# Reminders and iOS alarms

Settings → 出発リマインダー has two lists of times: 30, 15, 10 and 5 minutes before leaving, and 出発時刻 (the leave time itself).

- **通知 (notifications):** on by default at 15分前 and 出発時刻.
- **アラーム (alarms, iOS only):** off by default. Turning the switch on asks for AlarmKit permission and starts with 出発時刻. Turning it off moves its times back to notifications.

Each time is in one list at most: choosing it in one list removes it from the other. Nothing is scheduled unless the user chose it. The "missed the last train?" check-in has its own switch and is always a notification. Settings are stored on the phone and used by both the foreground app and the background location task.

## Technical behaviour

- iOS 26 and later schedule system alarms with AlarmKit (`modules/last-ride-alarm`). They show the full alarm screen, ring in silent mode and Focus, and have a localised Stop button (停止).
- The native module bundles three original tones (Pulse, Chime, Urgent, 2 s CAF); "iOS default" is Apple's alarm sound.
- When AlarmKit isn't available (iOS below 26), isn't allowed, or fails, an alarm time falls back to a time-sensitive notification that plays the chosen tone. It's quiet in silent mode. Settings explains this only to the people it applies to: an "update to iOS 26" note below iOS 26, or an "alarms aren't allowed" note with a Settings link.
- Tapping a tone previews it at once with a vibration (`previewSound`: AVAudioPlayer in the playback category, so it plays in silent mode, at media volume). Apps can't play Apple's default alarm sound or use the ringer volume, so **実際のアラームで確認** schedules a real alarm 5 seconds ahead with the chosen sound.
- Rescheduling replaces the app's notifications and alarms; stopping tracking or resetting cancels both.
- Android has no alarm section; a vibration switch picks between two notification channels.

## iOS limits

AlarmKit has no API for alarm volume or vibration: both follow the phone's Sounds & Haptics settings, and apps can't force maximum volume. Settings says so rather than offering controls that wouldn't work.

## Device testing (TestFlight, iOS 26+)

1. Turn alarms on and allow them. Preview each tone, then use 実際のアラームで確認 with each sound, with the phone locked, unlocked, in silent mode and in a Focus mode.
2. Refuse the permission: alarm times should arrive as notifications with the chosen tone, and Settings should show the "not allowed" note.
3. Move a time between the two lists, and change station or route while tracking (including from the background): old alarms must be replaced, not stacked.
4. Stop tracking and reset: no alarm should remain.
5. On an iPhone below iOS 26: the update note shows, and alarm times arrive as notifications with the chosen tone.
