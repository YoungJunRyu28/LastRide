/**
 * Tonight's trains before the last one (1本前, 2本前), remembered per station
 * and destination. Apple's lookup of them is unreliable (MapKit request limits,
 * a slow answer), so a later search of the same station that finds fewer must
 * not take away a train the user has already seen. Kept on disk as well, for
 * the background task and a relaunch; forgotten at the next service night.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { serviceDate } from '@/lib/time';
import type { TrainTime } from '@/lib/timetable';
import { EARLIER_TRAIN_COUNT, EARLIER_TRAINS_WINDOW_MS } from '@/lib/appleTransit';

const STORAGE_KEY = 'lastride-earlier-trains';

type Entry = { last: number; trains: TrainTime[] };
type Store = { night: string; entries: Record<string, Entry> };
let memory: Store | null = null;

const sameTrains = (a: TrainTime[], b: TrainTime[]) =>
  a.length === b.length && a.every((train, index) => train.departsAt === b[index].departsAt);

async function load(night: string): Promise<Store> {
  if (memory?.night === night) return memory;
  try {
    const saved = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? 'null') as Store | null;
    memory = saved?.night === night && saved.entries ? saved : { night, entries: {} };
  } catch {
    memory = { night, entries: {} };
  }
  return memory;
}

/** The same train from two answers (server and Apple can differ by a minute). */
const SAME_TRAIN_MS = 90_000;

/**
 * Tonight's earlier trains for this station and destination: what this search
 * found, plus anything found before for the same last train (the same night,
 * the same departure), latest first, at most EARLIER_TRAIN_COUNT. A different
 * last train (another night, or a later one found since) starts afresh, so
 * a list is never shown for a train it doesn't belong to. Remembers the answer.
 */
export async function rememberEarlierTrains(
  fromNameJa: string,
  toNameJa: string,
  last: TrainTime,
  found: TrainTime[],
): Promise<TrainTime[]> {
  // The night the last train belongs to (00:10 is still the night before), not the
  // time of the call: a re-plan at 04:30 or 22:00 can't mix up two nights.
  const store = await load(serviceDate(last.departsAt));
  const key = `${fromNameJa}→${toNameJa}`;
  const saved = store.entries[key];
  const known = saved && saved.last === last.departsAt ? saved.trains : [];
  const earliest = last.departsAt - EARLIER_TRAINS_WINDOW_MS;
  // This search's answers first (a remembered copy of the same train is dropped), then by time.
  const merged: TrainTime[] = [];
  for (const train of [...found, ...known]) {
    if (train.departsAt >= last.departsAt || train.departsAt < earliest) continue;
    if (merged.some((kept) => Math.abs(kept.departsAt - train.departsAt) < SAME_TRAIN_MS)) continue;
    merged.push(train);
  }
  const best = merged.sort((a, b) => b.departsAt - a.departsAt).slice(0, EARLIER_TRAIN_COUNT);
  const sameAsFound = best.length === found.length && best.every((train, index) => train === found[index]);
  if (!saved || saved.last !== last.departsAt || !sameTrains(best, saved.trains)) {
    store.entries[key] = { last: last.departsAt, trains: best };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(store)).catch(() => undefined);
  }
  return sameAsFound ? found : best;
}

/** Tests only. */
export function resetEarlierTrainsMemory() {
  memory = null;
}
