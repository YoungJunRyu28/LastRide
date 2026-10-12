import { MarginStepper } from '@/components/MarginStepper';
import { Section, SettingsPage } from '@/components/SettingsUI';
import { useLastRide } from '@/context/LastRideContext';
import { formatJstTime, MINUTE_MS } from '@/lib/time';
import React from 'react';

/** Settings → 早めに出る時間 (余裕): minutes before the latest leave time, by the minute. */
export default function LeaveMarginScreen() {
  const { language, leaveMargin, setLeaveMargin, plan } = useLastRide();
  const ja = language === 'ja';
  // Tonight's latest leave time makes the example real when there is a plan.
  const latest = plan?.leaveByMs ?? null;

  return (
    <SettingsPage title={ja ? '早めに出る時間' : 'Leave early by'} backLabel={ja ? '設定' : 'Settings'}>
      <Section
        label={ja ? '「遅くとも」の何分前に出発するか' : 'HOW LONG BEFORE THE LATEST TIME TO LEAVE'}
        footer={
          latest !== null
            ? ja
              ? `今夜なら：遅くとも ${formatJstTime(latest)} → ${formatJstTime(latest - leaveMargin * MINUTE_MS)}に出発。乗り換えが多い日は自動で少し足します。`
              : `Tonight: latest ${formatJstTime(latest)} → leave at ${formatJstTime(latest - leaveMargin * MINUTE_MS)}. A little more is added for routes with changes.`
            : ja
              ? '乗り換えが多い日は自動で少し足します。'
              : 'A little more is added for routes with changes.'
        }
      >
        <MarginStepper value={leaveMargin} onChange={setLeaveMargin} ja={ja} />
      </Section>
    </SettingsPage>
  );
}
