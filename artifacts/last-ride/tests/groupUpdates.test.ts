import { beforeEach, describe, expect, test, vi } from 'vitest';

const store = new Map<string, string>();
const api = { joinGroupTonight: vi.fn() };

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => void store.set(key, value),
    removeItem: async (key: string) => void store.delete(key),
  },
}));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-task-manager', () => ({ defineTask: vi.fn() }));
vi.mock('expo-notifications', () => ({ registerTaskAsync: vi.fn(), addNotificationReceivedListener: vi.fn() }));
vi.mock('@workspace/api-client-react', () => api);

const { findGroupId } = await import('@/lib/groupUpdates');
const { leaveByChanged, markSharing, syncSharedLeaveBy } = await import('@/lib/groupSharing');

beforeEach(() => {
  store.clear();
  api.joinGroupTonight.mockReset();
});

describe('silent group pushes', () => {
  test('find the group id wherever the platform puts it', () => {
    expect(findGroupId({ data: { kind: 'group_updated', groupId: 'g1' } })).toBe('g1');
    // Expo can deliver the custom data as a JSON string inside the APNs payload.
    expect(findGroupId({ data: { body: JSON.stringify({ groupId: 'g2' }) } })).toBe('g2');
    expect(findGroupId({ data: { body: '{}' } })).toBeNull();
  });
});

describe('sharing tonight’s leave time from the background', () => {
  test('a change of under a minute isn’t sent', () => {
    expect(leaveByChanged('2026-10-16T14:31:00.000Z', '2026-10-16T14:31:30.000Z')).toBe(false);
    expect(leaveByChanged('2026-10-16T14:31:00.000Z', '2026-10-16T14:33:00.000Z')).toBe(true);
    expect(leaveByChanged(null, '2026-10-16T14:31:00.000Z')).toBe(true);
  });

  test('sends a moved time to the groups this phone shares with, with its member token', async () => {
    store.set('lastride-group-memberships', JSON.stringify([{ groupId: 'g1', memberToken: 'tok', name: '金曜会' }]));
    await markSharing('g1', '2026-10-16T14:31:00.000Z');
    api.joinGroupTonight.mockResolvedValue({});

    await syncSharedLeaveBy(Date.parse('2026-10-16T14:31:20.000Z'));
    expect(api.joinGroupTonight).not.toHaveBeenCalled();

    await syncSharedLeaveBy(Date.parse('2026-10-16T14:35:00.000Z'));
    expect(api.joinGroupTonight).toHaveBeenCalledWith(
      'g1',
      { leaveBy: '2026-10-16T14:35:00.000Z' },
      { headers: { 'X-Member-Token': 'tok' } },
    );
    // Remembered, so the same time isn't sent again.
    await syncSharedLeaveBy(Date.parse('2026-10-16T14:35:00.000Z'));
    expect(api.joinGroupTonight).toHaveBeenCalledTimes(1);
  });

  test('stops sharing once the night has ended on the server', async () => {
    store.set('lastride-group-memberships', JSON.stringify([{ groupId: 'g1', memberToken: 'tok', name: '金曜会' }]));
    await markSharing('g1', null);
    api.joinGroupTonight.mockRejectedValue({ status: 409 });
    await syncSharedLeaveBy(Date.parse('2026-10-16T14:35:00.000Z'));
    expect(JSON.parse(store.get('lastride-group-sharing') ?? '{}')).toEqual({});
  });
});
