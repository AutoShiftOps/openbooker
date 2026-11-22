// Covers: completing a visit opens a prefilled WhatsApp thank-you (wa.me link
// with country code, client's first name, business name) and records when it
// was opened; the offers question is added only for a client who was never
// asked; recording "yes"/"no" on the booking updates the client directory's
// consent flag (and the Clients screen checkbox/copy button); the Settings
// switch turns the thank-you off; settings and consent survive a reload; a
// client with no phone number gets a clear message instead of a broken link.
// window.open is stubbed so no real WhatsApp window is opened.
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
  const pad = n => (n < 10 ? '0' + n : '' + n);
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  await page.addInitScript((d) => {
    window.__opened = [];
    window.open = (url) => { window.__opened.push(url); return {}; };
    if (!localStorage.getItem('asha_appointments_v1')) {
      localStorage.setItem('asha_appointments_v1', JSON.stringify([
        { id: 'a1', name: 'Priya Sharma', phone: '416-555-0199', services: ['Facial'], date: d, time: '10:00', address: '', price: '', notes: '', status: 'upcoming' },
        { id: 'a2', name: 'Meena Rao', phone: '+44 7700 900123', services: ['Facial'], date: d, time: '12:00', address: '', price: '', notes: '', status: 'upcoming' },
        { id: 'a3', name: 'No Phone', phone: '', services: ['Facial'], date: d, time: '14:00', address: '', price: '', notes: '', status: 'upcoming' },
      ]));
    }
  }, todayStr);

  async function complete(apptId, price) {
    await page.evaluate((id) => Actions.openAppt(id), apptId);
    await page.click('[data-action="openComplete"]');
    await page.fill('#pending-price', price);
    await page.click('[data-action="selectPayment"][data-value="Cash"]');
    await page.click('[data-action="confirmComplete"]');
    await page.waitForSelector('.toast');
    return (await page.locator('.toast').textContent()).trim();
  }

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await bypassGate(page);

  // Pure message helpers
  const msg = await page.evaluate(() => fillMessage('Hi {name}, thanks from {business} for your {service}.{review}', { name: 'Priya Sharma', services: ['Facial'] }, { name: 'Glow Studio', reviewUrl: '' }));
  assert.strictEqual(msg, 'Hi Priya, thanks from Glow Studio for your facial.');
  assert.strictEqual(await page.evaluate(() => waNumber('(416) 555-0199')), '14165550199', '10-digit numbers get the +1 country code');
  assert.strictEqual(await page.evaluate(() => waNumber('+44 7700 900123')), '447700900123', 'numbers with a country code are left alone');

  // 1) Completing a visit opens the thank-you, with the offers question (never asked yet)
  let toast = await complete('a1', '80');
  assert.ok(toast.includes('thank-you'), 'toast should say the thank-you is ready: ' + toast);
  let opened = await page.evaluate(() => window.__opened.slice());
  assert.strictEqual(opened.length, 1, 'exactly one WhatsApp window should open');
  assert.ok(opened[0].startsWith('https://wa.me/14165550199?text='), 'wa.me link with country code: ' + opened[0]);
  let text = decodeURIComponent(opened[0].split('?text=')[1]);
  assert.ok(text.startsWith('Hi Priya,'), 'uses first name: ' + text);
  assert.ok(text.includes('Test Business'), 'uses the business name: ' + text);
  assert.ok(text.includes('P.S.'), 'adds the offers question for a never-asked client');
  await page.waitForSelector('#thanks-card');
  assert.ok((await page.locator('#thanks-card').textContent()).includes('Opened in WhatsApp'));
  assert.ok((await page.locator('#consent-card').textContent()).includes('Asked'), 'client is now marked as asked');
  const appt = await page.evaluate(() => state.appointments.find(a => a.id === 'a1'));
  assert.strictEqual(appt.status, 'done');
  assert.ok(appt.thanksSentAt > 0, 'thanksSentAt recorded');

  // 2) Recording her answer on the booking updates the client directory
  await page.click('#consent-card [data-action="consentYes"]');
  await page.waitForTimeout(200);
  assert.ok((await page.locator('#consent-card').textContent()).includes('OK to send offers'));
  const priya = await page.evaluate(() => state.clients.find(c => c.phone === '416-555-0199'));
  assert.strictEqual(priya.consent, true);
  assert.ok(priya.consentAnsweredAt > 0);

  // 3) "Send again" no longer asks the offers question (she already answered)
  await page.click('[data-action="sendThanks"]');
  opened = await page.evaluate(() => window.__opened.slice());
  assert.strictEqual(opened.length, 2);
  assert.ok(!decodeURIComponent(opened[1]).includes('P.S.'), 'no offers question once answered');

  // 4) Clients screen reflects the yes
  await page.click('[data-action="goSearch"]');
  await page.waitForSelector('[data-action="copyConsentList"]');
  assert.ok((await page.locator('[data-action="copyConsentList"]').textContent()).includes('Copy 1 opted-in number'));

  // 5) Client with no phone: clear message, no window
  toast = await complete('a3', '50');
  assert.ok(toast.includes('no phone number'), toast);
  assert.strictEqual(await page.evaluate(() => window.__opened.length), 2);

  // 6) Turning the thank-you off in Settings
  await page.click('[data-action="goSettings"]');
  await page.waitForSelector('#thanks-preview');
  assert.ok((await page.locator('#thanks-preview').textContent()).includes('Hi Priya'), 'preview renders');
  await page.click('[data-action="toggleThanksEnabled"]');
  await page.waitForTimeout(200);
  toast = await complete('a2', '60');
  assert.strictEqual(toast, 'Marked as completed');
  assert.strictEqual(await page.evaluate(() => window.__opened.length), 2, 'no WhatsApp window when switched off');

  // 7) Settings and consent survive a reload
  await page.reload({ waitUntil: 'load' });
  await bypassGate(page);
  assert.strictEqual(await page.evaluate(() => state.businessProfile.thanksEnabled), false);
  assert.strictEqual(await page.evaluate(() => state.clients.find(c => c.phone === '416-555-0199').consent), true);

  const realErrors = errors.filter(e => !/Failed to load resource/.test(e));
  if (realErrors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(realErrors));
  console.log('PASS: 32-whatsapp-thanks-and-offers-consent');
  await browser.close();
})().catch(e => { console.error('FAIL: 32-whatsapp-thanks-and-offers-consent —', e.message); process.exit(1); });
