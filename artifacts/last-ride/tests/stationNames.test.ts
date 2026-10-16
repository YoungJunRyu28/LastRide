import { describe, expect, it } from 'vitest';
import { bilingualStationName } from '@/lib/stationNames';

describe('bilingualStationName', () => {
  it('adds the English name to a Japanese one', () => {
    expect(bilingualStationName('渋谷')).toEqual({ nameJa: '渋谷', name: 'Shibuya' });
    expect(bilingualStationName('菊名')).toEqual({ nameJa: '菊名', name: 'Kikuna' });
  });

  it('adds the Japanese name to an English one, ignoring case, spaces and macrons', () => {
    expect(bilingualStationName('Shibuya')).toEqual({ name: 'Shibuya', nameJa: '渋谷' });
    expect(bilingualStationName('shibuya').nameJa).toBe('渋谷');
    expect(bilingualStationName('Ōsaka').nameJa).toBe('大阪');
  });

  it('keeps an unknown name in both languages', () => {
    expect(bilingualStationName('Nowhere Junction')).toEqual({ name: 'Nowhere Junction', nameJa: 'Nowhere Junction' });
    expect(bilingualStationName('存在しない')).toEqual({ name: '存在しない', nameJa: '存在しない' });
  });
});
