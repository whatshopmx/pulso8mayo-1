# Plan de corrección de lotes y FEFO

Fecha: 2026-10-24.
Estado: FEFO-01/02/03 y Checkpoint 1 completados; [evidencia de cierre](evidencia/lotes-fefo/FEFO-03B/README.md). FEFO-04A, 04B-1 y 04B-2 completados el 2026-10-26: los envíos automáticos y por lote explícito ya usan elegibilidad común, con rollback íntegro ante faltantes. Verificación actual: 92 pruebas enfocadas, suite general de 175 archivos/2,204 pruebas pasadas, lint sin errores y build completo con TypeScript/430 páginas aprobados; [evidencia](evidencia/lotes-fefo/FEFO-04B-2/README.md). Continúa FEFO-04B-3 (producción), después consumo teórico y selector/preview. Líneas fraccionarias, desglose de transferencia y recepción por asignación siguen en FEFO-07A/B. Investigación de base: [estado-2026-10-26.md](evidencia/lotes-fefo/estado-2026-10-26.md).
Seguimiento: [todo-lotes-fefo.md](todo-lotes-fefo.md).

## Objetivo y alcance

Conseguir que las existencias por lote reflejen la operación física y que cada entrada, consumo, transferencia, elaboración, ajuste y merma conserve cantidades, origen y caducidad. Mantener un producto por lote. Una recepción puede agrupar distintos productos y varios lotes de cada producto; una categoría define políticas, no un lote consumible compartido.

El primer entregable es FEFO-01 a FEFO-05: diagnóstico, reglas, permisos y descuentos confiables. Documentar este plan no autoriza por sí mismo aplicar correcciones históricas, migraciones o despliegues en producción.

## Evidencia de la investigación

Hallazgos de lectura del código; no equivalen a una auditoría de datos reales ni a pruebas de explotación:

- `lib/db/schema.ts`: `inventoryBatches` vincula un producto y una sucursal con cantidad inicial/actual, fechas, costo y estado. Incluye `origin` y `parentBatchIds`; verificar su uso efectivo antes de agregar campos equivalentes.
- `lib/services/receiving-service.ts` e `inventory-service.ts`: la recepción crea lote y movimiento en una transacción; `createReceivingBatch` inicia el saldo en cero y el movimiento lo incrementa. Conservar esta protección contra doble entrada.
- `lib/services/fefo-allocator.ts`: asigna lotes AVAILABLE con saldo positivo, ordenados por caducidad y antigüedad, con bloqueo de filas; no valida directamente la vigencia de la fecha.
- `app/api/inventory/batches/route.ts`: listado, trazabilidad y cambio de estado verifican sesión, pero no aplican explícitamente alcance por empresa/sucursal. El listado excluye cantidades negativas.
- `lib/services/expiration-alert-service.ts` y `lib/inngest/functions/cron-stock-check.ts`: existe clasificación programada de caducidades y cambio a EXPIRED; el descuento no debe depender de su puntualidad.
- `lib/services/inventory-service.ts`: al enviar por FEFO desde varios lotes se conserva un lote primario; la recepción de transferencia hereda sus datos. Se debe preservar el desglose completo. También revisar redondeos de cantidades fraccionarias y conservación de costos.
- `lib/services/production-service.ts` y `recipe-production.ts`: producción descuenta ingredientes; la creación de lote del producto terminado figura pendiente en el flujo revisado.
- `lib/services/theoretical-consumption-service.ts`: el faltante puede generar saldo negativo o un lote DUMMY-NEG. Se requiere un recorrido explícito de diferencias.
- `app/api/inventory/waste/route.ts`: revisar atomicidad entre saldo, movimiento y aprobación, además de la validación existente de pertenencia del lote.

Antes de implementar, actualizar el contexto con CodeGraph y contrastar los hallazgos con la revisión actual. Evitar duplicar trabajo ya resuelto por otros planes de inventario/producción.

## Modelo y decisiones

1. Categoría: valores predeterminados de seguimiento, caducidad, alertas y estrategia de salida. Producto: configuración efectiva y unidad base. Lote: identidad de producto y origen. Existencia: saldo y condición por sucursal/ubicación. Recepción: documento que agrupa entradas. Movimiento: evidencia de cada variación.
2. Separar conceptualmente identidad de lote y existencia local. Decidir la representación física en FEFO-02; no imponer una reescritura general de tablas para corregir permisos y descuentos. Reutilizar campos y relaciones existentes cuando sean suficientes.
3. Conservar códigos del proveedor y distinguirlos de identificadores internos. La coincidencia textual de códigos no prueba identidad; considerar empresa, producto, proveedor/fabricante, origen y fechas. No imponer unicidad global del número de lote.
4. FEFO asigna entre lotes elegibles del mismo producto y sucursal, por vencimiento ascendente; desempate estable por antigüedad e identificador. Política explícita para fechas nulas. FIFO usa antigüedad cuando esté configurado.
5. Estados y fecha son condiciones independientes: AVAILABLE no hace consumible un lote vencido. La selección explícita de lote debe pasar las mismas validaciones. Una merma sí debe poder retirar existencias vencidas o en cuarentena, con permisos y motivo.
6. Una sola operación transaccional debe ser dueña de cada cambio de saldo y su movimiento. Preservar cantidades a cuatro decimales y costos monetarios en centavos; evitar conversiones o redondeos intermedios que pierdan cantidad o valor.
7. Los consumos físicos no generan saldos negativos. Propuesta para consumos teóricos por ventas: registrar asignación real y faltante separado, con idempotencia y conciliación. Confirmar el contrato en FEFO-02 antes de modificar el comportamiento actual.
8. Producción almacenable genera lote de salida y genealogía de ingredientes; servicio inmediato registra producción/consumo sin obligar a generar stock terminado.
9. Lote reservado requiere un contrato de reserva y liberación: no habilitar su consumo genérico. Documentar si existen reservas parciales; no sustituirlas con un estado global que bloquee incorrectamente todo el saldo.
10. Transferencias conservan identidad de origen por cada asignación, cantidades parciales y costo. El tránsito no crea un lote de fabricación nuevo.
11. No cambiar políticas o fechas históricas por editar una categoría. Toda liberación de cuarentena, excepción o ajuste debe tener responsable, motivo y auditoría.

## Reglas que debe cerrar FEFO-02

- Fecha sin hora: proponer vigencia hasta el final del día local de la sucursal; validar contra el significado de la etiqueta. Fecha con hora: respetar el instante. No interpretar todos los vencimientos a medianoche ni usar el reloj del navegador para autorizar salidas.
- Producto perecedero sin fecha: proponer impedir su disponibilidad hasta completar información o registrar una excepción autorizada; no inventar fecha ni vida útil.
- Producto sin vencimiento por naturaleza: permitir política FIFO o posición definida para fecha nula, sin confundirlo con un dato faltante.
- Definir roles que cambian políticas, liberan cuarentena, corrigen fechas o seleccionan un lote distinto del sugerido.
- Determinar tratamiento de devolución, cancelación, reversión, reserva y reapertura de periodos: preservar movimientos originales mediante compensaciones y referencias.
- Definir si una recepción de transferencia puede ser parcial en varias sesiones y cómo se cierra el faltante de transporte sin doble descuento.
- Identificar producto/unidad de salida y vida útil validada por operación de cada preparación almacenable.

## Tareas y dependencias

Cada tarea es una sesión enfocada. Tamaño S: 1–2 archivos; M: 3–5. Las rutas son candidatas; si el recorrido exige más de cinco archivos, dividir la tarea antes de implementarla y actualizar el checklist.

| ID | Entregable | Depende de | Tamaño |
|---|---|---|---|
| FEFO-01 | Diagnóstico y mapa de escrituras | Ninguna | M |
| FEFO-02 | Contrato operativo y diseño mínimo de datos | 01 | S |
| FEFO-03 | Aislamiento de listado, trazabilidad y estados | 01 | M |
| FEFO-04 | Elegibilidad y asignación FEFO/FIFO común | 02, 03 | M |
| FEFO-04A | Preparar motor puro y pruebas, sin activar salidas | 02 | S |
| FEFO-04B | Integrar asignación y selección explícita en servidor | 03, 04A | M |
| FEFO-04B-1 | Consulta con alcance/bloqueo y pruebas SQL, sin activar consumidores | 04A; activación tras 03 | M |
| FEFO-04B-2 | Integrar envío de transferencia automático y explícito | 03, 04B-1 | M |
| FEFO-04B-3 | Integrar producción automática y manual | 03, 04B-1 | M |
| FEFO-04B-4 | Integrar consumo teórico y retirar allocator anterior | 03, 04B-1, 04B-2, 04B-3 | M |
| FEFO-04C | Alinear selector/preview y revalidación | 04B | M |
| FEFO-05A | Descuento transaccional e idempotencia | 04 | M |
| FEFO-05B | Merma y ajustes consistentes | 05A | M |
| FEFO-05C | Faltantes de consumo teórico | 02, 05A | M |
| FEFO-06A | Identidad y vínculos de recepción | 02 | M |
| FEFO-06B | Captura de varios lotes por producto | 04, 06A | M |
| FEFO-07A | Desglose persistido de transferencia | 05A, 06A | M |
| FEFO-07B | Recepción y diferencias de transferencia | 07A | M |
| FEFO-08 | Configuración de preparación almacenable | 02 | M |
| FEFO-09A | Lote terminado y genealogía | 05A, 06A, 08 | M |
| FEFO-09B | Integración de producción en sus entradas | 09A | M |
| FEFO-10A | Resolución de políticas categoría/producto | 02, 04 | M |
| FEFO-10B | Edición de políticas y validación de captura | 06B, 10A | M |
| FEFO-11A | Consulta operativa y diferencias visibles | 05C, 06B, 07B, 09B, 10B | M |
| FEFO-11B | Trazabilidad y etiquetas operativas | 11A | M |
| FEFO-12A | Propuesta de conciliación histórica | 01, 05B, 05C, 07B, 09B | M |
| FEFO-12B | Validación integral y piloto | Todas las anteriores | M |

Los criterios y verificaciones específicos están en el checklist vinculado. Checkpoints después de 01–03, 04–05C, 06A–07B, 08–09B, 10A–11B y 12A–12B. FEFO-06A, 08 y 10A pueden prepararse tras cerrar sus dependencias, pero las migraciones y cambios compartidos se integran secuencialmente.

## Verificación

- Pruebas unitarias de política, elegibilidad, orden estable, precisión y conversiones.
- Pruebas de integración en base aislada: concurrencia real entre transacciones, rollback, movimientos, idempotencia, permisos y conservación de cantidades/costos. Un mock del allocator no demuestra exclusión mutua.
- Pruebas de navegador: recepción dividida, selección FEFO, merma, transferencia y preparación almacenable. Fixtures propias, sin modificar inventario real.
- Usar scripts existentes: `pnpm run test:unit -- <archivo>`, `pnpm run test:integration -- <archivo>`, `pnpm exec playwright test <archivo>` según configuración efectiva del repositorio. Confirmar inclusión de cada prueba en su configuración antes de considerarla ejecutada.
- En cada checkpoint ejecutar pruebas enfocadas y lint de archivos afectados. Al cierre ejecutar suites pertinentes, `pnpm run lint` y `pnpm run build`; registrar fallos preexistentes separadamente y no darlos por resueltos.
- Evidencia por tarea en `tasks/evidencia/lotes-fefo/<ID>/`: resultado, comando, casos verificados y limitaciones. No guardar credenciales ni datos personales innecesarios.

### Casos obligatorios

1. Entrada más reciente con vencimiento anterior se consume primero.
2. Solicitud que atraviesa varios lotes conserva fracciones y suma exacta.
3. Vencido AVAILABLE se rechaza sin depender del cron; cuarentena y reserva también.
4. Dos salidas simultáneas no sobreconsumen; reintentos no duplican movimientos.
5. Fallo después de una escritura revierte saldo y movimiento.
6. Producto, lote, sucursal o empresa incompatibles no se leen ni modifican.
7. Dos recepciones del mismo código preservan documentos y origen; productos distintos con igual código no se mezclan.
8. Transferencia de dos caducidades conserva ambas, costo y cantidades; parciales y merma no duplican descuentos.
9. Producción almacenable enlaza todos los lotes de ingredientes y no duplica salida al reintentarse.
10. Consumo teórico insuficiente deja diferencia visible, sin un lote físico negativo nuevo.
11. Fecha nula, fecha sin hora y vencimiento durante el día siguen el contrato acordado.
12. Cambiar políticas no altera fechas ni cantidades históricas; reversión conserva evidencia.

## Migración, conciliación y despliegue

Primero reporte de solo lectura. No recalcular saldos masivamente como suma de movimientos sin comprobar saldos iniciales y cobertura histórica del kardex. No fusionar lotes ni reemplazar caducidades por inferencias.

Los cambios de esquema serán aditivos y compatibles con registros existentes; generar y revisar SQL, índices y backfill con simulación. Nunca usar `db:push` para este trabajo. Coordinar numeración con las migraciones ya presentes; no reservar números en este plan. Probar migración en base aislada antes de aplicación al entorno objetivo.

Desplegar por capacidades después de verificar compatibilidad de lectores/escritores. Elegir una sucursal piloto y observar diferencias de stock, rechazos por caducidad, faltantes y duplicados. La reversión debe desactivar la capacidad nueva conservando movimientos, códigos y genealogía ya registrados; nunca borrar historial para volver al código anterior.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Diferencias históricas confundidas con errores nuevos | Línea base, clasificación por origen y corrección por movimientos auditados. |
| Caducidad interpretada con otro huso horario | Contrato por tipo de fecha y pruebas en límites del día. |
| Creación duplicada desde API/workflow/reintento | Idempotencia por evento y transacción compartida. |
| Descuentos dobles al integrar servicios | Un dueño explícito del saldo; prueba de entrada/salida y ledger. |
| Transferencia o conversión pierde decimales/costo | Conservación de cantidades/valor con fixtures fraccionarias. |
| Etiqueta física distinta del lote descontado | Etiqueta legible, sugerencia verificable y selección alternativa auditada. |
| Modelo de categorías insuficiente o compartido | Inspeccionar modelo real antes de agregar tablas; políticas siempre dentro de empresa. |
| Otros cambios locales en esquema y migraciones | No sobrescribirlos; integrar el mínimo diff y coordinar numeración. |

## Referencias de la investigación externa

- [GS1 Global Traceability Standard](https://www.gs1.org/standards/gs1-global-traceability-standard/current-standard): identidad de producto y lote; distinción con unidades logísticas.
- [Odoo: FEFO](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/shipping_receiving/removal_strategies/fefo.html): seguimiento por lote y selección por fechas de salida.
- [Odoo: caducidades](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/product_management/product_tracking/expiration_dates.html): configuración de fechas y estrategias por categoría/ubicación.

Las decisiones propuestas para Pulso son de diseño del producto; estas referencias no sustituyen políticas operativas ni constituyen una certificación de cumplimiento normativo.
