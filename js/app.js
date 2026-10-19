import { loadConfig } from './config.js';
import { ParameterStore } from './model.js';
import { buildUi, activatePage, nextPage } from './ui.js';
import { SerialClient } from './serial.js';

const state = {
  config: null,
  store: null,
  ui: null,
  serial: null,
  log: [],
  logModal: null,
  modal: null,
  pageMenu: null,
  connected: false,
  closed: false,
  lastPage: 0,
  prevSerialStatus: 'no Connection',
};

const el = (id) => document.getElementById(id);
const pagesRoot = el('pages');
const connPill = el('connPill');
const statusLeft = el('statusLeft');
const statusRight = el('statusRight');
const bankPill = el('bankPill');
const modalRoot = el('modalRoot');
const tooltip = el('tooltip');
const fileInput = el('fileInput');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function pageTitle(page) {
  return page.text || page.name || 'Page';
}

function addLog(direction, text) {
  const stamp = new Date().toLocaleTimeString();
  state.log.push(`[${stamp}] ${direction.toUpperCase()} ${text}`);
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
  if (state.logModal) state.logModal.value = state.log.join('\n');
}

function sanitizeTooltip(html) {
  const doc = new DOMParser().parseFromString(`<div id="tt">${html}</div>`, 'text/html');
  const root = doc.getElementById('tt');
  if (!root) return '';
  for (const bad of root.querySelectorAll('script,style,iframe,object,embed,form,input,button,textarea,select,link,meta')) bad.remove();
  for (const node of root.querySelectorAll('*')) {
    for (const attr of [...node.attributes]) {
      if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
      if ((attr.name === 'href' || attr.name === 'src') && /^\s*javascript:/i.test(attr.value)) node.removeAttribute(attr.name);
    }
  }
  return root.innerHTML;
}

function showTooltip(target, x, y) {
  const raw = target.dataset.tooltip;
  if (!raw) return;
  let body = raw;
  let title = '';
  const sep = raw.indexOf('~');
  if (sep > 0) {
    title = raw.slice(0, sep);
    body = raw.slice(sep + 1);
  }
  const html = sanitizeTooltip(body);
  tooltip.style.width = raw.length > 85 ? '314px' : 'auto';
  tooltip.innerHTML = (title ? `<div class="tt-title">&nbsp;&nbsp;${escapeHtml(title)}</div>` : '') + html;
  tooltip.classList.add('visible');
  const pad = 14;
  const maxX = window.innerWidth - tooltip.offsetWidth - pad;
  const maxY = window.innerHeight - tooltip.offsetHeight - pad;
  tooltip.style.left = `${Math.max(pad, Math.min(maxX, x + 16))}px`;
  tooltip.style.top = `${Math.max(pad, Math.min(maxY, y + 18))}px`;
}

function hideTooltip() {
  if (tooltipTimer) {
    clearTimeout(tooltipTimer);
    tooltipTimer = null;
  }
  tooltip.classList.remove('visible');
}

let tooltipTimer = null;
document.addEventListener('pointerover', (ev) => {
  const target = ev.target instanceof Element ? ev.target.closest('[data-tooltip]') : null;
  if (tooltipTimer) {
    clearTimeout(tooltipTimer);
    tooltipTimer = null;
  }
  if (target && target.dataset.tooltip) {
    const x = ev.clientX;
    const y = ev.clientY;
    tooltipTimer = setTimeout(() => {
      tooltipTimer = null;
      showTooltip(target, x, y);
    }, 250);
  } else {
    hideTooltip();
  }
});
document.addEventListener('pointerdown', hideTooltip);
document.addEventListener('pointermove', (ev) => {
  if (!tooltip.classList.contains('visible')) return;
  const target = ev.target instanceof Element ? ev.target.closest('[data-tooltip]') : null;
  if (!target) {
    hideTooltip();
    return;
  }
  const pad = 14;
  const maxX = window.innerWidth - tooltip.offsetWidth - pad;
  const maxY = window.innerHeight - tooltip.offsetHeight - pad;
  tooltip.style.left = `${Math.max(pad, Math.min(maxX, ev.clientX + 16))}px`;
  tooltip.style.top = `${Math.max(pad, Math.min(maxY, ev.clientY + 18))}px`;
});
document.addEventListener('pointerout', (ev) => {
  const target = ev.target instanceof Element ? ev.target.closest('[data-tooltip]') : null;
  if (!target) return;
  const to = ev.relatedTarget instanceof Element ? ev.relatedTarget.closest('[data-tooltip]') : null;
  if (to !== target) hideTooltip();
});
pagesRoot.addEventListener('scroll', hideTooltip);

function closeModal() {
  if (!state.modal) return;
  const m = state.modal;
  state.modal = null;
  if (m.keyHandler) document.removeEventListener('keydown', m.keyHandler);
  if (m.onClose) m.onClose();
  m.backdrop.remove();
}

function openModal({ title, body, buttons = [], width = 520, onClose = null }) {
  closeModal();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.width = `${width}px`;
  const head = document.createElement('div');
  head.className = 'modal-title';
  const t = document.createElement('span');
  t.textContent = title;
  const x = document.createElement('button');
  x.type = 'button';
  x.textContent = '✕';
  x.addEventListener('click', closeModal);
  head.appendChild(t);
  head.appendChild(x);
  const bodyEl = document.createElement('div');
  bodyEl.className = 'modal-body';
  if (body instanceof Node) bodyEl.appendChild(body);
  else bodyEl.innerHTML = body;
  const foot = document.createElement('div');
  foot.className = 'modal-footer';
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = b.label;
    if (b.primary) btn.classList.add('primary');
    if (b.danger) btn.classList.add('danger');
    btn.addEventListener('click', () => b.onClick ? b.onClick(closeModal) : closeModal());
    foot.appendChild(btn);
  }
  modal.appendChild(head);
  modal.appendChild(bodyEl);
  if (buttons.length) modal.appendChild(foot);
  backdrop.appendChild(modal);
  modalRoot.appendChild(backdrop);
  const key = (ev) => {
    if (ev.key === 'Escape') {
      hideTooltip();
      closeModal();
    }
  };
  state.modal = { backdrop, modal, onClose, keyHandler: key };
  backdrop.addEventListener('mousedown', (ev) => {
    if (ev.target === backdrop) closeModal();
  });
  document.addEventListener('keydown', key);
  return { close: closeModal, modal, body: bodyEl };
}

function confirmDialog(message, title = 'Warning') {
  return new Promise((resolve) => {
    openModal({
      title,
      body: `<p style="white-space:pre-wrap">${escapeHtml(message)}</p>`,
      buttons: [
        { label: 'Cancel', onClick: (close) => { resolve(false); close(); } },
        { label: 'OK', primary: true, onClick: (close) => { resolve(true); close(); } },
      ],
      onClose: () => resolve(false),
    });
  });
}

function alertDialog(message, title = 'Information') {
  return new Promise((resolve) => {
    openModal({
      title,
      body: `<p style="white-space:pre-wrap">${escapeHtml(message)}</p>`,
      buttons: [{ label: 'OK', primary: true, onClick: (close) => { close(); resolve(true); } }],
      onClose: () => resolve(true),
    });
  });
}

function statusDisplay(status, detail = '') {
  const map = {
    'no Connection': { cls: '', label: 'no Connection' },
    'connected': { cls: 'connected', label: 'connected' },
    'waiting': { cls: 'waiting', label: 'waiting' },
    'busy': { cls: 'busy', label: 'busy' },
    'timeout': { cls: '', label: 'timeout' },
    'error': { cls: '', label: 'error' },
  };
  const item = map[status] || map['no Connection'];
  connPill.className = `conn-pill ${item.cls}`.trim();
  connPill.textContent = item.label;
  statusLeft.textContent = detail ? `${item.label} - ${detail}` : item.label;
  state.connected = status === 'connected' || status === 'busy';
}

function onSerialStatus(status, detail) {
  statusDisplay(status, detail);
  if (status === 'connected' && state.prevSerialStatus !== 'connected' && state.prevSerialStatus !== 'busy') addLog('info', 'Connection established');
  if (status === 'no Connection' && state.prevSerialStatus !== 'no Connection') addLog('info', detail || 'Disconnected');
  state.prevSerialStatus = status;
}

function onPageChanged(index) {
  state.lastPage = index;
  const page = state.config.pages[index];
  statusRight.textContent = `VStabi 5.3.4 - 29.10.2012    ${pageTitle(page)}`;
  if (state.pageMenu) {
    for (const b of state.pageMenu.querySelectorAll('button[data-page]')) {
      b.classList.toggle('active-page', Number(b.dataset.page) === index);
      b.style.fontWeight = Number(b.dataset.page) === index ? '700' : '';
    }
  }
}

function onPageVisibilityChanged() {
  if (!state.ui) return;
  buildPageMenu();
  const active = state.config.pages[state.ui.active];
  if (active && active.pageVisible === false) {
    for (let i = 0; i < state.config.pages.length; i++) {
      if (state.config.pages[i].pageVisible !== false) {
        activatePage(state.ui, i);
        return;
      }
    }
  }
}

function buildPageMenu() {
  const menu = el('pageMenu');
  if (!menu || !state.config) return;
  menu.innerHTML = '';
  for (let i = 0; i < state.config.pages.length; i++) {
    const page = state.config.pages[i];
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.page = String(i);
    b.textContent = `${i + 1}. ${pageTitle(page)}`;
    const hidden = page.pageVisible === false;
    b.disabled = hidden;
    b.style.opacity = hidden ? '.45' : '';
    b.style.paddingLeft = '28px';
    if (!hidden) b.addEventListener('click', () => { activatePage(state.ui, i); closeMenus(); });
    menu.appendChild(b);
  }
  state.pageMenu = menu;
  if (state.ui) onPageChanged(state.ui.active);
}

function closeMenus() {
  for (const m of document.querySelectorAll('.menu.open')) m.classList.remove('open');
}

function showAbout() {
  openModal({
    title: 'About Setup VStabi',
    width: 480,
    body: `
      <div style="display:flex;gap:14px;align-items:flex-start">
        <img src="assets/ui/logo51_32x32.png" alt="" style="width:48px;height:48px">
        <div>
          <h3 style="margin-top:0">Setup VStabi 5.3.4</h3>
          <p>Web edition of the legacy VStabi PC setup application.</p>
          <p>Config: <b>${escapeHtml(state.config ? state.config.version : '5.3')}</b><br>
          Pages: ${state.config ? state.config.pages.length : 0}<br>
          Parameters: ${state.config ? state.config.params.length : 0}</p>
          <p class="hint">The UI, images and parameter formulas are taken from the original install. Bluetooth SPP works through the COM port created by Windows.</p>
        </div>
      </div>`,
    buttons: [{ label: 'OK', primary: true }],
  });
}

function showHelp() {
  openModal({
    title: 'Help',
    width: 600,
    body: `
      <h3>Bluetooth connection</h3>
      <ol>
        <li>Pair the VBar/KBar Bluetooth module in Windows Settings.</li>
        <li>Make sure Windows created an outgoing COM port for the device. If it did not, open <b>More Bluetooth options &gt; COM Ports &gt; Add</b> and create an outgoing port.</li>
        <li>Use Chrome or Edge on desktop and open this page from <code>http://127.0.0.1</code>.</li>
        <li>Close the old VStabi application so it does not hold the COM port.</li>
        <li>Click <b>Bluetooth</b>, then choose the Bluetooth COM port. The interface runs at <code>9600 8N1</code>.</li>
      </ol>
      <p class="hint">USB cable access is intentionally not supported. The original USB path uses Silicon Labs USBXpress, which browsers cannot open. The Bluetooth SPP COM port is supported.</p>
      <h3>Pages</h3>
      <p>The original <code>-n</code> mode hides the top-level page tabs. Use the navigation buttons inside the pages, or the <b>Parameter &gt; Go to Page</b> menu.</p>
      <h3>Protocol</h3>
      <p>The app polls with <code>C</code>, sends <code>S&lt;id&gt;:&lt;value&gt;;&lt;checksum&gt;</code>, and accepts <code>I&lt;id&gt;:&lt;value&gt;</code> telegrams. Checksums are the low byte of the character sum.</p>`,
    buttons: [{ label: 'OK', primary: true }],
  });
}

function showLog() {
  const body = document.createElement('div');
  const ta = document.createElement('textarea');
  ta.className = 'log';
  ta.readOnly = true;
  ta.value = state.log.join('\n');
  body.appendChild(ta);
  const info = document.createElement('p');
  info.className = 'hint';
  info.textContent = 'Serial traffic and application events.';
  body.appendChild(info);
  state.logModal = ta;
  openModal({
    title: 'Event Log',
    body,
    width: 720,
    buttons: [
      { label: 'Clear', onClick: () => { state.log = []; ta.value = ''; } },
      { label: 'Close', primary: true },
    ],
    onClose: () => { state.logModal = null; },
  });
}

async function showConnection() {
  const supported = SerialClient.supported();
  const body = document.createElement('div');
  body.innerHTML = `
    <h3>Bluetooth wireless connection</h3>
    <p>Pair the VBar/KBar Bluetooth adapter in Windows first. Windows normally creates an outgoing COM port. If it does not, add one in <b>More Bluetooth options &gt; COM Ports &gt; Add</b>. This page opens that COM port through the browser Web Serial API.</p>
    <ul>
      <li>Baud rate: <code>9600</code>, 8 data bits, 1 stop bit, no parity.</li>
      <li>Browser: Chrome or Edge on desktop, served from <code>localhost</code>.</li>
      <li>Close the old VStabi executable before connecting, so the COM port is free.</li>
      <li>USB cable access is not supported in the browser.</li>
    </ul>
    ${supported ? '' : '<p style="color:#a00"><b>Web Serial is not available in this browser.</b> Open the page in Chrome or Edge on desktop.</p>'}
    <div id="portList"></div>`;
  const portList = body.querySelector('#portList');
  if (supported) {
    try {
      const ports = await navigator.serial.getPorts();
      if (ports.length) {
        const head = document.createElement('p');
        head.innerHTML = '<b>Authorized ports</b>';
        portList.appendChild(head);
        for (const p of ports) {
          const b = document.createElement('button');
          b.type = 'button';
          b.style.margin = '0 4px 4px 0';
          b.textContent = 'Reconnect';
          b.addEventListener('click', async () => {
            try {
              await state.serial.reconnect(p);
              closeModal();
            } catch (err) {
              await alertDialog(err.message || String(err), 'Connection error');
            }
          });
          portList.appendChild(b);
        }
      }
    } catch (err) {}
  }
  const buttons = [];
  if (supported) {
    buttons.push({
      label: state.serial.portOpen ? 'Change Port' : 'Connect COM Port',
      primary: true,
      onClick: async (close) => {
        close();
        try {
          await state.serial.connect();
        } catch (err) {
          if (err && err.name === 'NotFoundError') return;
          await alertDialog(err.message || String(err), 'Connection error');
        }
      },
    });
  }
  if (state.serial.portOpen) {
    buttons.push({
      label: 'Disconnect',
      danger: true,
      onClick: async (close) => {
        close();
        await state.serial.disconnect();
      },
    });
  }
  buttons.push({
    label: 'Simulation',
    onClick: async (close) => {
      close();
      if (state.serial.portOpen) await state.serial.disconnect();
      state.serial.startSimulation();
      addLog('info', 'Simulation started');
    },
  });
  buttons.push({ label: 'Cancel' });
  openModal({ title: 'Bluetooth Connection', body, buttons, width: 620 });
}

function showPresetUnavailable() {
  openModal({
    title: 'Preset',
    body: '<p>Model preset selection requires the original model preset files. They are not part of the installed program directory used for this conversion.</p><p>Use <b>Load</b> to apply a saved <code>.vbr</code> parameter file instead.</p>',
    buttons: [{ label: 'OK', primary: true }],
  });
}

function triggerLoad() {
  fileInput.value = '';
  fileInput.click();
}

function saveFile() {
  if (!state.config) return;
  const lines = ['<?xml version="1.0" encoding="ISO-8859-1"?>', '<REGISTER>'];
  for (const p of state.config.params) {
    if (!p.readOnSave) continue;
    lines.push(`  <VALUE Register="${p.id}" Value="${escapeXml(state.store.get(p.id))}"/>`);
  }
  lines.push('</REGISTER>');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `vstabi-${state.config.version}-${new Date().toISOString().slice(0, 10)}.vbr`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  addLog('info', 'Parameter file saved');
}

async function loadFile(file) {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) {
    await alertDialog('The selected file is not a valid XML parameter file.', 'Load error');
    return;
  }
  const root = doc.documentElement;
  if (!root || root.localName !== 'REGISTER') {
    await alertDialog('The selected file does not contain a REGISTER element.', 'Load error');
    return;
  }
  const values = [];
  for (const n of root.children) {
    if (n.localName !== 'VALUE') continue;
    const id = Number.parseInt(n.getAttribute('Register'), 10);
    const value = Number.parseInt(n.getAttribute('Value'), 10);
    if (Number.isFinite(id) && Number.isFinite(value)) values.push({ id, value });
  }
  if (!values.length) {
    await alertDialog('No parameter values were found in the file.', 'Load error');
    return;
  }
  const known = values.filter((v) => state.store.param(v.id));
  const loadable = known.filter((v) => state.store.param(v.id).setOnLoad);
  const skipped = values.length - loadable.length;
  const fileVersion = values.find((v) => v.id === 109);
  const currentVersion = state.store.get(109);
  const versionWarning = fileVersion && fileVersion.value !== currentVersion
    ? `<p style="color:#8b1010"><b>File version register ${fileVersion.value} differs from the current configuration (${currentVersion}).</b> Check compatibility before applying.</p>`
    : '';
  const summary = document.createElement('div');
  summary.innerHTML = `<p>File: <b>${escapeHtml(file.name)}</b></p>
    <p>Values: ${values.length}<br>Known parameters: ${known.length}<br>Apply: ${loadable.length}<br>Skipped by SetOnLoad: ${skipped}</p>
    ${versionWarning}
    <p class="hint">Applying values sends changed serial parameters to the connected controller.</p>`;
  openModal({
    title: 'Load Parameters',
    body: summary,
    buttons: [
      { label: 'Cancel' },
      {
        label: 'Apply',
        primary: true,
        onClick: (close) => {
          close();
          for (const v of loadable) state.store.set(v.id, v.value, 0);
          addLog('info', `Loaded ${loadable.length} parameters from ${file.name}`);
        },
      },
    ],
  });
}

async function resetDefaults() {
  const ok = await confirmDialog('Reset every parameter to the values defined in config_53.xml?', 'Reset to Defaults');
  if (!ok) return;
  state.store.resetDefaults(0);
  addLog('info', 'All parameters reset to config defaults');
}

function setupMenus() {
  for (const menu of document.querySelectorAll('.menu')) {
    const label = menu.querySelector('span');
    label.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const open = menu.classList.contains('open');
      closeMenus();
      if (!open) menu.classList.add('open');
    });
  }
  document.addEventListener('click', () => closeMenus());
  document.querySelectorAll('.dropdown').forEach((d) => d.addEventListener('click', (ev) => ev.stopPropagation()));
  document.querySelectorAll('.dropdown button[data-action]').forEach((b) => {
    b.addEventListener('click', () => {
      closeMenus();
      const action = b.dataset.action;
      if (action === 'load') triggerLoad();
      else if (action === 'save') saveFile();
      else if (action === 'reset') resetDefaults();
      else if (action === 'help') showHelp();
      else if (action === 'log') showLog();
      else if (action === 'about') showAbout();
      else if (action === 'exit') closeWindow();
    });
  });
}

function closeWindow() {
  if (state.closed) return;
  state.closed = true;
  document.body.classList.add('is-closed');
  const overlay = document.createElement('div');
  overlay.className = 'closed-overlay';
  overlay.innerHTML = `<img src="assets/ui/logo51_32x32.png" alt=""><h2>Setup VStabi closed</h2><p>Reload the page to open the application again.</p><button type="button" id="reopenBtn">Reopen</button>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#reopenBtn').addEventListener('click', () => location.reload());
}

function setupWindowControls() {
  el('btnMin').addEventListener('click', () => document.body.classList.add('is-minimized'));
  el('btnRestore').addEventListener('click', () => document.body.classList.remove('is-minimized'));
  el('btnClose').addEventListener('click', closeWindow);
  el('btnMax').addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
      setTimeout(fitScale, 120);
    } catch (err) {}
  });
}

function fitScale() {
  const margin = 20;
  const sx = (window.innerWidth - margin) / 979;
  const sy = (window.innerHeight - margin) / 566;
  let scale = Math.min(sx, sy);
  scale = Math.max(0.55, Math.min(2.2, scale));
  document.documentElement.style.setProperty('--scale', String(scale));
}

function setupKeyboard() {
  document.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      const k = ev.key.toLowerCase();
      if (k === 'o' || k === 'l') {
        ev.preventDefault();
        triggerLoad();
      } else if (k === 's') {
        ev.preventDefault();
        saveFile();
      }
    }
    if (ev.key === 'Escape') {
      closeMenus();
      hideTooltip();
    }
  });
  document.addEventListener('dragenter', (ev) => {
    if (ev.dataTransfer && [...ev.dataTransfer.types].includes('Files')) ev.preventDefault();
  });
  document.addEventListener('dragover', (ev) => {
    if (ev.dataTransfer && [...ev.dataTransfer.types].includes('Files')) ev.preventDefault();
  });
  document.addEventListener('drop', async (ev) => {
    if (!ev.dataTransfer || !ev.dataTransfer.files || !ev.dataTransfer.files.length) return;
    ev.preventDefault();
    await loadFile(ev.dataTransfer.files[0]);
  });
}

async function init() {
  setupMenus();
  setupWindowControls();
  setupKeyboard();
  window.addEventListener('resize', fitScale);
  fitScale();
  statusDisplay('no Connection');
  const splash = document.createElement('div');
  splash.className = 'loading-overlay';
  splash.innerHTML = '<img src="assets/ui/logo51_32x32.png" alt=""><div>Loading VStabi 5.3 ...</div>';
  document.body.appendChild(splash);
  try {
    const config = await loadConfig('assets/config_53.xml');
    state.config = config;
    state.store = new ParameterStore(config.params);
    state.ui = buildUi(config, state.store, {
      confirm: confirmDialog,
      openUrl: (url) => window.open(url, '_blank', 'noopener'),
      onPageChanged,
      onPageVisibilityChanged,
    });
    buildPageMenu();
    state.store.addParamListener([997], (adj) => {
      const v = adj.value;
      if (v === 100) nextPage(state.ui, 1);
      else if (v === 101) nextPage(state.ui, -1);
      else if (v === 10101) showPresetUnavailable();
      else if (v >= 0 && v < state.config.pages.length) activatePage(state.ui, v);
    });
    state.store.addParamListener([996], () => showPresetUnavailable());
    state.store.addParamListener([998], () => showHelp());
    state.store.addParamListener([29], (adj) => {
      bankPill.textContent = `Bank ${adj.value}`;
    });
    state.store.addParamListener([498], (adj) => {
      if ((adj.value & 32) !== 0) addLog('info', `Status register 498=${adj.value}`);
    });
    bankPill.textContent = `Bank ${state.store.get(29)}`;
    state.serial = new SerialClient(state.store, {
      onStatus: onSerialStatus,
      onLog: (dir, text) => addLog(dir, text),
      onTelemetry: () => {},
    });
    el('btnConnect').addEventListener('click', showConnection);
    connPill.addEventListener('click', showConnection);
    el('btnLoad').addEventListener('click', triggerLoad);
    el('btnSave').addEventListener('click', saveFile);
    fileInput.addEventListener('change', async () => {
      if (fileInput.files && fileInput.files.length) await loadFile(fileInput.files[0]);
    });
    let first = 0;
    for (let i = 0; i < config.pages.length; i++) {
      if (config.pages[i].pageVisible !== false) { first = i; break; }
    }
    activatePage(state.ui, first);
    statusRight.textContent = `VStabi 5.3.4 - 29.10.2012    ${pageTitle(config.pages[first])}`;
    const qs = new URLSearchParams(location.search);
    if (qs.has('page')) {
      const target = Number.parseInt(qs.get('page'), 10);
      if (Number.isFinite(target)) activatePage(state.ui, target);
    }
    addLog('info', `Loaded config ${config.version}: ${config.pages.length} pages, ${config.params.length} parameters`);
    window.kbar = {
      config,
      store: state.store,
      ui: state.ui,
      serial: state.serial,
      loadFile,
      saveFile,
      showConnection,
      showAbout,
      showLog,
    };
  } catch (err) {
    console.error(err);
    splash.remove();
    await alertDialog(err.message || String(err), 'Startup error');
  } finally {
    splash.remove();
  }
}

init();
