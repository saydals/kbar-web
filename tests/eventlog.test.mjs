// Regression tests for the device event log (VStabiShell CErrorList port).
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  EVENT_LOG_PARAM,
  EVENT_LOG_STREAM_PARAM,
  EVENT_LOG_ALL,
  EVENT_LOG_RECENT,
  applyLogCode,
  recomputeLogTimes,
  formatLogTime,
  describeError,
  createEventLog,
} from '../js/eventlog.js';

test('request parameter ids match the original CErrorList', () => {
  assert.equal(EVENT_LOG_PARAM, 107, 'request id is S107');
  assert.equal(EVENT_LOG_STREAM_PARAM, 140, 'response id is I140');
});

test('"Get 100 Entries" requests S107:63, "Get All Entries" requests S107:64', () => {
  // Original CErrorList:
  //   GetButton ("Get 100 Entries")  -> p.adjust(..., 107, 63.0)
  //   jButton1 ("Get All Entries")  -> p.adjust(..., 107, 64.0)
  assert.equal(EVENT_LOG_RECENT, 63);
  assert.equal(EVENT_LOG_ALL, 64);

test('the time column uses the original "m:ss" format', () => {
  // Java CErrorListModel.getValueAt(column 2):
  //   s = err.time % 60; pad to 2 digits; s = (err.time / 60) + ":" + s
  assert.equal(formatLogTime(0), '0:00');
  assert.equal(formatLogTime(5), '0:05');
  assert.equal(formatLogTime(65), '1:05');
  assert.equal(formatLogTime(600), '10:00');
  assert.equal(formatLogTime(3661), '61:01');
});

  assert.notEqual(EVENT_LOG_ALL, EVENT_LOG_RECENT);
});


test('every decoded code from the captured stream exists in assets/errors.xml', async () => {
  const { DOMParser } = await import('@xmldom/xmldom');
  // The original errors.xml is ISO-8859-1; decode it explicitly.
  const buf = readFileSync(new URL('../assets/errors.xml', import.meta.url));
  const xml = new TextDecoder('iso-8859-1').decode(buf);
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const catalog = new Set();
  for (const e of doc.getElementsByTagName('ERROR')) {
    catalog.add(Number.parseInt(e.getAttribute('Code'), 10));
  }
  assert.ok(catalog.size > 0, 'errors.xml must not be empty');

  const codes = readFileSync(
    new URL('./fixtures/i140-codes.txt', import.meta.url),
    'utf8',
  ).split('\n').map((s) => s.trim()).filter(Boolean).map(Number);

  const missing = [...new Set(codes.filter((c) => c < 240 && !catalog.has(c)))];
  assert.deepEqual(missing, [], 'codes without a description in errors.xml');

test('the real error catalog loader describes the captured codes', async () => {
  const { DOMParser } = await import('@xmldom/xmldom');
  const { ensureErrorCatalog, describeError } = await import('../js/eventlog.js');
  const buf = readFileSync(new URL('../assets/errors.xml', import.meta.url));
  const originalFetch = globalThis.fetch;
  const originalParser = globalThis.DOMParser;
  // xmldom's Document has no querySelector; the app only uses it to detect
  // a parser error, so a minimal shim is enough for the test.
  class TestDOMParser extends DOMParser {
    parseFromString(src, mime) {
      const doc = super.parseFromString(src, mime);
      doc.querySelector = (sel) => doc.getElementsByTagName(sel)[0] || null;
      return doc;
    }
  }
  globalThis.DOMParser = TestDOMParser;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  });
  try {
    await ensureErrorCatalog();
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.DOMParser = originalParser;
  }

  // Code 0 is the "Good Health Message" entry with an initial delay of 10 s.
  const zero = describeError(0, 'en');
  assert.equal(zero.type, 'Good');
  assert.match(zero.short, /Good Health Message/);
  // Code 14 is a reset reason (the original greys out rows starting "Reset").
  const reset = describeError(14, 'en');
  assert.equal(reset.type, 'Good');
  assert.match(reset.short, /^Reset/);
  // Unknown codes fall back to the original's missing-description text.
  assert.equal(describeError(999, 'en').short, '-- no description --');
});

});


test('a code below 240 prepends a new entry (newest first)', () => {
  const entries = [];
  applyLogCode(entries, 42);
  applyLogCode(entries, 43);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].code, 43, 'newest entry first');
  assert.equal(entries[1].code, 42);
});

test('code 0 starts with a delay of 10 seconds', () => {
  const entries = [];
  applyLogCode(entries, 0);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].code, 0);
  assert.equal(entries[0].delay, 10, 'CErrorListModel.add sets delay=10 for code 0');
});

test('a non-zero code starts with a delay of 0', () => {
  const entries = [];
  applyLogCode(entries, 5);
  assert.equal(entries[0].delay, 0);
});

test('a code >= 240 sets delay = code - 240 + 1 on the newest entry', () => {
  const entries = [];
  applyLogCode(entries, 42);
  applyLogCode(entries, 240);
  assert.equal(entries.length, 1, 'no entry is appended');
  assert.equal(entries[0].delay, 1);
  applyLogCode(entries, 255);
  assert.equal(entries[0].delay, 16);
  applyLogCode(entries, 247);
  assert.equal(entries[0].delay, 8);
});

test('a delayed code without a preceding entry is ignored', () => {
  const entries = [];
  applyLogCode(entries, 245);
  assert.equal(entries.length, 0);
});

test('values are clamped to the range of parameter 140 (0..256)', () => {
  const entries = [];
  applyLogCode(entries, -5);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].code, 0, 'negative values are clamped to 0');
  // 300 is clamped to 256, which is >= 240 and therefore a delay, not a code.
  applyLogCode(entries, 300);
  assert.equal(entries.length, 1, 'a clamped value >= 240 stays a delay');
  assert.equal(entries[0].delay, 17, 'delay = 256 - 240 + 1');
});

test('delays accumulate into the relative and absolute time', () => {
  const entries = [];
  applyLogCode(entries, 5);   // new entry, delay 0
  applyLogCode(entries, 240); // delay 1 on the newest entry (code 5)
  applyLogCode(entries, 6);   // new entry, delay 0
  applyLogCode(entries, 241); // delay 2 on the newest entry (code 6)
  applyLogCode(entries, 7);   // new entry, delay 0
  recomputeLogTimes(entries);
  // Newest first: code 7 (delay 0), code 6 (delay 2), code 5 (delay 1).
  assert.deepEqual(entries.map((e) => e.delay), [0, 2, 1]);
  assert.deepEqual(entries.map((e) => e.time), [0, 2, 3]);
  assert.deepEqual(entries.map((e) => e.timeAbsolute), [0, 2, 3]);
});

test('codes 14, 1 and 2 reset the relative time but not the absolute time', () => {
  for (const resetCode of [14, 1, 2]) {
    const entries = [];
    applyLogCode(entries, resetCode); // oldest entry, delay 0
    applyLogCode(entries, 5);          // newer entry, delay 0
    applyLogCode(entries, 240);        // delay 1 on the newest entry
    recomputeLogTimes(entries);
    assert.equal(entries[0].time, 1, 'a newer entry keeps its relative time');
    assert.equal(entries[0].timeAbsolute, 1, 'the absolute time keeps counting');
    assert.equal(entries[1].time, 0, `code ${resetCode} resets the relative time`);
    assert.equal(entries[1].timeAbsolute, 1, 'the absolute time keeps counting');
  }
});

test('the relative time of an entry is the sum of the delays since the last reset', () => {
  const entries = [];
  applyLogCode(entries, 5);
  applyLogCode(entries, 240); // delay 1 on code 5
  applyLogCode(entries, 6);
  applyLogCode(entries, 240); // delay 1 on code 6
  applyLogCode(entries, 7);
  recomputeLogTimes(entries);
  assert.deepEqual(entries.map((e) => e.time), [0, 1, 2]);
  assert.deepEqual(entries.map((e) => e.timeAbsolute), [0, 1, 2]);
});

// Reference port of the original CErrorListModel.add()/reload() (Java),
// used to prove the web implementation behaves identically.
class JavaErr {
  constructor(code, delay) {
    this.code = code;
    this.delay = delay;
    this.time = 0;
    this.time_absolute = 0;
  }
}

function javaDecode(codes) {
  const Errors = [];
  for (const raw of codes) {
    let error = Math.round(raw);
    if (error < 0) error = 0;      // CParameter.adjust clamp to parameter 140
    if (error > 256) error = 256;
    if (error >= 240) {
      if (Errors.length) Errors[0].delay = error - 240 + 1;
    } else {
      Errors.unshift(new JavaErr(error, error === 0 ? 10 : 0));
    }
  }
  let time = 0;
  let time_absolute = 0;
  for (const err of Errors) {
    time += err.delay;
    time_absolute += err.delay;
    if (err.code === 14 || err.code === 1 || err.code === 2) time = 0;
    err.time = time;
    err.time_absolute = time_absolute;
  }
  return Errors;
}

function webDecode(codes) {
  const entries = [];
  for (const code of codes) applyLogCode(entries, code);
  recomputeLogTimes(entries);
  return entries;
}

test('the web decoder matches the original Java CErrorList on the captured stream', () => {
  const codes = readFileSync(
    new URL('./fixtures/i140-codes.txt', import.meta.url),
    'utf8',
  ).split('\n').map((s) => s.trim()).filter(Boolean).map(Number);

  assert.ok(codes.length > 0, 'capture fixture must not be empty');

  const java = javaDecode(codes);
  const web = webDecode(codes);

  assert.equal(web.length, java.length, 'entry count');
  assert.equal(web.length, 612, 'captured stream produces 612 entries');

  for (let i = 0; i < java.length; i++) {
    assert.equal(web[i].code, java[i].code, `code at ${i}`);
    assert.equal(web[i].delay, java[i].delay, `delay at ${i}`);
    assert.equal(web[i].time, java[i].time, `relative time at ${i}`);
    assert.equal(web[i].timeAbsolute, java[i].time_absolute, `absolute time at ${i}`);
  }
});

