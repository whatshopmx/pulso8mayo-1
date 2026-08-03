# Implementation Plan: Rediseño de Cumplimiento — Semáforo / Reportes / Registros

> **Fuente:** `plans/compliance-redesign-plan.md` (decisiones D1–D5 ya resueltas — este documento NO las reabre).
> Baseline del critique: `.impeccable/critique/2026-07-28T23-06-29Z__app-dashboard-compliance.md` — **18/40**, 0 P0, 4 P1, 1 P2.
> **Meta: ≥28/40** (banda "Good"); heurísticas 4 (Consistencia) y 6 (Reconocimiento) de 1 → ≥3.
> Task list ejecutable: `tasks/compliance/todo.md`.

## Overview

Reorganizar la superficie de cumplimiento en tres destinos por intención de usuario (Semáforo / Reportes / Registros), eliminar toda UI muerta y datos falsos, consolidar el color semántico en un `<RateBadge />` único, unificar el idioma a ES-MX, y aplanar la navegación de 3 capas de tabs a máximo 2. Seis fases ordenadas: **Trust → Color → Idioma → IA → Layout → Verificación**.

## Architecture Decisions (heredadas del plan fuente)

- **D1 — Tres destinos, no siete tabs.** Semáforo = leer + actuar. Reportes = generar + descargar (los selectores sucursal/período viven ahí). Registros = altas/cfdis/horarios al corriente. Si Semáforo empieza a exportar PDFs, la línea se borró.
- **D2 — Verdad numérica.** Ningún número sin query detrás; sin fuente → "Sin datos" + CTA, jamás placeholder.
- **D3 — Color en 3 capas.** Variant `success` en Badge → `<RateBadge />` dueño único de umbrales → sweep de hardcoded utilities. Sin capa 2, la capa 3 se revierte en dos sprints.
- **D4 — Info tab → Expediente de Auditoría.** "Si COFEPRIS llega hoy a las 6pm, ¿qué le presento?"
- **D5 — IMSS una sola casa.** Los generadores SUA/IDSE (funcionan) se mudan a `registros/imss`; el tab IMSS de la página principal se elimina.

## Verificado contra el codebase (2026-07-28)

| Afirmación del plan | Verificación | Resultado |
|---|---|---|
| ~176 utilidades hardcodeadas | `grep -c` | **161 reales** — mismo sweep |
| 13 rutas huérfanas | grep de inbound links | **5 con cero links** (`imss/reports`, `overtime`, `schedules`, `expediente`, `breaks`); el resto solo enlazadas desde los stub tabs que Fase 0 elimina |
| Token `success` OKLCH existe | `app/globals.css` | ✅ `--success` + `--success-foreground` en light y dark — solo falta el variant en Badge |
| Umbrales duplicados en 4 archivos | `grep ">= 90"` | **3 archivos** (dashboard, corporate-grid, nom251). `psychosocial-dashboard` usa switches de riesgo NOM-035 (MUY_ALTO/ALTO/…), no umbrales de rate → va en el sweep de color, no en adopción de RateBadge |
| Sidebar | `components/app-sidebar.tsx:226` | Confirmado: Dashboard/Auditoría/Reportes/Constructor/Verificaciones AI |

## Task List (resumen — detalle en `todo.md`)

### Fase 0 — Trust breakers (T1–T6, ~1 sesión)
Nada en pantalla puede mentir o ser callejón sin salida.

### Checkpoint: Trust
- [ ] Cero botones permanentemente deshabilitados sin ruta de activación
- [ ] Cero números sin fuente de datos
- [ ] Envío WA reporta el resultado real de la API
- [ ] `pnpm run build` limpio

### Fase 1 — Color semántico (T7–T10)
Variant `success` → `<RateBadge />` → sweep a tokens.

### Checkpoint: Color
- [ ] `grep -c "(text|bg|border)-(green|yellow|red|orange)-[0-9]"` ≈ 0 en compliance
- [ ] `grep -rln ">= 90" components/compliance/` → solo `rate-badge.tsx`
- [ ] Rojo Operacional solo en acciones de marca (≤10-15% de pantalla)

### Fase 2 — Un idioma (T11–T13)
ES-MX en UI y PDFs; empty states con acción; errores visibles.

### Checkpoint: Idioma
- [ ] Cero strings en inglés en UI y PDFs (excepción: SUA/IDSE/IMSS/COFEPRIS)

### Fase 3 — IA: tres destinos (T14–T19)
Rutas nuevas, generadores movidos, huérfanas rehogadas con redirects 308, sidebar, Expediente.

### Checkpoint: IA
- [ ] Toda página de compliance alcanzable en ≤2 clicks desde sidebar
- [ ] Cero rutas huérfanas (grep de verificación)
- [ ] Redirects permanentes de rutas viejas funcionando

### Fase 4 — Flatten + contexto único (T20–T23)
Máximo 2 capas de navegación; ningún selector visible que no afecte al contenido visible.

### Fase 5 — Verificación (T24–T25)
Polish a11y + re-critique contra meta 28/40.

### Checkpoint: Complete
- [ ] Todas las verificaciones continuas en verde (sección 4 del plan fuente)
- [ ] Re-critique ≥28/40, heurísticas 4 y 6 ≥3
- [ ] Review con humano antes de cerrar

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Bookmarks/links WA a rutas viejas `/compliance/imss/*` | High | `redirect()` permanente en páginas viejas durante ≥1 release (T16) |
| Sweep de color sin RateBadge se revierte | Med | Orden forzado: T7→T8→T9→T10; verificación grep en checkpoint |
| Mover UI muerta a rutas nuevas esconde la basura | Med | Fase 3 bloqueada hasta cerrar Fase 0 (regla del plan fuente) |
| Fase 4 toca `layout.tsx` o filtro del header — colisiona con el plan activo `tasks/plan.md` (Dashboard Consistency Pass, AD-1 BranchScopeControl) | High | **Coordinar antes de T21:** si el BranchScopeControl del otro plan ya existe, adoptarlo en vez de construir uno paralelo |
| `pnpm run build` strict:false puede esconder roturas de tipos en moves | Low | Build limpio como gate en cada checkpoint |

## Open Questions

- **Q1:** ¿El plan Dashboard Consistency Pass (`tasks/plan.md`) ya implementó `BranchScopeControl` en el layout header? T21 depende de esa respuesta — si sí, Semáforo solo consume; si no, se decide cuál plan aterriza primero el contexto de filtro.
- **Q2:** ¿Redirects 308 permanentes desde el día 1, o páginas viejas con banner "esta página se mudó" durante un release? (El plan fuente dice redirect ≥1 release; asumo redirect inmediato salvo objeción.)
- **Q3:** `PayrollExport` recibe `branchId` como `companyId` (T22) — ¿el fix es corregir el prop en el call site o renombrar el prop en el componente? Revisar contrato de la API antes de tocar.
