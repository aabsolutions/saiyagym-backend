# Deployment — Render + MongoDB Atlas

Production runs as one Render **web service** (Node, free plan) built from `render.yaml`, talking
to a MongoDB **Atlas** cluster. GitHub Actions gates every deploy: lint, unit + e2e tests and build
must pass on `main` before Render is told to deploy.

```
GitHub PR ──► Actions: lint · unit · e2e · build · openapi drift
merge to main ──► same checks ──► POST Render deploy hook ──► npm ci + build ──► node dist/main
                                                                   │
                                     health check /api/v1/health ◄─┘ (pings Atlas; must pass to go live)
```

## 1. MongoDB Atlas (production)

1. Create a **separate project/cluster** for production (M0 free is fine to start). Never share it
   with development: seed scripts and tests must not be able to reach it by accident.
2. Pick the region next to Render's (`render.yaml` uses `virginia` → AWS `us-east-1`). Every query
   crosses that link; a cross-continent hop adds ~100 ms per query.
3. **Database Access**: a user with `readWrite` on the `saiyagym` database only — not `atlasAdmin`.
   Long random password (URL-encode `@ : / ? #` in the URI).
4. **Network Access**: Render's free plan has no dedicated IP. Use the outbound IP ranges Render
   shows for the service (Dashboard → service → *Connect* → *Outbound*) if your plan lists them;
   otherwise `0.0.0.0/0` is the only option — then the strong password and least-privilege user
   above are what protect the database.
5. URI → `MONGODB_URI`:
   `mongodb+srv://<user>:<password>@<cluster>.xxxxx.mongodb.net/saiyagym?retryWrites=true&w=majority`

Indexes are created by the app at startup (see [INDEXES.md](INDEXES.md)); nothing to do by hand.

## 2. Render

1. Render Dashboard → **New → Blueprint** → select this repository. Render reads `render.yaml`.
2. Fill in every variable marked `sync: false` (table below). `JWT_ACCESS_SECRET` is generated.
3. Service → **Settings → Deploy Hook** → copy the URL.
4. GitHub repo → **Settings → Secrets and variables → Actions** → secret `RENDER_DEPLOY_HOOK_URL`.
   Optionally add protection rules to the `production` environment (the deploy job uses it).
5. `autoDeploy: false` is deliberate: Render deploys only when CI calls the hook, i.e. after the
   checks pass. (Render's native alternative is *Auto-Deploy → After CI checks pass*.)

Build: `npm ci --include=dev && npm run build && npm prune --omit=dev` — `NODE_ENV=production` is
present at build time too, so dev dependencies (Nest CLI, TypeScript) must be requested explicitly.
Start: `node dist/main` (no CLI/compiler in the boot path). Node version: `.nvmrc` (24.x).

### Environment variables

Validated at boot by `src/config/env.schema.ts`: a missing or malformed variable stops the app with
the full list of problems (visible in the deploy log), instead of failing later at runtime.

| Variable | Production value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Disables Swagger UI by default; `info` log level; console mail driver won't print email bodies. |
| `PORT` | *(set by Render)* | The app listens on it. |
| `TRUST_PROXY` | `1` | Render's proxy is in front. Without it every request appears to come from the proxy IP and the per-IP rate limits throttle **all users together**. |
| `MONGODB_URI` | Atlas production URI | See §1. |
| `JWT_ACCESS_SECRET` | generated (≥ 32 chars) | The only JWT secret: refresh tokens are opaque random values stored as SHA-256, not JWTs. Rotating it invalidates every access token at once; clients transparently refresh (≤ 15 min tokens), nobody is logged out. |
| `JWT_ACCESS_TTL_SECONDS` / `REFRESH_TOKEN_TTL_DAYS` | defaults `900` / `30` | |
| `CORS_ORIGINS` | `https://<github-user>.github.io` | The web client's **origin**: scheme + host, no path (`/<repo>`) and no trailing slash — browsers send the origin without them and the match is exact. Comma-separate several (e.g. a custom domain). Empty = every cross-origin browser call is blocked. The mobile app isn't affected by CORS. |
| `APP_WEB_URL` | `https://<github-user>.github.io/<web-repo>` | Base for the links in verification / reset emails; the `/<repo>` path is kept. |
| `MAIL_DRIVER` | `smtp` | With `console` in production nothing is sent and only a masked notice is logged (bodies hold single-use tokens). |
| `MAIL_FROM` | `SaiyaGym <no-reply@your-domain>` | Must be a sender your SMTP provider has verified. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | from the provider | Any transactional provider with SMTP (Brevo, Mailgun, Resend, SES…). `SMTP_SECURE` defaults to `true` only for port 465 (587/2525 use STARTTLS). **Render's free plan may block outbound SMTP on 25/465/587** — check Render's current docs; if blocked, use the provider's port **2525** or a paid instance. |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Cloudinary dashboard → API Keys | All three or none (without them media endpoints answer `503 MEDIA_NOT_CONFIGURED`). The secret never leaves the API: clients get signed upload params. |
| `CLOUDINARY_FOLDER` | `gymapp` | Assets go under `gymapp/production/…`, so dev uploads never mix in. Set the max upload size in a Cloudinary upload preset / account settings (`MEDIA_MAX_IMAGE_BYTES` is only advisory). |
| `LOG_LEVEL` | `info` | `debug` temporarily to investigate; `warn` to reduce volume. |
| `SWAGGER_ENABLED` | unset (`false`) | The contract is `openapi.json` in the repo; no need to expose `/api/docs` publicly. |
| `THROTTLE_TTL_MS` / `THROTTLE_LIMIT` | defaults `60000` / `100` | Global per-IP limit; auth routes have stricter fixed limits. In-memory: fine for one instance, needs a shared store (Redis) if you scale out. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | **not on Render** | Only read by `npm run seed`, run from your machine (§4). |

## 3. Cold starts (Render free plan)

**What happens**: a free web service **spins down after 15 minutes without inbound traffic**. The
next request wakes it: Render starts the container (typically **30–60 s**, Render quotes "up to a
minute"), then `node dist/main` boots. The first request waits for all of it; later requests are
normal. In-memory state (rate-limit counters) resets on each spin-down — harmless.

**What the app does to keep its part short** (measured: Nest bootstrap ≈ 0.4 s, index creation
included):
- Runs the compiled `dist/main` — no `nest start`, no TypeScript compilation at boot.
- Nothing slow is awaited before listening:
  - the argon2 dummy hash (login timing protection — seconds on 0.1 CPU) is computed in the
    background;
  - the one-off `serverUpdatedAt` backfill — an unindexed scan of every synced collection — is no
    longer run at boot (`npm run db:backfill-sync` if ever needed);
  - index creation is a no-op round-trip per index on an existing database;
  - default-plan check: two tiny queries.
- `serverSelectionTimeoutMS: 10 000`: an unreachable/misconfigured Atlas fails the boot in 10 s
  (visible in the deploy log and the health check) instead of hanging for 30 s.
- Swagger UI is off in production; its document is built lazily anyway.

**What clients should do**:
- Treat the first call after a while as slow: timeouts ≥ 60 s on it, a "waking up the server…"
  state in the UI, and retry idempotent requests on timeout.
- Fire `GET /api/v1/health` when the app opens, so the service is warm by the time the user logs in.
- The mobile app is offline-first: logging a workout never waits for the server; sync catches up.

**If cold starts become a problem**:

| Option | Tradeoff |
|---|---|
| Keep it as is | Free; first request after 15 idle minutes takes up to ~1 min. |
| External pinger (cron-job.org, UptimeRobot) on `/api/v1/health` every 10–14 min | Free and simple, but keeps the instance up ~730 h/month, using almost all of the workspace's 750 free instance-hours (a second free service would then sleep for the rest of the month). Check Render's current free-tier terms before relying on it. |
| Paid instance (Starter) | Never sleeps, more CPU (faster argon2 and JSON), outbound SMTP open. The real fix once there are users. |

## 4. First deploy checklist

1. Atlas production cluster + user + network access (§1).
2. Render Blueprint with all variables (§2) → first deploy goes live when `/api/v1/health` is `200`.
3. Seed reference data **from your machine** against the production database (the free plan has no
   Render shell). Runtime variables override `.env`, so point only the URI at production:
   ```bash
   export MONGODB_URI='mongodb+srv://…/saiyagym…'   # production — double-check!
   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='…' npm run seed   # plans + admin user
   npm run seed:exercises    # catalog (141 exercises, tags)
   npm run seed:templates    # program templates (needs exercises)
   npm run seed:nutrition    # foods, meal suggestions, guidelines
   unset MONGODB_URI
   ```
   All seeds are idempotent and insert-only by default (admin edits are never overwritten).
   Your IP must be allowed in Atlas Network Access.
4. Smoke test:
   ```bash
   curl -i https://<service>.onrender.com/api/v1/health      # 200 + X-Request-Id header
   curl -s https://<service>.onrender.com/api/v1/plans        # Free / Premium
   ```
5. Web client: build with the API base URL `https://<service>.onrender.com/api/v1`. Mobile: same.

## 5. Logs

Structured JSON on stdout (pino), one object per line, readable in Render's *Logs* tab and by any
log drain:

```json
{"level":"info","time":"2026-10-16T10:00:00.000Z","service":"saiyagym-api","env":"production","userId":"…","req":{"id":"…","method":"POST","url":"/api/v1/workouts"},"res":{"statusCode":201},"responseTime":42,"msg":"request completed"}
```

- One line per request: method, path (**no query string**), status, duration, `userId` when
  authenticated. 4xx → `warn`, 5xx → `error` (with the error). `/api/v1/health` isn't logged.
- `req.id` reuses Render's request id (`rndr-id` / `X-Request-Id`) when well-formed, else a UUID; it's
  returned as the `X-Request-Id` response header. Application logs written while handling a request
  carry the same `reqId` — search by it to follow one request.
- **Never logged**: headers (`Authorization`, cookies), request/response bodies, query strings,
  passwords, tokens, emails. pino `redact` paths cover structured fields; free text from errors
  (e.g. Mongo's `E11000 … { email: "…" }`) is scrubbed (`src/common/utils/log-redaction.util.ts`):
  emails become `a***@domain`, token-like strings `[REDACTED]`.
- Level: `LOG_LEVEL` (`info` in production). Development pretty-prints; tests are silent.

## 6. CI/CD (`.github/workflows/ci.yml`)

| Trigger | Jobs |
|---|---|
| Pull request to `main` | `check`: `npm ci` → lint → unit tests → e2e tests (in-memory MongoDB, binary cached) → build → `openapi.json` must match `npm run openapi` |
| Push/merge to `main` | `check`, then `deploy`: POST to `RENDER_DEPLOY_HOOK_URL` (environment `production`, one deploy at a time) |

Recommended branch protection on `main`: require the `Lint, test, build` check and a PR.

## 7. Operations

- **Index changes**: the app creates new indexes at boot; dropping removed ones is manual —
  `npm run db:indexes` (dry run) then `npm run db:indexes -- --apply` with `MONGODB_URI` pointing at
  the target database.
- **Rollback**: Render Dashboard → *Events* → redeploy a previous successful deploy.
- **Secrets rotation**: change the variable in Render → it redeploys. `JWT_ACCESS_SECRET` rotation is
  transparent for clients (see table).
