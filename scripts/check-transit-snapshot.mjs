#!/usr/bin/env node
/** Fail-closed release preflight for a licensed, freshly generated last-train
 * timetable snapshot. Run before applying migrations or deploying an API. */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

export const DEFAULT_MAX_AGE_DAYS = 30;
const MAX_COMPRESSED_BYTES = 25 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 150 * 1024 * 1024;
const FUTURE_TOLERANCE_MS = 15 * 60 * 1000;

export function validateTransitSnapshot(snapshot, now = Date.now(), maxAgeDays = DEFAULT_MAX_AGE_DAYS) {
  if (!snapshot || typeof snapshot !== 'object' || snapshot.version !== 1) {
    throw new Error('Unsupported or corrupt transit snapshot version');
  }
  if (typeof snapshot.generatedAt !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(snapshot.generatedAt)) {
    throw new Error('Snapshot is missing an ISO generatedAt timestamp');
  }
  const created = Date.parse(snapshot.generatedAt);
  if (!Number.isFinite(created) || !/(Z|[+-]\d\d:\d\d)$/.test(snapshot.generatedAt)) {
    throw new Error('Snapshot generatedAt must be a valid timezone-aware timestamp');
  }
  const ageMs = now - created;
  if (ageMs < -FUTURE_TOLERANCE_MS) throw new Error('Snapshot generatedAt is unexpectedly in the future');
  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) throw new Error('Invalid snapshot max age');
  if (ageMs > maxAgeDays * 86400000) throw new Error(`Timetable snapshot is stale (> ${maxAgeDays} days)`);

  if (!Array.isArray(snapshot.sources) || !snapshot.sources.length ||
      !snapshot.sources.every((source) => source && typeof source.operator === 'string' && typeof source.license === 'string' && source.license.trim())) {
    throw new Error('Snapshot has no declared licensed data sources');
  }
  if (!Array.isArray(snapshot.stations) || !snapshot.stations.length) throw new Error('Snapshot contains no stations');
  if (!Array.isArray(snapshot.trips) || !snapshot.trips.length) throw new Error('Snapshot contains no train trips');
  if (!snapshot.services || typeof snapshot.services !== 'object' || !Object.keys(snapshot.services).length) {
    throw new Error('Snapshot contains no service calendar');
  }
  const stationCount = snapshot.stations.length;
  for (const station of snapshot.stations) {
    if (!station || typeof station.id !== 'string' ||
        !Number.isFinite(station.lat) || !Number.isFinite(station.lon) ||
        Math.abs(station.lat) > 90 || Math.abs(station.lon) > 180) {
      throw new Error('Snapshot contains invalid station coordinates or ids');
    }
  }
  for (const trip of snapshot.trips) {
    if (!trip || !Object.hasOwn(snapshot.services, trip.service) ||
        !Array.isArray(trip.stops) || trip.stops.length < 2) {
      throw new Error('Snapshot contains an invalid train service or too few trip stops');
    }
    for (const stop of trip.stops) {
      if (!Array.isArray(stop) || stop.length !== 3 || !Number.isInteger(stop[0]) ||
          stop[0] < 0 || stop[0] >= stationCount ||
          ![stop[1], stop[2]].every((minute) => minute === null || (Number.isFinite(minute) && minute >= 0 && minute <= 3000))) {
        throw new Error('Snapshot trip contains an invalid station or time');
      }
    }
  }
  return { ageDays: Math.max(0, ageMs / 86400000), stationCount, tripCount: snapshot.trips.length };
}

export function loadTransitSnapshot(filePath, now = Date.now(), maxAgeDays = DEFAULT_MAX_AGE_DAYS) {
  const input = readFileSync(filePath);
  if (!input.length || input.length > MAX_COMPRESSED_BYTES) throw new Error('Transit snapshot compressed file has invalid size');
  const plain = gunzipSync(input, { maxOutputLength: MAX_UNCOMPRESSED_BYTES });
  return validateTransitSnapshot(JSON.parse(plain.toString('utf8')), now, maxAgeDays);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const file = process.argv[2];
  const maxDays = Number(process.env.TRANSIT_SNAPSHOT_MAX_AGE_DAYS ?? DEFAULT_MAX_AGE_DAYS);
  if (!file) {
    console.error('Usage: node scripts/check-transit-snapshot.mjs <snapshot.json.gz>');
    process.exitCode = 2;
  } else {
    try {
      const report = loadTransitSnapshot(file, Date.now(), maxDays);
      console.log(`Timetable snapshot accepted: ${report.stationCount} stations, ${report.tripCount} trips, ${report.ageDays.toFixed(1)} days old`);
    } catch (err) {
      console.error(`Refusing timetable deployment: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  }
}
