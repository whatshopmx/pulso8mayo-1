# FC-01 — Contrato de fuentes y reconocimiento

Revisión técnica: 2026-10-30. Alcance: código local, sin consultar datos de clientes ni certificar producción. Cada `companyId` es una razón social (confirmado por el propietario en esta sesión). Aún no existen clientes; el primer escenario será sintético. El propietario validó el contrato para desarrollo sintético (cortes, gastos aprobados con fecha, pagos separados y plantilla revisable). La validación contable de una empresa real queda para el piloto.

### Catálogos existentes que se reutilizan

- `cost_centers` en [service-orders.ts](../../lib/db/schema/service-orders.ts): empresa, código, nombre, `accountingLine` y estado activo. [cost-center-service.ts](../../lib/services/cost-center-service.ts) ya aporta partidas QSR 2xxx–6xxx para COGS, nómina, OPEX, corporativo y CAPEX. Son la clasificación existente de los egresos; no crear otra plantilla de categorías equivalente.
- `company_bank_accounts` en [treasury.ts](../../lib/db/schema/treasury.ts): cuentas propias con propósito RECEPCION, DISPERSION o MIXTO, número cifrado, saldo de apertura y fecha. MIXTO permite recibir y efectuar pagos desde la misma cuenta; no crear otra cuenta operativa para representar cada dirección del dinero.
- `operating_expenses.costCenterId` ya enlaza el gasto con su partida; tesorería ya selecciona cuenta bancaria de origen. Lo pendiente es unir clasificación, operación, obligación y pago al registro de cargos/abonos y sus saldos. `accountingLine` hoy es texto clasificatorio, no una póliza balanceada ni una relación a un libro mayor general.
- FC-05 inventariará esos vínculos antes del esquema: extender lo necesario para integridad contable sin duplicar centros, partidas o cuentas bancarias. Ejemplo: gasto de renta usa su centro/partida actual y pago desde la cuenta MIXTO actual; dos hechos vinculados, una clasificación y una cuenta bancaria operativa.

## 1. Fuentes, fechas y elegibilidad

Los nombres de tablas son los del esquema Drizzle. Toda clave contable incluirá empresa, tipo/id de origen, hecho y versión; una referencia documental no basta para demostrar un movimiento de dinero. `businessDate`, fecha de documento, reconocimiento y liquidación se conservan por separado.

| Hecho | Fuente canónica propuesta y evidencia existente | Fecha / elegibilidad para contabilizar | Evitar solapamiento / hueco identificado |
|---|---|---|---|
| Venta | `daily_sales_cuts`, vía `ingestSalesCut`; `rawFileUrl`, sucursal, turno y canal | `businessDate`; solo `VALIDATED`, desglose de medios consistente y datos suficientes para separar impuesto/propinas | Los `sales_entries` agregados por receta/día sirven a consumo teórico, no son tickets individuales ni otro ingreso. Una partición de canales excluye TOTAL del mismo turno. La unicidad actual por canal no impide por sí sola TOTAL + particiones en otras rutas. |
| Devolución, descuento, contracargo | Referencia a la venta/corte original y documento de corrección; `gateway_transactions.status` es evidencia auxiliar | Fecha de corrección autorizada; importes y venta afectados explícitos | No existe un circuito de reversa contable. Un REFUNDED/DISPUTED importado no autoriza inventar desglose ni reducir ventas sin vínculo. Bloquear publicación incompleta. |
| Liquidación tarjeta/plataforma | `gateway_transactions` (`grossAmountCents`, `feeAmountCents`, `feeVatCents`, `netAmountCents`, `externalId`, cuenta destino) | Hecho declarado `SETTLED`, con fechas de transacción y liquidación; efecto definitivo en banco respaldado por match confirmado de `bank_transactions` | `aggregator_settlements` compara contra POS por periodo/canal, pero no es otro depósito. Ni el corte ni la liquidación crean otra venta. Falta un vínculo que identifique inequívocamente ambas representaciones. |
| Conciliación bancaria | `bank_transactions` con `matchedPaymentRunItemId` o `matchedGatewayTransactionId`, `matchedAt`, `matchedBy` | `valueDate` para evidencia bancaria; solo confirmación humana `MATCHED` | Sugerencia e IGNORED no confirman dinero. Match, unmatch y reimportación vinculan evidencia; no vuelven a crear el pago/cobro. |
| Recepción de insumos | `receiving_reports` + `receiving_report_items`, vía `processReceiving`; fotos, firma, proveedor, OC, idempotencyKey; movimientos RECEIVING | Recepción efectivamente persistida, cantidad aceptada y valoración documentada; fecha física del reporte | Reconocer inventario contra recepción pendiente de facturar. Factura vinculada regulariza obligación/diferencias; no entra nuevamente inventario. Cuarentena y rechazos requieren clasificación explícita. |
| Factura de proveedor | `invoices` + `invoice_lines`; `receivingReportId`, `purchaseOrderId`; `InvoiceMatchingService` | Fecha documental y fecha de reconocimiento explícitas; vínculo consistente y discrepancia resuelta (`MATCHED`/`EXCEPTION_APPROVED` cuando corresponda) | Vincular primero si ya hubo recepción. Un archivo/CFDI recibido sin asociación no demuestra otra adquisición. Sin recepción, clasificar gasto/activo y documentar regla antes de publicar. |
| Consumo | `inventory_movements.type = USAGE`, `referenceId`, artículo, lote y sucursal | Timestamp del movimiento y valor congelado en ese momento | `food-cost-service` hoy multiplica cantidades por costo actual; no es valoración histórica congelada. Compras proxy y consumo no se suman. |
| Merma | `inventory_movements.type = WASTE`, evidencia operativa/referencia de merma | Movimiento confirmado y valor congelado | No repetir como USAGE. Costo inexistente queda pendiente, nunca publicar un cero por fallback. |
| Transferencia de inventario | `inventory_transfers` + ítems y movimientos relacionados, vía `InventoryService` | Fases enviadas/recibidas reconciliadas; conservar valor en tránsito | Ambas sucursales deben pertenecer a la misma razón social. No crear ingreso ni gasto; no usar el costo vivo del destino para alterar valor. |
| Gasto reconocido | `operating_expenses`, vía `expense-service`; categoría, beneficiario, centro de costo, `evidenceUrl`, actor/aprobación | Propuesta inicial: `APPROVED` o `PAID` con aprobación válida, `businessDate` de reconocimiento explícita | PENDING_APPROVAL no es obligación contable aprobada. Gasto ya PAID no se reconoce dos veces. Si falta fecha/regla, pendiente. El P&L actual incluye todos salvo REJECTED: mantener esa diferencia visible. |
| Pago de obligación | `payment_run_items` unido a `payment_runs` y documento `referenceId`; referencia de liquidación | Partida `CONFIRMED`, corrida autorizada, importe aplicado y `settledAt`; FAILED/PENDING sin salida definitiva | `markPaidOperatingExpense` declara pago manual, no confirma banco ni soporta por sí solo parciales. Un espejo PAID del documento y su partida son un hecho. Falta libro de aplicaciones parciales antes de FC-09. |
| Nómina reconocida | `payroll_runs` + `payroll_payslips`, vía `executePayrollRun`; periodo, percepciones/deducciones, CFDI y snapshots cuando existan | Recibos calculados/confirmados y run sin errores pendientes; periodo de devengo explícito | COMPLETED no prueba pago; COMPLETED_WITH_ERRORS exige revisión por recibo. Separar bruto, neto y pasivos. `labor-cost-service` mide contratos/asistencia y estimaciones; no sustituye nómina confirmada. |
| Pago de nómina | Partida PAYROLL `CONFIRMED`, referencias a run y empleados; dispersión de aguinaldo separada cuando corresponda | Fecha e importe confirmado de liquidación, sin repetir devengo | `saldarDocumentosDePartidas` solo espeja facturas/gastos; no marca nómina pagada. Conciliar importes de percepciones contra netos, deducciones y dispersión antes del adaptador. |
| Gasto de caja chica | `petty_cash_transactions.type = OUT` unido a `petty_cash_funds`; concepto, categoría, evidencia, actor | Fecha del movimiento y comprobante validado | No existe clave documental común con operating_expenses: mismo comprobante en ambos debe quedar pendiente de revisión o vincularse antes de publicar; URL sola no es identidad suficiente. |
| Reposición / transferencia propia | `petty_cash_transactions.type = REPLENISHMENT` y origen de tesorería; transferencias bancarias con ambas cuentas propias identificadas | Movimiento confirmado, mismo companyId, fecha e importe documentados | Solo mover activos. La partida PETTY_CASH_REIMBURSEMENT no crea automáticamente la reposición del fondo; vincular ambos documentos. No inferir transferencia propia solo por monto igual. |

## 2. Base exacta del P&L que FC-03 debe reproducir

Evidencia: [pnl-service.ts](../../lib/services/pnl-service.ts), [sales-base.ts](../../lib/services/sales-base.ts), [food-cost-service.ts](../../lib/services/food-cost-service.ts), [labor-cost-service.ts](../../lib/services/labor-cost-service.ts), [commission-service.ts](../../lib/services/commission-service.ts).

- Ventas: todos los cortes de empresa por `businessDate` inclusiva, sin filtro de estado. El importe del renglón es bruto; utilidad y porcentajes usan `resolveSalesBase` (neto medido, derivado o bruto declarado). FC-03 no puede imponer VALIDATED y seguir afirmando que reproduce el P&L.
- Gasto: todos salvo REJECTED; fecha SQL `COALESCE(businessDate, paidAt::date, dueDate, createdAt::date)`. El comentario y la nota de UI omiten la prioridad actual de businessDate; manda la consulta. Incluye pendientes de aprobación.
- Caja chica: OUT por `createdAt::date`, empresa obtenida del fondo y sucursal del fondo. REPLENISHMENT no suma gasto.
- Food cost: USAGE y WASTE separados, por timestamp UTC del rango; cantidades absolutas por costo actual promedio/último del artículo, redondeo al agregar. Sin salidas usa RECEIVING como proxy PURCHASES; sin datos, P&L puede usar constante sectorial. Mostrar fórmula y cobertura, no documentos ficticios para una estimación.
- Labor: contratos/asistencia, horas extra y configuración; no son los recibos de payroll. Mantener fuente MEASURED/CONTRACT_ONLY/SECTOR_DEFAULT/NO_DATA y cobertura. No publicar una provisión informativa como pasivo formal.
- Comisiones: tarifas por fecha de negocio y sucursal con fallback de empresa; medición manual de TPV toma prioridad. Reportes gateway se agregan por transactionDate y empresa/sucursal, sin filtro de status; si no hay medición manual y la comisión gateway es positiva, sustituyen la estimación TPV. Actualmente mezclan adquirentes en TPV y pueden sustituir toda una estimación con cobertura parcial. Registrar diferencia; no arreglar el P&L silenciosamente en el detalle.
- Utilidad: base de venta menos food cost, merma, labor, gasto, comisiones y caja chica. El detalle de utilidad explica esos componentes, no otra fuente de ingreso.
- Acceso: [ruta P&L](../../app/api/finance/pnl/route.ts) exige `reports:read`, clasificación FINANCIAL, `resolveBranchScope` y masking. FC-03 debe aplicar empresa/alcance antes de documentos y totales; no alcanza con ocultar filas en la pantalla. Links y evidencia requieren autorización propia.

## 3. Recorridos manuales del código

### Venta → cobro

1. `ingestSalesCut` en [sales-ingestion-service.ts](../../lib/services/sales-ingestion-service.ts) produce cortes VALIDATED/PENDING_REVIEW y rechaza duplicados de la misma clave. Los agregados de recetas de [sales-ingest-service.ts](../../lib/services/sales-ingest-service.ts) alimentan consumo teórico, no un segundo ingreso.
2. [gateway-report-service.ts](../../lib/services/gateway-report-service.ts) importa reportes, valida cuenta destino activa de empresa e ignora conflictos por `(companyId, acquirer, externalId)`.
3. [bank-statement-service.ts](../../lib/services/bank-statement-service.ts) importa extracto con fingerprint; sugiere entradas por neto/cuenta/ventana; `confirmDepositMatch` bloquea ambas filas y confirma un vínculo 1:1 por monto exacto y cuenta destino. No se verifica status gateway en esa confirmación: el adaptador debe exigir elegibilidad adicional.
4. [aggregator-settlement-service.ts](../../lib/services/aggregator-settlement-service.ts) registra una comparación por canal/periodo; no une sus filas a las del importador gateway. Pendiente resolver identidad para usar ambas sin duplicación.

### Recepción → factura → pago

1. [receiving-service.ts](../../lib/services/receiving-service.ts) guarda reporte/ítems y movimientos en transacción y puede asociar factura y ejecutar matching.
2. [invoice-matching-service.ts](../../lib/services/invoice-matching-service.ts) admite 3-way con OC o 2-way con recepción, vínculo posterior y excepción documentada. El vínculo evita tratar la factura posterior como una segunda recepción.
3. [treasury-service.ts](../../lib/services/treasury-service.ts) agenda documentos por tipo/referencia, verifica empresa y estado, autoriza corrida y confirma partidas con evidencia. Confirmar una partida espeja PAID a factura/gasto dentro de la transacción.
4. Ese espejo marca el documento completo PAID; aún no es una aplicación parcial. FC-09 debe introducir saldo/aplicaciones y enlazar el pago manual con la partida antes de automatizar.

Estos recorridos son inspección del código; no son ejecuciones UI ni pruebas de persistencia.

## 4. Dependencias bancarias verificadas en código

| Capacidad | Evidencia | Estado para este plan |
|---|---|---|
| Propósito de cuenta, default de dispersión/recepción | `companyBankAccounts.purpose`; `getDefaultDisbursementAccount`, `getDefaultDepositAccount` | Existe; reutilizar. |
| Destino de pasarela, asignación posterior y privacidad last-4 | `GatewayReportService.importReport`, `assignDestination`, `getTransactions` | Existe; verificar aislamiento en integración al conectar. |
| Matching entradas/salidas, reversión y fingerprint | `suggestDepositMatches`, `confirmDepositMatch`, `confirmMatch`, `unmatchDepositTransaction`, `importBankStatement` | Existe 1:1; depósitos agrupados siguen sin resolución 1:N. |
| Plataformas y cruce | `terminalAcquirerEnum` en finance.ts, `getPlatformCrossReport` | Existe; no equivale al vínculo contable venta-liquidación. |
| Ancla y saldo calculado por cuenta | `setCompanyBankAccountAnchor`, `getComputedAccountBalances` | Existe; reutilizar. No es libro mayor ni certifica integridad de extractos. |
| Cierre y snapshot | `closeFinancialPeriod`, `freezePnLPeriod` | Existe secuencialmente; falta protocolo compartido con publicación y versiones contables de FC-16. |

Los checklists bancarios anteriores están desactualizados respecto al código. No se modificaron. No se verificó despliegue ni se aplicaron migraciones. Búsqueda CodeGraph de `journal`, `ledger`, `accounting` y catálogo del esquema: sin libro mayor general identificado; `drizzle/meta/_journal.json` es historial de migraciones, no pólizas.

## 5. Decisiones y responsables

| ID | Decisión / propuesta concreta | Responsable | Bloqueo y momento de resolución |
|---|---|---|---|
| D01 | companyId = una razón social, confirmado; validar también ownership/franquicias al consolidar sucursales | Propietario de producto; ingeniería valida ámbito | Identidad empresarial resuelta; no incluir franquiciatario como activo propio por compartir tenant. |
| D02 | Cortes como fuente inicial de ingreso; sales_entries solo consumo/analítica; no hay tickets individuales canónicos en este circuito | Producto revisa propuesta; ingeniería implementa | Revisar antes de FC-11; FC-03 usa exactamente la base actual descrita arriba. |
| D03 | Reutilizar centros/partidas y `accountingLine` QSR, y bancos RECEPCION/DISPERSION/MIXTO. Completar vínculos/reglas por empresa, vigencia, preview de cargos/abonos y activación explícita | Ingeniería (FC-05/08), propietario autorizado y futuro contador (validación) | Contrato de desarrollo validado. Configuración administrativa sin duplicar catálogos ni editor arbitrario de fórmulas. Sin cuenta/regla vigente, evento pendiente. Versiones aplicadas quedan congeladas. |
| D04 | Aprobación reconoce gasto con businessDate explícita; pagos son aplicaciones separadas, manual/tesorería comparten identidad | Producto + futuro responsable contable; ingeniería para vínculo | Resolver identidades y parciales en FC-09; no usar el espejo PAID como segundo evento. |
| D05 | Impuestos documentados separados; propinas como obligación cuando estén identificadas; descuentos/devoluciones con referencia; no inferir IVA faltante | Futuro responsable contable, ingeniería implementa validación | Bloquea publicación automática del hecho incompleto; catálogo/cuentas y tratamiento fiscal reales se validan antes del piloto. |
| D06 | Primera apertura/fecha real todavía no aplican; usar octubre 2026 sintético. Histórico anterior se consulta, sin backfill automático | Propietario de futura empresa piloto | Bloquea FC-20/21 reales, no desarrollo ni fixtures. |
| D07 | No hay clientes ni contador designado. Asignar revisor al preparar primer piloto | Propietario de producto | FC-21 no puede declararse aprobado con tests sintéticos. |
| D08 | Publicar/revertir, configurar, cerrar y reabrir serán capacidades separadas; reutilizar ABAC y alcance, sin dar acceso global por título de contador | Ingeniería; producto revisa roles finales | Definir contrato de permisos antes de API de mutaciones FC-07/08 y cierre FC-16. |
| D09 | Valor por movimiento congelado; fecha de negocio de sucursal distinta del timestamp; preservar ambas y hacer corte explícito | Ingeniería; futuro contador valida método | FC-13/14 deben guardar valoración antes de emitir contabilidad. FC-02 probará cruce de mes y conservación. |

Revisión funcional recibida: el propietario eligió «Sí, seguir con ese contrato» para desarrollo con datos sintéticos. Se mantienen explícitos los huecos técnicos por tarea y las decisiones de un futuro piloto (cuentas concretas, tratamiento fiscal aplicable, apertura y revisor). Esta aprobación no certifica reglas fiscales para clientes. Aclaración posterior del propietario incorporada: aprovechar centros/partidas y cuentas de recepción/dispersión/mixtas existentes, sin recrearlos.

## 6. Verificación de FC-01

- Cubiertos los nueve hechos de §4 del plan, junto con documentos, correcciones, transferencias e impuestos/propinas; fuente, fecha, estado, solapamiento y hueco visibles por fila.
- Recorridos venta → cobro y recepción → factura → pago revisados contra los servicios enlazados.
- Sin cambios a runtime, migraciones ni clientes. Verificación aplicable: revisión documental, enlaces locales y `git diff --check`; no requiere build ni pruebas de aplicación.
- La skill incremental remite a `references/definition-of-done.md`, ausente en su directorio local; se aplican los checks explícitos del checklist y de la skill.

## 7. FC-02 — Mes sintético y cálculo independiente

Fixture: [month.ts](../../tests/fixtures/accounting/month.ts). Verificación de integridad del oráculo: [accounting-reference.test.ts](../../tests/unit/finance/accounting-reference.test.ts). Son resultados esperados para probar las siguientes entregas, no un motor de contabilización ni una prueba de autorización, recuperación o persistencia de la aplicación.

Octubre de 2026, MXN en centavos. Company A tiene sucursales A/B; company-foreign tiene su propia sucursal y una venta de 999999 excluida de todos los totales de A. Apertura al inicio del 1 de octubre (antes de movimientos del día): activos 1980000, proveedores 150000, capital 1830000. Incluye dos versiones de reglas (1 y 16 de octubre), vínculo recepción/factura, factura con impuesto documentado en cero, dos pagos de 10000/5000 contra gasto bruto 34800, nómina bruta 80000 con neto 70000 y deducciones 10000, impuesto y propina separados, descuento/devolución y transferencias internas.

Resultados calculados antes de ejecutar tests; el test suma las pólizas esperadas y coteja estas constantes sin importar ningún servicio de producción:

| Control de octubre (centavos) | Cálculo independiente | Esperado |
|---|---|---:|
| Banco | 1500000 - 15000 - 70000 - 1160 + 92800 - 58000 + 200000; transferencia propia neta cero | 1648640 |
| Caja | 150000 + 118000 - 11600 + 52200 | 308600 |
| Fondo caja chica | 30000 - 1160 + 1160 | 30000 |
| Inventario | 300000 + 60000 - 70000 - 5000; transferencia propia neta cero | 285000 |
| Por liquidar | Venta tarjeta 232000 + plataforma 116000 - plataforma liquidada 116000 | 232000 |
| IVA documentado recuperable | 4800 + 160 + 3200 + 8000 | 16160 |
| Equipo | Compra de activo, sin llevarla a gasto | 50000 |
| Total activos | Banco + caja + fondo + inventario + por liquidar + IVA + equipo | 2570400 |
| Proveedores | Apertura 150000 + recepción/factura 60000 + gasto 34800 - pagos 15000 | 229800 |
| Otros pasivos | IVA trasladado 69600 + propinas 2000 + deducciones 10000 + préstamo 200000 | 281600 |
| Ingreso neto | 100000 + 200000 + 100000 - devolución 10000 + venta con descuento 45000 | 435000 |
| Costos/gastos | Consumo 70000 + merma 5000 + nómina 80000 + gastos 31000 + comisión medida 20000 | 206000 |
| Resultado | Ingreso neto 435000 - costos/gastos 206000 | 229000 |
| Ecuación patrimonial | Pasivos 511400 + capital 1830000 + resultado 229000 | 2570400 |
| Sumas de pólizas de apertura + octubre | Cargos = abonos, contando regularización de factura y ambas piernas internas | 3400920 |
| Saldos deudores/acreedores de balanza | Activos 2570400 + costos/gastos 206000 = pasivos/capital/ingresos | 2776400 |
| Flujo operativo realizado | 118000 + 52200 - 11600 + 92800 - 15000 - 70000 - 1160 | 165240 |
| Flujo inversión / financiamiento | Compra equipo con IVA / préstamo recibido | -58000 / 200000 |
| Efectivo al cierre | Apertura 1680000 + operación 165240 - inversión 58000 + financiamiento 200000 | 1987240 |

La venta con tarjeta del 31 de octubre ocurrió a `2026-11-01T05:30:00Z` (31 de octubre local). Su liquidación del 2 de noviembre: neto 225040 + comisión 6000 + IVA de comisión 960 = 232000; queda fuera de octubre. No se estima una comisión contable de octubre sin documento. La devolución refiere a la primera venta, la factura refiere a recepción y ambos pagos refieren al mismo gasto; banco/gateway de noviembre explican la misma póliza, no dos cobros.

Las sucursales no son entidades jurídicas separadas: las transferencias de 100000 de banco y 20000 de inventario cambian sus activos respectivos. La ecuación patrimonial exigida aquí es de la empresa; no se oculta la diferencia de sucursal con una cuenta automática. No hay partidas corporativas sin asignar en este caso; FC-17 deberá incluir otro caso si incorpora esas partidas.

Casos de entrada que **no** se incorporan como nuevas pólizas esperadas: corte/receta solapados, reimportación de banco, comprobante en gasto y caja chica, FAILED/PENDING, gasto pendiente, estimación de nómina, lectura de empresa ajena/sucursal oculta, escritura con solo permiso de lectura, periodo cerrado e impuesto sin documentar. Cada uno tiene resultado esperado y motivo en `sourceCases`; su enforcement real se prueba al implementar los respectivos servicios.

Comando focalizado: `pnpm exec vitest run --configLoader bundle tests/unit/finance/accounting-reference.test.ts --maxWorkers 2`. No pasar un separador `--` al script: en este entorno llegaba literalmente a Vitest e iniciaba la suite completa en lugar de aplicar el filtro. Checkpoint técnico: resultados de ejecución se registran en el checklist FC-02 al finalizar.
