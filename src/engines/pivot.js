import {LIMIT,check,field} from '../utils/data.js';
import {Accumulator} from './statistics.js';
import {tuples,pathKey} from './dimensions.js';
import {scan} from './performance.js';

function prefixes(row,dims) {
  const result=new Map([['[]',[]]]);
  for(const path of tuples(row,dims)) for(let depth=1;depth<=path.length;depth++){
    const prefix=path.slice(0,depth); result.set(pathKey(prefix),prefix);
  }
  return result;
}
export async function pivot(data,ids,spec,token) {
  const rows=new Map([['[]',[]]]), cols=new Map([['[]',[]]]), cells=new Map();
  let updates=0;
  const states=()=>spec.measures.map(m=>new Accumulator(m));
  cells.set(JSON.stringify(['[]','[]']),states());
  await scan(ids,id=>{
    const row=data[id], rp=prefixes(row,spec.rows),cp=prefixes(row,spec.cols);
    check(rp.size*cp.size<=LIMIT.fanout*12,'Слишком много комбинаций в сводной');
    updates+=rp.size*cp.size*spec.measures.length;
    check(updates<=LIMIT.updates,'Слишком много обновлений ячеек. Сократите число мер, уровней или строк.');
    const values=spec.measures.map(m=>field(row,m.field));
    for(const [rk,r] of rp) {
      rows.set(rk,r);
      for(const [ck,c] of cp) {
        cols.set(ck,c);
        const key=JSON.stringify([rk,ck]);
        let cell=cells.get(key);
        if(!cell) {
          check((cells.size+1)*spec.measures.length<=LIMIT.cells,'Слишком много ячеек сводной. Сократите измерения или выборку.');
          cell=states();cells.set(key,cell);
        }
        cell.forEach((s,i)=>s.add(values[i]));
      }
    }
  },token);
  const values=Object.create(null);
  for(const [key,cell] of cells) values[key]=cell.map(s=>s.result());
  function hierarchy(map,axis) {
    const children=new Map();
    for(const [key,path] of map) {
      if(!path.length) continue;
      const parent=pathKey(path.slice(0,-1));
      if(!children.has(parent)) children.set(parent,[]);
      children.get(parent).push({key,path});
    }
    const ordered=[];
    function walk(parent) {
      const items=children.get(parent) || [];
      const total=item=>values[JSON.stringify(axis==='rows'?[item.key,'[]']:['[]',item.key])]?.[0];
      items.sort((a,b)=>{
        const t=spec.order==='key'?0:(Number(total(a))-Number(total(b)))*(spec.order==='asc'?1:-1);
        return t || a.path[a.path.length-1].text.localeCompare(b.path[b.path.length-1].text,'ru',{numeric:true});
      });
      for(const item of items){ordered.push(item);walk(item.key);}
    }
    walk('[]');return [...ordered,{key:'[]',path:[]}];
  }
  return {kind:'pivot',rows:hierarchy(rows,'rows'),cols:hierarchy(cols,'cols'),values,rowsCount:ids.length};
}
export const cellValue=(p,r,c,i=0)=>p.values[JSON.stringify([r,c])]?.[i] ?? null;
