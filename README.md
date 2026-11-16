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

Configuration: `JWT_SECRET` (required), `MONGODB_URI`, `BIND_ADDRESS` (default 127.0.0.1), `PORT` (8080), `WEB_ROOT` (web). The binary does not automatically load `.env`; Compose does. Backend Docker build is the reference Linux build.

For the optional desktop shell, install Qt 6.4+ Core/Gui/Quick/Qml/WebEngineQuick and the Qt Quick Controls runtime:

```sh
cmake -S frontend -B out-desktop
cmake --build out-desktop -j2
./out-desktop/TranquilFrontend
```

Set `TRANQUIL_BASE_URL` to use another server; it defaults to http://localhost:8080. No machine-specific paths or forced media emulation are used. The upstream Main.qml and RegistrationView.qml entry points are retained as wrappers around the shared application; registration opens the same validated web flow.

## Accounts and content operations
Public signup accepts `patient` or `expert`. Expert requests are stored as `expert_pending`, with no elevated publishing or clinic permissions. There is no public role-promotion API.

A trusted operator must verify credentials outside this application before changing a user's stored role to `expert`. The user must then sign in again. This version does not implement a credential verification service, administrator dashboard, appointment scheduling or professional matching. A private room is an invitation mechanism, not proof of a clinician relationship.

To add a clinic, a verified expert sends a bearer-authenticated `POST /api/clinics` with `{"name":"...","lat":-25.75,"lng":28.23}`. Confirm listing accuracy and services directly; a listing is not an endorsement.

Publish an article in the verified expert UI, or `POST /api/blogs` with `title`, `body` (50–20000 UTF-8 bytes), and a public `author` name. Content renders as text, never injected HTML. A trusted operator can add real event records to MongoDB collection `events` using public `title`, `description`, `location`, and UTC ISO `startsAt` such as `2027-01-15T12:00:00Z`. Only future events appear. No public event write endpoint exists.

## API
| Endpoint | Access | Purpose |
| --- | --- | --- |
| POST /api/register | Public, throttled | Create patient or pending-expert account |
| POST /api/login | Public, throttled | Obtain one-hour API bearer token |
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
- Account recovery, email verification, credential-review tooling, moderation/reporting, operational audit logging and deletion/export workflows are not implemented. This is not ready for clinical production use.
- The interface directs urgent situations to local emergency services without presenting unverified hotline numbers.

## Tests
`npm test` runs JavaScript syntax checks and ten WebRTC lifecycle tests, without downloads or npm dependencies.

```sh
g++ -std=c++17 -Wall -Wextra -Werror tests/core_test.cpp -o core_test
./core_test
```

The C++ tests cover malformed numbers, coordinate boundaries, normalized email/password validation, room isolation, two-person capacity, duplicate joins, disconnect cleanup, room resource limits and throttling.

`npm run test:integration` targets the real running backend at `http://localhost:8080` (override `TEST_BASE_URL`). It checks authentication, role escalation denial, JWT audience isolation, real MongoDB operations, static security headers, malformed coordinate responses and WebSocket authorization/membership/relay behavior. **Use a disposable test database:** it creates test accounts; it does not delete production data.

Drogon 1.9.10 accepts a WebSocket upgrade on the first request of a TCP connection. Browser WebSocket clients open a dedicated connection; the Node integration harness closes its REST sockets so Undici cannot reuse one for an upgrade.\n\nGitHub Actions includes JavaScript/core tests, a Docker backend build with MongoDB integration tests, and a Qt desktop compile. Local JavaScript and standalone C++ tests were run during this update. The Qt desktop build also passed on GitHub Actions. Full backend and browser checks run in CI; consult their results rather than assuming they ran locally.
