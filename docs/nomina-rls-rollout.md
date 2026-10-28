# OPS-02.nomina — Mapa previo a activar RLS

2026-10-26; actualizado 2026-10-27. Fuente del entorno: manifiestos de OPS-01. El operativo conecta como dueño con bypass y no tiene pulso_app; la base aislada sí tiene pulso_app sin superuser/bypass, pero las cuatro tablas de public todavía no tienen políticas. OPS-02.nomina.A adapta el protocolo y la recuperación y acredita ese recorrido con login runtime y políticas exclusivamente privadas de prueba. No se activan políticas ni se cambian roles operativos.

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
| app/api/payroll/[id]/payslips/route.ts | B.3 implementado: reports:read FINANCIAL con auditoría READ y empresa explícita de sesión al servicio de recibos. |

CodeGraph devolvió la definición de payrollRuns, pero no los callers conocidos de timbrarNomina ni el conjunto de referencias. Para completar este mapa se consultaron las referencias literales de las cuatro tablas y sus nombres SQL en app/lib, y se leyeron los consumidores concretos. No se interpreta el resultado incompleto del índice como ausencia de consumidores.

## Incrementos antes de activar

1. **NOMINA-A — completo local:** protocolo fiscal/consumidor de recuperación con transacciones breves y pruebas; no mantiene conexión ante el PAC. Runtime 6/6; integración conjunta 21/21; focalizadas 51/51; lint/build con TypeScript exit 0. [Evidencia y límites](../tasks/evidencia/consolidado-2026-10-22/OPS-02-nomina-A/README.md). Las políticas son privadas de contrato; el lote definitivo y HTTP/job completo siguen en E/F.
2. **NOMINA-B — completo local:** autorización/historial/bitácora de aguinaldo y nómina ordinaria, dividido en tres incrementos. No activa RLS operativo ni cierra E/F.
   - **B.1 completo local:** autorización/historial/bitácora de aguinaldo; integración conjunta 25/25, focalizadas 39/39 y lint/build con TypeScript exit 0. [Evidencia](../tasks/evidencia/consolidado-2026-10-22/OPS-02-nomina-B1/README.md).
   - **B.2 completo local:** consulta/reutilización/persistencia fiscal ordinaria con runtime 4/4, focalizadas 12/12, lint/build TypeScript exit 0. [Evidencia](../tasks/evidencia/consolidado-2026-10-22/OPS-02-nomina-B2/README.md). Conserva el protocolo ordinario existente; su durabilidad sigue en NOM-04.
   - **B.3 completo local:** corridas/listados/recibos ordinarios y caller HTTP con empresa explícita. Integración conjunta 32/32, contrato API 7/7, lint/build con TypeScript exit 0; suite global 2230 passed y 19 fallos FEFO preexistentes. [Evidencia y límites](../tasks/evidencia/consolidado-2026-10-22/OPS-02-nomina-B3/README.md).
3. **NOMINA-C:** lecturas/bloqueos de tesorería con contexto en el tx real y regresiones HTTP/layout.
4. **NOMINA-D:** cron/job por empresa, sin depender de sesión ni de bypass. Revisar también OWNER (no existe en el enum de roles) y el lenguaje que equipara corrida COMPLETED con dispersión; AGU-04 conserva esa aceptación funcional.
5. **NOMINA-E:** generar/revisar la migración aditiva de políticas y grants del rol preaprovisionado; inventariar el nuevo lote en OPS-01. No crear credenciales en SQL versionado ni aplicar al operativo.
6. **NOMINA-F / AGU-03C.3:** pruebas con login runtime real, propietario separado, sin superuser/bypass ni membresía que conceda propiedad. Aplicar las políticas reales del lote en el entorno de aceptación: dos empresas, consultas HTTP/job, pool max=1, pérdida del contexto entre transacciones, raw SELECT sin contexto sin filas y escrituras rechazadas. Correr también preview→autorización→recibo, reintento e incertidumbre fiscal sin duplicados.

Cada hijo hereda pruebas de rollback, concurrencia y dos empresas; el padre no cierra por agregar withCompanyContext a un único recorrido. Las correcciones de importes netos de tesorería pertenecen a NOM-05: adaptar el contexto no acredita por sí mismo esa integración económica.

OPS-03 conserva el aprovisionamiento/activación del entorno operativo, con revisión del manifiesto, respaldo recuperable y sanity checks posteriores. No basta ejecutar las pruebas bajo el dueño, ni clonar tablas sin aplicar políticas, para cerrar AGU-03C.3.

## Contrato B.3 implementado

GET `/api/payroll/[id]/payslips` conserva la ruta y el DTO de éxito. Obtiene la empresa desde `requirePermissionApi('reports','read', {classification:'FINANCIAL'})`, igual que GET `/api/payroll`; un companyId de query/body no puede seleccionar otra empresa. El único caller de `getPayrollPayslips` localizado está en esta ruta: se actualizó junto con la firma interna requerida `getPayrollPayslips(companyId, runId)`, sin fallback sin contexto.

IDs inválidos se rechazan con 400, sesión/permiso con 401/403 y corrida ausente/ajena con 404. Una corrida propia sin recibos conserva 200 con arreglo vacío. Las lecturas de hijos se enlazan con el padre y la empresa; la validación del padre y consulta de recibos ocurren en la misma transacción. Las pruebas de propagación API y SQL/runtime se registran por separado; no sustituyen la aceptación HTTP/job completa de F.
