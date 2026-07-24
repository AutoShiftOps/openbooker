// Covers: the per-tenant timezone setting in Business details -- a <select>
// with the current value, editable, persists to localStorage, and survives a
// reload. (The Cloud Function side -- reading businessProfile.timezone per
// tenant instead of a hardcoded zone -- isn't reachable from this
// browser-driven harness; see functions/index.js's apptStartMillis/tz usage.)
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
  await page.click('[data-action="goSettings"]');
  await page.waitForSelector('select[data-bind="businessProfile.timezone"]');

  const tzSelect = page.locator('select[data-bind="businessProfile.timezone"]');
  const initialValue = await tzSelect.inputValue();
  assert.ok(initialValue, 'expected a non-empty default timezone');

  await tzSelect.selectOption('America/Los_Angeles');
  await page.waitForTimeout(200);

  const stored = JSON.parse(await page.evaluate(() => localStorage.getItem('asha_business_profile_v1')));
  assert.strictEqual(stored.timezone, 'America/Los_Angeles', 'timezone change should persist to localStorage');

  await page.reload({ waitUntil: 'load' });
  await bypassGate(page);
  await page.click('[data-action="goSettings"]');
  await page.waitForSelector('select[data-bind="businessProfile.timezone"]');
  const afterReload = await page.locator('select[data-bind="businessProfile.timezone"]').inputValue();
  assert.strictEqual(afterReload, 'America/Los_Angeles', 'timezone should survive a reload');

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 21-timezone-setting');
  await browser.close();
})().catch(e => { console.error('FAIL: 21-timezone-setting —', e.message || e); process.exit(1); });
