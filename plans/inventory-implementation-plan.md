# Plan de Implementación — Módulo de Inventario Completo (sin POS)

> Basado en `inventory.md` (PRD) y el código existente en `app/dashboard/inventory/`.

## Estado actual: ~55% construido

- **18 rutas de UI**, **24+ APIs**, **18 tablas DB**, **6 servicios**, **componentes robustos**
- CRUD completo: productos, proveedores, lotes, ubicaciones, recetas
- Flujos complejos: órdenes de compra (con aprobaciones), recepción 3-way (CFDI), transferencias entre sucursales, conteos ciegos, mermas, alertas, auditoría

---

## Fase 0 — Reparaciones críticas (1-2 días)

| # | Archivos | Descripción |
|---|---|---|
| 0.1 | `lib/cron/inventory-checks.ts`, `lib/inngest/functions/cron-inventory-checks.ts` | Reactivar cron de alertas (stock bajo, vencimientos, price increase) — hoy está hardcodeado a `skipped` |
| 0.2 | `app/dashboard/inventory/invoices/` + API | Conectar tabla `creditNotes` a UI — existe la tabla pero no hay pantalla para ver/crear notas de crédito |
| 0.3 | `app/api/inventory/ocr/`, `components/inventory/receiving-workflow.tsx` | Integrar OCR existente en el flujo de recepción |

---

## Fase 1 — Núcleo operativo (1 semana)

| # | Archivos | Descripción |
|---|---|---|
| 1.1 | Schema `storageLocations.type`, `lib/services/inventory-service.ts` | Agregar `type` ('CENTRAL', 'BRANCH', 'VIRTUAL', 'TRANSIT') a almacenes. Separar lógica central vs sucursal |
| 1.2 | `app/dashboard/inventory/production/`, schema `productionOrders`, `productionResults`, service `production-service.ts` | **Módulo de Producción**: planear batch cooking, registrar insumos usados, producto terminado. Producción sugerida basada en ventas históricas (manuales o CSV) |
| 1.3 | Schema: columna `yieldPercent` en `inventoryItems` + `recipeItems` | **Rendimientos**: modelar que 10kg carne → 8.4kg útiles (84%). Afecta consumo teórico y costeo de recetas |
| 1.4 | Nueva tabla `inventoryKnowledgeGraph`, service `knowledge-service.ts` | Base analítica por par ingrediente-sucursal: merma promedio, variación, tendencia, consumo. Se alimenta de movimientos, mermas, conteos |

---

## Fase 2 — Automatización inteligente (1 semana)

| # | Archivos | Descripción |
|---|---|---|
| 2.1 | `app/dashboard/inventory/suggested-orders/`, service `suggested-order-service.ts` | **PAR Levels + Compras sugeridas**: punto de reorden, cantidad sugerida basada en min/max/objetivo, consumo histórico manual, lead time |
| 2.2 | `lib/services/forecast-service.ts`, Inngest semanal | **Forecast**: media móvil ponderada sobre ventas manuales/CSV + día de semana + estacionalidad. Predice demanda próxima semana |
| 2.3 | `lib/services/theoretical-consumption-service.ts`, Inngest | **Consumo Teórico**: cuando se registra una venta manual/CSV, descontar ingredientes vía recetas automáticamente |
| 2.4 | Service `alert-service.ts` — nuevos tipos de alerta | **Alertas avanzadas**: `HIGH_VARIANCE`, `ANOMALOUS_WASTE`, `YIELD_DROP`. Basadas en desviación estadística vs umbrales fijos |

---

## Fase 3 — Dashboard ejecutivo e Ingeniería de Menú (3-4 días)

| # | Archivos | Descripción |
|---|---|---|
| 3.1 | `app/dashboard/inventory/reports/executive/`, service `executive-report-service.ts` | **Dashboard por rol**: vistas CEO, COO, Compras con KPIs (Food Cost %, COGS, Inventory Turnover, Stock Days, Shrinkage, Fill Rate, Exactitud) |
| 3.2 | `app/dashboard/inventory/menu-engineering/`, component `MenuEngineeringMatrix` | **Matriz Estrellas/Vacas/Incógnitas/Pesos**: popularidad vs rentabilidad. Basado en ventas manuales + food cost real |
| 3.3 | `lib/services/costing-service.ts`, UI en recetas | **Costeo Avanzado**: costo estándar vs real por sucursal, variación. Permitir cambiar método (LAST_PRICE / AVERAGE_COST) por sucursal |

---

## Fase 4 — Pulso Intelligence (1 semana)

| # | Archivos | Descripción |
|---|---|---|
| 4.1 | Componente `PulsoIntelligence`, API `/api/ai/inventory-insights` | **Q&A en lenguaje natural**: "¿Por qué subió mi Food Cost?", "¿Qué sucursal pierde más aguacate?". Consulta knowledge graph + datos en tiempo real |
| 4.2 | Inngest semanal `weekly-insights` | **Insights automáticos**: "San Pedro desperdicia 18% más queso", "La carne subió 7%". Se notifican por WhatsApp/email |
| 4.3 | Extender simulador de recetas | **Simulación de escenarios**: "¿Qué pasa si el tomate sube 20%?" — impacto en food cost de cada receta, margen por sucursal |

---

## Fase 5 — Integraciones y pulido (2-3 días)

| # | Archivos | Descripción |
|---|---|---|
| 5.1 | `app/dashboard/inventory/credit-notes/`, APIs | UI completa para notas de crédito / devoluciones a proveedores |
| 5.2 | Flujo de recepción + schema `temperatureLogs` | Capturar temperatura al recibir perecederos (manual) |
| 5.3 | PO schema + UI | **Backorders**: cuando proveedor no entrega todo, generar backorder automático |
| 5.4 | `NotificationDispatcher` | Alertas por rol: gerente ve sucursal, COO ve consolidado |

---

## Resumen de nuevo código

| Tipo | Cantidad | Ejemplos |
|---|---|---|
| Rutas UI nuevas | ~7 | production/, suggested-orders/, executive/, menu-engineering/, credit-notes/ |
| Servicios nuevos | ~6 | production-service, forecast-service, suggested-order-service, costing-service, intelligence-service, knowledge-service |
| Componentes nuevos | ~6 | PulsoIntelligence, ProductionPlanner, MenuEngineeringMatrix, ExecutiveDashboard, YieldManager, SuggestedOrderBuilder |
| Tablas/columnas nuevas | ~6 | productionOrders, productionResults, inventoryKnowledgeGraph, yieldPercent, storageLocation.type |
| APIs nuevas | ~8 | /production, /forecast, /suggested-orders, /menu-engineering, /intelligence, /costing |
| Funciones Inngest | ~3 | weekly-insights, forecast-calculation, auto-theoretical-consumption |

**Estimado: ~3-4 semanas full-time.**

> El consumo teórico y forecast se alimentan de ventas registradas manualmente o por CSV (lo que ya existe en `salesEntries` y el importador CSV en reports). Sin POS, el usuario captura sus ventas del día o sube el CSV, y el sistema descuenta ingredientes y genera sugerencias.
