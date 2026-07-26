/* openbooker — multi-tenant appointment booking SaaS
   Vanilla JS SPA: single state object, full re-render on change, event delegation.
   Forked from a single-tenant prototype built for one real business; this build
   requires a signed-in, onboarded, subscribed account per tenant (see REQUIRE_AUTH
   below) instead of working fully offline/local-first out of the box. */

// SaaS build: every install requires sign-in, a completed onboarding wizard, and
// an active subscription before the normal app is reachable (see
// renderEntitlementGate()). This constant doesn't exist in the original
// single-tenant fork this was forked from -- flipping it to false locally is a
// convenient dev escape hatch while iterating on unrelated screens.
const REQUIRE_AUTH = true;

// ---- Business profile (owner-customizable in Settings; a brand new tenant fills
// these in via the onboarding wizard -- see awaitingOnboarding -- so they should
// stay neutral placeholders, never a real business's identity) ----
const DEFAULT_BUSINESS_PROFILE = {
  name: '',
  tagline: '',
  location: '',
  accent: '#2563eb',     // openbooker brand blue -- provisional, editable any time in Settings
  accentSoft: '#0d9488', // openbooker brand teal -- provisional, editable any time in Settings
  currency: '$',
  hoursStart: 9,
  hoursEnd: 17,
  travelBufferMin: 30,
  appointmentDurationMin: 60, // assumed length; also used for calendar-export end times
  defaultAddress: '',
  logoDataUrl: '', // owner-uploaded logo, auto-cropped to a square PNG data URI; empty = text-only header
  timezone: 'America/Toronto', // overwritten with the browser's detected zone at onboarding time
  onboarded: false,
  updatedAt: 0
};

const LOGO_SIZE_PX = 256; // stored/display resolution -- sharp enough for a retina header badge and the browser tab favicon

// Web Push "VAPID" public key -- generate in Firebase Console: Project Settings ->
// Cloud Messaging -> Web Push certificates -> Generate key pair. Paste the value
// here (this one is public by design, safe to ship client-side, unlike an API key).
const VAPID_KEY = 'BEm07yLb3A4FD8a2RggNcZIA-SbuG8fZzDccgtxghLUXVfH6iBsioQPtui32GjjqMsQ4jBZyFbEOB4VJICTr_3g';

const DEFAULT_SERVICES = ['Consultation','Standard appointment','Other'];
const PAYMENT_METHODS = ['Cash','Interac','Card','Other'];
const PAGE_SIZE = 15; // rows shown before a "Show more" button, on any list that can grow unbounded

// Curated, not exhaustive -- a starting set covering North America plus a few
// common others. Expand as real tenants ask for a zone that's missing; the
// select always includes whatever's already stored even if it's not in this
// list, so nobody's existing setting silently disappears from the dropdown.
const IANA_TIMEZONES = [
  'America/Toronto', 'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'America/Vancouver', 'America/Edmonton', 'America/Winnipeg',
  'America/Halifax', 'Europe/London', 'Europe/Dublin', 'Australia/Sydney', 'UTC'
];

function renderTimezoneSelect(bindPath, currentValue){
  const options = IANA_TIMEZONES.indexOf(currentValue) !== -1 ? IANA_TIMEZONES : [currentValue, ...IANA_TIMEZONES];
  return `<select class="field" data-bind="${bindPath}">
    ${options.map(tz => `<option value="${esc(tz)}" ${tz === currentValue ? 'selected' : ''}>${esc(tz)}</option>`).join('')}
  </select>`;
}

const LS_KEYS = {
  appointments: 'asha_appointments_v1',
  inventory: 'asha_inventory_v1',
  services: 'asha_services_v1',
  clients: 'asha_clients_v1',
  blockedDates: 'asha_blocked_dates_v1',
  lastBackup: 'asha_last_backup_v1',
  pushToken: 'asha_push_token_v1',
  businessProfile: 'asha_business_profile_v1'
};

function mergeSingleton(local, cloud){
  if (!cloud) return local;
  if (!local) return cloud;
  return (cloud.updatedAt || 0) > (local.updatedAt || 0) ? cloud : local;
}

function applyAccentColors(accent, accentSoft){
  const root = document.documentElement.style;
  root.setProperty('--accent', accent);
  root.setProperty('--accent-soft', accentSoft);
}

function applyFavicon(dataUrl){
  const link = document.getElementById('favicon-link');
  if (link) link.href = dataUrl || './icons/icon-192.png';
}

// ---- Pure business logic (dates, formatting, parsing, analytics) ----
function pad(n){ return n<10?'0'+n:''+n; }

// Date.now() alone collides when several records are created in the same
// millisecond -- a real bug found via reconcileClientsFromAppointments(),
// which creates client records in a tight synchronous loop (two clients
// reconciled from the same batch of appointments could end up with an
// identical id, so looking one up by id could silently return the wrong
// client). The random suffix guarantees uniqueness even for same-millisecond calls.
function uid(prefix){
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// New bookings default to right now (rounded up to the next 15-minute mark so
// it's a plausible slot, not an odd time like 2:37pm) -- saves a walk-in/
// same-day booking from always needing the date/time manually set, while
// staying fully editable for anything scheduled later.
function defaultBookingDateTime(){
  const now = new Date();
  const date = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  let hours = now.getHours();
  let minutes = Math.ceil(now.getMinutes() / 15) * 15;
  if (minutes === 60) { hours = (hours + 1) % 24; minutes = 0; }
  return { date, time: `${pad(hours)}:${pad(minutes)}` };
}

function toDateObj(dateStr,timeStr){
  if(!dateStr) return null;
  const [y,m,d]=dateStr.split('-').map(Number);
  let hh=0,mm=0;
  if(timeStr){ const [h,mi]=timeStr.split(':').map(Number); hh=h; mm=mi; }
  return new Date(y,(m||1)-1,d||1,hh,mm);
}
function fmtDateLabel(dateStr){
  if(!dateStr) return '';
  const d=toDateObj(dateStr,'00:00');
  return d.toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
}
function fmtTimeLabel(timeStr){
  if(!timeStr) return '';
  const [h,m]=timeStr.split(':').map(Number);
  const ampm = h>=12?'PM':'AM';
  let h12 = h%12; if(h12===0) h12=12;
  return `${h12}:${pad(m)} ${ampm}`;
}
// A live "what day/time is it right now" anchor for the header -- so a quick
// glance can catch "Next up" being tomorrow (or later) rather than assuming
// today just because it's the first thing shown.
function formatNowLabel(){
  const now = new Date();
  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
  const timeLabel = fmtTimeLabel(`${pad(now.getHours())}:${pad(now.getMinutes())}`);
  return `Today: ${dateLabel} · ${timeLabel}`;
}
function fmtLeaveBy(dateStr,timeStr,bufferMin){
  if(!dateStr||!timeStr) return '';
  const d=toDateObj(dateStr,timeStr);
  d.setMinutes(d.getMinutes()-bufferMin);
  return fmtTimeLabel(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
}
function fmtCountdown(dateStr,timeStr){
  if(!dateStr||!timeStr) return '';
  const target=toDateObj(dateStr,timeStr).getTime();
  const diffMs=target-Date.now();
  if(diffMs <= -state.businessProfile.appointmentDurationMin*60000) return 'Overdue';
  if(diffMs<=0) return 'Happening now';
  const mins=Math.round(diffMs/60000);
  if(mins<60) return `in ${mins} min`;
  const hrs=Math.floor(mins/60), rem=mins%60;
  if(hrs<24) return `in ${hrs}h ${rem}m`;
  const days=Math.floor(hrs/24);
  return `in ${days} day${days===1?'':'s'}`;
}
function emptyForm(){
  const { date, time } = defaultBookingDateTime();
  return { name:'', phone:'', services:[], date, time, address:state.businessProfile.defaultAddress, price:'', notes:'' };
}
function emptyEditForm(){
  return { name:'', phone:'', services:[], date:'', time:'', address:'', price:'', paymentMethod:'', notes:'' };
}
// Appointments may come from before multi-service support existed (a single
// `service` string) or after (a `services` array) -- normalize both to a list,
// and to a single display label, so every render/analytics site only has to
// deal with one shape.
function serviceList(appt){
  if (Array.isArray(appt.services)) return appt.services;
  if (appt.service) return [appt.service];
  return [];
}
function serviceLabel(appt){
  return serviceList(appt).join(' + ');
}
// Union-merge two id-keyed lists (appointments/inventory/services), keeping whichever
// side's record is newer per `updatedAt`. Ties (including missing updatedAt on both
// sides, e.g. records created before this field existed) favor local, since that's
// what's in front of the user right now. Ids only on one side are kept as-is.
// This is a last-write-wins merge, not a full CRDT: a delete on one device can still
// be resurrected by a stale cloud/local copy that still has the record. Acceptable
// here since the goal is "don't silently wipe local entries on sign-in", not
// multi-device concurrent editing.
function mergeById(localList, cloudList){
  const map = new Map();
  (cloudList || []).forEach(item => map.set(item.id, item));
  (localList || []).forEach(item => {
    const existing = map.get(item.id);
    if (!existing || (item.updatedAt || 0) >= (existing.updatedAt || 0)) map.set(item.id, item);
  });
  return [...map.values()];
}
function esc(v){
  return String(v==null?'':v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function checkOverlap(appointments, dateStr, timeStr, excludeId){
  if (!dateStr || !timeStr) return false;
  const target = toDateObj(dateStr, timeStr).getTime();
  return appointments.some(a => {
    if (a.id === excludeId || a.status === 'done') return false;
    if (!a.date || !a.time) return false;
    const t = toDateObj(a.date, a.time).getTime();
    return Math.abs(t - target) < 60 * 60 * 1000;
  });
}
function parseChatText(text, formIn, serviceNames){
  const form = { ...formIn };
  const services = serviceNames && serviceNames.length ? serviceNames : DEFAULT_SERVICES;
  const phoneMatch = text.match(/(\+?\d[\d\s-]{8,13}\d)/);
  if (phoneMatch) form.phone = phoneMatch[1].replace(/[\s-]/g, '');

  let dateFound = '';
  const today = new Date();
  if (/\btomorrow\b/i.test(text)) {
    const d = new Date(today); d.setDate(d.getDate() + 1);
    dateFound = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  } else if (/\btoday\b/i.test(text)) {
    dateFound = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
  } else {
    const dmy = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    const monthNames = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const dMon = text.match(/(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{2,4})?/i);
    if (dmy) {
      let [, d, m, y] = dmy;
      if (y.length === 2) y = '20' + y;
      dateFound = `${y}-${pad(+m)}-${pad(+d)}`;
    } else if (dMon) {
      const mi = monthNames.indexOf(dMon[2].toLowerCase().slice(0,3)) + 1;
      const y = dMon[3] ? (dMon[3].length===2?'20'+dMon[3]:dMon[3]) : today.getFullYear();
      dateFound = `${y}-${pad(mi)}-${pad(+dMon[1])}`;
    }
  }
  if (dateFound) form.date = dateFound;

  const timeMatch = text.match(/(\d{1,2})(:(\d{2}))?\s*(am|pm)/i);
  const time24 = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (timeMatch) {
    let h = +timeMatch[1];
    const min = timeMatch[3] ? +timeMatch[3] : 0;
    const isPM = /pm/i.test(timeMatch[4]);
    if (isPM && h < 12) h += 12;
    if (!isPM && h === 12) h = 0;
    form.time = `${pad(h)}:${pad(min)}`;
  } else if (time24) {
    form.time = `${pad(+time24[1])}:${pad(+time24[2])}`;
  }

  const matchedServices = services.filter(s => text.toLowerCase().includes(s.split(' ')[0].toLowerCase()));
  if (matchedServices.length) form.services = matchedServices;

  const addrMatch = text.match(/(?:at|address[:\s]+)([A-Za-z0-9,.\s]{5,60})(?:[.,]|call|\d{9,}|$)/i);
  if (addrMatch) form.address = addrMatch[1].trim();

  const firstLine = text.split(/\n|,/)[0].trim();
  if (firstLine && firstLine.length < 40 && !form.name) form.name = firstLine.replace(/^hi\s*asha[,!\s]*/i, '').trim() || form.name;

  return form;
}
function byKey(arr, keyFn){
  const m = new Map();
  arr.forEach(a => { const k = keyFn(a); if (!k) return; const e = m.get(k) || { key: k, count: 0, revenue: 0 }; e.count++; e.revenue += (+a.price || 0); m.set(k, e); });
  return [...m.values()];
}
// Like byKey, but for a field that can hold multiple values per record (a
// booking with several services) -- each value gets its own tally. Revenue is
// split evenly across the services in that booking so summing "top services"
// revenue doesn't overcount what was actually charged for a multi-service visit.
function byKeyMulti(arr, keysFn){
  const m = new Map();
  arr.forEach(a => {
    const keys = (keysFn(a) || []).filter(Boolean);
    if (!keys.length) return;
    keys.forEach(k => {
      const e = m.get(k) || { key: k, count: 0, revenue: 0 };
      e.count++;
      e.revenue += (+a.price || 0) / keys.length;
      m.set(k, e);
    });
  });
  return [...m.values()];
}
function gcalLink(a){
  const start = toDateObj(a.date, a.time);
  const end = new Date(start.getTime() + state.businessProfile.appointmentDurationMin * 60000);
  const fmt = d => `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const svcLabel = serviceLabel(a) || 'Appointment';
  const details = encodeURIComponent(`${svcLabel}${a.notes ? ' — ' + a.notes : ''}`);
  const text = encodeURIComponent(`${a.name} — ${svcLabel}`);
  const loc = encodeURIComponent(a.address || '');
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${fmt(start)}/${fmt(end)}&details=${details}&location=${loc}`;
}

// A proper .ics file (not just a Google Calendar link) so the reminder becomes a
// real event in whatever calendar app is default on her phone, with a 30-minute-
// before alarm baked in -- this is what actually rings/notifies at the OS level,
// which a website by itself cannot do without her explicitly adding it once.
function buildIcs(a){
  const start = toDateObj(a.date, a.time);
  const end = new Date(start.getTime() + state.businessProfile.appointmentDurationMin * 60000);
  const fmtUtc = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  const icsEsc = s => String(s || '').replace(/([,;])/g, '\\$1').replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SAMakeovers//Appointments//EN',
    'BEGIN:VEVENT',
    `UID:${a.id}@samakeovers-appointments`,
    `DTSTAMP:${fmtUtc(new Date())}`,
    `DTSTART:${fmtUtc(start)}`,
    `DTEND:${fmtUtc(end)}`,
    `SUMMARY:${icsEsc(a.name)} — ${icsEsc(serviceLabel(a) || 'Appointment')}`,
    a.address ? `LOCATION:${icsEsc(a.address)}` : '',
    a.notes ? `DESCRIPTION:${icsEsc(a.notes)}` : '',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Appointment reminder',
    'TRIGGER:-PT30M',
    'END:VALARM',
    'BEGIN:VALARM',
    'ACTION:AUDIO',
    'TRIGGER:-PT30M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean).join('\r\n');
}

// Day-availability view: a coarse hour-by-hour picture of a given date so she can
// tell a caller what's free while still on the phone with them. Slots use the same
// 1-hour granularity as the existing overlap-conflict check elsewhere in the app
// (appointments don't carry a duration field, so an hour block per booking is the
// same approximation already used for conflict detection).
function getDaySchedule(appointments, dateStr){
  if (!dateStr) return [];
  const bookedByHour = new Map();
  appointments.forEach(a => {
    if (a.status === 'cancelled' || !a.date || !a.time || a.date !== dateStr) return;
    const hour = +a.time.split(':')[0];
    if (!bookedByHour.has(hour)) bookedByHour.set(hour, a);
  });
  const slots = [];
  for (let h = state.businessProfile.hoursStart; h < state.businessProfile.hoursEnd; h++) {
    const booked = bookedByHour.get(h);
    slots.push({
      timeLabel: fmtTimeLabel(`${pad(h)}:00`),
      timeValue: `${pad(h)}:00`,
      booked: booked ? { id: booked.id, name: booked.name, service: serviceLabel(booked) } : null
    });
  }
  return slots;
}

// Month calendar grid: a flat array of cells (padded with the tail of the
// previous month and the head of the next so every row has 7 days), so she
// can glance at a whole month and see which days already have bookings
// before deciding whether to offer a new client a date.
function getMonthGrid(year, month, appointments, blockedDates){
  // month is 1-indexed
  const bookedDates = new Set();
  appointments.forEach(a => { if (a.status !== 'cancelled' && a.date) bookedDates.add(a.date); });
  const blockedSet = new Set((blockedDates || []).map(b => b.date));
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;

  const startDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;

  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(year, month - 1, 1 - startDow + i);
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    cells.push({
      dateStr,
      dayNum: d.getDate(),
      inMonth: d.getMonth() === month - 1,
      hasBookings: bookedDates.has(dateStr),
      isBlocked: blockedSet.has(dateStr),
      isToday: dateStr === todayStr
    });
  }
  return cells;
}

// Distinct past/repeat clients, most-recently-booked first, for quick-fill on
// the Add screen and "Book again" on a concluded appointment. Deduped by
// phone (falling back to name for records with no phone) so the same client
// booked under slightly different name spellings still collapses to one entry
// as long as the phone number matches.
function getRecentClients(appointments, limit){
  const byClient = new Map();
  appointments.forEach(a => {
    const key = ((a.phone || a.name || '') + '').toLowerCase().trim();
    if (!key) return;
    const t = a.date ? toDateObj(a.date, a.time || '00:00').getTime() : 0;
    const existing = byClient.get(key);
    if (!existing || t > existing._t) {
      byClient.set(key, { name: a.name || '', phone: a.phone || '', address: a.address || '', services: serviceList(a), _t: t });
    }
  });
  return [...byClient.values()].sort((a,b) => b._t - a._t).slice(0, limit);
}

// Price fields only checked "not empty," never "is actually a number" -- a
// typo like "250 cash" would save fine and then silently compute as $0 in
// every revenue total from then on, with no error ever shown. Empty is still
// fine wherever price is optional.
function isValidPrice(v){
  if (!v) return true;
  return /^\d+(\.\d{1,2})?$/.test(String(v).trim());
}

// Two different clients can easily share a first name (or full name) --
// showing the phone alongside it everywhere a name is used to pick/identify
// someone (not just where full contact details are already listed) means
// there's never an ambiguous "which Priya is this?" moment.
function clientLabel(name, phone){
  if (name && phone) return `${name} (${phone})`;
  return name || phone || '';
}

// Canonical client directory, separate from the appointments list, so a
// client's contact info and marketing-consent flag survive independently of
// any one booking (and aren't lost/duplicated across repeat visits). Matched
// by digits-only phone first (same normalization as search), falling back to
// name for the rare no-phone entry. Never touches an existing `consent` flag.
function upsertClient(list, { name, phone, address }){
  if (!name && !phone) return list;
  const digits = (phone || '').replace(/\D/g, '');
  const key = digits || (name || '').toLowerCase().trim();
  if (!key) return list;
  const keyOf = c => (c.phone || '').replace(/\D/g, '') || (c.name || '').toLowerCase().trim();
  const idx = list.findIndex(c => keyOf(c) === key);
  const now = Date.now();
  if (idx === -1) {
    return [...list, { id: uid('c'), name: name || '', phone: phone || '', address: address || '', consent: false, updatedAt: now }];
  }
  const copy = list.slice();
  copy[idx] = { ...copy[idx], name: name || copy[idx].name, phone: phone || copy[idx].phone, address: address || copy[idx].address, updatedAt: now };
  return copy;
}

// Ensures every appointment is represented in the client directory. Run this
// every time the appointment list changes shape from underneath the client
// list (on load, and after a cloud merge) rather than relying on a one-time
// backfill -- a one-time backfill can run before a full appointment history
// has synced in from another device, permanently missing everyone who wasn't
// locally cached yet at that exact moment. Safe to re-run: it never touches
// an existing client's consent flag, and never resurrects a merged-away
// client since their appointments were reassigned to the kept identity.
function reconcileClientsFromAppointments(clients, appointments){
  const byRecency = [...appointments].sort((a,b) =>
    (a.date ? toDateObj(a.date, a.time || '00:00').getTime() : 0) - (b.date ? toDateObj(b.date, b.time || '00:00').getTime() : 0)
  );
  let result = clients;
  byRecency.forEach(a => { result = upsertClient(result, { name: a.name, phone: a.phone, address: a.address }); });
  return result;
}

function isDateBlocked(blockedDates, dateStr){
  return blockedDates.find(b => b.date === dateStr) || null;
}

// ---- Icons ----
const ICON_GEAR = '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>';
const ICON_CALENDAR = '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
const ICON_WARNING = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>';
const ICON_HOME = '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin:0 auto"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>';
const ICON_SEARCH = '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin:0 auto"><circle cx="11" cy="11" r="7"/><path d="m20 20-3-3"/></svg>';
const ICON_PLUS = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>';
const ICON_CHART = '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin:0 auto"><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-6"/></svg>';
const ICON_BOX = '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin:0 auto"><path d="M21 8L12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>';
const ICON_GOOGLE = '<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h11.8c-.5 2.7-2 5-4.3 6.6v5.5h7C42.6 37.5 45.1 31.5 45.1 24.5z"/><path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.4l-7-5.5c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.6-3.9-12.4-9.1H4.3v5.7C7.9 41 15.4 46 24 46z"/><path fill="#FBBC05" d="M11.6 28.1c-.5-1.3-.7-2.7-.7-4.1s.3-2.8.7-4.1v-5.7H4.3C2.8 17.1 2 20.5 2 24s.8 6.9 2.3 9.8l7.3-5.7z"/><path fill="#EA4335" d="M24 10.7c3.2 0 6.1 1.1 8.4 3.3l6.2-6.2C34.9 4.2 29.9 2 24 2 15.4 2 7.9 7 4.3 14.2l7.3 5.7c1.8-5.2 6.6-9.2 12.4-9.2z"/></svg>';

// ---- State ----
const state = {
  appointments: [],
  screen: 'home',
  addTab: 'manual',
  // Not emptyForm() here -- it reads state.businessProfile.defaultAddress,
  // and `state` itself hasn't finished being constructed yet at this point
  // (referencing it would throw). loadPersisted() calls emptyForm() again
  // once businessProfile is loaded/corrected, before anything is rendered.
  form: { name:'', phone:'', services:[], date:'', time:'', address:'', price:'', notes:'' },
  pasteText: '',
  search: '',
  detailId: null,
  toast: null,
  ocrStatus: null,
  backupStatus: null,
  lastBackupAt: null,
  cloudReady: false,
  cloudUser: null,
  authEmail: '',
  authPassword: '',
  authMode: 'signin',
  authConsent: false,
  awaitingOnboarding: false,
  onboardingForm: null,
  subscription: null, // { status: 'trialing'|'active'|'past_due'|'canceled' } once wired to Stripe; null = unknown/not loaded yet
  cloudStatus: null,
  pushStatus: null,
  pushToken: null,
  logPast: false,
  completingId: null,
  pendingPrice: '',
  pendingPaymentMethod: '',
  reschedulingId: null,
  resDate: '', resTime: '',
  editingId: null,
  editForm: emptyEditForm(),
  inventory: [],
  invName: '', invQty: '', invThreshold: '', invUnit: '',
  services: [],
  newServiceName: '',
  calendarMonth: `${new Date().getFullYear()}-${pad(new Date().getMonth()+1)}`,
  calendarSelectedDate: null,
  clients: [],
  addingClient: false,
  newClientForm: { name: '', phone: '', address: '' },
  mergingClientId: null,
  mergeTargetId: null,
  viewingClientId: null,
  blockedDates: [],
  businessProfile: { ...DEFAULT_BUSINESS_PROFILE },
  // How many rows of each growing list to show before a "Show more" button --
  // otherwise these all grow unbounded as the business accumulates history.
  homeUpcomingVisible: PAGE_SIZE,
  earningsCompletedVisible: PAGE_SIZE,
  clientsVisible: PAGE_SIZE
};

let auth = null, db = null, fns = null, toastTimer = null;

function setState(patch){
  Object.assign(state, typeof patch === 'function' ? patch(state) : patch);
  render();
}

function loadPersisted(){
  try {
    const raw = localStorage.getItem(LS_KEYS.appointments);
    state.appointments = raw ? JSON.parse(raw) : [];
  } catch(e) { state.appointments = []; }
  try {
    const lb = localStorage.getItem(LS_KEYS.lastBackup);
    if (lb) state.lastBackupAt = +lb;
    const inv = localStorage.getItem(LS_KEYS.inventory);
    state.inventory = inv ? JSON.parse(inv) : [];
    const pushToken = localStorage.getItem(LS_KEYS.pushToken);
    if (pushToken) state.pushToken = pushToken;
  } catch(e) {}
  try {
    const raw = localStorage.getItem(LS_KEYS.services);
    if (raw) {
      state.services = JSON.parse(raw);
    } else {
      state.services = DEFAULT_SERVICES.map((name, i) => ({ id: 'sv_seed_' + i, name, updatedAt: 0 }));
      localStorage.setItem(LS_KEYS.services, JSON.stringify(state.services));
    }
  } catch(e) { state.services = DEFAULT_SERVICES.map((name, i) => ({ id: 'sv_seed_' + i, name, updatedAt: 0 })); }
  try {
    const raw = localStorage.getItem(LS_KEYS.clients);
    const existing = raw ? JSON.parse(raw) : [];
    // Always reconcile against local appointment history (not just on first
    // run) -- see reconcileClientsFromAppointments() for why a one-time-only
    // backfill isn't reliable for a cloud-synced client.
    state.clients = reconcileClientsFromAppointments(existing, state.appointments);
    localStorage.setItem(LS_KEYS.clients, JSON.stringify(state.clients));
  } catch(e) { state.clients = []; }
  try {
    const raw = localStorage.getItem(LS_KEYS.blockedDates);
    state.blockedDates = raw ? JSON.parse(raw) : [];
  } catch(e) { state.blockedDates = []; }
  try {
    const raw = localStorage.getItem(LS_KEYS.businessProfile);
    state.businessProfile = raw ? { ...DEFAULT_BUSINESS_PROFILE, ...JSON.parse(raw) } : { ...DEFAULT_BUSINESS_PROFILE };
  } catch(e) { state.businessProfile = { ...DEFAULT_BUSINESS_PROFILE }; }
  // Safe to build the real default form now -- state.businessProfile is loaded,
  // unlike at the top-level state literal where it doesn't exist yet.
  state.form = emptyForm();
  applyAccentColors(state.businessProfile.accent, state.businessProfile.accentSoft);
  applyFavicon(state.businessProfile.logoDataUrl);
}

function persist(list){
  state.appointments = list;
  try { localStorage.setItem(LS_KEYS.appointments, JSON.stringify(list)); } catch(e) {}
  pushToCloud();
  scheduleRender();
}
function persistInventory(list){
  state.inventory = list;
  try { localStorage.setItem(LS_KEYS.inventory, JSON.stringify(list)); } catch(e) {}
  pushToCloud();
  scheduleRender();
}
function persistServices(list){
  state.services = list;
  try { localStorage.setItem(LS_KEYS.services, JSON.stringify(list)); } catch(e) {}
  pushToCloud();
  scheduleRender();
}
function persistClients(list){
  state.clients = list;
  try { localStorage.setItem(LS_KEYS.clients, JSON.stringify(list)); } catch(e) {}
  pushToCloud();
  scheduleRender();
}
function persistBlockedDates(list){
  state.blockedDates = list;
  try { localStorage.setItem(LS_KEYS.blockedDates, JSON.stringify(list)); } catch(e) {}
  pushToCloud();
  scheduleRender();
}
function persistBusinessProfile(profile){
  profile = { ...profile, updatedAt: Date.now() };
  state.businessProfile = profile;
  try { localStorage.setItem(LS_KEYS.businessProfile, JSON.stringify(profile)); } catch(e) {}
  applyAccentColors(profile.accent, profile.accentSoft);
  applyFavicon(profile.logoDataUrl);
  pushToCloud();
  scheduleRender();
}

// ---- Firebase cloud sync (optional; no-ops until firebase-config.js has real keys) ----
function initCloud(){
  const cfg = self.OPENBOOKER_FIREBASE_CONFIG;
  if (!cfg || cfg.apiKey === 'PASTE_API_KEY_HERE' || typeof firebase === 'undefined') return;
  try {
    if (!firebase.apps.length) firebase.initializeApp(cfg);
    auth = firebase.auth();
    db = firebase.firestore();
    fns = firebase.functions();
    state.cloudReady = true;
    auth.onAuthStateChanged(user => {
      setState({ cloudUser: user ? user.email : null });
      if (user) {
        pullFromCloud(user.uid);
        // Realtime (not a one-shot read) so the paywall clears the instant a
        // Stripe webhook confirms payment, without needing a manual refresh.
        // Client can only ever READ this doc -- see firestore.rules -- a
        // trusted server (the webhook) is the only writer.
        db.collection('subscriptions').doc(user.uid).onSnapshot(
          doc => setState({ subscription: doc.exists ? doc.data() : null }),
          () => setState({ subscription: null })
        );
      }
    });
  } catch(e) { state.cloudStatus = 'Cloud backup could not start.'; }
}
function pullFromCloud(uid){
  db.collection('users').doc(uid).get().then(doc => {
    if (doc.exists && Array.isArray(doc.data().appointments)) {
      const d = doc.data();
      // Merge rather than overwrite: a cloud snapshot pulled on sign-in must never
      // silently discard appointments/inventory/services added locally while offline
      // or signed out. See mergeById() above for the merge rule.
      const appointments = mergeById(state.appointments, d.appointments);
      const inventory = mergeById(state.inventory, Array.isArray(d.inventory) ? d.inventory : []);
      const services = mergeById(state.services, Array.isArray(d.services) ? d.services : []);
      // Merge whatever client records exist on both sides, then top up against
      // the now-fuller appointment list -- catches anyone missed by an earlier
      // backfill that ran before this device had the full history synced in.
      const mergedClients = mergeById(state.clients, Array.isArray(d.clients) ? d.clients : []);
      const clients = reconcileClientsFromAppointments(mergedClients, appointments);
      const blockedDates = mergeById(state.blockedDates, Array.isArray(d.blockedDates) ? d.blockedDates : []);
      // Not an array -- a single settings object, so "newer updatedAt wins"
      // rather than the record-list merge rule used above.
      const businessProfile = mergeSingleton(state.businessProfile, d.businessProfile);
      state.appointments = appointments;
      state.inventory = inventory;
      state.services = services;
      state.clients = clients;
      state.blockedDates = blockedDates;
      state.businessProfile = businessProfile;
      try {
        localStorage.setItem(LS_KEYS.appointments, JSON.stringify(appointments));
        localStorage.setItem(LS_KEYS.inventory, JSON.stringify(inventory));
        localStorage.setItem(LS_KEYS.services, JSON.stringify(services));
        localStorage.setItem(LS_KEYS.clients, JSON.stringify(clients));
        localStorage.setItem(LS_KEYS.blockedDates, JSON.stringify(blockedDates));
        localStorage.setItem(LS_KEYS.businessProfile, JSON.stringify(businessProfile));
      } catch(e) {}
      applyAccentColors(businessProfile.accent, businessProfile.accentSoft);
      applyFavicon(businessProfile.logoDataUrl);
      // Push the reconciled result back up so both sides converge on the same data.
      pushToCloud();
      setState({ cloudStatus: 'Synced from cloud.' });
    } else if ((state.businessProfile.name && state.businessProfile.name.trim()) || state.appointments.length > 0) {
      // No cloud doc yet under this account, but this device already has real
      // local data -- e.g. an existing installer signing in for the first time
      // now that accounts are mandatory, migrating onto this account rather
      // than starting fresh. Sync what's already here instead of showing the
      // onboarding wizard as if this were a blank slate.
      setState({ cloudStatus: 'Setting up your account…' });
      pushToCloud();
    } else {
      // Genuinely brand new tenant -- deliberately do NOT push anything yet.
      // Pushing here would silently seed this account with whatever
      // DEFAULT_BUSINESS_PROFILE/DEFAULT_SERVICES happen to be, instead of the
      // business's real details. The onboarding wizard's first
      // persistBusinessProfile() call is what performs this tenant's real
      // first write.
      setState({
        awaitingOnboarding: true,
        onboardingForm: {
          name: '', tagline: '', location: '', defaultAddress: '',
          currency: DEFAULT_BUSINESS_PROFILE.currency,
          hoursStart: DEFAULT_BUSINESS_PROFILE.hoursStart,
          hoursEnd: DEFAULT_BUSINESS_PROFILE.hoursEnd,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_BUSINESS_PROFILE.timezone
        },
        cloudStatus: 'Let’s set up your business.'
      });
    }
  }).catch(() => setState({ cloudStatus: 'Could not reach cloud backup.' }));
}
function pushToCloud(){
  if (!db || !auth.currentUser) return;
  db.collection('users').doc(auth.currentUser.uid).set({
    appointments: state.appointments, inventory: state.inventory, services: state.services, clients: state.clients,
    blockedDates: state.blockedDates, businessProfile: state.businessProfile, updatedAt: Date.now()
  }).catch(() => {});
}
function cloudSignIn(isSignUp){
  if (!state.authConsent) { setState({ cloudStatus: 'Please agree to the Terms and Privacy Policy first.' }); return; }
  const { authEmail, authPassword } = state;
  if (!authEmail || !authPassword) { setState({ cloudStatus: 'Enter email & password.' }); return; }
  const action = isSignUp ? auth.createUserWithEmailAndPassword(authEmail, authPassword) : auth.signInWithEmailAndPassword(authEmail, authPassword);
  action.then(() => setState({ cloudStatus: 'Signed in — syncing…', authPassword: '' }))
    .catch(err => setState({ cloudStatus: err.message }));
}
function cloudSignInGoogle(){
  if (!state.authConsent) { setState({ cloudStatus: 'Please agree to the Terms and Privacy Policy first.' }); return; }
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider)
    .then(() => setState({ cloudStatus: 'Signed in — syncing…' }))
    .catch(err => setState({ cloudStatus: err.message }));
}
function cloudSignOut(){
  auth.signOut().then(() => setState({ cloudStatus: 'Signed out. Data stays on this phone.' }));
}

// ---- Stripe billing (Checkout for a new subscription, Billing Portal for
// self-serve manage/cancel) -- both just redirect to a Stripe-hosted page; no
// payment form is ever handled directly by this app. ----
function startCheckout(){
  if (!fns) { showToast('Billing isn’t set up yet.'); return; }
  showToast('Redirecting to checkout…');
  const returnUrl = window.location.origin + window.location.pathname;
  fns.httpsCallable('createCheckoutSession')({ successUrl: returnUrl, cancelUrl: returnUrl })
    .then(res => { window.location.assign(res.data.url); })
    .catch(err => showToast(err.message || 'Could not start checkout.'));
}
function openBillingPortal(){
  if (!fns) { showToast('Billing isn’t set up yet.'); return; }
  showToast('Opening billing portal…');
  const returnUrl = window.location.origin + window.location.pathname;
  fns.httpsCallable('createPortalSession')({ returnUrl })
    .then(res => { window.location.assign(res.data.url); })
    .catch(err => showToast(err.message || 'Could not open billing portal.'));
}

// ---- Push notifications (automatic 30-min-before reminders) ----
// Requires being signed in (the reminder is sent server-side by a Cloud Function
// reading her Firestore doc, so the device needs a registered FCM token there).
function pushSupported(){
  // Basic feature detection only -- firebase.messaging.isSupported() returns a
  // Promise in this SDK version, so it can't be checked synchronously here;
  // an actually-unsupported environment will surface a clear error from
  // getToken() below instead, which is already caught and shown.
  return 'Notification' in window && 'serviceWorker' in navigator && typeof firebase !== 'undefined' && !!firebase.messaging;
}
function enablePushReminders(){
  if (!auth || !auth.currentUser) { setState({ pushStatus: 'Sign in above first — reminders are sent based on your synced data.' }); return; }
  if (!pushSupported()) { setState({ pushStatus: 'Push notifications are not supported in this browser.' }); return; }
  if (VAPID_KEY === 'PASTE_VAPID_KEY_HERE') { setState({ pushStatus: 'Not set up yet -- missing VAPID key.' }); return; }
  setState({ pushStatus: 'Requesting permission…' });
  Notification.requestPermission().then(permission => {
    if (permission !== 'granted') { setState({ pushStatus: 'Permission denied — enable notifications for this app in your phone settings.' }); return; }
    const messaging = firebase.messaging();
    navigator.serviceWorker.ready.then(registration =>
      messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: registration })
    ).then(token => {
      if (!token) { setState({ pushStatus: 'Could not get a reminder token — try again.' }); return; }
      return db.collection('users').doc(auth.currentUser.uid).set(
        { fcmTokens: firebase.firestore.FieldValue.arrayUnion(token) }, { merge: true }
      ).then(() => {
        try { localStorage.setItem(LS_KEYS.pushToken, token); } catch(e) {}
        setState({ pushToken: token, pushStatus: 'Automatic reminders are on for this phone.' });
      });
    }).catch(err => setState({ pushStatus: 'Could not enable reminders: ' + err.message }));
  }).catch(err => setState({ pushStatus: 'Could not request permission: ' + err.message }));
}
function disablePushReminders(){
  const token = state.pushToken;
  try { localStorage.removeItem(LS_KEYS.pushToken); } catch(e) {}
  setState({ pushToken: null, pushStatus: 'Automatic reminders turned off for this phone.' });
  if (token && auth && auth.currentUser && db) {
    db.collection('users').doc(auth.currentUser.uid).set(
      { fcmTokens: firebase.firestore.FieldValue.arrayRemove(token) }, { merge: true }
    ).catch(() => {});
  }
}

// ---- Feature actions ----
function showToast(msg){
  setState({ toast: msg });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setState({ toast: null }), 2200);
}

function saveAppointment(){
  const f = state.form;
  if (!f.name || !f.date || !f.time) { showToast('Please add name, date & time'); return; }
  if (!isValidPrice(f.price)) { showToast('Price should be a plain number, e.g. 250'); return; }
  if (state.logPast && (!f.price || !state.pendingPaymentMethod)) { showToast('Add the price & payment method to log this visit'); return; }
  const wasLogPast = state.logPast;
  const id = uid('a');
  const record = wasLogPast
    ? { id, status: 'done', paymentMethod: state.pendingPaymentMethod, ...f, updatedAt: Date.now() }
    : { id, status: 'upcoming', ...f, updatedAt: Date.now() };
  const list = [...state.appointments, record];
  persist(list);
  persistClients(upsertClient(state.clients, { name: f.name, phone: f.phone, address: f.address }));
  setState({ form: emptyForm(), pasteText: '', screen: 'home', addTab: 'manual', logPast: false, pendingPaymentMethod: '' });
  showToast(wasLogPast ? 'Past visit logged' : 'Appointment saved');
}

// Two client records that turned out to be the same person (typo'd name, a
// number saved two different ways, etc.) -- `keepId` survives, `absorbId` is
// removed. Every appointment that matched the absorbed identity gets its
// name/phone rewritten to the kept client's, so history consolidates under
// one entry instead of splitting the same person across two rows.
function mergeClientsAction(keepId, absorbId){
  const clients = state.clients;
  const keep = clients.find(c => c.id === keepId);
  const absorb = clients.find(c => c.id === absorbId);
  if (!keep || !absorb || keep.id === absorb.id) return;

  const keyOf = c => (c.phone || '').replace(/\D/g, '') || (c.name || '').toLowerCase().trim();
  const absorbKey = keyOf(absorb);
  const apptKeyOf = a => (a.phone || '').replace(/\D/g, '') || (a.name || '').toLowerCase().trim();

  const updatedAppointments = state.appointments.map(a => {
    if (apptKeyOf(a) !== absorbKey) return a;
    return { ...a, name: keep.name || a.name, phone: keep.phone || a.phone, updatedAt: Date.now() };
  });

  const mergedClient = {
    ...keep,
    address: keep.address || absorb.address,
    consent: keep.consent || absorb.consent, // preserve an existing yes rather than risk losing it
    updatedAt: Date.now()
  };
  const updatedClients = clients.filter(c => c.id !== absorbId).map(c => c.id === keepId ? mergedClient : c);

  persist(updatedAppointments);
  persistClients(updatedClients);
}

function addInventoryItem(){
  const { invName, invQty, invThreshold, invUnit } = state;
  if (!invName) { showToast('Enter an item name'); return; }
  const item = { id: uid('i'), name: invName, qty: +invQty || 0, threshold: +invThreshold || 0, unit: invUnit || '', updatedAt: Date.now() };
  persistInventory([...state.inventory, item]);
  setState({ invName: '', invQty: '', invThreshold: '', invUnit: '' });
  showToast('Item added');
}
function adjustQty(id, delta){
  const list = state.inventory.map(i => i.id === id ? { ...i, qty: Math.max(0, i.qty + delta), updatedAt: Date.now() } : i);
  persistInventory(list);
}
function deleteInventoryItem(id){
  persistInventory(state.inventory.filter(i => i.id !== id));
}

function exportBackup(){
  try {
    // Everything, not just appointments -- inventory, the custom service list,
    // and the client directory (with consent flags) are just as important to
    // survive a phone loss/reset as the bookings themselves.
    const payload = {
      appointments: state.appointments,
      inventory: state.inventory,
      services: state.services,
      clients: state.clients,
      exportedAt: Date.now()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `asha-appointments-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    const now = Date.now();
    try { localStorage.setItem(LS_KEYS.lastBackup, String(now)); } catch(e) {}
    setState({ backupStatus: 'Backup downloaded to your phone.', lastBackupAt: now });
  } catch(e) { setState({ backupStatus: 'Could not export backup.' }); }
}
function importBackupFile(file){
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (Array.isArray(data)) {
        // Backward compatible with backup files from before this covered
        // more than appointments.
        persist(data);
        setState({ backupStatus: `Restored ${data.length} appointment(s). (Older backup format -- inventory/services/clients weren't included in it.)` });
        return;
      }
      if (!data || !Array.isArray(data.appointments)) throw new Error('bad format');
      persist(data.appointments);
      if (Array.isArray(data.inventory)) persistInventory(data.inventory);
      if (Array.isArray(data.services)) persistServices(data.services);
      if (Array.isArray(data.clients)) persistClients(data.clients);
      setState({ backupStatus: `Restored ${data.appointments.length} appointment(s), ${(data.inventory||[]).length} stock item(s), ${(data.clients||[]).length} client(s).` });
    } catch(e) { setState({ backupStatus: 'That file could not be read as a backup.' }); }
  };
  reader.readAsText(file);
}

function onScreenshotFile(file){
  if (!file || typeof Tesseract === 'undefined') { setState({ ocrStatus: 'Could not read image — try pasting the text instead.' }); return; }
  setState({ ocrStatus: 'Reading screenshot…' });
  Tesseract.recognize(file, 'eng').then(({ data: { text } }) => {
    const form = parseChatText(text, state.form, state.services.map(s => s.name));
    setState({ pasteText: text, ocrStatus: 'Read successfully — review the fields below.', addTab: 'manual', form });
    showToast('Parsed — please check the details below');
  }).catch(() => setState({ ocrStatus: 'Could not read that image — try a clearer screenshot.' }));
}

// Auto-crops whatever she uploads to a centered square and downsizes it to a
// fixed resolution -- no drag/pinch crop UI, just fit-and-crop, so a logo that's
// already roughly square looks right and a wider photo loses its edges instead
// of stretching.
function onLogoFile(file){
  if (!file || !file.type || file.type.indexOf('image/') !== 0) { showToast('Please choose an image file.'); return; }
  const reader = new FileReader();
  reader.onerror = () => showToast('Could not read that image.');
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => showToast('Could not read that image.');
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = LOGO_SIZE_PX; canvas.height = LOGO_SIZE_PX;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, side, side, 0, 0, LOGO_SIZE_PX, LOGO_SIZE_PX);
      const dataUrl = canvas.toDataURL('image/png');
      persistBusinessProfile({ ...state.businessProfile, logoDataUrl: dataUrl });
      showToast('Logo updated');
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

const Actions = {
  goHome: () => setState({ screen: 'home' }),
  goBack: () => setState({ screen: 'home', detailId: null }),
  goAdd: () => setState({ screen: 'add' }),
  goSearch: () => setState({ screen: 'search', viewingClientId: null }),
  goEarnings: () => setState({ screen: 'earnings' }),
  goInventory: () => setState({ screen: 'inventory' }),
  goSettings: () => setState({ screen: 'settings' }),

  goCalendar: () => setState({ screen: 'calendar' }),
  calendarPrevMonth: () => setState(s => {
    const [y, m] = s.calendarMonth.split('-').map(Number);
    const prev = new Date(y, m - 2, 1);
    return { calendarMonth: `${prev.getFullYear()}-${pad(prev.getMonth()+1)}` };
  }),
  calendarNextMonth: () => setState(s => {
    const [y, m] = s.calendarMonth.split('-').map(Number);
    const next = new Date(y, m, 1);
    return { calendarMonth: `${next.getFullYear()}-${pad(next.getMonth()+1)}` };
  }),
  calendarSelectDay: (id, value) => setState({ calendarSelectedDate: value }),
  calendarPickSlot: (id, value) => setState(s => ({ screen: 'add', form: { ...s.form, date: s.calendarSelectedDate, time: value } })),
  goAddFromCalendar: () => setState(s => ({ screen: 'add', form: { ...s.form, date: s.calendarSelectedDate } })),
  toggleDayOff: () => {
    const date = state.calendarSelectedDate;
    if (!date) return;
    const existing = isDateBlocked(state.blockedDates, date);
    if (existing) {
      persistBlockedDates(state.blockedDates.filter(b => b.id !== existing.id));
      showToast('Day marked available again');
    } else {
      persistBlockedDates([...state.blockedDates, { id: uid('bd'), date, updatedAt: Date.now() }]);
      showToast('Day marked off');
    }
  },

  openAppt: (id) => setState({ screen: 'detail', detailId: id }),

  setTabManual: () => setState({ addTab: 'manual' }),
  setTabPaste: () => setState({ addTab: 'paste' }),
  setTabScreenshot: () => setState({ addTab: 'screenshot', ocrStatus: null }),

  onParse: () => {
    const form = parseChatText(state.pasteText || '', state.form, state.services.map(s => s.name));
    setState({ form, addTab: 'manual' });
    showToast('Parsed — please check the details below');
  },

  toggleLogPast: () => setState({ logPast: !state.logPast }),
  selectPayment: (id, value) => setState({ pendingPaymentMethod: value }),
  onSave: () => saveAppointment(),
  toggleFormService: (id, value) => setState(s => ({
    form: { ...s.form, services: s.form.services.includes(value) ? s.form.services.filter(x => x !== value) : [...s.form.services, value] }
  })),
  pickRecentClient: (id) => {
    const client = getRecentClients(state.appointments, 8)[+id];
    if (!client) return;
    setState(s => ({ form: { ...s.form, name: client.name, phone: client.phone, address: client.address, services: [...client.services] } }));
  },
  // Autocomplete match while typing a name on the Add screen -- fills in
  // their known phone/address from the client directory (not services,
  // which are per-visit, not per-client).
  pickNameMatch: (id) => {
    const client = state.clients.find(c => c.id === id);
    if (!client) return;
    setState(s => ({ form: { ...s.form, name: client.name, phone: client.phone, address: client.address || s.form.address } }));
  },
  showMoreUpcoming: () => setState(s => ({ homeUpcomingVisible: s.homeUpcomingVisible + PAGE_SIZE })),
  showMoreCompleted: () => setState(s => ({ earningsCompletedVisible: s.earningsCompletedVisible + PAGE_SIZE })),
  showMoreClients: () => setState(s => ({ clientsVisible: s.clientsVisible + PAGE_SIZE })),
  bookAgain: () => {
    const a = state.appointments.find(x => x.id === state.detailId);
    if (!a) return;
    setState({
      screen: 'add', addTab: 'manual', detailId: null,
      // date/time deliberately blank here, unlike a fresh emptyForm() -- a
      // repeat booking is a new future slot to pick, not "right now".
      form: { ...emptyForm(), date: '', time: '', name: a.name || '', phone: a.phone || '', address: a.address || '', services: serviceList(a) }
    });
  },
  pickSlotTime: (id, value) => setState(s => ({ form: { ...s.form, time: value } })),
  toggleClientConsent: (id) => {
    persistClients(state.clients.map(c => c.id === id ? { ...c, consent: !c.consent, updatedAt: Date.now() } : c));
  },
  viewClientHistory: (id) => setState({ viewingClientId: id }),
  backFromClientHistory: () => setState({ viewingClientId: null }),

  openAddClient: () => setState({ addingClient: true, newClientForm: { name: '', phone: '', address: '' } }),
  cancelAddClient: () => setState({ addingClient: false }),
  confirmAddClient: () => {
    const f = state.newClientForm;
    if (!f.name && !f.phone) { showToast('Enter a name or phone number'); return; }
    persistClients([...state.clients, { id: uid('c'), name: f.name, phone: f.phone, address: f.address, consent: false, updatedAt: Date.now() }]);
    setState({ addingClient: false });
    showToast('Client added');
  },

  startMergeClient: (id) => setState({ mergingClientId: id, mergeTargetId: null }),
  cancelMerge: () => setState({ mergingClientId: null, mergeTargetId: null }),
  selectMergeTarget: (id) => setState({ mergeTargetId: id }),
  confirmMerge: () => {
    const { mergingClientId, mergeTargetId } = state;
    if (!mergingClientId || !mergeTargetId) return;
    mergeClientsAction(mergeTargetId, mergingClientId);
    setState({ mergingClientId: null, mergeTargetId: null });
    showToast('Clients merged');
  },

  downloadIcs: (id) => {
    const a = state.appointments.find(x => x.id === id);
    if (!a || !a.date || !a.time) return;
    const ics = buildIcs(a);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(a.name || 'appointment').replace(/[^a-z0-9]+/gi, '-')}.ics`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast('Reminder file downloaded — open it to add to your phone calendar');
  },

  openComplete: () => {
    const id = state.detailId;
    const a = state.appointments.find(x => x.id === id);
    setState({ completingId: id, pendingPrice: (a && a.price) || '', pendingPaymentMethod: (a && a.paymentMethod) || '' });
  },
  cancelComplete: () => setState({ completingId: null }),
  confirmComplete: () => {
    const { completingId, pendingPrice, pendingPaymentMethod } = state;
    if (!pendingPrice || !pendingPaymentMethod) { showToast('Enter the price and payment method to complete'); return; }
    if (!isValidPrice(pendingPrice)) { showToast('Price should be a plain number, e.g. 250'); return; }
    const list = state.appointments.map(a => a.id === completingId ? { ...a, status: 'done', price: pendingPrice, paymentMethod: pendingPaymentMethod, updatedAt: Date.now() } : a);
    persist(list);
    setState({ completingId: null, pendingPrice: '', pendingPaymentMethod: '' });
    showToast('Marked as completed');
  },

  openReschedule: () => {
    const id = state.detailId;
    const a = state.appointments.find(x => x.id === id);
    setState({ reschedulingId: id, resDate: a.date, resTime: a.time });
  },
  cancelReschedule: () => setState({ reschedulingId: null }),
  confirmReschedule: () => {
    const { reschedulingId, resDate, resTime } = state;
    if (!resDate || !resTime) { showToast('Pick a new date & time'); return; }
    const list = state.appointments.map(a => {
      if (a.id !== reschedulingId) return a;
      const history = [...(a.history || []), { date: a.date, time: a.time }];
      // Reset so the reminder function sends a fresh 30-min notice for the new
      // time -- otherwise a reminder already sent for the old slot would
      // wrongly suppress the one for the new slot.
      return { ...a, date: resDate, time: resTime, history, updatedAt: Date.now(), reminderSent: false };
    });
    persist(list);
    setState({ reschedulingId: null });
    showToast('Appointment rescheduled');
  },

  onCancelAppt: () => {
    const list = state.appointments.map(a => a.id === state.detailId ? { ...a, status: 'cancelled', updatedAt: Date.now() } : a);
    persist(list);
    setState({ screen: 'home', detailId: null });
    showToast('Appointment cancelled');
  },
  onNoShow: () => {
    const list = state.appointments.map(a => a.id === state.detailId ? { ...a, status: 'no-show', updatedAt: Date.now() } : a);
    persist(list);
    setState({ screen: 'home', detailId: null });
    showToast('Marked as no-show');
  },
  deleteAppt: () => {
    const a = state.appointments.find(x => x.id === state.detailId);
    const label = a ? `${a.name || 'this appointment'}${a.date ? ' on ' + fmtDateLabel(a.date) : ''}` : 'this appointment';
    if (!confirm(`Delete ${label}? This can't be undone.`)) return;
    persist(state.appointments.filter(a => a.id !== state.detailId));
    setState({ screen: 'home', detailId: null });
    showToast('Appointment deleted');
  },

  openEdit: () => {
    const id = state.detailId;
    const a = state.appointments.find(x => x.id === id);
    if (!a) return;
    setState({
      editingId: id,
      editForm: {
        name: a.name || '', phone: a.phone || '', services: serviceList(a),
        date: a.date || '', time: a.time || '',
        address: a.address || '', price: a.price || '', paymentMethod: a.paymentMethod || '', notes: a.notes || ''
      }
    });
  },
  cancelEdit: () => setState({ editingId: null }),
  confirmEdit: () => {
    const { editingId, editForm } = state;
    if (!editForm.name || !editForm.date || !editForm.time) { showToast('Name, date & time are required'); return; }
    if (!isValidPrice(editForm.price)) { showToast('Price should be a plain number, e.g. 250'); return; }
    const list = state.appointments.map(a => {
      if (a.id !== editingId) return a;
      const dateTimeChanged = a.date !== editForm.date || a.time !== editForm.time;
      // Keep the same reschedule-history trail the dedicated Reschedule button
      // uses, so editing the date/time here behaves identically either way.
      const history = dateTimeChanged ? [...(a.history || []), { date: a.date, time: a.time }] : a.history;
      return { ...a, ...editForm, history, updatedAt: Date.now(), reminderSent: dateTimeChanged ? false : a.reminderSent };
    });
    persist(list);
    persistClients(upsertClient(state.clients, { name: editForm.name, phone: editForm.phone, address: editForm.address }));
    setState({ editingId: null });
    showToast('Details updated');
  },
  selectEditPayment: (id, value) => setState(s => ({ editForm: { ...s.editForm, paymentMethod: value } })),
  toggleEditService: (id, value) => setState(s => ({
    editForm: { ...s.editForm, services: s.editForm.services.includes(value) ? s.editForm.services.filter(x => x !== value) : [...s.editForm.services, value] }
  })),

  onAddInventory: () => addInventoryItem(),
  incQty: (id) => adjustQty(id, 1),
  decQty: (id) => adjustQty(id, -1),
  deleteInvItem: (id) => {
    const item = state.inventory.find(i => i.id === id);
    if (!confirm(`Remove "${item ? item.name : 'this item'}" from inventory?`)) return;
    deleteInventoryItem(id);
  },

  onAddService: () => {
    const name = (state.newServiceName || '').trim();
    if (!name) { showToast('Enter a service name'); return; }
    persistServices([...state.services, { id: uid('sv'), name, updatedAt: Date.now() }]);
    setState({ newServiceName: '' });
    showToast('Service added');
  },
  deleteService: (id) => {
    const sv = state.services.find(s => s.id === id);
    if (!confirm(`Remove "${sv ? sv.name : 'this service'}" from your services list? Past appointments keep their recorded service name either way.`)) return;
    persistServices(state.services.filter(s => s.id !== id));
    showToast('Service removed');
  },

  onExport: () => exportBackup(),

  setAuthSignin: () => setState({ authMode: 'signin' }),
  setAuthSignup: () => setState({ authMode: 'signup' }),
  onCloudSubmit: () => cloudSignIn(state.authMode === 'signup'),
  onGoogleSignIn: () => cloudSignInGoogle(),
  onCloudSignOut: () => cloudSignOut(),
  onEnablePush: () => enablePushReminders(),
  onDisablePush: () => disablePushReminders(),
  removeLogo: () => {
    persistBusinessProfile({ ...state.businessProfile, logoDataUrl: '' });
    showToast('Logo removed');
  },

  toggleAuthConsent: () => setState({ authConsent: !state.authConsent }),

  submitOnboarding: () => {
    const f = state.onboardingForm;
    const name = (f.name || '').trim();
    if (!name) { showToast('Business name is required'); return; }
    const hoursStart = parseInt(f.hoursStart, 10);
    const hoursEnd = parseInt(f.hoursEnd, 10);
    const profile = {
      ...DEFAULT_BUSINESS_PROFILE,
      name,
      tagline: (f.tagline || '').trim(),
      location: (f.location || '').trim(),
      defaultAddress: (f.defaultAddress || '').trim(),
      currency: (f.currency || '').trim() || DEFAULT_BUSINESS_PROFILE.currency,
      hoursStart: isNaN(hoursStart) ? DEFAULT_BUSINESS_PROFILE.hoursStart : hoursStart,
      hoursEnd: isNaN(hoursEnd) ? DEFAULT_BUSINESS_PROFILE.hoursEnd : hoursEnd,
      timezone: f.timezone || DEFAULT_BUSINESS_PROFILE.timezone,
      onboarded: true
    };
    persistBusinessProfile(profile);
    // The Add screen's blank-form default address is only ever built at boot
    // (see loadPersisted()) -- refresh it now that businessProfile.defaultAddress
    // has a real value, so it doesn't take a page reload to show up there.
    setState({ awaitingOnboarding: false, onboardingForm: null, cloudStatus: 'All set!', form: emptyForm() });
  },

  onSubscribe: () => startCheckout(),
  onManageBilling: () => openBillingPortal()
};

// ---- Computed view-model (mirrors the original renderVals()) ----
function computeVals(){
  const s = state;
  const accent = s.businessProfile.accent, currency = s.businessProfile.currency;
  const upcoming = s.appointments.filter(a => a.status !== 'done' && a.status !== 'cancelled' && a.status !== 'no-show' && a.date).sort((a,b) => toDateObj(a.date,a.time) - toDateObj(b.date,b.time));
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;

  const isOverdue = a => a.status === 'upcoming' && a.date && a.time &&
    (now - toDateObj(a.date, a.time)) > state.businessProfile.appointmentDurationMin * 60000;

  const withMeta = list => list.map(a => ({
    ...a,
    service: serviceLabel(a), // normalized display label -- overrides the raw service/services field so every template reading `.service` works unchanged regardless of which shape the record is in
    dateLabel: fmtDateLabel(a.date),
    timeLabel: fmtTimeLabel(a.time),
    priceLabel: a.price ? `${currency}${a.price}` : '',
    overlap: checkOverlap(s.appointments, a.date, a.time, a.id),
    overdue: isOverdue(a),
    statusLabel: a.status === 'done' ? 'Done' : a.status === 'cancelled' ? 'Cancelled' : a.status === 'no-show' ? 'No-show' : 'Upcoming',
    statusColor: a.status === 'done' ? '#12a457' : a.status === 'cancelled' ? '#7d79a8' : a.status === 'no-show' ? '#c9791a' : accent
  }));

  const todayList = withMeta(upcoming.filter(a => a.date === todayStr));
  const upcomingList = withMeta(upcoming.filter(a => a.date !== todayStr));
  const hasOverlap = todayList.concat(upcomingList).some(a => a.overlap);

  const needsFollowUp = withMeta(upcoming.filter(isOverdue)).sort((a,b) => toDateObj(a.date,a.time) - toDateObj(b.date,b.time));
  const hasNeedsFollowUp = needsFollowUp.length > 0;
  const followUpLabel = needsFollowUp.length === 1
    ? `1 past appointment needs an outcome — did it happen?`
    : `${needsFollowUp.length} past appointments need an outcome — did they happen?`;

  const daysSinceBackup = s.lastBackupAt ? Math.floor((now - s.lastBackupAt) / 86400000) : null;
  const needsBackupNag = (upcoming.length > 0) && (daysSinceBackup === null || daysSinceBackup >= 7);
  const backupNagLabel = daysSinceBackup === null ? "You've never backed up — protect her bookings in 10 seconds." : `Last backup ${daysSinceBackup} day${daysSinceBackup===1?'':'s'} ago — back up again.`;

  const inventoryList = s.inventory.map(i => ({ ...i, lowStock: i.threshold > 0 && i.qty <= i.threshold }));
  const lowStockItems = inventoryList.filter(i => i.lowStock);

  const bufferMin = s.businessProfile.travelBufferMin;
  const nextRaw = upcoming.find(a => !isOverdue(a));
  const nextAppt = nextRaw ? {
    ...withMeta([nextRaw])[0],
    countdown: fmtCountdown(nextRaw.date, nextRaw.time),
    leaveByLabel: fmtLeaveBy(nextRaw.date, nextRaw.time, bufferMin)
  } : null;

  const searchQ = (s.search || '').toLowerCase();

  const completed = s.appointments.filter(a => a.status === 'done');
  const weekAgo = new Date(now.getTime() - 7*86400000);
  const weekTotal = completed.filter(a => a.date && toDateObj(a.date,'00:00') >= weekAgo).reduce((sum,a) => sum + (+a.price || 0), 0);
  // "Completed jobs" below counts every completed job ever, same as the full
  // history list beneath it -- this all-time total keeps the $ figure
  // matching the same scope, instead of only weekTotal (last 7 days) sitting
  // next to a count of everything.
  const allTimeTotal = completed.reduce((sum,a) => sum + (+a.price || 0), 0);
  const completedList = withMeta(completed.sort((a,b) => toDateObj(b.date||'1970-01-01','00:00') - toDateObj(a.date||'1970-01-01','00:00')));

  const noShows = s.appointments.filter(a => a.status === 'no-show');
  const noShowList = withMeta(noShows.sort((a,b) => toDateObj(b.date||'1970-01-01','00:00') - toDateObj(a.date||'1970-01-01','00:00')));
  const noShowsByClient = byKey(noShows, a => a.name).sort((a,b) => b.count - a.count)
    .map(c => ({ label: c.key, sub: `${c.count} no-show${c.count===1?'':'s'}`, valueLabel: `${c.count}` }));

  const topClients = byKey(completed, a => a.name).sort((a,b) => b.revenue - a.revenue).slice(0,5)
    .map(c => ({ label: c.key, sub: `${c.count} visit${c.count===1?'':'s'}`, valueLabel: `${currency}${c.revenue}` }));
  const topServices = byKeyMulti(completed, a => serviceList(a)).sort((a,b) => b.count - a.count).slice(0,5)
    .map(sv => ({ label: sv.key || 'Other', sub: `${currency}${Math.round(sv.revenue)} total`, valueLabel: `${sv.count}×` }));
  const paymentBreakdown = byKey(completed, a => a.paymentMethod).sort((a,b) => b.revenue - a.revenue)
    .map(p => ({ label: p.key || 'Unrecorded', valueLabel: `${currency}${p.revenue}` }));

  const detailRec = s.detailId ? s.appointments.find(a => a.id === s.detailId) : null;
  const detail = detailRec ? {
    ...detailRec,
    service: serviceLabel(detailRec),
    dateLabel: fmtDateLabel(detailRec.date),
    timeLabel: fmtTimeLabel(detailRec.time),
    priceLabel: detailRec.price ? `${currency}${detailRec.price}` : '',
    done: detailRec.status === 'done',
    telLink: `tel:${detailRec.phone || ''}`,
    waLink: `https://wa.me/${(detailRec.phone||'').replace(/\D/g,'')}`,
    mapLink: `https://maps.google.com/?q=${encodeURIComponent(detailRec.address || '')}`,
    gcalLink: gcalLink(detailRec),
    cancelled: detailRec.status === 'cancelled',
    noShow: detailRec.status === 'no-show',
    history: (detailRec.history || []).map(h => ({ dateLabel: fmtDateLabel(h.date), timeLabel: fmtTimeLabel(h.time) }))
  } : {};

  const formOverlapWarning = checkOverlap(s.appointments, s.form.date, s.form.time, null);
  const daySchedule = getDaySchedule(s.appointments, s.form.date);

  const [calYear, calMonthNum] = s.calendarMonth.split('-').map(Number);
  const calendarGrid = getMonthGrid(calYear, calMonthNum, s.appointments, s.blockedDates);
  const calendarDayAppts = s.calendarSelectedDate
    ? withMeta(s.appointments.filter(a => a.date === s.calendarSelectedDate && a.status !== 'cancelled')
        .sort((a,b) => toDateObj(a.date,a.time) - toDateObj(b.date,b.time)))
    : [];
  const calendarDaySchedule = getDaySchedule(s.appointments, s.calendarSelectedDate);
  const calendarSelectedBlocked = s.calendarSelectedDate ? isDateBlocked(s.blockedDates, s.calendarSelectedDate) : null;
  const formDateBlocked = s.form.date ? isDateBlocked(s.blockedDates, s.form.date) : null;

  const recentClients = getRecentClients(s.appointments, 8);

  const clientKeyOf = c => (c.phone || '').replace(/\D/g, '') || (c.name || '').toLowerCase().trim();
  const apptKeyOf = a => (a.phone || '').replace(/\D/g, '') || (a.name || '').toLowerCase().trim();
  const allClients = s.clients.map(c => {
    const key = clientKeyOf(c);
    const theirAppts = s.appointments.filter(a => apptKeyOf(a) === key);
    const totalSpend = theirAppts.filter(a => a.status === 'done').reduce((sum,a) => sum + (+a.price || 0), 0);
    const noShowCount = theirAppts.filter(a => a.status === 'no-show').length;
    const lastVisit = theirAppts.reduce((latest, a) => {
      if (!a.date) return latest;
      const t = toDateObj(a.date, a.time || '00:00').getTime();
      return (!latest || t > latest.t) ? { t, dateLabel: fmtDateLabel(a.date) } : latest;
    }, null);
    return {
      ...c,
      visitCount: theirAppts.length,
      totalSpendLabel: `${currency}${totalSpend}`,
      noShowCount,
      lastVisitLabel: lastVisit ? lastVisit.dateLabel : 'No visits yet'
    };
  }).sort((a,b) => (a.name||'').localeCompare(b.name||''));

  // Drilling into one client's full appointment history (tapped from a search
  // result or the "All clients" list) -- a dedicated view, not the search box
  // reused as a filter, since search now shows one grouped row per client
  // rather than one row per appointment.
  const viewingClient = s.viewingClientId ? allClients.find(c => c.id === s.viewingClientId) : null;
  const viewingClientAppointments = viewingClient
    ? withMeta(s.appointments.filter(a => apptKeyOf(a) === clientKeyOf(viewingClient))
        .sort((a,b) => toDateObj(b.date||'1970-01-01', b.time||'00:00') - toDateObj(a.date||'1970-01-01', a.time||'00:00')))
    : [];

  // Live suggestions while typing a client's name on the Add screen, so a
  // returning client's phone/address doesn't need to be re-typed from memory.
  // Only while phone is still blank -- once it's filled (by picking a match,
  // or by typing one manually for a genuinely new client), suggestions stop
  // showing rather than lingering under an already-answered field. Requires
  // at least 2 characters so it doesn't flash a huge list after one keystroke.
  const formNameQ = (s.form.name || '').trim().toLowerCase();
  const nameMatches = (!s.form.phone && formNameQ.length >= 2)
    ? s.clients.filter(c => (c.name || '').toLowerCase().includes(formNameQ)).slice(0, 5)
    : [];

  // Group search results by client (not one row per appointment) -- same
  // shape and tap-through as the "All clients" list above, just filtered by
  // query, so a client with several bookings shows up once instead of once
  // per appointment. Phone numbers get typed with all kinds of punctuation
  // (dashes, spaces, parens) depending on where they were entered from --
  // compare digits-only on both sides so formatting differences don't hide a
  // real match. Only applied when the query actually has digits, so a
  // pure-name search doesn't spuriously match every phone number via an
  // empty-string .includes().
  const searchDigits = searchQ.replace(/\D/g, '');
  const searchResults = searchQ ? allClients.filter(c =>
    (c.name || '').toLowerCase().includes(searchQ) ||
    (searchDigits && (c.phone || '').replace(/\D/g, '').includes(searchDigits))
  ) : [];

  return {
    accent, currency,
    headerSubtitle: s.screen === 'home' ? `${upcoming.length} upcoming booking${upcoming.length===1?'':'s'}` :
      s.screen === 'add' ? 'Add a new booking' : s.screen === 'search' ? 'Find a client' :
      s.screen === 'earnings' ? 'Completed jobs & earnings' : s.screen === 'settings' ? 'Settings' :
      s.screen === 'inventory' ? 'Inventory' : s.screen === 'calendar' ? 'Calendar' : 'Booking details',
    hasOverlap, nextAppt, needsBackupNag, backupNagLabel,
    hasNeedsFollowUp, followUpLabel, needsFollowUp,
    noToday: todayList.length === 0, noUpcoming: upcomingList.length === 0,
    noSearchResults: searchResults.length === 0,
    noCompleted: completedList.length === 0,
    lastBackupLabel: daysSinceBackup === null ? 'Never backed up yet' : daysSinceBackup === 0 ? 'Backed up today' : `Last backup ${daysSinceBackup} day${daysSinceBackup===1?'':'s'} ago`,
    todayLabel: now.toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'}),
    todayList, upcomingList,
    inventoryList, hasInventory: inventoryList.length > 0, lowStockCount: lowStockItems.length, hasLowStock: lowStockItems.length > 0,
    searchResults, searchEmptyLabel: searchQ ? 'No matching clients found.' : 'Type a name or phone number to search.',
    weekTotal, allTimeTotal, completedCount: completed.length, completedList,
    noShowList, hasNoShows: noShowList.length > 0,
    noShowsByClient, hasNoShowsByClient: noShowsByClient.length > 0,
    topClients, hasTopClients: topClients.length > 0,
    topServices, hasTopServices: topServices.length > 0,
    paymentBreakdown, hasPaymentBreakdown: paymentBreakdown.length > 0,
    detail, hasHistory: (detail.history || []).length > 0,
    isCompletingThis: s.completingId === s.detailId,
    isReschedulingThis: s.reschedulingId === s.detailId,
    isEditingThis: s.editingId === s.detailId,
    showActionRow: !detail.done && !detail.cancelled && !detail.noShow && s.completingId !== s.detailId && s.reschedulingId !== s.detailId && s.editingId !== s.detailId,
    anyPanelOpen: s.completingId === s.detailId || s.reschedulingId === s.detailId || s.editingId === s.detailId,
    formOverlapWarning, daySchedule, formDateBlocked,
    calendarGrid, calendarDayAppts, calendarDaySchedule, calendarSelectedBlocked,
    recentClients, hasRecentClients: recentClients.length > 0,
    nameMatches, hasNameMatches: nameMatches.length > 0,
    viewingClient, viewingClientAppointments,
    allClients, hasClients: allClients.length > 0
  };
}

// ---- Templates ----
function renderHeader(v){
  const bp = state.businessProfile;
  return `
  <header class="app-header">
    <button class="calendar-btn" data-action="goCalendar" aria-label="Calendar">${ICON_CALENDAR}</button>
    <button class="settings-btn" data-action="goSettings" aria-label="Settings">${ICON_GEAR}</button>
    ${bp.logoDataUrl ? `<img class="header-logo" src="${esc(bp.logoDataUrl)}" alt="${esc(bp.name)} logo"/>` : ''}
    <div class="wordmark">${esc(bp.name)}</div>
    <div class="header-divider"></div>
    <div class="header-tagline">${esc(bp.tagline)}</div>
    <div class="header-location">${esc(bp.location)}</div>
    <div class="header-now" id="header-now">${formatNowLabel()}</div>
    <div class="header-subtitle">${esc(v.headerSubtitle)}</div>
    ${v.hasOverlap ? `<div class="overlap-banner">${ICON_WARNING} Two appointments are too close together — check timing.</div>` : ''}
  </header>`;
}

function renderNav(){
  const s = state;
  const cls = name => 'nav-item' + (s.screen === name ? ' nav-item--active' : '');
  return `
  <nav class="bottom-nav">
    <div class="${cls('home')}" data-action="goHome">${ICON_HOME}<div class="nav-label">Home</div></div>
    <div class="${cls('search')}" data-action="goSearch">${ICON_SEARCH}<div class="nav-label">Search</div></div>
    <div class="fab" data-action="goAdd">${ICON_PLUS}</div>
    <div class="${cls('earnings')}" data-action="goEarnings">${ICON_CHART}<div class="nav-label">History</div></div>
    <div class="${cls('inventory')}" data-action="goInventory">${ICON_BOX}<div class="nav-label">Inventory</div></div>
  </nav>`;
}

// Shared "Show more" footer for any list capped at a visible count -- avoids
// the same growing-list-with-no-end problem showing up separately on Home,
// Earnings history, and the client directory.
function renderShowMore(totalCount, visibleCount, action){
  if (totalCount <= visibleCount) return '';
  const remaining = totalCount - visibleCount;
  return `<div class="action-btn-secondary" style="margin-bottom:14px" data-action="${action}">Show ${Math.min(remaining, PAGE_SIZE)} more (${remaining} left)</div>`;
}

function renderHome(v){
  let html = '<div>';
  if (v.hasLowStock) {
    html += `<div class="banner-warning-row" data-action="goInventory">
      <div class="banner-warning-text">&#9888; ${v.lowStockCount} item(s) running low on stock.</div>
      <div class="banner-warning-cta">Restock &rarr;</div>
    </div>`;
  }
  if (v.needsBackupNag) {
    html += `<div class="banner-warning-row" data-action="goSettings">
      <div class="banner-warning-text">${esc(v.backupNagLabel)}</div>
      <div class="banner-warning-cta">Back up &rarr;</div>
    </div>`;
  }
  if (v.hasNeedsFollowUp) {
    html += `<div class="banner-warning-row" data-action="openAppt" data-id="${esc(v.needsFollowUp[0].id)}">
      <div class="banner-warning-text">&#9888; ${esc(v.followUpLabel)}</div>
      <div class="banner-warning-cta">Review &rarr;</div>
    </div>`;
  }
  if (v.nextAppt) {
    const n = v.nextAppt;
    html += `<div class="next-up-card" data-action="openAppt" data-id="${esc(n.id)}">
      <div class="next-up-label">Next up &middot; ${esc(n.countdown)}</div>
      <div class="next-up-title">${esc(n.name)} — ${esc(n.service)}</div>
      <div class="next-up-sub">${esc(n.dateLabel)} at ${esc(n.timeLabel)}</div>
      <div class="next-up-leaveby">&#128663; Leave by ${esc(n.leaveByLabel)}</div>
    </div>`;
  }
  html += `<div class="section-title">Today &middot; ${esc(v.todayLabel)}</div>`;
  if (v.todayList.length) {
    html += `<div class="appt-list">${v.todayList.map(a => `
      <div class="appt-card appt-card--today" data-action="openAppt" data-id="${esc(a.id)}">
        <div>
          <div class="appt-name">${esc(a.name)}</div>
          <div class="appt-service">${esc(a.service)}</div>
        </div>
        <div style="text-align:right">
          <div class="appt-time">${esc(a.timeLabel)}</div>
          ${a.overlap ? '<div class="conflict-tag">&#9888; conflict</div>' : ''}
          ${a.overdue ? '<div class="conflict-tag">&#9888; awaiting outcome</div>' : ''}
        </div>
      </div>`).join('')}</div>`;
  } else {
    html += `<div class="empty-state">No appointments today. Enjoy the rest!</div>`;
  }
  html += `<div class="section-title">Upcoming</div>`;
  if (v.upcomingList.length) {
    const visibleUpcoming = v.upcomingList.slice(0, state.homeUpcomingVisible);
    html += `<div class="appt-list">${visibleUpcoming.map(a => `
      <div class="appt-card appt-card--upcoming" data-action="openAppt" data-id="${esc(a.id)}">
        <div>
          <div class="appt-name">${esc(a.name)}</div>
          <div class="appt-service">${esc(a.service)} &middot; ${esc(a.dateLabel)}</div>
        </div>
        <div class="appt-time">${esc(a.timeLabel)}</div>
      </div>`).join('')}</div>`;
    html += renderShowMore(v.upcomingList.length, state.homeUpcomingVisible, 'showMoreUpcoming');
  } else {
    html += `<div class="empty-state empty-state--dashed">No appointments yet.<br/>Tap the <b>+</b> button below to add your first booking.</div>`;
  }
  html += '</div>';
  return html;
}

function renderAdd(v){
  const s = state, f = s.form;
  let html = '<div>';
  html += `<div class="tabs">
    <div class="tab ${s.addTab==='manual'?'tab--active':''}" data-action="setTabManual">Manual</div>
    <div class="tab ${s.addTab==='paste'?'tab--active':''}" data-action="setTabPaste">Paste chat</div>
    <div class="tab ${s.addTab==='screenshot'?'tab--active':''}" data-action="setTabScreenshot">Screenshot</div>
  </div>`;
  if (s.addTab === 'paste') {
    html += `<div class="hint-text">Paste the whole WhatsApp conversation — greetings and all. We'll scan it for the date, time, service, name &amp; phone.</div>
    <textarea id="paste-text" class="field textarea" data-bind="pasteText" placeholder="Hi Asha, how are you? Are you available today?&#10;Yes! What service do you need?&#10;Bridal makeup on 5 Aug at 6am, at Green Park. Call 9876543210">${esc(s.pasteText)}</textarea>
    <div class="btn-primary" data-action="onParse">Parse &amp; review below</div>`;
  }
  if (s.addTab === 'screenshot') {
    html += `<div class="hint-text">Upload a screenshot of the chat. We'll read the text on-device and pull out the details.</div>
    <label class="upload-label">&#128247; Tap to choose a screenshot
      <input type="file" accept="image/*" data-action="onScreenshotChange" style="display:none"/>
    </label>`;
    if (s.ocrStatus) html += `<div class="ocr-status">${esc(s.ocrStatus)}</div>`;
  }
  if (s.addTab === 'manual' && v.hasRecentClients) {
    html += `<div class="payment-panel-title" style="margin-top:2px">Recent clients — tap to fill in</div>
    <div class="payment-chip-row" style="margin-bottom:10px">
      ${v.recentClients.map((c,i) => `<div class="payment-chip" data-action="pickRecentClient" data-id="${i}">${esc(clientLabel(c.name, c.phone))}</div>`).join('')}
    </div>`;
  }
  html += `<div class="field-stack">
    <input id="field-name" class="field" data-bind="form.name" value="${esc(f.name)}" placeholder="Client name"/>
    ${v.hasNameMatches ? `<div class="list-col" style="margin-bottom:0;gap:6px">
      ${v.nameMatches.map(c => `<div class="list-row" style="cursor:pointer" data-action="pickNameMatch" data-id="${esc(c.id)}">
        <div class="list-row-label">${esc(c.name || c.phone)}</div>
        <div class="list-row-sub">${esc(c.phone)}</div>
      </div>`).join('')}
    </div>` : ''}
    <input id="field-phone" class="field" type="tel" inputmode="tel" autocomplete="tel" data-bind="form.phone" value="${esc(f.phone)}" placeholder="Phone number"/>
    <div class="payment-panel-title" style="margin-top:2px">Services (tap all that apply)</div>
    <div class="payment-chip-row" style="margin-bottom:4px">
      ${s.services.map(sv => `<div class="payment-chip ${f.services.includes(sv.name)?'payment-chip--active':''}" data-action="toggleFormService" data-value="${esc(sv.name)}">${esc(sv.name)}</div>`).join('')}
    </div>
    <div style="display:flex;gap:10px">
      <input id="field-date" type="date" class="field" style="flex:1" data-bind="form.date" value="${esc(f.date)}"/>
      <input id="field-time" type="time" class="field" style="flex:1" data-bind="form.time" value="${esc(f.time)}"/>
    </div>
    ${f.date && v.formDateBlocked ? `<div class="banner-warning">&#128683; ${esc(fmtDateLabel(f.date))} is marked as a day off. You can still book it if this is an exception.</div>` : ''}
    ${f.date ? `<div class="day-schedule">
      <div class="day-schedule-title">Availability on ${esc(fmtDateLabel(f.date))}</div>
      <div class="day-schedule-list">
        ${v.daySchedule.map(slot => slot.booked
          ? `<div class="day-slot day-slot--booked"><div class="day-slot-time">${esc(slot.timeLabel)}</div><div class="day-slot-status">${esc(slot.booked.name)} &middot; ${esc(slot.booked.service)}</div></div>`
          : `<div class="day-slot day-slot--free" data-action="pickSlotTime" data-value="${esc(slot.timeValue)}"><div class="day-slot-time">${esc(slot.timeLabel)}</div><div class="day-slot-status">Free — tap to pick</div></div>`
        ).join('')}
      </div>
    </div>` : ''}
    <input id="field-address" class="field" data-bind="form.address" value="${esc(f.address)}" placeholder="Location / address"/>
    <input id="field-price" class="field" inputmode="decimal" data-bind="form.price" value="${esc(f.price)}" placeholder="Price ${s.logPast?'':'(optional)'}"/>
    <textarea id="field-notes" class="field textarea-small" data-bind="form.notes" placeholder="Notes (allergies, reference look, etc.)">${esc(f.notes)}</textarea>
  </div>`;
  html += `<div class="checkbox-row" data-action="toggleLogPast">
    <div class="checkbox-box ${s.logPast?'checkbox-box--checked':''}"></div>
    <div class="checkbox-label">This already happened — log it as a completed visit</div>
  </div>`;
  if (s.logPast) {
    html += `<div class="payment-panel">
      <div class="payment-panel-title">Payment method</div>
      <div class="payment-chip-row">
        ${PAYMENT_METHODS.map(m => `<div class="payment-chip ${s.pendingPaymentMethod===m?'payment-chip--active':''}" data-action="selectPayment" data-value="${esc(m)}">${esc(m)}</div>`).join('')}
      </div>
    </div>`;
  }
  if (v.formOverlapWarning) {
    html += `<div class="banner-warning">&#9888; This clashes with another booking within an hour. Double-check the time.</div>`;
  }
  html += `<div class="btn-primary btn-primary--save" data-action="onSave">Save appointment</div>`;
  html += '</div>';
  return html;
}

// Shared between search results and the "All clients" browse list below --
// one row per client (name, phone, visit stats), tap to open their full
// booking history. Kept separate from the browse list's row markup only in
// that merge/consent controls don't make sense mid-search.
function renderClientSearchRow(c){
  return `<div class="appt-card appt-card--upcoming" data-action="viewClientHistory" data-id="${esc(c.id)}">
    <div>
      <div class="appt-name">${esc(c.name || c.phone)}</div>
      <div class="appt-service">${esc(c.phone)}</div>
      <div class="appt-service">${c.visitCount} visit${c.visitCount===1?'':'s'} &middot; ${esc(c.totalSpendLabel)}${c.noShowCount ? ` &middot; ${c.noShowCount} no-show${c.noShowCount===1?'':'s'}` : ''} &middot; last: ${esc(c.lastVisitLabel)}</div>
    </div>
  </div>`;
}

function renderSearch(v){
  const s = state;
  if (s.viewingClientId && v.viewingClient) {
    const c = v.viewingClient;
    let html = `<div>
      <div class="back-link" data-action="backFromClientHistory">&larr; Back</div>
      <div class="section-title">${esc(c.name || c.phone)}</div>
      <div class="hint-text">${esc(c.phone)} &middot; ${c.visitCount} visit${c.visitCount===1?'':'s'} &middot; ${esc(c.totalSpendLabel)}${c.noShowCount ? ` &middot; ${c.noShowCount} no-show${c.noShowCount===1?'':'s'}` : ''}</div>`;
    if (v.viewingClientAppointments.length) {
      html += `<div class="appt-list">${v.viewingClientAppointments.map(a => `
        <div class="appt-card appt-card--upcoming" data-action="openAppt" data-id="${esc(a.id)}">
          <div>
            <div class="appt-name">${esc(a.service)}</div>
            <div class="appt-service">${esc(a.dateLabel)} ${esc(a.timeLabel)}</div>
          </div>
          <div class="status-label" style="color:${a.statusColor}">${esc(a.statusLabel)}</div>
        </div>`).join('')}</div>`;
    } else {
      html += `<div class="empty-state">No appointments yet.</div>`;
    }
    html += '</div>';
    return html;
  }
  let html = `<div>
    <input id="search-input" class="field search-field" data-bind="search" value="${esc(s.search)}" placeholder="Search client name or phone"/>`;
  if (v.searchResults.length) {
    html += `<div class="appt-list">${v.searchResults.map(c => renderClientSearchRow(c)).join('')}</div>`;
  } else if (!s.search) {
    if (s.mergingClientId) {
      const mergingClient = s.clients.find(c => c.id === s.mergingClientId);
      html += `<div class="banner-warning-row" data-action="cancelMerge">
        <div class="banner-warning-text">Merging ${esc(mergingClient ? (mergingClient.name || mergingClient.phone) : '')} — tap another client to combine</div>
        <div class="banner-warning-cta">Cancel</div>
      </div>`;
    }
    html += `<div class="section-title" style="margin-top:4px">All clients</div>
    <div class="hint-text">Tap a client to see their booking history. The checkbox marks them OK to contact for promotions.</div>`;

    if (s.addingClient) {
      html += `<div class="inline-panel">
        <div class="inline-panel-title">Add client</div>
        <div class="field-stack" style="margin-top:0;margin-bottom:10px">
          <input id="new-client-name" class="field" data-bind="newClientForm.name" value="${esc(s.newClientForm.name)}" placeholder="Client name"/>
          <input id="new-client-phone" class="field" type="tel" inputmode="tel" autocomplete="tel" data-bind="newClientForm.phone" value="${esc(s.newClientForm.phone)}" placeholder="Phone number"/>
          <input id="new-client-address" class="field" data-bind="newClientForm.address" value="${esc(s.newClientForm.address)}" placeholder="Address (optional)"/>
        </div>
        <div style="display:flex;gap:8px">
          <div class="action-btn-secondary" style="flex:1" data-action="cancelAddClient">Cancel</div>
          <div class="btn-primary" style="flex:1;margin-top:0" data-action="confirmAddClient">Add client</div>
        </div>
      </div>`;
    } else {
      html += `<div class="action-btn-secondary" style="margin-bottom:14px" data-action="openAddClient">+ Add client</div>`;
    }

    if (v.hasClients) {
      const visibleClients = v.allClients.slice(0, state.clientsVisible);
      html += `<div class="appt-list">
        ${visibleClients.map(c => {
          const isSource = s.mergingClientId === c.id;
          const rowAction = s.mergingClientId
            ? (isSource ? '' : `data-action="selectMergeTarget" data-id="${esc(c.id)}"`)
            : `data-action="viewClientHistory" data-id="${esc(c.id)}"`;
          return `<div class="appt-card appt-card--upcoming" ${rowAction} style="${isSource ? 'opacity:0.5' : ''}">
            <div>
              <div class="appt-name">${esc(c.name || c.phone)}</div>
              <div class="appt-service">${esc(c.phone)}</div>
              <div class="appt-service">${c.visitCount} visit${c.visitCount===1?'':'s'} &middot; ${esc(c.totalSpendLabel)}${c.noShowCount ? ` &middot; ${c.noShowCount} no-show${c.noShowCount===1?'':'s'}` : ''} &middot; last: ${esc(c.lastVisitLabel)}</div>
            </div>
            ${s.mergingClientId ? '' : `
            <div>
              <div data-action="toggleClientConsent" data-id="${esc(c.id)}" style="text-align:center;padding:4px;cursor:pointer">
                <div class="checkbox-box ${c.consent?'checkbox-box--checked':''}"></div>
                <div style="font-size:9px;color:#7d79a8;margin-top:3px;white-space:nowrap">Promo OK</div>
              </div>
              <div class="inv-remove" style="text-align:center;margin-top:2px" data-action="startMergeClient" data-id="${esc(c.id)}">Merge</div>
            </div>`}
          </div>`;
        }).join('')}
      </div>`;
      html += renderShowMore(v.allClients.length, state.clientsVisible, 'showMoreClients');
    } else {
      html += `<div class="empty-state">No clients yet — add one above, or they'll appear automatically after your first booking.</div>`;
    }

    if (s.mergeTargetId) {
      const sourceClient = s.clients.find(c => c.id === s.mergingClientId);
      const targetClient = s.clients.find(c => c.id === s.mergeTargetId);
      const sourceLabel = sourceClient ? (sourceClient.name || sourceClient.phone) : '';
      const targetLabel = targetClient ? (targetClient.name || targetClient.phone) : '';
      html += `<div class="inline-panel">
        <div class="inline-panel-title">Merge clients?</div>
        <div class="hint-text" style="margin-bottom:10px">Combine <b>${esc(sourceLabel)}</b> into <b>${esc(targetLabel)}</b>. Their booking history will show under ${esc(targetLabel)}. This can't be undone.</div>
        <div style="display:flex;gap:8px">
          <div class="action-btn-secondary" style="flex:1" data-action="cancelMerge">Cancel</div>
          <div class="btn-primary" style="flex:1;margin-top:0" data-action="confirmMerge">Merge</div>
        </div>
      </div>`;
    }
  } else {
    html += `<div class="empty-state">${esc(v.searchEmptyLabel)}</div>`;
  }
  html += '</div>';
  return html;
}

function renderEarnings(v){
  let html = `<div>
    <div class="stat-row">
      <div class="stat-card"><div class="stat-label">This week</div><div class="stat-value">${esc(v.currency)}${v.weekTotal}</div></div>
      <div class="stat-card"><div class="stat-label">All-time revenue</div><div class="stat-value">${esc(v.currency)}${v.allTimeTotal}</div></div>
      <div class="stat-card"><div class="stat-label">Completed jobs</div><div class="stat-value">${v.completedCount}</div></div>
    </div>`;
  html += `<div class="section-title">Completed history</div>`;
  if (v.completedList.length) {
    const visibleCompleted = v.completedList.slice(0, state.earningsCompletedVisible);
    html += `<div class="appt-list">${visibleCompleted.map(a => `
      <div class="appt-card appt-card--completed" data-action="openAppt" data-id="${esc(a.id)}" style="cursor:pointer">
        <div><div class="appt-name">${esc(a.name)}</div><div class="appt-service">${esc(a.service)} &middot; ${esc(a.dateLabel)}</div></div>
        <div class="appt-price">${esc(a.priceLabel)}</div>
      </div>`).join('')}</div>`;
    html += renderShowMore(v.completedList.length, state.earningsCompletedVisible, 'showMoreCompleted');
  } else {
    html += `<div class="empty-state">Nothing completed yet — mark bookings done from their detail screen.</div>`;
  }
  if (v.hasNoShows) {
    html += `<div class="section-title">No-shows</div><div class="appt-list">${v.noShowList.map(a => `
      <div class="appt-card appt-card--completed" data-action="openAppt" data-id="${esc(a.id)}" style="cursor:pointer">
        <div><div class="appt-name">${esc(a.name)}</div><div class="appt-service">${esc(a.service)} &middot; ${esc(a.dateLabel)}</div></div>
      </div>`).join('')}</div>`;
    if (v.hasNoShowsByClient) {
      html += `<div class="list-col" style="margin-top:8px">
        ${v.noShowsByClient.map(c => `<div class="list-row"><div class="list-row-label">${esc(c.label)}</div><div class="list-row-value" style="color:#c9791a">${esc(c.valueLabel)}</div></div>`).join('')}
      </div>`;
    }
  }
  if (v.hasTopClients) {
    html += `<div class="section-title">Top clients</div><div class="list-col">
      ${v.topClients.map(c => `<div class="list-row"><div><div class="list-row-label">${esc(c.label)}</div><div class="list-row-sub">${esc(c.sub)}</div></div><div class="list-row-value">${esc(c.valueLabel)}</div></div>`).join('')}
    </div>`;
  }
  if (v.hasTopServices) {
    html += `<div class="section-title">Most requested services</div><div class="list-col">
      ${v.topServices.map(sv => `<div class="list-row"><div><div class="list-row-label">${esc(sv.label)}</div><div class="list-row-sub">${esc(sv.sub)}</div></div><div class="list-row-value" style="color:${esc(v.accent)}">${esc(sv.valueLabel)}</div></div>`).join('')}
    </div>`;
  }
  if (v.hasPaymentBreakdown) {
    html += `<div class="section-title">By payment method</div><div class="payment-pill-row">
      ${v.paymentBreakdown.map(p => `<div class="payment-pill">${esc(p.label)}: ${esc(p.valueLabel)}</div>`).join('')}
    </div>`;
  }
  html += '</div>';
  return html;
}

function renderDetail(v){
  const d = v.detail;
  if (!d || !d.id) return '<div class="empty-state">Appointment not found.</div>';
  let html = `<div>
    <div class="back-link" data-action="goBack">&larr; Back</div>
    <div class="detail-card">
      <div class="detail-name">${esc(d.name)}</div>
      <div class="detail-service">${esc(d.service)}</div>
      ${d.cancelled ? '<div class="cancelled-badge">Cancelled</div>' : ''}
      ${d.noShow ? '<div class="cancelled-badge" style="background:#fdf1e3;color:#c9791a">No-show</div>' : ''}
      <div class="detail-info">
        <div><b>When:</b> ${esc(d.dateLabel)} at ${esc(d.timeLabel)}</div>
        ${d.address ? `<div><b>Where:</b> ${esc(d.address)}</div>` : ''}
        ${d.priceLabel ? `<div><b>Price:</b> ${esc(d.priceLabel)}</div>` : ''}
        ${d.notes ? `<div><b>Notes:</b> ${esc(d.notes)}</div>` : ''}
      </div>
    </div>`;
  if (v.hasHistory) {
    html += `<div class="history-card">
      <div class="history-title">Rescheduled from</div>
      <div class="history-list">
        ${d.history.map(h => `<div class="history-strike">${esc(h.dateLabel)} at ${esc(h.timeLabel)}</div>`).join('')}
        <div class="history-now">Now: ${esc(d.dateLabel)} at ${esc(d.timeLabel)}</div>
      </div>
    </div>`;
  }
  html += `<div class="link-grid">
    <a href="${esc(d.telLink)}" class="link-btn">&#128222; Call</a>
    <a href="${esc(d.waLink)}" target="_blank" rel="noopener" class="link-btn link-btn--whatsapp">WhatsApp</a>
  </div>
  <div class="link-grid">
    <a href="${esc(d.mapLink)}" target="_blank" rel="noopener" class="link-btn">&#128205; Directions</a>
    <a href="${esc(d.gcalLink)}" target="_blank" rel="noopener" class="link-btn">&#128197; Add to Calendar</a>
  </div>`;
  if (!d.cancelled) {
    html += `<div class="action-btn-secondary" data-action="downloadIcs" data-id="${esc(d.id)}" style="margin-bottom:10px">&#128276; Set 30-min reminder</div>`;
  }
  if (d.done || d.cancelled || d.noShow) {
    html += `<div class="btn-primary" data-action="bookAgain">&#128257; Book again</div>`;
  }
  if (v.showActionRow) {
    html += `<div class="btn-primary" data-action="openComplete">Mark as completed</div>
    <div class="action-grid">
      <div class="action-btn-secondary" data-action="openReschedule">Reschedule</div>
      <div class="action-btn-secondary" data-action="onNoShow">No-show</div>
    </div>
    <div class="action-btn-danger" style="margin-bottom:10px" data-action="onCancelAppt">Cancel appointment</div>`;
  }
  if (v.isReschedulingThis) {
    html += `<div class="inline-panel">
      <div class="inline-panel-title">New date &amp; time</div>
      <div style="display:flex;gap:10px;margin-bottom:10px">
        <input id="res-date" type="date" class="field" style="flex:1" data-bind="resDate" value="${esc(state.resDate)}"/>
        <input id="res-time" type="time" class="field" style="flex:1" data-bind="resTime" value="${esc(state.resTime)}"/>
      </div>
      <div style="display:flex;gap:8px">
        <div class="action-btn-secondary" style="flex:1" data-action="cancelReschedule">Cancel</div>
        <div class="btn-primary" style="flex:1;margin-top:0" data-action="confirmReschedule">Save new time</div>
      </div>
    </div>`;
  }
  if (v.isCompletingThis) {
    html += `<div class="inline-panel">
      <div class="inline-panel-title">Confirm completion</div>
      <input id="pending-price" class="field" inputmode="decimal" style="margin-bottom:8px" data-bind="pendingPrice" value="${esc(state.pendingPrice)}" placeholder="Final price"/>
      <div class="payment-chip-row" style="margin-bottom:10px">
        ${PAYMENT_METHODS.map(m => `<div class="payment-chip ${state.pendingPaymentMethod===m?'payment-chip--active':''}" data-action="selectPayment" data-value="${esc(m)}">${esc(m)}</div>`).join('')}
      </div>
      <div style="display:flex;gap:8px">
        <div class="action-btn-secondary" style="flex:1" data-action="cancelComplete">Cancel</div>
        <div class="btn-primary" style="flex:1;margin-top:0" data-action="confirmComplete">Confirm</div>
      </div>
    </div>`;
  }
  if (v.isEditingThis) {
    const ef = state.editForm;
    html += `<div class="inline-panel">
      <div class="inline-panel-title">Edit details</div>
      <div class="field-stack" style="margin-top:0;margin-bottom:10px">
        <input id="edit-name" class="field" data-bind="editForm.name" value="${esc(ef.name)}" placeholder="Client name"/>
        <input id="edit-phone" class="field" type="tel" inputmode="tel" autocomplete="tel" data-bind="editForm.phone" value="${esc(ef.phone)}" placeholder="Phone number"/>
        <div style="display:flex;gap:10px">
          <input id="edit-date" type="date" class="field" style="flex:1" data-bind="editForm.date" value="${esc(ef.date)}"/>
          <input id="edit-time" type="time" class="field" style="flex:1" data-bind="editForm.time" value="${esc(ef.time)}"/>
        </div>
        <div class="payment-panel-title" style="margin-top:2px">Services (tap all that apply)</div>
        <div class="payment-chip-row" style="margin-bottom:4px">
          ${state.services.map(sv => `<div class="payment-chip ${ef.services.includes(sv.name)?'payment-chip--active':''}" data-action="toggleEditService" data-value="${esc(sv.name)}">${esc(sv.name)}</div>`).join('')}
        </div>
        <input id="edit-address" class="field" data-bind="editForm.address" value="${esc(ef.address)}" placeholder="Location / address"/>
        <input id="edit-price" class="field" inputmode="decimal" data-bind="editForm.price" value="${esc(ef.price)}" placeholder="Price"/>
        <div class="payment-chip-row">
          ${PAYMENT_METHODS.map(m => `<div class="payment-chip ${ef.paymentMethod===m?'payment-chip--active':''}" data-action="selectEditPayment" data-value="${esc(m)}">${esc(m)}</div>`).join('')}
        </div>
        <textarea id="edit-notes" class="field textarea-small" data-bind="editForm.notes" placeholder="Notes (allergies, reference look, etc.)">${esc(ef.notes)}</textarea>
      </div>
      <div style="display:flex;gap:8px">
        <div class="action-btn-secondary" style="flex:1" data-action="cancelEdit">Cancel</div>
        <div class="btn-primary" style="flex:1;margin-top:0" data-action="confirmEdit">Save changes</div>
      </div>
    </div>`;
  }
  if (!v.anyPanelOpen) {
    html += `<div style="display:flex;justify-content:space-between;align-items:center">
      <div class="edit-link" data-action="openEdit">Edit details</div>
      <div class="delete-link" data-action="deleteAppt">Delete appointment</div>
    </div>`;
  }
  html += '</div>';
  return html;
}

function renderInventory(v){
  const s = state;
  let html = '<div>';
  if (v.hasLowStock) html += `<div class="banner-warning">&#9888; ${v.lowStockCount} item(s) running low — restock soon.</div>`;
  html += `<div class="section-title">Stock on hand</div>`;
  if (v.hasInventory) {
    html += `<div class="inv-list">${v.inventoryList.map(i => `
      <div class="inv-card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div class="inv-name">${esc(i.name)}</div>
            ${i.lowStock ? '<div class="inv-low">Low stock</div>' : ''}
          </div>
          <div class="inv-remove" data-action="deleteInvItem" data-id="${esc(i.id)}">Remove</div>
        </div>
        <div class="qty-row">
          <div class="qty-btn" data-action="decQty" data-id="${esc(i.id)}" role="button" aria-label="Decrease ${esc(i.name)} quantity">&minus;</div>
          <div class="qty-value">${esc(i.qty)} ${esc(i.unit)}</div>
          <div class="qty-btn" data-action="incQty" data-id="${esc(i.id)}" role="button" aria-label="Increase ${esc(i.name)} quantity">+</div>
        </div>
      </div>`).join('')}</div>`;
  } else {
    html += `<div class="empty-state" style="margin-bottom:16px">No items yet — add wax tins, facial packs, and other supplies below.</div>`;
  }
  html += `<div class="section-title">Add item</div>
  <div class="field-stack">
    <input id="inv-name" class="field" data-bind="invName" value="${esc(s.invName)}" placeholder="Item name (e.g. Wax tins)"/>
    <div style="display:flex;gap:8px">
      <input id="inv-qty" class="field" inputmode="numeric" style="flex:1" data-bind="invQty" value="${esc(s.invQty)}" placeholder="Quantity"/>
      <input id="inv-unit" class="field" style="flex:1" data-bind="invUnit" value="${esc(s.invUnit)}" placeholder="Unit (tins, packs)"/>
    </div>
    <input id="inv-threshold" class="field" inputmode="numeric" data-bind="invThreshold" value="${esc(s.invThreshold)}" placeholder="Alert when at or below…"/>
    <div class="btn-primary" data-action="onAddInventory">Add to stock</div>
  </div>`;
  html += '</div>';
  return html;
}

function renderSettings(v){
  const s = state;
  let html = `<div>
    <div class="back-link" data-action="goHome">&larr; Back</div>
    <div class="section-title">Account</div>
    <div class="signed-in-text">Signed in as <b>${esc(s.cloudUser)}</b> — syncing automatically.</div>
    <div class="signout-link" data-action="onCloudSignOut">Sign out</div>
    ${s.cloudStatus ? `<div class="cloud-status">${esc(s.cloudStatus)}</div>` : ''}
    <div class="hint-text" style="margin-top:-4px;margin-bottom:16px">Manage your subscription (update card, view invoices, cancel) via <span class="edit-link" data-action="onManageBilling">Manage billing</span>.</div>`;

  const bp = s.businessProfile;
  html += `<div class="section-title">Business details</div>
  <div class="hint-text">Shown in the header and used as booking defaults -- update any time.</div>
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
    ${bp.logoDataUrl
      ? `<img src="${esc(bp.logoDataUrl)}" alt="Current logo" style="width:56px;height:56px;border-radius:50%;object-fit:cover;border:1px solid rgba(0,0,0,0.08);flex-shrink:0"/>`
      : `<div style="width:56px;height:56px;border-radius:50%;background:#eee;display:flex;align-items:center;justify-content:center;font-size:10.5px;color:#999;text-align:center;flex-shrink:0">No logo</div>`}
    <div style="display:flex;flex-direction:column;gap:6px">
      <label class="action-btn-secondary" style="padding:8px 14px">${bp.logoDataUrl ? 'Change logo' : 'Upload logo'}<input type="file" accept="image/*" data-action="onLogoChange" style="display:none"/></label>
      ${bp.logoDataUrl ? `<div class="signout-link" style="margin-bottom:0" data-action="removeLogo">Remove logo</div>` : ''}
    </div>
  </div>
  <div class="hint-text" style="margin-bottom:10px">Auto-cropped to a square, shown in the header and as the browser tab icon.</div>
  <input class="field" style="margin-bottom:8px" data-bind="businessProfile.name" value="${esc(bp.name)}" placeholder="Business name"/>
  <input class="field" style="margin-bottom:8px" data-bind="businessProfile.tagline" value="${esc(bp.tagline)}" placeholder="Tagline"/>
  <input class="field" style="margin-bottom:8px" data-bind="businessProfile.location" value="${esc(bp.location)}" placeholder="Location (city, province)"/>
  <input class="field" style="margin-bottom:8px" data-bind="businessProfile.defaultAddress" value="${esc(bp.defaultAddress)}" placeholder="Default address"/>
  <div style="display:flex;gap:10px;margin-bottom:8px">
    <div style="flex:1"><div class="hint-text" style="margin-bottom:4px">Accent color</div><input type="color" class="field" style="padding:4px;height:44px" data-bind="businessProfile.accent" value="${esc(bp.accent)}"/></div>
    <div style="flex:1"><div class="hint-text" style="margin-bottom:4px">Accent (secondary)</div><input type="color" class="field" style="padding:4px;height:44px" data-bind="businessProfile.accentSoft" value="${esc(bp.accentSoft)}"/></div>
  </div>
  <div style="display:flex;gap:10px;margin-bottom:8px">
    <div style="flex:1"><div class="hint-text" style="margin-bottom:4px">Currency symbol</div><input class="field" data-bind="businessProfile.currency" value="${esc(bp.currency)}" placeholder="$"/></div>
    <div style="flex:1"><div class="hint-text" style="margin-bottom:4px">Appt length (min)</div><input type="number" inputmode="numeric" class="field" data-bind="businessProfile.appointmentDurationMin" value="${esc(bp.appointmentDurationMin)}"/></div>
  </div>
  <div style="display:flex;gap:10px;margin-bottom:8px">
    <div style="flex:1"><div class="hint-text" style="margin-bottom:4px">Hours start (0-23)</div><input type="number" inputmode="numeric" min="0" max="23" class="field" data-bind="businessProfile.hoursStart" value="${esc(bp.hoursStart)}"/></div>
    <div style="flex:1"><div class="hint-text" style="margin-bottom:4px">Hours end (1-24)</div><input type="number" inputmode="numeric" min="1" max="24" class="field" data-bind="businessProfile.hoursEnd" value="${esc(bp.hoursEnd)}"/></div>
  </div>
  <div style="margin-bottom:8px"><div class="hint-text" style="margin-bottom:4px">Timezone</div>${renderTimezoneSelect('businessProfile.timezone', bp.timezone)}</div>
  <div style="margin-bottom:22px"><div class="hint-text" style="margin-bottom:4px">Travel buffer between appointments (min)</div><input type="number" inputmode="numeric" class="field" data-bind="businessProfile.travelBufferMin" value="${esc(bp.travelBufferMin)}"/></div>`;

  html += `<div class="section-title">Services you offer</div>
  <div class="hint-text">Add, rename, or remove the services shown when booking a new appointment.</div>
  <div class="service-list">
    ${s.services.map(sv => `
      <div class="service-row">
        <input id="service-${esc(sv.id)}" class="field" data-service-id="${esc(sv.id)}" value="${esc(sv.name)}"/>
        <div class="service-remove" data-action="deleteService" data-id="${esc(sv.id)}">Remove</div>
      </div>`).join('')}
  </div>
  <div class="service-row" style="margin-top:4px;margin-bottom:22px">
    <input id="new-service-name" class="field" data-bind="newServiceName" value="${esc(s.newServiceName)}" placeholder="New service name"/>
    <div class="action-btn-secondary" style="flex:0 0 auto;padding:11px 16px" data-action="onAddService">Add</div>
  </div>`;

  html += `<div class="section-title">Automatic reminders</div>
  <div class="hint-text">Get a phone notification 30 minutes before each upcoming appointment — sent from the cloud, so it works even if the app isn't open.</div>`;
  const notifPermission = (typeof Notification !== 'undefined') ? Notification.permission : 'unsupported';
  if (!s.cloudUser) {
    html += `<div class="info-box">Sign in above (Cloud backup) first — reminders are sent based on your synced data.</div>`;
  } else if (s.pushToken && notifPermission === 'granted') {
    html += `<div class="signed-in-text">&#9989; Automatic reminders are on for this phone.</div>
    <div class="signout-link" data-action="onDisablePush">Turn off</div>`;
  } else if (s.pushToken && notifPermission !== 'granted') {
    html += `<div class="banner-warning" style="margin-top:0;margin-bottom:10px">Notifications got turned off in your phone settings — tap below to turn reminders back on.</div>
    <div class="btn-primary" style="margin-bottom:8px" data-action="onEnablePush">&#128276; Enable automatic reminders</div>`;
  } else {
    html += `<div class="btn-primary" style="margin-bottom:8px" data-action="onEnablePush">&#128276; Enable automatic reminders</div>`;
  }
  if (s.pushStatus) html += `<div class="cloud-status">${esc(s.pushStatus)}</div>`;

  html += `<div class="section-title">Backup your data</div>
  <div class="hint-text">This app is installed and works offline, and the phone is told to keep this data safe from routine cleanup. But if she ever clears all app/site data by hand, or switches phones, only a backup file protects her bookings — export it regularly.</div>
  <div class="backup-label">${esc(v.lastBackupLabel)}</div>
  <div class="backup-actions">
    <div class="action-btn-secondary" data-action="onExport">&#8681; Export backup</div>
    <label class="action-btn-secondary">&#8679; Import backup<input type="file" accept="application/json" data-action="onImportBackup" style="display:none"/></label>
  </div>`;
  if (s.backupStatus) html += `<div class="cloud-status">${esc(s.backupStatus)}</div>`;
  html += '</div>';
  return html;
}

function renderCalendar(v){
  const s = state;
  const [year, month] = s.calendarMonth.split('-').map(Number);
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const weekdayLabels = ['Su','Mo','Tu','We','Th','Fr','Sa'];

  let html = `<div>
    <div class="back-link" data-action="goHome">&larr; Back</div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div class="qty-btn" data-action="calendarPrevMonth" role="button" aria-label="Previous month">&#8249;</div>
      <div class="section-title" style="margin-bottom:0">${esc(monthLabel)}</div>
      <div class="qty-btn" data-action="calendarNextMonth" role="button" aria-label="Next month">&#8250;</div>
    </div>
    <div class="calendar-weekdays">${weekdayLabels.map(w => `<div class="calendar-weekday">${w}</div>`).join('')}</div>
    <div class="calendar-grid">
      ${v.calendarGrid.map(c => `<div class="calendar-cell ${c.inMonth?'':'calendar-cell--out'} ${c.isToday?'calendar-cell--today':''} ${c.isBlocked?'calendar-cell--blocked':''} ${s.calendarSelectedDate===c.dateStr?'calendar-cell--selected':''}" data-action="calendarSelectDay" data-value="${c.dateStr}">
        <div class="calendar-daynum">${c.dayNum}</div>
        ${c.hasBookings ? '<div class="calendar-dot"></div>' : ''}
        ${c.isBlocked ? '<div class="calendar-off-mark">Off</div>' : ''}
      </div>`).join('')}
    </div>`;

  if (s.calendarSelectedDate) {
    html += `<div class="section-title" style="margin-top:20px">${esc(fmtDateLabel(s.calendarSelectedDate))}</div>`;
    html += `<div class="action-btn-secondary" style="margin-bottom:12px" data-action="toggleDayOff">${v.calendarSelectedBlocked ? 'Mark as available again' : '&#128683; Mark as a day off'}</div>`;
    if (v.calendarSelectedBlocked) {
      html += `<div class="banner-warning" style="margin-top:0">This day is marked off. Existing bookings below still stand -- cancel or reschedule them separately if needed.</div>`;
    }
    if (v.calendarDayAppts.length) {
      html += `<div class="appt-list">${v.calendarDayAppts.map(a => `
        <div class="appt-card appt-card--upcoming" data-action="openAppt" data-id="${esc(a.id)}">
          <div><div class="appt-name">${esc(a.name)}</div><div class="appt-service">${esc(a.service)}</div></div>
          <div class="appt-time">${esc(a.timeLabel)}</div>
        </div>`).join('')}</div>`;
    } else {
      html += `<div class="empty-state">No appointments this day.</div>`;
    }
    if (!v.calendarSelectedBlocked) {
      html += `<div class="section-title">Availability</div>
      <div class="day-schedule">
        <div class="day-schedule-list">
          ${v.calendarDaySchedule.map(slot => slot.booked
            ? `<div class="day-slot day-slot--booked"><div class="day-slot-time">${esc(slot.timeLabel)}</div><div class="day-slot-status">${esc(slot.booked.name)} &middot; ${esc(slot.booked.service)}</div></div>`
            : `<div class="day-slot day-slot--free" data-action="calendarPickSlot" data-value="${esc(slot.timeValue)}"><div class="day-slot-time">${esc(slot.timeLabel)}</div><div class="day-slot-status">Free — tap to book</div></div>`
          ).join('')}
        </div>
      </div>
      <div class="btn-primary" data-action="goAddFromCalendar">+ Add booking for this day</div>`;
    }
  }
  html += '</div>';
  return html;
}

function renderScreen(v){
  switch (state.screen) {
    case 'home': return renderHome(v);
    case 'add': return renderAdd(v);
    case 'search': return renderSearch(v);
    case 'earnings': return renderEarnings(v);
    case 'detail': return renderDetail(v);
    case 'inventory': return renderInventory(v);
    case 'settings': return renderSettings(v);
    case 'calendar': return renderCalendar(v);
    default: return renderHome(v);
  }
}

// ---- Auth / onboarding / subscription gate (SaaS build only) ----
// Every screen above requires a signed-in, onboarded, subscribed account.
// These render full-screen, replacing header/screen/nav entirely, rather than
// living inside renderScreen()'s normal cases.

// /subscriptions/{uid} is written only by the Stripe webhook (server-side,
// Admin SDK) -- see firestore.rules, which refuses any client write to that
// collection outright. `trialing` counts as entitled so a fresh Checkout
// session's trial period works before the first real payment. `comp` is a
// manually-granted exemption (set directly in the Firestore console, never by
// the app or the webhook) for accounts that shouldn't see a paywall at all --
// e.g. the business validating this product before it's opened to the public.
function entitled(subscription){
  return !!subscription && (subscription.status === 'active' || subscription.status === 'trialing' || subscription.status === 'comp');
}

function renderGateShell(inner){
  return `<div class="gate-screen">
    <header class="app-header">
      <div class="wordmark">openbooker</div>
      <div class="header-divider"></div>
      <div class="header-tagline">APPOINTMENT BOOKING FOR INDEPENDENT PROS</div>
    </header>
    <div class="gate-body">${inner}</div>
    ${state.toast ? `<div class="toast">${esc(state.toast)}</div>` : ''}
  </div>`;
}

function renderCloudMisconfigured(){
  return `<div class="section-title">Not set up yet</div>
  <div class="info-box">This install is missing its Firebase configuration — paste your project's keys into <b>firebase-config.js</b> to turn it on.</div>`;
}

function renderAuthFields(v){
  const s = state;
  // Consent applies to both the Google button and the email form below, and to
  // both tabs -- there's no reliable way to tell whether a Google sign-in is a
  // brand new account or a returning one before Firebase responds, so this is
  // deliberately required up front for either path rather than only gating the
  // "Create account" tab.
  let html = `<div class="section-title">${s.authMode === 'signup' ? 'Create your account' : 'Sign in'}</div>
  <label class="hint-text" style="display:flex;align-items:flex-start;gap:8px;margin-bottom:14px;cursor:pointer">
    <input type="checkbox" data-action="toggleAuthConsent" ${s.authConsent ? 'checked' : ''} style="margin-top:2px;flex-shrink:0"/>
    <span>I agree to the <a href="./terms.html" target="_blank" rel="noopener">Terms</a> and <a href="./privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.</span>
  </label>
  <div class="google-btn" data-action="onGoogleSignIn">${ICON_GOOGLE} Continue with Google</div>
  <div class="or-divider">or use email &amp; password</div>
  <div class="tabs" style="margin-bottom:10px">
    <div class="tab ${s.authMode==='signin'?'tab--active':''}" data-action="setAuthSignin">Sign in</div>
    <div class="tab ${s.authMode==='signup'?'tab--active':''}" data-action="setAuthSignup">Create account</div>
  </div>
  <input id="auth-email" class="field" type="email" inputmode="email" autocomplete="email" style="margin-bottom:8px" data-bind="authEmail" value="${esc(s.authEmail)}" placeholder="Email"/>
  <input id="auth-password" type="password" class="field" style="margin-bottom:8px" data-bind="authPassword" value="${esc(s.authPassword)}" placeholder="Password"/>
  <div class="btn-primary" style="margin-bottom:8px" data-action="onCloudSubmit">${s.authMode==='signup'?'Create account':'Sign in'}</div>`;
  if (s.cloudStatus) html += `<div class="cloud-status">${esc(s.cloudStatus)}</div>`;
  return html;
}

function renderAuthScreen(v){
  return renderGateShell(renderAuthFields(v));
}

function renderOnboarding(v){
  const f = state.onboardingForm;
  const inner = `<div class="section-title">Set up your business</div>
  <div class="hint-text" style="margin-bottom:14px">A few details to personalize your account — all editable later in Settings.</div>
  <input class="field" style="margin-bottom:8px" data-bind="onboardingForm.name" value="${esc(f.name)}" placeholder="Business name"/>
  <input class="field" style="margin-bottom:8px" data-bind="onboardingForm.tagline" value="${esc(f.tagline)}" placeholder="Tagline (optional)"/>
  <input class="field" style="margin-bottom:8px" data-bind="onboardingForm.location" value="${esc(f.location)}" placeholder="Location (city, province/state)"/>
  <input class="field" style="margin-bottom:8px" data-bind="onboardingForm.defaultAddress" value="${esc(f.defaultAddress)}" placeholder="Default address (optional)"/>
  <div style="display:flex;gap:10px;margin-bottom:8px">
    <div style="flex:1"><div class="hint-text" style="margin-bottom:4px">Currency symbol</div><input class="field" data-bind="onboardingForm.currency" value="${esc(f.currency)}" placeholder="$"/></div>
    <div style="flex:1"><div class="hint-text" style="margin-bottom:4px">Timezone</div>${renderTimezoneSelect('onboardingForm.timezone', f.timezone)}</div>
  </div>
  <div style="display:flex;gap:10px;margin-bottom:18px">
    <div style="flex:1"><div class="hint-text" style="margin-bottom:4px">Hours start (0-23)</div><input type="number" inputmode="numeric" min="0" max="23" class="field" data-bind="onboardingForm.hoursStart" value="${esc(f.hoursStart)}"/></div>
    <div style="flex:1"><div class="hint-text" style="margin-bottom:4px">Hours end (1-24)</div><input type="number" inputmode="numeric" min="1" max="24" class="field" data-bind="onboardingForm.hoursEnd" value="${esc(f.hoursEnd)}"/></div>
  </div>
  <div class="btn-primary" data-action="submitOnboarding">Continue</div>
  ${state.cloudStatus ? `<div class="cloud-status">${esc(state.cloudStatus)}</div>` : ''}`;
  return renderGateShell(inner);
}

function renderPaywall(v){
  const s = state;
  const status = s.subscription && s.subscription.status;
  let banner = '';
  if (status === 'past_due') banner = `<div class="banner-warning" style="margin-top:0">Your last payment didn't go through — update your card to keep your account active.</div>`;
  else if (status === 'canceled') banner = `<div class="banner-warning" style="margin-top:0">Your subscription was canceled.</div>`;
  const inner = `<div class="section-title">Subscribe to continue</div>
  ${banner}
  <div class="hint-text" style="margin-bottom:16px">Start your subscription to unlock booking management, reminders, and everything else.</div>
  <div class="btn-primary" style="margin-bottom:10px" data-action="onSubscribe">Subscribe</div>
  <div class="edit-link" style="text-align:center;display:block" data-action="onManageBilling">Manage billing</div>
  <div class="signout-link" style="margin-top:18px" data-action="onCloudSignOut">Sign out</div>`;
  return renderGateShell(inner);
}

function renderEntitlementGate(v){
  const s = state;
  if (!s.cloudReady) return renderGateShell(renderCloudMisconfigured());
  if (!s.cloudUser) return renderAuthScreen(v);
  if (s.awaitingOnboarding) return renderOnboarding(v);
  if (!entitled(s.subscription)) return renderPaywall(v);
  return null;
}

function renderApp(){
  const v = computeVals();
  if (REQUIRE_AUTH) {
    const gate = renderEntitlementGate(v);
    if (gate) return gate;
  }
  return `
    ${renderHeader(v)}
    <main class="app-content">${renderScreen(v)}</main>
    ${renderNav()}
    ${state.toast ? `<div class="toast">${esc(state.toast)}</div>` : ''}
  `;
}

// ---- DOM wiring ----
const root = document.getElementById('phone-frame');

function captureFocus(){
  const active = document.activeElement;
  if (!active || !active.id || !root.contains(active)) return null;
  const info = { id: active.id };
  if (typeof active.selectionStart === 'number') {
    info.selStart = active.selectionStart;
    info.selEnd = active.selectionEnd;
  }
  return info;
}
function restoreFocus(info){
  if (!info) return;
  const el = document.getElementById(info.id);
  if (!el) return;
  el.focus();
  if (info.selStart != null && typeof el.setSelectionRange === 'function') {
    try { el.setSelectionRange(info.selStart, info.selEnd); } catch(e) {}
  }
}
function render(){
  const focusInfo = captureFocus();
  root.innerHTML = renderApp();
  restoreFocus(focusInfo);
}

// Moving focus from one field to the next (e.g. tapping the date field right
// after typing a name) fires the outgoing field's 'change' event *synchronously,
// mid-focus-transition* -- before the browser has finished shifting focus into
// the field being tapped. Calling render() synchronously from that handler
// replaces the whole DOM tree, including the field the user just tapped,
// while the browser is still in the middle of focusing it -- the new element
// receives the focus intent but the value the user is about to enter can be
// lost. Deferring to a microtask lets the current focus transition finish
// first; render() then runs against a settled DOM instead of one mid-swap.
function scheduleRender(){
  // A microtask isn't late enough: on a real tap/click, mousedown (which
  // blurs the previous field and fires this) and mouseup/click are still
  // separate, already-queued tasks -- a microtask fires *before* mouseup even
  // starts, so the DOM gets replaced mid-gesture and the browser never
  // synthesizes the click at all (confirmed: a raw el.click() reaches our
  // handler, but a real mousedown+mouseup sequence on the same element does
  // not, right after a preceding field blurs). A macrotask runs after the
  // whole click gesture's already-queued events finish, avoiding this.
  setTimeout(render, 0);
}

function setPath(obj, path, value){
  const parts = path.split('.');
  let cur = obj;
  for (let i=0;i<parts.length-1;i++) cur = cur[parts[i]];
  cur[parts[parts.length-1]] = value;
}

root.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  if (action === 'onScreenshotChange' || action === 'onImportBackup' || action === 'onLogoChange') return;
  const fn = Actions[action];
  if (!fn) return;
  e.preventDefault();
  fn(el.dataset.id, el.dataset.value);
});

root.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset && el.dataset.serviceId) {
    // Live-update in memory on every keystroke (keeps the Add screen's service
    // dropdown in sync); the persisted write happens on 'change' (blur/commit)
    // below, not on every keystroke.
    const id = el.dataset.serviceId;
    state.services = state.services.map(sv => sv.id === id ? { ...sv, name: el.value } : sv);
    scheduleRender();
    return;
  }
  if (el.dataset && el.dataset.bind) {
    setPath(state, el.dataset.bind, el.value);
    // Only the search field needs the screen to live-update as she types (the
    // filtered results list below it). Every other text field just updates
    // `state` silently here -- the visible re-render happens on 'change'
    // (blur/commit) below instead. Re-rendering (i.e. recreating the DOM node)
    // on every keystroke was resetting mobile virtual keyboards back to the
    // default letter layout for tel/email/number fields, forcing a manual tap
    // back to the digit pad after every character.
    if (el.dataset.bind === 'search' || el.dataset.bind === 'form.name') scheduleRender();
    // Color pickers fire 'input' continuously while dragging -- apply live so
    // she sees the accent change in real time, without a full re-render.
    if (el.dataset.bind === 'businessProfile.accent' || el.dataset.bind === 'businessProfile.accentSoft') {
      applyAccentColors(state.businessProfile.accent, state.businessProfile.accentSoft);
    }
  }
});

root.addEventListener('change', e => {
  const el = e.target;
  if (el.type === 'file') {
    const action = el.dataset.action;
    const file = el.files && el.files[0];
    if (action === 'onScreenshotChange') onScreenshotFile(file);
    if (action === 'onImportBackup') importBackupFile(file);
    if (action === 'onLogoChange') onLogoFile(file);
    el.value = '';
    return;
  }
  if (el.dataset && el.dataset.serviceId) {
    const id = el.dataset.serviceId;
    persistServices(state.services.map(sv => sv.id === id ? { ...sv, name: el.value, updatedAt: Date.now() } : sv));
    return;
  }
  if (el.dataset && el.dataset.bind) {
    if (el.dataset.bind.indexOf('businessProfile.') === 0) {
      const field = el.dataset.bind.split('.')[1];
      const numericFields = ['hoursStart', 'hoursEnd', 'travelBufferMin', 'appointmentDurationMin'];
      if (numericFields.indexOf(field) !== -1) {
        const n = parseInt(state.businessProfile[field], 10);
        state.businessProfile[field] = isNaN(n) ? DEFAULT_BUSINESS_PROFILE[field] : n;
      }
      persistBusinessProfile(state.businessProfile);
    } else if (el.dataset.bind.indexOf('onboardingForm.') === 0) {
      // Nothing on the onboarding screen needs to visually react to another
      // field changing -- skip the render entirely here (same reasoning as
      // the search-field special-case above) rather than deferring one.
      // scheduleRender()'s setTimeout(0) defer can land much later than
      // expected under load (measured 600ms+ in practice), and if that fires
      // while the NEXT field is mid-fill, this field's whole subtree gets
      // replaced while an input/change event is in flight on it -- the event
      // fires on a node that's no longer attached to `root`, so it never
      // reaches this delegated listener and the keystroke is silently lost.
      // A form with several fields filled in quick succession (exactly what
      // onboarding is) is exactly the shape that triggers this.
    } else {
      scheduleRender();
    }
  }
});

// ---- Init ----
loadPersisted();
initCloud();
render();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

// Keep the header's "Today: ..." line current even while she's just looking at
// the app without tapping anything (every other render already recomputes it
// fresh, this only matters when the screen has been sitting idle for a while).
// A direct text-node update, not a full render() -- no risk of disturbing
// focus, scroll position, or anything else while idle.
setInterval(() => {
  const el = document.getElementById('header-now');
  if (el) el.textContent = formatNowLabel();
}, 60000);
