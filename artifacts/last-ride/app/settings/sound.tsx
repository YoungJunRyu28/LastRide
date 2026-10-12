import { Section, SettingsPage, soundLabel } from '@/components/SettingsUI';
import { Divider, PremiumTag, Row } from '@/components/ui';
import { useLastRide } from '@/context/LastRideContext';
import { usePremium } from '@/context/PremiumContext';
import { previewSound } from '@/lib/notifications';
import { deliveredReminders, FREE_ALARM_SOUND, REMINDER_SOUNDS } from '@/lib/settings';
import { router } from 'expo-router';
import React from 'react';

/** Settings → Leave reminders → Sound: pick the alarm tone; each tap plays it. */
export default function AlarmSoundScreen() {
  const { language, reminderIntervals, alarmIntervals, alarmSound, setAlarmSound } = useLastRide();
  const { isPremium } = usePremium();
  const { sound: current } = deliveredReminders({ notifications: reminderIntervals, alarms: alarmIntervals, sound: alarmSound }, isPremium);
  const ja = language === 'ja';

  return (
    <SettingsPage title={ja ? 'アラームの音' : 'Alarm sound'} backLabel={ja ? '戻る' : 'Back'}>
      <Section footer={ja ? 'タップすると試聴できます（iOS標準を除く）。' : 'Tap to hear a sound (except iOS default).'}>
        {REMINDER_SOUNDS.map((sound, index) => {
          const locked = !isPremium && sound !== FREE_ALARM_SOUND;
          return (
            <React.Fragment key={sound}>
              {index > 0 && <Divider />}
              <Row
                testID={`alarm-sound-${sound}`}
                title={soundLabel(sound, ja)}
                checked={locked ? undefined : current === sound}
                onPress={() => {
                  if (locked) {
                    previewSound(sound).catch(() => undefined);
                    router.push('/paywall');
                    return;
                  }
                  setAlarmSound(sound);
                  previewSound(sound).catch(() => undefined);
                }}
              >
                {locked ? <PremiumTag label={ja ? 'プレミアム' : 'Premium'} /> : undefined}
              </Row>
            </React.Fragment>
          );
        })}
      </Section>
    </SettingsPage>
  );
}
