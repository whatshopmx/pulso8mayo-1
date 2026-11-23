# `INV-01.c.recovery.ui-routes`, `INV-01.c.recovery` y cierre de `INV-01.c`

2026-11-22. Base `05016efdd9d184b52d90192c56d8464bf5669127`, build de producción `BUILD_ID: 3uHsQamaXwpx8-UdKZkBZ`.

**Registros aceptados en entorno aislado (60 → 63 aceptados):**
- **`INV-01.c.recovery.ui-routes`** (V1, V2, V3)
- **`INV-01.c.recovery`** (V2 — todas sus 16 dependencias acreditadas)
- **`INV-01.c`** (padre P — todos sus hijos acreditados)

Siguen abiertos `INV-01.d` y la fila `11.11`.

## Evidencia ejecutada

| Capa | Comando | Resultado |
| --- | --- | --- |
| V1 unitarias rutas/diálogo | `node node_modules/vitest/vitest.mjs run --configLoader bundle lib/services/__tests__/sale-recovery-proposals-route.test.ts tests/unit/inventory/sale-recovery-attestations-route.test.ts tests/unit/inventory/sale-recovery-evidence-route.test.ts --maxWorkers=1 --pool=threads` | **25/25** (incluidos en los 97/97 de `sale-recovery`), `exit 0` |
| V3 Playwright controlado | `node node_modules/@playwright/test/cli.js test --config tests/playwright-sale-recovery.config.ts` | **4/4** Chromium, `exit 0`, 1.2 min |
| V2/V3 Next producción + Chromium + Better Auth + Neon desechable + R2 reales | `node .tmp/sale-recovery-next-browser-verify.cjs` (`RUN_SALE_RECOVERY_NEXT_BROWSER=1`) | **1/1**, `exit 0`, 66.22 s (`2026-11-23T00:34:08.162Z`) |
| ESLint prueba integrada | `node node_modules/eslint/bin/eslint.js tests/integration/sale-recovery-next-browser.test.ts` | `exit 0`, sin advertencias |

Detalles estructurados: [next-results.json](next-results.json).

### Recorrido integrado real (`tests/integration/sale-recovery-next-browser.test.ts`)

1. Base desechable `inv_sales_next_73bd14966a28429fb2cbc8b7af061e68` (baseline `0158`) y servidor Next de producción (`BUILD_ID: 3uHsQamaXwpx8-UdKZkBZ`), sin mocks de API, Better Auth, SQL ni R2.
2. Sesión `ADMIN` solicitante (`requester`): sube 3 documentos JSON privados a R2 (`POST /api/inventory/sales-entry/recovery-evidence`, `201` × 3), registra las 3 atestaciones con verificación real de SHA-256 contra R2 (`POST /api/inventory/sales-entry/recovery-attestations`, `201` × 3), abre `/dashboard/inventory/sales-entry` → **Recuperación Histórica** → **Crear expediente**, crea el expediente (`POST /api/inventory/sales-entry/recovery-proposals`, `201`) y verifica la alerta de **Segregación de funciones** sin botones de aprobar/aplicar y con stock intacto (`20.0000`).
3. Sesión `ADMIN` independiente (`reviewer`): consulta el expediente en el diálogo UI, registra aprobación (`POST /api/inventory/sales-entry/recovery-decisions`, `201`), captura motivo `AUD-02` y ejecuta **Aplicar Consumo e Inventario** (`POST /api/inventory/sales-entry/recovery-apply`, `200`).
4. Oráculos SQL independientes tras commit: lote `20.0000` → `17.0000`, `sales_consumption_revisions` con revisión `1`, `inventory_movements` con `-3.0000` y registro en `inventory_audit_log`.
5. Reintento idempotente por API devuelve `200` `{ applied: false, alreadyApplied: true }` manteniendo `17.0000`. Tras `sign-out`, la lectura del expediente devuelve `401`.
6. Limpieza verificada: Chromium y servidor Next cerrados, los 3 objetos R2 del prefijo privado eliminados (`0` remanentes) y base/rol desechables retirados (`databaseCreated: false`, `roleCreated: false`, `closed: true`).

## Límites explícitos

- Las migraciones candidatas (`0143`/`0144`/`0145`) no se aplicaron a la base operativa ni a `main` (quedan para `OPS-03`).
- `INV-01.d` y la fila `11.11` siguen pendientes de su aceptación explícita.
