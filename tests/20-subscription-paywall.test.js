// Covers: the subscription paywall gate -- signed in and onboarded but not
// entitled (no active/trialing subscription) still blocks the normal app;
// Subscribe/Manage billing/Sign out are reachable from the paywall; a
// `trialing` status counts as entitled (not just `active`); becoming entitled
// unlocks the app without needing to sign out and back in.
const { chromium } = require('playwright');
const assert = require('assert');
const BASE_URL = process.env.BASE_URL || 'http://localhost:8888';
const { bypassGate } = require('./lib/bypassGate');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await bypassGate(page, { subscription: { status: 'canceled' } });
  await page.waitForSelector('.gate-screen');

  assert.strictEqual(await page.locator('[data-action="goAdd"]').count(), 0, 'normal app should not be reachable without an entitled subscription');
  assert.ok(await page.locator('[data-action="onSubscribe"]').isVisible(), 'expected a Subscribe button on the paywall');
  assert.ok(await page.locator('[data-action="onManageBilling"]').isVisible(), 'expected a Manage billing link on the paywall');
  assert.ok(await page.locator('[data-action="onCloudSignOut"]').isVisible(), 'expected a way to sign out from the paywall');
  const banner = await page.locator('.banner-warning').textContent();
  assert.ok(/canceled/i.test(banner), 'expected a canceled-subscription banner, got: ' + banner);

  // `trialing` counts as entitled, not just `active`.
  await page.evaluate(() => setState({ subscription: { status: 'trialing' } }));
  await page.waitForTimeout(150);
  assert.strictEqual(await page.locator('[data-action="goAdd"]').count(), 1, 'trialing subscription should unlock the normal app');

  // Re-block, then confirm `active` also unlocks it live (no reload needed --
  // this is what the realtime onSnapshot listener is for in the real app).
  await page.evaluate(() => setState({ subscription: { status: 'past_due' } }));
  await page.waitForTimeout(150);
  assert.strictEqual(await page.locator('[data-action="goAdd"]').count(), 0, 'past_due should re-block the app');
  const pastDueBanner = await page.locator('.banner-warning').textContent();
  assert.ok(/payment/i.test(pastDueBanner), 'expected a past-due payment banner, got: ' + pastDueBanner);

  await page.evaluate(() => setState({ subscription: { status: 'active' } }));
  await page.waitForTimeout(150);
  assert.strictEqual(await page.locator('[data-action="goAdd"]').count(), 1, 'active subscription should unlock the normal app');

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 20-subscription-paywall');
  await browser.close();
})().catch(e => { console.error('FAIL: 20-subscription-paywall —', e.message || e); process.exit(1); });
