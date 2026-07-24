// Covers: new bookings default to the home-base address (this is a home-based
// business), and the field stays freely editable for the times she travels to
// a client's location instead.
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

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await bypassGate(page);
  await page.click('[data-action="goAdd"]');
  await page.waitForSelector('#field-address');
  const addressVal = await page.locator('#field-address').inputValue();
  assert.strictEqual(addressVal, '123 Test St, Testville, ON A1A 1A1');

  await page.fill('#field-address', "Client's house, 22 Elm St");
  const overridden = await page.locator('#field-address').inputValue();
  assert.strictEqual(overridden, "Client's house, 22 Elm St");

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 10-default-address');
  await browser.close();
})().catch(e => { console.error('FAIL: 10-default-address —', e.message || e); process.exit(1); });
