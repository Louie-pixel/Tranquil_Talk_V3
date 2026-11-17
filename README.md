# Tranquil Talk

**Speak freely. Heal quietly.**

Tranquil Talk uses a C++17/Drogon API, MongoDB replica-set database, a shared browser interface and an optional Qt desktop shell. The server serves both the interface and APIs from the same origin. Node is used for tests and the explicitly labelled layout preview.

## Run the complete application on Windows

Install and open Docker Desktop with Linux containers, then run from this repository:

```powershell
.\tools\start.ps1
```

The launcher checks Docker, generates a signing key in a private `.env` if needed, builds the application, starts MongoDB and a local email inbox, and checks API readiness. It preserves existing configuration and data. The first build compiles pinned C++ dependencies and can take several minutes.

- Application: http://localhost:8080
- Local development email inbox: http://localhost:8025
- Readiness: http://localhost:8080/api/health

Create an account, sign in and request verification from Account. Open the verification email in the **local test inbox** and confirm its link. Password recovery uses the same inbox. These development messages are captured locally, not delivered to real email addresses. No email-provider account is needed for this local flow.

Use `tools/start.ps1 -Port 8101` to choose another application port. `tools/status.ps1` checks services and API readiness. `tools/stop.ps1` stops services while preserving data volumes. These scripts require PowerShell 5.1 or later and Docker Compose v2. They do not install Docker or request administrative access.

On Linux/macOS, copy `.env.example` to `.env`, replace `JWT_SECRET` with a random string of at least 32 characters, then run `docker compose up -d --build --wait`. Compose supplies the internal MongoDB URI and local mail provider configuration. Never commit `.env` or actual credentials.

## Supported workflows

- Sign-up and bcrypt sign-in; one-hour JWTs, current database role checks and session-version revocation.
- Email verification and single-use password recovery links; private durable delivery outbox with retries.
- Expert draft profiles, manual credential review, revision-specific approval, suspension and private review history.
- Clinic search by device location or area/name, with public address/contact fields and no fabricated providers.
- Verified experts manage their own clinic listings; administrators can manage all listings, including legacy records. Archive and restore preserve records while controlling public visibility.
- Thirty-minute availability, patient alias booking, accept/decline, expert counterproposal, patient confirmation and cancellation. Transactions and unique per-person reservations prevent double bookings.
- Accepted appointment rooms require the matching signed-in participant, current session, join window and approved expert. Audio-only mode avoids the camera. Device checks, temporary TURN credentials, relay-only policy when configured, bounded ICE restart and explicit reconnect are included.
- Verified expert articles, administrator-managed community events and a reflection space held only in the open page.
- Password-confirmed account deletion and private reports reviewed by administrators. Clinic/event management uses role/owner checks, transactions and revision conflicts.

The first page is sign-in, signup has its own page, and a successful login opens Home. Explore provides the other pages. Public clinic, profile and invitation links remain accessible.

## Administrator setup

Create and verify the intended operator account first. A trusted operator who has confirmed ownership can grant administrator access to that existing account:

```powershell
.\tools\grant-admin.ps1 -Email operator@example.com
```

Equivalent Docker command:

```sh
docker compose exec -T app /app/TranquilBackend --grant-admin operator@example.com
```

Public signup cannot create administrator or approved professional accounts. An administrator cannot approve their own professional profile. Review requires matching the applicant against an official professional register and recording a source and notes. Approval is a manual review, not an automated identity/licence check. Changes to an approved profile withdraw it from public listings until reapproved.

In Account, verified experts see Clinic listings. Administrators additionally see Community events and the safety review queue. Record coordinates in the professional clinic editor refer to the actual practice location; the patient locator uses a place-search interface.

## API

| Route | Access | Purpose |
| --- | --- | --- |
| `GET /api/health`, `GET /api/status` | Public | Readiness and application-mode discovery |
| `POST /api/register`, `POST /api/login` | Public, throttled | Account creation and sign-in |
| `GET /api/me` | Signed in | Current account role and email state |
| `POST /api/account/request-verification` | Signed in | Queue verification email |
| `POST /api/account/request-reset` | Public, throttled | Queue recovery email without account enumeration |
| `POST /api/account/verify`, `POST /api/account/reset` | Valid single-use token | Confirm verification or set a new password |
| `POST /api/account/delete` | Signed in, current password | Delete account and owned private/public records |
| `GET /api/experts`, `GET /api/experts/{id}` | Public | Approved profiles only |
| `GET/PUT /api/expert-profile`, `POST /api/expert-profile/submit` | Professional account | Private draft/application workflow |
| `/api/admin/experts` and review routes | Administrator | Versioned credential review |
| `GET /api/clinics` | Public | Area/name or nearby-location search |
| `POST /api/clinics` | Approved expert | Compatible clinic creation endpoint |
| `GET/POST /api/manage/clinics` | Approved expert/admin, verified email | List own/all records or create a listing |
| `PUT/DELETE /api/manage/clinics/{id}` | Owner/admin, verified email | Versioned update or archive |
| `GET /api/blogs`, `GET /api/events` | Public | Published articles and upcoming active events |
| `POST /api/blogs` | Approved expert | Publish an owned article |
| `GET/POST /api/manage/events` | Administrator, verified email | List/manage community events |
| `PUT/DELETE /api/manage/events/{id}` | Administrator, verified email | Versioned update or archive |
| `GET/POST /api/availability/{expertId}` | Public read / approved expert write | Thirty-minute slots |
| `GET/POST /api/appointments` | Signed in / verified patient for creation | Own appointments and booking |
| `POST /api/appointments/{id}/{action}` | Participant | Accept, decline, propose, cancel or join |
| `GET /api/rtc-config` | Signed in | Temporary relay credentials |
| `POST /api/sessions`, `/rtc/signal` | Room/participant authorization | Separate invitation or appointment calling |
| `GET/POST /api/reports`, `POST /api/reports/{id}` | Reporter/admin as appropriate | Private reporting and recorded moderation |

Management creates return an ID and revision. Updates and archive requests require that revision. Management lists return 50 records per page with `nextOffset`; pass `?offset=` to continue. DELETE on a clinic/event archives it rather than permanently deleting it. PUT with `archived:false` restores a valid record. Public responses omit ownership/account fields. Event requests use numeric UTC `startAt` seconds; public event responses retain ISO UTC `startsAt`.

## Production and privacy

Use standalone `compose.live.yaml` with a real domain, verified mail sender and TURN relay. It provides an authenticated MongoDB replica set, mounted secrets, an app-scoped database account, internal database networking and Caddy HTTPS/WebSocket proxying. Development Mailpit and published app/database ports are absent. See [backend rollout instructions](deploy/BACKEND-ROLLOUT.md) for setup, clinic imports, queue operations and backups. The older `compose.production.yaml` development overlay is deprecated; the application now refuses its unauthenticated database URI.

The development database remains a local baseline. The new production stack is an authenticated single-node replica set; host storage encryption, off-host backups, restore validation, retention and a privacy notice remain deployment responsibilities. Runtime refuses a standalone/non-writable database because booking and account workflows need transactions. No clinical-production certification, encryption-at-rest configuration, high availability or live public deployment is claimed.

Patient aliases and omitted emails provide pseudonymity, not guaranteed anonymity from voice or disclosed information. Configured TURN calls use relay-only transport; real cross-network relay operation requires operator testing. There is no recording feature, but a peer may record externally. General invitation rooms remain shareable bearer capabilities, separate from participant-bound appointments.

Sign-in tokens remain in page memory. Reflection text and location searches are not persisted to accounts or browser storage. Signaling and rate limits remain single-instance; scaling needs shared signaling and edge throttling. Calls require HTTPS outside localhost. Appointment requests remain reserved until accepted/declined/cancelled; reminders, payments, recurring scheduling, data export and automated clinical matching are outside this build.

## Validation

`npm test` runs syntax and twelve call lifecycle/configuration/reconnection tests. C++ core tests cover input validation, room isolation and booking boundaries. CI compiles the real backend, runs MongoDB replica-set suites for accounts, verification, booking races, room access and moderation, plus real local email delivery and clinic/event ownership/archive/revision tests. It also checks Compose configuration, rejects development mail in production, runs responsive browser tests and two-browser calls with emulated devices, and compiles Qt.

Integration tests require explicitly disposable Docker containers and create test-only accounts/listings. Never run them against production data. Local email tests use Mailpit's official HTTP API; no public endpoint returns private account links. Native backend build details and pinned dependencies are in `backend/CMakeLists.txt` and `Dockerfile`.

For a **layout preview only**, run `node tools/preview.cjs 8100`. It cannot authenticate users or search live records; use the Docker stack for those workflows.

## Backend expansion awaiting final testing

Appointment changes now queue separate participant emails and accepted-appointment reminders at 24 hours and one hour before the start. Durable leases, retries and expiry handling support delivery workers. Account preferences control appointment emails/reminders and named timezones. UTC timestamps remain authoritative; ICU handles named-zone conversion and rejects nonexistent or ambiguous local times without explicit disambiguation.

Verified administrators can preview OpenStreetMap clinic data and transactionally import reviewed directory batches with stable identifiers, source attribution, archive preservation and manual-edit protection. Patient searches stay within the app database. Source links appear on imported clinic cards.

These additions have not been built, tested or deployed yet, following the requested implementation-first order. Frontend preference and import-management controls are still a later task. The [backend rollout guide](deploy/BACKEND-ROLLOUT.md) documents APIs, scripts, production requirements and the final validation work. Previous passing CI runs apply to the earlier implementation.
