# Todo List: IMSS Compliance Section Remediation

## Phase 1: Design System Alignment (MetricCard + Checkbox)

- [x] **Task 1**: Replace hand-rolled summary cards with MetricCard on Altas page
  - **Description**: Replace the three inline `Card > text-2xl font-bold text-orange-600` summary cards (Pendientes, Listos, Vencidos) with `MetricGrid columns={3}` + `MetricCard` using proper `tone` props.
  - **Acceptance criteria**:
    - [x] Three MetricCards with tones: `warning`, `success`, `destructive`
    - [x] No raw Tailwind color classes (`text-orange-600`, `text-green-600`, `text-red-600`)
  - **Verification**: Visual check + `pnpm run build`
  - **Files**: `app/dashboard/compliance/imss/altas/page.tsx`
  - **Scope**: XS

- [x] **Task 2**: Replace hand-rolled summary cards with MetricCard on Bajas page
  - **Description**: Same as Task 1 for Bajas. Unify "Listo" badge color to `success` (green).
  - **Acceptance criteria**:
    - [x] Three MetricCards with tones: `warning`, `success`, `destructive`
    - [x] "Listo" badge green on both Altas and Bajas
  - **Verification**: Visual comparison
  - **Files**: `app/dashboard/compliance/imss/bajas/page.tsx`
  - **Scope**: XS

- [x] **Task 3**: Replace hand-rolled summary cards with MetricCard on Reports page
  - **Description**: Replace four inline summary cards with `MetricGrid columns={4}` + `MetricCard`. Move icons into MetricCard `icon` slot.
  - **Acceptance criteria**:
    - [x] Four MetricCards with proper icons and semantic tones
    - [x] No raw Tailwind color classes
  - **Verification**: Visual check
  - **Files**: `app/dashboard/compliance/imss/reports/page.tsx`
  - **Scope**: XS

- [x] **Task 4**: Replace Unicode glyph checkboxes with `Checkbox` on Altas page
  - **Description**: Replace `"✓"/"○"` Button ghost with shadcn `Checkbox`. Add indeterminate state for header.
  - **Acceptance criteria**:
    - [x] Header `Checkbox` with `aria-label="Seleccionar todos"`, indeterminate when partial
    - [x] Row `Checkbox` with `aria-label="Seleccionar [nombre]"`, disabled ≠ READY
    - [x] No Unicode `✓`/`○`
    - [x] Row highlight uses border, not `bg-green-50/50`
  - **Verification**: Keyboard + screen reader check
  - **Files**: `app/dashboard/compliance/imss/altas/page.tsx`
  - **Scope**: S

- [x] **Task 5**: Replace Unicode glyph checkboxes with `Checkbox` on Bajas page
  - **Description**: Same as Task 4 for Bajas.
  - **Acceptance criteria**:
    - [x] Header and row `Checkbox` with `aria-label`
    - [x] No Unicode `✓`/`○`
  - **Verification**: Keyboard + screen reader check
  - **Files**: `app/dashboard/compliance/imss/bajas/page.tsx`
  - **Scope**: S

### Checkpoint: Design System
- [x] All sub-pages use MetricCard — no raw Tailwind colors
- [x] All checkboxes are `<Checkbox>` with `aria-label`
- [ ] `pnpm run build` is clean — no verificado: el build falla al descargar Geist de Google Fonts (sin red). `npx tsc --noEmit` sí pasa limpio en todos los archivos IMSS.

---

## Phase 2: i18n + Copy Cleanup

- [x] **Task 6**: Fix all English fragments across IMSS files
  - **Description**: Replace `terminated(s)` → `dado(s) de baja`, `salary` → `salario`, `Desregistro` → `Baja`, `Pasaron deadline` → `Plazo vencido`, IDSE codes with labels.
  - **Acceptance criteria**:
    - [x] Zero English fragments in user-facing strings
    - [x] `Desregistro` gone everywhere
    - [x] IDSE codes shown with Spanish label
  - **Verification**: `grep -rn "salary\|terminated\|Desregistro\|deadline" app/dashboard/compliance/imss/`
  - **Files**: `altas/page.tsx`, `bajas/page.tsx`, `sua/page.tsx`, `page.tsx`
  - **Scope**: S

### Checkpoint: i18n
- [x] Every visible string in the IMSS directory is proper es-MX Spanish

---

## Phase 3: Navigation + Wayfinding

- [x] **Task 7**: Add breadcrumb labels and IMSS sub-navigation
  - **Description**: Add `altas`, `bajas`, `sua` to `PATH_LABELS`. Create `ImssSubNav` component. Wire into all sub-pages.
  - **Acceptance criteria**:
    - [x] Breadcrumbs show full path on every sub-page
    - [x] Sub-nav highlights active link
    - [x] Next.js Link navigation (no full reload)
  - **Verification**: Manual navigation + `pnpm run build`
  - **Files**: `breadcrumb-dynamic.tsx`, `imss-sub-nav.tsx` [NEW], 4 sub-page files
  - **Scope**: M

### Checkpoint: Navigation
- [x] Breadcrumbs correct on all sub-pages
- [x] Sub-nav functional

---

## Phase 4: Reports Page Simplification + Cross-links

- [x] **Task 8**: Remove "Generar Archivos" tab from Reports; add cross-links
  - **Description**: Strip generation UI from Reports. Remove `handleGenerateIdse`/`handleGenerateSUA`. Default to history view. Add "Ver historial →" links on sub-pages.
  - **Acceptance criteria**:
    - [x] Reports page = history only (no generation buttons)
    - [x] Tabs removed — single view
    - [x] Sub-pages have cross-link to Reports
  - **Verification**: Reports loads without generation UI + `pnpm run build`
  - **Files**: `reports/page.tsx`, `altas/page.tsx`, `bajas/page.tsx`, `sua/page.tsx`
  - **Scope**: M

### Checkpoint: Reports
- [x] Reports page is history-only
- [x] Cross-links work

---

## Phase 5: Minor Hardening

- [x] **Task 9**: Fix toggleAll inconsistency, magic salary, accessibility
  - **Description**: Bajas `toggleAll` → READY only. SUA fallback `300` → named constant. Add `role="alert"` to Alert banners. Replace `bg-green-50/50` with border indicator.
  - **Acceptance criteria**:
    - [x] Bajas `toggleAll` selects only READY
    - [x] Magic `300` → `IMSS_MIN_SALARY_DEFAULT`
    - [x] Alert banners have `role="alert"`
    - [x] Row highlight uses border, not color-only
  - **Verification**: Behavior check + `pnpm run build`
  - **Files**: `bajas/page.tsx`, `sua/page.tsx`, `altas/page.tsx`
  - **Scope**: S

### Checkpoint: Complete
- [ ] `pnpm run build` is clean — no verificado: el build falla al descargar Geist de Google Fonts (sin red). `npx tsc --noEmit` sí pasa limpio en todos los archivos IMSS.
- [x] All critique P1 and P2 issues addressed
