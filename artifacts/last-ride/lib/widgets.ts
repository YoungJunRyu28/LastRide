/**
 * Keeps the iOS WidgetKit and Android home-screen widget in sync with tonight's
 * plan. Both use lib/widgetContent.ts for exactly the same train/phase logic.
 * Android uses a native RemoteViews widget instead of the iOS SwiftUI view;
 * its expiry warning matters because OS background jobs are not guaranteed.
 */
import { liveActivityEnabled } from '@/lib/liveActivity';
import { androidHomeWidgetAvailable, updateAndroidHomeWidget } from '@/modules/countdown-notification/src';
import { androidWidgetPayload } from '@/lib/androidWidgetTimeline';
import { MINUTE_MS } from '@/lib/time';
import type { NightPlan } from '@/lib/planner';
import { readPremiumCache } from '@/lib/premiumCache';
import { readWidgetTheme } from '@/lib/settings';
import type { TrainTime } from '@/lib/timetable';
import type { BoardedRecord } from '@/lib/boarding';
import {
  boardedTimeline,
  widgetSignature,
  widgetMessage,
  widgetTimeline,
  type WidgetMessageReason,
} from '@/lib/widgetContent';
import type { WidgetThemeId } from '@/lib/widgetThemes';

/** WidgetKit only; loading its SwiftUI code on Android would fail. */
function widget() {
  return (
    require('@/components/LeaveWidget') as typeof import('@/components/LeaveWidget')
  ).default;
}

let shownSignature: string | null = null;
let lastAndroidSyncAt = 0;

export type WidgetSyncOptions = {
  tracking: boolean;
  firstTrain?: TrainTime | null;
  reason?: string | null;
  theme?: WidgetThemeId;
  boarded?: BoardedRecord | null;
};

function messageReason(reason: string | null | undefined): WidgetMessageReason {
  if (reason === 'permission') return 'location-off';
  if (reason === 'near-home') return 'near-home';
  if (reason === 'no-route' || reason === 'no-station') return 'no-route';
  return 'no-plan';
}

export async function syncWidgets(
  plan: NightPlan | null,
  destinationLabel: string,
  language: 'ja' | 'en',
  nowMs = Date.now(),
  premium?: boolean,
  options: WidgetSyncOptions = { tracking: true },
): Promise<void> {
  if (!liveActivityEnabled && !androidHomeWidgetAvailable) return;
  const entitled = premium ?? (await readPremiumCache());
  const theme = options.theme ?? (await readWidgetTheme());
  const entries = !entitled
    ? [{ date: new Date(nowMs), props: widgetMessage(language, 'premium') }]
    : options.boarded
      ? boardedTimeline(options.boarded, destinationLabel, language, nowMs, theme)
    : plan
      ? widgetTimeline(plan, destinationLabel, language, nowMs, { tracking: options.tracking, firstTrain: options.firstTrain, theme })
      : [{ date: new Date(nowMs), props: widgetMessage(language, messageReason(options.reason), theme, destinationLabel) }];
  const next = widgetSignature(entries, nowMs);
  if (androidHomeWidgetAvailable) {
    // Unchanged station/time still needs periodic freshness updates.
    if (next === shownSignature && nowMs - lastAndroidSyncAt < 2 * MINUTE_MS) return;
    updateAndroidHomeWidget(JSON.stringify(androidWidgetPayload(entries, language, nowMs,
      plan?.computedAt ?? null, options.tracking)));
    lastAndroidSyncAt = nowMs;
    shownSignature = next;
    return;
  }
  if (next === shownSignature) return;
  widget().updateTimeline(entries);
  shownSignature = next;
}
