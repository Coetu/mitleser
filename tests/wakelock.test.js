// Tests: Erkennung der iPadOS-Version für den Hinweis zur Bildschirmsperre (js/wakelock.js)
import { test, assert } from './harness.js';
import { appleOsVersion, isWebAppWakeLockBroken } from '../js/wakelock.js';

const IPAD_DESKTOP = (version) =>
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${version} Safari/605.1.15`;

test('Version aus der iPad-Kennung im Desktop-Modus (Version/…)', () => {
  assert.deepEqual(appleOsVersion(IPAD_DESKTOP('18.3')), { major: 18, minor: 3 });
  assert.equal(isWebAppWakeLockBroken(IPAD_DESKTOP('17.4')), true);
  assert.equal(isWebAppWakeLockBroken(IPAD_DESKTOP('18.3')), true);
  assert.equal(isWebAppWakeLockBroken(IPAD_DESKTOP('18.4')), false);
  assert.equal(isWebAppWakeLockBroken(IPAD_DESKTOP('27.0')), false);
});

test('Version aus „CPU OS 16_4“ (iPad/iPhone ohne Desktop-Modus)', () => {
  const ua = (os) => `Mozilla/5.0 (iPad; CPU OS ${os} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148`;
  assert.equal(isWebAppWakeLockBroken(ua('16_4')), true);
  assert.equal(isWebAppWakeLockBroken(ua('18_4_1')), false);
  assert.equal(isWebAppWakeLockBroken('Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) Version/26.0'), false);
});

test('Ohne erkennbare Version kein Hinweis', () => {
  assert.equal(appleOsVersion('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'), null);
  assert.equal(isWebAppWakeLockBroken(''), false);
  assert.equal(isWebAppWakeLockBroken(undefined), false);
});
