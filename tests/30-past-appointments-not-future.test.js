// Covers: a booking whose date is in the past but was never closed out
// (client no-showed, or Asha forgot to mark it done) must NOT keep showing in
// "Upcoming" as if it were a future appointment. It should instead be caught
// by the "needs an outcome" reminder banner -- including date-only bookings
// with no time entered, which the old isOverdue check silently ignored.
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
    const pad2 = n => String(n).padStart(2, '0');
    const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const daysOut = n => ymd(new Date(Date.now() + n * 86400000));
    localStorage.setItem('asha_appointments_v1', JSON.stringify([
      // past, with a time
      { id: 'past-timed', name: 'Rekha', phone: '4165550201', service: 'Facial', date: daysOut(-10), time: '14:00', address: '', price: '', notes: '', status: 'upcoming' },
      // past, no time ever entered -- the case the old check missed
      { id: 'past-untimed', name: 'Sana', phone: '4165550202', service: 'Threading', date: daysOut(-4), time: '', address: '', price: '', notes: '', status: 'upcoming' },
      // genuinely future
      { id: 'future', name: 'Priya', phone: '4165550203', service: 'Bridal makeup', date: daysOut(9), time: '11:00', address: '', price: '', notes: '', status: 'upcoming' },
    ]));
  });

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await bypassGate(page);
  await page.waitForSelector('.wordmark');

  // Upcoming list shows ONLY the future booking
  const upcomingText = (await page.locator('.appt-card--upcoming').allTextContents()).join(' | ');
  assert.ok(/Priya/.test(upcomingText), 'the genuinely-future booking should be in Upcoming: ' + upcomingText);
  assert.ok(!/Rekha/.test(upcomingText), 'a past timed booking must not show in Upcoming: ' + upcomingText);
  assert.ok(!/Sana/.test(upcomingText), 'a past untimed booking must not show in Upcoming: ' + upcomingText);

  // "Next up" is the future booking, not either past one
  const nextUp = await page.locator('.next-up-title').textContent().catch(() => '(none)');
  assert.ok(nextUp.includes('Priya'), 'Next up should be the future booking: ' + nextUp);

  // Both past bookings are surfaced in the "Needs attention" list
  const attention = await page.locator('.appt-card--attention').allTextContents();
  assert.strictEqual(attention.length, 2, 'both stale past bookings should be listed under Needs attention');
  assert.ok(attention.join(' | ').includes('Rekha'), 'past timed booking missing from Needs attention');
  assert.ok(attention.join(' | ').includes('Sana'), 'past untimed booking missing from Needs attention');

  const bannerText = await page.locator('.banner-warning', { hasText: /an outcome/ }).textContent();
  assert.ok(/2 past appointments/.test(bannerText), 'banner should count both stale past bookings: ' + bannerText);

  // The header count reflects only genuinely-scheduled bookings, not the stale past ones
  const headerSub = await page.locator('.header-subtitle').textContent();
  assert.strictEqual(headerSub.trim(), '1 upcoming booking', 'header should not count stale past bookings: ' + headerSub);

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 30-past-appointments-not-future');
  await browser.close();
})().catch(e => { console.error('FAIL: 30-past-appointments-not-future —', e.message || e); process.exit(1); });
