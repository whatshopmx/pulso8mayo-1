# TODO — Crítica de Cumplimiento (compliance section remediation)

> Plan: `tasks/plan-compliance-critique.md` · Crítica: `.impeccable/critique/2026-08-10T21-33-26Z__app-dashboard-compliance.md` (19/40 → meta ≥32/40)
> Alcance: remediación de superficie de `app/dashboard/compliance/` + `components/compliance/`. No toca API, `templates/`, `lib/inngest/` ni el motor de workflows. No rediseña IA.

---

## Phase 1: Foundation — un solo rate→color (P1 #1, P3 #7)

- [x] **Task 1 (M): Módulo canónico de compliance-rate + sweep de consumo**
  - `components/compliance/rate-badge.tsx` (dueño único documentado): exportar además de `getRateTier` (ya existe): `getRateBadgeVariant(tier)` (mover `TIER_VARIANT` a export), `getRateColor(tier)` → OKLCH para charts/dots/progress (success `oklch(0.60 0.16 150)`, warning `oklch(0.72 0.15 80)`, destructive `oklch(0.50 0.22 22)` — mismos valores de DESIGN.md), `getRateClasses(tier)` → clases Tailwind semánticas para texto/badge de tabla/dot (high → `text-success bg-success/10 border-success/20`, mid → `text-warning-text bg-warning/10 border-warning/20`, low → `text-destructive bg-destructive/10 border-destructive/20`), y `getRateProgressClasses(tier)` para fill de progress bars
  - `components/compliance/compliance-dashboard.tsx`: badge de Scorecards (hoy `variant={rate >= 90 ? "default" : ...}`) → `RateBadge`/`getRateBadgeVariant`; tab "Por Sucursal" badge + progress `bg-green-500/bg-yellow-500/bg-red-500` + texto `text-green-700/text-yellow-700/text-red-600` → helpers compartidos. **Un 98% debe renderizar success/green** igual que en la grid corporativa
  - `components/compliance/corporate-compliance-grid.tsx`: borrar `getComplianceColor`/`getComplianceBg` locales → `getRateColor`/`getRateClasses`. Mismo commit: P3 #7 — `text-[10px]` ×2 ("Inactiva" y "(N Críticas)") → `text-xs`; tooltip chart `borderRadius: 8px` → `rounded-md`/token; quitar `boxShadow`
  - `components/compliance/nom251-report.tsx` (líneas 159-166 y 399-400): umbrales duplicados → `getRateTier`/`RateBadge`
  - **NO tocar** `psychosocial-dashboard.tsx` (escalas NOM-035 propias) ni equipment (sistémico, otra superficie)
  - **Verificación:** `rg ">= 90" components/compliance/` → solo `rate-badge.tsx`; `rg "variant=\{.*>= 90"` → 0; `pnpm run build`
  - **Aceptación:** un mismo rate (p.ej. 98%) muestre el mismo color semántico en scorecard, "Por Sucursal" y grid corporativa

### ✅ Checkpoint Foundation
- [x] `pnpm run build` pasa
- [x] 0 usos de `variant="default"` para niveles de cumplimiento en la sección
- [x] Detector: 0 findings en `components/compliance/` (se cierran los 3 advisories)

## Phase 2: Reachability & dedupe (P1 #2)

- [x] **Task 2 (S): Sidebar — registrar rutas huérfanas**
  - `components/app-sidebar.tsx`, sección Cumplimiento: añadir `groupLabel: "Registros"` y links a IMSS → `/dashboard/compliance/imss`, SAT → `/dashboard/compliance/sat`, Expediente → `/dashboard/compliance/expediente`, Horarios → `/dashboard/compliance/schedules`, Nómina → `/dashboard/compliance/payroll`
  - Cobertura resultante: imss/altas·bajas·sua·reports y sat/validation·certificates alcanzables desde sus páginas madre (los botones imbricados ya existen); breaks/overtime se cubren vía redirect (T3)
  - **Verificación:** manual — cada subruta de `app/dashboard/compliance/**` es alcanzable desde sidebar o links de página madre

- [x] **Task 3 (M): Redirect breaks/overtime + hubs IMSS/Nómina**
  - **Antes de borrar:** `rg -n "compliance/(breaks|overtime)" lib/ templates/ lib/inngest/ app/api/` → verificar que ningún cron/notificación enlace a esas URLs
  - `app/dashboard/compliance/breaks/page.tsx` y `app/dashboard/compliance/overtime/page.tsx` → `redirect()` (next/navigation) a `/dashboard/labor/breaks` y `/dashboard/labor/overtime`; confirmar build; borrar los archivos en commit aparte
  - `app/dashboard/compliance/compliance-page-client.tsx`: tab IMSS deja de embeker SUA/IDSE → hub con link a `/dashboard/compliance/imss`; tab Nómina deja de embeker `PayrollExport` → hub con link a `/dashboard/compliance/payroll`; quitar imports
  - Borrar `components/compliance/imss/sua-generator.tsx` y `components/compliance/imss/idse-generator.tsx` (únicos consumidores: el tab raíz; `imss/sua/page.tsx` y `imss/reports/page.tsx` son las casas canónicas)
  - **Verificación:** `rg "SUAGenerator|IDSEGenerator"` → 0; `pnpm run build`; `pnpm run lint`
  - **Aceptación:** exactamente UNA implementación de breaks y UNA de overtime en el repo

### ✅ Checkpoint Reachability
- [x] Toda ruta bajo `app/dashboard/compliance/**` es alcanzable
- [x] IMSS alcanzable desde sidebar (ya no solo por URL de cron)
- [x] Build + lint limpios

## Phase 3: Trust — errores ≠ vacío + idioma (P2 #5, P1 #3)

- [x] **Task 4 (M): Estados tipados con retry**
  - `components/compliance/compliance-dashboard.tsx`: estado `{ status: 'loading' | 'error' | 'ready'; data }`; `!res.ok` → error (hoy cae silencioso a "No compliance data available"); reusar `components/shared/error-state.tsx` (tiene `onRetry` + `role="alert"`) y `toast.error`; distinguir "sin registros" (data con scorecards/branches vacíos) de "no cargó" (fetch falló)
  - `app/dashboard/compliance/imss/page.tsx` y `app/dashboard/compliance/sat/page.tsx`: fallo de fetch crítico → error state + retry; nunca "0%"/"Sin datos" por fallo de red
  - **Verificación:** manual — matar red → error view + toast; retry recupera; datos vacíos reales → empty state honesto
  - **Aceptación:** ningún fallo de API se renderiza como "0%" o "No compliance data available"

- [x] **Task 5 (M): Localización es-MX + PDF de marca**
  - `compliance-dashboard.tsx`: "Total Workflows"→"Total de Flujos", "Completed in period"→"Completados en el período", "Upcoming Deadlines"→"Próximos Vencimientos", "Next 30 days"→"Próximos 30 días", "critical"→"críticas", "Period"→"Período", "Last 30 days"/"Last 90 days"→"Últimos…", "No compliance data available", "No active alerts"→"Sin alertas activas", chart label "Compliance Rate"→"Tasa de Cumplimiento", eje X chart `en-US` → `es-MX`
  - `imss/page.tsx`: "Need IMSS registration"→"Requieren registro ante IMSS", "Need IMSS deregistration"→"Requieren baja ante IMSS"
  - PDF `exportToPDF`: título "Compliance Dashboard Report"→"Reporte de Cumplimiento"; headers Alert/Severity/Status/Workflow/Date→es; `fillColor: [59,130,246]` (azul off-brand) → Operational Red del token `--primary` (`oklch(0.52 0.17 25)`, convertir a RGB/hex para jsPDF); fechas es-MX consistentes
  - **Verificación:** `rg -n "Total Workflows|Upcoming Deadlines|No active alerts|Compliance Dashboard Report|Need IMSS|Last 30 days" app/dashboard/compliance components/compliance` → 0; `.toLocaleDateString("en-US")` → 0 en la sección
  - **Aceptación:** cero strings EN en la superficie; el texto del PDF es un documento presentable ante COFEPRIS/IMSS

### ✅ Checkpoint Trust
- [x] Matar la API de compliance → error view + toast, nunca "no data"
- [x] Cero inglés en la sección (grep verificado)
- [x] PDF con paleta de marca + headers es-MX

## Phase 4: Unificación de sistema de diseño (P1 #4, P2 #6, payroll scope)

- [x] **Task 6 (M): MetricCard/PageHeader + scope chip + fix payroll**
  - `imss/page.tsx`: 4 Cards hand-rolled → `MetricGrid columns={4}` + `MetricCard` (Empleados Activos neutral; Altas Pendientes warning; Bajas Pendientes destructive; Estado de Cumplimiento success con progress); eliminar `text-orange-600/text-red-600/text-green-600`
  - `sat/page.tsx`: 2 cards → `MetricGrid` (Validación RFC/CURP neutral con estado honesto "Sin datos" + CTA; Constancias Anuales neutral)
  - Sweep `text-3xl font-bold` → `PageHeader` (components/shared) en los 11 archivos restantes: imss, sat, schedules, expediente, payroll, imss/altas, imss/bajas, imss/reports, imss/sua, sat/validation, sat/certificates (breaks/overtime ya redirigidos en T3)
  - Scope chip: quitar el Select de sucursal inline de `ComplianceDashboard` (el header `BranchScopeControl` AD-1 manda); mostrar chip con `useBranch().selectedBranch` ("Sucursal: X" / "Todas las sucursales"); el perímetro `days` se mantiene en el Select
  - Payroll: con el hub de T3 desaparece `companyId={selectedBranchId || ''}`; si por algún motivo el PayrollExport quedara inline, pasar `companyId` real desde server component (`CompliancePage` ya tiene `session.user.companyId`)
  - **Verificación:** `rg "text-3xl font-bold" app/dashboard/compliance` → 0; `rg "text-(green|orange|red|blue)-600" app/dashboard/compliance components/compliance` → 0; `pnpm run build`
  - **Aceptación:** un solo mecanismo de scope (header AD-1) + chip visible; "which branch am I looking at?" se responde sin recordar

- [ ] **Task 7 (S): Aplanar tabs**
  - Con T3 + T6: raíz = 6 tabs pero IMSS/Nómina son hubs de 1 control; pila interna IMSS 5→2 tabs eliminada; control row del Dashboard = período + export (2 controles) + 5 sub-tabs
  - **Verificación:** primera pantalla del tab Dashboard expone ≤4 controles simultáneos
  - **Aceptación:** un owner que entra a revisar "una cosa" no re-decide 8 veces

### ✅ Checkpoint Unification
- [x] Sin KPI cards hand-rolled ni `text-3xl font-bold` en la sección (grep = 0)
- [x] Nómina nunca pasa `''` como companyId
- [x] Build + lint limpios

## Phase 5: Hardening (P3 #8)

- [x] **Task 8 (S): schedules — confirmación + a11y**
  - `app/dashboard/compliance/schedules/page.tsx`: `deleteTemplate` → `AlertDialog` de confirmación (`components/ui/alert-dialog.tsx` existe); botón `<Trash2>` → `aria-label="Eliminar plantilla"`; day-picker (Buttons como toggles) → `aria-pressed={formData.daysOfWeek.includes(i)}` (y anuncio "Día de la semana")
  - **Aceptación:** un tap no borra una plantilla sin confirmar; navegación solo-teclado identifica acciones y estados del picker

### ✅ Checkpoint Complete
- [x] 8/8 tareas con criterios cumplidos
- [x] `pnpm run build` + `pnpm run lint` limpios
- [x] Detector en `components/compliance/` → 0 findings
- [x] `PROJECT_CONTEXT.md` actualizado

## Riesgos clave (del plan)

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Redirect de `compliance/breaks|overtime` rompe bookmarks/URLs de cron | Med | Chequear `rg` en lib/templates/inngest/api ANTES de borrar; `redirect()` 302 conserva URLs viejas |
| SUA/IDSE inline con más consumidores de los vistos | Med | `rg "SUAGenerator|IDSEGenerator"` antes de borrar; `imss/reports` ya está canónica |
| `variant="default"` sistémico (equipment) | Low | Cambio acotado a la sección de compliance; no tocar otras superficies |
| Conversión OKLCH→RGB del token primario para jsPDF imprecisa | Low | Tomar el valor del tema (`--primary` en globals.css) y verificar contraste en el PDF generado |