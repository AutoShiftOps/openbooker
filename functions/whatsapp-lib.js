/* Pure helpers for the WhatsApp automations -- no Firebase, no network, so they
   can be unit-tested with plain `node --test`. whatsapp.js wires them to
   Firestore + the WhatsApp Cloud API.

   Rules baked in here (see WHATSAPP.md for the why):
   - The thank-you receipt goes to every client who has a usable phone number
     (it confirms a service they just paid for).
   - The Channel invite is marketing: it goes ONLY to clients whose `consent`
     flag is true, and only once per client. */

// Template names registered (and approved) in Meta Business Manager.
const TEMPLATES = {
  thanks: 'thank_you_receipt',      // category: UTILITY
  invite: 'channel_invite_offers'   // category: MARKETING
};

/* Best-effort E.164 for the phone numbers people actually type into the app.
   Returns null when we can't be reasonably sure -- better to skip a message
   than to text a stranger.
   - 10 digits            -> default country (Canada/US: +1)
   - 11 digits starting 1 -> +1 NANP
   - anything with a leading "+" keeps its own country code (7-15 digits) */
function toE164(raw, defaultCountryCode = '1') {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const hasPlus = s.startsWith('+') || s.startsWith('00');
  const digits = s.replace(/\D/g, '').replace(/^00/, '');
  if (hasPlus) return digits.length >= 7 && digits.length <= 15 ? digits : null;
  if (digits.length === 10 && defaultCountryCode === '1') return '1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return digits;
  if (digits.length === 10) return defaultCountryCode + digits;
  return null;
}

// Same matching rule the app uses for its client directory: digits-only phone.
function digitsOf(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function findClient(clients, appt) {
  const list = Array.isArray(clients) ? clients : [];
  const key = digitsOf(appt.phone);
  if (key) {
    const byPhone = list.find(c => digitsOf(c.phone) === key);
    if (byPhone) return byPhone;
  }
  const nameKey = String(appt.name || '').toLowerCase().trim();
  return nameKey ? list.find(c => String(c.name || '').toLowerCase().trim() === nameKey) || null : null;
}

/* Appointments that flipped to "done" between two snapshots of the user doc.
   Transition-only on purpose: a doc rewrite that leaves an already-done
   appointment untouched must never re-send. A done appointment still has to
   have price + payment method (the app enforces both on completion, but a
   hand-edited/imported record might not). */
function newlyCompleted(beforeAppts, afterAppts) {
  const before = new Map((Array.isArray(beforeAppts) ? beforeAppts : []).map(a => [a.id, a]));
  return (Array.isArray(afterAppts) ? afterAppts : []).filter(a => {
    if (!a || a.status !== 'done') return false;
    if (!a.price || !a.paymentMethod) return false;
    const prev = before.get(a.id);
    return !prev || prev.status !== 'done';
  });
}

function serviceLabel(appt) {
  if (Array.isArray(appt.services) && appt.services.length) return appt.services.join(' + ');
  return appt.service || 'appointment';
}

function firstName(name) {
  const n = String(name || '').trim().split(/\s+/)[0];
  return n || 'there';
}

/* Template variables, in order. Meta rejects empty/newline/4+-space variables,
   so everything is trimmed and flattened. */
function clean(v) {
  return String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim() || '-';
}

function thanksParams(appt, cfg) {
  const currency = (cfg && cfg.currency) || '$';
  return [
    firstName(appt.name),                        // {{1}} first name
    serviceLabel(appt),                          // {{2}} service(s)
    `${currency}${String(appt.price).trim()}`,   // {{3}} amount paid
    appt.paymentMethod                           // {{4}} payment method
  ].map(clean);
}

function inviteParams(client, cfg) {
  return [firstName(client && client.name), cfg.channelUrl].map(clean); // {{1}} name, {{2}} channel link
}

function shouldInvite(client, cfg, alreadyInvited) {
  return !!(client && client.consent === true && cfg && cfg.channelUrl && !alreadyInvited);
}

// Meta "send template" request body.
function templatePayload(to, templateName, params, lang = 'en') {
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: lang },
      components: [{ type: 'body', parameters: params.map(text => ({ type: 'text', text })) }]
    }
  };
}

module.exports = {
  TEMPLATES, toE164, digitsOf, findClient, newlyCompleted,
  thanksParams, inviteParams, shouldInvite, templatePayload, firstName, serviceLabel
};
