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

const STORAGE_KEY = 'lastride-earlier-trains';

type Store = { night: string; entries: Record<string, TrainTime[]> };
let memory: Store | null = null;

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

const sameTrains = (a: TrainTime[], b: TrainTime[]) =>
  a.length === b.length && a.every((train, index) => train.departsAt === b[index].departsAt);

/**
 * The fuller list of the two: `found` by this search, or what was found for
 * this station and destination earlier tonight (only trains before `last`).
 * A list as long as the remembered one wins, so a changed timetable still comes
 * through. Remembers the answer.
 */
export async function rememberEarlierTrains(
  fromNameJa: string,
  toNameJa: string,
  last: TrainTime,
  found: TrainTime[],
  nowMs: number,
): Promise<TrainTime[]> {
  const store = await load(serviceDate(nowMs));
  const key = `${fromNameJa}→${toNameJa}`;
  const known = (store.entries[key] ?? []).filter((train) => train.departsAt < last.departsAt);
  const best = found.length >= known.length ? found : known;
  if (!sameTrains(best, store.entries[key] ?? [])) {
    store.entries[key] = best;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(store)).catch(() => undefined);
  }
  return best;
}

/** Tests only. */
export function resetEarlierTrainsMemory() {
  memory = null;
}
