// Covers: the hardware/browser Back button is wired into the History API, so
// in an installed PWA it steps back through in-app screens instead of closing
// the whole app. Back from a sub-screen returns to the previous screen; Back
// from the detail screen's reschedule panel closes just the panel; Back from
// a client's history returns to the search list.
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

  const pad = n => String(n).padStart(2, '0');
  const future = new Date(Date.now() + 6 * 86400000);
  const futureYmd = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}`;

  await page.addInitScript((d) => {
    localStorage.setItem('asha_appointments_v1', JSON.stringify([
      { id: 'appt1', name: 'Neha', phone: '4165550111', service: 'Facial', date: d, time: '11:00', address: '', price: '', notes: '', status: 'upcoming' },
    ]));
  }, futureYmd);

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await bypassGate(page);
  await page.waitForSelector('.next-up-card');

  const onHome = () => page.locator('.section-title', { hasText: 'Today' }).isVisible();
  const onEarnings = () => page.locator('.period-summary-value').isVisible();

  // --- screen nav: home -> History -> Inventory, then Back, Back ---
  await page.click('[data-action="goEarnings"]');
  await page.waitForSelector('.period-summary-value');
  await page.click('[data-action="goInventory"]');
  await page.waitForSelector('#inv-name');

  await page.goBack();
  await page.waitForSelector('.period-summary-value');
  assert.ok(await onEarnings(), 'Back from Inventory should return to History');

  await page.goBack();
  await page.waitForSelector('.next-up-card');
  assert.ok(await onHome(), 'Back from History should return to Home');

  // --- detail + panel: open appt -> reschedule panel -> Back closes just the panel ---
  await page.click('.next-up-card');
  await page.waitForSelector('.detail-name');
  await page.click('[data-action="openReschedule"]');
  await page.waitForSelector('#res-date');

  await page.goBack();
  await page.waitForSelector('.detail-name');
  assert.strictEqual(await page.locator('#res-date').count(), 0, 'Back should close the reschedule panel');
  assert.ok(await page.locator('.detail-name').isVisible(), 'still on the detail screen after closing the panel');

  await page.goBack();
  await page.waitForSelector('.next-up-card');
  assert.ok(await onHome(), 'Back from detail should return to Home');

  // --- client history sub-view: search -> client -> Back returns to search ---
  await page.click('[data-action="goSearch"]');
  await page.waitForSelector('#search-input');
  const clientRow = page.locator('[data-action="viewClientHistory"]').first();
  if (await clientRow.count()) {
    await clientRow.click();
    await page.waitForSelector('[data-action="backFromClientHistory"], .client-history, .detail-name').catch(() => {});
    await page.goBack();
    await page.waitForSelector('#search-input');
    assert.ok(await page.locator('#search-input').isVisible(), 'Back from a client history returns to the search list');
  }

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 31-back-button-navigation');
  await browser.close();
})().catch(e => { console.error('FAIL: 31-back-button-navigation —', e.message || e); process.exit(1); });
