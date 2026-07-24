// Covers: the header shows a live "Today: <date> · <time>" anchor on every
// screen, so a stale mental model of "today" doesn't get confused with a
// "Next up" appointment scheduled for a later day.
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
    const tomorrow = new Date(Date.now() + 24*60*60000);
    const dateStr = tomorrow.toISOString().slice(0,10);
    localStorage.setItem('asha_appointments_v1', JSON.stringify([
      { id: 'a1', name: 'Zara', phone: '4165551234', services: ['Bridal makeup'], date: dateStr, time: '14:00', address: '', price: '', notes: '', status: 'upcoming' },
    ]));
  });

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await bypassGate(page);
  await page.waitForSelector('#header-now');
  const nowText = await page.locator('#header-now').textContent();
  assert.ok(/^Today: /.test(nowText), 'header-now not formatted as expected: ' + nowText);

  await page.click('[data-action="goSettings"]');
  await page.waitForSelector('#header-now'); // header is shared across screens

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 09-header-now-label');
  await browser.close();
})().catch(e => { console.error('FAIL: 09-header-now-label —', e.message || e); process.exit(1); });
