// Device Event Log (ported from VStabiShell CErrorList).
// Protocol: send S107:63 (100 entries) or S107:64 (all entries); the
// controller answers with an I140 telegram per log entry (the original
// CErrorList listens on parameter 140, not on the request id 107). code < 240
// = new entry, code >= 240 sets delay = code-240+1 on the most recent entry.
// Time accumulates delays; codes 1/2/14 reset the relative time.
// Descriptions come from assets/errors.xml (locale -> English fallback),
// same as the original.
export const EVENT_LOG_PARAM = 107;      // request id (S107:<kind>)
export const EVENT_LOG_STREAM_PARAM = 140; // response id (I140:<code>)
// Original CErrorList: "Get 100 Entries" -> S107:63, "Get All Entries" -> S107:64.
export const EVENT_LOG_RECENT = 63; // last 100 entries
export const EVENT_LOG_ALL = 64;    // complete log

let catalog = null; // Map<number, {type, short:{lang:text}, long:{lang:text}}>
let catalogPromise = null;

async function loadCatalog() {
  const res = await fetch('assets/errors.xml', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Cannot load assets/errors.xml (${res.status})`);
  const buf = await res.arrayBuffer();
  // Original file is ISO-8859-1; decode explicitly so German umlauts survive.
  const xml = new TextDecoder('iso-8859-1').decode(buf);
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('errors.xml parse error');
  const map = new Map();
  for (const e of doc.getElementsByTagName('ERROR')) {
    const code = Number.parseInt(e.getAttribute('Code'), 10);
    if (!Number.isFinite(code)) continue;
    const entry = { type: e.getAttribute('Type') || 'Info', short: {}, long: {} };
    for (const t of e.getElementsByTagName('TEXT')) {
      const lang = (t.getAttribute('Lang') || 'en').toLowerCase();
      entry.short[lang] = (t.getAttribute('Short') || '').trim();
      entry.long[lang] = (t.textContent || '').replace(/\s+/g, ' ').trim();
    }
    map.set(code, entry);
  }
  return map;
}

export async function ensureErrorCatalog() {
  if (catalog) return catalog;
  if (!catalogPromise) catalogPromise = loadCatalog().catch((err) => { catalogPromise = null; throw err; });
  catalog = await catalogPromise;
  return catalog;
}

export function describeError(code, lang = 'en') {
  const entry = catalog ? catalog.get(code) : null;
  const l = (lang || 'en').toLowerCase();
  // The original returns "-- no description --" for codes missing from
  // errors.xml and falls back to English when the locale has no TEXT child.
  if (!entry) return { type: 'Info', short: '-- no description --', long: '' };
  return {
    type: entry.type,
    short: entry.short[l] || entry.short.en || '-- no description --',
    long: entry.long[l] || entry.long.en || '',
  };
}

export function formatLogTime(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Decode one streamed I140 value into the entry list (mutates entries).
// entries[0] is the most recent (Vector index 0 in the original).
// The value arrives already clamped to parameter 140's range (0..256) by
// the store; the clamp is repeated here so this function stays equivalent
// to the original CParameter.adjust -> CErrorListModel.add chain.
export function applyLogCode(entries, code) {
  if (!Number.isFinite(code)) return entries;
  let value = Math.round(code);
  if (value < 0) value = 0;
  if (value > 256) value = 256;
  if (value >= 240) {
    if (entries.length) entries[0].delay = value - 240 + 1;
    return entries;
  }
  entries.unshift({ code: value, delay: value === 0 ? 10 : 0, time: 0, timeAbsolute: 0 });
  return entries;
}

// Recompute time/timeAbsolute from delays (CErrorListModel.reload port).
export function recomputeLogTimes(entries) {
  let rel = 0;
  let abs = 0;
  for (const e of entries) {
    rel += e.delay;
    abs += e.delay;
    if (e.code === 14 || e.code === 1 || e.code === 2) rel = 0;
    e.time = rel;
    e.timeAbsolute = abs;
  }
  return entries;
}

export function createEventLog() {
  return { entries: [], fetching: false };
}
