# Handoff: Asha's Bookings (SAMakeovers appointment app)

## Overview
A mobile-first appointment manager for a home-based beautician/makeup artist (SAMakeovers, Mississauga ON). Solves: missed/wrong-date appointments, no central log of bookings, no revenue/inventory tracking. Built as a single-page app with client-side storage + optional Firebase (Firestore + Auth) cloud sync.

## About the source files — read this first
Everything in `source/` is **real, working code** — not a static mockup. The UI, state management, form parsing, Firebase sync, and business logic are fully implemented and functional today (open `Asha Appointments.dc.html` in a browser and it runs).

The one non-portable piece is the **template runtime**: this file was authored in a proprietary template DSL (`{{ value }}` interpolation, `<sc-if>`/`<sc-for>` control-flow tags, compiled by a `support.js` runtime private to the authoring tool). That runtime is **not included** and is not meant to be redistributed or depended on outside that tool.

**Your task:** port this to a normal stack (plain HTML/CSS/JS, or React/Vite if this becomes part of a larger app) — reimplement the template layer, but the JavaScript **business logic below is plain, portable JS and can be copied close to verbatim** (date/time parsing, overlap detection, Firebase read/write, analytics aggregation, etc.) — it doesn't depend on the proprietary runtime at all.

## Suggested Claude Code prompt
```
I'm handing off a functional HTML prototype of an appointment-booking app for a
beautician (see design_handoff_asha_bookings/README.md and source/). It's built
in a proprietary template DSL I can't keep using — please rebuild it as a
plain React + Vite (or plain HTML/CSS/vanilla JS if you think that's simpler
for something this size) single-page app.

Port the UI 1:1 (same screens, layout, copy, colors — rose/blush palette,
Georgia serif for the "SAMakeovers" wordmark, Inter for body text) and port
the business logic (date/time parsing from pasted chat text, OCR-based
screenshot parsing via tesseract.js, overlap detection, reschedule history,
Firebase Firestore sync, analytics aggregation) essentially as-is — it's
plain JS in the <script> section of the .dc.html and doesn't depend on the
proprietary runtime.

Keep: localStorage as the offline source of truth, Firebase as opt-in cloud
sync (config in firebase-config.js — already has real project keys), the
manifest.json + service worker for PWA installability, and the
firebase.json/.firebaserc for Firebase Hosting deploy.

Read the README's "Screens" and "Known issues / next steps" sections before
starting.
```

## Screens
1. **Home** — low-stock banner, backup-nag banner, "Next up" hero card (countdown + leave-by time using a travel-buffer setting), Today list, Upcoming list (date-grouped), empty states.
2. **Add** — 3 input modes: Manual form, "Paste WhatsApp chat" (regex-based parser pulls name/phone/date/time/service/address from free text), "Screenshot" (tesseract.js OCR → same parser). Shared review form below. "Log a past appointment" toggle switches Save into logging a completed visit (requires price + payment method up front).
3. **Search** — filter all appointments (past + upcoming) by name/phone.
4. **Insights** (bottom nav "Insights") — this week's revenue, completed count, top clients by revenue, top services by count, payment-method breakdown, completed history list.
5. **Inventory** — stock items (name, qty, unit, low-stock threshold) with +/- adjusters, low-stock banner surfaced on Home too.
6. **Detail** (tap any appointment) — full info, Call/WhatsApp/Directions/Add-to-Google-Calendar links, reschedule (keeps a struck-through history trail vs. a highlighted current time), cancel, mark-completed (blocks completion until price + payment method are entered), delete.
7. **Settings** (gear icon, header) — Cloud backup (Firebase email/password + Google sign-in, graceful "not configured" fallback), Google Business Profile review-reply shortcut link, manual Export/Import JSON backup with a "last backup" nag.

## State model (see the `Component` class in the .dc.html `<script>`)
- `appointments`: array of `{id, name, phone, service, date, time, address, price, paymentMethod, notes, status: 'upcoming'|'done'|'cancelled', history: [{date,time}, ...]}`. Persisted to `localStorage['asha_appointments_v1']` and, if signed in, Firestore `users/{uid}.appointments`.
- `inventory`: array of `{id, name, qty, threshold, unit}`. Same dual persistence, Firestore `users/{uid}.inventory`.
- Screen navigation is a single `screen` state string (`home|add|search|earnings|inventory|detail|settings`) — no router.
- Firebase is fully optional: `initCloud()` no-ops if `firebase-config.js` still has placeholder values.

## Design tokens
- Colors: accent indigo/purple `#3d4a7d` and accent-soft emerald `#12a457` (both sampled from the SAMakeovers Media logo), background lavender-white gradient `#f2f1f8 → #e8e7f2`, card surface `#fdfdff`/`#fff`, text `#2c2a52` / `#453f78` / muted `#7d79a8`. (Originally a generic rose/blush placeholder palette; recolored to match the real logo once it was provided.)
- Fonts: Georgia/Times New Roman serif for the "SAMakeovers" wordmark; Poppins (600/700) for section headings; Inter for body/UI text.
- Radius: 16-18px cards, 10-14px buttons/inputs, 36px outer phone frame.
- Phone-frame layout: centered, max-width 420px, min-height 820px — designed as a mobile app, not a responsive website.

## Known issues / next steps to hand to the developer
- **Google Sign-In** will throw "requested action invalid" until the deployed domain is added to Firebase Console → Authentication → Settings → Authorized domains. Email/password works from any domain.
- **Firestore security rules** must restrict each user to their own doc:
  ```
  match /users/{uid} { allow read, write: if request.auth != null && request.auth.uid == uid; }
  ```
- No true native app store binary yet — currently a PWA (installable, offline-capable via the included service worker + manifest). Path to a sideloadable APK: deploy to a permanent HTTPS URL (Firebase Hosting config included) → run through pwabuilder.com → Android package.
- OCR (tesseract.js, loaded from CDN) and the chat-text parser are heuristic — they populate the form for the user to review/correct, not authoritative.
- No automated tests exist; logic worth covering: overlap detection window (±1hr), reschedule history append, analytics aggregation (`byKey` in the logic class).

## Assets
- App icons generated as a rose gradient monogram "A" (`icons/icon-192.png`, `icons/icon-512.png`) — placeholder, swap for real branding.
- No other external imagery; Google icon SVG is inlined in the Google Sign-In button.

## Files
All in `source/`:
- `Asha Appointments.dc.html` — the entire app (markup + logic in one file; ignore the `<x-dc>`/`{{ }}` template wrapper, the inner `<script>` block is the portable business logic)
- `firebase-config.js` — real Firebase project keys (already wired to a live Firestore project)
- `firebase.json`, `.firebaserc` — Firebase Hosting deploy config
- `manifest.json` — PWA manifest
- `sw.js` — service worker (network-first caching)
- `icons/` — app icons
