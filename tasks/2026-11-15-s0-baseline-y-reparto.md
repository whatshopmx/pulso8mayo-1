# S0: Baseline reproducible, manifiesto de entornos y reparto inicial (A1 / B1 / C1)

Fecha: 2026-11-15. Complementa [2026-11-15-investigacion-y-sesiones-faltantes.md](2026-11-15-investigacion-y-sesiones-faltantes.md) y [todo-implementacion-faltantes.md](todo-implementacion-faltantes.md). S0 no implementa lógica, no ejecuta migraciones ni acepta funcionalidad nueva.

## 1. Base reproducible y preservación de cambios concurrentes

- **HEAD base:** `35c5dcf3d05a4b991d60e7d8c1f10f22b433e12c` (`feat(labor): complete leave request approval flow and audit fixes`).
- **Cambios locales en el árbol de trabajo (31 archivos modificados + archivos nuevos untracked):**
  - **Frente Ventas/Recuperación (A):** `app/api/inventory/sales-entry/*`, `app/api/workflows/smart-links/upload-pos/route.ts`, `app/dashboard/inventory/sales-entry/sales-entry-client.tsx`, `lib/services/sale-consumption-service.ts`, `lib/services/sales-ingest-service.ts`, `lib/services/sale-recovery-*.ts`, `lib/db/schema.ts`, `lib/db/schema/evidence.ts`, `lib/storage/r2-client.ts`, `drizzle/0143_*`–`0145_*`, `app/api/inventory/sales-entry/recovery-*`, `tests/*`, `tasks/evidencia/2026-11-11/INV-01.*` y `CHECKPOINT-INV-B3/`.
  - **Seeds y servicios transversales concurrentes:** `scripts/seed-04-inventory.ts`, `seed-05-workflows.ts`, `seed-06-labor.ts`, `seed-12-sales-pos.ts`, `seed-13-receiving-matching.ts`, `seed-15-financial-close.ts`, `seed-16-executive-control.ts`, `seed-18-finance.ts`, `scripts/db-commit-enum-values.ts`, `lib/services/cross-branch-service.ts`, `lib/services/domain-event-service.ts`, `lib/services/executive-twin-engine.ts`, `tests/unit/seed-integration.test.ts`.
  - **Trazabilidad y contabilidad:** `docs/matriz-cumplimiento-sistema-2026-11-11.csv`, `plans/2026-11-11-plan-implementacion-faltantes.md`, `tasks/mapa-implementacion-faltantes.json`, `tasks/todo-implementacion-faltantes.md`, `tasks/finanzas-contabilidad/{bank-account-link-verification,migration-2026-11-12,pilot-netlify-2026-11-12}.json`, `faltantecontabilidad.md.txt`.
- **Regla de worktrees:** un `git worktree add` directo desde `HEAD` **no incluye** los 31 archivos modificados ni los untracked. Antes de abrir worktrees paralelos para A1/B1/C1, copiar o crear una rama/commit de preservación local (sin push ni alteración de `main`) o trabajar sobre copias aisladas que conserven este árbol.

## 2. Manifiesto de entornos y migraciones (sanitizado)

| Entorno / archivo | Destino observado (sin credenciales) | Banderas / rol | Estado de migraciones |
|---|---|---|---|
| `.env` (`DATABASE_URL`, `MIGRATION_DATABASE_URL`) | `ep-twilight-shadow-behp01su` (`neondb`, `neondb_owner`) | `ACCOUNTING_*` no definidas (apagadas) | Base local principal; según `migration-2026-11-12.json` llegó a `0140` en esa fecha. `0141`–`0150` locales no se asumen aplicadas. |
| `.env` (`DATABASE_URL_UNPOOLED`) | `ep-dawn-scene-ayy93r15` (`neondb`, `neondb_owner`) | — | Host distinto al pooled/migration en `.env`; verificar antes de cualquier DDL. |
| `.env.test` (`TEST_DATABASE_URL`) | `ep-cold-morning-bewqoz3o` (`neondb`, `neondb_owner`) | Rama aislada (`br-round-voice-belheola`), rol runtime `pulso_app` (`NOBYPASSRLS`) | Baseline + `0137`–`0139` aplicadas en rama aislada; `0141`, `0143`–`0145` probadas en rollback/aislamiento según evidencias. |
| Journal local (`drizzle/meta/_journal.json`) | Índices `0000`–`0150` | — | `0146`–`0150` en `HEAD`; `0143`–`0145` untracked locales. **Nunca inferir despliegue desde `_journal.json`.** |

## 3. Contraste documental P0 / CHECKPOINT-INV-B3 / FC-15–21

- **Aceptados en el mapa (15):** `P0-01`..`P0-05`, `SEC-00`, `INV-01.a`, `INV-01.a1`, `INV-01.a2`, `INV-01.b1`, `INV-01.b2a`, `INV-01.b2`, `INV-01.b3a`, `INV-01.b3`, `INV-01.b4a`.
- **Reconciliación aplicada en `todo-implementacion-faltantes.md`:**
  - `INV-01.b3a`, `INV-01.b3` y `INV-01.b4a` quedan reconciliados en la tabla de ejecución con su estado vigente (`aceptado` por `CHECKPOINT-INV-B3`).
  - Los 10 hijos adicionales de `INV-01.c.recovery.*` quedan reflejados en la tabla de ejecución (`código implementado`, coincidiendo con los 18 registros del mapa + 3 `en curso`).
  - `SEC-05.resto` (14 hijos) e `INT-02` (5 hijos) ya están materializados en `mapa-implementacion-faltantes.json`; permanecen sin marcar en reglas hasta verificar delimitación y ejecutarlos.
- **FC-15–21 (`tasks/finanzas-contabilidad/todo.md`):** FC-15–20 completadas técnicamente en local (`0146`–`0150` sin aplicar); FC-21 pendiente de revisión UI/roles y firma del responsable contable. Se reutilizan para `NOM-05` y `FIN-01/02`.

## 4. Pendientes globales registrados (diagnóstico separado)

1. **Timeout del seed en suite unitaria general** (reportado en `INV-01.c.recovery.sources` y `proposal.service`). Reproducir y diagnosticar por separado; prohibido ampliar timeouts o excluir pruebas.
2. **5 archivos heredados de `tests/integration/accounting`** (`expense-payment.test.ts`, `sales.test.ts`, `settlements.test.ts`, `purchases.test.ts`, `journal.test.ts`) fallando por bootstraps previos a `0146`–`0149`.
3. **Migraciones `0141`–`0150`** pendientes de aplicación autorizada por entorno (`OPS-03`).
4. **Playwright E2E contable (`tests/e2e/accounting.spec.ts`)** para controles FC-19 y validación humana **FC-21**.

## 5. Reparto y archivos asignados (A1 / B1 / C1 en paralelo)

| Sesión | IDs | Archivos permitidos (escritura) | Solo lectura / prohibido tocar | Turno de schema/journal |
|---|---|---|---|---|
| **A1** | `INV-01.b4b.rls`, `INV-01.b4b`, `INV-01.b4.manual`, `INV-01.b4.bulk`, `INV-01.b4.smartlink`, `INV-01.b4.ui` (subdividir por frontera si supera 5 archivos) | `app/api/inventory/sales-entry/route.ts`, `app/api/inventory/sales-entry/bulk/route.ts`, `app/api/workflows/smart-links/upload-pos/route.ts`, `app/dashboard/inventory/sales-entry/sales-entry-client.tsx`, `lib/services/sales-ingest-service.ts`, `tests/unit/inventory/sales-entry-*.test.ts`, `tests/integration/sale-consumption-application-db.test.ts`, `tests/e2e/sales-entry-feedback.spec.ts`, `tests/playwright-sales-entry.config.ts`, `tests/support/sales-entry-browser-server.ts`, `tasks/evidencia/2026-11-11/INV-01.b4*/` | No tocar `lib/services/sale-consumption-service.ts` (aceptado b3), `payroll-service.ts`, `audit-service.ts`, ni `drizzle/meta/_journal.json` | Sin turno (0141 ya generada). Si storage POS requiere tabla/columna, solicitar turno a S. |
| **B1** | `NOM-01` | `lib/services/payroll-service.ts`, `lib/services/compliance/payroll-calculator.ts`, `lib/services/__tests__/payroll-*.test.ts` (o nueva prueba focal `NOM-01`), `tasks/evidencia/2026-11-11/NOM-01/` | Solo lectura: `lib/treasury/payroll-snapshot.ts`, `lib/services/accounting/payroll-contract.ts`, `lib/services/accounting/payroll-adapter.ts` (propiedad de D). Prohibido tocar ventas/auditoría. | Diseñar contrato y pruebas primero; solicitar turno exclusivo a S antes de editar `lib/db/schema*` o `drizzle/`. |
| **C1** | `AUD-02` | `lib/services/audit-service.ts`, `lib/security/audit.ts`, primer caller crítico acotado (coordinar si toca A o D), prueba focal `AUD-02`, `tasks/evidencia/2026-11-11/AUD-02/` | Prohibido tocar `payroll-service.ts` (B1), `sales-ingest-service.ts` (A1), ni `drizzle/meta/_journal.json`. | Sin turno inicial; si requiere columna/índice de auditoría, solicitar turno exclusivo a S. |
