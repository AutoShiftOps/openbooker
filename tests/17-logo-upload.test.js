// Covers: owner-uploaded business logo -- auto-cropped/resized client-side via
// canvas, shown in the header and as the browser tab favicon, persisted across
// reload, and removable back to the text-only header.
const path = require('path');
const { chromium } = require('playwright');
const assert = require('assert');
const BASE_URL = process.env.BASE_URL || 'http://localhost:8888';
const { bypassGate } = require('./lib/bypassGate');
const SAMPLE_IMAGE = path.join(__dirname, '..', 'icons', 'icon-512.png');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await bypassGate(page);
  await page.waitForSelector('.wordmark');

  // No logo yet: no header image, default favicon file.
  assert.strictEqual(await page.locator('.header-logo').count(), 0, 'no header logo before uploading one');
  const faviconBefore = await page.locator('#favicon-link').getAttribute('href');
  assert.ok(faviconBefore.indexOf('icon-192.png') !== -1, 'favicon should point at the default icon file before upload');

  await page.click('[data-action="goSettings"]');
  await page.waitForSelector('input[data-action="onLogoChange"]', { state: 'attached' });
  const uploadLabel = await page.locator('label:has(input[data-action="onLogoChange"])').textContent();
  assert.ok(/upload logo/i.test(uploadLabel), 'expected an "Upload logo" control when no logo is set');

  await page.setInputFiles('input[data-action="onLogoChange"]', SAMPLE_IMAGE);
  await page.waitForSelector('.toast');
  await page.waitForTimeout(200);

  // Persisted to localStorage as a data URI.
  const stored = await page.evaluate(() => localStorage.getItem('asha_business_profile_v1'));
  const storedProfile = JSON.parse(stored);
  assert.ok(storedProfile.logoDataUrl && storedProfile.logoDataUrl.indexOf('data:image/png') === 0, 'expected a data:image/png logo persisted');

  // Favicon updated live.
  const faviconAfter = await page.locator('#favicon-link').getAttribute('href');
  assert.ok(faviconAfter.indexOf('data:image/png') === 0, 'expected favicon href to become the uploaded logo data URI');

  // Header shows the logo image, and the upload control now offers "Change"/"Remove".
  await page.click('[data-action="goHome"]');
  assert.strictEqual(await page.locator('.header-logo').count(), 1, 'expected a header logo image after uploading');
  await page.click('[data-action="goSettings"]');
  const changeLabel = await page.locator('label:has(input[data-action="onLogoChange"])').textContent();
  assert.ok(/change logo/i.test(changeLabel), 'expected the control to read "Change logo" once a logo is set');
  assert.strictEqual(await page.locator('[data-action="removeLogo"]').count(), 1, 'expected a "Remove logo" option once a logo is set');

  // Survives a reload (localStorage, not just in-memory state).
  await page.reload({ waitUntil: 'load' });
  await bypassGate(page);
  await page.waitForSelector('.wordmark');
  assert.strictEqual(await page.locator('.header-logo').count(), 1, 'logo should survive a reload');
  const faviconAfterReload = await page.locator('#favicon-link').getAttribute('href');
  assert.ok(faviconAfterReload.indexOf('data:image/png') === 0, 'favicon should survive a reload');

  // Remove it -> back to text-only header and the default favicon file.
  await page.click('[data-action="goSettings"]');
  await page.click('[data-action="removeLogo"]');
  await page.waitForTimeout(200);
  await page.click('[data-action="goHome"]');
  assert.strictEqual(await page.locator('.header-logo').count(), 0, 'logo should be gone after removing it');
  const faviconAfterRemove = await page.locator('#favicon-link').getAttribute('href');
  assert.ok(faviconAfterRemove.indexOf('icon-192.png') !== -1, 'favicon should revert to the default icon file after removing the logo');

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 17-logo-upload');
  await browser.close();
})().catch(e => { console.error('FAIL: 17-logo-upload —', e.message || e); process.exit(1); });
