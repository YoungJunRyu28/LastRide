import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { NotificationRouter } from '@/components/NotificationRouter';
import { SpaceGrotesk_500Medium, SpaceGrotesk_700Bold, useFonts } from '@expo-google-fonts/space-grotesk';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { LastRideProvider, useLastRide } from '@/context/LastRideContext';
import { PremiumProvider, usePremium } from '@/context/PremiumContext';
import { GroupsProvider } from '@/context/GroupsContext';
import { initCrashReporting, reportError } from '@/lib/crashReporting';
import { debugEvent } from '@/lib/debugEvents';

initCrashReporting();

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'none' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="ride" />
      <Stack.Screen name="home-station" />
      <Stack.Screen name="destinations" />
      <Stack.Screen name="alternatives" />
      <Stack.Screen name="far-ways" />
      <Stack.Screen name="groups" />
      <Stack.Screen name="group/[id]" />
      <Stack.Screen name="group-new" />
      <Stack.Screen name="group-join" />
      <Stack.Screen name="onboarding-notifications" />
      <Stack.Screen name="onboarding-alarms" />
      <Stack.Screen name="onboarding-margin" />
      <Stack.Screen name="onboarding-location" />
      <Stack.Screen name="trial" />
      <Stack.Screen name="paywall" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="settings/index" />
      <Stack.Screen name="settings/reminders" />
      <Stack.Screen name="settings/location" />
      <Stack.Screen name="settings/margin" />
      <Stack.Screen name="settings/language" />
      <Stack.Screen name="settings/reset" />
      <Stack.Screen name="settings/widget-theme" />
      <Stack.Screen name="departure-station" />
      <Stack.Screen name="join" />
      <Stack.Screen name="business" />
      <Stack.Screen name="business-event" />
      <Stack.Screen name="privacy" />
      <Stack.Screen name="data-sources" />
    </Stack>
  );
}

/**
 * The splash stays until the saved settings and the last known Premium state
 * are loaded and the start route has swapped in underneath (welcome → home),
 * so a relaunch never flashes the setup screen or the free version.
 */
const SPLASH_SETTLE_MS = 120;
const SPLASH_MAX_MS = 4000;
function SplashGate() {
  const { isHydrated } = useLastRide();
  const { loaded } = usePremium();
  useEffect(() => {
    // Never stuck behind the splash, whatever fails to load.
    const timer = setTimeout(() => void SplashScreen.hideAsync().catch(() => undefined), SPLASH_MAX_MS);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!isHydrated || !loaded) return;
    const timer = setTimeout(() => void SplashScreen.hideAsync().catch(() => undefined), SPLASH_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [isHydrated, loaded]);
  return null;
}

// A new app process (cold launch, or relaunched in the background by location): see lib/debugEvents.
void debugEvent('app process started');

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
  });

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary onError={reportError}>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <PremiumProvider>
                <LastRideProvider>
                  <GroupsProvider>
                    <RootLayoutNav />
                    <SplashGate />
                    {Platform.OS !== 'web' && <NotificationRouter />}
                  </GroupsProvider>
                </LastRideProvider>
              </PremiumProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
