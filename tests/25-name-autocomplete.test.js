// Covers: typing a client's name on the Add screen shows matching existing
// clients below the field (name + phone), and tapping one autofills their
// phone/address -- so a returning client's details don't need to be
// remembered/retyped. Suggestions only show while the phone field is still
// blank, and stop once a match is picked (phone gets filled).
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
    localStorage.setItem('asha_clients_v1', JSON.stringify([
      { id: 'c1', name: 'Priya Sharma', phone: '416-555-0199', address: '123 Maple St', consent: false, updatedAt: 0 },
    ]));
  });

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await bypassGate(page);
  await page.click('[data-action="goAdd"]');
  await page.waitForSelector('#field-name');

  // One character isn't enough to show suggestions (avoids a huge list flash).
  await page.locator('#field-name').pressSequentially('P', { delay: 15 });
  await page.waitForTimeout(150);
  assert.strictEqual(await page.locator('[data-action="pickNameMatch"]').count(), 0, 'should not suggest on a single character');

  await page.locator('#field-name').pressSequentially('ri', { delay: 15 });
  await page.waitForTimeout(150);
  assert.strictEqual(await page.locator('[data-action="pickNameMatch"]').count(), 1, 'expected exactly one matching suggestion for "Pri"');
  const suggestionText = await page.locator('[data-action="pickNameMatch"]').textContent();
  assert.ok(suggestionText.includes('Priya Sharma') && suggestionText.includes('416-555-0199'), 'suggestion should show name and phone: ' + suggestionText);

  await page.click('[data-action="pickNameMatch"]');
  await page.waitForTimeout(150);
  assert.strictEqual(await page.locator('#field-phone').inputValue(), '416-555-0199', 'picking a suggestion should fill in the phone');
  assert.strictEqual(await page.locator('#field-address').inputValue(), '123 Maple St', 'picking a suggestion should fill in the address');
  assert.strictEqual(await page.locator('[data-action="pickNameMatch"]').count(), 0, 'suggestions should disappear once the phone is filled');

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 25-name-autocomplete');
  await browser.close();
})().catch(e => { console.error('FAIL: 25-name-autocomplete —', e.message || e); process.exit(1); });
