// Covers: the History screen's date-range controls -- preset chips (This
// month / Last month / This year / All time) and the From/To calendar
// inputs. The revenue summary and every collapsible section (Completed
// history, No-shows, Insights) reflect only the chosen range.
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
  const thisMonthDate = `${y}-${pad(m + 1)}-05`;
  const prev = new Date(y, m - 1, 15);
  const prevMonthDate = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-15`;
  const prevFrom = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-01`;
  const prevTo = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-${pad(new Date(prev.getFullYear(), prev.getMonth() + 1, 0).getDate())}`;

  await page.addInitScript((d) => {
    localStorage.setItem('asha_appointments_v1', JSON.stringify([
      { id: 'tm', name: 'This Month', phone: '4165550001', service: 'Facial', date: d.thisMonth, time: '10:00', address: '', price: '100', notes: '', status: 'done' },
      { id: 'lm', name: 'Last Month', phone: '4165550002', service: 'Makeup', date: d.prevMonth, time: '10:00', address: '', price: '250', notes: '', status: 'done' },
    ]));
  }, { thisMonth: thisMonthDate, prevMonth: prevMonthDate });

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await bypassGate(page);
  await page.click('[data-action="goEarnings"]');
  await page.waitForSelector('.period-summary-value');

  const summary = () => page.locator('.period-summary-value').textContent();
  const sub = () => page.locator('.period-summary-sub').textContent();

  // Default range is the current month.
  assert.strictEqual(await summary(), '$100', 'defaults to this month');
  assert.ok((await sub()).includes('1 job'), 'this-month sub shows 1 job');
  assert.ok(await page.locator('.period-chip--active:has-text("This month")').count() > 0, '"This month" chip is active by default');
  assert.strictEqual(await page.locator('.section-toggle:has-text("Completed history")').textContent().then(t => t.replace(/\D/g, '')), '1', 'Completed history count is scoped to the period');

  // Last month
  await page.click('.period-chip:has-text("Last month")');
  await page.waitForTimeout(80);
  assert.strictEqual(await summary(), '$250', 'Last month preset');

  // All time
  await page.click('.period-chip:has-text("All time")');
  await page.waitForTimeout(80);
  assert.strictEqual(await summary(), '$350', 'All time = both jobs');
  assert.ok((await sub()).includes('2 jobs'), 'all-time sub shows 2 jobs');
  await page.click('.section-toggle:has-text("Completed history")');
  await page.waitForSelector('.appt-card--completed');
  assert.strictEqual(await page.locator('.appt-card--completed').count(), 2, 'both completed jobs listed under All time');

  // Custom range via the From/To calendar inputs -> just last month
  await page.fill('input[data-bind="earningsFrom"]', prevFrom);
  await page.fill('input[data-bind="earningsTo"]', prevTo);
  await page.waitForTimeout(120);
  assert.strictEqual(await summary(), '$250', 'custom range covering only last month');
  assert.strictEqual(await page.locator('.appt-card--completed').count(), 1, 'completed list also narrows to the custom range');

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 23-earnings-date-range');
  await browser.close();
})().catch(e => { console.error('FAIL: 23-earnings-date-range —', e.message || e); process.exit(1); });
