# Reliability-aware night planning

LastRide distinguishes two departure deadlines.

- **Absolute/latest practical deadline** (`leaveByMs`): last-train departure
  minus the current walking time and the 3-minute station-entry/platform
  buffer. This value is retained for backwards compatibility with plans saved
  by older app versions and is shown only as the hard fallback boundary.
- **Recommended departure**: the time LastRide asks the user to act on. It is
  deliberately earlier to absorb ordinary uncertainty. Reminders, Live
  Activity, night history and LastRide for Business all use this deadline.

## Safety margin

The recommended departure starts 4 minutes before the hard deadline, then adds:

- 2 minutes per transfer, capped at 6 transfer-margin minutes;
- 2 more minutes when the walk to the station is at least 15 minutes.

The route-specific margin is stored in new plans. Older saved plans derive the
same margin at read/use time, so an OTA update does not invalidate an active
night.

The app starts saying **Leave now** at the recommended departure. It changes to
**Hurry** only after the hard deadline has passed. That distinction is
intentional: between the two deadlines the route may still be physically
possible, but LastRide no longer considers it comfortably reliable.

## Automatic station choice and suggestions

The automatic pick is the closest station whose last train hasn't left. The
station in use stays until another is at least 3 minutes closer on foot, so two
nearby stations don't swap back and forth (each swap moving the leave time and
sending a notice). A farther station is never switched to by itself, however
much later it runs (`lib/planner.ts` `autoPick`).

A farther station is instead *suggested* (`lib/stationSuggestion.ts`) when it
lets the user leave at least 10 minutes later on the last train, or, when the
closest station's route has a current service incident, when it offers a clean
route. Never for a 目安 (approximate) time, a walk over 20 minutes, a route with
its own incident, a leave time under 5 minutes away, a locked station, or while
the plan is held on the way to the train. The main screen shows the one with
the latest leave time; tapping it locks that station for the night. With the
app closed, background tracking sends it as a notification at most once a night
per reason (later / clean route), from 15 minutes later, while the user's own
leave time is at least 10 minutes away, and never for a station already seen in
the app or dismissed.

When timetable legs are available, planning asks the existing disruption
endpoint once for the distinct lines used by candidate routes. The lookup is
best-effort; an unavailable disruption product never breaks core planning.

A station whose lookup fails (Apple's request limit, no connection) keeps its
earlier result for the rest of the night, since its trains don't change; the
walk is looked up from wherever the user is. The station in use is also looked
at when Apple's station search leaves it out although it is nearer than one
found, so a refused or varying answer can't make the closest station disappear.

Pinned stations still override the automatic choice.

## Adaptive station discovery

Normal planning evaluates the three nearest distinct stations to keep provider
work and latency bounded. It widens to six when either is true:

1. fewer than two viable routes were found;
2. one of the candidate routes has a current service incident.

A near deadline alone does not widen the search: the app is used most in the
last half hour, so that would roughly double provider calls on most plans,
and a farther station means a longer walk exactly when time is shortest.

Only newly discovered stations are evaluated on the second pass.

## Plan freshness

A plan is:

- **fresh** through 5 minutes old;
- **aging** after 5 minutes;
- **stale** after 12 minutes.

The leave screen always exposes plan health. Aging/stale plans can be tapped to
recalculate immediately. A saved plan can therefore still rescue a user in a
basement or outage, without being silently presented as live data.

Background tracking continues to use its existing movement/age re-plan rules.
If a background network lookup fails, the last valid plan remains available
and the foreground freshness indicator makes that degraded state visible.

## Testing invariants

Pure tests pin the safety-margin formula, freshness boundaries, disruption line
matching, disruption-aware station choice, adaptive search triggers, reminder
times, Live Activity deadline and history persistence. Any future change to
these rules should update both the implementation and tests deliberately.
