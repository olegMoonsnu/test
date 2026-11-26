export const LIMIT = Object.freeze({
  rows: 100000, columns: 96, depth: 8, list: 128, text: 16384,
  bytes: 64 * 1024 * 1024, config: 128 * 1024, groups: 12000,
  cells: 12000, fanout: 64, widgets: 32, filters: 80, exportBytes: 32 * 1024 * 1024
});
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
export const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
export function check(ok, message) { if (!ok) throw new Error(message); }
export function safeKey(key) {
  return typeof key === 'string' && key.length > 0 && key.length <= 128 &&
    key.split('.').every(part => part && !forbidden.has(part)) && !/[\x00-\x1f]/.test(key);
}
export function plain(value) {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}
function spend(budget, amount) {
  budget.used += amount;
  check(budget.used <= budget.max, 'Превышен лимит объёма данных');
}
export function copyValue(value, budget, depth = 0) {
  check(depth <= (budget.depth ?? LIMIT.depth), 'Слишком глубокая структура');
  spend(budget, 8);
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    check(value.length <= LIMIT.text, 'Слишком длинная строка');
    spend(budget, 2 * value.length);
    return value;
  }
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (Array.isArray(value)) {
    check(value.length <= LIMIT.list, 'Слишком длинный многозначный атрибут');
    const list = new Array(value.length);
    for (let i = 0; i < value.length; i++) list[i] = copyValue(readOwn(value, i), budget, depth + 1);
    return list;
  }
  check(plain(value), 'Ожидается JSON-совместимый объект');
  const result = Object.create(null);
  const keys = Object.keys(value);
  check(keys.length <= LIMIT.columns, 'Слишком много атрибутов');
  for (const key of keys) {
    check(safeKey(key), 'Недопустимое имя атрибута');
    spend(budget, key.length * 2);
    result[key] = copyValue(readOwn(value, key), budget, depth + 1);
  }
  return result;
}
export function readOwn(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) return undefined;
  check(own(descriptor, 'value'), 'Входные данные содержат вычисляемое свойство');
  return descriptor.value;
}
export function field(row, path) {
  if (!path) return undefined;
  if (own(row, path)) return row[path];
  let value = row;
  for (const part of path.split('.')) {
    if (!value || typeof value !== 'object' || !own(value, part)) return undefined;
    value = value[part];
  }
  return value;
}
export const empty = value => value == null || value === '' || (Array.isArray(value) && !value.length);
export function dateMs(value) {
  if (typeof value === 'number') return Number.isFinite(new Date(value).getTime()) ? value : null;
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d\d)-(\d\d)(?:T\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d))?$/.exec(value);
  if (!match) return null;
  const day = new Date(match[1] + '-' + match[2] + '-' + match[3] + 'T00:00:00Z');
  if (!Number.isFinite(+day) || day.getUTCDate() !== +match[3]) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}
export function identity(value) {
  if (value == null) return 'null';
  if (Array.isArray(value)) return 'a' + JSON.stringify([...new Set(value.map(identity))].sort());
  if (typeof value === 'object') {
    if (typeof value.uuid === 'string') return 'r' + JSON.stringify(value.uuid);
    return 'o' + JSON.stringify(Object.keys(value).sort().map(k => [k, identity(value[k])]));
  }
  return typeof value + ':' + JSON.stringify(value);
}
export function label(value) {
  if (value == null) return '∅';
  if (Array.isArray(value)) return [...new Set(value.map(label))].sort().join(', ') || '∅';
  if (typeof value === 'object') {
    if (typeof value.uuid === 'string') return typeof value.title === 'string' ? value.title : value.uuid;
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  return String(value);
}
export function safeUrl(value, base) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, base);
    return /^https?:$/.test(url.protocol) && url.origin === new URL(base).origin &&
      !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
