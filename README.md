# SaiyaGym API (gymapp-api)

REST API for GymApp — plan, log and analyze hypertrophy and powerlifting training, with Free and
Premium plans. NestJS 12 + MongoDB (Mongoose 9), deployed on Render with MongoDB Atlas.

| Doc | What's in it |
|---|---|
| [docs/SPEC.md](docs/SPEC.md) | Functional spec (Spanish), shared by the API, web and mobile projects |
| [docs/PROGRESS.md](docs/PROGRESS.md) | What's done, decisions and gotchas, per milestone |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Render + Atlas setup, environment variables, cold starts, logs, CI/CD |
| [docs/INDEXES.md](docs/INDEXES.md) | Every MongoDB index and why it exists (checked by a test) |
| [openapi.json](openapi.json) | The API contract the clients generate from (`npm run openapi`; CI fails if stale) |

## Architecture

```
            ┌──────────── Web (Angular, GitHub Pages): plan & analyze
 clients ───┤
            └──────────── Mobile (Flutter): live logging, offline-first ── /sync/push · /sync/pull
                                 │  HTTPS, JWT bearer
                                 ▼
 Render ── helmet · CORS · JSON 2 MB · pino-http (request log, X-Request-Id)
           ValidationPipe (whitelist, forbidNonWhitelisted)   → 400 VALIDATION_ERROR
           Guards: Throttler → JwtAuth (@Public opts out) → Roles → Entitlements (plan gating)
           Controller → Service → Mongoose model ─────────────► MongoDB Atlas
           AllExceptionsFilter → { statusCode, code, message, details? } (i18n by Accept-Language)
                                 │
                                 └─ Cloudinary (signed uploads; the API only signs and validates)
```

**The API is the single source of truth.** Every permission (ownership, roles, plan limits and
features) is decided here; clients only hide UI. Per-user isolation is verified by
`test/isolation.e2e-spec.ts`.

Key patterns:
- **Registries instead of imports** to avoid module cycles: `UsageCountersRegistry` (plan-limit
  counters, fails closed when a limit has no counter), `RoutineUsageRegistry` ("routine in use"),
  `SyncRegistry` (per-collection sync handlers; validation stays in the domain module).
- **Ports**: `WorkoutHistoryProvider` feeds the progression engine; `PaymentProvider` is reserved for
  Stripe / RevenueCat (plans are assigned by admins for now).
- **Domain events**: `workout.finished|updated|deleted` (REST and sync) → personal records are
  rebuilt; listeners are idempotent and results come back through `emitAsync`.
- **Pure cores, no I/O**: `ProgressionService`, `program-schedule.ts`, `personal-records.calc.ts`,
  `stats-window.ts`, `nutrition-calculator.ts` — unit-tested in isolation.
- **Two clocks for sync**: client `updatedAt` decides conflicts (last write wins); server
  `serverUpdatedAt` (`syncTrackingPlugin`) is the pull cursor.
- **Persistence**: UUID string `_id` (clients generate them offline), soft delete via `deletedAt`
  everywhere (deletions must reach other devices), embedded documents (routine slots, workout sets).
  Startup waits for all indexes (`IndexesReadyService`) so unique constraints hold from request one.

### Layout

```
src/
  main.ts · app.module.ts · app.setup.ts (HTTP setup shared with e2e) · openapi.ts
  config/       env schema (zod, validated at boot) · logger config (pino)
  common/       guards, filter, pipes, decorators, error codes, utils (local dates, CSV, log redaction…)
  database/     BaseSchema/UserOwnedSchema, sync plugin, IndexesReadyService, seeds + maintenance scripts
  i18n/<lang>/  errors.json, mail.json, common.json, nutrition.json (es default, en)
  modules/<domain>/  controller(s) · service(s) · dto/ · schemas/ · *.spec.ts
test/           e2e suites (one in-memory database per file) + utils
```

### Modules

| Module | Main routes | Notes |
|---|---|---|
| `auth` | `/auth/register · login · refresh · logout · logout-all · verify-email · password/*`, `/users/me/password`, `DELETE /users/me` | argon2id; access JWT 15 min + opaque refresh token with rotation and reuse detection; strict rate limits |
| `users` | `/users/me`, `/admin/users` | Profile + preferences; admin search, role change, manual plan assignment |
| `plans` · `entitlements` | `/plans`, `/admin/plans` | Admin-editable limits/features; `@RequireFeature()` / `@CheckLimit()` |
| `exercises` | `/exercises`, `/exercise-tags`, `/admin/exercises`, `/admin/exercise-tags` | Global + custom in one collection; per-goal tiers S/A/B/C, tier list, favorites/personal tier, text search |
| `media` | `/media/upload-signature` | Cloudinary signed uploads; URL validation |
| `routines` | `/routines` | Embedded slots + target sets, supersets, progression rules (Premium) |
| `programs` | `/programs`, `/programs/active/today`, `/program-templates`, `/admin/program-templates` | Weeks → days → routine, deloads, training maxes; copyable templates |
| `workouts` | `/workouts`, `/exercises/:id/last-performance`, `/exercises/:id/history` | Idempotent create on client id, server-computed volume |
| `sync` | `/sync/push`, `/sync/pull` | Offline-first protocol for the mobile app |
| `records` | `/records`, `/exercises/:id/records` | Precalculated PRs, returned as `newRecords` when saving workouts |
| `stats` | `/stats/*` | Aggregation pipelines; Free = last 90 days (server-side) |
| `body-metrics` · `progress-photos` | `/body-metrics`, `/progress-photos` | Measurements in kg/cm; private photos (Premium) |
| `export` | `/export` | JSON / CSV (Premium) |
| `nutrition` | `/nutrition/*`, `/admin/nutrition/*` | Foods, meal suggestions (full list Premium), guidelines, orientative calculator |
| `mail` · `health` | `/health` | SMTP / console mail; health check pings MongoDB |

## Local setup

Requirements: **Node ≥ 24.9** (`.nvmrc`; Nest 12 ships as ESM and Jest loads it via `require(esm)` +
`--experimental-vm-modules` — tests fail below 24.9) and a MongoDB.

```bash
npm install
cp .env.example .env          # then set MONGODB_URI and JWT_ACCESS_SECRET
npm run start:dev             # http://localhost:3000/api/v1 · Swagger UI: /api/docs
```

**MongoDB Atlas (recommended)** — a **dev-only** cluster or database (never production: seeds would
write to it), a user with `readWrite` on that database only, your IP in Network Access:
`MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.xxxxx.mongodb.net/saiyagym-dev?retryWrites=true&w=majority`
(URL-encode special characters in the password). Same engine as production, but ~50–150 ms per query.

**Docker (offline alternative)** — `docker compose up -d` (MongoDB 8.0) and
`MONGODB_URI=mongodb://saiyagym:saiyagym@localhost:27017/saiyagym?authSource=admin`.

Then load reference data (see [Seeds](#seeds)). Tests never touch Atlas or Docker.

## Scripts

| Script | What it does |
|---|---|
| `npm run start:dev` | Watch mode (pretty logs) |
| `npm run build` / `npm run start:prod` | Compile to `dist/` / run the compiled app |
| `npm run lint` / `lint:fix` | ESLint (type-checked) + Prettier |
| `npm test` | Unit tests (`src/**/*.spec.ts`). One file: `npm test -- path/to/file.spec.ts`; by name: `-t "name"` |
| `npm run test:e2e` | E2E tests (`test/*.e2e-spec.ts`) against an in-memory MongoDB — no Docker. First run downloads a MongoDB binary (~100 MB) |
| `npm run openapi` | Writes `openapi.json` (no DB or `.env` needed). Commit it: CI checks it's current |
| `npm run seed` · `seed:exercises` · `seed:templates` · `seed:nutrition` | Reference data, see below |
| `npm run db:indexes [-- --apply]` | Diff schema indexes vs. the database; `--apply` creates missing and **drops** extra ones |
| `npm run db:backfill-sync` | One-off: `serverUpdatedAt` for documents older than the sync plugin |

## Seeds

All idempotent, keyed by `slug` (or plan `code`), **insert-only by default**: existing documents —
including admin edits — are left alone, and soft-deleted ones are never resurrected (their slug stays
reserved). `-- --update` overwrites existing, non-deleted documents from the JSON.

| Order | Script | Data |
|---|---|---|
| 1 | `npm run seed` | Free/Premium plans (only into an empty `plans` collection; the app also does this at boot) + admin user from `ADMIN_EMAIL`/`ADMIN_PASSWORD` (an existing user is promoted, password untouched) |
| 2 | `npm run seed:exercises` | `src/database/seeds/exercises.seed.json`: 141 exercises (es/en, tiers, competition lifts and accessories) + 9 tags |
| 3 | `npm run seed:templates` | `program-templates.seed.json`: PPL, Upper/Lower, Full Body, 4-week strength block (references exercises by slug → after step 2) |
| 4 | `npm run seed:nutrition` | `nutrition.seed.json`: 81 foods (macros per 100 g), 30 meal suggestions, 10 guidelines |

Each seed file is validated by a unit test before it can be merged.

## Environment

Validated at boot with zod (`src/config/env.schema.ts`): the app refuses to start and lists every
invalid variable. Production values and the reasoning behind each: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#environment-variables).

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `development` \| `test` \| `production`. With `test`, `.env` is ignored |
| `PORT` | `3000` | |
| `MONGODB_URI` | — (required) | `mongodb://` or `mongodb+srv://` |
| `CORS_ORIGINS` | empty (blocked) | Comma-separated origins, e.g. `https://<user>.github.io` (no path) |
| `THROTTLE_TTL_MS` / `THROTTLE_LIMIT` | `60000` / `100` | Global per-IP rate limit (auth routes are stricter) |
| `TRUST_PROXY` | `0` | `1` on Render, or rate limits see one IP for everybody |
| `SWAGGER_ENABLED` | `true` except in production | |
| `LOG_LEVEL` | `info` prod · `debug` dev · `silent` test | pino level |
| `JWT_ACCESS_SECRET` | — (required, ≥ 32 chars) | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `JWT_ACCESS_TTL_SECONDS` / `REFRESH_TOKEN_TTL_DAYS` | `900` / `30` | |
| `EMAIL_VERIFICATION_TTL_HOURS` / `PASSWORD_RESET_TTL_MINUTES` | `24` / `60` | |
| `APP_WEB_URL` | `http://localhost:4200` | Base for email links; GitHub Pages' `/<repo>/` path is kept |
| `MAIL_DRIVER` / `MAIL_FROM` | `console` / `GymApp <no-reply@gymapp.local>` | `console` prints emails (dev only — in production it prints nothing sensitive) · `smtp` sends |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` | — / `587` / `true` if 465 / — / — | `SMTP_HOST` required when `MAIL_DRIVER=smtp` |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | — | All three or none; without them media endpoints return `503 MEDIA_NOT_CONFIGURED` |
| `CLOUDINARY_FOLDER` / `MEDIA_MAX_IMAGE_BYTES` | `gymapp` / `5242880` | Uploads under `<folder>/<NODE_ENV>/…`; the byte cap is advisory (enforce it in Cloudinary) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | — | Only read by `npm run seed` |

## Testing

- **Unit** (`npm test`): pure logic (progression, PRs, stats window, nutrition calculator, CSV,
  dates, seeds), services with real in-memory Mongo where persistence *is* the logic (token
  rotation), logger redaction.
- **E2E** (`npm run test:e2e`): the real `AppModule` over HTTP. Each file gets its own database.
  Notable suites: `isolation` (two users: every list must match an empty user's, every foreign id is
  404 on every verb, no foreign references or id takeover via REST or sync), `indexes` (the
  database's indexes equal [docs/INDEXES.md](docs/INDEXES.md)), `sync` (conflicts, late offline
  edits), `stats` (90-day Free window).
- Many-user files use `createTestUser()` (the real `/auth/register` limit is 5/hour).

## Deployment

Render web service from [`render.yaml`](render.yaml) (free plan, health check `/api/v1/health`),
MongoDB Atlas, GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)): lint, unit,
e2e and build on every PR and push; Render auto-deploys each `main` commit once those checks pass
(`autoDeployTrigger: checksPass`). The free
plan sleeps after 15 idle minutes — first request takes up to ~1 min. Everything (variables, Atlas
network access, SMTP on the free plan, cold-start mitigation, first-deploy seeding, logs):
**[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

## Domain reference

### Auth

- **Access token**: JWT HS256, 15 min, `{ sub, role, sid }`. `Authorization: Bearer …` on every route
  not marked `@Public()`.
- **Refresh token**: opaque `<id>.<secret>`, 30 days, stored as SHA-256. **Single use**:
  `POST /auth/refresh` returns a new pair; replaying a rotated token → `401 REFRESH_TOKEN_REUSED` and
  the session is revoked. Clients must serialize refreshes.
- Role changes and account deletion reach access tokens on the next refresh (≤ 15 min).
- Password change ends all *other* sessions; reset and account deletion end all of them.

### Exercise catalog

- One `exercises` collection: globals (admin, `slug`, tiers) + customs (user, `ownerId`). Users see
  globals + their own. User responses are localized (`Accept-Language`, fallback `es`); admin
  responses return the `{ es, en }` maps.
- `q`: text index (whole words, accent-insensitive), falling back to substring match.
- Tiers per goal (`hypertrophy`, `powerlifting`): `GET /exercises/tier-list?goal=&muscle=&source=global|personal`.
- Images: `POST /media/upload-signature` → direct upload to Cloudinary → `imageUrl` (only our cloud
  and folder accepted).

### Routines, programs & progression

- Routine slots: `exerciseId`, `groupId` (supersets, contiguous, ≥ 2), target sets (`type`,
  `repsMin–repsMax`, `weightKg` XOR `percent1RM`, `restSeconds`), optional progression rule (Premium).
- Program: weeks → days (`weekday` 1–7) → routine; deload weeks; training maxes;
  `draft → active → completed`. `GET /programs/active/today?date=YYYY-MM-DD` (client's local date)
  returns target weights and machine-readable `adjustments`.
- Free: 3 live routines (archived don't count), 1 active program.

### Workouts & offline sync

- Workouts embed exercises and sets; `volumeKg`, `workingSets`, `durationSeconds` computed
  server-side. `POST /workouts` is idempotent on the client `id`.
- `POST /sync/push` `{ changes: [{ collection, op: 'upsert'|'delete', doc: { id, updatedAt, … } }] }`
  for `workouts`, `routines`, `body_metrics`, `user_exercise_prefs` → per change `applied` /
  `ignored_older` / `error`. LWW on the client's `updatedAt` (> 5 min ahead → `CLOCK_SKEW`). Same
  validation, limits and Premium rules as REST; another user's id → `FORBIDDEN`.
- `GET /sync/pull?since=<serverTime>` → `{ serverTime, changes }`, deletions included, plus read-only
  `programs` and custom `exercises`. Stops 2 s before "now" to cover in-flight writes.

### Records, stats, measurements, photos, export

- PRs (max weight, best e1RM Epley 1–12 reps, most reps per weight, best session volume; warmups
  never count) rebuilt from scratch on every `workout.*` event.
- Stats via aggregation pipelines, bucketed in the user's `?tz=`; Free sees the last 90 days
  (`window.limitedByPlan`).
- Body metrics (kg/cm/%), private progress photos (signed URLs), JSON/CSV export (Premium).

### Nutrition (general guidance, not medical advice)

- Foods (macros per 100 g, closed tag list), meal suggestions by goal (`bulk|cut|maintenance`) and
  meal type with totals computed from current food data, short guidelines. Free sees sample
  suggestions (`limitedByPlan`, `lockedCount`) and all guidelines.
- `POST /nutrition/calculator`: Mifflin-St Jeor × activity factor + macros per goal, from the request
  or the profile and latest weight; stores nothing; always returns a translated `disclaimer`.

## Conventions

- **Errors**: `{ statusCode, code, message, details? }`. Clients branch on `code`
  (`src/common/constants/error-codes.ts`); `message` is translated. Throw
  `AppException(code, status, { args, details })`; every code needs `errors.<CODE>` in each language.
- **i18n**: `src/i18n/<lang>/*.json`, fallback `es`. A new language = a new folder.
- **Units & dates**: kg/cm only; UTC ISO 8601; program dates are local `YYYY-MM-DD` strings.
- **PATCH DTOs** built with `PartialType` pass `{ skipNullProperties: false }` (otherwise `null`
  reaches Mongoose → 500).
- **Logs**: never log headers, bodies, tokens or emails; free text from errors goes through
  `scrubText()`.
- **Indexes**: add a row to `docs/INDEXES.md` with every schema index (the `indexes` e2e test enforces it).
- Conventional commits.
