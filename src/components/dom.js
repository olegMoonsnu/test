import {dateMs,label} from '../utils/data.js';
export function el(tag,cls='',content) {
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  if(content!=null)node.textContent=String(content);
  return node;
}
export function svg(tag, attrs={},content) {
  const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const [k,v] of Object.entries(attrs)) node.setAttribute(k,String(v));
  if(content!=null) node.textContent=String(content);
  return node;
}
const paths={
  grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  table:'M3 4h18v16H3z M3 9h18 M3 14h18 M9 9v11',
  pivot:'M3 4h18v16H3z M3 9h18 M9 4v16 M13 16l4-4 M14 12h3v3',
  filter:'M3 5h18l-7 8v5l-4 2v-7z', plus:'M12 5v14 M5 12h14',
  download:'M12 3v12 M7 10l5 5 5-5 M4 16v4h16v-4', close:'M6 6l12 12 M18 6L6 18',
  expand:'M4 10V4h6 M14 4h6v6 M20 14v6h-6 M10 20H4v-6',
  sun:'M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l2 2 M17 17l2 2 M19 5l-2 2 M7 17l-2 2 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  settings:'M4 7h8 M16 7h4 M4 17h3 M11 17h9 M12 4v6 M8 14v6',
  database:'M20 6c0 4-16 4-16 0s16-4 16 0z M4 6v12c0 4 16 4 16 0V6 M4 12c0 4 16 4 16 0',
  chart:'M4 3v17h17 M8 15V9 M13 15V5 M18 15v-4', arrow:'M5 12h14 M13 6l6 6-6 6',
  clock:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 6v6l4 2',
  check:'M3 12l6 6L21 5', layers:'M12 3l9 5-9 5-9-5z M3 12l9 5 9-5 M3 16l9 5 9-5',
  dot:'M4 12h1 M11 12h1 M18 12h1', save:'M4 4h13l3 3v13H4z M8 4v6h8V4 M8 20v-6h8v6',
  menu:'M3 5h18 M3 12h18 M3 19h18', search:'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0 M15 15l6 6'
};
export function icon(name) {
  const n=svg('svg',{viewBox:'0 0 24 24',width:17,height:17,fill:'none',stroke:'currentColor','stroke-width':1.65,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':true});
  n.append(svg('path',{d:paths[name]||paths.chart}));return n;
}
export function button(title,fn,cls='',glyph,iconOnly=false) {
  const b=el('button',cls);b.type='button';b.title=title;b.setAttribute('aria-label',title);
  if(glyph)b.append(icon(glyph));if(!iconOnly)b.append(document.createTextNode(title));
  b.onclick=fn;return b;
}
export const opt=(v,s)=>{const o=el('option','',s);o.value=v;return o;};
export function select(items,value,change) {
  const s=el('select');
  for(const item of items) s.append(Array.isArray(item)?opt(item[0],item[1]):opt(item,item));
  if(value!=null)s.value=value;if(change)s.onchange=()=>change(s.value);return s;
}
export function input(value='',type='text'){const n=el('input');n.type=type;n.value=value;return n;}
export function control(caption,element) {
  const l=el('label','field');l.append(el('span','',caption),element);element.setAttribute('aria-label',caption);return l;
}
export function formatter(locale){
  const number=new Intl.NumberFormat(locale,{maximumFractionDigits:2});
  const date=new Intl.DateTimeFormat(locale,{timeZone:'UTC',year:'numeric',month:'2-digit',day:'2-digit'});
  return (value,column)=>{
    if(value==null)return '—';
    if(column?.type==='date'){const ms=dateMs(value);return ms==null?'—':date.format(ms);}
    if(typeof value==='number') return number.format(value);
    return label(value);
  };
}
export const chartNames={bar:'Горизонтальные столбцы',column:'Вертикальные столбцы',pie:'Круговая',donut:'Кольцевая',line:'Линия',stacked:'С накоплением',area:'Область',heatmap:'Тепловая карта',scatter:'Диаграмма рассеяния',histogram:'Гистограмма',treemap:'Карта дерева',funnel:'Воронка',kpi:'KPI',pareto:'Парето',box:'Ящик с усами',gauge:'Шкала',pivot:'Сводная таблица',table:'Таблица объектов'};
export const opNames={count:'Количество',distinct:'Уникальные значения',sum:'Сумма',avg:'Среднее',min:'Минимум',max:'Максимум',median:'Медиана',mode:'Мода',percentile:'Перцентиль',stddev:'Стандартное отклонение',variance:'Дисперсия'};
