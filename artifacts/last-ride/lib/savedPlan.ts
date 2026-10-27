/**
 * The last plan, kept on the phone. A cold start in a basement bar with no
 * signal should still show tonight's leave-by time rather than an error, so the
 * plan is saved whenever it changes and read back on launch — but only while it
 * still belongs to tonight.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NightPlan, StationChoice } from '@/lib/planner';
import { walkingUncertaintyMarginMinutes, recommendedLeaveTime } from '@/lib/reliability';
import { MINUTE_MS } from '@/lib/time';
import { serviceDate } from '@/lib/time';

const SAVED_PLAN_KEY = 'lastride-last-plan';

export async function writeSavedPlan(plan: NightPlan | null): Promise<void> {
  if (!plan) return; // clearing happens on reset, not every time a plan is dropped
  await AsyncStorage.setItem(SAVED_PLAN_KEY, JSON.stringify(plan)).catch(() => undefined);
}

export async function clearSavedPlan(): Promise<void> {
  await AsyncStorage.removeItem(SAVED_PLAN_KEY).catch(() => undefined);
}

/** A saved plan from a pre-provenance release has no evidence of pedestrian
 * routing. Retain tonight's offline plan but advance its recommended alert;
 * never silently label an unknown route as a confirmed MapKit walk. */
function upgradeLegacyWalkingChoice<T extends StationChoice>(choice: T): T {
  if (choice.walkingSource === 'routed' || choice.walkingSource === 'estimated') return choice;
  const extra = walkingUncertaintyMarginMinutes(choice.walkingMinutes, undefined);
  return {
    ...choice,
    walkingSource: 'estimated',
    safetyMarginMinutes: (choice.safetyMarginMinutes ?? 0) + extra,
    recommendedLeaveByMs: recommendedLeaveTime(choice) - extra * MINUTE_MS,
  };
}

/** Cached plans are untrusted on upgrade or after an interrupted write.
 * Missing computedAt used to bypass the launch refresh comparison, potentially
 * leaving a user staring at a stale departure with no re-plan. */
function usableOfflinePlan(value: unknown, nowMs: number): value is NightPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<NightPlan>;
  const station = plan.station;
  const lastTrain = plan.lastTrain;
  const coordinates = plan.coordinates;
  return typeof plan.computedAt === 'number' && Number.isFinite(plan.computedAt) &&
    nowMs - plan.computedAt <= 36 * 60 * MINUTE_MS &&
    plan.computedAt <= nowMs + 5 * MINUTE_MS &&
    typeof plan.leaveByMs === 'number' && Number.isFinite(plan.leaveByMs) &&
    typeof lastTrain?.departsAt === 'number' && Number.isFinite(lastTrain.departsAt) &&
    typeof station?.nameJa === 'string' &&
    typeof plan.destination?.nameJa === 'string' &&
    typeof plan.walkingMinutes === 'number' && Number.isFinite(plan.walkingMinutes) &&
    plan.walkingMinutes >= 0 &&
    typeof coordinates?.latitude === 'number' && Number.isFinite(coordinates.latitude) &&
    typeof coordinates?.longitude === 'number' && Number.isFinite(coordinates.longitude) &&
    Math.abs(coordinates.latitude) <= 90 && Math.abs(coordinates.longitude) <= 180;
}

/** The saved plan, if it is still for tonight's trains. */
export async function readSavedPlan(): Promise<NightPlan | null> {
  try {
    const raw = await AsyncStorage.getItem(SAVED_PLAN_KEY);
    if (!raw) return null;
    const plan: unknown = JSON.parse(raw);
    const now = Date.now();
    if (!usableOfflinePlan(plan, now)) {
      await AsyncStorage.removeItem(SAVED_PLAN_KEY).catch(() => undefined);
      return null;
    }
    if (serviceDate(plan.lastTrain.departsAt) === serviceDate(now)) {
      return {
        ...upgradeLegacyWalkingChoice(plan),
        alternatives: (plan.alternatives ?? []).map(upgradeLegacyWalkingChoice),
        autoPick: plan.autoPick ? upgradeLegacyWalkingChoice(plan.autoPick) : plan,
      };
    }
    // Plans hold positions from Apple Maps: don't keep a past night's.
    await AsyncStorage.removeItem(SAVED_PLAN_KEY).catch(() => undefined);
    return null;
  } catch {
    return null;
  }
}
