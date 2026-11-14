# Operación y retroceso del módulo contable (FC-20)

Guía operativa para activar, monitorear, recuperar y desactivar de forma reversible la contabilidad integrada por empresa (`companyId`).

## 1. Activación gradual por empresa

La activación combina una bandera de entorno global (`ACCOUNTING_POSTING_ENABLED=1`, `ACCOUNTING_REVIEW_ENABLED=1`) y el estado por empresa en `accounting_company_settings`:

1. **Preparación previa (estado `DISABLED`):**
   - Configurar catálogo de cuentas (`accounting_accounts`), vínculos de centros/bancos (`accounting_source_links`), vínculos de adquirentes (`accounting_gateway_links`) y reglas versionadas (`accounting_rules`).
   - Validar apertura contable en modo **vista previa** antes de publicar:
     ```bash
     npx tsx scripts/accounting-opening-preview.ts --company-id <UUID> --actor-id <USER_ID> --file apertura.json
     ```
   - Confirmar que `ready: true`, totales cuadrados en centavos, sin pólizas `POSTED` en o antes de `openingDate`, y revisar `historicalExcluded` (operaciones históricas en o antes de `openingDate` que quedan excluidas del reproceso contable).
2. **Publicación de apertura:**
   - Solo un usuario con alcance `COMPANY`, `settings:update` y `accounting:publish` puede ejecutar `--publish` (o `createOpening`).
3. **Modo comparación (`COMPARISON`):**
   - Llamar `activateCompanyPilot(ctx, { mode: "COMPARISON", postingEnabled: true, reviewEnabled: true })`.
   - El P&L operativo sigue siendo consultable sin reemplazo silencioso; las diferencias entre P&L operativo, resultado contable y flujo realizado se miden por causa (`ESTIMACION`, `FECHA`, `FUENTE`).
4. **Operación activa (`ACTIVE`):**
   - Tras validar el primer cierre del piloto con el responsable contable (FC-21), promover a `mode: "ACTIVE"`.

## 2. Prevención de solapamiento histórico

- Ninguna operación con fecha contable `<= openingDate` se encola ni se recupera automáticamente (`recordAccountingEventIn` y `recoverMissingAccountingEvents` omiten fechas en o antes de la apertura).
- Las guardas SQL de `0130` impiden publicar pólizas operativas en o antes de `openingDate`.
- El histórico operativo previo permanece consultable en los módulos de origen.

## 3. Medición de salud por empresa

`measureCompanyPilotMetrics(ctx, { fromDate, toDate })` expone por empresa (sin datos bancarios sensibles ni documentos completos en logs):

- **Backlog:** `pendingCount`, `oldestPendingAt` y `maxAgeSeconds`.
- **Fallos:** `failedCount` y agrupación `recentErrors` por mensaje seguro.
- **Latencia de contabilización:** `postedCount` y `avgPostingSeconds`.
- **Diferencias:** puente P&L operativo vs resultado contable vs flujo realizado (`operationalToAccountingDeltaCents`, `unexplainedAccountingToCashCents`, totales por categoría `ESTIMACION`, `FECHA`, `FUENTE`).

## 4. Recuperación ante caídas o fallos

1. Si un worker falla entre escritura operativa y publicación contable, el hecho permanece en `accounting_events` (`status = 'PENDING'`, `attempts`, `last_error`, `next_attempt_at`).
2. `accountingRecoverySweep` (Inngest) y `recoverMissingAccountingEvents(companyId)` detectan hechos elegibles posteriores a `openingDate` sin duplicar pólizas gracias a la unicidad `(company_id, source_type, source_id, event_type, source_version)`.
3. Un operador autorizado (`COMPANY` + `accounting:publish`) puede reintentar un hecho específico con `retryAccountingEvent(ctx, eventId)` una vez corregida la regla o vínculo faltante.

## 5. Retroceso seguro (desactivación)

Para detener el piloto de una empresa sin pérdida de datos:

1. Ejecutar `disableCompanyPilot(ctx, { reason: "<motivo auditado>" })` (cambia `mode = 'DISABLED'`, `postingEnabled = false`, registra `disabledBy`, `disabledAt` y `disableReason`).
2. **Efecto inmediato:**
   - `recordAccountingEventIn` deja de crear nuevos hechos en `accounting_events`.
   - `dueAccountingEvents`, `recoverMissingAccountingEvents`, `processAccountingEvent` y el cron `accountingPost` detienen el procesamiento de esa empresa.
   - Toda la evidencia previa (`accounting_events`, `accounting_journals`, `accounting_openings`, `accounting_period_closes`) se conserva intacta.
3. **Prohibido como mecanismo de retroceso:** borrar masivamente pólizas publicadas o hechos de outbox; cualquier corrección contable sobre pólizas ya publicadas se realiza mediante reversa vinculada.
4. Si se requiere apagado global inmediato de plataforma, establecer `ACCOUNTING_POSTING_ENABLED=0` y `ACCOUNTING_REVIEW_ENABLED=0` en el entorno y redesplegar.
