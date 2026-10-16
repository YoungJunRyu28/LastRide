import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { generateAssetLinks, normalizeCertificateFingerprint } from './generate-android-assetlinks.mjs';

const sha = 'a1'.repeat(32);
test('normalizes a verified 32-byte SHA-256 certificate fingerprint', () => {
  assert.equal(normalizeCertificateFingerprint(sha), Array(32).fill('A1').join(':'));
  assert.equal(normalizeCertificateFingerprint(Array(32).fill('A1').join(':')), Array(32).fill('A1').join(':'));
});
test('rejects placeholders, invalid/short certificates and injection', () => {
  for (const input of ['', '<SHA256_SIGNING_CERT_FINGERPRINT>', '12:34', 'zz'.repeat(32)]) {
    assert.throws(() => normalizeCertificateFingerprint(input));
  }
  assert.throws(() => generateAssetLinks('invalid!', [sha]));
});
test('uses the actual package name and includes only the verified signing keys', () => {
  const links = generateAssetLinks('jp.lastride.app', [sha, sha]);
  assert.equal(links[0].target.package_name, 'jp.lastride.app');
  assert.equal(links[0].target.sha256_cert_fingerprints.length, 1);
  assert.deepEqual(links[0].relation, ['delegate_permission/common.handle_all_urls']);
});
