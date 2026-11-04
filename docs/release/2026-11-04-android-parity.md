# Android parity with the iOS November release — 2026-11-04

**Status:** engineering work, not release approval. Native Android validation is required before merging or distributing. No backend migrations, store release, or production deployment in this work.

## Audit of recent iOS changes

Much of LastRide is shared React Native code and **already executes on Android**. Do not copy these screens or duplicate their state machines.

| iOS feature/fix (Nov 2–4) | Android status in current main | What to verify |
| --- | --- | --- |
| B2 Ride layout, dropdowns, station selection, check-time refresh, train choices, map-sized transitions | Shared screen; code present | Emulator and signed device, small screen, TalkBack, font scale |
| Group list/detail/settings, leave-time summaries, member initials, invitation handling | Shared screens and backend | Deep links, process death, notifications, Play/Keystore |
| 1本前/2本前 choice, station matching, rollover and holiday semantics | Shared planner; Apple-specific sources differ | Real Japan timetable corpus; do not assume Apple and Android sources give the same result |
| Privacy/terms notices and Premium management | Shared UI | Play/Galaxy billing flows and external subscription management |
| Live Activity / lock-screen countdown | Existing Android ongoing notification with Android 16 promotion attempt | Background and permission-revoked device tests; it is not iOS AlarmKit |
| iPhone home/lock-screen widget | **New Android home-screen RemoteViews widget in this branch** | Launcher picker, different sizes, themes, locale, battery saver, process death |
| iPhone reinstall/new-device group recovery via Keychain copy | **Not portable to Android** | Android Keystore secrets do not survive backup/reinstall; requires identity-backed recovery design |
| Apple MapKit transit and walking guidance | Android Google Maps and OS geocoder exist, **provider parity unverified** | No invented road routes; geocoding, railway data and walking route validation still P0 |

## Android widget implementation in this branch

- An Android AppWidgetProvider is provided by the existing native countdown module (Android only); it appears in the launcher widget picker and opens the app on tap.
- Its content comes from the **same pure widget timeline** as iOS, including Premium gating, Japanese/English, train and leave times, first-train and no-route states. No native widget network calls or GPS collection are introduced.
- State is cached locally in private app SharedPreferences. Do not add group secrets, tokens, raw coordinates or full journeys to the payload. The data is removed when the final widget is removed and refreshed on app state changes.
- An inexact, best-effort Android OS alarm advances known phases, with normal 30-minute widget updates as fallback. Android Doze and launchers can delay both; the widget therefore shows a last-checked label and always directs the user into the app to confirm current advice.
- An active route expires after **12 minutes without a fresh location/planning result**; an idle route after **25 minutes**. Expired advice becomes a refresh warning, not an apparently live last train. Native expiry updates can be delayed by the OS; this is not a last-train delivery guarantee.
- The iOS WidgetKit extension remains unchanged. Android’s widget is a separate small/medium-sized home-screen surface; **Android lock-screen widgets are not claimed as implemented**.

## Android QA gates before distribution

1. Assemble **signed** Play and Galaxy Android builds with the intended Maps API key and matching package name. Verify widget provider is present, can be added/removed and survives reboot.
2. Check every widget state (no Premium; free-to-paid/expired; not tracking; active; moving station; missed last train; first train; stopped; erase data) in Japanese/English and each theme.
3. Verify Android 12–16 foreground/background/Doze + revoked location and notification permissions; note expected delays rather than claiming iOS AlarmKit equivalence.
4. Test app widgets and notification state after app kill/relaunch, date rollover, timezone change and DST (while train clock displays Japan time).
5. Validate deep-link tap targets, launcher truncation (small/large text and font scaling), TalkBack labels, contrast and widget stale content.
6. Prove real JR/private rail and walking-route data parity in Japan before recommending exact train deadlines.
7. Verify group creation, joining, leaving, guest links, Android Keystore backup/restore and large-group push on actual devices. Android reinstall recovery still needs an approved identity design.
8. Run full CI and signed-device beta acceptance against `DEPLOYMENT-STOP-POINT.md`. This change does **not** close LR-003/005/010/036/040/041/055 or approve the public release.

## Validation evidence

- Mobile TypeScript and pure JS tests are run against the isolated branch, including new Android timeline tests.
- Native Android Gradle compilation and signed device evidence must be recorded explicitly after execution. Do not infer a green release from passing JS tests.
