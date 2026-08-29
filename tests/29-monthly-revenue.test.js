// Covers: Asha's original need -- seeing revenue for a specific month, incl.
// months in a prior year. The History screen's From/To calendar inputs take
// any range with no 6-month limit; the summary shows that window's total,
// job count and average, and names the period ("February 2025" for a whole
// calendar month).
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
  const m = today.getMonth();

  const thisMonth = new Date(y, m, 4);
  const oldMonth = new Date(y, m - 18, 10); // ~1.5 years back -- a prior calendar year
  const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const ymd = d => `${key(d)}-${pad(d.getDate())}`;
  const monthLabel = d => new Date(d.getFullYear(), d.getMonth(), 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const bounds = d => ({
    from: `${key(d)}-01`,
    to: `${key(d)}-${pad(new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())}`
  });

  await page.addInitScript((data) => {
    localStorage.setItem('asha_appointments_v1', JSON.stringify([
      { id: 't1', name: 'A', phone: '4165550001', service: 'Facial', date: data.thisMonth, time: '10:00', address: '', price: '120', notes: '', status: 'done' },
      { id: 'o1', name: 'B', phone: '4165550002', service: 'Bridal', date: data.oldMonth, time: '09:00', address: '', price: '300', notes: '', status: 'done' },
      { id: 'o2', name: 'C', phone: '4165550003', service: 'Makeup', date: data.oldMonth, time: '13:00', address: '', price: '500', notes: '', status: 'done' },
    ]));
  }, { thisMonth: ymd(thisMonth), oldMonth: ymd(oldMonth) });

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await bypassGate(page);
  await page.click('[data-action="goEarnings"]');
  await page.waitForSelector('.period-summary-value');

  // Defaults to the current month.
  assert.strictEqual(await page.locator('.period-summary-value').textContent(), '$120');

  // Jump to a month in a previous year via the calendar inputs.
  const ob = bounds(oldMonth);
  await page.fill('input[data-bind="earningsFrom"]', ob.from);
  await page.fill('input[data-bind="earningsTo"]', ob.to);
  await page.waitForTimeout(120);

  assert.strictEqual(await page.locator('.period-summary-value').textContent(), '$800', 'old month total = 300 + 500');
  const label = await page.locator('.period-summary-label').textContent();
  assert.strictEqual(label.trim(), monthLabel(oldMonth), 'a whole calendar month is named, e.g. "February 2025"');
  const sub = await page.locator('.period-summary-sub').textContent();
  assert.ok(/2 jobs/.test(sub) && /\$400 avg/.test(sub), 'sub shows job count and average: ' + sub);

  // The completed-history section is scoped to that same month.
  await page.click('.section-toggle:has-text("Completed history")');
  await page.waitForSelector('.appt-card--completed');
  assert.strictEqual(await page.locator('.appt-card--completed').count(), 2, 'only the old month\'s jobs are listed');

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 29-monthly-revenue');
  await browser.close();
})().catch(e => { console.error('FAIL: 29-monthly-revenue —', e.message || e); process.exit(1); });
