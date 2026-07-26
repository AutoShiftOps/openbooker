// Covers: Home's upcoming list, Earnings' completed history, and the client
// directory all capping at PAGE_SIZE (15) rows with a "Show more" button,
// instead of rendering an ever-growing, unbounded list as the business
// accumulates history.
//
// Uses one consistent set of 20 people, each with one upcoming + one
// completed appointment -- deliberately not 20 separate client-directory
// entries plus 40 differently-named appointments, since the client directory
// is rebuilt from appointment history (reconcileClientsFromAppointments), and
// distinctly-named extra appointments would inflate the client count past 20.
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
    const appointments = [];
    for (let i = 0; i < 20; i++) {
      const name = 'Person ' + i;
      const phone = '416555' + String(1000 + i);
      appointments.push({
        id: 'up' + i, name, phone, service: 'Consultation',
        date: '2026-09-' + String(10 + (i % 15)).padStart(2, '0'), time: '10:00',
        address: '', price: '', notes: '', status: 'upcoming'
      });
      appointments.push({
        id: 'done' + i, name, phone, service: 'Consultation',
        date: '2026-01-' + String(1 + (i % 28)).padStart(2, '0'), time: '10:00',
        address: '', price: '50', paymentMethod: 'Cash', notes: '', status: 'done'
      });
    }
    localStorage.setItem('asha_appointments_v1', JSON.stringify(appointments));
  });

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await bypassGate(page);

  // Home: Upcoming list capped at 15, "Show more" reveals the rest.
  await page.waitForSelector('.appt-card--upcoming');
  assert.strictEqual(await page.locator('.appt-card--upcoming').count(), 15, 'expected 15 visible upcoming appointments before Show more');
  assert.strictEqual(await page.locator('[data-action="showMoreUpcoming"]').count(), 1, 'expected a Show more button for Upcoming');
  await page.click('[data-action="showMoreUpcoming"]');
  await page.waitForTimeout(150);
  assert.strictEqual(await page.locator('.appt-card--upcoming').count(), 20, 'expected all 20 upcoming appointments after Show more');
  assert.strictEqual(await page.locator('[data-action="showMoreUpcoming"]').count(), 0, 'Show more button should be gone once everything is visible');

  // Earnings: Completed history capped at 15.
  await page.click('[data-action="goEarnings"]');
  await page.waitForSelector('.appt-card--completed');
  assert.strictEqual(await page.locator('.appt-card--completed').count(), 15, 'expected 15 visible completed jobs before Show more');
  assert.strictEqual(await page.locator('[data-action="showMoreCompleted"]').count(), 1, 'expected a Show more button for completed history');
  await page.click('[data-action="showMoreCompleted"]');
  await page.waitForTimeout(150);
  assert.strictEqual(await page.locator('.appt-card--completed').count(), 20, 'expected all 20 completed jobs after Show more');

  // Client directory (reconciled from the 20 distinct people above) capped at 15.
  await page.click('[data-action="goSearch"]');
  await page.waitForSelector('[data-action="viewClientHistory"]');
  assert.strictEqual(await page.locator('[data-action="viewClientHistory"]').count(), 15, 'expected 15 visible clients before Show more');
  assert.strictEqual(await page.locator('[data-action="showMoreClients"]').count(), 1, 'expected a Show more button for the client directory');
  await page.click('[data-action="showMoreClients"]');
  await page.waitForTimeout(150);
  assert.strictEqual(await page.locator('[data-action="viewClientHistory"]').count(), 20, 'expected all 20 clients after Show more');

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 27-pagination');
  await browser.close();
})().catch(e => { console.error('FAIL: 27-pagination —', e.message || e); process.exit(1); });
