# Offline-plan persistence and Android location notice (2026-10-27)

Code fixes in draft PR #48. **Not a public-release approval.**

## Durable cached departure order

The React provider writes tonight's last-train plan to AsyncStorage whenever
a calculation changes, so the last known departure remains accessible when
network connectivity disappears. Native storage operations can settle out of
order. Previously an older calculation could overwrite a newer plan, a delayed
write could resurrect a plan after clearing it, and cleanup from a stale read
could remove a newer cached plan.

All operations on the saved-plan key now run in one serial queue. The queue does
not release on a timeout, so a slow native operation cannot race a newer one
after the watchdog expires. A plan with an older computed timestamp is
rejected if a newer timestamp was already submitted. Explicit reset clears the
timestamp fence and removes the saved plan **after** all queued writes settle.
Pending React effects from an earlier reset session cannot enqueue their old
plans, and the UI clears the previous plan immediately when a reset begins.

Tests deliberately delay native read/write operations to check five failure
modes: stale-writer completion, reset during a write, invalid cache read during
a new write, older calculation submitted after a newer one, and a new session
saving normally after reset. Existing legacy walking-provenance and corrupted
cache validation tests are retained.

## Android location foreground service

The mandatory Android ongoing-location notification used a hard-coded English
title and description even when users selected Japanese. The message now
identifies that location data is in use and uses the selected app language.
A location task's native configuration identity includes the selected language
on Android, so switching locale while tracking updates the notice without
waiting for an unrelated movement/accuracy profile change. iOS does not need
a restart on language change for an Android-only foreground-service notice.

## Remaining verification

- Real Android devices (including a suspended app and system language switch):
  notification title/body, foreground service reconfiguration, permission
  revocation and Doze behavior.
- Delayed native storage and reset under repeated app termination/restoration
  and actual background-tracking updates.
- Licensed timetable source coverage, passenger walking route accuracy and
  iOS/Android itinerary parity remain P0 release gates.
- Passing unit tests, typechecks and bundling do not establish physical-device
  delivery or safe public launch.

Review gates: DEPLOYMENT-STOP-POINT.md.
