# Implementation Plan: Finance & Sales Critique Resolution

## Overview

Resuelve los 7 hallazgos del critique de `app/dashboard/finance/*` y `app/dashboard/sales/*` (2026-08-04, score 27/40). Tres frentes ordenados por dependencia: integridad de datos (bloqueante), rediseño de Cash Flow (prioridad del usuario), y calidad/pulido (tooltips, badges, iconos, filtros). No se toca backend — todas las tareas son frontend.

## Architecture Decisions

- **Food Cost / Labor Cost se eliminan del KPI card, no se integran.** El backend (`sales-analytics-service.ts`) no expone estos ratios ni tiene datos de costo de inventario o nómina para calcularlos. Mostrar placeholders es peor que no mostrar nada. Si en el futuro se integran, será una feature aparte con su propia tarea de backend.
- **Cash Flow se rediseña como panel de alerta temprana, no como grilla de calendario.** El usuario validó que la página actual no es práctica. El nuevo diseño responde 3 preguntas: ¿me alcanza? ¿qué día me preocupo? ¿por qué?
- **Los tooltips usan el atributo `title` nativo + un ícono `?` sutil.** No se agrega una dependencia de tooltip library para 4-5 labels. Si en el futuro se necesita un sistema de tooltips, se extrae a componente.
- **Las variantes de badge se consolidan con un helper `statusBadgeClasses()` en `lib/utils.ts`.** No se modifica la API del componente Badge (ya tiene variantes `default`, `secondary`, `destructive`, `outline`, `warning`, `success`); el helper produce las clases compuestas que las páginas ya usan pero desde un solo lugar.

## Task List

### Fase 1: Integridad de Datos (bloqueante)

- [ ] Task 1: Eliminar KPIs falsos de FinancialKpiCards

### Checkpoint: Integridad
- [ ] Los KPI cards solo muestran datos que vienen del backend
- [ ] Build limpio, sin errores de tipo

### Fase 2: Rediseño Cash Flow

- [ ] Task 2: Reescribir CashFlowCalendar como panel de alerta temprana
- [ ] Task 3: Ajustar layout de la página Cash Flow

### Checkpoint: Cash Flow
- [ ] La página responde "¿me alcanza?" y "¿qué día me preocupo?" en el primer vistazo
- [ ] Sin regresión en datos (misma API, mismo fetch)

### Fase 3: Calidad y Pulido

- [ ] Task 4: Agregar tooltips de ayuda contextual en Sales
- [ ] Task 5: Consolidar variantes de badge en un helper
- [ ] Task 6: Agregar presets de fecha en filtros de Sales

### Checkpoint: Complete
- [ ] Los 7 hallazgos del critique están resueltos
- [ ] Build limpio
- [ ] Re-run `$impeccable critique app/dashboard/finance app/dashboard/sales` para verificar mejora de score

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| La API de cash flow no devuelve detalle de egresos por día (solo `outflowItemsCount`) | Medium | La lista de días críticos muestra el conteo y monto total; se deja espacio visual para detalle futuro |
| Recharts no exporta a CSV nativamente | Low | El botón de exportar genera el CSV desde `projection` en memoria con `Blob` + `URL.createObjectURL` |
| El branch scope del sidebar interfiere con el branch selector local de cada página | Low | Esta tarea NO está en el plan (requiere coordinar con el sistema de tenant context). Se deja como follow-up |

## Open Questions

- ¿La API de cash flow debe devolver detalle de egresos por día (lista de gastos con nombres)? Si sí, se crea una tarea de backend aparte.
- ¿El unified financial overview (dashboard widget) entra en este plan o es una iniciativa separada? El critique lo menciona como pregunta abierta, no como P1.
