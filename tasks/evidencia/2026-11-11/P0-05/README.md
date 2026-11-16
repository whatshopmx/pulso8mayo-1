# P0-05 — Coordinación bancaria y contable

Estado: aceptado, verificación D. Fecha: 2026-11-11.
HEAD: `ba88018d2cbd7d879549cfe6476d39e4addfd5d2` y diff local inventariado en P0-01. Entorno de revisión local; no se certifica el entorno de la cuenta anterior.

| Frente | Responsable/estado comprobable | Propiedad y siguiente paso |
|---|---|---|
| FC-12 | Trabajo local previo y concurrente del frente contable; autor de cada cambio no inferido. Su checklist registra pruebas y controles finales; en la última lectura el build definitivo seguía pendiente. | Conservar adaptador, servicios y migración 0136. La continuación de faltantes no modifica estos archivos ni marca FC-12 terminado. |
| Circuito bancario | [Plan activo](../../../plan.md); existen cuentas/importación, matching de salidas y depósitos. | BAN-01/04/06 aceptan contratos existentes; nuevas correcciones se coordinan con el hecho contable. |
| Faltantes | Esta continuación ejecuta P0 y prepara el entorno solicitado por el propietario. | INV-01 empieza después de P0-03/SEC-00; banca conserva sus dependencias SEC-05.tesoreria y P0-05. |

Contratos compartidos:

- Empresa, sucursal, capacidad y actor se conservan desde HTTP/job hasta la transacción. No reutilizar un resultado de propietario como prueba runtime.
- La confirmación bancaria y `settleConfirmedTransactionIn` comparten transacción cuando corresponde. Identidad empresa/fuente/hecho/versión e idempotencia pertenecen al contrato existente.
- Un depósito con hecho contable no admite `unmatch` ordinario. BAN-06.b debe resolver corrección auditada conservando hechos; no se habilita borrado ni se duplica el adaptador.
- «Reportado por pasarela» y «conciliado con banco» son dimensiones distintas. FIN-06.a conserva esa separación; un test con cero documentado no acredita conciliación bancaria externa.
- Dinero en centavos, cuenta vinculada y fecha de depósito separados de fecha de venta. El puente contable/operativo sigue en FC-18.

Archivos reservados para edición secuencial: `drizzle/meta/_journal.json`, `lib/db/schema/accounting.ts`, `bank-statement-service.ts`, `commission-service.ts`, `accounting/settlement-adapter.ts`, `accounting/event-service.ts`, `accounting/account-service.ts`, `payroll-service.ts`, `pnl-service.ts` y operating-config. Abrir el ticket y renovar HEAD/diff antes de tocarlos.

Evidencia reutilizable: [registro FC-12](../../../finanzas-contabilidad/todo.md#fc-12--continuación-del-borrador-local-2026-11-11), [investigación](../../../../docs/2026-11-11-investigacion-plan-faltantes.md), [baseline de partida](../P0-01/baseline.json). Las cifras de FC-12 son evidencia heredada indicada como tal; no se reejecutaron aquí para declarar su cierre.

Durante la continuación cambiaron los hashes del adaptador y del checklist contable. La última lectura registra una corrección para un segundo banco y evidencia adicional (17 casos de liquidaciones y controles globales); son trabajo concurrente, no entregas de este frente. No se congeló ni sobrescribió ese diff. Renovar esta lectura al abrir BAN-06.b/FIN-06.

Renovación durante INV-01.b3: aparecieron `accounting/purchase-contract.ts`, `purchase-adapter.ts`, `0140_fc13_purchases.sql` y snapshot/journal del frente FC-13. El build de inventario compiló, pero su comprobación TypeScript global falló en `purchase-contract.ts:13` por literales BigInt bajo target ES2017. [Captura y hash](../INV-01.b3/global-build-failure.txt). Se preservó ese trabajo; no se modificó su contrato, target ni migración. Inventario aplicó únicamente 0139 en la rama aislada antes de aparecer 0140; el journal de esa rama sigue en 0139 y main en 0136 según SELECT posteriores. B3/b3a conservan pruebas V2 y aceptación pendiente del gate global. No se atribuye FC-13 a esta continuación ni se afirma que su responsable terminó.

La base nueva recibió un baseline del esquema local, incluido FC-12 sin commit, exclusivamente por la nueva solicitud de instalación. Esto no demuestra aplicación de 0136 en la cuenta anterior, aceptación funcional de FC-12 ni despliegue de la aplicación. Ver [NEON-NEW](../NEON-NEW/README.md).

Comprobación D: lectura de ambos planes/checklists y contratos; `pnpm.cmd exec tsx scripts/validate-faltantes.ts`, exit 0. No se enviaron mensajes a otros responsables ni se inició trabajo paralelo sobre archivos compartidos.


Renovación 2026-11-14 — atestaciones: se preservan los cambios concurrentes de Nómina/Tesorería, incluida 0146. El TypeScript global de esta continuación falla con TS2345 en `lib/services/treasury-service.ts:726` (executor DB|Tx pasado a helper que requiere Tx); [captura](../INV-01.c.recovery.attestation.service/typecheck-final.txt). No se amplió ni convirtió ese contrato para forzar el gate. La comparación completa 0144→0145 muestra únicamente `public.sale_recovery_attestations`; [delta](../INV-01.c.recovery.attestation.schema/migration-delta.json). 0145 se prueba exclusivamente dentro de rollback aislado, sin aplicar a main. Los incrementos se registran como código implementado, sin aceptación ni build global nuevo.
