# Contraste del plan de faltantes contra el sistema

Fecha: 2026-11-11. Plan revisado: `plans/2026-11-11-plan-implementacion-faltantes.md`.

## Conclusión

El plan identifica brechas reales, especialmente nómina, corrección de consumo de ventas y salida de producción a inventario. Sin embargo, no es todavía un inventario completo y actualizado para iniciar todas las fases: subestima código financiero existente, omite migraciones RLS posteriores y necesita resolver sus dependencias heredadas.

Esta revisión acredita código local y una ejecución focalizada de unitarias. No acredita despliegue, migraciones aplicadas, datos de producción ni aceptación integral de las 239 filas. Los estados de la matriz histórica no se modificaron.

## Base observada

- HEAD: `ba88018d2cbd7d879549cfe6476d39e4addfd5d2`.
- Hay cambios locales en schema/journal, conciliación bancaria, eventos contables, pruebas y documentos. Existen como archivos nuevos `settlement-adapter.ts`, la migración `0136_fc12_settlements.sql`, su snapshot y `tests/integration/accounting/settlements.test.ts`.
- La matriz del 17 de octubre tiene exactamente **239 filas**: 98 «Implementado en código», 98 «Parcial», 39 «Base localizada; por verificar» y 4 «Sin implementación localizada».
- No se encontró el CSV `docs/matriz-cumplimiento-sistema-2026-11-11.csv` entre los documentos del 11 de noviembre. El checklist existe, con Fase 0 pendiente.
- La presencia de archivos SQL no prueba que estén aplicados en un entorno.

## Hallazgos contrastados

| Tema / tarea | Evidencia local | Dictamen y consecuencia |
|---|---|---|
| H03 / NOM-02 y NOM-06 | `lib/services/payroll-service.ts:350,353` devuelve `overtimePayCents: 0` y `totalDeduccionesCents: 0`. En 339–343 calcula carga patronal con multiplicador fijo `0.35`. | Brecha confirmada. El plan debe incluir explícitamente sustituir o declarar la aproximación patronal, además de eliminar ceros silenciosos. No se validó la normativa fiscal ni laboral en esta revisión. |
| H06 / INV-01 | `lib/services/sales-ingest-service.ts:151` hace upsert; en 166–175 llama consumo solo cuando `written.isNew`. La escritura de venta y llamada de consumo son operaciones separadas en este método. | Brecha confirmada. Una corrección de 10 a 12 actualiza ventas sin ejecutar el diferencial de consumo. También debe probarse recuperación cuando falla consumo después de insertar la venta, pues un reintento encuentra una fila existente. |
| H05 / PROD-01 | `lib/services/production-service.ts:449` registra resultado; en 508 descuenta lotes; en 538 registra `USAGE`; en 552 persiste ingredientes y en 556 costo. | Falta observada: este recorrido no inserta un lote terminado utilizable en inventario. Pero sí existen transacción, FEFO, ingredientes por lote, costo y caducidad por hold time. Ampliar el modelo existente, sin rehacer esas garantías. No se demostró exhaustivamente la ausencia de consumidores de `production_batches` en todo el repositorio. |
| H01 / EVI-02 | `lib/services/evidence-store.ts:24` admite workflow, incidente, documento, gasto, OS, merma, recepción y general. | Confirmado: el contrato no declara `INVOICE`, `PAYMENT` ni `EXCEPTION`. La persistencia común ya existe; falta integrar estos sujetos con sus reglas de acceso. |
| H02 / EXC-05 | `app/dashboard/exceptions/page.tsx:84` consulta `/api/group/exceptions`. | Confirmado el uso del feed legacy. Esto por sí solo no demuestra que el backend carezca de enriquecimiento canónico; sí obliga a validar cómo llegan las acciones reales a la UI. |
| EXC-03 | Existen `exception-lifecycle.test.ts` y `exception-sla.test.ts`; cubren transiciones, segregación y funciones de SLA. | Ya hay reglas y pruebas unitarias. Separar lo implementado de la aceptación pendiente de concurrencia, persistencia y ejecución del job. No usar la etiqueta «Pendiente» como sinónimo de ausencia total. |
| H09 / AUD-02 | `lib/services/audit-service.ts:19,35` mantiene `reason?`; `logEmployeeAction` acepta executor y fuera de él captura el error y devuelve `null`. | Brecha confirmada con matiz: la atomicidad depende del caller. Auditar qué acciones críticas pasan su transacción y exigir motivo donde corresponda. No basta una firma genérica ni el piloto para acreditar unificación. |
| H08 / OPE-01 | `lib/services/equipment-service.ts:391–395` consulta programaciones activas. | La evidencia del plan coincide en este servicio. La ausencia global de escritores/generadores no quedó demostrada en esta revisión; mantener como pendiente de rastreo, no como inexistencia absoluta. |
| H10 / FIN-03 | `lib/services/pnl-service.ts` calcula por empresa/sucursal, agrega por `branchId` y no expone dimensión de centro de costo. | Brecha confirmada en este servicio. El P&L ya distingue procedencia/cobertura e incorpora comisiones y caja chica. Conservar esos contratos al ampliarlo. |

## Correcciones necesarias en el frente financiero

1. **BAN-06 y FIN-06 tienen base implementada.** `bank-statement-service.ts` contiene `suggestDepositMatches`, `confirmDepositMatch` y `unmatchDepositTransaction`. `commission-service.ts` incorpora datos de pasarela, tarifas por vigencia y auditoría de comisiones. `pnl-service.ts` consume esas comisiones. Las tareas deben separar ampliación funcional de aceptación del recorrido.
2. **El trabajo local FC-12 afecta las reversas.** El diff de `bank-statement-service.ts` conecta confirmación de depósito con `settleConfirmedTransactionIn` bajo la bandera contable y bloquea deshacer un cruce cuando existe un hecho contable. Por ello, «matching y reversas ya implementados» no significa que cualquier cruce pueda deshacerse: se necesita especificar y aceptar la corrección auditada. La implementación local no equivale a una migración desplegada.
3. **Hay que probar qué significa comisión medida.** `commission-service.ts:365–379` lee importes de `gatewayTransactions` sin unir al depósito bancario ni filtrar conciliación en esa consulta; posteriormente puede emitir `MEASURED`. El comentario del P&L que vincula esa etiqueta a conciliación bancaria no se acredita con esta consulta. Definir si significa «reportada por pasarela» o «conciliada contra banco», y comprobarlo con casos pendientes, discrepantes y confirmados.
4. **FiscalAPI ya está integrado.** `payroll-service.ts:18,476` llama `timbrarNomina`; `fiscal-service.ts:24–31` declara hosts test/live y configuración `FISCALAPI_*`. Reformular la pregunta sobre PAC como confirmación del proveedor existente, configuración y evidencia de sandbox. No se consultaron credenciales ni se realizó timbrado.

## Correcciones necesarias en el propio plan

- **RLS no se limita a cinco migraciones.** Además de las listadas, existen políticas y/o `FORCE ROW LEVEL SECURITY` en `0125`, `0126`, `0127`, `0128`, `0130`, `0131`, `0133`, `0134` y en la local `0136`. Esto no demuestra cobertura total de los dominios ni aplicación en base. P0-04 debe inventariar tabla, política, rol, permisos y entorno real.
- **Hay dependencias externas sin equivalencia local.** `OPS-02.*` y `REC-03B` sí existen en el consolidado anterior, pero el nuevo plan no los desarrolla. Añadir enlaces/criterios heredados o un mapa de equivalencias. `BAN-04` aparece como dependencia individual aunque su fila nueva agrupa `BAN-01/04`; conviene definir el hito exacto.
- **Evitar un ciclo al renombrar seguridad.** BAN-01/04 depende de `OPS-02.tesoreria`, mientras `SEC-05.tesoreria` depende de BAN-04. Si ambos nombres representan el mismo trabajo RLS, surge un ciclo. Separar preparación RLS de aceptación bancaria, o documentar que son tareas distintas. El comodín `SEC-05.*` de `SEC-05.resto` también necesita excluir explícitamente la propia tarea.
- **No está demostrada aún la cobertura fila→tarea.** Enumerar módulos y rangos no sustituye el mapa de las 239 filas. P0-03 sigue siendo necesario antes de afirmar que el plan cubre todo.
- **17.12–17.14 están desactualizadas en la matriz histórica.** Siguen como «Sin implementación localizada» aunque el código de banca existe. Corregirlo en la nueva matriz con evidencia, sin subirlo automáticamente a aceptación completa.
- **La regla de aceptación por grep es insuficiente.** Que desaparezca `overtimePayCents: 0` no prueba un cálculo correcto; un caso legítimo sin horas extra puede dar cero. El criterio debe exigir importes correctos y procedencia para períodos con y sin incidencias.
- **Los tamaños M requieren descomposición adicional.** Por ejemplo, «ISR ordinario, IMSS y préstamos» reúne motores, datos y validaciones diferentes. No se validó aquí la estimación de 175–217 días-persona contra un desglose ejecutable; debe mantenerse como estimación preliminar.

## Verificación ejecutada

Primera ejecución mediante `pnpm.cmd run test:unit -- <archivos>`: el proceso terminó con exit **3221226505**, sin resumen de resultados. No se determinó la causa del fallo de proceso en Windows.

Reintento focalizado:

```powershell
pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads lib/services/__tests__/receiving-cost.test.ts lib/services/__tests__/receiving-temperature.test.ts lib/services/__tests__/payroll-validation.test.ts lib/services/__tests__/payroll-holiday.test.ts lib/services/__tests__/exception-lifecycle.test.ts lib/services/__tests__/exception-sla.test.ts lib/services/__tests__/bank-statement-service.test.ts
```

Resultado: **exit 0; 7 archivos aprobados; 157 pruebas aprobadas**. Duración informada: 27.80 s. Vitest emitió una advertencia de compatibilidad futura del cargador de configuración.

Estas pruebas acreditan sus casos unitarios, no una nómina completa ni escrituras/rollback/concurrencia bancaria. Se localizaron pruebas de integración de recepción, auditoría y settlements, pero no se ejecutaron. No se corrieron build, lint, typecheck ni navegador, dado que la revisión no modificó código de aplicación.

## Orden recomendado después de esta investigación

1. Completar P0: matriz nueva, mapa de 239 filas, manifiesto de migraciones por entorno y equivalencias de dependencias, conservando identificados los cambios contables locales.
2. Corregir INV-01 con prueba de delta, fallo después de insertar y reintento; consolidar el contrato de consumo antes de ampliar producción.
3. Descomponer nómina por cálculo y procedencia, incluyendo la carga patronal aproximada y la consistencia con timbrado/costo laboral.
4. Aceptar y ampliar banca/comisiones sobre las implementaciones existentes, coordinando FC-12 y definiendo correcciones contables y significado de `MEASURED`.
5. Verificar el resto de los recorridos con dos empresas y alcance de sucursal. Mantener explícitos los pendientes de delivery, mantenimiento, cumplimiento y perfiles hasta rastrearlos y ejecutarlos.

No se cambiaron servicios, migraciones, estados del checklist ni el plan original durante esta investigación.
