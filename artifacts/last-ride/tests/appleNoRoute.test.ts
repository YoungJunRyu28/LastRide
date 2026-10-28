/**
 * A JR / private-railway station our server doesn't cover (404): Apple's "no
 * route" means no train from there, while its request limit means the lookup
 * failed (the planner then keeps the station's last result).
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ apple: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({
  getLastTrain: vi.fn(async () => { throw Object.assign(new Error('Not found'), { status: 404 }); }),
  getFirstTrain: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ apiBaseUrl: 'https://api.example', isDevelopment: false }));
vi.mock('@/lib/appleTransit', () => ({
  appleLastTrain: mocks.apple, appleFirstTrain: vi.fn(), appleTrainsBefore: vi.fn(),
  appleTransitEnabled: true, EARLIER_TRAIN_COUNT: 2,
}));

import { AppleLookupFailed, getLastTrain } from '@/lib/timetable';

const yamate = { name: 'Yamate', nameJa: '山手', latitude: 35.4367, longitude: 139.6427 };
const home = { name: 'Kikuna', nameJa: '菊名', latitude: 35.5097, longitude: 139.6305 };
const night = Date.UTC(2026, 9, 9, 12);

beforeEach(() => {
  mocks.apple.mockReset();
});

describe('Apple on a route our server does not cover', () => {
  test('"no route" is an answer: no train from there', async () => {
    mocks.apple.mockImplementation(async () => { throw Object.assign(new Error('Directions not available'), { code: 'ERR_ETA_NO_ROUTE' }); });
    await expect(getLastTrain(yamate, home, night)).resolves.toBeNull();
  });

  test('its request limit (or no connection) is a failed lookup', async () => {
    mocks.apple.mockImplementation(async () => { throw Object.assign(new Error('Throttled'), { code: 'ERR_ETA' }); });
    await expect(getLastTrain(yamate, home, night)).rejects.toBeInstanceOf(AppleLookupFailed);
  });
});
