import { beforeEach, describe, expect, test, vi } from 'vitest';

const store = new Map<string, string>();
const api = { joinGroupTonight: vi.fn(), getGroup: vi.fn() };
const failure = { outboxWrite: false, outboxRead: false };

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => {
      if (key === 'lastride-group-leave-outbox-v1' && failure.outboxRead) throw new Error('outbox read failed');
      return store.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => {
      if (key === 'lastride-group-leave-outbox-v1' && failure.outboxWrite) throw new Error('outbox write failed');
      store.set(key, value);
    },
    removeItem: async (key: string) => void store.delete(key),
  },
}));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
const securedTokens = new Map<string, string>();
vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK: 'AFTER_FIRST_UNLOCK',
  isAvailableAsync: vi.fn(async () => true),
  getItemAsync: vi.fn(async (key: string) => securedTokens.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => { securedTokens.set(key, value); }),
  deleteItemAsync: vi.fn(async (key: string) => { securedTokens.delete(key); }),
}));
vi.mock('expo-crypto', async () => {
  const { createHash } = await import('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: vi.fn(async (_algorithm: string, value: string) =>
      createHash('sha256').update(value).digest('hex')),
  };
});
vi.mock('expo-task-manager', () => ({ defineTask: vi.fn() }));
vi.mock('expo-notifications', () => ({ registerTaskAsync: vi.fn(), addNotificationReceivedListener: vi.fn() }));
vi.mock('@workspace/api-client-react', () => api);

const { findGroupId } = await import('@/lib/groupUpdates');
const { leaveByChanged, markSharing, syncSharedLeaveBy, syncSharedLeaveByForGroup, flushPendingSharedLeaveBy, stopSharing, clearSharing, SHARE_OUTBOX_MAX_AGE_MS } = await import('@/lib/groupSharing');

beforeEach(() => {
  store.clear();
  securedTokens.clear();
  api.joinGroupTonight.mockReset();
  api.getGroup.mockReset();
  failure.outboxWrite = false;
  failure.outboxRead = false;
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
      expect.objectContaining({ headers: { 'X-Member-Token': 'tok', 'X-Leave-Expected-Revision': '0' }, signal: expect.any(AbortSignal) }),
    );
    // Remembered, so the same time isn't sent again.
    await syncSharedLeaveBy(Date.parse('2026-10-16T14:35:00.000Z'));
    expect(api.joinGroupTonight).toHaveBeenCalledTimes(1);
  });

  test('persists offline leave-time changes and replays them after app resume with no new GPS update', async () => {
    store.set('lastride-group-memberships', JSON.stringify([{ groupId: 'g1', memberToken: 'tok', name: 'Group' }]));
    await markSharing('g1', '2026-10-16T14:31:00.000Z');
    api.joinGroupTonight.mockRejectedValueOnce(new Error('offline'));
    await syncSharedLeaveBy(Date.parse('2026-10-16T14:35:00.000Z'));
    expect(JSON.parse(store.get('lastride-group-leave-outbox-v1') ?? '{}').g1.leaveBy).toBe('2026-10-16T14:35:00.000Z');
    expect(JSON.parse(store.get('lastride-group-sharing') ?? '{}').g1).toBe('2026-10-16T14:31:00.000Z');
    api.joinGroupTonight.mockResolvedValue({});
    await flushPendingSharedLeaveBy();
    expect(api.joinGroupTonight).toHaveBeenCalledTimes(2);
    expect(JSON.parse(store.get('lastride-group-leave-outbox-v1') ?? '{}')).toEqual({});
    expect(JSON.parse(store.get('lastride-group-sharing') ?? '{}').g1).toBe('2026-10-16T14:35:00.000Z');
    await flushPendingSharedLeaveBy();
    expect(api.joinGroupTonight).toHaveBeenCalledTimes(2); // no extra request with an empty outbox
  });

  test('only retries the newest desired time, never earlier offline values', async () => {
    store.set('lastride-group-memberships', JSON.stringify([{ groupId: 'g1', memberToken: 'tok', name: 'Group' }]));
    await markSharing('g1', '2026-10-16T14:31:00.000Z');
    api.joinGroupTonight.mockRejectedValue(new Error('offline'));
    await syncSharedLeaveBy(Date.parse('2026-10-16T14:35:00.000Z'));
    await syncSharedLeaveBy(Date.parse('2026-10-16T14:42:00.000Z'));
    expect(JSON.parse(store.get('lastride-group-leave-outbox-v1') ?? '{}').g1.leaveBy).toBe('2026-10-16T14:42:00.000Z');
    api.joinGroupTonight.mockResolvedValue({});
    await flushPendingSharedLeaveBy();
    expect(api.joinGroupTonight.mock.calls.at(-1)?.[1]).toEqual({ leaveBy: '2026-10-16T14:42:00.000Z' });
  });

  test('opt-out removes pending time and foreground replay cannot resurrect sharing', async () => {
    store.set('lastride-group-memberships', JSON.stringify([{ groupId: 'g1', memberToken: 'tok', name: 'Group' }]));
    await markSharing('g1', null);
    api.joinGroupTonight.mockRejectedValueOnce(new Error('offline'));
    await syncSharedLeaveBy(Date.parse('2026-10-16T14:35:00.000Z'));
    await stopSharing('g1');
    api.joinGroupTonight.mockResolvedValue({});
    await flushPendingSharedLeaveBy();
    expect(api.joinGroupTonight).toHaveBeenCalledTimes(1);
    expect(JSON.parse(store.get('lastride-group-leave-outbox-v1') ?? '{}')).toEqual({});
    expect(JSON.parse(store.get('lastride-group-sharing') ?? '{}')).toEqual({});
  });

  test('expired offline entries are discarded rather than replaying yesterday’s leave time', async () => {
    store.set('lastride-group-memberships', JSON.stringify([{ groupId: 'g1', memberToken: 'tok', name: 'Group' }]));
    await markSharing('g1', null);
    store.set('lastride-group-leave-outbox-v1', JSON.stringify({ g1: {
      leaveBy: '2026-10-16T14:35:00.000Z', queuedAt: Date.now() - SHARE_OUTBOX_MAX_AGE_MS - 1000,
    } }));
    await flushPendingSharedLeaveBy();
    expect(api.joinGroupTonight).not.toHaveBeenCalled();
    expect(JSON.parse(store.get('lastride-group-leave-outbox-v1') ?? '{}')).toEqual({});
    expect(JSON.parse(store.get('lastride-group-sharing') ?? '{}')).toEqual({ g1: null });
  });

  test('a local reset removes all queued deliveries before the next foreground retry', async () => {
    store.set('lastride-group-memberships', JSON.stringify([{ groupId: 'g1', memberToken: 'tok', name: 'Group' }]));
    await markSharing('g1', null);
    api.joinGroupTonight.mockRejectedValueOnce(new Error('offline'));
    await syncSharedLeaveBy(Date.parse('2026-10-16T14:35:00.000Z'));
    await clearSharing();
    api.joinGroupTonight.mockResolvedValue({});
    await flushPendingSharedLeaveBy();
    expect(api.joinGroupTonight).toHaveBeenCalledTimes(1);
    expect(store.has('lastride-group-leave-outbox-v1')).toBe(false);
  });

  test('server gone response removes the outbox, while transient 503 remains retryable', async () => {
    store.set('lastride-group-memberships', JSON.stringify([{ groupId: 'g1', memberToken: 'tok', name: 'Group' }]));
    await markSharing('g1', null);
    api.joinGroupTonight.mockRejectedValueOnce({ status: 503 });
    await syncSharedLeaveBy(Date.parse('2026-10-16T14:35:00.000Z'));
    expect(JSON.parse(store.get('lastride-group-leave-outbox-v1') ?? '{}').g1).toBeDefined();
    api.joinGroupTonight.mockRejectedValueOnce({ status: 409 });
    await flushPendingSharedLeaveBy();
    expect(JSON.parse(store.get('lastride-group-leave-outbox-v1') ?? '{}')).toEqual({});
    expect(JSON.parse(store.get('lastride-group-sharing') ?? '{}')).toEqual({});
  });

  test('storage failures fail closed before network activity and are retryable', async () => {
    store.set('lastride-group-memberships', JSON.stringify([{ groupId: 'g1', memberToken: 'tok', name: 'Group' }]));
    await markSharing('g1', null);
    failure.outboxWrite = true;
    await expect(syncSharedLeaveBy(Date.parse('2026-10-16T14:35:00.000Z'))).rejects.toThrow('outbox write failed');
    expect(api.joinGroupTonight).not.toHaveBeenCalled();
    failure.outboxWrite = false;
    api.joinGroupTonight.mockResolvedValue({});
    await syncSharedLeaveBy(Date.parse('2026-10-16T14:35:00.000Z'));
    expect(api.joinGroupTonight).toHaveBeenCalledOnce();
  });

  test('missing membership credentials remove the pending capability instead of sending without auth', async () => {
    await markSharing('g1', null);
    store.set('lastride-group-leave-outbox-v1', JSON.stringify({ g1: {
      leaveBy: '2026-10-16T14:35:00.000Z', queuedAt: Date.now(),
    } }));
    await flushPendingSharedLeaveBy();
    expect(api.joinGroupTonight).not.toHaveBeenCalled();
    expect(JSON.parse(store.get('lastride-group-sharing') ?? '{}')).toEqual({});
    expect(JSON.parse(store.get('lastride-group-leave-outbox-v1') ?? '{}')).toEqual({});
  });

  test('overlapping foreground callbacks coalesce into one delivery', async () => {
    store.set('lastride-group-memberships', JSON.stringify([{ groupId: 'g1', memberToken: 'tok', name: 'Group' }]));
    await markSharing('g1', null);
    store.set('lastride-group-leave-outbox-v1', JSON.stringify({ g1: {
      leaveBy: '2026-10-16T14:35:00.000Z', queuedAt: Date.now(),
    } }));
    api.joinGroupTonight.mockResolvedValue({});
    await Promise.all(Array.from({ length: 20 }, () => flushPendingSharedLeaveBy()));
    expect(api.joinGroupTonight).toHaveBeenCalledOnce();
  });

  test('acknowledgment cannot revive an opt-out that happened while the request was in flight', async () => {
    store.set('lastride-group-memberships', JSON.stringify([{ groupId: 'g1', memberToken: 'tok', name: 'Group' }]));
    await markSharing('g1', null);
    let unblock: (() => void) | undefined;
    api.joinGroupTonight.mockImplementation(() => new Promise<void>(resolve => { unblock = resolve; }));
    const processing = syncSharedLeaveBy(Date.parse('2026-10-16T14:35:00.000Z'));
    await vi.waitFor(() => expect(api.joinGroupTonight).toHaveBeenCalledOnce());
    await stopSharing('g1');
    unblock?.();
    await processing;
    expect(JSON.parse(store.get('lastride-group-sharing') ?? '{}')).toEqual({});
    expect(JSON.parse(store.get('lastride-group-leave-outbox-v1') ?? '{}')).toEqual({});
  });

  test('one transient outage stops a multi-group replay storm and leaves all unsent groups queued', async () => {
    store.set('lastride-group-memberships', JSON.stringify(['g1','g2','g3'].map(id => ({ groupId: id, memberToken: 'tok', name: id }))));
    for (const id of ['g1', 'g2', 'g3']) await markSharing(id, null);
    api.joinGroupTonight.mockRejectedValue(new Error('offline'));
    await syncSharedLeaveBy(Date.parse('2026-10-16T14:35:00.000Z'));
    expect(api.joinGroupTonight).toHaveBeenCalledOnce();
    expect(Object.keys(JSON.parse(store.get('lastride-group-leave-outbox-v1') ?? '{}'))).toEqual(['g1','g2','g3']);
  });

  test('foreground updates save one target group durably and return its server result for UI', async () => {
    store.set('lastride-group-memberships', JSON.stringify(['g1','g2'].map(id => ({ groupId: id, memberToken: id+'tok', name: id }))));
    await markSharing('g1', '2026-10-16T14:31:00.000Z');
    await markSharing('g2', '2026-10-16T14:31:00.000Z');
    const returned = { id: 'g1', name: 'Friends', tonight: { active: true } };
    api.joinGroupTonight.mockResolvedValue(returned);
    expect(await syncSharedLeaveByForGroup('g1', Date.parse('2026-10-16T14:35:00.000Z'))).toEqual(returned);
    expect(api.joinGroupTonight).toHaveBeenCalledOnce();
    expect(api.joinGroupTonight.mock.calls[0]?.[0]).toBe('g1');
    expect(JSON.parse(store.get('lastride-group-sharing') ?? '{}').g2).toBe('2026-10-16T14:31:00.000Z');
  });

  test('clearing a departure time (null) is durable and does not cancel opting into the group', async () => {
    store.set('lastride-group-memberships', JSON.stringify([{ groupId: 'g1', memberToken: 'tok', name: 'Group' }]));
    await markSharing('g1', '2026-10-16T14:31:00.000Z');
    api.joinGroupTonight.mockRejectedValueOnce(new Error('offline'));
    expect(await syncSharedLeaveByForGroup('g1', null)).toBeNull();
    expect(JSON.parse(store.get('lastride-group-leave-outbox-v1') ?? '{}').g1.leaveBy).toBeNull();
    expect(JSON.parse(store.get('lastride-group-sharing') ?? '{}')).toEqual({g1:'2026-10-16T14:31:00.000Z'});
    api.joinGroupTonight.mockResolvedValue({ id: 'g1' });
    await flushPendingSharedLeaveBy();
    expect(api.joinGroupTonight.mock.calls.at(-1)?.[1]).toEqual({ leaveBy: null });
    expect(JSON.parse(store.get('lastride-group-sharing') ?? '{}')).toEqual({g1:null});
    expect(JSON.parse(store.get('lastride-group-leave-outbox-v1') ?? '{}')).toEqual({});
    await syncSharedLeaveByForGroup('g1', null);
    expect(api.joinGroupTonight).toHaveBeenCalledTimes(2); // no duplicate clear
  });

  test('a pending offline operation carries its ORIGINAL expected revision, not a newer one', async () => {
    store.set('lastride-group-memberships', JSON.stringify([{ groupId: 'g1', memberToken: 'tok', name: 'Group' }]));
    await markSharing('g1', '2026-10-16T14:31:00.000Z', 7);
    api.joinGroupTonight.mockRejectedValueOnce(new Error('offline'));
    await syncSharedLeaveBy(Date.parse('2026-10-16T14:35:00.000Z'));
    expect(JSON.parse(store.get('lastride-group-leave-outbox-v1') ?? '{}').g1.expectedRevision).toBe(7);
    // A push/GET reported another device won version 8 while this was offline.
    await markSharing('g1', '2026-10-16T14:43:00.000Z', 8);
    api.joinGroupTonight.mockRejectedValueOnce({ status: 412 });
    api.getGroup.mockResolvedValue({ me: {memberId:'mid'}, tonight: { participants: [
      {memberId:'mid',leaveBy:'2026-10-16T14:43:00.000Z',leaveRevision:8},
    ] }});
    await flushPendingSharedLeaveBy();
    expect(api.joinGroupTonight.mock.calls[1]?.[2]?.headers).toMatchObject({'X-Leave-Expected-Revision':'7'});
    expect(JSON.parse(store.get('lastride-group-leave-outbox-v1') ?? '{}')).toEqual({});
    expect(JSON.parse(store.get('lastride-group-sharing') ?? '{}').g1).toBe('2026-10-16T14:43:00.000Z');
    expect(JSON.parse(store.get('lastride-group-leave-revisions-v1') ?? '{}').g1).toBe(8);
    expect(api.getGroup).toHaveBeenCalledOnce();
  });

  test('a confirmed CAS increments the saved revision; stale group refresh cannot reduce it', async () => {
    store.set('lastride-group-memberships', JSON.stringify([{ groupId: 'g1', memberToken: 'tok', name: 'Group' }]));
    await markSharing('g1', '2026-10-16T14:31:00.000Z', 3);
    api.joinGroupTonight.mockResolvedValue({});
    await syncSharedLeaveBy(Date.parse('2026-10-16T14:35:00.000Z'));
    expect(api.joinGroupTonight.mock.calls[0]?.[2]?.headers).toMatchObject({'X-Leave-Expected-Revision':'3'});
    expect(JSON.parse(store.get('lastride-group-leave-revisions-v1') ?? '{}').g1).toBe(4);
    await markSharing('g1', '2026-10-16T14:30:00.000Z', 3);
    expect(JSON.parse(store.get('lastride-group-sharing') ?? '{}').g1).toBe('2026-10-16T14:35:00.000Z');
    await syncSharedLeaveBy(Date.parse('2026-10-16T14:48:00.000Z'));
    expect(api.joinGroupTonight.mock.calls[1]?.[2]?.headers).toMatchObject({'X-Leave-Expected-Revision':'4'});
  });

  test('replaying obsolete CAS revision does not opt out of the active group', async () => {
    store.set('lastride-group-memberships', JSON.stringify([{ groupId: 'g1', memberToken: 'tok', name: 'Group' }]));
    await markSharing('g1', null, 0);
    api.joinGroupTonight.mockRejectedValueOnce({status:412});
    api.getGroup.mockRejectedValueOnce(new Error('temporary GET failure'));
    await syncSharedLeaveBy(Date.parse('2026-10-16T14:35:00.000Z'));
    expect(JSON.parse(store.get('lastride-group-sharing') ?? '{}')).toEqual({g1:null});
    expect(JSON.parse(store.get('lastride-group-leave-outbox-v1') ?? '{}')).toEqual({});
    expect(JSON.parse(store.get('lastride-group-leave-revisions-v1') ?? '{}')).toEqual({g1:0});
  });

  test('corrupted saved CAS versions fail closed instead of issuing an unguarded write', async () => {
    store.set('lastride-group-memberships', JSON.stringify([{ groupId: 'g1', memberToken: 'tok', name: 'Group' }]));
    await markSharing('g1', null, 0);
    store.set('lastride-group-leave-outbox-v1', JSON.stringify({ g1: {
      leaveBy: '2026-10-16T14:35:00.000Z', queuedAt: Date.now(), expectedRevision: -1,
    } }));
    await expect(flushPendingSharedLeaveBy()).rejects.toThrow('Invalid pending group leave time');
    expect(api.joinGroupTonight).not.toHaveBeenCalled();
  });

  test('stops sharing once the night has ended on the server', async () => {
    store.set('lastride-group-memberships', JSON.stringify([{ groupId: 'g1', memberToken: 'tok', name: '金曜会' }]));
    await markSharing('g1', null);
    api.joinGroupTonight.mockRejectedValue({ status: 409 });
    await syncSharedLeaveBy(Date.parse('2026-10-16T14:35:00.000Z'));
    expect(JSON.parse(store.get('lastride-group-sharing') ?? '{}')).toEqual({});
  });
});
