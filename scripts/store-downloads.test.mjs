import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import vm from 'node:vm';

const source = readFileSync(new URL('../site/store-downloads.js', import.meta.url), 'utf8');
function render(storeConfig, userAgent = 'Android') {
  const links = [];
  const placeholders = ['appStore', 'googlePlay'].map(store => ({
    hidden: false,
    getAttribute: () => store,
    store,
  }));
  const container = {
    getAttribute: () => 'en',
    appendChild: element => links.push(element),
  };
  const document = {
    querySelectorAll: selector =>
      selector === '[data-store-links]' ? [container] : placeholders,
    createElement: tagName => ({ tagName }),
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
test('iOS viewers get App Store first; malicious or token-bearing destinations are ignored', () => {
  const { links } = render({
    appStore: 'https://apps.apple.com/jp/app/lastride/id1234567890',
    googlePlay: 'https://play.google.com.evil.example/store/apps?invite=secret',
    galaxyStore: 'https://galaxystore.samsung.com/detail/pkg?invite=secret',
  }, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)');
  assert.equal(links.length, 1);
  assert.equal(links[0].textContent, 'iPhone · App Store');
  assert.ok(!links[0].href.includes('invite='));
});
test('join and group invites include both platform download widgets', () => {
  for (const path of ['site/join/index.html','site/group-join/index.html']) {
    const html = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
    assert.match(html, /data-store-links data-lang="ja"/);
    assert.match(html, /data-store-links data-lang="en"/);
    assert.match(html, /src="\/store-downloads\.js"/);
  }
});

test('Play links reject extra tracking and invite query parameters', () => {
  const {links} = render({
    googlePlay: 'https://play.google.com/store/apps/details?id=jp.lastride.app&invite=secret',
  });
  assert.equal(links.length, 0);
});
