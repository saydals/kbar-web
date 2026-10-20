import { evaluateFn, formatValue } from './expression.js';
import { trShell } from './i18n.js';

const ASSET = 'assets/';
const CHANNEL_PARAMS = [210, 211, 212, 213, 214, 215, 216, 236, 239];
const CHANNEL_NAMES = ['Collective', 'Aileron', 'Elevator', 'Tail', 'ESC', 'AUX', 'AUX2', 'Throttle', 'Preset'];

function assetPath(path) {
  if (!path) return '';
  return ASSET + String(path).replace(/\\/g, '/').replace(/^\/+/, '');
}

function color(value, fallback) {
  if (!value) return fallback;
  if (/^#[0-9a-f]{3}$/i.test(value) || /^#[0-9a-f]{6}$/i.test(value) || /^#[0-9a-f]{8}$/i.test(value)) return value;
  return fallback;
}

function inverse(hex) {
  const c = color(hex, '#000000');
  if (c.length === 4) {
    const r = 255 - parseInt(c[1] + c[1], 16);
    const g = 255 - parseInt(c[2] + c[2], 16);
    const b = 255 - parseInt(c[3] + c[3], 16);
    return `rgb(${r},${g},${b})`;
  }
  const r = 255 - parseInt(c.slice(1, 3), 16);
  const g = 255 - parseInt(c.slice(3, 5), 16);
  const b = 255 - parseInt(c.slice(5, 7), 16);
  return `rgb(${r},${g},${b})`;
}

function fontCss(obj) {
  const style = obj.fontStyle | 0;
  const weight = (style & 1) ? 'bold' : 'normal';
  const slant = (style & 2) ? 'italic' : 'normal';
  const family = obj.fontName && obj.fontName.trim() ? `"${obj.fontName}", Arial, sans-serif` : 'Arial, Helvetica, sans-serif';
  const size = obj.fontSize > 0 ? obj.fontSize : 11;
  return { fontFamily: family, fontSize: `${size}px`, fontWeight: weight, fontStyle: slant };
}

function applyFont(el, obj) {
  const f = fontCss(obj);
  el.style.fontFamily = f.fontFamily;
  el.style.fontSize = f.fontSize;
  el.style.fontWeight = f.fontWeight;
  el.style.fontStyle = f.fontStyle;
}

function applyBorder(el, obj) {
  const mode = obj.border | 0;
  if (mode === 1) {
    el.style.boxShadow = 'inset 0 0 0 1px #404040';
  } else if (mode === 2) {
    el.style.boxShadow = 'inset 1px 1px 0 #808080, inset -1px -1px 0 #ffffff';
  }
}

function applyBackground(el, obj, always = false) {
  if (always || obj.opaque) {
    el.style.backgroundColor = color(obj.bg, '#f0f0f0');
  } else {
    el.style.backgroundColor = 'transparent';
  }
}

function makeImage(path, cls) {
  const img = document.createElement('img');
  img.src = assetPath(path);
  img.alt = '';
  img.draggable = false;
  if (cls) img.className = cls;
  return img;
}

function setOutputs(obj, x, ctx) {
  if (!obj.param || !obj.param.ausgang || !obj.param.ausgang.length) return;
  for (const out of obj.param.ausgang) {
    if (out.register < 0) continue;
    const v = evaluateFn(out.fn, ctx.store.values, x);
    ctx.store.set(out.register, v, obj.sourceId);
  }
}

function comboLabel(obj, item, ctx) {
  let label = item.label || item.name || '';
  if (obj.channelSelector === 1 && item.value >= 0) {
    for (let i = 0; i < CHANNEL_PARAMS.length; i++) {
      if (ctx.store.get(CHANNEL_PARAMS[i]) === item.value) {
        label += ' | ' + CHANNEL_NAMES[i];
      }
    }
  }
  return label;
}

function refreshCombo(obj, ctx) {
  if (!obj.selectEl) return;
  const sel = obj.selectEl.selectedIndex;
  for (let i = 0; i < obj.items.length; i++) {
    const opt = obj.selectEl.options[i];
    if (opt) opt.textContent = comboLabel(obj, obj.items[i], ctx);
  }
  if (sel >= 0 && sel < obj.selectEl.options.length) obj.selectEl.selectedIndex = sel;
}

function setPageVisibility(obj, visible, ctx) {
  obj.pageVisible = visible;
  if (visible) obj.pageEl.classList.remove('page-hidden');
  else obj.pageEl.classList.add('page-hidden');
  if (ctx.app && ctx.app.onPageVisibilityChanged) ctx.app.onPageVisibilityChanged();
}

function applyValue(obj, raw, ctx) {
  const v = Number(raw) || 0;
  obj.value = v;
  if (obj.pageEl) {
    applyPageValue(obj, v, ctx);
    return;
  }
  if (obj.invalidSize) return;
  switch (obj.type) {
    case 'Panel': {
      const visible = Math.round(v) !== 0;
      obj.visible = visible;
      if (obj.el) obj.el.style.display = visible ? 'block' : 'none';
      break;
    }
    case 'Label': {
      if (obj.textEl) obj.textEl.textContent = formatValue(v, obj.fraction);
      break;
    }
    case 'Combo': {
      if (!obj.selectEl) break;
      const target = Math.round(v);
      let found = -1;
      for (let i = 0; i < obj.items.length; i++) {
        if (Math.round(obj.items[i].value) === target) found = i;
      }
      if (found >= 0) obj.selectEl.selectedIndex = found;
      break;
    }
    case 'Check': {
      if (obj.checkEl) obj.checkEl.checked = Math.round(v) !== 0;
      break;
    }
    case 'Field': {
      if (!obj.inputEl) break;
      obj.inputEl.value = formatValue(v, obj.fraction);
      obj.inputEl.classList.remove('invalid');
      break;
    }
    case 'Slider': {
      const lo = Math.min(obj.minimum, obj.maximum);
      const hi = Math.max(obj.minimum, obj.maximum);
      const sv = Math.max(lo, Math.min(hi, Math.round(v)));
      obj.sliderValue = sv;
      updateSliderThumb(obj);
      break;
    }
    case 'Bar': {
      updateBar(obj, v);
      break;
    }
    case 'SwitchImage': {
      const target = Math.round(v);
      let found = null;
      for (const item of obj.items) {
        if (Math.round(item.value) === target && item.name) found = item;
      }
      if (found) {
        if (!obj.imgEl) {
          obj.imgEl = document.createElement('img');
          obj.imgEl.draggable = false;
          obj.imgEl.alt = '';
          obj.el.appendChild(obj.imgEl);
        }
        obj.imgEl.src = assetPath(found.name);
      }
      break;
    }
    case 'MultiField': {
      if (obj.textEl) obj.textEl.textContent = formatValue(v, obj.fraction);
      break;
    }
    default:
      break;
  }
}

function updateSliderThumb(obj) {
  if (!obj.thumbEl) return;
  const lo = Math.min(obj.minimum, obj.maximum);
  const hi = Math.max(obj.minimum, obj.maximum);
  const span = hi - lo || 1;
  const v = obj.sliderValue === undefined ? lo : obj.sliderValue;
  if (obj.orientation === 0) {
    const start = obj.sliderBarStart === undefined ? 7 : obj.sliderBarStart;
    const width = obj.sliderBarWidth === undefined ? Math.max(1, obj.w - 14) : obj.sliderBarWidth;
    const x = start + ((v - lo) / span) * width;
    obj.thumbEl.style.left = `${x}px`;
    obj.thumbEl.style.top = `${obj.sliderBarY === undefined ? 12.5 : obj.sliderBarY}px`;
  } else {
    const y = 7 + ((hi - v) / span) * Math.max(1, obj.h - 14);
    obj.thumbEl.style.top = `${y}px`;
    obj.thumbEl.style.left = `${obj.sliderBarX || 7.5}px`;
  }
}

function updateBar(obj, raw) {
  if (!obj.fillEl) return;
  const lo = Math.min(obj.minimum, obj.maximum);
  const hi = Math.max(obj.minimum, obj.maximum);
  const span = hi - lo || 1;
  const v = Math.max(lo, Math.min(hi, Math.round(raw)));
  const fg = color(obj.fg, '#0000cc');
  obj.fillEl.style.background = v > 0 ? fg : inverse(fg);
  if (obj.orientation === 0) {
    const valw = obj.w - Math.trunc(((span - (v - lo)) * obj.w) / span);
    const zerow = obj.w - Math.trunc(((span - (0 - lo)) * obj.w) / span);
    if (v > 0) {
      obj.fillEl.style.left = `${zerow}px`;
      obj.fillEl.style.width = `${Math.max(0, valw - zerow)}px`;
    } else {
      obj.fillEl.style.left = `${valw}px`;
      obj.fillEl.style.width = `${Math.max(0, zerow - valw)}px`;
    }
    obj.fillEl.style.top = '0';
    obj.fillEl.style.height = '100%';
    if (obj.zeroEl) {
      obj.zeroEl.style.display = lo < 0 ? 'block' : 'none';
      obj.zeroEl.className = 'zero h';
      obj.zeroEl.style.left = `${zerow}px`;
      obj.zeroEl.style.top = '0';
      obj.zeroEl.style.bottom = '0';
      obj.zeroEl.style.width = '1px';
      obj.zeroEl.style.height = '';
    }
  } else {
    const valh = Math.trunc(((span - (v - lo)) * obj.h) / span);
    const zeroh = Math.trunc(((span - (0 - lo)) * obj.h) / span);
    if (v > 0) {
      obj.fillEl.style.top = `${valh}px`;
      obj.fillEl.style.height = `${Math.max(0, zeroh - valh)}px`;
    } else {
      obj.fillEl.style.top = `${zeroh}px`;
      obj.fillEl.style.height = `${Math.max(0, valh - zeroh)}px`;
    }
    obj.fillEl.style.left = '0';
    obj.fillEl.style.width = '100%';
    if (obj.zeroEl) {
      obj.zeroEl.style.display = lo < 0 ? 'block' : 'none';
      obj.zeroEl.className = 'zero v';
      obj.zeroEl.style.top = `${zeroh}px`;
      obj.zeroEl.style.left = '0';
      obj.zeroEl.style.right = '0';
      obj.zeroEl.style.height = '1px';
      obj.zeroEl.style.width = '';
    }
  }
}

function sliderSetFromPointer(obj, ctx, clientX, clientY) {
  const rect = obj.el.getBoundingClientRect();
  const lo = Math.min(obj.minimum, obj.maximum);
  const hi = Math.max(obj.minimum, obj.maximum);
  let ratio;
  if (obj.orientation === 0) {
    const start = obj.sliderBarStart === undefined ? 7 : obj.sliderBarStart;
    const width = obj.sliderBarWidth === undefined ? Math.max(1, obj.w - 14) : obj.sliderBarWidth;
    const localX = ((clientX - rect.left) / Math.max(1, rect.width)) * obj.w;
    ratio = (localX - start) / Math.max(1, width);
  } else {
    ratio = (clientY - rect.top) / Math.max(1, rect.height);
  }
  ratio = Math.max(0, Math.min(1, ratio));
  let v = obj.orientation === 0 ? lo + ratio * (hi - lo) : hi - ratio * (hi - lo);
  v = Math.round(v);
  v = Math.max(lo, Math.min(hi, v));
  obj.sliderValue = v;
  updateSliderThumb(obj);
  setOutputs(obj, v, ctx);
}

function setupSlider(obj, el, ctx) {
  el.classList.add('ui-slider', obj.orientation === 0 ? 'horizontal' : 'vertical');
  const track = document.createElement('div');
  track.className = 'track';
  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  el.appendChild(track);
  el.appendChild(thumb);
  obj.thumbEl = thumb;
  const lo = Math.min(obj.minimum, obj.maximum);
  const hi = Math.max(obj.minimum, obj.maximum);
  const span = hi - lo || 1;
  const major = obj.majorTick > 0 ? obj.majorTick : (obj.labelIncrement > 0 ? obj.labelIncrement : 0);
  if (major > 0) {
    const count = Math.floor(span / major);
    for (let i = 0; i <= count; i++) {
      const val = lo + i * major;
      const r = (val - lo) / span;
      const tick = document.createElement('div');
      tick.className = 'tick';
      if (obj.orientation === 0) {
        tick.style.left = `${7 + r * Math.max(1, obj.w - 14)}px`;
        tick.style.top = `${(obj.sliderBarY === undefined ? 12.5 : obj.sliderBarY) + 4}px`;
      } else {
        tick.style.top = `${7 + (1 - r) * Math.max(1, obj.h - 14)}px`;
        tick.style.left = `${(obj.sliderBarX || 7.5) + 4.5}px`;
      }
      el.appendChild(tick);
    }
  }
  if (obj.labelIncrement > 0) {
    let vals = [];
    for (let val = lo; val <= hi; val += obj.labelIncrement) vals.push(val);
    if (vals.length === 0 || vals[vals.length - 1] !== hi) vals.push(hi);
    for (const val of vals) {
      const r = (val - lo) / span;
      const label = document.createElement('div');
      label.className = 'slabel' + (val === 0 ? ' zero' : '');
      label.textContent = String(val);
      if (obj.orientation === 0) {
        label.style.left = `${7 + r * Math.max(1, obj.w - 14)}px`;
        label.style.top = `${(obj.sliderBarY === undefined ? 12.5 : obj.sliderBarY) + 24}px`;
      } else {
        label.style.top = `${7 + (1 - r) * Math.max(1, obj.h - 14)}px`;
        label.style.left = `${Math.round(obj.w * 0.7)}px`;
      }
      el.appendChild(label);
    }
  }
  updateSliderThumb(obj);
  el.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    el.setPointerCapture(ev.pointerId);
    obj.dragging = true;
    sliderSetFromPointer(obj, ctx, ev.clientX, ev.clientY);
  });
  el.addEventListener('pointermove', (ev) => {
    if (!obj.dragging) return;
    ev.preventDefault();
    sliderSetFromPointer(obj, ctx, ev.clientX, ev.clientY);
  });
  el.addEventListener('pointerup', (ev) => {
    obj.dragging = false;
    try { el.releasePointerCapture(ev.pointerId); } catch (e) {}
  });
  el.addEventListener('pointercancel', () => { obj.dragging = false; });
  applyValue(obj, obj.param && obj.param.eingang ? 0 : Math.max(lo, Math.min(hi, 0)), ctx);
}

function setupCombo(obj, el, ctx) {
  el.classList.add('ui-combo');
  const select = document.createElement('select');
  select.className = 'combo-input';
  select.style.width = '100%';
  select.style.height = '100%';
  for (const item of obj.items) {
    const opt = document.createElement('option');
    opt.value = String(item.value);
    opt.textContent = comboLabel(obj, item, ctx);
    select.appendChild(opt);
  }
  if (select.options.length) select.selectedIndex = 0;
  el.appendChild(select);
  obj.selectEl = select;
  applyFont(select, obj);
  select.style.background = color(obj.bg, '#ffffff');
  select.addEventListener('change', () => {
    if (obj.disableEvents) return;
    const idx = select.selectedIndex;
    if (idx < 0 || idx >= obj.items.length) return;
    setOutputs(obj, obj.items[idx].value, ctx);
  });
  if (obj.channelSelector === 1) {
    ctx.store.addParamListener(CHANNEL_PARAMS, () => refreshCombo(obj, ctx));
  }
}

function setupCheck(obj, el, ctx) {
  const input = document.createElement('input');
  input.type = 'checkbox';
  const span = document.createElement('span');
  span.textContent = obj.text;
  el.appendChild(input);
  if (obj.text) el.appendChild(span);
  obj.checkEl = input;
  applyFont(el, obj);
  el.addEventListener('click', (ev) => {
    if (ev.target !== input) input.click();
  });
  input.addEventListener('change', async () => {
    if (obj.disableEvents) return;
    let ok = true;
    if (obj.nachfrage) ok = await ctx.app.confirm(`${trShell('Are you sure you want to execute this function?')} : ${obj.text}`, trShell('Warning'));
    if (!ok) {
      obj.disableEvents = true;
      input.checked = !input.checked;
      obj.disableEvents = false;
      return;
    }
    setOutputs(obj, input.checked ? 1 : 0, ctx);
  });
}

function setupField(obj, el, ctx) {
  el.classList.add('ui-field');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'field-input';
  input.style.width = '100%';
  input.style.height = '100%';
  input.spellcheck = false;
  el.appendChild(input);
  obj.inputEl = input;
  applyFont(input, obj);
  const commit = () => {
    const raw = input.value.replace(',', '.').trim();
    if (!raw) {
      input.value = formatValue(obj.value || 0, obj.fraction);
      return;
    }
    const val = obj.fraction > 0 ? Number.parseFloat(raw) : Number.parseInt(raw, 10);
    if (!Number.isFinite(val)) {
      input.classList.add('invalid');
      return;
    }
    input.classList.remove('invalid');
    setOutputs(obj, val, ctx);
  };
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      commit();
    }
  });
  input.addEventListener('blur', commit);
  input.addEventListener('change', commit);
  input.addEventListener('input', () => input.classList.remove('invalid'));
}

function setupButton(obj, el, ctx) {
  const image = obj.image ? makeImage(obj.image) : null;
  const span = document.createElement('span');
  span.textContent = obj.text;
  if (image) el.appendChild(image);
  if (!obj.hideText && obj.text) el.appendChild(span);
  if (obj.alignment === 1 && image && span.parentNode) {
    el.insertBefore(span, image);
  }
  applyFont(el, obj);
  if (obj.opaque) el.style.background = color(obj.bg, '#cccccc');
  el.addEventListener('click', async () => {
    if (obj.nachfrage) {
      let message = 'Are you sure you want to execute this function?';
      let title = 'Warning';
      if (obj.nachfrage === 2 && obj.tooltip) {
        message = obj.tooltip;
        const sep = message.indexOf('~');
        if (sep > 0) {
          title = message.slice(0, sep);
          message = message.slice(sep + 1);
        }
        message = message
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<p\s*\/?>/gi, '\n\n')
          .replace(/<[^>]+>/g, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      }
      const ok = await ctx.app.confirm(`${trShell(message)}  : ${obj.text}`, trShell(title));
      if (!ok) return;
    }
    const at = obj.text.indexOf('@');
    if (at >= 0) {
      ctx.app.openUrl(obj.text.slice(at + 1));
      return;
    }
    setOutputs(obj, 1, ctx);
  });
}

function setupSwitchImage(obj, el, ctx) {
  obj.imgEl = null;
  if (obj.param && obj.param.ausgang && obj.param.ausgang.length) el.classList.add('clickable');
  el.addEventListener('click', async () => {
    if (!obj.param || !obj.param.ausgang.length) return;
    let ok = true;
    if (obj.nachfrage) ok = await ctx.app.confirm('Change', 'Warning');
    if (ok) setOutputs(obj, 1, ctx);
  });
}

function setupLabel(obj, el) {
  if (obj.image) el.appendChild(makeImage(obj.image));
  const span = document.createElement('span');
  span.textContent = obj.text;
  el.appendChild(span);
  obj.textEl = span;
  const align = obj.alignment | 0;
  el.style.justifyContent = align === 0 ? 'flex-start' : (align === 1 ? 'flex-end' : 'center');
  applyFont(el, obj);
  el.style.color = color(obj.fg, '#000000');
  if (obj.opaque) el.style.backgroundColor = color(obj.bg, '#c9c9c9');
}

function setupMultiField(obj, el) {
  const span = document.createElement('div');
  span.textContent = String(obj.text || '').replace(/\|/g, '\n');
  el.appendChild(span);
  obj.textEl = span;
  applyFont(el, obj);
  el.style.color = color(obj.fg, '#000000');
  el.style.backgroundColor = obj.opaque ? color(obj.bg, '#f0f0f0') : 'transparent';
}

function setupLine(obj, el) {
  const line = document.createElement('div');
  line.className = 'line';
  line.style.background = color(obj.fg, '#999999');
  const thickness = Math.max(2, Math.floor(obj.h / 4));
  line.style.height = `${thickness}px`;
  line.style.top = `${Math.floor(obj.h / 2 - thickness / 2)}px`;
  el.appendChild(line);
  if (obj.opaque) el.style.backgroundColor = color(obj.bg, '#ffffff');
}

function drawTsView(obj, ctx) {
  const canvas = obj.canvasEl;
  if (!canvas) return;
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const w = obj.w;
  const h = obj.h;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const x = Math.min(w, h);
  const scale = (x < 2 ? 100 : x / 2) / 130;
  g.fillStyle = '#adadff';
  g.beginPath();
  g.arc(cx, cy, 100 * scale, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#808080';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(cx, 0); g.lineTo(cx, h);
  g.moveTo(0, cy); g.lineTo(w, cy);
  g.stroke();
  g.font = '9px Arial';
  g.textBaseline = 'alphabetic';
  for (let i = 0; i < 4; i++) {
    const dist = obj.tsDistance[i];
    if (dist <= 0) continue;
    const rad = obj.tsAngle[i] * Math.PI / 180;
    const px = cx + dist * scale * Math.cos(rad);
    const py = cy - dist * scale * Math.sin(rad);
    g.strokeStyle = '#ff0000';
    g.fillStyle = '#ff0000';
    g.beginPath();
    g.moveTo(cx, cy); g.lineTo(px, py); g.stroke();
    g.beginPath();
    g.arc(px, py, 5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#000000';
    g.fillText('Ch' + (i + 1), px, py - 10);
    g.fillText(`${obj.tsAngle[i]}gr`, px - 20, py + 15);
    g.fillText(`${dist}%`, px - 20, py + 27);
  }
}

function setupTsView(obj, el, ctx) {
  const canvas = document.createElement('canvas');
  canvas.className = 'ui-canvas';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  el.appendChild(canvas);
  obj.canvasEl = canvas;
  obj.tsAngle = [30, 150, 270, 0];
  obj.tsDistance = [100, 100, 100, 0];
  obj.tsStore = new Array(28).fill(0);
  for (const id of [20, 21, 22, 23, 24, 25, 26, 27]) obj.tsStore[id] = ctx.store.get(id);
  const updatePair = (base) => {
    const a = obj.tsStore[base];
    const b = obj.tsStore[base + 1];
    const dr = (v) => (v > 0 ? v + 0.5 : (v < 0 ? v - 0.5 : 0));
    const angle = Math.round(Math.atan2(dr(b), dr(a)) * 180 / Math.PI + 360) % 360;
    const dist = Math.trunc(Math.sqrt(Math.pow(dr(a), 2) + Math.pow(dr(b), 2)) + 0.2);
    const idx = base === 20 ? 0 : (base === 22 ? 1 : (base === 24 ? 2 : 3));
    obj.tsAngle[idx] = angle;
    obj.tsDistance[idx] = dist;
  };
  ctx.store.addParamListener([20, 21, 22, 23, 24, 25, 26, 27], (adj) => {
    obj.tsStore[adj.parameter] = adj.value;
    updatePair(adj.parameter <= 21 ? 20 : (adj.parameter <= 23 ? 22 : (adj.parameter <= 25 ? 24 : 26)));
    drawTsView(obj, ctx);
  });
  drawTsView(obj, ctx);
}

function drawGasCurve(obj) {
  const canvas = obj.canvasEl;
  if (!canvas) return;
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const w = obj.w;
  const h = obj.h;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const yn = Math.floor((h - 15) / 2);
  const xn = Math.floor((w - 30) / 2) + 30;
  const xScale = Math.floor((w - 30) / 5);
  const yScale = Math.floor(((h - 15) * 100) / 256);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#E0E0FF';
  g.fillRect(30, yn + Math.floor(((2 * obj.gasMinimum) * yScale) / 100), w, h);
  g.strokeStyle = '#F0F0F0';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(30, yn + Math.floor((96 * yScale) / 100)); g.lineTo(w, yn + Math.floor((96 * yScale) / 100));
  g.moveTo(30, yn - Math.floor((96 * yScale) / 100)); g.lineTo(w, yn - Math.floor((96 * yScale) / 100));
  g.moveTo(xn + 2 * xScale, 0); g.lineTo(xn + 2 * xScale, h - 15);
  g.moveTo(xn - 2 * xScale, 0); g.lineTo(xn - 2 * xScale, h - 15);
  g.stroke();
  g.strokeStyle = '#0000cc';
  g.fillStyle = '#0000cc';
  let lastX = 0;
  let lastY = 0;
  for (let i = -1; i < 6; i++) {
    let val;
    if (i < 0) val = obj.gasValues[0] - (obj.gasValues[1] - obj.gasValues[0]);
    else if (i === 5) val = obj.gasValues[4] - (obj.gasValues[3] - obj.gasValues[4]);
    else val = obj.gasValues[i];
    const px = xn + xScale * (i - 2);
    const py = yn - Math.floor((val * yScale) / 100);
    g.fillStyle = (i === obj.gasCursor) ? '#ff0000' : '#0000cc';
    g.fillRect(px - 4, py - 4, 8, 8);
    if (i > -1) {
      g.strokeStyle = '#0000cc';
      g.beginPath(); g.moveTo(lastX, lastY); g.lineTo(px, py); g.stroke();
    }
    lastX = px;
    lastY = py;
  }
  g.fillStyle = '#d3d3d3';
  g.fillRect(0, 0, 30, h);
  g.fillRect(0, h - 15, w, 15);
  g.fillStyle = '#555';
  g.font = '9px Arial';
  g.fillText('-100', 4, yn + 5 + Math.floor((96 * yScale) / 100));
  g.fillText('0', 4, yn + 5);
  g.fillText('100', 4, yn + 5 - Math.floor((96 * yScale) / 100));
  g.fillText('100', xn - 10 + 2 * xScale, h - 5);
  g.fillText('0', xn - 5, h - 5);
  g.fillText('-100', xn - 10 - 2 * xScale, h - 5);
  g.strokeStyle = '#555';
  g.beginPath();
  g.moveTo(30, yn); g.lineTo(w, yn);
  g.moveTo(xn, 0); g.lineTo(xn, h - 15);
  g.stroke();
  g.strokeStyle = '#008000';
  const px = xn + Math.floor((obj.gasPitch * xScale) / 800);
  g.beginPath(); g.moveTo(px, 0); g.lineTo(px, h - 15); g.stroke();
  g.beginPath(); g.moveTo(px + 1, 0); g.lineTo(px + 1, h - 15); g.stroke();
}

function gasSetFromPointer(obj, ctx, clientX, clientY) {
  const rect = obj.el.getBoundingClientRect();
  const w = obj.w;
  const h = obj.h;
  const yn = Math.floor((h - 15) / 2);
  const x = (clientX - rect.left) * (w / Math.max(1, rect.width));
  const y = (clientY - rect.top) * (h / Math.max(1, rect.height));
  const xn = Math.floor((w - 30) / 2) + 30;
  const xScale = Math.floor((w - 30) / 5);
  const yScale = Math.floor(((h - 15) * 100) / 256);
  let idx = Math.floor((x - xn + xScale / 2) / xScale) + 2;
  if (idx < 0 || idx >= 5) return;
  let val = Math.trunc(((yn - y) * 100) / yScale);
  val = Math.max(-127, Math.min(127, val));
  obj.gasCursor = idx;
  obj.gasValues[idx] = val;
  drawGasCurve(obj);
  ctx.store.set(obj.startParam + idx, val, obj.sourceId);
}

function setupGasCurve(obj, el, ctx) {
  const canvas = document.createElement('canvas');
  canvas.className = 'ui-canvas';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  el.appendChild(canvas);
  obj.canvasEl = canvas;
  obj.gasValues = new Array(5).fill(0);
  for (let i = 0; i < 5; i++) obj.gasValues[i] = ctx.store.get(obj.startParam + i);
  obj.gasMinimum = ctx.store.get(obj.minimumParam);
  obj.gasPitch = ctx.store.get(obj.pitchParam);
  obj.gasCursor = -1;
  const redraw = () => {
    obj.gasMinimum = ctx.store.get(obj.minimumParam);
    obj.gasPitch = ctx.store.get(obj.pitchParam);
    drawGasCurve(obj);
  };
  ctx.store.addParamListener([obj.startParam, obj.startParam + 1, obj.startParam + 2, obj.startParam + 3, obj.startParam + 4], (adj) => {
    obj.gasValues[adj.parameter - obj.startParam] = adj.value;
    drawGasCurve(obj);
  });
  ctx.store.addParamListener([obj.minimumParam, obj.pitchParam], redraw);
  let dragging = false;
  el.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    el.setPointerCapture(ev.pointerId);
    dragging = true;
    gasSetFromPointer(obj, ctx, ev.clientX, ev.clientY);
  });
  el.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    ev.preventDefault();
    gasSetFromPointer(obj, ctx, ev.clientX, ev.clientY);
  });
  const stop = () => { dragging = false; };
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
  drawGasCurve(obj);
}

function drawFft(obj, mode) {
  const canvas = obj.canvasEl;
  if (!canvas) return;
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const w = obj.w;
  const h = obj.h;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#e4e4e4';
  g.lineWidth = 1;
  for (let i = 0; i <= 8; i++) {
    const x = Math.floor((w * i) / 8);
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
  }
  for (let i = 0; i <= 4; i++) {
    const y = Math.floor((h * i) / 4);
    g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
  }
  if (mode === 'local') {
    const bins = obj.spectrum || new Float32Array(64);
    let max = 1;
    for (const v of bins) max = Math.max(max, v);
    g.fillStyle = '#1b9b1b';
    const bw = w / bins.length;
    for (let i = 0; i < bins.length; i++) {
      const bh = Math.max(0, Math.min(1, bins[i] / max)) * (h - 4);
      g.fillRect(i * bw, h - bh - 1, Math.max(1, bw - 1), bh);
    }
    g.fillStyle = '#111';
    g.font = '10px Arial';
    g.fillText('max=' + Math.round(max), 8, 12);
  } else {
    const data = obj.fftData || new Float32Array(128);
    let norm = 350;
    for (const v of data) norm = Math.max(norm, Math.abs(v));
    g.fillStyle = '#C0FFC0';
    g.beginPath();
    g.moveTo(0, h);
    for (let i = 0; i < data.length; i++) {
      const x = (w * i) / data.length;
      const y = h - 2 - ((data[i] * 1900) / norm) * h / 2000;
      g.lineTo(x, y);
    }
    g.lineTo(w, h);
    g.closePath();
    g.fill();
    g.strokeStyle = '#008000';
    g.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = (w * i) / data.length;
      const y = h - 2 - ((data[i] * 1900) / norm) * h / 2000;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = '#111';
    g.font = '10px Arial';
    g.fillText('max=' + Math.round(norm), 8, 12);
  }
}

function fftRadix2(re, im, n) {
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function setupFft(obj, el, ctx, local) {
  const canvas = document.createElement('canvas');
  canvas.className = 'ui-canvas';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  el.appendChild(canvas);
  obj.canvasEl = canvas;
  obj.fftData = new Float32Array(128);
  obj.fftPos = 0;
  obj.spectrum = new Float32Array(64);
  const push = (v) => {
    obj.fftData[obj.fftPos] = v;
    obj.fftPos = (obj.fftPos + 1) % 128;
  };
  ctx.store.addParamListener([130], (adj) => push(adj.value));
  if (local) {
    obj.fftSamples = new Float32Array(128);
    obj.fftSamplePos = 0;
    ctx.store.addParamListener([130], (adj) => {
      obj.fftSamples[obj.fftSamplePos] = adj.value;
      obj.fftSamplePos = (obj.fftSamplePos + 1) % 128;
    });
  }
  const timer = setInterval(() => {
    if (!obj.el || !obj.el.offsetParent) return;
    if (local) {
      const re = new Float32Array(128);
      const im = new Float32Array(128);
      for (let i = 0; i < 128; i++) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 127);
        re[i] = (obj.fftSamples[(obj.fftSamplePos + i) % 128] || 0) * w;
      }
      fftRadix2(re, im, 128);
      for (let i = 0; i < 64; i++) obj.spectrum[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    }
    drawFft(obj, local ? 'local' : 'time');
  }, 180);
  obj.timer = timer;
  drawFft(obj, local ? 'local' : 'time');
}

function createObjectEl(obj, parent, ctx) {
  const el = document.createElement('div');
  el.style.left = `${obj.x}px`;
  el.style.top = `${obj.y}px`;
  el.style.width = `${obj.w}px`;
  el.style.height = `${obj.h}px`;
  el.style.zIndex = String(1000 - parent.childElementCount);
  if (obj.w <= 0 || obj.h <= 0) {
    obj.invalidSize = true;
    el.style.display = 'none';
  }
  obj.el = el;
  obj.sourceId = ctx.nextSourceId++;
  ctx.objects.push(obj);
  parent.appendChild(el);
  if (obj.tooltip) el.dataset.tooltip = obj.tooltip;
  return el;
}

function renderObject(obj, parent, ctx) {
  const el = createObjectEl(obj, parent, ctx);
  switch (obj.type) {
    case 'Panel': {
      el.classList.add('ui-panel');
      applyBackground(el, obj);
      applyBorder(el, obj);
      if (obj.image) el.appendChild(makeImage(obj.image, 'ui-bg'));
      break;
    }
    case 'Label': {
      el.classList.add('ui-label');
      setupLabel(obj, el);
      applyBorder(el, obj);
      break;
    }
    case 'Button': {
      el.classList.add('ui-button');
      setupButton(obj, el, ctx);
      applyBackground(el, obj);
      break;
    }
    case 'Combo': {
      setupCombo(obj, el, ctx);
      break;
    }
    case 'Check': {
      el.classList.add('ui-check');
      setupCheck(obj, el, ctx);
      applyBackground(el, obj);
      applyFont(el, obj);
      break;
    }
    case 'Field': {
      setupField(obj, el, ctx);
      break;
    }
    case 'Slider': {
      setupSlider(obj, el, ctx);
      applyBackground(el, obj);
      applyBorder(el, obj);
      break;
    }
    case 'Bar': {
      el.classList.add('ui-bar');
      el.style.backgroundColor = color(obj.bg, '#ffffff');
      const fill = document.createElement('div');
      fill.className = 'fill';
      el.appendChild(fill);
      const zero = document.createElement('div');
      zero.className = 'zero';
      el.appendChild(zero);
      obj.fillEl = fill;
      obj.zeroEl = zero;
      break;
    }
    case 'SwitchImage': {
      el.classList.add('ui-switchimage');
      setupSwitchImage(obj, el, ctx);
      applyBackground(el, obj);
      applyBorder(el, obj);
      break;
    }
    case 'MultiField': {
      el.classList.add('ui-multifield');
      setupMultiField(obj, el);
      applyBorder(el, obj);
      break;
    }
    case 'Line': {
      el.classList.add('ui-line');
      setupLine(obj, el);
      applyBorder(el, obj);
      break;
    }
    case 'TsView': {
      setupTsView(obj, el, ctx);
      break;
    }
    case 'Gaskurve': {
      setupGasCurve(obj, el, ctx);
      break;
    }
    case 'Fft': {
      setupFft(obj, el, ctx, false);
      break;
    }
    case 'FftLocal': {
      setupFft(obj, el, ctx, true);
      break;
    }
    default: {
      el.classList.add('ui-unknown');
      if (obj.text) el.textContent = obj.text;
      break;
    }
  }
  if (obj.children && obj.children.length) {
    for (const c of obj.children) renderObject(c, el, ctx);
  }
  if (obj.param && obj.param.eingangRefs && obj.param.eingangRefs.size) {
    const refs = [...obj.param.eingangRefs];
    ctx.store.addParamListener(refs, () => {
      applyValue(obj, evaluateFn(obj.param.eingangFn, ctx.store.values, 0), ctx);
    });
  }
}

function setupPage(page, el, ctx) {
  page.el = el;
  page.pageEl = el;
  page.sourceId = ctx.nextSourceId++;
  page.pageVisible = true;
  objPositionPage(page, el);
  ctx.objects.push(page);
  if (page.tooltip) el.dataset.tooltip = page.tooltip;
  if (page.children && page.children.length) {
    for (const c of page.children) renderObject(c, el, ctx);
  }
  if (page.param && page.param.eingangRefs && page.param.eingangRefs.size) {
    ctx.store.addParamListener([...page.param.eingangRefs], () => {
      applyPageValue(page, evaluateFn(page.param.eingangFn, ctx.store.values, 0), ctx);
    });
  }
}

function objPositionPage(page, el) {
  const w = Math.max(page.w, 973);
  const h = Math.max(page.h, 475);
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  el.style.backgroundColor = color(page.bg, '#f0f0f0');
  if (page.image) el.appendChild(makeImage(page.image, 'ui-bg'));
}

function applyPageValue(page, raw, ctx) {
  const visible = Math.round(Number(raw) || 0) !== 0;
  setPageVisibility(page, visible, ctx);
}

function assignSliderGeometry(obj) {
  if (obj.children && obj.children.length) {
    for (const item of obj.children) {
      if (item.type === 'Slider') {
        if (item.orientation !== 0 && !item.sliderBarX) {
          let barX = null;
          for (const sib of obj.children) {
            if (sib.type !== 'Panel' || !sib.image || !/verlauf\.png$/i.test(sib.image)) continue;
            if (sib.x >= item.x - 2 && sib.x <= item.x + item.w && sib.y >= item.y - 2 && sib.y <= item.y + item.h) {
              barX = sib.x - item.x + sib.w / 2;
              break;
            }
          }
          item.sliderBarX = barX === null ? Math.max(5, item.w * 0.15) : barX;
        } else if (item.orientation === 0 && item.sliderBarY === undefined) {
          let bar = null;
          for (const sib of obj.children) {
            if (sib.type !== 'Panel' || !sib.image || !/verlauf3\.png$/i.test(sib.image)) continue;
            if (sib.x >= item.x - 2 && sib.x <= item.x + item.w && sib.y >= item.y - 2 && sib.y <= item.y + item.h) {
              bar = sib;
              break;
            }
          }
          item.sliderBarStart = bar ? bar.x - item.x : 7;
          item.sliderBarWidth = bar ? bar.w : Math.max(1, item.w - 14);
          item.sliderBarY = bar ? bar.y - item.y + bar.h / 2 : 12.5;
        }
      }
      assignSliderGeometry(item);
    }
  }
}

export function buildUi(config, store, app) {
  for (const page of config.pages) assignSliderGeometry(page);
  const ctx = {
    config,
    store,
    app,
    objects: [],
    pages: [],
    pageEls: [],
    nextSourceId: 10000,
    active: 0,
  };
  const root = document.getElementById('pages');
  for (let i = 0; i < config.pages.length; i++) {
    const page = config.pages[i];
    page.pageIndex = i;
    const el = document.createElement('div');
    el.className = 'page';
    el.dataset.page = String(i);
    root.appendChild(el);
    ctx.pages.push(page);
    ctx.pageEls.push(el);
  }
  for (let i = 0; i < ctx.pages.length; i++) {
    setupPage(ctx.pages[i], ctx.pageEls[i], ctx);
  }
  for (const obj of ctx.objects) {
    if (obj.param && obj.param.eingang) {
      applyValue(obj, evaluateFn(obj.param.eingangFn, store.values, 0), ctx);
    }
  }
  ctx.activate = (index) => activatePage(ctx, index);
  ctx.nextPage = (dir) => nextPage(ctx, dir);
  ctx.refresh = () => {
    for (const obj of ctx.objects) {
      if (obj.param && obj.param.eingang) {
        if (obj.type === 'Panel') applyValue(obj, evaluateFn(obj.param.eingangFn, store.values, 0), ctx);
        else applyValue(obj, evaluateFn(obj.param.eingangFn, store.values, 0), ctx);
      }
    }
  };
  return ctx;
}

export function activatePage(ctx, index) {
  let i = Number(index);
  if (!Number.isFinite(i)) return false;
  if (i < 0) i = 0;
  if (i >= ctx.pages.length) i = ctx.pages.length - 1;
  const page = ctx.pages[i];
  if (!page || page.pageVisible === false) return false;
  ctx.active = i;
  for (let k = 0; k < ctx.pageEls.length; k++) {
    ctx.pageEls[k].classList.toggle('active', k === i);
  }
  if (ctx.app && ctx.app.onPageChanged) ctx.app.onPageChanged(i);
  return true;
}

export function nextPage(ctx, dir) {
  const n = ctx.pages.length;
  for (let step = 1; step <= n; step++) {
    const idx = (ctx.active + (dir < 0 ? -step : step) + n) % n;
    if (ctx.pages[idx].pageVisible !== false) return activatePage(ctx, idx);
  }
  return false;
}

export function applyExternalValue(obj, value, ctx) {
  applyValue(obj, value, ctx);
}
