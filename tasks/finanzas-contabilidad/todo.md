# Checklist: finanzas y contabilidad integrada

Fecha: 2026-10-30. Estado: FC-01 completada técnicamente y contrato de desarrollo sintético validado; FC-02 con 9 pruebas focalizadas aprobadas y checkpoint global en verificación.
Plan y decisiones: [plan.md](plan.md). Las rutas nuevas son propuestas; `<...>` indica un punto a resolver en FC-01, no un archivo existente.

## Reglas de ejecución

- Trabajar por entrega vertical; conservar código y planes bancarios existentes.
- Máximo cinco archivos previstos por tarea. Incluir metadatos de migración en el conteo real y dividir la tarea si lo supera.
- Toda mutación valida empresa, visibilidad de sucursal, permiso y periodo; las pruebas negativas son obligatorias.
- Cada tarea ejecuta las pruebas focalizadas indicadas. Pruebas de integración en base aislada; registrar evidencia, sin usar datos reales como fixtures.
- Checkpoints: tests del área y flujos afectados, `pnpm exec tsc --noEmit`, `pnpm run lint`, `pnpm run build`; E2E en entregas de UI. Distinguir fallos previos de regresiones.
- Revisión funcional del plan y resolución de decisiones de FC-01 antes de implementar adaptadores. No ejecutar migraciones ni activar producción desde esta planificación.

## FC-01: Definir fuentes canónicas y reglas

- [x] Completada con evidencia: [matriz-fuentes.md](matriz-fuentes.md), §§1–6. Decisiones de producto pendientes con responsable/bloqueo en §5; no equivalen a reglas aprobadas para clientes.
- **Tamaño:** M. **Dependencias:** Ninguna.
- **Descripción:** Inventariar fuentes, entidades legales, fechas y estados elegibles; resolver solapamientos y anotar huecos bancarios.
- **Aceptación:**
  - [x] Matriz cubre cada hecho de §4 y sus documentos.
  - [x] cada operación tiene fuente canónica propuesta y condición de elegibilidad; huecos explícitos bloquean su publicación.
  - [x] decisiones pendientes tienen responsable y bloqueo identificado.
- **Verificación:** Revisión contra servicios actuales y recorrido manual venta → cobro y recepción → factura → pago.
- **Archivos previstos:** `tasks/finanzas-contabilidad/plan.md`, `tasks/finanzas-contabilidad/matriz-fuentes.md`.

## FC-02: Construir el mes de referencia

- [x] Fixture y controles completados: [matriz-fuentes.md §7](matriz-fuentes.md#7-fc-02--mes-sintético-y-cálculo-independiente), 9/9 pruebas focalizadas y ESLint de ambos archivos aprobado. Checkpoint revisado: suite completa, TypeScript y lint aprobados; build inicial bloqueado por red, reintento en curso (compilación aprobada).
- **Tamaño:** M. **Dependencias:** FC-01.
- **Descripción:** Preparar fixture sintético y resultados esperados calculados independientemente de la implementación.
- **Aceptación:**
  - [x] Dos sucursales y empresa ajena cubren casos de §7.
  - [x] apertura, cargos, abonos y cierre esperado cuadran en centavos.
  - [x] permisos y cortes de fecha tienen ejemplos negativos (contratos esperados; enforcement se prueba en tareas de servicios).
- **Verificación:** Revisión del fixture y cálculo independiente de balances/flujo; `pnpm exec vitest run --configLoader bundle tests/unit/finance/accounting-reference.test.ts --maxWorkers 2`.
- **Archivos previstos:** `tests/fixtures/accounting/month.ts`, `tests/unit/finance/accounting-reference.test.ts`, `tasks/finanzas-contabilidad/matriz-fuentes.md`.

**Checkpoint tras FC-02:** revisar aceptación y evidencia de las tareas acumuladas; ejecutar verificaciones aplicables y actualizar decisiones/riesgos del plan antes de ampliar el alcance.

Ejecución 2026-10-30: focalizada 9/9; ESLint de fixture/test exit 0. Checkpoint recuperado al continuar: suite completa **190 archivos, 2360 pruebas aprobadas, 1 skipped, 1 todo, exit 0**; TypeScript **exit 0**; lint global **exit 0, 2438 warnings, 0 errores**. Build inicial exit 1 al descargar Geist/Geist Mono; se repitió con red autorizada y compiló, aún pendiente su resultado final al registrar este estado. Logs locales: `.tmp/fc02-{tsc,lint,build,unit}.log` y `.tmp/fc02-build-retry.log`. El intento inicial con separador `--` se interrumpió por filtro incorrecto; los resultados aprobados corresponden a comandos corregidos. FC-02 solo añade fixture/tests y documentación: no aplica migraciones ni modifica runtime. Se permite avanzar con el límite de build explícito, sin presentarlo como aprobado.

## FC-03: Consultar el origen de una cifra

- [ ] Completada con evidencia.
- **División de ejecución (mantener máximo cinco archivos por incremento):** FC-03a entrega consulta/API de ventas, gastos operativos y caja chica, con total completo y aislamiento; FC-03b ampliará inventario/merma, FC-03c labor/comisiones y puente de utilidad. No marcar FC-03 completa con cobertura parcial. Cada ampliación debe reproducir la fórmula actual, sin fabricar documentos para estimaciones.
- **Tamaño:** M. **Dependencias:** FC-01, FC-02.
- **Descripción:** Crear consulta paginada de detalle del P&L usando la base y alcance del cálculo actual.
- **Aceptación:**
  - [ ] Filtros de periodo/sucursal coinciden con el P&L.
  - [ ] suma completa del detalle reproduce el renglón y conserva cobertura/estimación.
  - [ ] documentos de otro ámbito no son accesibles.
- **Verificación:** Pruebas de contrato, total paginado y denegación entre empresas/sucursales.
- **Archivos previstos:** `lib/services/pnl-detail-service.ts`, `app/api/finance/pnl/detail/route.ts`, `tests/unit/finance/pnl-detail.test.ts`, `tests/integration/accounting/pnl-detail.test.ts`.

## FC-04: Mostrar documentos desde Resultados

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-03.
- **Descripción:** Añadir detalle accesible desde cada renglón, con enlace a operación y evidencia permitida.
- **Aceptación:**
  - [ ] Detalle expone fuente, fecha y cobertura.
  - [ ] estados vacío/error/paginación conservan filtros.
  - [ ] navegación por teclado y roles autorizados funcionan.
- **Verificación:** Verificación en navegador y pnpm run test:e2e -- tests/e2e/accounting.spec.ts.
- **Archivos previstos:** `components/finance/pnl-branch-table.tsx`, `components/finance/pnl-source-detail.tsx`, `tests/e2e/accounting.spec.ts`.

**Checkpoint tras FC-04:** revisar aceptación y evidencia de las tareas acumuladas; ejecutar verificaciones aplicables y actualizar decisiones/riesgos del plan antes de ampliar el alcance.

## FC-05: Completar vínculos contables sobre catálogos existentes

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-01.
- **Descripción:** Inventariar y reutilizar `cost_centers.accountingLine`, partidas QSR y `company_bank_accounts` RECEPCION/DISPERSION/MIXTO. Incorporar únicamente estructuras y vínculos que falten para el registro contable; conservar catálogos y clasificación operativa existentes.
- **Aceptación:**
  - [ ] Código único por empresa y jerarquía sin ciclos.
  - [ ] referencias y cuenta bancaria pertenecen al mismo ámbito.
  - [ ] migración aditiva probada en base aislada.
- **Verificación:** Pruebas de restricciones y aislamiento; inspección SQL generado con pnpm db:generate.
- **Archivos previstos:** `lib/db/schema/accounting.ts`, `lib/db/schema.ts`, `lib/services/accounting/account-service.ts`, `drizzle/<migración-generada>.sql`, `tests/integration/accounting/accounts.test.ts`.

## FC-06: Registrar una póliza balanceada

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-02, FC-05.
- **Descripción:** Crear esquema y servicio transaccional de borrador/publicación y validación de importes.
- **Aceptación:**
  - [ ] Publicación atómica rechaza descuadre/cuenta inválida.
  - [ ] centavos y totales no desbordan ni aceptan lados negativos.
  - [ ] póliza publicada no admite edición/borrado.
- **Verificación:** Pruebas de publicación, rollback y persistencia bajo fallo.
- **Archivos previstos:** `lib/db/schema/accounting.ts`, `drizzle/<migración-generada>.sql`, `lib/services/accounting/journal-service.ts`, `lib/services/accounting/amounts.ts`, `tests/integration/accounting/journal.test.ts`.

## FC-07: Revisar y publicar ajustes

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-06.
- **Descripción:** Exponer API y pantalla de pólizas con capacidades separadas y corrección mediante reversa.
- **Aceptación:**
  - [ ] Listado/detalle respetan ámbito y paginación.
  - [ ] publicar/revertir exige permiso y motivo con historial.
  - [ ] reversa y reemplazo referencian la póliza y preservan la original.
- **Verificación:** Pruebas de autorización y reversa; recorrido UI con contador y gerente.
- **Archivos previstos:** `app/api/finance/accounting/journals/route.ts`, `app/api/finance/accounting/journals/[id]/route.ts`, `app/dashboard/finance/control-interno/polizas/page.tsx`, `tests/integration/accounting/journal-access.test.ts`, `tests/e2e/accounting.spec.ts`.

**Checkpoint tras FC-07:** revisar aceptación y evidencia de las tareas acumuladas; ejecutar verificaciones aplicables y actualizar decisiones/riesgos del plan antes de ampliar el alcance.

## FC-08: Capturar apertura y reglas vigentes

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-05, FC-06.
- **Descripción:** Permitir apertura balanceada y mapeos versionados con fecha efectiva y vista previa.
- **Aceptación:**
  - [ ] Apertura identifica fecha y documentos sin solapar histórico.
  - [ ] regla seleccionada queda congelada en póliza.
  - [ ] falta de cuenta/regla bloquea publicación con motivo visible.
- **Verificación:** Fixture de cambio de regla y apertura; verificación UI y pruebas de fecha efectiva.
- **Archivos previstos:** `lib/services/accounting/mapping-service.ts`, `lib/services/accounting/opening-service.ts`, `app/api/finance/accounting/settings/route.ts`, `app/dashboard/finance/settings/accounting/page.tsx`, `tests/integration/accounting/opening-mapping.test.ts`.

## FC-09: Contabilizar un gasto y su pago

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-06, FC-08.
- **Descripción:** Entregar el primer circuito completo desde gasto reconocido hasta pagos parciales confirmados.
- **Aceptación:**
  - [ ] Gasto crea obligación una sola vez.
  - [ ] pagos parciales reducen saldo y no repiten gasto.
  - [ ] pago rechazado/no confirmado no genera salida definitiva.
- **Verificación:** Mes de referencia reducido y pruebas de reintento/pago parcial; confirmar documentos vinculados.
- **Archivos previstos:** `lib/services/expense-service.ts`, `lib/services/treasury-service.ts`, `lib/services/accounting/expense-adapter.ts`, `tests/integration/accounting/expense-payment.test.ts`.

## FC-10: Recuperar contabilizaciones pendientes

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-09.
- **Descripción:** Persistir hechos en transacción con origen y procesarlos con trabajador durable; añadir diagnóstico básico.
- **Aceptación:**
  - [ ] Caída después de guardar origen no pierde hecho.
  - [ ] concurrencia/reintentos producen una póliza por clave y versión.
  - [ ] pendientes muestran edad/error y reproceso respeta cierre.
- **Verificación:** Inyectar caída y reinicio, dos trabajadores y fallo de red; comprobar recuperación e idempotencia en base.
- **Archivos previstos:** `lib/services/accounting/event-service.ts`, `lib/inngest/functions/accounting-post.ts`, `app/api/inngest/route.ts`, `app/api/finance/accounting/pending/route.ts`, `tests/integration/accounting/recovery.test.ts`.

**Checkpoint tras FC-10:** revisar aceptación y evidencia de las tareas acumuladas; ejecutar verificaciones aplicables y actualizar decisiones/riesgos del plan antes de ampliar el alcance.

## FC-11: Contabilizar ventas desde fuente canónica

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-01, FC-08, FC-10.
- **Descripción:** Integrar ventas, devoluciones y su separación entre efectivo y cuentas por liquidar.
- **Aceptación:**
  - [ ] Corte y tickets superpuestos no duplican ingreso.
  - [ ] impuestos/propinas/descuentos documentados se separan según matriz.
  - [ ] devolución/corrección genera reversa o hecho vinculado según política.
- **Verificación:** Casos de tickets/corte repetidos, devolución y cambio de fecha de negocio.
- **Archivos previstos:** `lib/services/accounting/sales-adapter.ts`, `<servicio-canónico-de-ventas-definido-en-FC-01>`, `tests/integration/accounting/sales.test.ts`.

## FC-12: Vincular liquidaciones y conciliación

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-10, FC-11 y dependencia bancaria verificada.
- **Descripción:** Registrar liquidaciones con neto/comisión y enlazar conciliaciones confirmadas existentes.
- **Aceptación:**
  - [ ] Depósito liquida cuenta por cobrar sin crear otra venta.
  - [ ] comisión medida sustituye comparación estimada sin sumarla dos veces.
  - [ ] conciliación/reimportación no vuelve a contabilizar dinero.
- **Verificación:** Fixture de venta de fin de mes liquidada al siguiente; reimportación y conciliación duplicada.
- **Archivos previstos:** `lib/services/accounting/settlement-adapter.ts`, `lib/services/bank-statement-service.ts`, `<servicio-de-liquidaciones-verificado-en-FC-01>`, `tests/integration/accounting/settlements.test.ts`.

**Checkpoint tras FC-12:** revisar aceptación y evidencia de las tareas acumuladas; ejecutar verificaciones aplicables y actualizar decisiones/riesgos del plan antes de ampliar el alcance.

## FC-13: Contabilizar recepción y factura vinculada

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-08, FC-10.
- **Descripción:** Integrar adquisición de inventario con obligación y regularización posterior de factura.
- **Aceptación:**
  - [ ] Recepción y factura reconocen una sola adquisición.
  - [ ] diferencias/devoluciones tienen regla y referencia.
  - [ ] pago consume obligación existente sin repetir inventario/costo.
- **Verificación:** Pruebas recepción antes/después de factura, diferencias y pago parcial.
- **Archivos previstos:** `lib/services/accounting/purchase-adapter.ts`, `lib/services/inventory-service.ts`, `<servicio-de-facturas-verificado-en-FC-01>`, `tests/integration/accounting/purchases.test.ts`.

## FC-14: Valorar consumos y mermas

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-13.
- **Descripción:** Congelar valoración por movimiento e integrar costo de venta/merma/transferencia.
- **Aceptación:**
  - [ ] Cambiar costo actual no altera póliza histórica.
  - [ ] merma no se suma además al consumo normal.
  - [ ] transferir entre sucursales propias conserva valor y no crea venta.
- **Verificación:** Pruebas de valoración histórica, redondeo y conservación entre sucursales.
- **Archivos previstos:** `lib/services/accounting/inventory-adapter.ts`, `lib/services/food-cost-service.ts`, `lib/services/inventory-service.ts`, `tests/integration/accounting/inventory.test.ts`.

## FC-15: Integrar nómina y caja chica

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-09, FC-10.
- **Descripción:** Añadir adaptadores de nómina confirmada y caja chica con reconocimiento separado de liquidación.
- **Aceptación:**
  - [ ] Pago de nómina no repite costo reconocido.
  - [ ] reposición de caja mueve efectivo sin crear gasto.
  - [ ] operaciones con el mismo comprobante no se duplican en gastos/caja chica.
- **Verificación:** Casos de nómina estimada frente a confirmada, comprobante repetido y reposición.
- **Archivos previstos:** `lib/services/accounting/payroll-adapter.ts`, `lib/services/accounting/petty-cash-adapter.ts`, `<servicio-canónico-de-nómina-definido-en-FC-01>`, `tests/integration/accounting/payroll-petty-cash.test.ts`.

**Checkpoint tras FC-15:** revisar aceptación y evidencia de las tareas acumuladas; ejecutar verificaciones aplicables y actualizar decisiones/riesgos del plan antes de ampliar el alcance.

## FC-16: Cerrar el periodo con consistencia

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-10–15.
- **Descripción:** Extender cierre financiero y snapshots con protocolo compartido de bloqueo y versiones contables.
- **Aceptación:**
  - [ ] Publicación y cierre concurrentes no generan corte inconsistente.
  - [ ] pendientes bloqueantes impiden cierre definitivo y muestran motivo.
  - [ ] reapertura exige permiso/motivo y conserva exportaciones/versiones anteriores.
- **Verificación:** Pruebas de carrera cierre/publicación, fallo de snapshot y reapertura con/sin permiso.
- **Archivos previstos:** `lib/services/financial-period-service.ts`, `lib/services/pnl-snapshot-service.ts`, `lib/services/accounting/close-service.ts`, `lib/services/accounting/journal-service.ts`, `tests/integration/accounting/close.test.ts`.

**Checkpoint tras FC-16:** revisar aceptación y evidencia de las tareas acumuladas; ejecutar verificaciones aplicables y actualizar decisiones/riesgos del plan antes de ampliar el alcance.

## FC-17: Consultar balanza y estados contables

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-16.
- **Descripción:** Crear consultas de balanza, resultados y balance con drill-down al mayor.
- **Aceptación:**
  - [ ] Apertura más movimientos explica saldos a fecha.
  - [ ] balance incluye resultado y arrastre de ejercicios sin ajuste oculto.
  - [ ] reporte por sucursal declara partidas corporativas no asignadas.
- **Verificación:** Comparar consultas con resultados independientes del mes y cambio de ejercicio.
- **Archivos previstos:** `lib/services/accounting/report-service.ts`, `app/api/finance/accounting/reports/route.ts`, `components/finance/accounting-statements.tsx`, `app/dashboard/finance/results/accounting/page.tsx`, `tests/integration/accounting/reports.test.ts`.

## FC-18: Explicar flujo realizado y diferencias con P&L

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-12, FC-15, FC-17.
- **Descripción:** Añadir flujo realizado y puente hacia P&L operativo manteniendo proyección existente.
- **Aceptación:**
  - [ ] Flujo clasifica operación/inversión/financiamiento y excluye transferencias propias.
  - [ ] variación de efectivo coincide con apertura/cierre.
  - [ ] diferencias operativas se explican por fuente, fecha o estimación.
- **Verificación:** Comparación con fixture y recorrido UI de diferencia por liquidación del mes siguiente.
- **Archivos previstos:** `lib/services/accounting/cash-flow-service.ts`, `lib/services/accounting/pnl-bridge-service.ts`, `app/api/finance/accounting/cash-flow/route.ts`, `components/finance/accounting-cash-flow.tsx`, `tests/integration/accounting/cash-flow.test.ts`.

## FC-19: Exportar expediente del cierre

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-16–18.
- **Descripción:** Generar PDF/CSV con periodo, versión, pólizas, estados y pendientes.
- **Aceptación:**
  - [ ] Exportación reproduce totales del cierre y respeta permisos.
  - [ ] periodo, versión y cobertura aparecen en cada reporte.
  - [ ] CSV neutraliza fórmulas y archivos no filtran datos de otros ámbitos.
- **Verificación:** Comparar totales descargados, reexportar cierre antiguo y probar roles/fórmulas maliciosas.
- **Archivos previstos:** `lib/services/accounting/export-service.ts`, `app/api/finance/accounting/export/route.ts`, `components/finance/accounting-export.tsx`, `tests/integration/accounting/export.test.ts`, `tests/e2e/accounting.spec.ts`.

**Checkpoint tras FC-19:** revisar aceptación y evidencia de las tareas acumuladas; ejecutar verificaciones aplicables y actualizar decisiones/riesgos del plan antes de ampliar el alcance.

## FC-20: Activar piloto recuperable por empresa

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-04, FC-19.
- **Descripción:** Configurar activación gradual, importar apertura con vista previa y documentar operación/retroceso.
- **Aceptación:**
  - [ ] Histórico no solapa apertura ni se publica sin revisión.
  - [ ] desactivar detiene nuevos eventos sin borrar evidencia.
  - [ ] backlog, fallos y diferencias pueden medirse por empresa.
- **Verificación:** Simular activación, caída, recuperación y desactivación en base aislada; revisión de checklist con responsable contable.
- **Archivos previstos:** `lib/services/accounting/activation-service.ts`, `scripts/accounting-opening-preview.ts`, `tests/integration/accounting/pilot.test.ts`, `docs/accounting-operations.md`, `tasks/finanzas-contabilidad/pilot-review.md`.

## FC-21: Validar el primer cierre del piloto

- [ ] Completada con evidencia.
- **Tamaño:** S. **Dependencias:** FC-20.
- **Descripción:** Revisar cierre de empresa piloto y evidencia técnica antes de ampliar activación.
- **Aceptación:**
  - [ ] Responsable contable valida apertura, reglas y diferencias.
  - [ ] pruebas de recuperación, aislamiento y cierre quedan registradas.
  - [ ] límites conocidos y decisión de ampliación quedan documentados.
- **Verificación:** Ejecutar comandos de §7 y revisión UI con roles; cotejar bancos/fuentes con libro mayor sin asumir que un build demuestra exactitud contable.
- **Archivos previstos:** `tasks/finanzas-contabilidad/pilot-review.md`, `docs/accounting-operations.md`.

**Checkpoint tras FC-21:** revisar aceptación y evidencia de las tareas acumuladas; ejecutar verificaciones aplicables y actualizar decisiones/riesgos del plan antes de ampliar el alcance.
