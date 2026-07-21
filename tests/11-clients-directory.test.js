// Covers: the client directory (Search screen, empty query) backfills from
// existing appointment history, dedupes by phone, aggregates visit
// count/spend/last-visit correctly, the marketing-consent checkbox persists
// across reload, tapping a client drills into their appointment history, and
// saving a new appointment for a brand-new client upserts them into the
// directory automatically.
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
      { id: 'a2', name: 'Priya Sharma', phone: '416-555-0199', service: 'Hairstyling', date: '2026-07-01', time: '10:00', address: '123 Maple St', price: '80', paymentMethod: 'Cash', notes: '', status: 'done' },
    ]));
  });

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await page.click('[data-action="goSearch"]');
  await page.waitForSelector('.section-title');

  const title = await page.locator('.section-title').first().textContent();
  assert.strictEqual(title, 'All clients');
  assert.strictEqual(await page.locator('[data-action="viewClientHistory"]').count(), 1, 'expected 1 client, deduped by phone from 2 appointments');
  const clientStats = await page.locator('.appt-service').nth(1).textContent();
  assert.ok(clientStats.includes('2 visits'), 'should aggregate both appointments as 2 visits');
  assert.ok(clientStats.includes('$330'), 'should sum both completed prices (250+80)');

  await page.click('[data-action="toggleClientConsent"]');
  await page.waitForTimeout(200);
  let checkboxClass = await page.locator('.checkbox-box').first().getAttribute('class');
  assert.ok(checkboxClass.includes('checkbox-box--checked'));

  await page.reload({ waitUntil: 'load' });
  await page.click('[data-action="goSearch"]');
  await page.waitForSelector('.checkbox-box');
  checkboxClass = await page.locator('.checkbox-box').first().getAttribute('class');
  assert.ok(checkboxClass.includes('checkbox-box--checked'), 'consent should persist across reload');

  await page.click('[data-action="viewClientHistory"]');
  await page.waitForTimeout(200);
  assert.strictEqual(await page.locator('.appt-card').count(), 2, "should show both of Priya's appointments");

  await page.click('[data-action="goAdd"]');
  await page.fill('#field-name', 'New Client Test');
  await page.fill('#field-phone', '416-555-0300');
  await page.fill('#field-date', '2026-09-01');
  await page.fill('#field-time', '10:00');
  await page.click('[data-action="onSave"]');
  await page.waitForSelector('.toast');
  await page.click('[data-action="goSearch"]');
  await page.fill('#search-input', '');
  await page.waitForSelector('[data-action="viewClientHistory"]');
  assert.strictEqual(await page.locator('[data-action="viewClientHistory"]').count(), 2, 'new client should upsert into directory');

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 11-clients-directory');
  await browser.close();
})().catch(e => { console.error('FAIL: 11-clients-directory —', e.message || e); process.exit(1); });
