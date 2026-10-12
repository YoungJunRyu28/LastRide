import { Section, SettingsPage, soundLabel } from '@/components/SettingsUI';
import { Divider, Row } from '@/components/ui';
import { useLastRide } from '@/context/LastRideContext';
import { previewSound } from '@/lib/notifications';
import { REMINDER_SOUNDS } from '@/lib/settings';
import React from 'react';

/** Settings → Leave reminders → Sound: pick the alarm tone; each tap plays it. */
export default function AlarmSoundScreen() {
  const { language, alarmSound, setAlarmSound } = useLastRide();
  const ja = language === 'ja';

  return (
    <SettingsPage title={ja ? 'アラームの音' : 'Alarm sound'} backLabel={ja ? '戻る' : 'Back'}>
      <Section footer={ja ? 'タップすると試聴できます（iOS標準を除く）。' : 'Tap to hear a sound (except iOS default).'}>
        {REMINDER_SOUNDS.map((sound, index) => (
          <React.Fragment key={sound}>
            {index > 0 && <Divider />}
            <Row
              testID={`alarm-sound-${sound}`}
              title={soundLabel(sound, ja)}
              checked={alarmSound === sound}
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
