export function child(el, name) {
  if (!el) return null;
  for (let n = el.firstElementChild; n; n = n.nextElementSibling) {
    if (n.localName === name) return n;
  }
  return null;
}

export function children(el, name) {
  const out = [];
  if (!el) return out;
  for (let n = el.firstElementChild; n; n = n.nextElementSibling) {
    if (!name || n.localName === name) out.push(n);
  }
  return out;
}

export function attr(el, name, fallback = '') {
  if (!el || !el.hasAttribute(name)) return fallback;
  return el.getAttribute(name);
}

export function num(el, name, fallback = 0) {
  const v = attr(el, name, '');
  if (v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function bool(el, name, fallback = false) {
  const v = attr(el, name, '').toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fallback;
}

export function text(el, fallback = '') {
  if (!el) return fallback;
  const t = el.getAttribute('Text');
  if (t !== null && t !== '') return t;
  const v = el.getAttribute('Value');
  return v !== null ? v : fallback;
}

export function direct(el, name) {
  return child(el, name);
}
