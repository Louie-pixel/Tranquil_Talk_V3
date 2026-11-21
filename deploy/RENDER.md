# Render demonstration deployment

This deploys the existing C++/Drogon backend and browser frontend together, using
the root Dockerfile. It does not run Compose, MongoDB or Caddy on Render. Render
terminates HTTPS and forwards HTTP/WebSocket requests to the container. The
backend already listens on `0.0.0.0` and reads Render's `PORT` variable.

The root `render.yaml` explicitly selects Free compute and disables automatic
deploys. Review the resource summary before creating the service. This blueprint
does not create paid resources, but external providers and usage overages have
their own terms. Never put credentials into YAML, GitHub, screenshots or chat.

## Free plan boundaries

- Free web services sleep after 15 minutes without inbound HTTP/WebSocket traffic.
  Waking takes about a minute. Reminder and email workers stop while the service
  sleeps; queued mail is durable in MongoDB, but time-sensitive reminders may be
  delayed or expire. Do not use artificial keep-alive traffic as a workaround.
- Local files disappear on restart, redeployment and sleep. Free web services
  cannot attach a persistent disk. MongoDB must be external.
- This is a demonstration deployment using test accounts and fictional data.
  Render explicitly advises against production applications on Free compute.
  Real consultations require live-provider validation and a dependable deployment.
- Render Free does not offer shell/SSH access. Plan administrator provisioning
  separately; public signup must never grant professional or administrator roles.
- This blueprint does not provision a TURN server. Render's HTTP web service is
  not a replacement for a TURN relay.

## 1. Prepare the external services

### MongoDB Atlas

1. Create an Atlas project and a Free (`M0`) replica-set cluster if available.
   Use an appropriate nearby region. Do not load sample data into this app DB.
2. Create a separate database user with `readWrite` only on `tranquil_talk`.
   This is not your Atlas account login. Use a strong generated password.
3. In Render, find the service's outbound IP ranges under its Connect information
   and add those ranges to Atlas Network Access. Add only your own IP temporarily
   if needed for setup. Avoid the unrestricted `0.0.0.0/0` rule.
4. Copy Atlas's Drivers connection string and URL-encode any password characters
   that require escaping. Keep TLS enabled and use the Atlas-provided URI options.
   A typical form is:

   `mongodb+srv://USER:ENCODED_PASSWORD@CLUSTER/tranquil_talk?retryWrites=true&w=majority&appName=TranquilTalk`

5. Store it only as Render's `MONGODB_URI` environment variable. The database
   manager requires a writable replica set and creates its own indexes. Validate
   transactions, booking races and reconnects against this actual cluster using
   disposable data before inviting testers. Local MongoDB CI success does not
   establish Atlas compatibility or performance.

### Email

Create a Resend account, verify a sending domain using the DNS records Resend
supplies, and create an API key. Store the key as `RESEND_API_KEY` and set
`MAIL_FROM` to an address on that verified domain, such as
`TranquilTalk <no-reply@tranquiltalk.website>` if that domain is yours. Resend uses
HTTPS, so Render Free's SMTP port restrictions do not block this implementation.
Check provider quotas and pricing. Do not substitute development Mailpit or
outbox mode in a public deployment.

### TURN

Use an external coturn relay or a provider supporting coturn-compatible
time-limited HMAC-SHA1 credentials. Set `TURN_URL` to the actual provider URL and
`TURN_SECRET` to that relay's existing shared authentication secret (at least
32 characters). Generating an unrelated secret does not configure the relay.
Providers that only supply static username/password credentials are not drop-in
compatible with the current endpoint. See `deploy/turnserver.conf.example` for
the self-hosted configuration and the backend rollout guide.

Production startup intentionally rejects missing authenticated MongoDB, verified
email configuration, HTTPS origin or TURN settings. Do not bypass these checks
by changing `APP_ENV` or entering fake credentials.

## 2. Create the Render service

1. Sign in at https://dashboard.render.com using GitHub. Authorize access to
   `Louie-pixel/Tranquil_Talk_V3` only, if possible.
2. After the Render preparation PR is merged, choose **New > Blueprint**, select
   the repository and its `master` branch, and use `render.yaml`.
3. Confirm there is one web service with **Free** compute. Supply the prompted
   values from the external-service setup. Render generates `JWT_SECRET`; keep
   it stable across deploys. Do not expose it to the browser.
4. Set `APP_BASE_URL` to the service's actual HTTPS public origin, without a
   trailing slash. For the first deploy you may use its assigned `.onrender.com`
   hostname; if not known during creation, update it when Render shows the URL
   and redeploy. Never leave a guessed hostname when testing account links.
5. Review and create the blueprint. If the initial deploy fails because external
   settings are unfinished, complete them, then manually deploy again. Do not
   weaken production startup checks to make the health check pass.

For manual creation instead, choose **New > Web Service**, select the repository
and `master`, choose **Docker**, leave Root Directory empty, set Dockerfile Path
to `./Dockerfile`, choose Free, and copy all environment settings from
`render.yaml`. Generate `JWT_SECRET` privately with at least 32 random characters.
Use `/api/health` as the health check. Leave the Docker command unchanged.

The Docker build compiles dependencies and runs C++ core tests; it may take time.
Inspect Build Logs, then Runtime Logs. `/api/health` must return HTTP 200 and
`ready: true`. That confirms a database ping, not email, TURN or every workflow.

## 3. Connect the registered domain

1. First verify the service works at its `.onrender.com` URL.
2. In Render's service **Settings > Custom Domains**, add the exact registered
   hostname (for example, `tranquiltalk.website`).
3. If Namecheap BasicDNS is authoritative, open **Domain List > Manage > Advanced
   DNS** and copy the exact DNS record types, hosts and targets Render provides.
   If another DNS provider is authoritative, make the changes there instead.
   Remove conflicting parking/redirect records only; retain mail verification,
   SPF, DKIM and other unrelated records. Do not invent a server IP.
4. Verify the domain in Render and wait for its managed HTTPS certificate.
5. Set `APP_BASE_URL` to `https://YOUR_REGISTERED_DOMAIN` (no trailing slash) and
   redeploy before requesting new verification/recovery links. Add `www` only
   if you configure it explicitly as a separate custom domain/redirect.

## 4. Validate and provision the operator

Use disposable accounts to test signup, real verification email, recovery,
booking, acceptance/rescheduling, cancellation, participant-only room entry and
calls across two different networks, including TURN relay use. Check persistence
after redeploy and the effect of sleep on reminders. Test the custom domain on
a phone, including microphone/camera permissions and clinic geolocation.

To provision the first administrator, use the existing
`TranquilBackend --grant-admin existing-account-email` command from a trusted
machine/container with the same database and production environment settings.
The account must already exist. See the backend rollout guide. Render Free has
no shell, so this step cannot be done in its web console. Never expose a public
bootstrap endpoint or use a database role edit as a replacement for professional
credential review. Import real clinic data and approve professionals only after
the operator account is established.

No live Render, Atlas, Resend, TURN, DNS or TLS validation is implied by adding
this blueprint. Keep local backups of disposable setup notes without credentials.

## References

- https://render.com/docs/free
- https://render.com/docs/docker
- https://render.com/docs/blueprint-spec
- https://render.com/docs/outbound-ip-addresses
- https://render.com/docs/custom-domains
- https://www.mongodb.com/docs/atlas/tutorial/deploy-free-tier-cluster/
- https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/
