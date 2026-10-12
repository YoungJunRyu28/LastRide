import { describe, expect, it } from 'vitest';
import { stationForStorage, type StationLookup } from '@/lib/savedStation';

const apple = { name: 'Oshiage', nameJa: '押上駅', latitude: 35.7101, longitude: 139.8134, regionJa: '東京都墨田区' };
const odpt = { name: 'Oshiage', nameJa: '押上', latitude: 35.7106, longitude: 139.8136, regionJa: '東京都' };

describe('stationForStorage', () => {
  it("stores our server's ODPT record when it has the same station nearby", async () => {
    const lookup: StationLookup = async () => [odpt];
    expect(await stationForStorage(apple, lookup)).toEqual({ ...odpt, source: 'odpt' });
  });

  it('keeps the picked station when ODPT has no match (JR, private railways)', async () => {
    const elsewhere = { ...odpt, latitude: 35.6, longitude: 139.7 };
    expect(await stationForStorage(apple, async () => [elsewhere])).toEqual(apple);
    expect(await stationForStorage(apple, async () => [])).toEqual(apple);
  });

  it('keeps the picked station when the server fails or there is none', async () => {
    expect(await stationForStorage(apple, async () => { throw new Error('offline'); })).toEqual(apple);
    expect(await stationForStorage(apple, null)).toEqual(apple);
  });
});
