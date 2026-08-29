// Covers: the Earnings/History screen's monthly revenue -- Asha couldn't see
// how much she made in a given month (only "This week" and "All-time"
// existed). Confirms the new "This month" stat card reflects the current
// calendar month, and the "Revenue by month" breakdown lists each month with
// completed work, newest first, with the right totals and job counts.
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
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth(); // 0-indexed

  // First of the current month -- always on/before today, so it counts as
  // "this month" regardless of what day the test runs.
  const thisMonthDate = `${y}-${pad(m + 1)}-01`;
  const prev = new Date(y, m - 1, 15); // 15th of last month (handles year rollover)
  const prevMonthDate = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-15`;

  const monthLabel = d => new Date(d.getFullYear(), d.getMonth(), 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const thisMonthLabel = monthLabel(new Date(y, m, 1));
  const prevMonthLabel = monthLabel(prev);

  await page.addInitScript((dates) => {
    localStorage.setItem('asha_appointments_v1', JSON.stringify([
      { id: 'tm1', name: 'This Month Client', phone: '4165550001', service: 'Facial', date: dates.thisMonth, time: '10:00', address: '', price: '120', notes: '', status: 'done' },
      { id: 'pm1', name: 'Last Month A', phone: '4165550002', service: 'Makeup', date: dates.prevMonth, time: '10:00', address: '', price: '200', notes: '', status: 'done' },
      { id: 'pm2', name: 'Last Month B', phone: '4165550003', service: 'Threading', date: dates.prevMonth, time: '12:00', address: '', price: '80', notes: '', status: 'done' },
    ]));
  }, { thisMonth: thisMonthDate, prevMonth: prevMonthDate });

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await bypassGate(page);
  await page.click('[data-action="goEarnings"]');
  await page.waitForSelector('.stat-value');

  // "This month" stat card
  const labels = await page.locator('.stat-label').allTextContents();
  const values = await page.locator('.stat-value').allTextContents();
  assert.ok(labels.includes('This month'), 'expected a "This month" stat card');
  assert.strictEqual(values[labels.indexOf('This month')], '$120', 'this month should only include the current-month completed job');
  assert.strictEqual(values[labels.indexOf('All-time revenue')], '$400', 'all-time should still be 120+200+80');

  // "Revenue by month" breakdown, newest first
  const section = page.locator('.section-title:has-text("Revenue by month") + .list-col');
  await section.waitFor();
  const rowLabels = await section.locator('.list-row-label').allTextContents();
  const rowValues = await section.locator('.list-row-value').allTextContents();
  const rowSubs = await section.locator('.list-row-sub').allTextContents();

  assert.strictEqual(rowLabels.length, 2, 'expected exactly two months with completed work');
  assert.strictEqual(rowLabels[0], thisMonthLabel, 'newest month should be listed first');
  assert.strictEqual(rowValues[0], '$120');
  assert.strictEqual(rowSubs[0], '1 job');
  assert.strictEqual(rowLabels[1], prevMonthLabel);
  assert.strictEqual(rowValues[1], '$280', 'last month should sum both of its jobs (200+80)');
  assert.strictEqual(rowSubs[1], '2 jobs');

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 29-monthly-revenue');
  await browser.close();
})().catch(e => { console.error('FAIL: 29-monthly-revenue —', e.message || e); process.exit(1); });
