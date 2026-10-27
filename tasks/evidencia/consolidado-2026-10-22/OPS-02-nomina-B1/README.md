# OPS-02.nomina.B.1 — Autorización e historial de aguinaldo bajo contexto

2026-10-27. Base `c39767d`. Incremento separado de fiscal ordinario y de corridas/recibos ordinarios (B.2/B.3).

## Cambio

Precheck, autorización atómica de cabecera/recibos, historial y listado de bitácora usan `withCompanyContext`. La bitácora manual valida al empleado y escribe en la misma transacción con contexto de empresa/actor. Configuración y cálculo permanecen fuera de esa transacción; ninguna espera del PAC queda dentro de ella.

La simulación unitaria sólo marca el commit de autorización cuando hay escrituras, para no confundir el nuevo precheck de lectura con persistencia confirmada. La barrera del ensayo previo C.2 se desplaza a la segunda transacción (autorización), manteniendo la carrera real después del precheck.

## RED y aceptación

El nuevo recorrido inicial runtime falló al insertar payroll_runs por política RLS (42501), sin contexto. Tras la adaptación pasó con fuentes SQL privadas, dos empresas e historial/bitácora separados. Las regresiones de servicio/snapshots pasaron 39/39; primera ampliación B.1 4/4.

Se amplía el ensayo runtime existente con fuentes privadas de plantilla, contratos, configuración, regla fiscal, turnos y permisos. Se sustituye sólo la caché Next para forzar lectura SQL; el cálculo, snapshot, protocolo fiscal y contexto son reales. Las fuentes no protegidas del lote conservan los filtros de aplicación; las cuatro tablas del dominio mantienen políticas privadas de contrato y login pulso_app sin bypass, superuser ni membresía del dueño, con dos conexiones/pool max=1.

Se verifican autorización de dos empresas con el mismo RFC/año, historial/bitácora por empresa, bitácora manual con rechazo de empleado ajeno, rollback de la corrida y dos recibos antes del PAC, reintento con otro autorizador y carrera forzada con un solo ganador/timbre. Los oráculos de enero 2026 siguen en centavos: bruto 900000, exento 339420, gravado 560580, ISR 119731, neto 780269 y excedente 450000.

Sólo se crean/otorgan permisos sobre tablas/esquemas privados de TEST_DATABASE_URL y se eliminan al terminar. No se alteran políticas de public, roles ni migraciones operativas; no hay CFDI ni mensajes reales. B.2/B.3, lote definitivo E, aceptación HTTP/job F y AGU-03C.3 permanecen pendientes.

## Resultados

- `pnpm.cmd run test:integration tests/integration/aguinaldo-runtime-recovery-db.test.ts tests/integration/aguinaldo-recovery-db.test.ts`: **25/25, exit 0**, [log](integration.log). Son seis aceptaciones runtime de A, cuatro de B.1 y las quince anteriores de recuperación/recorrido inicial. El caso de rollback final incluye dos empleados y dos recibos. `NODE_OPTIONS=--use-system-ca` sólo en el proceso.
- `pnpm.cmd run test:unit lib/__tests__/aguinaldo-payroll-service.test.ts lib/__tests__/aguinaldo-snapshot-execution.test.ts`: **39/39, exit 0**.
- Lint de los cuatro archivos de código/test afectados: **exit 0**, sin errores ni advertencias, [log](lint.log).
- `pnpm.cmd run test:unit --maxWorkers=2`: **177 archivos aprobados / 1 fallido; 2223 passed / 19 failed / 1 skipped / 1 todo; exit 1**, [log](unit.log). Los fallos siguen concentrados en el archivo local preexistente `tests/unit/inventory/production-fefo-db.test.ts`, que no se modificó ni excluyó. No se declara verde la suite general.
- Build con TypeScript y 430 páginas: **exit 0**, [log](build.log), `pnpm.cmd run build` con heap de 6144 MB sólo en el proceso y red autorizada para Geist. Logs guardados como UTF-8 con espacios finales normalizados.

Revisión: se conserva la validación fiscal previa, el índice único por empresa/año, la autorización atómica, la huella fiscal y los importes originales. El precheck de lectura no mantiene abierta la conexión durante la preview. La configuración manual se consulta antes del callback transaccional para evitar una consulta por el pool global mientras se sostiene su única conexión; la validación del empleado y la escritura usan el mismo tx.
