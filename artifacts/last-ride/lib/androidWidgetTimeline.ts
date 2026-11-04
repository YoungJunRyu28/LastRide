/** Convert the iOS widget's pure timeline into a small, platform-neutral payload.
 * Android renders it with RemoteViews; no Expo UI/SwiftUI runtime is involved.
 * A plan expires unless refreshed: an old location cannot remain travel advice.
 */
import type { WidgetEntry, LeaveWidgetProps } from '@/lib/widgetContent';
import { MINUTE_MS } from '@/lib/time';

export type AndroidWidgetEntry = {
  at: number;
  heading: string;
  primary: string;
  secondary: string;
  footer: string;
  url: string;
  background: string;
  foreground: string;
  accent: string;
  muted: string;
};

export type AndroidWidgetPayload = {
  expiresAt: number;
  staleMessage: string;
  openLabel: string;
  entries: AndroidWidgetEntry[];
};

function short(value: string, max = 100): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

function safeUrl(value: string): string {
  return /^last-ride:\/\/(ride|paywall|alternatives)(?:[/?#]|$)/.test(value)
    ? value
    : 'last-ride://ride';
}

function display(entry: WidgetEntry): AndroidWidgetEntry {
  const p: LeaveWidgetProps = entry.props;
  const primary = p.kind === 'message' ? p.message
    : p.kind === 'first' ? p.trainTime
    : p.kind === 'plan' ? `${p.trainTime} ${p.trainSuffix}`
    : p.target;
  const secondary = p.kind === 'message' ? p.hint
    : p.kind === 'first' ? p.trainHeading
    : p.kind === 'plan' ? p.leaveLine
    : p.inline;
  return {
    at: entry.date.getTime(),
    heading: short(p.heading, 60),
    primary: short(primary),
    secondary: short(secondary),
    footer: short(p.kind === 'message' ? '' : p.checked || p.footnote, 80),
    url: safeUrl(p.url),
    background: p.colors.background,
    foreground: p.colors.text,
    accent: p.kind === 'message' ? p.colors.alert : p.kind === 'live' && p.tone === 'train' ? p.colors.train : p.colors.leave,
    muted: p.colors.muted,
  };
}

/** Keep the current entry and future transitions (not a historic itinerary).
 * The native widget may update late due to Doze; it always shows the check time.
 */
export function androidWidgetPayload(
  entries: WidgetEntry[],
  language: 'ja' | 'en',
  nowMs: number,
  checkedAtMs: number | null,
  tracking: boolean,
): AndroidWidgetPayload {
  const sorted = [...entries].filter((entry) => Number.isFinite(entry.date.getTime()))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const current = [...sorted].reverse().findIndex((entry) => entry.date.getTime() <= nowMs);
  const start = current < 0 ? 0 : sorted.length - 1 - current;
  const selected = sorted.slice(start, start + 24);
  // Only expire travel advice quickly. A Premium, permission, or no-plan
  // message is not a route; it must not become a misleading "stale route".
  const hasRouteAdvice = selected.some((entry) => entry.props.kind !== 'message');
  const ageLimit = (tracking ? 12 : 25) * MINUTE_MS;
  const lastCheck = checkedAtMs === null || !Number.isFinite(checkedAtMs)
    ? nowMs : Math.min(checkedAtMs, nowMs);
  return {
    expiresAt: hasRouteAdvice
      ? Math.max(nowMs, Math.min(nowMs + ageLimit, lastCheck + ageLimit))
      : nowMs + 7 * 24 * 60 * MINUTE_MS,
    staleMessage: language === 'ja' ? '案内の確認が必要です' : 'Route needs a fresh check',
    openLabel: language === 'ja' ? 'タップして帰り時で確認' : 'Tap to check in LastRide',
    entries: selected.map(display),
  };
}
