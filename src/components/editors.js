import {button,control,el,input,opNames,chartNames,select} from './dom.js';
import {operators} from '../engines/filter.js';
import {charts} from '../core/config.js';
import {ops} from '../engines/statistics.js';
const predicates={eq:'Равно',ne:'Не равно',contains:'Содержит',notContains:'Не содержит',starts:'Начинается с',ends:'Заканчивается на',gt:'Больше',lt:'Меньше',gte:'Больше или равно',lte:'Меньше или равно',between:'Между',in:'В списке',notIn:'Вне списка',filled:'Заполнено',empty:'Не заполнено',dateRange:'Диапазон дат',bool:'Да / нет'};
const buckets=[['none','Без интервала'],['day','День'],['week','Неделя'],['month','Месяц'],['year','Год']];
const modes=[['set','Набор целиком'],['first','Первое значение'],['explode','Каждое уникальное']];
export function editors(columns,t){
  const fields=columns.map(c=>[c.code,c.title]);
  const opts=list=>list.map(([k,v])=>[k,t(v)]);
  const add=(root,title,element)=>{root.append(control(t(title),element));return element;};
  function dimensions(root,title,initial,max){
    const section=el('fieldset');section.append(el('legend','',t(title)));
    const list=el('div');section.append(list);root.append(section);
    const entries=[];
    const append=d=>{
      if(entries.length>=max||!fields.length)return;
      const row=el('div','editor-row'),f=select(fields,d?.field),b=select(opts(buckets),d?.bucket||'none'),m=select(opts(modes),d?.mode||'set');
      const getter=()=>({field:f.value,bucket:b.value,mode:m.value});
      entries.push(getter);row.append(control(t('Поле'),f),control(t('Интервал UTC'),b),control(t('Массив'),m),
        button(t('Убрать'),()=>{entries.splice(entries.indexOf(getter),1);row.remove();},'icon','close',true));list.append(row);
    };
    initial.forEach(append);section.append(button(t('Добавить уровень'),()=>append(null),'link','plus'));return ()=>entries.map(f=>f());
  }
  function measurement(parent,initial={}){
    const row=el('div','editor-row'), op=select(opts(ops.map(k=>[k,opNames[k]])),initial.op||'count'),
      field=select([['',t('Все строки')],...fields],initial.field||''),p=input(initial.p??.95,'number');p.min='0';p.max='1';p.step='.01';
    row.append(control(t('Функция'),op),control(t('Значения'),field));const quant=control(t('Квантиль'),p);row.append(quant);
    op.onchange=()=>{quant.hidden=op.value!=='percentile';};op.onchange();parent.append(row);
    return ()=>({op:op.value,field:field.value,p:Number(p.value)});
  }
  function filter(initial){
    const wrap=el('div','filter-editor');
    let nodes=0;
    function group(node,depth,remove){
      const box=el('fieldset','group'),head=el('div','row'),join=select([['and',t('Все условия (AND)')],['or',t('Любое условие (OR)')]],node?.join||'and');
      join.setAttribute('aria-label',t('Объединение условий'));head.append(join);
      if(remove)head.append(button(t('Удалить группу'),remove,'icon','close',true));
      const rules=el('div');box.append(head,rules);
      const reads=[];
      function entry(n,isGroup){
        if(nodes>=80||(!fields.length&&!isGroup))return;nodes++;
        let element,get;
        const drop=()=>{nodes--;reads.splice(reads.indexOf(get),1);element.remove();};
        if(isGroup){const child=group(n,depth+1,drop);element=child.node;get=child.read;}
        else{
          element=el('div','rule');
          const f=select(fields,n?.field),op=select(opts(operators.map(k=>[k,predicates[k]])),n?.op||'eq'),values=el('div','rule-values');
          f.setAttribute('aria-label',t('Поле условия'));op.setAttribute('aria-label',t('Условие'));
          element.append(f,op,values,button(t('Удалить условие'),drop,'icon','close',true));
          let read;
          const display=(old)=>{
            values.replaceChildren();
            const type=columns.find(c=>c.code===f.value)?.type;
            const cast=s=>{if(type==='number'&&s!==''){const num=Number(s);if(!Number.isFinite(num))throw new Error(t('Введите число'));return num;}if(type==='boolean')return s==='true';return s;};
            const make=(v,ty='text')=>{const i=input(v??'',ty);i.setAttribute('aria-label',t('Значение'));values.append(i);return i;};
            if(['empty','filled'].includes(op.value))read=()=>null;
            else if(op.value==='bool'||(type==='boolean'&&['eq','ne'].includes(op.value))){
              const s=select([['true',t('Да')],['false',t('Нет')]],String(old??true));values.append(s);read=()=>s.value==='true';
            }else if(['between','dateRange'].includes(op.value)){
              const ty=op.value==='dateRange'?'date':type==='number'?'number':'text';
              const a=make(old?.[0],ty),b=make(old?.[1],ty);read=()=>[cast(a.value),cast(b.value)];
            }else if(['in','notIn'].includes(op.value)){
              const i=make(Array.isArray(old)?old.join('\n'):'');
              i.placeholder=t('Через запятую');i.value=Array.isArray(old)?old.join(', '):'';
              read=()=>i.value.split(',').map(v=>cast(v.trim()));
            }else{const i=make(old,type==='number'?'number':'text');read=()=>cast(i.value);}
          };
          f.onchange=op.onchange=()=>display(null);display(n?.value);
          get=()=>({field:f.value,op:op.value,value:read()});
        }
        reads.push(get);rules.append(element);
      }
      (node?.rules||[]).forEach(n=>entry(n,Array.isArray(n.rules)));
      const actions=el('div','row');actions.append(button(t('Условие'),()=>entry(null,false),'link','plus'));
      if(depth<5)actions.append(button(t('Группа'),()=>entry(null,true),'link','plus'));box.append(actions);
      return {node:box,read:()=>({join:join.value,rules:reads.map(f=>f())})};
    }
    const start=initial&&!initial.rules?{join:'and',rules:[initial]}:initial;
    const g=group(start,0);wrap.append(g.node);
    return {node:wrap,read:()=>{const v=g.read();return v.rules.length?v:null;}};
  }
  function widgetEditor(w){
    const root=el('div','edit-form'),title=add(root,'Название',input(w.title)),type=add(root,'Визуализация',select(opts(charts.map(k=>[k,chartNames[k]])),w.type));
    const dims=dimensions(root,'Группировка и детализация',w.dims,4),metric=measurement(root,w.measure);
    const extra=el('div','editor-row');root.append(extra);
    const nums=[['','—'],...fields], x=add(extra,'Ось X / распределение',select(nums,w.x)),y=add(extra,'Ось Y',select(nums,w.y)),goal=add(extra,'Цель шкалы',input(w.goal,'number'));
    const row=el('div','editor-row');root.append(row);
    const order=add(row,'Сортировка',select(opts([['key','По измерению'],['desc','TOP N'],['asc','BOTTOM N']]),w.order));
    const limit=add(row,'Лимит категорий',input(w.limit,'number'));limit.min='1';limit.max='60';
    const transform=add(row,'Расчёт',select(opts([['value','Значение'],['percent','Доля, %'],['cumulative','Накопительный итог'],['delta','Динамика, %']]),w.transform));
    const size=el('div','editor-row');root.append(size);
    const span=add(size,'Ширина',select(opts([['1','Одна колонка'],['2','Две колонки']]),String(w.span)));
    const height=add(size,'Высота',select(opts([['1','Обычная'],['2','Увеличенная']]),String(w.height)));
    root.append(el('h3','',t('Фильтр виджета')));const local=filter(w.filter);root.append(local.node);
    return {node:root,read:()=>({...w,title:title.value,type:type.value,dims:dims(),measure:metric(),x:x.value,y:y.value,goal:Number(goal.value),limit:Number(limit.value),order:order.value,transform:transform.value,span:Number(span.value),height:Number(height.value),filter:local.read()})};
  }
  function pivotEditor(p){
    const root=el('div','edit-form'), rd=dimensions(root,'Строки',p.rows,3),cd=dimensions(root,'Столбцы',p.cols,2);
    const section=el('fieldset');section.append(el('legend','',t('Показатели')));root.append(section);
    const reads=[];
    function append(m){
      if(reads.length>=4)return;
      const line=el('div','measure-line');section.append(line);
      const read=measurement(line,m);reads.push(read);
      line.append(button(t('Удалить показатель'),()=>{line.remove();reads.splice(reads.indexOf(read),1);},'icon','close',true));
    }
    p.measures.forEach(append);root.append(button(t('Добавить показатель'),()=>append({}),'link','plus'));
    const order=add(root,'Сортировка',select(opts([['key','По измерению'],['desc','По убыванию'],['asc','По возрастанию']]),p.order));
    const heat=add(root,'Цветовая шкала',select(opts([['1','Включена'],['0','Выключена']]),p.heat?'1':'0'));
    root.append(el('h3','',t('Фильтр сводной')));const local=filter(p.filter);root.append(local.node);
    return {node:root,read:()=>({rows:rd(),cols:cd(),measures:reads.map(f=>f()),order:order.value,heat:heat.value==='1',filter:local.read()})};
  }
  return {filter,widgetEditor,pivotEditor};
}
