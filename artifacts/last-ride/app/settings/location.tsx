import { Section, SettingsPage } from '@/components/SettingsUI';
import { Divider, Row } from '@/components/ui';
import { useLastRide } from '@/context/LastRideContext';
import React from 'react';
import { Linking, Platform } from 'react-native';

/** Settings → Night location: update only while open, or also while closed. */
export default function NightLocationScreen() {
  const { language, nightLocationMode, setNightLocationMode, backgroundAllowed, requestBackgroundLocation } = useLastRide();
  const ja = language === 'ja';

  return (
    <SettingsPage title={ja ? '夜間の位置情報' : 'Night location'} backLabel={ja ? '設定' : 'Settings'}>
      <Section
        footer={
          nightLocationMode === 'ask'
            ? ja
              ? '夜間の案内中のみ位置情報を使用します。次回、案内を開始するときに使用方法を確認します。'
              : 'Only used during night-out tracking. Not chosen yet, so you’ll be asked when you next start tracking.'
            : ja
              ? '夜間の案内中のみ位置情報を使用します。'
              : 'Only used during night-out tracking.'
        }
      >
        <Row
          testID="night-location-foreground"
          title={ja ? 'アプリの使用中のみ' : 'App open'}
          subtitle={ja ? 'アプリの使用中のみ位置情報を更新' : 'Updates while the app is open'}
          checked={nightLocationMode === 'foreground'}
          onPress={() => setNightLocationMode('foreground')}
        />
        <Divider />
        <Row
          testID="night-location-background"
          title={ja ? 'アプリを閉じても更新' : 'When closed'}
          subtitle={ja ? 'アプリを閉じている間も更新（位置情報「常に」）' : 'Also while closed (location “Always”)'}
          checked={nightLocationMode === 'background'}
          onPress={() => {
            setNightLocationMode('background');
            // アプリを閉じても更新 needs iOS "Always": ask now, while the choice is fresh.
            if (Platform.OS !== 'web') void requestBackgroundLocation();
          }}
        />
      </Section>

      {nightLocationMode === 'background' && backgroundAllowed === false && (
        <Section>
          <Row
            testID="background-location-settings"
            title={ja ? 'iPhoneの設定が「常に」ではありません' : 'iPhone Settings isn’t “Always”'}
            subtitle={ja ? 'このままでは閉じている間は更新されません。タップして「常に」にしてください。' : 'LastRide can’t update while closed until then. Tap to set “Always”.'}
            onPress={() => void Linking.openSettings()}
            destructive
          />
        </Section>
      )}
    </SettingsPage>
  );
}
