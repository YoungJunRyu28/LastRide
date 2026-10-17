import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

const require = createRequire(import.meta.url);
const getConfig = require('../artifacts/last-ride/app.config.js');
const base = JSON.parse(readFileSync(new URL('../artifacts/last-ride/app.json', import.meta.url), 'utf8')).expo;
const key = 'AIza' + 'X'.repeat(35);
const vars = [
  'EAS_BUILD_PROFILE', 'EAS_BUILD_PLATFORM', 'EXPO_PUBLIC_ANDROID_STORE',
  'EXPO_PUBLIC_GALAXY_BILLING_MODE', 'EXPO_PUBLIC_REVENUECAT_GALAXY_KEY',
  'EXPO_PUBLIC_REVENUECAT_ANDROID_KEY', 'EXPO_PUBLIC_REVENUECAT_IOS_KEY',
  'EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_APP_JOIN_BASE_URL',
  'EXPO_ANDROID_GOOGLE_MAPS_API_KEY', 'EXPO_ANDROID_GALAXY_GOOGLE_MAPS_API_KEY', 'ENABLE_REMOTE_PUSH',
  'ENABLE_UNIVERSAL_LINKS', 'ANDROID_PACKAGE_ID',
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
  EAS_BUILD_PLATFORM: 'android',
};
test('Google Play release keeps its current package and ordinary Play billing', () => {
  const app = configured({ ...release, EAS_BUILD_PROFILE: 'production' });
  assert.equal(app.android.package, 'jp.lastride.app');
  assert.equal(app.extra.androidDistributionStore, 'google-play');
  assert.equal(app.android.intentFilters[0].data[1].pathPrefix, '/group-join');
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
    EAS_BUILD_PLATFORM: 'ios', EXPO_PUBLIC_REVENUECAT_IOS_KEY: '' }), /REVENUECAT_IOS_KEY/);
  assert.throws(() => configured({ ...release, EAS_BUILD_PROFILE: 'production',
    EAS_BUILD_PLATFORM: 'ios', EXPO_PUBLIC_REVENUECAT_IOS_KEY: 'goog_wrong' }), /REVENUECAT_IOS_KEY/);
  const ios = configured({ ...release, EAS_BUILD_PROFILE: 'production',
    EAS_BUILD_PLATFORM: 'ios', EXPO_PUBLIC_REVENUECAT_IOS_KEY: 'appl_example_public_key' });
  assert.equal(ios.ios.bundleIdentifier, 'jp.lastride.app');
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

test('Galaxy store never builds for iOS', () => {
  assert.throws(() => configured({ ...release, EAS_BUILD_PROFILE: 'galaxy',
    EAS_BUILD_PLATFORM: 'ios', EXPO_PUBLIC_ANDROID_STORE: 'galaxy',
    EXPO_PUBLIC_REVENUECAT_GALAXY_KEY: 'galx_public'}), /only supports Android/);
});

test('Galaxy refuses reuse of Google Play package identity', () => {
  assert.throws(() => configured({ ...release, EAS_BUILD_PROFILE: 'galaxy',
    EXPO_PUBLIC_ANDROID_STORE: 'galaxy', EXPO_PUBLIC_REVENUECAT_GALAXY_KEY: 'galx_public',
    EXPO_ANDROID_GALAXY_GOOGLE_MAPS_API_KEY: key,
    ANDROID_PACKAGE_ID: 'jp.lastride.app' }), /different package ID/);
});
