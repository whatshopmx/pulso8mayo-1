# Evidencia de aceptación — `REC-03B` (Aceptar protocolo de corrección histórica)

- **Fecha:** 2026-11-27
- **Base Git (`HEAD`):** `35515c62f66a49e0b998f531b507c0ebed4dfd4b` (+ cambios locales de `REC-03A` / `REC-03B`)
- **Ticket:** `REC-03B` — *Aceptar protocolo de corrección histórica* (`A / M`, depende de `REC-03A, AUD-02`, verificación `V2, V3`).
- **Estado:** `aceptado` en entorno aislado (`V2, V3`).

## Cambios implementados

1. **Servicio de protocolo `REC-03B` (`lib/services/historical-correction-protocol-service.ts`):**
   - `validateHistoricalCorrectionProtocolInput` y `applyHistoricalCorrectionProtocol` exigen antes de cualquier escritura:
     - **Conteo físico (`countedQuantity`):** debe concordar con el ledger esperado (`COUNT_MISMATCH` → `409` en caso contrario).
     - **Unidad (`unit`):** debe coincidir con `inventory_items.unit` (`UNIT_MISMATCH` → `400`).
     - **Actor y aprobación separada:** `countedBy !== approverId` (`SELF_APPROVAL` → `403`) y `approverRole >= ADMIN` (`INSUFFICIENT_ROLE` → `403`), con verificación estricta de empresa (`SCOPE_MISMATCH` → `403`).
     - **Motivo y respaldo obligatorio:** `reason >= 10` caracteres y `backupReference >= 6` caracteres (`BACKUP_REQUIRED` → `400`), persistidos en auditoría crítica `AUD-02` (`protocol: "REC-03B"`).
     - **Retención de ambiguos e idempotencia:** lotes `AMBIGUOUS` se rechazan con `409` (`NOT_SUFFICIENT`) sin escritura; repetición y concurrencia en 2 conexiones (`FOR UPDATE`) devuelven `ALREADY_CORRECTED` sin duplicar movimiento ni auditoría.
2. **Frontera HTTP (`app/api/inventory/batches/historical-correction/route.ts`):**
   - `GET /api/inventory/batches/historical-correction`: RBAC `inventory:read`, transacción `READ ONLY`, dry-run `REC-03A` acotado a `ctx.userCompanyId`.
   - `POST /api/inventory/batches/historical-correction`: RBAC `inventory:update`, deriva `companyId`, `approverId` y `approverRole` exclusivamente desde la sesión, ejecuta `applyHistoricalCorrectionProtocol` y mapea errores de dominio a `400`/`403`/`404`/`409`.

## Verificación ejecutada

| Tipo | Comando | Resultado |
|---|---|---|
| V1 + V3 HTTP | `node node_modules/vitest/vitest.mjs run tests/unit/inventory/receiving-overcount-revalidation.test.ts tests/unit/inventory/receiving-overcount-diagnostic.test.ts tests/unit/inventory/rec03b-historical-correction-http-v3.test.ts` | **PASS (20/20)** — reglas puras de segregación/rol/respaldo/motivo, `GET` `READ ONLY` + RBAC `403`, `POST` con `400`/`403`/`409`/`200` y replay idempotente. |
| V2 PostgreSQL nativo (base desechable en Neon) | `node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/rec03b-historical-correction-db.test.ts` | **PASS (2/2)** — rechazo sin efectos de falta de respaldo (`400`), unidad errónea (`400`), auto-aprobación (`403`), rol insuficiente (`403`), conteo discordante (`409`), lote `AMBIGUOUS` (`409`) y cruce entre empresas (`403`); aplicación atómica a lote `SUFFICIENT` respaldado con `AUD-02` completo, repetición idempotente y carrera real de 2 conexiones (`APPLIED` + `ALREADY_CORRECTED`) manteniendo el lote ambiguo intacto. |
| ESLint | `node node_modules/eslint/bin/eslint.js lib/inventory/receiving-overcount-revalidation.ts lib/services/receiving-overcount-service.ts lib/services/historical-correction-protocol-service.ts app/api/inventory/batches/historical-correction/route.ts scripts/diag-receiving-overcount.ts tests/unit/inventory/receiving-overcount-revalidation.test.ts tests/unit/inventory/rec03b-historical-correction-http-v3.test.ts tests/integration/receiving-overcount-revalidation-db.test.ts tests/integration/rec03b-historical-correction-db.test.ts` | **PASS (0 errors, 0 warnings)** |
| TypeScript (`tsc`) | `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc --noEmit --incremental false` | **PASS (exit 0, 0 diagnósticos)** |

## Límites explícitos

- Verificado en bases desechables aisladas en Neon (destruidas al terminar). Ningún dato operativo fue alterado; la ejecución operativa requiere respaldo previo del entorno objetivo (`OPS-03`).
- El cierre de filas funcionales de inventario permanece reservado a `VAL-01` / `VAL-03`.
