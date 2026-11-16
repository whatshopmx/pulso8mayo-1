# Plan: facturas de compras y gastos operativos

Fecha: 2026-11-16. Estado: T01–T09 completadas, T10 pendiente. Build de producción aprobado al cerrar T09 (ver checklist).
Seguimiento: [todo-facturas-gastos.md](todo-facturas-gastos.md).
Ubicación autorizada por el usuario para conservar los planes bancarios existentes.

## Resultado esperado

Desde Finanzas se puede registrar un gasto de renta, luz, mantenimiento o servicios con su CFDI, sin pasar por Inventario ni dar de alta al emisor como proveedor de insumos. La ficha de la contraparte distingue documentos de compras y de gastos. Una factura vinculada a un gasto representa una sola obligación, una sola salida proyectada y un solo reconocimiento contable.

Ejemplos de aceptación:
- Harina: factura de compra, vinculable a OC/recepción; conserva el circuito de inventario.
- Electricidad: CFDI cargado desde Finanzas, asociado a un gasto de servicios; aprobación y pago por el circuito del gasto.
- Un mismo emisor vende insumos y presta mantenimiento: cada documento tiene su destino; no se clasifica todo el proveedor igual.
- Gasto sin CFDI: se puede registrar con ticket o sin comprobante y asociar el XML después.

## Diagnóstico confirmado en código

- `app/dashboard/finance/payees/[id]/page.tsx` ofrece gastos y documentos, pero el botón de facturas lleva a Inventario.
- `getPayeeFinance` consulta documentos mediante `invoices -> suppliers -> payeeId`: depende de una identidad de proveedor incluso para servicios.
- `ExpenseForm` captura evidencia, no un CFDI estructurado.
- `associatePayeeInvoice` ya vincula gasto y factura, bloquea compras con OC/recepción y conserva controles de pagos, pólizas y periodos cerrados.
- `getAccountsPayable` excluye facturas ya asociadas a gastos, pero una factura aún sin asociar entra como obligación independiente.
- `PayeeFinanceTables` denomina cualquier fuente `INVOICE` como «Factura de compra».
- La carga de Inventario intenta relacionar conceptos con productos y asigna la primera OC elegible del proveedor. El mismo endpoint también admite vínculos con contratos recurrentes y órdenes de servicio.
- `invoices` conserva XML y datos fiscales, pero no tiene una clasificación explícita del destino. El parser revisado expone subtotal y total, y la carga calcula impuesto como diferencia; el soporte de impuestos/retenciones debe verificarse antes de reutilizarlo en servicios.

Este diagnóstico es de código. La composición y calidad de los datos históricos de la empresa no se han auditado.

## Decisiones propuestas

1. Conservar un registro fiscal único en `invoices`; evitar una segunda tabla de CFDI para gastos. Añadir destino explícito `INVENTORY_PURCHASE`, `OPERATING_EXPENSE` o `UNCLASSIFIED`. Son nombres técnicos propuestos, a ajustar a las convenciones del proyecto.
2. Clasificar por documento, no por proveedor. Una compra de inventario no equivale automáticamente a costo de ventas: el reconocimiento del consumo sigue el circuito existente.
3. Añadir relación directa factura–contraparte para gastos; `supplierId` seguirá disponible para compras y compatibilidad histórica. Validar empresa, sucursal e identidad al resolver o vincular emisores. El RFC es una coincidencia a confirmar; no crear/vincular registros ambiguos por nombre.
4. Conservar `operatingExpenses.invoiceId` como vínculo del comprobante y el gasto como fuente única de aprobación, pago y contabilización operativa. No exigir un proveedor de inventario para registrar renta o servicios.
5. La carga se procesa primero como vista previa sin deuda nueva. La confirmación guarda factura y gasto/vínculo en una transacción. Si se cancela o falla, no queda una factura huérfana pagable. Un XML duplicado ofrece abrir/asociar el registro accesible existente, sin recrearlo ni revelar registros ajenos.
6. Los CFDI de gastos nunca buscan productos, OC o recepciones. Los importes no se ajustan silenciosamente para hacer coincidir un gasto existente.
7. Documentos mixtos, relaciones contradictorias e históricos ambiguos quedan «Por clasificar» para revisión. Esta entrega no distribuye automáticamente un CFDI entre inventario y gastos; ese caso queda identificado y bloqueado para nuevos pagos hasta resolverse por un flujo explícito.
8. No modificar pagos ni pólizas históricas como efecto de clasificar. Reclasificar registros con actividad financiera requiere la revisión ya prevista por el sistema.
9. Mantener el alta manual de gastos sin factura, los permisos existentes y las reglas de aprobación. Cargar una factura no autoriza ni paga el gasto.

## Experiencia propuesta

En la ficha de contraparte:
- «Nuevo gasto» permite captura manual o «Cargar CFDI»; muestra emisor, receptor, UUID, fecha, moneda, subtotal, impuestos/retenciones y total, con categoría, sucursal, centro de costo y vencimiento.
- En un gasto existente: «Cargar factura» y «Asociar factura existente». Se muestran incompatibilidades de importe, emisor, moneda, sucursal o estado antes de confirmar.
- «Documentos» tiene filtros Todos / Compras de inventario / Gastos operativos / Por clasificar. Cada fila muestra destino y gasto u origen vinculado; los textos no confunden compra con servicio.
- Desde Finanzas → Gastos se dispone del mismo flujo. Facturas de inventario conserva su circuito y filtra explícitamente su destino, con acceso a históricos por clasificar.
- Los estados vacíos explican cómo cargar o vincular el documento. Fechas, sucursal y paginación siguen aplicándose al filtro seleccionado.

## Etapas y dependencias

| Orden | Entrega | Depende de |
|---|---|---|
| F0 | Trazar consumidores y fijar contrato con casos actuales | Ninguna |
| F1 | Modelo aditivo y lectura compatible | F0 |
| F2 | Evitar deuda, proyección y pólizas duplicadas según destino | F1 |
| F3 | Servicio de captura de CFDI operativo con confirmación atómica | F2 |
| F4 | Capturar/asociar desde la ficha y Gastos | F3 |
| F5 | Separar documentos y proteger la captura de inventario | F2, F4 |
| F6 | Clasificación histórica revisable | F1, F2, F5 |
| F7 | Validación integral y preparación de entrega | F0–F6 |

Cada etapa se divide en tareas de 2–5 archivos en el checklist. No habilitar el nuevo alta hasta que los consumidores financieros entiendan el destino.

## Reglas para históricos y transición

- Primero producir inventario de solo lectura: conteos e importes por empresa, destino inferido, vínculo y estado financiero, más conflictos y duplicados. Clasificar metadata no debe cambiar automáticamente saldos existentes.
- Gasto vinculado sin evidencia incompatible de inventario: candidato a gasto operativo. OC o recepción válida sin gasto vinculado: candidato a compra. Ausencia de OC no prueba que sea gasto.
- Contrato recurrente u orden de servicio es una señal a revisar: no crear automáticamente un gasto por cada factura y duplicar obligaciones ya existentes.
- Contradicciones y ambigüedad quedan pendientes. Conservar visibilidad del historial y trazar cualquier cambio propuesto en elegibilidad para pago antes de aplicarlo.
- Separar cambios técnicos de metadata de cambios financieros. La migración aditiva debe mantener lectura del histórico; la activación del bloqueo de documentos ambiguos necesita un reporte previo de impacto en CxP y proyección.
- Ejecutar el backfill con alcance explícito, modo simulación, transacciones por lote y auditoría; debe ser repetible sin duplicar relaciones.
- No borrar facturas, reconstruir pólizas ni modificar movimientos bancarios. No usar `db:push`; generar y revisar una migración aditiva cuyo número se determine al implementar.

## Verificación y criterios de cierre

- CFDI operativo nuevo con contraparte sin proveedor: gasto registrado pendiente de aprobación, XML accesible y destino correcto; sin entradas en inventario.
- Asociación a gasto previo: rechazo de importe/sucursal/emisor/moneda incompatible, cancelado, periodo cerrado o actividad financiera que impida asociar.
- Dos confirmaciones concurrentes o doble carga: una factura, un vínculo y una obligación; fallo revierte toda la operación.
- Antes/después de aprobación y pago parcial: CxP, proyección y contabilidad concilian en centavos y no suman ambos orígenes. Una factura operativa sin gasto válido no es pagable como compra.
- Compra con OC/recepción conserva conciliación, pagos y costos existentes; carga de servicio no toma una OC del mismo emisor.
- Casos fiscales: receptor incorrecto, XML inválido, moneda no soportada, IVA y retenciones; no inferir IVA como total menos subtotal cuando hay retenciones. El soporte exacto se fija en F0 y los casos no soportados se rechazan de forma explícita.
- Aislamiento por empresa/sucursal, permisos, contraparte inactiva y acceso al XML verificados en API, no solo en UI.
- Pruebas unitarias focalizadas con `pnpm test:unit -- <archivos>`; integración de transacciones y concurrencia con `pnpm test:integration -- <archivos>` sobre base de pruebas aislada.
- Verificación de navegador en escritorio y móvil: captura, errores, documentos filtrados y navegación a origen. E2E focalizado con `pnpm test:e2e -- <archivo>`.
- Cierre técnico: `pnpm exec tsc --noEmit`, lint de archivos afectados y `pnpm run build`. Registrar fallos previos por separado; no declarar validación aprobada sin evidencia.

## Riesgos y límites

| Riesgo | Tratamiento |
|---|---|
| Cambiar el saldo histórico por clasificación | Simulación, comparación de totales y revisión de excepciones antes de activar reglas |
| CFDI de servicio duplicado como compra y gasto | Fuente única explícita y validaciones en todos los consumidores |
| Contratos/órdenes con otra obligación ya creada | Inventariar esos consumidores en F0 y probar transiciones |
| Migración sobre datos contradictorios | No inferir por ausencia; conservar «Por clasificar» y reporte de conflictos |
| Impuestos o divisas que el parser no representa | Definir soporte antes de alta; rechazar lo no soportado sin alterar cifras |
| Un mismo CFDI mezcla destinos | Revisión explícita; distribución por líneas diferida a una entrega posterior |

No incluye rediseño general de tesorería, automatización de pago, cambio de política de costo de ventas ni recuperación masiva de CFDI del SAT. La ejecución de migraciones, correcciones de datos y despliegue se revisarán con sus resultados concretos; el avance de implementación se registra en el checklist.

## F0 / T01 — Contrato de implementación (2026-11-16)

Esta sección fija las reglas para las siguientes tareas. No activa captura, clasificación ni restricciones nuevas sobre históricos. La verificación usa datos sintéticos en PGlite; no constituye auditoría de datos reales.

### Mapa de consumidores y cambios requeridos

| Circuito | Archivos y símbolos actuales | Supuesto actual / trabajo dependiente |
|---|---|---|
| Carga y consulta de CFDI | `app/api/inventory/invoices/upload/route.ts` (`POST`); `app/api/inventory/invoices/route.ts` (`GET`); `lib/services/cfdi-parser.ts` (`CFDIParserService.parse`) | Resuelve proveedor por RFC y luego nombre, busca productos y toma la primera OC elegible. Guarda `taxAmount = total - subtotal`. Listado sin destino. T06/T07 deben ofrecer vista previa sin escrituras y confirmación operativa separada; T11 protege Inventario. |
| Conciliación y recepción | `lib/services/invoice-matching-service.ts` (`InvoiceMatchingService`); carga anterior y detalle `app/api/inventory/invoices/[id]/route.ts` | OC/recepción y líneas pertenecen a compras. La captura operativa no invoca este circuito. T11 conserva la conciliación de mercancía. |
| Ficha, documentos y asociación | `lib/services/payee-finance-service.ts` (`getPayeeFinance`, `getPayeeInvoiceCandidates`, `associatePayeeInvoice`) | Documentos/candidatos requieren `invoices.supplierId -> suppliers.payeeId`. Asociación bloquea OC/recepción, diferencias de importe/sucursal, otros gastos, actividad financiera y periodos cerrados; no valida moneda. T07/T09/T10 añaden identidad directa y validación fiscal sin retirar las guardas. |
| CxP y saldos | `lib/services/accounts-payable-service.ts` (`getAccountsPayable`); `lib/services/payable-balances.ts` | Excluye facturas asociadas a cualquier gasto de la empresa; solo gastos APPROVED son deuda firme. Factura sin vínculo entra como INVOICE. Filtro supplierId omite gastos; payeeId resuelve facturas por proveedor. T03 centraliza elegibilidad por destino y conserva saldo histórico explícito. |
| Proyección operativa | `lib/services/cash-flow-service.ts` (`getCashFlowProjection`) | Excluye CFDI vinculados a gastos; clasifica los restantes como COMPRAS/PROCUREMENT_INVOICE. Proyecta gastos PENDING_APPROVAL y APPROVED (no PENDING_OVERBUDGET_APPROVAL). OC comprometida se proyecta por separado. T03 debe probar factura/OC/recepción además de factura/gasto. |
| Programación y corridas | `lib/services/treasury-service.ts` (`TreasuryService.getUnpaidInvoices`, `addItemToRun`, resolución de partidas); rutas `app/api/finance/treasury/` | Factura exige proveedor/CLABE y excluye gasto asociado. Gasto usa payee y `serviceInvoiceBlocker`. T04 debe cubrir también corridas existentes, preparación, aprobación y descarga de layout. |
| Ejecución de pago | `lib/services/treasury-service.ts` (`settlePaymentRunItem`, `saldarDocumentosDePartidas`, cierre de corrida); `lib/services/payment-run-settlement.ts` | Con ACCOUNTING_POSTING_ENABLED valida saldo de factura mediante adaptador; sin bandera el espejo marca PAID directamente. T04 debe revalidar destino/fuente al ejecutar en ambos modos, no confiar en controles de programación. |
| Comprobante del gasto | `lib/services/expense-invoice-evidence.ts` (`serviceInvoiceBlocker`, `mirrorExpenseInvoicePaid`) | Valida identidad mediante proveedor, importe, sucursal, cancelación y OC/recepción. El espejo salda CFDI solo cuando gasto está PAID. T04/T05/T07 migran lectura a identidad directa compatible y validan moneda. |
| Contabilidad de compras | `lib/services/accounting/purchase-adapter.ts` (`invoiceBlocker`, `remainingInvoiceCentsIn`, `captureInvoicePaymentIn`) | Bloquea factura que respalda gasto. Compra requiere recepción, sucursal y MXN; recepción y factura son hechos relacionados, no dos adquisiciones. T05 añade destino a captura y publicación. |
| Contabilidad del gasto | `lib/services/accounting/expense-adapter.ts` (`expenseBlocker`, captura/publicación/pagos) | Requiere aprobación, fecha de negocio e impuesto explícito no negativo menor que bruto; usa `serviceInvoiceBlocker` y moneda MXN. No representa retenciones separadas. T05 mantiene idempotencia/periodos y limita tratamiento soportado. |
| Reportes contables | `lib/services/accounting/cash-flow-service.ts`; `tests/integration/accounting/{cash-flow,purchases,expense-payment,pnl-detail,reports}.test.ts` | Deben seguir hechos/pólizas existentes, sin generar reconocimiento al cambiar metadata. T05/T13 comparan mayor, flujo contable y detalle de resultados con los hechos de origen. |
| Contratos recurrentes | `lib/services/recurring-payable-service.ts` (`syncRecurringPayables`); `lib/services/recurring-contract-projection.ts` (`projectRecurringContracts`, `periodosYaCapturados`); `lib/services/recurring-contract-variance.ts` | OPEN es estimado; INVOICED se excluye de CxP estimada. Sync usa contrato/periodo del CFDI; proyección suprime por factura resuelta o gasto del payee/sucursal/mes. Estas consultas no filtran destino; la supresión por gasto puede alcanzar varios contratos del mismo payee. T03/T07/T12 deben preservar/revisar sustitución, no crear otro gasto automático. |
| Órdenes de servicio | `lib/services/service-order-service.ts` (`linkInvoice`); `app/api/service-orders/[id]/link-invoice/route.ts`; upload de Inventario | Upload busca OS de mismo proveedor, cerrada/pendiente de conformidad, con candidato único; vínculo manual identifica factura de empresa. T07/T11/T12 validan coherencia explícita; OS/contrato solos no prueban que pueda crearse una nueva obligación. |
| Interfaz de Finanzas | `app/dashboard/finance/payees/[id]/page.tsx`; `components/finance/payee-finance-tables.tsx`; formulario de gasto y asociación | Actualmente etiqueta INVOICE como compra y lleva carga a Inventario. T08–T10 cambian captura/navegación y filtros después de los controles financieros. |

### Destino, identidad y fuente única

- `INVENTORY_PURCHASE`: el CFDI integra el circuito de compra. Puede mantener supplierId y OC/recepción coherentes; no puede respaldar operatingExpenses. Registrar inventario no reconoce automáticamente costo de ventas.
- `OPERATING_EXPENSE`: exige payee directo de la misma empresa y un único gasto válido al confirmar. No admite OC/recepción ni matching de productos. La factura conserva datos fiscales/XML; el gasto determina aprobación, vencimiento operativo, pago y reconocimiento.
- `UNCLASSIFIED`: valor inicial de históricos, nunca inferir compra por defecto ni gasto por falta de OC. Mantiene lectura y comportamiento financiero previo durante la transición. Visibilidad y elegibilidad son conceptos distintos: antes de activar bloqueo se exige reporte T12 de impacto y revisión; nuevos documentos ambiguos no se habilitan para pago.
- Metadata de clasificación registra actor, fecha, motivo y procedencia. Empresa de factura, contraparte, proveedor y gasto debe coincidir; sucursal e importe deben coincidir para la asociación. Resolver RFC no permite seleccionar el primer homónimo ni crear una contraparte ambigua. No copiar CLABE ni modificar pagos/pólizas al clasificar.
- Mantener supplierId histórico opcional. Para operación nueva manda payee directo; si hay ambas identidades y son contradictorias se rechaza, no se elige una silenciosamente. Relaciones entre empresas requieren restricciones/validación transaccional, además del filtro de sesión.
- Un único gasto por factura, protegido en DB para concurrencia; UUID fiscal único. Actualmente `invoices.uuid` es único global, mientras upload busca duplicado solo en empresa: T07 debe traducir conflicto global en respuesta genérica para registros ajenos, sin UUID, identificadores ni enlaces de otra empresa.
- Vista previa no crea factura, gasto ni deuda. Confirmación guarda ambos/vincula dentro de una transacción; error revierte todo. Duplicado accesible permite abrir/asociar con las mismas guardas. La carga no aprueba ni paga.
- Gasto pendiente puede proyectarse conservadoramente sin ser CxP firme. Rechazado/cancelado no habilita el CFDI operativo como deuda de compra. Abonos confirmados reducen saldo en centavos; fallidos no. Con bandera contable apagada se caracteriza el saldo bruto actual, sin inventar soporte de abonos parciales.
- Clasificación con actividad financiera no modifica esa actividad: pasa a revisión. Documento mixto o con relaciones contradictorias permanece por clasificar y requiere resolución explícita.

### Soporte fiscal acotado para T05/T06

Contrato inicial del nuevo flujo: CFDI 4.0 de ingreso, timbrado, receptor de la empresa, MXN, cantidades finitas y positivas y conciliación exacta en centavos. Soportar sin impuesto (cero explícito) o IVA trasladado no negativo, identificado en XML, con base y total conciliables. No deducir IVA de la diferencia entre total y subtotal.

Retenciones, IEPS/otros impuestos, impuestos locales, descuentos, complementos con efectos monetarios, moneda distinta de MXN y tipos de comprobante distintos de ingreso se rechazan explícitamente en la captura nueva hasta contar con representación y contabilización probadas. Si el XML mezcla tratamientos no representables no se degrada a un impuesto neto. El parser actual declara 3.3/4.0 pero no valida versión, tipo, receptor, estructura XML completa ni desglose fiscal; no es aún una validación fiscal reutilizable. Rechazar lo no soportado debe ocurrir antes de toda escritura.

Esta es una decisión de alcance del software, no una conclusión fiscal sobre deducibilidad. No altera el tratamiento de documentos históricos.

### Casos antes / después

| Caso | Comportamiento actual caracterizado | Resultado requerido al completar el plan |
|---|---|---|
| Harina y electricidad del mismo emisor | Factura de harina sigue INVOICE; electricidad asociada aparece solo OPERATING_EXPENSE. Documento sin proveedor queda en CxP global pero desaparece de ficha. | Destino por documento; harina conserva compra y electricidad usa payee directo, con una fuente por obligación. |
| Electricidad pendiente de aprobar con CFDI | Asociación retira factura de CxP; gasto pendiente suma cero a deuda firme y sí suma a proyección. | Mantener esta diferencia deliberada; guardar CFDI+gasto atómicamente evita la deuda huérfana previa a asociación. |
| Mantenimiento sin proveedor de insumos | Asociación exige proveedor vinculado al payee; carga intenta matching de inventario. | Captura desde Finanzas sin proveedor ni OC automática; mismo emisor puede conservar sus compras de harina. |
| Abonos parciales confirmados | Con bandera contable, saldos de compras y gastos descuentan confirmados, conservan centavos y omiten fallidos. | Misma suma en CxP/proyección, guardas de ejecución en ambos modos y ningún abono por dos fuentes. |
| Servicio con IVA 160 y retención 100 | Parser conserva subtotal/total pero no desglose; upload guardaría impuesto neto 60. | Rechazo explícito de retención hasta soportarla, sin alterar cifras ni dejar deuda. |

### Verificación de T01 y siguientes tareas

- `tests/unit/finance/payee-finance-db.test.ts`: SQL real de consultas/asociación, compra y gasto del mismo emisor, ausencia de proveedor, aprobación, proyección y abonos. Harness PGlite sin FKs/defaults: prueba consultas y transacciones, no integridad del esquema ni seguridad RLS.
- `lib/services/__tests__/cfdi-parser-characterization.test.ts`: identidad/importes, moneda sin validar, retenciones no representadas y XML incompleto. Caracteriza limitaciones; no certifica soporte fiscal.
- Regresiones existentes: `tests/unit/finance/payee-obligations.test.ts`, `lib/services/__tests__/{recurring-payable-service,recurring-contracts,payment-run-settlement,treasury-disbursement}.test.ts`.
- T02 debe probar la migración real con restricciones en base aislada; T04/T05 deben ejecutar integración de tesorería/contabilidad, con bandera encendida y apagada. T13 conserva el cierre integral indicado arriba. Ninguna prueba de T01 habilita cambios en base real.
