import "@/lib/api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  joinEnterpriseEvent,
  leaveEnterpriseEvent,
  updateEventParticipant,
} from "@workspace/api-client-react";

const PARTICIPATION_KEY = "lastride-enterprise-participation";

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
    const raw = await AsyncStorage.getItem(PARTICIPATION_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!isParticipation(parsed)) return null;
    if (Date.parse(parsed.eventExpiresAt) <= Date.now()) {
      await AsyncStorage.removeItem(PARTICIPATION_KEY);
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
  await AsyncStorage.setItem(PARTICIPATION_KEY, JSON.stringify(participation));
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
      await AsyncStorage.removeItem(PARTICIPATION_KEY);
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
    await AsyncStorage.removeItem(PARTICIPATION_KEY);
  }
}

export async function clearEnterpriseParticipation(): Promise<void> {
  await AsyncStorage.removeItem(PARTICIPATION_KEY);
}
