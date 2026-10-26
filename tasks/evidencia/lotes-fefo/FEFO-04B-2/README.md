# FEFO-04B-2 — Envío de transferencias con elegibilidad común

Fecha: 2026-10-26. Dependencias: FEFO-03, 04A y 04B-1 completadas. Dividido en integración/pruebas (04B-2a: 3 archivos) y cierre documental (04B-2b: evidencia, plan y checklist). No se aplicaron migraciones ni correcciones históricas.

**Cerrado.** Código/pruebas en `ed7a196`; el cierre documental se guarda por separado. Continúa FEFO-04B-3 (producción). FEFO-04 completo y Checkpoint 2 permanecen abiertos.

## Comportamiento implementado

`InventoryService.shipTransfer` usa `allocateScopedBatches` para selección FEFO y lote explícito dentro de la transacción de envío. Empresa de producto y sucursal, producto, estado AVAILABLE, fecha vigente y saldo positivo se comprueban con el mismo motor; un lote explícito inválido no se sustituye. Fecha nula con política desconocida queda bloqueada.

El envío reclama la cabecera mediante UPDATE condicionado a APPROVED y `shipped_at IS NULL`; si no obtiene fila, devuelve conflicto antes de descontar. También rechaza un marcador de envío previo aunque una reaprobación haya vuelto a poner APPROVED. Lee las cantidades aprobadas después del reclamo; ordena líneas por producto/ID y el allocator toma locks de lotes en orden de ID. No se envían transferencias vacías ni cantidades no positivas.

Cada asignación descuenta el saldo y registra un TRANSFER por la misma cantidad, actor y referencia. El faltante elegible provoca 409 y revierte cabecera, líneas, saldos y movimientos de **todo** el envío, incluidas líneas previas. Un fallo real al insertar kardex también revierte el descuento. Se mantiene el lote primario esperado por el lector de recepción actual; conservar el desglose completo en destino corresponde a FEFO-07A/B.

## Pruebas y revisión

- RED inicial: `pnpm run test:unit tests/unit/inventory/transfer-fefo-db.test.ts --maxWorkers=1`: **18 casos fallaron y 4 pasaron** con el código previo. Demostró consumo automático de vencido, aceptación de explícitos bloqueados/ajenos/inexistentes, saldo negativo por faltante explícito y ausencia de conflicto HTTP apropiado.
- RED adicionales: dos pruebas reprodujeron transferencia vacía y uso de una aprobación leída antes del reclamo; otra reprodujo doble descuento tras reaprobar una transferencia ya enviada. Todas se escribieron antes de sus respectivas guardas.
- Verificación enfocada final: `pnpm run test:unit tests/unit/inventory/transfer-fefo-db.test.ts tests/unit/inventory/transfer-scope.test.ts tests/unit/inventory/fefo-allocator-db.test.ts tests/unit/inventory/batch-allocation-policy.test.ts --maxWorkers=1`: **92/92 aprobadas**, 4 archivos, código 0. Incluye 30 casos de envío SQL/HTTP, 15 casos anteriores de alcance y 47 de motor/consulta común.
- Dos casos de `transfer-scope.test.ts` se migraron al archivo SQL: recorrido exitoso origen→destino con dos movimientos y una creación en destino; gerente del origen 200/destino 403 sin escritura. Se conservaron y reforzaron sus aserciones sobre datos reales, sin simular joins ni FOR UPDATE. No se eliminó cobertura para ocultar fallos del simulador.
- Fixture con Drizzle/PGlite real, PK y tipos `numeric(12,4)`/integer del esquema; FK y NOT NULL relajadas sólo para sembrar referencias corruptas. No conecta a DATABASE_URL. Los snapshots verifican rollback de cabecera, líneas, lotes y kardex.
- Casos: reparto 0.4 + 0.6 = 1, vencido AVAILABLE sin cron, igualdad al límite, fecha nula, cuarentena/reserva/agotado/estado nulo, empresa/producto/sucursal incompatibles, explícito inexistente, faltante automático/expreso, varias líneas, inserción de movimiento rechazada por CHECK real, reclamo sin fila, cambios de aprobación en la frontera del reclamo, reintento/reaprobación y contrato HTTP 403/409/200.
- `pnpm exec eslint lib/services/inventory-service.ts tests/unit/inventory/transfer-fefo-db.test.ts tests/unit/inventory/transfer-scope.test.ts`: código 0, **0 errores y 2 advertencias preexistentes** de `inventory-service.ts` (import `companies` y `any` en actualización de costos), fuera del bloque modificado.
- `pnpm run test:unit --maxWorkers=1 --reporter=dot`: **175 archivos aprobados, 2,204 pruebas pasadas, 1 skipped y 1 todo preexistentes**, código 0; duración 355.51 s. No se agregaron exclusiones. El incremento neto es 28 casos: 30 SQL/HTTP nuevos menos los 2 casos trasladados desde el simulador.
- Build posterior al código final: `$env:NODE_OPTIONS='--max-old-space-size=3072'; pnpm run build`, con acceso de red autorizado: **código 0**, TypeScript aprobado y **430/430 páginas** generadas. Compilación: 4.3 minutos. Se ejecutó después de terminar la suite, sin builds/suites propios simultáneos. Conserva los avisos previos de `fetchConnectionCache` y ruta dinámica `/dashboard/labor/documents`; no se omitieron comprobaciones.
- `git diff --check` y `git diff --cached --check`: código 0. Sólo avisos de normalización LF/CRLF.
- Revisión independiente conforme a `code-review-and-quality`: sin hallazgos requeridos.

## Límites

El esquema sigue usando enteros para requested/approved/shipped/received de cada línea. El reparto fraccionario probado ocurre **entre lotes**, sumando una cantidad de línea entera; no se declara soporte de líneas fraccionarias. FEFO-07A/B resolverán ese esquema, el desglose de origen, caducidades/costos de destino, parciales y diferencias de recepción. No se modificó `receiveTransfer`.

Las pruebas PGlite no demuestran contención entre conexiones PostgreSQL independientes. Los triggers de prueba reproducen una modificación de aprobación en la frontera de reclamo y el rechazo de un UPDATE; no son una demostración de una carrera real. La idempotencia general de operaciones, el resto de transiciones de transferencia y la concurrencia entre conexiones siguen en FEFO-05A/07. No se considera este envío un cierre de FEFO-04 completo.

Producción y consumo teórico conservan el allocator anterior hasta FEFO-04B-3/4. No se modificaron políticas persistidas, stock del demo, migraciones ni despliegues.
