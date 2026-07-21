/* Scheduled Cloud Function: sends a push notification ~30 minutes before each
   upcoming appointment. Runs server-side so it fires even if the PWA isn't
   open -- the client only needs to have registered an FCM token once
   (Settings -> "Enable automatic reminders"). */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
const { DateTime } = require('luxon');

admin.initializeApp();

const BUSINESS_TZ = 'America/Toronto'; // Mississauga, Ontario
const REMINDER_MINUTES_BEFORE = 30;
// Runs every 5 minutes; window is wider than the cron cadence so a slightly
// delayed run never skips an appointment. `reminderSent` is the real guard
// against sending the same reminder twice.
const WINDOW_MINUTES = 10;

function apptStartMillis(appt) {
  if (!appt.date || !appt.time) return null;
  const dt = DateTime.fromFormat(`${appt.date} ${appt.time}`, 'yyyy-MM-dd HH:mm', { zone: BUSINESS_TZ });
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

    let changed = false;
    const staleTokens = new Set();

    for (const appt of appointments) {
      if (appt.status !== 'upcoming' || appt.reminderSent) continue;
      const startMs = apptStartMillis(appt);
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
