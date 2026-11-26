import {performance} from 'node:perf_hooks';
import os from 'node:os';
import {readFile,writeFile} from 'node:fs/promises';
import '../demo/mock-data.js';
import {Session} from '../src/core/session.js';
import {config,widget,pivotSpec} from '../src/core/config.js';
const rows=[],sizes=[100,1000,10000,50000,100000],round=n=>Math.round(n*100)/100;
const cpu=os.cpus()[0]?.model;
const quota=await readFile('/sys/fs/cgroup/cpu.max','utf8').catch(()=>null);
const memoryLimit=await readFile('/sys/fs/cgroup/memory.max','utf8').catch(()=>null);
const timing=async fn=>{const t=performance.now();const v=await fn();return [round(performance.now()-t),v];};
const mid=a=>a.slice().sort((a,b)=>a-b)[Math.floor(a.length/2)];
for(const size of sizes){
  const runs=[];
  for(let i=0;i<3;i++){
    const input=NSDDemo.generate('tickets',size),raw=NSDDemo.config('tickets');
    delete raw.persistFilterFields;delete raw.storageKey;
    const s=new Session(),cfg=config(raw),filter={field:'slaViolated',op:'bool',value:true};
    const [load]=await timing(()=>s.load(input,cfg,{worker:false}));
    const [filterGroup,g]=await timing(()=>s.run('chart',{filters:[filter],w:widget({dims:['department','status'],measure:{field:'duration',op:'avg'}})}));
    const [pivot,p]=await timing(()=>s.run('pivot',{spec:pivotSpec(cfg.pivot)}));
    if(p.values[JSON.stringify(['[]','[]'])][0]!==size)throw new Error('pivot mismatch');
    runs.push({load,filterGroup,pivot,matched:g.rows});s.dispose();
  }
  rows.push({objects:size,load:mid(runs.map(v=>v.load)),filterGroup:mid(runs.map(v=>v.filterGroup)),pivot:mid(runs.map(v=>v.pivot)),runs});
}
const result={version:'0.1.0',runtime:process.version,platform:os.platform()+' '+os.arch(),cpu,quota:quota?.trim(),memoryLimit:memoryLimit?.trim(),unit:'ms',rounds:3,seed:417,rows};
console.table(rows.map(({runs,...r})=>r));if(process.argv.includes('--record'))await writeFile('benchmarks/results.json',JSON.stringify(result,null,2)+'\n');
