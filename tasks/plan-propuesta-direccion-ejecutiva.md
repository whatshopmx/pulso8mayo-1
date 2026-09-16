# Implementation Plan: Dirección Ejecutiva & Unit Economics (Executive OS)

Fecha: 16 de septiembre de 2026  
Origen: `docs/propuesta-direccion-ejecutiva.md`  
Audience: Dueño / Director General / Socio Operador de Red Restaurantera (3 a 15 sucursales)  

---

## 1. Overview

Transformar `/dashboard/executive` de un scroll vertical interminable de reportes y tablas contables a un **Cockpit Ejecutivo de Alta Densidad** ("The Executive Operating Cockpit"). La nueva experiencia se estructura en **3 Modos de Decisión**:

1. **Despacho & Decisiones (La Rutina Diaria de 60s):** Vital Signs Bar, Executive Decision Deck con impacto económico en MXN y Copiloto Estratégico Proactivo con simulaciones de EBITDA.
2. **Unit Economics & Prime Cost (Rentabilidad de Red):** Visualizador de Prime Cost apilado (Alimentos % + Mano de Obra % < 60%), detección de fugas de margen por sucursal y cascada ejecutiva de EBITDA con P&L analítico bajo demanda (Drawer).
3. **Oxígeno & Flujo 14D (Capital & Liquidez Real):** Calendario de hitos críticos restauranteros en México (Nómina 15/30, IMSS día 17, Proveedores A, Rentas) y proyección de saldo mínimo de seguridad (*Lowest Cash Point*).

---

## 2. Architecture & Design Decisions

- **Sincronización de Vistas vía URL SearchParams:** El estado de la vista (`cockpit` | `economics` | `liquidity`) se controla mediante `?view=` con Server Components y `Suspense`, permitiendo deep linking, recarga determinista y cero layout shifts.
- **Reutilización Estricta de Servicios Vivos (Wrap, Don't Recompute):**
  - Métricas de grupo y dimensiones ejecutivas: `ExecutiveTwinEngine.getLatest(companyId)`.
  - Prime Cost y anomalías de red: `CrossBranchService.getQSRRanking(companyId, 30)` y `detectNetworkAnomalies`.
  - Decisiones y prioridades matutinas: `MorningBriefService.getLatest(companyId)`.
  - Proyección de tesorería y compromisos: `CashFlowService.getCashFlowProjection(companyId, 14)`.
- **Desacoplamiento de la Tabla Contable Masiva:** La tabla de 15 columnas `PnlBranchTable` se retira del flujo vertical principal y se coloca dentro de un `Sheet` (Drawer lateral) accesible con un clic para auditoría profunda, manteniendo la pantalla ejecutiva limpia y de alto impacto.
- **Tokens de Diseño Pulso HORECA:** Flat con estratificación tonal (sin sombras pesadas), Operational Red (`oklch(0.52 0.17 25)`), tipografía Geist Display y Geist Mono para cifras monetarias.

---

## 3. Dependency Graph

```
Phase 1: Foundation
  └── Task 1: Vital Signs Bar & View Switcher (URL params ?view=)
         │
         ├── Phase 2: View 1 (Despacho & Decisiones)
         │     ├── Task 2: Executive Decision Deck (Prioridades con impacto MXN y botones de acción)
         │     └── Task 3: Proactive Strategic Copilot (Simulaciones de EBITDA)
         │
         ├── Phase 3: View 2 (Unit Economics & Prime Cost)
         │     ├── Task 4: Prime Cost Stack Visualizer (Barras apiladas vs 60%)
         │     └── Task 5: EBITDA Waterfall & Audit Drawer (PnlBranchTable en Sheet)
         │
         └── Phase 4: View 3 (Oxígeno & Flujo 14D)
               └── Task 6: Cash Runway Card con Hitos Mexicanos (Nómina, IMSS día 17)
                     │
Phase 5: Orchestration & Polish
  └── Task 7: Master Page Integration (/dashboard/executive/page.tsx)
  └── Task 8: E2E Verification & Responsive Tests
```

---

## 4. Task Breakdown

### Phase 1: Foundation & Header

#### Task 1: Vital Signs Header & Executive Mode Switcher
**Description:**  
Crear el componente `ExecutiveCockpitHeader` que muestra los 4 signos vitales de la red (Salud del Grupo 0-100, Venta del Mes vs Meta, Prime Cost Consolidado y Caja Libre Proyectada a 14d) y la barra selectora de modos de decisión (`cockpit`, `economics`, `liquidity`).

**Acceptance criteria:**
- [ ] Muestra los 4 KPIs clave en formato compacto Geist Display con tonalidad semafórica.
- [ ] Permite alternar entre las 3 vistas mediante tabs fluidos sincronizados con `?view=`.
- [ ] La vista por defecto es `cockpit`.
- [ ] Incluye estado de carga esqueleto (`VitalSignsSkeleton`).

**Verification:**
- [ ] Typecheck: `pnpm exec tsc --noEmit`
- [ ] Manual check: Alternar vistas en `/dashboard/executive?view=...` actualiza la URL y el tab activo sin parpadeos.

**Dependencies:** None  
**Files likely touched:**
- `components/dashboard/executive/executive-cockpit-header.tsx`
- `components/dashboard/executive/executive-cockpit-skeleton.tsx`  
**Estimated scope:** S (2 files)

---

### Phase 2: View 1 — Despacho & Decisiones

#### Task 2: Executive Decision Deck con Impacto en MXN y Acciones Directas
**Description:**  
Crear el componente `ExecutiveDecisionDeck` que transforma las prioridades del `MorningBriefService` y las anomalías de `CrossBranchService` en tarjetas ejecutivas accionables que muestran el monto en pesos mexicanos (ahorro o riesgo) y botones de resolución en 1 clic.

**Acceptance criteria:**
- [ ] Renderiza tarjetas para nómina pendiente, arbitraje de inventario entre sucursales y alertas de dinero en caja.
- [ ] Cada tarjeta incluye: Título, Badge de impacto (`CRITICAL`, `HIGH`, `MEDIUM`), Monto estimado en MXN y botón de acción directa con deep-link o modal.
- [ ] Maneja estado vacío cuando no hay decisiones críticas pendientes con un mensaje positivo de operación controlada.

**Verification:**
- [ ] Tests unitarios: `pnpm test:unit components/dashboard/executive/__tests__/executive-decision-deck.test.tsx`
- [ ] Typecheck: `pnpm exec tsc --noEmit`

**Dependencies:** Task 1  
**Files likely touched:**
- `components/dashboard/executive/executive-decision-deck.tsx`  
**Estimated scope:** M (2 files)

#### Task 3: Copiloto Estratégico Proactivo (Virtual Board Member)
**Description:**  
Evolucionar `ExecutiveCopilot` para que en lugar de un chatbox vacío, presente **3 Simulaciones de Alto Impacto** pre-calculadas para el mes (ej. Estandarización de porciones para ganar EBITDA, Mitigación de aumento en insumos cárnicos, Redistribución de cuadrantes laborales) más barra de consulta rápida.

**Acceptance criteria:**
- [ ] Muestra 3 tarjetas de simulación estratégica basadas en el estado del `ExecutiveTwin`.
- [ ] Al hacer clic en una simulación, despliega el desglose del impacto financiero proyectado en EBITDA y margen.
- [ ] Mantiene la barra de consulta abierta para preguntas ad-hoc al `IntelligenceService`.

**Verification:**
- [ ] Typecheck: `pnpm exec tsc --noEmit`
- [ ] Manual check: Clic en simulación abre el escenario interactivo.

**Dependencies:** Task 1  
**Files likely touched:**
- `components/dashboard/executive/executive-copilot-card.tsx`
- `components/dashboard/executive/executive-copilot-client.tsx`  
**Estimated scope:** M (2-3 files)

---

### Checkpoint 1: Despacho de 60 Segundos Operativo
- [ ] La cabecera ejecutiva y la vista de Despacho (`?view=cockpit`) cargan limpiamente.
- [ ] El usuario puede evaluar el estado del grupo y resolver o delegar las 3 prioridades del día sin hacer scroll.

---

### Phase 3: View 2 — Unit Economics & Prime Cost

#### Task 4: Visualizador de Prime Cost Stack por Sucursal
**Description:**  
Crear `PrimeCostStackCard` para visualizar la anatomía del costo de cada una de las 3 a 15 sucursales mediante barras apiladas (Alimentos % + Mano de Obra %) frente al umbral de viabilidad del 60%, resaltando la tienda estrella y las tiendas con fuga de margen.

**Acceptance criteria:**
- [ ] Compara todas las sucursales ordenadas por su Prime Cost combinado (menor a mayor).
- [ ] Segmenta visualmente Food Cost % y Labor Cost % con colores semafóricos (<60% verde, 60-65% amarillo, >65% rojo).
- [ ] Resalta a la "Sucursal Benchmark" y a las sucursales con fugas de margen activas con desglose de causas (merma oculta, sobrecosto de nómina).

**Verification:**
- [ ] Tests unitarios: verificar cálculo proporcional de barras.
- [ ] Typecheck: `pnpm exec tsc --noEmit`

**Dependencies:** Task 1  
**Files likely touched:**
- `components/dashboard/executive/prime-cost-stack-card.tsx`  
**Estimated scope:** M (2 files)

#### Task 5: Cascada de EBITDA Operativo y Drawer de Auditoría P&L
**Description:**  
Crear `PnlExecutiveWaterfall` que muestra la cascada financiera consolidada de la red (Ventas -> COGS -> Margen Bruto -> Nómina -> Prime Margin -> Gastos de Tienda -> EBITDA Operativo) e incorpora un botón que abre `PnlBranchTable` dentro de un `Sheet` (Drawer) lateral sin abandonar la vista ejecutiva.

**Acceptance criteria:**
- [ ] Presenta la cascada financiera con porcentajes sobre venta y montos en MXN.
- [ ] Incluye botón `[Ver P&L Analítico Completo]` que abre el Drawer con la tabla comparativa por sucursal con procedencia del dato.
- [ ] Permite exportar el resumen a CSV para reuniones de consejo/socios.

**Verification:**
- [ ] Typecheck: `pnpm exec tsc --noEmit`
- [ ] Manual check: El Drawer se abre y cierra suavemente en desktop y tablet.

**Dependencies:** Task 4  
**Files likely touched:**
- `components/dashboard/executive/pnl-executive-waterfall.tsx`
- `components/dashboard/executive/pnl-audit-drawer.tsx`  
**Estimated scope:** M (2-3 files)

---

### Checkpoint 2: Análisis de Rentabilidad y Fugas Operativo
- [ ] La vista de Unit Economics (`?view=economics`) expone de inmediato el Prime Cost de la red sin necesidad de interpretar tablas contables complejas.
- [ ] La auditoría detallada de P&L queda disponible a un clic sin sobrecargar la pantalla principal.

---

### Phase 4: View 3 — Oxígeno & Flujo a 14 Días

#### Task 6: Proyector de Caja con Hitos Restauranteros Mexicanos
**Description:**  
Crear `CashRunwayCard` que integra la proyección de tesorería a 14 días destacando los hitos ineludibles de salida en México: Nómina quincenal (15/30), Cuotas IMSS/Infonavit (día 17), Proveedores Clave de perecederos y Rentas de locales comerciales, con indicador de punto de estrés (*Lowest Cash Point*).

**Acceptance criteria:**
- [ ] Destaca los eventos de salida por fecha, tipo e importe en MXN.
- [ ] Muestra el saldo mínimo proyectado en los próximos 14 días y alerta si roza el colchón de seguridad.
- [ ] Incorpora un simulador interactivo de postergación de pagos que recalcula el flujo proyectado sin alterar la base de datos.

**Verification:**
- [ ] Typecheck: `pnpm exec tsc --noEmit`
- [ ] Manual check: La gráfica y el calendario de obligaciones reflejan las fechas críticas correctamente.

**Dependencies:** Task 1  
**Files likely touched:**
- `components/dashboard/executive/cash-runway-card.tsx`
- `components/dashboard/executive/cash-flow-projection.tsx`  
**Estimated scope:** M (2 files)

---

### Phase 5: Orquestación, Polish & Validación

#### Task 7: Orquestación del Dashboard Ejecutivo (`app/dashboard/executive/page.tsx`)
**Description:**  
Reescribir `app/dashboard/executive/page.tsx` para integrar el `ExecutiveCockpitHeader` y orquestar las 3 vistas mediante Server Components, Suspense y lazy loading selectivo según el parámetro `?view=`.

**Acceptance criteria:**
- [ ] Carga con Server Components leyendo `companyId` de sesión y delegando a los componentes correspondientes.
- [ ] La vista `cockpit` renderiza `VitalSigns` + `DecisionDeck` + `CopilotCard`.
- [ ] La vista `economics` renderiza `VitalSigns` + `PrimeCostStack` + `PnlWaterfall`.
- [ ] La vista `liquidity` renderiza `VitalSigns` + `CashRunwayCard`.
- [ ] Skeleton individual por bloque para carga progresiva sin layout shift.

**Verification:**
- [ ] Build de producción: `pnpm run build`
- [ ] Typecheck: `pnpm exec tsc --noEmit`
- [ ] Manual check: Probar las 3 vistas en localhost:3000/dashboard/executive.

**Dependencies:** Tasks 1, 2, 3, 4, 5, 6  
**Files likely touched:**
- `app/dashboard/executive/page.tsx`  
**Estimated scope:** M (1-2 files)

#### Task 8: Verificación E2E y Pruebas Unitarias de Regresión
**Description:**  
Ejecutar la suite de pruebas unitarias de los servicios de consolidación ejecutiva (`cross-branch-service`, `executive-twin-engine`, `pnl-service`) y verificar que los componentes del dashboard cumplan con los principios de diseño de `PRODUCT.md` y `DESIGN.md`.

**Acceptance criteria:**
- [ ] Todas las pruebas unitarias pasan sin errores.
- [ ] `pnpm run build` compila con 0 errores de TypeScript y 0 warnings críticos.
- [ ] Verificación de accesibilidad y diseño responsivo en móvil, tablet y escritorio.

**Verification:**
- [ ] Tests pasan: `pnpm test:unit`
- [ ] Build exitoso: `pnpm run build`

**Dependencies:** Task 7  
**Files likely touched:**
- `lib/services/__tests__/executive-consolidation.test.ts`  
**Estimated scope:** S (1-2 files)

---

## 5. Checkpoint Final: Sistema Operativo Ejecutivo de Red Listo
- [ ] `/dashboard/executive` ofrece la vista panorámica de dirección para el dueño sin ruido ni sobrecarga operativa.
- [ ] Las decisiones críticas de caja, nómina y abasto se pueden autorizar o derivar en menos de 60 segundos.
- [ ] El Prime Cost y el EBITDA consolidado están al frente del análisis de rentabilidad.
