# Appointment delivery, timezones, directory integration and production

Implementation is prepared. Build, integration, browser and deployment tests are intentionally deferred until the final project testing phase. These additions have not been deployed or exercised against a real email account, relay, directory or production database.

## Appointment emails

Creating a request or accepting, declining, proposing a new time or cancelling queues a status update for each verified participant whose appointment emails are enabled. The appointment and its queued notifications commit together. Acceptance also queues reminders 24 hours and one hour before the start when those times are still in the future. Short-notice bookings do not receive a burst of overdue reminders. In-person appointments receive the same notifications.

Changing an appointment removes pending notifications for its previous revision. Each message rechecks the appointment revision, membership, account state, email verification and current email preferences immediately before delivery. Deletion removes queued appointment messages for both participants. A message already handed to the email provider cannot be recalled; recipients should use the signed-in app as the current source of truth.

The outbox is durable. Atomic 90-second message leases prevent simultaneous workers from normally delivering the same job. A stable provider idempotency key accompanies retries. Delivery uses a 15-second request timeout, exponential retry delay capped at one hour and eight attempts before a failed state. Expired updates, reminders and account-action messages are purged. A process crash or provider with no idempotency guarantee can still lead to duplicate delivery; this is not an exactly-once email system. Mailpit is development only; Resend is production.

Messages have neutral subjects and show only status, time with UTC offset and timezone, duration and a normal sign-in link. They contain no patient name, alias, email address of the other participant, clinical notes or room ticket. Each recipient gets a separate message, never a shared To/CC list.

Verified administrators can inspect queue counts and failed message IDs through `GET /api/admin/operations`. Responses omit addresses, account-action URLs and message bodies. `POST /api/admin/mail/retry` with `{"id":"MESSAGE_ID"}` retries an unexpired failed message; current eligibility is rechecked before delivery. Successful/expired messages cannot be replayed through this endpoint.

For accepted appointments created before this rollout, a verified administrator can call `POST /api/admin/mail/schedule-reminders` with `{}` to schedule future reminder times in batches of 50. Repeat with `{"afterId":"RETURNED_NEXT_AFTER_ID"}` until `nextAfterId` is null. This does not generate status emails or overdue reminders, preserves pending status updates and respects account preferences. Existing records are not silently changed during startup.

## Timezones and preferences

UTC epoch seconds remain the booking authority. Existing numeric `startAt` requests work without migration. Existing records and accounts without a timezone default to UTC. Timezone changes alter presentation and future local-time entry, never move existing appointments.

`GET /api/account/preferences` and `PUT /api/account/preferences` require the user's bearer token. A partial update accepts only these fields:

```json
{"timeZone":"Africa/Johannesburg","appointmentEmails":true,"appointmentReminders":true}
```

Appointment emails/reminders default to enabled for verified accounts. Disabling appointment emails also suppresses reminders; account verification and password recovery remain available. Changing delivery preferences regenerates future accepted-appointment reminders for that user. Opting back in schedules future reminder times only. The preferences API, login and `/api/me` expose the chosen values to the frontend. Frontend preference controls are a subsequent task.

`GET /api/timezones` lists supported named zones from ICU. ICU's installed timezone rules are used, rather than a hardcoded country-to-offset table. Rebuild dependencies as timezone rules change.

Availability and community event creation accept **one** of:

- `startAt`: finite UTC epoch seconds, plus optional `timeZone` metadata.
- `localStart`: `YYYY-MM-DDTHH:mm`, with required named `timeZone`. If the clock repeats that time, supply `occurrence: "earlier"` or `"later"`. Nonexistent daylight-saving times are rejected instead of silently shifted.

Example local-time availability payload (a future valid date is still required):

```json
{"localStart":"2027-01-20T14:00","timeZone":"Africa/Johannesburg","location":"Confirmed practice address"}
```

The existing 30-minute duration, UTC half-hour grid, five-minute notice and 90-day availability window remain enforced. Appointment responses include `time: {startAt, localStart, timeZone}` formatted for the signed-in viewer and the slot's `sourceTimeZone`. LocalStart output includes an explicit UTC offset. Public availability retains the numeric timestamp and slot timezone. No patient timezone preference is exposed to the expert as account metadata.

## Real clinic data

Public clinic search stays database-backed. It does not send patient searches or device locations to a third-party directory. The operator can populate that database from a reviewed data file or an OpenStreetMap preview.

Set `CLINIC_OSM_ENABLED=true` only when the operator wants to use the external source. `POST /api/admin/clinics/osm-preview` requires a verified administrator and numeric `lat`, `lng`, `radius` (100-10000 metres). It calls the fixed HTTPS Overpass endpoint with generated parameters, a bounded server query, a 25-second client timeout and a maximum of 50 preview items. No arbitrary URLs or raw queries are accepted. Its area-level external request is explicit and separate from patient searches. Public Overpass availability/quotas are outside this application's control.

The preview includes mental-health-tagged providers and general clinics/hospitals; the category is source data, not a verified clinical endorsement. Missing addresses remain missing for the administrator to investigate. No opening hours, ratings, availability or practitioners are fabricated.

Use Node 22 or later and your own short-lived, verified administrator token:

```powershell
$env:TRANQUIL_ADMIN_TOKEN='YOUR_SHORT_LIVED_TOKEN'
node tools/clinic-directory.cjs preview --lat -25.75 --lng 28.23 --radius 5000 --output clinic-review.json
```

The coordinates above select an area, not a claimed clinic. The tool creates the output file exclusively and will not overwrite earlier work. Review each clinic, complete its accurate address/city/country, remove unconfirmed entries, preserve attribution, and explicitly set `reviewed: true`. Then:

```powershell
node tools/clinic-directory.cjs import --file clinic-review.json
Remove-Item Env:TRANQUIL_ADMIN_TOKEN
```

The API accepts batches of 1-50 items under the existing 64 KiB request limit; use smaller batches for long addresses. An empty preview is not importable. For a production service, add `--base https://YOUR_HOSTNAME` to each command. Tokens are never printed by the tool and redirects are rejected.

`POST /api/admin/clinics/import` also accepts a vetted directory from another permitted source. Its JSON envelope requires `sourceId` (lowercase letters/digits/underscore/hyphen), `sourceName`, HTTPS `sourceUrl`, `reviewed: true`, and `items`. Each item requires `externalId`, `name`, `lat`, `lng`, `address`, `city`, `country`; optional fields are `suburb`, `phone`, HTTPS `website`, and `category` (`mental_health`, `general_clinic`, `hospital`). Check the source's permission/licence before importing.

Stable IDs are derived from source ID and external ID. Reimporting updates that source record rather than appending duplicates. Records from different sources are not automatically merged; the operator should reconcile overlaps. A batch is transactional and recorded in a private import audit. Missing source records are not automatically deleted. Archived records stay archived. Manual management edits lock imported records against later refreshes unless the administrator explicitly sends `overwriteReviewed: true`. Ownership and professional approval flows are not changed by imports.

Public responses include source name, source URL and refresh timestamp; clinic cards display the source link. OpenStreetMap records retain contributor attribution and the ODbL copyright link. Do not remove attribution in future frontend work. Operators should review stale records regularly; no automatic sync timer is enabled.

## Production setup

Use **standalone `compose.live.yaml`**, not an override of the development stack. It has no application/database published ports; only Caddy publishes 80/443. MongoDB requires authentication, cluster-key replica-set authentication and an app-scoped read/write user. The app runs as its existing unprivileged user with a read-only filesystem, temporary scratch mount, dropped capabilities, and mounted secrets. It has outbound access for email and the optional clinic source. MongoDB uses a separate internal network. Development Mailpit is absent.

`*_FILE` is supported for configuration secrets. Set either the direct value or the corresponding secret file, never both. The server fails closed in production unless email, HTTPS origin, authenticated MongoDB and a TURN URL/shared secret are configured. Startup logs do not contain secret values. The production proxy overwrites X-Real-IP and the isolated app trusts that header for per-client rate-limit keys. Do not enable `TRUST_PROXY_HEADERS` when directly exposing the app. Process-local rate limits are not a shared global limiter.

Prepare configuration once, using your real DNS hostname, verified sender address and existing TURN relay URL:

```powershell
.\tools\configure-production.ps1 -Domain YOUR_HOSTNAME -MailFrom YOUR_VERIFIED_SENDER -TurnUrl YOUR_TURN_URL
```

The script privately prompts for the Resend key and the shared secret already configured on your relay. It generates database, signing and replica-set keys in ignored `deploy/secrets` files and non-secret settings in ignored `.env.production`. It refuses to overwrite an existing production configuration or secret directory. No accounts, domains, certificates, mail providers or TURN servers are provisioned by this script. Protect these files with host filesystem permissions and an encrypted backup; Docker Compose file secrets are not a vault and are not automatically encrypted at rest. Never change database credentials/cluster keys by regenerating files for an existing database volume.

Transfer the project and protected configuration to the intended Linux Docker host, point DNS to it, permit inbound 80/443, configure the relay separately, then run:

```sh
docker compose --env-file .env.production -f compose.live.yaml up -d --build --wait
```

Caddy obtains and renews the HTTPS certificate and proxies WebSockets. New production volumes are separate from development data. `deploy/mongo-init.js` creates the app user only on first initialization. Existing development data is not automatically migrated; plan an explicit, backed-up migration during final deployment work. This single-node replica set is not high availability and its internal traffic/storage are not encrypted by this Compose file. Use an authenticated managed replica set or additional infrastructure when those guarantees are required.

Create/verify the intended operator account normally. Grant admin access only through the existing trusted CLI in the production app container, then sign in again. Imported clinics and professional reviews remain explicit operator decisions.

For a private oplog-consistent archive:

```sh
mkdir -p backups
chmod 700 backups
docker compose --env-file .env.production -f compose.live.yaml run --rm backup
```

The root-authenticated maintenance container writes an archive without printing credentials or streaming binary data through PowerShell. Archives include sensitive account data and database users. Keep them encrypted, restrict access, apply retention, and store a copy away from the host. Scheduling and off-host upload are operator tasks. Restore into a separate isolated replica set first, using MongoDB's `mongorestore --archive --gzip --oplogReplay` workflow; do not restore over the live database without an approved recovery plan.

## Final validation phase

Before launch, execute the deferred build/test work: backend compilation with ICU; timezone DST gap/repeat cases and legacy UTC records; separate-recipient emails, short-notice reminders, lease recovery and retry exhaustion; reschedule/cancel/delete and preference races; source preview/import permissions, invalid data, idempotent reimport, attribution and manual-edit preservation; fresh authenticated production initialization, restart, HTTPS/WebSocket/TURN/email operation, backups and isolated restore. Add frontend controls and exercise patient/expert/admin journeys before accepting real appointments. The earlier CI results predate these changes and are not evidence for this implementation.

References used for implementation: [ICU calendar API](https://unicode-org.github.io/icu-docs/apidoc/dev/icu4c/ucal_8h.html), [Overpass usage and resource limits](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html), [OpenStreetMap copyright and licence](https://www.openstreetmap.org/copyright).
