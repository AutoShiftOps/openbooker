// Regression test for a real bug: tapping a button immediately after typing
// into a text field could silently swallow the click, because the field's
// blur-triggered re-render replaced the DOM mid-gesture (between mousedown
// and mouseup). Fixed by deferring re-renders to a macrotask. This
// reproduces the exact failure pattern -- do not "simplify" this test by
// using el.click() instead of a real mousedown/mouseup sequence, that does
// not exercise the bug at all.
const { chromium } = require('playwright');
const BASE_URL = process.env.BASE_URL || 'http://localhost:8888';
const { bypassGate } = require('./lib/bypassGate');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await bypassGate(page);
  await page.click('[data-action="goAdd"]');
  await page.waitForSelector('#field-name');
  await page.fill('#field-name', 'Race Test');
  await page.fill('#field-phone', '4165551234');
  await page.fill('#field-date', '2026-09-20');
  await page.fill('#field-time', '11:00');

  await page.evaluate(() => {
    window.__clickReached = false;
    document.addEventListener('click', e => {
      if (e.target.dataset && e.target.dataset.action === 'onSave') window.__clickReached = true;
    }, true);
  });

  // Real click (mousedown -> mouseup -> click), immediately after the last
  // field's blur -- this is the exact pattern that used to fail.
  await page.click('[data-action="onSave"]');
  await page.waitForTimeout(500);

  const clickReached = await page.evaluate(() => window.__clickReached);
  const toastVisible = await page.locator('.toast').count();
  const onHome = await page.locator('.wordmark').isVisible();

  if (!clickReached) throw new Error('FAIL: click was swallowed (race regressed)');
  if (!toastVisible) throw new Error('FAIL: save did not go through');
  if (!onHome) throw new Error('FAIL: did not navigate home after save');

  if (errors.length) throw new Error('Page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 03-click-race-fix');
  await browser.close();
})().catch(e => { console.error('FAIL: 03-click-race-fix —', e.message || e); process.exit(1); });
