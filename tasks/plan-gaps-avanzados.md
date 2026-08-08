# Implementation Plan: Cierre de Gaps Avanzados — Grupo Restaurantero (B)

## Overview

Cerrar las **tres brechas** detectadas en la investigación de `@app/dashboard/` que **no** cubría `tasks/plan-grupo-restaurantero.md` (que ya entregó dashboard ejecutivo, predicciones, benchmarking, WhatsApp, portal externo):

1. **Playbooks corporativos con versionado y publicación a N sucursales** — el núcleo de "el grupo define, las sucursales ejecutan". Hoy `corporateTwins.playbookCount` está fijo en `0` y hay un comentario "Sprint 3 manual playbook CRUD".
2. **Tiering por tamaño de cliente (3-5 vs 6-15 sucursales)** — hoy no hay `subscription_tiers`, `company_subscriptions` ni `TierService`; el onboarding/distinction se trata igual para todos.
3. **Morning Brief del grupo** — la rutina diaria del CEO (diseño §19 y Executive OS v2 §8.5/§9). No existe.

Fuentes de verdad: `docs/pulso-executive-os-v2.md` (§8.5, §8.6, §9, §10) y `docs/pulso-diseno-grupo-restaurantero.md` (§7 gobernanza, §16 empaquetado por tamaño, §22 dashboard ejecutivo).

**Filosofía vertical:** cada fase entrega valor usable y deja el sistema compilando. Primero la **base** (feature-flag/tier) porque playbook y brief respetan la visibilidad de sucursal y la clasificación de datos; luego **playbooks** (crea el recurso de memoria del grupo); al final **Morning Brief** (consume tier + playbook + twin para producir el momento diario del dueño).

## Architecture Decisions

- **AD-1 — Tier definido por `max_branches`, no por cargo.** El tier se deriva del número de sucursales reales de la compañía (`branches`), además de almacenarse en `company_subscriptions`. La flag de features se lee contra una matriz estática `TIER_FEATURES` (copiada de ES v2 §10.2). *Rationale:* un grupo de 4 no paga por features de 15; el frontend esconde/deshabilita según el tier activo sin romper rutas.
- **AD-2 — Playbook = `workflowTemplates` con `scope`, gobernado desde el Builder existente.** Se añade el campo `scope: 'company'|'branch'` (default `'branch'`) a `workflowTemplates` para distinguir template corporativo reutilizable vs copia localizada a sucursal. El **editor existente** (`app/dashboard/builder/editor/[id]/editor-client.tsx` + `WorkflowSettingsModal`) es el corazón: al guardar, el usuario elige "Aplicar a todas las sucursales" (scope=company) o "Sucursales específicas" (selector multi → se crean copias branch-scoped). `company/playbooks` queda como **listado/administración** (qué hay publicado, a qué sucursales, versionado), no como editor duplicado. `templates/` (JSON estáticos) sigue siendo el catálogo maestro que siembra `workflow_templates`. `corporateTwins.playbookCount` deriva de los templates con `scope='company'`. *Rationale:* cero duplicación de motor; el Director de Ops usa una sola superficie de edición; la UI del Builder ya carga `templateLibrary` de `@/templates` y guarda vía `PATCH /api/templates/[id]` (hoy solo name/steps/description — se extiende con scope/branchIds).
- **AD-3 — Morning Brief es un documento derivado, no una consulta ad-hoc.** Un Inngest cron diario (07:00) recalcula el Executive Twin y los 8 engines, genera el brief JSON estructurado y lo persiste en `morning_briefs`, y se entrega por WhatsApp/Email/In-App (réplica del patrón `weekly-insights.ts`). El frontend lee la última fila. *Rationale:* determinista, cacheable, el patrón ya está probado; no bloquear el render de la página en cálculos pesados.
- **AD-4 — RBAC y clasificación se respetan en las 3 features.** Playbooks publicados usan `branchVisibilityFilter`; el Morning Brief y el tier nunca cruzan el filtro de franquicia. Usar `requirePermissionApi` y las clasificaciones `FINANCIAL/SENSITIVE` donde corresponda (igual que `/api/executive/twin`).

## Dependency Graph

```
subscription schema (subscription.ts)
   ├─ TierService + tier-feature gate
   │     ├─ API /api/company/subscription + UI tier/usage banner
   │     └─ gate el acceso a features en rutas (middleware-lite) y onboarding
   ├─ playbooks schema (playbooks + playbook_versions)
   │     ├─ scope='company' en workflow_templates + selector en Builder/editor
   │     ├─ PlaybookService (publish-to-branches + versionado + backfill count)
   │     └─ UI: company/playbooks (listado + estado por sucursal)
   └─ morning_briefs schema
         ├─ MorningBriefGenerator + generate-morning-brief cron
         ├─ API /api/executive/brief/latest|history
         └─ UI morning-brief.tsx (sección 0 del dashboard ejecutivo)
```

## Task List

### Phase 1 — Tiering: base (flags + subscription)

- [ ] **T1 — Schema de suscripciones y tiers.** Nuevo `lib/db/schema/subscription.ts`: `subscription_tiers`, `company_subscriptions` (copiar shape exacta de ES v2 §10.1), exportar en `lib/db/schema/index.ts`. Seed inicial (3 rows: `foundation`/max 5, `growth`/max 15, `executive`/max 50) en `scripts/` o migration trivial. *Files: `lib/db/schema/subscription.ts` (new), `lib/db/schema/index.ts` (edit), `scripts/seed-subscription-tiers.ts` (new). Size M.*
- [ ] **T2 — `TierService` + matriz de features.** Nuevo `lib/services/tier-service.ts`: `TIER_FEATURES` (Foundation/Growth/Executive per ES v2 §10.2), `getCompanyTier(companyId)` (resuelve por `branches.length` con fallback a `company_subscriptions`), `hasFeature(companyId, feature)`, `getFeatureGate`. TTL cache. *Files: `lib/services/tier-service.ts` (new). Size S.*
- [ ] **T3 — API de suscripción + gate.** `app/api/company/subscription/route.ts` (GET tier+features; POST admin up/down tier; PATCH status). `app/api/company/features/route.ts` (GET lista features activas + reason). *Files: `app/api/company/subscription/route.ts` (new), `app/api/company/features/route.ts` (new). Size M.*
- [ ] **T4 — UI Tier + banner de features.** `components/company/tier-banner.tsx` (muestra el tier activo, sucursales vs límite, features bloqueadas con "Upgrade"' CTA). Integrar en `app/dashboard/company/` (settings). Deshabilitar visualmente features fuera del tier sin romper navegación. *Files: `components/company/tier-banner.tsx` (new), `app/dashboard/company/page.tsx` (edit). Size S.*

### Checkpoint 1 (T1–T4)
- [ ] `pnpm run build` clean
- [ ] `pnpm db:generate` produce SOLO `CREATE TABLE subscription_tiers/company_subscriptions` (sin DROP)
- [ ] Seed aplica los 3 tiers; `TierService.getCompanyTier` devuelve correcto para 3/8/20 sucursales
- [ ] `/api/company/subscription` GET retorna tier+features; banner muestra límites y gatea features
- [ ] Manual: subir tier y ver el banner / features desbloquear

### Phase 2 — Playbooks corporativos (definir una vez, publicar a N)

- [ ] **T5 — Campo `scope` en `workflowTemplates`.** Extender `lib/db/schema.ts` (tabla `workflowTemplates`): añadir `scope: text('scope').default('branch').notNull()` (`'company'|'branch'`). Migración segura (`ALTER TABLE ADD COLUMN`, probar en Neon branch antes). *Files: `lib/db/schema.ts` (edit). Size XS.*
- [ ] **T6 — `PlaybookService` (publish-to-N + backfill count).** Nuevo `lib/services/playbook-service.ts`: `publish(templateId, branchIds)` → para cada `branchId` UPSERT de `workflowTemplate` copiado (id determinista `(templateId, branchId)`, `scope='branch'`, `originalTemplateId=source`); `rollbackScope(templateId)` (publicar a TODAS → `scope='company'`, sin copias); `reconcile(companyId)` → setea `corporateTwins.playbookCount` = count de templates `scope='company'`; `listPublished(companyId)` → qué sucursales tienen copias de cada template. *Files: `lib/services/playbook-service.ts` (new). Size L → descomponer en T6a (publicar/despublicar puntual) y T6b (reconcile + listPublished + contador).*
  - **T6a — publish/rollback puntual.** Métodos por sucursal, UPSERT idempotente, `originalTemplateId` como fuente de verdad. *Size M.*
  - **T6b — reconcile + contador.** Reconciliar copias, backfill `playbookCount`, listar publicaciones por sucursal. *Size M.*
- [ ] **T7 — Extender PATCH de plantilla + API playbooks.** `app/api/templates/[id]/route.ts` (edit): aceptar `scope` y `branchIds` en el body y delegar a `PlaybookService`. Nuevas APIs de listado: `app/api/playbooks/route.ts` (GET list publicados + estado por sucursal) y `app/api/playbooks/[id]/route.ts` (GET detalle/versiones). Guards `requirePermissionApi('workflow','manage')` con ownership companyId. *Files: `app/api/templates/[id]/route.ts` (edit), `app/api/playbooks/*.ts` (new). Size M.*
- [ ] **T8 — UI: selector de alcance en el Builder + listado `company/playbooks`.** (a) `components/builder/workflow-settings-modal.tsx` (edit): bloque "Aplicar a"; dos opciones "🌐 Todas las sucursales (scope=company)" / "🏬 Sucursales específicas" + selector multi-sucursal (usa `useBranch`/`useBranches`), enviar `scope`/`branchIds` en el PATCH. (b) `app/dashboard/company/playbooks/page.tsx` (new) + `components/company/playbooks/playbook-list.tsx` (new): listado de playbooks/templates company-wide, estado por sucursal (dónde está publicado), vínculo en `components/app-sidebar.tsx` (edit). *Files: `components/builder/workflow-settings-modal.tsx` (edit), `app/dashboard/company/playbooks/*` (new), `components/company/playbooks/` (new), `components/app-sidebar.tsx` (edit). Size L → descomponer T8a (modal+selector) / T8b (listado).*

### Checkpoint 2 (T5–T8)
- [ ] `pnpm run build` clean
- [ ] `pnpm db:generate` añade SOLO la columna `scope` a `workflow_templates` (sin DROP)
- [ ] Publicar "Sucursales específicas" → N sucursales reciben su copia `branchId=<target>`; `playbookCount` >0 en twin
- [ ] Publicar v2 del mismo template → las copias en sucursales se actualizan en cascada
- [ ] Seleccionar "Todas las sucursales" en el editor → el template queda `scope='company'` sin copias
- [ ] Ver FRANQUICIA: sucursal objetivo ve el playbook publicado; una fuera de alcance no lo ve
- [ ] `company/playbooks` lista por template el estado por sucursal

### Phase 3 — Morning Brief del grupo (rutina diaria del CEO)

- [ ] **T9 — Schema morning_briefs.** Nueva tabla en `lib/db/schema/operational-twin.ts` o `lib/db/schema/intelligence.ts`: `morning_briefs` (id, companyId, brief jsonb, generatedAt, deliveredAt, twinSnapshot jsonb). *Files: `lib/db/schema/operational-twin.ts` (edit) o archivo nuevo. Size S.*
- [ ] **T10 — `MorningBriefService`.** Nuevo `lib/services/morning-brief-service.ts`: `generate(companyId)` → KPIs del día (compliance, merma, ventas, laboral, cash), 3 prioridades accionables (usa los engines) y resumen de variaciones vs ayer + la `ExecutiveTwin`; expone `getLatest`, `getHistory`, `getTwinSnapshot`. *Files: `lib/services/morning-brief-service.ts` (new). Size M.*
- [ ] **T11 — Cron `generate-morning-brief`** (Inngest). `lib/inngest/functions/generate-morning-brief.ts`: cron `0 7 * * *`, para cada compañía con el feature `morning_brief` activo → `step.run` recalcula twin + genera brief + lo persiste + entrega (réplica del patrón `weekly-insights.ts`). Registrar en `lib/inngest/functions/index.ts`. *Files: `lib/inngest/functions/generate-morning-brief.ts` (new), `lib/inngest/functions/index.ts` (edit). Size M.*
- [ ] **T12 — API brief.** `app/api/executive/brief/latest/route.ts` (GET), `app/api/executive/brief/history/route.ts` (GET), `app/api/executive/feed/route.ts` (GET items prioritarios). Guards `requirePermissionApi('reports','read')`. *Files: `app/api/executive/brief/*.ts`, `app/api/executive/feed/route.ts` (new). Size S.*
- [ ] **T13 — UI «Sección 0» del dashboard ejecutivo.** `app/dashboard/executive/page.tsx` (edit): insertar `<MorningBrief companyId>` arriba. Componente `components/dashboard/morning-brief.tsx` (Suspense con KpiCardsSkeleton; KPIs de hoy + 3 prioridades con `actionUrl` + resumen ayer). *Files: `components/dashboard/morning-brief.tsx` (new), `app/dashboard/executive/page.tsx` (edit). Size M.*
- [ ] **T14 — (Opcional, post-MVP) `reasonAbout`** en `lib/services/intelligence-service.ts`: método nuevo que carga twin + engines + respuesta con LLM estructurado y fuentes (engineId+score). Extiende sin romper `answerQuestion`. Si la feature `ai_copilot` del tier no está activa, se degrada a resumen heurístico. *Files: `lib/services/intelligence-service.ts` (edit), `app/api/executive/reason/route.ts` (new). Size L → descomponer T14a (servicio) / T14b (API+UI).*

### Checkpoint 3 (T9–T14)
- [ ] `pnpm run build` clean
- [ ] Cron diario genera `morning_brief` por compañía; latest/history legibles y cacheables
- [ ] El brief del dashboard ejecutivo muestra 3+ una prioridad accionable con enlace real
- [ ] Entrega WhatsApp/Email/In-App replicando `weekly-insights.ts`
- [ ] `reasonAbout` (opcional) responde con fuentes de engines si el tier tiene la feature

## Checkpoints principales
- **[ ] T1–T4:** tier resuelve por número de sucursales, flags geatean la UI, build limpio
- **[ ] T5–T8:** playbook definido una vez se publica a N sucursales y el backfill escribe `playbookCount`; FRANQUICIA respeta visibilidad
- **[ ] T9–T14:** brief diario del twin generado y consumible; el dashboard ejecutivo inicia con el "momento CEO"

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| El tier se calcula por `branches.length` pero el dato puede estar incompleto en clientes existentes | Med | merge `company_subscriptions` como overwrite; `getCompanyTier` cae a count con fallback; documentar en seed |
| Publicar playbook crea filas de `workflowTemplate` duplicadas por sucursal — colisiones sin id determinista | High | id determinista `(templateId, branchId)` + UPSERT `originalTemplateId=source`; migración idempotente; reconcile periódico borra copias huérfanas |
| `corporateTwins` migración (12+ columnas ADD) | Med | Procedimiento safe en ES v2 §6.1: solo `ALTER TABLE ADD COLUMN`, probar en Neon branch antes |
| Morning brief sin prioridades si los 8 engines aún no generan | Med | `brief` se genera con KPIs reales + heurística; los engines hacen fallback al `corporateTwin` más reciente; no bloquear si falta un engine |
| El cron nuevo no se registra y no aparece en dev | Baja | registrar en `lib/inngest/functions/index.ts`; `INNGEST_DEV=1` para probar local; log de startup no fatal |

## Open Questions
- ¿El tier afecta el **precio real** o solo el gateo de UI? (MVP: solo gateo; el billing real queda para otra sprint.)
- ¿El Playbook se gestiona también en el `Builder` existente (single template) o solo en `company/playbooks`? **(Resuelto:** editor del Builder como única superficie de edición; `company/playbooks` como listado/administración.)
- ¿El Morning Brief corre por **cada** sucursal o solo a nivel grupo (single pane)? (MVP: grupo; el detalle por sucursal queda en el historial.)