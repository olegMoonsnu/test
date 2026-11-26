import {widget,pivotSpec} from '../core/config.js';
export function makeDefaults(cfg,columns) {
  const category=columns.find(c=>['string','boolean','reference','array'].includes(c.type)&&!['uuid','title','url'].includes(c.code))||columns[0];
  const number=columns.find(c=>c.type==='number'),date=columns.find(c=>c.type==='date');
  if(cfg.autoWidgets && !cfg.widgets.length){
    const defaults=[{id:'count',title:'Всего объектов',type:'kpi'}];
    if(number)defaults.push({id:'average',title:'Среднее · '+number.title,type:'kpi',measure:{op:'avg',field:number.code}});
    if(category)defaults.push({id:'distribution',title:'Распределение · '+category.title,type:'bar',dims:[category.code]});
    if(date)defaults.push({id:'trend',title:'Динамика · '+date.title,type:'line',dims:[{field:date.code,bucket:'month'}],order:'key'});
    cfg.widgets=defaults.map(widget);cfg.autoWidgets=false;
  }
  if(!cfg.pivot.rows.length && !cfg.pivot.cols.length && cfg.autoPivot!==false && category)cfg.pivot=pivotSpec({...cfg.pivot,rows:[category.code]});
}
export function chartQuery(w,depth=0){
  const multi=['stacked','heatmap','pivot'].includes(w.type);
  return {...w,dims:multi?w.dims:w.dims.slice(depth,depth+1),order:w.type==='pareto'?'desc':w.order};
}
export function widgetPivot(w){
  return pivotSpec({rows:w.dims.slice(0,1),cols:w.dims.slice(1,2),measures:[w.measure],order:w.order,heat:true});
}
// Explicit storage only. Titles and filter literals may be company information.
// The embedder opts into storing its configuration only after classifying it.
export function storageKey(scope){
  if(typeof scope!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(scope))return null;
  return 'nsd-analytics:v1:'+scope;
}
