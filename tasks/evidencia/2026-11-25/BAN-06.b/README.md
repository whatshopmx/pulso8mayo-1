# BAN-06.b — Resolver corrección auditada de un depósito contabilizado

Fecha: 2026-11-25. Base: `45a4cadfd2a45c87f9307e5fd4f0fb3e1515d9ed` + árbol local.

## Implementación

- **Reutilización del contrato de reversa FC-12 + auditoría atómica `AUD-02` (`lib/services/bank-statement-service.ts`):**
  - `correctAccountedDepositMatch`: adquiere `pg_advisory_xact_lock(hashtextextended(companyId, 601))`, exige `actorId` y `reason` obligatorios (≥5 caracteres), verifica versión optimista (`expectedVersion`) e inexistencia de reversa previa (`accounting_journals.reversal_of_id`), genera y publica atómicamente la póliza de reversa con líneas invertidas vía `insertJournalLines` + `postInTransaction`, libera una sola vez `bank_transactions` (`WHERE match_status = 'MATCHED' AND matched_gateway_transaction_id = $gwId`), **jamás borra `accounting_events` ni la póliza original**, y registra auditoría crítica obligatoria `AUD-02` (`AuditService.logCriticalConfigChange` con `fieldName: "DEPOSIT_CORRECTION"`) en la misma transacción.
  - `unmatchDepositTransaction` acepta `dbInstance` opcional y conserva el bloqueo `409` ante cualquier depósito con hecho contable `GATEWAY_SETTLEMENT`.
- **Frontera HTTP (`app/api/finance/bank-transactions/route.ts`):** `PATCH` con acción `CORRECT_DEPOSIT_MATCH` bajo `requirePermissionApi("reports", "update", { classification: "FINANCIAL" })`, validando `reason` (≥5 caracteres), `accountingDate?` y `expectedVersion?`.

## Verificación V2 y V3

- **V2 (Neon aislado `pulso_app` NOBYPASSRLS con triggers reales FC-08/FC-11/FC-12 + `0167`+`0169`):** `tests/integration/ban06b-deposit-correction-db.test.ts` — **1/1**, exit 0:
  - Deshacer ingenuo bloqueado (`409`); motivo corto (`400`) y versión obsoleta (`409`) rechazados.
  - Corrección auditada crea reversa `POSTED` con líneas invertidas, conserva el hecho `accounting_events` y la póliza original intactos, libera `bank_transactions` a `UNMATCHED` y persiste auditoría `AUD-02` (`DEPOSIT_CORRECTION`) en `config_change_logs`.
  - Repetir corrección rechaza con `409` (nunca libera saldo dos veces); empresa ajena recibe `404` por RLS; rollback limpio verificado.
- **V3 HTTP + parser:** `tests/unit/finance/ban06b-deposit-correction-http.test.ts` (`2/2`) + `lib/services/__tests__/bank-statement-service.test.ts` (`26/26`) = **28/28**, exit 0.
- **ESLint:** exit 0, 0 errores y 0 advertencias.

## Checkpoint 3.2

Con `BAN-05`, `BAN-06.a` y `BAN-06.b` aceptados en entorno aislado, queda cerrado **Checkpoint 3.2** (**105 aceptados / 0 errores**), destrabando `FIN-06.a` → `FIN-06.b` → `FIN-01` para cerrar Puerta 3.
