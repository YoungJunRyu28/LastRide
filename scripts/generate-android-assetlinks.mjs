#!/usr/bin/env node
/**
 * Generate the static Android Digital Asset Links file for a specific Play
 * signing certificate. Never guess this SHA-256: Google Play App Signing's
 * app-signing fingerprint differs from the developer's upload certificate.
 *
 * ANDROID_PLAY_SIGNING_SHA256='AA:...' node scripts/generate-android-assetlinks.mjs
 * Deploy site/ to the HTTPS invite domain after generation.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

export function normalizeCertificateFingerprint(raw) {
  if (typeof raw !== 'string') throw new TypeError('Signing certificate SHA-256 fingerprint is required');
  const hex = raw.trim().replaceAll(':', '').toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) {
    throw new Error('Expected a genuine 32-byte SHA-256 fingerprint from Google Play App Signing');
  }
  return hex.match(/.{2}/g).join(':');
}

export function generateAssetLinks(packageName, signingFingerprints) {
  if (!/^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*){1,}$/.test(packageName))
    throw new Error('Invalid Android package name');
  if (signingFingerprints.length === 0) throw new Error('At least one signing certificate required');
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: packageName,
        sha256_cert_fingerprints: [...new Set(signingFingerprints.map(normalizeCertificateFingerprint))],
      },
    },
  ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const packageName = process.env.ANDROID_PACKAGE_ID || 'jp.lastride.app';
  const sha256 = process.env.ANDROID_PLAY_SIGNING_SHA256;
  const links = generateAssetLinks(packageName, [sha256]);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const destination = resolve(root, 'site/.well-known/assetlinks.json');
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, JSON.stringify(links, null, 2) + '\n');
  console.log(`Generated ${destination} for ${packageName}; deploy site/ and verify the production URL returns HTTP 200`);
}
