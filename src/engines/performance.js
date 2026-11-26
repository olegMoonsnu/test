export const pause = () => new Promise(resolve => setTimeout(resolve,0));
export function abort() { const error = new Error('Вычисление отменено'); error.name='AbortError'; throw error; }
export function checkpoint(token) { if (token?.cancelled) abort(); }
export async function scan(items, visit, token) {
  let next = performance.now() + 12;
  for (let i=0; i<items.length; i++) {
    visit(items[i],i);
    if ((i & 511) === 511 && performance.now() >= next) {
      await pause(); checkpoint(token); next = performance.now()+12;
    }
  }
  checkpoint(token);
}
export class Cache {
  constructor(limit) { this.limit=limit; this.entries=new Map(); }
  get(key) {
    if (!this.entries.has(key)) return undefined;
    const result=this.entries.get(key); this.entries.delete(key); this.entries.set(key,result); return result;
  }
  set(key,value) {
    this.entries.delete(key); this.entries.set(key,value);
    if(this.entries.size>this.limit) this.entries.delete(this.entries.keys().next().value);
    return value;
  }
}
