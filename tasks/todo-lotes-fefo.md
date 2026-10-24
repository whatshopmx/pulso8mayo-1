# Tareas: corrección de lotes y FEFO

Plan: [plan-lotes-fefo.md](plan-lotes-fefo.md). Implementación iniciada; diagnóstico FEFO-01 contrastado con el demo Condesa.
Cada cierre requiere evidencia en `tasks/evidencia/lotes-fefo/<ID>/`. Archivos indicados como candidatos, no contratos de implementación. Dividir cualquier tarea que exceda cinco archivos.

## Fase 1 — Diagnóstico y contrato

- [x] **FEFO-01 (M): diagnóstico y mapa de escrituras.** Dependencias: ninguna.
  - [x] **FEFO-01A:** herramienta exclusivamente de lectura, mapa actual y contraste con casos controlados en PGlite. Evidencia: `tasks/evidencia/lotes-fefo/FEFO-01/README.md`.
  - [x] **FEFO-01B:** ejecutado en demo Condesa, alcance elegido con autorización del usuario; 25 lotes, 3 vencidos disponibles, 8 sin movimientos, 15 diferencias por revisar y 2 coincidencias con apertura + ledger. Consulta independiente confirma conteos básicos. No se aplicaron correcciones. Límites del historial documentados en evidencia.
  - Aceptación: inventario de todos los escritores/lectores de lotes, incluidas API, workflows y cron; reporte de negativos, fechas faltantes, vencidos disponibles y discrepancias entre saldo/movimientos; clasificación sin modificar registros.
  - Verificación: ejecutar reporte de solo lectura en entorno autorizado y contrastar casos controlados; documentar vacíos de historial y pruebas existentes aprovechables.
  - Archivos candidatos: nuevo reporte en `scripts/`, `inventory-service.ts`, documento de evidencia y pruebas del reporte.
- [ ] **FEFO-02 (S): contrato operativo y diseño mínimo.** Depende de 01.
  - Aceptación: resolver fecha/huso horario, fecha nula, faltantes físicos/teóricos, reservas, excepciones y reversión; definir identidad del lote y existencia local; acordar compatibilidad de esquema y comportamiento.
  - Verificación: tabla de ejemplos con resultados esperados; revisión operativa de decisiones abiertas antes de programar comportamiento dependiente.
  - Archivos: plan y documento de contrato en `docs/`.
- [ ] **FEFO-03 (M): permisos de lotes.** Depende de 01.
  - Aceptación: empresa/sucursal/rol en listado, trazabilidad y PATCH; impedir cambios ajenos y estados no autorizados; auditoría de cambios con motivo y responsable.
  - Verificación: pruebas API con dos empresas, sucursales y roles; identificadores ajenos no revelan ni modifican datos.
  - Archivos: `app/api/inventory/batches/route.ts`, helper de alcance existente y pruebas enfocadas.
- [ ] **Checkpoint 1:** diagnóstico y decisiones disponibles; permisos verificados; pruebas enfocadas y lint pasan.

## Fase 2 — Consumo confiable

- [ ] **FEFO-04 (M): elegibilidad y asignación común.** Depende de 02, 03.
  - Aceptación: FEFO/FIFO estable según política; validación de fecha, estado, saldo, producto y sucursal, también para lote explícito; fecha nula sigue contrato.
  - Verificación: orden inverso al de recepción, empates, fecha límite, cron detenido, reserva y cuarentena; precisión en reparto entre lotes.
  - Archivos: `fefo-allocator.ts`, helper de política, selector/preview consumidor y pruebas.
- [ ] **FEFO-05A (M): salida transaccional e idempotente.** Depende de 04.
  - Aceptación: validación/descuento/movimiento atómicos; protección de concurrencia; reintento de la misma operación no repite descuento.
  - Verificación: integración con dos transacciones competidoras, stock insuficiente, reintento y fallo intermedio; no saldos físicos negativos.
  - Archivos: `inventory-service.ts`, servicio compartido si hace falta y pruebas de integración.
- [ ] **FEFO-05B (M): merma y ajustes.** Depende de 05A.
  - Aceptación: saldo y kardex coherentes en merma/aprobación/ajuste; permitir descarte de vencido o cuarentena; rechazar baja superior al saldo y doble aprobación; no liberar bloqueos accidentalmente al ajustar.
  - Verificación: merma parcial/total/concurrente, aprobación repetida y ajuste fraccionario; estado agotado consistente.
  - Archivos: API de merma/aprobación, `stock-count-service.ts`, pruebas enfocadas; dividir si requiere más de cinco archivos.
- [ ] **FEFO-05C (M): faltante teórico explícito.** Depende de 02, 05A.
  - Aceptación: consumo por ventas conserva cantidad requerida/asignada/faltante e identidad del evento; no genera nuevos lotes DUMMY-NEG; diferencia consultable e idempotente.
  - Verificación: stock cero/parcial, reintento y conciliación posterior; compatibilidad documentada con reportes y costo teórico.
  - Archivos: `theoretical-consumption-service.ts`, almacenamiento/consulta de diferencias y pruebas.
- [ ] **Checkpoint 2:** aislamiento, caducidad, concurrencia, rollback, fracciones y faltantes demostrados; pruebas enfocadas y lint pasan.

## Fase 3 — Recepción y transferencia

- [ ] **FEFO-06A (M): identidad de lote y recepción.** Depende de 02.
  - Aceptación: distinguir código original, ID interno y recepción; conservar proveedor/origen; migración aditiva solo si hace falta; sin unicidad global ni fusiones automáticas.
  - Verificación: dos entregas de un lote, dos productos con mismo código y recepción sin código; generar/revisar SQL y probarlo en base aislada.
  - Archivos: `lib/db/schema.ts`, migración, `receiving-service.ts` y pruebas.
- [ ] **FEFO-06B (M): captura dividida por lote.** Depende de 04, 06A.
  - Aceptación: mismo producto con varios códigos/caducidades en una recepción; totales de cantidad y valor correctos; rechazo o excepción explícita de fecha faltante según política.
  - Verificación: navegador y API con dos lotes, conversión de unidad y reintento de recepción.
  - Archivos: formulario real de recepción, validación/servicio y pruebas.
- [ ] **FEFO-07A (M): asignaciones de transferencia.** Depende de 05A, 06A.
  - Aceptación: persistir cada lote/cantidad/costo enviado; conservar vínculo de origen; no reducir trazabilidad a un lote principal.
  - Verificación: envío desde dos lotes fraccionarios y envío concurrente; sumas y costo conservados.
  - Archivos: esquema/migración, `inventory-service.ts` y pruebas.
- [ ] **FEFO-07B (M): recepción de transferencia.** Depende de 07A.
  - Aceptación: cantidad recibida por asignación, lotes y caducidades conservados; tránsito/parciales/faltantes registrados sin doble descuento; recepción repetida idempotente.
  - Verificación: dos caducidades, recepción parcial repetida, merma de transporte y rechazo de exceso; no redondear cantidades a enteros.
  - Archivos: `inventory-service.ts`, API/formulario de recepción de transferencia y pruebas.
- [ ] **Checkpoint 3:** recepción → consumo parcial → transferencia → destino conserva cantidades, costo y origen; pruebas enfocadas y lint pasan.

## Fase 4 — Producción almacenable

- [ ] **FEFO-08 (M): configurar salida almacenable.** Depende de 02.
  - Aceptación: tipo de elaboración, producto/unidad de salida y vida útil validada; servicio inmediato mantiene contrato explícito; registros previos sin cambio automático de comportamiento.
  - Verificación: receta inmediata, salsa almacenable y configuración incompleta rechazada.
  - Archivos: esquema de receta, migración si procede, API/formulario y pruebas; dividir si excede cinco.
- [ ] **FEFO-09A (M): lote terminado y genealogía.** Depende de 05A, 06A, 08.
  - Aceptación: ingredientes, resultado, lote de salida y movimientos atómicos; vínculos a todos los lotes consumidos; costo, rendimiento y cantidades coherentes.
  - Verificación: varios lotes de un ingrediente, fracciones, fallo intermedio, faltante según contrato y reintento sin duplicado.
  - Archivos: `production-service.ts`, `recipe-production.ts`, modelo de genealogía y pruebas.
- [ ] **FEFO-09B (M): integrar entradas de producción.** Depende de 09A.
  - Aceptación: API y workflows utilizan la misma operación; preview coincide con reglas efectivas y se revalida al confirmar; lote alternativo registra motivo.
  - Verificación: navegador/API/workflow con la misma preparación y carrera entre preview y confirmación.
  - Archivos: ruta de producción, `production-from-workflow.ts`, cliente de producción y pruebas.
- [ ] **Checkpoint 4:** preparación almacenada visible y rastreable hasta ingredientes; servicio inmediato correcto; pruebas enfocadas y lint pasan.

## Fase 5 — Políticas y consulta

- [ ] **FEFO-10A (M): políticas efectivas.** Depende de 02, 04.
  - Aceptación: categoría como default y override por producto, siempre dentro de empresa; FEFO/FIFO, seguimiento, fecha y alertas resueltos consistentemente; cambios no reescriben historia.
  - Verificación: herencia, override, cambio de categoría, producto antiguo y aislamiento entre empresas.
  - Archivos: modelo real de categoría/producto, migración, resolver y pruebas.
- [ ] **FEFO-10B (M): edición de políticas.** Depende de 06B, 10A.
  - Aceptación: controles con permisos, validación y explicación del valor heredado; recepción aplica la política efectiva y documenta excepciones autorizadas.
  - Verificación: guardar/recargar en navegador, rol restringido y API con datos inválidos.
  - Archivos: API/formularios de catálogo y recepción, pruebas.
- [ ] **FEFO-11A (M): lotes y diferencias visibles.** Depende de 05C, 06B, 07B, 09B, 10B.
  - Aceptación: origen/recepción/categoría y disponibilidad claros; diferencias negativas históricas visibles en sección explícita; filtros y métricas explican su alcance.
  - Verificación: API y navegador con lotes agotados, vencidos, sin fecha y diferencias pendientes; prueba de alcance por sucursal.
  - Archivos: `app/dashboard/inventory/lotes/page.tsx`, API, hook y pruebas.
- [ ] **FEFO-11B (M): trazabilidad y etiqueta.** Depende de 11A.
  - Aceptación: navegación de recepción/transferencia/preparación a lotes relacionados; etiqueta identifica producto, lote y caducidad sin inventar datos; refleja selección física.
  - Verificación: seguimiento de lote proveedor → preparación → transferencia y etiqueta legible en móvil/impresión.
  - Archivos: diálogo de trazabilidad, API, componente de etiqueta y pruebas.
- [ ] **Checkpoint 5:** recorrido diario comprensible, usable con teclado y móvil; políticas y fechas sin contradicciones; pruebas enfocadas y lint pasan.

## Fase 6 — Conciliación y piloto

- [ ] **FEFO-12A (M): propuesta de saneamiento histórico.** Depende de 01, 05B, 05C, 07B, 09B.
  - Aceptación: reporte antes/después con razones por corrección; simulación repetible; sin fusiones por código ni recalcular saldos ignorando saldos iniciales; ajustes auditados.
  - Verificación: fixtures con historia incompleta, duplicado aparente, negativo y caducidad desconocida; ejecución real solo tras revisión concreta de los cambios.
  - Archivos: script de diagnóstico/conciliación, pruebas y evidencia.
- [ ] **FEFO-12B (M): validación integral y piloto.** Depende de todas las anteriores.
  - Aceptación: matriz obligatoria del plan completa; migraciones probadas; sucursal piloto y reversión documentadas; límites conocidos registrados.
  - Verificación: suites unitarias/integración pertinentes, E2E, `pnpm run lint` y `pnpm run build`; monitorear diferencias, rechazos y reintentos sin duplicados.
  - Archivos: pruebas integrales, evidencia y guía operativa/despliegue.
- [ ] **Checkpoint final:** criterios demostrados, conciliación revisable, procedimientos de recepción/etiquetado/consumo documentados y piloto evaluado antes de extender a todas las sucursales.
