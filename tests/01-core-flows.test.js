// Covers: full-bleed layout on a phone-sized viewport, correct mobile keyboard
// types (tel/inputmode) on the phone field, the day-availability panel on the
// Add screen (slot count, tap-to-fill, reflects a just-created booking as
// booked), the History nav rename, and CAD currency formatting.
const { chromium } = require('playwright');
const BASE_URL = process.env.BASE_URL || 'http://localhost:8888';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('.wordmark');

  // 1. Full-bleed on a phone-sized viewport (no visible "mockup card" chrome).
  const shellBox = await page.locator('.phone-shell').boundingBox();
  const bodyWidth = await page.evaluate(() => document.body.clientWidth);
  if (Math.round(shellBox.width) < bodyWidth - 2) throw new Error('FAIL: phone-shell is not full-bleed on narrow viewport');
  const radius = await page.locator('.phone-shell').evaluate(el => getComputedStyle(el).borderRadius);
  if (radius !== '0px') throw new Error('FAIL: phone-shell should have no border-radius on a phone-sized viewport, got ' + radius);
  console.log('full-bleed layout OK');

  // 2. Phone field has the right type/inputmode so the correct keyboard shows.
  await page.click('[data-action="goAdd"]');
  await page.waitForSelector('#field-phone');
  const phoneEl = page.locator('#field-phone');
  const phoneType = await phoneEl.getAttribute('type');
  const phoneInputmode = await phoneEl.getAttribute('inputmode');
  if (phoneType !== 'tel' || phoneInputmode !== 'tel') throw new Error('FAIL: phone field missing type=tel/inputmode=tel');
  await phoneEl.pressSequentially('4165551234', { delay: 15 });
  await phoneEl.blur();
  const phoneValueAfterBlur = await phoneEl.inputValue();
  if (phoneValueAfterBlur !== '4165551234') throw new Error('FAIL: phone value not correct after typing');
  console.log('phone field type/inputmode + value-after-blur OK');

  // 3. Day-availability panel.
  await page.fill('#field-name', 'Test Client');
  await page.fill('#field-date', '2026-09-10');
  await page.waitForSelector('.day-schedule');
  const slotCount = await page.locator('.day-slot').count();
  if (slotCount !== 8) throw new Error('FAIL: expected 8 hourly slots (11am-7pm), got ' + slotCount);
  await page.click('.day-slot--free >> nth=2'); // 11,12,13 -> index2 = 1pm
  const timeVal = await page.locator('#field-time').inputValue();
  if (timeVal !== '13:00') throw new Error('FAIL: tapping a free slot did not set time to 13:00, got ' + timeVal);
  console.log('day-availability panel (slot count + tap-to-fill) OK');

  await page.click('[data-action="onSave"]');
  await page.waitForSelector('.toast');

  await page.click('[data-action="goAdd"]');
  await page.fill('#field-name', 'Second Client');
  await page.fill('#field-phone', '4165559999');
  await page.fill('#field-date', '2026-09-10');
  await page.waitForSelector('.day-schedule');
  const bookedSlotText = await page.locator('.day-slot--booked').first().textContent();
  if (!bookedSlotText.includes('Test Client')) throw new Error('FAIL: day-schedule did not show the just-created booking as occupied');
  console.log('day-schedule reflects newly-created booking OK');

  // 4. History nav rename + CAD currency.
  await page.click('[data-action="goEarnings"]');
  await page.waitForSelector('.stat-value');
  const navLabels = await page.locator('.nav-label').allTextContents();
  if (!navLabels.includes('History')) throw new Error('FAIL: nav label not renamed to History, got ' + navLabels.join(','));
  const statText = await page.locator('.stat-value').first().textContent();
  if (!statText.trim().startsWith('$')) throw new Error('FAIL: currency is not $ (CAD), got ' + statText);
  console.log('History nav rename + CAD currency OK');

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 01-core-flows');
  await browser.close();
})().catch(e => { console.error('FAIL: 01-core-flows —', e.message || e); process.exit(1); });
