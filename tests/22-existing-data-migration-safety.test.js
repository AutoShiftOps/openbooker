// Regression test for the consolidation from two codebases (Asha-only +
// public SaaS) back into one: an existing installer who has real local data
// (appointments, a real business name already set) but has never synced under
// their account yet -- e.g. mandatory sign-in just shipped, or a new device --
// must NOT be shown the onboarding wizard as if they were a blank-slate new
// tenant. Their existing local data should just get pushed up as their
// account's data. This is the exact mechanism protecting Asha's real
// appointments/business profile when this app moved from optional to
// mandatory sign-in.
//
// pullFromCloud() needs a real Firestore call this harness can't provide, so
// `db` is stubbed directly (same spirit as how 13-clients-cloud-reconcile.test.js
// exercises cloud-merge logic without a real backend) to return exists:false --
// exactly what a signed-in account with no cloud doc yet looks like.
const { chromium } = require('playwright');
const assert = require('assert');
const BASE_URL = process.env.BASE_URL || 'http://localhost:8888';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });

  // Real-looking pre-existing local data -- a business name already set and
  // real appointment history, exactly like an existing installer's device.
  await page.addInitScript(() => {
    localStorage.setItem('asha_appointments_v1', JSON.stringify([
      { id: 'a1', name: 'Existing Client', phone: '4165550111', service: 'Consultation', date: '2026-08-01', time: '10:00', address: '', price: '', notes: '', status: 'upcoming' },
    ]));
    localStorage.setItem('asha_business_profile_v1', JSON.stringify({
      name: 'Already Set Up Salon', tagline: '', location: '', accent: '#2563eb', accentSoft: '#0d9488',
      currency: '$', hoursStart: 9, hoursEnd: 17, travelBufferMin: 30, appointmentDurationMin: 60,
      defaultAddress: '', logoDataUrl: '', timezone: 'America/Toronto', onboarded: false, updatedAt: 0
    }));
  });

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof setState === 'function');

  // Sanity check: loadPersisted() picked up the real local data before any of
  // the gate/auth logic runs.
  const preloaded = await page.evaluate(() => ({ name: state.businessProfile.name, apptCount: state.appointments.length }));
  assert.strictEqual(preloaded.name, 'Already Set Up Salon', 'sanity check: local business name should be loaded');
  assert.strictEqual(preloaded.apptCount, 1, 'sanity check: local appointment should be loaded');

  // Sign in (no real Firebase needed for this) and simulate pullFromCloud()
  // discovering there's no cloud doc yet for this account.
  await page.evaluate(() => {
    setState({ cloudReady: true, cloudUser: 'existing-installer@example.com', subscription: { status: 'active' } });
    db = { collection: () => ({ doc: () => ({ get: () => Promise.resolve({ exists: false, data: () => ({}) }) }) }) };
    pullFromCloud('fake-uid-for-existing-installer');
  });
  await page.waitForTimeout(300);

  // Must NOT be sitting on the onboarding wizard -- the real business name and
  // appointment must still be there, unchanged, and the normal app reachable.
  const afterSync = await page.evaluate(() => ({
    awaitingOnboarding: state.awaitingOnboarding,
    name: state.businessProfile.name,
    apptCount: state.appointments.length
  }));
  assert.strictEqual(afterSync.awaitingOnboarding, false, 'should NOT be routed into the onboarding wizard when real local data already exists');
  assert.strictEqual(afterSync.name, 'Already Set Up Salon', 'existing business name must survive the migration path unchanged');
  assert.strictEqual(afterSync.apptCount, 1, 'existing appointment must survive the migration path unchanged');

  assert.strictEqual(await page.locator('[data-action="submitOnboarding"]').count(), 0, 'onboarding screen must not be showing');
  assert.strictEqual(await page.locator('[data-action="goAdd"]').count(), 1, 'normal app should be reachable, not the onboarding gate');
  const wordmark = await page.locator('.wordmark').textContent();
  assert.strictEqual(wordmark, 'Already Set Up Salon', 'header should show the existing business name, not be reset');

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 22-existing-data-migration-safety');
  await browser.close();
})().catch(e => { console.error('FAIL: 22-existing-data-migration-safety —', e.message || e); process.exit(1); });
