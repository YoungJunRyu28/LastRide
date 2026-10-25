import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apple: vi.fn(),
  server: vi.fn(),
}));

vi.mock('@/lib/applePlaces', () => ({ appleNearbyStations: mocks.apple, appleWalkingRoute: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({ getNearbyStations: mocks.server, getWalkRoute: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiBaseUrl: 'https://api.example', communityFallbacksEnabled: false }));
vi.mock('@/lib/fetchWithTimeout', () => ({ fetchWithTimeout: vi.fn() }));

import { findNearbyStations, LocationError } from '@/lib/stations';

// Near 元町・中華街. The server's list (subway-type lines only) has 伊勢佐木長者町, a 32-minute walk.
const here = { latitude: 35.4425, longitude: 139.6505 };
const motomachi = { name: 'Motomachi-Chukagai', nameJa: '元町・中華街', latitude: 35.4428, longitude: 139.6498 };
const ishikawacho = { name: 'Ishikawacho', nameJa: '石川町', latitude: 35.4388, longitude: 139.6425 };
const isezaki = { id: 'odpt.Station:Yokohama.Blue.IsezakiChojamachi', name: 'Isezakichojamachi', nameJa: '伊勢佐木長者町', latitude: 35.4436, longitude: 139.6296, walkingMeters: 2600, walkingMinutes: 32 };

describe('nearby stations when Apple Maps fails', () => {
  beforeEach(() => {
    mocks.apple.mockReset();
    mocks.server.mockReset().mockResolvedValue([isezaki]);
  });

  it('uses Apple’s stations when the search works', async () => {
    mocks.apple.mockResolvedValue([{ station: motomachi, straightMeters: 80, walk: { walkingMinutes: 2, distanceMeters: 150 } }]);
    const found = await findNearbyStations(here, 'normal', 3);
    expect(found.map(({ station }) => station.nameJa)).toEqual(['元町・中華街']);
  });

  it('a failed search falls back to the last plan’s stations, not the subway-only server list', async () => {
    mocks.apple.mockRejectedValue(new Error('throttled'));
    const found = await findNearbyStations(here, 'normal', 3, new Map([['石川町', { walkingMinutes: 13, distanceMeters: 1000 }]]), [ishikawacho, motomachi]);
    expect(found.map(({ station }) => station.nameJa)).toEqual(['元町・中華街', '石川町']);
    expect(found[1].walk).toEqual({ walkingMinutes: 13, distanceMeters: 1000 });
    expect(mocks.server).not.toHaveBeenCalled();
  });

  it('a failed search with no recent plan fails for now, so the plan in force stays', async () => {
    mocks.apple.mockRejectedValue(new Error('throttled'));
    await expect(findNearbyStations(here, 'normal', 3)).rejects.toBeInstanceOf(LocationError);
    expect(mocks.server).not.toHaveBeenCalled();
  });

  it('only when Apple finds no stations at all does the server list stand in', async () => {
    mocks.apple.mockResolvedValue([]);
    const found = await findNearbyStations(here, 'normal', 3);
    expect(found.map(({ station }) => station.nameJa)).toEqual(['伊勢佐木長者町']);
  });
});
