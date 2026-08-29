// Covers: a fresh Add screen defaults date/time to right now (rounded up to
// the next 15-minute mark) instead of blank, so a walk-in/same-day booking
// doesn't need the date manually set every time. Also guards the deliberate
// exception: "Book again" on a past client still leaves date/time blank,
// since that's picking a new future slot, not "right now".
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
      { id: 'past1', name: 'Past Client', phone: '4165550003', service: 'Consultation', date: '2026-01-01', time: '10:00', address: '111 Elm St', price: '80', notes: '', status: 'done' },
    ]));
  });

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await bypassGate(page);

  const expectedDate = await page.evaluate(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });

  await page.click('[data-action="goAdd"]');
  await page.waitForSelector('#field-date');
  const dateVal = await page.locator('#field-date').inputValue();
  const timeVal = await page.locator('#field-time').inputValue();
  assert.strictEqual(dateVal, expectedDate, 'expected a fresh booking to default to today');
  assert.ok(timeVal, 'expected a fresh booking to default to a non-empty time');
  assert.match(timeVal, /^\d{2}:(00|15|30|45)$/, 'expected time rounded to a 15-minute mark, got: ' + timeVal);

  // "Book again" is the deliberate exception -- still blank.
  await page.click('[data-action="goHome"]');
  await page.click('[data-action="goEarnings"]');
  await page.click('.section-toggle:has-text("Completed history")');
  await page.waitForSelector('.appt-card--completed');
  await page.click('.appt-card--completed');
  await page.waitForSelector('[data-action="bookAgain"]');
  await page.click('[data-action="bookAgain"]');
  await page.waitForSelector('#field-name');
  assert.strictEqual(await page.locator('#field-date').inputValue(), '', 'Book again should still leave date blank');
  assert.strictEqual(await page.locator('#field-time').inputValue(), '', 'Book again should still leave time blank');

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 24-auto-date-time-default');
  await browser.close();
})().catch(e => { console.error('FAIL: 24-auto-date-time-default —', e.message || e); process.exit(1); });
