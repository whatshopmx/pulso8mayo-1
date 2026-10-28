# OPS-02.nomina.C — consumidores de nómina en tesorería

Base `9304929`; 2026-10-28. Tres archivos de código/pruebas. Adaptación local del lote de cuatro tablas de nómina; no es el rollout RLS de todo el dominio financiero.

## Implementación

- Pendientes de nómina: corrida, recibos y referencias programadas se consultan en una transacción con contexto de empresa.
- Validación PAYROLL directa: abre una transacción con empresa. Si recibe el ejecutor del alta, fija el contexto en ese mismo ejecutor; no abre una transacción anidada.
- Alta de partida: fija contexto antes del FOR UPDATE de la nómina. El bloqueo permanece hasta guardar partida y total, o hasta revertir ambos. El importe sigue siendo el autoritativo existente, no el enviado por el cliente.
- Detalle: la consulta de la nómina referenciada lleva contexto y filtro explícito de empresa; una referencia histórica ajena queda sin detalle.
- Layout: consulta recibos bajo contexto, enlazando empresa de nómina y empleado. Descifra fuera de esa transacción y conserva los importes/DTO existentes. Excluye referencias ajenas aunque estén guardadas en partidas históricas. Si una nómina propia tiene un recibo con empleado ajeno, conserva esa fila sin datos personales/bancarios para que la validación de CLABE excluya toda la nómina y no emita transferencias parciales.

GET `/api/finance/treasury/payroll/unpaid` ya exigía reports:read FINANCIAL y usaba la empresa del contexto de permisos. No requiere cambios de producción: la prueba llama al handler real y al servicio SQL real con permisos simulados, ignora companyId de query y comprueba el DTO. No acredita autenticación, auditoría ni red HTTP completas.

## Pruebas

| Ejecución | Resultado | Registro |
|---|---|---|
| RED, antes de adaptar servicio | 3 fallos: pendientes vacíos y nómina propia invisible en validación/detalle | [red.log](red.log) |
| Runtime focalizado C, primera aceptación | 5/5, exit 0 | [runtime.log](runtime.log) |
| RED de nómina parcial | 1 fallo: ocultar el recibo inconsistente emitía una transferencia parcial | [red-partial.log](red-partial.log) |
| Regresiones focalizadas de tesorería/programación/aguinaldo | 72/72, exit 0 | [focused.log](focused.log) |
| Regresiones tras corregir firma del ejecutor | 72/72, exit 0 | [focused-final.log](focused-final.log) |
| Integración conjunta A/B/C y recuperación | 37/37, exit 0 | [integration.log](integration.log) |
| Integración final, incluye rechazo de nómina parcial | 38/38, exit 0; seis casos C | [integration-final.log](integration-final.log) |
| Suite unitaria global concurrente con build | 2229 passed, 20 failed, 1 skipped, 1 todo; 177 archivos aprobados y 2 fallidos, exit 1 | [unit-full.log](unit-full.log) |
| Suite global final, después del build y del ajuste de layout | 2230 passed, 19 failed, 1 skipped, 1 todo; 178 archivos aprobados y 1 fallido, exit 1 | [unit-final.log](unit-final.log) |
| Seed aislado, sin build/integración concurrentes | 1/1, exit 0, 42.99 s | [seed-isolated.log](seed-isolated.log) |
| ESLint inicial y final de los tres archivos | exit 0, sin errores; tres advertencias previas en treasury-service: branchId sin uso y dos any | [lint.log](lint.log), [lint-final.log](lint-final.log) |
| Build final con TypeScript, heap 6144 MB | exit 0, 430 páginas generadas | [build.log](build.log) |

El runtime usa pulso_app preaprovisionado sin superuser/bypass ni membresía del propietario, dos pools max=1 y políticas privadas de contrato en las cuatro tablas. Se agregan payment_runs/payment_run_items como fuentes privadas sin RLS para ejercitar estos consumidores. Verifica dos empresas, handler de pendientes, monto autoritativo, rechazo cruzado, detalle/layout históricos, rollback provocado tras el bloqueo y competencia de dos altas por una sola obligación. El fixture unitario admite set_config sin emular RLS; el aislamiento se acredita con PostgreSQL.

La primera suite global registró los 19 fallos preexistentes de `tests/unit/inventory/production-fefo-db.test.ts`, archivo no versionado que se deja intacto, y un timeout de 120000 ms en seed-integration mientras corrían build e integración. El seed pasó aislado sin cambiar código ni timeout. La suite global final, ejecutada después del build, volvió a 2230 passed/19 fallos FEFO y aprobó el seed. Se conservan los registros originales; no se presenta la suite global como verde ni se excluyen pruebas.

El build inicial compiló, pero TypeScript rechazó el ejecutor parcial de la validación PAYROLL. Se corrigió la firma para exigir la transacción completa que necesita setTenantContext, sin casts ni supresiones. [Registro inicial, exit 1](build-initial.log).

El build final pasa con TypeScript y conserva los mensajes existentes de deprecación fetchConnectionCache y uso dinámico de headers en documentos laborales. El heap de 6144 MB se fija sólo para ese proceso, sin cambiar configuración del proyecto.

La revisión posterior agregó el caso del recibo con empleado ajeno en una nómina propia. El segundo build se interrumpió para incorporar esa corrección y no se considera validación final. [Registro interrumpido](build-interrupted.log). El layout mantiene esa fila sin datos bancarios mediante joins por empresa; la validación existente rechaza la nómina completa.

CLABE y banco son datos sintéticos, con descifrado simulado. No acredita el cifrado de PII ni la aceptación de este layout por un banco. La generación sólo devuelve texto en memoria: no se realizan transferencias, CFDI ni notificaciones.

## Límites y revisión

Conserva la base de percepciones que usa hoy tesorería; netos/deducciones, snapshot económico y conciliación siguen en NOM-05. No se modifican transiciones, firmas, liquidaciones ni los demás tipos de partida.

No aplica migraciones compartidas ni altera roles. E conserva la migración definitiva; F / AGU-03C.3 conserva la aceptación completa HTTP/job con políticas finales. Las políticas privadas y estas pruebas no cierran esos criterios ni OPS-03.

Revisión del diff: filtros parametrizados por empresa, contexto local a transacción, bloqueo y escrituras del alta en la misma conexión, sin persistir ajustes de sesión ni introducir una transacción anidada al validar PAYROLL.
