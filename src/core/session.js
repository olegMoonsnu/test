import {LIMIT,check,copyValue,plain,own,readOwn} from '../utils/data.js';
import {abort,checkpoint,pause} from '../engines/performance.js';
import {Dataset} from './dataset.js';

function readPath(row,code) {
  if(own(row,code)) return readOwn(row,code);
  let value=row;
  for(const key of code.split('.')) {
    if(!plain(value)) return undefined;
    value=readOwn(value,key);
  }
  return value;
}
export class Session {
  constructor() {this.serial=0; this.pending=new Map(); this.life={cancelled:false};this.mode='main';}
  async load(rows,cfg,options={},progress=()=>{}) {
    check(Array.isArray(rows) && rows.length<=LIMIT.rows,'Ожидается массив до 100 000 объектов');
    if(rows.length>=5000 && options.worker!==false && typeof Worker==='function' && typeof __NSD_WORKER__==='string') {
      let timer;
      try {
        const url=URL.createObjectURL(new Blob([__NSD_WORKER__],{type:'text/javascript'}));
        try{this.worker=new Worker(url);}finally{URL.revokeObjectURL(url);}
        this.worker.onmessage=({data})=>{
          const p=this.pending.get(data.id);if(!p)return;
          this.pending.delete(data.id);
          if(data.error){const e=new Error(data.error);e.name=data.name;p.reject(e);} else p.resolve(data.value);
        };
        this.worker.onerror=event=>{event.preventDefault();this.failAll(new Error('Worker остановлен'));};
        await Promise.race([this.send('hello'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Worker недоступен')),2000);})]);
        this.mode='worker';
      }catch{this.worker?.terminate();this.worker=null;this.failAll(new Error('Worker недоступен'));}
      finally{clearTimeout(timer);}
    }
    checkpoint(this.life);
    if(this.worker) await this.send('begin',cfg); else this.data=new Dataset(cfg);
    const budget={used:0,max:LIMIT.bytes};
    const projection=cfg.columns.length && !cfg.includeUnlisted ? cfg.columns.map(c=>c.code) : null;
    for(let start=0;start<rows.length;start+=512) {
      checkpoint(this.life);
      const batch=[];
      for(let i=start;i<Math.min(rows.length,start+512);i++) {
        const row=readOwn(rows,i);
        check(plain(row),'Строка '+(i+1)+' должна быть объектом');
        if(!projection){batch.push(copyValue(row,budget));continue;}
        const out=Object.create(null);
        for(const k of projection){const value=readPath(row,k);if(value!==undefined){budget.used+=2*k.length;out[k]=copyValue(value,budget);}}
        batch.push(out);
      }
      if(this.worker) await this.send('append',batch);else this.data.append(batch);
      progress(Math.min(start+512,rows.length),rows.length);
      if(rows.length>2000 && !this.worker) await pause();
    }
    checkpoint(this.life);
    return this.worker?this.send('finish'):this.data.finish();
  }
  send(cmd,payload,token) {
    const id=++this.serial;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{resolve,reject,token});
      try{this.worker.postMessage({id,cmd,payload});}catch(e){this.pending.delete(id);reject(e);}
    });
  }
  run(cmd,q,token=this.life) {
    checkpoint(this.life);checkpoint(token);
    return this.worker?this.send(cmd,q,token):this.data.run(cmd,q,token);
  }
  cancel(token) {
    if(!token)return;
    token.cancelled=true;
    if(this.worker)for(const [id,p] of this.pending)if(p.token===token)this.worker.postMessage({cmd:'cancel',payload:id});
  }
  failAll(error){for(const p of this.pending.values())p.reject(error);this.pending.clear();}
  dispose(){
    this.life.cancelled=true;
    this.worker?.terminate();this.worker=null;this.data=null;
    try{abort();}catch(error){this.failAll(error);}
  }
}
