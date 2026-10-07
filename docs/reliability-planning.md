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

## Disruption-aware automatic station choice

When timetable legs are available, planning asks the existing disruption
endpoint once for the distinct lines used by candidate routes. The lookup is
best-effort; an unavailable disruption product never breaks core planning.

For automatic station selection only, a candidate with a current service
incident receives a 15-minute ranking penalty. This does not rewrite train
times or claim a delay duration. It simply requires a disrupted route to have a
meaningful timing advantage before LastRide recommends it.

Pinned stations still override the automatic choice.

## Adaptive station discovery

Normal planning evaluates the three nearest distinct stations to keep provider
work and latency bounded. It widens to six when any of these are true:

1. fewer than two viable routes were found;
2. one of the candidate routes has a current service incident;
3. the best recommended departure is within 30 minutes.

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
