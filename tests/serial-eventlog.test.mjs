// Integration test for the serial telegram path that feeds the event log.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

import { ParameterStore, SERIAL_SOURCE } from '../js/model.js';
import { SerialClient } from '../js/serial.js';
import {
  EVENT_LOG_PARAM,
  EVENT_LOG_STREAM_PARAM,
  EVENT_LOG_ALL,
  EVENT_LOG_RECENT,
  applyLogCode,
} from '../js/eventlog.js';

// Mirrors assets/config_53.xml: parameter 140 is the "Error Message"
// parameter with Minimum="0" Maximum="256".
const PARAMS = [
  { id: 107, name: 'Informationsmessage Parameter auf 118', value: 50, min: 0, max: 255, sendSerial: true },
  { id: 140, name: 'Error Message', value: 247, min: 0, max: 256, sendSerial: true },
];

function makeClient(seen) {
  const store = new ParameterStore(PARAMS);
  const client = new SerialClient(store, {
    onLogEntry: (id, value) => seen.push([id, value]),
  });
  // Avoid touching navigator/serial in a non-browser environment.
  client.portOpen = true;
  return { client, store };
}

test('an I140 telegram is delivered to onLogEntry with the stored value', () => {
  const seen = [];
  const { client } = makeClient(seen);
  client.handleLine('I140:42');
  assert.deepEqual(seen, [[140, 42]]);
});

test('the I140 value is clamped to the parameter range (0..256)', () => {
  const seen = [];
  const { client } = makeClient(seen);
  client.handleLine('I140:300');
  assert.deepEqual(seen, [[140, 256]], 'clamped to the parameter maximum');
  seen.length = 0;
  client.handleLine('I140:-10');
  assert.deepEqual(seen, [[140, 0]], 'clamped to the parameter minimum');
});

test('a telegram carrying several values yields one entry per value', () => {
  const seen = [];
  const { client } = makeClient(seen);
  client.handleLine('I140:1 2 3');
  assert.deepEqual(seen, [[140, 1], [140, 2], [140, 3]]);
});

test('a telegram with a bad checksum is dropped', () => {
  const seen = [];
  const { client } = makeClient(seen);
  client.handleLine('I140:42;999');
  assert.deepEqual(seen, [], 'a corrupt telegram must not reach the log');
});

test('other parameter telegrams are not treated as log entries', () => {
  const seen = [];
  const { client } = makeClient(seen);
  client.handleLine('I107:50');
  assert.deepEqual(seen, []);
});

test('the request is queued as S107 with the requested kind', (t) => {
  const seen = [];
  const { client } = makeClient(seen);
  client.pump = () => {}; // do not actually write, just inspect the queue
  t.after(() => client.cancelEventLogRetry());
  client.requestEventLog(EVENT_LOG_ALL);
  assert.deepEqual(client.queue, [{ parameter: EVENT_LOG_PARAM, value: 64 }]);
  client.queue.length = 0;
  client.requestEventLog(EVENT_LOG_RECENT);
  assert.deepEqual(client.queue, [{ parameter: EVENT_LOG_PARAM, value: 63 }]);
});

test('a full serial round trip decodes the same entries as the pure decoder', () => {
  const seen = [];
  const { client } = makeClient(seen);
  const entries = [];
  for (const code of [5, 240, 6, 241, 0]) {
    client.handleLine(`I140:${code}`);
  }
  for (const [, value] of seen) applyLogCode(entries, value);
  assert.deepEqual(entries.map((e) => e.code), [0, 6, 5]);
  assert.deepEqual(entries.map((e) => e.delay), [10, 2, 1]);
  assert.equal(EVENT_LOG_STREAM_PARAM, 140);
  assert.equal(SERIAL_SOURCE, 1);
});
