// Covers: the mandatory auth gate (REQUIRE_AUTH) that sits in front of the
// entire app for the openbooker SaaS build -- when not signed in, none of the
// normal app screens/nav are reachable, only the full-screen sign-in view is;
// the Terms/Privacy consent checkbox is required before either sign-in path
// (Google or email) will proceed.
const { chromium } = require('playwright');
const assert = require('assert');
const BASE_URL = process.env.BASE_URL || 'http://localhost:8888';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof setState === 'function');

  // Simulate a configured backend (real Firebase keys) but a signed-out user --
  // this is the real first-launch state for anyone who isn't this test harness
  // (which normally has no Firebase config at all, so bypassGate() is what
  // every other test uses to skip past this entirely).
  await page.evaluate(() => setState({ cloudReady: true }));
  await page.waitForSelector('.gate-screen');

  // None of the normal app is reachable from behind the gate.
  assert.strictEqual(await page.locator('[data-action="goAdd"]').count(), 0, 'Add nav should not be reachable while signed out');
  assert.strictEqual(await page.locator('[data-action="goSearch"]').count(), 0, 'Search nav should not be reachable while signed out');
  assert.strictEqual(await page.locator('[data-action="goSettings"]').count(), 0, 'Settings should not be reachable while signed out');

  // Sign-in form is present.
  assert.ok(await page.locator('.google-btn').isVisible(), 'expected a Google sign-in button');
  assert.ok(await page.locator('#auth-email').isVisible(), 'expected an email field');

  // Submitting without checking the consent box is blocked with a clear message.
  await page.fill('#auth-email', 'newuser@example.com');
  await page.fill('#auth-password', 'testpassword123');
  await page.click('[data-action="onCloudSubmit"]');
  await page.waitForTimeout(150);
  const statusText = await page.locator('.cloud-status').textContent();
  assert.ok(/agree/i.test(statusText), 'expected a consent-required message, got: ' + statusText);
  assert.strictEqual(await page.locator('.gate-screen').count(), 1, 'should still be on the gate after a blocked submit');

  // Checking consent updates the checkbox state.
  await page.click('[data-action="toggleAuthConsent"]');
  await page.waitForTimeout(100);
  const checked = await page.locator('input[type="checkbox"][data-action="toggleAuthConsent"]').isChecked();
  assert.ok(checked, 'consent checkbox should be checked after tapping it');

  // Tabs switch between sign-in and create-account modes.
  await page.click('[data-action="setAuthSignup"]');
  await page.waitForTimeout(100);
  assert.ok((await page.locator('.tab--active').textContent()).includes('Create account'));
  await page.click('[data-action="setAuthSignin"]');
  await page.waitForTimeout(100);
  assert.ok((await page.locator('.tab--active').textContent()).includes('Sign in'));

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 18-auth-gate');
  await browser.close();
})().catch(e => { console.error('FAIL: 18-auth-gate —', e.message || e); process.exit(1); });
