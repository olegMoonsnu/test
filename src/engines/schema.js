import {LIMIT, check, dateMs, empty, field} from '../utils/data.js';
function infer(value, code) {
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return typeof value.uuid === 'string' ? 'reference' : 'object';
  if (typeof value === 'string' && dateMs(value) !== null) return 'date';
  if (typeof value === 'number' && /(?:At|Date|Дата)$/i.test(code) && Math.abs(value) >= 1e11 && dateMs(value) !== null) return 'date';
  return typeof value;
}
export class Schema {
  constructor(config) {
    this.declared = new Map(config.columns.map(c => [c.code, c]));
    this.types = new Map(config.columns.map(c => [c.code, null]));
    this.discover = config.includeUnlisted || !config.columns.length;
  }
  observe(row) {
    if (this.discover) for (const code of Object.keys(row)) {
      if (!this.types.has(code)) {
        check(this.types.size < LIMIT.columns, 'Слишком много уникальных полей');
        this.types.set(code, null);
      }
    }
    for (const [code, current] of this.types) {
      if (this.declared.get(code)?.type || current === 'mixed') continue;
      const value = field(row, code);
      if (empty(value)) continue;
      const next = infer(value, code);
      this.types.set(code, current && current !== next ? 'mixed' : next);
    }
  }
  finish() {
    return Array.from(this.types, ([code, type]) => ({code, title:code, ...this.declared.get(code), type:this.declared.get(code)?.type || type || 'string'}));
  }
}
