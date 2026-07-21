// Covers: adding a client manually with no appointment yet, merging two
// duplicate client records (history reassigns to the kept client, the
// absorbed one disappears), cancelling a merge mid-flow does nothing, and the
// consent toggle still works normally outside of merge mode.
const { chromium } = require('playwright');
const assert = require('assert');
const BASE_URL = process.env.BASE_URL || 'http://localhost:8888';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });

  await page.addInitScript(() => {
    localStorage.setItem('asha_appointments_v1', JSON.stringify([
      { id: 'a1', name: 'Priya Sharma', phone: '416-555-0199', service: 'Bridal makeup', date: '2026-06-01', time: '10:00', address: '123 Maple St', price: '250', paymentMethod: 'Cash', notes: '', status: 'done' },
    ]));
  });

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await page.click('[data-action="goSearch"]');
  await page.waitForSelector('[data-action="openAddClient"]');

  await page.click('[data-action="openAddClient"]');
  await page.waitForSelector('#new-client-name');
  await page.fill('#new-client-name', 'Zainab Khan');
  await page.fill('#new-client-phone', '416-555-0400');
  await page.click('[data-action="confirmAddClient"]');
  await page.waitForSelector('.toast');
  await page.waitForTimeout(200);
  assert.strictEqual(await page.locator('[data-action="viewClientHistory"]').count(), 2, 'expect 2 clients: Priya + Zainab');

  const zainabMergeBtn = page.locator('.appt-card', { hasText: 'Zainab Khan' }).locator('[data-action="startMergeClient"]');
  await zainabMergeBtn.click();
  await page.waitForSelector('[data-action="cancelMerge"]');
  const bannerText = await page.locator('.banner-warning-text').textContent();
  assert.ok(bannerText.includes('Zainab Khan'));

  await page.locator('.appt-card', { hasText: 'Priya Sharma' }).click();
  await page.waitForSelector('[data-action="confirmMerge"]');
  const confirmText = await page.locator('.inline-panel .hint-text').textContent();
  assert.ok(confirmText.includes('Zainab Khan') && confirmText.includes('Priya Sharma'));

  await page.click('[data-action="confirmMerge"]');
  await page.waitForSelector('.toast');
  await page.waitForTimeout(200);
  assert.strictEqual(await page.locator('[data-action="viewClientHistory"]').count(), 1, 'expect 1 client after merge');
  const remainingName = await page.locator('.appt-name').first().textContent();
  assert.strictEqual(remainingName, 'Priya Sharma', 'the target (kept) client should survive');

  await page.click('[data-action="openAddClient"]');
  await page.fill('#new-client-name', 'Test Cancel Merge');
  await page.click('[data-action="confirmAddClient"]');
  await page.waitForTimeout(300);
  await page.locator('.appt-card', { hasText: 'Test Cancel Merge' }).locator('[data-action="startMergeClient"]').click();
  await page.click('[data-action="cancelMerge"]');
  await page.waitForTimeout(200);
  assert.strictEqual(await page.locator('[data-action="viewClientHistory"]').count(), 2, 'cancelled merge should not merge anything');

  await page.locator('.appt-card', { hasText: 'Priya Sharma' }).locator('[data-action="toggleClientConsent"]').click();
  await page.waitForTimeout(200);
  const checked = await page.locator('.appt-card', { hasText: 'Priya Sharma' }).locator('.checkbox-box').getAttribute('class');
  assert.ok(checked.includes('checkbox-box--checked'));

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 12-client-management');
  await browser.close();
})().catch(e => { console.error('FAIL: 12-client-management —', e.message || e); process.exit(1); });
