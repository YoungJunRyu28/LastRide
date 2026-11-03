/**
 * The privacy policy lives on the website only (lastride.jp/privacy, in the
 * app's language): one text, so the app can never say something different
 * from the policy. This route stays so that any old link still works: it
 * opens the page and steps back.
 */
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect } from "react";
import { View } from "react-native";
import { useLastRide } from "@/context/LastRideContext";
import { useColors } from "@/hooks/useColors";
import { PRIVACY_URL, siteLink } from "@/lib/links";

export default function PrivacyScreen() {
  const colors = useColors();
  const { language } = useLastRide();
  useEffect(() => {
    void WebBrowser.openBrowserAsync(siteLink(PRIVACY_URL, language !== "en")).finally(() => {
      if (router.canGoBack()) router.back();
      else router.replace("/settings");
    });
  }, [language]);
  return <View style={{ flex: 1, backgroundColor: colors.background }} />;
}
