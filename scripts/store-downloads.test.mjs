import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import vm from 'node:vm';

const source = readFileSync(new URL('../site/store-downloads.js', import.meta.url), 'utf8');
function element(tagName) {
  const el = { tagName, children: [], appendChild(child) { this.children.push(child); } };
  return el;
}
function render(storeConfig, userAgent = 'Android') {
  const links = [];
  // The placeholders and the link container sit side by side, as on the pages.
  const parent = {
    attributes: new Set(),
    setAttribute(name) { this.attributes.add(name); },
    hasAttribute(name) { return this.attributes.has(name); },
    querySelector: () => container,
  };
  const placeholders = ['appStore', 'googlePlay'].map(store => ({
    hidden: false,
    getAttribute: () => store,
    store,
    parentNode: parent,
    replacedBy: null,
    replaceWith(node) { this.replacedBy = node; },
  }));
  const container = {
    getAttribute: () => 'en',
    appendChild: element => links.push(element),
    parentNode: parent,
  };
  const document = {
    documentElement: { lang: 'en' },
    querySelectorAll: selector =>
      selector === '[data-store-links]' ? [container] : placeholders,
    createElement: element,
  };
  vm.runInNewContext(source, {
    window: {LASTRIDE_STORE_LISTINGS: storeConfig},
    navigator: {userAgent},
    document,
    URL,
  });
  return { links, placeholders };
}
test('an unpublished app renders no links, never a dead listing', () => {
  const { links, placeholders } = render({ appStore:'', googlePlay:'', galaxyStore:''});
  assert.equal(links.length, 0);
  assert.ok(placeholders.every(x => !x.hidden));
});
test('Android viewers get Google Play first and Samsung next when actually published', () => {
  const { links, placeholders } = render({
    googlePlay: 'https://play.google.com/store/apps/details?id=jp.lastride.app',
    galaxyStore: 'https://galaxystore.samsung.com/detail/jp.lastride.app.galaxy',
  });
  assert.deepEqual(links.map(link => link.textContent),
    ['Android · Google Play', 'Samsung · Galaxy Store']);
  assert.ok(links.every(link => link.rel.includes('noopener')));
  assert.ok(placeholders.find(x => x.store === 'googlePlay').hidden);
});
test('iOS viewers get the App Store first, as Apple\'s official badge in the iPhone placeholder; malicious or token-bearing destinations are ignored', () => {
  const { links, placeholders } = render({
    appStore: 'https://apps.apple.com/jp/app/lastride/id1234567890',
    googlePlay: 'https://play.google.com.evil.example/store/apps?invite=secret',
    galaxyStore: 'https://galaxystore.samsung.com/detail/pkg?invite=secret',
  }, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)');
  const badge = placeholders.find(x => x.store === 'appStore').replacedBy;
  assert.ok(badge, 'the App Store placeholder is replaced by the badge');
  assert.equal(badge.className, 'store-badge');
  assert.equal(badge.href, 'https://apps.apple.com/jp/app/lastride/id1234567890');
  assert.ok(badge.rel.includes('noopener'));
  assert.equal(badge.children[0].alt, 'Download on the App Store');
  assert.match(badge.children[0].src, /app-store-badge-en-us\.svg$/);
  // Not repeated in the links row, and the rejected destinations add nothing.
  assert.equal(links.length, 0);
  assert.ok(!placeholders.find(x => x.store === 'googlePlay').hidden);
});
test('pages without a placeholder (invites) get the badge in the links row', () => {
  const links = [];
  const container = { getAttribute: () => 'ja', appendChild: e => links.push(e), parentNode: { hasAttribute: () => false } };
  vm.runInNewContext(source, {
    window: { LASTRIDE_STORE_LISTINGS: { appStore: 'https://apps.apple.com/jp/app/id6821818204' } },
    navigator: { userAgent: 'iPhone' },
    document: {
      documentElement: { lang: 'ja' },
      querySelectorAll: selector => (selector === '[data-store-links]' ? [container] : []),
      createElement: element,
    },
    URL,
  });
  assert.equal(links.length, 1);
  assert.equal(links[0].className, 'store-badge');
  assert.equal(links[0].children[0].alt, 'App Storeからダウンロード');
});
test('join and group invites include both platform download widgets', () => {
  for (const path of ['site/join/index.html','site/group-join/index.html']) {
    const html = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
    assert.match(html, /data-store-links data-lang="ja"/);
    assert.match(html, /data-store-links data-lang="en"/);
    assert.match(html, /src="\/store-downloads\.js(\?v=\d+)?"/);
  }
});

test('Play links reject extra tracking and invite query parameters', () => {
  const {links} = render({
    googlePlay: 'https://play.google.com/store/apps/details?id=jp.lastride.app&invite=secret',
  });
  assert.equal(links.length, 0);
});

test('unpublished Uptodown and AppGallery listings remain invisible', () => {
  const { links } = render({uptodown: '', appGallery: ''}, 'Android');
  assert.equal(links.length, 0);
});

test('published Uptodown and Huawei app pages are accepted only as exact listing URLs', () => {
  const { links } = render({
    uptodown: 'https://lastride.en.uptodown.com/android',
    appGallery: 'https://appgallery.huawei.com/app/C123456789',
  }, 'Android');
  assert.deepEqual(links.map(link => link.textContent), ['Android · Uptodown', 'Huawei · AppGallery']);
  assert.ok(links.every(link => !link.href.includes('token') && !link.href.includes('invite')));
});

test('rejects Uptodown/Huawei redirects, lookalike hosts, tracking and invite tokens', () => {
  for (const url of [
    'http://lastride.en.uptodown.com/android',
    'https://lastride.en.uptodown.com.evil.test/android',
    'https://anotherapp.en.uptodown.com/android',
    'https://lastride.en.uptodown.com/android/another',
    'https://lastride.en.uptodown.com/android?token=secret',
    'https://appgallery.huawei.com.evil.test/app/C123456',
    'https://appgallery.huawei.com/app/C123456?invite=secret',
    'https://appgallery.huawei.com/redirect/C123456',
  ]) {
    const key = url.includes('uptodown') ? 'uptodown' : 'appGallery';
    const { links } = render({[key]: url});
    assert.equal(links.length, 0, `Unexpected unverified link ${url}`);
  }
});

test('English pages use the region-free App Store link; Japanese pages keep the Japan store', () => {
  const config = {
    appStore: 'https://apps.apple.com/jp/app/id6821818204',
    appStoreEn: 'https://apps.apple.com/app/id6821818204',
  };
  for (const [lang, expected] of [['en', config.appStoreEn], ['ja', config.appStore]]) {
    const links = [];
    const container = { getAttribute: () => lang, appendChild: e => links.push(e), parentNode: { hasAttribute: () => false } };
    vm.runInNewContext(source, {
      window: { LASTRIDE_STORE_LISTINGS: config },
      navigator: { userAgent: 'iPhone' },
      document: {
        documentElement: { lang },
        querySelectorAll: selector => (selector === '[data-store-links]' ? [container] : []),
        createElement: element,
      },
      URL,
    });
    assert.equal(links[0].href, expected);
  }
});
