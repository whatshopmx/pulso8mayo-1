# Implementation Plan: IMSS Compliance Section Remediation

## Overview
The IMSS compliance section scored **16/40** on the Impeccable critique. It is functional but bland: ad-hoc summary cards ignore MetricCard, Unicode glyphs impersonate checkboxes, strings mix English/Spanish, the Reports page duplicates generation UIs from sub-pages, and there is no wayfinding between sub-pages. This plan addresses all three P1 issues and both P2 issues plus the minor observations flagged in the critique.

## Architecture Decisions
1. **MetricGrid + MetricCard everywhere.** Replace all hand-rolled `Card > CardHeader > CardContent > text-2xl font-bold text-orange-600` mini-summary cards on altas, bajas, sua, and reports sub-pages with the canonical `MetricCard` component. Use semantic `tone` props (`warning`, `success`, `destructive`, `info`) instead of raw Tailwind colors.
2. **Checkbox component for selection.** Replace all `"✓"/"○"` Button ghost hacks with the existing shadcn `Checkbox` component from `components/ui/checkbox.tsx`. Wire `checked`/`onCheckedChange` and add `aria-label`.
3. **Reports page becomes history-only.** Remove the "Generar Archivos" tab entirely — all generation UIs already exist on their dedicated sub-pages (Altas, Bajas, SUA). Keep Reports as a pure audit-log/history view. Add cross-links from sub-pages to Reports.
4. **Breadcrumb labels + IMSS sub-nav.** Add missing `altas`, `bajas`, `sua` entries to `BreadcrumbDynamic` PATH_LABELS. Create a shared `ImssSubNav` component that renders a horizontal tab-style nav bar across all IMSS sub-pages.
5. **Spanish-only copy.** Audit and fix every English fragment: `terminated(s)`, `salary`, `Desregistro`, `Pasaron deadline`, `Ingresa al menos un salary`.
6. **Minor hardening.** Name the magic salary constant, fix `toggleAll` inconsistency on bajas, add `role="alert"` to Alert banners, replace color-only row highlights with a non-color indicator.

## Task List

### Phase 1: Design System Alignment (MetricCard + Checkbox)

- [x] **Task 1**: Replace hand-rolled summary cards with MetricCard on Altas page
- [x] **Task 2**: Replace hand-rolled summary cards with MetricCard on Bajas page
- [x] **Task 3**: Replace hand-rolled summary cards with MetricCard on Reports page
- [x] **Task 4**: Replace Unicode glyph checkboxes with `Checkbox` component on Altas page
- [x] **Task 5**: Replace Unicode glyph checkboxes with `Checkbox` component on Bajas page

### Checkpoint: Design System
- [x] All sub-pages use MetricCard with semantic tone props — no raw Tailwind color classes
- [x] All checkboxes are real `<Checkbox>` with `aria-label`
- [ ] `pnpm run build` is clean — no verificado (Google Fonts sin red); `npx tsc --noEmit` limpio

---

### Phase 2: i18n + Copy Cleanup

- [x] **Task 6**: Fix all English fragments across IMSS files

### Checkpoint: i18n
- [x] Every visible string in the IMSS directory is proper es-MX Spanish

---

### Phase 3: Navigation + Wayfinding

- [x] **Task 7**: Add breadcrumb labels and IMSS sub-navigation

### Checkpoint: Navigation
- [x] Breadcrumbs render correctly on all sub-pages
- [x] Sub-nav highlights the active page

---

### Phase 4: Reports Page Simplification + Cross-links

- [x] **Task 8**: Remove "Generar Archivos" tab from Reports; add cross-links from sub-pages

### Checkpoint: Reports
- [x] Reports page shows only history/audit tab
- [x] Each sub-page has a "Ver historial" link to Reports

---

### Phase 5: Minor Hardening

- [x] **Task 9**: Fix toggleAll inconsistency, magic salary constant, accessibility attributes

### Checkpoint: Complete
- [ ] `pnpm run build` is clean — no verificado (Google Fonts sin red); `npx tsc --noEmit` limpio
- [x] All critique P1 and P2 issues addressed

---

## Task Details

### Task 1: Replace hand-rolled summary cards with MetricCard on Altas page

**Description:** Replace the three inline `Card > text-2xl font-bold text-orange-600` summary cards (Pendientes, Listos, Vencidos) with `MetricGrid columns={3}` + `MetricCard` using proper `tone` props.

**Acceptance criteria:**
- [x] Three MetricCards render with tones: `warning` (Pendientes), `success` (Listos), `destructive` (Vencidos)
- [x] No raw Tailwind color classes like `text-orange-600`, `text-green-600`, `text-red-600`

**Verification:**
- [x] Visual check in browser
- [ ] `pnpm run build` succeeds — no verificado (Google Fonts sin red); `npx tsc --noEmit` limpio

**Dependencies:** None

**Files likely touched:**
- `app/dashboard/compliance/imss/altas/page.tsx`

**Estimated scope:** XS (1 file)

---

### Task 2: Replace hand-rolled summary cards with MetricCard on Bajas page

**Description:** Same transformation as Task 1 but for the Bajas page. Additionally, unify the "Listos" badge color — currently blue on Bajas vs. green on Altas. Both should use `success` tone.

**Acceptance criteria:**
- [x] Three MetricCards with tones: `warning`, `success`, `destructive`
- [x] "Listo" badge uses `success` tone (green) on both Altas and Bajas
- [x] No raw Tailwind color classes

**Verification:**
- [x] Visual comparison of Altas and Bajas summary cards — consistent colors

**Dependencies:** None (parallel with Task 1)

**Files likely touched:**
- `app/dashboard/compliance/imss/bajas/page.tsx`

**Estimated scope:** XS (1 file)

---

### Task 3: Replace hand-rolled summary cards with MetricCard on Reports page

**Description:** Replace the four inline summary cards on the Reports page with `MetricGrid columns={4}` + `MetricCard`. Move the disconnected icons from `CardHeader` into the MetricCard `icon` slot.

**Acceptance criteria:**
- [x] Four MetricCards with proper icons in tonal icon boxes
- [x] Compliance rate card uses semantic tone (success/warning/destructive)
- [x] No raw Tailwind color classes like `text-green-500`, `text-yellow-500`, `text-red-500`

**Verification:**
- [x] Visual check

**Dependencies:** None (parallel with Tasks 1-2)

**Files likely touched:**
- `app/dashboard/compliance/imss/reports/page.tsx`

**Estimated scope:** XS (1 file)

---

### Task 4: Replace Unicode glyph checkboxes with `Checkbox` on Altas page

**Description:** Replace `Button variant="ghost"` with `"✓"/"○"` text in the selection column (header toggle-all and per-row) with the shadcn `Checkbox` component. Wire `checked`/`onCheckedChange` to existing selection state.

**Acceptance criteria:**
- [x] Header uses `Checkbox` with `aria-label="Seleccionar todos"` and indeterminate state when partially selected
- [x] Each row uses `Checkbox` with `aria-label="Seleccionar [nombre]"`, disabled when status ≠ READY
- [x] No Unicode `✓` or `○` characters remain
- [x] `bg-green-50/50` row highlight replaced with a non-color-only indicator (left border or icon)

**Verification:**
- [x] Keyboard toggle (Space) works on checkboxes
- [x] Screen reader announces "checkbox, checked/unchecked"

**Dependencies:** None

**Files likely touched:**
- `app/dashboard/compliance/imss/altas/page.tsx`

**Estimated scope:** S (1 file)

---

### Task 5: Replace Unicode glyph checkboxes with `Checkbox` on Bajas page

**Description:** Same transformation as Task 4 for the Bajas page.

**Acceptance criteria:**
- [x] Header and row checkboxes use shadcn `Checkbox`
- [x] Proper `aria-label` on each checkbox
- [x] No Unicode `✓`/`○` characters

**Verification:**
- [x] Keyboard and screen reader check

**Dependencies:** None (parallel with Task 4)

**Files likely touched:**
- `app/dashboard/compliance/imss/bajas/page.tsx`

**Estimated scope:** S (1 file)

---

### Task 6: Fix all English fragments across IMSS files

**Description:** Audit every string in the IMSS directory and fix English fragments and non-standard Spanish.

| Current | Fix |
|---------|-----|
| `terminated(s)` (bajas:181) | `dado(s) de baja` |
| `salary nuevo` (sua:220) | `salario nuevo` |
| `salary` (sua:72) | `salario` |
| `Ingresa al menos un salary` (sua:72) | `Ingresa al menos un salario` |
| `Desregistro` (bajas:134, main:167) | `Baja` / `Aviso de baja` |
| `Pasaron deadline` (altas:176, bajas:171) | `Plazo vencido` |
| IDSE code `08`/`02`/`07` shown raw | Add contextual labels: `08 (Alta)`, `02 (Baja)`, `07 (Mod. Salarial)` |

**Acceptance criteria:**
- [x] Zero English fragments in user-facing strings
- [x] `Desregistro` replaced with `Baja` everywhere
- [x] IDSE codes always shown with Spanish label

**Verification:**
- [x] `grep -rn "salary\|terminated\|Desregistro\|deadline" app/dashboard/compliance/imss/`

**Dependencies:** None

**Files likely touched:**
- `app/dashboard/compliance/imss/altas/page.tsx`
- `app/dashboard/compliance/imss/bajas/page.tsx`
- `app/dashboard/compliance/imss/sua/page.tsx`
- `app/dashboard/compliance/imss/page.tsx`

**Estimated scope:** S (4 files, string changes only)

---

### Task 7: Add breadcrumb labels and IMSS sub-navigation

**Description:** Add missing `altas: "Altas"`, `bajas: "Bajas"`, `sua: "SUA"` entries to `BreadcrumbDynamic`'s `PATH_LABELS`. Create a shared `ImssSubNav` component (horizontal link tabs: Altas | Bajas | SUA | Reportes) and add it below `PageHeader` on each IMSS sub-page.

**Acceptance criteria:**
- [x] Breadcrumbs show `Dashboard > Cumplimiento > IMSS > Altas` (etc.) on every sub-page
- [x] Sub-nav renders on all four sub-pages, highlighting the active link
- [x] Clicking a sub-nav link navigates without full page reload (Next.js Link)

**Verification:**
- [x] Navigate between all IMSS sub-pages using sub-nav
- [ ] `pnpm run build` succeeds — no verificado (Google Fonts sin red); `npx tsc --noEmit` limpio

**Dependencies:** None

**Files likely touched:**
- `components/shared/breadcrumb-dynamic.tsx`
- `components/compliance/imss-sub-nav.tsx` [NEW]
- `app/dashboard/compliance/imss/altas/page.tsx`
- `app/dashboard/compliance/imss/bajas/page.tsx`
- `app/dashboard/compliance/imss/sua/page.tsx`
- `app/dashboard/compliance/imss/reports/page.tsx`

**Estimated scope:** M (6 files)

---

### Task 8: Remove "Generar Archivos" tab from Reports; add cross-links

**Description:** Strip the "Generar Archivos" tab and its duplicate generation UIs from the Reports page. Default to the history table. Remove the `handleGenerateIdse` and `handleGenerateSUA` functions. Add a "Ver historial de archivos" link at the bottom of each sub-page (Altas, Bajas, SUA).

**Acceptance criteria:**
- [x] Reports page shows only history table (no generation buttons)
- [x] `Tabs`/`TabsList` removed — page is a single-view
- [x] Each sub-page has a "Ver historial →" link to `/dashboard/compliance/imss/reports`

**Verification:**
- [x] Reports page loads without generation UI
- [x] Cross-links navigate correctly
- [ ] `pnpm run build` succeeds — no verificado (Google Fonts sin red); `npx tsc --noEmit` limpio

**Dependencies:** Task 7 (sub-nav already present)

**Files likely touched:**
- `app/dashboard/compliance/imss/reports/page.tsx`
- `app/dashboard/compliance/imss/altas/page.tsx`
- `app/dashboard/compliance/imss/bajas/page.tsx`
- `app/dashboard/compliance/imss/sua/page.tsx`

**Estimated scope:** M (4 files)

---

### Task 9: Fix toggleAll inconsistency, magic salary constant, accessibility

**Description:** Bundle remaining minor fixes:
1. Bajas `toggleAll` selects READY + PENDING — change to select only READY (matching Altas behavior) to prevent selecting employees without NSS for IDSE generation.
2. SUA `getDefaultSalary` fallback `300` → named constant `IMSS_MIN_SALARY_DEFAULT = 300`.
3. Add `role="alert"` to Alert banners on altas/bajas/sua pages.
4. Replace `bg-green-50/50` color-only row highlight on Altas with a left border indicator (`border-l-2 border-success`).

**Acceptance criteria:**
- [x] Bajas `toggleAll` selects only READY employees
- [x] Magic `300` replaced with named constant
- [x] Alert banners have `role="alert"`
- [x] Row highlight uses border, not background color alone

**Verification:**
- [x] Toggle-all on Bajas matches Altas behavior
- [ ] `pnpm run build` succeeds — no verificado (Google Fonts sin red); `npx tsc --noEmit` limpio

**Dependencies:** Tasks 4-5 (checkboxes already in place)

**Files likely touched:**
- `app/dashboard/compliance/imss/bajas/page.tsx`
- `app/dashboard/compliance/imss/sua/page.tsx`
- `app/dashboard/compliance/imss/altas/page.tsx`

**Estimated scope:** S (3 files)

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| MetricCard import paths or missing `MetricGrid` re-export | Low | Already verified: `MetricGrid` and `MetricCard` are both exported from `components/ui/metric-card.tsx` and used on the main IMSS page |
| Checkbox indeterminate state not supported by shadcn primitive | Low | Radix Checkbox supports `checked="indeterminate"` natively |
| Reports page data currently comes from altas/bajas APIs, not a dedicated history API | Medium | Keep the existing fetch logic for history — only strip generation UI. The data flow is unchanged. |
| Sub-nav adds repeated JSX to each page | Low | Extract into a shared component (`ImssSubNav`) to keep DRY |

## Verification Plan

### Automated Tests
- `pnpm run build` after each phase checkpoint

### Manual Verification
- Visual comparison of MetricCards across all IMSS sub-pages
- Keyboard navigation through checkboxes on Altas/Bajas
- Navigate full IMSS flow via sub-nav without browser back button
- `grep` for remaining English fragments

## Open Questions — RESUELTO

> [!IMPORTANT]
> **IDSE Modificación Salarial (code "07") on Reports** — Decisión: **opción A**, se eliminó por completo. La página SUA ya cubre los cambios salariales; mantener un flujo IDSE "07" paralelo generaba confusión.
> Consecuencia: el endpoint `/api/imss/idse-generate` ya no recibe `movementType: "07"` desde ninguna UI. Si el código 07 sigue siendo necesario, hay que darle una sub-página propia con selección de empleados.
