import {LIMIT, check, copyValue, plain, safeKey, own} from '../utils/data.js';
import {measureSpec} from '../engines/statistics.js';
import {operators} from '../engines/filter.js';
export const charts = ['bar','column','pie','donut','line','stacked','area','heatmap','scatter','histogram','treemap','funnel','kpi','pareto','box','gauge','pivot','table'];
const types = ['string','number','boolean','date','array','object','reference','mixed'];
const text = (v, fallback = '') => {
  if (v === undefined) return fallback;
  check(typeof v === 'string' && v.length <= 180, 'Некорректная подпись'); return v;
};
const code = (s,optional=false) => {
  if (optional && (s == null || s === '')) return '';
  check(safeKey(s), 'Некорректный код поля'); return s;
};
function list(value, max) {
  check(Array.isArray(value) && value.length <= max,'Некорректная длина списка'); return value;
}
function pick(v,options,initial) {
  v = v ?? initial; check(options.includes(v),'Недопустимое значение настройки'); return v;
}
function integer(n,initial,lo,hi) {
  n = n ?? initial; check(Number.isInteger(n) && n >= lo && n <= hi,'Число вне диапазона'); return n;
}
export function dimension(value) {
  const d = typeof value === 'string' ? {field:value} : value;
  check(plain(d),'Ожидается измерение');
  return {field:code(d.field),bucket:pick(d.bucket,['none','day','week','month','year'],'none'),mode:pick(d.mode,['set','first','explode'],'set')};
}
export function measure(v={}) {
  check(plain(v),'Ожидается мера');
  const m = measureSpec(v); m.field = code(m.field,true);
  check(m.op === 'count' || m.field, 'Выберите поле показателя'); return m;
}
export function filterTree(n, state={n:0}, level=0) {
  if (n == null) return null;
  check(plain(n) && level <= 5 && ++state.n <= LIMIT.filters,'Слишком сложный фильтр');
  if (own(n,'rules')) {
    return {join:pick(n.join,['and','or'],'and'),rules:list(n.rules,LIMIT.filters).map(x => {
      check(x != null,'Пустое условие'); return filterTree(x,state,level+1);
    })};
  }
  const op = pick(n.op,operators,'eq'), value = n.value ?? null;
  const scalar = v => v == null || typeof v === 'boolean' || Number.isFinite(v) || (typeof v === 'string' && v.length <= 2048);
  check(Array.isArray(value) ? value.length <= 100 && value.every(scalar) : scalar(value),'Некорректное значение фильтра');
  if (['in','notIn','between','dateRange'].includes(op)) check(Array.isArray(value),'Ожидается список значений');
  if (['between','dateRange'].includes(op)) check(value.length === 2,'Задайте обе границы');
  if (op === 'bool') check(typeof value === 'boolean','Ожидается логическое значение');
  return {field:code(n.field),op,value};
}
export function widget(v={},i=0) {
  check(plain(v),'Некорректный виджет');
  const goal = v.goal ?? 100;
  check(Number.isFinite(goal) && goal > 0,'Цель должна быть положительной');
  return {id:code(v.id ?? ('w'+i)), title:text(v.title,'Показатель'), type:pick(v.type,charts,'bar'),
    dims:list(v.dims ?? [],4).map(dimension), measure:measure(v.measure), filter:filterTree(v.filter),
    order:pick(v.order,['desc','asc','key'],'desc'), limit:integer(v.limit,12,1,60),
    span:integer(v.span,1,1,2), height:integer(v.height,1,1,2), goal,
    x:code(v.x,true), y:code(v.y,true), transform:pick(v.transform,['value','percent','cumulative','delta'],'value')};
}
export function pivotSpec(p={}) {
  check(plain(p),'Некорректная сводная таблица');
  const measures = list(p.measures ?? [{}],4).map(measure);
  check(measures.length,'Добавьте хотя бы одну меру');
  return {rows:list(p.rows ?? [],3).map(dimension), cols:list(p.cols ?? [],2).map(dimension), measures,
    order:pick(p.order,['key','desc','asc'],'key'), heat:p.heat !== false, filter:filterTree(p.filter)};
}
export function config(input={}) {
  if (typeof input === 'string') { check(input.length <= LIMIT.config,'Слишком большой шаблон'); input = JSON.parse(input); }
  check(plain(input),'Конфигурация должна быть объектом');
  // Validate even ignored keys before projecting into a fresh configuration.
  const v = copyValue(input,{used:0,max:LIMIT.config});
  check(v.version == null || v.version === 1,'Неподдерживаемая версия шаблона');
  const columns = list(v.columns ?? [],LIMIT.columns).map(c => {
    check(plain(c),'Некорректная колонка');
    if (c.type != null) check(types.includes(c.type),'Неизвестный тип поля');
    return {code:code(c.code),title:text(c.title,c.code),type:c.type ?? null,unit:text(c.unit)};
  });
  check(new Set(columns.map(c=>c.code)).size === columns.length,'Повтор кода колонки');
  const widgets = list(v.widgets ?? [],LIMIT.widgets).map(widget);
  check(new Set(widgets.map(w=>w.id)).size === widgets.length,'Повтор ID виджета');
  const locale = text(v.locale,'ru-RU');
  try { new Intl.NumberFormat(locale); } catch { throw new Error('Некорректная локаль'); }
  return {version:1,title:text(v.title,'Аналитика объектов'),locale,theme:pick(v.theme,['light','dark'],'light'),
    columns, includeUnlisted:v.includeUnlisted === true, filter:filterTree(v.filter), widgets,
    pivot:pivotSpec(v.pivot), autoWidgets:v.autoWidgets ?? !own(v,'widgets')};
}
