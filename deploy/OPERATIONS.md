# Complete application and deployment

For appointment delivery, named timezones, clinic integration and the authenticated production stack, follow [BACKEND-ROLLOUT.md](BACKEND-ROLLOUT.md). The combined final checks and remaining live-deployment requirements are recorded in [VALIDATION.md](VALIDATION.md); PR #9 provides the latest CI result.

The static layout preview does not run real accounts, booking or calls. On Windows, install/open Docker Desktop with Linux containers and run `tools/start.ps1` from the repository. The launcher generates local configuration, starts the real API/database and local email inbox, and checks readiness. The application opens at http://localhost:8080; captured development emails are available at http://localhost:8025. See README.md for complete setup commands.

## Booking and consultation journey

1. Create patient and professional accounts. Sign in, open Account and request an email verification link. Confirm it through the emailed link.
2. The professional submits a profile for the existing administrator registration review. Approval is still manual and must match the current profile revision.
3. The approved professional opens Appointments and offers thirty-minute slots, on the hour or half hour. Include a meeting location for in-person support. Availability must be at least five minutes ahead and within ninety days.
4. The patient opens the professional's public profile and chooses See available times, a consultation method, a slot and a display alias.
5. The professional accepts, declines or proposes another offered time. A proposed time requires the patient's acceptance. Either participant can cancel before the appointment starts.
6. For accepted audio/video appointments, the waiting room opens ten minutes before the start and closes at the end of the thirty-minute session. Check microphone/camera, confirm readiness and enter. In-person appointments have no call room.

Times are stored as UTC epoch seconds and displayed using the device's local timezone. Requests reserve both participants' entire slot immediately. MongoDB transactions commit reservations, proposals, cancellations and appointment revisions atomically. Unique reservation IDs prevent both expert and patient double bookings, including a patient booking two experts at the same time. Stale decisions return a conflict. Slot removal cannot race a reservation successfully.

The supplied MongoDB service is a single-node replica set because these operations require transactions. Native standalone MongoDB installations must be converted to replica sets. Failed transactions do not fall back to partial writes. For production, use an authenticated managed replica set, encrypted storage and tested backups; the supplied isolated database is a development baseline.

Appointment responses omit the internal patient ID and email; professionals see the chosen alias. Voice or shared information may still identify someone. Room tickets are scoped to one participant, and joining additionally requires that participant's current API bearer token. A forwarded room ticket alone is insufficient. Only an accepted appointment, current account/session version and currently approved expert can enter. Existing general private-invitation rooms remain a separate, explicitly shareable feature.

Appointment access is rechecked on every signaling message and every ten seconds while connected. Cancellation, suspension, deletion and password-reset revocation terminate access. Only one socket per participant is allowed in a consultation. Device checks do not send media to another peer. ICE reconnection makes up to two restart attempts from the offerer. Socket failure and peer departure stop media; Reconnect repeats authorization and the device check instead of silently enabling devices.

The current scope is thirty-minute sessions, up to 200 returned appointments and 200 future slots. Unanswered requests are held until declined or cancelled; there are no automatic reminders, payments, recurring schedules or automatic clinical matching. Sign-in state stays in memory within the open page. Reloading requires signing in again. Use a single app instance for signaling; distributed scaling needs shared signaling and throttling.

## Email delivery and account actions

For production, set `APP_BASE_URL` to the exact site origin without a trailing slash, `RESEND_API_KEY` to a private provider key and `MAIL_FROM` to an address on a verified sender domain. The production email adapter uses Resend. Local Compose instead uses `MAIL_MODE=mailpit`, `APP_ENV=development` and the fixed internal `MAILPIT_URL=http://mailpit:8025`; verification/reset emails arrive in a loopback-only local inbox without being delivered externally. Production refuses development mail modes. Public production origins must use HTTPS; the local `http://localhost:8080` and `http://127.0.0.1:8080` origins are allowed for development.

The private durable outbox uses message leases and exponential retry delays capped at one hour. Eight failed delivery attempts mark a message failed; an administrator can retry an unexpired message. Provider idempotency keys accompany retries. Successful delivery removes the pending email. Account tokens are SHA-256 digests in the action collection; their raw links are temporarily present only in pending email records. Links expire after thirty minutes, can be used once and are invalidated by a password reset. Public APIs never return the links. Resetting the password increases a session version checked by API requests and consultation sockets.

`MAIL_MODE=outbox` queues emails without delivering them and is for isolated automated tests only. CI reads test links through trusted Docker/database access. Do not enable that mode in production. If delivery is unconfigured, account email requests show a configuration error.

Account deletion requires the current password and typing `DELETE`. One transaction removes the user, expert profile and availability, all appointments involving the user, their reservations, pending email and action tokens, owned articles and reports they submitted. Counterpart appointment records disappear too. API access ends immediately and active consultation sockets close on the next access check. Already-delivered email, external backups and legacy articles predating owner tracking need the operator's retention process. Set a retention policy and privacy notice before collecting real patient information.

Verified-email users can report expert profiles, articles or their own appointments. Only administrators can read reports and record private decisions. They can dismiss reports, remove reported articles or restrict reported non-admin experts. Restrictions disable the account, revoke sessions and suspend its profile. A trusted operator must review any restoration; self-service cannot restore restricted access. Then reopen/review the profile through the existing verification workflow. Reports are not an emergency response channel.

## TURN relay and HTTPS

Provision coturn or a service supporting TURN REST shared-secret authentication. `turnserver.conf.example` provides a starting configuration: replace the hostname, public IP, certificate paths and shared secret on your relay host. Open the configured listener and relay port range. Configure `TURN_URL`, for example `turns:turn.your-domain.com:5349?transport=tcp`, and the server-side `TURN_SECRET`.

Authenticated clients receive one-hour HMAC credentials, never the shared secret. Configured appointment calls force relay transport. Without TURN, the waiting room clearly explains the STUN fallback and its connectivity/network-privacy limitations. CI checks credential generation. A real relay still requires testing from separate restrictive networks, including a relay-only connection.

For HTTPS, provision a server with Docker Compose, point a real DNS hostname to it and open TCP 80/443. Set `DOMAIN`, `JWT_SECRET`, `RESEND_API_KEY`, `MAIL_FROM`, `TURN_URL` and `TURN_SECRET` in its private environment. Run:

```sh
docker compose --env-file .env.production -f compose.live.yaml up -d --build --wait
```

Caddy obtains/renews the certificate, redirects HTTP to HTTPS, proxies WebSocket upgrades and sends HSTS. Certificate state persists in named volumes. Production MongoDB is authenticated on an internal-only network; the app has a separate network for outbound email. The standalone production stack publishes no application/database ports and uses protected secret files prepared as described in BACKEND-ROLLOUT.md. The old development overlay is deprecated.

This is a deployment configuration, not a provisioned public deployment. A real domain/server, verified sender and relay credentials must be supplied. Verify live HTTPS, email delivery, backups/restore and calls before launch. Keep the host and dependencies patched. The code does not claim encryption at rest or high-availability hosting.

## Validation and navigation

Run `npm test` for syntax and WebRTC lifecycle checks. Compile/run `tests/core_test.cpp` for validation, booking transition and join-window boundaries. CI builds the real backend and runs MongoDB replica-set tests for booking races, patient conflicts across experts, revision conflicts, proposals, protected rooms, single-use email links, recovery revocation, deletion and moderation. Browser tests cover separate-page navigation, mobile layout, alias booking, account links, expert verification and two-browser calls. All test professionals are fixtures, never real seeded directory entries.

Pages: `/#experts`, `/#appointments`, `/#care`, `/#connect`, `/#stories`, `/#events`, `/#account`, `/#professional`, `/#verification`.

## Entry pages and clinic discovery

The root opens a full sign-in page. Create account opens a separate sign-up page; a successful sign-in opens Home. Explore is a keyboard-accessible dropdown. Existing public profile, clinic and invitation links remain usable. Sign-out returns to sign-in.

Clinic discovery accepts a suburb, city or clinic name, or requests the device location and searches immediately. Location errors explain permission, device availability or timeout recovery, and area search stays available. Coordinates and search radius are not exposed as form controls. Distance labels are approximate straight-line distances; hours, ratings and travel times are never invented. Area search matches metadata in the Tranquil Talk directory; it is not an external geocoding service or a complete worldwide provider search. Existing clinic entries should be updated with accurate public address/city/suburb/contact fields for area search to find them. Google Maps is an explicit external fallback.

The public clinic endpoint supports GET /api/clinics?q=AREA alongside the existing coordinate API. Verified expert clinic creation also accepts optional address, suburb, city, country, phone and HTTPS website fields. Only these public listing fields are returned.

For layout-only viewing, run node tools/preview.cjs 8100. This explicitly labels itself as a preview and returns a service-unavailable response for account and directory operations. It never simulates a successful sign-in or makes an offline directory appear empty. For functional sign-in and live clinic results, run the Docker application above.


## Backend management and readiness

GET /api/health checks database connectivity. Startup requires a writable replica set. Clinic and event management are available in Account with transaction-backed ownership/role checks and revision conflicts. Experts manage owned clinic listings; administrators manage all clinics and community events. DELETE archives a listing/event, which removes it from public responses. PUT can restore a valid record. Management lists support fifty records per page and nextOffset pagination. Account deletion also removes owned clinic listings. Legacy clinic records without owners are manageable only by administrators.

Use tools/status.ps1 to check readiness, tools/stop.ps1 to stop without deleting volumes and tools/grant-admin.ps1 only for an existing operator account whose ownership is confirmed. Development mail mode accepts only the fixed local Mailpit service/loopback origins. Do not expose the local inbox or enable it in production. Mailpit API reference: https://mailpit.axllent.org/docs/api-v1/ .

