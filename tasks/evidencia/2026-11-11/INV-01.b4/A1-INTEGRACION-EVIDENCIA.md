# A1: Cierre del recorrido integrado de captura e importación (INV-01.b4*)

Fecha: 2026-11-15T17:08:00Z  
Sesión: A1 (Frente A — Ventas/Stock)  
Base acordada: HEAD `35c5dcf3d05a4b991d60e7d8c1f10f22b433e12c` más cambios locales concurrentes.  
Entorno de prueba: `.env.test` aislado (rama Neon `br-round-voice-belheola`, host `ep-cold-morning-bewqoz3o`).

---

## 1. Inventario de Pruebas: Reales vs Sintéticas

| ID | Alcance / Archivos | Componente Real | Componente Sintético / Mock | Estado Técnico |
|---|---|---|---|---|
| **INV-01.b4b.rls** | `0141_inv01b_import_recipe_name.sql`, `tests/integration/sale-consumption-application-db.test.ts` | **PostgreSQL Real**: rol `pulso_app`, RLS activo, transacción serializable, `GRANT SELECT(name)` dentro de rollback. DML denegado (42501). | Migración no aplicada a main ni a rama fija; se ejecuta en la transacción del probe y se revierte. | V2 comprobada (1/1 caso RLS específico + 16 regresiones). |
| **INV-01.b4b** | `lib/services/sales-ingest-service.ts`, `tests/integration/sale-consumption-application-db.test.ts`, `lib/services/__tests__/sales-ingest-service.test.ts` | **PostgreSQL Real**: writer transaccional, resolución de nombres/UUID bajo contexto runtime, reintentos 40001/40P01, cálculo de `revenueCoverage`. | Pruebas unitarias de `sales-ingest-service.test.ts` (6 tests) usan mocks de `db` y `applySaleConsumptionInTransaction`. | V1/V2 comprobadas (17 SQL conjuntas, 6 unitarias). |
| **INV-01.b4.manual** | `app/api/inventory/sales-entry/route.ts`, `tests/unit/inventory/sales-entry-access.test.ts`, `tests/integration/sale-consumption-application-db.test.ts` | **PostgreSQL Real**: prueba atómica de lote con savepoint (`atomic: true`), rollback de venta, identidad y movimientos si falla stock o receta. | Ruta HTTP (`sales-entry-access.test.ts`, 6 tests) usa `NextRequest` con mock de `getSession`, mock de `db.select` y mock de `SalesIngestService.ingest`. | V1/V2 comprobadas (1 SQL de lote atómico + 6 de ruta mock). |
| **INV-01.b4.bulk** | `app/api/inventory/sales-entry/bulk/route.ts`, `tests/unit/inventory/sales-entry-bulk.test.ts` | **Parser Real**: `buildRows` de `sales-ingest-pure.ts` ejecuta normalización, agrupación y manejo de delimitadores. | Ruta HTTP (`sales-entry-bulk.test.ts`, 5 tests) usa `NextRequest` con mock de `getSession` y mock de `SalesIngestService.ingest`. Persistencia integrada reutiliza la prueba Postgres de b4b. | V1/V2 parcial (5 pruebas de ruta; API HTTP real pendiente en INV-01.d). |
| **INV-01.b4.smartlink** | `app/api/workflows/smart-links/upload-pos/route.ts`, `tests/unit/inventory/sales-entry-smart-link.test.ts` | **Parser y Validación Real**: parseo multipart y JSON, validación de fecha civil, resolución de alcance con `resolveBranchScope`. | Almacenamiento sintético: `pos-uploads/${tenant.id}/${branchId}/...` (ruta string en DB, no Cloudflare R2 durable). Auth/DB mockeados en pruebas de ruta (4 tests). | V1/V2 parcial (4 pruebas de ruta; storage R2 durable y workflow completo en INV-01.d/EVI). |
| **INV-01.b4.ui** | `app/dashboard/inventory/sales-entry/sales-entry-client.tsx`, `tests/support/sales-entry-browser-server.ts`, `tests/e2e/sales-entry-feedback.spec.ts`, `tests/playwright-sales-entry.config.ts` | **Navegador y CSS Reales**: Playwright en Chromium headless, servidor Vite efímero con `@/app/globals.css` compilado, layout móvil (390×844) y teclado. | Backend HTTP sintético: `page.route("**/api/inventory/sales-entry/bulk")` intercepta peticiones y retorna payloads JSON mockeados. Sin sesión ni DB en el navegador. | V1/V3 parcial (9/9 pruebas Playwright aprobadas; integración real API/DB en INV-01.d). |
| **INV-01.b4** | Padre integrador de captura/importación | Writer atómico común y servicio de ingestión compartidos por las 3 fronteras. | No se acepta como padre hasta que el almacenamiento durable y la integración con sesión/DB reales estén acreditados en INV-01.d. | Pendiente de cierre global. |

---

## 2. Ejecuciones de Verificación A1

### A. Pruebas Unitarias Focales (10 archivos, 124 tests)
```powershell
pnpm.cmd exec vitest run --configLoader bundle `
  tests/unit/inventory/sales-entry-smart-link.test.ts `
  tests/unit/inventory/sales-entry-bulk.test.ts `
  tests/unit/inventory/sales-entry-access.test.ts `
  lib/services/__tests__/sales-ingest-service.test.ts `
  lib/services/__tests__/sales-ingest-revisions.test.ts `
  lib/services/__tests__/sale-consumption-contract.test.ts `
  lib/services/__tests__/sale-consumption-delta.test.ts `
  lib/services/__tests__/sale-consumption-snapshot.test.ts `
  tests/unit/faltantes-traceability.test.ts `
  tests/unit/migration-manifest.test.ts `
  --maxWorkers=1 --pool=threads
```
- **Resultado:** `10 passed (10 files), 124 passed (124 tests), exit 0`. Duración: 19.09s.

### B. Pruebas de Integración PostgreSQL Runtime (1 archivo, 17 tests)
```powershell
powershell -Command "$env:NODE_OPTIONS='--use-system-ca'; pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/sale-consumption-application-db.test.ts --maxWorkers=1 --pool=threads"
```
- **Resultado:** `1 passed (1 file), 17 passed (17 tests), exit 0`. Duración: 200.45s.
- **Entorno:** Rama aislada `br-round-voice-belheola`, rol `pulso_app`, 2 empresas, 3 sucursales, aislamiento serializable, rollback limpio de fixtures.
- **Casos verificados:**
  1. Bloqueo de movimientos huérfanos sin revisión que demuestre consumo (`PENDING_RECOVERY`).
  2. Importación sin ingreso, repetición idempotente, corrección y completitud de ingreso sin duplicar consumo.
  3. Captura manual atómica: rollback de lote completo ante stock insuficiente o receta ajena.
  4. Ingestión resuelve nombres bajo runtime, rechaza receta ajena/ambigua y revierte grupos sin stock.
  5. Permiso de nombre (0141) mantiene RLS sin contexto y entre empresas; DML denegado (42501).
  6. 10→12 descuenta 2; 12→8 devuelve 4; repetir no mueve stock; anular devuelve a lotes originales.
  7. Cambiar receta devuelve al lote original incluso vencido y actualiza proyecciones.
  8. Conserva otros productos/fuentes de la misma receta al corregir un solo origen.
  9. Corrección monetaria no mueve stock; conserva definición previa hasta rebase explícito.
  10. Stock insuficiente revierte devoluciones previas al faltante.
  11. Error capturado por llamador no deja media revisión en transacción.
  12. Fallo de revisión tras proyectar venta revierte stock, movimientos, venta e identidad.
  13. Deniega revisión obsoleta, receta ajena y sucursal de otra empresa.
  14. No adopta venta legacy sin consumo ni procedencia alterada.
  15. No transforma ingreso histórico desconocido en cero ni descuenta otra vez.
  16. Rechaza precisión/ingreso/versión inválidos y desbordamiento de ingreso agregado.
  17. Exige snapshot serializable antes de leer o escribir datos de venta.

### C. Pruebas E2E en Navegador Aislado (Playwright Chromium, 9 tests)
```powershell
pnpm.cmd exec playwright test --config tests/playwright-sales-entry.config.ts
```
- **Resultado:** `9 passed (9 tests), exit 0`. Duración: 38.4s.
- **Casos verificados:**
  1. Distingue altas, correcciones y repetición sin atribuir otra salida de stock.
  2. Muestra ingreso incompleto y filas con error en vez de éxito total.
  3. Conserva errores de fila de HTTP 400 y permite corregir/reintentar.
  4. Muestra todos los errores de vista previa y bloquea archivo sin grupos válidos.
  5. El resultado queda ligado al archivo, sucursal y día que lo produjeron.
  6. Bloquea cambios y duplicación de envío mientras espera al servidor.
  7. Sin indicador de cobertura no afirma ingreso completo.
  8. Errores largos se pueden abrir en móvil (390×844) sin desbordar la página.
  9. Un archivo nuevo invalida mapeo opcional que ya no existe y borra resultado anterior.

### D. Trazabilidad y Validación Documental
```powershell
pnpm.cmd exec tsx scripts/validate-faltantes.ts
```
- **Resultado:** `rows: 239, planTasks: 86, children: 90, acceptedTasks: 15, errors: 0, exit 0`.

### E. Lint Focal
```powershell
pnpm.cmd exec eslint app/api/inventory/sales-entry/route.ts app/api/inventory/sales-entry/bulk/route.ts app/api/workflows/smart-links/upload-pos/route.ts app/dashboard/inventory/sales-entry/sales-entry-client.tsx lib/services/sales-ingest-service.ts tests/unit/inventory/sales-entry-access.test.ts tests/unit/inventory/sales-entry-bulk.test.ts tests/unit/inventory/sales-entry-smart-link.test.ts tests/integration/sale-consumption-application-db.test.ts tests/e2e/sales-entry-feedback.spec.ts tests/support/sales-entry-browser-server.ts
```
- **Resultado:** `0 errors, 0 warnings, exit 0`.
- **Ajuste realizado:** Se limpió la variable `error` no usada en el bloque `catch` de `app/api/inventory/sales-entry/route.ts` (línea 139), resolviendo la advertencia preexistente.

### F. Git Diff Check
```powershell
git diff --check
```
- **Resultado:** `exit 0` (sin errores de sintaxis, trailing whitespace ni conflictos).

---

## 3. Brechas Demostradas y Tratamiento

1. **Advertencia de ESLint en GET manual:**
   - Brecha: `app/api/inventory/sales-entry/route.ts:139` definía `catch (error)` sin usar la variable `error`.
   - Corrección: sustituido por `catch` sin binding (sintaxis moderna ES2019/TS). Linter focal queda en 0 advertencias.
2. **Límites de Almacenamiento en Smart Link (`upload-pos`):**
   - El almacenamiento de archivos POS continúa como path sintetizado (`pos-uploads/...`). Integrar storage durable de R2 requiere coordinación con el catálogo de evidencia (Frente C / EVI-02) y turno de schema si requiere columna/tabla adicional; se mantiene fuera de A1 según la directiva.
3. **HTTP/Auth Sintéticos en Fronteras:**
   - Las pruebas de rutas bulk y smart-link verifican la lógica de validación, permisos y mapeo, pero usan dobles de sesión (`getSession`, `requireAuth`). La aceptación integrada con sesión y endpoints vivos se mantiene asignada a `INV-01.d`.

---

## 4. Estado de Aceptación Recomendado para Consolidación (S)

- **INV-01.b4b.rls:** `código implementado; V2 comprobada`. No marcar aceptado en main hasta aplicación formal de migración 0141 en lote OPS-03.
- **INV-01.b4b:** `código implementado; V1/V2 focales comprobadas`. No marcar aceptado en el checklist general hasta propagación de cobertura canónica a lectores legacy.
- **INV-01.b4.manual:** `código implementado; V1/V2 focales comprobadas`. Lote atómico y guardias de sucursal/tenant confirmadas.
- **INV-01.b4.bulk:** `código implementado; V1/V2 parcial comprobada`.
- **INV-01.b4.smartlink:** `código implementado; V1/V2 parcial comprobada`. Storage durable POS pendiente.
- **INV-01.b4.ui:** `código implementado; V1/V3 aislada comprobada`. 9/9 Chromium exit 0.
- **INV-01.b4 (padre):** `en curso / código implementado`. Conservar dependencias pendientes hasta acreditación integrada en `INV-01.d`.
