# OPS-02.nomina.A — Contexto de empresa en recuperación y entrega fiscal

2026-10-27. Base `da501c8`. En preparación de la activación RLS del dominio; no modifica esquema compartido ni roles.

## Cambio

El protocolo durable adquiere/reutiliza la intención fiscal y guarda su respuesta dentro de transacciones breves con `withCompanyContext`. El consumidor de recuperación usa ese mismo contexto para leer corrida/recibos y para bloquear/finalizar recibo, bitácora y estado. El scope de la entrega fiscal conserva el actor autorizador del snapshot. Ninguna transacción abarca la espera del PAC.

La prueba unitaria que simula el executor incorpora `execute`, necesario para el helper real de contexto. Las pruebas SQL y la nueva aceptación runtime ejecutan el helper real; no se simula el resultado de RLS.

## RED y alcance de aceptación

La prueba inicial con login real pulso_app y RLS privado falló con `RangeError: Corrida no encontrada en esta empresa` en `aguinaldo-run-execution.ts`: sin contexto, el runtime no veía la corrida autorizada. Después del cambio pasó 1/1; regresiones focalizadas 51/51 en cuatro archivos. La primera ampliación runtime pasó 4/4.

El ensayo valida que el rol existente no tiene superuser, bypass ni membresía del dueño, y que las dos conexiones tienen backend distinto y pool max=1. Sólo crea tablas/esquema privados en TEST_DATABASE_URL, previa comparación host/base con las configuraciones operativas. Se clonan estructuras sin datos/FK/RLS y se aplican políticas privadas del contrato del dominio, con filtros de empresa y relación padre/hijo. Los grants se limitan al esquema privado; no se aprovisionan ni alteran roles, no se cambian políticas de public. El esquema se elimina al terminar.

Políticas generadas/aplicadas del lote definitivo, autorización inicial/listados, nómina ordinaria, tesorería, cron y aceptación HTTP/job completa permanecen en OPS-02.nomina.B–F y AGU-03C.3. Esta prueba no los sustituye ni cierra el padre RLS. El PAC HTTP es simulado; no se emiten CFDI reales ni se envían mensajes.

## Resultados

- `pnpm.cmd run test:integration tests/integration/aguinaldo-runtime-recovery-db.test.ts tests/integration/aguinaldo-recovery-db.test.ts`: **21/21, exit 0**, [log](integration.log). Se mantienen las 15 aceptaciones previas y se agregan seis de runtime. `NODE_OPTIONS=--use-system-ca` sólo en el proceso.
- Los seis escenarios nuevos comprueban recuperación completa, dos empresas con el mismo RFC/año y rechazo cruzado, espera del PAC sin conexión/contexto retenidos, respuesta incierta sin reenvío, rollback local de recibo seguido de dos recuperadores que reutilizan un timbre y una sola bitácora, y escritura sin contexto rechazada/recuperación sin empresa bloqueada. Se conservan los oráculos bruto 900000, exento 339420, gravado 560580, ISR 119731, neto 780269 y excedente autorizado 450000 centavos.
- `pnpm.cmd run test:unit lib/__tests__/aguinaldo-payroll-service.test.ts lib/__tests__/aguinaldo-fiscal-delivery.test.ts lib/__tests__/aguinaldo-snapshot-execution.test.ts lib/__tests__/fiscal-aguinaldo-recovery.test.ts`: **51/51, exit 0**.
- Lint de los cuatro archivos de código/test modificados: **exit 0, sin errores ni advertencias**, [log](lint.log).
- Suite general `pnpm.cmd run test:unit --maxWorkers=2`: **177 archivos aprobados / 1 fallido; 2223 passed / 19 failed / 1 skipped / 1 todo; exit 1**, [log](unit.log). Los 19 fallos están en el archivo local preexistente `tests/unit/inventory/production-fefo-db.test.ts`, conservado sin modificar. Ninguna prueba se excluye y la suite global no se declara verde.
- Build con TypeScript: **exit 0**, [log](build.log), `pnpm.cmd run build` con heap de 6144 MB sólo en el proceso y acceso de red autorizado para las fuentes Geist, cuya descarga falló en los intentos restringidos del checkpoint anterior. No se cambia la configuración de fuentes ni se omiten controles.

Revisión del incremento: todos los accesos del protocolo y del consumidor de recuperación usan contexto en su propia transacción; los bloqueos de corrida y la intención durable conservan su alcance anterior. El PAC queda fuera de las transacciones. No se cambian imports/cálculos de la nómina ordinaria, aprobación inicial, políticas de public, tarifas, importes ni estados de emisión incierta.

Cierre local de OPS-02.nomina.A. OPS-02.nomina.B–F, AGU-03C.3 y las puertas de fase permanecen abiertos. Los cambios locales de FEFO se conservaron; no se incluyen en el commit del incremento.
