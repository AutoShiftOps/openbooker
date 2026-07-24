// Covers: the owner-editable "Business details" settings section -- editing
// name/tagline/location updates the header live, editing accent colors
// updates the CSS custom properties at runtime, editing currency/hours
// changes downstream display and booking-availability logic, and all of it
// persists to localStorage (and survives a reload) instead of being baked
// into hardcoded constants.
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
  await bypassGate(page);
  await page.waitForSelector('.wordmark');

  // Defaults render correctly before any edits (seeded by bypassGate --
  // stands in for a completed onboarding wizard).
  const wordmarkBefore = await page.locator('.wordmark').textContent();
  assert.strictEqual(wordmarkBefore, 'Test Business');

  await page.click('[data-action="goSettings"]');
  await page.waitForSelector('.section-title');
  const titles = await page.locator('.section-title').allTextContents();
  assert.ok(titles.some(t => /business details/i.test(t)), 'expected a "Business details" settings section');

  const nameInput = page.locator('[data-bind="businessProfile.name"]');
  assert.strictEqual(await nameInput.inputValue(), 'Test Business');

  // 1. Editing the name persists and updates the header live.
  await nameInput.fill('Glow Studio');
  await nameInput.blur();
  await page.waitForTimeout(100);
  await page.click('[data-action="goHome"]');
  const wordmarkAfter = await page.locator('.wordmark').textContent();
  assert.strictEqual(wordmarkAfter, 'Glow Studio', 'header wordmark should reflect the edited business name');

  const stored = await page.evaluate(() => localStorage.getItem('asha_business_profile_v1'));
  const storedProfile = JSON.parse(stored);
  assert.strictEqual(storedProfile.name, 'Glow Studio', 'business profile should persist to localStorage');

  // 2. Editing tagline/location updates the header too.
  await page.click('[data-action="goSettings"]');
  await page.locator('[data-bind="businessProfile.tagline"]').fill('SKINCARE ONLY');
  await page.locator('[data-bind="businessProfile.tagline"]').blur();
  await page.locator('[data-bind="businessProfile.location"]').fill('TORONTO, ONTARIO');
  await page.locator('[data-bind="businessProfile.location"]').blur();
  await page.waitForTimeout(100);
  await page.click('[data-action="goHome"]');
  assert.strictEqual(await page.locator('.header-tagline').textContent(), 'SKINCARE ONLY');
  assert.strictEqual(await page.locator('.header-location').textContent(), 'TORONTO, ONTARIO');

  // 3. Accent color updates the live CSS custom property (type=color can't use
  // Playwright's fill(), so set the value + dispatch events directly).
  await page.click('[data-action="goSettings"]');
  await page.locator('[data-bind="businessProfile.accent"]').evaluate(el => {
    el.value = '#ff0000';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(100);
  const accentVar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  assert.strictEqual(accentVar, '#ff0000', 'expected --accent CSS var to update live after editing the color picker');

  // 4. Currency symbol shows up in Earnings.
  await page.click('[data-action="goSettings"]');
  await page.locator('[data-bind="businessProfile.currency"]').fill('EUR');
  await page.locator('[data-bind="businessProfile.currency"]').blur();
  await page.waitForTimeout(100);
  await page.click('[data-action="goEarnings"]');
  await page.waitForSelector('.stat-value');
  const statText = await page.locator('.stat-card .stat-value').first().textContent();
  assert.ok(statText.startsWith('EUR'), 'expected the edited currency symbol in the earnings stat, got: ' + statText);

  // 5. Business hours change the Add screen's availability slot count.
  await page.click('[data-action="goSettings"]');
  await page.locator('[data-bind="businessProfile.hoursStart"]').fill('9');
  await page.locator('[data-bind="businessProfile.hoursStart"]').blur();
  await page.locator('[data-bind="businessProfile.hoursEnd"]').fill('12');
  await page.locator('[data-bind="businessProfile.hoursEnd"]').blur();
  await page.waitForTimeout(100);
  await page.click('[data-action="goAdd"]');
  await page.fill('#field-date', '2026-09-11');
  await page.waitForSelector('.day-schedule');
  const slotCount = await page.locator('.day-slot').count();
  assert.strictEqual(slotCount, 3, 'expected 3 hourly slots for a 9am-12pm business day, got ' + slotCount);

  // 6. Survives a full reload (localStorage, not just in-memory state).
  await page.reload({ waitUntil: 'load' });
  await bypassGate(page);
  await page.waitForSelector('.wordmark');
  assert.strictEqual(await page.locator('.wordmark').textContent(), 'Glow Studio', 'edited name should survive a reload');
  const accentVarAfterReload = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  assert.strictEqual(accentVarAfterReload, '#ff0000', 'edited accent should survive a reload');

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 16-business-profile');
  await browser.close();
})().catch(e => { console.error('FAIL: 16-business-profile —', e.message || e); process.exit(1); });
