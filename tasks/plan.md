# Implementation Plan: Executive Dashboard Refinement & Hardening (Executive OS)

**Fecha:** 17 de septiembre de 2026  
**Objetivo:** Elevar el Executive Dashboard (`/dashboard/executive`) de una calificación de **22/40 (Acceptable)** a **>34/40 (Good/Excellent)** mediante interactividad en cliente con latencia cero, gráfica de flujo robusta, cascada financiera deductiva real, acciones inline de 60 segundos con WhatsApp y apego estricto al Design System de Pulso.  
**Ruta:** `/dashboard/executive` (`?view=cockpit` · `?view=economics` · `?view=liquidity`)  
**Auditoría previa:** `.impeccable/critique/2026-09-17T15-00-17Z__app-dashboard-executive-page-tsx.md`  
**Referencia detallada:** `tasks/plan-executive-dashboard-refinement.md`

---

## 1. Overview

El Executive Dashboard cuenta con un anclaje de negocio sobresaliente para dueños y directores de cadenas HORECA en México (3 a 15 sucursales): integra Prime Cost (comida + nómina ≤ 60%), calendario con hitos clave (SIPARE/IMSS día 17, nóminas quincenales 15/30) y el modelo causal del Executive Twin.

Sin embargo, la auditoría visual y de código de Impeccable evidenció 5 cuellos de botella críticos:
1. **Latencia y parpadeo SSR**: Las 3 vistas cambian mediante enlaces `<Link>`, disparando 4 consultas a Postgres en cada clic en vez de alternar fluidamente en cliente.
2. **Gráfica de tesorería colgada en estado de carga**: En la vista de liquidez, la proyección de caja muestra un contenedor punteado estático cuando faltan series, carece de eje cero (`y=0`) para insolvencia y redondea erróneamente las barras negativas.
3. **Falsa cascada de P&L**: El componente `PnlExecutiveWaterfall` es una cuadrícula de 4 cajas estáticas en vez de una verdadera cascada escalonada de deducción de margen y EBITDA.
4. **Fuga del flujo de 60 segundos**: La Cola de Decisiones expulsa al director hacia otras páginas para cualquier acción, en lugar de permitir despachos inline o alertas inmediatas por WhatsApp.
5. **25 violaciones de la regla Label-Floor**: Microtextos a 10px y 11px ilegibles en tablets, clases inválidas (`py-0.2`) y colores utilitarios (`sky-500`, `indigo-500`, `#10b981`) fuera del sistema OKLCH de `DESIGN.md`.

---

## 2. Architecture & Design Decisions

### Decisión 1: Precarga Integral en Servidor + Coordinador de Pestañas en Cliente (`ExecutiveCockpitTabs`)
- `page.tsx` entrega el paquete completo de datos (`company`, `twin`, `ranking`, `brief`) al componente cliente `ExecutiveCockpitTabs`.
- Las 3 vistas se alternan con estado React en 0 ms. Se sincroniza la URL vía `window.history.replaceState` / shallow routing para mantener deep-linking permanente sin forzar peticiones RSC.

### Decisión 2: Despacho Operativo en 1 Clic con WhatsApp en la Cola de Decisiones
- Cada ítem en `ExecutiveDecisionDeck` incluye disparador rápido de WhatsApp (web o Wasender) con texto pre-elaborado para el gerente de la sucursal, y resolución inline inmediata ("Autorizar", "Diferir 24h") con actualización optimista.

### Decisión 3: Gráfico Waterfall Escalonado Financiero Interactivo
- Transformar `PnlExecutiveWaterfall` en un gráfico de puente escalonado: Base Ventas ➔ -COGS ➔ Margen Bruto ➔ -Nómina ➔ Prime Margin (≤60%) ➔ -OpEx ➔ EBITDA, con tooltip de mayor fuga y acceso directo a `PnlAuditDrawer`.

### Decisión 4: Erradicación de Violaciones Label-Floor y Tokenización OKLCH
- Elevar todos los 25 microtextos de 10px y 11px a un mínimo de 12px (`text-xs`).
- Reemplazar colores utilitarios por tokens semánticos de `DESIGN.md` (`chart-1`, `chart-2`, etc.).
- Limitar el Operational Red a acentos sutiles (≤15%) en la pestaña activa.

---

## 3. Dependency Graph

```
Phase 1: Shell & Latency Elimination
  ├── Task 1: Componente Cliente ExecutiveCockpitTabs con Shallow URL Sync
  └── Task 2: Rediseño de Pestañas & Header (Operational Red ≤15% + Label Floor)
         │
         ▼
Checkpoint 1: Cambio de vistas instantáneo (0ms) y URL sincronizada

Phase 2: Hardening de Flujo de Caja (Liquidity)
  ├── Task 3: Simulación de Contingencia en Cash Runway + Baseline Cero (y=0)
  └── Task 4: Tokenización OKLCH y Erradicación de 11 Microtextos en Flujo 14D
         │
         ▼
Checkpoint 2: Proyección de tesorería robusta ante cualquier estado de datos

Phase 3: Unit Economics & Cascada Financiera
  ├── Task 5: Rediseño a Waterfall Escalonado Deductivo en PnlExecutiveWaterfall
  └── Task 6: Resiliencia de Escala >80% y Corrección de Tokens en PrimeCostStackCard
         │
         ▼
Checkpoint 3: Visualización de margen deductivo en 5 segundos sin fuga de tokens

Phase 4: Despacho de 60 Segundos con WhatsApp & Cierre
  ├── Task 7: Acciones Inline y Generador de WhatsApp en ExecutiveDecisionDeck
  └── Task 8: Pulido del Copiloto, Erradicación de Bugs de Sintaxis y Verificación detect.mjs
         │
         ▼
Checkpoint 4: 0 Hallazgos en detector, suite compila limpia, re-evaluación de score
```

---

## 4. Task Breakdown

### Phase 1: Shell & Latency Elimination
- **Task 1:** Componente Cliente `ExecutiveCockpitTabs` con Shallow URL Sync. (Archivos: `components/dashboard/executive/executive-cockpit-tabs.tsx`, `app/dashboard/executive/page.tsx`).
- **Task 2:** Rediseño de Pestañas & Header (Operational Red ≤15% + Label Floor). (Archivo: `components/dashboard/executive/executive-cockpit-header.tsx`).
*Checkpoint 1:* Cambio instantáneo en cliente (0 ms), URL sincronizada, Operational Red contenido.

### Phase 2: Hardening de Flujo de Caja (Liquidity)
- **Task 3:** Resiliencia de Proyección en Cash Runway + Baseline Cero (`y=0`). (Archivo: `components/dashboard/executive/cash-runway-card.tsx`).
- **Task 4:** Tokenización OKLCH y Erradicación de 11 Microtextos en `cash-runway-card.tsx`. (Archivo: `components/dashboard/executive/cash-runway-card.tsx`).
*Checkpoint 2:* Gráfica de tesorería determinista y legible sin textos < 12px.

### Phase 3: Unit Economics & Cascada Financiera
- **Task 5:** Rediseño a Waterfall Escalonado Deductivo en `PnlExecutiveWaterfall`. (Archivo: `components/dashboard/executive/pnl-executive-waterfall.tsx`).
- **Task 6:** Resiliencia de Escala >80% y Corrección de Tokens en `PrimeCostStackCard`. (Archivo: `components/dashboard/executive/prime-cost-stack-card.tsx`).
*Checkpoint 3:* Cascada deductiva clara en 5 segundos y barras apiladas adaptables.

### Phase 4: Despacho de 60 Segundos con WhatsApp & Cierre
- **Task 7:** Acciones Inline y Generador de WhatsApp en `ExecutiveDecisionDeck`. (Archivo: `components/dashboard/executive/executive-decision-deck.tsx`).
- **Task 8:** Pulido del Copiloto, Erradicación de Bugs de Sintaxis y Verificación `detect.mjs`. (Archivo: `components/dashboard/executive/executive-copilot-card.tsx`).
*Checkpoint Final:* 0 hallazgos en detector, build sin errores y score >34/40 en Impeccable Critique.
