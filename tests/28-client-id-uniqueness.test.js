// Regression test for a real bug: client records were id'd via `'c_' +
// Date.now()`, and reconcileClientsFromAppointments() creates client records
// in a tight synchronous loop -- two clients reconciled from the same batch
// of appointments could land in the same millisecond and get an IDENTICAL
// id. Any id-based lookup (view history, toggle consent, merge) could then
// silently act on the wrong client. Seeds several distinct clients at once
// (the exact scenario that triggers it) and confirms each one is looked up
// correctly, not confused with another.
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
    // All reconciled in the same synchronous pass at boot -- exactly the
    // condition that used to produce duplicate `c_<timestamp>` ids.
    localStorage.setItem('asha_appointments_v1', JSON.stringify([
      { id: 'a1', name: 'Alice One', phone: '4165550001', service: 'Consultation', date: '2026-06-01', time: '10:00', address: '', price: '', notes: '', status: 'upcoming' },
      { id: 'a2', name: 'Bob Two', phone: '4165550002', service: 'Consultation', date: '2026-06-02', time: '10:00', address: '', price: '', notes: '', status: 'upcoming' },
      { id: 'a3', name: 'Carol Three', phone: '4165550003', service: 'Consultation', date: '2026-06-03', time: '10:00', address: '', price: '', notes: '', status: 'upcoming' },
    ]));
  });

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await bypassGate(page);

  const ids = await page.evaluate(() => state.clients.map(c => c.id));
  assert.strictEqual(new Set(ids).size, ids.length, 'every reconciled client should have a unique id, got: ' + JSON.stringify(ids));

  // Looking up each one by id resolves to the right person, not a colliding neighbor.
  await page.click('[data-action="goSearch"]');
  await page.fill('#search-input', '');
  await page.waitForSelector('[data-action="viewClientHistory"]');
  const bobId = await page.evaluate(() => state.clients.find(c => c.name === 'Bob Two').id);
  await page.click(`[data-action="viewClientHistory"][data-id="${bobId}"]`);
  await page.waitForSelector('.section-title');
  const title = await page.locator('.section-title').first().textContent();
  assert.strictEqual(title, 'Bob Two', 'looking up Bob by his id should show Bob, not a colliding neighbor');

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 28-client-id-uniqueness');
  await browser.close();
})().catch(e => { console.error('FAIL: 28-client-id-uniqueness —', e.message || e); process.exit(1); });
