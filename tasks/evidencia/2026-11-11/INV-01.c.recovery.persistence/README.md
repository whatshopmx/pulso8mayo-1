# INV-01.c.recovery.persistence — Expediente y decisión inmutables

Continuación 2026-11-13. HEAD inicial `5a05fb992c813031cacf4209a1bc37e525e56931`, con diff previo compartido. Scope de cinco archivos: `lib/db/schema.ts`, `drizzle/0143_inv01c_recovery_review.sql`, snapshot `0143`, journal y `tests/integration/sale-recovery-persistence-db.test.ts`. No se hace commit automático de trabajo de otras sesiones.

## Persistencia implementada

`sale_recovery_proposals` guarda venta legada, empresa/sucursal, clave idempotente por empresa, solicitante/motivo, hashes y JSON congelado del expediente. El envelope SQL obliga a concordar IDs, solicitante, motivo y clave con las columnas y requiere entre 3 y 100 referencias de evidencia. Estas comprobaciones básicas SQL **no sustituyen** el contrato completo `prepareSaleRecoveryReview`, ni prueban que los hashes correspondan al JSON o que sus evidencias hayan sido descargadas. El futuro servicio deberá calcularlos y verificar contenido desde registros del servidor; la prueba SQL usa envelopes mínimos deliberadamente para aislar constraints.

`sale_recovery_decisions` admite una decisión final APPROVED/REJECTED por propuesta. Su FK compuesta enlaza ID, empresa, sucursal, ambos hashes y solicitante al mismo expediente; no se puede aprobar otro hash o inventar otro solicitante para eludir la separación de actor. La decisión exige otra persona, rol administrativo declarado y fecha posterior o igual a la creación del expediente. Rechazo también es un hecho final inmutable: para revisar nuevo estado o evidencia se necesita otra propuesta y clave.

Ambas tablas tienen RLS habilitada y forzada, sin lectura en ausencia de contexto, filtros de empresa/sucursal y mínimo SELECT/INSERT para `pulso_app` si ya existe. El `WITH CHECK` de propuesta exige venta legada y sucursal propias. Triggers bloquean UPDATE/DELETE incluso con conexión dueña ordinaria; runtime carece además de UPDATE/DELETE/TRUNCATE. El timeline se comprueba mediante trigger invoker, sin SECURITY DEFINER. No se alteran privilegios sobre tablas existentes, roles, ventas, revisiones ni stock.

## Verificación

RED: la suite falló antes de fixtures porque aún no existía la migración 0143. Tras generar SQL/snapshot/journal con `pnpm.cmd exec drizzle-kit generate --name inv01c_recovery_review` y añadir FORCE RLS, triggers y privilegios mínimos, **7/7 pruebas SQL pasaron** (exit 0, 46.41 s).

Comando: `NODE_OPTIONS=--use-system-ca pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/sale-recovery-persistence-db.test.ts --maxWorkers=1 --pool=threads`.

Entorno aislado existente: proyecto `soft-cloud-50478212`, rama `br-round-voice-belheola`, host verificado `ep-cold-morning-bewqoz3o.c-9.us-east-2.aws.neon.tech`, distinto de `.env`. Rol runtime existente `pulso_app` comprobado NOBYPASSRLS y NOSUPERUSER. No se registran credenciales. Cada caso crea migración completa y fixtures de dos empresas/tres sucursales dentro de una transacción, ejecuta runtime con `SET LOCAL ROLE` y provoca rollback. Al salir se comprueba que ambas tablas no existan. **0143 no quedó aplicada ni en la rama aislada ni en main.**

Casos: falta de contexto, consultas sin WHERE con scope de empresa/sucursal, FORCE RLS y mínimo de privilegios, persistencia/lectura aislada de aprobación y rechazo, idempotencia/hashes/envelope, FK de estado/solicitante/sucursal, empresa ajena, autoaprobación/rol insuficiente/timeline, doble decisión, venta legada lateral y bloqueo de UPDATE/DELETE bajo runtime y dueño. Resultados de regresión/tipos/lint/build/trazabilidad al cierre en `results.json`.

Regresión final: **18/18 SQL** en tres archivos (identidad, aplicación-schema y persistencia), exit 0, 92.56 s; **62/62 unitarias** en cinco archivos, exit 0. TypeScript global y lint focal exit 0, con tres advertencias previas de imports en schema. Diff check exit 0. Validador documental con `node --experimental-strip-types scripts/validate-faltantes.ts`: 239 filas, 82 hijos, cero errores. El intento con tsx no arrancó por ENOMEM durante build simultáneo; se ejecutó el mismo script directamente con Node 22. Build del incremento con heap de 4 GB y red autorizada terminado exit 0, log `build.txt`; resultado terminal comprobado al continuar la sesión 14485. Valida el modelo persistido y el writer previo a la corrección de movimientos huérfanos del checkpoint INV-B3. El build del incremento anterior (objetos) terminó exit 0 y quedó registrado en su evidencia.

## Límites

Modelo de almacenamiento implementado; ningún registro se consume como autorización operativa. Falta el servicio que carga estado/evidencias propios, verifica sesión/rol/capacidad vigentes del aprobador, comprueba bytes y calcula hashes, persiste desde el servidor y revalida estado bajo lock antes de aplicar. El rol declarado en la fila no acredita por sí mismo la membresía real del usuario; los timestamps de pruebas son sintéticos. Faltan API/UI, reparación auditada/idempotente, rollback de aplicación y carreras. No se acepta INV-01.c.recovery, INV-01.c, INV-01.b ni la fila 11.11 con esta migración.
