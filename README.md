# Tranquil Talk
**Speak freely, Heal quietly.**

A mental wellbeing platform for finding nearby clinics, private audio/video conversations, expert articles, reflection and community events.

## What is implemented
- Responsive HTML/CSS/JavaScript browser application served by the existing C++17/Drogon backend.
- MongoDB-backed registration and bcrypt password verification; normalized emails, a unique email index, bounded input, process-local authentication throttling, one-hour JWTs, and a required environment signing secret.
- Clinic search with GeoJSON longitude/latitude order, coordinate/radius validation, a startup 2dsphere index, and a 100-result limit. Only verified experts can add clinic records.
- Private two-person WebRTC rooms. Authenticated users create 30-minute invitation capabilities; invitees do not need to disclose an account identity to their peer. Signaling requires a valid room ticket, strips unrelated fields, prevents cross-room relay and duplicate membership, caps rooms at two participants, and cleans up disconnected/expired sockets.
- User-selected audio-only or video mode; media access begins only on Enter conversation. Mute, camera toggle and hangup work on actual tracks. Early ICE is queued until remote SDP is installed.
- MongoDB articles published only by verified expert accounts. Public article and upcoming-event lists return only public fields. No fabricated clinics, professionals, articles or events are seeded.
- A reflection space held only in the open page: no server submission, browser storage or autosave.
- Optional Qt 6.4+ desktop shell uses the same web application, explicit permission prompts and configurable server URL. Obsolete duplicate views, fake device flags, absolute WSL paths and generated build products have been removed.

The repository previously used C++/Drogon and Qt, despite the original project description mentioning Node/Express. This update retains the working architecture rather than silently replacing its backend. Node is used only for tests.

## Run with Docker Compose
Install Docker with Compose. From this repository:

1. Copy `.env.example` to `.env`.
2. Generate a key using `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"` and put it in `JWT_SECRET` in `.env`.
3. Run `docker compose up --build`.
4. Open http://localhost:8080.

The first build compiles pinned Drogon, MongoDB C/C++ driver, jwt-cpp and bcrypt dependencies. MongoDB is on the internal Compose network; only the application port is published, bound to localhost. Records persist in the `tranquil-data` volume. This is a local development configuration. Environment files are not committed.

The server refuses to start without a JWT secret of at least 32 characters, reachable MongoDB or required indexes. If an existing database contains duplicate email values, reconcile those records before starting. Existing mixed-case email records must be normalized before relying on case-insensitive sign-in. Previously issued tokens are intentionally invalid under the new signing key/required expiry and audience.

## Native builds
Backend requires CMake 3.24+, a C/C++17 toolchain, OpenSSL, Drogon and MongoDB C++ driver 3.11-compatible packages. CMake fetches pinned jwt-cpp and bcrypt sources; outbound access is needed for first configuration.

```sh
cmake -S backend -B out
cmake --build out -j2
# Export JWT_SECRET first. Run from repository root so WEB_ROOT=web resolves.
./out/TranquilBackend
```

Configuration: `JWT_SECRET` (required), `MONGODB_URI`, `BIND_ADDRESS` (default 127.0.0.1), `PORT` (8080), `WEB_ROOT` (web), `UPLOAD_PATH` (/tmp/tranquil-talk-uploads). The binary does not automatically load `.env`; Compose does. Backend Docker build is the reference Linux build.

For the optional desktop shell, install Qt 6.4+ Core/Gui/Quick/Qml/WebEngineQuick and the Qt Quick Controls runtime:

```sh
cmake -S frontend -B out-desktop
cmake --build out-desktop -j2
./out-desktop/TranquilFrontend
```

Set `TRANQUIL_BASE_URL` to use another server; it defaults to http://localhost:8080. No machine-specific paths or forced media emulation are used. The upstream Main.qml and RegistrationView.qml entry points are retained as wrappers around the shared application; registration opens the same validated web flow.

## Accounts and content operations
Public signup accepts `patient` or `expert`. Expert requests are stored as `expert_pending`, with no elevated publishing or clinic permissions. There is no public role-promotion API.

Professional profiles now have an administrator review workflow. Experts sign in, open **My profile**, save their public information and private registration details, then submit for review. Only the exact approved revision appears in the public directory. Editing a published profile hides it until the new version is approved.

Administrators use **Verification** to approve, request changes, suspend or reopen an application. Approval requires confirmation that the applicant was matched to an official professional register, the HTTPS registry reference actually checked, and a review note. This is a manual, recorded review, not automatic identity or licence verification. There are no uploads or automatic outbound requests to applicant-provided reference URLs. Registration numbers, submitted references, review notes and reviewer IDs never appear in public profile responses.

Role checks read the current database account and approved profile revision on authenticated requests. Existing tokens immediately lose expert write access after an edit, requested change or suspension. Legacy accounts marked expert without an approved profile must complete this workflow. JWT role claims are not the source of current privilege. Appointment scheduling and professional matching remain future work; a private call invitation does not establish a clinician relationship.

To add a clinic, a verified expert sends a bearer-authenticated `POST /api/clinics` with `{"name":"...","lat":-25.75,"lng":28.23}`. Confirm listing accuracy and services directly; a listing is not an endorsement.

Publish an article in the verified expert UI, or `POST /api/blogs` with `title`, `body` (50–20000 UTF-8 bytes), and a public `author` name. Content renders as text, never injected HTML. A trusted operator can add real event records to MongoDB collection `events` using public `title`, `description`, `location`, and UTC ISO `startsAt` such as `2027-01-15T12:00:00Z`. Only future events appear. No public event write endpoint exists.

## Administrator setup
Create the intended operator account through normal signup first. A trusted operator with container/database access can then grant administrator access to that existing account:

```sh
docker compose exec app /app/TranquilBackend --grant-admin operator@example.com
```

No public signup field or HTTP endpoint grants administrator privileges. The command updates an existing account only and does not create credentials. Grant access only to an account whose ownership you have confirmed. The operator can sign in to access **Verification**. A reviewer cannot approve their own profile. Administrator access can be revoked by a trusted database operator by restoring the account's appropriate non-admin role; current-request database checks enforce the change.

The first administrator is not created automatically. Review decisions and audit history are written atomically into the profile document, with a compare-and-set revision check. Stale decisions return 409; suspended profiles cannot be edited or resubmitted until an administrator reopens them. Approval's account-role update is ordered before the atomic profile decision, and privileges additionally require the exact approved profile revision, so a failed or racing decision does not expose an unapproved profile.

## Profile links and navigation
- Directory: `/#experts`
- Public profile: `/#expert/ACCOUNT_OBJECT_ID` (available only while approved)
- Professional workspace: `/#professional`
- Administrator workspace: `/#verification` (administrator access required)

Public profiles provide a copyable link, reviewed registration date, qualifications, languages, consultation methods and optional practice website. They do not display account emails or private credential evidence. Public lists are paginated in batches of 20, with keyword, specialty, exact-language and consultation-method filters. User search strings are escaped before regex matching.

The interface uses a restrained modern visual system without emojis. This project preference is also recorded in `AGENTS.md` for future builds.

## API
| Endpoint | Access | Purpose |
| --- | --- | --- |
| POST /api/register | Public, throttled | Create patient or pending-expert account |
| POST /api/login | Public, throttled | Obtain one-hour API bearer token |
| GET /api/me | Signed in | Read current account role |
| GET /api/experts | Public | Approved directory, q/specialty/language/method/offset filters |
| GET /api/experts/{id} | Public | Current approved profile only |
| GET /api/expert-profile | Professional account | Own private profile and feedback |
| PUT /api/expert-profile | Professional account | Save own draft with expected revision |
| POST /api/expert-profile/submit | Professional account | Submit complete draft/changes with expected revision |
| GET /api/admin/experts | Administrator | Review queue by status/offset |
| GET /api/admin/experts/{id} | Administrator | Current private application and audit history |
| POST /api/admin/experts/{id}/review | Administrator | Versioned approve/request_changes/suspend decision |
| GET /api/clinics?lat=...&lng=...&radius=... | Public | Search 1–100000 metres, up to 100 results |
| POST /api/clinics | Verified expert | Add a clinic |
| POST /api/sessions | Signed in, throttled | Create a private 30-minute invitation |
| GET /api/blogs | Public | Up to 50 latest articles |
| POST /api/blogs | Verified expert, throttled | Publish an article |
| GET /api/events | Public | Up to 50 upcoming events |
| WS /rtc/signal | Room capability required | Two-person signaling |

WebSocket protocol: send `{"type":"join","ticket":"..."}` after opening. Server acknowledges `joined` with the peer count. The second participant creates the offer. Supported relay messages are `offer` with an `offer` SDP object, `answer` with an `answer` SDP object, `ice_candidate` with a `candidate` object, and `hangup`. Notifications include `peer_joined`, `peer_left` and `error`. Invitations travel in URL fragments and join messages, never query parameters.

## Privacy and production limitations
- Audio-only is pseudonymous to the other participant, not absolute anonymity. WebRTC peers can learn network information. STUN discovery contacts Google's STUN service. A configured TURN service and relay-only policy are still needed if hiding peer IPs is required; restrictive networks may not connect with STUN alone.
- There is no recording feature. This does not prevent a participant from recording using other software.
- JWTs contain an account ID and role, not the email; JWT payloads are signed, not encrypted. Browser API credentials remain in page memory and disappear on reload. Invitations are bearer capabilities: anyone possessing one can occupy a room slot until expiry.
- Calls and signaling rooms are process-local. Multi-instance routing, TURN provisioning, revocation, reconnection/resume and durable scheduled appointments remain future work.
- Set up HTTPS/WSS behind a trusted reverse proxy before remote use. HTTP media permissions work only on localhost. Do not expose the development MongoDB configuration publicly; configure database authentication, backups, retention and access controls for deployment.
- Rate limits are process-local and peer-IP-based. Add an edge rate limiter and correctly configured proxy IP handling before production; do not trust arbitrary forwarded headers.
- Account recovery, email verification, moderation/reporting, broader operational audit logging and deletion/export workflows are not implemented. Credential review has a private versioned decision history; it still requires a human reviewer to check authoritative records. This is not ready for clinical production use.
- The interface directs urgent situations to local emergency services without presenting unverified hotline numbers.

## Tests
`npm test` runs JavaScript syntax checks and ten WebRTC lifecycle tests, without downloads or npm dependencies.

```sh
g++ -std=c++17 -Wall -Wextra -Werror tests/core_test.cpp -o core_test
./core_test
```

The C++ tests cover malformed numbers, coordinate boundaries, normalized email/password validation, room isolation, two-person capacity, duplicate joins, disconnect cleanup, room resource limits and throttling.

`npm run test:integration` targets the real running backend at `http://localhost:8080` (override `TEST_BASE_URL`). It checks authentication, role escalation denial, JWT audience isolation, real MongoDB operations, static security headers, malformed coordinate responses and WebSocket authorization/membership/relay behavior. **Use a disposable test database:** it creates test accounts; it does not delete production data.

Drogon 1.9.10 accepts a WebSocket upgrade on the first request of a TCP connection. Browser WebSocket clients open a dedicated connection; the Node integration harness closes its REST sockets so Undici cannot reuse one for an upgrade.

GitHub Actions includes JavaScript/core tests, a Docker backend build with MongoDB integration tests, and a Qt desktop compile. Local JavaScript and standalone C++ tests were run during this update. GitHub Actions also runs four browser tests at desktop/mobile widths and a two-browser call against the real backend using emulated devices. These check media mode, mute/camera controls, and hangup cleanup without capturing real devices. Qt desktop compilation and responsive browser checks have passed in CI; consult the latest PR checks for the combined backend/integration result.

## Expert verification checks
`npm run test:experts` runs the real MongoDB profile lifecycle, privacy, access-control and review-revision tests. It requires `TEST_PROFILES_BASE_URL` and `TEST_ADMIN_CONTAINER` for an explicitly disposable running application container; without the operator fixture container it is skipped. The test grants an administrator role to a test account using the operator command, never a public bypass. Do not point it at production.

CI starts a separate application process for these fixtures so authentication throttling remains enabled and independent of the ordinary account/call tests. Tests cover draft saving, incomplete submission rejection, unknown-field rejection, private credential isolation, administrator-only review, registry attestation, stale reviews, approval, edits withdrawing visibility, immediate token permission changes, suspension, reopening and preserved audit history.

Playwright also exercises directory filters, desktop/mobile layout, shareable profile links, private application submission, sign-out cleanup and administrator approval. Professional names and credentials in tests are fixtures only; none are seeded into the production directory.
