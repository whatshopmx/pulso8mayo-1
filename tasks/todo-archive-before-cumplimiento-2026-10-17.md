# Todo: Executive Dashboard Refinement & Hardening (Executive OS)

> Implementation Task Tracker  
> Plan: `tasks/plan-executive-dashboard-refinement.md`  
> Target: `/dashboard/executive`  
> Base score: 22/40 | Goal: >34/40

---

## Phase 1: Shell & Latency Elimination

- [ ] **Task 1: Componente Cliente `ExecutiveCockpitTabs` con Shallow URL Sync**
  - [ ] Crear `components/dashboard/executive/executive-cockpit-tabs.tsx` como coordinador en cliente.
  - [ ] Pasar todas las props precargadas desde `app/dashboard/executive/page.tsx`.
  - [ ] Manejar estado de vista activo con alternancia instantánea (0 ms de latencia).
  - [ ] Sincronizar URL (`?view=cockpit|economics|liquidity`) con `history.replaceState` sin navegación RSC.
  - [ ] Verificar que recargas directas con `?view=...` abran la pestaña correspondiente.
  - [ ] *Verification:* Inspección en navegador + `pnpm run build`.

- [ ] **Task 2: Rediseño de Pestañas & Header (Operational Red ≤15% + Label Floor)**
  - [ ] Eliminar bloque rojo masivo (`bg-primary text-primary-foreground`) en pestaña activa.
  - [ ] Implementar indicador de píldora tonal con acento sutil conforme a `DESIGN.md`.
  - [ ] Corregir errores de clase de Tailwind (`py-0.2` a `py-0.5`) en badges de estatus.
  - [ ] Elevar textos a `text-xs` (12px).
  - [ ] *Verification:* `node .agents/skills/impeccable/scripts/detect.mjs --json components/dashboard/executive/executive-cockpit-header.tsx` = 0 findings.

### Checkpoint 1: Foundation & Shell
- [ ] Cambio de vistas instantáneo en cliente (0 ms de latencia de red).
- [ ] Parámetro `?view=` sincronizado sin parpadeos ni recargas SSR.
- [ ] Cabecera dentro del límite del 10-15% de Operational Red.

---

## Phase 2: Hardening de Flujo de Caja (Liquidity)

- [ ] **Task 3: Resiliencia de Proyección en Cash Runway + Baseline Cero (`y=0`)**
  - [ ] Corregir estado inerte punteado cuando `projectionData` no tenga series en el Twin.
  - [ ] Incorporar curva proyectada estimada o estado accionable de sincronización.
  - [ ] Agregar `<ReferenceLine y={0} stroke="oklch(var(--destructive))" strokeDasharray="3 3" />` en Recharts.
  - [ ] Invertir el radio de esquinas en barras con saldo negativo (`radius={[0,0,4,4]}`).
  - [ ] *Verification:* Verificación visual en navegador de `?view=liquidity`.

- [ ] **Task 4: Tokenización OKLCH y Erradicación de 11 Microtextos en `cash-runway-card.tsx`**
  - [ ] Elevar ejes `XAxis` y `YAxis` a `tick={{ fontSize: 12 }}`.
  - [ ] Elevar etiquetas de hitos del calendario mexicano y badges a `text-xs` (12px).
  - [ ] Reemplazar hex fijos (`#10b981`, `#ef4444`) por variables semánticas del sistema.
  - [ ] *Verification:* `node .agents/skills/impeccable/scripts/detect.mjs --json components/dashboard/executive/cash-runway-card.tsx` = 0 findings.

### Checkpoint 2: Flujo de Caja Hardened
- [ ] Gráfica de tesorería renderiza de forma determinista ante cualquier estado de datos.
- [ ] Cero violaciones de fuente menor a 12px en el módulo de liquidez.

---

## Phase 3: Unit Economics & Cascada Financiera

- [ ] **Task 5: Rediseño a Waterfall Escalonado Deductivo en `PnlExecutiveWaterfall`**
  - [ ] Reemplazar cuadrícula de 4 tarjetas por un gráfico de puente/cascada deductivo conectado.
  - [ ] Mostrar flujo: Ventas Netas (100%) ➔ -Insumos ➔ Margen Bruto ➔ -Nómina ➔ Prime Margin ➔ -OpEx ➔ EBITDA.
  - [ ] Marcar visualmente el umbral objetivo del Prime Margin (≤60%).
  - [ ] Añadir tooltip interactivo con la sucursal de mayor merma/fuga de la red y enlace al drawer `PnlAuditDrawer`.
  - [ ] Erradicar los 4 hallazgos de microtextos en el componente.
  - [ ] *Verification:* `node .agents/skills/impeccable/scripts/detect.mjs --json components/dashboard/executive/pnl-executive-waterfall.tsx` = 0 findings.

- [ ] **Task 6: Resiliencia de Escala >80% y Corrección de Tokens en `PrimeCostStackCard`**
  - [ ] Ajustar la escala de barras apiladas para soportar desbordes de Prime Cost >80% sin recorte visual.
  - [ ] Reemplazar clases utilitarias `bg-sky-500` e `bg-indigo-500` por tokens OKLCH del sistema (`chart-1`, `chart-2`).
  - [ ] Erradicar los 4 hallazgos de microtextos a 10px/11px.
  - [ ] *Verification:* `node .agents/skills/impeccable/scripts/detect.mjs --json components/dashboard/executive/prime-cost-stack-card.tsx` = 0 findings.

### Checkpoint 3: Unit Economics Impecable
- [ ] Cascada P&L comunica la fuga de margen en 5 segundos.
- [ ] Barras apiladas toleran anomalías extremas sin romperse.
- [ ] Cero violaciones tipográficas en la vista de economía unitaria.

---

## Phase 4: Despacho de 60 Segundos con WhatsApp & Cierre

- [ ] **Task 7: Acciones Inline y Generador de WhatsApp en `ExecutiveDecisionDeck`**
  - [ ] Incorporar botón "Mandar WhatsApp a Gerente" con plantilla de texto pre-elaborada con los datos del incidente.
  - [ ] Añadir botón "Autorizar / Descartar" con actualización optimista inmediata sin salir del panel.
  - [ ] Conservar botón de auditoría profunda hacia `/dashboard/branches/[id]` o excepciones.
  - [ ] Elevar microtexto de prioridad a 12px (`text-xs`).
  - [ ] *Verification:* `node .agents/skills/impeccable/scripts/detect.mjs --json components/dashboard/executive/executive-decision-deck.tsx` = 0 findings.

- [ ] **Task 8: Pulido del Copiloto, Erradicación de Errores y Verificación Final**
  - [ ] Elevar los 5 microtextos en `executive-copilot-card.tsx` a 12px.
  - [ ] Ajustar altura mínima y usabilidad del textarea de consulta ejecutiva.
  - [ ] Ejecutar `detect.mjs` sobre toda la carpeta `components/dashboard/executive/` verificando 0 hallazgos.
  - [ ] Compilar suite completa con `pnpm run build`.
  - [ ] Re-ejecutar `$impeccable critique` para registrar el incremento de calificación en el histórico.
  - [ ] *Verification:* 0 hallazgos en detector, build clean y snapshot actualizado.

### Checkpoint Final: Aprobación y Trend Impeccable
- [ ] Las 8 tareas completadas y verificadas.
- [ ] Score de Impeccable Critique sube a banda Good/Excellent (>34/40).
- [ ] Cero errores de build en producción.
