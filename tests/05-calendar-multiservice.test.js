// Covers: the month-grid calendar (booking dots, day drill-down, tap-a-free-
// slot jumps into Add with date+time prefilled), multi-service selection
// (chip toggling, saving, joined display label), and backward compatibility
// with appointments saved before multi-service existed (single `service`
// string field).
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

  // Use a date ~40 days out (rather than a hard-coded one that eventually
  // falls into the past): a past-dated booking no longer shows on the Home
  // "Upcoming" list, which the final assertion here relies on.
  const pad2 = n => String(n).padStart(2, '0');
  const target = new Date(Date.now() + 40 * 86400000);
  const APPT_DATE = `${target.getFullYear()}-${pad2(target.getMonth() + 1)}-${pad2(target.getDate())}`;
  const APPT_MONTH_LABEL = target.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  await page.addInitScript((apptDate) => {
    localStorage.setItem('asha_appointments_v1', JSON.stringify([
      { id: 'legacy1', name: 'Legacy Client', phone: '4165550001', service: 'Consultation', date: apptDate, time: '10:00', address: '', price: '', notes: '', status: 'upcoming' },
    ]));
  }, APPT_DATE);

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await bypassGate(page);
  await page.waitForSelector('.wordmark');

  await page.click('[data-action="goCalendar"]');
  await page.waitForSelector('.calendar-grid');

  const monthLabel = await page.locator('.section-title').first().textContent();
  if (!monthLabel.includes(APPT_MONTH_LABEL)) {
    for (let i = 0; i < 24; i++) {
      const lbl = await page.locator('.section-title').first().textContent();
      if (lbl.includes(APPT_MONTH_LABEL)) break;
      await page.click('[data-action="calendarNextMonth"]');
      await page.waitForTimeout(50);
    }
  }

  const dotCount = await page.locator('.calendar-dot').count();
  assert.strictEqual(dotCount, 1, 'expected exactly 1 day with a booking dot (legacy appt)');

  await page.click(`.calendar-cell[data-value="${APPT_DATE}"]`);
  await page.waitForTimeout(200);
  const dayApptText = await page.locator('.appt-name').first().textContent();
  assert.strictEqual(dayApptText, 'Legacy Client');
  const dayApptService = await page.locator('.appt-service').first().textContent();
  assert.strictEqual(dayApptService, 'Consultation', 'legacy `service` string should still display correctly');

  await page.click('.day-slot--free >> nth=0');
  await page.waitForSelector('#field-name');
  const prefilledDate = await page.locator('#field-date').inputValue();
  assert.strictEqual(prefilledDate, APPT_DATE);

  await page.fill('#field-name', 'Multi Service Client');
  await page.fill('#field-phone', '4165559999');
  await page.click('.payment-chip[data-value="Consultation"]');
  await page.click('.payment-chip[data-value="Standard appointment"]');
  const activeChips = await page.locator('.payment-chip--active').allTextContents();
  assert.deepStrictEqual(activeChips.sort(), ['Consultation', 'Standard appointment'].sort());

  await page.click('[data-action="onSave"]');
  await page.waitForSelector('.toast');

  await page.waitForSelector('.appt-card');
  const homeServiceLabels = await page.locator('.appt-service').allTextContents();
  assert.ok(homeServiceLabels.some(t => t.includes('Consultation + Standard appointment')), 'joined service label not found on Home');

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 05-calendar-multiservice');
  await browser.close();
})().catch(e => { console.error('FAIL: 05-calendar-multiservice —', e.message || e); process.exit(1); });
