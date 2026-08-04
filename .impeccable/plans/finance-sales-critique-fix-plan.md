# Plan: Finance + Sales Critique Fix

**Targets:** `app/dashboard/finance/` + `app/dashboard/sales/` (con sus componentes en `components/{finance,sales}/`)
**Critique scores:** Finance 20/40, Sales 23/40 → **target: 32+ / 32+**
**Critiques origen:** `.impeccable/critique/2026-08-04T15-20-15Z__app-dashboard-finance.md`, `…16Z__app-dashboard-sales.md`
**Created:** 2026-08-04
**Status:** 🔜 Pendiente

---

## Resumen de diagnóstico (cruzado)

Los dos módulos comparten raíces de problema — el plan se ordena por **tema transversal**, no por página, para que cada fase cierre la misma deuda en ambas superficies a la vez:

| # | Problema transversal | Finance | Sales | Prioridad |
|---|----------------------|---------|-------|-----------|
| A | KPI "hero-metric" cards apiladas (patrón vetado por DESIGN.md) | petty-cash (3-up) | FinancialKpiCards (4) + SalesDashboard (4) = 8 apiladas | **P1** |
| B | Colores hardcoded (`emerald-50/700`, `amber-50/700`, `blue-*`, `#10b981`, `#f43f5e`) fuera de tokens OKLCH | badges + cash-flow calendar/gráfico | gráficos + estatus cortes | **P1** |
| C | Micro-tipo fuera del ramp (10/11px, piso = 12px/`text-xs`) | cash-flow calendar (9-10px) | mapping pills (10/11px), notas cortes (10px) | **P2** |
| D | Errores silenciados (`console.error` → spinner eterno / vacío mudo) | cash-flow, expenses, petty-cash | sales-dashboard (parcial) | **P2** |
| E | Acciones irreversibles sin confirm/undo | expenses Approve | mapping delete (`confirm()` nativo) | **P2** |
| F | Selectores de sucursal desconectados / sin rollup multi-sucursal | cash-flow sin selector, single-branch | twin `selectedBranch` (KPI vs dashboard) + date-range sin validar | **P2** |
| G | Empty states ausentes o inconsistentes | `!fund`→null, `!kpis`→null | cortes (mín) vs mapping (rico, enseñar) | **P2** |
| H | Aceleradores power-user ausentes (batch, sort, column toggle, teclado) | expenses (1-a-1) | cortes (10 columnas) | **P3** |
| I | Recharts SVG sin a11y (aria-label/role, teclado) | cash-flow chart | sales trend + channel bars | **P3** |

---

## Fases (ejecutar en orden; cada fase = commit independiente)

> Notas: el detector ya da limpio en bans absolutos (gradients, side-stripes, glass, eyebrow, numbered scaffolding). El trabajo es **distill + colorize + typeset + harden**, no rescate anti-slop.

### Fase 1 — Color: migrar todo a tokens OKLCH (P1, problema B)

Cierre transversal. Reemplazar literalmente cada color hardcoded por los tokens de `DESIGN.md` (`--success`, `--warning`, `--info`, `--destructive`, `--chart-1..5`, `--primary`, `--muted`). Un solo commit, impacto visual inmediato.

**`app/dashboard/finance/expenses/page.tsx`** (badges + botón Aprobar):

| Actual | Reemplazo |
|--------|-----------|
| `bg-emerald-50 text-emerald-700 border-emerald-200` (APPROVED) | `bg-success/10 text-success border-success/20` |
| `bg-amber-50 text-amber-700 border-amber-200` (PENDING) | `bg-warning/10 text-warning border-warning/20` |
| `bg-blue-50 text-blue-700 border-blue-200` (PAID) | `bg-info/10 text-info border-info/20` |
| Botón `bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-emerald-200` | `bg-success/10 text-success hover:bg-success/20 border-success/20` |

**`app/dashboard/finance/petty-cash/page.tsx`**:

| Actual | Reemplazo |
|--------|-----------|
| `bg-emerald-50 text-emerald-700 border-emerald-200` (Suficiente) | `bg-success/10 text-success border-success/20` |
| `text-emerald-600` (ShieldCheck icon) | `text-success` |

**`components/finance/cash-flow-calendar.tsx`** (gráfico + calendario):

| Actual | Reemplazo |
|--------|-----------|
| `<Bar … fill="#10b981">` (Entradas) | `fill="var(--chart-3)"` |
| `<Bar … fill="#f43f5e">` (Salidas) | `fill="var(--chart-5)"` |
| `border-amber-300 bg-amber-50/50`, `text-rose-600`, `text-emerald-600`, `bg-amber-100 text-amber-800` | `warning/…`, `destructive`, `success`, `warning` tokens |
| Rampa del calendario de(Op.→Negativo) | gradiente OKLCH `chart-3→chart-5` por porcentaje |

**`components/sales/financial-kpi-cards.tsx`** (4 cards, badges e iconos):

| Actual | Reemplazo |
|--------|-----------|
| `text-amber-600`, `text-blue-600`, `text-purple-600`, `text-emerald-600` (iconos) | `text-warning`, `text-info`, `text-chart-4`, `text-success` |
| `bg-emerald-50 text-emerald-700…` / `bg-amber-50…` / `bg-destructive…` | `success/10`, `warning/10`, `destructive/10` tokens |
| `text-emerald-600` margin % | `text-success` |

**`components/sales/sales-dashboard.tsx`** (gráficos + KPI cards):

| Actual | Reemplazo |
|--------|-----------|
| `<linearGradient stop="#10b981">` y `stroke="#10b981"` (venta trend) | `var(--chart-3)` con misma opacidad |
| `bg-primary` barra de canal | mantener `bg-primary` (ya correcto) o `bg-chart-1` para rol de canal |
| Iconos `text-emerald-600/blue-600/purple-600/amber-600` | `text-success/info/chart-4/warning` |

**`app/dashboard/sales/page.tsx`** (estatus cortes + badges origen):

| Actual | Reemplazo |
|--------|-----------|
| `text-green-500` (Validado) | `text-success` |
| `text-yellow-500` (Observación) | `text-warning` |
| `bg-blue-50 text-blue-700` / `bg-emerald-50…` / `bg-amber-50…` (`getSourceBadge`) | `info/10`, `success/10`, `warning/10` tokens |

**Verificación:** `rg "emerald-[0-9]|amber-[0-9]|rose-[0-9]|blue-50|green-500|yellow-500|#10b981|#f43f5e|#f59e0b" app/dashboard/finance app/dashboard/sales components/finance components/sales` → **0 hits**.

**Comando sugerido:** `$impeccable colorize app/dashboard/finance app/dashboard/sales`

---

### Fase 2 — Distill: colapsar la pila de KPI hero-metric (P1, problema A)

La crítica más visible en ambos módulos. Devolver "una métrica primaria + contexto demotado".

**`app/dashboard/finance/petty-cash/page.tsx`** — 3 cards (Saldo / Umbral / Movimientos) → 1 superficie de estado de fondo:
- Conservar **una sola** figura prominente: `Saldo Disponible` con `text-3xl`.
- Umbral mínimo → barra inline horizontal: `currentBalance` como % de `fundAmount` (ya calculado `balancePercentage`), con marca en 20% (umbral). Tono `success` sano / `destructive` bajo umbral.
- Movimientos → secundario en una línea (ícono + conteo + "auditado con firma"), no card propia.
- Quitar el `grid grid-cols-3` por un `Card` único con layout flex vertical.

**`components/sales/financial-kpi-cards.tsx` + `components/sales/sales-dashboard.tsx`** — 8 cards → 1 resumen financiero coherente:
- Fusionar ambos componentes en **una sola tira**: `Venta Total` (número primario) + una **tira compacta de ratios** (`Food Cost %`, `Labor Cost %`, `Prime Cost %`) como líneas debajo, no cards separadas.
- `Canal Principal` se demueve hacia el gráfico "Desglose por Canal" (ya muestra lo mismo) — eliminar la card.
- `Efectivo vs Tarjeta`: convertir las dos filas de texto chico en una sola barra de proporción (estilo barra de canal ya en `sales-dashboard`).
- `Margen Primo Restante`: queda como leyenda/porcentaje dentro de la tira de ratios, no card.
- Resultado: 1 card gruesa arriba (Venta Total + ratios) en vez de 8 cards apiladas.

**Coherencia de módulo:** Entradas/Salidas y Venta compartan la misma rampa `chart-3`/`chart-5` ya aplicada en Fase 1.

**Comando sugerido:** `$impeccable distill app/dashboard/finance/petty-cash app/dashboard/sales`

---

### Fase 3 — Hard: errores visibles + confirmaciones + undo (P2, problemas D + E)

**Errores en superficie (problema D)** — añadir estado de error en línea con retry, no solo `console.error`:

| Archivo | Cambio |
|---------|--------|
| `app/dashboard/finance/cash-flow/page.tsx` | estado `error`; render `AlertCircle destructivo` + botón "Reintentar" en lugar de spinner eterno |
| `app/dashboard/finance/expenses/page.tsx` | `catch` → toast `variant="destructive"` ("No se cargaron los gastos") en paralelo a `console.error`; `fetchExpenses` reutilizable desde el botón reintentar |
| `app/dashboard/finance/petty-cash/page.tsx` | mismo patrón: toast destructivo + bloque de error en línea con retry |
| `components/sales/financial-kpi-cards.tsx` | reconocer fallo (hoy `!kpis`→null silencioso) |
| `components/sales/sales-dashboard.tsx` | hoy ya toasta en cortes; `fetchAnalytics` no avisa fallo → añadir |

**Approve irreversible (problema E):**
- `app/dashboard/finance/expenses/page.tsx` `handleApprove`: hoy toasta solo en éxito. Añadir:
  1. Toast destructivo cuando `!res.ok` (mensaje del servidor).
  2. Confirmación antes de comprometer: `AlertDialog` (Radix, ya en proyecto) en lugar de click directo, **o** toast optimista con **deshacer 5s** (preferible — menos fricción).
- `app/dashboard/sales/mapping/page.tsx` `handleDelete`: reemplazar `confirm()` nativo (rompe flow) por `AlertDialog` de Radix; ya existe `deletingId` para el estado de carga.

**Coherencia con sales:** el patrón de toast destructivo + mensaje del servidor que ya usa `sales/page.tsx` `fetchCuts` se convierte en el estándar — replicar en los 3 archivos de finance.

**Comando sugerido:** `$impeccable harden app/dashboard/finance app/dashboard/sales`

---

### Fase 4 — Tiposet: subir todo al ramp ≥12px (P2, problema C)

El detector ya marcó específicamente estos sitios. Piso documentado: `text-xs` (12px = 0.75rem). Jerarquía vía peso/opacidad, no sub-12px.

| Archivo | Línea actual | Cambio |
|---------|---|--------|
| `components/finance/cash-flow-calendar.tsx` | `text-[10px]`, `text-[9px] px-1 py-0`, `text-[11px]` | `text-xs` mínimo; si necesita más jerarquía → `text-xs` + `font-semibold`/`text-muted-foreground` |
| `app/dashboard/sales/mapping/page.tsx` | `text-[10px]` (121, 149), `text-[11px]` (144, 156) | `text-xs`; metadata → `text-xs text-muted-foreground` |
| `app/dashboard/sales/page.tsx` | `text-[10px]` notas validación (321, 330) y timestamp recibido | `text-xs` (mantenible con `text-muted-foreground`) |
| `components/sales/financial-kpi-cards.tsx` | `text-[11px]` captions, `text-[10px]` badges | `text-xs` captions; badges → `text-xs` o compactar con `Badge` size |
| `components/sales/sales-dashboard.tsx` | `text-[11px]` captions | `text-xs` |
| `app/dashboard/finance/petty-cash/page.tsx` | `text-xs` legend (ok) pero revisar `CardDescription text-xs` | mantener ok |

**Verificación:** `rg "text-\[(9|10|11)px\]" app/dashboard/finance app/dashboard/sales components/finance components/sales` → **0 hits**.

**Comando sugerido:** `$impeccable typeset app/dashboard/finance app/dashboard/sales`

---

### Fase 5 — Consistencia: branch selector + empty states (P2, problemas F + G)

**Selector único de sucursal (problema F)** — el bug real que Riley detectó:

- `app/dashboard/sales/page.tsx`: hoy hay **dos** `selectedBranch` independientes (nivel página para `FinancialKpiCards.branchId`, nivel `SalesDashboard` interno). El selector de la página **no** afecta los gráficos.
  - Solución: `SalesDashboard` acepta `branchId` como prop controlada (quitar su `useState`); el único `selectedBranch` vive en `page.tsx` y alimenta **ambos** (`FinancialKpiCards` + `SalesDashboard`).
  - El `<Select>` actual de la pestaña Analytics sube a un control común (moverlo al header de la pestaña, encima de las cards).
- `app/dashboard/finance/cash-flow/page.tsx`: hoy **sin** selector de sucursal (siempre rollup). Añadir `<Select>` que admita `"ALL"` (todas) — responde a "Questions to Consider" del Dueño de Cadena. El endpoint ya recibe `branchId`.
- `app/dashboard/finance/petty-cash/page.tsx`: petty-cash hoy obliga a 1 sucursal. Mantener para el detalle, **pero** añadir opción `"ALL"` agregada (suma de saldos + movimientos de todas las cajas chicas) para el Dueño de 3-15 sucursales — o documentar explícito que petty-cash es por sucursal y ofrecer un futuro rollup tesorero. **Decisión de producto:** recomiendo rollup `"ALL"` con aviso "vista consolidada de cajas chicas".

**Empty states (problema G)** — alinear todos al patrón de `mapping/page.tsx` (enseña la interfaz):

| Archivo | Estado actual | Cambio |
|---------|---------------|--------|
| `app/dashboard/finance/petty-cash/page.tsx` | `!fund ? null` (blanco) | empty state: ícono `Wallet` + "Sin caja chica en esta sucursal" + CTA "Crear fondo" (abrir `PettyCashRegister`) |
| `components/sales/financial-kpi-cards.tsx` | `!kpis ? null` | empty state: "Sin ventas registradas en el período" + ícono |
| `components/sales/sales-dashboard.tsx` | `!summary ? null` | empty state similar al de cortes o enseñar como mapping |
| `app/dashboard/sales/page.tsx` (cortes vacío) | "No se encontraron cortes…" + ícono | enriquecer al patrón mapping: + 1 línea de guía ("Sube un corte POS o usa WhatsApp") + CTA si corresponde |
| `app/dashboard/finance/expenses/page.tsx` (vacío) | "Sin gastos…" texto chico | plantear CTA "Registrar gasto" (abrir `ExpenseForm`) |

**Usar componente compartido** (opcional, rec.) `components/ui/empty-state.tsx` (`icon + title + description + action`) para romper la repetición y validar el vocabulario de empty states del módulo.

**Comando sugerido:** `$impeccable clarify app/dashboard/finance app/dashboard/sales`

---

### Fase 6 — A11y de Recharts + micro-tipos resistentes (P3, problemas C-residual + I)

- Envolver cada `<ResponsiveContainer>` con **`role="img"`** + `aria-label` descriptivo (`"Tendencia de ventas diarias"`, `"Flujo de efectivo: entradas vs salidas"`, `"Desglose por canal"`).
- Validar que los `Tooltip` de Recharts no sean dependientes del teclado; añadir `<title>` en barras/áreas o tabla `sr-only` alternativa con los mismos datos (rec. tabla para lectores de pantalla).
- Confirmar 200% zoom: ya no hay sub-12px tras Fase 4; verificar que la barra de umbral de Fase 2 y la tira de ratios de Fase 2 no se rompan.

---

### Fase 7 — Power user (P3, problema H) — opcional / siguiente sprint

Fuera del bloque "aceptable→32+", pero listado para completar los red flags de Alex. Solo si backlog lo permite:

- **`expenses/page.tsx`** y **`sales/page.tsx` cortes**: checkboxes de fila + "Aprobar seleccionados" / exportación; sort por columna (`Table` ya soporta cabeceras clicables); columnas togglables.
- Atajos de teclado: `Cmd/Ctrl+Enter` para aprobar fila enfocada, `Esc` cancela.
- Migrar todo `confirm()`/`AlertDialog` a `AlertDialog` de Radix (Fase 3 ya cobertura el delete; revisar otras).

---

## Matriz archivo × fase (chequeo de cierre)

| Archivo | F1 color | F2 distill | F3 harden | F4 typeset | F5 branch/empty | F6 a11y |
|---------|:-:|:-:|:-:|:-:|:-:|:-:|
| `app/dashboard/finance/cash-flow/page.tsx` | — | — | ✓ | — | selector | — |
| `components/finance/cash-flow-calendar.tsx` | ✓ | — | ✓ | ✓ | — | ✓ |
| `app/dashboard/finance/expenses/page.tsx` | ✓ | — | ✓ | — | empty | — |
| `app/dashboard/finance/petty-cash/page.tsx` | ✓ | ✓ | ✓ | — | ✓ | — |
| `components/sales/financial-kpi-cards.tsx` | ✓ | ✓ | ✓ | ✓ | empty | — |
| `components/sales/sales-dashboard.tsx` | ✓ | ✓ | ✓ | ✓ | empty | ✓ |
| `app/dashboard/sales/page.tsx` | ✓ | — | ✓ | ✓ | empty + branch fusion | — |
| `app/dashboard/sales/mapping/page.tsx` | — | — | ✓ | ✓ | — | — |

---

## Verificación final

1. **Re-critique:** `$impeccable critique app/dashboard/finance app/dashboard/sales` → esperar ≥32/40 cada uno.
2. **Detector limpio:** `rg` de los patrones de color (Fase 1) y `text-[(9|10|11)px]` (Fase 4) sin hits.
3. **Build:** `pnpm run build` sin errores TS; `pnpm run lint` sin warnings nuevos.
4. **E2E smoke** (si existen tests bajo `tests/` para sales/finance): `pnpm test:e2e -- --grep "sales|finance|petty"`.
5. **A11y manual:** tabular por cada pestaña; barras/áreas Recharts anuncian su `aria-label`; 200% zoom legible.

---

## Out of scope (decisiones diferidas)

- **Reescritura de componentes compartidos** (`empty-state`, `kpi-strip`, `ratio-bar`): recomendado en Fase 2/5 pero si el refactor_Button es grande, extraerlo a un follow-up para no lastimar el foco del bloque P1/P2.
- **Cross-branch rollup completo ("command center 15 sucursales")**: la Fase 5 añade `"ALL"` pero la vista tesorero consolidada es un epíco de producto aparte — capturar en `PROJECT_CONTEXT.md` TODO, no en este plan.
- **Power user completo (Fase 7)**: dejar como sprint siguiente; las críticas marcan `Flexibility` score 1 pero no es bloqueante para subir del "aceptable bajo".