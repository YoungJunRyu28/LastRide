# iOS AlarmKit reminders

LastRide keeps the existing 30/15/10/5-minute selector. Each enabled reminder, plus the always-on 0-minute departure alert, now has its own alarm-vs-notification delivery mode. Alarm delivery is **opt-in**. Settings are stored locally in AsyncStorage and used by both foreground and background location scheduling. No server migration is necessary.

## Technical behavior

- iOS 26+ compiled native apps schedule system alarms using AlarmKit; user permission is requested on selecting full alarm.
- The native module bundles three original CAF tones (Pulse, Chime, Urgent), plus Apple’s standard alert sound.
- If AlarmKit is unavailable, denied or scheduling fails, delivery falls back to a normal notification, which requires its own permission.
- The existing missed-the-train check-in remains a normal notification.
- Rescheduling replaces owned notifications and app-owned native alarms. Cancel/stop/reset cancel both.
- Android supports vibration on/off for ordinary notifications with separate notification channels.

## Important iOS limits

AlarmKit provides **no supported API for per-alarm volume or setting the physical iPhone volume to maximum**. The app explains how to change the volume in iOS Settings → Sounds & Haptics rather than creating a nonworking slider. Similarly, iOS decides native alarm and notification vibrations, so a per-alert iOS vibration switch cannot reliably override Sounds & Haptics settings. The Clock app's full ringtone library isn't exposed publicly.

## Physical-device verification

1. Build a native iOS 26+ app (Expo Go does not load local native modules). Verify the final app bundle contains all three `lastride_*.caf` files.
2. Select Full alarm, grant AlarmKit permission and use **Test alarm in 15 seconds** to test all four sound choices on a physical phone. Test locked, backgrounded, Silent Mode and Focus.
3. Reject alarm permission to confirm normal notification fallback, and reject notification permission to confirm the UI warning.
4. Modify the station/route, lead time, and notification settings while tracking, including from the background; confirm old alarms are canceled rather than stacked.
5. Stop tracking and reset settings; no obsolete native alarm should remain. Check 0-minute reminders still schedule with zero lead-time chips selected.
6. Check Android's two vibration channels and older iOS normal-notification fallback.

Native sound/volume behavior cannot be validated from TypeScript tests or simulator alone. **Verify on a physical iPhone before release.**
