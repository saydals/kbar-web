const BLE_PROFILES = [
  { name: 'CC2541', service: '0000ffe0-0000-1000-8000-00805f9b34fb', write: '0000ffe1-0000-1000-8000-00805f9b34fb', notify: '0000ffe2-0000-1000-8000-00805f9b34fb' },
  { name: 'HM-10', service: '0000ffe1-0000-1000-8000-00805f9b34fb', write: '0000ffe1-0000-1000-8000-00805f9b34fb', notify: '0000ffe1-0000-1000-8000-00805f9b34fb' },
  { name: 'HC-05', service: '00001101-0000-1000-8000-00805f9b34fb', write: '00001101-0000-1000-8000-00805f9b34fb', notify: '00001101-0000-1000-8000-00805f9b34fb' },
  { name: 'Nordic NUS', service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', write: '6e400002-b5a3-f393-e0a9-e50e24dcca9e', notify: '6e400003-b5a3-f393-e0a9-e50e24dcca9e' },
  { name: 'DroneBridge', service: '0000db32-0000-1000-8000-00805f9b34fb', write: '0000db33-0000-1000-8000-00805f9b34fb', notify: '0000db34-0000-1000-8000-00805f9b34fb' },
  { name: 'SpeedyBee V1', service: '00001000-0000-1000-8000-00805f9b34fb', write: '00001001-0000-1000-8000-00805f9b34fb', notify: '00001002-0000-1000-8000-00805f9b34fb' },
  { name: 'SpeedyBee V2', service: '0000abf0-0000-1000-8000-00805f9b34fb', write: '0000abf1-0000-1000-8000-00805f9b34fb', notify: '0000abf2-0000-1000-8000-00805f9b34fb' },
  { name: 'SpeedyBee FF00', service: '000000ff-0000-1000-8000-00805f9b34fb', write: '0000ff01-0000-1000-8000-00805f9b34fb', notify: '0000ff02-0000-1000-8000-00805f9b34fb' },
];

let wired = false;
const activePorts = new Set();

function plugin() {
  return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.RfBle;
}

export function isAndroidNative() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && plugin());
}

function base64ToBytes(b64) {
  if (!b64) return new Uint8Array(0);
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array(value);
}

function ensureWired() {
  const p = plugin();
  if (!p || wired) return p;
  wired = true;
  p.addListener('dataReceived', (event) => {
    const bytes = base64ToBytes(event && event.data);
    if (!bytes.length) return;
    for (const port of activePorts) port._feed(bytes);
  });
  p.addListener('disconnected', () => {
    for (const port of activePorts) port._lost();
  });
  return p;
}

export async function requestAndroidPermissions() {
  const p = ensureWired();
  if (!p) throw new Error('Native Bluetooth plugin is not available.');
  try { await p.requestPerms(); } catch (err) {
    if (err && /already/i.test(String(err.message || err))) return;
    throw err;
  }
}

export async function listAndroidBondedDevices() {
  const p = ensureWired();
  if (!p) return [];
  const result = await p.getBondedDevices();
  const devices = (result && result.devices) || [];
  return devices.map((d) => ({
    kind: 'spp',
    name: d.name || d.address,
    address: d.address,
    type: d.type,
  }));
}

export async function scanAndroidBleDevices() {
  const p = ensureWired();
  if (!p) return [];
  const result = await p.getDevices({ serviceUuids: [] });
  const devices = (result && result.devices) || [];
  return devices.map((d) => ({
    kind: 'ble',
    name: d.name || d.address,
    address: d.address,
    serviceUuid: d.serviceUuid,
    writeCharacteristic: d.writeCharacteristic,
    notifyCharacteristic: d.notifyCharacteristic,
    rssi: d.rssi,
  }));
}

export function bleProfiles() {
  return BLE_PROFILES.slice();
}

export class AndroidSerialPort {
  constructor(device) {
    this.device = device;
    this.kind = device.kind;
    this.label = `${device.kind === 'spp' ? 'SPP' : 'BLE'} ${device.name || device.address}`;
    this._open = false;
    this._closing = false;
    this._ctrl = null;
    this._readable = null;
    this._writable = null;
    this._backlog = [];
    this.onLost = null;
  }

  get readable() { return this._readable; }
  get writable() { return this._writable; }

  getInfo() {
    return { usbVendorId: 0, usbProductId: 0 };
  }

  async open() {
    const p = ensureWired();
    if (!p) throw new Error('Native Bluetooth plugin is not available.');
    if (this._open) return;

    this._backlog = [];
    this._readable = new ReadableStream({
      start: (controller) => {
        this._ctrl = controller;
        this._drain();
      },
      cancel: () => { this._ctrl = null; },
    });
    this._writable = new WritableStream({
      write: async (chunk) => {
        const bytes = toBytes(chunk);
        if (!bytes.length) return;
        const data = bytesToBase64(bytes);
        if (this.kind === 'spp') await p.sendSPP({ data });
        else await p.send({ data });
      },
    });

    activePorts.add(this);
    try {
      if (this.kind === 'spp') {
        const result = await p.connectSPP({ address: this.device.address });
        this.label = `SPP ${(result && result.name) || this.device.name || this.device.address}`;
      } else {
        const result = await p.connect({
          address: this.device.address,
          serviceUuid: this.device.serviceUuid,
          writeCharacteristic: this.device.writeCharacteristic,
          notifyCharacteristic: this.device.notifyCharacteristic,
        });
        this.label = `BLE ${(result && result.name) || this.device.name || this.device.address}`;
      }
    } catch (err) {
      activePorts.delete(this);
      try { this._ctrl && this._ctrl.close(); } catch (e) {}
      this._ctrl = null;
      this._readable = null;
      this._writable = null;
      throw err;
    }
    this._open = true;
    this._drain();
  }

  _drain() {
    if (!this._ctrl) return;
    while (this._backlog.length) {
      try { this._ctrl.enqueue(this._backlog.shift()); }
      catch (err) { break; }
    }
  }

  _feed(bytes) {
    if (!this._open || !this._ctrl) {
      if (this._backlog.length < 64) this._backlog.push(bytes.slice());
      return;
    }
    try { this._ctrl.enqueue(bytes.slice()); }
    catch (err) {
      if (this._backlog.length < 64) this._backlog.push(bytes.slice());
    }
  }

  _lost() {
    if (!this._open || this._closing) return;
    this._open = false;
    activePorts.delete(this);
    try { this._ctrl && this._ctrl.close(); } catch (err) {}
    this._ctrl = null;
    if (this.onLost) this.onLost();
  }

  async close() {
    if (this._closing) return;
    this._closing = true;
    const wasOpen = this._open;
    this._open = false;
    activePorts.delete(this);
    try { this._ctrl && this._ctrl.close(); } catch (err) {}
    this._ctrl = null;
    this._backlog = [];
    if (wasOpen) {
      const p = plugin();
      if (p) {
        try {
          if (this.kind === 'spp') await p.sppDisconnect();
          else await p.disconnect();
        } catch (err) {}
      }
    }
    this._closing = false;
  }
}
