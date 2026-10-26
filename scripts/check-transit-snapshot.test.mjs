import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';
import { loadTransitSnapshot, validateTransitSnapshot } from './check-transit-snapshot.mjs';

const now = Date.UTC(2026, 9, 16);
function fresh() {
  return {
    version: 1,
    generatedAt: new Date(now - 2 * 86400000).toISOString(),
    sources: [{ operator: 'odpt.Operator:TokyoMetro', format: 'odpt', license: 'ODPT basic', url: 'https://example.test' }],
    stations: [
      { id: 'shibuya', lat: 35.66, lon: 139.7 },
      { id: 'omote', lat: 35.66, lon: 139.71 },
    ],
    services: { daily: { dayTypes: ['weekday'] } },
    trips: [{ service: 'daily', stops: [[0, 1380, 1381], [1, 1400, 1401]] }],
  };
}

test('accepts a valid, fresh ODPT timetable and reports age/counts', () => {
  assert.deepEqual(validateTransitSnapshot(fresh(), now), { ageDays: 2, stationCount: 2, tripCount: 1 });
});
test('blocks stale timetables and timestamp spoofing', () => {
  const snap = fresh();
  snap.generatedAt = new Date(now - 31 * 86400000).toISOString();
  assert.throws(() => validateTransitSnapshot(snap, now), /stale/);
  snap.generatedAt = new Date(now + 1 * 86400000).toISOString();
  assert.throws(() => validateTransitSnapshot(snap, now), /future/);
  snap.generatedAt = '2026-10-16T00:00:00';
  assert.throws(() => validateTransitSnapshot(snap, now), /timezone/);
});
test('rejects malformed, empty and incompatible provider snapshots', () => {
  for (const change of [
    (snap) => { snap.version = 2; },
    (snap) => { snap.stations = []; },
    (snap) => { snap.trips = []; },
    (snap) => { snap.services = {}; },
    (snap) => { snap.sources = []; },
    (snap) => { snap.sources[0].license = ''; },
    (snap) => { snap.stations[0].lat = NaN; },
    (snap) => { snap.trips[0].service = 'missing'; },
    (snap) => { snap.trips[0].stops[1][0] = 100; },
    (snap) => { snap.trips[0].stops[1][1] = Infinity; },
  ]) {
    const snap = fresh(); change(snap);
    assert.throws(() => validateTransitSnapshot(snap, now));
  }
});
test('loads valid gzip and rejects corrupt/truncated and oversized compressed data', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lastride-transit-'));
  const file = path.join(dir, 'data.gz');
  try {
    writeFileSync(file, gzipSync(JSON.stringify(fresh())));
    assert.equal(loadTransitSnapshot(file, now).tripCount, 1);
    writeFileSync(file, Buffer.from('not gzip'));
    assert.throws(() => loadTransitSnapshot(file, now));
    writeFileSync(file, Buffer.alloc(25 * 1024 * 1024 + 1));
    assert.throws(() => loadTransitSnapshot(file, now), /size/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
