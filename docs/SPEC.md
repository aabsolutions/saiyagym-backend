
# GymApp – Especificación maestra

## Visión
Plataforma multiusuario para planificar, registrar y analizar entrenamientos de
hipertrofia y powerlifting. Monetizable con planes Free y Premium.
- API: NestJS + MongoDB (repo gymapp-api), desplegada en Render, BD en MongoDB Atlas.
- Web: Angular (repo gymapp-web), en GitHub Pages. SOLO planificar y analizar
  (no registra sesiones en vivo).
- Móvil: Flutter (repo gymapp-mobile). Registro de sesiones en vivo, offline-first.
- Imágenes: Cloudinary (subida firmada desde la API).
- Referencia de UX: Hevy (registro de series) y Strong (pantalla de entreno mínima).
- Sin login social: solo email + contraseña.

## Roles
- user: gestiona sus propios datos.
- admin: gestiona catálogo de ejercicios, tiers, base nutricional, planes y usuarios.
- coach: RESERVADO para el futuro. Dejar el enum preparado, sin funcionalidad.

## Planes y monetización
- Colección `plans` editable por admin, con `entitlements` (límites y features).
- Free (valores iniciales, configurables): máx. 3 rutinas propias, 1 programa activo,
  10 ejercicios personalizados, estadísticas de los últimos 90 días, sin fotos de progreso,
  sin progresión automática.
- Premium: sin límites, estadísticas completas, progresión automática, fotos de progreso,
  sugerencias nutricionales completas, exportación CSV/JSON.
- La API decide siempre los permisos (guard de entitlements); los clientes solo ocultan UI.
- El usuario tiene `subscription { planId, status, currentPeriodEnd, provider }`.
  En esta versión NO se integra pasarela de pago: el admin asigna planes manualmente.
  Dejar una interfaz `PaymentProvider` para integrar después (Stripe en web,
  compras in-app vía RevenueCat en móvil).

## Idiomas (i18n)
- Iniciales: es (por defecto) y en. Añadir un idioma = añadir un archivo JSON, sin tocar código.
- Textos de interfaz: diccionarios JSON por cliente (`assets/i18n/es.json`, `en.json`).
- Contenido de BD (ejercicios, alimentos, sugerencias): campos traducibles como mapa
  `{ "es": "...", "en": "..." }`. Si falta el idioma pedido, usar `es`.
- Mensajes de error de la API: códigos estables (p. ej. `ROUTINE_LIMIT_REACHED`)
  + mensaje traducido según cabecera `Accept-Language`.

## Unidades
- Se guarda SIEMPRE en kg y cm. La conversión a lb/in es solo de presentación.
- Fechas en UTC (ISO 8601); el cliente muestra en la zona horaria del usuario.

## Módulos
1. Auth: registro, login, refresh token con rotación, logout, logout de todos los
   dispositivos, verificación de email, recuperación de contraseña.
2. Perfil y preferencias: nombre, fecha de nacimiento, sexo, altura, nivel
   (principiante/intermedio/avanzado), objetivo (hipertrofia/powerlifting/ambos),
   unidades, idioma, tema, descanso por defecto, primer día de la semana.
3. Catálogo de ejercicios: globales (seed + admin) y personalizados del usuario.
4. Rutinas (plantillas) y programas (rutinas en el tiempo, con progresión).
5. Sesiones (workouts): registro en móvil, consulta/edición en web.
6. Estadísticas y récords personales (PR).
7. Medidas corporales y fotos de progreso.
8. Nutrición: base de datos estática de sugerencias generales, administrable.
9. Administración: catálogo, tiers, nutrición, planes, usuarios.
10. Notificaciones: locales en móvil (descanso, recordatorios de entreno).

## Catálogo de ejercicios y tier list
- Campos: name (traducible), description/instructions (traducibles), primaryMuscle,
  secondaryMuscles[], equipment (barbell, dumbbell, machine, cable, bodyweight,
  kettlebell, band, smith, other), mechanic (compound/isolation),
  category (strength, powerlifting_main, accessory), imageUrl, tags[], isGlobal, ownerId.
- Tipo de registro: peso + repeticiones (único tipo en esta versión; dejar el campo
  `trackingType` preparado para tiempo o distancia en el futuro).
- Tier S/A/B/C POR OBJETIVO: `tiers: { hypertrophy: "S"|"A"|"B"|"C", powerlifting: ... }`,
  asignado por admin. Ejemplo: sentadilla trasera = S en powerlifting y S en hipertrofia;
  curl de concentración = C en powerlifting y B en hipertrofia.
- Cada usuario puede poner su propio tier personal POR OBJETIVO (hipertrofia/powerlifting, como el
  global; vacío = usa el global) y marcar favoritos (colección aparte).
- Etiquetas libres administrables (p. ej. "básico", "unilateral", "lumbar-friendly").
- Vistas: lista con filtros (músculo, equipo, tier, etiqueta, favoritos) y vista tablero
  tier list (columnas S, A, B, C) filtrable por grupo muscular y objetivo.
- Seed inicial: ~120 ejercicios comunes con traducción es/en, tiers y etiquetas,
  incluyendo las variantes de competición (sentadilla, press banca, peso muerto
  convencional y sumo) y sus accesorios típicos (pausa, pin, déficit, close grip...).

## Rutinas y programas
- Rutina: nombre, notas, ejercicios ordenados; por ejercicio: series objetivo,
  rango de reps (min-max), peso sugerido o %1RM, descanso (s), notas, groupId
  para superseries.
- Tipos de serie: warmup, normal, dropset, failure. Solo normal/dropset/failure
  cuentan para volumen y PR.
- Programa: nombre, duración en semanas, semanas con días -> rutina, semana de descarga.
- Progresión automática (Premium), reglas por ejercicio:
  - doble progresión: al completar el máximo del rango en todas las series, +X kg
    la próxima vez (X configurable, por defecto 2.5 kg compuestos, 1 kg aislados);
  - porcentaje de 1RM por semana (estilo powerlifting, p. ej. 70/75/80/85 %);
  - descarga: -Y % de peso o de series.
- Plantillas de programa globales creadas por admin (p. ej. PPL, Upper/Lower,
  Full Body, bloque de fuerza de 4 semanas), que el usuario puede copiar.

## Sesiones (workouts)
- Se crea en móvil desde rutina, desde el día del programa o en vacío.
- Por serie: type, weightKg, reps, completed, completedAt.
- Notas por ejercicio y por sesión; valoración 1-5; duración; volumen total.
- Mostrar en cada ejercicio las series de la última vez que se hizo.
- Calculadora de discos (barra 20 kg por defecto, discos configurables).

## Estadísticas y PR
- 1RM estimado (Epley): peso x (1 + reps / 30), solo para series de 1 a 12 reps.
- Tipos de PR: mayor peso, mejor 1RM estimado, más reps con un peso dado,
  mayor volumen de un ejercicio en una sesión.
- Al guardar una sesión, la API detecta PR y los devuelve en la respuesta.
- Gráficas: evolución por ejercicio, volumen semanal por grupo muscular
  (series efectivas y kg), frecuencia, racha, adherencia al programa,
  total powerlifting (sentadilla + banca + muerto) y su evolución.

## Medidas corporales
- Peso, % grasa, cintura, pecho, cadera, brazo, muslo, pantorrilla, cuello (cm).
- Fotos de progreso (Premium): Cloudinary, carpeta privada por usuario,
  vistas frontal/lateral/espalda, comparador antes/después.

## Nutrición (sugerencias generales, NO consejo médico)
- Base estática administrable, todo traducible:
  - foods: nombre, categoría, kcal/proteínas/carbohidratos/grasas por 100 g, etiquetas
    (vegano, sin gluten...).
  - mealSuggestions: comidas tipo (desayuno, pre-entreno, post-entreno, cena...)
    con alimentos y cantidades, por objetivo (volumen, definición, mantenimiento).
  - guidelines: artículos breves por objetivo (proteína diaria orientativa,
    hidratación, timing).
- Calculadora orientativa de calorías (Mifflin-St Jeor x factor de actividad) y
  reparto de macros por objetivo. Siempre con aviso visible: "orientativo, consulta
  con un profesional".
- Free: guías y calculadora. Premium: todas las sugerencias de comidas.
- Sin registro diario de comidas en esta versión.

## Modelo de datos (colecciones MongoDB)
- users, refresh_tokens, plans
- exercises, user_exercise_prefs (favorito + tier personal por objetivo), tags
- routines (ejercicios y series objetivo EMBEBIDOS)
- programs, program_templates
- workouts (ejercicios y series EMBEBIDOS; ref a routineId/programId)
- personal_records (precalculados)
- body_metrics, progress_photos
- foods, meal_suggestions, nutrition_guidelines
- Todos los documentos de usuario: _id (UUID generado en cliente cuando aplique),
  userId, createdAt, updatedAt, deletedAt (borrado lógico, necesario para la sincronización).
- Índices mínimos: workouts(userId, startedAt), workouts(userId, exercises.exerciseId),
  workouts(userId, updatedAt), personal_records(userId, exerciseId).

## Sincronización (móvil offline-first)
- El móvil genera los ids (UUID v4) y guarda en local primero.
- Endpoints: POST /sync/push (lote de cambios) y GET /sync/pull?since=<timestamp>.
- Conflictos: gana el `updatedAt` más reciente (last write wins), por documento.
- Los borrados se sincronizan con `deletedAt`.

## No funcionales
- Registrar una serie: máximo 2 toques.
- La sesión en curso sobrevive al cierre de la app.
- Seguridad: bcrypt/argon2, rate limiting en auth, helmet, CORS limitado a los dominios
  de la web, validación estricta de DTO, cada usuario solo accede a sus datos.
- Responsive en web; tema claro/oscuro en web y móvil.
- Tests: nivel básico (servicios clave y flujos principales).
- Conventional commits; README con cómo arrancar en local.