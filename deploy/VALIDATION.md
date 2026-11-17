# Combined validation — 17 November 2026

The backend and frontend from PRs #7 and #8 were merged before validation began. Fixes and final checks are tracked in [PR #9](https://github.com/Louie-pixel/Tranquil_Talk_V3/pull/9). Its Checks tab is the authority for the latest commit; no public deployment is performed by this validation work.

The first complete passing combined run was [44117104493](https://github.com/Louie-pixel/Tranquil_Talk_V3/actions/runs/44117104493), at commit `dd5f10e40e3f3f75214573e7db1ad46cfe2d5a59`. That run passed all four CI jobs, with no skipped API integration suites. Subsequent validation commits add the Caddy configuration check and preserve successful integration artifacts; review their latest CI result on PR #9.

## Fixes found

- The pinned MongoDB driver has no `mongocxx/options/return_document.hpp`. Removing the invalid include allows the backend to compile using the declarations supplied by its existing find-and-update header.
- Native availability validation used a 15-minute step anchored to a dynamically changing minimum timestamp. For example, a minimum of 09:17 made a valid 12:00 half-hour slot fail browser validation before any API request. Availability now accepts minute-granularity input and leaves UTC half-hour validation to the backend. A browser regression test uses that exact minimum-time mismatch.
- Existing UI checks were updated for explicit calendar time selection and named-zone event entry. A cancellation test now waits for the asynchronous request; the public-profile test derives its origin instead of hardcoding one test port.
- The browser harness can use an explicitly started test server on a chosen port, avoiding Windows child-server teardown issues. Default CI remains isolated on its standard test server.

## Automated coverage

| Area | Evidence exercised |
| --- | --- |
| Build | Full C++/Drogon backend with ICU, C++ core validation/booking/room/rate-limit rules, Qt desktop compilation and browser JavaScript syntax |
| Browser interface | 22 Chromium tests; desktop and 390/320-pixel reflow, separate pages/history, signup/signin, profile/registration management, calendar/time keyboard choices, date/status/search filters, cancellation confirmation, timezone preferences and calendar download |
| Accessibility | Axe scans with WCAG A/AA and 2.1 AA tags on appointment, account, clinic, booking-dialog and waiting-room surfaces; skip-link/focus, keyboard interaction, reduced-motion and viewport checks |
| Clinics | Location success and denial/unavailable/timeout recovery, stale callback protection, real database area matching and escaped search; consent before any tile request, fixture-tile zoom/marker/card interaction, category/contact filters and attribution |
| Booking | Verified accounts, expert approval/revocation, concurrent reservation conflicts, per-patient conflicts, stale revisions, proposals/acceptance, cancellation, in-person rules and participant-bound room access |
| Email/timezone backend | Actual HTTP delivery to isolated Mailpit; verification/reset single-use links, status emails, 24-hour/one-hour reminder scheduling, preferences, forced-due reminder delivery, stale reminder removal, retry of a failed fixture job, IANA zone validation and DST skipped/repeated local times |
| Directory imports | Admin-only access, invalid-batch rollback, deterministic reimport, attribution/public-field allowlist, preservation of reviewed edits and archives; external-source requests remain disabled in CI |
| Combined journey | Real browser signup/verification, professional availability, account timezone save, calendar booking, acceptance, early local device check, rescheduling/acceptance, two-account audio consultation, mute/track release, cancellation, real database clinic search/map with fixture tiles, password reset and old-session rejection |
| Calls | Two existing real-browser call scenarios plus the combined journey, using Chromium emulated media devices; audio mode has zero camera tracks, signalling starts only on entry, alias-only display and actual track cleanup are asserted |
| Production configuration | Isolated standalone Compose stack: fresh secret-file setup, app-scoped authenticated MongoDB replica set, unauthenticated access rejection, application readiness/restart, Caddy config validation, private oplog backup and restore into a separate disposable replica set |

Local execution passed the 22 browser tests, 12 call-engine tests, C++ core rules and syntax parsing of all five PowerShell launch/configuration scripts. Local browser screenshots of clinic, booking and waiting-room layouts were visually reviewed. Docker is not installed on this computer, so full backend, database and production-container execution use GitHub CI.

## Reproduce

Run `npm test` and the documented C++/Docker checks. The complete CI workflow is `.github/workflows/ci.yml` and explicitly requires fixture containers for integration suites. Browser tools are temporary test dependencies:

```sh
npm install --no-save --package-lock=false @playwright/test@1.56.1 @axe-core/playwright@4.10.2
npx playwright install --with-deps chromium
npx playwright test
```

The full journey uses `playwright.journey.config.cjs` with a disposable backend on port 8086, MongoDB fixture access and local Mailpit. Expanded API checks use port 8085. The production test runs only when `TEST_ALLOW_PRODUCTION_FIXTURE=1`; it creates its own temporary source/configuration directory, unique Docker project and volumes, then removes only those fixtures. Never point integration tests at real patient data or an existing deployment.

Browser artifacts contain fixture-only screenshots/traces. Automated map tests intercept tile requests; they do not scrape or generate traffic to community map services. Reminder checks accelerate disposable outbox due times rather than waiting days. Trusted database fixtures establish the reviewed professional for the combined journey; the separate API suite exercises the actual administrator registration-review lifecycle.

## Remaining live deployment checks

- No real domain/certificate was provisioned. Caddy validation checks configuration, not live DNS, certificate issuance/renewal or public HTTPS.
- Mailpit verifies actual local email delivery. Delivery through a real Resend account, verified sender domain and recipient inbox/spam handling still needs the operator's credentials and live verification.
- Calls use actual WebRTC with emulated media on one CI host. A real TURN relay, restrictive/separate networks, hardware microphones/cameras, speaker routing and mobile OS permissions still need live checks.
- Device location and map requests are covered with controlled fixtures. Real-device location services, live map/Overpass availability and reviewed real clinic records remain operator checks.
- Automated accessibility scans and keyboard/viewport checks are not a WCAG certification or a substitute for assistive-technology review.
- The production restore check uses disposable data. The deployment owner must configure host/storage protection, off-host backup retention and their real recovery process. No real service was deployed or real account messages sent.
