import {empty, identity, check} from '../utils/data.js';
export const ops = ['count','distinct','sum','avg','min','max','median','mode','percentile','stddev','variance'];
export function quantile(sorted, p) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index), part = index - low;
  if (!part) return sorted[low];
  return sorted[low] * (1 - part) + sorted[low + 1] * part;
}
export function relative(value, base) {
  if (!Number.isFinite(value) || !Number.isFinite(base) || base === 0) return null;
  const ratio = (value - base) / Math.abs(base) * 100;
  return Number.isFinite(ratio) ? ratio : null;
}
function lastInside(sorted, upper) {
  let index=sorted.length-1;
  while(index>0 && sorted[index]>upper) index--;
  return index;
}
export function boxSummary(samples) {
  if (!samples.length) return null;
  const a = samples.slice().sort((x,y) => x-y);
  const q1 = quantile(a, .25), q3 = quantile(a, .75), iqr = q3 - q1;
  const lower = q1 - 1.5 * iqr, upper = q3 + 1.5 * iqr;
  const outliers = a.filter(x => x < lower || x > upper);
  return {q1, q3, median:quantile(a,.5), min:a.find(x => x >= lower),
    max:a[lastInside(a,upper)], lower, upper, outliers};
}
export class Accumulator {
  constructor(measure) {
    this.m = measure;
    this.n = this.mean = this.m2 = this.total = this.correction = 0;
    this.low = Infinity; this.high = -Infinity;
    if (['distinct','mode'].includes(measure.op)) this.freq = new Map();
    if (['median','percentile'].includes(measure.op)) this.samples = [];
  }
  add(value) {
    const op = this.m.op;
    if (op === 'count') { if (!this.m.field || !empty(value)) this.n++; return; }
    if (empty(value)) return;
    if (this.freq) {
      const key = identity(value), old = this.freq.get(key);
      if (old) old.n++;
      else this.freq.set(key, {value, n:1});
      return;
    }
    if (!Number.isFinite(value)) return;
    this.n++;
    if (this.samples) { this.samples.push(value); return; }
    this.low = Math.min(this.low, value); this.high = Math.max(this.high, value);
    // Compensated sum and Welford population variance.
    const delta = value - this.mean;
    this.mean = Number.isFinite(delta) ? this.mean + delta / this.n : this.mean * ((this.n - 1) / this.n) + value / this.n;
    this.m2 += delta * (value - this.mean);
    const y = value - this.correction, t = this.total + y;
    this.correction = (t - this.total) - y;
    this.total = t;
  }
  result() {
    const op = this.m.op;
    if (op === 'count') return this.n;
    if (op === 'distinct') return this.freq.size;
    if (op === 'mode') {
      let best = null;
      for (const entry of this.freq.values()) if (!best || entry.n > best.n) best = entry;
      return best?.value ?? null;
    }
    if (!this.n) return null;
    if (this.samples) return quantile(this.samples.sort((a,b) => a-b), op === 'median' ? .5 : this.m.p);
    const values = {sum:this.total, avg:this.mean, min:this.low, max:this.high,
      variance:Math.max(0, this.m2 / this.n), stddev:Math.sqrt(Math.max(0, this.m2 / this.n))};
    const result = values[op];
    return Number.isFinite(result) ? result : null;
  }
}
export function measureSpec(value = {}) {
  const op = value.op ?? 'count';
  check(ops.includes(op), 'Неизвестная функция');
  const p = value.p ?? .95;
  check(Number.isFinite(p) && p >= 0 && p <= 1, 'Перцентиль должен быть в диапазоне 0…1');
  return {op, field:value.field || '', p};
}
