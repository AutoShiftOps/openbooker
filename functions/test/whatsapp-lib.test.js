const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../whatsapp-lib');

test('toE164: normalises typical typed numbers', () => {
  assert.equal(lib.toE164('(905) 555-0142'), '19055550142');
  assert.equal(lib.toE164('905-555-0142'), '19055550142');
  assert.equal(lib.toE164('1 905 555 0142'), '19055550142');
  assert.equal(lib.toE164('+91 98765 43210'), '919876543210');
  assert.equal(lib.toE164('009198765 43210'), '919876543210');
});

test('toE164: refuses numbers it cannot be sure about', () => {
  assert.equal(lib.toE164(''), null);
  assert.equal(lib.toE164(null), null);
  assert.equal(lib.toE164('555-0142'), null);
  assert.equal(lib.toE164('12345'), null);
  assert.equal(lib.toE164('+123'), null);
});

const A = (o) => ({ id: 'a1', name: 'Priya Rao', phone: '9055550142', status: 'upcoming', price: '', paymentMethod: '', services: ['Threading'], ...o });

test('newlyCompleted: fires once, on the transition only', () => {
  const before = [A({})];
  const after = [A({ status: 'done', price: '15', paymentMethod: 'Cash' })];
  assert.equal(lib.newlyCompleted(before, after).length, 1);
  // doc rewritten again with the appointment already done -> no re-send
  assert.equal(lib.newlyCompleted(after, after).length, 0);
});

test('newlyCompleted: a done record logged directly (no earlier version) counts', () => {
  assert.equal(lib.newlyCompleted([], [A({ status: 'done', price: '15', paymentMethod: 'Cash' })]).length, 1);
});

test('newlyCompleted: ignores unpaid, cancelled, no-show and untouched appointments', () => {
  assert.equal(lib.newlyCompleted([A({})], [A({ status: 'done', price: '', paymentMethod: 'Cash' })]).length, 0);
  assert.equal(lib.newlyCompleted([A({})], [A({ status: 'done', price: '15', paymentMethod: '' })]).length, 0);
  assert.equal(lib.newlyCompleted([A({})], [A({ status: 'cancelled' })]).length, 0);
  assert.equal(lib.newlyCompleted(undefined, undefined).length, 0);
});

test('thanksParams: first name, services joined, currency + amount, payment', () => {
  const p = lib.thanksParams(A({ services: ['Threading', 'Facial'], price: '80', paymentMethod: 'Interac' }), { currency: '$' });
  assert.deepEqual(p, ['Priya', 'Threading + Facial', '$80', 'Interac']);
});

test('thanksParams: never produces an empty variable (Meta rejects them)', () => {
  const p = lib.thanksParams({ name: '', price: '10', paymentMethod: 'Cash' }, {});
  assert.deepEqual(p, ['there', 'appointment', '$10', 'Cash']);
  p.forEach(v => assert.ok(v.length > 0 && !/[\n\t]/.test(v)));
});

test('findClient: matches by digits-only phone, falls back to name', () => {
  const clients = [{ id: 'c1', name: 'Priya Rao', phone: '(905) 555-0142', consent: true }];
  assert.equal(lib.findClient(clients, A({ phone: '905.555.0142' })).id, 'c1');
  assert.equal(lib.findClient(clients, A({ phone: '', name: 'priya rao' })).id, 'c1');
  assert.equal(lib.findClient(clients, A({ phone: '4165550000', name: 'Someone Else' })), null);
});

test('shouldInvite: consent required, channel configured, once only', () => {
  const cfg = { channelUrl: 'https://whatsapp.com/channel/x' };
  assert.equal(lib.shouldInvite({ consent: true }, cfg, false), true);
  assert.equal(lib.shouldInvite({ consent: false }, cfg, false), false);
  assert.equal(lib.shouldInvite({}, cfg, false), false);          // flag missing = no consent
  assert.equal(lib.shouldInvite(null, cfg, false), false);
  assert.equal(lib.shouldInvite({ consent: true }, {}, false), false);
  assert.equal(lib.shouldInvite({ consent: true }, cfg, true), false);
});

test('templatePayload: matches the Cloud API shape', () => {
  const body = lib.templatePayload('19055550142', lib.TEMPLATES.thanks, ['Priya', 'Threading', '$15', 'Cash']);
  assert.equal(body.messaging_product, 'whatsapp');
  assert.equal(body.to, '19055550142');
  assert.equal(body.template.name, 'thank_you_receipt');
  assert.equal(body.template.language.code, 'en');
  assert.deepEqual(body.template.components[0].parameters.map(p => p.text), ['Priya', 'Threading', '$15', 'Cash']);
});
