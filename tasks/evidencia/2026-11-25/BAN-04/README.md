# BAN-04 — Aceptar matching de egresos

Fecha: 2026-11-25. Base: `732a815136f0273ee267e564eb58a53fe6fa4548` + árbol local.

## Cambios y correcciones

- **Atomicidad, RLS y carreras en `lib/services/bank-statement-service.ts`:**
  - `confirmMatch` y `unmatchTransaction` ahora ejecutan bajo `withCompanyContext` (o `dbInstance` inyectado para pruebas `pulso_app`), adquieren `pg_advisory_xact_lock(hashtextextended(companyId, 602))`, validan monto negativo en egresos y aplican cerrojo optimista (`WHERE match_status = 'UNMATCHED'` / `'MATCHED'`) devolviendo `409 Conflict` ante repeticiones o carreras concurrentes.
  - Deshacer un cruce de egreso (`unmatchTransaction`) solo limpia `bank_transactions` (`UNMATCHED`, `matched_payment_run_item_id = NULL`) y **jamás revierte** la confirmación manual (`payment_run_items.settlement_status = 'CONFIRMED'` ni `settlement_reference`), manteniendo separadas la liquidación manual y la conciliación bancaria.

## Verificación V2 y V3

- **V2 (Neon aislado):** `tests/integration/ban04-outflow-matching-db.test.ts` — **2/2**, exit 0:
  1. Bajo `pulso_app` (`NOBYPASSRLS`) con `0167_sec05_tesoreria_rls.sql`: bloqueo `400` sobre partida `PENDING`, confirmación `MATCHED` sobre partida `CONFIRMED`, `409` en repetición o segundo movimiento sobre la misma partida, deshacer conserva `payment_run_items` (`CONFIRMED` + `SPEI-MANUAL-100`), `409` al repetir deshacer y aislamiento RLS `404` entre empresas.
  2. Carrera concurrente real en PostgreSQL con dos conexiones simultáneas: `Promise.allSettled` en `confirmMatch` produce **1 ganador y 1 `409 Conflict`** (1 única fila `MATCHED`); `Promise.allSettled` en `unmatchTransaction` produce **1 ganador y 1 `409 Conflict`**; limpieza de fixtures verificada.
- **V3 HTTP + parser:** `tests/unit/finance/ban04-outflow-matching-http.test.ts` (`2/2`) + `lib/services/__tests__/bank-statement-service.test.ts` (`26/26`) = **28/28**, exit 0.
- **ESLint:** exit 0, 0 errores y 0 advertencias.

## Checkpoint 3.1

Con `SEC-05.tesoreria`, `BAN-01` y `BAN-04` aceptados V2/V3 en entorno aislado, queda cerrado **Checkpoint 3.1** y desbloqueado **`NOM-05`** (enlace de nómina aprobada con tesorería para cerrar Puerta 2).
