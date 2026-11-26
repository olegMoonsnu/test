import test from 'node:test';
import assert from 'node:assert/strict';
import {Accumulator,boxSummary,relative} from '../src/engines/statistics.js';
import {config,dimension,filterTree,measure,pivotSpec,widget} from '../src/core/config.js';
import {Dataset} from '../src/core/dataset.js';
import {Session} from '../src/core/session.js';
import {dateMs,identity,field} from '../src/utils/data.js';
import {predicate} from '../src/engines/filter.js';
import {cellValue} from '../src/engines/pivot.js';
const metric=(op,values,p=.95)=>{const a=new Accumulator(measure({op,field:'v',p}));values.forEach(v=>a.add(v));return a.result();};
const make=(rows,cfg={})=>{const d=new Dataset(config(cfg));d.append(rows);d.finish();return d;};
const records=[{uuid:'z',team:'A',status:'x',v:-2,tags:['q','q','r'],at:'2025-01-01'},
  {uuid:'z',team:'A',status:'y',v:8,tags:['q'],at:'2025-01-03'},
  {uuid:'b',team:'B',status:'x',v:0,tags:[],at:'2025-02-01'},
  {team:'B',status:'x',v:null,at:'2025-03-01'}];
const values=[-2,0,4,6,null,'8',NaN,Infinity];
for(const [op,result] of Object.entries({count:7,distinct:5,sum:8,avg:2,min:-2,max:6,median:2,mode:-2,percentile:5.7,stddev:Math.sqrt(10),variance:10})){
  test('Агрегат '+op,()=>{
    // Dataset ingestion maps nonfinite values to null before aggregation.
    const clean=values.map(v=>typeof v==='number'&&!Number.isFinite(v)?null:v);
    const expected=op==='count'?5:result;
    const v=metric(op,clean);
    if(typeof expected==='number')assert.ok(Math.abs(v-expected)<1e-12);else assert.equal(v,expected);
  });
}
test('Нет наблюдений, одна строка, равная частота, большие числа',()=>{
  for(const op of ['sum','avg','min','max','median','stddev','variance','mode'])assert.equal(metric(op,[null,undefined]),null);
  assert.equal(metric('stddev',[7]),0);assert.equal(metric('median',[7]),7);assert.equal(metric('mode',['A','B','B','A']),'A');
  assert.equal(metric('sum',[1e308,1e308]),null);assert.equal(metric('avg',[1e308,1e308]),1e308);
  assert.equal(metric('percentile',[2,7],0),2);assert.equal(metric('percentile',[2,7],1),7);
  assert.equal(relative(0,0),null);assert.equal(relative(-5,-10),50);
  assert.deepEqual(boxSummary([0,1,2,3,4,100]).outliers,[100]);
});
test('Типы, вложенные пути, объединение поздних полей, UTC',async()=>{
  const d=make([{n:1,whenAt:1795651200000},{n:'1',invented:true,ref:{uuid:'r',title:'R'},tags:['a'],o:{x:1}}]);
  assert.deepEqual(Object.fromEntries(d.columns.map(c=>[c.code,c.type])),{n:'mixed',whenAt:'date',invented:'boolean',ref:'reference',tags:'array',o:'object'});
  assert.equal(dateMs('2025-02-29'),null);assert.equal(dateMs('2024-02-29'),Date.UTC(2024,1,29));
  assert.equal(dateMs('10/12/2026'),null);assert.equal(dateMs('2025-01-01T00:00:00'),null);
  const s=new Session();await s.load([{a:{n:4},secret:'omit'}],config({columns:[{code:'a.n',type:'string'}]}));
  const row=(await s.run('page',{limit:1})).items[0].row;
  assert.equal(field(row,'a.n'),4);assert.deepEqual(Object.keys(row),['a.n']);s.dispose();
});
const fieldMap=new Map([['v',{type:'number'}],['s',{type:'string'}],['b',{type:'boolean'}],['d',{type:'date'}],['a',{type:'array'}]]);
const sample={v:-2,s:'Тестовая строка',b:false,d:'2024-03-03T23:59:00Z',a:['x','y']};
for(const [op,f,val,expected] of [
  ['eq','v',-2,true],['ne','s','другое',true],['contains','s','СТОВАЯ',true],['notContains','s','ТЕСТ',false],
  ['starts','s','тест',true],['ends','s','ка',true],['gt','v',-3,true],['gte','v',-2,true],['lt','v',0,true],
  ['lte','v',-2,true],['between','v',[-2,0],true],['in','a',['y'],true],['notIn','a',['y'],false],
  ['empty','missing',null,true],['filled','b',null,true],['dateRange','d',['2024-03-01','2024-03-03'],true],
  ['bool','b',false,true]]){
  test('Фильтр '+op,()=>assert.equal(predicate(filterTree({field:f,op,value:val}),fieldMap)(sample),expected));
}
test('AND и OR, ссылки по UUID, наборы и типовые ключи',()=>{
  const n={join:'and',rules:[{field:'v',op:'gte',value:-2},{join:'or',rules:[{field:'s',op:'eq',value:'?'},{field:'b',op:'bool',value:false}]}]};
  assert.ok(predicate(filterTree(n),fieldMap)(sample));
  assert.notEqual(identity(1),identity('1'));assert.equal(identity(['b','a','b']),identity(['a','b']));
  assert.equal(identity({uuid:'r',title:'old'}),identity({uuid:'r',title:'new'}));
  assert.ok(predicate({field:'r',op:'eq',value:'r'},new Map())({r:{uuid:'r',title:'R'}}));
});
test('Группировка, TOP/BOTTOM, накопление, доля, относительное отклонение',async()=>{
  const d=make(records);
  const run=(opts={})=>d.run('chart',{w:widget({type:'bar',dims:['team'],measure:{op:'sum',field:'v'},...opts})});
  assert.deepEqual((await run()).groups.map(x=>x.value),[6,0]);
  assert.equal((await run({order:'asc',limit:1})).groups[0].path[0].text,'B');
  assert.deepEqual((await run({transform:'percent'})).groups.map(x=>x.value),[100,0]);
  assert.deepEqual((await run({transform:'cumulative'})).groups.map(x=>x.value),[6,6]);
  assert.deepEqual((await run({transform:'delta'})).groups.map(x=>x.value),[null,-100]);
  const r=await run({dims:['team','status'],measure:{op:'count'}});assert.equal(r.count,3);assert.equal(r.total,4);
  assert.equal((await run({dims:[],measure:{op:'distinct',field:'uuid'}})).total,2);
  assert.equal((await make([]).run('chart',{w:widget()})).total,0);
});
test('Массивы, три способа учёта, сводная и корректный неаддитивный итог',async()=>{
  const d=make(records),r=await d.run('pivot',{spec:pivotSpec({rows:['team','status'],cols:[{field:'tags',mode:'explode'}],measures:[{op:'count'},{op:'avg',field:'v'},{op:'median',field:'v'}]})});
  assert.deepEqual(r.values[JSON.stringify(['[]','[]'])],[4,2,0]);
  const a=r.rows.find(x=>x.path.length===1&&x.path[0].text==='A'),q=r.cols.find(x=>x.path[0]?.text==='q');
  assert.equal(cellValue(r,a.key,q.key),2);assert.equal(cellValue(r,a.key,'[]',1),3);
  for(const mode of ['first','set','explode']){
    const g=await d.run('chart',{w:widget({dims:[{field:'tags',mode}]})});
    assert.equal(g.total,4);assert.equal(g.groups.reduce((s,v)=>s+v.value,0),mode==='explode'?5:4);
  }
});
test('Сравнение произвольных периодов и выбор исходных наблюдений',async()=>{
  const d=make(records),result=await d.run('periods',{field:'at',previous:['2025-01-01','2025-01-31'],current:['2025-02-01','2025-02-28'],measure:measure()});
  assert.deepEqual(result,{previous:2,current:1,change:-1,percent:-50});
  const w=widget({dims:[{field:'at',bucket:'month'}],order:'key'}),g=await d.run('chart',{w});
  const pg=await d.run('page',{terms:g.groups[0].terms,sort:{code:'v',desc:true}});
  assert.deepEqual(pg.items.map(x=>x.row.v),[8,-2]);assert.equal((await d.run('page',{search:'absent'})).count,0);
});
test('Распределения, рассеяние, отмена до запроса, лимит веера',async()=>{
  const d=make(records);
  const hist=await d.run('chart',{w:widget({type:'histogram',x:'v'})});
  for(const g of hist.groups)assert.equal((await d.run('page',{terms:g.terms})).count,g.value);
  assert.equal((await d.run('chart',{w:widget({type:'scatter',x:'v',y:'v'})})).count,3);
  assert.equal((await d.run('chart',{w:widget({type:'box',x:'v'})})).box.median,0);
  const s=new Session();await s.load([],config());await assert.rejects(async()=>s.run('size',{},{cancelled:true}),{name:'AbortError'});s.dispose();
  const many=make([{a:Array.from({length:70},(_,i)=>i)}]);
  await assert.rejects(()=>many.run('chart',{w:widget({dims:[dimension({field:'a',mode:'explode'})]})}),/лимит комбинаций/);
});
