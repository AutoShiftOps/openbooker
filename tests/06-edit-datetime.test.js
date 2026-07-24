// Covers: "Edit details" on the Detail screen includes date & time (not just
// Reschedule), prefills correctly, saves correctly, and records the same
// reschedule-history trail the dedicated Reschedule button uses.
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

  await page.addInitScript(() => {
    localStorage.setItem('asha_appointments_v1', JSON.stringify([
      { id: 'a1', name: 'Priya', phone: '4165550101', service: 'Bridal makeup', date: '2026-08-08', time: '10:00', address: '', price: '', notes: '', status: 'upcoming' },
    ]));
  });

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await bypassGate(page);
  await page.click('.appt-card');
  await page.waitForSelector('[data-action="openEdit"]');
  await page.click('[data-action="openEdit"]');
  await page.waitForSelector('#edit-date');

  const dateVal = await page.locator('#edit-date').inputValue();
  const timeVal = await page.locator('#edit-time').inputValue();
  assert.strictEqual(dateVal, '2026-08-08');
  assert.strictEqual(timeVal, '10:00');

  await page.fill('#edit-date', '2026-08-15');
  await page.fill('#edit-time', '14:30');
  await page.click('[data-action="confirmEdit"]');
  await page.waitForSelector('.toast');

  const newDateLabel = await page.locator('.detail-info').textContent();
  assert.ok(newDateLabel.includes('15 Aug'), 'date did not update');

  const historyText = await page.locator('.history-strike').textContent().catch(() => '(none)');
  assert.ok(historyText.includes('8 Aug'), 'reschedule history not recorded when edited via Edit details');

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 06-edit-datetime');
  await browser.close();
})().catch(e => { console.error('FAIL: 06-edit-datetime —', e.message || e); process.exit(1); });
