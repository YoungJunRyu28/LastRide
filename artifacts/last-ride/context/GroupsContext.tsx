/**
 * Groups this device belongs to, kept fresh from the server, and the one
 * thing groups ever receive from this phone: tonight's leave-by time, sent
 * only for groups where you chose 今夜参加する. Location, station, route and
 * destination never leave the device.
 */
import {
  createGroup,
  getGroup,
  joinGroup,
  leaveGroup,
  leaveGroupTonight,
  resetGroupMembership,
  updateMyGroupMembership,
  type GroupDetail,
} from "@workspace/api-client-react";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useLastRide } from "@/context/LastRideContext";
import { usePremium } from "@/context/PremiumContext";
import { apiBaseUrl } from "@/lib/api";
import {
  clearMemberships,
  readMemberships,
  removeMembership,
  renameMembership,
  saveMembership,
  writeDisplayName,
  type GroupMembership,
} from "@/lib/groupMemberships";
import { clearSharing, flushPendingSharedLeaveBy, markSharing, stopSharing, syncSharedLeaveByForGroup } from "@/lib/groupSharing";
import { prepareGroupCreation, readPendingGroupCreation, finishGroupCreation, creationDefinitelyRejected } from "@/lib/pendingGroupCreation";
import { prepareGroupJoin, readPendingGroupJoin, finishGroupJoin, joinDefinitelyRejected } from "@/lib/pendingGroupJoin";
import { GroupRefreshGuard } from "@/lib/groupRefreshGuard";
import { onGroupUpdated, startGroupUpdates } from "@/lib/groupUpdates";
import { expoPushToken } from "@/lib/pushToken";
import { recommendedLeaveTime } from "@/lib/reliability";

export type GroupEntry = {
  membership: GroupMembership;
  /** Null until loaded, or when the server couldn't be reached. */
  detail: GroupDetail | null;
};

type GroupsValue = {
  groups: GroupEntry[];
  loading: boolean;
  /** True if saved OS-protected group credentials cannot be accessed. */
  credentialError: boolean;
  /** Explicitly abandon unrecoverable local credentials, without a server leave. */
  clearUnavailableMemberships: () => Promise<void>;
  available: boolean;
  refresh: () => Promise<void>;
  /** Refresh only this group when its detail screen is focused. */
  refreshGroup: (groupId: string) => Promise<void>;
  /** Request options carrying this device's member token for `groupId`. */
  memberOptions: (groupId: string) => RequestInit;
  /** Stores a server answer for a group (after any action that returns GroupDetail). */
  apply: (detail: GroupDetail) => void;
  /** Forgets a group locally (left, removed, disbanded). */
  forget: (groupId: string) => Promise<void>;
  /**
   * "Reset & start over": leaves every group on the server (a host's group is
   * disbanded), then forgets them on this phone.
   * Offline, the server copies are removed later by the inactivity cleanup.
   */
  leaveAll: () => Promise<void>;
  create: (name: string, displayName: string) => Promise<GroupDetail>;
  /** `alreadyMember`: this phone was already in the group; nothing changed. */
  join: (input: { inviteToken?: string; joinCode?: string; displayName: string }) => Promise<{ group: GroupDetail; alreadyMember: boolean }>;
  /** The group you're in tonight (opted in, night active), for the Leave strip and If missed. */
  tonightGroup: GroupDetail | null;
  /** A group active tonight that you haven't joined yet (the home screen offers 参加). */
  tonightOpenGroup: GroupDetail | null;
  /** Every group you're sharing your leave time with tonight. */
  sharingTonight: GroupDetail[];
  /** 今夜はやめる in each of them (you stay in the groups). */
  stopSharingTonight: () => Promise<void>;
};

const GroupsContext = createContext<GroupsValue | null>(null);

function errorStatus(error: unknown): number | undefined {
  return (error as { status?: number } | null)?.status;
}

export function GroupsProvider({ children }: { children: React.ReactNode }) {
  const { plan, language, isHydrated } = useLastRide();
  const { groupCreationHeaders } = usePremium();
  const [memberships, setMemberships] = useState<GroupMembership[]>([]);
  const [details, setDetails] = useState<Record<string, GroupDetail>>({});
  const [loading, setLoading] = useState(true);
  const [credentialError, setCredentialError] = useState(false);
  const available = !!apiBaseUrl;
  const membershipsRef = useRef(memberships);
  membershipsRef.current = memberships;
  const refreshGuard = useRef(new GroupRefreshGuard());
  // One registration per group, language and OS push token per app session.
  // Re-check each time the app becomes active (permission or token can change).
  const deviceRegistrations = useRef<Record<string, string>>({});
  // Guard only duplicate sends during the SAME membership lifetime. Opt-out,
  // group reset and re-join clear it so the next night can publish again.
  const sent = useRef<Record<string, string | null>>({});

  const memberOptions = useCallback(
    (groupId: string): RequestInit => {
      const token = membershipsRef.current.find((item) => item.groupId === groupId)?.memberToken ?? "";
      return { headers: { "X-Member-Token": token } };
    },
    [],
  );

  const apply = useCallback((detail: GroupDetail) => {
    refreshGuard.current.changed(detail.id);
    setDetails((current) => ({ ...current, [detail.id]: detail }));
    const known = membershipsRef.current.find((item) => item.groupId === detail.id);
    if (known && known.name !== detail.name) {
      // Do not optimistically claim a name has been saved, or leave an
      // unhandled rejection when Keychain/AsyncStorage is unavailable.
      // Rename only the metadata: never rewrite or downgrade a host token.
      void renameMembership(detail.id, detail.name)
        .then(() => {
          setMemberships((current) => current.map((item) =>
            item.groupId === detail.id && item.memberToken === known.memberToken
              ? { ...item, name: detail.name }
              : item,
          ));
        })
        .catch(() => {
          // The server's name is already in details; a later refresh retries
          // persistence when storage is writable again.
        });
    }
  }, []);

  const forget = useCallback(async (groupId: string) => {
    refreshGuard.current.changed(groupId);
    delete deviceRegistrations.current[groupId];
    delete sent.current[groupId];
    await removeMembership(groupId);
    await stopSharing(groupId);
    setMemberships((current) => current.filter((item) => item.groupId !== groupId));
    setDetails((current) => {
      const { [groupId]: _removed, ...rest } = current;
      return rest;
    });
  }, []);

  const leaveAll = useCallback(async () => {
    // An in-flight POST may already have created a host whose response never
    // arrived. Prevent reset from hiding its only recovery credential.
    if (await readPendingGroupCreation()) throw new Error("PENDING_GROUP_CREATION");
    if (await readPendingGroupJoin()) throw new Error("PENDING_GROUP_JOIN");
    const list = await readMemberships();
    await Promise.all(
      list.map(async (membership) => {
        // No AbortSignal.timeout() in React Native (see lib/fetchWithTimeout).
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8_000);
        try {
          await resetGroupMembership(membership.groupId, {
            headers: { "X-Member-Token": membership.memberToken },
            signal: controller.signal,
          });
        } catch (error) {
          // A confirmed 404 means the server already removed this membership.
          // Network outages must NOT destroy the only local host credential.
          if (errorStatus(error) !== 404) throw error;
        } finally {
          clearTimeout(timer);
        }
      }),
    );
    await clearMemberships();
    await clearSharing();
    for (const member of list) refreshGuard.current.changed(member.groupId);
    setMemberships([]);
    setDetails({});
    deviceRegistrations.current = {};
    sent.current = {};
  }, []);

  const clearUnavailableMemberships = useCallback(async () => {
    // Do not discard the only recovery proof of a partially committed
    // group create or join. An in-flight operation must be resolved first.
    if (await readPendingGroupCreation()) throw new Error("PENDING_GROUP_CREATION");
    if (await readPendingGroupJoin()) throw new Error("PENDING_GROUP_JOIN");
    // This is local recovery only: we cannot authenticate missing keys to
    // call the group leave API. The UI must warn about server-side remnants.
    await clearMemberships();
    await clearSharing();
    for (const item of membershipsRef.current) refreshGuard.current.changed(item.groupId);
    setMemberships([]);
    setDetails({});
    deviceRegistrations.current = {};
    sent.current = {};
    setCredentialError(false);
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    let list: GroupMembership[];
    try {
      list = await readMemberships();
      setCredentialError(false);
    } catch {
      // An Android backup may restore an index without its Keystore keys.
      // Never show an empty group list or spin indefinitely on this failure.
      setCredentialError(true);
      setLoading(false);
      return;
    }
    setMemberships(list);
    if (!available) {
      setLoading(false);
      return;
    }
    await Promise.all(list.map(async (membership) => {
      const ticket = refreshGuard.current.begin(membership.groupId);
      try {
        const detail = await getGroup(membership.groupId, {
          headers: { "X-Member-Token": membership.memberToken },
        });
        if (refreshGuard.current.isCurrent(ticket)) apply(detail);
      } catch (error) {
        // Don't let a stale 404 delete a membership after a successful mutation.
        if (errorStatus(error) === 404 && refreshGuard.current.isCurrent(ticket))
          await forget(membership.groupId);
      }
    }));
    setLoading(false);
  }, [available, apply, forget]);

  /** Reloads one group (after a silent "group updated" push). */
  const refreshGroup = useCallback(
    async (groupId: string) => {
      if (!available) return;
      let membership: GroupMembership | undefined;
      try {
        membership = (await readMemberships()).find((item) => item.groupId === groupId);
      } catch {
        setCredentialError(true);
        return;
      }
      if (!membership) return;
      const ticket = refreshGuard.current.begin(groupId);
      try {
        const detail = await getGroup(groupId, { headers: { "X-Member-Token": membership.memberToken } });
        if (refreshGuard.current.isCurrent(ticket)) apply(detail);
      } catch (error) {
        if (errorStatus(error) === 404 && refreshGuard.current.isCurrent(ticket)) await forget(groupId);
      }
    },
    [available, apply, forget],
  );

  // No polling (it would keep the server's database awake): refresh on opening
  // the app, and when the server says a group changed (lib/groupUpdates).
  useEffect(() => {
    void refresh();
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    const stopUpdates = startGroupUpdates();
    const stopListening = onGroupUpdated((groupId) => {
      if (AppState.currentState !== "active") return; // refreshed on opening anyway
      void (groupId ? refreshGroup(groupId) : refresh());
    });
    return () => {
      appState.remove();
      stopUpdates();
      stopListening();
    };
  }, [refresh, refreshGroup]);

  // iOS can suspend a motionless background task indefinitely. Retry ONLY
  // durable pending leave-time changes whenever the app becomes active, and
  // occasionally while open (including after Wi-Fi connectivity returns).
  // Empty outbox: no HTTP requests. Unmount always clears the timer.
  useEffect(() => {
    if (!isHydrated || !available) return;
    const retry = () => { if (AppState.currentState === 'active') void flushPendingSharedLeaveBy().catch(() => undefined); };
    retry();
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') retry();
    });
    const timer = setInterval(retry, 30_000);
    return () => { clearInterval(timer); listener.remove(); };
  }, [isHydrated, available]);

  // Remember which groups this phone shares with tonight (and the time they
  // have), so background tracking can keep them current (lib/groupSharing).
  useEffect(() => {
    for (const detail of Object.values(details)) {
      const mine =
        detail.tonight.active &&
        detail.tonight.participants.find((participant) => participant.memberId === detail.me.memberId);
      if (mine) void markSharing(detail.id, mine.leaveBy ? new Date(mine.leaveBy).toISOString() : null, mine.leaveRevision).catch(() => undefined);
      else void stopSharing(detail.id).catch(() => undefined);
    }
  }, [details]);

  /**
   * Re-register existing members when the app reopens or notification
   * permissions / Expo push token / language changes. A null token explicitly
   * unregisters a revoked notification permission on the server.
   *
   * No extra prompt is shown; expoPushToken checks existing permission only.
   */
  const refreshDeviceRegistrations = useCallback(async () => {
    if (!available) return;
    let members: GroupMembership[];
    try {
      members = await readMemberships();
    } catch {
      setCredentialError(true);
      return;
    }
    if (members.length === 0) return;
    const token = await expoPushToken();
    const locale = language ?? "ja";
    const signature = JSON.stringify([locale, token]);
    await Promise.all(members.map(async (membership) => {
      if (deviceRegistrations.current[membership.groupId] === signature) return;
      try {
        const detail = await updateMyGroupMembership(
          membership.groupId,
          { language: locale, expoPushToken: token },
          { headers: { "X-Member-Token": membership.memberToken } },
        );
        deviceRegistrations.current[membership.groupId] = signature;
        apply(detail);
      } catch {
        // Keep the capability and retry on the next foreground transition.
      }
    }));
  }, [available, language, apply]);

  useEffect(() => {
    void refreshDeviceRegistrations();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshDeviceRegistrations();
    });
    return () => listener.remove();
  }, [refreshDeviceRegistrations, memberships]);

  const remember = useCallback(
    async (memberToken: string, detail: GroupDetail, displayName: string) => {
      const membership = { groupId: detail.id, memberToken, name: detail.name };
      delete sent.current[detail.id];
      await saveMembership(membership);
      await writeDisplayName(displayName);
      setMemberships((current) => [...current.filter((item) => item.groupId !== detail.id), membership]);
      apply(detail);
      // The membership effect registers push and language once saved.
    },
    [apply],
  );

  /**
   * The creation capability is written before network I/O, and cleared only
   * after the returned host membership was durably written on this device.
   * A timeout, force-kill or response-loss cannot generate a second host.
   */
  const resumePendingCreation = useCallback(async () => {
    const pending = await readPendingGroupCreation();
    if (!pending) return null;
    let session: Awaited<ReturnType<typeof createGroup>>;
    try {
      session = await createGroup(
        { name: pending.name, displayName: pending.displayName, language: pending.language },
        { headers: {
          ...await groupCreationHeaders(),
          "X-Group-Create-Key": pending.creationKey,
        } },
      );
    } catch (error) {
      if (creationDefinitelyRejected(errorStatus(error))) await finishGroupCreation(pending.creationKey);
      throw error;
    }
    await remember(session.memberToken, session.group, pending.displayName);
    await finishGroupCreation(pending.creationKey);
    return session.group;
  }, [groupCreationHeaders, remember]);

  const create = useCallback(
    async (name: string, displayName: string) => {
      const pending = await prepareGroupCreation(name, displayName, language ?? "ja");
      let session: Awaited<ReturnType<typeof createGroup>>;
      try {
        session = await createGroup(
          { name: pending.name, displayName: pending.displayName, language: pending.language },
          { headers: {
            ...await groupCreationHeaders(),
            "X-Group-Create-Key": pending.creationKey,
          } },
        );
      } catch (error) {
        if (creationDefinitelyRejected(errorStatus(error))) await finishGroupCreation(pending.creationKey);
        throw error;
      }
      await remember(session.memberToken, session.group, pending.displayName);
      await finishGroupCreation(pending.creationKey);
      return session.group;
    },
    [groupCreationHeaders, language, remember],
  );

  // Restore a creation interrupted between the server's DB commit and the
  // device's membership write. Never delete pending credentials on a 402/503.
  const pendingRecoveryRunning = useRef(false);
  useEffect(() => {
    if (!isHydrated || !available || pendingRecoveryRunning.current) return;
    pendingRecoveryRunning.current = true;
    void resumePendingCreation().catch(() => undefined).finally(() => {
      pendingRecoveryRunning.current = false;
    });
  }, [isHydrated, available, resumePendingCreation]);

  /** Recover a join committed just before the app lost the response. */
  const resumePendingJoin = useCallback(async () => {
    const pending = await readPendingGroupJoin();
    if (!pending) return null;
    const knownMemberTokens = (await readMemberships()).map((item) => item.memberToken).slice(0, 50);
    let session: Awaited<ReturnType<typeof joinGroup>>;
    try {
      session = await joinGroup({
        ...(pending.inviteToken ? { inviteToken: pending.inviteToken } : { joinCode: pending.joinCode }),
        displayName: pending.displayName, language: pending.language, knownMemberTokens,
      }, { headers: { "X-Group-Join-Key": pending.joinKey } });
    } catch (error) {
      if (joinDefinitelyRejected(errorStatus(error))) await finishGroupJoin(pending.joinKey);
      throw error;
    }
    await remember(session.memberToken, session.group, pending.displayName);
    await finishGroupJoin(pending.joinKey);
    return session.group;
  }, [remember]);

  const join = useCallback(
    async (input: { inviteToken?: string; joinCode?: string; displayName: string }) => {
      const pending = await prepareGroupJoin({ ...input, language: language ?? "ja" });
      const knownMemberTokens = (await readMemberships()).map((item) => item.memberToken).slice(0, 50);
      let session: Awaited<ReturnType<typeof joinGroup>>;
      try {
        session = await joinGroup({
          ...input, language: pending.language, knownMemberTokens,
        }, { headers: { "X-Group-Join-Key": pending.joinKey } });
      } catch (error) {
        if (joinDefinitelyRejected(errorStatus(error))) await finishGroupJoin(pending.joinKey);
        throw error;
      }
      const existing = membershipsRef.current.find((item) => item.groupId === session.group.id);
      if (existing && existing.memberToken !== session.memberToken) {
        // A valid existing membership takes precedence; don't overwrite a
        // host capability with a just-issued normal member credential.
        if (!session.alreadyMember)
          void leaveGroup(session.group.id, { headers: { "X-Member-Token": session.memberToken } }).catch(() => undefined);
        await finishGroupJoin(pending.joinKey);
        await refreshGroup(session.group.id);
        return { group: details[session.group.id] ?? session.group, alreadyMember: true };
      }
      await remember(session.memberToken, session.group, input.displayName);
      await finishGroupJoin(pending.joinKey);
      return { group: session.group, alreadyMember: Boolean(session.alreadyMember || existing) };
    },
    [language, remember, refreshGroup, details],
  );

  const pendingJoinRecoveryRunning = useRef(false);
  useEffect(() => {
    if (!isHydrated || !available || pendingJoinRecoveryRunning.current) return;
    pendingJoinRecoveryRunning.current = true;
    void resumePendingJoin().catch(() => undefined).finally(() => {
      pendingJoinRecoveryRunning.current = false;
    });
  }, [isHydrated, available, resumePendingJoin]);

  // Keep tonight's leave-by current in every group you've opted into tonight.
  const leaveBy = plan ? new Date(recommendedLeaveTime(plan)).toISOString() : null;
  useEffect(() => {
    if (!isHydrated || !available) return;
    for (const detail of Object.values(details)) {
      const mine = detail.tonight.active && detail.tonight.participants.find((participant) => participant.memberId === detail.me.memberId);
      if (!mine) continue;
      const serverValue = mine.leaveBy ? new Date(mine.leaveBy).toISOString() : null;
      if (serverValue === leaveBy || sent.current[detail.id] === leaveBy) continue;
      sent.current[detail.id] = leaveBy;
      void (async () => {
        // Ensure the group has a saved opt-in before queuing. The foreground
        // and headless background paths share one durable, serialized outbox.
        await markSharing(detail.id, serverValue, mine.leaveRevision);
        // Sending null to clear an old leave time is also durable. In
        // particular, don't mark the group as opted out just because the
        // rider has no current departure plan.
        const updated = await syncSharedLeaveByForGroup(
          detail.id, leaveBy === null ? null : Date.parse(leaveBy),
        );
        if (updated) apply(updated);
      })().catch(() => {
        sent.current[detail.id] = null;
      });
    }
  }, [details, leaveBy, isHydrated, available, apply]);

  const groups = useMemo(
    () => memberships.map((membership) => ({ membership, detail: details[membership.groupId] ?? null })),
    [memberships, details],
  );

  const tonightGroup = useMemo(
    () =>
      groups
        .map((entry) => entry.detail)
        .find(
          (detail): detail is GroupDetail =>
            !!detail && detail.tonight.active && detail.tonight.participants.some((participant) => participant.memberId === detail.me.memberId),
        ) ?? null,
    [groups],
  );
  const sharingTonight = useMemo(
    () =>
      groups
        .map((entry) => entry.detail)
        .filter(
          (detail): detail is GroupDetail =>
            !!detail && detail.tonight.active && detail.tonight.participants.some((participant) => participant.memberId === detail.me.memberId),
        ),
    [groups],
  );
  const stopSharingTonight = useCallback(async () => {
    await Promise.all(
      sharingTonight.map(async (detail) => {
        const result = await leaveGroupTonight(detail.id, memberOptions(detail.id)).catch(() => null);
        if (result) {
          await stopSharing(detail.id); // do not replay an offline update after opting out
          delete sent.current[detail.id];
          apply(result);
        }
      }),
    );
  }, [sharingTonight, memberOptions, apply]);
  const tonightOpenGroup = useMemo(
    () =>
      tonightGroup
        ? null
        : (groups
            .map((entry) => entry.detail)
            .find((detail): detail is GroupDetail => !!detail && detail.tonight.active) ?? null),
    [groups, tonightGroup],
  );

  const value = useMemo(
    () => ({ groups, loading, credentialError, clearUnavailableMemberships, available, refresh, refreshGroup, memberOptions, apply, forget, leaveAll, create, join, tonightGroup, tonightOpenGroup, sharingTonight, stopSharingTonight }),
    [groups, loading, credentialError, clearUnavailableMemberships, available, refresh, refreshGroup, memberOptions, apply, forget, leaveAll, create, join, tonightGroup, tonightOpenGroup, sharingTonight, stopSharingTonight],
  );
  return <GroupsContext.Provider value={value}>{children}</GroupsContext.Provider>;
}

export function useGroups() {
  const value = useContext(GroupsContext);
  if (!value) throw new Error("useGroups must be used inside GroupsProvider");
  return value;
}

/** Status code of a failed API call, if any. */
export { errorStatus };
