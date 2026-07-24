# openbooker regression suite

Playwright-driven browser tests for the app in the parent folder (`../index.html`
+ `../app.js`). No build step for the app itself, and no test framework
dependency beyond Playwright — each file is a self-contained script that exits
0 on pass, 1 on fail.

## Setup (one-time)

```
cd tests
npm install
npx playwright install chromium
```

## Running

Run everything (starts its own local static server on port 8888, no need to
start one yourself):

```
node run-all.js
```

Run one file directly against a server you already have running elsewhere:

```
BASE_URL=http://localhost:5000 node 07-search-phone-normalization.test.js
```

## What each file covers

| File | Covers |
|---|---|
| `01-core-flows.test.js` | Full-bleed phone layout, correct mobile keyboard types, day-availability panel on Add, History nav rename, CAD currency |
| `02-settings-screen.test.js` | Google-reviews section removed, Automatic reminders + Services sections present |
| `03-click-race-fix.test.js` | Regression: a button tap right after typing into a field could get silently swallowed |
| `04-noshow-handling.test.js` | Overdue-appointment "needs an outcome" banner, Next-up skips overdue entries, no-show status end to end |
| `05-calendar-multiservice.test.js` | Month calendar (dots, drill-down, slot tap), multi-service chip selection, legacy single-service backward compat |
| `06-edit-datetime.test.js` | "Edit details" can change date/time and records the same history trail as Reschedule |
| `07-search-phone-normalization.test.js` | Regression: phone search ignoring punctuation (dashes/spaces) formatting differences |
| `08-repeat-client.test.js` | "Recent clients" quick-pick and "Book again" prefill correctly |
| `09-header-now-label.test.js` | Live "Today: ..." header anchor, shared across screens |
| `10-default-address.test.js` | New bookings default to the home-base address, still overridable |
| `11-clients-directory.test.js` | Client directory backfill/dedup/aggregation, consent persistence, upsert-on-save |
| `12-client-management.test.js` | Manually adding a client, merging duplicates, cancelling a merge, consent toggle outside merge mode |
| `13-clients-cloud-reconcile.test.js` | Regression: client directory getting permanently stuck at whatever was locally cached at boot, instead of reconciling once the fuller cloud-synced history arrives |
| `14-backup-completeness-and-safety.test.js` | Regression: backup export/import covering inventory+services+clients (not just appointments), delete confirmations for appointment/inventory, and non-numeric price rejection |
| `15-day-off-blocking.test.js` | Marking/unmarking a day off from the Calendar (grid marker, hides availability list, existing bookings still show), Add screen warns (doesn't block) if the picked date is marked off |
| `16-business-profile.test.js` | Owner-editable Business details settings (name/tagline/location live in the header, accent color updates CSS vars at runtime, currency shows in Earnings, business hours change the Add screen's slot count, all of it persists across a reload) |
| `17-logo-upload.test.js` | Owner-uploaded business logo: auto-crop/resize to a data URI, header image + browser tab favicon update live, persists across reload, "Remove logo" reverts to the text-only header and default favicon |
| `18-auth-gate.test.js` | SaaS build's mandatory sign-in gate (`REQUIRE_AUTH`): normal app/nav unreachable while signed out, Terms/Privacy consent required before submitting either sign-in path, sign-in/create-account tab switching |
| `19-onboarding-wizard.test.js` | Regression: a brand new tenant (fresh Firestore doc) must fill in their own business details before their first cloud write, instead of inheriting `DEFAULT_BUSINESS_PROFILE`'s seed values; business-name-required validation; finishing the wizard unlocks the app |
| `20-subscription-paywall.test.js` | Subscription paywall gate: blocks the app without an entitled subscription, `trialing` counts as entitled (not just `active`), `past_due`/`canceled` show the right banner, becoming entitled unlocks the app live without a reload |
| `21-timezone-setting.test.js` | Per-tenant timezone `<select>` in Business details persists across reload (the Cloud Function side -- reading it per-tenant instead of a hardcoded zone -- isn't reachable from this harness) |
| `22-existing-data-migration-safety.test.js` | Regression: an existing installer with real local data (not a blank slate) who signs in for the first time under mandatory auth must NOT be routed into the onboarding wizard -- their existing business profile/appointments sync up as-is instead |

## Adding a new test

Copy the shape of any existing file: seed `localStorage` via
`page.addInitScript`, drive the UI via `data-action` attributes (grep `app.js`
for `data-action=` to see what's available), assert with `assert`, and end
with the same `.catch(e => { console.error(...); process.exit(1); })` pattern
so `run-all.js` can detect failure. Name it `NN-description.test.js` so it
sorts sensibly and `run-all.js` picks it up automatically.

This is a SaaS build (`REQUIRE_AUTH = true` in `app.js`) -- every real screen
sits behind sign-in + onboarding + an entitled subscription (see
`renderEntitlementGate()`). Unless your test is specifically about that gate
(like 18-20 above), call `const { bypassGate } = require('./lib/bypassGate');`
and `await bypassGate(page);` right after `page.goto()` to skip straight past
it into a fully set-up test tenant. Call it again after any `page.reload()` --
the gate's in-memory state doesn't survive a reload, but bypassGate is
idempotent about `businessProfile` (see its own comments) so it won't clobber
real values an earlier part of your test persisted.
