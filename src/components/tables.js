import {el,button,input} from './dom.js';
import {field} from '../utils/data.js';
import {cellValue} from '../engines/pivot.js';
import {selection,pathKey} from '../engines/dimensions.js';

export async function objectTable(app,root,query,token,compact=false) {
  const {t,fmt,columns,session}=app;
  const cols=compact?columns.slice(0,5):columns;
  const search=input(query.search||'','search');search.placeholder=t('Поиск по значениям');search.setAttribute('aria-label',t('Поиск по значениям'));
  const bar=el('div','table-tools'),count=el('small','hint');bar.append(search,count);root.append(bar);
  const viewport=el('div','table-viewport');viewport.tabIndex=0;viewport.setAttribute('aria-label',t('Таблица объектов'));
  if(compact)viewport.classList.add('compact');
  const table=el('table','records'),head=el('thead'),body=el('tbody'),tr=el('tr');
  for(const c of cols) {
    const th=el('th');th.append(button(c.title,()=>{
      query.sort={code:c.code,desc:query.sort?.code===c.code&&!query.sort.desc};
      viewport.scrollTop=0;draw(true).catch(app.report);
    },'th-button'));tr.append(th);
  }
  head.append(tr);table.append(head,body);viewport.append(table);root.append(viewport);
  const rowHeight=33;
  let revision=0,last=-1,timer;
  function spacer(h){const tr=el('tr','spacer'),td=el('td');td.colSpan=Math.max(1,cols.length);td.style.height=h+'px';tr.append(td);return tr;}
  async function draw(force=false){
    if(token.cancelled)return;
    const start=Math.max(0,Math.floor(viewport.scrollTop/rowHeight)-8);
    if(last===start&&!force)return;last=start;
    const limit=Math.max(24,Math.ceil((viewport.clientHeight||480)/rowHeight)+18),seq=++revision;
    const p=await session.run('page',{...query,start,limit},token);
    if(token.cancelled||seq!==revision)return;
    count.textContent=fmt(p.count)+' '+t('объектов');body.replaceChildren(spacer(start*rowHeight));
    for(const {id,row} of p.items){
      const line=el('tr');line.tabIndex=0;line.onclick=()=>app.detail(id);line.onkeydown=e=>{if(e.key==='Enter')app.detail(id);};
      for(const c of cols){const str=fmt(field(row,c.code),c),td=el('td','',str);td.title=str;line.append(td);}body.append(line);
    }
    if(!p.count){const empty=el('td','empty',t('По текущим условиям нет объектов'));empty.colSpan=Math.max(1,cols.length);const tr=el('tr');tr.append(empty);body.append(tr);}
    body.append(spacer(Math.max(0,p.count-start-p.items.length)*rowHeight));
  }
  viewport.onscroll=()=>draw().catch(app.report);
  search.oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(token.cancelled)return;query.search=search.value;viewport.scrollTop=0;draw(true).catch(app.report);},175);};
  await draw(true);
}
export function pivotMatrix(model,spec,fmt,t){
  const path=p=>p.map(v=>v.text).join(' / ')||t('Итого');
  const headers=[t('Группа'),...model.cols.flatMap(c=>spec.measures.map(m=>path(c.path)+' · '+m.op+(m.field?' '+m.field:'')))];
  const rows=model.rows.map(r=>[path(r.path),...model.cols.flatMap(c=>spec.measures.map((m,i)=>cellValue(model,r.key,c.key,i)))]);
  return {headers,rows};
}
export function pivotTable(app,root,model,spec,onPick,compact=false){
  const {fmt,t}=app,closedR=new Set(),closedC=new Set();
  let page=0,colPage=0;
  const host=el('div','pivot-host');root.append(host);
  function visible(item,closed){return !item.path.some((_,i)=>i>0&&closed.has(pathKey(item.path.slice(0,i))));}
  function draw(){
    host.replaceChildren();
    const rr=model.rows.filter(r=>visible(r,closedR)),cc=model.cols.filter(c=>visible(c,closedC));
    const rsize=compact?8:40,csize=compact?4:8;
    page=Math.min(page,Math.ceil(rr.length/rsize)-1);colPage=Math.min(colPage,Math.ceil(cc.length/csize)-1);
    const rows=rr.slice(page*rsize,(page+1)*rsize),cols=cc.slice(colPage*csize,(colPage+1)*csize);
    const wrapper=el('div','pivot-scroll'),table=el('table','pivot-table'),head=el('thead'),tr=el('tr');
    tr.append(el('th','',t('Группа')));
    function header(th,item,dims,closed){
      const name=item.path.map(p=>p.text).join(' / ')||t('Итого');
      if(item.path.length&&item.path.length<dims.length){
        const b=button((closed.has(item.key)?'▸ ':'▾ ')+name,()=>{if(closed.has(item.key))closed.delete(item.key);else closed.add(item.key);draw();},'th-button');
        b.setAttribute('aria-expanded',String(!closed.has(item.key)));th.append(b);
      }else th.textContent=name;
      th.title=name;
    }
    for(const c of cols){
      for(const m of spec.measures){const th=el('th');header(th,c,spec.cols,closedC);th.append(el('small','measure-label',m.op.toUpperCase()+(m.field?' · '+m.field:'')));tr.append(th);}
    }
    head.append(tr);table.append(head);const body=el('tbody');
    let max=0;
    for(const r of rows)for(const c of cols)for(let i=0;i<spec.measures.length;i++){const v=cellValue(model,r.key,c.key,i);if(Number.isFinite(v))max=Math.max(max,Math.abs(v));}
    for(const r of rows){
      const line=el('tr',r.path.length?'':'total'),th=el('th');header(th,r,spec.rows,closedR);line.append(th);
      for(const c of cols)spec.measures.forEach((m,i)=>{
        const v=cellValue(model,r.key,c.key,i),td=el('td');
        if(spec.heat&&Number.isFinite(v)&&max)td.style.backgroundColor='rgba(111,95,211,'+(.04+.24*Math.abs(v)/max)+')';
        td.append(button(fmt(v),()=>onPick([...selection(spec.rows,r.path),...selection(spec.cols,c.path)]),'cell-button'));line.append(td);
      });
      body.append(line);
    }
    table.append(body);wrapper.append(table);host.append(wrapper);
    function pager(title,current,size,total,set){
      if(total<=size)return;
      const nav=el('div','row pager');nav.append(el('small','hint',title+' '+(current*size+1)+'–'+Math.min((current+1)*size,total)+' / '+total));
      const prev=button(t('Назад'),()=>{set(current-1);draw();}),next=button(t('Далее'),()=>{set(current+1);draw();});
      prev.disabled=current===0;next.disabled=(current+1)*size>=total;nav.append(prev,next);host.append(nav);
    }
    pager(t('Строки'),page,rsize,rr.length,v=>page=v);pager(t('Столбцы'),colPage,csize,cc.length,v=>colPage=v);
  }
  draw();
}
