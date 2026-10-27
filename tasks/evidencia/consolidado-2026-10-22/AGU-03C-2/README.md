# AGU-03C.2 — Recorrido inicial sobre Postgres independiente

2026-10-26. Base `10fb4d0`. Incremento de aceptación de código existente; no modifica servicios productivos.

## Alcance

Se amplía `tests/integration/aguinaldo-recovery-db.test.ts` para usar plantilla, contratos, configuración, reglas fiscales, turnos y permisos desde tablas privadas de Postgres. Sólo se sustituyen la caché de Next, los certificados/personas SAT y el transporte HTTP del PAC. Preview, cálculo, snapshots, transacciones, protocolo durable y consumidor fiscal son reales.

Los escenarios iniciales comparan el oráculo previo de enero 2026 (año causado 2025): bruto 900000, exento 339420, gravado 560580, ISR 119731 y neto 780269 centavos. Se compara preview con snapshot, recibo y conceptos/fecha del payload fiscal. Se comprueban cero manual, bloqueo de subsidio sin acumulados, dos empresas con igual RFC/año y rollback de cabecera/todos los recibos cuando falla uno de dos empleados.

La carrera de autorización usa dos conexiones con pool max=1 y una barrera antes de sus transacciones: ambos pasan el precheck antes de intentar guardar. La unicidad real de Postgres permite una sola autorización y un solo envío; no se simula el resultado SQL.

## Aislamiento y límites

El esquema aleatorio sólo se crea en TEST_DATABASE_URL; antes se compara host/base con las URLs operativas de `.env` y `.env.local`, sin imprimir secretos. Se clonan tablas sin datos mediante LIKE INCLUDING ALL; no se copian FK ni RLS. Las columnas/índice de 0122 se completan exclusivamente en la copia privada si faltan en public. El esquema se elimina al terminar.

No se aplican migraciones operativas, no se emiten CFDI reales ni se envían mensajes. Esta prueba no acredita RLS/rol runtime/contexto HTTP/job (AGU-03C.3), ni habilita el subsidio mensual sin acumulados conciliados. AGU-03 y su puerta permanecen abiertos.

## Verificación

Primera ampliación: 14/14, exit 0. Segunda ampliación con carrera forzada y payload fiscal: 15/15, exit 0 (73.79 s). Ejecución final tras reforzar cero manual y la guarda de entorno: **15/15, exit 0 (74.37 s)**, con `NODE_OPTIONS=--use-system-ca` sólo en el proceso. Comando `pnpm.cmd run test:integration tests/integration/aguinaldo-recovery-db.test.ts`, [log](integration.log). Lint del archivo **exit 0, sin advertencias**, [log](lint.log). No se presenta un RED productivo: es aceptación adicional del comportamiento existente.

Revisión de alcance, rollback, concurrencia y aislamiento completada. No cambia UI ni código productivo; no se repite build por esta ampliación de pruebas. El último build global aprobado y los 19 fallos locales de FEFO se conservan en la evidencia de C.1; no se presentan como una suite global verde.
