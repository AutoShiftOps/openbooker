/* Scheduled Cloud Function: sends a push notification ~30 minutes before each
   upcoming appointment. Runs server-side so it fires even if the PWA isn't
   open -- the client only needs to have registered an FCM token once
   (Settings -> "Enable automatic reminders"). */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
const { DateTime } = require('luxon');

admin.initializeApp();

// Stripe billing functions live in their own file (stripe.js) -- required
// after initializeApp() since they call admin.firestore() at request time.
Object.assign(exports, require('./stripe'));

const REMINDER_MINUTES_BEFORE = 30;
// Runs every 5 minutes; window is wider than the cron cadence so a slightly
// delayed run never skips an appointment. `reminderSent` is the real guard
// against sending the same reminder twice.
const WINDOW_MINUTES = 10;
// Neutral fallback for any tenant doc that predates the timezone field --
// deliberately not a real-world zone like America/Toronto, since that would
// just be Asha's default leaking into every other tenant's fallback too.
const FALLBACK_TZ = 'UTC';

function apptStartMillis(appt, tz) {
  if (!appt.date || !appt.time) return null;
  const dt = DateTime.fromFormat(`${appt.date} ${appt.time}`, 'yyyy-MM-dd HH:mm', { zone: tz || FALLBACK_TZ });
  return dt.isValid ? dt.toMillis() : null;
}

exports.sendAppointmentReminders = onSchedule('every 5 minutes', async () => {
  const db = admin.firestore();
  const messaging = admin.messaging();
  const now = Date.now();
  const windowCenter = now + REMINDER_MINUTES_BEFORE * 60000;
  const windowStart = windowCenter - (WINDOW_MINUTES / 2) * 60000;
  const windowEnd = windowCenter + (WINDOW_MINUTES / 2) * 60000;

  const usersSnap = await db.collection('users').get();

  for (const userDoc of usersSnap.docs) {
    const data = userDoc.data();
    const appointments = Array.isArray(data.appointments) ? data.appointments : [];
    const tokens = Array.isArray(data.fcmTokens) ? data.fcmTokens : [];
    if (!tokens.length) continue;
    const tz = (data.businessProfile && data.businessProfile.timezone) || FALLBACK_TZ;

    let changed = false;
    const staleTokens = new Set();

    for (const appt of appointments) {
      if (appt.status !== 'upcoming' || appt.reminderSent) continue;
      const startMs = apptStartMillis(appt, tz);
      if (startMs == null || startMs < windowStart || startMs > windowEnd) continue;

      const res = await messaging.sendEachForMulticast({
        tokens,
        notification: {
          title: `Upcoming: ${appt.name || 'Appointment'}`,
          body: `${appt.service || 'Appointment'} at ${appt.time} — leave soon if you're travelling.`
        }
      });
      res.responses.forEach((r, i) => {
        if (!r.success && r.error && (
          r.error.code === 'messaging/registration-token-not-registered' ||
          r.error.code === 'messaging/invalid-registration-token'
        )) {
          staleTokens.add(tokens[i]);
        }
      });

      appt.reminderSent = true;
      changed = true;
    }

    if (changed) {
      const update = { appointments };
      if (staleTokens.size) {
        update.fcmTokens = tokens.filter(t => !staleTokens.has(t));
      }
      await userDoc.ref.update(update);
    }
  }
});
