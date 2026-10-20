import { SERIAL_SOURCE } from './model.js';
import { AndroidSerialPort, isAndroidNative } from './android.js';
import { EVENT_LOG_PARAM, EVENT_LOG_STREAM_PARAM } from './eventlog.js';

const BAUD = 9600;

function checksum(text) {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum += text.charCodeAt(i);
  return sum & 255;
}

export class SerialClient {
  constructor(store, handlers = {}) {
    this.store = store;
    this.handlers = handlers;
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.reading = false;
    this.portOpen = false;
    this.paramAck = true;
    this.queue = [];
    this.pumping = false;
    this.ackTimer = null;
    this.heartbeatTimer = null;
    this.idleTimer = null;
    this.lastTelegram = 0;
    this.buffer = '';
    this.decoder = new TextDecoder();
    this.writeChain = Promise.resolve();
    this.simulation = null;
    this.status = 'no Connection';
    this.store.addAllListener((adj) => {
      if (adj.sourceId === SERIAL_SOURCE) return;
      if (!this.portOpen || this.simulation) return;
      this.enqueue(adj);
    });
    if ('serial' in navigator) {
      navigator.serial.addEventListener('disconnect', (ev) => {
        if (ev.target === this.port) this.handlePortLost();
      });
    }
  }

  static supported() {
    return isAndroidNative() || 'serial' in navigator;
  }

  async connectAndroid(device) {
    if (!isAndroidNative()) throw new Error('Android Bluetooth transport is not available.');
    const port = new AndroidSerialPort(device);
    await this.openPort(port);
    return port;
  }

  setStatus(status, detail = '') {
    this.status = status;
    if (this.handlers.onStatus) this.handlers.onStatus(status, detail);
  }

  log(direction, text) {
    if (this.handlers.onLog) this.handlers.onLog(direction, text);
  }

  async connect() {
    if (isAndroidNative()) {
      throw new Error('Choose a paired SPP or nearby BLE device from the Bluetooth dialog.');
    }
    if (!SerialClient.supported()) {
      throw new Error('Web Serial is not available in this browser. Use Chrome or Edge on desktop over http://127.0.0.1.');
    }
    const port = await navigator.serial.requestPort();
    await this.openPort(port);
    return port;
  }

  async reconnect(port) {
    if (!port) throw new Error('No authorized port.');
    await this.openPort(port);
  }

  async openPort(port) {
    if (this.portOpen) await this.disconnect();
    this.port = port;
    this.setStatus('waiting', 'Opening port');
    const native = port instanceof AndroidSerialPort;
    if (native) {
      port.onLost = () => this.handlePortLost();
      this.log('info', `Opening ${port.label}`);
    } else {
      this.log('info', 'Opening serial port at 9600 8N1');
    }
    try {
      await port.open({
        baudRate: BAUD,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: 'none',
        bufferSize: 4096,
      });
    } catch (err) {
      this.port = null;
      this.portOpen = false;
      this.setStatus('no Connection', err.message || 'Open failed');
      throw err;
    }
    this.portOpen = true;
    this.reader = port.readable.getReader();
    this.writer = port.writable.getWriter();
    this.paramAck = true;
    this.queue = [];
    this.buffer = '';
    this.lastTelegram = Date.now();
    this.setStatus('connected', native ? 'Bluetooth link open' : 'COM port open');
    this.startReadLoop();
    this.heartbeatTimer = setInterval(() => this.heartbeat(), 2000);
    this.idleTimer = setInterval(() => this.checkIdle(), 1000);
    this.log('info', `Port opened: ${this.portLabel(port)}`);
    this.rawWrite('C\n');
    this.rawWrite('C\n');
    this.pump();
  }

  portLabel(port) {
    if (port && port.label) return port.label;
    try {
      const info = port.getInfo ? port.getInfo() : {};
      const v = info.usbVendorId !== undefined ? info.usbVendorId.toString(16) : '';
      const p = info.usbProductId !== undefined ? info.usbProductId.toString(16) : '';
      if (v || p) return `${v}:${p}`;
    } catch (err) {}
    return 'serial port';
  }

  startReadLoop() {
    this.reading = true;
    const loop = async () => {
      try {
        while (this.reading && this.reader) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value && value.length) this.feed(value);
        }
      } catch (err) {
        if (this.reading) {
          this.log('error', 'Read error: ' + err.message);
          this.handlePortLost();
        }
      }
    };
    loop();
  }

  feed(bytes) {
    const text = this.decoder.decode(bytes, { stream: true });
    this.buffer += text;
    if (this.buffer.length > 32768) this.buffer = this.buffer.slice(-8192);
    let idx;
    while ((idx = this.buffer.search(/[\r\n]/)) >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.trim()) this.handleLine(line.trim());
    }
  }

  handleLine(line) {
    this.log('rx', line);
    let payload = line;
    if (payload.includes(';')) {
      const p = payload.lastIndexOf(';');
      const sumText = payload.slice(p + 1).trim();
      const expected = Number.parseInt(sumText, 10);
      const body = payload.slice(0, p + 1);
      if (Number.isFinite(expected)) {
        const actual = checksum(body);
        if (actual !== expected) {
          this.log('error', `Checksum error (${actual} != ${expected})`);
          this.setStatus('timeout', 'Checksum error');
          return;
        }
        payload = body.slice(0, -1);
      }
    }
    this.lastTelegram = Date.now();
    if (this.status !== 'connected') this.setStatus('connected');
    if (payload.startsWith('B') && !payload.startsWith('BOO') && !payload.startsWith('B:')) {
      this.paramAck = true;
      if (this.ackTimer) {
        clearTimeout(this.ackTimer);
        this.ackTimer = null;
      }
      this.pump();
      if (!this.queue.length && this.paramAck) this.setStatus('connected');
      return;
    }
    if (payload.startsWith('I')) {
      const colon = payload.indexOf(':');
      if (colon < 0) return;
      const idText = payload.slice(1, colon);
      const valuesText = payload.slice(colon + 1);
      const id = Number.parseInt(idText, 10);
      if (!Number.isFinite(id)) return;
      const values = valuesText.trim().split(/\s+/).filter(Boolean);
      if (!values.length) return;
      if (id === EVENT_LOG_STREAM_PARAM) {
        // Device event-log stream: the controller answers S107 with I140
        // telegrams (one log code each), not with the request id 107.
        // The original also stores the code in parameter 140.
        // First stream telegram proves the request got through: stop retries.
        this.cancelEventLogRetry();
        for (const vs of values) {
          const value = Number.parseInt(vs, 10);
          if (!Number.isFinite(value)) continue;
          // The original stores the code in parameter 140 and notifies its
          // listeners with the *clamped* value (0..256 for that parameter).
          const stored = this.store.set(id, value, SERIAL_SOURCE);
          const code = stored === null || stored === undefined ? value : stored;
          if (this.handlers.onLogEntry) this.handlers.onLogEntry(id, code);
        }
        return;
      }
      for (const vs of values) {
        const value = Number.parseInt(vs, 10);
        if (Number.isFinite(value)) this.store.set(id, value, SERIAL_SOURCE);
      }
      if (this.handlers.onTelemetry) this.handlers.onTelemetry(id, valuesText);
      return;
    }
    if (payload.startsWith('R:')) {
      this.log('info', 'Bootloader reset message ignored');
      return;
    }
  }

  rawWrite(text) {
    if (!this.writer || !this.portOpen) return Promise.resolve();
    const data = new TextEncoder().encode(text);
    this.log('tx', text.replace(/\n/g, '\\n'));
    this.writeChain = this.writeChain.then(async () => {
      try {
        await this.writer.write(data);
      } catch (err) {
        this.log('error', 'Write error: ' + err.message);
        this.handlePortLost();
      }
    });
    return this.writeChain;
  }

  heartbeat() {
    // Only poll when idle: never pre-empt a queued write (e.g. S107 log
    // fetch) — at 9600 baud over SPP a colliding C can bury the request.
    if (!this.portOpen || !this.paramAck || this.queue.length) return;
    this.rawWrite('C\n');
  }

  checkIdle() {
    if (!this.portOpen) return;
    const age = Date.now() - this.lastTelegram;
    if (age > 8000) {
      if (this.status !== 'no Connection') this.setStatus('no Connection', 'No telemetry');
    } else if (age > 3500) {
      if (this.status !== 'waiting') this.setStatus('waiting', 'Waiting for telemetry');
    }
  }

  enqueue(adj) {
    const p = this.store.param(adj.parameter);
    if (!p || !p.sendSerial) return;
    if (adj.parameter === 999) {
      if (adj.value !== 1 && adj.value !== 11) return;
    }
    if (p.sendSerialOptimize) {
      for (let i = this.queue.length - 1; i >= 0; i--) {
        if (this.queue[i].parameter === adj.parameter) this.queue.splice(i, 1);
      }
    }
    this.queue.push({ parameter: adj.parameter, value: adj.value });
    this.pump();
  }

  // Device event-log request (S107:63 = recent 100, S107:64 = all entries).
  // Goes through the normal ack queue like the original CParameter.adjust:
  // responses stream back as I140 telegrams through onLogEntry.
  // Retried up to 3x: at 9600 baud over SPP a single wireless write can be
  // lost, and the controller only answers when it actually receives S107.
  requestEventLog(kind, attempt = 1) {
    if (!this.portOpen) throw new Error('Not connected.');
    const p = this.store.param(EVENT_LOG_PARAM);
    if (!p) throw new Error('Event log parameter (107) is not defined.');
    this.enqueue({ parameter: EVENT_LOG_PARAM, value: kind });
    if (attempt < 3) {
      if (this.eventLogRetry) clearTimeout(this.eventLogRetry);
      this.eventLogRetry = setTimeout(() => {
        this.eventLogRetry = null;
        if (!this.portOpen) return;
        if (this.handlers.onLogRetry) this.handlers.onLogRetry(attempt + 1);
        try { this.requestEventLog(kind, attempt + 1); } catch (err) {}
      }, 4000);
    }
  }

  cancelEventLogRetry() {
    if (this.eventLogRetry) {
      clearTimeout(this.eventLogRetry);
      this.eventLogRetry = null;
    }
  }

  pump() {
    if (!this.portOpen || !this.paramAck || this.pumping) return;
    if (!this.queue.length) return;
    this.pumping = true;
    const item = this.queue.shift();
    try {
      if (item.parameter === 999) {
        if (item.value === 1) this.rawWrite('A\n');
        this.paramAck = true;
        this.pumping = false;
        this.pump();
        return;
      }
      const body = `S${item.parameter}:${item.value};`;
      this.rawWrite(`${body}${checksum(body)}\n`);
      this.paramAck = false;
      this.setStatus('busy');
      if (this.ackTimer) clearTimeout(this.ackTimer);
      this.ackTimer = setTimeout(() => this.ackTimeout(item), 2000);
    } finally {
      this.pumping = false;
    }
  }

  ackTimeout(item) {
    this.ackTimer = null;
    if (this.paramAck) return;
    this.paramAck = true;
    // Event-log fetch (107) is answered by an I107 stream, not a B ack.
    // Only report a timeout when it is a normal parameter write.
    if (item.parameter !== EVENT_LOG_PARAM) {
      this.log('error', `Timeout waiting for ack of ${item.parameter}:${item.value}`);
      this.setStatus('timeout', `No ack for parameter ${item.parameter}`);
    }
    this.pump();
  }

  async disconnect() {
    if (this.simulation) {
      clearInterval(this.simulation);
      this.simulation = null;
    }
    this.reading = false;
    if (this.ackTimer) {
      clearTimeout(this.ackTimer);
      this.ackTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    try { if (this.reader) await this.reader.cancel(); } catch (err) {}
    try { if (this.reader) this.reader.releaseLock(); } catch (err) {}
    try { if (this.writer) this.writer.releaseLock(); } catch (err) {}
    try { if (this.port) await this.port.close(); } catch (err) {}
    this.reader = null;
    this.writer = null;
    this.port = null;
    this.portOpen = false;
    this.setStatus('no Connection');
    this.log('info', 'Port closed');
  }

  handlePortLost() {
    if (!this.portOpen) return;
    this.portOpen = false;
    this.reading = false;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.heartbeatTimer = null;
    this.idleTimer = null;
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.setStatus('no Connection', 'Port disconnected');
    this.log('error', 'Serial port disconnected');
  }

  startSimulation() {
    if (this.simulation) return;
    this.portOpen = true;
    this.lastTelegram = Date.now();
    this.setStatus('connected', 'Simulation');
    let tick = 0;
    this.simulation = setInterval(() => {
      tick++;
      this.lastTelegram = Date.now();
      const id = 130;
      const value = Math.round(300 * Math.sin(tick / 4) + (Math.random() * 40 - 20));
      this.handleLine(`I${id}:${value}`);
      if (tick % 6 === 0) this.handleLine('B1:1');
    }, 120);
  }

  stopSimulation() {
    if (this.simulation) clearInterval(this.simulation);
    this.simulation = null;
    this.portOpen = false;
    this.setStatus('no Connection');
  }
}
