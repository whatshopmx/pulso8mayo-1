# Conteo de inventario por categoría y lote

Dirección confirmada: lista completa de productos y lotes por categoría; al
terminar, guardar para revisión. No ajustar existencias durante la captura.

## Incrementos

1. Contrato y validación: cantidades fraccionarias, cero distinto de pendiente,
   alcance inmutable de producto/lote, totales por producto para reportes.
2. Servidor: resolver categorías contra el inventario de la sucursal al iniciar,
   congelar productos/lotes, guardar borradores y cerrar para revisión.
3. Captura: componente compartido, búsqueda, pendientes, navegación por teclado,
   guardado automático serializado y recuperación tras recargar.
4. Wizard y entradas: seleccionar categorías reales y generar bloques editables
   del workflow; usar el mismo componente al iniciar desde Inventario.
5. Revisión: desglose por lote, aplicación explícita e idempotente de ajustes a
   los lotes contados, manteniendo la compatibilidad con conteos anteriores.

## Decisiones

- La plantilla guarda categorías; cada ejecución resuelve el catálogo vigente.
- La definición congelada y el valor del paso conservan el detalle por lote;
  `stock_counts` conserva los totales por producto. No requiere migración.
- Cada producto activo sin lotes disponibles aparece con "Sin lote registrado".
- Los lotes disponibles próximos a vencer o vencidos pueden contarse; no se
  aplican las restricciones de un selector de lotes para despacho.
- Respetar el modo ciego y el alcance por empresa/sucursal en las entradas.
- No recortar categorías a los primeros 30 productos.

## Aceptación

- Una categoría de 40 productos se captura en una lista, sin 40 pasos.
- Dos lotes del mismo producto conservan cantidades e identidad independientes.
- Borrador parcial recuperable; no se completa con pendientes ni lotes ajenos.
- Finalizar no cambia stock; aprobar una vez registra movimientos por lote.
- Reportes existentes siguen recibiendo el total contado por producto.
- Conteos anteriores conservan su ejecución y revisión.
- Pruebas unitarias, TypeScript, lint y build; verificar escritorio y móvil en
  navegador y recorrer captura, recarga, finalización y revisión.

## Estado de implementación (16-10-2026)

Se añadió la entrada **inline** pedida: al seleccionar una categoría, su conteo
aparece en la misma pantalla de Inventario, con un renglón por producto y lote
disponible (y su vencimiento, FEFO), sin redirigir a un formulario por producto.

- **B1 (servidor):** `GET /api/inventory/stock-count/rows` devuelve las filas de
  la categoría (empresa de la sesión, sucursal validada por alcance).
  `createStockCountInstance` acepta `initialValues` por categoría y los valida
  con `normalizeStockCount` contra las filas congeladas antes de escribir.
- **B2 (pantalla):** `StockCountLauncher` reemplaza el formulario que sólo
  enviaba categorías; muestra el grid por categoría al marcarla y conserva lo
  capturado como borrador del conteo al confirmar.
- Evidencia: `tests/unit/workflows/stock-count-rows-route.test.ts` (3),
  `tests/unit/workflows/stock-count-prefill.test.ts` (3),
  `tests/unit/inventory/stock-count-launcher.test.ts` (4) y
  `tests/e2e/stock-count-inline.spec.ts` (2, navegador aislado).

**Pendiente conocido (no incluido en B):** el mismo template "Conteo de
Inventario" lanzado por la vía genérica (`POST /api/workflows/execute` desde
Plantillas/Ejecutar/Compartir/agendado) conserva la rama legacy de
`workflow-execution-service.ts` que genera **un paso por producto sin lote**
(`getProductsWithStock` + `generateStockCountSteps`). La pantalla de Inventario
ya no usa esa rama, pero la inconsistencia sigue viva para quien lance el
template por otra entrada. Se deja anotada para decidir su retiro.
