# Historia de vacaciones — persistencia y orden de publicación

Fecha: 2026-11-23. Preparación local de `NOM-02.c1.history.schema`; adopción operativa pendiente. Contrato y secuencia en el [plan de historia](../../plans/2026-11-23-vacation-history.md).

Se separan aperturas verificadas (`vacation_history_streams`) y hechos (`vacation_history_events`). Una corrección de apertura añade un sucesor del último stream, sin borrar el anterior. La identidad empresa/empleado es inmutable y forma parte de las FKs del stream, sucesor y reversa. Las formas permitidas de cada evento se comprueban en SQL; las decisiones fijan las fechas/días del origen aprobado y las cancelaciones apuntan a esa aprobación.

RLS/privilegios por sí solos no impiden retrofechar columnas de auditoría ni garantizan inmutabilidad del propietario. El trigger de inserción exige actor del contexto y autorización vigente, bloquea por empresa/empleado, bloquea las identidades consultadas y vuelve a comprobar autoridad. La base impone `recorded_at` y `record_version`. El rol dedicado recibe SELECT/INSERT y ejecución del predicado privado; se revocan permisos de PUBLIC y permisos heredados del rol sobre las tablas/secuencia nuevas. No obtiene lectura de usuarios/sucursales ni uso directo de la secuencia.

Las tablas nuevas usan FORCE RLS. La lectura corporativa queda en empresa; gerente/supervisor/lector se vinculan a la sucursal real del sujeto dentro de esa empresa y el empleado a lo propio. La gestión de créditos/aperturas corresponde a roles corporativos. Decidir exige además estado, actor, fechas y sucursal del origen; no basta conocer el UUID. No se concede lectura sin actor a `pulso_app` en este historial. Las excepciones de superusuario/BYPASSRLS y el hecho de que TRUNCATE no está sujeto a RLS se describen en [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html); por eso existen también guardas contra UPDATE/DELETE/TRUNCATE. No se pretende impedir cambios DDL por un administrador de base.

## Manifiesto de lectura

Un timestamp de inserción puede preceder al commit. Por tanto el futuro lector capturará `knownAt` y `throughVersion` bajo el mismo bloqueo de empleado y conservará ambos en su manifiesto. La versión se asigna después del bloqueo y el lector limitará stream/eventos por esa versión; no reinterpretará versiones posteriores como parte de un corte anterior. Es una decisión de aplicación apoyada en los [bloqueos transaccionales de PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS).

La secuencia no representa un contador continuo ni, por sí sola, el orden de commits: sus cambios no se revierten al abortar una transacción, según [aislamiento y secuencias](https://www.postgresql.org/docs/current/transaction-iso.html). Se admiten huecos. La captura y las escrituras deben seguir el protocolo de bloqueo; exponer solo `knownAt` o asignar la versión como DEFAULT antes del bloqueo no cumple este contrato. El replay puro recibe la proyección ya limitada por el manifiesto.

## Límites

La candidata es aditiva y no reconstruye historia a partir de balances actuales. Una referencia textual no verifica automáticamente un documento ni define derechos legales: administración/apertura requieren todavía el flujo de autoridad y evidencia del escritor. Tampoco se han conectado los eventos a la misma transacción de las rutas operativas ni retirado el fallback de saldos mutables del cálculo de nómina. Esas integraciones, su invalidación de borradores y sus recorridos con sesión/navegador siguen pendientes.
