# SAMakeovers regression suite

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

## Adding a new test

Copy the shape of any existing file: seed `localStorage` via
`page.addInitScript`, drive the UI via `data-action` attributes (grep `app.js`
for `data-action=` to see what's available), assert with `assert`, and end
with the same `.catch(e => { console.error(...); process.exit(1); })` pattern
so `run-all.js` can detect failure. Name it `NN-description.test.js` so it
sorts sensibly and `run-all.js` picks it up automatically.
