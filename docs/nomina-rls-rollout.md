# OPS-02.nomina — Mapa previo a activar RLS

2026-10-26. Preparación documental, sin políticas activadas ni cambios de rol. Fuente del entorno: manifiestos de OPS-01. El operativo conecta como dueño con bypass y no tiene pulso_app; la base aislada sí tiene pulso_app sin superuser/bypass, pero las cuatro tablas todavía no tienen políticas.

## Tablas del lote

| Tabla | Frontera requerida |
|---|---|
| payroll_runs | company_id igual al contexto transaccional |
| payroll_payslips | La corrida padre pertenece a la empresa del contexto; validar también escrituras/cambios de run_id |
| payroll_aguinaldo_dispersiones | company_id del contexto y coherencia con la corrida cuando run_id no es NULL |
| cfdi_nomina_timbrados | company_id del contexto; conservar unicidad/fingerprint por empresa/RFC/período |

No introducir una política cuyo único filtro sea user_id ni confiar en company_id enviado por el cliente HTTP. La empresa viene del contexto de permisos o del evento/job autorizado.

## Consumidores comprobados

| Archivo | Operaciones que requieren adaptación |
|---|---|
| lib/services/aguinaldo-payroll-service.ts | Precheck, autorización de run/recibos, historial, bitácora manual y listado |
| lib/services/aguinaldo-run-execution.ts | Lectura inicial, finalización de recibos, bitácora y cierre bajo bloqueo breve |
| lib/services/aguinaldo-fiscal-delivery.ts | Adquirir/reutilizar intención fiscal y guardar respuesta; liberar conexión antes del PAC |
| lib/services/fiscal-service.ts | Consulta de comprobantes y persistencia ordinaria; el recorrido extraordinario también usa el protocolo durable |
| lib/services/payroll-service.ts | Creación/cierre de corrida ordinaria y persistencia de recibos |
| lib/services/treasury-service.ts | Lectura/bloqueo del documento PAYROLL, pendientes, detalles y layout. Los helpers que reciben tx necesitan fijar contexto en esa misma transacción; evitar transacciones anidadas o q=db sin alcance. |
| lib/inngest/functions/cron-aguinaldo-reminder.ts | Enumeración de empresas y lectura de corridas por empresa con contexto explícito; no hacer lectura multiempresa esperando bypass |
| app/api/finance/treasury/payroll/unpaid/route.ts | Delegación al servicio: conservar empresa de sesión y probar respuesta con runtime real |

CodeGraph devolvió la definición de payrollRuns, pero no los callers conocidos de timbrarNomina ni el conjunto de referencias. Para completar este mapa se consultaron las referencias literales de las cuatro tablas y sus nombres SQL en app/lib, y se leyeron los consumidores concretos. No se interpreta el resultado incompleto del índice como ausencia de consumidores.

## Incrementos antes de activar

1. **NOMINA-A:** protocolo fiscal/consumidor de recuperación con transacciones breves y pruebas; no mantener conexión ante el PAC.
2. **NOMINA-B:** autorización/historial/bitácora de aguinaldo y nómina ordinaria, separando hijos si código+tests supera cinco archivos.
3. **NOMINA-C:** lecturas/bloqueos de tesorería con contexto en el tx real y regresiones HTTP/layout.
4. **NOMINA-D:** cron/job por empresa, sin depender de sesión ni de bypass. Revisar también OWNER (no existe en el enum de roles) y el lenguaje que equipara corrida COMPLETED con dispersión; AGU-04 conserva esa aceptación funcional.
5. **NOMINA-E:** generar/revisar la migración aditiva de políticas y grants del rol preaprovisionado; inventariar el nuevo lote en OPS-01. No crear credenciales en SQL versionado ni aplicar al operativo.
6. **NOMINA-F / AGU-03C.3:** pruebas con login runtime real, propietario separado, sin superuser/bypass ni membresía que conceda propiedad. Aplicar las políticas reales del lote en el entorno de aceptación: dos empresas, consultas HTTP/job, pool max=1, pérdida del contexto entre transacciones, raw SELECT sin contexto sin filas y escrituras rechazadas. Correr también preview→autorización→recibo, reintento e incertidumbre fiscal sin duplicados.

Cada hijo hereda pruebas de rollback, concurrencia y dos empresas; el padre no cierra por agregar withCompanyContext a un único recorrido. Las correcciones de importes netos de tesorería pertenecen a NOM-05: adaptar el contexto no acredita por sí mismo esa integración económica.

OPS-03 conserva el aprovisionamiento/activación del entorno operativo, con revisión del manifiesto, respaldo recuperable y sanity checks posteriores. No basta ejecutar las pruebas bajo el dueño, ni clonar tablas sin aplicar políticas, para cerrar AGU-03C.3.
