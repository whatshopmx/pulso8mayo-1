# Finance & Sales Critique — Task List

Critique score: 27/40. Target: resolver los 7 hallazgos. Sin cambios de backend.

---

## Fase 1: Integridad de Datos

### Task 1: Eliminar KPIs falsos de FinancialKpiCards

**Description:** `components/sales/financial-kpi-cards.tsx` muestra `foodCostPct: 28.5` y `laborCostPct: 26.2` hardcodeados con badges de "Óptimo"/"Precaución" como si fueran datos reales. El backend no expone estos ratios. Se eliminan las 4 celdas de `RatioCell` que dependen de datos ficticios (Food Cost, Labor Cost, Costo Primo, Margen Restante). El card se reestructura mostrando solo métricas reales: Venta Total + subtítulo con tickets/cortes/ticket promedio + barra Efectivo vs Tarjeta. El `RatioCell` sub-component se elimina si no tiene otros usos.

**Acceptance criteria:**
- [ ] `FinancialKpiCards` no contiene ningún valor hardcodeado que parezca dato real
- [ ] El card muestra: Venta Total (formato MXN), conteo de cortes + tickets + ticket promedio, barra Efectivo vs Tarjeta
- [ ] Sin referencias a `foodCostPct`, `laborCostPct`, `primeCostPct`, `marginPct` en el componente
- [ ] Los estados loading, error, y empty siguen funcionando
- [ ] `RatioCell` se elimina del archivo si no es usado por otro componente

**Verification:**
- [ ] Build: `pnpm run build`
- [ ] Visual: navegar a `/dashboard/sales`, verificar que el card "Resumen Financiero" no muestra Food Cost ni Labor Cost
- [ ] Visual: verificar estados vacío (sin ventas) y error (API caída)

**Dependencies:** None

**Files likely touched:**
- `components/sales/financial-kpi-cards.tsx`

**Estimated scope:** Small (1 file)

---

### Checkpoint: Fase 1
- [ ] Build limpio
- [ ] KPI cards sin datos ficticios
- [ ] Estados loading/empty/error intactos

---

## Fase 2: Rediseño Cash Flow

### Task 2: Reescribir CashFlowCalendar como panel de alerta temprana

**Description:** Reescribe `components/finance/cash-flow-calendar.tsx` con un diseño que responde 3 preguntas en el primer vistazo: (1) ¿me alcanza el dinero este mes? → saldo mínimo proyectado con fecha y severidad, (2) ¿qué día tengo que preocuparme? → lista de días críticos con motivo, (3) ¿cuánto entra vs sale? → gráfico de barras 30 días con botón exportar CSV. La grilla de 30 cajitas se elimina. Se reemplaza el emoji ⚡ por `<Zap>` de lucide-react.

**Nuevo layout:**
```
┌──────────────────────────────────────────────────────────┐
│ Saldo mínimo proyectado: $X (Fecha) —— [OK|⚠️|🔴]        │
├─────────────────────────┬────────────────────────────────┤
│ Timeline 7 días          │ Días Críticos                  │
│ (barra horizontal con    │ Mar 19 · $8,200 ⚠️             │
│  saldo diario, días      │   4 egresos ($31,500)          │
│  críticos resaltados)    │ Jue 21 · $5,100 🔴             │
│                          │   Renta + proveedor            │
├─────────────────────────┴────────────────────────────────┤
│ Entradas vs Salidas — 30 días              [Exportar CSV] │
│ (BarChart Recharts)                                       │
└──────────────────────────────────────────────────────────┘
```

**Acceptance criteria:**
- [ ] Métrica principal visible: "Saldo mínimo proyectado: $X,XXX (Vie 22 Ago)" con badge de severidad
- [ ] Timeline horizontal de 7 días con barra de saldo diario y días bajo umbral resaltados
- [ ] Lista de días críticos (solo si `hasHighConcentration` o `netFlowCents < 0`) con conteo de egresos y monto
- [ ] Gráfico de barras Entradas vs Salidas a 30 días (ampliado de los 14 actuales)
- [ ] Botón "Exportar CSV" que descarga los datos de `projection` como archivo CSV
- [ ] El emoji ⚡ no aparece en el código; se usa `<Zap className="w-3 h-3" />` de lucide-react
- [ ] La grilla de 30 cajitas (`grid grid-cols-2 sm:grid-cols-5...`) está eliminada
- [ ] El alerta de concentración se integra en la lista de días críticos, no como banner separado
- [ ] Sin regresión: misma prop `projection: CashFlowDay[]`, mismo fetching en la página padre

**Verification:**
- [ ] Build: `pnpm run build`
- [ ] Visual: navegar a `/dashboard/finance/cash-flow`, verificar nuevo layout en desktop y mobile
- [ ] Visual: verificar estados loading y error
- [ ] Funcional: hacer clic en "Exportar CSV", verificar que descarga un archivo .csv con columnas fecha, entradas, salidas, neto, saldo acumulado
- [ ] Funcional: seleccionar una sucursal específica, verificar que los datos se filtran correctamente

**Dependencies:** None (la API no cambia)

**Files likely touched:**
- `components/finance/cash-flow-calendar.tsx`

**Estimated scope:** Medium (1 file grande, reescritura completa del componente)

---

### Task 3: Ajustar layout de la página Cash Flow

**Description:** La página `app/dashboard/finance/cash-flow/page.tsx` se ajusta para reflejar el nuevo diseño del calendario: el header se simplifica (el subtitle actual explica la metodología, no el valor para el usuario), y el contenedor del componente se adapta al nuevo layout que ya no es una grilla calendario.

**Acceptance criteria:**
- [ ] El subtitle del header dice algo orientado al usuario, no a la metodología. Ej: "Proyección de liquidez a 30 días basada en ventas estimadas y egresos programados."
- [ ] El layout de la página funciona con el nuevo componente (el container `space-y-6` probablemente no necesita cambios)

**Verification:**
- [ ] Build: `pnpm run build`
- [ ] Visual: header claro y conciso en desktop y mobile

**Dependencies:** Task 2

**Files likely touched:**
- `app/dashboard/finance/cash-flow/page.tsx`

**Estimated scope:** XS (1 archivo, cambios mínimos)

---

### Checkpoint: Fase 2
- [ ] Nueva página Cash Flow funcional
- [ ] Responde las 3 preguntas clave en el primer vistazo
- [ ] Build limpio

---

## Fase 3: Calidad y Pulido

### Task 4: Agregar tooltips de ayuda contextual en Sales

**Description:** Se agregan tooltips inline (atributo `title` + ícono `HelpCircle` sutil) en términos de dominio que un usuario nuevo no entendería. Los labels objetivo son: "Ticket promedio" en FinancialKpiCards, "Desglose por Canal" en SalesDashboard, y el título "Ventas y POS (M13)" en la página principal de Sales. Cada tooltip es una frase de una línea.

**Acceptance criteria:**
- [ ] "Ticket promedio" tiene un ícono `?` con tooltip: "Venta total del período ÷ número de tickets o comandas."
- [ ] "Desglose por Canal" tiene tooltip: "Distribución del ingreso entre Salón, Delivery y Eventos."
- [ ] Los tooltips usan `title` nativo + un ícono `HelpCircle` de lucide-react (`w-3 h-3 text-muted-foreground/60`)
- [ ] No se agregan dependencias nuevas
- [ ] Los tooltips no interfieren con el layout en mobile (el ícono es inline)

**Verification:**
- [ ] Build: `pnpm run build`
- [ ] Visual: hover sobre cada ícono `?`, verificar que aparece el tooltip nativo del browser
- [ ] Visual: en mobile, los tooltips no rompen el layout

**Dependencies:** Task 1 (FinancialKpiCards ya no tiene Food Cost/Labor Cost, así que los tooltips van sobre los labels correctos)

**Files likely touched:**
- `components/sales/financial-kpi-cards.tsx`
- `components/sales/sales-dashboard.tsx`

**Estimated scope:** XS (2 archivos, cambios puntuales)

---

### Task 5: Consolidar variantes de badge en un helper

**Description:** Tres archivos definen clases de badge con ternarios inline repetidos: `getSourceBadge()` en `app/dashboard/sales/page.tsx`, `getStatusBadge()` en `app/dashboard/finance/expenses/page.tsx`, y `RatioCell` en `components/sales/financial-kpi-cards.tsx`. Se crea un helper `statusBadgeClasses(status)` en `lib/utils.ts` que mapea status → clases CSS, y se reemplazan los ternarios en los 3 archivos. El helper acepta un parámetro `tone` para los casos donde el status es un string libre (como los canales de venta en sales).

**Acceptance criteria:**
- [ ] Existe `statusBadgeClasses(status, options?)` en `lib/utils.ts` con la firma: `(status: string, options?: { prefix?: string }) => string`
- [ ] Los 3 sitios de uso llaman al helper en vez de tener ternarios inline
- [ ] El helper produce exactamente las mismas clases que los ternarios originales
- [ ] `RatioCell` (si sobrevivió a Task 1) usa el helper
- [ ] Sin regresión visual: los badges se ven idénticos a antes

**Verification:**
- [ ] Build: `pnpm run build`
- [ ] Visual: navegar a Sales → verificar badges de origen (Archivo POS, WhatsApp, Manual) y estatus (Validado, Observación)
- [ ] Visual: navegar a Expenses → verificar badges de estatus (Aprobado, Pendiente, Rechazado, Pagado)

**Dependencies:** Task 1 (FinancialKpiCards ya fue modificado)

**Files likely touched:**
- `lib/utils.ts`
- `app/dashboard/sales/page.tsx`
- `app/dashboard/finance/expenses/page.tsx`
- `components/sales/financial-kpi-cards.tsx`

**Estimated scope:** Small (4 archivos, cambios mecánicos)

---

### Task 6: Agregar presets de fecha en filtros de Sales

**Description:** Los filtros de fecha en la tabla de cortes (`app/dashboard/sales/page.tsx`, tab "Registro de Cortes") empiezan vacíos. Se agrega una fila de botones pequeños debajo de los inputs de fecha: "Hoy | Ayer | 7 días | Este mes". El preset "7 días" se aplica por defecto al cargar la página (en vez de vacío = all-time). Al hacer clic en un preset, se actualizan `startDate` y `endDate`. El botón "Limpiar" existente resetea a "7 días" (no a vacío).

**Acceptance criteria:**
- [ ] Fila de 4 botones pequeños (`size="xs" variant="ghost"`) entre los inputs de fecha y la tabla: "Hoy", "Ayer", "7 días", "Este mes"
- [ ] Al cargar la página, "7 días" está aplicado por defecto (startDate = hace 7 días, endDate = hoy)
- [ ] Al hacer clic en un preset, los inputs de fecha se actualizan y el preset activo se resalta (`variant="secondary"`)
- [ ] El botón "Limpiar" resetea a "7 días" (no a vacío)
- [ ] Los presets solo aparecen en el tab "Registro de Cortes" (no en Analytics)

**Verification:**
- [ ] Build: `pnpm run build`
- [ ] Visual: cargar `/dashboard/sales`, cambiar al tab "Registro de Cortes", verificar que "7 días" está preseleccionado
- [ ] Funcional: hacer clic en "Ayer", verificar que la tabla se filtra correctamente
- [ ] Funcional: hacer clic en "Limpiar", verificar que vuelve a "7 días"

**Dependencies:** None

**Files likely touched:**
- `app/dashboard/sales/page.tsx`

**Estimated scope:** XS (1 archivo, ~30 líneas nuevas)

---

### Checkpoint: Fase 3 — Complete
- [ ] Los 7 hallazgos del critique están resueltos
- [ ] Build limpio
- [ ] Listo para re-evaluar con `$impeccable critique app/dashboard/finance app/dashboard/sales`

---

## Resumen

| # | Tarea | Fase | Scope | Archivos |
|---|-------|------|-------|----------|
| 1 | Quitar KPIs falsos | Integridad | S (1) | `financial-kpi-cards.tsx` |
| 2 | Reescribir CashFlowCalendar | Rediseño | M (1) | `cash-flow-calendar.tsx` |
| 3 | Ajustar layout Cash Flow page | Rediseño | XS (1) | `cash-flow/page.tsx` |
| 4 | Tooltips ayuda contextual | Calidad | XS (2) | `financial-kpi-cards.tsx`, `sales-dashboard.tsx` |
| 5 | Consolidar badge variants | Calidad | S (4) | `utils.ts`, `sales/page.tsx`, `expenses/page.tsx`, `financial-kpi-cards.tsx` |
| 6 | Presets de fecha en filtros | Calidad | XS (1) | `sales/page.tsx` |

**Total: 6 tareas, ~10 archivos, 3 fases con checkpoints**
**Orden: 1 → 2 → 3 → 4 → 5 → 6**
