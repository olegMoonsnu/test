import {LIMIT, check, dateMs, field, identity, label} from '../utils/data.js';
export function members(row, dimension) {
  let value = field(row, dimension.field);
  if (dimension.bucket && dimension.bucket !== 'none') {
    const ms = dateMs(value);
    if (ms === null) value = null;
    else {
      const date = new Date(ms);
      if (dimension.bucket === 'week') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
      const len = dimension.bucket === 'year' ? 4 : dimension.bucket === 'month' ? 7 : 10;
      value = date.toISOString().slice(0, len);
    }
  }
  const list = Array.isArray(value) && dimension.mode !== 'set' ?
    (dimension.mode === 'first' ? value.slice(0,1) : value) : [value];
  const unique = new Map();
  for (const item of list.length ? list : [null]) {
    const key = identity(item);
    if (!unique.has(key)) unique.set(key, {key, text:label(item)});
  }
  return [...unique.values()];
}
export function tuples(row, dimensions) {
  let paths = [[]];
  for (const d of dimensions) {
    const values = members(row, d);
    check(paths.length * values.length <= LIMIT.fanout, 'Превышен лимит комбинаций одной строки');
    paths = paths.flatMap(path => values.map(item => [...path,item]));
  }
  return paths;
}
export const pathKey = path => JSON.stringify(path.map(v => v.key));
export const selection = (dims, path) => path.map((v,i) => ({dim:dims[i],key:v.key}));
