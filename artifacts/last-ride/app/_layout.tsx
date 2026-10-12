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
import { LastRideProvider } from '@/context/LastRideContext';
import { PremiumProvider } from '@/context/PremiumContext';
import { GroupsProvider } from '@/context/GroupsContext';
import { initCrashReporting, reportError } from '@/lib/crashReporting';

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
      <Stack.Screen name="groups" />
      <Stack.Screen name="group/[id]" />
      <Stack.Screen name="group-new" />
      <Stack.Screen name="group-join" />
      <Stack.Screen name="onboarding-notifications" />
      <Stack.Screen name="onboarding-location" />
      <Stack.Screen name="trial" />
      <Stack.Screen name="paywall" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="settings/index" />
      <Stack.Screen name="settings/reminders" />
      <Stack.Screen name="settings/sound" />
      <Stack.Screen name="settings/location" />
      <Stack.Screen name="settings/margin" />
      <Stack.Screen name="settings/language" />
      <Stack.Screen name="join" />
      <Stack.Screen name="business" />
      <Stack.Screen name="business-event" />
      <Stack.Screen name="privacy" />
      <Stack.Screen name="data-sources" />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

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
