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
  joinGroupTonight,
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
  saveMembership,
  writeDisplayName,
  type GroupMembership,
} from "@/lib/groupMemberships";
import { clearSharing, markSharing, stopSharing } from "@/lib/groupSharing";
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
  const { appUserId } = usePremium();
  const [memberships, setMemberships] = useState<GroupMembership[]>([]);
  const [details, setDetails] = useState<Record<string, GroupDetail>>({});
  const [loading, setLoading] = useState(true);
  const available = !!apiBaseUrl;
  const membershipsRef = useRef(memberships);
  membershipsRef.current = memberships;
  const refreshGuard = useRef(new GroupRefreshGuard());
  // One registration per group, language and OS push token per app session.
  // Re-check each time the app becomes active (permission or token can change).
  const deviceRegistrations = useRef<Record<string, string>>({});

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
      const next = { ...known, name: detail.name };
      setMemberships((current) => current.map((item) => (item.groupId === detail.id ? next : item)));
      void saveMembership(next);
    }
  }, []);

  const forget = useCallback(async (groupId: string) => {
    refreshGuard.current.changed(groupId);
    delete deviceRegistrations.current[groupId];
    await removeMembership(groupId);
    await stopSharing(groupId);
    setMemberships((current) => current.filter((item) => item.groupId !== groupId));
    setDetails((current) => {
      const { [groupId]: _removed, ...rest } = current;
      return rest;
    });
  }, []);

  const leaveAll = useCallback(async () => {
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
  }, []);

  const refresh = useCallback(async () => {
    const list = await readMemberships();
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
      const membership = (await readMemberships()).find((item) => item.groupId === groupId);
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

  // Remember which groups this phone shares with tonight (and the time they
  // have), so background tracking can keep them current (lib/groupSharing).
  useEffect(() => {
    for (const detail of Object.values(details)) {
      const mine =
        detail.tonight.active &&
        detail.tonight.participants.find((participant) => participant.memberId === detail.me.memberId);
      if (mine) void markSharing(detail.id, mine.leaveBy ? new Date(mine.leaveBy).toISOString() : null).catch(() => undefined);
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
    const members = await readMemberships();
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
      await saveMembership(membership);
      await writeDisplayName(displayName);
      setMemberships((current) => [...current.filter((item) => item.groupId !== detail.id), membership]);
      apply(detail);
      // The membership effect registers push and language once saved.
    },
    [apply],
  );

  const create = useCallback(
    async (name: string, displayName: string) => {
      const session = await createGroup(
        { name, displayName, language: language ?? "ja" },
        { headers: { "X-RevenueCat-App-User-Id": await appUserId() } },
      );
      await remember(session.memberToken, session.group, displayName);
      return session.group;
    },
    [appUserId, language, remember],
  );

  const join = useCallback(
    async (input: { inviteToken?: string; joinCode?: string; displayName: string }) => {
      // The tokens this phone holds: the server returns the existing membership
      // instead of adding the same person twice (e.g. the host opening their own link).
      const knownMemberTokens = membershipsRef.current.map((item) => item.memberToken).slice(0, 50);
      const session = await joinGroup({ ...input, language: language ?? "ja", knownMemberTokens });
      const existing = membershipsRef.current.find((item) => item.groupId === session.group.id);
      if (session.alreadyMember || existing) {
        // An older server added a second member anyway: remove it again at once.
        if (!session.alreadyMember && existing)
          void leaveGroup(session.group.id, { headers: { "X-Member-Token": session.memberToken } }).catch(() => undefined);
        // Never replace the membership this phone already has (a host would lose hosting).
        apply(session.group);
        return { group: session.group, alreadyMember: true };
      }
      await remember(session.memberToken, session.group, input.displayName);
      return { group: session.group, alreadyMember: false };
    },
    [language, remember, apply],
  );

  // Keep tonight's leave-by current in every group you've opted into tonight.
  const leaveBy = plan ? new Date(recommendedLeaveTime(plan)).toISOString() : null;
  const sent = useRef<Record<string, string | null>>({});
  useEffect(() => {
    if (!isHydrated || !available) return;
    for (const detail of Object.values(details)) {
      const mine = detail.tonight.active && detail.tonight.participants.find((participant) => participant.memberId === detail.me.memberId);
      if (!mine) continue;
      const serverValue = mine.leaveBy ? new Date(mine.leaveBy).toISOString() : null;
      if (serverValue === leaveBy || sent.current[detail.id] === leaveBy) continue;
      sent.current[detail.id] = leaveBy;
      void joinGroupTonight(detail.id, { leaveBy }, memberOptions(detail.id))
        .then(apply)
        .catch(() => {
          sent.current[detail.id] = null;
        });
    }
  }, [details, leaveBy, isHydrated, available, memberOptions, apply]);

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
        if (result) apply(result);
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
    () => ({ groups, loading, available, refresh, refreshGroup, memberOptions, apply, forget, leaveAll, create, join, tonightGroup, tonightOpenGroup, sharingTonight, stopSharingTonight }),
    [groups, loading, available, refresh, refreshGroup, memberOptions, apply, forget, leaveAll, create, join, tonightGroup, tonightOpenGroup, sharingTonight, stopSharingTonight],
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
