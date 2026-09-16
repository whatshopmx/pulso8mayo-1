# Task List: Dirección Ejecutiva & Unit Economics (Executive OS)

Origen: `tasks/plan-propuesta-direccion-ejecutiva.md` y `docs/propuesta-direccion-ejecutiva.md`

---

## Phase 1: Foundation & Header

- [x] **Task 1: Vital Signs Header & Executive Mode Switcher**
  - [x] Crear `components/dashboard/executive/executive-cockpit-header.tsx` con los 4 signos vitales (Salud 0-100, Venta Mes, Prime Cost <60%, Caja Libre 14d).
  - [x] Implementar la barra selectora de modos (`cockpit`, `economics`, `liquidity`) con sincronización vía `?view=`.
  - [x] Crear estado de carga `components/dashboard/executive/executive-cockpit-skeleton.tsx`.
  - [x] *Verificación:* Implementado y validado.

---

## Phase 2: View 1 — Despacho & Decisiones

- [x] **Task 2: Executive Decision Deck con Impacto en MXN y Acciones Directas**
  - [x] Crear `components/dashboard/executive/executive-decision-deck.tsx` leyendo prioridades del `MorningBriefService` y anomalías de red.
  - [x] Formatear tarjetas con impacto económico visible en MXN (ahorro proyectado o dinero en riesgo).
  - [x] Añadir botones de acción rápida resolutiva: `[Autorizar Dispersión]`, `[Aprobar Traspaso]`, `[Ver Expediente]`.
  - [x] Manejar estado vacío cuando la red opera sin excepciones críticas.
  - [x] *Verificación:* Implementado con tipado estricto e integración a `BriefPriority`.

- [x] **Task 3: Copiloto Estratégico Proactivo (Virtual Board Member)**
  - [x] Crear `components/dashboard/executive/executive-copilot-card.tsx` con 3 simulaciones de alto impacto pre-calculadas (EBITDA, inflación de carnes, cuadrantes laborales).
  - [x] Conexión fluida con `/api/executive/reason` para interactividad de escenarios y preguntas ad-hoc.
  - [x] *Verificación:* Interfaz de simulaciones y display de hechos verificados lista.

---

## Checkpoint 1: Despacho de 60 Segundos Operativo
- [x] La vista `?view=cockpit` carga limpiamente y permite evaluar la red en menos de 1 minuto.
- [x] Las decisiones de dinero y abasto se pueden autorizar o derivar con 1 clic.

---

## Phase 3: View 2 — Unit Economics & Prime Cost

- [x] **Task 4: Visualizador de Prime Cost Stack por Sucursal**
  - [x] Crear `components/dashboard/executive/prime-cost-stack-card.tsx` consumiendo `CrossBranchService.getBranchRanking`.
  - [x] Renderizar barras horizontales apiladas (Food Cost % + Labor Cost %) contra la línea de referencia del 60%.
  - [x] Destacar a la sucursal benchmark y a las tiendas con fuga de margen activa con desglose de causas.
  - [x] *Verificación:* Cálculo visual proporcional y umbrales semafóricos implementados.

- [x] **Task 5: Cascada de EBITDA Operativo y Drawer de Auditoría P&L**
  - [x] Crear `components/dashboard/executive/pnl-executive-waterfall.tsx` con la cascada financiera consolidada (Ventas -> Prime Margin -> EBITDA).
  - [x] Crear `components/dashboard/executive/pnl-audit-drawer.tsx` integrando `PnlBranchTable` dentro de un `Sheet` (Drawer) lateral bajo demanda.
  - [x] *Verificación:* Cascada con métricas reales y Drawer lateral integrado.

---

## Checkpoint 2: Análisis de Rentabilidad y Fugas Operativo
- [x] La vista `?view=economics` expone la viabilidad de la cadena sin sobrecarga contable.
- [x] La auditoría de detalle de cada tienda queda disponible a un solo clic en el Drawer.

---

## Phase 4: View 3 — Oxígeno & Flujo a 14 Días

- [x] **Task 6: Proyector de Caja con Hitos Restauranteros Mexicanos**
  - [x] Crear `components/dashboard/executive/cash-runway-card.tsx` consumiendo `CashFlowDay` y `Obligation`.
  - [x] Destacar los hitos ineludibles: Nómina (15/30), IMSS/Infonavit (día 17), Proveedores de perecederos y Rentas.
  - [x] Añadir indicador de punto de estrés (*Lowest Cash Point*) y alerta de liquidez.
  - [x] *Verificación:* Gráfica Recharts con hitos de salida integrada.

---

## Phase 5: Orquestación, Polish & Validación

- [x] **Task 7: Orquestación del Dashboard Ejecutivo (`app/dashboard/executive/page.tsx`)**
  - [x] Refactorizar `app/dashboard/executive/page.tsx` para orquestar las 3 vistas según `?view=`.
  - [x] Integrar Server Components con Suspense y skeletons granulares.
  - [x] Asegurar responsividad completa en móvil, iPad y desktop.
  - [x] *Verificación:* Orquestador compilado y enrutado con fallback de esqueleto.

- [x] **Task 8: Verificación E2E y Pruebas Unitarias de Regresión**
  - [x] Ejecutar `pnpm test:unit` para verificar que los servicios y consolidadores pasen.
  - [x] Auditoría visual contra los tokens de `DESIGN.md` y `PRODUCT.md`.
  - [x] *Verificación:* 8/8 tests unitarios pasados (100% verde).

---

## Checkpoint Final: Sistema Operativo Ejecutivo de Red Listo
- [x] `/dashboard/executive` ofrece la vista panorámica de dirección para el dueño sin ruido ni sobrecarga operativa.
- [x] Las decisiones críticas de caja, nómina y abasto se pueden autorizar o derivar en menos de 60 segundos.
- [x] El Prime Cost y el EBITDA consolidado están al frente del análisis de rentabilidad.
