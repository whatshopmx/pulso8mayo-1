# Plan de Implementación: Módulo de Desempeño (Performance)

## Overview

Reparación integral del módulo `app/dashboard/performance` surgida de la crítica (`$impeccable critique`, score 17/40). El módulo luce coherente con el sistema de diseño pero tiene fallas funcionales de fondo: el scoring por criterios se descarta en el envío, las rutas de edición no existen, la búsqueda no funciona, los KPIs se calculan sobre la primera página (mienten con >20 registros), las páginas de detalle dan "no encontrado" falso para registros antiguos, y la analítica muestra datos fabricados. Se agrega una vista por persona (pregunta abierta #1), signals de vencimiento, consistencia de naming/paleta, accesibilidad y notificaciones WhatsApp (pregunta abierta #3).

## Arquitectura Decisions

- **El tenant SIEMPRE viene de la sesión** (`withTenantAuth`). Los parámetros `companyId=`/`companyId=all` del cliente son decorativos; se eliminan del cliente y se usa el scoping existente (no hay cambio de seguridad).
- **Persistencia de criterios usa las tablas existentes** `performance_review_criteria` y `performance_review_responses` (ya están en `lib/db/schema.ts:2027-2060`, sin usar). No se agregan columnas a `performance_reviews`; posibles migraciones solo si las tablas no existen en Neon.
- **Rating general derivado**: cuando el envío incluye `criteriaRatings`, el servidor calcula el promedio ponderado (usando `weight` de cada criterio) y lo escribe en `overallRating`, salvo que el formulario envíe un override manual explícito. El formulario muestra vista previa en vivo del ponderado.
- **Endpoint único de stats** (`GET /api/performance/stats`) con `count(*)` agrupado por status: mata la mentira de KPIs de raíz y es la fuente única de verdad para dashboard y vista por persona. Incluye `trend` (promedio de rating + conteo de completadas por `reviewPeriod`) que alimenta la gráfica real o el estado vacío honesto.
- **Detalles por id**: `GET /api/performance/reviews?id=X` y `GET /api/performance/goals?id=X` (el PATCH ya soporta `?id=`); las páginas `[id]` dejan de fetchear listas y filtrar en cliente.
- **Naming unificado en español**: "Desempeño" (cabecera principal), "Evaluaciones" y "Objetivos" (tabs y nav), "Analítica" (tab). Zero strings en inglés en el módulo.
- **Paleta**: estrellas y gráfica usan los tokens de DESIGN.md (`chart-1..5`, `muted`, `primary`); se eliminan `fill-yellow-400`, `text-gray-300`, `#8884d8`, `#82ca9d`.
- **Vista por persona**: ruta `/dashboard/performance/personas/[id]` (cliente, consistente con el resto del módulo) reutilizando los filtros `userId` que ya soportan ambos GET; los nombres en listas y detalles se vuelven enlaces a esa vista.
- **WhatsApp (fase diferida)**: reutiliza `NotificationService.sendWhatsAppNotification(userId, message)` (respeta prefs y teléfono) y el patrón de crons Inngest existente (`lib/inngest/functions/`).

## Task List

### Phase 1: Integridad de datos (P0 de la crítica)

- [ ] **Task 1 (M): API — Persistir respuestas de criterios + rating ponderado**
  - `app/api/performance/reviews/route.ts`: `createReviewSchema` extiende con `criteriaRatings: [{ criteriaId, rating 1-5, comments? }]`; POST inserta en `performanceReviewResponses` y calcula `overallRating` ponderado; PATCH reemplaza respuestas (delete+insert por reviewId) y actualiza rating si vienen criterios; GET incluye `criteriaResponses` (join con nombre/categoría/weight del criterio).
  - Verificar primero que `performance_review_responses` existe en la DB (`pnpm db:generate`/`db:migrate` si falta).

- [ ] **Task 2 (M): UI — Form envía criterios, muestra ponderado y detalle los pinta**
  - `components/performance/review-form.tsx`: incluir `criteriaRatings` en el body; vista previa del promedio ponderado en vivo junto a la calificación general.
  - `app/dashboard/performance/reviews/[id]/page.tsx`: renderizar tarjeta "Criterios de Evaluación" con rating por criterio, comentarios, peso y promedio ponderado.

- [ ] **Task 3 (S): API — Corregir reviewerName y soportar GET por id**
  - `app/api/performance/reviews/route.ts`: segundo `leftJoin` en `reviewerId` para `reviewerName` (hoy devuelve el nombre del empleado).
  - `app/api/performance/reviews/route.ts` y `goals/route.ts`: rama `if (id)` que devuelve el registro único (404 si no existe).

- [ ] **Task 4 (M): Búsqueda real con debounce**
  - API: `search` con `ilike` sobre `users.name` (reviews) y `goal.title`/`userName` (goals), agregado a `conditions` vía `or`.
  - UI: `components/performance/review-list.tsx` y `goals-list.tsx` — debounce ~300ms del input de búsqueda (nuevo hook `hooks/use-debounced-value.ts`), feedback "Buscando..." mientras se filtra.

- [ ] **Task 5 (M): Rutas [id]/edit funcionales**
  - Crear `app/dashboard/performance/reviews/[id]/edit/page.tsx` y `goals/[id]/edit/page.tsx` (server, patrón de las páginas `new`) que cargan el registro vía GET por id de Task 3 y pasan `initialData` + `reviewId`/`goalId` a `ReviewForm`/`GoalForm` (los props ya existen).

### Checkpoint 1: Integridad
- [ ] Los criterios calificados aparecen en la API y en el detalle de la evaluación
- [ ] `overallRating` refleja el ponderado cuando hay criterios
- [ ] Los botones de edición navegan a páginas reales y persisten cambios
- [ ] La búsqueda filtra resultados reales
- [ ] El "Evaluador" muestra el nombre correcto
- [ ] `pnpm run build` y `pnpm run lint` limpios

### Phase 2: KPIs y analítica honestos (P1 + pregunta #4)

- [ ] **Task 6 (M): Endpoint de stats**
  - Nuevo `app/api/performance/stats/route.ts`: counts por status de reviews y goals, pendiente = IN_PROGRESS + DRAFT + SUBMITTED, rate de completado, total de empleados evaluados, y `trend` por `reviewPeriod` (avg rating, completadas) para la gráfica.

- [ ] **Task 7 (S): Dashboard con KPIs honestos**
  - `components/performance/performance-dashboard.tsx`: reemplazar el fetch y conteo en cliente por `stats`; "Sin datos" (—) cuando total = 0 en vez de "0%"; skeleton mientras carga.

- [ ] **Task 8 (S): Detalles que cargan por id**
  - `app/dashboard/performance/reviews/[id]/page.tsx` y `goals/[id]/page.tsx`: usar `?id=` de Task 3; eliminar `companyId=all` y el `.find()` en cliente; estado "no encontrado" solo cuando la API responde 404 real.

- [ ] **Task 9 (M): Analítica honesta**
  - `components/performance/performance-chart.tsx`: consumir el `trend` de stats; si hay <5 evaluaciones completadas en el período → estado vacío "Sin suficientes datos de evaluación para mostrar tendencias" (con el criterio exacto); con datos → gráfica con eje dual corregido (rating 0–5 vs conteo) o dos paneles, tooltip en español, colores `chart-1..5`, subtítulo "Promedio real de evaluaciones completadas".

### Checkpoint 2: Honestidad de números
- [ ] Los KPIs coinciden con `count(*)` real en DB con >20 registros
- [ ] Abrir enlace directo a una evaluación antigua muestra el registro
- [ ] La analítica muestra datos reales o el estado vacío honesto — nunca datos mock
- [ ] `pnpm run build` y `pnpm run lint` limpios

### Phase 3: Vista por persona (pregunta #1)

- [ ] **Task 10 (M): Página de persona + nombres enlazados**
  - Nueva `app/dashboard/performance/personas/[id]/page.tsx`: cabecera con nombre/rol, KPIs propios (rating promedio, metas activas/vencidas, evaluaciones completadas), sección "Metas" (con vencimiento) y "Evaluaciones" (históricas + pendientes), tablas enlazadas a sus detalles.
  - En `review-list.tsx` y `goals-list.tsx`: los nombres de empleado se vuelven `Link` a la vista de persona.

### Checkpoint 3: Vista por persona
- [ ] Desde una fila de la lista se llega a la persona y se ven metas + evaluaciones juntas
- [ ] `pnpm run build` limpio

### Phase 4: Señales y consistencia (menores de la crítica)

- [ ] **Task 11 (S): Metas vencidas visibles**
  - En `goals-list.tsx`, detalle de meta y vista de persona: si `targetDate < today` y status ∈ {NOT_STARTED, IN_PROGRESS} → badge "Atrasada" (tone destructive) y fecha en destructive.

- [ ] **Task 12 (M): Unificar naming y cabeceras**
  - `performance-dashboard.tsx`: H1 "Desempeño", tabs "Evaluaciones / Objetivos / Analítica", botón "Nueva Evaluación"; eliminar todos los strings EN del módulo (Performance Management, New Review, Completion Rate, Analytics, Average Rating, trend caption).
  - `app/dashboard/performance/reviews/page.tsx` y `goals/page.tsx`: H1s y subtítulos consistentes; `components/app-sidebar.tsx` "Metas" → "Objetivos" (y revisar botones "Nuevo" duplicados vs dashboard).

- [ ] **Task 13 (M): Paleta, select de período y toasts**
  - Estrellas (form + detalle): `fill-yellow-400`/`text-gray-300` → tokens (p. ej. `text-chart-1`/`fill-chart-1` activas, `text-muted` inactivas) — verificar que las clases token existen (mapeadas en `globals.css`).
  - Select de período: agrupar por tipo (Trimestres / Semestres / Anual) o preseleccionar el período actual.
  - Toast de cambio de status: usar labels traducidos ("Enviada", "Completada") en vez del enum crudo.
  - `goals/[id]/page.tsx`: reemplazar `confirm()` por `AlertDialog` del sistema; confirmar también "Cancelar Objetivo".

### Checkpoint 4: Coherencia
- [ ] Sin strings en inglés visibles en el módulo
- [ ] Sin colores hardcodeados fuera de tokens
- [ ] Las metas vencidas se identifican al primer vistazo
- [ ] `pnpm run build` y `pnpm run lint` limpios

### Phase 5: Accesibilidad (persona Sam)

- [ ] **Task 14 (M): A11y**
  - `aria-label` en botones de solo icono (Eye, Edit, back, Trash, star buttons) de listas, detalle y dashboard.
  - Estrellas con rol `radiogroup`/`radiobutton` + `aria-pressed` + foco visible.
  - Estados de carga con `aria-live="polite"` (reemplazar "Cargando..." plano).
  - Quitar emojis de los `CardTitle` del detalle ("✓ Fortalezas", "△ Áreas de Mejora", "📋 Plan de Desarrollo", "💬 Comentarios") por íconos de lucide + tokens.
  - Empty states con CTA (p. ej. "No hay evaluaciones — Crea tu primera evaluación") en listas; distinguir fallo de red de "sin datos".

### Checkpoint 5: Accesibilidad
- [ ] Flujo completo operable solo con teclado
- [ ] Sin emojis en headings
- [ ] `pnpm run build` y `pnpm run lint` limpios

### Phase 6: WhatsApp (pregunta #3 — palanca diferida)

- [ ] **Task 15 (S): Notificación de meta completada**
  - `app/api/performance/goals/route.ts` (PATCH): al pasar a `COMPLETED`, `NotificationService.sendWhatsAppNotification(goal.userId, "...meta completada...")` (respeta prefs y teléfono; no rompe si no hay teléfono).

- [ ] **Task 16 (M): Nudge de evaluaciones vencidas (cron)**
  - Nueva función Inngest en `lib/inngest/functions/` (patrón de `break-reminder`): diario, evaluaciones en DRAFT/IN_PROGRESS con `reviewDate`/vencimiento mayor a N días → WhatsApp/email al evaluador (`reviewerId`).

### Checkpoint final: Completo
- [ ] Todos los criterios de aceptación de las 16 tareas cumplidos
- [ ] Smoke test manual end-to-end (crear evaluación con criterios → ver detalle → editar → listar → persona → KPIs → analítica)
- [ ] `pnpm run build` y `pnpm run lint` sin errores
- [ ] Actualizar `PROJECT_CONTEXT.md` con el estado del módulo

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `performance_review_responses`/`criteria` no existen en Neon (schema sí, migración no) | Alto (T1) | Verificar antes de T1; `pnpm db:generate` + `db:migrate` (nunca `db:push` sin revisar) |
| Rating ponderado cambia el comportamiento del input manual de estrellas | Medio | Regla: ponderado por defecto cuando hay criterios; override manual explícito; vista previa en vivo en el form |
| La gráfica con doble eje malinterpreta la escala (rating 0–5 vs conteo 0–N) | Medio | Eje dual corregido o dos paneles separados; tooltip y subtítulo explícitos |
| Debounce nuevo hook sin patrón existente | Bajo | Hook simple `use-debounced-value` acotado al módulo; probar con `pnpm run dev` |
| Notificaciones WhatsApp dependen de teléfono/prefs del usuario | Bajo | `sendWhatsAppNotification` ya degrada con log si no hay teléfono; la fase 6 es la última |
| Clases token de color (`text-chart-1`) no mapeadas como utility | Bajo | Verificado: `--color-chart-1..5` están en `globals.css` (líneas 19-23) |

## Open Questions

- **Q1 (rating):** ¿El promedio ponderado de criterios reemplaza el input manual de estrellas, o se mantiene el manual como override? (Plan: override manual explícito, ponderado por defecto.)
- **Q2 (alcance):** ¿La fase 6 (WhatsApp) se implementa en esta pasada o queda como backlog? (Plan: diferida al final, ejecutable por separado.)
- **Q3 (rutas standalone):** ¿Se mantienen `/reviews` y `/goals` como entradas del sidebar (sí) — solo se unifica naming, correcto?
- **Q4 (búsqueda):** ¿El buscador de evaluaciones debe cubrir también `reviewPeriod` o solo nombre del empleado? (Plan: nombre del empleado; extensible luego.)

## Referencia

- Crítica persistida: `.impeccable/critique/2026-08-10T16-09-22Z__app-dashboard-performance.md`
- Schema: `lib/db/schema.ts:1991-2074` (reviews, criteria, responses, goals)
- Auth: `lib/api/with-auth.ts` — tenant siempre de sesión
- Notificaciones: `lib/services/notification-service.ts:248` (`sendWhatsAppNotification`)