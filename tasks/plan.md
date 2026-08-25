# Implementation Plan: Estrategia de Pruebas Pulso HORECA

## Overview

Cerrar el hueco entre 289 rutas API / 122 servicios / 33 funciones Inngest / 140 páginas y 0 pruebas unitarias + 0 CI. La suite actual son 36 specs Playwright contra la base de dev compartida, en serie. Este plan implementa las capas del documento de estrategia en orden costo/beneficio, con dos ajustes derivados de la verificación del 2026-08-24:

1. **Los dos hallazgos de seguridad ya están corregidos en el código** (IDOR en `employees/[id]/*` → ahora usa `getCurrentTenant()` de sesión; webhook de WhatsApp → token-in-path con `timingSafeEqual`). El paso 1 pasa de "tapar fugas" a "escribir las regresiones que impidan que se rompan de nuevo".
2. Los conteos reales difieren levemente del doc (289 rutas, no 287; 122 servicios, no 111) — los barridos deben derivarse del filesystem, no de números hardcodeados.

## Architecture Decisions

- **Vitest para la capa unitaria**: ciclo de milisegundos, soporta table-driven tests y fast-check para property-based (`calculatePropinasDistribution`). Playwright queda exclusivamente para E2E.
- **Barridos parametrizados desde el filesystem**: una sola prueba que recorra `app/api/**/route.ts` cubre invariantes transversales (401 sin sesión, sobre `{ success, data | error }`) y detecta rutas nuevas sin guardia automáticamente.
- **Regresiones de seguridad como tests unitarios/integración primero**: baratas, rápidas y documentan el contrato de seguridad que proxy.ts y las guardias mantienen.
- **Base efímera con ramas de Neon** (decidido): Docker no está disponible en el entorno y el repo usa `@neondatabase/serverless` (WebSocket) — probar contra Postgres local/TCP sería otra configuración de conexión que la de producción. Flujo por corrida: create_branch → migrar desde cero → seeds → suite → delete_branch. La prueba de drift sale gratis porque la rama siempre se migra desde cero.
- **Lista de excepciones del barrido 401 con revisión humana** (decidido): primero barrido exploratorio que clasifica las rutas sin guardia (legítima-pública / debería-tener-guardia / desconocida), tabla al humano para aprobar, recién entonces se congela como fixture del test.
- **E2E nocturno en GitHub Actions scheduled** (decidido): segundo workflow en `.github/workflows/` con `schedule`; sin servicios externos gracias a las ramas efímeras de Neon.
- **Excluir `.worktrees/`** de todos los barridos (hay un worktree con su propio node_modules).
- **No probar**: primitivos shadcn de `components/ui/`, wrappers de reexportación, el esquema Drizzle en sí (sí la migración que lo produce), cobertura por porcentaje.

## Task List

### Phase 0: Regresiones de seguridad (los fixes ya existen — blindarlos)

- [ ] **Task 1: Regresión webhook WhatsApp autenticado** (S)
  Specs: POST a `/api/whatsapp/webhook` (sin token) → 405/404; POST a `/api/whatsapp/webhook/<token-malo>` → 404; token válido + payload con `messages` → emite evento Inngest con `id = message.id`; mismo `message.id` dos veces → un solo procesamiento; JSON malformado → 400/500 sin encolar.
  - Archivos: `tests/api/whatsapp-webhook-auth.spec.ts`
- [ ] **Task 2: Regresión tenant-desde-sesión en employees/[id]/*** (S)
  Specs: sesión válida + `?companyId=<otra-empresa>` sobre documents/benefits/contracts/training → los datos devueltos filtran por companyId de sesión (nunca el parámetro); sin sesión → 401.
  - Archivos: `tests/api/employees-tenant-isolation.spec.ts`

### Phase 1: Fundación de pruebas

- [ ] **Task 3: Instalar Vitest + configuración base** (S)
  `vitest`, `fast-check`; script `pnpm test:unit`; config con exclude de `.worktrees/` y de specs Playwright; smoke test trivial verde.
  - Archivos: `package.json`, `vitest.config.ts`, `lib/workflows/__tests__/today.smoke.test.ts`
- [ ] **Task 4: CI mínimo** (S)
  `.github/workflows/ci.yml`: pnpm install → lint → build → test:unit en cada push/PR. Sin E2E todavía (nocturno más adelante).
  - Archivos: `.github/workflows/ci.yml`

### Checkpoint: Fundación
- [x] `pnpm run build` y `pnpm run lint` pasan localmente — lint requerido triage previo: 1067 errores preexistentes (`any` endémico con `strict:false`) bajados a warning en config; 11 `rules-of-hooks` reales corregidos en código (crash latente de "Rendered more hooks")
- [x] `pnpm test:unit` corre el smoke test en <10 s (~1 s)
- [ ] CI verde en un PR real *(pendiente push)*

### Phase 2: Capa 01 — Unitarias sobre lógica pura

- [x] **Task 5: Fechas y zonas horarias (`lib/workflows/today.ts`)** (M)
  Table-driven: `localMoment`, `startOfLocalDayUtc`, `localDateString`, `addCalendarDays`, `localDayRangeUtc` × 3 zonas (Mexico_City, Cancún UTC−5 fijo, Tijuana DST); captura 23:50 cae en día operativo correcto. `isScheduleDueOn`/`parseTimeOfDay`: ONCE/DAILY/WEEKLY/MONTHLY, día 31, 29-feb, hora inválida. `deriveItemState`: matriz HECHO/EN_CURSO/VENCIDO/PENDIENTE + empate.
  - Archivos: `lib/workflows/__tests__/today.test.ts`
  - Hallazgos (2026-08-24): BUG corregido — el redondeo de `startOfLocalDayUtc` sesgaba +1 min con segundos ≥31 (`history/route.ts` pasa `new Date()`; test rojo commit 0c72e58, fix mínimo 85e7acf). Congelado como contrato: `"08:30:15"` sí parsea (regex sin ancla final). Documentado en tests: días DST Tijuana reportan rango de 24 h corrido ±1 h (día real 23/25 h), según admite el docstring del módulo; WEEKLY con `daysOfWeek:[7]` filtra y cae al escalar `dayOfWeek ?? 1`.
- [x] **Task 6: LFT (`lib/labor-validation.ts`)** (M)
  `calculateOvertime` (primeras 9 h semanales al doble, siguientes al triple), turnos traslapados, cierre-apertura <8 h, cruce de medianoche, `aggregateWeeklyHours`/`getComplianceStatus` contra reglas default y sobrescritas por tenant.
  - Archivos: `lib/__tests__/labor-validation.test.ts`
  - Hallazgos (2026-08-24): BUGS corregidos — `checkShiftConflict` daba falsos positivos según orden de inserción y no veía traslapes entre fechas (0 callers, sin riesgo); `calculateWeeklyOvertime` restaba 2× las 8h regulares → alertas de extra muertas. PENDIENTES DE DECISIÓN HUMANA: (a) `calculateOvertime` paga la 1ª hora extra a tarifa Normal(1x), difiere de LFT 9h-al-doble del plan — afecta nómina; (b) `validateBreakCompliance` mezcla semántica jornada-total/tramo-continuo: toda sesión ≥5h sale no-compliant aunque tome sus descansos (shift-sessions PUT marca `missedBreak`). Ambos congelados en tests con comentario.
- [ ] **Task 7: Permisos y alcance (RBAC/ABAC)** (M)
  `branch-scope.ts`: 6 roles × sucursal propia/ajena/"todas" — GERENTE/SUPERVISOR no amplían alcance vía parámetro. `permissions.ts`: `hasAccess` sobre ROUTE_PERMISSIONS completo, `getDefaultDashboard` sin redirects a rutas prohibidas. `abac.ts`: OWNED/FRANCHISE × NONE/OWN_BRANCH_ONLY/ALL. `masking.ts`: PII nuevo entra enmascarado (fail-closed).
  - Archivos: `lib/__tests__/branch-scope.test.ts`, `lib/rbac/__tests__/permissions.test.ts`, `lib/rbac/__tests__/abac.test.ts`, `lib/rbac/__tests__/masking.test.ts`
- [ ] **Task 8: Dinero y parseo POS** (M)
  `pos-column-aliases.ts`: `parseMoneyToCents` ("$1,234.50", "1.234,50", "(150.00)", "1 234,50 MXN", "", "N/A", notación científica) → null, nunca NaN; `normalizeHeader`/`matchFieldAlias`/`isTotalLabel` con acentos, mayúsculas, duplicados. `rate-limiter.ts`: ventana expira, contador reinicia, headers correctos con fallback en memoria.
  - Archivos: `lib/services/__tests__/pos-column-aliases.test.ts`, `lib/__tests__/rate-limiter.test.ts`
- [ ] **Task 9: Propinas con property-based testing** (S)
  `calculatePropinasDistribution`: invariante fast-check — suma repartida === total, con cualquier número de empleados y monto; sin centavos perdidos/inventados.
  - Archivos: `lib/services/__tests__/propinas-service.test.ts`

### Checkpoint: Capa 01
- [ ] Suite unitaria completa en <30 s
- [ ] Casos borde documentados en los propios tests (día 31, DST Tijuana, empate de estado)

### Phase 3: Capa 03 — Contrato de API

- [ ] **Task 10: Barrido 401 sin sesión sobre todas las rutas** (M)
  Paso previo (exploratorio): clasificar las rutas sin guardia en legítima-pública / debería-tener-guardia / desconocida y entregar la tabla al humano para aprobar. Después, prueba parametrizada que recorre `app/api/**/route.ts` del filesystem; cada ruta responde 401 sin sesión (ni 200 ni 500). Lista de excepciones congelada como fixture solo tras aprobación. Ruta nueva sin excepción → test falla.
  - Archivos: `tests/support/public-routes.ts` (fixture), `tests/api/contract/unauth-sweep.spec.ts`, tabla de clasificación en el PR
- [ ] **Task 11: Sobre de respuesta y método no permitido** (M)
  Éxito y error respetan `{ success, data | error }`; DELETE sobre ruta GET-only → 405, no 500. Mismo mecanismo de barrido.
  - Archivos: `tests/api/contract/envelope-sweep.spec.ts`, `tests/api/contract/method-sweep.spec.ts`

### Phase 4: Capa 04 — Aislamiento multi-tenant

- [ ] **Task 12: Barrido IDOR communications + employees** (S)
  Sembrar empresa B con un recurso de cada tipo; sesión de A intenta leer/editar/borrar por id → 403/404; control positivo sigue pasando (fail-closed no cierra a quien sí tiene permiso).
  - Archivos: `tests/api/tenant-idor.spec.ts`
- [ ] **Task 13: Cruce entre sucursales GERENTE/SUPERVISOR** (M)
  Por dominio con datos por sucursal (inventario, finanzas, incidentes, turnos, nómina): cookie `pulso_selected_branch` no amplía alcance.
  - Archivos: `tests/api/branch-cross-domain.spec.ts`
- [ ] **Task 14: Exportaciones y evidencias R2 sin fuga** (S)
  CSV/PDF de A no contiene filas de B; URL de foto de B ilegible con sesión de A.

### Checkpoint: Contrato + Aislamiento
- [ ] Los tres barridos pasan completos contra la base de dev
- [ ] Revisión con humano antes de tocar infraestructura de BD

### Phase 5: Capa 02 — Base efímera + paralelización

- [ ] **Task 15: Postgres efímero por corrida (ramas de Neon)** (L — dividir si excede una sesión)
  DECIDIDO: ramas de Neon (Docker no disponible en el entorno; el repo usa driver WebSocket que difiere de un Postgres local TCP). Flujo: create_branch → migrar desde cero + seeds → suite → delete_branch. Configurar `playwright.config.ts` workers > 1. La migración desde cero en cada corrida verifica drift contra `lib/db/schema.ts`.
  - Archivos: `playwright.config.ts`, script de setup/teardown Neon en `tests/support/`
- [ ] **Task 16: Pruebas de idempotencia/transacción sobre BD efímera** (M)
  Extractores workflow re-ejecutados no duplican; transacción inventario fallada a medias no deja huérfanos; doble `executePayrollRun` → un solo recibo; recepción parcial/sobre-ordenada/OC cerrada.

### Phase 6: Capa 06 — Inngest con @inngest/test

- [ ] **Task 17: Setup @inngest/test + whatsapp-router** (S)
  Número no registrado, empleado dado de baja, multimedia sin descargar, texto sin match de intent.
- [ ] **Task 18: Idempotencia de extractores y snapshots** (M)
  Replay del mismo evento no duplica mermas/recepciones/conteos; doble corrida de snapshot KPI → un snapshot.
- [ ] **Task 19: Crons por zona horaria y escalamiento** (M)
  Cancún/CDMX/Tijuana disparan a su hora local; DST sin saltar/duplicar días; escalera de escalamiento sale de `tenant_operating_config`; alerta no escala dos veces al mismo nivel.

### Phase 7: Capa 07 — Recorridos E2E de negocio

- [ ] **Task 20: Onboarding completo** (M) registro → empresa → sucursal → invitar gerente → primer workflow → primera ejecución.
- [ ] **Task 21: Empleado vía WhatsApp + AI verify** (M) smart link sin sesión → checklist → foto → >85% auto-aprueba / <85% a revisión.
- [ ] **Task 22: Cierre de turno** (S) arqueo → corte → propinas → notificación; casos faltante y sobrante.
- [ ] **Task 23: Ciclo de compra** (M) OC → recepción parcial → CFDI → conciliación 3-way → reclamación.
- [ ] **Task 24: Nómina e incidentes** (M) periodo → horas extra → timbrado → reintento; incidente → escalamiento → remediación → cierre.
- [ ] **Task 25: Recorrido por rol** (S) 6 roles entran a su dashboard y navegan sin 403 ni bucle de redirect.

### Phase 8: No funcionales (continuo)

- [ ] **Task 26: Presupuesto p95 en agregados** (S) `/api/finance/pnl`, `/api/executive/twin`, `/api/analytics/*` con 15 sucursales + 1 año de datos.
- [ ] **Task 27: axe-core en pantallas críticas** (S) extender `tests/support/contrast.ts` a teclado, foco visible, labels.
- [ ] **Task 28: i18n sweep** (S) ninguna clave usada falta en `messages/es.json`; sin strings EN visibles.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Barrido 401 destapa muchas rutas públicas sin excepción documentada | Medio | Fase exploratoria previa: clasificar las ~56 rutas sin guardia antes de fijar la lista de excepciones |
| Base efímera (Neon branches) cuesta o golpea límites del plan | Medio | Docker Postgres como fallback; decisión explícita en Task 15 |
| `strict: false` oculta errores de tipo que solo `pnpm build` atrapa | Bajo | CI ejecuta build en cada push desde Task 4 |
| Tests de zona horaria dependen de TZ de la máquina CI | Medio | Fijar `TZ=UTC` en vitest config y usar zonas explícitas, nunca locales |
| Worktree `.worktrees/refactor-shift-scheduler` contamina barridos | Bajo | Exclude explícito en configs desde Task 3 |

## Open Questions

*(Resueltas el 2026-08-24 — ver Architecture Decisions. Pendiente de ejecución: la tabla de clasificación de rutas sin guardia del Task 10 requiere aprobación humana antes de congelar el fixture.)*

## Parallelization Opportunities

- Tasks 1–2 (regresiones) son independientes entre sí.
- Tasks 5–9 (capa 01) son archivos de test independientes — paralelizables por agente/sesión.
- Tasks 10–11 comparten el mecanismo de barrido: definir helper primero, luego paralelizar.
- Tasks 20–25 (E2E) son independientes una vez existe la base efímera (Task 15).
