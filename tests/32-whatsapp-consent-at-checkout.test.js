// Covers: the "OK getting offers on WhatsApp" tick in the Confirm-completion
// panel -- it reflects and flips the client's directory `consent` flag (the
// same flag as Clients -> "Promo OK"), starts unticked, persists, and is
// already saved by the time the appointment is marked complete (the WhatsApp
// Cloud Function reads that flag from the synced doc).
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
    if (localStorage.getItem('asha_appointments_v1')) return; // survive reloads
    localStorage.setItem('asha_appointments_v1', JSON.stringify([
      { id: 'a1', name: 'Priya Rao', phone: '(905) 555-0142', service: 'Threading', date: '2099-01-01', time: '10:00', address: '', price: '', paymentMethod: '', notes: '', status: 'upcoming' },
    ]));
  });

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await bypassGate(page);
  await page.evaluate(() => setState({ screen: 'detail', detailId: 'a1' }));
  await page.waitForSelector('[data-action="openComplete"]');
  await page.click('[data-action="openComplete"]');
  await page.waitForSelector('[data-action="toggleCompleteConsent"]');

  const box = page.locator('[data-action="toggleCompleteConsent"] .checkbox-box');
  assert.ok(!(await box.getAttribute('class')).includes('checkbox-box--checked'), 'starts unticked: no consent by default');

  await page.click('[data-action="toggleCompleteConsent"]');
  await page.waitForTimeout(150);
  assert.ok((await box.getAttribute('class')).includes('checkbox-box--checked'), 'ticks on click');
  let clients = await page.evaluate(() => JSON.parse(localStorage.getItem('asha_clients_v1')));
  assert.strictEqual(clients.length, 1);
  assert.strictEqual(clients[0].consent, true, 'consent persisted to the client directory');

  await page.click('[data-action="toggleCompleteConsent"]');
  await page.waitForTimeout(150);
  clients = await page.evaluate(() => JSON.parse(localStorage.getItem('asha_clients_v1')));
  assert.strictEqual(clients[0].consent, false, 'second click turns it back off');

  // Tick, then complete: the flag is in place before the completion is saved.
  await page.click('[data-action="toggleCompleteConsent"]');
  await page.fill('#pending-price', '15');
  await page.click('.payment-chip:has-text("Cash")');
  await page.click('[data-action="confirmComplete"]');
  await page.waitForTimeout(250);
  const state = await page.evaluate(() => ({
    appt: JSON.parse(localStorage.getItem('asha_appointments_v1'))[0],
    client: JSON.parse(localStorage.getItem('asha_clients_v1'))[0]
  }));
  assert.strictEqual(state.appt.status, 'done');
  assert.strictEqual(state.client.consent, true, 'consent still set after completion');

  await browser.close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('PASS 32-whatsapp-consent-at-checkout');
})().catch(e => { console.error(e); process.exit(1); });
