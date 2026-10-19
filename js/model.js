export const SERIAL_SOURCE = 1;

export class ParameterStore {
  constructor(params) {
    this.byId = new Map();
    this.values = new Float64Array(1000);
    this.paramListeners = new Map();
    this.allListeners = new Set();
    for (const p of params) {
      this.byId.set(p.id, p);
      this.values[p.id] = this.clamp(p, p.value);
    }
  }

  clamp(p, value) {
    let v = Math.round(Number(value));
    if (!Number.isFinite(v)) v = 0;
    if (v < p.min) v = p.min;
    if (v > p.max) v = p.max;
    return v;
  }

  get(id) {
    return this.values[id] || 0;
  }

  param(id) {
    return this.byId.get(id) || null;
  }

  allParams() {
    return [...this.byId.values()];
  }

  addAllListener(cb) {
    this.allListeners.add(cb);
    return () => this.allListeners.delete(cb);
  }

  addParamListener(ids, cb) {
    const set = ids instanceof Set ? ids : new Set(ids);
    for (const id of set) {
      if (!this.paramListeners.has(id)) this.paramListeners.set(id, new Set());
      this.paramListeners.get(id).add(cb);
    }
    return () => {
      for (const id of set) {
        const s = this.paramListeners.get(id);
        if (s) s.delete(cb);
      }
    };
  }

  set(id, value, sourceId = 0) {
    const p = this.byId.get(id);
    if (!p) return null;
    const v = this.clamp(p, value);
    this.values[id] = v;
    const adj = { parameter: id, value: v, sourceId };
    for (const l of [...this.allListeners]) {
      try { l(adj); } catch (err) { console.warn('all listener', err); }
    }
    const ls = this.paramListeners.get(id);
    if (ls) {
      for (const l of [...ls]) {
        try { l(adj); } catch (err) { console.warn('param listener', err); }
      }
    }
    return v;
  }

  resetDefaults(sourceId = 0) {
    for (const p of this.byId.values()) this.set(p.id, p.value, sourceId);
  }
}
