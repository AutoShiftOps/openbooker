// Regression test for a real production bug: the client directory only got
// built once, from whatever appointments happened to be in local storage at
// that exact boot moment -- before a fuller cloud-synced history necessarily
// finished pulling in. If only one appointment was locally cached at that
// instant, only one client ever showed up, permanently, even after the rest
// of the appointment history arrived seconds later via cloud sync. Fixed by
// reconciling the client list against the full appointment set every load,
// and again after every cloud merge, instead of a one-time backfill.
//
// This test simulates exactly that: local storage starts with only ONE
// appointment (so the boot-time reconciliation only "sees" one client), then
// a signed-in Firebase pull is faked to bring in several more appointments +
// no client records at all (a plausible real case: appointments existed
// before the client-directory feature shipped). The bug would leave the
// directory stuck at 1 client after the "sync"; the fix should show all of
// them.
const { chromium } = require('playwright');
const assert = require('assert');
const BASE_URL = process.env.BASE_URL || 'http://localhost:8888';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });

  // Only ONE appointment locally cached at boot -- mirrors a device that
  // hasn't pulled the full cloud history down yet.
  await page.addInitScript(() => {
    localStorage.setItem('asha_appointments_v1', JSON.stringify([
      { id: 'local1', name: 'Ali Shahzad', phone: '2896861986', service: 'Bridal makeup', date: '2026-08-14', time: '10:00', address: '', price: '', notes: '', status: 'done' },
    ]));
  });

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('.wordmark');

  await page.click('[data-action="goSearch"]');
  await page.waitForSelector('[data-action="viewClientHistory"]');
  const beforeSync = await page.locator('[data-action="viewClientHistory"]').count();
  assert.strictEqual(beforeSync, 1, 'sanity check: should start with just the one locally-cached client');

  // Simulate what pullFromCloud() does when a fuller history arrives from
  // Firestore, WITHOUT needing a real signed-in Firebase session: call the
  // same reconciliation path directly with a bigger appointment set and no
  // pre-existing client records (as if the client-directory feature postdates
  // most of the appointment history).
  await page.evaluate(() => {
    const fuller = [
      { id: 'local1', name: 'Ali Shahzad', phone: '2896861986', service: 'Bridal makeup', date: '2026-08-14', time: '10:00', address: '', price: '', notes: '', status: 'done' },
      { id: 'cloud2', name: 'Priya Sharma', phone: '4165550199', service: 'Hairstyling', date: '2026-08-10', time: '11:00', address: '', price: '80', paymentMethod: 'Cash', notes: '', status: 'done' },
      { id: 'cloud3', name: 'Jane Doe', phone: '4165550200', service: 'Facial & skincare', date: '2026-08-12', time: '14:00', address: '', price: '', notes: '', status: 'upcoming' },
    ];
    const mergedClients = mergeById(state.clients, []); // no client records came from "the cloud" in this scenario
    state.clients = reconcileClientsFromAppointments(mergedClients, fuller);
    state.appointments = fuller;
    render();
  });
  await page.waitForTimeout(200);

  await page.click('[data-action="goHome"]');
  await page.click('[data-action="goSearch"]');
  await page.fill('#search-input', '');
  await page.waitForSelector('[data-action="viewClientHistory"]');
  const afterSync = await page.locator('[data-action="viewClientHistory"]').count();
  assert.strictEqual(afterSync, 3, `expected all 3 clients after the fuller history arrives, got ${afterSync}`);

  const names = await page.locator('.appt-name').allTextContents();
  assert.ok(names.includes('Ali Shahzad') && names.includes('Priya Sharma') && names.includes('Jane Doe'),
    'expected all three client names present: ' + JSON.stringify(names));

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 13-clients-cloud-reconcile');
  await browser.close();
})().catch(e => { console.error('FAIL: 13-clients-cloud-reconcile —', e.message || e); process.exit(1); });
