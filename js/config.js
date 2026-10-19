import { child, children, attr, num, bool, text } from './xml.js';
import { tr } from './i18n.js';
import { compile, references } from './expression.js';

function parseItems(el) {
  const itemsEl = child(el, 'ITEMS');
  const items = [];
  for (const it of children(itemsEl, 'ITEM')) {
    items.push({
      name: attr(it, 'Name', ''),
      value: num(it, 'Value', 0),
      label: tr(attr(it, 'Text', '') || attr(it, 'Name', '')),
    });
  }
  return items;
}

function parseParameter(el) {
  const pEl = child(el, 'PARAMETER');
  if (!pEl) return null;
  const eingangEl = child(pEl, 'EINGANG');
  const eingangFormel = child(eingangEl, 'FORMEL');
  const eingang = eingangFormel ? attr(eingangFormel, 'Berechnung', '') : '';
  const ausgang = [];
  const ausgangEl = child(pEl, 'AUSGANG');
  for (const f of children(ausgangEl, 'FORMEL')) {
    const expr = attr(f, 'Berechnung', '');
    ausgang.push({
      expr,
      register: num(f, 'Register', -1),
      fn: compile(expr),
    });
  }
  return {
    eingang,
    eingangFn: compile(eingang),
    eingangRefs: references(eingang),
    ausgang,
  };
}

function parseObject(el) {
  const pos = child(el, 'POSITION');
  const color = child(el, 'COLOR');
  const settings = child(el, 'SETTINGS');
  const fontEl = child(el, 'FONT');
  const imageEl = child(el, 'IMAGE');
  const tooltipEl = child(el, 'TOOLTIP');
  const type = attr(el, 'Type', '');
  const obj = {
    type,
    name: attr(el, 'Name', ''),
    text: '',
    x: num(pos, 'x', 0),
    y: num(pos, 'y', 0),
    w: num(pos, 'Width', 100),
    h: num(pos, 'Height', 100),
    bg: attr(color, 'rgb', '#f0f0f0'),
    fg: attr(color, 'f_rgb', '#000000'),
    opaque: bool(color, 'Opaque', type === 'Panel'),
    border: num(settings, 'Border', 0),
    alignment: num(settings, 'Alignment', 0),
    fraction: num(settings, 'Fraction', 0),
    orientation: num(settings, 'Orientation', 0),
    minimum: num(settings, 'Minimum', 0),
    maximum: num(settings, 'Maximum', 100),
    minorTick: num(settings, 'MinorTickSpacing', 0),
    majorTick: num(settings, 'MajorTickSpacing', 0),
    labelIncrement: num(settings, 'LabelIncrement', 20),
    channelSelector: num(settings, 'ChannelSelector', 0),
    hideText: num(settings, 'HideText', 0),
    nachfrage: num(settings, 'Nachfrage', 0),
    lineMode: num(settings, 'LineMode', 0),
    startParam: num(settings, 'StartParam', 83),
    minimumParam: num(settings, 'MinimumParam', 89),
    pitchParam: num(settings, 'PitchParam', 104),
    image: imageEl ? attr(imageEl, 'Path', '') : '',
    tooltip: tooltipEl ? tr(text(tooltipEl, attr(tooltipEl, 'Value', ''))) : '',
    fontName: attr(fontEl, 'Name', ''),
    fontStyle: num(fontEl, 'Style', 0),
    fontSize: num(fontEl, 'Size', 11),
    items: [],
    children: [],
    param: parseParameter(el),
    el: null,
    ui: null,
    sourceId: 0,
    visible: true,
    value: 0,
  };
  const textEl = child(el, 'TEXT');
  if (textEl) obj.text = tr(text(textEl, attr(textEl, 'Value', '')));
  if (type === 'Combo' || type === 'SwitchImage') obj.items = parseItems(el);
  for (const c of children(el, 'UI_OBJECT')) obj.children.push(parseObject(c));
  return obj;
}

export async function loadConfig(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Cannot load ${url} (${res.status})`);
  const xml = await res.text();
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const perr = doc.querySelector('parsererror');
  if (perr) throw new Error('Config XML parse error: ' + perr.textContent.slice(0, 300));
  const root = doc.documentElement;
  const params = [];
  const paramRoot = child(root, 'PARAMETER');
  for (const p of children(paramRoot, 'PAR')) {
    params.push({
      id: num(p, 'Id', -1),
      name: attr(p, 'Name', ''),
      value: num(p, 'Value', 0),
      min: num(p, 'Minimum', -127),
      max: num(p, 'Maximum', 127),
      setOnLoad: bool(p, 'SetOnLoad', true),
      readOnSave: bool(p, 'ReadOnSave', true),
      sendSerial: bool(p, 'SendSerial', true),
      sendSerialOptimize: bool(p, 'SendSerialOptimize', true),
      receiveSerial: bool(p, 'ReciveSerial', true),
      type: num(p, 'Type', 0),
      log: bool(p, 'Log', false),
    });
  }
  const types = [];
  const typeRoot = child(root, 'TYPELIST');
  for (const t of children(typeRoot, 'TYPE')) {
    types.push({
      id: num(t, 'Id', 0),
      name: attr(t, 'Name', ''),
      descr: attr(t, 'Descr', ''),
      text: tr(text(t, attr(t, 'Descr', ''))),
    });
  }
  const pages = [];
  for (const el of children(root, 'UI_OBJECT')) pages.push(parseObject(el));
  const pageByName = new Map(pages.map((p, i) => [p.name, i]));
  return {
    version: attr(root, 'Version', '0.0'),
    frameW: num(root, 'W', 979),
    frameH: num(root, 'H', 566),
    params,
    types,
    pages,
    pageByName,
  };
}
