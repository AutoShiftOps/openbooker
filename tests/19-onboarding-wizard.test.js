// Covers: the regression this whole feature exists to fix -- a brand new
// tenant (fresh Firestore doc, doc.exists === false in pullFromCloud) must
// fill in their own real business details before their first cloud write,
// instead of silently inheriting whatever DEFAULT_BUSINESS_PROFILE happens to
// contain. Also covers the name-required validation and that finishing
// onboarding unlocks the normal app.
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

  // Mirrors exactly what pullFromCloud()'s "brand new tenant" branch sets --
  // signed in, subscribed, but awaiting onboarding with a blank form.
  await page.evaluate(() => {
    setState({
      cloudReady: true,
      cloudUser: 'newuser@example.com',
      subscription: { status: 'trialing' },
      awaitingOnboarding: true,
      onboardingForm: {
        name: '', tagline: '', location: '', defaultAddress: '',
        currency: '$', hoursStart: 9, hoursEnd: 17, timezone: 'America/New_York'
      }
    });
  });
  await page.waitForSelector('.gate-screen');

  // Onboarding screen shows, not the normal home screen.
  assert.strictEqual(await page.locator('[data-action="goAdd"]').count(), 0, 'normal app should not be reachable during onboarding');
  assert.ok(await page.locator('[data-action="submitOnboarding"]').isVisible(), 'expected the onboarding Continue button');

  // Submitting with no business name is rejected.
  await page.click('[data-action="submitOnboarding"]');
  await page.waitForSelector('.toast');
  const toastText = await page.locator('.toast').textContent();
  assert.ok(/business name/i.test(toastText), 'expected a "business name is required" toast, got: ' + toastText);
  assert.strictEqual(await page.locator('[data-action="submitOnboarding"]').count(), 1, 'should still be on the onboarding screen');

  // Fill in real details and submit.
  await page.fill('[data-bind="onboardingForm.name"]', 'Riverside Wellness');
  await page.fill('[data-bind="onboardingForm.location"]', 'Austin, Texas');
  await page.fill('[data-bind="onboardingForm.defaultAddress"]', '99 River Rd');
  await page.click('[data-action="submitOnboarding"]');
  await page.waitForTimeout(300);

  // Unlocked into the normal app, and critically -- the business name is what
  // was actually typed, not left empty or some baked-in default.
  assert.strictEqual(await page.locator('[data-action="goAdd"]').count(), 1, 'normal app should be reachable once onboarding is done');
  const wordmark = await page.locator('.wordmark').textContent();
  assert.strictEqual(wordmark, 'Riverside Wellness', 'header should reflect the entered business name, not a default');

  const stored = JSON.parse(await page.evaluate(() => localStorage.getItem('asha_business_profile_v1')));
  assert.strictEqual(stored.name, 'Riverside Wellness');
  assert.strictEqual(stored.onboarded, true, 'businessProfile.onboarded should be true after finishing the wizard');
  assert.strictEqual(stored.location, 'Austin, Texas');
  assert.strictEqual(stored.defaultAddress, '99 River Rd');

  const awaiting = await page.evaluate(() => state.awaitingOnboarding);
  assert.strictEqual(awaiting, false, 'awaitingOnboarding should be cleared after submit');

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 19-onboarding-wizard');
  await browser.close();
})().catch(e => { console.error('FAIL: 19-onboarding-wizard —', e.message || e); process.exit(1); });
