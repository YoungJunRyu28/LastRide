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
import { expoPushToken } from "@/lib/pushToken";
import { recommendedLeaveTime } from "@/lib/reliability";

const REFRESH_MS = 60_000;

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
  join: (input: { inviteToken?: string; joinCode?: string; displayName: string }) => Promise<GroupDetail>;
  /** The group you're in tonight (opted in, night active), for the Leave strip and If missed. */
  tonightGroup: GroupDetail | null;
  /** A group active tonight that you haven't joined yet (the home screen offers 参加). */
  tonightOpenGroup: GroupDetail | null;
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

  const memberOptions = useCallback(
    (groupId: string): RequestInit => {
      const token = membershipsRef.current.find((item) => item.groupId === groupId)?.memberToken ?? "";
      return { headers: { "X-Member-Token": token } };
    },
    [],
  );

  const apply = useCallback((detail: GroupDetail) => {
    setDetails((current) => ({ ...current, [detail.id]: detail }));
    const known = membershipsRef.current.find((item) => item.groupId === detail.id);
    if (known && known.name !== detail.name) {
      const next = { ...known, name: detail.name };
      setMemberships((current) => current.map((item) => (item.groupId === detail.id ? next : item)));
      void saveMembership(next);
    }
  }, []);

  const forget = useCallback(async (groupId: string) => {
    await removeMembership(groupId);
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
        } catch {
          // Offline or already gone: the server cleanup handles what's left.
        } finally {
          clearTimeout(timer);
        }
      }),
    );
    await clearMemberships();
    setMemberships([]);
    setDetails({});
  }, []);

  const refresh = useCallback(async () => {
    const list = await readMemberships();
    setMemberships(list);
    if (!available) {
      setLoading(false);
      return;
    }
    await Promise.all(
      list.map(async (membership) => {
        try {
          apply(await getGroup(membership.groupId, { headers: { "X-Member-Token": membership.memberToken } }));
        } catch (error) {
          // 404: disbanded, removed, or the token is no longer valid.
          if (errorStatus(error) === 404) await forget(membership.groupId);
        }
      }),
    );
    setLoading(false);
  }, [available, apply, forget]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [refresh]);

  /** Registers push and language for a new membership; failures just mean no group pushes. */
  const registerDevice = useCallback(
    async (detail: GroupDetail, memberToken: string) => {
      const token = await expoPushToken();
      try {
        apply(
          await updateMyGroupMembership(
            detail.id,
            { language: language ?? "ja", ...(token ? { expoPushToken: token } : {}) },
            { headers: { "X-Member-Token": memberToken } },
          ),
        );
      } catch {
        // Keep the membership; the next refresh shows it anyway.
      }
    },
    [apply, language],
  );

  const remember = useCallback(
    async (memberToken: string, detail: GroupDetail, displayName: string) => {
      const membership = { groupId: detail.id, memberToken, name: detail.name };
      await saveMembership(membership);
      await writeDisplayName(displayName);
      setMemberships((current) => [...current.filter((item) => item.groupId !== detail.id), membership]);
      apply(detail);
      void registerDevice(detail, memberToken);
    },
    [apply, registerDevice],
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
      const session = await joinGroup({ ...input, language: language ?? "ja" });
      await remember(session.memberToken, session.group, input.displayName);
      return session.group;
    },
    [language, remember],
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
    () => ({ groups, loading, available, refresh, memberOptions, apply, forget, leaveAll, create, join, tonightGroup, tonightOpenGroup }),
    [groups, loading, available, refresh, memberOptions, apply, forget, leaveAll, create, join, tonightGroup, tonightOpenGroup],
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
