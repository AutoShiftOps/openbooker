// Covers: the "Recent clients" quick-pick on the Add screen (prefills name/
// phone/address/services from a past booking) and "Book again" on a
// concluded appointment (same prefill, but leaves date/time blank for a
// fresh booking).
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
      { id: 'a1', name: 'Priya Sharma', phone: '416-555-0199', services: ['Consultation','Standard appointment'], date: '2026-07-01', time: '10:00', address: '123 Maple St', price: '250', paymentMethod: 'Cash', notes: '', status: 'done' },
      { id: 'a2', name: 'Jane Doe', phone: '416-555-0200', service: 'Standard appointment', date: '2026-07-10', time: '11:00', address: '456 Oak Ave', price: '', notes: '', status: 'upcoming' },
    ]));
  });

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await bypassGate(page);

  await page.click('[data-action="goAdd"]');
  await page.waitForSelector('.payment-chip[data-action="pickRecentClient"]');
  // Chips now include the phone number alongside the name (disambiguates
  // clients who share a name -- see 26-search-grouped-and-name-collisions.test.js),
  // so check by substring rather than an exact array match.
  const chipLabels = await page.locator('.payment-chip[data-action="pickRecentClient"]').allTextContents();
  assert.ok(chipLabels.some(t => t.includes('Priya Sharma')) && chipLabels.some(t => t.includes('Jane Doe')));

  await page.click('.payment-chip[data-action="pickRecentClient"]:has-text("Priya Sharma")');
  await page.waitForTimeout(50);
  assert.strictEqual(await page.locator('#field-name').inputValue(), 'Priya Sharma');
  assert.strictEqual(await page.locator('#field-phone').inputValue(), '416-555-0199');
  assert.strictEqual(await page.locator('#field-address').inputValue(), '123 Maple St');
  const activeChips = await page.locator('.payment-chip--active').allTextContents();
  assert.ok(activeChips.includes('Consultation') && activeChips.includes('Standard appointment'));

  // Search results are grouped by client now (see
  // 26-search-grouped-and-name-collisions.test.js) -- tap the client row,
  // then the specific appointment within their history, to reach "Book again".
  await page.click('[data-action="goSearch"]');
  await page.fill('#search-input', 'priya');
  await page.waitForSelector('.appt-card');
  await page.click('.appt-card');
  await page.waitForSelector('[data-action="openAppt"]');
  await page.click('[data-action="openAppt"]');
  await page.waitForSelector('[data-action="bookAgain"]');
  await page.click('[data-action="bookAgain"]');
  await page.waitForSelector('#field-name');

  assert.strictEqual(await page.locator('#field-name').inputValue(), 'Priya Sharma');
  assert.strictEqual(await page.locator('#field-phone').inputValue(), '416-555-0199');
  assert.strictEqual(await page.locator('#field-date').inputValue(), '', 'date/time should be blank for a fresh booking');
  const rebookChips = await page.locator('.payment-chip--active').allTextContents();
  assert.ok(rebookChips.includes('Consultation') && rebookChips.includes('Standard appointment'));

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 08-repeat-client');
  await browser.close();
})().catch(e => { console.error('FAIL: 08-repeat-client —', e.message || e); process.exit(1); });
