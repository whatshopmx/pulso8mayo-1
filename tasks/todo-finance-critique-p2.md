# Finance Overview Critique P2 — Task List

Fuente: `.impeccable/critique/2026-08-23T04-28-39Z__app-dashboard-finance-page-tsx.md` (33/40).
Los 3 P1 ya quedaron resueltos en commits `81ad88e`, `5eea37c` y `c0732a1`. Esta lista cubre
los hallazgos menores que quedaron fuera de ese pase. Sin cambios de backend salvo la Task 1.

---

## Fase 1: Persona Contador

### Task 1: Exportar CSV y leyenda de procedencia imprimible en el P&L

**Description:** El contador externo no puede llevarse el P&L: no hay export ni versión para
imprimir. Agregar un botón "Exportar CSV" en el header de `PnlBranchTable` que genere el CSV
cliente-side (una fila por sucursal + TOTAL GRUPO, columnas = las 7 de la tabla) con BOM UTF-8
para Excel es-MX. En el mismo bloque de notas al pie, agregar una leyenda de procedencia
compacta (MEASURED / † DERIVED / \* SECTOR_DEFAULT / — NO_DATA) que sobreviva a Ctrl+P, y
promover el período del reporte desde letra fina a la descripción del card si la API lo expone;
si no, documentarlo como gap de backend.

**Acceptance criteria:**
- [x] Botón "Exportar CSV" visible cuando hay datos; descarga archivo que abre limpio en Excel es-MX (acentos y MXN intactos)
- [x] El CSV incluye las filas de sucursales paginadas completas (no solo la página visible) y el total de grupo
- [x] Leyenda de procedencia visible junto a las notas al pie y legible en impresión (`print:` styles o equivalente)
- [ ] El período analizado aparece en el header del card, no solo en letra fina
  → **GAP DE BACKEND:** `/api/finance/pnl` no devuelve el período en la respuesta ni en `meta`.
  Requiere exponer `startDate`/`endDate` efectivos desde `getPnLByBranch` antes de poder cerrar
  este criterio.

**Verification:**
- [ ] Build: `pnpm run build`
- [ ] Manual: exportar con ≥6 sucursales y verificar contenido contra la tabla
- [ ] Manual: imprimir preview de `/dashboard/finance` y verificar leyenda

**Dependencies:** Ninguna (si la API no expone período, anotar el gap y usar el rango conocido)

**Files likely touched:**
- `components/finance/pnl-branch-table.tsx`

**Estimated scope:** Medium (1 archivo, lógica de CSV nueva)

---

### Task 2: Tratamiento de procedencia en la venta total del grupo

**Description:** La pregunta abierta de la crítica: "¿por qué el número más grande no tiene
tratamiento de procedencia?". El total de ventas del TOTAL GRUPO se muestra sin marca aunque se
suma solo sobre sucursales con datos. Aplicar el mismo vocabulario del resto de la tabla: si
alguna sucursal tiene `sales.source === "NO_DATA"`, marcar el total con ≈/† y tooltip que diga
cuántas sucursales entran en la suma; si todas son MEASURED, dejarlo limpio.

**Acceptance criteria:**
- [ ] El total de ventas muestra marcador de procedencia cuando la suma es parcial
- [ ] El tooltip nombra cuántas sucursales con datos componen el total (p. ej. "5 de 7 sucursales")
- [ ] Sin marcador cuando todas las ventas son medidas
- [ ] Mismo tratamiento consistente con MARKER/SOURCE_CLASS existentes

**Verification:**
- [ ] Build: `pnpm run build`
- [ ] Manual: caso mixto (sucursal sin ventas) muestra marcador; caso completo no

**Dependencies:** Ninguna

**Files likely touched:**
- `components/finance/pnl-branch-table.tsx`

**Estimated scope:** Small (1 archivo)

---

## Fase 2: Limpieza Menor

### Task 3: Deduplicar formatMXN vs formatCents

**Description:** `components/finance/pnl-branch-table.tsx` define un `formatMXN` local que
duplica lo que ya hace `formatCents` de `lib/utils.ts` (usado por money-attention-panel y
cash-flow-summary-card). Eliminar el local y usar el compartido, verificando que el formato
de salida sea idéntico (es-MX, MXN). Si difieren, alinear primero en `lib/utils.ts`.

**Acceptance criteria:**
- [ ] No existe `formatMXN` local en pnl-branch-table.tsx
- [ ] Los montos del P&L se ven exactamente igual que antes (comparar captura antes/después)
- [ ] Un solo formateador de moneda es-MX en uso en components/finance/

**Verification:**
- [ ] Build: `pnpm run build`
- [ ] Visual: montos del P&L sin cambio de formato

**Dependencies:** Ninguna

**Files likely touched:**
- `components/finance/pnl-branch-table.tsx`
- `lib/utils.ts` (solo si hace falta alinear)

**Estimated scope:** Small (1-2 archivos)

---

### Task 4: Doble truncation en el panel de atención esconde la sucursal

**Description:** En los renglones de MoneyAttentionPanel, `item.detail` (que contiene la
sucursal) se trunca, y encima el contenedor puede truncar de nuevo en pantallas angostas:
el dueño ve "Polan…" sin saber qué rama ni qué caso. Cambiar `truncate` por `line-clamp-2`
en el detalle (o mover la sucursal a su propio span sin truncar y truncar solo el resto).

**Acceptance criteria:**
- [ ] La sucursal del renglón es legible en viewport de 360px
- [ ] Ningún renglón crece más de dos líneas de detalle
- [ ] El monto sigue alineado a la derecha sin encimarse

**Verification:**
- [ ] Build: `pnpm run build`
- [ ] Visual: 360px, 768px y 1280px con detalles largos (sucursal + categoría + antigüedad)

**Dependencies:** Ninguna

**Files likely touched:**
- `components/finance/money-attention-panel.tsx`

**Estimated scope:** Small (1 archivo)

---

### Task 5: Grid de tesorería envuelve el tercer stat solo en tablet

**Description:** En CashFlowSummaryCard, la grilla de tres stats (saldo inicial, salidas,
saldo al día) envuelve el tercer elemento solo en el breakpoint intermedio, quedando huérfano.
Revisar las clases de la grilla y elegir un acomodo estable: 3 columnas desde `sm`, o wrap
controlado con los tres a ancho completo.

**Acceptance criteria:**
- [ ] En ningún breakpoint queda un stat solo en su propia fila
- [ ] Los tres stats comparten alineación tipográfica en todos los breakpoints

**Verification:**
- [ ] Build: `pnpm run build`
- [ ] Visual: 640px, 768px, 1024px

**Dependencies:** Ninguna

**Files likely touched:**
- `components/finance/cash-flow-summary-card.tsx`

**Estimated scope:** Small (1 archivo)

---

## Checkpoint final

- [ ] Build limpio (`pnpm run build`)
- [ ] Lint limpio
- [ ] Re-correr `$impeccable critique` sobre `/dashboard/finance` y confirmar que los P2 bajaron
