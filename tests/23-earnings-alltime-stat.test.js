// Covers: the Earnings screen's stat row -- "This week" only reflects the
// last 7 days, but the "Completed jobs" count (and the list below it) is
// all-time. Without an "All-time revenue" stat next to it, the $ figure at
// the top didn't match the scope of the list underneath it. Confirms both
// numbers are correct and distinct.
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

  const today = new Date();
  const recentDate = new Date(today.getTime() - 2 * 86400000); // 2 days ago -- within this week
  const oldDate = new Date(today.getTime() - 30 * 86400000); // 30 days ago -- outside this week
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  await page.addInitScript((dates) => {
    localStorage.setItem('asha_appointments_v1', JSON.stringify([
      { id: 'recent1', name: 'Recent Client', phone: '4165550001', service: 'Consultation', date: dates.recent, time: '10:00', address: '', price: '100', notes: '', status: 'done' },
      { id: 'old1', name: 'Old Client', phone: '4165550002', service: 'Consultation', date: dates.old, time: '10:00', address: '', price: '250', notes: '', status: 'done' },
    ]));
  }, { recent: fmt(recentDate), old: fmt(oldDate) });

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await bypassGate(page);
  await page.click('[data-action="goEarnings"]');
  await page.waitForSelector('.stat-value');

  const labels = await page.locator('.stat-label').allTextContents();
  assert.ok(labels.includes('This week'), 'expected a "This week" stat');
  assert.ok(labels.includes('All-time revenue'), 'expected an "All-time revenue" stat');
  assert.ok(labels.includes('Completed jobs'), 'expected a "Completed jobs" stat');

  const values = await page.locator('.stat-value').allTextContents();
  const weekIdx = labels.indexOf('This week');
  const allTimeIdx = labels.indexOf('All-time revenue');
  const jobsIdx = labels.indexOf('Completed jobs');

  assert.strictEqual(values[weekIdx], '$100', 'this week should only include the recent completed job');
  assert.strictEqual(values[allTimeIdx], '$350', 'all-time revenue should include both completed jobs (100+250)');
  assert.strictEqual(values[jobsIdx], '2', 'completed jobs count should be all-time (2), matching the all-time total');

  const completedRows = await page.locator('.appt-card--completed').count();
  assert.strictEqual(completedRows, 2, 'completed history list should show both jobs, matching the all-time stat');

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 23-earnings-alltime-stat');
  await browser.close();
})().catch(e => { console.error('FAIL: 23-earnings-alltime-stat —', e.message || e); process.exit(1); });
