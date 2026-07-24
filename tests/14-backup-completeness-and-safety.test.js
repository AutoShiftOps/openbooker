// Regression tests for three real bugs found in a final owner+customer audit:
// (1) "Export backup" only saved appointments -- inventory, services, and the
//     client directory (with consent flags) were silently left out, despite
//     backup being the explicit safety net against phone loss.
// (2) Deleting an appointment/inventory item/service was instant and
//     permanent with no confirmation, unlike Cancel which soft-deletes.
// (3) The price field only checked "not empty," not "is a number" -- a typo
//     like "250 cash" saved fine and then silently computed as $0 in every
//     revenue total forever.
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE_URL = process.env.BASE_URL || 'http://localhost:8888';
const { bypassGate } = require('./lib/bypassGate');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });

  await page.addInitScript(() => {
    localStorage.setItem('asha_appointments_v1', JSON.stringify([
      { id: 'a1', name: 'Priya Sharma', phone: '4165550199', service: 'Bridal makeup', date: '2026-08-08', time: '10:00', address: '', price: '250', paymentMethod: 'Cash', notes: '', status: 'done' },
    ]));
    localStorage.setItem('asha_inventory_v1', JSON.stringify([
      { id: 'i1', name: 'Wax tins', qty: 5, threshold: 2, unit: 'tins' },
    ]));
  });

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await bypassGate(page);
  await page.waitForSelector('.wordmark');

  // --- 1. Backup completeness ---
  await page.click('[data-action="goSettings"]');
  await page.waitForSelector('[data-action="onExport"]');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('[data-action="onExport"]'),
  ]);
  const downloadPath = path.join(os.tmpdir(), 'backup-test.json');
  await download.saveAs(downloadPath);
  const backupContent = JSON.parse(fs.readFileSync(downloadPath, 'utf8'));
  assert.ok(Array.isArray(backupContent.appointments) && backupContent.appointments.length === 1, 'backup missing appointments');
  assert.ok(Array.isArray(backupContent.inventory) && backupContent.inventory.length === 1, 'backup missing inventory');
  assert.ok(Array.isArray(backupContent.services), 'backup missing services');
  assert.ok(Array.isArray(backupContent.clients) && backupContent.clients.length === 1, 'backup missing clients directory');
  fs.unlinkSync(downloadPath);
  console.log('backup file includes appointments + inventory + services + clients: OK');

  // --- 2. Delete confirmation (appointment) ---
  await page.click('[data-action="goSearch"]');
  await page.fill('#search-input', 'priya');
  await page.waitForSelector('.appt-card');
  await page.click('.appt-card');
  await page.waitForSelector('[data-action="deleteAppt"]');

  // Dismiss the confirm dialog -> appointment should survive.
  page.once('dialog', dialog => dialog.dismiss());
  await page.click('[data-action="deleteAppt"]');
  await page.waitForTimeout(200);
  let stillOnDetail = await page.locator('[data-action="deleteAppt"]').count();
  assert.strictEqual(stillOnDetail, 1, 'dismissing the delete confirmation should NOT delete the appointment');
  console.log('delete confirmation dismiss -> appointment preserved: OK');

  // Accept it -> appointment should actually be gone.
  page.once('dialog', dialog => {
    assert.ok(dialog.message().includes('Priya Sharma'), 'confirm dialog should name the appointment being deleted');
    dialog.accept();
  });
  await page.click('[data-action="deleteAppt"]');
  await page.waitForSelector('.toast');
  const onHome = await page.locator('.wordmark').isVisible();
  assert.ok(onHome, 'should navigate home after confirmed delete');
  console.log('delete confirmation accept -> appointment removed: OK');

  // --- 2b. Delete confirmation (inventory) ---
  await page.click('[data-action="goInventory"]');
  await page.waitForSelector('[data-action="deleteInvItem"]');
  page.once('dialog', dialog => { assert.ok(dialog.message().includes('Wax tins')); dialog.dismiss(); });
  await page.click('[data-action="deleteInvItem"]');
  await page.waitForTimeout(200);
  assert.strictEqual(await page.locator('[data-action="deleteInvItem"]').count(), 1, 'dismissed inventory delete should not remove the item');
  console.log('inventory delete confirmation: OK');

  // --- 3. Price validation ---
  await page.click('[data-action="goAdd"]');
  await page.fill('#field-name', 'Bad Price Client');
  await page.fill('#field-date', '2026-09-01');
  await page.fill('#field-time', '10:00');
  await page.fill('#field-price', '250 cash');
  await page.click('[data-action="onSave"]');
  await page.waitForSelector('.toast');
  const toastText = await page.locator('.toast').textContent();
  assert.ok(/price should be a plain number/i.test(toastText), 'expected a price-validation toast, got: ' + toastText);
  const stillOnAdd = await page.locator('#field-name').count();
  assert.strictEqual(stillOnAdd, 1, 'should not have navigated away -- the bad price must not have saved');
  console.log('non-numeric price rejected with a clear message: OK');

  // Confirm a valid numeric price still works fine.
  await page.fill('#field-price', '250');
  await page.click('[data-action="onSave"]');
  await page.waitForSelector('.toast');
  const savedOk = await page.locator('.wordmark').isVisible();
  assert.ok(savedOk, 'a valid numeric price should save normally');
  console.log('valid numeric price still saves normally: OK');

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 14-backup-completeness-and-safety');
  await browser.close();
})().catch(e => { console.error('FAIL: 14-backup-completeness-and-safety —', e.message || e); process.exit(1); });
