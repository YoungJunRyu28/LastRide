import AsyncStorage from "@react-native-async-storage/async-storage";
import type { NightPlan } from "@/lib/planner";
import { recommendedLeaveTime } from "@/lib/reliability";
import { STORAGE_KEYS } from "@/lib/settings";
import { serviceDate } from "@/lib/time";

const MAX_HISTORY_ENTRIES = 30;

export type NightHistoryEntry = {
  id: string;
  serviceDate: string;
  destinationId: string;
  destinationLabel: string;
  departureStation: string;
  departureStationJa: string;
  leaveByMs: number;
  lastTrainDepartsAt: number;
  arrivalMs: number | null;
  fareYen: number | null;
  updatedAt: number;
};

function validEntry(value: unknown): value is NightHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.serviceDate === "string" &&
    typeof entry.destinationId === "string" &&
    typeof entry.destinationLabel === "string" &&
    typeof entry.departureStation === "string" &&
    typeof entry.departureStationJa === "string" &&
    typeof entry.leaveByMs === "number" &&
    typeof entry.lastTrainDepartsAt === "number" &&
    (typeof entry.arrivalMs === "number" || entry.arrivalMs === null) &&
    (typeof entry.fareYen === "number" || entry.fareYen === null) &&
    typeof entry.updatedAt === "number"
  );
}

export async function readNightHistory(): Promise<NightHistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.nightHistory);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(validEntry)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_HISTORY_ENTRIES);
  } catch {
    return [];
  }
}

let historyQueue: Promise<void> = Promise.resolve();

async function upsertNightHistory(
  plan: NightPlan,
  destination: { id: string; label: string },
): Promise<void> {
  const date = serviceDate(plan.lastTrain.departsAt);
  const id = `${date}:${destination.id}`;
  const current = await readNightHistory();
  const next: NightHistoryEntry = {
    id,
    serviceDate: date,
    destinationId: destination.id,
    destinationLabel: destination.label,
    departureStation: plan.station.name,
    departureStationJa: plan.station.nameJa,
    leaveByMs: recommendedLeaveTime(plan),
    lastTrainDepartsAt: plan.lastTrain.departsAt,
    arrivalMs: plan.arriveHomeMs ?? plan.lastTrain.arrivesAt ?? null,
    fareYen: plan.lastTrain.fareYen ?? null,
    updatedAt: plan.computedAt,
  };
  const merged = [next, ...current.filter((entry) => entry.id !== id)]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_HISTORY_ENTRIES);
  await AsyncStorage.setItem(STORAGE_KEYS.nightHistory, JSON.stringify(merged));
}

export function recordNightPlan(
  plan: NightPlan,
  destination: { id: string; label: string },
): Promise<void> {
  historyQueue = historyQueue.then(
    () => upsertNightHistory(plan, destination),
    () => upsertNightHistory(plan, destination),
  );
  return historyQueue;
}

export async function clearNightHistory(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEYS.nightHistory);
}
