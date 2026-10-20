const SELECTOR = 'input.field-input, input[type="number"], input[inputmode="numeric"], input[inputmode="decimal"]';
const KEYS = ['7', '8', '9', 'BKSP', '4', '5', '6', 'UP', '1', '2', '3', 'DOWN', '.', '0', '-', 'DONE'];

let pad = null;
let target = null;
let buffer = '';
let editEl = null;
let hideTimer = null;
let hideEl = null;
let startValue = '';
let holdTimer = null;
let holdInterval = null;
let position = null;
let drag = null;

function tagField(el) {
  el.setAttribute('inputmode', 'none');
  el.setAttribute('readonly', '');
}

function tagAll(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll(SELECTOR).forEach(tagField);
}

function fireChange(el) {
  if (!el) return;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function commit(el) {
  if (!el) return;
  let num = Number.parseFloat(String(el.value).replace(',', '.'));
  if (!Number.isFinite(num)) num = 0;
  const min = el.getAttribute('min');
  const max = el.getAttribute('max');
  if (min !== null && min !== '') num = Math.max(Number.parseFloat(min), num);
  if (max !== null && max !== '') num = Math.min(Number.parseFloat(max), num);
  el.value = String(num);
  if (el.value !== startValue) {
    if (document.activeElement === el) el.blur();
    else fireChange(el);
  }
  startValue = el.value;
}

function markEditing(el) {
  if (editEl === el) return;
  if (editEl) editEl.classList.remove('rf-editing');
  editEl = el || null;
  if (editEl) editEl.classList.add('rf-editing');
}

function applyPosition() {
  if (!position || !pad) return;
  const w = pad.offsetWidth || 340;
  const h = pad.offsetHeight || 250;
  position.left = Math.max(2, Math.min(window.innerWidth - w - 2, position.left));
  position.bottom = Math.max(2, Math.min(window.innerHeight - h - 2, position.bottom));
  pad.style.left = `${position.left}px`;
  pad.style.bottom = `${position.bottom}px`;
}

function defaultPosition(el) {
  const w = pad.offsetWidth || 340;
  const rect = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
  const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  position = cx <= window.innerWidth / 2
    ? { left: window.innerWidth - w - 16, bottom: 12 }
    : { left: 16, bottom: 12 };
  applyPosition();
}

function restorePosition() {
  try {
    const raw = localStorage.getItem('kbar-numpad-pos');
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!saved || !Number.isFinite(saved.left) || !Number.isFinite(saved.bottom)) return false;
    position = saved;
    applyPosition();
    return true;
  } catch (err) { return false; }
}

function savePosition() {
  try { localStorage.setItem('kbar-numpad-pos', JSON.stringify(position)); } catch (err) {}
}

function showPad(el) {
  if (target && target !== el) commit(target);
  if (hideTimer && hideEl === el) { clearTimeout(hideTimer); hideTimer = null; hideEl = null; }
  target = el;
  markEditing(el);
  buffer = String(el.value == null ? '' : el.value);
  startValue = buffer;
  if (!pad.parentNode) document.body.appendChild(pad);
  pad.style.display = 'block';
  if (!position || !restorePosition()) defaultPosition(el);
  applyPosition();
}

function hidePad(doCommit, el) {
  stopHold();
  const t = el || target;
  if (t === target) { target = null; buffer = ''; markEditing(null); }
  if (doCommit && t) commit(t);
  if (!target) pad.style.display = 'none';
  if (hideEl === t) { clearTimeout(hideTimer); hideTimer = null; hideEl = null; }
}

function stepFor() {
  const attr = target.getAttribute ? target.getAttribute('step') : null;
  if (attr) {
    const value = Number.parseFloat(attr);
    if (Number.isFinite(value) && value > 0) return { value, decimals: (attr.split('.')[1] || '').length };
  }
  const current = Number.parseFloat(buffer);
  return Number.isFinite(current) && Math.abs(current % 1) > 1e-9
    ? { value: 0.1, decimals: 1 }
    : { value: 1, decimals: 0 };
}

function nudge(direction) {
  if (!target) return;
  const step = stepFor();
  let num = Number.parseFloat(buffer);
  if (!Number.isFinite(num)) num = 0;
  num += direction * step.value;
  const min = target.getAttribute('min');
  const max = target.getAttribute('max');
  if (min !== null && min !== '' && Number.isFinite(Number.parseFloat(min))) num = Math.max(Number.parseFloat(min), num);
  if (max !== null && max !== '' && Number.isFinite(Number.parseFloat(max))) num = Math.min(Number.parseFloat(max), num);
  num = Number.parseFloat(num.toFixed(Math.min(step.decimals, 2)));
  buffer = String(num);
  target.value = buffer;
  fireChange(target);
}

function press(key) {
  if (!target) return;
  if (key === 'UP') { nudge(1); return; }
  if (key === 'DOWN') { nudge(-1); return; }
  if (key === 'BKSP') buffer = buffer.slice(0, -1);
  else if (key === 'DONE') { hidePad(true); return; }
  else if (key === '.') { if (!buffer.includes('.')) buffer += '.'; }
  else buffer += key;
  target.value = buffer;
}

function stopHold() {
  if (holdTimer) clearTimeout(holdTimer);
  if (holdInterval) clearInterval(holdInterval);
  holdTimer = null;
  holdInterval = null;
}

function buildPad() {
  pad = document.createElement('div');
  pad.id = 'rf-numpad';
  pad.innerHTML = '<div class="rfnp-handle"><span></span></div><div class="rfnp-grid">' +
    KEYS.map((key) => {
      const label = key === 'BKSP' ? '&#9003;' : key === 'UP' ? '&#9650;' : key === 'DOWN' ? '&#9660;' : key === 'DONE' ? '&#10003;' : key;
      return `<button type="button" data-k="${key}">${label}</button>`;
    }).join('') + '</div>';

  pad.addEventListener('pointerdown', (event) => event.preventDefault());
  pad.addEventListener('pointerdown', (event) => {
    const button = event.target.closest('button[data-k]');
    if (!button) return;
    const key = button.dataset.k;
    if (key === 'UP' || key === 'DOWN') {
      press(key);
      stopHold();
      holdTimer = setTimeout(() => {
        holdInterval = setInterval(() => press(key), 110);
      }, 420);
    }
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((name) =>
    pad.addEventListener(name, () => { if (holdTimer || holdInterval) stopHold(); }));
  window.addEventListener('pointerup', () => { if (holdTimer || holdInterval) stopHold(); });

  pad.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-k]');
    if (!button) return;
    const key = button.dataset.k;
    if (key !== 'UP' && key !== 'DOWN') press(key);
  });

  const handle = pad.querySelector('.rfnp-handle');
  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = pad.getBoundingClientRect();
    drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    try { handle.setPointerCapture(event.pointerId); } catch (err) {}
  });
  handle.addEventListener('pointermove', (event) => {
    if (!drag) return;
    event.preventDefault();
    position = {
      left: event.clientX - drag.dx,
      bottom: window.innerHeight - (event.clientY - drag.dy) - pad.offsetHeight,
    };
    applyPosition();
  });
  ['pointerup', 'pointercancel'].forEach((name) =>
    handle.addEventListener(name, () => {
      if (drag) { drag = null; savePosition(); }
    }));

  window.addEventListener('resize', () => { if (pad.style.display !== 'none') applyPosition(); });
  document.body.appendChild(pad);

  document.addEventListener('pointerdown', (event) => {
    const el = event.target;
    if (pad.contains(el)) return;
    if (el instanceof HTMLInputElement && el.matches(SELECTOR)) {
      if (!el.disabled) {
        event.preventDefault();
        tagField(el);
        showPad(el);
      }
    } else if (target) {
      hidePad(true);
    }
  }, true);

  document.addEventListener('focusout', (event) => {
    const el = event.target;
    if (el && el === target) {
      hideEl = el;
      hideTimer = setTimeout(() => hidePad(true, el), 120);
    }
  });

  document.addEventListener('click', (event) => {
    const el = event.target;
    if (pad.contains(el) || !target) return;
    if (el instanceof HTMLInputElement && el.matches(SELECTOR)) return;
    if (el && el.querySelector && el.querySelector(SELECTOR)) return;
    hidePad(true);
  }, true);
}

export function installKeypad() {
  if (pad) return;
  buildPad();
  tagAll(document);
  try {
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes || []) {
          if (node.nodeType !== 1) continue;
          if (node.matches && node.matches(SELECTOR)) tagField(node);
          tagAll(node);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  } catch (err) {}
}
