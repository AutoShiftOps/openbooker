/* WhatsApp automations via the Meta WhatsApp Cloud API.

   Trigger: any write to users/{uid}. When an appointment flips to "done" (with a
   price + payment method -- exactly what the app's "Mark completed" step
   requires), send the client a thank-you receipt. If that client has ticked
   "Promo OK" (clients[].consent), also send a ONE-TIME invite to the business's
   WhatsApp Channel.

   Nothing here ever writes back to users/{uid}, so it can't retrigger itself.
   Idempotency + an audit trail live in whatsappLog/{key}, created atomically
   (.create() fails if the key exists), so a re-delivered event or a doc rewrite
   can never double-send.

   Per-business settings (server-only; clients can read but never write -- see
   firestore.rules): whatsappConfig/{uid} = {
     enabled: true,
     phoneNumberId: '1234567890',          // from Meta WhatsApp Manager
     channelUrl: 'https://whatsapp.com/channel/...',
     currency: '$', defaultCountryCode: '1', lang: 'en'
   }
   The access token is a secret: `firebase functions:secrets:set WHATSAPP_TOKEN`. */

const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const lib = require('./whatsapp-lib');

const WHATSAPP_TOKEN = defineSecret('WHATSAPP_TOKEN');
const GRAPH_VERSION = 'v21.0';

async function sendTemplate({ phoneNumberId, token, to, template, params, lang }) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(lib.templatePayload(to, template, params, lang))
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((body.error && body.error.message) || `HTTP ${res.status}`);
    err.code = body.error && body.error.code;
    throw err;
  }
  return body.messages && body.messages[0] && body.messages[0].id;
}

// Claim a send slot. Returns the log ref, or null if it was already claimed.
async function claim(db, key, meta) {
  const ref = db.collection('whatsappLog').doc(key);
  try {
    await ref.create({ ...meta, status: 'sending', createdAt: Date.now() });
    return ref;
  } catch (e) {
    if (e.code === 6 || /already exists/i.test(e.message || '')) return null; // ALREADY_EXISTS
    throw e;
  }
}

async function deliver(db, key, meta, send) {
  const ref = await claim(db, key, meta);
  if (!ref) return;
  try {
    const wamid = await send();
    await ref.update({ status: 'sent', wamid: wamid || null, sentAt: Date.now() });
  } catch (e) {
    // Not retried automatically: a retry after an ambiguous failure could
    // double-text a client. The failure is visible in the log for follow-up.
    console.error(`WhatsApp send failed (${key}):`, e.message);
    await ref.update({ status: 'failed', error: String(e.message || e).slice(0, 300), failedAt: Date.now() });
  }
}

exports.whatsappOnAppointmentCompleted = onDocumentUpdated(
  { document: 'users/{uid}', secrets: [WHATSAPP_TOKEN] },
  async (event) => {
    const uid = event.params.uid;
    const before = event.data.before.data() || {};
    const after = event.data.after.data() || {};

    const done = lib.newlyCompleted(before.appointments, after.appointments);
    if (!done.length) return;

    const db = admin.firestore();
    const cfgSnap = await db.collection('whatsappConfig').doc(uid).get();
    const cfg = cfgSnap.exists ? cfgSnap.data() : null;
    if (!cfg || !cfg.enabled || !cfg.phoneNumberId) return; // feature off for this business

    const token = WHATSAPP_TOKEN.value();
    const country = cfg.defaultCountryCode || '1';
    const lang = cfg.lang || 'en';

    for (const appt of done) {
      const to = lib.toE164(appt.phone, country);
      if (!to) {
        console.log(`WhatsApp skipped (${uid}/${appt.id}): no usable phone number`);
        continue;
      }

      // 1) Thank-you receipt (transactional) -- every client with a number.
      await deliver(db, `${uid}__${appt.id}__thanks`, { uid, apptId: appt.id, kind: 'thanks', to }, () =>
        sendTemplate({
          phoneNumberId: cfg.phoneNumberId, token, to, lang,
          template: lib.TEMPLATES.thanks,
          params: lib.thanksParams(appt, cfg)
        })
      );

      // 2) Channel invite (marketing) -- consenting clients only, once ever.
      const client = lib.findClient(after.clients, appt);
      const inviteKey = `${uid}__client_${lib.digitsOf(appt.phone)}__invite`;
      const invited = (await db.collection('whatsappLog').doc(inviteKey).get()).exists;
      if (lib.shouldInvite(client, cfg, invited)) {
        await deliver(db, inviteKey, { uid, kind: 'invite', to }, () =>
          sendTemplate({
            phoneNumberId: cfg.phoneNumberId, token, to, lang,
            template: lib.TEMPLATES.invite,
            params: lib.inviteParams(client, cfg)
          })
        );
      }
    }
  }
);
