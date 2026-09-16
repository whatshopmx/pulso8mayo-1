# Plan de Implementación: Dirección Ejecutiva & Unit Economics (Executive OS)

> Documento espejo y referencia de ingeniería para `docs/propuesta-direccion-ejecutiva.md`.  
> Para el desglose de tareas atómicas y estado de avance, consultar [`tasks/todo-propuesta-direccion-ejecutiva.md`](../tasks/todo-propuesta-direccion-ejecutiva.md) y [`tasks/plan-propuesta-direccion-ejecutiva.md`](../tasks/plan-propuesta-direccion-ejecutiva.md).

---

## Resumen de Fases y Tareas

### Fase 1: Cabecera & Selector de Modos de Decisión
- **Tarea 1:** `ExecutiveCockpitHeader` (Vital Signs Bar: Salud 0-100, Venta Mes, Prime Cost <60%, Caja Libre 14d + selector `?view=cockpit|economics|liquidity`).

### Fase 2: Vista 1 — Despacho & Decisiones
- **Tarea 2:** `ExecutiveDecisionDeck` (Tarjetas de acción rápida con impacto en MXN: nómina, arbitraje de abasto y alertas de dinero).
- **Tarea 3:** `ExecutiveCopilotCard` (Simulaciones estratégicas proactivas de EBITDA y mitigación de inflación).

### Fase 3: Vista 2 — Unit Economics & Prime Cost
- **Tarea 4:** `PrimeCostStackCard` (Comparador visual de Alimentos % + Mano de Obra % vs umbral de 60% por sucursal).
- **Tarea 5:** `PnlExecutiveWaterfall` + `PnlAuditDrawer` (Cascada financiera consolidada + Drawer lateral bajo demanda con `PnlBranchTable`).

### Fase 4: Vista 3 — Oxígeno & Flujo 14D
- **Tarea 6:** `CashRunwayCard` (Calendario de compromisos ineludibles: Nómina 15/30, IMSS día 17, Proveedores de perecederos y Rentas + test de estrés de caja).

### Fase 5: Orquestación & Verificación
- **Tarea 7:** Orquestación en `app/dashboard/executive/page.tsx` con Server Components y Suspense.
- **Tarea 8:** Verificación con pruebas unitarias (`pnpm test:unit`) y build (`pnpm run build`).
