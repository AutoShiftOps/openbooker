// Covers: the Google-reviews section was fully removed, the Automatic
// reminders section exists in its place, and Services management is present.
const { chromium } = require('playwright');
const BASE_URL = process.env.BASE_URL || 'http://localhost:8888';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await page.click('[data-action="goSettings"]');
  await page.waitForSelector('.section-title');
  const sectionTitles = await page.locator('.section-title').allTextContents();
  console.log('Settings section titles:', sectionTitles);
  if (sectionTitles.some(t => /google business/i.test(t))) throw new Error('FAIL: Google Business Profile section still present');
  if (!sectionTitles.some(t => /automatic reminders/i.test(t))) throw new Error('FAIL: Automatic reminders section missing');
  if (!sectionTitles.some(t => /services you offer/i.test(t))) throw new Error('FAIL: Services section missing');

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 02-settings-screen');
  await browser.close();
})().catch(e => { console.error('FAIL: 02-settings-screen —', e.message || e); process.exit(1); });
