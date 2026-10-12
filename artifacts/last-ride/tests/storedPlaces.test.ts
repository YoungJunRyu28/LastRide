import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const key of keys) storage.delete(key);
    }),
  },
}));

import { readSettings, STORAGE_KEYS, writeDestinationState, type SavedDestination } from '@/lib/settings';
import { addressForDisk, rememberTonight, resolveAddress, resolveStation, stationForDisk } from '@/lib/storedPlaces';

const HOUR = 60 * 60 * 1000;
const tonight = Date.UTC(2026, 9, 12, 13, 0); // 22:00 in Japan
const tomorrow = tonight + 24 * HOUR;

const motomachi = { name: 'Motomachi-Chukagai', nameJa: '元町・中華街', latitude: 35.4425, longitude: 139.6506, regionJa: '神奈川県横浜市中区' };
const oshiageOdpt = { name: 'Oshiage', nameJa: '押上', latitude: 35.7106, longitude: 139.8136, regionJa: '東京都', source: 'odpt' as const };
const address = { label: '神奈川県横浜市中区山下町1', latitude: 35.444, longitude: 139.648 };

describe('what is stored long-term', () => {
  beforeEach(() => storage.clear());

  it('keeps ODPT stations, and only the name and area of other stations', () => {
    expect(stationForDisk(oshiageOdpt)).toEqual(oshiageOdpt);
    expect(stationForDisk(motomachi)).toMatchObject({ nameJa: '元町・中華街', regionJa: '神奈川県横浜市中区', latitude: 0, longitude: 0 });
  });

  it('keeps only the text of an address', () => {
    expect(addressForDisk(address)).toEqual({ label: address.label, latitude: 0, longitude: 0 });
  });

  it('saves destinations without Apple positions, and reads them back with tonight\'s positions', async () => {
    const destinations: SavedDestination[] = [{ id: 'home', label: 'Home', station: motomachi, address }];
    await writeDestinationState(destinations, 'home');

    const stored = JSON.parse(storage.get(STORAGE_KEYS.destinations) ?? '[]') as SavedDestination[];
    expect(stored[0].station).toMatchObject({ latitude: 0, longitude: 0 });
    expect(stored[0].address).toEqual({ label: address.label, latitude: 0, longitude: 0 });

    const settings = await readSettings();
    expect(settings.homeStation).toMatchObject({ nameJa: '元町・中華街', latitude: motomachi.latitude, longitude: motomachi.longitude });
    expect(settings.homeAddress).toEqual(address);
  });

  it('moves positions saved by an older build out of long-term storage', async () => {
    storage.set(STORAGE_KEYS.destinations, JSON.stringify([{ id: 'home', label: 'Home', station: motomachi, address }]));
    storage.set(STORAGE_KEYS.activeDestinationId, 'home');

    const settings = await readSettings();
    const stored = JSON.parse(storage.get(STORAGE_KEYS.destinations) ?? '[]') as SavedDestination[];
    expect(stored[0].station).toMatchObject({ latitude: 0, longitude: 0 });
    expect(settings.homeStation).toMatchObject({ latitude: motomachi.latitude });
  });
});

describe('finding positions again', () => {
  beforeEach(() => storage.clear());
  const named = stationForDisk(motomachi);

  it('uses tonight\'s cache without searching', async () => {
    await rememberTonight([motomachi], [], tonight);
    const search = vi.fn(async () => []);
    expect(await resolveStation(named, search, tonight + HOUR)).toMatchObject({ latitude: motomachi.latitude });
    expect(search).not.toHaveBeenCalled();
  });

  it('forgets positions when the service day changes, and searches again by name and area', async () => {
    await rememberTonight([motomachi], [], tonight);
    const search = vi.fn(async () => [
      { ...motomachi, latitude: 34.0, longitude: 135.0, regionJa: '大阪府大阪市' }, // same name elsewhere
      { ...motomachi, latitude: 35.4426, longitude: 139.6507 },
    ]);
    const resolved = await resolveStation(named, search, tomorrow);
    expect(search).toHaveBeenCalledOnce();
    expect(resolved).toMatchObject({ latitude: 35.4426, longitude: 139.6507 });
  });

  it('stays without a position when only a same-named station elsewhere is found', async () => {
    const search = async () => [{ ...motomachi, regionJa: '大阪府大阪市', latitude: 34.0, longitude: 135.0 }];
    expect(await resolveStation(named, search, tomorrow)).toMatchObject({ latitude: 0, longitude: 0 });
  });

  it('finds an address again from its text', async () => {
    const search = vi.fn(async () => [address]);
    expect(await resolveAddress(addressForDisk(address)!, search, tomorrow)).toEqual(address);
    expect(await resolveAddress(addressForDisk(address)!, search, tomorrow + HOUR)).toEqual(address);
    expect(search).toHaveBeenCalledOnce(); // the second came from the cache
  });
});
