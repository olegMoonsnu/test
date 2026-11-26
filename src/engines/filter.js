import {dateMs, empty, field, identity, label} from '../utils/data.js';
import {members} from './dimensions.js';
export const operators = ['eq','ne','contains','notContains','starts','ends','gt','lt','gte','lte','between','in','notIn','filled','empty','dateRange','bool'];
const negative = {ne:'eq', notContains:'contains', notIn:'in'};
function comparable(v, type) {
  if (v == null) return null;
  if (type === 'number') return typeof v === 'number' && Number.isFinite(v) ? v : null;
  if (type === 'date') return dateMs(v);
  if (type === 'boolean') return typeof v === 'boolean' ? v : null;
  if (typeof v === 'object' && typeof v.uuid === 'string') return v.uuid;
  return typeof v === 'object' ? identity(v) : v;
}
export function predicate(node, columns) {
  if (!node) return () => true;
  if (node.rules) {
    const tests = node.rules.map(n => predicate(n, columns));
    if (!tests.length) return () => true;
    return node.join === 'or' ? row => tests.some(f => f(row)) : row => tests.every(f => f(row));
  }
  const {field:code, op, value} = node;
  const type = columns.get(code)?.type;
  const cast = v => comparable(v,type);
  const base = negative[op] || op;
  const lo = cast(Array.isArray(value) ? value[0] : value);
  const hi = cast(Array.isArray(value) ? value[1] : null);
  const list = new Set((Array.isArray(value) ? value : [value]).map(cast));
  const text = String(value ?? '').toLocaleLowerCase();
  const compare = raw => {
    const v = cast(raw);
    if (base === 'eq' || base === 'bool') return v === lo && (v !== null || value === null);
    if (base === 'in') return list.has(v) && (v !== null || (Array.isArray(value) && value.includes(null)));
    if (v === null) return false;
    switch (base) {
      case 'gt': return lo !== null && v > lo;
      case 'gte': return lo !== null && v >= lo;
      case 'lt': return lo !== null && v < lo;
      case 'lte': return lo !== null && v <= lo;
      case 'between': return lo !== null && hi !== null && v >= lo && v <= hi;
      case 'dateRange': {
        const t = dateMs(raw), a = dateMs(value[0]), b = dateMs(value[1]);
        const end = typeof value[1] === 'string' && value[1].length === 10 ? b + 86400000 - 1 : b;
        return t !== null && a !== null && b !== null && t >= a && t <= end;
      }
      default: {
        const s = label(raw).toLocaleLowerCase();
        if (base === 'starts') return s.startsWith(text);
        if (base === 'ends') return s.endsWith(text);
        return s.includes(text);
      }
    }
  };
  return row => {
    const raw = field(row, code);
    if (op === 'filled' || op === 'empty') return empty(raw) === (op === 'empty');
    const match = Array.isArray(raw) ? raw.some(compare) : compare(raw);
    return negative[op] ? !match : match;
  };
}
export function matchesSelection(row, terms) {
  return terms.every(term => {
    if (term.dim) return members(row, term.dim).some(m => m.key === term.key);
    const v = field(row,term.field);
    if (term.index !== undefined) return false;
    return Number.isFinite(v) && v >= term.low && (term.inclusive ? v <= term.high : v < term.high);
  });
}
