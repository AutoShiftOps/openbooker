// Covers: marking a day off from the Calendar screen (visual marker on the
// grid, "Closed" state hides the free-slot availability list but still shows
// any existing bookings that day), unmarking it, and the Add screen warning
// if she picks a date that's marked off (without hard-blocking the save --
// exceptions happen).
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

  await page.click('[data-action="goCalendar"]');
  await page.waitForSelector('.calendar-grid');

  const monthLabel = await page.locator('.section-title').first().textContent();
  if (!monthLabel.includes('August 2026')) {
    for (let i = 0; i < 24; i++) {
      const lbl = await page.locator('.section-title').first().textContent();
      if (lbl.includes('August 2026')) break;
      await page.click('[data-action="calendarNextMonth"]');
      await page.waitForTimeout(50);
    }
  }

  await page.click('.calendar-cell[data-value="2026-08-15"]');
  await page.waitForSelector('[data-action="toggleDayOff"]');
  let toggleText = await page.locator('[data-action="toggleDayOff"]').textContent();
  assert.ok(/mark as a day off/i.test(toggleText), 'expected "Mark as a day off" initially');

  // No availability list should show before marking off (sanity: it's a normal open day)
  assert.strictEqual(await page.locator('[data-action="goAddFromCalendar"]').count(), 1);

  await page.click('[data-action="toggleDayOff"]');
  await page.waitForSelector('.toast');
  await page.waitForTimeout(200);

  toggleText = await page.locator('[data-action="toggleDayOff"]').textContent();
  assert.ok(/available again/i.test(toggleText), 'expected "Mark as available again" after blocking');
  assert.strictEqual(await page.locator('.calendar-cell--blocked').count(), 1, 'expected exactly 1 blocked day marked in the grid');
  assert.strictEqual(await page.locator('[data-action="goAddFromCalendar"]').count(), 0, 'availability list should be hidden once the day is blocked');
  const bannerText = await page.locator('.banner-warning').textContent();
  assert.ok(/marked off/i.test(bannerText), 'expected a "marked off" warning banner');

  // Add screen should warn if she picks this exact date, but not prevent saving.
  await page.click('[data-action="goAdd"]');
  await page.fill('#field-name', 'Exception Client');
  await page.fill('#field-phone', '4165551111');
  await page.fill('#field-date', '2026-08-15');
  await page.fill('#field-time', '13:00');
  await page.waitForSelector('.banner-warning');
  const addWarning = await page.locator('.banner-warning').textContent();
  assert.ok(/day off/i.test(addWarning), 'Add screen should warn about the blocked day: ' + addWarning);
  await page.click('[data-action="onSave"]');
  await page.waitForSelector('.toast');
  const savedOk = await page.locator('.wordmark').isVisible();
  assert.ok(savedOk, 'should still be able to save an exception booking on a blocked day');

  // Unmark the day -> availability list should come back, blocked marker gone.
  await page.click('[data-action="goCalendar"]');
  await page.waitForSelector('.calendar-cell[data-value="2026-08-15"]');
  await page.click('.calendar-cell[data-value="2026-08-15"]');
  await page.click('[data-action="toggleDayOff"]');
  await page.waitForTimeout(200);
  assert.strictEqual(await page.locator('.calendar-cell--blocked').count(), 0, 'blocked marker should be gone after unmarking');
  assert.strictEqual(await page.locator('[data-action="goAddFromCalendar"]').count(), 1, 'availability list should return after unmarking');

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 15-day-off-blocking');
  await browser.close();
})().catch(e => { console.error('FAIL: 15-day-off-blocking —', e.message || e); process.exit(1); });
