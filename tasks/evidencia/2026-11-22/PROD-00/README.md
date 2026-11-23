# PROD-00 — rastreo y preparación de integridad de órdenes

Base: `d05eae09d67ed0b190b6785da168a8fb8b564fd0`, más diff local. Al comenzar ya estaban modificados `production-service.ts` y `production-fefo-db.test.ts`: guardas de orden/receta/estado y cuatro regresiones. Se conserva ese trabajo y se amplía la verificación. Sin migraciones ni escrituras en bases externas.

Estado: **PROD-00 aceptado (D)** tras cerrarse `INV-02` en `2d3f879` y repetirse **67/67** pruebas focales (`exit 0`, 27.35 s). Esta aceptación destraba `PROD-01.a`; no acredita `PROD-01.a/b` ni `PROD-02`.

## Modelo y consumidores observados

| Modelo | Escritura / lectura actual | Consecuencia |
|---|---|---|
| `production_orders` (schema raíz) | `ProductionService.createOrder`, `recordProductionInTransaction`, `PrepListService.createLine/updateLine/completeLine`; API production y prep-list | Es la planificación operativa compartida; el cierre requiere registro real y no un PATCH de estado. |
| `production_results` y `production_ingredients` (schema raíz) | `recordProductionInTransaction`, invocado también por `produceRecipeWithFefo`; `HoldTimeService`; genealogía de insumos en `/api/inventory/batches` | Fuente actual del hecho producido, costo, insumos y retención. Mantener IDs e históricos. |
| `production_plans`, `production_plan_items`, `production_batches` (`lib/db/schema/production.ts`) | Definiciones presentes; búsqueda literal en `app/` y `lib/` no localiza consumidores fuera de ese módulo | La definición y `inventoryBatchId` nullable no acreditan un lote disponible ni un recorrido aplicado. No eliminar tablas ni migrar históricos por esta observación. |
| `inventory_batches` | FEFO y registro de producción descuentan insumos; writer canónico de ventas aplica diferencias | El cierre actual no inserta stock terminado. Hace falta identidad de producto elaborado y vínculo único al resultado. |
| Venta de subreceta | `sale-consumption-snapshot.ts` expande recursivamente hasta ingredientes; también existe el recorrido legacy `TheoreticalConsumptionService` | Añadir terminado sin cambiar el contrato de consumo permite descontar ingredientes al producir y otra vez al vender. INV-02 es una dependencia real. |

Contexto obtenido mediante CodeGraph context/explore; lecturas focales de los archivos anteriores y búsqueda literal de nombres de tablas. Alcance: código local, no catálogo ni datos operativos.

## Decisión de preparación

Conservar `production_orders` → `production_results` → `production_ingredients` como recorrido operativo y punto de extensión transaccional. PROD-01 debe definir el vínculo del resultado con el lote terminado y su producto inventariable, unidades, costo, caducidad y genealogía. No activar esa ampliación hasta resolver INV-02 (venta directa frente a consumo de elaborado). La compatibilidad con `production_batches` requiere diseño/migración explícitos, sin asumir que está vacío.

Brecha visible adicional para PROD-02: el botón «Completar Lote» del cliente de producción carga receta/cantidad, pero debe verificarse la transmisión de `orderId` al formulario y al POST; la prep list tiene su propio cierre con `orderId`. No se acredita integración de UI con la protección de órdenes por tests de servicio.

## Preparación de cierre único

El registro bloquea la orden y verifica empresa/sucursal, receta y estado antes de consumir. Un workflow ya aplicado puede repetir sin nuevo consumo; un origen distinto recibe conflicto. Se amplía el PATCH de production con permiso `inventory:update`, alcance de sucursal, validación estricta y lock compartido. COMPLETED sólo se escribe al producir; no puede reabrirse por edición. Se conserva la reactivación de canceladas. También se protege la edición de prep list contra cambios de estado que eludan la producción.

La prueba usa PGlite efímero, con tablas derivadas del schema y un índice real de idempotencia; no replica constraints/RLS completos ni demuestra carreras entre conexiones PostgreSQL. Los tests HTTP llaman al handler con sesión simulada; no acreditan Better Auth o navegador.

## Verificación

- RED inicial de PATCH: 8 fallos reproducidos (200 incorrecto), 12 pruebas existentes/caso válido pasan.
- GREEN intermedio: 46/46 en `production-scope.test.ts` y `production-fefo-db.test.ts`, incluyendo cancelación/reactivación y rechazo de reapertura con SQL.
- Lint inicial: exit 0, tres advertencias de imports sin uso preexistentes en la ruta.
- RED de prep list: 2 fallos reproducidos con SQL (reapertura y cierre sin insumos).
- GREEN final: `pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads tests/unit/inventory/production-scope.test.ts tests/unit/inventory/production-fefo-db.test.ts lib/inventory/__tests__/prep-list.test.ts` → exit 0, **67/67**, 3 archivos; 28 casos de producción SQL, 20 de scope/handler y 19 de reglas de hoja. Duración 40.81 s.
- `pnpm.cmd exec eslint app/api/inventory/production/route.ts lib/services/production-service.ts lib/services/prep-list-service.ts tests/unit/inventory/production-scope.test.ts tests/unit/inventory/production-fefo-db.test.ts` → exit 0, tres advertencias previas de imports sin uso en la ruta.
- `git diff --check` → exit 0 (aviso de normalización CRLF en pruebas).
- Build inicial `pnpm.cmd run build`: compilación Turbopack correcta en 8.1 min, luego **fallo de heap en TypeScript** (GC alrededor de 2042 MB, `Ineffective mark-compacts near heap limit`, worker exit 134; sesión exit 1). El `tsc --noEmit` independiente se interrumpió, exit 1 sin diagnóstico, para evitar competencia con el worker de build; no acredita tipos.
- Recuperación: **tipos globales exit 0** con `NODE_OPTIONS=--max-old-space-size=4096`, `pnpm.cmd exec tsc --noEmit`, sin build paralelo, siguiendo el antecedente de `INV-01.b4.smartlink.ui/alternate-executor.md`. Build Webpack/heap 4 GB solicitado a continuación; resultado final pendiente. No se ejecutó la suite global ni V2 Neon.

Pendiente: INV-02, stock terminado y venta sin doble consumo, RLS/runtime independiente, carreras Postgres, aceptación API/UI integrada y despliegue. No se modifican estados funcionales de la matriz por esta preparación.
