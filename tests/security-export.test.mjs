import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {config} from '../src/core/config.js';
import {Session} from '../src/core/session.js';
import {safeUrl,LIMIT,copyValue} from '../src/utils/data.js';
import {csvCell,encodeTable,exportRows} from '../src/engines/export.js';
test('Импорт формирует структуру заново и отклоняет запрещённые имена',()=>{
  for(const input of ['{"__proto__":{}}','{"widgets":[{"constructor":{}}]}','{"columns":[{"code":"a.prototype.b"}]}','{"version":3}','[]','{"widgets":[{"type":"custom"}]}']){
    assert.throws(()=>config(input));
  }
  assert.equal({}.polluted,undefined);assert.throws(()=>config({columns:[{code:'a'},{code:'a'}]}));
  assert.throws(()=>config(' '.repeat(LIMIT.config+1)));assert.throws(()=>config({widgets:[{limit:999}]}));
  assert.equal(config({anything:'unused'}).anything,undefined);
  let n={field:'s',op:'filled'};for(let i=0;i<5;i++)n={join:'or',rules:[n]};
  assert.doesNotThrow(()=>config({widgets:[{filter:n}]}));assert.throws(()=>config({filter:{rules:[n]}}));
});
test('Проверка строк, размеров, аксессоров, циклов и типов',async()=>{
  const load=r=>new Session().load(r,config());
  for(const d of [null,[null],[3],new Array(100001),[{v:'a'.repeat(16385)}],[{v:new Set()}]]) await assert.rejects(()=>load(d));
  const cyclic={};cyclic.v=cyclic;await assert.rejects(()=>load([cyclic]),/глубокая/);
  let hits=0;const row={get x(){hits++;return 1;}};await assert.rejects(()=>load([row]));assert.equal(hits,0);
  assert.throws(()=>copyValue('abcdef',{used:0,max:10}));
  const ok=new Session();await ok.load([{s:'a'.repeat(16384),n:Infinity,empty:null}],config());
  assert.equal((await ok.run('detail',{id:0})).n,null);ok.dispose();
});
test('Ссылка остаётся внутри origin HTTP(S)',()=>{
  const base='https://example.test/app';
  assert.equal(safeUrl('/card/1',base),'https://example.test/card/1');
  for(const u of ['javascript:void(0)','data:,test','https://other.example/','//other.example/','https://u@example.test/','','file:///local'])assert.equal(safeUrl(u,base),null);
});
test('CSV, TSV, буфер, кириллица, кавычки и сохранение чисел',()=>{
  for(const str of ['=1+2','+2','-7','@SUM',' \t=1','\n1','＠X','＝X'])assert.ok(csvCell(str).startsWith('"\''));
  assert.equal(csvCell(-7),'-7');assert.equal(csvCell('И"Т'),'\"И\"\"Т\"');
  assert.equal(csvCell('две\tстроки\n', '\t',true),'"две строки "');
  assert.equal(encodeTable(['А'],[[1],[2]],'tsv','Demo'),'"А"\r\n1\r\n2');
});
test('HTML отчёт экранирует разметку и формирует текст, JSON сохраняет типы',async()=>{
  const s=new Session();await s.load([{a:'<b data-note="x">текст</b>',b:false},{a:null,b:true}],config());
  const columns=s.data.columns,html=await(await exportRows(s,{},columns,'html','<заголовок>')).text();
  assert.ok(html.includes('&lt;b'));assert.ok(!html.includes('<b data-note'));assert.ok(html.includes('&lt;заголовок&gt;'));
  assert.deepEqual(JSON.parse(await(await exportRows(s,{},columns,'json','A')).text()),[{a:'<b data-note="x">текст</b>',b:false},{a:null,b:true}]);
  const csv=new Uint8Array(await(await exportRows(s,{},columns,'csv','A')).arrayBuffer());assert.deepEqual([...csv.subarray(0,3)],[239,187,191]);s.dispose();
});
test('Промышленный файл автономен и не содержит сетевых или исполняющих строку вызовов',()=>{
  for(const suffix of ['','.min']){
    const js=readFileSync('dist/nsd-analytics'+suffix+'.js','utf8');
    for(const re of [/\beval\s*\(/,/\bnew Function\s*\(/,/\bfetch\s*\(/,/\bXMLHttpRequest\b/,/\bWebSocket\b/,/\bsendBeacon\b/,/\.innerHTML\s*=/])assert.doesNotMatch(js,re);
  }
});
