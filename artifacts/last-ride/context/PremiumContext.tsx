/**
 * Premium (RevenueCat). The app is "live" once a RevenueCat public SDK key is
 * set for the platform (EXPO_PUBLIC_REVENUECAT_IOS_KEY / _ANDROID_KEY) and
 * runs in a native build; otherwise it runs in test mode, where premium is a
 * local switch so every paywall path can be exercised before the store
 * products exist. Test-mode purchases are refused in release builds.
 *
 * Entitlement: "premium". Offering: the current one, with monthly and annual
 * packages; the trial is the store's introductory offer on those products.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import Purchases, { type CustomerInfo, type PurchasesPackage } from 'react-native-purchases';
import { writePremiumCache } from '@/lib/premiumCache';
import { isTestFlightBuild } from '@/modules/last-ride-alarm/src';

export const PREMIUM_ENTITLEMENT = 'premium';
/** Saved destinations the free plan allows (tonight-only trips are always free). */
export const FREE_DESTINATIONS = 1;
const TEST_PREMIUM_KEY = 'lastride-test-premium';
/** TestFlight only: "true"/"false" overrides the real entitlement on this phone. */
const TESTFLIGHT_PREMIUM_KEY = 'lastride-testflight-premium';
const TEST_USER_KEY = 'lastride-test-user-id';

const apiKey =
  Platform.OS === 'ios'
    ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
    : Platform.OS === 'android'
      ? process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY
      : undefined;

/** True when real purchases go through RevenueCat. */
export const premiumLive = !!apiKey;

export type PlanChoice = {
  id: 'monthly' | 'annual';
  /** Store-formatted price, e.g. "¥290"; the planned price in test mode. */
  price: string;
  /** Free-trial length in days, when the product has an introductory trial. */
  trialDays: number | null;
  /** The RevenueCat package; null in test mode. */
  pkg: PurchasesPackage | null;
};

type PurchaseResult = 'purchased' | 'cancelled' | 'failed';

type PremiumValue = {
  isPremium: boolean;
  /** False until the first entitlement check finishes. */
  ready: boolean;
  /** Premium was actually determined (RevenueCat answered, test mode, or the TestFlight switch); false after a failed check. */
  known: boolean;
  live: boolean;
  plans: PlanChoice[];
  purchase: (plan: PlanChoice) => Promise<PurchaseResult>;
  restore: () => Promise<boolean>;
  /**
   * Test mode (no RevenueCat keys), or TestFlight: turn premium on or off
   * locally. On TestFlight it overrides the real entitlement on this phone
   * only (the server still sees the real one); null goes back to it.
   */
  setTestPremium: (enabled: boolean | null) => void;
  /** TestFlight: premium is overridden locally (setTestPremium). */
  testOverride: boolean;
  /** RevenueCat's (anonymous) user id; the server checks the entitlement with it. */
  appUserId: () => Promise<string>;
};

const PremiumContext = createContext<PremiumValue | null>(null);

const TEST_PLANS: PlanChoice[] = [
  { id: 'annual', price: '¥1,980', trialDays: 14, pkg: null },
  { id: 'monthly', price: '¥290', trialDays: 14, pkg: null },
];

function hasEntitlement(info: CustomerInfo) {
  return info.entitlements.active[PREMIUM_ENTITLEMENT] !== undefined;
}

function trialDays(pkg: PurchasesPackage): number | null {
  const intro = pkg.product.introPrice;
  if (!intro || intro.price !== 0) return null;
  const perUnit = ({ DAY: 1, WEEK: 7, MONTH: 30, YEAR: 365 } as Record<string, number>)[intro.periodUnit] ?? 0;
  return perUnit * intro.periodNumberOfUnits * (intro.cycles || 1) || null;
}

export function PremiumProvider({ children }: { children: React.ReactNode }) {
  const [entitled, setIsPremium] = useState(false);
  // TestFlight only: a local on/off over the real entitlement.
  const [override, setOverride] = useState<boolean | null>(null);
  const isPremium = override ?? entitled;
  useEffect(() => {
    if (!isTestFlightBuild || !premiumLive) return;
    void AsyncStorage.getItem(TESTFLIGHT_PREMIUM_KEY)
      .then((value) => setOverride(value === 'true' ? true : value === 'false' ? false : null))
      .catch(() => undefined);
  }, []);
  const [ready, setReady] = useState(false);
  // Premium has actually been determined (RevenueCat answered, or test mode read it).
  // A failed or unfinished check must never be saved as "not Premium": the
  // background task would then end a running Live Activity.
  const [known, setKnown] = useState(false);
  const [plans, setPlans] = useState<PlanChoice[]>(premiumLive ? [] : TEST_PLANS);

  useEffect(() => {
    if (!premiumLive || !apiKey) {
      void AsyncStorage.getItem(TEST_PREMIUM_KEY)
        .then((value) => {
          setIsPremium(value === 'true');
          setKnown(true);
        })
        .catch(() => undefined)
        .finally(() => setReady(true));
      return;
    }
    let active = true;
    Purchases.configure({ apiKey });
    const listener = (info: CustomerInfo) => {
      if (!active) return;
      setIsPremium(hasEntitlement(info));
      setKnown(true);
    };
    Purchases.addCustomerInfoUpdateListener(listener);
    void Purchases.getCustomerInfo()
      .then(listener)
      .catch(() => undefined)
      .finally(() => active && setReady(true));
    void Purchases.getOfferings()
      .then((offerings) => {
        const current = offerings.current;
        if (!active || !current) return;
        const choices: PlanChoice[] = [];
        if (current.annual) choices.push({ id: 'annual', price: current.annual.product.priceString, trialDays: trialDays(current.annual), pkg: current.annual });
        if (current.monthly) choices.push({ id: 'monthly', price: current.monthly.product.priceString, trialDays: trialDays(current.monthly), pkg: current.monthly });
        setPlans(choices);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      Purchases.removeCustomerInfoUpdateListener(listener);
    };
  }, []);

  // The TestFlight switch decides on its own once loaded; otherwise only a real answer.
  const determined = override !== null || known;
  useEffect(() => {
    if (determined) void writePremiumCache(isPremium);
  }, [isPremium, determined]);

  const setTestPremium = useCallback((enabled: boolean | null) => {
    if (premiumLive) {
      if (!isTestFlightBuild) return;
      setOverride(enabled);
      void (enabled === null
        ? AsyncStorage.removeItem(TESTFLIGHT_PREMIUM_KEY)
        : AsyncStorage.setItem(TESTFLIGHT_PREMIUM_KEY, String(enabled))
      ).catch(() => undefined);
      return;
    }
    if (enabled === null) return;
    setIsPremium(enabled);
    void AsyncStorage.setItem(TEST_PREMIUM_KEY, String(enabled)).catch(() => undefined);
  }, []);

  const purchase = useCallback(
    async (plan: PlanChoice): Promise<PurchaseResult> => {
      if (!premiumLive || !plan.pkg) {
        if (!__DEV__) return 'failed';
        setTestPremium(true);
        return 'purchased';
      }
      try {
        const { customerInfo } = await Purchases.purchasePackage(plan.pkg);
        const entitled = hasEntitlement(customerInfo);
        setIsPremium(entitled);
        return entitled ? 'purchased' : 'failed';
      } catch (error) {
        return (error as { userCancelled?: boolean | null }).userCancelled ? 'cancelled' : 'failed';
      }
    },
    [setTestPremium],
  );

  const restore = useCallback(async () => {
    if (!premiumLive) return isPremium;
    try {
      const entitled = hasEntitlement(await Purchases.restorePurchases());
      setIsPremium(entitled);
      return entitled;
    } catch {
      return false;
    }
  }, [isPremium]);

  const appUserId = useCallback(async () => {
    if (premiumLive) return Purchases.getAppUserID();
    // Test mode: a stable local id; the server accepts any id without a RevenueCat key outside production.
    const existing = await AsyncStorage.getItem(TEST_USER_KEY).catch(() => null);
    if (existing) return existing;
    const id = `test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    await AsyncStorage.setItem(TEST_USER_KEY, id).catch(() => undefined);
    return id;
  }, []);

  const value = useMemo(
    () => ({ isPremium, ready, known: determined, live: premiumLive, plans, purchase, restore, setTestPremium, testOverride: override !== null, appUserId }),
    [isPremium, ready, determined, plans, purchase, restore, setTestPremium, override, appUserId],
  );
  return <PremiumContext.Provider value={value}>{children}</PremiumContext.Provider>;
}

export function usePremium() {
  const value = useContext(PremiumContext);
  if (!value) throw new Error('usePremium must be used inside PremiumProvider');
  return value;
}

/** "2週間無料" / "14 days free" for a trial of `days` days; null without a trial. */
export function trialLabel(days: number | null, ja: boolean): string | null {
  if (!days) return null;
  if (days % 7 === 0) return ja ? `${days / 7}週間無料` : days === 7 ? '1 week free' : `${days / 7} weeks free`;
  return ja ? `${days}日間無料` : `${days} days free`;
}

/** The trial length on offer (the store's introductory offer; 14 days planned). */
export function useTrialDays(): number {
  const { plans } = usePremium();
  return plans.find((plan) => plan.trialDays)?.trialDays ?? 14;
}
