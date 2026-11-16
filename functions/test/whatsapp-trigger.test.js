/* End-to-end test of the Cloud Function with an in-memory Firestore and a fake
   WhatsApp API -- no network, no credentials. */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.WHATSAPP_TOKEN = 'test-token';
const admin = require('firebase-admin');

function makeDb(seed) {
  const store = new Map(Object.entries(seed));
  const doc = (col, id) => {
    const path = `${col}/${id}`;
    return {
      async get() { return { exists: store.has(path), data: () => store.get(path) }; },
      async create(d) { if (store.has(path)) { const e = new Error('already exists'); e.code = 6; throw e; } store.set(path, d); },
      async update(d) { store.set(path, { ...store.get(path), ...d }); }
    };
  };
  return { store, collection: (col) => ({ doc: (id) => doc(col, id) }) };
}

function setup({ cfg, calls, fail }) {
  const db = makeDb(cfg === undefined ? {} : { 'whatsappConfig/u1': cfg });
  Object.defineProperty(admin, 'firestore', { value: () => db, configurable: true });
  global.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    if (fail) return { ok: false, status: 400, json: async () => ({ error: { message: 'template not approved', code: 132001 } }) };
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.${calls.length}` }] }) };
  };
  return db;
}

const CFG = { enabled: true, phoneNumberId: '555', channelUrl: 'https://whatsapp.com/channel/abc', currency: '$' };
const appt = (o) => ({ id: 'a1', name: 'Priya Rao', phone: '(905) 555-0142', services: ['Threading'], status: 'upcoming', price: '', paymentMethod: '', ...o });
const client = (consent) => ({ id: 'c1', name: 'Priya Rao', phone: '9055550142', consent });
const evt = (beforeAppts, afterAppts, clients) => ({
  params: { uid: 'u1' },
  data: { before: { data: () => ({ appointments: beforeAppts, clients }) }, after: { data: () => ({ appointments: afterAppts, clients }) } }
});
const DONE = appt({ status: 'done', price: '15', paymentMethod: 'Cash' });

function fn() {
  delete require.cache[require.resolve('../whatsapp')];
  return require('../whatsapp').whatsappOnAppointmentCompleted;
}

test('consenting client: thank-you + one-time channel invite; replay sends nothing more', async () => {
  const calls = [];
  const db = setup({ cfg: CFG, calls });
  const run = fn();
  await run.run(evt([appt({})], [DONE], [client(true)]));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.template.name, 'thank_you_receipt');
  assert.equal(calls[0].body.to, '19055550142');
  assert.equal(calls[0].url, 'https://graph.facebook.com/v21.0/555/messages');
  assert.equal(calls[0].auth, 'Bearer test-token');
  assert.equal(calls[1].body.template.name, 'channel_invite_offers');
  assert.equal(db.store.get('whatsappLog/u1__a1__thanks').status, 'sent');
  // Same event delivered again (Firestore triggers are at-least-once)
  await run.run(evt([appt({})], [DONE], [client(true)]));
  assert.equal(calls.length, 2, 'no duplicate messages');
  // A later visit by the same client: thanks again, but never a second invite
  const later = appt({ id: 'a2', status: 'done', price: '20', paymentMethod: 'Interac' });
  await run.run(evt([appt({ id: 'a2' })], [later], [client(true)]));
  assert.equal(calls.length, 3);
  assert.equal(calls[2].body.template.name, 'thank_you_receipt');
});

test('client without consent gets the receipt only -- never the promo invite', async () => {
  const calls = [];
  setup({ cfg: CFG, calls });
  await fn().run(evt([appt({})], [DONE], [client(false)]));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.template.name, 'thank_you_receipt');
});

test('feature off (no config / disabled): nothing is sent', async () => {
  for (const cfg of [undefined, { ...CFG, enabled: false }]) {
    const calls = [];
    setup({ cfg, calls });
    await fn().run(evt([appt({})], [DONE], [client(true)]));
    assert.equal(calls.length, 0);
  }
});

test('no usable phone number: skipped without error', async () => {
  const calls = [];
  setup({ cfg: CFG, calls });
  await fn().run(evt([appt({ phone: '' })], [{ ...DONE, phone: '555' }], [client(true)]));
  assert.equal(calls.length, 0);
});

test('API failure is logged, does not throw, and is not auto-retried', async () => {
  const calls = [];
  const db = setup({ cfg: CFG, calls, fail: true });
  const run = fn();
  await run.run(evt([appt({})], [DONE], [client(false)]));
  const log = db.store.get('whatsappLog/u1__a1__thanks');
  assert.equal(log.status, 'failed');
  assert.match(log.error, /template not approved/);
  await run.run(evt([appt({})], [DONE], [client(false)]));
  assert.equal(calls.length, 1, 'a failed send is not silently re-sent');
});
