import {LIMIT,check,field,safeUrl,own} from '../utils/data.js';
import {config,widget,pivotSpec,filterTree,measure} from '../core/config.js';
import {Session} from '../core/session.js';
import {makeDefaults,chartQuery,widgetPivot,storageKey} from '../engines/dashboard.js';
import {el,icon,button,input,control,select,formatter,chartNames,opNames} from './dom.js';
import {editors} from './editors.js';
import {chart} from '../charts/render.js';
import {objectTable,pivotTable,pivotMatrix} from './tables.js';
import {exportRows,encodeTable,download,svgText,pngBlob,formats,escapeHtml,reportPage} from '../engines/export.js';
import styles from '../styles/studio.css';
const tabLabels={dashboard:'Дашборд',objects:'Объекты',pivot:'Сводная',periods:'Периоды'};
const tabIcons={dashboard:'grid',objects:'table',pivot:'pivot',periods:'clock'};
const clone=v=>JSON.parse(JSON.stringify(v));
const listRules=n=>!n?[]:n.rules?n.rules.flatMap(listRules):[n];

export class Studio {
  constructor(cfg,options,onClose){
    this.cfg=cfg;this.options=options;this.onClose=onClose;
    this.t=s=>typeof options.messages?.[s]==='string'&&own(options.messages,s)?options.messages[s]:s;
    this.fmt=formatter(cfg.locale);this.tab='dashboard';this.side=true;this.full=!!options.fullscreen;
    this.terms=[];this.extra=[];this.depth=new Map();this.tableQuery={};this.session=new Session();
    this.report=e=>{if(!this.closed&&e?.name!=='AbortError'){this.notice.textContent=e?.message||String(e);this.notice.classList.add('error');}};
    this.oldFocus=document.activeElement;
    this.host=document.createElement('div');this.host.setAttribute('data-nsd-analytics','studio');
    this.root=this.host.attachShadow({mode:'open'});const style=el('style');if(options.nonce)style.nonce=options.nonce;style.textContent=styles;this.root.append(style);
    this.wrap=el(options.mount?'div':'dialog',options.mount?'embedded':'backdrop');
    this.shell=el('section','shell');this.shell.tabIndex=-1;this.shell.setAttribute('aria-label','NSD Analytics Studio');
    this.top=el('header','top');this.layout=el('div','layout');this.sidebar=el('aside','sidebar');this.main=el('main','main');
    this.heading=el('div','heading');this.notice=el('div','notice');this.notice.setAttribute('role','status');
    this.content=el('div');this.main.append(this.heading,this.notice,this.content);this.layout.append(this.sidebar,this.main);
    this.shell.append(this.top,this.layout);this.wrap.append(this.shell);this.root.append(this.wrap);
    (options.mount||document.body).append(this.host);
    if(!options.mount){this.wrap.showModal();this.wrap.oncancel=e=>{e.preventDefault();this.popup?this.dismiss():this.onClose();};}
    this.shell.onkeydown=e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();this.popup?this.dismiss():this.onClose();}
      else if(e.key==='Tab'&&this.popup){
        const focus=[...this.popup.querySelectorAll('button:not(:disabled),input,select,textarea,[tabindex="0"]')].filter(n=>n.offsetParent!==null);
        if(!focus.length)return;
        if(e.shiftKey&&this.root.activeElement===focus[0]){e.preventDefault();focus[focus.length-1].focus();}
        else if(!e.shiftKey&&this.root.activeElement===focus[focus.length-1]){e.preventDefault();focus[0].focus();}
      }
    };
    this.chrome();this.shell.focus();
  }
  btn(s,fn,cls='',glyph,only=false){return button(this.t(s),()=>Promise.resolve().then(fn).catch(this.report),cls,glyph,only);}
  chrome(){
    const {t}=this;
    this.shell.classList.toggle('dark',this.cfg.theme==='dark');this.wrap.classList.toggle('full',this.full);
    this.sidebar.hidden=!this.side;this.layout.classList.toggle('noside',!this.side);this.top.replaceChildren();
    const logo=el('span','logo');logo.append(el('i'),el('i'),el('i'));const brand=el('div','brand');brand.append(logo,el('span','','NSD Analytics Studio'));
    this.top.append(this.btn('Показать или скрыть меню',()=>{this.side=!this.side;this.chrome();},'icon','menu',true),brand,el('span','top-divider'),el('span','top-meta',t('Рабочая область')),el('span','spacer-flex'),
      this.btn('Переключить тему',()=>{this.cfg.theme=this.cfg.theme==='dark'?'light':'dark';this.chrome();},'icon','sun',true),
      this.btn('На весь экран',async()=>{
        if(this.options.mount){
          if(document.fullscreenElement)await document.exitFullscreen();
          else await this.host.requestFullscreen();
        }else{this.full=!this.full;this.chrome();}
      },'icon','expand',true),this.btn('Закрыть',this.onClose,'icon','close',true));
    this.sidebar.replaceChildren(el('p','side-title',t('Рабочая область')));
    const nav=el('nav','nav');for(const [k,name] of Object.entries(tabLabels)){
      const b=this.btn(name,()=>{this.tab=k;this.draw();},k===this.tab?'active':'',tabIcons[k]);if(this.tab===k)b.setAttribute('aria-current','page');nav.append(b);
    }
    this.sidebar.append(nav);
    const section=el('div','side-section');section.append(el('p','side-title',t('Глобальные фильтры')));
    const rules=listRules(this.cfg.filter);
    for(const rule of rules.slice(0,3))section.append(el('span','filter-chip',this.col(rule.field)?.title+' · '+rule.op));
    if(!rules.length&&!this.terms.length&&!this.extra.length)section.append(el('small','hint',t('Все объекты выборки')));
    if(this.terms.length||this.extra.length)section.append(el('span','filter-chip',t('Выбор на диаграмме')));
    section.append(this.btn('Настроить фильтры',()=>this.editFilter(),'','filter'));
    if(rules.length||this.terms.length||this.extra.length)section.append(this.btn('Сбросить фильтры',()=>{this.cfg.filter=null;this.terms=[];this.extra=[];this.depth.clear();this.draw();},'link'));
    const tools=el('div','side-section');tools.append(el('p','side-title',t('Представление')),this.btn('Шаблоны дашбордов',()=>this.templates(),'link','layers'));
    this.sidebar.append(section,tools);
  }
  col(code){return this.columns?.find(c=>c.code===code);}
  async load(rows){
    this.shell.setAttribute('aria-busy','true');this.notice.textContent=this.t('Подготовка данных');
    const result=await this.session.load(rows,this.cfg,this.options,(n,total)=>{this.notice.textContent=this.t('Подготовка данных')+' · '+this.fmt(n)+' / '+this.fmt(total);});
    if(this.closed)return;
    this.columns=result.columns;this.count=result.count;this.edit=editors(this.columns,this.t);
    makeDefaults(this.cfg,this.columns);this.notice.textContent='';return this.draw();
  }
  query(filters=[],terms=[]){return {filters:[this.cfg.filter,...this.extra,...filters].filter(Boolean),terms:[...this.terms,...terms]};}
  async draw(){
    if(!this.columns||this.closed)return;
    this.session.cancel(this.token);const token=this.token={cancelled:false};
    this.pivotResult=null;this.dismiss(false);this.chrome();this.content.replaceChildren();this.heading.replaceChildren();this.notice.textContent='';this.notice.classList.remove('error');
    this.shell.setAttribute('aria-busy','true');
    const title=el('div'),meta=el('small');title.append(el('h1','',this.tab==='dashboard'?this.cfg.title:this.t(tabLabels[this.tab])),meta);
    const tools=el('div','toolbar');this.heading.append(title,tools);
    if(this.tab==='dashboard')tools.append(this.btn('Добавить виджет',()=>this.editWidget(null),'primary','plus'));
    if(this.tab==='pivot')tools.append(this.btn('Настроить сводную',()=>this.editPivot(),'primary','settings'));
    tools.append(this.btn('Экспорт',()=>this.exportMenu(),'','download'));
    const query=this.query();
    try{
      const count=await this.session.run('size',query,token);if(token.cancelled)return;
      meta.append(icon('database'),document.createTextNode(this.fmt(count)+' / '+this.fmt(this.count)+' '+this.t('объектов')));
      if(this.tab==='dashboard')await this.dashboard(token);
      else if(this.tab==='objects'){
        this.tableQuery={...this.tableQuery,...query};
        const panel=el('div','panel');this.content.append(panel);await objectTable(this,panel,this.tableQuery,token);
      }else if(this.tab==='pivot'){
        const p=this.cfg.pivot, panel=el('div','panel');this.content.append(panel);
        const result=await this.session.run('pivot',{...this.query([p.filter]),spec:p},token);
        if(token.cancelled)return;this.pivotResult=result;pivotTable(this,panel,result,p,terms=>this.drill(terms,[p.filter],true));
      }else await this.periods(token);
    }catch(e){this.report(e);}
    finally{if(!token.cancelled)this.shell.setAttribute('aria-busy','false');}
  }
  async dashboard(token){
    const kpis=el('div','kpis'),grid=el('div','grid');
    if(this.cfg.widgets.some(w=>w.type==='kpi'))this.content.append(kpis);
    if(this.cfg.widgets.some(w=>w.type!=='kpi'))this.content.append(el('h2','section-head',this.t('Распределение и динамика')),grid);
    if(!this.cfg.widgets.length)this.content.append(el('p','empty',this.t('Добавьте первый виджет')));
    for(const w of this.cfg.widgets){
      if(token.cancelled)return;
      const kpi=w.type==='kpi',card=el('article','widget'+(kpi?' kpi':'')+(w.span===2?' wide':'')+(w.height===2?' tall':''));
      card.dataset.widget=w.id;const head=el('div','card-head');head.append(el('h3','',w.title),this.btn('Настройки · '+w.title,()=>this.widgetMenu(w,card),'icon','dot',true));
      const body=el('div',kpi?'kpi-body':'chart-body');card.append(head,body);(kpi?kpis:grid).append(card);
      const filters=[w.filter],q=this.query(filters);
      try{
        if(w.type==='table'){await objectTable(this,body,q,token,true);continue;}
        const spec=chartQuery(w,this.depth.get(w.id)||0),matrix=['pivot','heatmap','stacked'].includes(w.type);
        if(['heatmap','stacked'].includes(w.type)&&w.dims.length<2){body.append(el('p','empty',this.t('Выберите два измерения')));continue;}
        const p=matrix?widgetPivot(w):null;
        const result=matrix?await this.session.run('pivot',{...q,spec:p},token):await this.session.run('chart',{...q,w:kpi?{...spec,dims:[]}:spec},token);
        if(token.cancelled)return;
        if(kpi){
          const val=el('strong','',this.fmt(result.total)),unit=this.col(w.measure.field)?.unit;
          if(unit&&!['count','distinct'].includes(w.measure.op))val.append(el('span','unit',unit));
          body.append(val,el('small','hint',this.t(opNames[w.measure.op])));
          val.tabIndex=0;val.setAttribute('role','button');val.onclick=()=>this.drill([],filters,true);val.onkeydown=e=>{if(e.key==='Enter')val.click();};
        }else if(w.type==='pivot')pivotTable(this,body,result,p,terms=>this.drill(terms,filters,true),true);
        else body.append(chart(result,spec,{fmt:this.fmt,t:this.t,choose:g=>{
          if(g.id!==undefined){this.detail(g.id);return;}
          this.pick(w,g);
        }}));
      }catch(e){if(e.name!=='AbortError')body.replaceChildren(el('p','empty',e.message));}
    }
  }
  drill(terms,filters,openObjects){
    this.terms.push(...terms);this.extra.push(...filters.filter(Boolean));this.tableQuery={};
    if(openObjects)this.tab='objects';this.draw();
  }
  pick(w,g){
    const items=[[this.t('Фильтровать дашборд'),()=>this.drill(g.terms||[],[],false)],
      [this.t('Показать исходные объекты'),()=>this.drill(g.terms||[],[w.filter],true)]];
    const n=this.depth.get(w.id)||0;
    if(n+1<w.dims.length&&!['stacked','heatmap','scatter','box','histogram'].includes(w.type))items.push([this.t('Следующий уровень'),()=>{
      this.depth.set(w.id,n+1);this.drill(g.terms||[],[],false);
    }]);
    this.menu(g.path?.map(p=>p.text).join(' / ')||w.title,items);
  }
  async detail(id){
    try{
      const row=await this.session.run('detail',{id},this.token);if(!row||this.closed)return;
      const dl=el('dl','detail');for(const c of this.columns)dl.append(el('dt','',c.title),el('dd','',this.fmt(field(row,c.code),c)));
      const url=safeUrl(field(row,this.options.urlField||'url'),document.baseURI);
      const actions=[];
      if(this.options.onOpenObject||url)actions.push(this.btn('Открыть карточку',()=>{
        if(this.options.onOpenObject)this.options.onOpenObject(row);
        else window.open(url,'_blank','noopener,noreferrer');
      },'primary','arrow'));
      this.dialog(this.t('Исходный объект'),dl,actions);
    }catch(e){this.report(e);}
  }
  dialog(title,node,actions=[]){
    this.dismiss(false);this.focusBefore=this.root.activeElement;
    const bg=el('div','dialog-bg'),box=el('section','dialog');box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-label',title);
    const head=el('div','row');head.append(el('h2','',title),this.btn('Закрыть окно',()=>this.dismiss(),'icon','close',true));
    const content=el('div','dialog-content');content.append(node);
    const foot=el('div','dialog-actions');foot.append(...actions);
    box.append(head,content,foot);bg.append(box);this.shell.append(bg);this.popup=bg;
    this.layout.inert=true;this.top.inert=true;head.querySelector('button').focus();
  }
  dismiss(focus=true){
    if(!this.popup)return;this.popup.remove();this.popup=null;this.layout.inert=false;this.top.inert=false;
    if(focus&&this.focusBefore?.isConnected)this.focusBefore.focus();this.focusBefore=null;
  }
  form(title,editor,save){
    const error=el('p','error');error.setAttribute('role','alert');editor.node.append(error);
    const apply=this.btn('Применить',()=>{
      try{const previous=this.exportConfig();try{save(editor.read());config(this.cfg);}catch(e){this.cfg=previous;throw e;}this.dismiss();this.draw();}catch(e){error.textContent=e.message;}
    },'primary','check');
    this.dialog(this.t(title),editor.node,[this.btn('Отмена',()=>this.dismiss()),apply]);
  }
  menu(title,items){
    const list=el('div','menu-list');
    for(const [name,action] of items)list.append(button(name,()=>{this.dismiss();Promise.resolve().then(action).catch(this.report);}));
    this.dialog(title,list);
  }
  editFilter(){if(this.edit)this.form('Глобальные фильтры',this.edit.filter(this.cfg.filter),v=>{this.cfg.filter=filterTree(v);});}
  editPivot(){this.form('Настроить сводную',this.edit.pivotEditor(this.cfg.pivot),v=>{this.cfg.pivot=pivotSpec(v);this.cfg.autoPivot=false;});}
  editWidget(w){
    const init=w||widget({id:'w'+Date.now().toString(36),title:this.t('Новый виджет'),dims:this.columns.length?[this.columns[0].code]:[]});
    this.form(w?'Настроить виджет':'Добавить виджет',this.edit.widgetEditor(init),v=>{
      const entry=widget(v);
      if(w)this.cfg.widgets[this.cfg.widgets.indexOf(w)]=entry;
      else{check(this.cfg.widgets.length<LIMIT.widgets,'Достигнут лимит виджетов');this.cfg.widgets.push(entry);}
      this.depth.delete(entry.id);
    });
  }
  widgetMenu(w,card){
    const arr=this.cfg.widgets,i=arr.indexOf(w),items=[[this.t('Настроить виджет'),()=>this.editWidget(w)]];
    function swap(a,b){[arr[a],arr[b]]=[arr[b],arr[a]];}
    if(i>0)items.push([this.t('Переместить выше'),()=>{swap(i,i-1);this.draw();}]);
    if(i<arr.length-1)items.push([this.t('Переместить ниже'),()=>{swap(i,i+1);this.draw();}]);
    items.push([this.t('Показать исходные объекты'),()=>this.drill([],[w.filter],true)]);
    const svg=card.querySelector('svg.viz');
    if(svg)items.push(['SVG',()=>download(new Blob([svgText(svg)],{type:formats.svg}),'chart.svg')],['PNG',async()=>download(await pngBlob(svg),'chart.png')]);
    items.push([this.t('Удалить виджет'),()=>{arr.splice(i,1);this.draw();}]);this.menu(w.title,items);
  }
  exportConfig(){return clone(this.cfg);}
  importConfig(raw){
    const next=config(raw);
    if(next.columns.length){
      const known=new Set(this.columns.map(c=>c.code));check(next.columns.every(c=>known.has(c.code)),'Шаблон содержит неизвестные колонки');
    }
    // Projection and types belong to the current authorised dataset.
    next.columns=this.cfg.columns;next.includeUnlisted=this.cfg.includeUnlisted;
    const known=new Set(this.columns.map(c=>c.code));
    const fieldCheck=k=>{if(k)check(known.has(k),'Шаблон использует недоступное поле: '+k);};
    function checkFilter(n){for(const r of listRules(n))fieldCheck(r.field);}
    for(const w of next.widgets){w.dims.forEach(d=>fieldCheck(d.field));fieldCheck(w.measure.field);fieldCheck(w.x);fieldCheck(w.y);checkFilter(w.filter);}
    [...next.pivot.rows,...next.pivot.cols].forEach(d=>fieldCheck(d.field));next.pivot.measures.forEach(m=>fieldCheck(m.field));
    checkFilter(next.pivot.filter);checkFilter(next.filter);
    this.cfg=next;this.fmt=formatter(next.locale);this.terms=[];this.extra=[];this.depth.clear();this.tableQuery={};return this.draw();
  }
  templates(){
    const key=storageKey(this.options.storageKey);
    const items=[[this.t('Скачать шаблон JSON'),()=>download(new Blob([JSON.stringify(this.cfg,null,2)],{type:formats.json}),'dashboard.json')],
      [this.t('Импортировать шаблон JSON'),()=>{
        const f=input('','file');f.accept='.json,application/json';
        f.onchange=async()=>{try{const file=f.files[0];if(!file)return;check(file.size<=LIMIT.config,'Файл конфигурации слишком большой');const raw=await file.text();if(!this.closed)await this.importConfig(raw);}catch(e){this.report(e);}};f.click();
      }]];
    if(key)items.push([this.t('Сохранить в этом браузере'),()=>{
      const allowed=new Set(this.options.persistFilterFields||[]);
      const filters=[this.cfg.filter,this.cfg.pivot.filter,...this.cfg.widgets.map(w=>w.filter)];
      check(filters.flatMap(listRules).every(r=>r.value==null||allowed.has(r.field)),'Хост не разрешил локальное хранение значений этих фильтров');
      localStorage.setItem(key,JSON.stringify(this.cfg));this.notice.textContent=this.t('Шаблон сохранён');
    }],[this.t('Восстановить из браузера'),()=>{const raw=localStorage.getItem(key);check(raw,'Сохранённого шаблона нет');return this.importConfig(raw);}]);
    this.menu(this.t('Шаблоны дашбордов'),items);
  }
  async periods(token){
    const panel=el('div','panel edit-form'),dates=this.columns.filter(c=>c.type==='date');
    this.content.append(panel);if(!dates.length){panel.append(el('p','empty',this.t('Для сравнения требуется колонка даты')));return;}
    const date=select(dates.map(c=>[c.code,c.title])),m=select(Object.entries(opNames)),f=select([['',this.t('Все строки')],...this.columns.map(c=>[c.code,c.title])]);
    const controls=el('div','editor-row');controls.append(control(this.t('Дата'),date),control(this.t('Функция'),m),control(this.t('Значения'),f));panel.append(controls);
    const now=new Date(),day=86400000,iso=x=>new Date(x).toISOString().slice(0,10);
    const inputs=[-27,-14,-13,0].map(d=>input(iso(+now+d*day),'date')),range=el('div','editor-row');
    ['Предыдущий с','Предыдущий по','Текущий с','Текущий по'].forEach((s,i)=>range.append(control(this.t(s),inputs[i])));panel.append(range);
    const out=el('div','notice');panel.append(this.btn('Сравнить периоды',async()=>{
      const v=inputs.map(i=>i.value);check(v.every(Boolean)&&v[0]<=v[1]&&v[2]<=v[3],'Проверьте границы периодов');
      const r=await this.session.run('periods',{...this.query(),previous:v.slice(0,2),current:v.slice(2),field:date.value,measure:measure({op:m.value,field:f.value})},token);
      if(!token.cancelled)out.textContent=this.t('Предыдущий')+' '+this.fmt(r.previous)+'  ·  '+this.t('Текущий')+' '+this.fmt(r.current)+'  ·  Δ '+this.fmt(r.change)+'  ·  '+this.fmt(r.percent)+' %';
    },'primary'),out);
  }
  exportMenu(){
    const {t}=this,items=[],token=this.token;
    for(const [format,name] of [['csv','CSV'],['tsv','TSV'],['json','JSON'],['html','HTML'],['copy','Копировать для Excel']]){
      items.push([t(name),async()=>{
        const copy=format==='copy',kind=copy?'tsv':format;
        let blob;
        if(this.tab==='pivot'&&this.pivotResult){
          const m=pivotMatrix(this.pivotResult,this.cfg.pivot,this.fmt,t);
          const str=kind==='json'?JSON.stringify({columns:m.headers,rows:m.rows}):encodeTable(m.headers,m.rows,kind,this.cfg.title,copy);
          blob=new Blob([!copy&&['csv','tsv'].includes(kind)?'\ufeff':'',str],{type:formats[kind]});
          check(blob.size<=LIMIT.exportBytes,'Слишком большой экспорт');
        }else if(kind==='html'&&this.tab==='dashboard'){
          let body='';
          for(const card of this.content.querySelectorAll('.widget')){
            body+='<section><h2>'+escapeHtml(card.querySelector('h3').textContent)+'</h2>';
            const svg=card.querySelector('.viz');body+=svg?svgText(svg):'<p>'+escapeHtml(card.querySelector('.kpi-body,.chart-body')?.textContent)+'</p>';body+='</section>';
          }
          blob=new Blob([reportPage(this.cfg.title,body)],{type:formats.html});
        }else{
          const q=this.tab==='objects'?this.tableQuery:this.query();
          blob=await exportRows(this.session,q,this.columns,kind,this.cfg.title,token,copy);
        }
        if(token.cancelled)return;
        if(copy){check(navigator.clipboard?.writeText,'Буфер обмена недоступен. Используйте TSV.');await navigator.clipboard.writeText(await blob.text());this.notice.textContent=t('Скопировано');}
        else download(blob,'analytics.'+kind);
      }]);
    }
    items.push([t('Печать отчёта'),()=>this.print()]);this.menu(t('Экспорт'),items);
  }
  print(){
    const frame=el('iframe');frame.title=this.t('Печать отчёта');frame.style.cssText='position:fixed;right:0;bottom:0;width:1px;height:1px;border:0';
    const token=this.token;
    const run=async()=>{
      let content;
      if(this.tab==='dashboard'){
        const blocks=[...this.content.querySelectorAll('.widget')].map(card=>{
          const s=card.querySelector('.viz');
          return '<section><h2>'+escapeHtml(card.querySelector('h3').textContent)+'</h2>'+(s?svgText(s):escapeHtml(card.querySelector('.kpi-body,.chart-body')?.textContent))+'</section>';
        });content=reportPage(this.cfg.title,blocks.join(''));
      }else if(this.tab==='pivot'&&this.pivotResult){
        const m=pivotMatrix(this.pivotResult,this.cfg.pivot,this.fmt,this.t);content=encodeTable(m.headers,m.rows,'html',this.cfg.title);
      }else content=await (await exportRows(this.session,this.tab==='objects'?this.tableQuery:this.query(),this.columns,'html',this.cfg.title,token)).text();
      if(token.cancelled)return;
      frame.onload=()=>{const win=frame.contentWindow;win.onafterprint=()=>frame.remove();win.focus();win.print();};
      frame.srcdoc=content;this.shell.append(frame);
    };return run();
  }
  dispose(){
    this.closed=true;this.session.cancel(this.token);this.session.dispose();this.host.remove();this.columns=null;this.pivotResult=null;
    if(this.oldFocus?.isConnected)this.oldFocus.focus();
  }
}
