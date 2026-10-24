# Progress — gymapp-api

## 2026-10-24 — Instrucciones de ejecución

### Hecho
- **Seed**: pasos de ejecución es/en para los 141 ejercicios (`instructions`, un paso por línea, 4 por ejercicio, mismos pasos en ambos idiomas). `validateSeedFile` exige es+en si hay instrucciones.
- **Seeder**: además del upsert, completa `instructions` SOLO donde están vacías o no existen (`instructionsFilled` en el reporte), incluso sin `--update`: así llegan a una base ya sembrada sin pisar lo que escribió el admin.
- **`GET /exercises?withText=true`**: los ítems traen además `description` e `instructions` localizadas (`ExerciseListItemDto`). Lo usa el móvil para tener el detalle offline; el listado normal sigue liviano. `GET /exercises/:id` no cambia.
- `openapi.json` regenerado.

### Verificación
- `npm run lint` ✅ · unit 246/246 ✅ · e2e 265/265 ✅ (nuevos: el seed tiene pasos bilingües y en igual cantidad; el llenado respeta el texto del admin y una segunda corrida no cambia nada; `withText` sí/no).

### Decisiones y gotchas
- Tras desplegar: `npm run seed:exercises` (sin `--update`) contra producción para cargar las instrucciones (ver `docs/DEPLOYMENT.md`).
- Prettier conserva los objetos JSON expandidos si ya tienen saltos de línea: para no reformatear todo el seed, el JSON se escribe compacto y lo formatea Prettier.

## 2026-10-23 — Guías de ejecución de ejercicios (backend)

### Hecho
- `exercises.guides[]` (solo globales): `{ id, kind: image|animation, publicId, format, width, height, bytes, caption }`, máximo 6, el orden del array es el de visualización. Metadatos leídos de Cloudinary, nunca del cliente.
- Subida: propósito `exercise_guide` (solo admin, `image/upload`, carpeta `exercises/guides`, jpg/png/webp/gif, `c_limit,w_1080,h_1080`). `MediaService.verifyGuideAsset` consulta la Admin API (`pages > 1` = animación) y destruye + rechaza (`400 INVALID_GUIDE_ASSET {reason}`) si el formato o el tamaño (`MEDIA_MAX_GUIDE_BYTES`, 4 MiB) no cumplen; un `publicId` fuera de la carpeta se rechaza sin destruir.
- Admin: `PUT /admin/exercises/:id/guides` reemplaza la lista y devuelve el `AdminExerciseDto` (ahora con `guides[]` y `url`). Los archivos conservados mantienen id y metadatos; los quitados se destruyen DESPUÉS de escribir en la DB (best-effort, no si otro ejercicio —aunque esté borrado— los usa).
- Plan: `entitlements.guidesPerRoutine` (Free 5, Premium `null`). Fuera de `LIMIT_KEYS` a propósito (no crea nada → no hay contador de uso).
- Lectura con permisos (módulo `guides`): `GET /guides` → `{ guidesPerRoutine, items[{ exerciseId, guides[{ id, kind, url, width, height, caption }] }], lockedExerciseIds }`; `POST /guides/resolve { exerciseIds }` para entreno libre. Lógica pura en `guides/guide-access.ts`. El catálogo (`GET /exercises*`) solo expone `hasGuide`.
- `RoutinesService.exerciseOrders(userId)`: ids de ejercicios por rutina no borrada (archivadas incluidas), usa el índice `(userId, deletedAt, archivedAt)`.

### Verificación
- `npm run lint` ✅ · unit 245/245 ✅ · e2e 263/263 ✅ (nuevo `guides.e2e-spec.ts`; caso Free en `isolation`) · `npm run openapi` ✅ (regenerado).

### Decisiones y gotchas
- **Las URLs no viajan en el doc del ejercicio**: si estuvieran ahí, un Free las recibiría todas y el bloqueo quedaría solo en la UI.
- **Falla cerrado + backfill automático**: el schema pone `guidesPerRoutine` en 0 por defecto (planes viejos = sin guías). `PlansService.onApplicationBootstrap` completa la clave donde falta (`premium` → `null`, el resto → 5); es idempotente y nunca pisa una edición del admin. Es automático y no un script manual porque, si el admin editaba un plan antes de correr el script, ese 0 quedaba guardado.
- `PlanEntitlementsDto.guidesPerRoutine` es opcional en la entrada: la web actual no lo manda; en un update se conserva el valor guardado; en un create queda 0.
- La URL de la guía se arma a mano (`…/image/upload/q_auto/<publicId>.<format>`): el SDK agrega `v1` y un `?_a=` de analytics que cambia entre versiones, y el móvil cachea por URL.
- La regla Free es "blanda" por diseño: un usuario puede armar una rutina con cualquier ejercicio para ver su guía.
- Sin índices nuevos: `guides.0` usa el prefijo de `(isGlobal, deletedAt, primaryMuscle)`; `guides.publicId` (solo al borrar archivos, admin) recorre una colección curada de cientos de documentos.
- Desplegar el backend ANTES que la web y el móvil (todo lo nuevo es aditivo).

## 2026-10-22 — Sonidos de recordatorios + limpieza de assets (backend)

### Hecho
- Borrar o reemplazar el audio de un sonido (`DELETE`/`PATCH publicId` en `/admin/sounds`) destruye el asset anterior en Cloudinary DESPUÉS de escribir en la DB (best-effort: si falla solo se registra un warning con `scrubText`, la respuesta sigue siendo 2xx). No se destruye si el `publicId` no cambia ni si otra fila de `rest_sounds` (incluso borrada) lo referencia. Sin índice nuevo: la colección es curada por admin (decenas de filas).
- Nuevas preferencias `trainingReminderSoundId` y `weighInSoundId` en `PATCH /users/me`, idénticas a `restSoundId` (null = por defecto; 404 `SOUND_NOT_FOUND`; 403 `PLAN_FEATURE_REQUIRED`). `/users/me` devuelve el valor EFECTIVO (null si se borró el sonido, bajó el plan o es un usuario legacy sin el campo; sin backfill). Claves en `users/sound-preferences.ts` (`SOUND_PREFERENCE_KEYS`).

### Verificación
- `eslint` ✅ · unit `sounds` + `users` 30/30 ✅ · e2e `sounds` + `isolation` 103/103 ✅ (resto del e2e y `npm run openapi` los corre el orquestador).
- Desplegar el backend ANTES que la app móvil (campos nuevos nullable, retrocompatibles).

### Decisiones y gotchas
- El destroy va después de la DB (al revés que `progress-photos`): la DB es la verdad; un huérfano cuesta bytes, una fila apuntando a un asset destruido rompe clientes.

## 2026-10-22 — Sonidos de alarma de descanso (backend)

### Hecho
- Biblioteca administrada `rest_sounds` (`src/modules/sounds`): CRUD `/admin/sounds` (solo admin, borrado lógico, slug reservado → `SOUND_SLUG_TAKEN`) y `GET /sounds` (orden por `sortOrder`, nombre localizado, `locked` + URLs `null` para premium sin `premiumSounds`).
- Subida: firma `rest_sound` (solo admin, `video/upload`, carpeta `sounds`). La API verifica el asset con la Admin API de Cloudinary (carpeta, audio, `bytes <= MEDIA_MAX_SOUND_BYTES`, `duration < 30 s`); si no cumple lo destruye y responde `400 INVALID_SOUND_ASSET {reason}`. Un `publicId` fuera de la carpeta se rechaza SIN destruir (no se puede probar que lo subimos nosotros).
- URLs de entrega (`sound-urls.ts`): `wavUrl` (`af_22050`, iOS) y `mp3Url` (Android).
- Preferencia `preferences.restSoundId` en `PATCH /users/me` (`null` = sonido por defecto; 404 `SOUND_NOT_FOUND`; 403 `PLAN_FEATURE_REQUIRED` si es premium sin `premiumSounds`). `/users/me` devuelve el id EFECTIVO (null si el sonido se borró o el plan ya no lo permite; el valor guardado no cambia, así que al volver a Premium se recupera).
- `RestSoundRegistry` (UsersModule) evita el ciclo users↔sounds: `SoundsModule` registra el lookup; sin registrar → null (falla cerrado).
- Feature `premiumSounds` en planes (seed premium=true) + `npm run db:backfill-premium-sounds` (idempotente, solo donde falta la clave). Ver `docs/DEPLOYMENT.md`.
- `createWithFreeSlug` acepta el código de error del slug duplicado (nutrición sigue igual).

### Verificación
- Pendiente: no se ejecutaron lint, tests ni build en esta tanda. Tests escritos: `sound-urls`, `rest-sound.registry`, `users.service`, `media.service`, `default-plans` (unit); `sounds`, `isolation`, `backfill-premium-sounds` (e2e); `indexes` cubre las filas nuevas de `docs/INDEXES.md`.
- Pendiente: `npm run openapi` para regenerar `openapi.json` (CI falla por drift hasta entonces).

### Decisiones y gotchas
- El DTO usa `@IsOptional() @IsUUID('4')` para `restSoundId`: `IsOptional` deja pasar `null` (reset) sin `IsOptionalNonNull`.
- ~~Reemplazar el audio o borrar un sonido NO destruía el asset~~ → desde "Sonidos de recordatorios + limpieza de assets" se destruye (después de la DB, best-effort).
- `.env.example` no documenta `MEDIA_MAX_SOUND_BYTES` (regla de denegación): está en `docs/DEPLOYMENT.md`.

## 2026-10-18 — Cloudinary: carpeta en la Media Library

### Hecho
- Las imágenes quedaban en la raíz de la Media Library: en *dynamic folder mode* (todas las cuentas nuevas) el path del `public_id` no ubica el asset en carpetas; eso lo hace `asset_folder`. La firma ahora incluye `asset_folder` (misma carpeta que el `public_id`, sin el id). `public_id`, URLs y validación (`assertValidImageUrl`) no cambian; las cuentas en *fixed mode* lo ignoran.
- `SignedUploadParamsDto.asset_folder` documentado; `openapi.json` regenerado.

### Verificación
- `npm run lint` ✅ · unit (media) ✅ · e2e 203/203 ✅.

## 2026-10-18 — Respuestas tipadas en OpenAPI (records, stats, medidas, fotos)

### Hecho
- Los controllers de `records`, `stats`, `body-metrics` y `progress-photos` vivían dentro del `*.module.ts`; el plugin de swagger solo infiere respuestas en archivos `*.controller.ts`, así que esos endpoints salían sin schema y el cliente generado de la web devolvía `void` (perdía el body). Movidos a su propio `*.controller.ts`; el servicio de fotos también pasó a `progress-photos.service.ts`. Sin cambios de rutas ni de comportamiento.
- `export`: `ExportQueryDto` pasó a `dto/export.dto.ts` (el plugin solo infiere propiedades en `*.dto.ts`) y el módulo se separó en controller/service: `GET /export` ahora documenta `format` y `dataset`.
- `openapi.json` regenerado: todas las respuestas 2xx tienen schema salvo las esperadas (202 de `verify-email/resend` y `password/forgot`, sin body; `GET /export` es una descarga de archivo).

### Verificación
- `npm run lint` ✅ · unit 188/188 ✅ · e2e 203/203 ✅.

## 2026-10-18 — Filtros del historial de sesiones

### Hecho
- `GET /workouts` acepta `routineId` y `exerciseId` (UUID v4), combinables entre sí y con `from`/`to`/`status`; `meta.total` cuenta con los filtros. Pedido por el historial de la web (filtrar por rutina y por ejercicio con paginación correcta).
- `exerciseId` usa el índice existente `workouts(userId, exercises.exerciseId, startedAt)`; `routineId` filtra sobre `workouts(userId, startedAt)`. Sin índices nuevos (`docs/INDEXES.md` sin cambios).
- `openapi.json` regenerado.

### Verificación
- `npm run lint` ✅ · unit 188/188 ✅ · e2e 203/203 ✅ (+1: por rutina, por ejercicio, combinado con fecha, id inválido → 400).

## 2026-10-18 — Tier personal por objetivo

### Hecho
- `user_exercise_prefs.personalTier` (un tier para todo) → **`personalTiers: { hypertrophy, powerlifting }`**, igual que el tier global. `null` en un objetivo = se usa el global. Pedido desde la web (tablero de tier list): un curl puede ser A en hipertrofia y C en powerlifting.
- Contrato (cambio incompatible, a propósito antes de que exista la app móvil):
  - `PATCH /exercises/:id/prefs` → `{ isFavorite?, personalTiers?: { hypertrophy?, powerlifting? } }`, parcial por objetivo (solo cambian los objetivos enviados; `null` limpia uno). El campo viejo `personalTier` → 400 (`forbidNonWhitelisted`).
  - Respuestas (`ExerciseSummaryDto`, `ExerciseDetailDto`, `ExercisePrefsDto`) → `personalTiers` completo.
  - `GET /exercises/tier-list?source=personal` usa el tier personal **del objetivo pedido**.
  - Sync `user_exercise_prefs`: `personalTiers` se fusiona por objetivo con lo guardado (un dispositivo que manda solo un objetivo no borra el otro).
- Migración one-off `npm run db:migrate-personal-tiers`: el `personalTier` viejo pasa a ambos objetivos (nadie pierde lo que tenía), sube `serverUpdatedAt`, idempotente y sin pisar valores por objetivo ya existentes. Lectura tolerante a documentos sin migrar (`personalTiersOf`).
- `openapi.json` regenerado; `SPEC.md` actualizado en los tres repos; README y CLAUDE.md raíz.

### Verificación
- `npm run lint` ✅ · `tsc --noEmit` ✅ · `npm run openapi` ✅.
- Unit 188/188 ✅ (+2: tier personal solo aplica a su objetivo; cada objetivo con el suyo).
- e2e 202/202 ✅ (+6: PATCH parcial por objetivo, rechazo del campo viejo y de objetivos desconocidos, tier-list personal por objetivo, sync que fusiona por objetivo, migración: ambos objetivos + `serverUpdatedAt`, idempotencia sin pisar, lectura por la API).
- **No ejecutado**: la migración contra la BD de producción.

### Decisiones y gotchas
- Sin campo de compatibilidad (`personalTier` deprecado): el único cliente es la web, que se actualiza en el mismo cambio, y la app móvil todavía no sincroniza. Hacerlo después habría exigido versionar el contrato de sync.
- La migración usa la colección nativa: el filtro apunta a un campo que el schema ya no tiene y los updates con pipeline no pasan por `syncTrackingPlugin` (por eso fija `serverUpdatedAt: '$$NOW'`).
- `findOneAndUpdate` con `$set` sobre `personalTiers.<goal>` + `upsert` + `setDefaultsOnInsert` funciona (cubierto por e2e): Mongoose no agrega el default del subdocumento cuando ya se setea un hijo.

### Pendiente / próximo
- **Producción, después del deploy**: `npm run db:migrate-personal-tiers` contra Atlas (desde local con el `MONGODB_URI` de producción). Hasta correrlo, los tiers personales viejos se leen como vacíos (no hay errores).

## 2026-10-17 — Primer despliegue en producción

### Hecho
- Repo en GitHub (`aabsolutions/saiyagym-backend`), CI verde. Render (Blueprint, plan free, `virginia`): **https://saiyagym-api.onrender.com** — Live.
- Deploy: auto-deploy nativo de Render tras CI (`autoDeployTrigger: checksPass`), sin deploy hook.
- Seeds cargados en la BD de producción desde local: planes + admin, 141 ejercicios + 9 tags, 4 plantillas, 81 alimentos, 30 comidas, 10 guías.

### Verificación (contra producción)
- `/health` 200 con Mongo `up`; `X-Request-Id` (reutiliza el de Render y uno válido del cliente); `/plans` Free/Premium; 401 con sobre de error y i18n (es por defecto, en con `Accept-Language`); Swagger apagado (404); CORS permite `https://aabsolutions.github.io` y no otros orígenes; helmet (HSTS, CSP, nosniff); `/exercise-tags` 9.
- Con el admin (verificado por el usuario): rol `admin`, 141 / 4 / 81 / 30 / 10.

### Decisiones y gotchas
- `npm ci` falló en CI por un npm global viejo (ver entrada anterior) → `.nvmrc` fijado a 24.22.0; Render lo usa sin problema.
- `MAIL_DRIVER` pasó a `sync: false` en `render.yaml`: con `value: smtp` un sync del Blueprint lo restablecería y la app no arranca sin `SMTP_HOST`. Hoy está en `console` en el dashboard.
- Un deploy aparece como "Build failed" con `npm error signal SIGTERM` cuando otro deploy más nuevo lo cancela (guardar una variable + push casi simultáneos). No es un error real.
- Ping a Mongo ~114 ms desde Render: probablemente el cluster de Atlas no está en AWS `us-east-1`. Cada query paga esa latencia.

### Pendiente / próximo
- Revisar la región del cluster de Atlas (M0 no se mueve: nuevo cluster en `us-east-1` + migrar datos/seeds + cambiar `MONGODB_URI`).
- SMTP (Brevo, puerto 2525) → `MAIL_DRIVER=smtp`: hoy no salen emails de verificación ni de recuperación de contraseña.
- Cloudinary (las tres variables) → imágenes y fotos de progreso (hoy 503 `MEDIA_NOT_CONFIGURED`).
- Protección de `main` en GitHub; `LOG_LEVEL=` en `.env.example`.
- Clientes: base URL `https://saiyagym-api.onrender.com/api/v1`; tolerar el arranque en frío (~1 min tras 15 min sin tráfico).


## 2026-10-16 — Preparación para producción

### Hecho
- **Auditoría de aislamiento por usuario**: todas las lecturas y agregaciones de datos de usuario filtran por `userId`/`ownerId`; los accesos por id son `requireOwned` (404, nunca 403); sync rechaza ids ajenos con `FORBIDDEN` antes de escribir; referencias cruzadas (ejercicio custom, rutina, programa) validadas como propias. **Sin fugas encontradas.** Endurecido: las escrituras posteriores a `requireOwned` (borrar/archivar en rutinas, programas, workouts, medidas, fotos) incluyen `userId` en el filtro (defensa en profundidad).
- **`test/isolation.e2e-spec.ts`** (60 tests): Bob tiene uno de todo; Alice (y Carol, vacía) recorren todos los endpoints. Listas y agregados: Alice ≡ usuario vacío **y** Bob ≠ usuario vacío (control positivo). Por id: 404 en cada verbo. Referencias ajenas → 400. Robo de id por REST → 409, por sync → `FORBIDDEN`. Al final los documentos de Bob siguen idénticos.
- **Índices**: revisados todos; `docs/INDEXES.md` explica cada uno. Eliminados los redundantes: `deletedAt` en todas las colecciones, `userId` simple en las de usuario (prefijo de compuestos), `exercises.isGlobal/primaryMuscle/ownerId`, `programs.status`. `test/indexes.e2e-spec.ts` falla si un índice no está documentado o viceversa. `npm run db:indexes [-- --apply]` para borrar sobrantes en BDs existentes (Mongoose no los borra).
- **Logging estructurado (pino, `nestjs-pino`)**: JSON por línea; una línea por request (`req.id`, método, path **sin query**, status, `responseTime`, `userId`); 4xx `warn`, 5xx `error`; health no se loguea; `X-Request-Id` (reutiliza el de Render si es válido); logs de la app dentro de un request llevan `reqId`. Nunca headers, bodies, tokens ni emails: `redact` + `scrubText()` para texto libre (mensajes de Mongo `E11000 … email`, stacks). `LOG_LEVEL` (info prod · debug dev · silent tests); pretty en desarrollo.
- Datos sensibles en logs corregidos: email del destinatario en errores SMTP (ahora `a***@dominio`), `ConsoleMailService` en producción ya no imprime el cuerpo (tokens de verificación/reset), errores 500 y stacks de sync/PRs pasan por `scrubText()`.
- **Arranque en frío**: Nest arranca en ~0,4 s (con índices). Quitado del arranque: el backfill de `serverUpdatedAt` (escaneo sin índice de 6 colecciones en cada boot → `npm run db:backfill-sync`) y la espera del hash argon2 dummy (segundos en 0,1 CPU; ahora en background). Mongo: `serverSelectionTimeoutMS` 10 s, `maxPoolSize` 10.
- **`render.yaml`**: web service Node free, `virginia`, `node dist/main`, health `/api/v1/health`, build con devDeps + prune, `autoDeployTrigger: checksPass`, todas las variables (secretos `sync: false`, `JWT_ACCESS_SECRET` generado).
- **GitHub Actions** (`.github/workflows/ci.yml`): en PR y main → lint, unit, e2e (binario de Mongo cacheado), build y `openapi.json` sin cambios. El deploy lo hace Render solo (ver decisión abajo).
- **Docs**: `docs/DEPLOYMENT.md` (Atlas, Render, variables con el porqué, GitHub Pages en `CORS_ORIGINS`, SMTP en plan free, arranque en frío y mitigaciones, primer despliegue con seeds, logs, CI/CD, operaciones); README reescrito (arquitectura, módulos, seeds, testing, despliegue, referencia de dominio).
- `openapi.json` regenerado (sin cambios de contrato en esta tarea).

### Verificación
- `npm run lint` ✅ · `tsc --noEmit` ✅ · `npm run openapi` ✅ (sin `npm run build` local; lo corre CI).
- Unit 186/186 ✅ (+5: logger con pino-http real → sin `Authorization`/cookies/query/emails/passwords, `reqId` correlado, request id malformado rechazado, 5xx `error`, health sin log; `maskEmail`/`scrubText`).
- e2e 196/196 ✅ (+61: aislamiento 60, índices 1); termina sin `--forceExit`.
- **Tests de mutación**: quitar `userId` del listado de rutinas → falla el test de aislamiento.
- **No verificado**: despliegue real en Render, workflow en GitHub (el repo no tiene remoto ni commits), envío SMTP desde el plan free.

### Decisiones y gotchas
- Aislamiento comparando con un usuario vacío en vez de buscar "trazas": sirve para agregados sin ids (volumen muscular, total PL). Normalizar `window.to` (= ahora) en frecuencia del año en curso.
- `it.each` con filas de 2 columnas y una función de 3 parámetros → Jest pasa `done` como 3.º → timeout. Filas siempre completas.
- `/exercises/:id/last-performance` con id ajeno devuelve `200 null` como con un id inexistente: no revela nada, no es 404.
- `export` tiene throttle propio 5/min por IP: los tests comparten IP.
- pino-http: el serializer `req` recibe el objeto estándar (con `id`); `quietReqLogger` pone `reqId` en los logs de la app. `fetch` no permite `
` en headers.
- Deploy: primero con deploy hook desde Actions; cambiado (a pedido) a auto-deploy nativo de Render con `autoDeployTrigger: checksPass` (`autoDeploy` está deprecado): push a main → despliega solo si todos los checks de GitHub del commit pasan. Sin secrets. Si un commit no tiene checks, Render no despliega → el workflow debe seguir corriendo en push a main.
- Render free: sin IP fija (Atlas `0.0.0.0/0` salvo rangos de salida), posible bloqueo de SMTP 25/465/587 (usar 2525), se duerme a los 15 min.
- **CI roto en el primer push** (`npm ci`: `Missing: @emnapi/core@1.11.3 from lock file`): el lock lo escribió un npm global viejo (11.6.1, pisaba al 11.19 de Node 24.21); el CI (Node 24.22 → npm 11.19.1) resuelve los peers de `@napi-rs/wasm-runtime` (opcional de Jest) en la raíz. Un lock regenerado con 11.21 rompía a su vez el 11.6.1. Fix: lock regenerado con npm 11.19.1 (verificado con `npm ci --dry-run` en 11.19.0/11.19.1/11.21.1), `.nvmrc` fijado a `24.22.0`, `engines.npm >= 11.19.0`.
- `CORS_ORIGINS` es el origen sin path: `https://<user>.github.io`, no `…/<repo>/`.

### Pendiente / próximo
- Protección de `main` en GitHub (PR + check "Lint, test, build").
- **Manual** (`.env*` bloqueado para el agente): añadir `LOG_LEVEL=` a `.env.example`.
- Primer despliegue según `docs/DEPLOYMENT.md` §4.
- Paginación de `/sync/pull`; store compartido para el throttler si se escala a varias instancias.


## 2026-10-16 — Nutrición (sugerencias generales, no consejo médico)

### Hecho
- **Módulo `modules/nutrition`**: colecciones `foods`, `meal_suggestions`, `nutrition_guidelines`, todo traducible `{es, en}`, borrado lógico, `slug` único reservado tras borrar.
  - `foods`: categoría (13), `per100g { kcal, proteinG, carbsG, fatG }`, etiquetas de lista cerrada (`vegan`, `vegetarian`, `gluten-free`, `lactose-free`, `high-protein`, `high-fiber`, `low-fat`).
  - `meal_suggestions`: objetivo (`bulk|cut|maintenance`) + tipo (`breakfast|lunch|dinner|snack|pre_workout|post_workout`), ítems `{ foodSlug, grams }`, `isSample`, `sortOrder`. Macros por ítem y totales **calculados al leer** desde los alimentos actuales.
  - `nutrition_guidelines`: `goals[]`, `title/summary/body`.
- **Usuario** (`/nutrition/*`): `GET foods` (filtros `category`, `tag` repetible = todas, `q` parcial sin acentos en cualquier idioma; orden por nombre localizado con collation), `GET foods/:id`, `GET meal-suggestions?goal&mealType`, `GET meal-suggestions/:id`, `GET guidelines?goal`, `GET guidelines/:id`.
- **Gating Premium** (`fullNutrition`): sin la feature, la lista devuelve solo `isSample` + `limitedByPlan: true` + `lockedCount`; el detalle de una no-muestra → 403 `PLAN_FEATURE_REQUIRED`. Guías y calculadora para todos los planes (SPEC).
- **`POST /nutrition/calculator`**: Mifflin-St Jeor × factor de actividad (1.2/1.375/1.55/1.725/1.9) y macros por objetivo (bulk +10 % · 1.8 g/kg · 25 % grasa; cut −20 % · 2.2 g/kg · 25 %; mantenimiento · 1.8 g/kg · 30 %; hidratos = resto). Datos del body o, si faltan, del perfil (sexo, fecha de nacimiento → edad, altura) y del último peso de `body_metrics`; `input.sources` dice de dónde salió cada valor. No guarda nada. Nunca por debajo del BMR (`clampedToBmr`). Respuesta con `disclaimer` traducido (`src/i18n/<lang>/nutrition.json`); también en listas de sugerencias y guías.
- Cálculo puro en `nutrition-calculator.ts` (`calculateNutrition`, `resolveCalculatorInput`, `ageInYears`); utilidades puras en `nutrition.util.ts`.
- **Admin** (`/admin/nutrition/foods|meal-suggestions|guidelines`): CRUD completo con mapas crudos. Sugerencias validan que sus alimentos existan (400 `FOOD_NOT_FOUND` + `missing`); borrar un alimento usado → 409 `FOOD_IN_USE` (+ slugs).
- **Seed** `src/database/seeds/nutrition.seed.json`: 81 alimentos, 30 sugerencias (10 por objetivo, los 6 tipos en cada uno, 2 muestras Free por objetivo), 10 guías. `npm run seed:nutrition` (insert-only) / `-- --update`. Validación estructural incluida la coherencia kcal ↔ 4/4/9.
- Nuevos códigos: `FOOD_NOT_FOUND`, `FOOD_IN_USE`, `MEAL_SUGGESTION_NOT_FOUND`, `NUTRITION_GUIDELINE_NOT_FOUND`, `NUTRITION_SLUG_TAKEN`, `NUTRITION_PROFILE_INCOMPLETE` (es/en). `BodyMetricsService.latestWeightKg()`.

### Verificación
- `npm run lint` ✅ · `npm run openapi` ✅ · `tsc --noEmit` ✅ (sin `npm run build`).
- Unit 181/181 ✅ (+28): Mifflin hombre/mujer, cada objetivo con valores exactos, cada factor de actividad, macros que suman el objetivo, clamp al BMR, hidratos nunca negativos, edad en cumpleaños, resolución body/perfil/peso, sexo `other`, faltantes, fuera de rango; búsqueda normalizada, macros por ración y totales; seed real válido y cobertura objetivo × tipo.
- e2e 135/135 ✅ (+22): seed idempotente, filtros/búsqueda/orden/404, Free vs Premium (lista, `lockedCount`, 403 en detalle), guías por objetivo e idioma, calculadora (body, perfil + último peso, no escribe, faltantes, validación), admin (rol, CRUD, slug reservado, `null` → 400, búsqueda tras renombrar, `FOOD_NOT_FOUND`, `FOOD_IN_USE`).
- **Test de mutación**: quitar el filtro `isSample` para Free hace fallar 2 tests.
- **No verificado**: el script CLI `seed:nutrition` (usa `nest build`); el `NutritionSeeder` que invoca sí está cubierto por e2e.

### Decisiones y gotchas
- **Muestra Free = flag `isSample` editable por admin**, no un límite numérico en `plans`: los `limits` son recursos contables con contador en `UsageCountersRegistry`, no encajan. `lockedCount` sirve para el upsell.
- **Etiquetas de alimentos como lista cerrada** (no colección admin como los tags de ejercicios): los clientes las traducen en su i18n y los filtros nunca apuntan a etiquetas sin nombre. Añadir una = cambio de código.
- Búsqueda: campo oculto `searchText` (todas las traducciones, minúsculas, sin diacríticos) recalculado en cada alta/edición del nombre + regex escapado. Con ~80 alimentos no hace falta índice de texto, y así funciona con palabras parciales y acentos (`$text` no).
- Las sugerencias referencian alimentos por **slug** (como plantillas → ejercicios) y los totales se calculan al leer: corregir un alimento corrige todas las comidas. Por eso no se borra un alimento en uso.
- Objetivo nutricional (`bulk|cut|maintenance`) ≠ objetivo de entrenamiento del perfil (`hypertrophy|powerlifting|both`): la calculadora lo exige en el body.
- Calculadora solo para adultos (18–100 años, 120–230 cm, 35–250 kg): valores guardados fuera de rango (p. ej. un menor) se reportan en `details.outOfRange` y no se usan. Sexo `other` del perfil → hay que enviar `male|female`.
- Heredoc de bash con `'EOF'` falló en Windows con un archivo grande: usar Write para archivos nuevos.

### Pendiente / próximo
- **Commit** (sigue sin commits).
- Clientes: pantalla de nutrición (web/móvil) mostrando siempre `disclaimer`.

## 2026-10-13 — Estadísticas, récords, medidas, fotos y exportación

### Hecho
- **Récords** (`modules/records`): `PersonalRecordsService` escucha `workout.finished|updated|deleted` y recalcula **desde cero** los PRs de cada ejercicio afectado (antes ∪ después): mayor peso, mejor e1RM Epley (1–12 reps), más reps por peso exacto, mayor volumen por sesión. Sin warmups. Cálculo puro en `personal-records.calc.ts`. `POST`/`PATCH /workouts` devuelven `newRecords[]` (vía `emitAsync`, sin que workouts importe records). También al llegar por sync (`afterWrite` ahora se espera). `GET /records`, `GET /exercises/:id/records`.
- **Estadísticas** (`modules/stats`, pipelines de agregación): `summary` (semana/mes + racha semanal), `exercise/:id` (peso máx., e1RM, volumen por sesión), `muscle-volume` (series y kg por músculo primario y semana, `$lookup` + `$dateTrunc`), `frequency` (días por semana + heatmap anual), `powerlifting-total` (máximo acumulado de sentadilla/banca/peso muerto y variantes de competición; `metric=e1rm|max_weight`), `program-adherence/:programId` (días planificados vs. hechos + extras). Zona horaria `?tz=` (IANA) y primer día de semana del usuario.
- **Límite Free de 90 días** aplicado en servidor por `statsWindow()` (función pura) en todas las estadísticas y en la serie de medidas; cada respuesta incluye `window.limitedByPlan`.
- **Medidas** (`/body-metrics`): CRUD idempotente + serie temporal por medida; el handler de sync ahora vive en `BodyMetricsService`.
- **Fotos de progreso** (`/progress-photos`): alta Premium; subida privada (`type=authenticated`) a `users/<id>/progress`; `publicId` validado contra la carpeta del usuario; URLs firmadas en cada lectura; comparador antes/después; borrar elimina primero en Cloudinary. La firma `progress_photo` exige Premium (chequeado en `MediaController`).
- **Exportación** (`GET /export`, Premium): JSON completo; CSV por `dataset` (UTF-8 BOM, CRLF, una fila por serie, protección contra inyección de fórmulas).
- Utilidades: `local-date.util.ts`, `csv.util.ts`, validador `@IsTimeZone`.

### Verificación
- `npm run lint` ✅ · `npm run build` ✅ · `npm run openapi` ✅
- Unit 153/153 ✅ — PRs (cada tipo, warmups/series no completadas, rango 1–12 del e1RM, empates, primera sesión, edición del poseedor vs. subcampeón, borrado), ventana de 90 días, fechas locales/zona, CSV.
- e2e 113/113 ✅ ×3 — PRs por REST y sync (detección, edición, borrado), límite de 90 días (Free vs Premium, también en frecuencia, volumen muscular y serie de medidas), resumen/racha, zona horaria, volumen muscular, total de powerlifting, adherencia, medidas, fotos (Premium, carpeta privada, URL firmada, comparador, borrado con fallo de Cloudinary), exportación (403 Free, JSON, CSV con inyección neutralizada).

### Decisiones y gotchas
- **`@OnEvent([a, b, c])` no es "cualquiera de"**: EventEmitter2 lo toma como un único evento con namespace `a.b.c` y el listener nunca se dispara. Apilar un `@OnEvent` por evento.
- PR "nuevo" = el workout lo posee y supera al **mejor sin contar ese workout** (idempotente; editar al poseedor no se celebra a sí mismo). Primera sesión y primer uso de un peso = línea base. Reenviar un create idempotente no re-emite eventos → `newRecords: []`.
- Los PRs se recalculan sin ventana de plan (son récords históricos); las estadísticas sí respetan los 90 días. La lista de medidas es historial completo; la serie, estadística.
- Fallos del recálculo de PRs se registran y no rompen la respuesta (el workout ya se guardó; los PRs se pueden reconstruir).
- Fotos: URLs firmadas sin caducidad (la caducidad requiere "token auth" de Cloudinary, de pago). Se puede ver/borrar tras bajar a Free; solo el alta es Premium.
- CSV no puede contener dos tablas → `dataset` en vez de un ZIP.
- Racha = semanas consecutivas con ≥ 1 sesión; la semana en curso no la rompe hasta terminar. En Free se cuenta dentro de la ventana.
- Tests: crear muchos usuarios por `/auth/register` choca con su rate limit real (5/h/IP) → `createTestUser()` usa el servicio y firma el token. El BOM `﻿` acabó dos veces como carácter literal en el código: usar la constante `UTF8_BOM`.

### Pendiente / próximo
- **Commit** (sigue sin commits).
- Paginación de `/sync/pull`; sync de fotos de progreso.
- Volumen muscular solo cuenta el músculo primario (los secundarios podrían sumar 0,5 serie).

## 2026-10-13 — Workouts y sincronización offline

### Hecho
- **Workouts** (`modules/workouts`): ejercicios y series embebidos (SPEC), `startedAt/finishedAt`, `durationSeconds`, notas, valoración 1-5, `routineId`/`programId` opcionales (validados como propios), `volumeKg`/`workingSets` calculados en servidor (solo series de trabajo completadas). CRUD REST; `POST` idempotente por `id` del cliente (201/200; id ajeno → 409); lista paginada con `from`/`to`/`status`; borrado lógico.
- `GET /exercises/:id/last-performance` (última sesión **finalizada**, slots del mismo ejercicio fusionados) y `GET /exercises/:id/history` (paginado, volumen y mejor e1RM por sesión).
- **Eventos** (`@nestjs/event-emitter`): `workout.finished|updated|deleted` desde REST y sync; transición calculada por función pura `workoutEventFor`. Sin listeners todavía (B6: PRs y estadísticas).
- **Historial real para la progresión**: `WorkoutHistoryAdapter` reemplaza al adaptador vacío del puerto `WorkoutHistoryProvider`. `/programs/active/today` ya sube pesos con la doble progresión.
- **Sync** (`modules/sync`): `POST /sync/push` (≤ 500 cambios, resultado por cambio `applied|ignored_older|error`) y `GET /sync/pull?since=`. Protocolo genérico + handlers por dominio registrados en `SyncRegistry` (workouts, routines, body_metrics, user_exercise_prefs; pull-only: programs, exercises custom). LWW por `updatedAt` del cliente, concurrencia optimista (reemplazo condicionado a la versión leída, 1 reintento), `CLOCK_SKEW` si `updatedAt` > ahora + 5 min.
- **`syncTrackingPlugin`**: `serverUpdatedAt` en toda escritura (save, update*, replace*) + índice `(owner, serverUpdatedAt)`; backfill al arrancar para documentos previos.
- **body_metrics**: schema SPEC + handler de sync (al menos una medida). Sin REST aún.
- Límite JSON a 2 MB.

### Verificación
- `npm run lint` ✅ · `npm run build` ✅ · `npm run openapi` ✅
- Unit 129/129 ✅ (cálculo de volumen/duración/validaciones/rendimiento, transiciones de eventos).
- e2e 92/92 ✅ ×3. Sync: push idempotente (un solo documento, sin segunda escritura, evento una vez), conflicto con versión más antigua (`ignored_older`) y más nueva, delete obsoleto pierde, errores por cambio sin abortar el lote, `CLOCK_SKEW`, documento ajeno → `FORBIDDEN`, prefs convergen, límites/Premium en rutinas, pull completo e incremental con borrados, **edición offline tardía entregada**, escrituras REST visibles en pull. Workouts: idempotencia, eventos de ciclo de vida, listados, last-performance/history, **integración con progresión** (3×12 a 80 kg → hoy 82,5 kg).
- **Test de mutación**: cambiar el cursor de pull a `updatedAt` hace fallar el test de edición offline tardía (el test detecta el bug que previene).

### Decisiones y gotchas
- **Dos relojes**: `updatedAt` (cliente) decide conflictos; `serverUpdatedAt` (servidor) es el cursor de pull. Con un solo reloj, una edición offline hecha a las 10:00 y subida a las 15:00 nunca llega a un dispositivo que hizo pull a las 12:00.
- Empate de `updatedAt` = repetición idempotente → `applied` sin escribir (gana el servidor, determinista).
- Pull devuelve hasta `ahora − 2 s` (margen para escrituras en vuelo); duplicados posibles e inocuos. **Sin paginación** todavía: un usuario con miles de documentos haría un primer pull grande.
- Mongoose 9: las actualizaciones con pipeline exigen `updatePipeline: true`.
- `bulkWrite` y llamadas directas al driver no disparan el plugin (hoy solo `bulkUpdateTiers` sobre ejercicios globales, que no se sincronizan).
- Referencias que eran válidas al registrar un workout/rutina siguen válidas al editarlo aunque el ejercicio/rutina/programa se haya borrado después.
- Reglas de progresión en sync: Premium solo para **añadir o cambiar** reglas (comparado por id de slot); las ya guardadas viajan en ediciones de usuarios que bajaron a Free.
- e2e: datos que dependen de `beforeAll` se construyen en `beforeAll`, no en el cuerpo del `describe` (segunda vez que aparece este bug).

### Pendiente / próximo
- **Commit** (sigue sin commits).
- B6: listeners de `workout.*` → PRs y estadísticas.
- Paginación de `/sync/pull` (cursor compuesto `serverUpdatedAt` + `_id`).
- REST de body_metrics + fotos de progreso.

## 2026-10-13 — Rutinas, programas, progresión y plantillas

### Hecho
- **Rutinas** (`modules/routines`): CRUD, duplicar (sufijo "(copia)/(copy)" i18n), archivar/desarchivar, reordenar (`PUT /routines/:id/exercises/order`, permutación exacta de slots). Ejercicios embebidos con slot `id` estable, series objetivo (`type`, `repsMin–repsMax`, `weightKg` XOR `percent1RM`, `restSeconds`), notas, `groupId` (superseries contiguas, ≥ 2). Valida que los `exerciseId` sean accesibles (globales + custom propios).
- Límite `routines` (Free 3) cuenta rutinas vivas no archivadas; `@CheckLimit` en crear/duplicar; desarchivar valida en servicio. Borrar una rutina usada por un programa draft/activo → 409 `ROUTINE_IN_USE` (vía `RoutineUsageRegistry`, sin ciclo routines↔programs).
- **Reglas de progresión** (Premium `autoProgression`, unión discriminada validada): `double_progression` (incremento por defecto 2.5 compuesto / 1 aislado) y `percent_1rm` (semanas `{percent, reps?, sets?}`, se ciclan). Descarga por programa (`deload {weeks, mode: weight|sets, percent}`) con override por ejercicio.
- **`ProgressionService` puro** + `program-schedule.ts` puro (fechas locales `YYYY-MM-DD`).
- **Programas** (`modules/programs`): CRUD, `activate` (fecha local de inicio, límite `activePrograms`, idempotente), `deactivate`, `complete` (completados: solo nombre/notas). Training maxes por ejercicio.
- **`GET /programs/active/today?date=`**: estado `training|rest|not_started|finished`, semana, descarga, rutina con series objetivo calculadas y `adjustments` (códigos: `INCREASE`, `HOLD`, `NO_HISTORY`, `WEEK_PERCENT`, `PERCENT_OF_MAX`, `NO_REFERENCE_MAX`, `DELOAD_WEIGHT`, `DELOAD_SETS`, `PROGRESSION_DISABLED`).
- **Plantillas** (`program_templates`): CRUD admin, listado/detalle localizados, `POST /program-templates/:id/copy` (crea rutinas + programa draft; valida todo antes de escribir; sin Premium descarta reglas → `progressionRulesDropped`; ejercicios borrados → `skippedExercises`). Referencian ejercicios por **slug**.
- **Seed** `program-templates.seed.json`: PPL 6 días, Torso/Pierna 4 días, Cuerpo completo 3 días (A/B alternado), Bloque de fuerza 4 semanas (70/75/80/85 % con reps y series por semana). Todas ≤ 3 rutinas (copiables en Free). `npm run seed:templates`.
- `WorkoutHistoryProvider` (puerto) con adaptador vacío hasta que exista el módulo de workouts.
- `EntitlementsService.assertWithinLimit(user, key, amount)` para altas en lote.
- Util `epley1RM` / `roundToStep` en `common/utils/one-rep-max.util.ts`; constantes de entrenamiento en `common/constants/training.ts`.

### Verificación
- `npm run lint` ✅ · `npm run build` ✅ · `npm run openapi` ✅
- Unit 112/112 ✅ — `ProgressionService` cubre cada regla: estático (peso fijo, %1RM con training max / estimado / sin máximo, redondeo compuesto/aislado/regla), plan sin Premium, doble progresión (sin historial, solo calentamientos, sube, incremento aislado y custom, mantiene, menos series, por posición, calentamientos intactos, solo última sesión, no sube en descarga), %1RM (cada semana, ciclo, overrides de reps/series, calentamientos, máximo estimado, sin máximo, redondeo), descarga (peso, series, mínimo 1, override por regla, se apila con %, fuera de semana de descarga). Calendario, reglas de rutina, Epley.
- e2e 68/68 ✅ ×4 (rutinas: validaciones, Premium, límites, archivado, reordenado, privacidad; programas: validación, en uso, activación, hoy por fecha local, descarga, límite Free, estados; plantillas: listado, detalle, copia Free/Premium, bloque de fuerza con training max → 140 kg semana 1, 195 kg peso muerto semana 4).
- Smoke de `seed:templates`: error claro si faltan ejercicios; idempotente; `--update`.

### Decisiones y gotchas
- **e2e compartían base de datos** → al sembrar el catálogo real rompían los conteos exactos de otros archivos (19–28 fallos solo al correr todo junto). Ahora `test/setup-isolated-db.ts` (jest `setupFiles`) da una base por archivo.
- `it.each` evalúa su tabla al definir los tests, antes de `beforeAll`: usar factories si dependen de datos sembrados.
- "Hoy" usa la fecha local del cliente (`date=YYYY-MM-DD`): calcularlo en UTC desplaza el día para usuarios en UTC−3 desde las 21:00.
- Doble progresión **por posición de serie** y solo si TODAS las series de trabajo llegaron al tope (SPEC); con menos series hechas que prescritas → mantiene.
- %1RM sin training max ni historial → `weightKg: null` + `NO_REFERENCE_MAX`; nunca se inventa un peso.
- Free: reglas ignoradas en `/today` (`PROGRESSION_DISABLED`) y descarga no aplicada (es progresión automática); el `%1RM` estático de una serie sí se resuelve (es prescripción).
- Activar no usa `@CheckLimit`: el guard corre antes del handler y rompería la idempotencia de reactivar uno ya activo.
- La descarga se apila sobre el % de la semana; las plantillas por % no definen semanas de descarga.

### Pendiente / próximo
- **Commit** (sigue sin commits).
- Workouts + sync: adaptador real de `WorkoutHistoryProvider`, detección de PR.
- Considerar `trainingMaxes` por slug en la copia (hoy por exerciseId; el cliente los obtiene del detalle de la plantilla).

## 2026-10-13 — Catálogo de ejercicios, tags, prefs y media

### Hecho
- **Ejercicios** (`modules/exercises`): colección única globales + custom. Campos SPEC: `name/description/instructions` traducibles, músculo primario/secundarios (19 músculos canónicos), equipo, mecánica, categoría, `trackingType: 'weight_reps'`, `imageUrl`, `tags` (slugs), `tiers { hypertrophy, powerlifting }` S/A/B/C/null, `isGlobal`, `ownerId`, `slug` (único parcial, solo globales).
- `GET /exercises`: filtros `q`, `muscle`, `equipment`, `mechanic`, `category`, `goal`+`tier`, `tag`, `favorites`, `custom`; paginación; orden `name|-name|createdAt|-createdAt|relevance`; respuestas localizadas con `isFavorite`, `personalTier`, `isCustom`. `GET /exercises/:id` (detalle con descripción e instrucciones).
- `GET /exercises/tier-list?goal&muscle&equipment&source=global|personal` → `{ tiers: {S,A,B,C}, unranked }`, ordenado por nombre con `Intl.Collator`.
- Custom: `POST/PATCH/DELETE /exercises` con `@CheckLimit('customExercises')` (primer contador real registrado en `UsageCountersRegistry`). Privados por usuario (404 para otros).
- `user_exercise_prefs`: `PATCH /exercises/:id/prefs` (favorito + tier personal, parcial, upsert; índice único userId+exerciseId).
- **Tags**: `exercise_tags`; `GET /exercise-tags` público localizado; CRUD admin (`/admin/exercise-tags`), borrar quita el tag de todos los ejercicios.
- **Admin**: `/admin/exercises` CRUD con mapas completos, `PATCH /admin/exercises/tiers` (lote, omitido = sin cambio, null = sin rango, reporta `notFound`).
- **Media** (`modules/media`): `POST /media/upload-signature` (Cloudinary signed upload; `public_id` = carpeta + UUID decidido por el server, formatos permitidos, transformación entrante `c_limit,w_1600,h_1600`, caduca en 1 h; `exercise_image` solo admin). `imageUrl` validado contra cloud + carpeta del scope. Secret nunca expuesto.
- **Seed**: `src/database/seeds/exercises.seed.json` — 141 ejercicios + 9 tags, es/en, competición (sentadilla, banca, peso muerto convencional y sumo) + accesorios (pausa, pin, déficit, bloques, Spoto, Larsen, JM press, SSB…). `npm run seed:exercises` (solo inserta) / `-- --update` (sobrescribe).
- Índice de texto `exercise_name_text` en `name.es` + `name.en` (`default_language: none`).
- `localize()` ahora cae a cualquier idioma disponible tras `es`.

### Verificación
- `npm run lint` ✅ · `npm run build` ✅ (JSON del seed copiado a `dist`) · `npm run openapi` ✅
- Unit 54/54 ✅ (agrupación tier list, validación del seed real, firma/URLs de media, localize) · e2e 49/49 ✅ ×3 (filtros, búsqueda texto/parcial/acentos, orden por idioma, paginación, prefs, tier list global/personal/unranked, custom + privacidad + límite Free 10, admin mapas/lote/slug reservado, tags).
- Smoke del script de seed: 141 insertados; idempotente; insert-only respeta edición admin; `--update` la sobrescribe; `$text` encuentra "banca", "deadlift sumo", "bulgara".

### Decisiones y gotchas
- **`PartialType` deja pasar `null`**: `PATCH {name: null}` llegaba a Mongoose → 500. `UpdatePlanDto` y `UpdateGlobalExerciseDto` usan `{ skipNullProperties: false }`; `UpdateCustomExerciseDto` explícito (null solo donde significa "borrar"). **Usar siempre esa opción en DTOs de PATCH.**
- `$text` exige palabras completas → fallback a substring (regex escapado) cuando da 0. MongoDB no permite collation con `$text`: con `q` el orden por nombre es binario.
- Nombre custom guardado en `es` y `en` (texto del usuario, sin traducir): si faltara `name.en`, ordenar por `name.en` los pondría primero (null ordena antes).
- Slugs de borrados se conservan (no se renombran): el seed no resucita y el admin recibe 409 si intenta reutilizarlo.
- Cloudinary: ruta completa en `public_id` (no param `folder`) → igual en modo de carpetas fijas y dinámicas. El tope en **bytes** no es un parámetro firmable: configurarlo en un upload preset o en la cuenta.
- Límite de plan: dos creaciones concurrentes pueden superar el límite en 1 (check-then-insert, sin transacción). Aceptado.
- Tier list sin paginación (tope 2000): el catálogo es pequeño por diseño.
- Descripciones del seed cortas (1 frase); `instructions` vacías — completar desde admin.

### Pendiente / próximo
- **Commit** (la base sigue sin commit).
- Configurar Cloudinary en `.env` y un upload preset con tope de tamaño.
- Rutinas y programas (contador `routines`, `@CheckLimit('routines')`).

## 2026-10-13 — Auth, usuarios, roles y planes

### Hecho
- **Auth** (`modules/auth`): registro, login, refresh con rotación + detección de reutilización, logout (por refresh token, idempotente), logout-all, verificación de email, reenvío, olvido/reset de contraseña. argon2id. Access JWT HS256 15 min `{sub, role, sid}`; refresh opaco 30 días hasheado (SHA-256) en `refresh_tokens` con `familyId` (sesión), `revokedReason` y TTL index.
- Tokens de un solo uso con caducidad en `action_tokens` (verificación 24 h, reset 60 min); emitir uno nuevo invalida el anterior del mismo tipo; consumo atómico.
- **Mail**: `MailService` abstracto → `ConsoleMailService` (dev) / `SmtpMailService` (nodemailer) por `MAIL_DRIVER`. Plantillas es/en en `src/i18n/<lang>/mail.json` (texto + HTML con escape).
- **Roles**: `user | admin | coach` (`coach` sin permisos). `@Roles()` + `RolesGuard`. Guards globales en orden: Throttler → JWT (`@Public()` para excluir) → Roles → Entitlements.
- **Usuarios**: `GET/PATCH /users/me` (perfil + preferencias SPEC, merge por campo; `null` limpia campos de perfil, no de preferencias), `POST /users/me/password` (mantiene la sesión actual, cierra las demás), `DELETE /users/me` (pide contraseña; borrado lógico + anonimización + cierre de sesiones). `GET /users/me` incluye el plan efectivo con entitlements.
- **Planes**: colección `plans` (`code` estable, `name/description` traducibles, `entitlements { limits, statsHistoryDays, features }`, `isDefault`, `active`). Free/Premium sembrados según SPEC. Todo registro nuevo → plan por defecto (Free). Plan efectivo: `active` hasta `currentPeriodEnd` (null = sin fin), `canceled` hasta `currentPeriodEnd`, si no → default. `GET /plans` público y localizado.
- **Entitlements**: `EntitlementsService` + `@RequireFeature()` / `@CheckLimit()` + guard → 403 `PLAN_FEATURE_REQUIRED` / `PLAN_LIMIT_REACHED` (con `details`). Conteo vía `UsageCountersRegistry` (cada módulo registra el suyo; sin contador → error, falla cerrado).
- **PaymentProvider**: interfaz documentada (Stripe web / RevenueCat móvil), sin implementación.
- **Admin**: `GET /admin/users` (paginación, búsqueda email/nombre con regex escapado, filtro rol), `GET /admin/users/:id`, `PATCH /admin/users/:id/role` (no el propio), `PUT /admin/users/:id/subscription`, CRUD `/admin/plans` (soft delete; el default no se borra ni desactiva).
- **Seed**: `npm run seed` (planes + admin desde `ADMIN_EMAIL`/`ADMIN_PASSWORD`).
- Rate limit estricto: login 5/min, registro 5/h, emails (forgot/resend) 3/15 min, verify/reset 10/15 min, cambio de contraseña y borrado 5/min. `TRUST_PROXY` para Render.

### Verificación
- `npm run lint` ✅ · `npm run build` ✅ · `npm run openapi` ✅
- Unit 33/33 ✅ (AuthService con rotación, reuse, concurrencia, logout, cambio/reset de contraseña, verificación, borrado; EntitlementsService; env) · e2e 21/21 ✅ (registro + login + refresh + reuse + logout + 429; admin roles/planes/búsqueda; health). 6 corridas unit+e2e en paralelo sin fallos. Node 24.21.
- Smoke del seed contra Mongo en memoria: idempotente, normaliza email, no resucita planes borrados.

### Decisiones y gotchas
- **Índices antes de servir**: Mongoose construye índices en background; en una BD nueva entró un `plans.code` duplicado antes de existir el índice único (e2e flaky). `IndexesReadyService` espera `Model.init()` de todos los modelos en `onModuleInit`. Aplica igual a `users.email` en producción.
- **Planes por defecto solo en colección vacía**: sembrar por `code` resucitaba planes que el admin había borrado (soft delete renombra el código). Ahora se siembra solo si `plans` está vacía; carrera de arranques concurrentes tolerada (E11000 ignorado).
- Refresh opaco + SHA-256 (no JWT, no argon2): 256 bits aleatorios no necesitan hash lento; búsqueda O(1) por id.
- Reuse detection solo para `revokedReason = 'rotated'`; un token cerrado por logout da `INVALID_REFRESH_TOKEN`. Dos refresh concurrentes con el mismo token → uno gana y el otro revoca la sesión: **los clientes deben serializar el refresh**.
- JWT guard sin estado: cambio de rol / borrado de cuenta tardan ≤ 15 min en afectar al access token.
- Login: `verifyOrBurn` contra hash dummy si el email no existe (evita enumeración por tiempo). Forgot-password siempre 202 y envío en background (el tiempo de SMTP no delata cuentas).
- Registro devuelve 409 si el email existe (enumeración aceptada por UX; mitigada por rate limit 5/h).
- Login permitido sin email verificado (`emailVerified` expuesto); restringir funciones a verificados queda como decisión futura.
- `APP_WEB_URL` se resuelve relativo: conserva el `/<repo>/` de GitHub Pages en los links.
- Tests: `NODE_ENV=test` ignora `.env` (antes el `.env` del dev con Atlas podía filtrarse en los tests).
- Tests unitarios de AuthService usan Mongo en memoria real para tokens: la rotación es lógica de persistencia (atomicidad de `findOneAndUpdate`), mockearla probaría el mock.
- Flaky encontrado y corregido en tests: emails en background llegan en orden no determinista → se esperan por plantilla, no "el último".

### Pendiente / próximo
- **Commit**: la base (2026-10-12) sigue sin commitear.
- Catálogo de ejercicios + tags + `user_exercise_prefs` + seed ~120 ejercicios.
- Rutinas (registrar contador `routines` en `UsageCountersRegistry` y `@CheckLimit('routines')` en create).
- Decidir si funciones requieren email verificado.

## 2026-10-13 — BD de desarrollo: Atlas como opción principal

- Decisión: desarrollo local contra **MongoDB Atlas** (cluster/BD solo de dev, usuario `readWrite` acotado, IP propia en Network Access). Docker (`docker-compose.yml`) queda como alternativa offline/baja latencia.
- Sin cambios de código: `MONGODB_URI` ya acepta `mongodb+srv://`.
- Tests sin cambios: e2e siguen con `mongodb-memory-server`, nunca tocan Atlas.
- Pendiente (manual, `.env*` bloqueado para el agente): actualizar `.env.example` con la URI `mongodb+srv://` de ejemplo y la local comentada.

## 2026-10-12 — Base del backend (sin módulos de negocio)

### Hecho
- NestJS 12.1 + TypeScript 6.0 (strict + `noUncheckedIndexedAccess`), Mongoose 9 vía `@nestjs/mongoose` 12.
- `docker-compose.yml` con `mongo:8.0` (8.0 por paridad con Atlas).
- Config con `@nestjs/config` + validación zod (`src/config/env.schema.ts`), tipada con `ConfigService<Env, true>`.
- Prefijo global `/api/v1`, `ValidationPipe` global (whitelist, forbidNonWhitelisted, transform) → errores como `VALIDATION_ERROR` con `details: [{ field, constraints[] }]`.
- Filtro global `{ statusCode, code, message, details? }` con i18n (`nestjs-i18n`, `src/i18n/{es,en}`, fallback `es`, `Accept-Language` strict-loose: `en-US` → `en`).
- `AppException(code, status, { args, details })` + catálogo `ErrorCode`.
- Swagger en `/api/docs` (Bearer), `npm run openapi` → `openapi.json` (modo preview de Nest: sin BD).
- helmet, CORS por `CORS_ORIGINS`, `@nestjs/throttler` global (health excluido).
- `GET /api/v1/health` con `@nestjs/terminus` (ping Mongo, 503 si cae, detalle en `details`).
- `BaseSchema` / `UserOwnedSchema` / `baseSchemaOptions` / `notDeleted()`.
- ESLint 10 (type-checked) + Prettier, Jest 30: unit (env schema) + e2e (health up/down, i18n del sobre de error) con `mongodb-memory-server`.

### Verificación
- `npm run lint` ✅ · `npm run build` ✅ · `npm test` 4/4 ✅ · `npm run test:e2e` 4/4 ✅ (Node 24.21) · `npm run openapi` ✅
- Smoke test de `dist/main.js` contra Mongo en memoria: health 200, CORS, CSP de helmet, 404 traducido, Swagger UI ✅.
- **No verificado**: `docker compose up` (Docker Desktop no estaba corriendo).

### Decisiones y gotchas
- **TypeScript 6.0, no 7**: TS 7 (port nativo) no es soportado por typescript-eslint (`<6.1`), ts-jest (`<7`), @nestjs/swagger (`^5.5 || ^6`) ni @nestjs/cli (`~6.0.2`).
- **Nest 12 es ESM puro** (`@nestjs/core|common|mongoose|config|terminus` son `"type": "module"`). La app compilada (CJS) funciona por `require(esm)` (Node ≥ 22.12). Jest necesita **Node ≥ 24.9 + `--experimental-vm-modules`** (verificado: falla en 22.16, pasa en 24.21). Por eso `engines.node >= 24.9.0`.
- E2E: Mongo en memoria arranca en `test/global-setup.ts`; `MONGODB_URI` debe existir antes de importar `AppModule` porque `ConfigModule.forRoot` valida al importar. Mismo motivo para `src/openapi.env.ts` como primer import de `openapi.ts`.
- Sin plugin global de soft delete: `/sync/pull` necesita ver documentos borrados.
- Sync (futuro): last-write-wins usa el `updatedAt` del cliente; los timestamps de Mongoose lo pisan → escribir con `{ timestamps: false }`.
- Rutas fuera de `/api/v1` devuelven el 404 HTML de Express, no el sobre JSON.
- `npm audit`: `braces` (high) vía `nestjs-i18n → chokidar@3`, sin versión parcheada. Solo se usa si `loaderOptions.watch: true` y con patrones propios, no de usuario → no explotable aquí; `watch: false`. `sprintf-js` (moderate) solo en cadena dev de Jest.
- Swagger UI + CSP de helmet: el HTML sirve OK; no probado en navegador.

### Próximo
- Auth (registro, login, refresh con rotación, logout/logout-all, verificación email, recuperación) + guards JWT/roles.
- Users/perfil + `plans` + guard de entitlements.
- Seeds (`src/database/seeds`).
