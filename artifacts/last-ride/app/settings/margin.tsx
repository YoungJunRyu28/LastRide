import { marginLabel, Section, SettingsPage } from '@/components/SettingsUI';
import { Divider, Row } from '@/components/ui';
import { useLastRide } from '@/context/LastRideContext';
import type { LeaveMargin } from '@/lib/reliability';
import React from 'react';

const OPTIONS: { value: LeaveMargin; ja: string; en: string }[] = [
  { value: 'tight', ja: '「遅くとも」の時刻に出発', en: 'Leave at the latest time' },
  { value: 'normal', ja: 'その4分前に出発', en: 'Leave 4 min before the latest time' },
  { value: 'relaxed', ja: 'その10分前に出発', en: 'Leave 10 min before the latest time' },
];

/** Settings → Time to spare: how long before the latest leave time we tell you to go. */
export default function LeaveMarginScreen() {
  const { language, leaveMargin, setLeaveMargin } = useLastRide();
  const ja = language === 'ja';

  return (
    <SettingsPage title={ja ? '余裕' : 'Time to spare'} backLabel={ja ? '設定' : 'Settings'}>
      <Section footer={ja ? '乗り換えや長い徒歩があるときは、さらに余裕を足します。' : 'Extra time is added for transfers and long walks.'}>
        {OPTIONS.map((option, index) => (
          <React.Fragment key={option.value}>
            {index > 0 && <Divider />}
            <Row
              testID={`margin-${option.value}`}
              title={marginLabel(option.value, ja)}
              subtitle={ja ? option.ja : option.en}
              checked={leaveMargin === option.value}
              onPress={() => setLeaveMargin(option.value)}
            />
          </React.Fragment>
        ))}
      </Section>
    </SettingsPage>
  );
}
