/*! NSD Analytics Studio v0.1.0 | MIT */
(() => {
  // src/utils/data.js
  var LIMIT = Object.freeze({
    rows: 1e5,
    columns: 96,
    depth: 8,
    list: 128,
    text: 16384,
    bytes: 64 * 1024 * 1024,
    config: 128 * 1024,
    groups: 12e3,
    updates: 3e6,
    cells: 12e3,
    fanout: 64,
    widgets: 32,
    filters: 80,
    exportBytes: 32 * 1024 * 1024
  });
  var forbidden = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]);
  var own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  function check(ok, message) {
    if (!ok) throw new Error(message);
  }
  function safeKey(key) {
    return typeof key === "string" && key.length > 0 && key.length <= 128 && key.split(".").every((part) => part && !forbidden.has(part)) && !/[\x00-\x1f]/.test(key);
  }
  function plain(value) {
    if (!value || typeof value !== "object") return false;
    const proto = Object.getPrototypeOf(value);
    return proto === null || proto === Object.prototype;
  }
  function spend(budget, amount) {
    budget.used += amount;
    check(budget.used <= budget.max, "Превышен лимит объёма данных");
  }
  function copyValue(value, budget, depth = 0) {
    check(depth <= (budget.depth ?? LIMIT.depth), "Слишком глубокая структура");
    spend(budget, 8);
    if (value == null) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      check(value.length <= LIMIT.text, "Слишком длинная строка");
      spend(budget, 2 * value.length);
      return value;
    }
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
    if (Array.isArray(value)) {
      check(value.length <= LIMIT.list, "Слишком длинный многозначный атрибут");
      const list2 = new Array(value.length);
      for (let i = 0; i < value.length; i++) list2[i] = copyValue(readOwn(value, i), budget, depth + 1);
      return list2;
    }
    check(plain(value), "Ожидается JSON-совместимый объект");
    const result = /* @__PURE__ */ Object.create(null);
    const keys = Object.keys(value);
    check(keys.length <= LIMIT.columns, "Слишком много атрибутов");
    for (const key of keys) {
      check(safeKey(key), "Недопустимое имя атрибута");
      spend(budget, key.length * 2);
      result[key] = copyValue(readOwn(value, key), budget, depth + 1);
    }
    return result;
  }
  function readOwn(object, key) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor) return void 0;
    check(own(descriptor, "value"), "Входные данные содержат вычисляемое свойство");
    return descriptor.value;
  }
  function field(row, path) {
    if (!path) return void 0;
    if (own(row, path)) return row[path];
    let value = row;
    for (const part of path.split(".")) {
      if (!value || typeof value !== "object" || !own(value, part)) return void 0;
      value = value[part];
    }
    return value;
  }
  var empty = (value) => value == null || value === "" || Array.isArray(value) && !value.length;
  function dateMs(value) {
    if (typeof value === "number") return Number.isFinite(new Date(value).getTime()) ? value : null;
    if (typeof value !== "string") return null;
    const match = /^(\d{4})-(\d\d)-(\d\d)(?:T\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d))?$/.exec(value);
    if (!match) return null;
    const day = /* @__PURE__ */ new Date(match[1] + "-" + match[2] + "-" + match[3] + "T00:00:00Z");
    if (!Number.isFinite(+day) || day.getUTCDate() !== +match[3]) return null;
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
  }
  function identity(value) {
    if (value == null) return "null";
    if (Array.isArray(value)) return "a" + JSON.stringify([...new Set(value.map(identity))].sort());
    if (typeof value === "object") {
      if (typeof value.uuid === "string") return "r" + JSON.stringify(value.uuid);
      return "o" + JSON.stringify(Object.keys(value).sort().map((k) => [k, identity(value[k])]));
    }
    return typeof value + ":" + JSON.stringify(value);
  }
  function label(value) {
    if (value == null) return "∅";
    if (Array.isArray(value)) return [...new Set(value.map(label))].sort().join(", ") || "∅";
    if (typeof value === "object") {
      if (typeof value.uuid === "string") return typeof value.title === "string" ? value.title : value.uuid;
      return JSON.stringify(value);
    }
    if (typeof value === "boolean") return value ? "Да" : "Нет";
    return String(value);
  }
  function safeUrl(value, base) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const url = new URL(value, base);
      return /^https?:$/.test(url.protocol) && url.origin === new URL(base).origin && !url.username && !url.password ? url.href : null;
    } catch {
      return null;
    }
  }

  // src/engines/statistics.js
  var ops = ["count", "distinct", "sum", "avg", "min", "max", "median", "mode", "percentile", "stddev", "variance"];
  function quantile(sorted, p) {
    if (!sorted.length) return null;
    const index = (sorted.length - 1) * p;
    const low = Math.floor(index), part = index - low;
    if (!part) return sorted[low];
    return sorted[low] * (1 - part) + sorted[low + 1] * part;
  }
  function relative(value, base) {
    if (!Number.isFinite(value) || !Number.isFinite(base) || base === 0) return null;
    const ratio = (value - base) / Math.abs(base) * 100;
    return Number.isFinite(ratio) ? ratio : null;
  }
  function lastInside(sorted, upper) {
    let index = sorted.length - 1;
    while (index > 0 && sorted[index] > upper) index--;
    return index;
  }
  function boxSummary(samples) {
    if (!samples.length) return null;
    const a = samples.slice().sort((x, y) => x - y);
    const q1 = quantile(a, 0.25), q3 = quantile(a, 0.75), iqr = q3 - q1;
    const lower = q1 - 1.5 * iqr, upper = q3 + 1.5 * iqr;
    const outliers = a.filter((x) => x < lower || x > upper);
    return {
      q1,
      q3,
      median: quantile(a, 0.5),
      min: a.find((x) => x >= lower),
      max: a[lastInside(a, upper)],
      lower,
      upper,
      outliers
    };
  }
  var Accumulator = class {
    constructor(measure2) {
      this.m = measure2;
      this.n = this.mean = this.m2 = this.total = this.correction = 0;
      this.low = Infinity;
      this.high = -Infinity;
      if (["distinct", "mode"].includes(measure2.op)) this.freq = /* @__PURE__ */ new Map();
      if (["median", "percentile"].includes(measure2.op)) this.samples = [];
    }
    add(value) {
      const op = this.m.op;
      if (op === "count") {
        if (!this.m.field || !empty(value)) this.n++;
        return;
      }
      if (empty(value)) return;
      if (this.freq) {
        const key = identity(value), old = this.freq.get(key);
        if (old) old.n++;
        else this.freq.set(key, { value, n: 1 });
        return;
      }
      if (!Number.isFinite(value)) return;
      this.n++;
      if (this.samples) {
        this.samples.push(value);
        return;
      }
      this.low = Math.min(this.low, value);
      this.high = Math.max(this.high, value);
      const delta = value - this.mean;
      this.mean = Number.isFinite(delta) ? this.mean + delta / this.n : this.mean * ((this.n - 1) / this.n) + value / this.n;
      this.m2 += delta * (value - this.mean);
      const y = value - this.correction, t = this.total + y;
      this.correction = t - this.total - y;
      this.total = t;
    }
    result() {
      const op = this.m.op;
      if (op === "count") return this.n;
      if (op === "distinct") return this.freq.size;
      if (op === "mode") {
        let best = null;
        for (const entry of this.freq.values()) if (!best || entry.n > best.n) best = entry;
        return best?.value ?? null;
      }
      if (!this.n) return null;
      if (this.samples) return quantile(this.samples.sort((a, b) => a - b), op === "median" ? 0.5 : this.m.p);
      const values = {
        sum: this.total,
        avg: this.mean,
        min: this.low,
        max: this.high,
        variance: Math.max(0, this.m2 / this.n),
        stddev: Math.sqrt(Math.max(0, this.m2 / this.n))
      };
      const result = values[op];
      return Number.isFinite(result) ? result : null;
    }
  };
  function measureSpec(value = {}) {
    const op = value.op ?? "count";
    check(ops.includes(op), "Неизвестная функция");
    const p = value.p ?? 0.95;
    check(Number.isFinite(p) && p >= 0 && p <= 1, "Перцентиль должен быть в диапазоне 0…1");
    return { op, field: value.field || "", p };
  }

  // src/engines/dimensions.js
  function members(row, dimension2) {
    let value = field(row, dimension2.field);
    if (dimension2.bucket && dimension2.bucket !== "none") {
      const ms = dateMs(value);
      if (ms === null) value = null;
      else {
        const date = new Date(ms);
        if (dimension2.bucket === "week") date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
        const len = dimension2.bucket === "year" ? 4 : dimension2.bucket === "month" ? 7 : 10;
        value = date.toISOString().slice(0, len);
      }
    }
    const list2 = Array.isArray(value) && dimension2.mode !== "set" ? dimension2.mode === "first" ? value.slice(0, 1) : value : [value];
    const unique = /* @__PURE__ */ new Map();
    for (const item of list2.length ? list2 : [null]) {
      const key = identity(item);
      if (!unique.has(key)) unique.set(key, { key, text: label(item) });
    }
    return [...unique.values()];
  }
  function tuples(row, dimensions) {
    let paths2 = [[]];
    for (const d of dimensions) {
      const values = members(row, d);
      check(paths2.length * values.length <= LIMIT.fanout, "Превышен лимит комбинаций одной строки");
      paths2 = paths2.flatMap((path) => values.map((item) => [...path, item]));
    }
    return paths2;
  }
  var pathKey = (path) => JSON.stringify(path.map((v) => v.key));
  var selection = (dims, path) => path.map((v, i) => ({ dim: dims[i], key: v.key }));

  // src/engines/filter.js
  var operators = ["eq", "ne", "contains", "notContains", "starts", "ends", "gt", "lt", "gte", "lte", "between", "in", "notIn", "filled", "empty", "dateRange", "bool"];
  var negative = { ne: "eq", notContains: "contains", notIn: "in" };
  function comparable(v, type) {
    if (v == null) return null;
    if (type === "number") return typeof v === "number" && Number.isFinite(v) ? v : null;
    if (type === "date") return dateMs(v);
    if (type === "boolean") return typeof v === "boolean" ? v : null;
    if (typeof v === "object" && typeof v.uuid === "string") return v.uuid;
    return typeof v === "object" ? identity(v) : v;
  }
  function predicate(node, columns) {
    if (!node) return () => true;
    if (node.rules) {
      const tests = node.rules.map((n) => predicate(n, columns));
      if (!tests.length) return () => true;
      return node.join === "or" ? (row) => tests.some((f) => f(row)) : (row) => tests.every((f) => f(row));
    }
    const { field: code2, op, value } = node;
    const type = columns.get(code2)?.type;
    const cast = (v) => comparable(v, type);
    const base = negative[op] || op;
    const lo = cast(Array.isArray(value) ? value[0] : value);
    const hi = cast(Array.isArray(value) ? value[1] : null);
    const list2 = new Set((Array.isArray(value) ? value : [value]).map(cast));
    const text2 = String(value ?? "").toLocaleLowerCase();
    const compare = (raw) => {
      const v = cast(raw);
      if (base === "eq" || base === "bool") return v === lo && (v !== null || value === null);
      if (base === "in") return list2.has(v) && (v !== null || Array.isArray(value) && value.includes(null));
      if (v === null) return false;
      switch (base) {
        case "gt":
          return lo !== null && v > lo;
        case "gte":
          return lo !== null && v >= lo;
        case "lt":
          return lo !== null && v < lo;
        case "lte":
          return lo !== null && v <= lo;
        case "between":
          return lo !== null && hi !== null && v >= lo && v <= hi;
        case "dateRange": {
          const t = dateMs(raw), a = dateMs(value[0]), b = dateMs(value[1]);
          const end = typeof value[1] === "string" && value[1].length === 10 ? b + 864e5 - 1 : b;
          return t !== null && a !== null && b !== null && t >= a && t <= end;
        }
        default: {
          const s = label(raw).toLocaleLowerCase();
          if (base === "starts") return s.startsWith(text2);
          if (base === "ends") return s.endsWith(text2);
          return s.includes(text2);
        }
      }
    };
    return (row) => {
      const raw = field(row, code2);
      if (op === "filled" || op === "empty") return empty(raw) === (op === "empty");
      const match = Array.isArray(raw) ? raw.some(compare) : compare(raw);
      return negative[op] ? !match : match;
    };
  }
  function matchesSelection(row, terms) {
    return terms.every((term) => {
      if (term.dim) return members(row, term.dim).some((m) => m.key === term.key);
      const v = field(row, term.field);
      if (term.index !== void 0) return false;
      return Number.isFinite(v) && v >= term.low && (term.inclusive ? v <= term.high : v < term.high);
    });
  }

  // src/core/config.js
  var charts = ["bar", "column", "pie", "donut", "line", "stacked", "area", "heatmap", "scatter", "histogram", "treemap", "funnel", "kpi", "pareto", "box", "gauge", "pivot", "table"];
  var types = ["string", "number", "boolean", "date", "array", "object", "reference", "mixed"];
  var text = (v, fallback = "") => {
    if (v === void 0) return fallback;
    check(typeof v === "string" && v.length <= 180, "Некорректная подпись");
    return v;
  };
  var code = (s, optional = false) => {
    if (optional && (s == null || s === "")) return "";
    check(safeKey(s), "Некорректный код поля");
    return s;
  };
  function list(value, max) {
    check(Array.isArray(value) && value.length <= max, "Некорректная длина списка");
    return value;
  }
  function pick(v, options, initial) {
    v = v ?? initial;
    check(options.includes(v), "Недопустимое значение настройки");
    return v;
  }
  function integer(n, initial, lo, hi) {
    n = n ?? initial;
    check(Number.isInteger(n) && n >= lo && n <= hi, "Число вне диапазона");
    return n;
  }
  function dimension(value) {
    const d = typeof value === "string" ? { field: value } : value;
    check(plain(d), "Ожидается измерение");
    return { field: code(d.field), bucket: pick(d.bucket, ["none", "day", "week", "month", "year"], "none"), mode: pick(d.mode, ["set", "first", "explode"], "set") };
  }
  function measure(v = {}) {
    check(plain(v), "Ожидается мера");
    const m = measureSpec(v);
    m.field = code(m.field, true);
    check(m.op === "count" || m.field, "Выберите поле показателя");
    return m;
  }
  function filterTree(n, state = { n: 0 }, level = 0) {
    if (n == null) return null;
    check(plain(n) && level <= 5 && ++state.n <= LIMIT.filters, "Слишком сложный фильтр");
    if (own(n, "rules")) {
      return { join: pick(n.join, ["and", "or"], "and"), rules: list(n.rules, LIMIT.filters).map((x) => {
        check(x != null, "Пустое условие");
        return filterTree(x, state, level + 1);
      }) };
    }
    const op = pick(n.op, operators, "eq"), value = n.value ?? null;
    const scalar = (v) => v == null || typeof v === "boolean" || Number.isFinite(v) || typeof v === "string" && v.length <= 2048;
    check(Array.isArray(value) ? value.length <= 100 && value.every(scalar) : scalar(value), "Некорректное значение фильтра");
    if (["in", "notIn", "between", "dateRange"].includes(op)) check(Array.isArray(value), "Ожидается список значений");
    if (["between", "dateRange"].includes(op)) check(value.length === 2, "Задайте обе границы");
    if (op === "bool") check(typeof value === "boolean", "Ожидается логическое значение");
    return { field: code(n.field), op, value };
  }
  function widget(v = {}, i = 0) {
    check(plain(v), "Некорректный виджет");
    const goal = v.goal ?? 100;
    check(Number.isFinite(goal) && goal > 0, "Цель должна быть положительной");
    return {
      id: code(v.id ?? "w" + i),
      title: text(v.title, "Показатель"),
      type: pick(v.type, charts, "bar"),
      dims: list(v.dims ?? [], 4).map(dimension),
      measure: measure(v.measure),
      filter: filterTree(v.filter),
      order: pick(v.order, ["desc", "asc", "key"], "desc"),
      limit: integer(v.limit, 12, 1, 60),
      span: integer(v.span, 1, 1, 2),
      height: integer(v.height, 1, 1, 2),
      goal,
      x: code(v.x, true),
      y: code(v.y, true),
      transform: pick(v.transform, ["value", "percent", "cumulative", "delta"], "value")
    };
  }
  function pivotSpec(p = {}) {
    check(plain(p), "Некорректная сводная таблица");
    const measures = list(p.measures ?? [{}], 4).map(measure);
    check(measures.length, "Добавьте хотя бы одну меру");
    return {
      rows: list(p.rows ?? [], 3).map(dimension),
      cols: list(p.cols ?? [], 2).map(dimension),
      measures,
      order: pick(p.order, ["key", "desc", "asc"], "key"),
      heat: p.heat !== false,
      filter: filterTree(p.filter)
    };
  }
  function config(input2 = {}) {
    if (typeof input2 === "string") {
      check(input2.length <= LIMIT.config, "Слишком большой шаблон");
      input2 = JSON.parse(input2);
    }
    check(plain(input2), "Конфигурация должна быть объектом");
    const v = copyValue(input2, { used: 0, max: LIMIT.config, depth: 24 });
    check(v.version == null || v.version === 1, "Неподдерживаемая версия шаблона");
    const columns = list(v.columns ?? [], LIMIT.columns).map((c) => {
      check(plain(c), "Некорректная колонка");
      if (c.type != null) check(types.includes(c.type), "Неизвестный тип поля");
      return { code: code(c.code), title: text(c.title, c.code), type: c.type ?? null, unit: text(c.unit) };
    });
    check(new Set(columns.map((c) => c.code)).size === columns.length, "Повтор кода колонки");
    const widgets = list(v.widgets ?? [], LIMIT.widgets).map(widget);
    check(new Set(widgets.map((w) => w.id)).size === widgets.length, "Повтор ID виджета");
    const locale = text(v.locale, "ru-RU");
    try {
      new Intl.NumberFormat(locale);
    } catch {
      throw new Error("Некорректная локаль");
    }
    return {
      version: 1,
      title: text(v.title, "Аналитика объектов"),
      locale,
      theme: pick(v.theme, ["light", "dark"], "light"),
      columns,
      includeUnlisted: v.includeUnlisted === true,
      filter: filterTree(v.filter),
      widgets,
      pivot: pivotSpec(v.pivot),
      autoPivot: v.autoPivot ?? !own(v, "pivot"),
      autoWidgets: v.autoWidgets ?? !own(v, "widgets")
    };
  }

  // src/engines/performance.js
  var pause = () => new Promise((resolve) => setTimeout(resolve, 0));
  function abort() {
    const error = new Error("Вычисление отменено");
    error.name = "AbortError";
    throw error;
  }
  function checkpoint(token) {
    if (token?.cancelled) abort();
  }
  async function scan(items, visit, token) {
    let next = performance.now() + 12;
    for (let i = 0; i < items.length; i++) {
      visit(items[i], i);
      if ((i & 511) === 511 && performance.now() >= next) {
        await pause();
        checkpoint(token);
        next = performance.now() + 12;
      }
    }
    checkpoint(token);
  }
  var Cache = class {
    constructor(limit) {
      this.limit = limit;
      this.entries = /* @__PURE__ */ new Map();
    }
    get(key) {
      if (!this.entries.has(key)) return void 0;
      const result = this.entries.get(key);
      this.entries.delete(key);
      this.entries.set(key, result);
      return result;
    }
    set(key, value) {
      this.entries.delete(key);
      this.entries.set(key, value);
      if (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value);
      return value;
    }
  };

  // src/engines/schema.js
  function infer(value, code2) {
    if (Array.isArray(value)) return "array";
    if (typeof value === "object") return typeof value.uuid === "string" ? "reference" : "object";
    if (typeof value === "string" && dateMs(value) !== null) return "date";
    if (typeof value === "number" && /(?:At|Date|Дата)$/i.test(code2) && Math.abs(value) >= 1e11 && dateMs(value) !== null) return "date";
    return typeof value;
  }
  var Schema = class {
    constructor(config2) {
      this.declared = new Map(config2.columns.map((c) => [c.code, c]));
      this.types = new Map(config2.columns.map((c) => [c.code, null]));
      this.discover = config2.includeUnlisted || !config2.columns.length;
    }
    observe(row) {
      if (this.discover) for (const code2 of Object.keys(row)) {
        if (!this.types.has(code2)) {
          check(this.types.size < LIMIT.columns, "Слишком много уникальных полей");
          this.types.set(code2, null);
        }
      }
      for (const [code2, current2] of this.types) {
        if (this.declared.get(code2)?.type || current2 === "mixed") continue;
        const value = field(row, code2);
        if (empty(value)) continue;
        const next = infer(value, code2);
        this.types.set(code2, current2 && current2 !== next ? "mixed" : next);
      }
    }
    finish() {
      return Array.from(this.types, ([code2, type]) => ({ code: code2, title: code2, ...this.declared.get(code2), type: this.declared.get(code2)?.type || type || "string" }));
    }
  };

  // src/engines/aggregate.js
  async function grouped(data, ids, w, token) {
    let updates = 0;
    const groups = /* @__PURE__ */ new Map(), total = new Accumulator(w.measure);
    await scan(ids, (id) => {
      const row = data[id], value = field(row, w.measure.field);
      total.add(value);
      const paths2 = tuples(row, w.dims);
      updates += paths2.length;
      check(updates <= LIMIT.updates, "Превышен лимит обновлений групп");
      for (const path of paths2) {
        const key = pathKey(path);
        let g = groups.get(key);
        if (!g) {
          check(groups.size < LIMIT.groups, "Слишком много групп. Уточните фильтр или укрупните период.");
          g = { path, acc: new Accumulator(w.measure) };
          groups.set(key, g);
        }
        g.acc.add(value);
      }
    }, token);
    let all = Array.from(groups.values(), (g) => ({ path: g.path, value: g.acc.result(), terms: selection(w.dims, g.path) }));
    const byKey = (a, b) => a.path.map((p) => p.text).join(" / ").localeCompare(b.path.map((p) => p.text).join(" / "), "ru", { numeric: true });
    all.sort((a, b) => {
      if (w.order === "key") return byKey(a, b);
      if (a.value == null || b.value == null) return Number(a.value == null) - Number(b.value == null) || byKey(a, b);
      const diff = typeof a.value === "number" && typeof b.value === "number" ? a.value - b.value : label(a.value).localeCompare(label(b.value));
      return (w.order === "asc" ? diff : -diff) || byKey(a, b);
    });
    const count = all.length, sum = all.reduce((s, g) => s + (Number.isFinite(g.value) ? g.value : 0), 0);
    let running = 0, previous = null;
    for (const g of all) {
      const raw = g.value;
      g.raw = raw;
      g.percent = Number.isFinite(raw) && Number.isFinite(sum) && sum !== 0 ? raw / sum * 100 : null;
      if (Number.isFinite(raw)) running += raw;
      if (w.transform === "percent") g.value = g.percent;
      if (w.transform === "cumulative") g.value = Number.isFinite(raw) && Number.isFinite(running) ? running : null;
      if (w.transform === "delta") g.value = relative(raw, previous);
      previous = raw;
    }
    all = all.slice(0, w.limit);
    return { kind: "group", groups: all, total: total.result(), rows: ids.length, count, omitted: count - all.length };
  }
  async function distribution(data, ids, w, token) {
    const values = [], points = [];
    let valid = 0, low = Infinity, high = -Infinity;
    const rng = /* @__PURE__ */ (() => {
      let seed = 71;
      return () => (seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296;
    })();
    await scan(ids, (id) => {
      const row = data[id], x = field(row, w.x || w.measure.field);
      if (!Number.isFinite(x)) return;
      if (w.type === "scatter") {
        const y = field(row, w.y);
        if (!Number.isFinite(y)) return;
        valid++;
        const point = { x, y, id }, j = valid <= 500 ? valid - 1 : Math.floor(rng() * valid);
        if (j < 500) points[j] = point;
      } else {
        values.push(x);
        low = Math.min(low, x);
        high = Math.max(high, x);
      }
    }, token);
    if (w.type === "scatter") return { kind: "scatter", points, count: valid, omitted: valid - points.length };
    if (w.type === "box") {
      const box = boxSummary(values);
      if (box) {
        box.outlierCount = box.outliers.length;
        box.outliers = box.outliers.slice(0, 64);
      }
      return { kind: "box", box, count: values.length, field: w.x || w.measure.field };
    }
    if (!values.length) return { kind: "group", groups: [], count: 0, omitted: 0 };
    const n = low === high ? 1 : Math.min(w.limit, Math.ceil(Math.sqrt(values.length)));
    const step = (high - low) / n;
    check(Number.isFinite(step), "Диапазон чисел превышает точность гистограммы");
    const groups = Array.from({ length: n }, (_, i) => {
      const a = low + i * step, b = i === n - 1 ? high : low + (i + 1) * step;
      return {
        path: [{ key: String(i), text: Number(a.toPrecision(4)) + "…" + Number(b.toPrecision(4)) }],
        value: 0,
        terms: [{ field: w.x || w.measure.field, low: a, high: b, inclusive: i === n - 1 }]
      };
    });
    for (const v of values) groups[step ? Math.min(n - 1, Math.floor((v - low) / step)) : 0].value++;
    return { kind: "group", groups, count: n, total: values.length, omitted: 0 };
  }

  // src/engines/pivot.js
  function prefixes(row, dims) {
    const result = /* @__PURE__ */ new Map([["[]", []]]);
    for (const path of tuples(row, dims)) for (let depth = 1; depth <= path.length; depth++) {
      const prefix = path.slice(0, depth);
      result.set(pathKey(prefix), prefix);
    }
    return result;
  }
  async function pivot(data, ids, spec, token) {
    const rows = /* @__PURE__ */ new Map([["[]", []]]), cols = /* @__PURE__ */ new Map([["[]", []]]), cells = /* @__PURE__ */ new Map();
    let updates = 0;
    const states = () => spec.measures.map((m) => new Accumulator(m));
    cells.set(JSON.stringify(["[]", "[]"]), states());
    await scan(ids, (id) => {
      const row = data[id], rp = prefixes(row, spec.rows), cp = prefixes(row, spec.cols);
      check(rp.size * cp.size <= LIMIT.fanout * 12, "Слишком много комбинаций в сводной");
      updates += rp.size * cp.size * spec.measures.length;
      check(updates <= LIMIT.updates, "Слишком много обновлений ячеек. Сократите число мер, уровней или строк.");
      const values2 = spec.measures.map((m) => field(row, m.field));
      for (const [rk, r] of rp) {
        rows.set(rk, r);
        for (const [ck, c] of cp) {
          cols.set(ck, c);
          const key = JSON.stringify([rk, ck]);
          let cell = cells.get(key);
          if (!cell) {
            check((cells.size + 1) * spec.measures.length <= LIMIT.cells, "Слишком много ячеек сводной. Сократите измерения или выборку.");
            cell = states();
            cells.set(key, cell);
          }
          cell.forEach((s, i) => s.add(values2[i]));
        }
      }
    }, token);
    const values = /* @__PURE__ */ Object.create(null);
    for (const [key, cell] of cells) values[key] = cell.map((s) => s.result());
    function hierarchy(map, axis) {
      const children = /* @__PURE__ */ new Map();
      for (const [key, path] of map) {
        if (!path.length) continue;
        const parent = pathKey(path.slice(0, -1));
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push({ key, path });
      }
      const ordered = [];
      function walk(parent) {
        const items = children.get(parent) || [];
        const total = (item) => values[JSON.stringify(axis === "rows" ? [item.key, "[]"] : ["[]", item.key])]?.[0];
        items.sort((a, b) => {
          const t = spec.order === "key" ? 0 : (Number(total(a)) - Number(total(b))) * (spec.order === "asc" ? 1 : -1);
          return t || a.path[a.path.length - 1].text.localeCompare(b.path[b.path.length - 1].text, "ru", { numeric: true });
        });
        for (const item of items) {
          ordered.push(item);
          walk(item.key);
        }
      }
      walk("[]");
      return [...ordered, { key: "[]", path: [] }];
    }
    return { kind: "pivot", rows: hierarchy(rows, "rows"), cols: hierarchy(cols, "cols"), values, rowsCount: ids.length };
  }
  var cellValue = (p, r, c, i = 0) => p.values[JSON.stringify([r, c])]?.[i] ?? null;

  // src/core/dataset.js
  var Dataset = class {
    constructor(config2) {
      this.rows = [];
      this.schema = new Schema(config2);
      this.views = new Cache(6);
      this.results = new Cache(24);
    }
    append(batch) {
      check(this.rows.length + batch.length <= LIMIT.rows, "Превышен лимит объектов");
      for (const row of batch) {
        this.schema.observe(row);
        this.rows.push(row);
      }
    }
    finish() {
      this.columns = this.schema.finish();
      this.fields = new Map(this.columns.map((c) => [c.code, c]));
      this.all = Uint32Array.from({ length: this.rows.length }, (_, i) => i);
      return { columns: this.columns, count: this.rows.length };
    }
    async view(q, token) {
      const key = JSON.stringify([q.filters || [], q.terms || [], q.search || "", q.sort || null]);
      const cached = this.views.get(key);
      if (cached) return cached;
      const filters = (q.filters || []).filter(Boolean).map((n) => predicate(n, this.fields));
      const terms = q.terms || [], search = (q.search || "").toLocaleLowerCase();
      if (!filters.length && !terms.length && !search && !q.sort) return this.all;
      const ids = [];
      await scan(this.all, (id) => {
        const row = this.rows[id];
        if (filters.every((test) => test(row)) && (!terms.length || matchesSelection(row, terms)) && (!search || this.columns.some((c) => label(field(row, c.code)).toLocaleLowerCase().includes(search)))) ids.push(id);
      }, token);
      if (q.sort) {
        const { code: code2, desc } = q.sort, type = this.fields.get(code2)?.type;
        const collator = new Intl.Collator("ru", { numeric: true });
        const val = (row) => {
          const v = field(row, code2);
          return type === "date" ? dateMs(v) : v;
        };
        ids.sort((a, b) => {
          const x = val(this.rows[a]), y = val(this.rows[b]);
          if (x == null || y == null) return Number(x == null) - Number(y == null) || a - b;
          const diff = typeof x === "number" && typeof y === "number" ? x - y : collator.compare(label(x), label(y));
          return (desc ? -diff : diff) || a - b;
        });
      }
      return this.views.set(key, Uint32Array.from(ids));
    }
    async run(command, q = {}, token) {
      if (command === "detail") return this.rows[q.id] ?? null;
      const ids = await this.view(q, token);
      if (command === "page") {
        const start = Math.max(0, q.start || 0), limit = Math.min(Math.max(1, q.limit || 40), 2048);
        return { count: ids.length, items: Array.from(ids.subarray(start, start + limit), (id) => ({ id, row: this.rows[id] })) };
      }
      if (command === "size") return ids.length;
      const key = JSON.stringify([command, q]), cached = this.results.get(key);
      if (cached) return cached;
      let result;
      if (command === "pivot") result = await pivot(this.rows, ids, q.spec, token);
      else if (command === "chart") {
        result = ["scatter", "histogram", "box"].includes(q.w.type) ? await distribution(this.rows, ids, q.w, token) : await grouped(this.rows, ids, q.w, token);
      } else if (command === "periods") {
        const aggregate = async (range) => {
          const periodIds = await this.view({ ...q, filters: [...q.filters || [], { field: q.field, op: "dateRange", value: range }] }, token);
          return (await grouped(this.rows, periodIds, { dims: [], measure: q.measure, limit: 1, order: "key", transform: "value" }, token)).total;
        };
        const previous = await aggregate(q.previous), current2 = await aggregate(q.current);
        result = { previous, current: current2, change: Number.isFinite(previous) && Number.isFinite(current2) ? current2 - previous : null, percent: relative(current2, previous) };
      } else throw new Error("Неизвестная команда");
      return command === "pivot" ? result : this.results.set(key, result);
    }
  };

  // src/core/session.js
  function readPath(row, code2) {
    if (own(row, code2)) return readOwn(row, code2);
    let value = row;
    for (const key of code2.split(".")) {
      if (!plain(value)) return void 0;
      value = readOwn(value, key);
    }
    return value;
  }
  var Session = class {
    constructor() {
      this.serial = 0;
      this.pending = /* @__PURE__ */ new Map();
      this.life = { cancelled: false };
      this.mode = "main";
    }
    async load(rows, cfg, options = {}, progress = () => {
    }) {
      check(Array.isArray(rows) && rows.length <= LIMIT.rows, "Ожидается массив до 100 000 объектов");
      if (rows.length >= 5e3 && options.worker !== false && typeof Worker === "function" && true) {
        let timer;
        try {
          const url = URL.createObjectURL(new Blob(['(()=>{var N=Object.freeze({rows:1e5,columns:96,depth:8,list:128,text:16384,bytes:67108864,config:131072,groups:12e3,updates:3e6,cells:12e3,fanout:64,widgets:32,filters:80,exportBytes:33554432});var B=(r,t)=>Object.prototype.hasOwnProperty.call(r,t);function M(r,t){if(!r)throw new Error(t)}function x(r,t){if(!t)return;if(B(r,t))return r[t];let e=r;for(let i of t.split(".")){if(!e||typeof e!="object"||!B(e,i))return;e=e[i]}return e}var S=r=>r==null||r===""||Array.isArray(r)&&!r.length;function k(r){if(typeof r=="number")return Number.isFinite(new Date(r).getTime())?r:null;if(typeof r!="string")return null;let t=/^(\\d{4})-(\\d\\d)-(\\d\\d)(?:T\\d\\d:\\d\\d(?::\\d\\d(?:\\.\\d{1,3})?)?(?:Z|[+-]\\d\\d:\\d\\d))?$/.exec(r);if(!t)return null;let e=new Date(t[1]+"-"+t[2]+"-"+t[3]+"T00:00:00Z");if(!Number.isFinite(+e)||e.getUTCDate()!==+t[3])return null;let i=Date.parse(r);return Number.isFinite(i)?i:null}function O(r){return r==null?"null":Array.isArray(r)?"a"+JSON.stringify([...new Set(r.map(O))].sort()):typeof r=="object"?typeof r.uuid=="string"?"r"+JSON.stringify(r.uuid):"o"+JSON.stringify(Object.keys(r).sort().map(t=>[t,O(r[t])])):typeof r+":"+JSON.stringify(r)}function A(r){return r==null?"∅":Array.isArray(r)?[...new Set(r.map(A))].sort().join(", ")||"∅":typeof r=="object"?typeof r.uuid=="string"?typeof r.title=="string"?r.title:r.uuid:JSON.stringify(r):typeof r=="boolean"?r?"Да":"Нет":String(r)}function tt(r,t){return Array.isArray(r)?"array":typeof r=="object"?typeof r.uuid=="string"?"reference":"object":typeof r=="string"&&k(r)!==null||typeof r=="number"&&/(?:At|Date|Дата)$/i.test(t)&&Math.abs(r)>=1e11&&k(r)!==null?"date":typeof r}var J=class{constructor(t){this.declared=new Map(t.columns.map(e=>[e.code,e])),this.types=new Map(t.columns.map(e=>[e.code,null])),this.discover=t.includeUnlisted||!t.columns.length}observe(t){if(this.discover)for(let e of Object.keys(t))this.types.has(e)||(M(this.types.size<N.columns,"Слишком много уникальных полей"),this.types.set(e,null));for(let[e,i]of this.types){if(this.declared.get(e)?.type||i==="mixed")continue;let n=x(t,e);if(S(n))continue;let l=tt(n,e);this.types.set(e,i&&i!==l?"mixed":l)}}finish(){return Array.from(this.types,([t,e])=>({code:t,title:t,...this.declared.get(t),type:this.declared.get(t)?.type||e||"string"}))}};function E(r,t){let e=x(r,t.field);if(t.bucket&&t.bucket!=="none"){let l=k(e);if(l===null)e=null;else{let u=new Date(l);t.bucket==="week"&&u.setUTCDate(u.getUTCDate()-(u.getUTCDay()+6)%7);let a=t.bucket==="year"?4:t.bucket==="month"?7:10;e=u.toISOString().slice(0,a)}}let i=Array.isArray(e)&&t.mode!=="set"?t.mode==="first"?e.slice(0,1):e:[e],n=new Map;for(let l of i.length?i:[null]){let u=O(l);n.has(u)||n.set(u,{key:u,text:A(l)})}return[...n.values()]}function z(r,t){let e=[[]];for(let i of t){let n=E(r,i);M(e.length*n.length<=N.fanout,"Превышен лимит комбинаций одной строки"),e=e.flatMap(l=>n.map(u=>[...l,u]))}return e}var L=r=>JSON.stringify(r.map(t=>t.key)),V=(r,t)=>t.map((e,i)=>({dim:r[i],key:e.key}));var W={ne:"eq",notContains:"contains",notIn:"in"};function et(r,t){return r==null?null:t==="number"?typeof r=="number"&&Number.isFinite(r)?r:null:t==="date"?k(r):t==="boolean"?typeof r=="boolean"?r:null:typeof r=="object"&&typeof r.uuid=="string"?r.uuid:typeof r=="object"?O(r):r}function K(r,t){if(!r)return()=>!0;if(r.rules){let o=r.rules.map(s=>K(s,t));return o.length?r.join==="or"?s=>o.some(c=>c(s)):s=>o.every(c=>c(s)):()=>!0}let{field:e,op:i,value:n}=r,l=t.get(e)?.type,u=o=>et(o,l),a=W[i]||i,f=u(Array.isArray(n)?n[0]:n),m=u(Array.isArray(n)?n[1]:null),h=new Set((Array.isArray(n)?n:[n]).map(u)),p=String(n??"").toLocaleLowerCase(),g=o=>{let s=u(o);if(a==="eq"||a==="bool")return s===f&&(s!==null||n===null);if(a==="in")return h.has(s)&&(s!==null||Array.isArray(n)&&n.includes(null));if(s===null)return!1;switch(a){case"gt":return f!==null&&s>f;case"gte":return f!==null&&s>=f;case"lt":return f!==null&&s<f;case"lte":return f!==null&&s<=f;case"between":return f!==null&&m!==null&&s>=f&&s<=m;case"dateRange":{let c=k(o),d=k(n[0]),y=k(n[1]),w=typeof n[1]=="string"&&n[1].length===10?y+864e5-1:y;return c!==null&&d!==null&&y!==null&&c>=d&&c<=w}default:{let c=A(o).toLocaleLowerCase();return a==="starts"?c.startsWith(p):a==="ends"?c.endsWith(p):c.includes(p)}}};return o=>{let s=x(o,e);if(i==="filled"||i==="empty")return S(s)===(i==="empty");let c=Array.isArray(s)?s.some(g):g(s);return W[i]?!c:c}}function Z(r,t){return t.every(e=>{if(e.dim)return E(r,e.dim).some(n=>n.key===e.key);let i=x(r,e.field);return e.index!==void 0?!1:Number.isFinite(i)&&i>=e.low&&(e.inclusive?i<=e.high:i<e.high)})}var rt=()=>new Promise(r=>setTimeout(r,0));function nt(){let r=new Error("Вычисление отменено");throw r.name="AbortError",r}function G(r){r?.cancelled&&nt()}async function F(r,t,e){let i=performance.now()+12;for(let n=0;n<r.length;n++)t(r[n],n),(n&511)===511&&performance.now()>=i&&(await rt(),G(e),i=performance.now()+12);G(e)}var T=class{constructor(t){this.limit=t,this.entries=new Map}get(t){if(!this.entries.has(t))return;let e=this.entries.get(t);return this.entries.delete(t),this.entries.set(t,e),e}set(t,e){return this.entries.delete(t),this.entries.set(t,e),this.entries.size>this.limit&&this.entries.delete(this.entries.keys().next().value),e}};function D(r,t){if(!r.length)return null;let e=(r.length-1)*t,i=Math.floor(e),n=e-i;return n?r[i]*(1-n)+r[i+1]*n:r[i]}function U(r,t){if(!Number.isFinite(r)||!Number.isFinite(t)||t===0)return null;let e=(r-t)/Math.abs(t)*100;return Number.isFinite(e)?e:null}function it(r,t){let e=r.length-1;for(;e>0&&r[e]>t;)e--;return e}function H(r){if(!r.length)return null;let t=r.slice().sort((f,m)=>f-m),e=D(t,.25),i=D(t,.75),n=i-e,l=e-1.5*n,u=i+1.5*n,a=t.filter(f=>f<l||f>u);return{q1:e,q3:i,median:D(t,.5),min:t.find(f=>f>=l),max:t[it(t,u)],lower:l,upper:u,outliers:a}}var j=class{constructor(t){this.m=t,this.n=this.mean=this.m2=this.total=this.correction=0,this.low=1/0,this.high=-1/0,["distinct","mode"].includes(t.op)&&(this.freq=new Map),["median","percentile"].includes(t.op)&&(this.samples=[])}add(t){if(this.m.op==="count"){(!this.m.field||!S(t))&&this.n++;return}if(S(t))return;if(this.freq){let u=O(t),a=this.freq.get(u);a?a.n++:this.freq.set(u,{value:t,n:1});return}if(!Number.isFinite(t))return;if(this.n++,this.samples){this.samples.push(t);return}this.low=Math.min(this.low,t),this.high=Math.max(this.high,t);let i=t-this.mean;this.mean=Number.isFinite(i)?this.mean+i/this.n:this.mean*((this.n-1)/this.n)+t/this.n,this.m2+=i*(t-this.mean);let n=t-this.correction,l=this.total+n;this.correction=l-this.total-n,this.total=l}result(){let t=this.m.op;if(t==="count")return this.n;if(t==="distinct")return this.freq.size;if(t==="mode"){let n=null;for(let l of this.freq.values())(!n||l.n>n.n)&&(n=l);return n?.value??null}if(!this.n)return null;if(this.samples)return D(this.samples.sort((n,l)=>n-l),t==="median"?.5:this.m.p);let i={sum:this.total,avg:this.mean,min:this.low,max:this.high,variance:Math.max(0,this.m2/this.n),stddev:Math.sqrt(Math.max(0,this.m2/this.n))}[t];return Number.isFinite(i)?i:null}};async function R(r,t,e,i){let n=0,l=new Map,u=new j(e.measure);await F(t,o=>{let s=r[o],c=x(s,e.measure.field);u.add(c);let d=z(s,e.dims);n+=d.length,M(n<=N.updates,"Превышен лимит обновлений групп");for(let y of d){let w=L(y),b=l.get(w);b||(M(l.size<N.groups,"Слишком много групп. Уточните фильтр или укрупните период."),b={path:y,acc:new j(e.measure)},l.set(w,b)),b.acc.add(c)}},i);let a=Array.from(l.values(),o=>({path:o.path,value:o.acc.result(),terms:V(e.dims,o.path)})),f=(o,s)=>o.path.map(c=>c.text).join(" / ").localeCompare(s.path.map(c=>c.text).join(" / "),"ru",{numeric:!0});a.sort((o,s)=>{if(e.order==="key")return f(o,s);if(o.value==null||s.value==null)return+(o.value==null)-+(s.value==null)||f(o,s);let c=typeof o.value=="number"&&typeof s.value=="number"?o.value-s.value:A(o.value).localeCompare(A(s.value));return(e.order==="asc"?c:-c)||f(o,s)});let m=a.length,h=a.reduce((o,s)=>o+(Number.isFinite(s.value)?s.value:0),0),p=0,g=null;for(let o of a){let s=o.value;o.raw=s,o.percent=Number.isFinite(s)&&Number.isFinite(h)&&h!==0?s/h*100:null,Number.isFinite(s)&&(p+=s),e.transform==="percent"&&(o.value=o.percent),e.transform==="cumulative"&&(o.value=Number.isFinite(s)&&Number.isFinite(p)?p:null),e.transform==="delta"&&(o.value=U(s,g)),g=s}return a=a.slice(0,e.limit),{kind:"group",groups:a,total:u.result(),rows:t.length,count:m,omitted:m-a.length}}async function Q(r,t,e,i){let n=[],l=[],u=0,a=1/0,f=-1/0,m=(()=>{let o=71;return()=>(o=Math.imul(o,1664525)+1013904223>>>0)/4294967296})();if(await F(t,o=>{let s=r[o],c=x(s,e.x||e.measure.field);if(Number.isFinite(c))if(e.type==="scatter"){let d=x(s,e.y);if(!Number.isFinite(d))return;u++;let y={x:c,y:d,id:o},w=u<=500?u-1:Math.floor(m()*u);w<500&&(l[w]=y)}else n.push(c),a=Math.min(a,c),f=Math.max(f,c)},i),e.type==="scatter")return{kind:"scatter",points:l,count:u,omitted:u-l.length};if(e.type==="box"){let o=H(n);return o&&(o.outlierCount=o.outliers.length,o.outliers=o.outliers.slice(0,64)),{kind:"box",box:o,count:n.length,field:e.x||e.measure.field}}if(!n.length)return{kind:"group",groups:[],count:0,omitted:0};let h=a===f?1:Math.min(e.limit,Math.ceil(Math.sqrt(n.length))),p=(f-a)/h;M(Number.isFinite(p),"Диапазон чисел превышает точность гистограммы");let g=Array.from({length:h},(o,s)=>{let c=a+s*p,d=s===h-1?f:a+(s+1)*p;return{path:[{key:String(s),text:Number(c.toPrecision(4))+"…"+Number(d.toPrecision(4))}],value:0,terms:[{field:e.x||e.measure.field,low:c,high:d,inclusive:s===h-1}]}});for(let o of n)g[p?Math.min(h-1,Math.floor((o-a)/p)):0].value++;return{kind:"group",groups:g,count:h,total:n.length,omitted:0}}function X(r,t){let e=new Map([["[]",[]]]);for(let i of z(r,t))for(let n=1;n<=i.length;n++){let l=i.slice(0,n);e.set(L(l),l)}return e}async function Y(r,t,e,i){let n=new Map([["[]",[]]]),l=new Map([["[]",[]]]),u=new Map,a=0,f=()=>e.measures.map(p=>new j(p));u.set(JSON.stringify(["[]","[]"]),f()),await F(t,p=>{let g=r[p],o=X(g,e.rows),s=X(g,e.cols);M(o.size*s.size<=N.fanout*12,"Слишком много комбинаций в сводной"),a+=o.size*s.size*e.measures.length,M(a<=N.updates,"Слишком много обновлений ячеек. Сократите число мер, уровней или строк.");let c=e.measures.map(d=>x(g,d.field));for(let[d,y]of o){n.set(d,y);for(let[w,b]of s){l.set(w,b);let I=JSON.stringify([d,w]),C=u.get(I);C||(M((u.size+1)*e.measures.length<=N.cells,"Слишком много ячеек сводной. Сократите измерения или выборку."),C=f(),u.set(I,C)),C.forEach((v,q)=>v.add(c[q]))}}},i);let m=Object.create(null);for(let[p,g]of u)m[p]=g.map(o=>o.result());function h(p,g){let o=new Map;for(let[d,y]of p){if(!y.length)continue;let w=L(y.slice(0,-1));o.has(w)||o.set(w,[]),o.get(w).push({key:d,path:y})}let s=[];function c(d){let y=o.get(d)||[],w=b=>m[JSON.stringify(g==="rows"?[b.key,"[]"]:["[]",b.key])]?.[0];y.sort((b,I)=>(e.order==="key"?0:(Number(w(b))-Number(w(I)))*(e.order==="asc"?1:-1))||b.path[b.path.length-1].text.localeCompare(I.path[I.path.length-1].text,"ru",{numeric:!0}));for(let b of y)s.push(b),c(b.key)}return c("[]"),[...s,{key:"[]",path:[]}]}return{kind:"pivot",rows:h(n,"rows"),cols:h(l,"cols"),values:m,rowsCount:t.length}}var P=class{constructor(t){this.rows=[],this.schema=new J(t),this.views=new T(6),this.results=new T(24)}append(t){M(this.rows.length+t.length<=N.rows,"Превышен лимит объектов");for(let e of t)this.schema.observe(e),this.rows.push(e)}finish(){return this.columns=this.schema.finish(),this.fields=new Map(this.columns.map(t=>[t.code,t])),this.all=Uint32Array.from({length:this.rows.length},(t,e)=>e),{columns:this.columns,count:this.rows.length}}async view(t,e){let i=JSON.stringify([t.filters||[],t.terms||[],t.search||"",t.sort||null]),n=this.views.get(i);if(n)return n;let l=(t.filters||[]).filter(Boolean).map(m=>K(m,this.fields)),u=t.terms||[],a=(t.search||"").toLocaleLowerCase();if(!l.length&&!u.length&&!a&&!t.sort)return this.all;let f=[];if(await F(this.all,m=>{let h=this.rows[m];l.every(p=>p(h))&&(!u.length||Z(h,u))&&(!a||this.columns.some(p=>A(x(h,p.code)).toLocaleLowerCase().includes(a)))&&f.push(m)},e),t.sort){let{code:m,desc:h}=t.sort,p=this.fields.get(m)?.type,g=new Intl.Collator("ru",{numeric:!0}),o=s=>{let c=x(s,m);return p==="date"?k(c):c};f.sort((s,c)=>{let d=o(this.rows[s]),y=o(this.rows[c]);if(d==null||y==null)return+(d==null)-+(y==null)||s-c;let w=typeof d=="number"&&typeof y=="number"?d-y:g.compare(A(d),A(y));return(h?-w:w)||s-c})}return this.views.set(i,Uint32Array.from(f))}async run(t,e={},i){if(t==="detail")return this.rows[e.id]??null;let n=await this.view(e,i);if(t==="page"){let f=Math.max(0,e.start||0),m=Math.min(Math.max(1,e.limit||40),2048);return{count:n.length,items:Array.from(n.subarray(f,f+m),h=>({id:h,row:this.rows[h]}))}}if(t==="size")return n.length;let l=JSON.stringify([t,e]),u=this.results.get(l);if(u)return u;let a;if(t==="pivot")a=await Y(this.rows,n,e.spec,i);else if(t==="chart")a=["scatter","histogram","box"].includes(e.w.type)?await Q(this.rows,n,e.w,i):await R(this.rows,n,e.w,i);else if(t==="periods"){let f=async p=>{let g=await this.view({...e,filters:[...e.filters||[],{field:e.field,op:"dateRange",value:p}]},i);return(await R(this.rows,g,{dims:[],measure:e.measure,limit:1,order:"key",transform:"value"},i)).total},m=await f(e.previous),h=await f(e.current);a={previous:m,current:h,change:Number.isFinite(m)&&Number.isFinite(h)?h-m:null,percent:U(h,m)}}else throw new Error("Неизвестная команда");return t==="pivot"?a:this.results.set(l,a)}};var _,$=new Map;self.onmessage=async r=>{let{id:t,cmd:e,payload:i}=r.data;if(e==="cancel"){let l=$.get(i);l&&(l.cancelled=!0);return}let n={cancelled:!1};$.set(t,n);try{let l;e==="hello"?l=!0:e==="begin"?_=new P(i):e==="append"?_.append(i):e==="finish"?l=_.finish():l=await _.run(e,i,n),self.postMessage({id:t,value:l})}catch(l){self.postMessage({id:t,error:l.message,name:l.name})}finally{$.delete(t)}};})();\n'], { type: "text/javascript" }));
          try {
            this.worker = new Worker(url);
          } finally {
            URL.revokeObjectURL(url);
          }
          this.worker.onmessage = ({ data }) => {
            const p = this.pending.get(data.id);
            if (!p) return;
            this.pending.delete(data.id);
            if (data.error) {
              const e = new Error(data.error);
              e.name = data.name;
              p.reject(e);
            } else p.resolve(data.value);
          };
          this.worker.onerror = (event) => {
            event.preventDefault();
            this.failAll(new Error("Worker остановлен"));
          };
          await Promise.race([this.send("hello"), new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("Worker недоступен")), 2e3);
          })]);
          this.mode = "worker";
        } catch {
          this.worker?.terminate();
          this.worker = null;
          this.failAll(new Error("Worker недоступен"));
        } finally {
          clearTimeout(timer);
        }
      }
      checkpoint(this.life);
      if (this.worker) await this.send("begin", cfg);
      else this.data = new Dataset(cfg);
      const budget = { used: 0, max: LIMIT.bytes };
      const projection = cfg.columns.length && !cfg.includeUnlisted ? cfg.columns.map((c) => c.code) : null;
      for (let start = 0; start < rows.length; start += 512) {
        checkpoint(this.life);
        const batch = [];
        for (let i = start; i < Math.min(rows.length, start + 512); i++) {
          const row = readOwn(rows, i);
          check(plain(row), "Строка " + (i + 1) + " должна быть объектом");
          if (!projection) {
            batch.push(copyValue(row, budget));
            continue;
          }
          const out = /* @__PURE__ */ Object.create(null);
          for (const k of projection) {
            const value = readPath(row, k);
            if (value !== void 0) {
              budget.used += 2 * k.length;
              out[k] = copyValue(value, budget);
            }
          }
          batch.push(out);
        }
        if (this.worker) await this.send("append", batch);
        else this.data.append(batch);
        progress(Math.min(start + 512, rows.length), rows.length);
        if (rows.length > 2e3 && !this.worker) await pause();
      }
      checkpoint(this.life);
      return this.worker ? this.send("finish") : this.data.finish();
    }
    send(cmd, payload, token) {
      const id = ++this.serial;
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject, token });
        try {
          this.worker.postMessage({ id, cmd, payload });
        } catch (e) {
          this.pending.delete(id);
          reject(e);
        }
      });
    }
    run(cmd, q, token = this.life) {
      checkpoint(this.life);
      checkpoint(token);
      return this.worker ? this.send(cmd, q, token) : this.data.run(cmd, q, token);
    }
    cancel(token) {
      if (!token) return;
      token.cancelled = true;
      if (this.worker) {
        for (const [id, p] of this.pending) if (p.token === token) this.worker.postMessage({ cmd: "cancel", payload: id });
      }
    }
    failAll(error) {
      for (const p of this.pending.values()) p.reject(error);
      this.pending.clear();
    }
    dispose() {
      this.life.cancelled = true;
      this.worker?.terminate();
      this.worker = null;
      this.data = null;
      try {
        abort();
      } catch (error) {
        this.failAll(error);
      }
    }
  };

  // src/engines/dashboard.js
  function makeDefaults(cfg, columns) {
    const category = columns.find((c) => ["string", "boolean", "reference", "array"].includes(c.type) && !["uuid", "title", "url"].includes(c.code)) || columns[0];
    const number = columns.find((c) => c.type === "number"), date = columns.find((c) => c.type === "date");
    if (cfg.autoWidgets && !cfg.widgets.length) {
      const defaults = [{ id: "count", title: "Всего объектов", type: "kpi" }];
      if (number) defaults.push({ id: "average", title: "Среднее · " + number.title, type: "kpi", measure: { op: "avg", field: number.code } });
      if (category) defaults.push({ id: "distribution", title: "Распределение · " + category.title, type: "bar", dims: [category.code] });
      if (date) defaults.push({ id: "trend", title: "Динамика · " + date.title, type: "line", dims: [{ field: date.code, bucket: "month" }], order: "key" });
      cfg.widgets = defaults.map(widget);
      cfg.autoWidgets = false;
    }
    if (!cfg.pivot.rows.length && !cfg.pivot.cols.length && cfg.autoPivot !== false && category) cfg.pivot = pivotSpec({ ...cfg.pivot, rows: [category.code] });
  }
  function chartQuery(w, depth = 0) {
    const multi = ["stacked", "heatmap", "pivot"].includes(w.type);
    return { ...w, dims: multi ? w.dims : w.dims.slice(depth, depth + 1), order: w.type === "pareto" ? "desc" : w.order };
  }
  function widgetPivot(w) {
    return pivotSpec({ rows: w.dims.slice(0, 1), cols: w.dims.slice(1, 2), measures: [w.measure], order: w.order, heat: true });
  }
  function storageKey(scope) {
    if (typeof scope !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(scope)) return null;
    return "nsd-analytics:v1:" + scope;
  }

  // src/components/dom.js
  function el(tag, cls = "", content) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (content != null) node.textContent = String(content);
    return node;
  }
  function svg(tag, attrs = {}, content) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    if (content != null) node.textContent = String(content);
    return node;
  }
  var paths = {
    grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    table: "M3 4h18v16H3z M3 9h18 M3 14h18 M9 9v11",
    pivot: "M3 4h18v16H3z M3 9h18 M9 4v16 M13 16l4-4 M14 12h3v3",
    filter: "M3 5h18l-7 8v5l-4 2v-7z",
    plus: "M12 5v14 M5 12h14",
    download: "M12 3v12 M7 10l5 5 5-5 M4 16v4h16v-4",
    close: "M6 6l12 12 M18 6L6 18",
    expand: "M4 10V4h6 M14 4h6v6 M20 14v6h-6 M10 20H4v-6",
    sun: "M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l2 2 M17 17l2 2 M19 5l-2 2 M7 17l-2 2 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    settings: "M4 7h8 M16 7h4 M4 17h3 M11 17h9 M12 4v6 M8 14v6",
    database: "M20 6c0 4-16 4-16 0s16-4 16 0z M4 6v12c0 4 16 4 16 0V6 M4 12c0 4 16 4 16 0",
    chart: "M4 3v17h17 M8 15V9 M13 15V5 M18 15v-4",
    arrow: "M5 12h14 M13 6l6 6-6 6",
    clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 6v6l4 2",
    check: "M3 12l6 6L21 5",
    layers: "M12 3l9 5-9 5-9-5z M3 12l9 5 9-5 M3 16l9 5 9-5",
    dot: "M4 12h1 M11 12h1 M18 12h1",
    save: "M4 4h13l3 3v13H4z M8 4v6h8V4 M8 20v-6h8v6",
    menu: "M3 5h18 M3 12h18 M3 19h18",
    search: "M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0 M15 15l6 6"
  };
  function icon(name2) {
    const n = svg("svg", { viewBox: "0 0 24 24", width: 17, height: 17, fill: "none", stroke: "currentColor", "stroke-width": 1.65, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": true });
    n.append(svg("path", { d: paths[name2] || paths.chart }));
    return n;
  }
  function button(title, fn, cls = "", glyph, iconOnly = false) {
    const b = el("button", cls);
    b.type = "button";
    b.title = title;
    b.setAttribute("aria-label", title);
    if (glyph) b.append(icon(glyph));
    if (!iconOnly) b.append(document.createTextNode(title));
    b.onclick = fn;
    return b;
  }
  var opt = (v, s) => {
    const o = el("option", "", s);
    o.value = v;
    return o;
  };
  function select(items, value, change) {
    const s = el("select");
    for (const item of items) s.append(Array.isArray(item) ? opt(item[0], item[1]) : opt(item, item));
    if (value != null) s.value = value;
    if (change) s.onchange = () => change(s.value);
    return s;
  }
  function input(value = "", type = "text") {
    const n = el("input");
    n.type = type;
    n.value = value;
    return n;
  }
  function control(caption, element) {
    const l = el("label", "field");
    l.append(el("span", "", caption), element);
    element.setAttribute("aria-label", caption);
    return l;
  }
  function formatter(locale) {
    const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
    const date = new Intl.DateTimeFormat(locale, { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
    return (value, column) => {
      if (value == null) return "—";
      if (column?.type === "date") {
        const ms = dateMs(value);
        return ms == null ? "—" : date.format(ms);
      }
      if (typeof value === "number") return number.format(value);
      return label(value);
    };
  }
  var chartNames = { bar: "Горизонтальные столбцы", column: "Вертикальные столбцы", pie: "Круговая", donut: "Кольцевая", line: "Линия", stacked: "С накоплением", area: "Область", heatmap: "Тепловая карта", scatter: "Диаграмма рассеяния", histogram: "Гистограмма", treemap: "Карта дерева", funnel: "Воронка", kpi: "KPI", pareto: "Парето", box: "Ящик с усами", gauge: "Шкала", pivot: "Сводная таблица", table: "Таблица объектов" };
  var opNames = { count: "Количество", distinct: "Уникальные значения", sum: "Сумма", avg: "Среднее", min: "Минимум", max: "Максимум", median: "Медиана", mode: "Мода", percentile: "Перцентиль", stddev: "Стандартное отклонение", variance: "Дисперсия" };

  // src/components/editors.js
  var predicates = { eq: "Равно", ne: "Не равно", contains: "Содержит", notContains: "Не содержит", starts: "Начинается с", ends: "Заканчивается на", gt: "Больше", lt: "Меньше", gte: "Больше или равно", lte: "Меньше или равно", between: "Между", in: "В списке", notIn: "Вне списка", filled: "Заполнено", empty: "Не заполнено", dateRange: "Диапазон дат", bool: "Да / нет" };
  var buckets = [["none", "Без интервала"], ["day", "День"], ["week", "Неделя"], ["month", "Месяц"], ["year", "Год"]];
  var modes = [["set", "Набор целиком"], ["first", "Первое значение"], ["explode", "Каждое уникальное"]];
  function editors(columns, t) {
    const fields = columns.map((c) => [c.code, c.title]);
    const opts = (list2) => list2.map(([k, v]) => [k, t(v)]);
    const add = (root, title, element) => {
      root.append(control(t(title), element));
      return element;
    };
    function dimensions(root, title, initial, max) {
      const section = el("fieldset");
      section.append(el("legend", "", t(title)));
      const list2 = el("div");
      section.append(list2);
      root.append(section);
      const entries = [];
      const append = (d) => {
        if (entries.length >= max || !fields.length) return;
        const row = el("div", "editor-row"), f = select(fields, d?.field), b = select(opts(buckets), d?.bucket || "none"), m = select(opts(modes), d?.mode || "set");
        const getter = () => ({ field: f.value, bucket: b.value, mode: m.value });
        entries.push(getter);
        row.append(
          control(t("Поле"), f),
          control(t("Интервал UTC"), b),
          control(t("Массив"), m),
          button(t("Убрать"), () => {
            entries.splice(entries.indexOf(getter), 1);
            row.remove();
          }, "icon", "close", true)
        );
        list2.append(row);
      };
      initial.forEach(append);
      section.append(button(t("Добавить уровень"), () => append(null), "link", "plus"));
      return () => entries.map((f) => f());
    }
    function measurement(parent, initial = {}) {
      const row = el("div", "editor-row"), op = select(opts(ops.map((k) => [k, opNames[k]])), initial.op || "count"), field2 = select([["", t("Все строки")], ...fields], initial.field || ""), p = input(initial.p ?? 0.95, "number");
      p.min = "0";
      p.max = "1";
      p.step = ".01";
      row.append(control(t("Функция"), op), control(t("Значения"), field2));
      const quant = control(t("Квантиль"), p);
      row.append(quant);
      op.onchange = () => {
        quant.hidden = op.value !== "percentile";
      };
      op.onchange();
      parent.append(row);
      return () => ({ op: op.value, field: field2.value, p: Number(p.value) });
    }
    function filter(initial) {
      const wrap = el("div", "filter-editor");
      let nodes = 0;
      function group(node, depth, remove) {
        const box = el("fieldset", "group"), head = el("div", "row"), join = select([["and", t("Все условия (AND)")], ["or", t("Любое условие (OR)")]], node?.join || "and");
        join.setAttribute("aria-label", t("Объединение условий"));
        head.append(join);
        if (remove) head.append(button(t("Удалить группу"), remove, "icon", "close", true));
        const rules = el("div");
        box.append(head, rules);
        const reads = [];
        function entry(n, isGroup) {
          if (nodes >= 80 || !fields.length && !isGroup) return;
          nodes++;
          let element, get;
          const drop = () => {
            nodes--;
            reads.splice(reads.indexOf(get), 1);
            element.remove();
          };
          if (isGroup) {
            const child = group(n, depth + 1, drop);
            element = child.node;
            get = child.read;
          } else {
            element = el("div", "rule");
            const f = select(fields, n?.field), op = select(opts(operators.map((k) => [k, predicates[k]])), n?.op || "eq"), values = el("div", "rule-values");
            f.setAttribute("aria-label", t("Поле условия"));
            op.setAttribute("aria-label", t("Условие"));
            element.append(f, op, values, button(t("Удалить условие"), drop, "icon", "close", true));
            let read;
            const display = (old) => {
              values.replaceChildren();
              const type = columns.find((c) => c.code === f.value)?.type;
              const cast = (s) => {
                if (type === "number" && s !== "") {
                  const num = Number(s);
                  if (!Number.isFinite(num)) throw new Error(t("Введите число"));
                  return num;
                }
                if (type === "boolean") return s === "true";
                return s;
              };
              const make = (v, ty = "text") => {
                const i = input(v ?? "", ty);
                i.setAttribute("aria-label", t("Значение"));
                values.append(i);
                return i;
              };
              if (["empty", "filled"].includes(op.value)) read = () => null;
              else if (op.value === "bool" || type === "boolean" && ["eq", "ne"].includes(op.value)) {
                const s = select([["true", t("Да")], ["false", t("Нет")]], String(old ?? true));
                values.append(s);
                read = () => s.value === "true";
              } else if (["between", "dateRange"].includes(op.value)) {
                const ty = op.value === "dateRange" ? "date" : type === "number" ? "number" : "text";
                const a = make(old?.[0], ty), b = make(old?.[1], ty);
                read = () => [cast(a.value), cast(b.value)];
              } else if (["in", "notIn"].includes(op.value)) {
                const i = make(Array.isArray(old) ? old.join("\n") : "");
                i.placeholder = t("Через запятую");
                i.value = Array.isArray(old) ? old.join(", ") : "";
                read = () => i.value.split(",").map((v) => cast(v.trim()));
              } else {
                const i = make(old, type === "number" ? "number" : "text");
                read = () => cast(i.value);
              }
            };
            f.onchange = op.onchange = () => display(null);
            display(n?.value);
            get = () => ({ field: f.value, op: op.value, value: read() });
          }
          reads.push(get);
          rules.append(element);
        }
        (node?.rules || []).forEach((n) => entry(n, Array.isArray(n.rules)));
        const actions = el("div", "row");
        actions.append(button(t("Условие"), () => entry(null, false), "link", "plus"));
        if (depth < 5) actions.append(button(t("Группа"), () => entry(null, true), "link", "plus"));
        box.append(actions);
        return { node: box, read: () => ({ join: join.value, rules: reads.map((f) => f()) }) };
      }
      const start = initial && !initial.rules ? { join: "and", rules: [initial] } : initial;
      const g = group(start, 0);
      wrap.append(g.node);
      return { node: wrap, read: () => {
        const v = g.read();
        return v.rules.length ? v : null;
      } };
    }
    function widgetEditor(w) {
      const root = el("div", "edit-form"), title = add(root, "Название", input(w.title)), type = add(root, "Визуализация", select(opts(charts.map((k) => [k, chartNames[k]])), w.type));
      const dims = dimensions(root, "Группировка и детализация", w.dims, 4), metric = measurement(root, w.measure);
      const extra = el("div", "editor-row");
      root.append(extra);
      const nums = [["", "—"], ...fields], x = add(extra, "Ось X / распределение", select(nums, w.x)), y = add(extra, "Ось Y", select(nums, w.y)), goal = add(extra, "Цель шкалы", input(w.goal, "number"));
      const row = el("div", "editor-row");
      root.append(row);
      const order = add(row, "Сортировка", select(opts([["key", "По измерению"], ["desc", "TOP N"], ["asc", "BOTTOM N"]]), w.order));
      const limit = add(row, "Лимит категорий", input(w.limit, "number"));
      limit.min = "1";
      limit.max = "60";
      const transform = add(row, "Расчёт", select(opts([["value", "Значение"], ["percent", "Доля, %"], ["cumulative", "Накопительный итог"], ["delta", "Динамика, %"]]), w.transform));
      const size = el("div", "editor-row");
      root.append(size);
      const span = add(size, "Ширина", select(opts([["1", "Одна колонка"], ["2", "Две колонки"]]), String(w.span)));
      const height = add(size, "Высота", select(opts([["1", "Обычная"], ["2", "Увеличенная"]]), String(w.height)));
      root.append(el("h3", "", t("Фильтр виджета")));
      const local = filter(w.filter);
      root.append(local.node);
      return { node: root, read: () => ({ ...w, title: title.value, type: type.value, dims: dims(), measure: metric(), x: x.value, y: y.value, goal: Number(goal.value), limit: Number(limit.value), order: order.value, transform: transform.value, span: Number(span.value), height: Number(height.value), filter: local.read() }) };
    }
    function pivotEditor(p) {
      const root = el("div", "edit-form"), rd = dimensions(root, "Строки", p.rows, 3), cd = dimensions(root, "Столбцы", p.cols, 2);
      const section = el("fieldset");
      section.append(el("legend", "", t("Показатели")));
      root.append(section);
      const reads = [];
      function append(m) {
        if (reads.length >= 4) return;
        const line2 = el("div", "measure-line");
        section.append(line2);
        const read = measurement(line2, m);
        reads.push(read);
        line2.append(button(t("Удалить показатель"), () => {
          line2.remove();
          reads.splice(reads.indexOf(read), 1);
        }, "icon", "close", true));
      }
      p.measures.forEach(append);
      root.append(button(t("Добавить показатель"), () => append({}), "link", "plus"));
      const order = add(root, "Сортировка", select(opts([["key", "По измерению"], ["desc", "По убыванию"], ["asc", "По возрастанию"]]), p.order));
      const heat = add(root, "Цветовая шкала", select(opts([["1", "Включена"], ["0", "Выключена"]]), p.heat ? "1" : "0"));
      root.append(el("h3", "", t("Фильтр сводной")));
      const local = filter(p.filter);
      root.append(local.node);
      return { node: root, read: () => ({ rows: rd(), cols: cd(), measures: reads.map((f) => f()), order: order.value, heat: heat.value === "1", filter: local.read() }) };
    }
    return { filter, widgetEditor, pivotEditor };
  }

  // src/charts/render.js
  var colors = ["#6758d6", "#36a996", "#6689d9", "#db9c53", "#c77ba7", "#73a257", "#8b73bd", "#4b9ab1"];
  var ink = "var(--ink)";
  var muted = "var(--muted)";
  var grid = "var(--line)";
  var short = (v, n = 19) => String(v).length > n ? String(v).slice(0, n - 1) + "…" : String(v);
  var line = (s, x1, y1, x2, y2, stroke = grid, width = 1) => s.append(svg("line", { x1, y1, x2, y2, stroke, "stroke-width": width }));
  function txt(s, x, y, value, size = 11, anchor = "start", fill = muted) {
    const n = svg("text", { x, y, "font-size": size, "text-anchor": anchor, fill }, value);
    s.append(n);
    return n;
  }
  function mark(node, caption, action) {
    node.append(svg("title", {}, caption));
    node.setAttribute("aria-label", caption);
    node.setAttribute("role", "button");
    node.setAttribute("tabindex", "0");
    node.onclick = action;
    node.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        action();
      }
    };
    return node;
  }
  function scale(a, b, lo, hi) {
    if (a === b) return () => (lo + hi) / 2;
    const span = b - a;
    return (x) => lo + (Number.isFinite(span) ? (x - a) / span : (x / 2 - a / 2) / (b / 2 - a / 2)) * (hi - lo);
  }
  var name = (g) => g.path.map((p) => p.text).join(" / ") || "Итого";
  function treemap(items, x, y, w, h, draw) {
    if (items.length === 1) {
      draw(items[0], x, y, w, h);
      return;
    }
    const sum = items.reduce((n, item) => n + item.value, 0);
    let k = 1, first = items[0].value;
    while (k < items.length - 1 && first + items[k].value / 2 < sum / 2) {
      first += items[k++].value;
    }
    const ratio = first / sum;
    if (w >= h) {
      treemap(items.slice(0, k), x, y, w * ratio, h, draw);
      treemap(items.slice(k), x + w * ratio, y, w * (1 - ratio), h, draw);
    } else {
      treemap(items.slice(0, k), x, y, w, h * ratio, draw);
      treemap(items.slice(k), x, y + h * ratio, w, h * (1 - ratio), draw);
    }
  }
  function chart(model, w, ctx) {
    const { fmt, t, choose } = ctx;
    const root = el("div", "plot");
    const blank = (msg) => {
      root.replaceChildren(el("p", "empty", t(msg)));
      return root;
    };
    const title = w.title, kind = w.type;
    let height = 204;
    let all = model.groups || [], data = all.filter((g) => Number.isFinite(g.value));
    if (kind === "bar" || kind === "funnel") height = Math.max(150, 32 + data.length * 26);
    const s = svg("svg", { viewBox: "0 0 520 " + height, role: "group", "aria-label": title, "font-family": "Arial, sans-serif", class: "viz" });
    root.append(s);
    s.append(svg("title", {}, title));
    const rect = (x, y, width, h, fill, rx = 3) => svg("rect", { x, y, width: Math.max(0, width), height: Math.max(0, h), fill, rx });
    const clickable = (n, g) => {
      s.append(mark(n, name(g) + " · " + fmt(g.value), () => choose(g)));
    };
    const legend = (entries) => {
      const l = el("div", "legend");
      entries.forEach(([caption, color]) => {
        const item = el("span");
        const dot = el("i");
        dot.style.backgroundColor = color;
        item.append(dot, document.createTextNode(caption));
        item.title = caption;
        l.append(item);
      });
      if (entries.length) root.append(l);
    };
    const axes = (min, max, y) => {
      for (let i = 0; i <= 4; i++) {
        const n = min * (1 - i / 4) + max * i / 4;
        line(s, 60, y(n), 504, y(n));
        txt(s, 53, y(n) + 4, short(fmt(n), 10), 10, "end");
      }
    };
    if (kind === "kpi" || kind === "gauge") {
      if (model.total == null || !model.rows) return blank("Нет подходящих данных");
      if (kind === "kpi") {
        txt(s, 20, 116, short(fmt(model.total), 28), 54, "start", ink);
        return root;
      }
      if (!Number.isFinite(model.total)) return blank("Требуется числовая мера");
      const arc = (color, fraction) => {
        if (!fraction) return;
        const angle = Math.PI * (1 - fraction);
        s.append(svg("path", { d: "M132 148 A128 128 0 0 1 " + (260 + 128 * Math.cos(angle)) + " " + (148 - 128 * Math.sin(angle)), fill: "none", stroke: color, "stroke-width": 20 }));
      };
      arc(grid, 1);
      arc(colors[0], Math.min(1, Math.max(0, model.total / w.goal)));
      txt(s, 260, 133, fmt(model.total), 38, "middle", ink);
      txt(s, 260, 171, t("Цель") + " " + fmt(w.goal), 14, "middle");
      return root;
    }
    if (kind === "scatter") {
      if (!model.points.length) return blank("Выберите две числовые колонки с совместными наблюдениями");
      const points = model.points, xs = points.map((p) => p.x), ys = points.map((p) => p.y);
      const min = Math.min(...ys), max = Math.max(...ys), x = scale(Math.min(...xs), Math.max(...xs), 68, 494), y = scale(min, max, 164, 18);
      axes(min, max, y);
      points.forEach((p) => s.append(mark(svg("circle", { cx: x(p.x), cy: y(p.y), r: 4, fill: colors[0], opacity: 0.65 }), fmt(p.x) + " × " + fmt(p.y), () => choose({ id: p.id }))));
      txt(s, 65, 191, fmt(Math.min(...xs)));
      txt(s, 496, 191, fmt(Math.max(...xs)), 11, "end");
      legend([[w.x + " × " + w.y, colors[0]]]);
    } else if (kind === "box") {
      const b = model.box;
      if (!b) return blank("Выберите числовое поле с наблюдениями");
      const x = scale(Math.min(b.min, ...b.outliers), Math.max(b.max, ...b.outliers), 42, 480);
      line(s, x(b.min), 92, x(b.max), 92, colors[0], 2);
      for (const n of [b.min, b.max]) line(s, x(n), 78, x(n), 106, colors[0], 2);
      s.append(mark(
        rect(x(b.q1), 65, Math.max(2, x(b.q3) - x(b.q1)), 54, colors[0]),
        "Q1–Q3: " + fmt(b.q1) + "–" + fmt(b.q3),
        () => choose({ terms: [{ field: model.field, low: b.q1, high: b.q3, inclusive: true }] })
      ));
      line(s, x(b.median), 65, x(b.median), 119, "white", 3);
      for (const n of b.outliers) s.append(mark(svg("circle", { cx: x(n), cy: 92, r: 3, fill: colors[3] }), fmt(n), () => choose({ terms: [{ field: model.field, low: n, high: n, inclusive: true }] })));
      txt(s, 260, 154, t("Медиана") + " " + fmt(b.median) + "   ·   Q1 " + fmt(b.q1) + "   ·   Q3 " + fmt(b.q3), 13, "middle");
      txt(s, 260, 177, t("Выбросы") + " " + fmt(b.outlierCount), 12, "middle");
    } else if (kind === "heatmap" || kind === "stacked") {
      const rows = model.rows.filter((r) => r.path.length === 1), cols = model.cols.filter((c) => c.path.length === 1);
      if (!rows.length || !cols.length) return blank("Выберите два измерения");
      if (rows.length > w.limit || cols.length > 16) return blank("Слишком много категорий. Уточните фильтр");
      const cells = rows.flatMap((r) => cols.map((c) => cellValue(model, r.key, c.key)));
      if (!cells.some(Number.isFinite)) return blank("Требуется числовая мера");
      const magnitude = Math.max(1, ...cells.filter(Number.isFinite).map(Math.abs));
      const maxStack = Math.max(0, ...rows.map((r) => cols.reduce((sum, c) => sum + Math.max(0, cellValue(model, r.key, c.key) || 0), 0)));
      const minStack = Math.min(0, ...rows.map((r) => cols.reduce((sum, c) => sum + Math.min(0, cellValue(model, r.key, c.key) || 0), 0)));
      const y = scale(minStack, maxStack, 163, 15);
      if (kind === "stacked") axes(minStack, maxStack, y);
      const dx = 438 / rows.length, dy = 143 / cols.length;
      rows.forEach((r, i) => {
        let pos = 0, neg = 0;
        cols.forEach((c, j) => {
          const v = cellValue(model, r.key, c.key);
          if (!Number.isFinite(v)) return;
          let cell;
          if (kind === "heatmap") {
            cell = rect(65 + i * dx, 15 + j * dy, dx - 1, dy - 1, v < 0 ? colors[3] : colors[0], 1);
            cell.setAttribute("opacity", 0.18 + 0.82 * Math.abs(v) / magnitude);
          } else {
            const from = v >= 0 ? pos : neg, to = from + v;
            cell = rect(65 + i * dx, Math.min(y(from), y(to)), dx * 0.73, Math.abs(y(to) - y(from)), colors[j % colors.length], 1);
            if (v >= 0) pos = to;
            else neg = to;
          }
          const picked = { path: [...r.path, ...c.path], value: v, terms: [...selection([w.dims[0]], r.path), ...selection([w.dims[1]], c.path)] };
          clickable(cell, picked);
        });
        if (i % Math.max(1, Math.ceil(rows.length / 6)) === 0) txt(s, 65 + (i + 0.4) * dx, 187, short(r.path[0].text, 10), 10, "middle");
      });
      if (kind === "heatmap") cols.forEach((c, j) => txt(s, 61, 19 + (j + 0.5) * dy, short(c.path[0].text, 9), 9, "end"));
      else legend(cols.map((c, j) => [c.path[0].text, colors[j % colors.length]]));
    } else {
      if (!data.length) return blank("Нет подходящих числовых данных");
      const positive = ["pie", "donut", "treemap", "funnel", "pareto"].includes(kind);
      if (positive && (data.some((g) => g.value < 0) || !data.some((g) => g.value > 0))) return blank("Для этой диаграммы нужны неотрицательные значения с положительным итогом");
      const sum = data.reduce((n, g) => n + g.value, 0);
      if (positive && !Number.isFinite(sum)) return blank("Итог превышает числовой диапазон");
      const vals = data.map((g) => g.value), low = Math.min(0, ...vals), high = Math.max(0, ...vals);
      if (kind === "bar" || kind === "funnel") {
        if (kind === "funnel") data = data.slice().sort((a, b) => b.value - a.value);
        const x = scale(low, high, 163, 458);
        data.forEach((g, i) => {
          const y = 12 + i * 26;
          txt(s, 4, y + 14, short(name(g), 23), 12, "start", ink);
          if (kind === "bar") {
            const x0 = x(0), x1 = x(g.value);
            clickable(rect(Math.min(x0, x1), y, Math.max(1, Math.abs(x1 - x0)), 17, g.value < 0 ? colors[3] : colors[i % colors.length]), g);
          } else {
            const width = g.value / high * 275;
            clickable(rect(310 - width / 2, y, width, 21, colors[i % colors.length], 1), g);
          }
          txt(s, 507, y + 14, short(fmt(g.value), 13), 12, "end", ink);
        });
      } else if (kind === "pie" || kind === "donut") {
        let start = -Math.PI / 2;
        const cx = 142, cy = 102, r = 86, inner = kind === "donut" ? 55 : 0;
        data.forEach((g, i) => {
          if (!g.value) return;
          const delta = g.value / sum * 2 * Math.PI, end = start + Math.min(delta, Math.PI * 2 - 1e-5);
          const point = (a, rad) => [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad].join(" ");
          const large = delta > Math.PI ? 1 : 0;
          const d = "M" + point(start, r) + " A" + r + " " + r + " 0 " + large + " 1 " + point(end, r) + (inner ? " L" + point(end, inner) + " A" + inner + " " + inner + " 0 " + large + " 0 " + point(start, inner) : " L" + cx + " " + cy) + " Z";
          clickable(svg("path", { d, fill: colors[i % colors.length], stroke: "var(--card)", "stroke-width": 2 }), g);
          start += delta;
        });
        if (inner) {
          txt(s, cx, 104, short(fmt(sum), 11), 27, "middle", ink);
          txt(s, cx, 124, t("В выборке"), 11, "middle");
        }
        const listed = data.slice(0, 7);
        listed.forEach((g, i) => {
          const yy = cy - (listed.length - 1) * 12 + i * 24;
          s.append(rect(258, yy - 7, 9, 9, colors[i % colors.length], 3));
          mark(txt(s, 275, yy + 2, short(name(g), 20), 12, "start", ink), name(g) + " · " + fmt(g.value), () => choose(g));
          txt(s, 505, yy + 2, fmt(g.value / sum * 100) + "%", 12, "end");
        });
        if (data.length > 7) legend(data.slice(7).map((g, i) => [name(g), colors[(i + 7) % colors.length]]));
      } else if (kind === "treemap") {
        treemap(data.filter((g) => g.value > 0).sort((a, b) => b.value - a.value), 3, 4, 514, 193, (g, x, y, width, h) => {
          const i = data.indexOf(g);
          clickable(rect(x + 1, y + 1, width - 2, h - 2, colors[i % colors.length], 2), g);
          if (width > 47 && h > 26) {
            const text2 = txt(s, x + 7, y + 18, short(name(g), Math.floor(width / 8)), 11, "start", "white");
            text2.setAttribute("pointer-events", "none");
          }
        });
      } else {
        if (kind === "pareto") data = data.slice().sort((a, b) => b.value - a.value);
        const step = 440 / data.length, x = (i) => 61 + step * (i + 0.5), y = scale(low, high || 1, 163, 15);
        axes(low, high || 1, y);
        const points = data.map((g, i) => [x(i), y(g.value)]);
        const d = points.map((p, i) => (i ? "L" : "M") + p.join(" ")).join(" ");
        if (kind === "line" || kind === "area") {
          if (kind === "area") s.append(svg("path", { d: d + " L" + x(data.length - 1) + " " + y(0) + " L" + x(0) + " " + y(0) + " Z", fill: colors[0], opacity: 0.13 }));
          s.append(svg("path", { d, fill: "none", stroke: colors[0], "stroke-width": 3, "stroke-linejoin": "round" }));
          points.forEach(([cx, cy], i) => clickable(svg("circle", { cx, cy, r: 4, fill: colors[0], stroke: "var(--card)", "stroke-width": 1 }), data[i]));
        } else {
          data.forEach((g, i) => clickable(rect(x(i) - step * 0.37, Math.min(y(0), y(g.value)), step * 0.74, Math.max(1, Math.abs(y(0) - y(g.value))), colors[0], 2), g));
          if (kind === "pareto") {
            let total = 0;
            const path = data.map((g, i) => {
              total += g.value;
              return (i ? "L" : "M") + x(i) + " " + (163 - 148 * total / sum);
            }).join(" ");
            s.append(svg("path", { d: path, fill: "none", stroke: colors[1], "stroke-width": 2.5, "pointer-events": "none" }));
            legend([[t("Значение"), colors[0]], [t("Накопленная доля, 0–100 %"), colors[1]]]);
          }
        }
        data.forEach((g, i) => {
          if (i % Math.max(1, Math.ceil(data.length / 6)) === 0) txt(s, x(i), 187, short(name(g), 11), 10, "middle");
        });
      }
    }
    if (model.omitted) root.append(el("small", "hint", t("Скрыто из-за лимита") + " · " + fmt(model.omitted)));
    return root;
  }

  // src/components/tables.js
  async function objectTable(app, root, query, token, compact = false) {
    const { t, fmt, columns, session } = app;
    const cols = compact ? columns.slice(0, 5) : columns;
    const search = input(query.search || "", "search");
    search.placeholder = t("Поиск по значениям");
    search.setAttribute("aria-label", t("Поиск по значениям"));
    const bar = el("div", "table-tools"), count = el("small", "hint");
    bar.append(search, count);
    root.append(bar);
    const viewport = el("div", "table-viewport");
    viewport.tabIndex = 0;
    viewport.setAttribute("aria-label", t("Таблица объектов"));
    if (compact) viewport.classList.add("compact");
    const table = el("table", "records"), head = el("thead"), body = el("tbody"), tr = el("tr");
    for (const c of cols) {
      const th = el("th");
      th.append(button(c.title, () => {
        query.sort = { code: c.code, desc: query.sort?.code === c.code && !query.sort.desc };
        viewport.scrollTop = 0;
        draw(true).catch(app.report);
      }, "th-button"));
      tr.append(th);
    }
    head.append(tr);
    table.append(head, body);
    viewport.append(table);
    root.append(viewport);
    const rowHeight = 33;
    let revision = 0, last = -1, timer;
    function spacer(h) {
      const tr2 = el("tr", "spacer"), td = el("td");
      td.colSpan = Math.max(1, cols.length);
      td.style.height = h + "px";
      tr2.append(td);
      return tr2;
    }
    async function draw(force = false) {
      if (token.cancelled) return;
      const start = Math.max(0, Math.floor(viewport.scrollTop / rowHeight) - 8);
      if (last === start && !force) return;
      last = start;
      const limit = Math.max(24, Math.ceil((viewport.clientHeight || 480) / rowHeight) + 18), seq = ++revision;
      const p = await session.run("page", { ...query, start, limit }, token);
      if (token.cancelled || seq !== revision) return;
      count.textContent = fmt(p.count) + " " + t("объектов");
      body.replaceChildren(spacer(start * rowHeight));
      for (const { id, row } of p.items) {
        const line2 = el("tr");
        line2.tabIndex = 0;
        line2.onclick = () => app.detail(id);
        line2.onkeydown = (e) => {
          if (e.key === "Enter") app.detail(id);
        };
        for (const c of cols) {
          const str = fmt(field(row, c.code), c), td = el("td", "", str);
          td.title = str;
          line2.append(td);
        }
        body.append(line2);
      }
      if (!p.count) {
        const empty2 = el("td", "empty", t("По текущим условиям нет объектов"));
        empty2.colSpan = Math.max(1, cols.length);
        const tr2 = el("tr");
        tr2.append(empty2);
        body.append(tr2);
      }
      body.append(spacer(Math.max(0, p.count - start - p.items.length) * rowHeight));
    }
    viewport.onscroll = () => draw().catch(app.report);
    search.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (token.cancelled) return;
        query.search = search.value;
        viewport.scrollTop = 0;
        draw(true).catch(app.report);
      }, 175);
    };
    await draw(true);
  }
  function pivotMatrix(model, spec, fmt, t) {
    const path = (p) => p.map((v) => v.text).join(" / ") || t("Итого");
    check(model.rows.length * model.cols.length * spec.measures.length <= LIMIT.cells * 4, "Плотная выгрузка слишком велика. Сократите измерения сводной.");
    const headers = [t("Группа"), ...model.cols.flatMap((c) => spec.measures.map((m) => path(c.path) + " · " + m.op + (m.field ? " " + m.field : "")))];
    const rows = model.rows.map((r) => [path(r.path), ...model.cols.flatMap((c) => spec.measures.map((m, i) => cellValue(model, r.key, c.key, i)))]);
    return { headers, rows };
  }
  function pivotTable(app, root, model, spec, onPick, compact = false) {
    const { fmt, t } = app, closedR = /* @__PURE__ */ new Set(), closedC = /* @__PURE__ */ new Set();
    let page = 0, colPage = 0;
    const host = el("div", "pivot-host");
    root.append(host);
    function visible(item, closed) {
      return !item.path.some((_, i) => i > 0 && closed.has(pathKey(item.path.slice(0, i))));
    }
    function draw() {
      host.replaceChildren();
      const rr = model.rows.filter((r) => visible(r, closedR)), cc = model.cols.filter((c) => visible(c, closedC));
      const rsize = compact ? 8 : 40, csize = compact ? 4 : 8;
      page = Math.min(page, Math.ceil(rr.length / rsize) - 1);
      colPage = Math.min(colPage, Math.ceil(cc.length / csize) - 1);
      const rows = rr.slice(page * rsize, (page + 1) * rsize), cols = cc.slice(colPage * csize, (colPage + 1) * csize);
      const wrapper = el("div", "pivot-scroll"), table = el("table", "pivot-table"), head = el("thead"), tr = el("tr");
      tr.append(el("th", "", t("Группа")));
      function header(th, item, dims, closed) {
        const name2 = item.path.map((p) => p.text).join(" / ") || t("Итого");
        if (item.path.length && item.path.length < dims.length) {
          const b = button((closed.has(item.key) ? "▸ " : "▾ ") + name2, () => {
            if (closed.has(item.key)) closed.delete(item.key);
            else closed.add(item.key);
            draw();
          }, "th-button");
          b.setAttribute("aria-expanded", String(!closed.has(item.key)));
          th.append(b);
        } else th.textContent = name2;
        th.title = name2;
      }
      for (const c of cols) {
        for (const m of spec.measures) {
          const th = el("th");
          header(th, c, spec.cols, closedC);
          th.append(el("small", "measure-label", m.op.toUpperCase() + (m.field ? " · " + m.field : "")));
          tr.append(th);
        }
      }
      head.append(tr);
      table.append(head);
      const body = el("tbody");
      let max = 0;
      for (const r of rows) for (const c of cols) for (let i = 0; i < spec.measures.length; i++) {
        const v = cellValue(model, r.key, c.key, i);
        if (Number.isFinite(v)) max = Math.max(max, Math.abs(v));
      }
      for (const r of rows) {
        const line2 = el("tr", r.path.length ? "" : "total"), th = el("th");
        header(th, r, spec.rows, closedR);
        line2.append(th);
        for (const c of cols) spec.measures.forEach((m, i) => {
          const v = cellValue(model, r.key, c.key, i), td = el("td");
          if (spec.heat && Number.isFinite(v) && max) td.style.backgroundColor = "rgba(111,95,211," + (0.04 + 0.24 * Math.abs(v) / max) + ")";
          td.append(button(fmt(v), () => onPick([...selection(spec.rows, r.path), ...selection(spec.cols, c.path)]), "cell-button"));
          line2.append(td);
        });
        body.append(line2);
      }
      table.append(body);
      wrapper.append(table);
      host.append(wrapper);
      function pager(title, current2, size, total, set) {
        if (total <= size) return;
        const nav = el("div", "row pager");
        nav.append(el("small", "hint", title + " " + (current2 * size + 1) + "–" + Math.min((current2 + 1) * size, total) + " / " + total));
        const prev = button(t("Назад"), () => {
          set(current2 - 1);
          draw();
        }), next = button(t("Далее"), () => {
          set(current2 + 1);
          draw();
        });
        prev.disabled = current2 === 0;
        next.disabled = (current2 + 1) * size >= total;
        nav.append(prev, next);
        host.append(nav);
      }
      pager(t("Строки"), page, rsize, rr.length, (v) => page = v);
      pager(t("Столбцы"), colPage, csize, cc.length, (v) => colPage = v);
    }
    draw();
  }

  // src/engines/export.js
  function csvCell(value, sep = ",", clipboard = false) {
    if (value == null) return '""';
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    let s = typeof value === "object" ? label(value) : String(value);
    if (/^[\u0000-\u0020\u00a0\ufeff]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/u.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
    if (clipboard) s = s.replace(/[\t\r\n]+/g, " ");
    return '"' + s.replace(/"/g, '""') + '"';
  }
  var escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (v) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[v]);
  var formats = { csv: "text/csv", tsv: "text/tab-separated-values", json: "application/json", html: "text/html", svg: "image/svg+xml", png: "image/png" };
  function reportPage(title, body) {
    return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>` + escapeHtml(title) + "</title><style>body{font:15px system-ui;color:#242532;margin:32px}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px;text-align:left}svg{width:min(100%,680px);display:block}section{break-inside:avoid}h1,h2{font-weight:600}</style><h1>" + escapeHtml(title) + "</h1>" + body + "</html>";
  }
  function cellData(row, c) {
    const v = field(row, c.code);
    return c.type === "date" && dateMs(v) != null ? new Date(dateMs(v)).toISOString() : v;
  }
  function encodeTable(headers, rows, format, title, clipboard = false) {
    if (format === "json") return JSON.stringify(rows);
    if (format === "html") {
      const tag = (cells, t) => "<tr>" + cells.map((v) => "<" + t + ">" + escapeHtml(v == null ? "" : label(v)) + "</" + t + ">").join("") + "</tr>";
      return reportPage(title, "<table>" + tag(headers, "th") + rows.map((row) => tag(row, "td")).join("") + "</table>");
    }
    const sep = format === "csv" ? ";" : "	";
    return [headers, ...rows].map((row) => row.map((v) => csvCell(v, sep, clipboard)).join(sep)).join("\r\n");
  }
  async function exportRows(session, query, columns, format, title, token, clipboard = false) {
    const parts = [];
    let bytes = 0;
    const encoder = new TextEncoder();
    function add(s) {
      bytes += encoder.encode(s).length;
      check(bytes <= LIMIT.exportBytes, "Экспорт превышает 32 МиБ. Сузьте выборку.");
      parts.push(s);
    }
    const sep = format === "csv" ? ";" : "	", tableRow = (r) => "<tr>" + r.map((v) => "<td>" + escapeHtml(v == null ? "" : label(v)) + "</td>").join("") + "</tr>";
    if (format === "json") add("[");
    else if (format === "html") add(reportPage(title, "<table><thead><tr>" + columns.map((c) => "<th>" + escapeHtml(c.title) + "</th>").join("") + "</tr></thead><tbody>").replace("</html>", ""));
    else add((clipboard ? "" : "\uFEFF") + columns.map((c) => csvCell(c.title, sep, clipboard)).join(sep));
    let start = 0;
    do {
      const page = await session.run("page", { ...query, start, limit: 512 }, token);
      for (const item of page.items) {
        if (format === "json") {
          add((start ? "," : "") + JSON.stringify(item.row));
        } else {
          const r = columns.map((c) => cellData(item.row, c));
          add(format === "html" ? tableRow(r) : "\r\n" + r.map((v) => csvCell(v, sep, clipboard)).join(sep));
        }
        start++;
      }
      if (start >= page.count) break;
    } while (true);
    if (format === "json") add("]");
    if (format === "html") add("</tbody></table></html>");
    return new Blob(parts, { type: formats[format] + ";charset=utf-8" });
  }
  function download(blob, name2) {
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url;
    a.download = name2;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2e3);
  }
  function svgText(node) {
    const clone2 = node.cloneNode(true);
    const source = [node, ...node.querySelectorAll("*")], copy = [clone2, ...clone2.querySelectorAll("*")];
    for (let i = 0; i < copy.length; i++) {
      for (const attr of ["fill", "stroke"]) if (copy[i].getAttribute(attr)?.includes("var(")) copy[i].setAttribute(attr, getComputedStyle(source[i])[attr]);
      for (const attr of ["tabindex", "role", "class"]) copy[i].removeAttribute(attr);
    }
    const legend = node.parentElement?.querySelector(".legend");
    const box = node.viewBox.baseVal;
    if (legend) {
      const ns = "http://www.w3.org/2000/svg";
      const labels = [...legend.children];
      labels.forEach((entry, i) => {
        const y = box.height + 14 + i * 16;
        const dot = document.createElementNS(ns, "rect");
        for (const [k, v] of Object.entries({ x: 10, y: y - 8, width: 8, height: 8, rx: 2, fill: getComputedStyle(entry.querySelector("i")).backgroundColor })) dot.setAttribute(k, String(v));
        const text2 = document.createElementNS(ns, "text");
        text2.setAttribute("x", "24");
        text2.setAttribute("y", String(y));
        text2.setAttribute("font-size", "11");
        text2.setAttribute("fill", getComputedStyle(entry).color);
        text2.textContent = entry.textContent.slice(0, 80);
        clone2.append(dot, text2);
      });
      clone2.setAttribute("viewBox", "0 0 " + box.width + " " + (box.height + labels.length * 16 + 5));
    }
    clone2.setAttribute("width", String(box.width));
    clone2.setAttribute("height", clone2.getAttribute("viewBox").split(/\s+/)[3]);
    return new XMLSerializer().serializeToString(clone2);
  }
  async function pngBlob(node) {
    const url = URL.createObjectURL(new Blob([svgText(node)], { type: formats.svg }));
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width * 2;
      c.height = img.height * 2;
      const ctx = c.getContext("2d");
      ctx.fillStyle = getComputedStyle(node.closest(".widget") || node).backgroundColor;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return await new Promise((resolve, reject) => c.toBlob((b) => b ? resolve(b) : reject(new Error("Не удалось создать PNG")), "image/png"));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // src/styles/studio.css
  var studio_default = `:host{all:initial;font-family:Inter,Arial,"DejaVu Sans",sans-serif;color-scheme:light;display:block}
*{box-sizing:border-box} [hidden]{display:none!important}
.shell{--ink:#202333;--muted:#646c80;--line:#e3e5ed;--card:#fff;--base:#f5f6fa;--soft:#f2effd;--accent:#6152c5;--head:#25233c;--onhead:#f5f3ff;--hover:#f7f6fd;--danger:#a13736;font:14px/1.4 Inter,Arial,sans-serif;color:var(--ink);background:var(--base);display:flex;flex-direction:column;overflow:hidden;isolation:isolate;outline:none;text-align:left}
.shell.dark{color-scheme:dark;--ink:#edf0f6;--muted:#a7adc0;--line:#3a3d50;--card:#282a39;--base:#202231;--soft:#393450;--accent:#baabff;--head:#171824;--hover:#323345;--danger:#ff9992}
.backdrop{border:0;margin:0;width:100vw;height:100vh;max-width:none;max-height:none;position:fixed;inset:0;z-index:2147483600;background:#11142570;display:grid;place-items:center;padding:2.5vh 2vw}
.backdrop .shell{width:min(1560px,100%);height:95vh;border-radius:13px;box-shadow:0 16px 70px #14152638}
.backdrop.full{padding:0}.backdrop.full .shell{width:100%;height:100%;border-radius:0}
.embedded .shell{width:100%;height:var(--nsda-height,85vh);min-height:380px;border:1px solid var(--line);border-radius:10px}
button,input,select,textarea{font:inherit;color:inherit}button,select,input,textarea{background:var(--card);border:1px solid var(--line);border-radius:6px}
button{min-height:31px;padding:5px 10px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:7px;line-height:1.25}
button:hover{background:var(--hover);border-color:var(--accent)}button:disabled{opacity:.45;cursor:default}
button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,[tabindex]:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
input,select,textarea{min-width:0;padding:7px 8px}select{max-width:100%}.primary{background:var(--accent);border-color:var(--accent);color:white;font-weight:600}.dark .primary{color:#201d30}.primary:hover{background:#5141b5;color:white}
.icon{width:32px;padding:6px}.link,.th-button,.cell-button{border:0;color:var(--accent);background:transparent}.link{justify-content:flex-start;padding-inline:3px}.row,.toolbar,.table-tools,.heading,.card-head,.editor-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.top{background:var(--head);color:var(--onhead);height:54px;flex:none;display:flex;align-items:center;gap:12px;padding:0 21px}
.brand{display:flex;align-items:center;gap:10px;font-size:16px;font-weight:650;letter-spacing:-.4px}.logo{width:29px;height:29px;background:#9182ee;color:#201d3f;border-radius:7px;display:flex;align-items:flex-end;justify-content:center;gap:3px;padding:6px}.logo i{display:block;width:3px;background:currentColor;border-radius:1px}.logo i:nth-child(1){height:7px}.logo i:nth-child(2){height:12px}.logo i:nth-child(3){height:16px}.top .spacer-flex{flex:1}.top .icon{background:none;color:#ecebf8;border:1px solid #ffffff26}.top .icon:hover{background:#ffffff18}.top-divider{height:20px;width:1px;background:#ffffff35}.top-meta{color:#c6c2db;font-size:12px}
.layout{display:grid;grid-template-columns:212px minmax(0,1fr);flex:1;min-height:0}.layout.noside{grid-template-columns:1fr}.sidebar{border-right:1px solid var(--line);background:var(--card);padding:23px 14px;overflow:auto}
.side-title{font-size:10px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin:0 8px 9px}
.nav{display:flex;flex-direction:column;gap:3px;margin-bottom:24px}.nav button{border:0;justify-content:flex-start;background:none;padding:9px 10px;color:var(--muted);font-weight:550}.nav button.active{background:var(--soft);color:var(--accent)}.nav button:hover{background:var(--hover)}
.side-section{border-top:1px solid var(--line);padding:19px 4px;margin-top:10px}.side-section .side-title{margin-left:3px}.side-section .hint{display:block;margin:9px 3px}.side-section button{margin:3px 0;max-width:100%}.filter-chip{font-size:12px;color:var(--accent);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:var(--soft);padding:4px 7px;border-radius:4px;margin-bottom:5px}
.main{min-width:0;overflow:auto;padding:25px clamp(15px,2.2vw,35px) 35px}.heading{justify-content:space-between;margin-bottom:18px}.heading h1{font-size:clamp(21px,2.2vw,32px);letter-spacing:-.055em;line-height:1.15;margin:6px 0}.hint,small{font-size:12px;color:var(--muted)}.heading small{display:flex;align-items:center;gap:6px}
h2,h3,p{margin:0}.section-head{font-size:16px;letter-spacing:-.02em;margin:18px 0 11px}.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.widget{background:var(--card);border:1px solid var(--line);border-radius:9px;min-width:0;overflow:hidden}.kpi{position:relative;padding:15px 16px 14px}.kpi .card-head{padding:0;gap:5px}.kpi .card-head h3{font-size:12px;font-weight:550;color:var(--muted)}.kpi strong{display:block;font-size:clamp(25px,2.6vw,40px);line-height:1.18;letter-spacing:-.06em;margin:8px 0 2px;font-variant-numeric:tabular-nums}.kpi .unit{font-size:15px;letter-spacing:0;font-weight:500;padding-left:5px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:start}.wide{grid-column:span 2}.card-head{padding:15px 16px 6px;display:flex;flex-wrap:nowrap}.card-head h3{font-size:14px;line-height:1.25;letter-spacing:-.02em;flex:1;overflow-wrap:anywhere}.card-head .icon{border:0;width:25px;height:24px;min-height:24px;color:var(--muted);padding:3px}.chart-body{padding:7px 14px 12px}.plot .viz{width:100%;max-height:310px;display:block;color:var(--ink)}.tall .viz{min-height:310px;max-height:500px}.viz [role=button]{cursor:pointer}.viz [role=button]:hover{filter:brightness(.9)}.legend{display:flex;flex-wrap:wrap;gap:5px 13px;font-size:11px;color:var(--muted);margin:4px 0}.legend>span{max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.legend i{display:inline-block;width:8px;height:8px;border-radius:3px;margin-right:5px}
.empty{padding:20px;color:var(--muted);text-align:center}.notice:not(:empty){padding:8px 12px;background:var(--soft);border-radius:6px;margin:4px 0 12px}.notice.error{color:var(--danger)}.source-line{padding:10px 14px;font-size:11px;color:var(--muted);border-top:1px solid var(--line)}
.panel{padding:15px;background:var(--card);border:1px solid var(--line);border-radius:9px}
.dialog-bg{position:absolute;inset:0;z-index:2;background:#16192755;display:grid;place-items:center;padding:16px}
.dialog{width:min(595px,100%);max-height:90%;display:flex;flex-direction:column;gap:14px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px;box-shadow:0 12px 54px #0002}.dialog>.row{justify-content:space-between}.dialog h2{font-size:20px}.dialog-content{overflow:auto;min-height:0}.dialog-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:7px}.edit-form,.filter-editor,.menu-list,.detail{display:grid;gap:10px}.menu-list button{justify-content:flex-start}.field{display:grid;gap:4px;min-width:0;font-size:12px;color:var(--muted)}.field input,.field select{width:100%;font-size:13px;color:var(--ink)}.editor-row{align-items:end;margin:4px 0}.editor-row .field{flex:1;min-width:85px}.rule{display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin:7px 0}.rule>select,.rule-values{flex:1;min-width:100px}.rule-values{display:flex;gap:3px}.rule-values>*{width:100%;min-width:0}.group,.edit-form fieldset{border:1px solid var(--line);border-radius:7px;margin:4px 0;padding:8px;min-width:0}.group .group{margin-left:8px}.edit-form legend{font-weight:600}.measure-line{display:flex;align-items:end;gap:6px}.measure-line>.editor-row{flex:1}
.table-tools{justify-content:space-between;margin:0 0 9px}.table-viewport,.pivot-scroll{overflow:auto;position:relative}.table-viewport{height:clamp(240px,56vh,650px);overflow-anchor:none}.table-viewport.compact{height:230px}.records,.pivot-table{border-collapse:separate;border-spacing:0;width:100%;font-size:12px}.records th,.records td,.pivot-table th,.pivot-table td{padding:5px 9px;white-space:nowrap;border-bottom:1px solid var(--line);text-align:left;max-width:250px;overflow:hidden;text-overflow:ellipsis}.records th,.pivot-table th{background:var(--base);font-weight:600}.records thead th{position:sticky;top:0;z-index:1}.records tbody tr:not(.spacer){height:33px;cursor:pointer}.records tbody tr:hover{background:var(--soft)}.records td{height:33px}.records .spacer td{padding:0;border:0;line-height:0}.th-button,.cell-button{color:var(--ink);min-height:20px;padding:0 2px;font-size:inherit}.cell-button{width:100%;justify-content:flex-end}.pivot-table td{text-align:right}.total{font-weight:700}.measure-label{display:block;font-size:10px;font-weight:400}.pager{justify-content:flex-end;margin-top:8px}
.detail{grid-template-columns:minmax(80px,1fr) minmax(0,2fr)}.detail dt{color:var(--muted)}.detail dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}.shell{position:relative}.shell[aria-busy=true] .notice:empty:after{content:'…'}.dialog .error{color:var(--danger);margin:6px 0}
@media(max-width:850px){.layout{grid-template-columns:165px minmax(0,1fr)}.sidebar{padding:15px 8px}.grid{gap:9px}.main{padding:16px}.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.top-meta{display:none}}
@media(max-width:690px){.layout{display:flex;flex-direction:column}.sidebar{padding:6px 10px;border-right:0;border-bottom:1px solid var(--line);flex:none;max-height:40vh}.sidebar>.side-title,.sidebar .source-line{display:none}.sidebar .nav{flex-direction:row;flex-wrap:wrap;margin:0}.sidebar .nav button{padding:5px;font-size:12px}.sidebar .side-section{display:inline-block;padding:3px;border:0;margin:0}.sidebar .side-section .hint,.sidebar .side-section .side-title{display:none}.main{flex:1;padding:12px}.grid{grid-template-columns:minmax(0,1fr)}.wide{grid-column:auto}.top{padding:0 10px;gap:6px;height:44px}.top-divider,.top-meta{display:none}.backdrop{padding:0}.backdrop .shell{height:100%;border-radius:0}.heading{gap:7px}.toolbar{gap:4px}.toolbar button{font-size:12px}.kpis{gap:7px}.kpi{padding:10px}.rule>select,.rule-values{min-width:75px}.brand{font-size:14px}}
@media print{.top,.sidebar,.toolbar,.icon,.source-line,.dialog-bg,.table-tools,.notice{display:none!important}.backdrop,.embedded,.shell,.layout,.main{position:static!important;height:auto!important;max-height:none!important;overflow:visible!important;display:block!important;padding:0!important}.widget{break-inside:avoid}.grid{display:block}.widget{margin-bottom:8px}}

.shell:focus{outline:none}.backdrop::backdrop{background:transparent}
`;

  // src/components/studio.js
  var tabLabels = { dashboard: "Дашборд", objects: "Объекты", pivot: "Сводная", periods: "Периоды" };
  var tabIcons = { dashboard: "grid", objects: "table", pivot: "pivot", periods: "clock" };
  var clone = (v) => JSON.parse(JSON.stringify(v));
  var listRules = (n) => !n ? [] : n.rules ? n.rules.flatMap(listRules) : [n];
  var Studio = class {
    constructor(cfg, options, onClose) {
      this.cfg = cfg;
      this.options = options;
      this.onClose = onClose;
      this.t = (s) => typeof options.messages?.[s] === "string" && own(options.messages, s) ? options.messages[s] : s;
      this.fmt = formatter(cfg.locale);
      this.tab = "dashboard";
      this.side = true;
      this.full = !!options.fullscreen;
      this.terms = [];
      this.extra = [];
      this.depth = /* @__PURE__ */ new Map();
      this.tableQuery = {};
      this.session = new Session();
      this.report = (e) => {
        if (!this.closed && e?.name !== "AbortError") {
          this.notice.textContent = e?.message || String(e);
          this.notice.classList.add("error");
        }
      };
      this.oldFocus = document.activeElement;
      this.host = document.createElement("div");
      this.host.setAttribute("data-nsd-analytics", "studio");
      this.root = this.host.attachShadow({ mode: "open" });
      const style = el("style");
      if (options.nonce) style.nonce = options.nonce;
      style.textContent = studio_default;
      this.root.append(style);
      this.wrap = el(options.mount ? "div" : "dialog", options.mount ? "embedded" : "backdrop");
      this.shell = el("section", "shell");
      this.shell.tabIndex = -1;
      this.shell.setAttribute("aria-label", "NSD Analytics Studio");
      this.top = el("header", "top");
      this.layout = el("div", "layout");
      this.sidebar = el("aside", "sidebar");
      this.main = el("main", "main");
      this.heading = el("div", "heading");
      this.notice = el("div", "notice");
      this.notice.setAttribute("role", "status");
      this.content = el("div");
      this.main.append(this.heading, this.notice, this.content);
      this.layout.append(this.sidebar, this.main);
      this.shell.append(this.top, this.layout);
      this.wrap.append(this.shell);
      this.root.append(this.wrap);
      (options.mount || document.body).append(this.host);
      if (!options.mount) {
        this.wrap.showModal();
        this.wrap.oncancel = (e) => {
          e.preventDefault();
          this.popup ? this.dismiss() : this.onClose();
        };
      }
      this.shell.onkeydown = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          this.popup ? this.dismiss() : this.onClose();
        } else if (e.key === "Tab" && this.popup) {
          const focus = [...this.popup.querySelectorAll('button:not(:disabled),input,select,textarea,[tabindex="0"]')].filter((n) => n.offsetParent !== null);
          if (!focus.length) return;
          if (e.shiftKey && this.root.activeElement === focus[0]) {
            e.preventDefault();
            focus[focus.length - 1].focus();
          } else if (!e.shiftKey && this.root.activeElement === focus[focus.length - 1]) {
            e.preventDefault();
            focus[0].focus();
          }
        }
      };
      this.chrome();
      this.shell.focus();
    }
    btn(s, fn, cls = "", glyph, only = false) {
      return button(this.t(s), () => Promise.resolve().then(fn).catch(this.report), cls, glyph, only);
    }
    chrome() {
      const { t } = this;
      this.shell.classList.toggle("dark", this.cfg.theme === "dark");
      this.wrap.classList.toggle("full", this.full);
      this.sidebar.hidden = !this.side;
      this.layout.classList.toggle("noside", !this.side);
      this.top.replaceChildren();
      const logo = el("span", "logo");
      logo.append(el("i"), el("i"), el("i"));
      const brand = el("div", "brand");
      brand.append(logo, el("span", "", "NSD Analytics Studio"));
      this.top.append(
        this.btn("Показать или скрыть меню", () => {
          this.side = !this.side;
          this.chrome();
        }, "icon", "menu", true),
        brand,
        el("span", "top-divider"),
        el("span", "top-meta", t("Рабочая область")),
        el("span", "spacer-flex"),
        this.btn("Переключить тему", () => {
          this.cfg.theme = this.cfg.theme === "dark" ? "light" : "dark";
          this.chrome();
        }, "icon", "sun", true),
        this.btn("На весь экран", async () => {
          if (this.options.mount) {
            if (document.fullscreenElement) await document.exitFullscreen();
            else await this.host.requestFullscreen();
          } else {
            this.full = !this.full;
            this.chrome();
          }
        }, "icon", "expand", true),
        this.btn("Закрыть", this.onClose, "icon", "close", true)
      );
      this.sidebar.replaceChildren(el("p", "side-title", t("Рабочая область")));
      const nav = el("nav", "nav");
      for (const [k, name2] of Object.entries(tabLabels)) {
        const b = this.btn(name2, () => {
          this.tab = k;
          this.draw();
        }, k === this.tab ? "active" : "", tabIcons[k]);
        if (this.tab === k) b.setAttribute("aria-current", "page");
        nav.append(b);
      }
      this.sidebar.append(nav);
      const section = el("div", "side-section");
      section.append(el("p", "side-title", t("Глобальные фильтры")));
      const rules = listRules(this.cfg.filter);
      for (const rule of rules.slice(0, 3)) section.append(el("span", "filter-chip", this.col(rule.field)?.title + " · " + rule.op));
      if (!rules.length && !this.terms.length && !this.extra.length) section.append(el("small", "hint", t("Все объекты выборки")));
      if (this.terms.length || this.extra.length) section.append(el("span", "filter-chip", t("Выбор на диаграмме")));
      section.append(this.btn("Настроить фильтры", () => this.editFilter(), "", "filter"));
      if (rules.length || this.terms.length || this.extra.length) section.append(this.btn("Сбросить фильтры", () => {
        this.cfg.filter = null;
        this.terms = [];
        this.extra = [];
        this.depth.clear();
        this.draw();
      }, "link"));
      const tools = el("div", "side-section");
      tools.append(el("p", "side-title", t("Представление")), this.btn("Шаблоны дашбордов", () => this.templates(), "link", "layers"));
      this.sidebar.append(section, tools);
    }
    col(code2) {
      return this.columns?.find((c) => c.code === code2);
    }
    async load(rows) {
      this.shell.setAttribute("aria-busy", "true");
      this.notice.textContent = this.t("Подготовка данных");
      const result = await this.session.load(rows, this.cfg, this.options, (n, total) => {
        this.notice.textContent = this.t("Подготовка данных") + " · " + this.fmt(n) + " / " + this.fmt(total);
      });
      if (this.closed) return;
      this.columns = result.columns;
      this.count = result.count;
      this.edit = editors(this.columns, this.t);
      makeDefaults(this.cfg, this.columns);
      this.notice.textContent = "";
      return this.draw();
    }
    query(filters = [], terms = []) {
      return { filters: [this.cfg.filter, ...this.extra, ...filters].filter(Boolean), terms: [...this.terms, ...terms] };
    }
    async draw() {
      if (!this.columns || this.closed) return;
      this.session.cancel(this.token);
      const token = this.token = { cancelled: false };
      this.pivotResult = null;
      this.dismiss(false);
      this.chrome();
      this.content.replaceChildren();
      this.heading.replaceChildren();
      this.notice.textContent = "";
      this.notice.classList.remove("error");
      this.shell.setAttribute("aria-busy", "true");
      const title = el("div"), meta = el("small");
      title.append(el("h1", "", this.tab === "dashboard" ? this.cfg.title : this.t(tabLabels[this.tab])), meta);
      const tools = el("div", "toolbar");
      this.heading.append(title, tools);
      if (this.tab === "dashboard") tools.append(this.btn("Добавить виджет", () => this.editWidget(null), "primary", "plus"));
      if (this.tab === "pivot") tools.append(this.btn("Настроить сводную", () => this.editPivot(), "primary", "settings"));
      tools.append(this.btn("Экспорт", () => this.exportMenu(), "", "download"));
      const query = this.query();
      try {
        const count = await this.session.run("size", query, token);
        if (token.cancelled) return;
        meta.append(icon("database"), document.createTextNode(this.fmt(count) + " / " + this.fmt(this.count) + " " + this.t("объектов")));
        if (this.tab === "dashboard") await this.dashboard(token);
        else if (this.tab === "objects") {
          this.tableQuery = { ...this.tableQuery, ...query };
          const panel = el("div", "panel");
          this.content.append(panel);
          await objectTable(this, panel, this.tableQuery, token);
        } else if (this.tab === "pivot") {
          const p = this.cfg.pivot, panel = el("div", "panel");
          this.content.append(panel);
          const result = await this.session.run("pivot", { ...this.query([p.filter]), spec: p }, token);
          if (token.cancelled) return;
          this.pivotResult = result;
          pivotTable(this, panel, result, p, (terms) => this.drill(terms, [p.filter], true));
        } else await this.periods(token);
      } catch (e) {
        this.report(e);
      } finally {
        if (!token.cancelled) this.shell.setAttribute("aria-busy", "false");
      }
    }
    async dashboard(token) {
      const kpis = el("div", "kpis"), grid2 = el("div", "grid");
      if (this.cfg.widgets.some((w) => w.type === "kpi")) this.content.append(kpis);
      if (this.cfg.widgets.some((w) => w.type !== "kpi")) this.content.append(el("h2", "section-head", this.t("Распределение и динамика")), grid2);
      if (!this.cfg.widgets.length) this.content.append(el("p", "empty", this.t("Добавьте первый виджет")));
      for (const w of this.cfg.widgets) {
        if (token.cancelled) return;
        const kpi = w.type === "kpi", card = el("article", "widget" + (kpi ? " kpi" : "") + (w.span === 2 ? " wide" : "") + (w.height === 2 ? " tall" : ""));
        card.dataset.widget = w.id;
        const head = el("div", "card-head");
        head.append(el("h3", "", w.title), this.btn("Настройки · " + w.title, () => this.widgetMenu(w, card), "icon", "dot", true));
        const body = el("div", kpi ? "kpi-body" : "chart-body");
        card.append(head, body);
        (kpi ? kpis : grid2).append(card);
        const filters = [w.filter], q = this.query(filters);
        try {
          if (w.type === "table") {
            await objectTable(this, body, q, token, true);
            continue;
          }
          const spec = chartQuery(w, this.depth.get(w.id) || 0), matrix = ["pivot", "heatmap", "stacked"].includes(w.type);
          if (["heatmap", "stacked"].includes(w.type) && w.dims.length < 2) {
            body.append(el("p", "empty", this.t("Выберите два измерения")));
            continue;
          }
          const p = matrix ? widgetPivot(w) : null;
          const result = matrix ? await this.session.run("pivot", { ...q, spec: p }, token) : await this.session.run("chart", { ...q, w: kpi ? { ...spec, dims: [] } : spec }, token);
          if (token.cancelled) return;
          if (kpi) {
            const val = el("strong", "", this.fmt(result.total)), unit = this.col(w.measure.field)?.unit;
            if (unit && !["count", "distinct"].includes(w.measure.op)) val.append(el("span", "unit", unit));
            body.append(val, el("small", "hint", this.t(opNames[w.measure.op])));
            val.tabIndex = 0;
            val.setAttribute("role", "button");
            val.onclick = () => this.drill([], filters, true);
            val.onkeydown = (e) => {
              if (e.key === "Enter") val.click();
            };
          } else if (w.type === "pivot") pivotTable(this, body, result, p, (terms) => this.drill(terms, filters, true), true);
          else body.append(chart(result, spec, { fmt: this.fmt, t: this.t, choose: (g) => {
            if (g.id !== void 0) {
              this.detail(g.id);
              return;
            }
            this.pick(w, g);
          } }));
        } catch (e) {
          if (e.name !== "AbortError") body.replaceChildren(el("p", "empty", e.message));
        }
      }
    }
    drill(terms, filters, openObjects) {
      this.terms.push(...terms);
      this.extra.push(...filters.filter(Boolean));
      this.tableQuery = {};
      if (openObjects) this.tab = "objects";
      this.draw();
    }
    pick(w, g) {
      const items = [
        [this.t("Фильтровать дашборд"), () => this.drill(g.terms || [], [w.filter], false)],
        [this.t("Показать исходные объекты"), () => this.drill(g.terms || [], [w.filter], true)]
      ];
      const n = this.depth.get(w.id) || 0;
      if (n + 1 < w.dims.length && !["stacked", "heatmap", "scatter", "box", "histogram"].includes(w.type)) items.push([this.t("Следующий уровень"), () => {
        this.depth.set(w.id, n + 1);
        this.drill(g.terms || [], [], false);
      }]);
      this.menu(g.path?.map((p) => p.text).join(" / ") || w.title, items);
    }
    async detail(id) {
      try {
        const row = await this.session.run("detail", { id }, this.token);
        if (!row || this.closed) return;
        const dl = el("dl", "detail");
        for (const c of this.columns) dl.append(el("dt", "", c.title), el("dd", "", this.fmt(field(row, c.code), c)));
        const url = safeUrl(field(row, this.options.urlField || "url"), document.baseURI);
        const actions = [];
        if (this.options.onOpenObject || url) actions.push(this.btn("Открыть карточку", () => {
          if (this.options.onOpenObject) this.options.onOpenObject(row);
          else window.open(url, "_blank", "noopener,noreferrer");
        }, "primary", "arrow"));
        this.dialog(this.t("Исходный объект"), dl, actions);
      } catch (e) {
        this.report(e);
      }
    }
    dialog(title, node, actions = []) {
      this.dismiss(false);
      this.focusBefore = this.root.activeElement;
      const bg = el("div", "dialog-bg"), box = el("section", "dialog");
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      box.setAttribute("aria-label", title);
      const head = el("div", "row");
      head.append(el("h2", "", title), this.btn("Закрыть окно", () => this.dismiss(), "icon", "close", true));
      const content = el("div", "dialog-content");
      content.append(node);
      const foot = el("div", "dialog-actions");
      foot.append(...actions);
      box.append(head, content, foot);
      bg.append(box);
      this.shell.append(bg);
      this.popup = bg;
      this.layout.inert = true;
      this.top.inert = true;
      head.querySelector("button").focus();
    }
    dismiss(focus = true) {
      if (!this.popup) return;
      this.popup.remove();
      this.popup = null;
      this.layout.inert = false;
      this.top.inert = false;
      if (focus && this.focusBefore?.isConnected) this.focusBefore.focus();
      this.focusBefore = null;
    }
    form(title, editor, save) {
      const error = el("p", "error");
      error.setAttribute("role", "alert");
      editor.node.append(error);
      const apply = this.btn("Применить", () => {
        try {
          const previous = this.exportConfig();
          try {
            save(editor.read());
            config(this.cfg);
          } catch (e) {
            this.cfg = previous;
            throw e;
          }
          this.dismiss();
          this.draw();
        } catch (e) {
          error.textContent = e.message;
        }
      }, "primary", "check");
      this.dialog(this.t(title), editor.node, [this.btn("Отмена", () => this.dismiss()), apply]);
    }
    menu(title, items) {
      const list2 = el("div", "menu-list");
      for (const [name2, action] of items) list2.append(button(name2, () => {
        this.dismiss();
        Promise.resolve().then(action).catch(this.report);
      }));
      this.dialog(title, list2);
    }
    editFilter() {
      if (this.edit) this.form("Глобальные фильтры", this.edit.filter(this.cfg.filter), (v) => {
        this.cfg.filter = filterTree(v);
      });
    }
    editPivot() {
      this.form("Настроить сводную", this.edit.pivotEditor(this.cfg.pivot), (v) => {
        this.cfg.pivot = pivotSpec(v);
        this.cfg.autoPivot = false;
      });
    }
    editWidget(w) {
      const init = w || widget({ id: "w" + Date.now().toString(36), title: this.t("Новый виджет"), dims: this.columns.length ? [this.columns[0].code] : [] });
      this.form(w ? "Настроить виджет" : "Добавить виджет", this.edit.widgetEditor(init), (v) => {
        const entry = widget(v);
        if (w) this.cfg.widgets[this.cfg.widgets.indexOf(w)] = entry;
        else {
          check(this.cfg.widgets.length < LIMIT.widgets, "Достигнут лимит виджетов");
          this.cfg.widgets.push(entry);
        }
        this.depth.delete(entry.id);
      });
    }
    widgetMenu(w, card) {
      const arr = this.cfg.widgets, i = arr.indexOf(w), items = [[this.t("Настроить виджет"), () => this.editWidget(w)]];
      function swap(a, b) {
        [arr[a], arr[b]] = [arr[b], arr[a]];
      }
      if (i > 0) items.push([this.t("Переместить выше"), () => {
        swap(i, i - 1);
        this.draw();
      }]);
      if (i < arr.length - 1) items.push([this.t("Переместить ниже"), () => {
        swap(i, i + 1);
        this.draw();
      }]);
      items.push([this.t("Показать исходные объекты"), () => this.drill([], [w.filter], true)]);
      const svg2 = card.querySelector("svg.viz");
      if (svg2) items.push(["SVG", () => download(new Blob([svgText(svg2)], { type: formats.svg }), "chart.svg")], ["PNG", async () => download(await pngBlob(svg2), "chart.png")]);
      items.push([this.t("Удалить виджет"), () => {
        arr.splice(i, 1);
        this.draw();
      }]);
      this.menu(w.title, items);
    }
    exportConfig() {
      return clone(this.cfg);
    }
    importConfig(raw) {
      const next = config(raw);
      if (next.columns.length) {
        const known2 = new Set(this.columns.map((c) => c.code));
        check(next.columns.every((c) => known2.has(c.code)), "Шаблон содержит неизвестные колонки");
      }
      next.columns = this.cfg.columns;
      next.includeUnlisted = this.cfg.includeUnlisted;
      const known = new Set(this.columns.map((c) => c.code));
      const fieldCheck = (k) => {
        if (k) check(known.has(k), "Шаблон использует недоступное поле: " + k);
      };
      function checkFilter(n) {
        for (const r of listRules(n)) fieldCheck(r.field);
      }
      for (const w of next.widgets) {
        w.dims.forEach((d) => fieldCheck(d.field));
        fieldCheck(w.measure.field);
        fieldCheck(w.x);
        fieldCheck(w.y);
        checkFilter(w.filter);
      }
      [...next.pivot.rows, ...next.pivot.cols].forEach((d) => fieldCheck(d.field));
      next.pivot.measures.forEach((m) => fieldCheck(m.field));
      checkFilter(next.pivot.filter);
      checkFilter(next.filter);
      this.cfg = next;
      this.fmt = formatter(next.locale);
      this.terms = [];
      this.extra = [];
      this.depth.clear();
      this.tableQuery = {};
      return this.draw();
    }
    templates() {
      const key = storageKey(this.options.storageKey);
      const items = [
        [this.t("Скачать шаблон JSON"), () => download(new Blob([JSON.stringify(this.cfg, null, 2)], { type: formats.json }), "dashboard.json")],
        [this.t("Импортировать шаблон JSON"), () => {
          const f = input("", "file");
          f.accept = ".json,application/json";
          f.onchange = async () => {
            try {
              const file = f.files[0];
              if (!file) return;
              check(file.size <= LIMIT.config, "Файл конфигурации слишком большой");
              const raw = await file.text();
              if (!this.closed) await this.importConfig(raw);
            } catch (e) {
              this.report(e);
            }
          };
          f.click();
        }]
      ];
      if (key) items.push([this.t("Сохранить в этом браузере"), () => {
        const allowed = new Set(this.options.persistFilterFields || []);
        const filters = [this.cfg.filter, this.cfg.pivot.filter, ...this.cfg.widgets.map((w) => w.filter)];
        check(filters.flatMap(listRules).every((r) => r.value == null || allowed.has(r.field)), "Хост не разрешил локальное хранение значений этих фильтров");
        localStorage.setItem(key, JSON.stringify(this.cfg));
        this.notice.textContent = this.t("Шаблон сохранён");
      }], [this.t("Восстановить из браузера"), () => {
        const raw = localStorage.getItem(key);
        check(raw, "Сохранённого шаблона нет");
        return this.importConfig(raw);
      }]);
      this.menu(this.t("Шаблоны дашбордов"), items);
    }
    async periods(token) {
      const panel = el("div", "panel edit-form"), dates = this.columns.filter((c) => c.type === "date");
      this.content.append(panel);
      if (!dates.length) {
        panel.append(el("p", "empty", this.t("Для сравнения требуется колонка даты")));
        return;
      }
      const date = select(dates.map((c) => [c.code, c.title])), m = select(Object.entries(opNames)), f = select([["", this.t("Все строки")], ...this.columns.map((c) => [c.code, c.title])]);
      const controls = el("div", "editor-row");
      controls.append(control(this.t("Дата"), date), control(this.t("Функция"), m), control(this.t("Значения"), f));
      panel.append(controls);
      const now = /* @__PURE__ */ new Date(), day = 864e5, iso = (x) => new Date(x).toISOString().slice(0, 10);
      const inputs = [-27, -14, -13, 0].map((d) => input(iso(+now + d * day), "date")), range = el("div", "editor-row");
      ["Предыдущий с", "Предыдущий по", "Текущий с", "Текущий по"].forEach((s, i) => range.append(control(this.t(s), inputs[i])));
      panel.append(range);
      const out = el("div", "notice");
      panel.append(this.btn("Сравнить периоды", async () => {
        const v = inputs.map((i) => i.value);
        check(v.every(Boolean) && v[0] <= v[1] && v[2] <= v[3], "Проверьте границы периодов");
        const r = await this.session.run("periods", { ...this.query(), previous: v.slice(0, 2), current: v.slice(2), field: date.value, measure: measure({ op: m.value, field: f.value }) }, token);
        if (!token.cancelled) out.textContent = this.t("Предыдущий") + " " + this.fmt(r.previous) + "  ·  " + this.t("Текущий") + " " + this.fmt(r.current) + "  ·  Δ " + this.fmt(r.change) + "  ·  " + this.fmt(r.percent) + " %";
      }, "primary"), out);
    }
    exportMenu() {
      const { t } = this, items = [], token = this.token;
      for (const [format, name2] of [["csv", "CSV"], ["tsv", "TSV"], ["json", "JSON"], ["html", "HTML"], ["copy", "Копировать для Excel"]]) {
        items.push([t(name2), async () => {
          const copy = format === "copy", kind = copy ? "tsv" : format;
          let blob;
          if (this.tab === "pivot" && this.pivotResult) {
            const m = pivotMatrix(this.pivotResult, this.cfg.pivot, this.fmt, t);
            const str = kind === "json" ? JSON.stringify({ columns: m.headers, rows: m.rows }) : encodeTable(m.headers, m.rows, kind, this.cfg.title, copy);
            blob = new Blob([!copy && ["csv", "tsv"].includes(kind) ? "\uFEFF" : "", str], { type: formats[kind] });
            check(blob.size <= LIMIT.exportBytes, "Слишком большой экспорт");
          } else if (kind === "html" && this.tab === "dashboard") {
            blob = new Blob([await this.dashboardReport(token)], { type: formats.html });
          } else {
            const q = this.tab === "objects" ? this.tableQuery : this.query();
            blob = await exportRows(this.session, q, this.columns, kind, this.cfg.title, token, copy);
          }
          if (token.cancelled) return;
          if (copy) {
            check(navigator.clipboard?.writeText, "Буфер обмена недоступен. Используйте TSV.");
            await navigator.clipboard.writeText(await blob.text());
            this.notice.textContent = t("Скопировано");
          } else download(blob, "analytics." + kind);
        }]);
      }
      items.push([t("Печать отчёта"), () => this.print()]);
      this.menu(t("Экспорт"), items);
    }
    async dashboardReport(token) {
      let body = "", bytes = 0;
      const encoder = new TextEncoder();
      for (const card of this.content.querySelectorAll(".widget")) {
        const w = this.cfg.widgets.find((v) => v.id === card.dataset.widget);
        const svg2 = card.querySelector(".viz");
        let content;
        if (svg2) content = svgText(svg2);
        else if (w.type === "table" || w.type === "pivot") {
          const q = this.query([w.filter]);
          let html;
          if (w.type === "table") html = await (await exportRows(this.session, q, this.columns, "html", w.title, token)).text();
          else {
            const spec = widgetPivot(w), result = await this.session.run("pivot", { ...q, spec }, token);
            const m = pivotMatrix(result, spec, this.fmt, this.t);
            html = encodeTable(m.headers, m.rows, "html", w.title);
          }
          content = html.slice(html.indexOf("<table>"), html.lastIndexOf("</table>") + 8);
        } else content = "<p>" + escapeHtml(card.querySelector(".kpi-body,.chart-body")?.textContent) + "</p>";
        const section = "<section><h2>" + escapeHtml(w.title) + "</h2>" + content + "</section>";
        bytes += encoder.encode(section).length;
        check(bytes <= LIMIT.exportBytes, "Отчёт превышает 32 МиБ. Сузьте выборку.");
        body += section;
      }
      return reportPage(this.cfg.title, body);
    }
    print() {
      const frame = el("iframe");
      frame.title = this.t("Печать отчёта");
      frame.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0";
      const token = this.token;
      const run = async () => {
        let content;
        if (this.tab === "dashboard") {
          content = await this.dashboardReport(token);
        } else if (this.tab === "pivot" && this.pivotResult) {
          const m = pivotMatrix(this.pivotResult, this.cfg.pivot, this.fmt, this.t);
          content = encodeTable(m.headers, m.rows, "html", this.cfg.title);
        } else content = await (await exportRows(this.session, this.tab === "objects" ? this.tableQuery : this.query(), this.columns, "html", this.cfg.title, token)).text();
        if (token.cancelled) return;
        frame.onload = () => {
          const win = frame.contentWindow;
          win.onafterprint = () => frame.remove();
          win.focus();
          win.print();
        };
        frame.srcdoc = content;
        this.shell.append(frame);
      };
      return run();
    }
    dispose() {
      this.closed = true;
      this.session.cancel(this.token);
      this.session.dispose();
      this.host.remove();
      this.columns = null;
      this.pivotResult = null;
      if (this.oldFocus?.isConnected) this.oldFocus.focus();
    }
  };

  // src/adapters/nsd.js
  var current;
  function close() {
    if (current) {
      current.dispose();
      current = null;
    }
  }
  function split(options) {
    check(plain(options), "Некорректная конфигурация");
    const { mount, onOpenObject, storageKey: storageKey2, persistFilterFields, worker, fullscreen, urlField, messages, nonce, ...settings } = options;
    if (mount != null) check(mount instanceof Element, "mount должен быть DOM-элементом");
    if (onOpenObject != null) check(typeof onOpenObject === "function", "Некорректный callback");
    const cfg = config(settings);
    return { cfg, host: { mount, onOpenObject, storageKey: storageKey2, persistFilterFields, worker, fullscreen, urlField, messages, nonce } };
  }
  async function launch(data, cfg, host) {
    check(Array.isArray(data), "Ожидается массив объектов");
    close();
    const instance = new Studio(cfg, host, close);
    current = instance;
    try {
      await instance.load(data);
      return instance.closed ? null : { count: instance.count, mode: instance.session.mode };
    } catch (e) {
      if (instance.closed && e.name === "AbortError") return null;
      instance.report(e);
      instance.shell.setAttribute("aria-busy", "false");
      instance.session.dispose();
      throw e;
    }
  }
  var api = Object.freeze({
    version: "0.1.0",
    open(data, options = {}) {
      const { cfg, host } = split(options);
      return launch(data, cfg, host);
    },
    update(data) {
      check(current, "Сначала откройте аналитику");
      return launch(data, current.exportConfig(), current.options);
    },
    close,
    destroy: close,
    exportConfig() {
      check(current, "Аналитика закрыта");
      return current.exportConfig();
    },
    importConfig(value) {
      check(current?.columns, "Дождитесь загрузки данных");
      return current.importConfig(value);
    }
  });
  if (!window.NSDAnalytics || window.NSDAnalytics.version !== api.version) window.NSDAnalytics = api;
})();
