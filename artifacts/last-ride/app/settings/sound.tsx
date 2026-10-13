import { Section, SettingsPage, soundLabel } from '@/components/SettingsUI';
import { Divider, Row } from '@/components/ui';
import { useLastRide } from '@/context/LastRideContext';
import { ALARM_SOUND_CHOICES, alarmKitAvailable, effectiveAlarmSound, previewSound } from '@/lib/notifications';
import React from 'react';

/** Settings → Leave reminders → Sound: pick the alarm tone; each tap plays it. */
export default function AlarmSoundScreen() {
  const { language, alarmSound, setAlarmSound } = useLastRide();
  const ja = language === 'ja';
  const shown = effectiveAlarmSound(alarmSound);

  return (
    <SettingsPage title={ja ? 'アラームの音' : 'Alarm sound'} backLabel={ja ? '戻る' : 'Back'}>
      <Section
        footer={
          alarmKitAvailable
            ? ja ? 'タップすると試聴できます（iOS標準を除く）。' : 'Tap to hear a sound (except iOS default).'
            : ja ? 'タップすると試聴できます。' : 'Tap to hear a sound.'
        }
      >
        {ALARM_SOUND_CHOICES.map((sound, index) => (
          <React.Fragment key={sound}>
            {index > 0 && <Divider />}
            <Row
              testID={`alarm-sound-${sound}`}
              title={soundLabel(sound, ja)}
              checked={shown === sound}
              onPress={() => {
                setAlarmSound(sound);
                previewSound(sound).catch(() => undefined);
              }}
            />
          </React.Fragment>
        ))}
      </Section>
    </SettingsPage>
  );
}
