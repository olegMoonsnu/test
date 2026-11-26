import {LIMIT, check, field, label} from '../utils/data.js';
import {Accumulator, relative, boxSummary} from './statistics.js';
import {tuples,pathKey,selection} from './dimensions.js';
import {scan} from './performance.js';

export async function grouped(data, ids, w, token) {
  let updates=0;
  const groups = new Map(), total = new Accumulator(w.measure);
  await scan(ids, id => {
    const row=data[id], value=field(row,w.measure.field);
    total.add(value);
    const paths=tuples(row,w.dims);
    updates+=paths.length;
    check(updates<=LIMIT.updates,'Превышен лимит обновлений групп');
    for(const path of paths) {
      const key=pathKey(path);
      let g=groups.get(key);
      if (!g) {
        check(groups.size < LIMIT.groups,'Слишком много групп. Уточните фильтр или укрупните период.');
        g={path,acc:new Accumulator(w.measure)}; groups.set(key,g);
      }
      g.acc.add(value);
    }
  },token);
  let all=Array.from(groups.values(),g=>({path:g.path, value:g.acc.result(),terms:selection(w.dims,g.path)}));
  const byKey=(a,b)=>a.path.map(p=>p.text).join(' / ').localeCompare(b.path.map(p=>p.text).join(' / '),'ru',{numeric:true});
  all.sort((a,b)=>{
    if(w.order === 'key') return byKey(a,b);
    if(a.value == null || b.value == null) return Number(a.value == null)-Number(b.value == null) || byKey(a,b);
    const diff=typeof a.value === 'number' && typeof b.value === 'number' ? a.value-b.value : label(a.value).localeCompare(label(b.value));
    return (w.order==='asc'?diff:-diff) || byKey(a,b);
  });
  const count=all.length, sum=all.reduce((s,g)=>s+(Number.isFinite(g.value)?g.value:0),0);
  let running=0,previous=null;
  for (const g of all) {
    const raw=g.value;
    g.raw=raw;
    g.percent=Number.isFinite(raw) && Number.isFinite(sum) && sum !== 0 ? raw/sum*100 : null;
    if (Number.isFinite(raw)) running+=raw;
    if(w.transform==='percent') g.value=g.percent;
    if(w.transform==='cumulative') g.value=Number.isFinite(raw) && Number.isFinite(running)?running:null;
    if(w.transform==='delta') g.value=relative(raw,previous);
    previous=raw;
  }
  all=all.slice(0,w.limit);
  return {kind:'group',groups:all,total:total.result(),rows:ids.length,count,omitted:count-all.length};
}
export async function distribution(data, ids, w, token) {
  const values=[], points=[];
  let valid=0, low=Infinity, high=-Infinity;
  const rng = (()=>{let seed=71;return ()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);})();
  await scan(ids,id=>{
    const row=data[id], x=field(row,w.x || w.measure.field);
    if(!Number.isFinite(x)) return;
    if(w.type==='scatter') {
      const y=field(row,w.y);
      if(!Number.isFinite(y)) return;
      valid++;
      const point={x,y,id}, j=valid<=500?valid-1:Math.floor(rng()*valid);
      if(j<500) points[j]=point;
    } else {
      values.push(x); low=Math.min(low,x); high=Math.max(high,x);
    }
  },token);
  if(w.type==='scatter') return {kind:'scatter',points,count:valid,omitted:valid-points.length};
  if(w.type==='box') {
    const box=boxSummary(values);
    if(box){box.outlierCount=box.outliers.length;box.outliers=box.outliers.slice(0,64);}
    return {kind:'box',box,count:values.length,field:w.x || w.measure.field};
  }
  if(!values.length) return {kind:'group',groups:[],count:0,omitted:0};
  const n=low===high?1:Math.min(w.limit,Math.ceil(Math.sqrt(values.length)));
  const step=(high-low)/n;
  check(Number.isFinite(step),'Диапазон чисел превышает точность гистограммы');
  const groups=Array.from({length:n},(_,i)=>{
    const a=low+i*step,b=i===n-1?high:low+(i+1)*step;
    return {path:[{key:String(i),text:Number(a.toPrecision(4))+'…'+Number(b.toPrecision(4))}],value:0,
      terms:[{field:w.x||w.measure.field,low:a,high:b,inclusive:i===n-1}]};
  });
  for(const v of values) groups[step?Math.min(n-1,Math.floor((v-low)/step)):0].value++;
  return {kind:'group',groups,count:n,total:values.length,omitted:0};
}
