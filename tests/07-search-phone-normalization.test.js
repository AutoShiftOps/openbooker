// Regression test for a real bug: phone search did an exact-substring match,
// so a number saved as "416-555-0199" would not match a search for
// "4165550199" (no dashes) or any other formatting difference. Fixed by
// comparing digits-only on both sides whenever the query contains digits.
const { chromium } = require('playwright');
const assert = require('assert');
const BASE_URL = process.env.BASE_URL || 'http://localhost:8888';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });

  await page.addInitScript(() => {
    localStorage.setItem('asha_appointments_v1', JSON.stringify([
      { id: 'a1', name: 'Priya Sharma', phone: '416-555-0199', service: 'Bridal makeup', date: '2026-09-25', time: '11:00', address: '', price: '', notes: '', status: 'upcoming' },
    ]));
  });

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await page.click('[data-action="goSearch"]');
  await page.waitForSelector('#search-input');

  async function search(query) {
    await page.fill('#search-input', '');
    await page.waitForTimeout(100);
    await page.locator('#search-input').pressSequentially(query, { delay: 15 });
    await page.waitForTimeout(300);
    return page.locator('.appt-card').count();
  }

  assert.strictEqual(await search('priya'), 1, 'name search should still work');
  assert.strictEqual(await search('4165550199'), 1, 'digits-only phone search did not match a dash-formatted saved number');
  assert.strictEqual(await search('5550199'), 1, 'partial digit match should still work');
  assert.strictEqual(await search('416-555-0199'), 1, 'exact formatted match should still work');
  assert.strictEqual(await search('9999999999'), 0, 'non-matching digits should not spuriously match');

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 07-search-phone-normalization');
  await browser.close();
})().catch(e => { console.error('FAIL: 07-search-phone-normalization —', e.message || e); process.exit(1); });
