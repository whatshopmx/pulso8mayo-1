# Todo: Corrección integral — Módulo Finanzas (crítica 2026-08-22, 29/40)

## Task 1: Eliminar totales $0.00 falsos en TOTAL GRUPO

**Descripción:** La fila TOTAL GRUPO de `PnlBranchTable` imprime `$0.00` en renglones donde ninguna sucursal aportó datos (captura viva: Gastos Operativos $0.00 con tres sucursales en "—"), violando la regla documentada NO_DATA→"—".

**Criterios de aceptación:**
- [ ] Cada total de renglón (foodCost, waste, labor, operatingExpenses) muestra "—" cuando cero sucursales tienen dato para ese renglón
- [ ] Cuando algunas sucursales tienen dato y otras no, el total suma solo las que tienen y conserva la marca de incompletitud existente
- [ ] `salesHasData` sigue controlando Venta Neta y Utilidad como hoy

**Verificación:**
- [ ] `pnpm run build`
- [ ] Manual: en /dashboard/finance, Gastos Operativos del TOTAL GRUPO muestra "—" con los datos demo actuales

**Dependencias:** None
**Archivos:** `components/finance/pnl-branch-table.tsx`
**Tamaño:** XS

---

## Task 2: Estado de error visible en PnlBranchTable

**Descripción:** El `catch` del fetch de `/api/finance/pnl` solo loguea; un fallo de red se muestra como "Sin suficientes datos para consolidar el P&L", mintiendo sobre la causa.

**Criterios de aceptación:**
- [ ] Estado `failed` + EmptyState con icono AlertCircle, mensaje en español y botón Reintentar que relanza el fetch (mismo patrón que `financial-kpi-cards.tsx`)
- [ ] El empty state legítimo ("Sin suficientes datos") solo aparece cuando la respuesta fue exitosa y no hay branches
- [ ] El reintento resetea loading/failed correctamente

**Verificación:**
- [ ] `pnpm run build`
- [ ] Manual: bloquear `/api/finance/pnl` en DevTools → se ve error + Reintentar; desbloquear y reintentar → tabla carga

**Dependencias:** None
**Archivos:** `components/finance/pnl-branch-table.tsx`
**Tamaño:** S

---

## Task 3: Tooltips accesibles (Radix) en lugar de `title`

**Descripción:** Los botones "?", los marcadores †/* y las notas de celda dependen del atributo nativo `title`, invisible en tablet (dispositivo primario) y teclado. Usar `components/ui/tooltip.tsx`.

**Criterios de aceptación:**
- [ ] Ambos botones "?" de `financial-kpi-cards.tsx` usan Tooltip (trigger asChild, mismo copy)
- [ ] Marcadores †/* de KPIs y notas de celda del P&L (`title={value.note}` en LineCell y utilidad) usan Tooltip o title+aria-describedby equivalente accesible
- [ ] Tooltips operables por foco de teclado y táctil; contenido anunciado por lectores de pantalla
- [ ] Sin cambio visual en reposo (los triggers mantienen su estilo actual)

**Verificación:**
- [ ] `pnpm run build`
- [ ] Manual: Tab hasta "?" → tooltip visible; viewport móvil → tap muestra tooltip

**Dependencias:** None
**Archivos:** `components/sales/financial-kpi-cards.tsx`, `components/finance/pnl-branch-table.tsx`
**Tamaño:** M

---

### Checkpoint 1-3: build limpio + verificación manual de P1

## Task 4: Tokens semánticos y componentes del sistema en PnL

**Descripción:** Sustituir colores crudos Tailwind (`text-amber-700`, `bg-red-50`, `text-emerald-600`, `bg-emerald-500/5`, `border-amber-500/40`) y el `<input>`/`<button>` custom del header por tokens semánticos (`success`/`warning`/`destructive`) y componentes UI existentes; eliminar clases `dark:` que los tokens ya resuelven.

**Criterios de aceptación:**
- [ ] Búsqueda usa el componente Input del sistema; toggle "En Rojo" usa Button (variant outline/toggle) con `aria-pressed`
- [ ] Colores de semáforo provienen de tokens; sin hex/Tailwind crudo de paleta
- [ ] Icono del título del P&L consistente con las demás tarjetas (o excepción documentada)
- [ ] Dark mode correcto en ambas tablas/alertas sin clases `dark:` manuales

**Verificación:**
- [ ] `pnpm run build` + `pnpm run lint`
- [ ] Manual: light y dark mode en /dashboard/finance

**Dependencias:** Tasks 1-2 (mismo archivo, evitar conflictos)
**Archivos:** `components/finance/pnl-branch-table.tsx`
**Tamaño:** M

---

## Task 5: Ancho de línea ≤70ch y guion largo reservado a datos

**Descripción:** Descripciones y pies de KPIs/P&L/Tesorería corren ~150–170 chars sin límite (detectado). Además "—" funciona como glifo de dato ausente y como puntuación de prosa.

**Criterios de aceptación:**
- [ ] Descripciones, pies de página y notas al pie llevan `max-w-[70ch]` (o contenedor equivalente)
- [ ] Prosa revisada: sin guiones largos como puntuación; el "—" queda únicamente en notación de datos ausentes
- [ ] Sin cambios de copy factual

**Verificación:**
- [ ] `pnpm run lint`
- [ ] Manual: ningún párrafo excede ~70ch en desktop ancho

**Dependencias:** None
**Archivos:** `components/sales/financial-kpi-cards.tsx`, `components/finance/pnl-branch-table.tsx`, `components/finance/cash-flow-summary-card.tsx`, `app/dashboard/finance/page.tsx`
**Tamaño:** S

---

### Checkpoint 4-5: build + lint + dark mode OK

## Task 6: scaleX en barras de costo

**Descripción:** `transition-all duration-500` anima width (layout thrash; detectado por detector).

**Criterios de aceptación:**
- [ ] Barra anima con transform scaleX + origin-left; sin transición de width
- [ ] Respeta `prefers-reduced-motion` (transition-none)

**Verificación:**
- [ ] `pnpm run build`; manual: barra anima igual al cargar KPIs

**Dependencias:** None
**Archivos:** `components/sales/financial-kpi-cards.tsx`
**Tamaño:** XS

---

## Task 7: Legibilidad badge, icono Clock, salidas neutras

**Descripción:** Tres ajustes menores de Tesorería/P&L: badge "N sucursales" ilegible sobre tinte rosa; alertas de Tesorería comparten TrendingDown; salidas proyectadas pintadas destructive siendo neutras.

**Criterios de aceptación:**
- [ ] Badge del TOTAL GRUPO legible (peso/color ajustados al fondo)
- [ ] Alerta de partidas vencidas usa Clock; cruce a negativo conserva TrendingDown
- [ ] Salidas proyectadas en foreground (no destructive); destructivo reservado al saldo negativo/cruce

**Verificación:** `pnpm run build`; manual en Tesorería con datos demo.
**Dependencias:** None (Task 4 recomendado primero si toca mismas líneas del summary card — no, es archivo distinto)
**Archivos:** `components/finance/pnl-branch-table.tsx`, `components/finance/cash-flow-summary-card.tsx`
**Tamaño:** S

---

## Task 8: Fuente 11px fuera de rampa

**Descripción:** Detector CLI: `expenses/page.tsx:575` usa `text-[11px]`, debajo del piso Label de 12px (Label-Floor Rule).

**Criterios de aceptación:**
- [ ] `text-xs` (12px) en lugar de `text-[11px]`

**Verificación:** `pnpm run build`; manual en /dashboard/finance/expenses.
**Dependencias:** None
**Archivos:** `app/dashboard/finance/expenses/page.tsx`
**Tamaño:** XS

---

## Task 9: Columna Confianza compacta

**Descripción:** La columna Confianza (badge con texto) ocupa tanto ancho como una columna numérica y empuja scroll horizontal en pantallas medianas.

**Criterios de aceptación:**
- [ ] En pantallas < lg la columna muestra solo el icono con tooltip accesible (reutiliza Task 3); texto completo en ≥lg
- [ ] Sin scroll horizontal a 1280px con 15 sucursales simuladas (o reducido significativamente)

**Verificación:** `pnpm run build`; manual a 1280px y 1440px.
**Dependencias:** Task 3 (tooltip), Task 4 (tokens del badge)
**Archivos:** `components/finance/pnl-branch-table.tsx`
**Tamaño:** S

---

## Task 10: Arqueos no aparecen en "Requiere tu atención" (TypeError cuts is not iterable)

**Descripción:** El panel `MoneyAttentionPanel` lanza `TypeError: cuts is not iterable` y cae a "Error de conexión" aunque la red esté bien: espera que `/api/sales/cuts` devuelva un arreglo, pero la ruta pagina con `{ items, total, scope }` (`app/api/sales/cuts/route.ts:148`). En `components/finance/money-attention-panel.tsx:168` se hace `const cuts: CutRow[] = cutsJson.data ?? []` y se itera directo. Los arqueos descuadrados nunca llegan al dueño.

**Criterios de aceptación:**
- [ ] Leer `cutsJson.data?.items ?? []` (con guarda `Array.isArray` defensiva)
- [ ] El conteo de arqueos descuadrados del panel coincide con lo que muestra /dashboard/sales
- [ ] Sin "Error de conexión" espurio cuando las tres APIs responden OK

**Verificación:**
- [ ] `pnpm run build`; manual en /dashboard/finance: sin error en consola, panel lista arqueos con faltante/sobrante

**Dependencias:** None
**Archivos:** `components/finance/money-attention-panel.tsx`
**Tamaño:** XS

---

### Checkpoint final
- [ ] Todas las criterias cumplidas
- [ ] `pnpm run build` final limpio
- [ ] `$impeccable critique app/dashboard/finance/page.tsx` → score mejoró respecto a 29/40
