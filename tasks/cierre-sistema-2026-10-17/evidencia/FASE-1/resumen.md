# Fase 1 — Evidencia de implementación (2026-10-17)

HEAD de partida: `e95291ca1bbd830e2ba060f503696fa7598c83cf`. Cambios en working
tree, sin commit al momento de esta evidencia. Hashes en `hashes-fase1.txt`.

Comandos de verificación:

```
npx vitest run --configLoader bundle tests/unit/maintenance-create-access.test.ts \
  tests/unit/workflow-evidence-access.test.ts \
  tests/unit/inventory/sales-entry-access.test.ts \
  tests/unit/inventory/receiving-batch-ownership.test.ts \
  tests/unit/inventory/receiving-idempotency.test.ts \
  tests/unit/inventory/receiving-atomicity.test.ts \
  tests/unit/inventory/receiving-overcount-diagnostic.test.ts
# → 7 archivos, 24 pruebas aprobadas (unit-fase1.log)

npx vitest run --configLoader bundle
# → 133 archivos, 1652 aprobadas, 1 omitida, 1 pendiente

npx tsx scripts/diag-receiving-overcount.ts   # sólo lectura
# → rec03-diagnostico-dryrun.txt

npx eslint <archivos tocados>                 # 0 errores, sólo warnings preexistentes
```

## SEC-01 — Alta general de mantenimiento

`app/api/equipment/maintenance/route.ts`. El `POST` aceptaba `equipmentId` del
cuerpo y escribía sin verificar empresa/sucursal ni rol; además fijaba
`lastMaintenanceDate = now()` al **programar**. Ahora usa
`equipmentService.getEquipmentInScope` (404 fuera de empresa, 403 fuera de
alcance), exige rol de mando, toma empresa/sucursal/autor del servidor y no
toca `lastMaintenanceDate` (sólo lo fija el cierre real). El `GET` también pasa
a filtrar por empresa y alcance.

## SEC-02 — Consulta de evidencia

`app/api/workflows/evidence/route.ts`. El `branchId` salía del query y era
opcional, así que un `EMPLEADO` veía evidencia de otros. Ahora: (1) alcance de
sucursal resuelto con `resolveBranchScope` (a GERENTE/SUPERVISOR se les fija su
sucursal; `NONE` devuelve vacío); (2) un `EMPLEADO` sólo ve instancias asignadas
a él o pasos que él completó; (3) la URL firmada se deriva después del filtro,
así que la descarga respeta el mismo alcance.

## SEC-03 — Venta legacy

`app/api/inventory/sales-entry/route.ts`. Exige `inventory:manage` (misma regla
que la importación bulk), resuelve la sucursal con `resolveBranchScope`,
`assertBranchOfCompany` y valida que **todas** las recetas sean de la empresa
antes de la primera escritura. El `GET` también queda acotado por empresa y
alcance.

## REC-01 — Un único dueño del incremento

`lib/services/inventory-service.ts` (`createReceivingBatch`) +
`receiving-service.ts` + `workflow-action-runner.ts` +
`app/actions/inventory-transactions.ts`. El lote nace en `currentQuantity = 0`
y sólo el movimiento `RECEIVING` lo incrementa; se devuelve el saldo ya
aplicado y el movimiento. Recibir 10 deja 10.

## REC-02 — Atomicidad e idempotencia

- **REC-02a**: columna `receiving_reports.idempotency_key` + índice único
  `(company_id, idempotency_key)` (migración `drizzle/0100_green_excalibur.sql`,
  **generada, no aplicada**). Replay antes de escribir; carrera resuelta por
  23505 → se recupera la fila ganadora; clave de otra sucursal → 409. El
  extractor de workflow usa `wf-receiving:<instanceId>` para que un reintento de
  Inngest no duplique la recepción.
- **REC-02b**: `processReceiving` ejecuta reporte, lotes, movimientos, líneas,
  avance de OC y conciliación de factura en **una transacción**. Alertas de
  precio, lecturas térmicas, incidentes, reclamos y notificaciones se ejecutan
  después del commit. `createReceivingBatch`, `updateItem`,
  `recordReceivedQuantity` y `perform3WayMatch` aceptan el `tx`.

## REC-03 — Diagnóstico histórico

`scripts/diag-receiving-overcount.ts` (sólo lectura por defecto) clasifica cada
lote de recepción con saldo ≠ ledger. Resultado sobre la base configurada:
**4 lotes** → 2 `ATTRIBUTABLE` (EXPIRED, delta = lo recibido) y 2 `AMBIGUOUS`
(AVAILABLE, con consumo posterior; van a conteo físico). La corrección
(`--apply --actor=<uuid> --yes`) inserta un `ADJUSTMENT` trazable y marcado, es
idempotente y **no se aplicó**.

## Pendiente para cerrar la puerta 1

1. `tsc --noEmit` y `pnpm run build` (este último bloqueado por el fetch de
   Google Fonts en esta máquina; no es del código).
2. Prueba contra DB real de rollback y de dos peticiones simultáneas con la
   misma clave (los tests actuales son unitarios con mocks).
3. Aplicar y verificar la migración `0100` en base aislada antes de desplegar.
4. Decidir con el responsable si se aplican los 2 ajustes `ATTRIBUTABLE` y
   agendar el conteo de los 2 `AMBIGUOUS`.
