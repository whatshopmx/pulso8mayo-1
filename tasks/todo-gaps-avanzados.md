# Cierre de Gaps Avanzados — Grupo Restaurantero — Task List

> Fuentes: `docs/pulso-executive-os-v2.md` (§8.5, §9, §10) y `docs/pulso-diseno-grupo-restaurantero.md` (§7, §16, §22). Plan completo en `tasks/plan-gaps-avanzados.md`. Marca con `[x]` al verificar.

> **Estado (2026-08-07):** T1–T14 implementados. Migración única `drizzle/0035_gaps-avanzados.sql` (solo CREATE/ADD COLUMN). Desviaciones registradas al final del archivo.

## Phase 1 — Tiering: base (flags + subscription)

- [x] **T1** Schema suscripciones: `lib/db/schema/subscription.ts` (new) — `subscription_tiers`, `company_subscriptions` (shape ES v2 §10.1); exportar en `lib/db/schema/index.ts`; seed 3 tiers (`foundation`/5, `growth`/15, `executive`/50) en `scripts/seed-subscription-tiers.ts` (new). *Size M. Deps: None.*
- [x] **T2** `lib/services/tier-service.ts` (new) — `TIER_FEATURES`, `getCompanyTier` (resolve por `branches.length` + overwrite `company_subscriptions`), `hasFeature`, `getFeatureGate`. TTL cache. *Size S. Deps: T1.*
- [x] **T3** APIs `app/api/company/subscription/route.ts` (new) + `app/api/company/features/route.ts` (new). *Size M. Deps: T2.*
- [x] **T4** `components/company/tier-banner.tsx` (new) + integración en `app/dashboard/company/page.tsx` (edit); gateo visual de features sin romper rutas. *Size S. Deps: T3.*

### Checkpoint 1 (T1–T4)
- [ ] `pnpm run build` clean
- [ ] `pnpm db:generate` produce SOLO `CREATE TABLE subscription_tiers/company_subscriptions` (sin DROP)
- [ ] `TierService.getCompanyTier` → 3/8/20 sucursales devuelven foundation/growth/executive
- [ ] Banner muestra tier, sucursales vs límite, features gateadas con CTA Upgrade
- [ ] Manual: subir tier → features se desbloquean

## Phase 2 — Playbooks corporativos (definir una vez, publicar a N)

- [x] **T5** Campo `scope: 'company'|'branch'` en `workflowTemplates` (`lib/db/schema.ts` edit) — `scope: text('scope').default('branch').notNull()`. Migración solo `ALTER TABLE ADD COLUMN`. *Size XS. Deps: None.*
- [x] **T6a** `lib/services/playbook-service.ts` (new) — `publish(templateId, branchIds)`: UPSERT por sucursal de `workflowTemplate` copiado (id determinista `(templateId, branchId)`, `scope='branch'`, `originalTemplateId=source`); `rollbackScope(templateId)` → scope='company' sin copias. *Size M. Deps: T5.*
- [x] **T6b** `lib/services/playbook-service.ts` (extender) — `reconcile(companyId)` → `corporateTwins.playbookCount` = count de templates `scope='company'`; `listPublished(companyId)` → estado por sucursal. *Size M. Deps: T6a.*
- [x] **T7** `app/api/templates/[id]/route.ts` (edit) acepta `scope`/`branchIds` y delega a `PlaybookService`; + `app/api/playbooks/route.ts` y `app/api/playbooks/[id]/route.ts` (listado/detalle). Guard `requirePermissionApi('workflow','manage')` + ownership companyId. *Size M. Deps: T6b.*
- [x] **T8** UI: (a) bloque "Aplicar a" (🌐 Todas / 🏬 Sucursales específicas multi-select) en `components/builder/workflow-settings-modal.tsx` (edit) + envío de `scope`/`branchIds` en el PATCH; (b) listado `app/dashboard/company/playbooks/page.tsx` + `components/company/playbooks/playbook-list.tsx` (new) + link en `components/app-sidebar.tsx` (edit) — estado por sucursal. *Size L → T8a modal / T8b listado. Deps: T7.*

### Checkpoint 2 (T5–T8)
- [ ] `pnpm run build` clean
- [ ] `pnpm db:generate` añade SOLO la columna `scope` a `workflow_templates` (sin DROP)
- [ ] Publicar "Sucursales específicas" → N sucursales reciben su copia `branchId=<target>`; `playbookCount` >0
- [ ] Publicar v2 del mismo template → las copias se actualizan en cascada
- [ ] "Todas las sucursales" en el editor → template `scope='company'` sin copias
- [ ] FRANQUICIA: sucursal en alcance ve el playbook; fuera de alcance no lo ve
- [ ] `company/playbooks` lista por template el estado por sucursal

## Phase 3 — Morning Brief del grupo

- [x] **T9** Schema `morning_briefs` (id, companyId, brief jsonb, twinSnapshot jsonb, generatedAt, deliveredAt) en `lib/db/schema/operational-twin.ts` (edit) o archivo nuevo. *Size S. Deps: None.*
- [x] **T10** `lib/services/morning-brief-service.ts` (new) — `generate(companyId)`, `getLatest`, `getHistory`, `getTwinSnapshot`. Heurística de KPIs + 3 prioridades desde engines/twin. *Size M. Deps: T9.*
- [x] **T11** `lib/inngest/functions/generate-morning-brief.ts` (new) cron `0 7 * * *` + registro en `lib/inngest/functions/index.ts` (edit). Replica entrega de `weekly-insights.ts`. *Size M. Deps: T10.*
- [x] **T12** APIs `app/api/executive/brief/latest/route.ts`, `.../history/route.ts`, `app/api/executive/feed/route.ts` — guard `requirePermissionApi('reports','read')`. *Size S. Deps: T10.*
- [x] **T13** `components/dashboard/morning-brief.tsx` (new) + sección 0 en `app/dashboard/executive/page.tsx` (edit) — Suspense, KPIs de hoy + 3 prioridades con `actionUrl` + resumen de ayer. *Size M. Deps: T12.*
- [x] **T14** (Opcional post-MVP) `IntelligenceService.reasonAbout` (extiende sin romper `answerQuestion`) + `app/api/executive/reason/route.ts`; degrada a heurística si falta feature `ai_copilot`. *Size L → T14a servicio / T14b API+UI. Deps: T11.*

### Checkpoint 3 (T9–T14)
- [ ] `pnpm run build` clean
- [ ] El brief se genera a diario; latest/history legibles
- [ ] El brief del dashboard ejecutivo muestra 3+ prioridades accionables con enlace real
- [ ] Entrega WhatsApp/Email/In-App funciona (réplica de weekly-insights)
- [ ] `reasonAbout` (opcional) responde con fuentes de engines si hay feature

## Fases de Orden y Finalidad
1. P1 (T1–T4) → tier/flags base
2. P2 (T5–T8) → playbooks/memoria del grupo
3. P3 (T9–T14) → morning brief diario

## Checklist final
- [ ] `pnpm run build` clean tras cada fase
- [ ] `pnpm db:generate` verificado en cada fase nueva (solo ADD/CREATE, sin DROP)
- [ ] Revisión con humano al cerrar cada Checkpoint antes de la siguiente fase
- [ ] Registrar decisión (AD) en `tasks/`/docs si alguna supuesto cambia

## Desviaciones respecto al plan (2026-08-07)

Todas conscientes; ninguna cambia el alcance:

1. **T4 — el banner vive en su propia pantalla.** `TierBanner` se montó en
   `app/dashboard/company/subscription/page.tsx` en vez de `app/dashboard/company/page.tsx`.
   El plan/upgrade es una superficie propia; meterlo en la página general de la compañía
   mezclaba configuración operativa con billing.
2. **T6a — `rollbackScope` se llama `unpublish`.** Mismo comportamiento (vuelve el template
   a `scope='branch'` y borra las copias); el nombre describe mejor lo que hace desde la UI.
3. **T6b — no existe `reconcile(companyId)`.** `corporateTwins.playbookCount` se calcula en
   caliente dentro de `ExecutiveTwinEngine.computeDimensions` vía
   `PlaybookService.countCompanyPlaybooks` (ver comentario en `executive-twin-engine.ts`).
   Un job de reconcile aparte podía quedar desfasado del twin; calcularlo en el mismo paso
   lo mantiene consistente por construcción.
4. **T14 — el copiloto no se oculta sin la feature.** `reasonAbout` degrada en tres niveles
   (sin twin → sin `ai_copilot` → sin `OPENAI_API_KEY`/error del proveedor) y siempre devuelve
   respuesta + fuentes. La API nunca responde 403 por tier; el 403 lo reserva el guard de
   permisos. La UI (`components/dashboard/executive/executive-copilot*.tsx`) muestra el panel
   siempre y pinta el CTA de upgrade cuando el tier no alcanza.