# TODO — Módulo de Desempeño (Performance)

> Plan completo: `tasks/plan-performance.md` · Crítica: `.impeccable/critique/2026-08-10T16-09-22Z__app-dashboard-performance.md`

## Phase 1: Integridad de datos (P0)

- [x] **Task 1 (M): API — Persistir respuestas de criterios + rating ponderado**
  - `app/api/performance/reviews/route.ts`: schema `criteriaRatings`; POST inserta `performanceReviewResponses`; PATCH reemplaza; GET devuelve `criteriaResponses` (con nombre/categoría/weight)
  - Verificar existan las tablas en Neon (`pnpm db:generate`/`db:migrate` si falta)

- [x] **Task 2 (M): UI — Form envía criterios + ponderado + detalle los pinta**
  - `components/performance/review-form.tsx`: enviar `criteriaRatings`; vista previa del promedio ponderado en vivo
  - `app/dashboard/performance/reviews/[id]/page.tsx`: tarjeta de criterios con rating, comentarios, peso, ponderado

- [x] **Task 3 (S): API — Corregir reviewerName + GET por id**
  - `reviews/route.ts`: segundo `leftJoin` en `reviewerId` para `reviewerName`
  - `reviews/route.ts` y `goals/route.ts`: `if (id)` → registro único / 404

- [x] **Task 4 (M): Búsqueda real con debounce**
  - API: `ilike` sobre `users.name` (reviews) y título (goals)
  - UI: `hooks/use-debounced-value.ts` nuevo; `review-list.tsx` y `goals-list.tsx` con debounce ~300ms y "Buscando..."

- [x] **Task 5 (M): Rutas [id]/edit funcionales**
  - Crear `reviews/[id]/edit/page.tsx` y `goals/[id]/edit/page.tsx`
  - Cargar vía GET por id (T3) → `initialData` + `reviewId`/`goalId` a los forms (props ya existen)

### ✅ Checkpoint 1: Criterios en API y detalle · rating ponderado · edit funcional · búsqueda filtra · evaluador correcto · build/lint limpios

## Phase 2: KPIs y analítica honestos (P1)

- [x] **Task 6 (M): Endpoint de stats** — nuevo `app/api/performance/stats/route.ts`: counts por status, pendiente (incl. SUBMITTED), rate, empleados evaluados, `trend` por `reviewPeriod`

- [x] **Task 7 (S): Dashboard con KPIs honestos** — `performance-dashboard.tsx` consume stats; "Sin datos" (—) con total 0; skeleton

- [x] **Task 8 (S): Detalles por id** — `reviews/[id]/page.tsx` y `goals/[id]/page.tsx` usan `?id=`; eliminar `companyId=all` y `.find()`; 404 solo real

- [x] **Task 9 (M): Analítica honesta** — `performance-chart.tsx`: `trend` real; <5 completadas → "Sin suficientes datos"; eje dual corregido, tooltip ES, colores `chart-1..5`

### ✅ Checkpoint 2: KPIs = conteo real (probar >20 registros) · enlace directo a registros antiguos · cero datos mock · build/lint limpios

## Phase 3: Vista por persona

- [x] **Task 10 (M): Página de persona + nombres enlazados**
  - Nueva `personas/[id]/page.tsx`: KPIs propios, metas + evaluaciones juntas, tablas enlazadas
  - Nombres en `review-list.tsx` y `goals-list.tsx` → `Link` a persona

### ✅ Checkpoint 3: De una fila se llega a la persona con metas+evaluaciones · build limpio

## Phase 4: Señales y consistencia

- [x] **Task 11 (S): Metas vencidas** — badge "Atrasada" (destructive) cuando `targetDate < today` y no completada, en lista, detalle y persona

- [x] **Task 12 (M): Naming unificado ES** — "Desempeño / Evaluaciones / Objetivos / Analítica" en dashboard, tabs, páginas standalone y sidebar ("Metas"→"Objetivos"); cero strings EN en el módulo

- [x] **Task 13 (M): Paleta + período + toasts** — estrellas con tokens (`chart-1`/`muted`); período agrupado o período actual por defecto; toast con labels ES; `confirm()` → `AlertDialog` (delete y cancelar objetivo)

### ✅ Checkpoint 4: Sin EN visible · sin colores hardcodeados · vencidas visibles al primer vistazo · build/lint limpios

## Phase 5: Accesibilidad

- [x] **Task 14 (M): A11y** — `aria-label` en botones de ícono; estrellas con `radiogroup`/`aria-pressed`; `aria-live` en cargas; quitar emojis de headings (íconos lucide); empty states con CTA; distinguir fallo de red de "sin datos"

### ✅ Checkpoint 5: Flujo completo solo-teclado · sin emojis en headings · build/lint limpios

## Phase 6: WhatsApp (diferida)

- [x] **Task 15 (S): Meta completada → WhatsApp** — en `goals/route.ts` PATCH, `NotificationService.sendWhatsAppNotification(userId, ...)`

- [x] **Task 16 (M): Nudge evaluaciones vencidas** — función Inngest diaria (patrón break-reminder): DRAFT/IN_PROGRESS vencidas → WhatsApp/email al evaluador

### ✅ Checkpoint final: 16/16 criterios · smoke test E2E manual · build/lint · `PROJECT_CONTEXT.md` actualizado