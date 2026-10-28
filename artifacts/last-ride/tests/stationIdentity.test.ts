import { describe, expect, it } from 'vitest';
import { collapseByStation, samePhysicalStation, type StationOption } from '@/lib/stations';
import { sameStation } from '@/lib/planner';

const station = (latitude: number, longitude: number, regionJa?: string): StationOption => ({
  name: 'Honmachi', nameJa: '本町', latitude, longitude, regionJa,
});

describe('station identity across Japan', () => {
  it('distinguishes two same-named stations in different cities', () => {
    const osaka = station(34.6826, 135.498);
    const distant = station(35.6826, 139.498);
    expect(sameStation(osaka, distant)).toBe(false);
    expect(samePhysicalStation(osaka, distant)).toBe(false);
  });

  it('treats nearby platform entrances as the same physical station', () => {
    expect(samePhysicalStation(station(35.6580, 139.7010), station(35.6590, 139.7020))).toBe(true);
  });

  it('uses locality to distinguish unlocated legacy MapKit saved stations', () => {
    expect(sameStation(station(0, 0, '大阪府大阪市'), station(0, 0, '東京都渋谷区'))).toBe(false);
    expect(sameStation(station(0, 0, '大阪府大阪市'), station(0, 0, '大阪府'))).toBe(true);
  });

  it('preserves remote namesakes during candidate deduplication', () => {
    const initial = station(34.6826, 135.498);
    const duplicate = station(34.683, 135.499);
    const remote = station(35.6826, 139.498);
    expect(collapseByStation([initial, duplicate, remote].map((item) => ({ station: item })), 3)
      .map((item) => item.station)).toEqual([initial, remote]);
  });

  it('never matches differently named stations merely for being nearby', () => {
    const first = station(35.6580, 139.7010);
    const second = { ...first, nameJa: '原宿' };
    expect(sameStation(first, second)).toBe(false);
  });
});
