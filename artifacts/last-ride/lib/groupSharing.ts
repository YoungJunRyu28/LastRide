/**
 * Which groups this device shares tonight's leave time with. Native location
 * callbacks aren't guaranteed to run when stationary or when iOS suspends the
 * app, so changed times must survive offline requests and app restarts.
 *
 * We keep (1) last SERVER-acknowledged leave times and (2) desired values
 * awaiting delivery. No location, route, station or destination is uploaded.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getGroup, joinGroupTonight } from '@workspace/api-client-react';
import { readMemberships } from '@/lib/groupMemberships';

const SHARING_KEY = 'lastride-group-sharing';
const OUTBOX_KEY = 'lastride-group-leave-outbox-v1';
const REVISIONS_KEY = 'lastride-group-leave-revisions-v1';
/** Never send yesterday's leave time merely because the user opens the app. */
export const SHARE_OUTBOX_MAX_AGE_MS = 8 * 60 * 60_000;
/** Smaller changes than this aren't worth a request and database wake-up. */
export const LEAVE_BY_RESEND_MS = 60_000;

type Sharing = Record<string, string | null>;
type Pending = Record<string, { leaveBy: string | null; queuedAt: number; expectedRevision?: number }>;
type Revisions = Record<string, number>;
type GroupDelivery = Awaited<ReturnType<typeof joinGroupTonight>>;

// AsyncStorage has no atomic read/modify/write; serialize on this JS runtime.
// A failed write must not poison future operations.
let mutationTail: Promise<void> = Promise.resolve();
function serializeMutation<T>(work: () => Promise<T>): Promise<T> {
  const result = mutationTail.then(work);
  mutationTail = result.then(() => undefined, () => undefined);
  return result;
}
// Likewise serialize network deliveries from foreground and background tasks.
// The latest desired value is checked before each send.
let deliveryTail: Promise<void> = Promise.resolve();
function serializeDelivery<T>(work: () => Promise<T>): Promise<T> {
  const result = deliveryTail.then(work, work);
  deliveryTail = result.then(() => undefined, () => undefined);
  return result;
}

async function read(strict = false): Promise<Sharing> {
  try {
    const raw = await AsyncStorage.getItem(SHARING_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid stored sharing state');
    if (Object.entries(parsed).some(([id, time]) => !id || (time !== null && typeof time !== 'string')))
      throw new Error('Invalid group sharing entry');
    return parsed as Sharing;
  } catch (error) {
    if (strict) throw error;
    return {};
  }
}
async function readOutbox(strict = false): Promise<Pending> {
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid group outbox');
    for (const [id, value] of Object.entries(parsed)) {
      const entry = value as Partial<Pending[string]> | null;
      if (!id || !entry || (entry.leaveBy !== null && (typeof entry.leaveBy !== 'string' || !Number.isFinite(Date.parse(entry.leaveBy)))) ||
        !Number.isFinite(entry.queuedAt) || entry.queuedAt! <= 0 ||
        (entry.expectedRevision !== undefined &&
          (!Number.isSafeInteger(entry.expectedRevision) || entry.expectedRevision < 0 || entry.expectedRevision > 2147483646)))
        throw new Error('Invalid pending group leave time');
    }
    return parsed as Pending;
  } catch (error) {
    if (strict) throw error;
    return {};
  }
}
async function readRevisions(strict = false): Promise<Revisions> {
  try {
    const raw = await AsyncStorage.getItem(REVISIONS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid group revisions');
    for (const [groupId, revision] of Object.entries(parsed)) {
      if (!groupId || !Number.isSafeInteger(revision) || (revision as number) < 0 || (revision as number) > 2147483646)
        throw new Error('Invalid saved leave revision');
    }
    return parsed as Revisions;
  } catch (error) {
    if (strict) throw error;
    return {};
  }
}
async function writeRevisions(revisions: Revisions): Promise<void> {
  await AsyncStorage.setItem(REVISIONS_KEY, JSON.stringify(revisions));
}

async function write(sharing: Sharing) {
  await AsyncStorage.setItem(SHARING_KEY, JSON.stringify(sharing));
}
async function writeOutbox(pending: Pending) {
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(pending));
}

/** The last leave-by value CONFIRMED by the group server. */
export async function markSharing(groupId: string, leaveBy: string | null, revision?: number): Promise<void> {
  await serializeMutation(async () => {
    const sharing = await read(true);
    if (revision !== undefined) {
      if (!Number.isSafeInteger(revision) || revision < 0 || revision > 2147483646)
        throw new Error('Invalid server leave revision');
      const revisions = await readRevisions(true);
      // A stale GET/push response must never downgrade a known server version.
      if (revision < (revisions[groupId] ?? 0)) return;
      if (revision !== revisions[groupId]) {
        await writeRevisions({ ...revisions, [groupId]: revision });
      }
    }
    if (groupId in sharing && sharing[groupId] === leaveBy) return;
    await write({ ...sharing, [groupId]: leaveBy });
  });
}

/** Opt-out invalidates pending updates so foreground retry cannot resurrect it. */
export async function stopSharing(groupId: string): Promise<void> {
  await serializeMutation(async () => {
    const sharing = await read(true);
    const pending = await readOutbox(true);
    const revisions = await readRevisions(true);
    if (groupId in revisions) {
      const { [groupId]: _removed, ...remaining } = revisions;
      await writeRevisions(remaining);
    }
    if (groupId in sharing) {
      const { [groupId]: _removed, ...remaining } = sharing;
      await write(remaining);
    }
    if (groupId in pending) {
      const { [groupId]: _removed, ...remaining } = pending;
      await writeOutbox(remaining);
    }
  });
}

/** Reset both saved group sharing and all pending requests. */
export async function clearSharing(): Promise<void> {
  await serializeMutation(async () => {
    await AsyncStorage.removeItem(SHARING_KEY);
    await AsyncStorage.removeItem(OUTBOX_KEY);
    await AsyncStorage.removeItem(REVISIONS_KEY);
  });
}

/** Whether next differs from the last confirmed leave-by time. */
export function leaveByChanged(previous: string | null | undefined, next: string | null): boolean {
  if (next === null) return previous !== null && previous !== undefined;
  if (!previous) return true;
  const prevMs = Date.parse(previous);
  const nextMs = Date.parse(next);
  return !Number.isFinite(prevMs) || !Number.isFinite(nextMs) ||
    Math.abs(prevMs - nextMs) >= LEAVE_BY_RESEND_MS;
}

/** Enqueue each group's latest desired time BEFORE any HTTP network I/O. */
async function recordDesiredLeaveBy(leaveBy: string | null, now: number, onlyGroup?: string): Promise<void> {
  await serializeMutation(async () => {
    const sharing = await read(true);
    const pending = await readOutbox(true);
    const revisions = await readRevisions(true);
    let changed = false;
    for (const [groupId, acknowledged] of Object.entries(sharing)) {
      if (onlyGroup !== undefined && groupId !== onlyGroup) continue;
      if (!leaveByChanged(acknowledged, leaveBy)) {
        if (groupId in pending) { delete pending[groupId]; changed = true; }
        continue;
      }
      if (pending[groupId]?.leaveBy !== leaveBy) {
        // The CAS precondition belongs to the ORIGINAL queued operation.
        // Do not refresh the revision when an old offline request is replayed.
        pending[groupId] = { leaveBy, queuedAt: now, expectedRevision: revisions[groupId] ?? 0 };
        changed = true;
      }
    }
    if (changed) await writeOutbox(pending);
  });
}

async function pendingEntries(): Promise<Pending> {
  await mutationTail;
  return readOutbox(true);
}

async function acknowledge(groupId: string, desired: Pending[string], succeeded: boolean): Promise<void> {
  await serializeMutation(async () => {
    const pending = await readOutbox(true);
    if (pending[groupId]?.leaveBy !== desired.leaveBy ||
        (pending[groupId]?.expectedRevision ?? 0) !== (desired.expectedRevision ?? 0)) return;
    const sharing = await read(true);
    // A user might have stopped sharing while HTTP was still in flight.
    if (succeeded && groupId in sharing) {
      const revisions = await readRevisions(true);
      const confirmed = (desired.expectedRevision ?? 0) + 1;
      // Never lower a server revision observed by a concurrent fresh group
      // detail. A successful CAS increments by exactly one on the backend.
      if (confirmed >= (revisions[groupId] ?? 0)) {
        await writeRevisions({ ...revisions, [groupId]: confirmed });
        await write({ ...sharing, [groupId]: desired.leaveBy });
      }
    }
    delete pending[groupId];
    await writeOutbox(pending);
  });
}

async function deliverPending(now: number): Promise<Map<string, GroupDelivery>> {
  const results = new Map<string, GroupDelivery>();
  const pending = await pendingEntries();
  // Most 30-second foreground ticks have nothing to retry. Avoid even the
  // membership read when the durable outbox is already empty.
  if (Object.keys(pending).length === 0) return results;
  const memberships = await readMemberships();
  const tokens = new Map(memberships.map((member) => [member.groupId, member.memberToken]));
  for (const [groupId, queued] of Object.entries(pending)) {
    const sharing = await read(true);
    const token = tokens.get(groupId);
    if (!(groupId in sharing) || !token || now - queued.queuedAt > SHARE_OUTBOX_MAX_AGE_MS ||
        queued.queuedAt > now + 60_000) {
      await stopSharingIfMissingOrStale(groupId, queued, Boolean(token), sharing, now);
      continue;
    }
    if (!leaveByChanged(sharing[groupId], queued.leaveBy)) {
      await acknowledge(groupId, queued, false);
      continue;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);
      let result: GroupDelivery;
      try {
        result = await joinGroupTonight(groupId, { leaveBy: queued.leaveBy }, {
          headers: {
            'X-Member-Token': token,
            'X-Leave-Expected-Revision': String(queued.expectedRevision ?? 0),
          }, signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      await acknowledge(groupId, queued, true);
      results.set(groupId, result);
    } catch (error) {
      // The group was removed or tonight has ended. Otherwise keep the
      // durable desired value until next foreground/reconnection retry.
      const status = (error as { status?: number } | null)?.status;
      if (status === 412) {
        // A newer member update won on the server. This operation is stale,
        // NOT a reason to opt the rider out. Discard it, then refresh the
        // server revision before future fresh updates are queued.
        await acknowledge(groupId, queued, false);
        try {
          const latest = await getGroup(groupId, { headers: { 'X-Member-Token': token } });
          const mine = latest.tonight.participants.find((entry) => entry.memberId === latest.me.memberId);
          if (mine) await markSharing(groupId, mine.leaveBy, mine.leaveRevision);
        } catch { /* foreground group refresh can recover later */ }
      } else if (status === 404 || status === 409) await stopSharing(groupId);
      // During a network outage, stop this pass: don't wait 12 seconds per
      // group or issue a storm of failed requests on every foreground tick.
      if (status === undefined || status === 429 || (status >= 500 && status <= 599)) break;
    }
  }
  return results;
}

async function stopSharingIfMissingOrStale(
  groupId: string, desired: Pending[string], memberKnown: boolean,
  sharing: Sharing, now: number,
) {
  if (!memberKnown || !(groupId in sharing)) await stopSharing(groupId);
  else if (now - desired.queuedAt > SHARE_OUTBOX_MAX_AGE_MS || desired.queuedAt > now + 60_000)
    await acknowledge(groupId, desired, false); // Drop old request, retain opt-in.
}

/** Retry only durable outstanding group leave-time changes. Safe when offline.
 * Coalesce overlapping 30-second timers and foreground events into ONE pass. */
let foregroundFlush: Promise<void> | null = null;
export function flushPendingSharedLeaveBy(): Promise<void> {
  if (!foregroundFlush) {
    foregroundFlush = serializeDelivery(async () => { await deliverPending(Date.now()); })
      .finally(() => { foregroundFlush = null; });
  }
  return foregroundFlush;
}

/** Background location updates publish current leave time and queue failures. */
export function syncSharedLeaveBy(leaveByMs: number): Promise<void> {
  if (!Number.isFinite(leaveByMs)) return Promise.reject(new Error('Invalid leave-by time'));
  return serializeDelivery(async () => {
    await recordDesiredLeaveBy(new Date(leaveByMs).toISOString(), Date.now());
    await deliverPending(Date.now());
  });
}

/** Foreground plan update: identical durable delivery protocol as background
 * tracking, but return this group's server response for immediate UI updates.
 * markSharing(groupId, last SERVER value) must have been called first. */
export function syncSharedLeaveByForGroup(groupId: string, leaveByMs: number | null): Promise<GroupDelivery | null> {
  if (leaveByMs !== null && !Number.isFinite(leaveByMs)) return Promise.reject(new Error('Invalid leave-by time'));
  return serializeDelivery(async () => {
    await recordDesiredLeaveBy(leaveByMs === null ? null : new Date(leaveByMs).toISOString(), Date.now(), groupId);
    return (await deliverPending(Date.now())).get(groupId) ?? null;
  });
}
