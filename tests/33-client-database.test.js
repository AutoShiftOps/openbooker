// Covers the client database redesign:
//  - same phone in different formats (+1 / dashes) collapses into ONE client
//    on load (the duplicate source was per-device random ids surviving the
//    id-based cloud merge), keeping the newest offers answer;
//  - look-alike names with different/missing phones are offered as "possible
//    duplicates", and "Not the same" is remembered;
//  - the client profile shows totals, upcoming, and every visit with its
//    per-service amounts;
//  - completing a multi-service visit asks for a price per service
//    (pre-filled from Settings defaults) and stores them as line items;
//  - the Add screen's "Is this the same client?" card (use existing / new);
//  - Add client warns about look-alikes before creating a new record;
//  - editing a client's phone carries their bookings along;
//  - search matches address and +1-formatted numbers.
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

  const d = n => { const x = new Date(); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

  await page.addInitScript((dates) => {
    window.open = () => ({});
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    localStorage.setItem('asha_services_v1', JSON.stringify([
      { id: 'sv1', name: 'Facial', price: 40, updatedAt: 0 },
      { id: 'sv2', name: 'Threading', price: 10, updatedAt: 0 },
      { id: 'sv3', name: 'Bridal makeup', updatedAt: 0 }
    ]));
    localStorage.setItem('asha_appointments_v1', JSON.stringify([
      { id: 'a1', name: 'Priya Sharma', phone: '416-555-0199', services: ['Facial', 'Threading'], date: dates.past2, time: '10:00', price: '55', paymentMethod: 'Cash', items: [{ service: 'Facial', price: 45 }, { service: 'Threading', price: 10 }], status: 'done', address: '12 Maple St' },
      { id: 'a2', name: 'Priya Sharma', phone: '+1 (416) 555-0199', services: ['Facial'], date: dates.past1, time: '11:00', price: '40', paymentMethod: 'Interac', status: 'done', address: '12 Maple St' },
      { id: 'a3', name: 'Priya Sharma', phone: '416 555 0199', services: ['Facial', 'Threading'], date: dates.future, time: '12:00', price: '', status: 'upcoming', address: '12 Maple St' },
      { id: 'a4', name: 'Anita Rao', phone: '905-555-0101', services: ['Bridal makeup'], date: dates.past1, time: '09:00', price: '300', paymentMethod: 'Card', status: 'done', address: '' }
    ]));
    // Two records for Priya under different number formats (what two devices
    // produced), plus a phone-less "Anita Rao" -> possible duplicate only.
    localStorage.setItem('asha_clients_v1', JSON.stringify([
      { id: 'c_b', name: 'Priya Sharma', phone: '+1 416 555 0199', address: '', consent: true, consentAnsweredAt: 2000, updatedAt: 2000 },
      { id: 'c_a', name: 'Priya Sharma', phone: '416-555-0199', address: '12 Maple St', consent: false, consentAnsweredAt: 1000, updatedAt: 1000 },
      { id: 'c_n', name: 'anita  rao', phone: '', address: '', consent: false, updatedAt: 0 }
    ]));
  }, { past2: d(-20), past1: d(-5), future: d(7) });

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await bypassGate(page);

  // 1) Same phone, different formats -> one client; smallest id kept; newest consent answer wins
  const priyas = await page.evaluate(() => state.clients.filter(c => phoneKey(c.phone) === '4165550199'));
  assert.strictEqual(priyas.length, 1, 'Priya should be one client, got ' + priyas.length);
  assert.strictEqual(priyas[0].id, 'c_a');
  assert.strictEqual(priyas[0].consent, true, 'newest consent answer (yes) kept');
  assert.strictEqual(priyas[0].address, '12 Maple St');

  // 2) Possible duplicates banner (Anita with/without phone), and "Not the same" sticks
  await page.click('[data-action="goSearch"]');
  await page.waitForSelector('[data-action="toggleDuplicates"]');
  assert.ok((await page.locator('[data-action="toggleDuplicates"]').textContent()).includes('1 possible duplicate'));
  await page.click('[data-action="toggleDuplicates"]');
  await page.click('[data-action="notSamePair"]');
  await page.waitForTimeout(200);
  assert.strictEqual(await page.locator('[data-action="toggleDuplicates"]').count(), 0, 'dismissed pair no longer listed');

  // 2b) Merging a phone-less look-alike keeps the record WITH the phone (bookings stay linked)
  await page.evaluate(() => {
    const extra = { id: 'c_0', name: 'Meena Iyer', phone: '', consent: false, updatedAt: 0 };
    persistClients([...state.clients, extra, { id: 'c_z', name: 'Meena Iyer', phone: '647-555-0123', consent: false, updatedAt: 0 }]);
    Actions.mergePair('c_0|c_z');
  });
  const meena = await page.evaluate(() => state.clients.filter(c => c.name === 'Meena Iyer'));
  assert.strictEqual(meena.length, 1);
  assert.strictEqual(meena[0].phone, '647-555-0123', 'merge kept the phone number');

  // 3) Search by address and by +1 number
  await page.fill('#search-input', 'maple');
  await page.waitForTimeout(150);
  assert.strictEqual(await page.locator('[data-action="viewClientHistory"]').count(), 1, 'address search');
  await page.fill('#search-input', '');
  await page.locator('#search-input').pressSequentially('+1 416 555 0199', { delay: 5 });
  await page.waitForTimeout(150);
  assert.strictEqual(await page.locator('[data-action="viewClientHistory"]').count(), 1, '+1 number search');

  // 4) Profile: totals, upcoming, per-service amounts
  await page.click('[data-action="viewClientHistory"]');
  await page.waitForSelector('.stat-grid');
  assert.strictEqual(await page.locator('.section-title').first().textContent(), 'Priya Sharma');
  const stats = await page.locator('.stat-grid').textContent();
  assert.ok(stats.includes('$95'), 'total paid 55 + 40: ' + stats);
  assert.ok(/Visits\s*2/.test(stats), 'two completed visits: ' + stats);
  const history = await page.locator('.visit-card').allTextContents();
  assert.strictEqual(history.length, 3, '1 upcoming + 2 past');
  const twoServiceVisit = history.find(t => t.includes('Threading') && t.includes('$45'));
  assert.ok(twoServiceVisit && twoServiceVisit.includes('$10') && twoServiceVisit.includes('Total') && twoServiceVisit.includes('$55'), 'per-service lines + total: ' + twoServiceVisit);
  assert.ok((await page.locator('.list-col').textContent()).includes('Facial'), 'spend by service');

  // 5) Completing a multi-service visit: one price per service, pre-filled from Settings defaults
  await page.click('[data-action="openAppt"][data-id="a3"]');
  await page.click('[data-action="openComplete"]');
  await page.waitForSelector('#pending-item-0');
  assert.strictEqual(await page.inputValue('#pending-item-0'), '40');
  assert.strictEqual(await page.inputValue('#pending-item-1'), '10');
  await page.fill('#pending-item-1', '15');
  await page.click('[data-action="selectPayment"][data-value="Cash"]');
  await page.click('[data-action="confirmComplete"]');
  await page.waitForSelector('.toast');
  const a3 = await page.evaluate(() => state.appointments.find(a => a.id === 'a3'));
  assert.strictEqual(a3.status, 'done');
  assert.strictEqual(a3.price, '55', 'total = 40 + 15');
  assert.deepStrictEqual(a3.items, [{ service: 'Facial', price: 40 }, { service: 'Threading', price: 15 }]);

  // 6) Add screen: look-alike name + new number -> "Is this the same client?"
  await page.click('[data-action="goAdd"]');
  await page.fill('#field-name', 'Pirya Sharma');
  await page.fill('#field-phone', '647-555-0000');
  await page.click('#field-address'); // blur -> re-render
  await page.waitForSelector('#same-client-card');
  assert.ok((await page.locator('#same-client-card').textContent()).includes('Is this the same client?'));
  await page.click('#same-client-card [data-action="useExistingClient"]');
  await page.waitForTimeout(200);
  assert.strictEqual((await page.inputValue('#field-phone')).replace(/\D/g, ''), '4165550199', 'existing client filled in');
  assert.strictEqual(await page.inputValue('#field-name'), 'Priya Sharma');
  assert.ok((await page.locator('#same-client-card').textContent()).includes('Existing client'), 'quiet confirmation once it is her');

  // ...and "No, this is a new client" dismisses it
  await page.fill('#field-name', 'Anita R');
  await page.fill('#field-phone', '289-555-7777');
  await page.click('#field-address');
  await page.waitForSelector('#same-client-card [data-action="dismissDupe"]');
  await page.click('[data-action="dismissDupe"]');
  await page.waitForTimeout(200);
  assert.strictEqual(await page.locator('#same-client-card').count(), 0);

  // 7) Add client warns first, then "No, add new client" creates it
  await page.click('[data-action="goSearch"]');
  await page.fill('#search-input', '');
  await page.click('[data-action="openAddClient"]');
  await page.fill('#new-client-name', 'Priya');
  await page.click('[data-action="confirmAddClient"]');
  await page.waitForSelector('[data-action="confirmAddClientAnyway"]');
  assert.ok((await page.locator('.match-card').textContent()).includes('Priya Sharma'));
  const before = await page.evaluate(() => state.clients.length);
  await page.click('[data-action="confirmAddClientAnyway"]');
  await page.waitForTimeout(200);
  assert.strictEqual(await page.evaluate(() => state.clients.length), before + 1);

  // 8) Editing a client's phone carries their bookings along
  const anitaId = await page.evaluate(() => state.clients.find(c => c.phone === '905-555-0101').id);
  await page.click(`[data-action="viewClientHistory"][data-id="${anitaId}"]`);
  await page.click(`[data-action="openEditClient"][data-id="${anitaId}"]`);
  await page.fill('#edit-client-phone', '905-555-0202');
  await page.click('[data-action="saveEditClient"]');
  await page.waitForTimeout(200);
  assert.strictEqual(await page.evaluate(() => state.appointments.find(a => a.id === 'a4').phone), '905-555-0202');
  assert.strictEqual(await page.locator('.visit-card').count(), 1, 'booking still under her profile');

  // 9) Survives reload (dedupe is stable, dismissal remembered)
  await page.reload({ waitUntil: 'load' });
  await bypassGate(page);
  assert.strictEqual(await page.evaluate(() => state.clients.filter(c => phoneKey(c.phone) === '4165550199').length), 1);
  assert.strictEqual(await page.evaluate(() => state.clients.find(c => c.id === 'c_n').notSameAs.length), 1);

  if (errors.length) throw new Error('Console/page errors detected: ' + JSON.stringify(errors));
  console.log('PASS: 33-client-database');
  await browser.close();
})().catch(e => { console.error('FAIL: 33-client-database —', e.message || e); process.exit(1); });
