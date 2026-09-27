import "@/lib/api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import {
  joinEnterpriseEvent,
  leaveEnterpriseEvent,
  updateEventParticipant,
} from "@workspace/api-client-react";

const PARTICIPATION_KEY = "lastride-enterprise-participation";
const PARTICIPATION_SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

async function secureStoreAvailable(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  return SecureStore.isAvailableAsync().catch(() => false);
}

async function removeParticipation(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(PARTICIPATION_KEY).catch(() => undefined),
    secureStoreAvailable().then((available) =>
      available
        ? SecureStore.deleteItemAsync(
            PARTICIPATION_KEY,
            PARTICIPATION_SECURE_OPTIONS,
          ).catch(() => undefined)
        : undefined,
    ),
  ]);
}

export type EnterpriseParticipation = {
  participantToken: string;
  participantId: string;
  displayName: string;
  eventId: string;
  eventTitle: string;
  eventExpiresAt: string;
  lastSyncedLeaveByMs: number | null;
};

function isParticipation(value: unknown): value is EnterpriseParticipation {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.participantToken === "string" &&
    typeof item.participantId === "string" &&
    typeof item.displayName === "string" &&
    typeof item.eventId === "string" &&
    typeof item.eventTitle === "string" &&
    typeof item.eventExpiresAt === "string" &&
    (typeof item.lastSyncedLeaveByMs === "number" ||
      item.lastSyncedLeaveByMs === null)
  );
}

export async function readEnterpriseParticipation(): Promise<EnterpriseParticipation | null> {
  try {
    const secure = await secureStoreAvailable();
    let raw = secure
      ? await SecureStore.getItemAsync(
          PARTICIPATION_KEY,
          PARTICIPATION_SECURE_OPTIONS,
        )
      : await AsyncStorage.getItem(PARTICIPATION_KEY);

    // Migrate anonymous event capability tokens from older builds once.
    if (secure && !raw) {
      const legacy = await AsyncStorage.getItem(PARTICIPATION_KEY);
      if (legacy) {
        await SecureStore.setItemAsync(
          PARTICIPATION_KEY,
          legacy,
          PARTICIPATION_SECURE_OPTIONS,
        );
        await AsyncStorage.removeItem(PARTICIPATION_KEY);
        raw = legacy;
      }
    }

    const parsed = raw ? JSON.parse(raw) : null;
    if (!isParticipation(parsed)) {
      if (raw) await removeParticipation();
      return null;
    }
    if (Date.parse(parsed.eventExpiresAt) <= Date.now()) {
      await removeParticipation();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeParticipation(
  participation: EnterpriseParticipation,
): Promise<void> {
  const serialized = JSON.stringify(participation);
  if (await secureStoreAvailable()) {
    await SecureStore.setItemAsync(
      PARTICIPATION_KEY,
      serialized,
      PARTICIPATION_SECURE_OPTIONS,
    );
    await AsyncStorage.removeItem(PARTICIPATION_KEY).catch(() => undefined);
    return;
  }
  await AsyncStorage.setItem(PARTICIPATION_KEY, serialized);
}

export async function joinEnterpriseParticipation(input: {
  displayName: string;
  inviteToken?: string;
  joinCode?: string;
}): Promise<EnterpriseParticipation> {
  const session = await joinEnterpriseEvent(input);
  const participation: EnterpriseParticipation = {
    participantToken: session.participantToken,
    participantId: session.participant.id,
    displayName: session.participant.displayName,
    eventId: session.event.id,
    eventTitle: session.event.title,
    eventExpiresAt: session.event.expiresAt,
    lastSyncedLeaveByMs: null,
  };
  await writeParticipation(participation);
  return participation;
}

let syncQueue: Promise<void> = Promise.resolve();

async function syncLeaveBy(leaveByMs: number): Promise<void> {
  const current = await readEnterpriseParticipation();
  if (!current) return;
  if (
    current.lastSyncedLeaveByMs !== null &&
    Math.abs(current.lastSyncedLeaveByMs - leaveByMs) < 60_000
  ) {
    return;
  }

  try {
    await updateEventParticipant(
      { leaveBy: new Date(leaveByMs).toISOString() },
      { headers: { "X-Participant-Token": current.participantToken } },
    );
    const latest = await readEnterpriseParticipation();
    if (!latest || latest.participantToken !== current.participantToken) return;
    await writeParticipation({
      ...latest,
      lastSyncedLeaveByMs: leaveByMs,
    });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 401 || status === 410) {
      await removeParticipation();
    }
    throw error;
  }
}

export function syncEnterpriseLeaveBy(leaveByMs: number): Promise<void> {
  syncQueue = syncQueue.then(
    () => syncLeaveBy(leaveByMs),
    () => syncLeaveBy(leaveByMs),
  );
  return syncQueue;
}

export async function leaveCurrentEnterpriseEvent(): Promise<void> {
  const current = await readEnterpriseParticipation();
  if (!current) return;
  try {
    await leaveEnterpriseEvent({
      headers: { "X-Participant-Token": current.participantToken },
    });
  } finally {
    await removeParticipation();
  }
}

export async function clearEnterpriseParticipation(): Promise<void> {
  await removeParticipation();
}
