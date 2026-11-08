import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { test, after } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';

const require = createRequire(import.meta.url);
const getConfig = require('../artifacts/last-ride/app.config.js');
const base = JSON.parse(readFileSync(new URL('../artifacts/last-ride/app.json', import.meta.url), 'utf8')).expo;
const key = 'AIza' + 'X'.repeat(35);
const firebaseDir = mkdtempSync(join(tmpdir(), 'lastride-fcm-config-test-'));
const firebaseFile = join(firebaseDir, 'google-services.json');
const wrongFirebaseFile = join(firebaseDir, 'wrong-google-services.json');
function fakeFirebaseFor(packages) {
  return JSON.stringify({
    project_info: { project_number: '1234567890' },
    client: packages.map((packageName) => ({
      client_info: {
        mobilesdk_app_id: '1:1234567890:android:example',
        android_client_info: { package_name: packageName },
      },
    })),
  });
}
writeFileSync(firebaseFile, fakeFirebaseFor(['jp.lastride.app', 'jp.lastride.app.galaxy']));
writeFileSync(wrongFirebaseFile, fakeFirebaseFor(['com.unrelated.app']));
after(() => rmSync(firebaseDir, { recursive: true, force: true }));
const vars = [
  'EAS_BUILD_PROFILE', 'EAS_BUILD_PLATFORM', 'EXPO_PUBLIC_ANDROID_STORE',
  'EXPO_PUBLIC_GALAXY_BILLING_MODE', 'EXPO_PUBLIC_REVENUECAT_GALAXY_KEY',
  'EXPO_PUBLIC_REVENUECAT_ANDROID_KEY', 'EXPO_PUBLIC_REVENUECAT_IOS_KEY',
  'EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_APP_JOIN_BASE_URL',
  'EXPO_ANDROID_GOOGLE_MAPS_API_KEY', 'EXPO_ANDROID_GALAXY_GOOGLE_MAPS_API_KEY', 'ENABLE_REMOTE_PUSH',
  'ENABLE_UNIVERSAL_LINKS', 'ENABLE_LIVE_ACTIVITY', 'ANDROID_PACKAGE_ID', 'IOS_BUNDLE_ID', 'GOOGLE_SERVICES_JSON',
];
function configured(values) {
  const original = Object.fromEntries(vars.map(name => [name, process.env[name]]));
  try {
    vars.forEach(name => { delete process.env[name]; });
    Object.entries(values).forEach(([name, value]) => { process.env[name] = value; });
    return getConfig({config: base});
  } finally {
    vars.forEach(name => {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    });
  }
}
const release = {
  EXPO_PUBLIC_API_URL: 'https://api.lastride.jp',
  EXPO_PUBLIC_APP_JOIN_BASE_URL: 'https://lastride.jp',
  ENABLE_REMOTE_PUSH: 'true',
  ENABLE_UNIVERSAL_LINKS: 'true',
  EXPO_ANDROID_GOOGLE_MAPS_API_KEY: key,
  EXPO_PUBLIC_REVENUECAT_ANDROID_KEY: 'goog_example_public_key',
  GOOGLE_SERVICES_JSON: firebaseFile,
  EAS_BUILD_PLATFORM: 'android',
};
test('Google Play release keeps its current package and ordinary Play billing', () => {
  const app = configured({ ...release, EAS_BUILD_PROFILE: 'production' });
  assert.equal(app.android.package, 'jp.lastride.app');
  assert.equal(app.extra.androidDistributionStore, 'google-play');
  assert.equal(app.android.intentFilters[0].data[1].pathPrefix, '/group-join');
});
test('Google Play releases require Android Firebase registration for FCM push', () => {
  const app = configured({ ...release, EAS_BUILD_PROFILE: 'production' });
  assert.equal(app.android.googleServicesFile, firebaseFile);
  assert.throws(
    () => configured({ ...release, EAS_BUILD_PROFILE: 'production', GOOGLE_SERVICES_JSON: '' }),
    /GOOGLE_SERVICES_JSON/,
  );
  assert.throws(
    () => configured({ ...release, EAS_BUILD_PROFILE: 'production', GOOGLE_SERVICES_JSON: wrongFirebaseFile }),
    /GOOGLE_SERVICES_JSON.*jp\.lastride\.app/,
  );
});

test('Android release excludes unnecessary sensitive permissions and unsafe partial backups', () => {
  const app = configured({ ...release, EAS_BUILD_PROFILE: 'production' });
  assert.equal(app.android.allowBackup, false);
  const blocked = new Set(app.android.blockedPermissions);
  for (const permission of ['SYSTEM_ALERT_WINDOW', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE']) {
    assert.ok(blocked.has('android.permission.' + permission), 'Missing blocked permission: ' + permission);
  }
  assert.ok(!blocked.has('android.permission.ACCESS_BACKGROUND_LOCATION'));
});

test('EAS OTA channels segregate Galaxy purchases from Google Play updates', () => {
  const eas = JSON.parse(readFileSync(new URL('../artifacts/last-ride/eas.json', import.meta.url), 'utf8'));
  assert.equal(eas.build.production.channel, 'production');
  assert.equal(eas.build.galaxy.channel, 'galaxy');
  assert.notEqual(eas.build.production.channel, eas.build.galaxy.channel);
  assert.equal(eas.build.galaxy.android.buildType, 'apk');
  assert.equal(eas.build.production.env.EXPO_PUBLIC_ANDROID_STORE, 'google-play');
  assert.equal(eas.build.galaxy.env.EXPO_PUBLIC_ANDROID_STORE, 'galaxy');
  assert.equal(eas.build.galaxy.environment, 'production');
});

test('Play and Apple releases fail closed without a correct store-specific RevenueCat public SDK key', () => {
  assert.throws(() => configured({ ...release, EAS_BUILD_PROFILE: 'production',
    EXPO_PUBLIC_REVENUECAT_ANDROID_KEY: '' }), /REVENUECAT_ANDROID_KEY/);
  assert.throws(() => configured({ ...release, EAS_BUILD_PROFILE: 'production',
    EXPO_PUBLIC_REVENUECAT_ANDROID_KEY: 'sk_revenuecat_server_secret' }), /REVENUECAT_ANDROID_KEY/);
  assert.throws(() => configured({ ...release, EAS_BUILD_PROFILE: 'production',
    EAS_BUILD_PLATFORM: 'ios', ENABLE_LIVE_ACTIVITY: 'true', EXPO_PUBLIC_REVENUECAT_IOS_KEY: '' }), /REVENUECAT_IOS_KEY/);
  assert.throws(() => configured({ ...release, EAS_BUILD_PROFILE: 'production',
    EAS_BUILD_PLATFORM: 'ios', ENABLE_LIVE_ACTIVITY: 'true', EXPO_PUBLIC_REVENUECAT_IOS_KEY: 'goog_wrong' }), /REVENUECAT_IOS_KEY/);
  const ios = configured({ ...release, EAS_BUILD_PROFILE: 'production',
    EAS_BUILD_PLATFORM: 'ios', ENABLE_LIVE_ACTIVITY: 'true', EXPO_PUBLIC_REVENUECAT_IOS_KEY: 'appl_example_public_key' });
  assert.equal(ios.ios.bundleIdentifier, 'jp.lastride.app');
});

test('App Store production refuses bundle ID overrides but Personal Team development remains flexible', () => {
  const releaseIOS = { ...release, EAS_BUILD_PROFILE: 'production',
    EAS_BUILD_PLATFORM: 'ios', ENABLE_LIVE_ACTIVITY: 'true', EXPO_PUBLIC_REVENUECAT_IOS_KEY: 'appl_realistic_public' };
  assert.throws(() => configured({ ...releaseIOS, IOS_BUNDLE_ID: 'jp.lastride.app.personal' }),
    /Production iOS requires bundle ID jp.lastride.app/);
  const canonical = configured({ ...releaseIOS, IOS_BUNDLE_ID: 'jp.lastride.app' });
  assert.equal(canonical.ios.bundleIdentifier, 'jp.lastride.app');
  const preview = configured({ EAS_BUILD_PROFILE: 'preview',
    EXPO_PUBLIC_API_URL: 'https://api.example.invalid',
    IOS_BUNDLE_ID: 'jp.lastride.app.personal' });
  assert.equal(preview.ios.bundleIdentifier, 'jp.lastride.app.personal');
});

test('App Store release must include Live Activity and bundled widget, not just notifications', () => {
  const opts = { ...release, EAS_BUILD_PROFILE: 'production', EAS_BUILD_PLATFORM: 'ios',
    EXPO_PUBLIC_REVENUECAT_IOS_KEY: 'appl_realistic_public' };
  assert.throws(() => configured({ ...opts, ENABLE_LIVE_ACTIVITY: '' }), /ENABLE_LIVE_ACTIVITY/);
  const enabled = configured({ ...opts, ENABLE_LIVE_ACTIVITY: 'true' });
  assert.equal(enabled.ios.infoPlist.NSSupportsLiveActivities, true);
  assert.ok(enabled.plugins.some(plugin => Array.isArray(plugin) && plugin[0] === 'expo-widgets'));
});

test('Galaxy Store release uses a distinct package and verified release capabilities', () => {
  const app = configured({ ...release, EAS_BUILD_PROFILE: 'galaxy',
    EXPO_PUBLIC_ANDROID_STORE: 'galaxy',
    EXPO_PUBLIC_REVENUECAT_GALAXY_KEY: 'galx_test_public_key',
    EXPO_ANDROID_GALAXY_GOOGLE_MAPS_API_KEY: key });
  assert.equal(app.android.package, 'jp.lastride.app.galaxy');
  assert.equal(app.extra.androidDistributionStore, 'galaxy');
  assert.ok(app.android.config.googleMaps.apiKey);
});
test('Galaxy Store release refuses missing billing key and maps SDK key', () => {
  const params = { ...release, EAS_BUILD_PROFILE: 'galaxy',
    EXPO_PUBLIC_ANDROID_STORE: 'galaxy' };
  assert.throws(() => configured(params), /REVENUECAT_GALAXY_KEY/);
  assert.throws(() => configured({ ...params, EXPO_PUBLIC_REVENUECAT_GALAXY_KEY: 'galx_public',
    EXPO_ANDROID_GALAXY_GOOGLE_MAPS_API_KEY: ''}), /EXPO_ANDROID_GALAXY_GOOGLE_MAPS_API_KEY/);
});
test('Store releases reject development billing and swapped distribution', () => {
  assert.throws(() => configured({ ...release, EAS_BUILD_PROFILE: 'production',
    EXPO_PUBLIC_ANDROID_STORE: 'galaxy'}), /google-play billing/);
  assert.throws(() => configured({ ...release, EAS_BUILD_PROFILE: 'galaxy',
    EXPO_PUBLIC_ANDROID_STORE: 'google-play'}), /galaxy billing/);
  assert.throws(() => configured({ ...release, EAS_BUILD_PROFILE: 'galaxy',
    EXPO_PUBLIC_ANDROID_STORE: 'galaxy', EXPO_PUBLIC_REVENUECAT_GALAXY_KEY: 'galx_public',
    EXPO_PUBLIC_GALAXY_BILLING_MODE: 'TEST'}), /test billing/);
});
test('Galaxy store refuses a Play key or RevenueCat secret in a public client configuration', () => {
  const env = { ...release, EAS_BUILD_PROFILE: 'galaxy', EXPO_PUBLIC_ANDROID_STORE: 'galaxy',
    EXPO_ANDROID_GALAXY_GOOGLE_MAPS_API_KEY: key };
  for (const wrong of ['goog_wrong_billing', 'sk_private', 'test_store']) {
    assert.throws(() => configured({ ...env, EXPO_PUBLIC_REVENUECAT_GALAXY_KEY: wrong }),
      /REVENUECAT_GALAXY_KEY/);
  }
});

test('store-signed Android builds refuse unapproved package-name overrides', () => {
  assert.throws(() => configured({ ...release, EAS_BUILD_PROFILE: 'production',
    ANDROID_PACKAGE_ID: 'jp.lastride.app.test' }), /Android package jp.lastride.app/);
  assert.throws(() => configured({ ...release, EAS_BUILD_PROFILE: 'galaxy',
    EXPO_PUBLIC_ANDROID_STORE: 'galaxy', EXPO_PUBLIC_REVENUECAT_GALAXY_KEY: 'galx_valid_public',
    EXPO_ANDROID_GALAXY_GOOGLE_MAPS_API_KEY: key,
    ANDROID_PACKAGE_ID: 'jp.lastride.app.galaxy.test' }), /Android package jp.lastride.app.galaxy/);
  const debug = configured({ ANDROID_PACKAGE_ID: 'jp.lastride.app.dev' });
  assert.equal(debug.android.package, 'jp.lastride.app.dev');
});

test('Galaxy store never builds for iOS', () => {
  assert.throws(() => configured({ ...release, EAS_BUILD_PROFILE: 'galaxy',
    EAS_BUILD_PLATFORM: 'ios', EXPO_PUBLIC_ANDROID_STORE: 'galaxy',
    EXPO_PUBLIC_REVENUECAT_GALAXY_KEY: 'galx_public'}), /only supports Android/);
});

test('Galaxy refuses reuse of Google Play package identity', () => {
  assert.throws(() => configured({ ...release, EAS_BUILD_PROFILE: 'galaxy',
    EXPO_PUBLIC_ANDROID_STORE: 'galaxy', EXPO_PUBLIC_REVENUECAT_GALAXY_KEY: 'galx_public',
    EXPO_ANDROID_GALAXY_GOOGLE_MAPS_API_KEY: key,
    ANDROID_PACKAGE_ID: 'jp.lastride.app' }), /different from Google Play/);
});

test('custom iOS MapKit module has a unique autolinked Swift class distinct from expo-maps', () => {
  const metadata = JSON.parse(readFileSync(new URL('../artifacts/last-ride/modules/apple-maps/expo-module.config.json', import.meta.url), 'utf8'));
  assert.deepEqual(metadata.apple.modules, ['LastRideAppleMapsModule']);
  const native = readFileSync(new URL('../artifacts/last-ride/modules/apple-maps/ios/LastRideAppleMapsModule.swift', import.meta.url), 'utf8');
  assert.match(native, /public class LastRideAppleMapsModule: Module/);
  assert.match(native, /Name\("AppleMaps"\)/);
  assert.doesNotMatch(native, /public class AppleMapsModule: Module/);
});
