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
import { GALAXY_BILLING_MODE } from 'react-native-purchases-store-galaxy';
import { writePremiumCache } from '@/lib/premiumCache';
import { getOrCreatePremiumDeviceIdentity, readPremiumMigrationStatus, writePremiumMigrationStatus } from '@/lib/premiumDeviceIdentity';
import { migrateRevenueCatIdentity } from '@/lib/revenueCatMigration';
import { isTestFlightBuild } from '@/modules/last-ride-alarm/src';

export const PREMIUM_ENTITLEMENT = 'premium';
/** Saved destinations the free plan allows (tonight-only trips are always free). */
export const FREE_DESTINATIONS = 1;
const TEST_PREMIUM_KEY = 'lastride-test-premium';
/** TestFlight only: "true"/"false" overrides the real entitlement on this phone. */
const TESTFLIGHT_PREMIUM_KEY = 'lastride-testflight-premium';
const TEST_USER_KEY = 'lastride-test-user-id';

// Store selection is part of the signed build, NOT a property of the Android
// device. A Galaxy handset can install Google Play apps and vice versa.
const galaxyDistribution = Platform.OS === 'android' && process.env.EXPO_PUBLIC_ANDROID_STORE === 'galaxy';
const apiKey =
  Platform.OS === 'ios'
    ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
    : Platform.OS === 'android'
      ? galaxyDistribution
        ? process.env.EXPO_PUBLIC_REVENUECAT_GALAXY_KEY
        : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY
      : undefined;

/** True when real purchases go through RevenueCat. */
export const premiumLive = !!apiKey;

// A previous LastRide version let RevenueCat generate anonymous customer IDs.
// On first upgrade we must log in FROM that cached anonymous identity so
// RevenueCat can alias its existing purchases before using our bound ID.
// Don't overwrite it by passing appUserID to configure on the first launch.
let purchasesSetup: Promise<{ restoreRequired: boolean }> | null = null;
let sdkConfigured = false;

/** A verified store entitlement remains valid even if persisting the local
 * migration receipt fails. Never report a successful purchase as failed
 * because of an unrelated Keychain status write. */
async function markMigrationVerified(): Promise<void> {
  try {
    await writePremiumMigrationStatus('complete');
    purchasesSetup = Promise.resolve({ restoreRequired: false });
  } catch {
    // The next app launch will retry after a real customer-info check.
    purchasesSetup = Promise.resolve({ restoreRequired: false });
  }
}

function configurePurchases(appUserID?: string): void {
  if (sdkConfigured || !apiKey) return;
  if (galaxyDistribution) {
    Purchases.configure({
      apiKey, ...(appUserID ? { appUserID } : {}), store: 'GALAXY',
      galaxyBillingMode: process.env.EXPO_PUBLIC_GALAXY_BILLING_MODE === 'TEST'
        ? GALAXY_BILLING_MODE.TEST : GALAXY_BILLING_MODE.PRODUCTION,
    });
  } else {
    Purchases.configure({ apiKey, ...(appUserID ? { appUserID } : {}) });
  }
  sdkConfigured = true;
}

function ensurePurchasesConfigured(): Promise<{ restoreRequired: boolean }> {
  if (!premiumLive || !apiKey) return Promise.reject(new Error('RevenueCat is not configured'));
  if (!purchasesSetup) {
    purchasesSetup = (async () => {
      const { appUserId } = await getOrCreatePremiumDeviceIdentity();
      const status = await readPremiumMigrationStatus();
      if (status === 'complete' || status === 'restore-required') {
        configurePurchases(appUserId);
        if (await Purchases.getAppUserID() !== appUserId) {
          throw new Error('RevenueCat identity differs from Keychain identity.');
        }
        if (status === 'restore-required') {
          // If the process died after a successful store restore but before
          // Keychain receipt persistence, re-check the bound customer on
          // launch instead of prompting indefinitely.
          try {
            if (hasEntitlement(await Purchases.getCustomerInfo())) {
              await markMigrationVerified();
              return { restoreRequired: false };
            }
          } catch {
            // Network failure != no existing purchase; preserve the warning.
          }
        }
        return { restoreRequired: status === 'restore-required' };
      }

      // Existing anonymous RevenueCat SDK state is still available until a
      // reconfigure with a custom ID. A failed logIn remains retryable.
      configurePurchases();
      return migrateRevenueCatIdentity({
        targetId: appUserId,
        readStatus: readPremiumMigrationStatus,
        writeStatus: writePremiumMigrationStatus,
        getCurrentId: () => Purchases.getAppUserID(),
        getCustomerInfo: () => Purchases.getCustomerInfo(),
        logIn: async (id) => (await Purchases.logIn(id)).customerInfo,
        hasPremium: hasEntitlement,
      });
    })().catch(error => { purchasesSetup = null; throw error; });
  }
  return purchasesSetup;
}

export type PlanChoice = {
  id: 'monthly' | 'annual';
  /** Store-formatted price, e.g. "¥190"; the planned price in test mode. */
  price: string;
  /** Yearly plan: the store's price per month (e.g. "¥100"), for 「月あたり」. */
  perMonth?: string | null;
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
  /** Headers proving ownership of the exact RevenueCat user being checked. */
  groupCreationHeaders: () => Promise<Record<string, string>>;
  /** Existing anonymous subscription was not confirmed after identity migration. */
  migrationNeedsRestore: boolean;
  /**
   * TestFlight check: the App Store country StoreKit uses and the plans' currency
   * and prices as fetched now, e.g. "JPN · JPY ¥1,200 / ¥190".
   */
  storeInfo: () => Promise<string>;
};

const PremiumContext = createContext<PremiumValue | null>(null);

const TEST_PLANS: PlanChoice[] = [
  { id: 'annual', price: '¥1,200', perMonth: '¥100', trialDays: 14, pkg: null },
  { id: 'monthly', price: '¥190', trialDays: 14, pkg: null },
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
  const [migrationNeedsRestore, setMigrationNeedsRestore] = useState(false);
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
    const listener = (info: CustomerInfo) => {
      if (!active) return;
      setIsPremium(hasEntitlement(info));
      setKnown(true);
    };
    let registered = false;
    void ensurePurchasesConfigured().then(async ({ restoreRequired }) => {
      if (!active) return;
      setMigrationNeedsRestore(restoreRequired);
      Purchases.addCustomerInfoUpdateListener(listener);
      registered = true;
      // Product-catalogue outages must not revoke a verified purchase. Fetch
      // offerings independently; only customer info determines entitlement.
      void Purchases.getOfferings().then((offerings) => {
        const current = offerings.current;
        if (!active || !current) return;
        const choices: PlanChoice[] = [];
        if (current.annual) choices.push({ id: 'annual', price: current.annual.product.priceString, perMonth: current.annual.product.pricePerMonthString, trialDays: trialDays(current.annual), pkg: current.annual });
        if (current.monthly) choices.push({ id: 'monthly', price: current.monthly.product.priceString, trialDays: trialDays(current.monthly), pkg: current.monthly });
        setPlans(choices);
      }).catch(() => undefined);
      await Purchases.getCustomerInfo().then(listener);
    }).catch(() => {
      // A failure to access secure storage must NOT silently configure an
      // unbound RevenueCat customer or show a paid entitlement as active.
      if (active) setIsPremium(false);
    }).finally(() => { if (active) setReady(true); });
    return () => {
      active = false;
      if (registered) Purchases.removeCustomerInfoUpdateListener(listener);
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
        await ensurePurchasesConfigured();
        const { customerInfo } = await Purchases.purchasePackage(plan.pkg);
        const entitled = hasEntitlement(customerInfo);
        setIsPremium(entitled);
        if (entitled) {
          await markMigrationVerified();
          setMigrationNeedsRestore(false);
        }
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
      await ensurePurchasesConfigured();
      const entitled = hasEntitlement(await Purchases.restorePurchases());
      setIsPremium(entitled);
      if (entitled) {
        await markMigrationVerified();
        setMigrationNeedsRestore(false);
      }
      return entitled;
    } catch {
      // "Store unavailable" is not "no purchase exists". The paywall must
      // keep the duplicate-purchase safety gate closed after a network error.
      throw new Error('Could not verify restored purchases with the store.');
    }
  }, [isPremium]);

  const appUserId = useCallback(async () => {
    if (premiumLive) return (await getOrCreatePremiumDeviceIdentity()).appUserId;
    // Test mode: a stable local id; the server accepts any id without a RevenueCat key outside production.
    const existing = await AsyncStorage.getItem(TEST_USER_KEY).catch(() => null);
    if (existing) return existing;
    const id = `test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    await AsyncStorage.setItem(TEST_USER_KEY, id).catch(() => undefined);
    return id;
  }, []);

  const groupCreationHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (!premiumLive) return { 'X-RevenueCat-App-User-Id': await appUserId() };
    await ensurePurchasesConfigured();
    const identity = await getOrCreatePremiumDeviceIdentity();
    return {
      'X-RevenueCat-App-User-Id': identity.appUserId,
      'X-Premium-Device-Secret': identity.secret,
    };
  }, [appUserId]);

  const storeInfo = useCallback(async () => {
    if (!premiumLive) return 'test mode';
    try {
      await ensurePurchasesConfigured();
      const [storefront, offerings] = await Promise.all([Purchases.getStorefront().catch(() => null), Purchases.getOfferings()]);
      const products = [offerings.current?.annual, offerings.current?.monthly].filter((pkg) => !!pkg).map((pkg) => pkg!.product);
      const currency = products[0]?.currencyCode ?? '?';
      return `${storefront?.countryCode ?? '?'} · ${currency} ${products.map((product) => product.priceString).join(' / ')}`;
    } catch (error) {
      return `error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }, []);

  const value = useMemo(
    () => ({ isPremium, ready, known: determined, live: premiumLive, plans, purchase, restore, setTestPremium, testOverride: override !== null, appUserId, groupCreationHeaders, migrationNeedsRestore, storeInfo }),
    [isPremium, ready, determined, plans, purchase, restore, setTestPremium, override, appUserId, groupCreationHeaders, migrationNeedsRestore, storeInfo],
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
