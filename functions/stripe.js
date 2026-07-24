/* Stripe subscription billing: a Checkout session to start a subscription, a
   Billing Portal session for self-serve manage/cancel, and the webhook that's
   the ONLY writer of /subscriptions/{uid} -- see firestore.rules, which
   refuses that collection any client write at all. Requires admin.initializeApp()
   to have already run (see index.js, which requires this file after that call). */

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const Stripe = require('stripe');

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');

// Not a secret (Stripe Price IDs aren't sensitive) -- just paste the real one
// from the Stripe Dashboard -> Product -> Pricing once it exists. A trial can
// also be configured on the Price itself instead of here; either works.
const PRICE_ID = 'price_REPLACE_WITH_YOUR_STRIPE_PRICE_ID';
const TRIAL_PERIOD_DAYS = 14;

function stripeClient() {
  return new Stripe(STRIPE_SECRET_KEY.value(), { apiVersion: '2024-06-20' });
}

exports.createCheckoutSession = onCall({ secrets: [STRIPE_SECRET_KEY] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const { successUrl, cancelUrl } = request.data || {};
  if (!successUrl || !cancelUrl) throw new HttpsError('invalid-argument', 'Missing successUrl/cancelUrl.');

  const stripe = stripeClient();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    client_reference_id: request.auth.uid,
    customer_email: request.auth.token.email,
    line_items: [{ price: PRICE_ID, quantity: 1 }],
    subscription_data: { trial_period_days: TRIAL_PERIOD_DAYS },
    success_url: successUrl,
    cancel_url: cancelUrl
  });
  return { url: session.url };
});

exports.createPortalSession = onCall({ secrets: [STRIPE_SECRET_KEY] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const { returnUrl } = request.data || {};
  if (!returnUrl) throw new HttpsError('invalid-argument', 'Missing returnUrl.');

  const subDoc = await admin.firestore().collection('subscriptions').doc(request.auth.uid).get();
  const customerId = subDoc.exists ? subDoc.data().stripeCustomerId : null;
  if (!customerId) throw new HttpsError('failed-precondition', 'No billing account yet — subscribe first.');

  const stripe = stripeClient();
  const portal = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
  return { url: portal.url };
});

// Bootstrapping order: deploy once (this function will fail closed until
// secrets exist, which is fine), copy its URL into the Stripe Dashboard's
// webhook config, THEN set STRIPE_WEBHOOK_SECRET and redeploy.
exports.stripeWebhook = onRequest({ secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET] }, async (req, res) => {
  const stripe = stripeClient();
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET.value());
  } catch (err) {
    res.status(400).send(`Webhook signature verification failed: ${err.message}`);
    return;
  }

  const db = admin.firestore();
  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const uid = session.client_reference_id;
      if (uid && session.subscription) {
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        await db.collection('subscriptions').doc(uid).set({
          status: sub.status,
          stripeCustomerId: session.customer,
          stripeSubscriptionId: sub.id,
          currentPeriodEnd: sub.current_period_end * 1000,
          updatedAt: Date.now()
        }, { merge: true });
      }
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      // client_reference_id isn't available on subscription events -- look the
      // tenant up by the Stripe customer id we stored on checkout completion.
      const snap = await db.collection('subscriptions').where('stripeCustomerId', '==', sub.customer).limit(1).get();
      if (!snap.empty) {
        await snap.docs[0].ref.set({
          status: event.type === 'customer.subscription.deleted' ? 'canceled' : sub.status,
          stripeSubscriptionId: sub.id,
          currentPeriodEnd: sub.current_period_end * 1000,
          updatedAt: Date.now()
        }, { merge: true });
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook handling error:', err);
    res.status(500).send('Webhook handler error');
  }
});
