/**
 * The last plan, kept on the phone. A cold start in a basement bar with no
 * signal should still show tonight's leave-by time rather than an error, so the
 * plan is saved whenever it changes and read back on launch — but only while it
 * still belongs to tonight.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NightPlan } from '@/lib/planner';
import { serviceDate } from '@/lib/time';

const SAVED_PLAN_KEY = 'lastride-last-plan';

export async function writeSavedPlan(plan: NightPlan | null): Promise<void> {
  if (!plan) return; // clearing happens on reset, not every time a plan is dropped
  await AsyncStorage.setItem(SAVED_PLAN_KEY, JSON.stringify(plan)).catch(() => undefined);
}

export async function clearSavedPlan(): Promise<void> {
  await AsyncStorage.removeItem(SAVED_PLAN_KEY).catch(() => undefined);
}

/** The saved plan, if it is still for tonight's trains. */
export async function readSavedPlan(): Promise<NightPlan | null> {
  try {
    const raw = await AsyncStorage.getItem(SAVED_PLAN_KEY);
    if (!raw) return null;
    const plan = JSON.parse(raw) as NightPlan;
    if (typeof plan?.leaveByMs !== 'number' || !plan.lastTrain) return null;
    if (serviceDate(plan.lastTrain.departsAt) === serviceDate(Date.now())) return plan;
    // Plans hold positions from Apple Maps: don't keep a past night's.
    await AsyncStorage.removeItem(SAVED_PLAN_KEY).catch(() => undefined);
    return null;
  } catch {
    return null;
  }
}
