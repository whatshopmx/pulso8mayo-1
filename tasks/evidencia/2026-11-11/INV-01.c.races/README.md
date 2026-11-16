# INV-01.c.races — Concurrencia real y protección histórica

Continuación 2026-11-13. HEAD inicial `fddc05dd92255d3b816b12e83e074eb31d95d57b` más diff compartido existente. Alcance de implementación: un archivo nuevo de integración, sin modificar código productivo, migraciones ni configuración del proyecto. Se conserva el trabajo contable concurrente. Estado: cinco casos nuevos comprobados V2; hijo no aceptado mientras INV-01.b siga sin aceptar. La reparación histórica de INV-01.c permanece pendiente.

## Aislamiento y método

Se verificó con Neon que `.env.test` apunta al endpoint `ep-cold-morning-bewqoz3o.c-9.us-east-2.aws.neon.tech`, rama `br-round-voice-belheola`, proyecto `soft-cloud-50478212`; distinto del host operativo. El test fija ese endpoint permitido antes de escribir fixtures. Comprueba que pulso_app tiene rolbypassrls=false y rolsuper=false.

El servicio de producción se importa con una conexión Drizzle/Pool autenticada como pulso_app. Solo se sustituye la dependencia de conexión: aplicación, savepoint, snapshot, planificador, movimiento, proyección y reintentos son el código real. La instrumentación de transaction consulta current_user, transaction_isolation y pg_backend_pid y coordina una barrera. Las dos transacciones toman snapshot antes de competir por el lock. Las cuatro carreras de aplicación exigen observar al menos dos PIDs iniciales distintos y un tercer intento; así no se atribuye concurrencia a un recorrido serial de una sola conexión.

Para que una conexión vea el commit de la otra, estas fixtures se confirman. Se conservan los hechos sintéticos append-only y su runId en la rama aislada; no son datos operativos. Cada ejecución crea UUIDs nuevos para dos empresas y sus sucursales, recetas, ingredientes y lotes. Se comprueba que el lote de la segunda empresa conserva 20.0000. [Manifiesto inicial](initial-run.json) y [manifiesto final](run.json) registran los identificadores; el final añade estados de venta/revisión/movimiento y saldos. No se limpian hechos inmutables desactivando protecciones. La regresión de aplicación conserva sus fixtures con rollback como antes.

## Casos comprobados

1. Dos altas idénticas: una aplica y otra repite; una revisión, un movimiento, venta 10.00 y stock 10.0000 desde 20.
2. Dos correcciones 10→12 y 10→8 con expectedRevision=1: una aplica y la otra devuelve REVISION_CONFLICT; el head ganador, venta e ingreso concuerdan y stock+cantidad=20.
3. Dos productos 4 y 3 de la misma receta/día: dos hechos de consumo, proyección 7.00/700 centavos y stock 13.0000, sin pérdida de agregado.
4. Dos días que solicitan 15 del mismo lote de 20: una aplicación y un INSUFFICIENT_STOCK; solo una revisión/movimiento y saldo 5.0000.
5. Una venta legacy de 1.00/100 centavos, sin consumo demostrado: dos solicitudes devuelven PENDING_RECOVERY, conservan la proyección y stock, y no dejan identidad, revisión ni movimientos. Este caso valida detección/bloqueo, no recuperación.

## Resultados y comandos

- Primera caracterización: 4/4 carreras, exit 0, sin cambios del writer.
- Final: `NODE_OPTIONS='--use-system-ca' pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/sale-consumption-concurrency-db.test.ts tests/integration/sale-consumption-application-db.test.ts --maxWorkers=1 --pool=threads`: **21/21 en dos archivos**, exit 0, cinco casos nuevos y dieciséis regresiones. [Resumen](integration-output.txt).
- Tipado focal del test y dependencias, extendiendo el tsconfig real sin cambiar target ES2017: `NODE_OPTIONS='--max-old-space-size=4096' pnpm.cmd exec tsc --noEmit --project .tmp/tsconfig-inv01-c.json`, exit 0. El primer intento detectó un callback de instrumentación sin tipo; se anotó Tx explícitamente. No era un error del writer.
- ESLint del archivo: exit 0. Trazabilidad y diff finales registrados en results.json.
- Validador final: 239 filas, 79 hijos, doce aceptaciones anteriores, cero errores, exit 0. Se convirtió INV-01.c a padre y se materializó el hijo recovery pendiente para no mezclar aceptación de carreras con reparación. Un reintento intermedio del validador falló por ENOMEM; el resultado final se obtuvo después y se conserva. `git diff --check`: exit 0.
- No se reejecuta build de aplicación porque este incremento añade pruebas y documentación; no cambia producción. El último build del incremento UI permanece como evidencia histórica, sin atribuirle la compilación de este archivo de tests (excluido del tsconfig global).

## Pendientes

No se acepta el padre ni la fila 11.11. Falta el camino auditado de reparación histórica con evidencia suficiente, su idempotencia y su recorrido autorizado. [Contrato pendiente](recovery-contract.md). Las pruebas no autorizan borrar una venta legada para hacerla pasar por el writer, inferir consumo de una receta actual ni usar ausencia de movimientos como prueba de consumo cero. API/UI integrada sigue en INV-01.d; lectores financieros legacy y políticas por dominio mantienen sus tickets propios.
