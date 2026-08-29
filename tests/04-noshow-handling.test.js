// Covers: an appointment whose time has passed but is still "upcoming" gets
// pulled out of the Today/Upcoming lists into the "Needs attention" list,
// "Next up" correctly skips it in favor of the real next appointment, marking
// it no-show clears it from Needs attention, and it shows up in History's
// No-shows section and in Search results with the right status label.
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
    const past = new Date(Date.now() - 3 * 60 * 60000); // 3 hours ago
    const future = new Date(Date.now() + 7 * 86400000); // a week out -- must stay genuinely future
    // Build both from the same local calendar fields -- mixing toISOString()
    // (UTC date) with toTimeString() (local time) silently breaks whenever the
    // UTC and local dates differ (i.e. for part of every day, depending on
    // timezone), which can push this "3 hours ago" appointment into what the
    // app reads as tomorrow instead of earlier today.
    const pad2 = n => String(n).padStart(2, '0');
    const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const dateStr = ymd(past);
    const timeStr = `${pad2(past.getHours())}:${pad2(past.getMinutes())}`;
    localStorage.setItem('asha_appointments_v1', JSON.stringify([
      { id: 'overdue1', name: 'Zakia', phone: '4165550101', service: 'Facial & skincare', date: dateStr, time: timeStr, address: '', price: '', notes: '', status: 'upcoming' },
      { id: 'future1', name: 'Minnie', phone: '4165550102', service: 'Saree draping', date: ymd(future), time: '16:30', address: '', price: '', notes: '', status: 'upcoming' },
    ]));
  });

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await bypassGate(page);
  await page.waitForSelector('.wordmark');

  const bannerCount = await page.locator('text=/needs an outcome/').count();
  assert.ok(bannerCount > 0, 'follow-up banner missing');

  const nextUpText = await page.locator('.next-up-title').textContent().catch(() => '(none)');
  assert.ok(nextUpText.includes('Minnie'), 'overdue appointment is still being shown as Next Up: ' + nextUpText);

  // The overdue appointment sits in its own "Needs attention" list, not Today/Upcoming.
  const attentionText = await page.locator('.appt-card--attention').textContent();
  assert.ok(attentionText.includes('Zakia'), 'overdue appointment not shown in Needs attention: ' + attentionText);

  await page.click('.appt-card--attention');
  await page.waitForSelector('.detail-name');
  const detailName = await page.locator('.detail-name').textContent();
  assert.ok(detailName.includes('Zakia'), 'Needs attention row did not open the overdue appointment');

  await page.click('[data-action="onNoShow"]');
  await page.waitForSelector('.toast');

  const bannerAfter = await page.locator('text=/needs an outcome/').count();
  assert.strictEqual(bannerAfter, 0, 'follow-up banner still showing after marking no-show');
  const attentionAfter = await page.locator('.appt-card--attention').count();
  assert.strictEqual(attentionAfter, 0, 'Needs attention row still showing after marking no-show');

  await page.click('[data-action="goEarnings"]');
  await page.waitForSelector('.period-summary-value');
  const noShowSectionCount = await page.locator('text=No-shows').count();
  assert.ok(noShowSectionCount > 0, 'No-shows section missing from History');

  // Search is grouped by client (see 26-search-grouped-and-name-collisions.test.js),
  // so this shows Zakia's aggregate no-show count, not a single appointment's status label.
  await page.click('[data-action="goSearch"]');
  await page.fill('#search-input', 'zakia');
  await page.waitForSelector('.appt-card');
  const rowText = await page.locator('.appt-card').first().textContent();
  assert.ok(/1 no-show/.test(rowText), 'search result should show the no-show on Zakia\'s aggregate row: ' + rowText);

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 04-noshow-handling');
  await browser.close();
})().catch(e => { console.error('FAIL: 04-noshow-handling —', e.message || e); process.exit(1); });
