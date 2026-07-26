// Covers two related fixes: (1) searching by name used to show one row per
// APPOINTMENT, so a client with several bookings appeared duplicated --
// fixed to group by client, same as the "All clients" browse list. (2) two
// clients sharing a name looked identical in the "recent clients" quick-pick
// chips -- fixed to always show the phone number alongside the name there.
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
    localStorage.setItem('asha_appointments_v1', JSON.stringify([
      { id: 'a1', name: 'Priya Sharma', phone: '416-555-0199', service: 'Consultation', date: '2026-06-01', time: '10:00', address: '', price: '100', paymentMethod: 'Cash', notes: '', status: 'done' },
      { id: 'a2', name: 'Priya Sharma', phone: '416-555-0199', service: 'Standard appointment', date: '2026-07-01', time: '10:00', address: '', price: '80', paymentMethod: 'Cash', notes: '', status: 'done' },
      { id: 'a3', name: 'Priya Sharma', phone: '416-555-0199', service: 'Consultation', date: '2026-08-01', time: '10:00', address: '', price: '', notes: '', status: 'upcoming' },
      // A second, different "Priya" -- the name-collision case.
      { id: 'a4', name: 'Priya Patel', phone: '647-555-0111', service: 'Standard appointment', date: '2026-08-05', time: '11:00', address: '', price: '', notes: '', status: 'upcoming' },
    ]));
  });

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await bypassGate(page);

  // 1. Search groups by client, not by appointment.
  await page.click('[data-action="goSearch"]');
  await page.fill('#search-input', 'priya sharma');
  await page.waitForTimeout(300);
  const resultRows = await page.locator('.appt-card').count();
  assert.strictEqual(resultRows, 1, 'Priya Sharma has 3 appointments but should appear as exactly 1 grouped search result, got ' + resultRows);
  const rowText = await page.locator('.appt-card').first().textContent();
  assert.ok(rowText.includes('3 visits') || rowText.includes('3 visit'), 'expected the grouped row to show a visit count of 3: ' + rowText);
  assert.ok(rowText.includes('416-555-0199'), 'expected the grouped row to show the phone number: ' + rowText);

  // A broader query matching both Priyas should show 2 grouped rows (not 4 appointments).
  await page.fill('#search-input', 'priya');
  await page.waitForTimeout(300);
  assert.strictEqual(await page.locator('.appt-card').count(), 2, 'expected 2 grouped client results for "priya" (Sharma + Patel)');

  // 2. Recent-clients chips disambiguate by phone.
  await page.click('[data-action="goAdd"]');
  await page.waitForSelector('.payment-chip[data-action="pickRecentClient"]');
  const chipLabels = await page.locator('.payment-chip[data-action="pickRecentClient"]').allTextContents();
  const sharmaChip = chipLabels.find(t => t.includes('416-555-0199'));
  const patelChip = chipLabels.find(t => t.includes('647-555-0111'));
  assert.ok(sharmaChip && sharmaChip.includes('Priya Sharma'), 'expected a chip showing "Priya Sharma (416-555-0199)", got: ' + JSON.stringify(chipLabels));
  assert.ok(patelChip && patelChip.includes('Priya Patel'), 'expected a chip showing "Priya Patel (647-555-0111)", got: ' + JSON.stringify(chipLabels));

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 26-search-grouped-and-name-collisions');
  await browser.close();
})().catch(e => { console.error('FAIL: 26-search-grouped-and-name-collisions —', e.message || e); process.exit(1); });
