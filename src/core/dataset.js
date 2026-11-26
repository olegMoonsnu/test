import {LIMIT,check,field,label,dateMs} from '../utils/data.js';
import {Schema} from '../engines/schema.js';
import {predicate,matchesSelection} from '../engines/filter.js';
import {Cache,scan} from '../engines/performance.js';
import {grouped,distribution} from '../engines/aggregate.js';
import {pivot} from '../engines/pivot.js';
import {relative} from '../engines/statistics.js';

export class Dataset {
  constructor(config) {
    this.rows=[];this.schema=new Schema(config);this.views=new Cache(6);this.results=new Cache(24);
  }
  append(batch) {
    check(this.rows.length+batch.length<=LIMIT.rows,'Превышен лимит объектов');
    for(const row of batch){this.schema.observe(row);this.rows.push(row);}
  }
  finish() {
    this.columns=this.schema.finish();
    this.fields=new Map(this.columns.map(c=>[c.code,c]));
    this.all=Uint32Array.from({length:this.rows.length},(_,i)=>i);
    return {columns:this.columns,count:this.rows.length};
  }
  async view(q,token) {
    const key=JSON.stringify([q.filters||[],q.terms||[],q.search||'',q.sort||null]);
    const cached=this.views.get(key); if(cached) return cached;
    const filters=(q.filters||[]).filter(Boolean).map(n=>predicate(n,this.fields));
    const terms=q.terms||[], search=(q.search||'').toLocaleLowerCase();
    if(!filters.length&&!terms.length&&!search&&!q.sort) return this.all;
    const ids=[];
    await scan(this.all,id=>{
      const row=this.rows[id];
      if(filters.every(test=>test(row)) && (!terms.length || matchesSelection(row,terms)) &&
        (!search || this.columns.some(c=>label(field(row,c.code)).toLocaleLowerCase().includes(search)))) ids.push(id);
    },token);
    if(q.sort) {
      const {code,desc}=q.sort,type=this.fields.get(code)?.type;
      const collator=new Intl.Collator('ru',{numeric:true});
      const val=row=>{const v=field(row,code);return type==='date'?dateMs(v):v;};
      ids.sort((a,b)=>{
        const x=val(this.rows[a]),y=val(this.rows[b]);
        if(x==null || y==null) return Number(x==null)-Number(y==null) || a-b;
        const diff=typeof x==='number' && typeof y==='number'?x-y:collator.compare(label(x),label(y));
        return (desc?-diff:diff) || a-b;
      });
    }
    return this.views.set(key,Uint32Array.from(ids));
  }
  async run(command,q={},token) {
    if(command==='detail') return this.rows[q.id] ?? null;
    const ids=await this.view(q,token);
    if(command==='page') {
      const start=Math.max(0,q.start||0),limit=Math.min(Math.max(1,q.limit||40),2048);
      return {count:ids.length,items:Array.from(ids.subarray(start,start+limit),id=>({id,row:this.rows[id]}))};
    }
    if(command==='size') return ids.length;
    const key=JSON.stringify([command,q]), cached=this.results.get(key); if(cached) return cached;
    let result;
    if(command==='pivot') result=await pivot(this.rows,ids,q.spec,token);
    else if(command==='chart') {
      result=['scatter','histogram','box'].includes(q.w.type)?await distribution(this.rows,ids,q.w,token):await grouped(this.rows,ids,q.w,token);
    } else if(command==='periods') {
      const aggregate=async range=>{
        const periodIds=await this.view({...q,filters:[...(q.filters||[]),{field:q.field,op:'dateRange',value:range}]},token);
        return (await grouped(this.rows,periodIds,{dims:[],measure:q.measure,limit:1,order:'key',transform:'value'},token)).total;
      };
      const previous=await aggregate(q.previous),current=await aggregate(q.current);
      result={previous,current,change:Number.isFinite(previous)&&Number.isFinite(current)?current-previous:null,percent:relative(current,previous)};
    } else throw new Error('Неизвестная команда');
    // Large sparse pivots can each occupy several MB.
    return command==='pivot'?result:this.results.set(key,result);
  }
}
