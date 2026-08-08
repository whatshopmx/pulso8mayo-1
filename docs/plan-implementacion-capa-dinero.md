# Plan de implementación — Capa de retención de dinero

Basado en auditoría de código (2025): gaps reales verificados, no los del
documento original (3.3 y 3.5 ya están resueltos en el código actual).

## Orden de ejecución (valor / esfuerzo)

| # | Fase | Esfuerzo | Riesgo |
|---|------|----------|--------|
| 0 | Base y migración segura | 0.5d | bajo |
| 1 | `operatingExpenses.evidenceUrl` | 0.5d | bajo |
| 2 | Arqueo en cierre de turno | 2d | medio |
| 3 | Desglose por agregador | 2d | medio |
| 4 | `isHighValue` + regla 30 SKUs | 2d | bajo |
| 5 | Recepción workflow → `receivingReports` | 3-5d | alto |
| 6 | QA final (build + e2e) | 1d | — |

---

## Fase 0 — Base y migración segura

**Regla de oro:** `pnpm db:generate` → **revisar el SQL generado** → `pnpm db:migrate`.
NUNCA `db:push` en base con datos (puede dropear tablas, AGENTS.md).

- Rama `feat/capa-dinero` desde `main`.
- Verificar `.env` apunta a la base correcta antes de migrar.
- Cada fase con su propia migración (una por feature, revisable).

---

## Fase 1 — `operatingExpenses.evidenceUrl` (0.5d)

**Objetivo:** el gasto sin CFDI (hielo, ferretería, taxi, plomero) guarda la foto del
ticket. Es el contenido de la libreta que el producto promete sustituir.

**Cambios:**
1. `lib/db/schema.ts` (~2663, `operatingExpenses`): añadir
   `evidenceUrl: text("evidence_url")` (nullable).
2. `pnpm db:generate` + revisar + `db:migrate`.
3. Formulario: `components/finance/expense-form.tsx` — campo de subida de foto.
   Reutilizar `lib/storage/r2-client.ts` (`uploadToR2`, `isR2Configured`) con
   fallback local, igual que hace `/api/sales/cuts/upload`.
4. API de creación de gasto: aceptar `evidenceUrl` en el body (buscar ruta que
   inserta `operatingExpenses`, hoy solo se lee en `pnl-service`).

**Criterio de aceptación:** crear un gasto con foto desde el dashboard → el
registro tiene `evidence_url` no nulo y la imagen se abre desde la UI.

---

## Fase 2 — Arqueo en cierre de turno (2d) — **la más crítica**

**Objetivo:** el número que detecta el faltante: `efectivo declarado vs. efectivo
contado físicamente`. Sin esto, `cashSales` es solo lo que el cajero declara.

**Cambios:**
1. **Schema** (`lib/db/schema.ts` ~2349, `dailySalesCuts`): 3 columnas
   - `cashCountedCents: integer("cash_counted_cents")` (nullable)
   - `depositedCents: integer("deposited_cents")` (nullable)
   - `varianceCents` — **no columna**, derivado: `cashSales − cashCountedCents`
     (evita estado inconsistente).
2. **Smart Link** (`app/api/workflows/smart-links/corte-caja/route.ts`):
   - `corteSchema`: añadir `arqueo` (efectivo contado) y `deposito` (opcionales).
   - Insertar `cashCountedCents` / `depositedCents`.
   - El arqueo es **obligatorio** en el form del cajero (si no lo captura, el
     corte no es fiable): rechazar si `efectivo > 0 && arqueo == null` con
     mensaje claro.
3. **Template** `templates/finanzas/corte-caja.json`: paso "Arqueo de caja" con
   los 2 campos (el Smart Link se renderiza desde el template).
4. **UI dashboard** (`app/dashboard/sales/page.tsx` + `components/sales/sales-cut-upload.tsx`):
   - Mostrar columna "Diferencia" (verde si 0, roja si ≠ 0).
   - Alerta por sucursal: "3 cortes con diferencia este mes".
5. **Ingesta POS** (`lib/services/sales-ingestion-service.ts`): arqueo no aplica
   (el archivo del POS no lo trae) → dejar null, no romper el parseo.

**Criterio de aceptación:**
- E2E: cerrar turno con efectivo declarado 1,000 y arqueo 980 → aparece
  diferencia −20 en dashboard y en el corte.
- Ingesta POS sigue funcionando con arqueo null.

---

## Fase 3 — Desglose por agregador (2d)

**Objetivo:** conciliar la liquidación del agregador (llega neta de comisión)
contra la venta reportada. Hoy el form del Smart Link ya captura `rappi/uber/didi`
pero el schema los colapsa en `otherPayments`.

**Cambios:**
1. **Schema**: `dailySalesCuts` — añadir
   `aggregatorSales: jsonb("aggregator_sales")` (ej. `{"rappi": 12345, "uber": 0, "didi": 678}`)
   en vez de columnas fijas (los agregadores cambian: Justo, Sin Delantal,
   Mercado Pago…). `otherPayments` se mantiene como suma para compatibilidad.
2. **Smart Link** (`corte-caja/route.ts`): guardar el desglose ya capturado en el
   jsonb en lugar de solo sumarlo.
3. **Ingesta** (`sales-ingestion-service.ts` ~744-806): cuando el mapeo del POS
   detecte columnas de agregador (vía `paymentMethodMapping` de
   `posMappingTemplates`), poblarlas en `aggregatorSales` con labels conocidos.
4. **UI** (`app/dashboard/sales/page.tsx`): tabla "Venta reportada vs.
   liquidación" por agregador con input manual del monto liquidado → varianza
   por comisión.

**Criterio de aceptación:** un corte con `rappi=1,000` guarda
`aggregator_sales.rappi = 1000` y aparece en el reporte de conciliación.

---

## Fase 4 — `isHighValue` + regla 30 SKUs (2d)

**Objetivo:** dirigir al cliente a contar 15-30 SKUs (80% del costo) en vez de
abandonar el inventario completo en la semana 6.

**Cambios:**
1. **Schema** (`lib/db/schema.ts` ~675, `inventoryItems`):
   `isHighValue: boolean("is_high_value").default(false)`.
2. **API** (`app/api/inventory/products/route.ts` y `[id]/route.ts`): aceptar el
   flag en alta/edición.
3. **Onboarding**: al crear items, validar "máx. 30 SKUs marcados como alto
   valor al inicio" — warning en la API + copy en la UI.
4. **Conteo semanal** (`templates/inventory/conteo-inventario-v1.json` + el
   servicio `stock-count-service.ts`): el flujo de conteo filtra por
   `isHighValue = true` por defecto, con toggle "ver todos".
5. **Dashboard inventario**: sección "SKUs de alto valor" con el 80/20 y
   antigüedad del último conteo por SKU.

**Criterio de aceptación:** crear el item 31 con `isHighValue` en onboarding →
warning; el template de conteo genera la lista filtrada.

---

## Fase 5 — Recepción: cablear workflow → `receivingReports` (3-5d)

**Objetivo (lo que queda real de 3.3):** el template
`templates/control_calidad/recepcion-mercancia-v2-enhanced.json` captura
evidencia (fotos, temperaturas, aceptar/rechazar) pero **no escribe** datos
estructurados. La tabla `receiving_reports` + `receiving_report_items`
(schema.ts:2261) YA existe con `orderedQuantity`, `receivedQuantity`,
`unitCost`, `discrepancyType/Qty` y YA tiene API
(`app/api/inventory/receiving/route.ts`) y UI. Falta el puente y la analítica.

**Cambios:**
1. **Extractor**: nuevo `lib/services/receiving-from-workflow.ts` — al completar
   una instancia del template `tpl-recepcion-mercancia-v2`, extrae de las
   respuestas/evidencia los campos por ítem y reutiliza la lógica de la ruta
   existente (refactor: mover el cuerpo de `route.ts` a un service compartido
   `lib/services/receiving-service.ts` para no duplicar).
2. **Punto de enganche**: en el executor (`components/workflow/workflow-executor.tsx`
   o el servicio de completado de instancia), al marcar COMPLETED + template de
   recepción → llamar al extractor. Fuera del request si es posible (Inngest ya
   existe en el repo para esto).
3. **Varianza por proveedor**: query agregada sobre `receiving_report_items`
   (ordenado vs. recibido, precio acordado vs. facturado) → endpoint
   `/api/inventory/supplier-variance` + card en dashboard proveedores:
   "Proveedor X: −4% de faltante los viernes".
4. **Conciliación CFDI**: `invoice-matching-service.ts` ya lee
   `receivingReportItems` — verificar que la UI de facturas muestre la varianza
   de precio/cantidad (hoy existe, validar visibilidad).

**Criterio de aceptación:** completar el workflow de recepción con 3 ítems (1
con faltante) → aparecen en `receiving_reports` con discrepancia, y la vista de
proveedores muestra el patrón.

---

## Fase 6 — QA final (1d)

1. `pnpm db:generate` → migración única por feature aplicada en orden.
2. `pnpm run build` y `pnpm run lint`.
3. E2E (`pnpm test:e2e`): escenario corte con arqueo con diferencia; gasto con
   foto; conteo filtrado por alto valor.
4. Smoke manual del Smart Link desde el celular (es el flujo que abre la
   cartera: el cajero cierra en 5 minutos).
5. Actualizar `PROJECT_CONTEXT.md` con el estado de las 5 features.

---

## Lo que NO se hace (decisiones de alcance)

- **No** reconstruir `goods_receipts` (ya existe como `receiving_reports`).
- **No** tocar el P&L (ya usa `food-cost-service`/`labor-cost-service` reales;
  el fallback sectorial ya está etiquetado en UI).
- **No** inventario completo: la Fase 4 lo limita a 30 SKUs.
- **No** migrar datos de `otherPayments` (jsonb nuevo es aditivo).
