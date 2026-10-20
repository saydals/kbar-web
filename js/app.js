import { loadConfig } from './config.js';
import { ParameterStore } from './model.js';
import { buildUi, activatePage, nextPage } from './ui.js';
import { getLang, ensureLang, trShell, trBank } from './i18n.js';
import { SerialClient } from './serial.js';
import { installKeypad } from './keypad.js';
import { isAndroidNative, requestAndroidPermissions, listAndroidBondedDevices, scanAndroidBleDevices } from './android.js';
import {
  EVENT_LOG_ALL, EVENT_LOG_RECENT,
  ensureErrorCatalog, describeError, formatLogTime,
  applyLogCode, recomputeLogTimes, createEventLog,
} from './eventlog.js';

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

let ioFlashTimer = null;

function flashIo(direction) {
  const btn = el('btnConnect');
  if (!btn) return;
  btn.classList.toggle('io-rx', direction === 'rx');
  btn.classList.toggle('io-tx', direction === 'tx');
  if (ioFlashTimer) clearTimeout(ioFlashTimer);
  ioFlashTimer = setTimeout(() => {
    btn.classList.remove('io-rx', 'io-tx');
    ioFlashTimer = null;
  }, 220);
}

function addLog(direction, text) {
  const stamp = new Date().toLocaleTimeString();
  state.log.push(`[${stamp}] ${direction.toUpperCase()} ${text}`);
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
  if (state.logModal) state.logModal.value = state.log.join('\n');
  if (direction === 'rx' || direction === 'tx') flashIo(direction);
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
      title: trShell(title),
      body: `<p style="white-space:pre-wrap">${escapeHtml(trShell(message))}</p>`,
      buttons: [
        { label: trShell('Cancel'), onClick: (close) => { resolve(false); close(); } },
        { label: trShell('OK'), primary: true, onClick: (close) => { resolve(true); close(); } },
      ],
      onClose: () => resolve(false),
    });
  });
}

function alertDialog(message, title = 'Information') {
  return new Promise((resolve) => {
    openModal({
      title: trShell(title),
      body: `<p style="white-space:pre-wrap">${escapeHtml(trShell(message))}</p>`,
      buttons: [{ label: trShell('OK'), primary: true, onClick: (close) => { close(); resolve(true); } }],
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
  const label = trShell(item.label);
  const connected = status === 'connected' || status === 'busy';
  const btn = el('btnConnect');
  if (btn) {
    btn.classList.toggle('connected', connected);
    btn.dataset.status = status;
    btn.title = detail ? `${label} - ${detail}` : label;
    btn.setAttribute('aria-label', btn.title);
  }
  state.connected = connected;
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
  if (menuLayer) menuLayer.innerHTML = '';
  menuLayerMenu = null;
}

function showAbout() {
  openModal({
    title: trShell('About Setup VStabi'),
    width: 480,
    body: `
      <div style="display:flex;gap:14px;align-items:flex-start">
        <img src="assets/ui/logo51_32x32.png" alt="" style="width:48px;height:48px">
        <div>
          <h3 style="margin-top:0">Setup VStabi 5.3.4</h3>
          <p>${isAndroidNative() ? 'Android edition of the legacy VStabi PC setup application.' : 'Web edition of the legacy VStabi PC setup application.'}</p>
          <p>Config: <b>${escapeHtml(state.config ? state.config.version : '5.3')}</b><br>
          Pages: ${state.config ? state.config.pages.length : 0}<br>
          Parameters: ${state.config ? state.config.params.length : 0}</p>
          <p class="hint">The UI, images and parameter formulas are taken from the original install. ${isAndroidNative() ? 'Bluetooth SPP and BLE links are provided by the native Android transport.' : 'Bluetooth SPP works through the COM port created by Windows.'}</p>
        </div>
      </div>`,
    buttons: [{ label: trShell('OK'), primary: true }],
  });
}

function showHelp() {
  const connectionHelp = isAndroidNative()
    ? `<h3>Bluetooth connection</h3>
      <ol>
        <li>Turn on Bluetooth and pair the VBar/KBar module in Android Bluetooth settings when using SPP.</li>
        <li>Tap <b>Bluetooth</b>, then choose the paired SPP module or a nearby BLE module found by the scan.</li>
        <li>Wait for the connection status to turn <b>connected</b>. The interface runs at <code>9600 8N1</code>.</li>
        <li>Use the same dialog to disconnect or switch modules.</li>
      </ol>
      <p class="hint">The Android app supports raw SPP and BLE serial streams. USB cable access is not supported.</p>`
    : `<h3>Bluetooth connection</h3>
      <ol>
        <li>Pair the VBar/KBar Bluetooth module in Windows Settings.</li>
        <li>Make sure Windows created an outgoing COM port for the device. If it did not, open <b>More Bluetooth options &gt; COM Ports &gt; Add</b> and create an outgoing port.</li>
        <li>Use Chrome or Edge on desktop and open this page from <code>http://127.0.0.1</code>.</li>
        <li>Close the old VStabi application so it does not hold the COM port.</li>
        <li>Click <b>Bluetooth</b>, then choose the Bluetooth COM port. The interface runs at <code>9600 8N1</code>.</li>
      </ol>
      <p class="hint">USB cable access is intentionally not supported. The original USB path uses Silicon Labs USBXpress, which browsers cannot open. The Bluetooth SPP COM port is supported.</p>`;
  openModal({
    title: trShell('Help'),
    width: 600,
    body: `
      ${connectionHelp}
      <h3>Pages</h3>
      <p>The original <code>-n</code> mode hides the top-level page tabs. Use the navigation buttons inside the pages, or the <b>Parameter &gt; Go to Page</b> menu.</p>
      <h3>Protocol</h3>
      <p>The app polls with <code>C</code>, sends <code>S&lt;id&gt;:&lt;value&gt;;&lt;checksum&gt;</code>, and accepts <code>I&lt;id&gt;:&lt;value&gt;</code> telegrams. Checksums are the low byte of the character sum.</p>`,
    buttons: [{ label: trShell('OK'), primary: true }],
  });
}

const TYPE_ICON = { Good: '✅', Info: 'ℹ️', Warning: '⚠️', Critical: '🔶', Error: '❌' };

async function showLog() {
  // Device Event Log (ported from VStabiShell CErrorList):
  // Get All Entries (S107:64) / Get 100 Entries (S107:63) fetch the log
  // stored on the controller; Close dismisses. No Save (per request).
  const elog = createEventLog();
  state.eventLog = elog;
  const body = document.createElement('div');
  body.className = 'event-log';
  body.innerHTML = `
    <p class="hint event-log-status">${escapeHtml(trShell('Connect the controller, then fetch its stored log.'))}</p>
    <div class="event-log-table-wrap"><table class="event-log-table">
      <thead><tr><th></th><th>Error</th><th>Time</th><th>Descr.</th></tr></thead>
      <tbody></tbody>
    </table></div>`;
  const statusEl = body.querySelector('.event-log-status');
  const tbody = body.querySelector('tbody');
  const setStatus = (text) => { statusEl.textContent = text; };
  const render = () => {
    tbody.innerHTML = '';
    if (!elog.entries.length) {
      const tr = document.createElement('tr');
      tr.className = 'event-log-empty';
      const td = document.createElement('td');
      td.colSpan = 4;
      td.textContent = trShell('No entries yet. Use Get All Entries or Get 100 Entries.');
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    for (const e of elog.entries) {
      // Original matches the system locale, then English. The catalog has
      // no Korean entries, so Korean UI falls through to English.
      const d = describeError(e.code, getLang() === 'kor' ? 'ko' : 'en');
      const shown = d;
      const tr = document.createElement('tr');
      const icon = document.createElement('td');
      icon.className = 'event-log-icon';
      icon.textContent = TYPE_ICON[shown.type] || '•';
      icon.title = shown.type;
      const code = document.createElement('td');
      code.className = 'event-log-code';
      code.textContent = String(e.code);
      const time = document.createElement('td');
      time.className = 'event-log-time';
      time.textContent = formatLogTime(e.time);
      const descr = document.createElement('td');
      descr.className = 'event-log-descr';
      descr.textContent = shown.short;
      descr.title = shown.long || shown.short;
      // Original CErrorListCellRenderer greys out rows whose description
      // starts with "Reset" (e.g. code 14 "Reset Reason: Power On").
      if (shown.short.startsWith('Reset')) tr.className = 'event-log-reset';
      tr.append(icon, code, time, descr);
      tbody.appendChild(tr);
    }
    const wrap = body.querySelector('.event-log-table-wrap');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
  };
  const refreshButtons = () => {
    for (const b of body.querySelectorAll('button[data-fetch]')) b.disabled = elog.fetching;
  };
  render();
  try {
    await ensureErrorCatalog();
  } catch (err) {
    setStatus(`${trShell('Load error')}: ${err.message || err}`);
  }
  const fetchLog = async (kind) => {
    if (!state.serial || !state.serial.portOpen) {
      setStatus(trShell('Not connected. Connect the controller first.'));
      return;
    }
    elog.entries = [];
    elog.fetching = true;
    render();
    refreshButtons();
    setStatus(trShell('Fetching log from controller ...'));
    try {
      state.serial.requestEventLog(kind);
    } catch (err) {
      elog.fetching = false;
      refreshButtons();
      setStatus(err.message || String(err));
    }
    // Fetch ends on idle timeout (see onLogEntry): original re-enables its
    // buttons ~10 ticks after the last telegram.
  };
  const onEntry = () => {
    recomputeLogTimes(elog.entries);
    render();
  };
  elog.onEntry = onEntry;
  elog.setStatus = setStatus;
  elog.render = render;
  elog.refreshButtons = refreshButtons;
  const getAllBtn = document.createElement('button');
  getAllBtn.type = 'button';
  getAllBtn.dataset.fetch = 'all';
  getAllBtn.textContent = trShell('Get All Entries');
  getAllBtn.addEventListener('click', () => fetchLog(EVENT_LOG_ALL));
  const get100Btn = document.createElement('button');
  get100Btn.type = 'button';
  get100Btn.dataset.fetch = 'recent';
  get100Btn.textContent = trShell('Get 100 Entries');
  get100Btn.addEventListener('click', () => fetchLog(EVENT_LOG_RECENT));
  body.append(getAllBtn, get100Btn);
  refreshButtons();
  openModal({
    title: trShell('Event Log'),
    body,
    width: 720,
    buttons: [{ label: trShell('Close'), primary: true }],
    onClose: () => {
      elog.fetching = false;
      if (elog.idleTimer) clearTimeout(elog.idleTimer);
      if (state.serial) state.serial.cancelEventLogRetry();
      if (state.eventLog === elog) state.eventLog = null;
    },
  });
}

function onLogEntry(id, value) {
  const elog = state.eventLog;
  if (!elog) return;
  applyLogCode(elog.entries, value);
  if (elog.idleTimer) clearTimeout(elog.idleTimer);
  // End of stream = idle gap. The controller streams the log as a tight
  // burst of I140 telegrams (~0.16s apart, interleaved with telemetry),
  // so a short quiet gap means the fetch is done (original: ~10 quiet
  // ticks of its 100ms timer).
  elog.idleTimer = setTimeout(() => {
    elog.fetching = false;
    if (elog.setStatus) {
      elog.setStatus(elog.entries.length
        ? `${elog.entries.length} entries`
        : 'No entries received.');
    }
    if (elog.refreshButtons) elog.refreshButtons();
  }, 1500);
  if (elog.onEntry) elog.onEntry();
}

async function showAndroidConnection() {
  const body = document.createElement('div');
  body.innerHTML = `
    <h3>${escapeHtml(trShell('Bluetooth connection'))}</h3>
    <p>${escapeHtml(trShell('Connect to a paired SPP module or scan for a nearby BLE module. The link uses the same VStabi protocol at 9600 8N1 over a raw Bluetooth stream.'))}</p>
    <div id="androidCurrent"></div>
    <div id="androidSpp"></div>
    <div id="androidBle"></div>
    <p class="hint" id="androidLinkStatus"></p>`;
  const currentEl = body.querySelector('#androidCurrent');
  const sppEl = body.querySelector('#androidSpp');
  const bleEl = body.querySelector('#androidBle');
  const statusEl = body.querySelector('#androidLinkStatus');
  const setStatus = (text) => { statusEl.textContent = text || ''; };
  let busy = false;

  const section = (host, title) => {
    const h = document.createElement('p');
    h.innerHTML = `<b>${escapeHtml(trShell(title))}</b>`;
    host.appendChild(h);
    return h;
  };
  const note = (host, text) => {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = trShell(text);
    host.appendChild(p);
  };
  const deviceButton = (device, subtitle) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'android-device-btn';
    const name = document.createElement('b');
    name.textContent = device.name;
    const meta = document.createElement('span');
    meta.textContent = subtitle || device.address;
    b.appendChild(name);
    b.appendChild(meta);
    b.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      b.disabled = true;
      setStatus(`${trShell('Connecting to')} ${device.name} ...`);
      try {
        await state.serial.connectAndroid(device);
        closeModal();
      } catch (err) {
        setStatus('');
        await alertDialog(err.message || String(err), trShell('Connection error'));
      } finally {
        busy = false;
        b.disabled = false;
      }
    });
    return b;
  };

  async function refresh() {
    if (busy) return;
    busy = true;
    currentEl.innerHTML = '';
    sppEl.innerHTML = '';
    bleEl.innerHTML = '';
    try {
      if (state.serial.portOpen) {
        section(currentEl, 'Current link');
        const p = document.createElement('p');
        p.className = 'hint';
        p.textContent = state.serial.port ? state.serial.port.label : trShell('connected');
        currentEl.appendChild(p);
      }
      setStatus(trShell('Requesting Bluetooth permission ...'));
      try {
        await requestAndroidPermissions();
      } catch (err) {
        setStatus(`${trShell('Bluetooth permission')}: ${err.message || err}`);
      }

      setStatus(trShell('Loading paired devices ...'));
      try {
        const bonded = (await listAndroidBondedDevices()).filter((d) => d.type !== 2);
        section(sppEl, 'Paired devices (SPP)');
        if (!bonded.length) note(sppEl, 'No paired devices. Pair the module in Android Bluetooth settings first.');
        const sppList = document.createElement('div');
        sppList.className = 'android-device-list';
        sppEl.appendChild(sppList);
        for (const d of bonded) sppList.appendChild(deviceButton(d, d.address));
      } catch (err) {
        section(sppEl, 'Paired devices (SPP)');
        note(sppEl, `Cannot list paired devices: ${err.message || err}`);
      }

      setStatus(trShell('Scanning for BLE devices ...'));
      section(bleEl, 'Nearby BLE devices');
      const bleList = document.createElement('div');
      bleList.className = 'android-device-list';
      bleEl.appendChild(bleList);
      try {
        const ble = await scanAndroidBleDevices();
        if (!ble.length) note(bleList, 'No supported BLE module found.');
        for (const d of ble) bleList.appendChild(deviceButton(d, `${d.address}  ${d.rssi || ''} dBm`));
      } catch (err) {
        note(bleList, `BLE scan failed: ${err.message || err}`);
      }
      setStatus('');
    } finally {
      busy = false;
    }
  }

  const buttons = [
    { label: trShell('Rescan'), onClick: () => refresh() },
  ];
  if (state.serial.portOpen) {
    buttons.push({
      label: trShell('Disconnect'),
      danger: true,
      onClick: async (close) => {
        close();
        await state.serial.disconnect();
      },
    });
  }
  buttons.push({
    label: trShell('Simulation'),
    onClick: async (close) => {
      close();
      if (state.serial.portOpen) await state.serial.disconnect();
      state.serial.startSimulation();
      addLog('info', 'Simulation started');
    },
  });
  buttons.push({ label: trShell('Cancel') });

  openModal({ title: trShell('Bluetooth Connection'), body, buttons, width: 620 });
  refresh();
}

async function showConnection() {
  if (isAndroidNative()) {
    await showAndroidConnection();
    return;
  }
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
        head.innerHTML = `<b>${escapeHtml(trShell('Authorized ports'))}</b>`;
        portList.appendChild(head);
        for (const p of ports) {
          const b = document.createElement('button');
          b.type = 'button';
          b.style.margin = '0 4px 4px 0';
          b.textContent = trShell('Reconnect');
          b.addEventListener('click', async () => {
            try {
              await state.serial.reconnect(p);
              closeModal();
            } catch (err) {
              await alertDialog(err.message || String(err), trShell('Connection error'));
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
      label: state.serial.portOpen ? trShell('Change Port') : trShell('Connect COM Port'),
      primary: true,
      onClick: async (close) => {
        close();
        try {
          await state.serial.connect();
        } catch (err) {
          if (err && err.name === 'NotFoundError') return;
          await alertDialog(err.message || String(err), trShell('Connection error'));
        }
      },
    });
  }
  if (state.serial.portOpen) {
    buttons.push({
      label: trShell('Disconnect'),
      danger: true,
      onClick: async (close) => {
        close();
        await state.serial.disconnect();
      },
    });
  }
  buttons.push({
    label: trShell('Simulation'),
    onClick: async (close) => {
      close();
      if (state.serial.portOpen) await state.serial.disconnect();
      state.serial.startSimulation();
      addLog('info', 'Simulation started');
    },
  });
  buttons.push({ label: trShell('Cancel') });
  openModal({ title: trShell('Bluetooth Connection'), body, buttons, width: 620 });
}

function showPresetUnavailable() {
  openModal({
    title: trShell('Preset'),
    body: '<p>Model preset selection requires the original model preset files. They are not part of the installed program directory used for this conversion.</p><p>Use <b>Load</b> to apply a saved <code>.vbr</code> parameter file instead.</p>',
    buttons: [{ label: trShell('OK'), primary: true }],
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
    await alertDialog(trShell('The selected file is not a valid XML parameter file.'), trShell('Load error'));
    return;
  }
  const root = doc.documentElement;
  if (!root || root.localName !== 'REGISTER') {
    await alertDialog(trShell('The selected file does not contain a REGISTER element.'), trShell('Load error'));
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
    await alertDialog(trShell('No parameter values were found in the file.'), trShell('Load error'));
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
    title: trShell('Load Parameters'),
    body: summary,
    buttons: [
      { label: trShell('Cancel') },
      {
        label: trShell('Apply'),
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
  const ok = await confirmDialog(trShell('Reset every parameter to the values defined in config_53.xml?'), trShell('Reset to Defaults'));
  if (!ok) return;
  state.store.resetDefaults(0);
  addLog('info', 'All parameters reset to config defaults');
}

function setupMenus() {
  applyShellText();
  for (const menu of document.querySelectorAll('.menu')) {
    const label = menu.querySelector('span');
    label.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const open = menu.classList.contains('open');
      closeMenus();
      if (!open) openMenu(menu);
    });
  }
  document.addEventListener('click', () => closeMenus());
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeMenus(); });
  window.addEventListener('resize', closeMenus);
  document.querySelectorAll('.dropdown').forEach((d) => d.addEventListener('click', (ev) => ev.stopPropagation()));
  document.querySelectorAll('.dropdown button[data-action]').forEach((b) => {
    b.addEventListener('click', async () => {
      closeMenus();
      const action = b.dataset.action;
      if (action === 'load') triggerLoad();
      else if (action === 'save') saveFile();
      else if (action === 'reset') resetDefaults();
      else if (action === 'help') showHelp();
      else if (action === 'log') showLog();
      else if (action === 'about') showAbout();
      else if (action === 'lang-eng') switchLang('eng');
      else if (action === 'lang-kor') switchLang('kor');
      else if (action === 'exit') closeWindow();
    });
  });
}

let menuLayer = null;
let menuLayerMenu = null;

function openMenu(menu) {
  // Show the dropdown in a body-level layer so the scaled .app-window
  // stacking context cannot trap it under page widgets.
  closeMenus();
  const dd = menu.querySelector('.dropdown');
  if (!dd) return;
  if (!menuLayer) {
    menuLayer = document.createElement('div');
    menuLayer.className = 'menu-layer';
    document.body.appendChild(menuLayer);
    menuLayer.addEventListener('click', (ev) => ev.stopPropagation());
    menuLayer.addEventListener('mousedown', (ev) => {
      if (ev.target === menuLayer) closeMenus();
    });
  }
  menuLayer.innerHTML = '';
  const hostRect = menu.getBoundingClientRect();
  const scale = Number(getComputedStyle(document.documentElement).getPropertyValue('--scale')) || 1;
  const appWin = document.querySelector('.app-window');
  const appRect = appWin ? appWin.getBoundingClientRect() : null;
  // Dropdown is positioned in unscaled page coordinates.
  const clone = dd.cloneNode(true);
  clone.classList.add('menu-clone');
  clone.style.display = 'block';
  clone.style.position = 'fixed';
  const inSidebar = !!menu.closest('.sidebar');
  const topLayout = document.body.classList.contains('layout-top');
  const sideMenu = inSidebar && !topLayout;
  // Original is display:none in all layouts (clone is shown instead), so measure
  // the clone off-screen: its natural width before fixed positioning.
  clone.style.visibility = 'hidden';
  clone.style.display = 'block';
  menuLayer.appendChild(clone);
  const rawW = Math.max(clone.scrollWidth || 0, menu.offsetWidth || 0, topLayout ? 300 : 190);
  menuLayer.removeChild(clone);
  clone.style.visibility = '';
  let left = sideMenu ? hostRect.right + 2 : hostRect.left;
  let top = sideMenu ? hostRect.top : hostRect.bottom;
  if (left + rawW > window.innerWidth - 4) left = Math.max(4, hostRect.left - rawW - 2);
  if (top + 60 > window.innerHeight) top = Math.max(4, window.innerHeight - 60);
  clone.style.left = `${left}px`;
  clone.style.top = `${top}px`;
  clone.style.zIndex = '40000';
  // Match unscaled width (scrollWidth is post-scale, divide out).
  // Skip in layout-top: CSS min-width (300px) must win, otherwise the
  // Parameter page-list dropdown gets squashed by the stale inline width.
  if (!topLayout) clone.style.minWidth = `${Math.round(rawW / (scale || 1))}px`;
  else clone.style.minWidth = '';
  menuLayer.appendChild(clone);
  menu.classList.add('open');
  menuLayerMenu = menu;
  // Wire clone buttons to the originals (same data-action dispatch).
  clone.querySelectorAll('button[data-action], button[data-page]').forEach((cb) => {
    cb.addEventListener('click', () => {
      const key = cb.dataset.action || `page:${cb.dataset.page}`;
      closeMenus();
      const orig = dd.querySelector(
        cb.dataset.action ? `button[data-action="${cb.dataset.action}"]` : `button[data-page="${cb.dataset.page}"]`
      );
      if (orig) orig.click();
      else if (key.startsWith('page:')) {
        const idx = Number(cb.dataset.page);
        if (Number.isFinite(idx) && state.ui) activatePage(state.ui, idx);
      }
    });
  });
}

function applyShellText() {
  const menuText = { file: 'File', parameter: 'Parameter', info: 'Info' };
  for (const menu of document.querySelectorAll('.menu')) {
    const span = menu.querySelector('span');
    const key = menu.dataset.menu;
    if (span && key && menuText[key]) span.textContent = trShell(menuText[key]);
  }
  for (const b of document.querySelectorAll('.dropdown button[data-action]')) {
    const a = b.dataset.action;
    if (a === 'lang-eng' || a === 'lang-kor') continue;
    const src = b.dataset.en || (b.dataset.en = b.textContent.trim());
    if (src) b.textContent = trShell(src);
  }
  for (const s of document.querySelectorAll('.submenu-label')) {
    const src = s.dataset.en || (s.dataset.en = s.textContent.trim());
    if (src) s.textContent = trShell(src);
  }
  const tbText = { btnLoad: 'Load', btnSave: 'Save', btnConnect: 'Bluetooth' };
  for (const [id, src] of Object.entries(tbText)) {
    const btn = el(id);
    const span = btn ? btn.querySelector('span') : null;
    if (span) span.textContent = trShell(src);
  }
  const tbTitle = {
    btnLoad: 'Load actual Bank from File',
    btnSave: 'Save actual Bank to File',
    btnConnect: isAndroidNative() ? 'Connect Bluetooth (SPP / BLE)' : 'Connect Bluetooth SPP COM port',
  };
  for (const [id, src] of Object.entries(tbTitle)) {
    const btn = el(id);
    if (btn) btn.title = trShell(src);
  }
  bankPill.title = trShell('Active bank');
  const exitBtn = el('btnExit');
  if (exitBtn) {
    exitBtn.textContent = trShell('Exit');
    exitBtn.title = trShell('Exit');
  }
  const winTitle = { btnMin: 'Minimize', btnMax: 'Maximize', btnClose: 'Close' };
  for (const [id, src] of Object.entries(winTitle)) {
    const btn = el(id);
    if (btn) btn.title = trShell(src);
  }
  const restore = el('btnRestore');
  if (restore) restore.textContent = trShell('Restore');
  markLang();
  refreshStatusTexts();
}

function markLang() {
  const lang = getLang();
  for (const b of document.querySelectorAll('.dropdown button[data-action^="lang-"]')) {
    b.classList.toggle('active-lang', (b.dataset.action === 'lang-kor') === (lang === 'kor'));
  }
}

function refreshStatusTexts() {
  statusDisplay(state.serial ? state.serial.status : state.prevSerialStatus);
  if (state.store) bankPill.textContent = trBank(state.store.get(29));
}

async function switchLang(lang) {
  if (getLang() === lang) { markLang(); return; }
  if (lang === 'kor') {
    try { await ensureLang('kor'); }
    catch (err) {
      await alertDialog('Cannot load lang_kr.xml. Staying in English.', 'Language');
      return;
    }
  } else { await ensureLang('eng'); }
  const savedPage = state.ui ? state.ui.active : state.lastPage;
  if (state.config && state.store) {
    const live = new Map();
    for (const p of state.store.allParams()) live.set(p.id, state.store.get(p.id));
    state.config = await loadConfig('assets/config_53.xml');
    for (const [id, v] of live) {
      if (state.store.param(id)) state.store.values[id] = v;
    }
    state.store.clearParamListeners();
    pagesRoot.innerHTML = '';
    state.ui = buildUi(state.config, state.store, {
      confirm: confirmDialog,
      openUrl: (url) => window.open(url, '_blank', 'noopener'),
      onPageChanged,
      onPageVisibilityChanged,
    });
    wireStoreListeners();
    state.ui.refresh();
    buildPageMenu();
    activatePage(state.ui, savedPage);
  }
  applyShellText();
  addLog('info', `Language: ${lang}`);
}

function wireStoreListeners() {
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
    bankPill.textContent = trBank(adj.value);
  });
  state.store.addParamListener([498], (adj) => {
    if ((adj.value & 32) !== 0) addLog('info', `Status register 498=${adj.value}`);
  });
}


function closeWindow() {
  const app = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
  if (app && typeof app.exitApp === 'function') {
    Promise.resolve(app.exitApp()).catch(() => showClosedOverlay());
    return;
  }
  showClosedOverlay();
}

function showClosedOverlay() {
  if (state.closed) return;
  state.closed = true;
  document.body.classList.add('is-closed');
  const overlay = document.createElement('div');
  overlay.className = 'closed-overlay';
  overlay.innerHTML = `<img src="assets/ui/logo51_32x32.png" alt=""><h2>${escapeHtml(trShell('Setup VStabi closed'))}</h2><p>${escapeHtml(trShell('Reload the page to open the application again.'))}</p><button type="button" id="reopenBtn">${escapeHtml(trShell('Reopen'))}</button>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#reopenBtn').addEventListener('click', () => location.reload());
}

function setupWindowControls() {
  const restore = el('btnRestore');
  if (restore) restore.addEventListener('click', () => document.body.classList.remove('is-minimized'));
}

function fitScale() {
  const margin = 20;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const sideScale = Math.min((vw - margin) / 1079, (vh - margin) / 477);
  const sideHeight = 477 * sideScale;
  const useTop = vh - sideHeight > vh * 0.12;
  document.body.classList.toggle('layout-top', useTop);
  const frame = document.querySelector('.app-window');
  const frameW = frame ? frame.offsetWidth : 1079;
  const frameH = frame ? frame.offsetHeight : 477;
  const sx = (vw - margin) / frameW;
  const sy = (vh - margin) / frameH;
  let scale = Math.min(sx, sy);
  scale = Math.max(0.55, Math.min(2.6, scale));
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
  if (isAndroidNative()) {
    document.body.classList.add('is-android');
    installKeypad();
  }
  await ensureLang(getLang());
  setupMenus();
  setupWindowControls();
  setupKeyboard();
  window.addEventListener('resize', fitScale);
  fitScale();
  statusDisplay('no Connection');
  const splash = document.createElement('div');
  splash.className = 'loading-overlay';
  splash.innerHTML = `<img src="assets/ui/logo51_32x32.png" alt=""><div>${escapeHtml(trShell('Loading VStabi 5.3 ...'))}</div>`;
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
    wireStoreListeners();
    bankPill.textContent = trBank(state.store.get(29));
    state.serial = new SerialClient(state.store, {
      onStatus: onSerialStatus,
      onLog: (dir, text) => addLog(dir, text),
      onTelemetry: () => {},
      onLogEntry,
      onLogRetry: (attempt) => {
        const elog = state.eventLog;
        if (elog && elog.setStatus) elog.setStatus(trShell('Retrying log request ...') + ` (${attempt}/3)`);
      },
    });
    el('btnConnect').addEventListener('click', showConnection);
    const exitBtn = el('btnExit');
    if (exitBtn) exitBtn.addEventListener('click', closeWindow);
    fileInput.addEventListener('change', async () => {
      if (fileInput.files && fileInput.files.length) await loadFile(fileInput.files[0]);
    });
    let first = 0;
    for (let i = 0; i < config.pages.length; i++) {
      if (config.pages[i].pageVisible !== false) { first = i; break; }
    }
    activatePage(state.ui, first);
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
    await alertDialog(err.message || String(err), trShell('Startup error'));
  } finally {
    splash.remove();
  }
}

init();
