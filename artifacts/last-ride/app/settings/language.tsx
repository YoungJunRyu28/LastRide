import { Section, SettingsPage } from '@/components/SettingsUI';
import { Divider, Row } from '@/components/ui';
import { useLastRide } from '@/context/LastRideContext';
import React from 'react';

/** Settings → Language. */
export default function LanguageScreen() {
  const { language, setLanguage } = useLastRide();
  const ja = language === 'ja';

  return (
    <SettingsPage title={ja ? '言語' : 'Language'} backLabel={ja ? '設定' : 'Settings'}>
      <Section>
        <Row testID="language-ja" title="日本語" checked={language === 'ja'} onPress={() => setLanguage('ja')} />
        <Divider />
        <Row testID="language-en" title="English" checked={language !== 'ja'} onPress={() => setLanguage('en')} />
      </Section>
    </SettingsPage>
  );
}
