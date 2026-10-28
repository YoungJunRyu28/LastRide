/**
 * 「高田馬場駅なら終電で12分遅く出られます」: a farther station worth knowing about.
 *
 * The plan always leaves from the closest station (lib/planner autoPick). A
 * farther one is never switched to by itself; when it gets the user home
 * meaningfully later, or avoids a line with a service problem, it is suggested
 * on the main screen (tap to use it) and, while tracking with the app closed,
 * at most once a night as a notification.
 *
 * Compared on the last train (終電) at each station, the times every station's
 * result holds, so the wording says 終電 even when the user heads for 1本前.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LONG_WALK_MINUTES, sameStation, type NightPlan, type StationChoice } from '@/lib/planner';
import { recommendedLeaveTime } from '@/lib/reliability';
import { MINUTE_MS, serviceDate } from '@/lib/time';

export type StationSuggestion = {
  option: StationChoice;
  /** later: leaves meaningfully later · clean: the closest station's route has a service problem, this one's doesn't. */
  reason: 'later' | 'clean';
  /** How much later the user can leave from it (negative: a clean route that leaves earlier). */
  gainMinutes: number;
};

/** Suggested on screen when it lets the user leave at least this much later. */
export const SUGGEST_GAIN_MINUTES = 10;
/** Worth a notification only from this much (the screen shows smaller gains). */
export const NOTIFY_GAIN_MINUTES = 15;
/** Its leave time must be at least this far ahead: time to read it and change plans. */
const ACT_MINUTES = 5;
/** No notification once leaving is this close: the leave reminders take over, and the app shows the card. */
const NOTIFY_LEAD_MINUTES = 10;

const hasProblem = (choice: StationChoice) => (choice.disruptionLines?.length ?? 0) > 0;

/**
 * The one station to suggest instead of the plan's, or null. None while a
 * station is locked (the user chose), while on the way to the train (times are
 * held), or for a 目安 time, a walk over 20 minutes, a last train gone or a
 * leave time too close to act on. With several, the latest leave time wins.
 */
export function stationSuggestion(plan: NightPlan, nowMs: number): StationSuggestion | null {
  if (plan.pinned || plan.frozenUntil !== undefined) return null;
  // The automatic pick with its last train, whatever train the user heads for.
  const base = plan.autoPick ?? plan;
  const baseLeave = recommendedLeaveTime(base);
  const usable = (plan.alternatives ?? [])
    .filter((option) =>
      !sameStation(option.station, base.station) &&
      !option.lastTrain.approximate &&
      option.walkingMinutes <= LONG_WALK_MINUTES &&
      option.lastTrain.departsAt > nowMs &&
      recommendedLeaveTime(option) >= nowMs + ACT_MINUTES * MINUTE_MS &&
      !hasProblem(option))
    .map((option) => ({ option, gainMinutes: Math.floor((recommendedLeaveTime(option) - baseLeave) / MINUTE_MS) }))
    .sort((first, second) => second.gainMinutes - first.gainMinutes || first.option.walkingMinutes - second.option.walkingMinutes);
  if (usable.length === 0) return null;
  // A problem on the closest station's line: the clean route with the latest leave time, even if earlier.
  if (hasProblem(base)) return { ...usable[0], reason: 'clean' };
  return usable[0].gainMinutes >= SUGGEST_GAIN_MINUTES ? { ...usable[0], reason: 'later' } : null;
}

/** Tonight's record: what was notified, and stations already seen on screen or dismissed. */
export type SuggestionLog = {
  night: string;
  /** Reasons a notification went out for (once each a night). */
  notified: StationSuggestion['reason'][];
  /** Stations (Japanese names) whose suggestion was shown in the open app. */
  seen: string[];
  /** Stations whose suggestion the user closed: not shown again tonight. */
  dismissed: string[];
};

const LOG_KEY = 'lastride-station-suggestions';

export function suggestionNight(plan: NightPlan): string {
  return serviceDate((plan.autoPick ?? plan).lastTrain.departsAt);
}

export async function readSuggestionLog(night: string): Promise<SuggestionLog> {
  const empty: SuggestionLog = { night, notified: [], seen: [], dismissed: [] };
  try {
    const raw = await AsyncStorage.getItem(LOG_KEY);
    const stored = raw ? (JSON.parse(raw) as SuggestionLog) : null;
    return stored && stored.night === night
      ? { night, notified: stored.notified ?? [], seen: stored.seen ?? [], dismissed: stored.dismissed ?? [] }
      : empty;
  } catch {
    return empty;
  }
}

export async function recordSuggestion(night: string, change: (log: SuggestionLog) => SuggestionLog): Promise<SuggestionLog> {
  const next = change(await readSuggestionLog(night));
  await AsyncStorage.setItem(LOG_KEY, JSON.stringify(next)).catch(() => undefined);
  return next;
}

const withName = (list: string[], name: string) => (list.includes(name) ? list : [...list, name]);
export const markSeen = (night: string, station: string) => recordSuggestion(night, (log) => ({ ...log, seen: withName(log.seen, station) }));
export const markDismissed = (night: string, station: string) => recordSuggestion(night, (log) => ({ ...log, dismissed: withName(log.dismissed, station) }));

/**
 * Whether the background task should send this suggestion as a notification:
 * once a night for each reason (one 「遅く出られます」, one for a service
 * problem), never for a station already seen in the app or dismissed, a later
 * time only from NOTIFY_GAIN_MINUTES, and only while the user's own leave time
 * (`leaveAtMs`, the train they head for) is at least 10 minutes away.
 */
export function shouldNotifySuggestion(suggestion: StationSuggestion, log: SuggestionLog, leaveAtMs: number, nowMs: number): boolean {
  if (log.notified.includes(suggestion.reason)) return false;
  const name = suggestion.option.station.nameJa;
  if (log.seen.includes(name) || log.dismissed.includes(name)) return false;
  if (suggestion.reason === 'later' && suggestion.gainMinutes < NOTIFY_GAIN_MINUTES) return false;
  return leaveAtMs - nowMs >= NOTIFY_LEAD_MINUTES * MINUTE_MS;
}

/** The suggestion in words, for the screen and the notification. */
export function suggestionText(suggestion: StationSuggestion, ja: boolean): { title: string; body: string } {
  const { option, gainMinutes } = suggestion;
  const walk = option.walkingSource === 'routed' ? '' : ja ? '（推定）' : ' (estimate)';
  const leave = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(recommendedLeaveTime(option)));
  if (suggestion.reason === 'clean') {
    return ja
      ? { title: `${option.station.nameJa}駅なら運行情報のない路線で帰れます`, body: `徒歩${option.walkingMinutes}分${walk} · ${leave}に出る` }
      : { title: `${option.station.name} avoids the line with service issues`, body: `${option.walkingMinutes} min walk${walk} · leave at ${leave}` };
  }
  return ja
    ? { title: `${option.station.nameJa}駅なら終電で${gainMinutes}分遅く出られます`, body: `徒歩${option.walkingMinutes}分${walk} · ${leave}に出る` }
    : { title: `${option.station.name}: leave ${gainMinutes} min later`, body: `${option.walkingMinutes} min walk${walk} · last train, leave at ${leave}` };
}
