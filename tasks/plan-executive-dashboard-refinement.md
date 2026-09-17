# Implementation Plan: Executive Dashboard Refinement & Hardening (Executive OS)

**Fecha:** 17 de septiembre de 2026  
**Objetivo:** Elevar el Executive Dashboard (`/dashboard/executive`) de una calificación de **22/40 (Acceptable)** a **>34/40 (Good/Excellent)** mediante interactividad en cliente con latencia cero, gráfica de flujo robusta, cascada financiera deductiva real, acciones inline de 60 segundos con WhatsApp y apego estricto al Design System de Pulso.  
**Ruta:** `/dashboard/executive` (`?view=cockpit` · `?view=economics` · `?view=liquidity`)  
**Auditoría previa:** `.impeccable/critique/2026-09-17T15-00-17Z__app-dashboard-executive-page-tsx.md`

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
- **Problema:** `page.tsx` ya obtiene todos los datos (`company`, `twin`, `ranking`, `brief`) en una sola pasada en servidor con `Promise.all`. Hacer navegación por servidor en cada pestaña es un desperdicio de recursos.
- **Solución:** `page.tsx` entrega el paquete completo de datos a un componente cliente interactivo `ExecutiveCockpitTabs`.
- **Comportamiento:** Las 3 vistas permanecen montadas o se alternan con estado React en 0 ms. Se sincroniza la URL vía `window.history.replaceState` / shallow routing para que `?view=economics` y `?view=liquidity` sigan siendo enlaces directos válidos y recargables.

### Decisión 2: Despacho Operativo en 1 Clic con WhatsApp en la Cola de Decisiones
- **Problema:** Un director general no tiene tiempo de abrir 4 pestañas secundarias para resolver discrepancias operativas de sus sucursales.
- **Solución:** Cada ítem en `ExecutiveDecisionDeck` incluirá:
  - **Disparador de WhatsApp:** Abre WhatsApp Web o genera mensaje Wasender pre-redactado con los datos de la sucursal, la desviación y la instrucción correctiva para el gerente.
  - **Resolución Inline:** Acciones de un clic ("Autorizar", "Diferir 24h") con actualización optimista inmediata en la UI.
  - **Enlace secundario:** Botón discreto de auditoría forense para inspección profunda.

### Decisión 3: Gráfico Waterfall Escalonado Financiero Interactivo (vs Grid Estático)
- **Problema:** 4 tarjetas una al lado de la otra no comunican visualmente la merma de margen.
- **Solución:** Transformar `PnlExecutiveWaterfall` en un gráfico de puente escalonado:
  - Base: Ventas Netas (100%)
  - Escalón descendente: -COGS Insumos
  - Escalón descendente: -Nómina
  - Nivel Prime Margin (con línea guía visual del umbral 40%)
  - Escalón descendente: -OpEx
  - Barra final: EBITDA Operativo
  - Al interactuar con el escalón de insumos o nómina, se destaca la sucursal de mayor fuga con acceso directo al drawer `PnlAuditDrawer`.

### Decisión 4: Erradicación de Violaciones Label-Floor y Tokenización OKLCH
- **Piso tipográfico:** Elevar todos los 25 microtextos de 10px y 11px a un mínimo estricto de 12px (`text-xs` / `typography.label`), utilizando pesos (`font-semibold`/`font-bold`) y colores semánticos para jerarquía.
- **Paleta:** Reemplazar colores fijos por tokens del sistema (`chart-1`, `chart-2`, `primary`, `destructive`, `muted-foreground`).
- **Operational Red:** Eliminar el bloque rojo masivo del botón activo en pestañas; aplicar una píldora con acento sutil conforme al límite del 10-15%.

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

#### Task 1: Componente Cliente `ExecutiveCockpitTabs` con Shallow URL Sync
- **Descripción:** Crear un contenedor de cliente que reciba las props precargadas de `page.tsx` y gestione la alternancia de las 3 vistas en memoria del cliente sin recargas de página ni re-ejecuciones de base de datos en el servidor.
- **Acceptance criteria:**
  - [ ] Al hacer clic entre *1. Despacho*, *2. Unit Economics* y *3. Oxígeno*, el cambio de vista ocurre en 0 ms sin pantalla blanca ni parpadeo.
  - [ ] La URL se actualiza transparentemente (`/dashboard/executive?view=economics`) mediante `window.history.replaceState` sin gatillar llamadas RSC.
  - [ ] Si el usuario recarga la página o entra con un enlace directo con `?view=liquidity`, la pestaña correcta se inicializa de forma inmediata.
- **Verification:**
  - [ ] Inspección en navegador: clic en pestañas no genera requests de navegación en Network.
  - [ ] `pnpm run build` compila sin errores.
- **Dependencies:** Ninguna.
- **Files likely touched:**
  - `components/dashboard/executive/executive-cockpit-tabs.tsx` [NEW]
  - `app/dashboard/executive/page.tsx` [MODIFY]
- **Estimated scope:** Medium (2 archivos).

#### Task 2: Rediseño de Pestañas & Header (Operational Red ≤15% + Label Floor)
- **Descripción:** Refinar `ExecutiveCockpitHeader` para eliminar el botón rojo sólido que satura la cabecera. Implementar estilo de píldora tonal con borde sutil o subrayado activo. Corregir errores de clase de Tailwind (`py-0.2` a `py-0.5`).
- **Acceptance criteria:**
  - [ ] La pestaña activa ya no utiliza `bg-primary text-primary-foreground shadow-sm` masivo; usa un indicador tonal con acento sutil acorde a `DESIGN.md`.
  - [ ] El contador de casos pendientes y la alerta de Prime Cost utilizan badges legibles sin clases inválidas.
  - [ ] No existen textos menores a 12px en el header.
- **Verification:**
  - [ ] `node .agents/skills/impeccable/scripts/detect.mjs --json components/dashboard/executive/executive-cockpit-header.tsx` = 0 findings.
- **Dependencies:** Task 1.
- **Files likely touched:**
  - `components/dashboard/executive/executive-cockpit-header.tsx` [MODIFY]
- **Estimated scope:** Small (1 archivo).

---

### Checkpoint: Foundation & Shell
- [ ] Cambio entre vistas es instantáneo en cliente (0 ms de latencia).
- [ ] Parámetro `?view=` se mantiene sincronizado en la barra de direcciones.
- [ ] Cabecera alineada con la regla del 10-15% de Operational Red.

---

### Phase 2: Hardening de Flujo de Caja (Liquidity)

#### Task 3: Resiliencia de Proyección en Cash Runway + Baseline Cero (`y=0`)
- **Descripción:** Corregir el estado en blanco/carga de `CashRunwayCard`. Cuando `projectionData` esté vacío en el Twin, generar una proyección sintética de contingencia calculada con base en el promedio de ventas y compromisos de nómina, evitando que la pantalla parezca rota. Incorporar la línea de referencia cero (`<ReferenceLine y={0} />`) y condicional de redondeo de barras.
- **Acceptance criteria:**
  - [ ] Si no hay datos en base de datos, la gráfica muestra una proyección estimada clara con badge indicativo *"Proyección preliminar del Twin"* en lugar de un recuadro punteado inerte.
  - [ ] La gráfica de barras incluye `<ReferenceLine y={0} stroke="oklch(var(--destructive))" strokeDasharray="3 3" />` para delimitar visualmente el umbral de insolvencia.
  - [ ] Las barras con saldo negativo tienen el radio redondeado hacia abajo (`radius={[0, 0, 4, 4]}`), mientras las positivas se redondean hacia arriba (`radius={[4, 4, 0, 0]}`).
- **Verification:**
  - [ ] Verificación visual en navegador de la vista `?view=liquidity` mostrando gráfica completa.
- **Dependencies:** Checkpoint 1.
- **Files likely touched:**
  - `components/dashboard/executive/cash-runway-card.tsx` [MODIFY]
- **Estimated scope:** Small (1 archivo).

#### Task 4: Tokenización OKLCH y Erradicación de 11 Microtextos en `cash-runway-card.tsx`
- **Descripción:** Erradicar las 11 violaciones de la regla Label-Floor detectadas por `detect.mjs` en `cash-runway-card.tsx` elevando todos los `text-[10px]` y `text-[11px]` a `text-xs` (12px) y `fontSize: 12` en los ejes de Recharts. Reemplazar los colores hexadecimales hardcodeados (`#10b981`, `#ef4444`) por variables semánticas del sistema.
- **Acceptance criteria:**
  - [ ] Ejes `XAxis` y `YAxis` usan `tick={{ fontSize: 12 }}`.
  - [ ] Los 4 hitos del calendario mexicano (Nómina, IMSS día 17, Proveedores A, Rentas) usan `text-xs` para descripciones y badges.
  - [ ] Colores de barras consumen tokens de éxito y advertencia del sistema.
- **Verification:**
  - [ ] `node .agents/skills/impeccable/scripts/detect.mjs --json components/dashboard/executive/cash-runway-card.tsx` arroja 0 hallazgos.
- **Dependencies:** Task 3.
- **Files likely touched:**
  - `components/dashboard/executive/cash-runway-card.tsx` [MODIFY]
- **Estimated scope:** Small (1 archivo).

---

### Checkpoint: Flujo de Caja Hardened
- [ ] La pestaña `?view=liquidity` renderiza de inmediato con o sin datos previos del Twin.
- [ ] Cero violaciones de fuente menor a 12px en el módulo de liquidez.

---

### Phase 3: Unit Economics & Cascada Financiera

#### Task 5: Rediseño a Waterfall Escalonado Deductivo en `PnlExecutiveWaterfall`
- **Descripción:** Transformar la cuadrícula de 4 tarjetas estáticas en una verdadera cascada gráfica conectada que ilustre el puente deductivo del dinero: Ingresos Netos (100%) ➔ -Alimentos ➔ Margen Bruto ➔ -Nómina ➔ Prime Margin ➔ -OpEx ➔ EBITDA. Incluir conectores visuales y tooltip que indique qué sucursal es responsable de la mayor fuga de margen.
- **Acceptance criteria:**
  - [ ] Visualización en forma de cascada o puente deductivo conectado con barras y subtotales intermedios.
  - [ ] Se destaca claramente el umbral crítico del Prime Margin (≤ 60%).
  - [ ] Todas las etiquetas respetan el piso de 12px (erradicar los 4 hallazgos de `detect.mjs`).
  - [ ] Al interactuar con el componente, se resalta la mayor fuga de la red con acceso directo al drawer de auditoría `PnlAuditDrawer`.
- **Verification:**
  - [ ] `node .agents/skills/impeccable/scripts/detect.mjs --json components/dashboard/executive/pnl-executive-waterfall.tsx` = 0 findings.
  - [ ] Visualización clara en desktop y viewport móvil (390px).
- **Dependencies:** Checkpoint 1.
- **Files likely touched:**
  - `components/dashboard/executive/pnl-executive-waterfall.tsx` [MODIFY]
- **Estimated scope:** Medium (1 archivo).

#### Task 6: Resiliencia de Escala >80% y Corrección de Tokens en `PrimeCostStackCard`
- **Descripción:** Corregir el cálculo de barras horizontales apiladas para sucursales con desbordes extremos de Prime Cost (>80%), evitando que se desborden o corten fuera del contenedor. Reemplazar `bg-sky-500` y `bg-indigo-500` por los tokens de gráficas del Design System (`chart-1`, `chart-2`). Erradicar los 4 hallazgos de microtexto a 10px/11px.
- **Acceptance criteria:**
  - [ ] La escala horizontal de barras calcula su ancho relativo dinámicamente si una sucursal excede el 80% de Prime Cost.
  - [ ] La barra de alimentos y nómina utiliza variables de color semánticas (`chart-1`, `chart-2` o equivalentes temáticos).
  - [ ] Todos los badges y leyendas usan `text-xs` (12px).
- **Verification:**
  - [ ] `node .agents/skills/impeccable/scripts/detect.mjs --json components/dashboard/executive/prime-cost-stack-card.tsx` = 0 findings.
- **Dependencies:** Task 5.
- **Files likely touched:**
  - `components/dashboard/executive/prime-cost-stack-card.tsx` [MODIFY]
- **Estimated scope:** Small (1 archivo).

---

### Checkpoint: Unit Economics Impecable
- [ ] La cascada P&L muestra visualmente el paso de ventas a EBITDA.
- [ ] Las barras apiladas de Prime Cost soportan desbordes sin romper la maquetación.
- [ ] Cero violaciones tipográficas en la vista de economía unitaria.

---

### Phase 4: Despacho de 60 Segundos con WhatsApp & Cierre

#### Task 7: Acciones Inline y Generador de WhatsApp en `ExecutiveDecisionDeck`
- **Descripción:** Incorporar botones de acción operativa rápida en cada tarjeta de decisión:
  1. Botón "Mandar WhatsApp a Gerente" que abre diálogo con mensaje pre-elaborado para enviar vía WhatsApp Web o API de Wasender.
  2. Botón "Autorizar / Descartar" que permite marcar el ítem como resuelto sin abandonar la cabina de mando.
  3. Enlace secundario "Auditar Tienda" conservado como opción de detalle forense.
- **Acceptance criteria:**
  - [ ] El director puede resolver o diferir un caso directamente desde la cabina con respuesta visual inmediata.
  - [ ] El botón de WhatsApp arma automáticamente el texto con la sucursal, la métrica desfasada y la recomendación.
  - [ ] Se eleva el microtexto a 10px de la prioridad a 12px (`text-xs`).
- **Verification:**
  - [ ] `node .agents/skills/impeccable/scripts/detect.mjs --json components/dashboard/executive/executive-decision-deck.tsx` = 0 findings.
  - [ ] Prueba interactiva del disparador de WhatsApp y resolución inline.
- **Dependencies:** Checkpoint 1.
- **Files likely touched:**
  - `components/dashboard/executive/executive-decision-deck.tsx` [MODIFY]
- **Estimated scope:** Medium (1-2 archivos).

#### Task 8: Pulido del Copiloto, Erradicación de Errores Tipográficos y Verificación Final
- **Descripción:** Erradicar los 5 hallazgos de microtextos en `executive-copilot-card.tsx`, ajustar la altura y accesibilidad del campo de texto de consulta estratégica, ejecutar el detector global sobre toda la carpeta ejecutiva y correr una nueva sesión de auditoría con `$impeccable critique`.
- **Acceptance criteria:**
  - [ ] Todos los microtextos en `executive-copilot-card.tsx` están en `text-xs`.
  - [ ] `detect.mjs` sobre `components/dashboard/executive/` pasa con **0 findings** (cero violaciones de las 25 originales).
  - [ ] `pnpm run build` compila con código de salida 0.
  - [ ] Se ejecuta `$impeccable critique` registrando la subida de score en el histórico de snapshots.
- **Verification:**
  - [ ] `node .agents/skills/impeccable/scripts/detect.mjs --json components/dashboard/executive` = `[]`.
  - [ ] `pnpm run build`.
- **Dependencies:** Tasks 1 a 7.
- **Files likely touched:**
  - `components/dashboard/executive/executive-copilot-card.tsx` [MODIFY]
- **Estimated scope:** Small (1 archivo).

---

### Checkpoint Final: Aprobación y Trend Impeccable
- [ ] Todas las tareas completadas y verificadas.
- [ ] `detect.mjs` reporta 0 hallazgos en toda la cabina ejecutiva.
- [ ] Suite de producción compila limpia.
- [ ] Trend actualizado en `.impeccable/critique/`.

---

## 5. Risks and Mitigations

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Inconsistencia de estado al usar `history.replaceState` en Next.js App Router | Medio | Utilizar el hook nativo de Next.js `useRouter` con `{ scroll: false }` o sincronización controlada en `useEffect` con fallback determinista. |
| Sucursales con datos nulos o cero ventas en la gráfica Waterfall | Medio | Integrar valores base seguros (`safeSales`) con indicativo visual claro cuando se esté operando con proyecciones estimadas. |
| Disparador de WhatsApp bloqueado por pop-up blocker en navegadores | Bajo | Utilizar enlaces directos con target `_blank` (`window.open` o `<a href="https://wa.me/...">`) activados por gesto explícito de clic de usuario. |
| Incompatibilidad de Recharts en renderizado responsivo móvil | Bajo | Emplear `ResponsiveContainer` con altura mínima fija (`min-h-[240px]`) y contenedor flex adaptable. |

---

## 6. Definition of Done
1. **Zero Detector Findings**: `node .agents/skills/impeccable/scripts/detect.mjs --json components/dashboard/executive` devuelve `[]`.
2. **Zero-Latency Tab Switch**: La navegación entre Cockpit, Economics y Liquidity no gatilla recargas de página en el navegador.
3. **P0/P1 Resueltos**: Gráfica de tesorería 14D funcional con baseline cero; cascada PnL gráfica conectada; acciones de 60 segundos con WhatsApp disponibles.
4. **Build Clean**: `pnpm run build` finaliza sin errores de TypeScript ni empaquetado.
5. **Auditoría Impeccable**: Nueva ejecución de `$impeccable critique` muestra el incremento de calificación registrado en el histórico.
