import { Section, SettingsPage } from '@/components/SettingsUI';
import { Divider, Row } from '@/components/ui';
import { useLastRide } from '@/context/LastRideContext';
import React from 'react';
import { Alert, Linking, Platform } from 'react-native';
import { trackingDisclosure } from '@/lib/trackingDisclosure';

/** Settings → Night location: update only while open, or also while closed. */
export default function NightLocationScreen() {
  const { language, nightLocationMode, setNightLocationMode, backgroundAllowed, requestBackgroundLocation } = useLastRide();
  const ja = language === 'ja';
  const enableBackground = () => {
    const askForBackground = () => {
      setNightLocationMode('background');
      if (Platform.OS !== 'web') void requestBackgroundLocation();
    };
    if (Platform.OS === 'android') {
      const disclosure = trackingDisclosure(language);
      Alert.alert(disclosure.title, disclosure.message, [
        { text: disclosure.cancel, style: 'cancel' },
        { text: disclosure.foregroundOnly, onPress: () => setNightLocationMode('foreground') },
        { text: disclosure.allowBackground, onPress: askForBackground },
      ], { cancelable: true });
      return;
    }
    askForBackground();
  };

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
          subtitle={Platform.OS === 'android'
            ? (ja ? 'アプリを閉じている間も更新（位置情報「常に許可」）' : 'Also while closed (“Allow all the time”)')
            : (ja ? 'アプリを閉じている間も更新（位置情報「常に」）' : 'Also while closed (location “Always”)')}
          checked={nightLocationMode === 'background'}
          onPress={enableBackground}
        />
      </Section>

      {nightLocationMode === 'background' && backgroundAllowed === false && (
        <Section>
          <Row
            testID="background-location-settings"
            title={Platform.OS === 'android'
              ? (ja ? '位置情報が「常に許可」になっていません' : 'Location is not set to “Allow all the time”')
              : (ja ? '位置情報の許可が「常に」になっていません' : 'iPhone Settings isn’t “Always”')}
            subtitle={Platform.OS === 'android'
              ? (ja ? 'アプリを閉じている間は更新できません。タップして「常に許可」' : 'Updates while closed require “Allow all the time” in Android Settings.')
              : (ja ? 'アプリを閉じている間は更新できません。タップして「常に」を許可' : 'LastRide can’t update while closed until then. Tap to set “Always”.')}
            onPress={() => void Linking.openSettings()}
            destructive
          />
        </Section>
      )}
    </SettingsPage>
  );
}
