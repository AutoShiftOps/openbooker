// Covers: the History screen's monthly revenue -- Asha couldn't see how much
// she made in a given month (only "This week" and "All-time" existed).
// Confirms the "This month" stat card reflects the current calendar month,
// and the "Revenue by month" picker lists every month with completed work
// (newest first, any year) and shows the chosen month's total + job count.
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

  const thisMonth = new Date(y, m, 1);       // 1st of current month -- on/before today
  const prevMonth = new Date(y, m - 1, 15);  // last month
  const oldMonth = new Date(y, m - 18, 10);  // ~1.5 years ago -- a prior calendar year

  const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const ymd = d => `${key(d)}-${pad(d.getDate())}`;
  const label = d => new Date(d.getFullYear(), d.getMonth(), 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  await page.addInitScript((dates) => {
    localStorage.setItem('asha_appointments_v1', JSON.stringify([
      { id: 'tm1', name: 'A', phone: '4165550001', service: 'Facial', date: dates.thisMonth, time: '10:00', address: '', price: '120', notes: '', status: 'done' },
      { id: 'pm1', name: 'B', phone: '4165550002', service: 'Makeup', date: dates.prevMonth, time: '10:00', address: '', price: '200', notes: '', status: 'done' },
      { id: 'pm2', name: 'C', phone: '4165550003', service: 'Threading', date: dates.prevMonth, time: '12:00', address: '', price: '80', notes: '', status: 'done' },
      { id: 'om1', name: 'D', phone: '4165550004', service: 'Bridal', date: dates.oldMonth, time: '09:00', address: '', price: '500', notes: '', status: 'done' },
    ]));
  }, { thisMonth: ymd(thisMonth), prevMonth: ymd(prevMonth), oldMonth: ymd(oldMonth) });

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await bypassGate(page);
  await page.click('[data-action="goEarnings"]');
  await page.waitForSelector('.stat-value');

  // "This month" stat card
  const labels = await page.locator('.stat-label').allTextContents();
  const values = await page.locator('.stat-value').allTextContents();
  assert.strictEqual(values[labels.indexOf('This month')], '$120', 'This month card should only count the current-month job');
  assert.strictEqual(values[labels.indexOf('All-time revenue')], '$900', 'all-time should be 120+200+80+500');

  // Revenue-by-month picker: one option per month with work, newest first
  const sel = page.locator('select[data-bind="revenueMonth"]');
  const optValues = await sel.locator('option').evaluateAll(os => os.map(o => o.value));
  const optTexts = await sel.locator('option').allTextContents();
  assert.deepStrictEqual(optValues, [key(thisMonth), key(prevMonth), key(oldMonth)], 'months listed newest first');
  assert.ok(optTexts[0].includes(label(thisMonth)) && optTexts[0].includes('$120'));
  assert.ok(optTexts[1].includes('$280'), 'last month option should show summed revenue 200+80');
  assert.ok(optTexts[2].includes(label(oldMonth)) && optTexts[2].includes('$500'), 'older-year month is listed: ' + optTexts[2]);

  // Default selection = most recent month
  let summary = await page.locator('select[data-bind="revenueMonth"] + .list-row').textContent();
  assert.ok(summary.includes(label(thisMonth)) && summary.includes('$120') && summary.includes('1 job'), 'default summary: ' + summary);

  // Pick the older-year month -> summary updates
  await sel.selectOption(key(oldMonth));
  await page.waitForTimeout(100);
  summary = await page.locator('select[data-bind="revenueMonth"] + .list-row').textContent();
  assert.ok(summary.includes(label(oldMonth)) && summary.includes('$500') && summary.includes('1 job'), 'picked-month summary: ' + summary);

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 29-monthly-revenue');
  await browser.close();
})().catch(e => { console.error('FAIL: 29-monthly-revenue —', e.message || e); process.exit(1); });
