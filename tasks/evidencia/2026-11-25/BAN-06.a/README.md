# BAN-06.a — Aceptar conciliación de depósitos existente

Fecha: 2026-11-25. Base: `732a815136f0273ee267e564eb58a53fe6fa4548` + árbol local.

## Cambios y verificación

- **Detección explícita de depósito agrupado y runtime aislado (`lib/services/bank-statement-service.ts`):**
  - `suggestDepositMatches` y `confirmDepositMatch` aceptan `dbInstance` opcional para ejecución transaccional bajo `SET LOCAL ROLE pulso_app` (`NOBYPASSRLS`).
  - Cuando un depósito positivo no tiene candidato 1-a-1 pero coincide con la suma de un subconjunto de ≥2 liquidaciones sin cruzar en la misma cuenta/ventana, `suggestDepositMatches` devuelve `candidates: []` y `pendingReason: "GROUPED_DEPOSIT_UNSUPPORTED"`, manteniéndolo explícitamente `UNMATCHED` sin fabricar un vínculo 1↔N.
- **V2 (Neon aislado):** `tests/integration/ban06a-deposit-reconciliation-db.test.ts` — **2/2**, exit 0:
  1. Bajo `pulso_app` (`NOBYPASSRLS`) con `0167`+`0169`: `suggestDepositMatches` sugiere sin mutar estado (`UNMATCHED`) y etiqueta `GROUPED_DEPOSIT_UNSUPPORTED`; `confirmDepositMatch` rechaza cuenta destino distinta (`400`), neto inexacto (`400`), empresa ajena (`404`) y repetición (`409`); el depósito agrupado permanece `UNMATCHED`.
  2. Carrera concurrente real en PostgreSQL con dos conexiones simultáneas compitiendo por la misma fila `gateway_transactions`: **1 ganador y 1 `409 Conflict`**, 1 único cruce persistido y limpieza verificada.
- **V3 HTTP + parser:** `tests/unit/finance/ban06a-deposit-reconciliation-http.test.ts` (`2/2`) + `lib/services/__tests__/bank-statement-service.test.ts` (`26/26`) = **28/28**, exit 0.
- **ESLint:** exit 0, 0 errores y 0 advertencias.

## Límites

- La corrección auditada de un depósito ya contabilizado (`GATEWAY_SETTLEMENT`) corresponde al siguiente ticket (`BAN-06.b`). Destraba `BAN-06.b` y `FIN-06.a`.
