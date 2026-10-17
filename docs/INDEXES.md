# MongoDB indexes

Every index below exists because a concrete query or constraint needs it. `test/indexes.e2e-spec.ts`
compares this table with the indexes the app really creates: adding an index to a schema without a
row here (or leaving a row for a removed one) fails CI.

How they get created: Mongoose builds the schema indexes at startup and `IndexesReadyService` waits
for them before the app serves traffic (a `unique` constraint isn't enforced until its index exists).
On an existing database that is a no-op per index. Mongoose never **drops** indexes: after removing
one from a schema, run `npm run db:indexes` (dry run) and `npm run db:indexes -- --apply`.

Conventions:
- `_id` (UUID string) is always indexed and isn't listed.
- No index on `deletedAt` alone and no single-field `userId`: `deletedAt` is `null` on almost every
  document (useless selectivity), and every user-owned collection has a compound index that starts
  with `userId`, which also serves plain `{ userId }` queries.
- `*_serverUpdatedAt_1` come from `syncTrackingPlugin`: `GET /sync/pull?since=` reads
  `{ owner, serverUpdatedAt > since }` per collection.

## Auth

| Collection | Index | Why |
|---|---|---|
| `users` | `email_1` | **Unique.** Login/registration lookup by email; prevents duplicate accounts. |
| `users` | `role_1` | Admin user list filtered by role (`GET /admin/users?role=`). |
| `refresh_tokens` | `expiresAt_1` | **TTL** (`expireAfterSeconds: 0`): MongoDB deletes expired refresh tokens; no cleanup job. |
| `refresh_tokens` | `familyId_1` | Reuse detection revokes the whole session family (`updateMany({ familyId })`). |
| `refresh_tokens` | `userId_1_revokedAt_1` | Logout-all / password change: revoke a user's live tokens (`{ userId, revokedAt: null }`). |
| `action_tokens` | `expiresAt_1` | **TTL**: expired verification / reset tokens disappear on their own. |
| `action_tokens` | `userId_1_purpose_1` | Issuing a new token invalidates the previous one of the same purpose. |

## Plans

| Collection | Index | Why |
|---|---|---|
| `plans` | `code_1` | **Unique** stable plan code (`free`, `premium`); seeding and admin edits key on it. |
| `plans` | `isDefault_1` | Resolving the default plan for users without an active subscription (every entitlement check that falls back). |

## Exercise catalog

| Collection | Index | Why |
|---|---|---|
| `exercises` | `slug_1` | **Unique, partial** (only docs with a string slug = globals). Seeds and program templates reference exercises by slug; custom exercises have `slug: null`. |
| `exercises` | `exercise_name_text` | Text index on `name.es` + `name.en` (`default_language: none`) for `GET /exercises?q=` — case/diacritic-insensitive whole words. |
| `exercises` | `isGlobal_1_deletedAt_1_primaryMuscle_1` | Catalog listing / tier list: live globals, usually filtered by muscle. |
| `exercises` | `ownerId_1_serverUpdatedAt_1` | Sync pull of custom exercises; its `ownerId` prefix also serves "my custom exercises" and the `customExercises` plan-limit counter. |
| `exercises` | `tags_1` | Multikey. `?tag=` filter and removing a deleted tag from every exercise (`updateMany({ tags })`). |
| `exercise_tags` | `slug_1` | **Unique** tag slug, kept after soft delete so it can't be reused. |
| `user_exercise_prefs` | `userId_1_exerciseId_1` | **Unique**: one favorite/personal-tier row per user and exercise (upsert key). |
| `user_exercise_prefs` | `userId_1_isFavorite_1` | `GET /exercises?favorites=true`. |
| `user_exercise_prefs` | `userId_1_serverUpdatedAt_1` | Sync pull. |

## Routines & programs

| Collection | Index | Why |
|---|---|---|
| `routines` | `userId_1_deletedAt_1_archivedAt_1` | Routine list (live, archived or not) and the `routines` plan-limit counter (live, not archived). |
| `routines` | `userId_1_updatedAt_1` | Routine list sorted by last edit. |
| `routines` | `userId_1_serverUpdatedAt_1` | Sync pull. |
| `programs` | `userId_1_deletedAt_1_status_1` | Program list by status, `GET /programs/active/today`, and the `activePrograms` plan-limit counter. |
| `programs` | `userId_1_weeks.days.routineId_1` | `ROUTINE_IN_USE`: is a routine referenced by one of the user's programs before deleting it. |
| `programs` | `userId_1_serverUpdatedAt_1` | Sync pull. |
| `program_templates` | `slug_1` | **Unique** template slug (seed upsert key, reserved after soft delete). |

## Workouts, records, measurements

| Collection | Index | Why |
|---|---|---|
| `workouts` | `userId_1_startedAt_-1` | SPEC. Workout history paginated by date; every stats pipeline `$match`es `{ userId, startedAt range }`. |
| `workouts` | `userId_1_exercises.exerciseId_1_startedAt_-1` | SPEC. Per-exercise history, last performance, PR recalculation and the progression engine (multikey on embedded exercises, newest first). |
| `workouts` | `userId_1_updatedAt_1` | SPEC-mandated (`workouts(userId, updatedAt)`). Not used by queries today — sync pulls by `serverUpdatedAt`; candidate for removal if the SPEC allows. |
| `workouts` | `userId_1_serverUpdatedAt_1` | Sync pull. |
| `personal_records` | `userId_1_exerciseId_1` | SPEC. **Unique**: one precalculated PR document per user and exercise (rebuilt on `workout.*` events). |
| `body_metrics` | `userId_1_measuredAt_-1` | Measurement list (newest first), latest weight for the nutrition calculator, time series. |
| `body_metrics` | `userId_1_serverUpdatedAt_1` | Sync pull. |
| `progress_photos` | `userId_1_view_1_takenAt_-1` | Photo list by view and the before/after comparator (first/last photo of a view in a range). |

## Nutrition (small admin catalogs)

| Collection | Index | Why |
|---|---|---|
| `foods` | `slug_1` | **Unique** slug; meal suggestions reference foods by it. |
| `foods` | `category_1` | `?category=` filter. |
| `foods` | `tags_1` | Multikey. `?tag=` filter (`$all`). |
| `meal_suggestions` | `slug_1` | **Unique** slug (seed upsert key). |
| `meal_suggestions` | `goal_1_mealType_1_sortOrder_1` | List by goal and meal type in admin-defined order. |
| `meal_suggestions` | `items.foodSlug_1` | Multikey. `FOOD_IN_USE` check before deleting a food. |
| `nutrition_guidelines` | `slug_1` | **Unique** slug (seed upsert key). |
| `nutrition_guidelines` | `goals_1` | Multikey. `?goal=` filter. |

## Removed on 2026-10-16 (production hardening)

Redundant with a compound prefix or with no selectivity; each costs a write per insert/update.
Drop them from existing databases with `npm run db:indexes -- --apply`.

- `deletedAt_1` on every collection (almost always `null`).
- `userId_1` on every user-owned collection (prefix of a compound in each).
- `exercises.isGlobal_1`, `exercises.primaryMuscle_1` (covered by `isGlobal_1_deletedAt_1_primaryMuscle_1`), `exercises.ownerId_1` (covered by `ownerId_1_serverUpdatedAt_1`).
- `programs.status_1` (covered by `userId_1_deletedAt_1_status_1`; never queried without `userId`).
