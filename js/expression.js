const cache = new Map();

function jif(c, a, b) {
  return c ? a : b;
}

function bit(v) {
  return (v | 0);
}

function isBitSet(v, b) {
  return (bit(v) & (1 << b)) !== 0 ? 1 : 0;
}

function SetBit(v, b) {
  return bit(v) | (1 << b);
}

function ClearBit(v, b) {
  return bit(v) & ~(1 << b);
}

function SetBitValue(v, b, bv) {
  return bv > 0 ? (bit(v) | (1 << b)) : (bit(v) & ~(1 << b));
}

const helpers = {
  jif,
  isBitSet,
  SetBit,
  ClearBit,
  SetBitValue,
};

function transform(expr) {
  let s = expr;
  s = s.replace(/\bR(\d+)\b/g, 'P[$1]');
  s = s.replace(/\bif\s*\(/g, 'jif(');
  s = s.replace(/\bisBitSet\s*\(/g, 'isBitSet(');
  s = s.replace(/\bSetBitValue\s*\(/g, 'SetBitValue(');
  s = s.replace(/\bSetBit\s*\(/g, 'SetBit(');
  s = s.replace(/\bClearBit\s*\(/g, 'ClearBit(');
  s = s.replace(/\bpi\b/g, 'Math.PI');
  s = s.replace(/\babs\s*\(/g, 'Math.abs(');
  s = s.replace(/\bsqrt\s*\(/g, 'Math.sqrt(');
  s = s.replace(/\batan2\s*\(/g, 'Math.atan2(');
  s = s.replace(/\basin\s*\(/g, 'Math.asin(');
  s = s.replace(/\bacos\s*\(/g, 'Math.acos(');
  s = s.replace(/\batan\s*\(/g, 'Math.atan(');
  s = s.replace(/\bsin\s*\(/g, 'Math.sin(');
  s = s.replace(/\bcos\s*\(/g, 'Math.cos(');
  s = s.replace(/\btan\s*\(/g, 'Math.tan(');
  s = s.replace(/\bfloor\s*\(/g, 'Math.floor(');
  s = s.replace(/\bceil\s*\(/g, 'Math.ceil(');
  s = s.replace(/\bround\s*\(/g, 'Math.round(');
  s = s.replace(/\bexp\s*\(/g, 'Math.exp(');
  s = s.replace(/\bln\s*\(/g, 'Math.log(');
  s = s.replace(/\blog\s*\(/g, 'Math.log10(');
  s = s.replace(/\bmin\s*\(/g, 'Math.min(');
  s = s.replace(/\bmax\s*\(/g, 'Math.max(');
  s = s.replace(/\bpow\s*\(/g, 'Math.pow(');
  s = s.replace(/\^/g, '**');
  return s;
}

export function compile(expr) {
  if (expr === null || expr === undefined) return null;
  const key = String(expr);
  if (!key.trim()) return null;
  if (cache.has(key)) return cache.get(key);
  const js = transform(key);
  let fn = null;
  try {
    fn = new Function('P', 'x', 'jif', 'isBitSet', 'SetBit', 'ClearBit', 'SetBitValue', `"use strict";return (${js});`);
  } catch (err) {
    for (let i = 1; i <= 4 && !fn; i++) {
      try {
        fn = new Function('P', 'x', 'jif', 'isBitSet', 'SetBit', 'ClearBit', 'SetBitValue', `"use strict";return (${js}${')'.repeat(i)});`);
      } catch (e) {
        fn = null;
      }
    }
    if (!fn) {
      console.warn('Formula compile failed', key, err);
      fn = () => 0;
    }
  }
  cache.set(key, fn);
  return fn;
}

export function evaluate(expr, P, x = 0) {
  const fn = compile(expr);
  if (!fn) return 0;
  try {
    let v = fn(P, x, helpers.jif, helpers.isBitSet, helpers.SetBit, helpers.ClearBit, helpers.SetBitValue);
    if (typeof v === 'boolean') v = v ? 1 : 0;
    if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
    return v;
  } catch (err) {
    return 0;
  }
}

export function evaluateFn(fn, P, x = 0) {
  if (!fn) return 0;
  try {
    let v = fn(P, x, helpers.jif, helpers.isBitSet, helpers.SetBit, helpers.ClearBit, helpers.SetBitValue);
    if (typeof v === 'boolean') v = v ? 1 : 0;
    if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
    return v;
  } catch (err) {
    return 0;
  }
}

export function references(expr) {
  const out = new Set();
  if (!expr) return out;
  const re = /\bR(\d+)\b/g;
  let m;
  while ((m = re.exec(expr))) out.add(Number(m[1]));
  return out;
}

export function formatValue(value, fraction) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  if (!fraction || fraction <= 0) return String(Math.round(n));
  return n.toFixed(fraction);
}
