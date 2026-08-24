# Todo List: Reconexión del Módulo de Inventario

Plan: `tasks/plan-inventario-desconexion.md`
Alcance acordado: P0–P3 completo · Entrada de ventas: smart-link + pantalla corporativa

**Puerta de verificación**: `npx tsc --noEmit` (el `pnpm run build` puede fallar en esta máquina
por descarga de Geist desde fonts.gstatic.com; el fallo no es de código — patrón ya establecido).

**Precondiciones**:
- [x] Leer `tasks/plan-costo-promedio.md` y `tasks/plan-branch-scope-fail-closed.md` (no duplicar)
- [x] Responder Open Questions 1 y 4 del plan con David antes de Fases 2–3
  - **OQ1 resuelta (2026-08-23)**: mapeo manual genérico; sin configs específicas por POS.
  - **OQ4 resuelta (2026-08-23)**: `plan-costo-promedio` corre en paralelo en otra sesión;
    aquí la Fase 3 solo conecta su salida (T12) — T11 no se ejecuta en esta sesión.

---

## Phase 1 — Scope de sucursal coherente (P0, D2)

### Task 1: Auditoría + contrato de scope

**Descripción**: Inventariar cada página bajo `app/dashboard/inventory` y cada ruta bajo
`app/api/inventory` anotando cómo resuelve sucursal (header / select propio /
`session.user.branchId` / ignora). Documentar el mecanismo canónico (AD-1: `useBranch()`) en un
contrato corto. No cambia comportamiento; es el mapa que hacen seguros los tasks 2–5.

**Acceptance criteria**:
- [ ] Tabla completa páginas+rutas → mecanismo actual → infracción sí/no
- [ ] `docs/inventario-contrato-scope.md` escrito con las 3 reglas canónicas
- [ ] Los infractores quedan listados como entrada exacta de Tasks 2–4

**Verificación**: revisión del documento con David
**Dependencias**: Ninguna
**Archivos**: `docs/inventario-contrato-scope.md` (nuevo)
**Scope**: S

---

### Task 2: `HighValueSkusSection` respeta el scope

> **Estado 2026-08-23**: ya implementado en el working tree (componente thread-ea `branchId`,
> ruta lo valida contra el tenant). Solo resta verificación manual.

**Acceptance criteria**:
- [x] `/api/inventory/high-value` acepta `branchId` y filtra por él
- [x] El componente thread-ea `activeBranchId` (`undefined` = todas) a la query
- [ ] Con scope "Polanco" la sección muestra solo SKUs de Polanco; con "Todas", agregado del grupo

**Verificación**: `npx tsc --noEmit`; manual con ambos scopes
**Dependencias**: Task 1
**Archivos**: `components/inventory/high-value-skus-section.tsx`, `app/api/inventory/high-value/route.ts`
**Scope**: S

---

### Task 3: `stock-count` hereda el scope del header

> **Estado 2026-08-23**: ya implementado (cookie del header → lockea; select solo sin scope).
> Solo resta verificación manual.

**Acceptance criteria**:
- [x] Con scope activo, la sucursal viene preseleccionada y bloqueada; el `<select>` propio no renderiza
- [x] Sin scope (todas), el select existe solo si la acción lo requiere, preseleccionando nada
- [ ] Ningún conteo se crea contra una sucursal distinta del scope activo

**Verificación**: `npx tsc --noEmit`; manual: crear conteo con ambos scopes
**Dependencias**: Task 1
**Archivos**: `app/dashboard/inventory/stock-count/page.tsx`
**Scope**: S

---

### Task 4: `waste` usa contexto de vista, no sesión

> **Estado 2026-08-23**: no-op — la auditoría (Task 1, `docs/inventario-contrato-scope.md`)
> confirmó que `waste/page.tsx` ya resuelve vía cookie del header + `enforceBranchScope`
> server-side y pasa prop fija a `WasteClient`. Cambio cosmético a `useBranch()` descartado.

**Acceptance criteria**:
- [x] `waste-client`/`waste-form` reciben la sucursal vía resolución del header (server: cookie + `enforceBranchScope`, equivalente en espíritu a `useBranch()`)
- [x] El flujo existente no rompe para gerentes fijados a una sucursal (su header ya viene fijado)
- [x] Autorización sigue validada server-side por la ruta POST (sin cambios de seguridad aquí)

**Verificación**: `pnpm test:e2e -- tests/inventory-waste.spec.ts`; `npx tsc --noEmit`
**Dependencias**: Task 1
**Archivos**: `app/dashboard/inventory/waste/waste-client.tsx`, `app/dashboard/inventory/waste/page.tsx`, `components/inventory/waste-form.tsx`
**Scope**: S

---

### Task 5: Rollup "Todas" distribuye por sucursal

### Task 5: Rollup "Todas" distribuye por sucursal

**Acceptance criteria**:
- [x] `DashboardKpis` con scope "Todas" muestra top 3 sucursales contribuyentes por KPI principal
      (`Valor del Inventario`, `Alertas Críticas`, `Pérdida por Merma` — informativo, vía
      `data.attribution` de `/api/inventory/dashboard`, solo en modo all-branches)
- [x] `QuickAlerts` atribuye sucursal de forma prominente (chip clicable fuera del Link que
      enfoca la vista en esa sucursal vía `setSelectedBranchId`), no micro-línea truncada
- [x] Con scope de una sucursal, la UI queda igual que hoy (`attribution` no viaja; chips no renderizan)

**Verificación**: `npx tsc --noEmit`; manual con datos sembrados multi-sucursal
**Dependencias**: Task 1
**Archivos**: `components/inventory/dashboard-kpis.tsx`, `components/inventory/quick-alerts.tsx`, `app/api/inventory/dashboard/route.ts`
**Scope**: M

### Task 5b: Infractores residuales encontrados por la auditoría (ampliación acordada)

> La auditoría de Task 1 (`docs/inventario-contrato-scope.md`) encontró páginas y rutas que
> resuelven sucursal con `session.user.branchId` suelto, fuera de las tasks originales.
> David aprobó ampliar Phase 1 con ellas.

**Acceptance criteria**:
- [x] `production/page.tsx` deja de leer `session.user.branchId` directo; hereda scope del header (server: cookie + `enforceBranchScope`) y ya no bloquea al corporativo
- [x] `[id]/page.tsx` (detalle de ítem) resuelve la sucursal de lotes/stock/movimientos desde el alcance del header, no de la sesión
- [x] Rutas API con fallback `|| session.user.branchId` suelto migradas a `enforceBranchScope`: `low-stock`, `production` (GET/POST), `production/suggestions`, `storage-locations`, `reports/variance`
- [x] Rutas de escritura que ignoraban el alcance elegido (`receiving`, `transfers`) aceptan `branchId` explícito validado con helper; `receiving` deja de filtrar lotes por `session.user.branchId!`; clientes (`receiving-workflow`, `transfer-request`, `transfer-list`) thread-ean el alcance del header
- [x] `suggested-orders` acepta `branchId` explícito en GET/POST (corporativo sin sucursal puede usarla; la página thread-ea `selectedBranchId`)
- [x] `suppliers`/`claims`/`invoices/upload` dejan de escribir `session.user.branchId || ''`: resuelven vía `enforceBranchScope` (audit logs con fallback `''` documentado cuando no hay alcance)

**Verificación**: `npx tsc --noEmit`; manual: ADMIN con scope "Polanco" opera recepción/transferencia/producción sobre Polanco
**Dependencias**: Task 1
**Archivos**: ver tabla de infractores en `docs/inventario-contrato-scope.md`
**Scope**: M

### ✅ Checkpoint 1: una sola forma de preguntar "¿de qué sucursal?"
- [ ] `npx tsc --noEmit` limpio
- [ ] Manual: scope Polanco → KPIs/conteo/merma/alto valor todos Polanco; scope Todas → todo con atribución
- [ ] Grep: ningún selector de sucursal propio bajo `app/dashboard/inventory`

---

## Phase 2 — Ingesta de ventas (P0, D1)

### Task 6: `SalesIngestService` parser + normalización

**Acceptance criteria**:
- [ ] Parsea CSV genérico con mapeo configurable columnas→campos
- [ ] Resuelve `recipeRef` por SKU, código o nombre exacto; filas sin match van a `errors[]`, no abortan el lote
- [ ] Fechas normalizadas al día local de la sucursal (mismo criterio que `inventory-snapshot-service`)
- [ ] Unit test del servicio con CSV válido, con errores mixtos y vacío

**Verificación**: unit tests en verde; `npx tsc --noEmit`
**Dependencias**: Ninguna
**Archivos**: `lib/services/sales-ingest-service.ts` (nuevo)
**Scope**: M

### Task 7: Idempotencia de ventas

**Acceptance criteria**:
- [ ] Unique index `(company_id, branch_id, sale_date, recipe_id)` en `sales_entries` vía migración Drizzle (`pnpm db:generate`)
- [ ] Query de diagnóstico ejecutada antes: duplicados históricos contados y política decidida (keep latest)
- [ ] Re-importar el mismo archivo no duplica filas ni consumo teórico

**Verificación**: SQL de migración revisado a mano (⚠️ nunca `db:push` sin verificar); reimport manual dos veces
**Dependencias**: Task 6
**Archivos**: `lib/db/schema.ts`, `drizzle/` (migración generada), `lib/services/sales-ingest-service.ts`
**Scope**: M

### Task 8: API bulk con permiso corporativo

**Acceptance criteria**:
- [ ] `POST /api/inventory/sales-entry/bulk` acepta `branchId` explícito; valida acceso con `resolveBranchScope` (ALL = cualquier sucursal del tenant; BRANCH = solo la propia)
- [ ] No depende de `session.user.branchId` (corporativo sin sucursal puede importar)
- [ ] Respuesta `{inserted, skipped, errors[]}` con fila y motivo por error
- [ ] Llama a `TheoreticalConsumptionService.consume` por fila insertada

**Verificación**: `npx tsc --noEmit`; curl manual con usuario ADMIN y GERENTE
**Dependencias**: Task 7
**Archivos**: `app/api/inventory/sales-entry/bulk/route.ts` (nuevo)
**Scope**: S

### Task 9: Pantalla corporativa de carga masiva

**Acceptance criteria**:
- [ ] Upload CSV + selección de sucursal (respetando scope) + mapeo de columnas persistible
- [ ] Preview de primeras N filas antes de confirmar; resultado con errores accionables por fila
- [ ] Accesible desde reports y desde el hub de inventario

**Verificación**: `npx tsc --noEmit`; manual end-to-end con CSV real de prueba
**Dependencias**: Task 8
**Archivos**: `app/dashboard/inventory/sales-entry/page.tsx` (nuevo), componente cliente
**Scope**: L — partir en 9a (upload+preview) y 9b (mapping+resultado) si excede una sesión

### Task 10: Smart-link cierre POS → ventas reales

**Acceptance criteria**:
- [ ] `POST /api/workflows/smart-links/upload-pos` parsea el archivo vía `SalesIngestService` y crea `salesEntries`, además de guardarlo en R2
- [ ] Fallo de parseo NO bloquea la evidencia del workflow: guarda el archivo y registra advertencia
- [ ] El gerente cierra su día por WhatsApp/link y sus ventas entran solas

**Verificación**: `npx tsc --noEmit`; manual subiendo CSV por smart link
**Dependencias**: Task 8
**Archivos**: `app/api/workflows/smart-links/upload-pos/route.ts`
**Scope**: S

### ✅ Checkpoint 2: ciclo vende→consume end-to-end
- [ ] Doble carga del mismo CSV = mismo conteo de `salesEntries`
- [ ] Ventas registradas producen movimientos USAGE verificables
- [ ] `npx tsc --noEmit` limpio

---

## Phase 3 — Food cost real (P1, D3+D4)

### Task 11: Ejecutar `plan-costo-promedio.md` (CP1–CP12)
Paraguas de fase: seguir `tasks/todo-costo-promedio.md` (si no existe aún, crearlo desde ese plan).
**Dependencias**: Ninguna (puede correr en paralelo desde ya)
**Scope**: según ese plan

### Task 12: Varianza conectada a la navegación
**Acceptance criteria**:
- [ ] El reporte de varianza resultante es alcanzable desde `costing/page.tsx` y desde reports
- [ ] Copy declara si el cálculo cubre solo SKUs alto valor (80/20)
**Dependencias**: Task 11
**Archivos**: `app/dashboard/inventory/costing/page.tsx`, página de varianza nueva
**Scope**: S

### Task 13: Ocultar cáscaras (D4)
**Acceptance criteria**:
- [ ] menu-engineering, intelligence y executive fuera de la nav del módulo (redirect o flag)
- [ ] Ninguna ruta navegable termina en página de 4 líneas vacía
- [ ] Nota de retorno documentada (cuándo vuelven y con qué contenido mínimo)
**Dependencias**: Ninguna (independiente)
**Archivos**: nav/sidebar del dashboard, `app/dashboard/inventory/{menu-engineering,intelligence,reports/executive}/page.tsx`
**Scope**: S

### ✅ Checkpoint 3: la promesa central responde
- [ ] Varianza devuelve números ≠ 0 con datos sembrados
- [ ] Cero cáscaras navegables
- [ ] **Revisión con David antes de Phase 4**

---

## Phase 4 — Coherencia operacional (P2, D5–D7)

### Task 14: Verificar solape conteo-workflow
Leer `plan-conteo-produccion-merma*`: si ya cubre wiring workflow+WhatsApp del conteo 80/20,
cerrar este task como duplicado con referencia; si no, implementarlo.
**Dependencias**: Checkpoint 3
**Scope**: S (verificación) / M (implementación si aplica)

### Task 15: Un motor de compras (D5)
**Acceptance criteria**:
- [ ] `procurement-engine` consume `SuggestedOrderService.calculate()`; lógica espejo borrada
- [ ] Las sugerencias de intelligence y de suggested-orders coinciden con los mismos inputs
**Dependencias**: Checkpoint 3
**Archivos**: `lib/services/intelligence/procurement-engine.ts`, `lib/services/suggested-order-service.ts`
**Scope**: M

### Task 16: Alertas en el momento + N+1 (D6)
**Acceptance criteria**:
- [ ] `checkStockLevels` usa join ítem+nivel en una query (adiós loop N+1)
- [ ] Low-stock evalúa inline al registrar recepción/merma/ajuste de conteo (misma transacción u evento Inngest, según Open Question 3 resuelta)
- [ ] El cron de 6h sigue como red de seguridad, no como única vía
**Dependencias**: Checkpoint 3
**Archivos**: `lib/services/stock-alert-service.ts`, rutas de receiving/waste/stock-count
**Scope**: M

### ✅ Checkpoint 4: un cerebro por decisión
- [ ] Una sola fuente de sugerencias de compra
- [ ] Merma crítica genera alerta visible sin esperar cron
- [ ] `npx tsc --noEmit` limpio

---

## Phase 5 — Integridad de escrituras (P3, D8)

### Task 17: Un punto de escritura de stock
**Acceptance criteria**:
- [ ] waste/receiving/transfers/production descuentan lotes vía un único servicio central
- [ ] Casos especiales preservados y testeado cada uno: STAFF/COURTESY→USAGE, shortfalls de producción, FEFO
- [ ] Specs e2e existentes en verde
**Dependencias**: Checkpoint 4
**Archivos**: `lib/services/inventory-service.ts`, rutas de waste/receiving/transfers, `lib/services/production-service.ts`
**Scope**: L — partir por dominio (waste primero, luego transfers, luego production)

### Task 18: `unitCost` en movimientos
**Acceptance criteria**:
- [ ] Columna agregada vía migración; write paths la pueblan desde el lote/costo vigente
- [ ] Costeo puede leer costo histórico cuando existe (fallback a comportamiento actual)
- [ ] Ejecutar SOLO después del checkpoint de `plan-costo-promedio`
**Dependencias**: Task 17 + CP de plan-costo-promedio
**Archivos**: `lib/db/schema.ts`, servicio central de escritura, servicios de costeo
**Scope**: M

### ✅ Checkpoint 5: completo
- [ ] Toda escritura de stock pasa por un servicio
- [ ] `tests/inventory-waste.spec.ts` en verde
- [ ] Todos los criterios marcados
