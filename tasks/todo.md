# Task List: Inventory Dashboard — 2026-07-28 Critique (26/40)

Source: `.impeccable/critique/2026-07-28T19-07-38Z__app-dashboard-inventory.md`

## Phase 1: Truthfulness & Hardening (P1 safety)

### Task 1: Add `generatedAt` to dashboard API + thread through `useDashboard`

**Description:** The dashboard API returns no timestamp, so the UI cannot show data recency. Add a
`generatedAt` (response time) to the `/api/inventory/dashboard` JSON and include it in the typed return
of `useDashboard`. This is the foundation for Task 5 (recency indicator) — no UI rendering yet.

**Acceptance criteria:**
- [ ] `GET /api/inventory/dashboard` response includes `generatedAt: ISO-8601 string`
- [ ] `useDashboard` return type includes `generatedAt: string` on the data shape
- [ ] Existing consumers compile unchanged (additive only)

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Manual check: `curl`/browser shows `generatedAt` in the JSON response

**Dependencies:** None

**Files likely touched:**
- `app/api/inventory/dashboard/route.ts`
- `hooks/queries/use-inventory.ts`

**Estimated scope:** S (2 files)

---

### Task 2: Add reusable `ErrorState` to `components/shared/`

**Description:** Add one shared error-state component (icon + message + retry button) so KPIs, charts,
alerts, and the table share a single error pattern with consistent a11y. Export it from
`components/shared/index.ts`.

**Acceptance criteria:**
- [ ] `ErrorState` accepts `message`, `onRetry`, optional `icon`, optional `className`
- [ ] Retry button is keyboard-focusable with a visible focus ring
- [ ] Role/aria: container has `role="alert"` and message is announced
- [ ] Exported from `components/shared/index.ts`

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Lint clean: `pnpm run lint`

**Dependencies:** None

**Files likely touched:**
- `components/shared/error-state.tsx`
- `components/shared/index.ts`

**Estimated scope:** S (2 files)

---

### Task 3: Tri-state KPI block — error/loading/success, no `?? 0` on success-critical metrics

**Description:** `DashboardKpis` currently does `data?.totalStockValue ?? 0` and
`data?.activeAlertsCount ?? 0`, so a failed fetch renders "$0.00 / 0 alertas / Operación sin
incidencias" — a clean bill of health that is actually a broken state. Accept `isError` and `refetch`
props; render `ErrorState` on error, `KpiCardsSkeleton` on loading, real numbers only on success.

**Acceptance criteria:**
- [ ] `DashboardKpis` accepts `loading: boolean`, `isError: boolean`, `onRetry: () => void`
- [ ] On `isError`, renders `ErrorState` (retry wired to `refetch`) — never renders `$0.00` or `0`
- [ ] On `loading`, renders `KpiCardsSkeleton` (unchanged)
- [ ] On success, numbers render exactly as today (no behavior change on the happy path)
- [ ] `stockValue` / `activeAlerts` read from a non-null `data` only (no `?? 0` fallback on the success path)

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Manual check: force a 500 (e.g. stop DB / bad branchId) → KPI block shows error + retry, not zeros
- [ ] Manual check: healthy load → numbers match pre-change

**Dependencies:** Task 2 (ErrorState)

**Files likely touched:**
- `components/inventory/dashboard-kpis.tsx`
- `app/dashboard/inventory/page.tsx` (pass `isError`/`refetch`)

**Estimated scope:** S (2 files)

---

### Task 4: Tri-state QuickAlerts + DashboardCharts + product table — error branches with retry

**Description:** Extend the tri-state pattern to the remaining dashboard surfaces. `QuickAlerts` and
`DashboardCharts` accept `isError`/`onRetry`; the product table in `page.tsx` branches on
`useInventory`'s `isError` (currently only `isLoading` is destructured). On error, render `ErrorState`
with retry — never empty lists that read as "no problems".

**Acceptance criteria:**
- [ ] `QuickAlerts` accepts `isError`, `onRetry`; on error renders one `ErrorState` spanning both cards
- [ ] `DashboardCharts` accepts `isError`, `onRetry`; on error renders `ErrorState` in each chart card
- [ ] Product table: `useInventory` destructures `isError` + `refetch`; error → `ErrorState` with retry
      (not the "No se encontraron productos" empty state, which currently masks a fetch failure)
- [ ] Loading and success paths unchanged
- [ ] Empty-state ("sin resultados" vs "no products at all") still distinguishes from error-state

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Manual check: with dashboard fetch failing, alerts/charts show error+retry, not "Sin alertas"
- [ ] Manual check: with inventory fetch failing, table shows error+retry, not "No se encontraron productos"

**Dependencies:** Task 2 (ErrorState)

**Files likely touched:**
- `components/inventory/quick-alerts.tsx`
- `components/inventory/dashboard-charts.tsx`
- `app/dashboard/inventory/page.tsx`

**Estimated scope:** M (3 files)

---

## Checkpoint: Foundation — Truthfulness
- [ ] `pnpm run build` succeeds
- [ ] Forced 500 → page shows error states, not reassuring zeros
- [ ] Healthy load → numbers/lists render as before
- [ ] No metric can render a hard-coded `0` from an `undefined` payload
- [ ] Review with human before Phase 2

## Phase 2: Affordance, A11y & Polish (P2)

### Task 5: Data-recency indicator ("Actualizado · {relative time}")

**Description:** Add a subtle recency line using `generatedAt` from Task 1. Place a single "Actualizado
· hace X min" near the PageHeader (scoped to the dashboard data), and a per-KPI footer timestamp is
optional. Add a small `useRelativeTime(iso)` helper that re-renders on a timer (every 60s) and stops
when hidden. Label honestly as last dashboard fetch, not last physical count.

**Acceptance criteria:**
- [ ] PageHeader area shows "Actualizado · {relative time}" when `dashboardData.generatedAt` is present
- [ ] Relative time updates at least once per minute while visible
- [ ] Hidden/undefined `generatedAt` renders nothing (no "Actualizado · —")
- [ ] Tooltip clarifies this is the last dashboard refresh, not the last stock count

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Manual check: indicator appears after load and ticks up over time

**Dependencies:** Task 1 (generatedAt)

**Files likely touched:**
- `app/dashboard/inventory/page.tsx`
- `hooks/use-relative-time.ts` (new, small)

**Estimated scope:** S (2 files)

---

### Task 6: KPI clickable affordance + a11y

**Description:** The "Alertas Críticas" KPI is a `Link` but is visually indistinguishable from the three
non-clickable KPI cards (hover-only `border-primary`, invisible on touch/SR). Add a persistent
affordance: a trailing chevron and a "Ver detalle →" text link in the card footer. Add `aria-label` to
the alert `bg-red-500` dot (currently unlabeled) and to the `cursor-help` Info tooltip triggers.

**Acceptance criteria:**
- [ ] Clickable KPI card shows a persistent chevron + "Ver detalle →" (not hover-only)
- [ ] Non-clickable KPI cards show no such affordance (visual distinction without hover)
- [ ] Alert dot has an `aria-label` (e.g. "hay alertas activas") or a visually-hidden text label
- [ ] All Info tooltip triggers have `aria-label` describing their KPI
- [ ] Focus-visible ring on the Link is preserved (already present)

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Manual check (keyboard Tab): the clickable card is identifiable without hover
- [ ] Manual check (touch / coarse pointer): affordance visible without hover

**Dependencies:** Task 3 (so KPI props are stable)

**Files likely touched:**
- `components/inventory/dashboard-kpis.tsx`

**Estimated scope:** S (1 file)

---

### Task 7: Color-blindness — shape+label for low-stock/expiring; "Sin stock" badge → warning

**Description:** Low-stock (amber) and expiring (orange) are hue-adjacent and indistinguishable for
deuteranopia/protanopia; the table row carries meaning by amber text alone. Differentiate by **shape +
text label**, color as reinforcement. Add a text badge ("Bajo" / "Vence") to table rows; QuickAlerts
already uses triangle vs clock icons (keep). Change the "Sin stock" tab badge from `variant="destructive"`
to `variant="warning"` (already exists in `badge.tsx`) — out-of-stock is a warning, not an error.

**Acceptance criteria:**
- [ ] Product table low-stock row shows a "Bajo" text badge alongside the amber icon/text (not color alone)
- [ ] QuickAlerts already differentiates by icon (triangle vs clock) — verified, no regression
- [ ] "Sin stock" tab count badge uses `warning` variant, not `destructive`
- [ ] Color remains as reinforcement; meaning survives grayscale

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Manual check: grayscale/colour-blind simulation — low-stock vs expiring still distinguishable

**Dependencies:** None (independent of Phase 1)

**Files likely touched:**
- `app/dashboard/inventory/page.tsx` (table row + tab badge)

**Estimated scope:** S (1 file)

---

### Task 8: Minor polish bundle

**Description:** Roll up the critique's minor observations into one mechanical pass:
1. `ChevronRight` on daily-action cards is `opacity-0 group-hover:opacity-100` — never appears on touch.
   Scope to `sm:opacity-0` so it's always visible on mobile/coarse-pointer.
2. KPI numerals `text-2xl` → `text-xl` for a tighter, less shouty hierarchy next to `text-sm` labels.
3. Remove `text-balance` on single-line table cells (no-op there).
4. `QuickAlerts`: each card's empty state links to `/dashboard/inventory/alerts` — keep one footer link
   per card (already one each, but verify no duplication after Phase 1 changes).
5. `DashboardCharts`: replace hardcoded OKLCH `COLORS` literals with `var(--chart-1..5)` CSS vars.

**Acceptance criteria:**
- [ ] Daily-action chevron visible on mobile (always), hover-reveal only on `sm:`
- [ ] KPI numerals use `text-xl` consistently across all four cards
- [ ] No `text-balance` on table cells
- [ ] Charts use `var(--chart-1)` … `var(--chart-5)` instead of literal OKLCH strings
- [ ] Dark mode: chart colors track theme tokens (no washed-out hardcoded values)

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Manual check: mobile viewport shows chevrons; dark mode charts consistent

**Dependencies:** Task 4 (charts may have been touched for error states)

**Files likely touched:**
- `app/dashboard/inventory/page.tsx`
- `components/inventory/dashboard-charts.tsx`
- `components/inventory/dashboard-kpis.tsx`
- `components/inventory/quick-alerts.tsx`

**Estimated scope:** M (4 files, all small mechanical edits)

---

### Task 9: Surface `branchesWithStock` in PageHeader (and flag the rollup product question)

**Description:** The API returns `branchesWithStock` but the UI never renders it — a multi-branch signal
(Mariana persona, 8 branches) built in the API and dropped in the UI. This is evidence the multi-sucursal
"morning brief" was the original intent and got half-built. **This task is the cheap, honest surface** —
show "X sucursales con stock" as a PageHeader badge when no single branch is selected (cross-branch
context), hide it when a single branch is selected. The deeper question (is a full cross-branch rollup
the north star?) is logged as an open product question and may spawn a follow-up epic beyond this plan.

**Acceptance criteria:**
- [ ] When no single branch selected: PageHeader shows "X sucursales con stock" badge
- [ ] When a single branch is selected: badge hidden (count would be misleading)
- [ ] Open product question logged in `tasks/plan.md`: is cross-branch rollup the north star?
- [ ] If team decides rollup is a non-goal: `branchesWithStock` removed from API + hook type, task closes with that note

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Manual check: badge appears in cross-branch context, hidden in single-branch context

**Dependencies:** Task 1 (data shape), Task 5 (PageHeader area already touched)

**Files likely touched:**
- `app/dashboard/inventory/page.tsx`
- `components/shared/page-header.tsx` (optional: add `meta` slot) — or render inline in page

**Estimated scope:** S (1-2 files)

---

## Checkpoint: Polish
- [ ] `pnpm run build` + `pnpm run lint` clean
- [ ] Keyboard-only: clickable KPI identifiable without hover; alert dot announced
- [ ] Color-blind simulation: low-stock vs expiring distinguishable without hue
- [ ] Dark mode: charts use theme tokens
- [ ] Review with human before Phase 3

## Phase 3: Power + Distill (P1 cognitive load, P2 table power)

### Task 10: Product table — sortable headers, "low stock first" default sort, pagination, row count

**Description:** The "Productos en Almacén" table has only search + a 2-tab filter; no sort, no
pagination, no row count — a wall of SKUs for a branch with hundreds. Add sortable headers (name,
category, stock), default to "low stock first" (ascending stock) so the power user sees what needs
attention, paginate above ~50 rows, and show a row count. Reuse the existing `Table` primitives; keep
data client-side (already filtered client-side).

**Acceptance criteria:**
- [ ] Name / Category / Stock headers are sortable (click toggles asc/desc, default low-stock-first on stock)
- [ ] Default sort: stock ascending (lowest first)
- [ ] Pagination at 50 rows/row count shown ("Mostrando X–Y de Z")
- [ ] Search + tab filter compose with sort and pagination
- [ ] Sort indicator is not color-only (icon + aria-sort on `<th>`)

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Manual check: >50 products paginate; clicking "Stock" sorts ascending then descending
- [ ] Manual check: search + sort + pagination compose without losing state

**Dependencies:** Task 4 (table error state already in place)

**Files likely touched:**
- `app/dashboard/inventory/page.tsx`
- `hooks/use-table-sort.ts` (new, small) or inline

**Estimated scope:** M (1-2 files)

---

### Task 11: Distill page IA to STATUS BOARD — remove sitemap, demote daily-actions, merge alerts, ≤4 sections

**Description:** The page stacks 8 sections (~35 interactive items): PageHeader → 4 daily-action cards
→ 4 KPI cards → 2 charts → 2 quick-alert cards → product table → 21-link sitemap. **Page identity is
decided: STATUS BOARD** (confirmed by code — `components/app-sidebar.tsx` L96–192 already exposes the
same 21 inventory links with the same 4-group IA, so the sitemap is a duplicate, not compensation for a
weak sidebar; the launchpad job is already covered by the sidebar). Distill to a status board: remove
the 21-link "Todas las herramientas" card entirely, demote daily-actions from a 4-card grid into a slim
"Acciones rápidas" row between header and KPIs, and merge QuickAlerts (Stock Bajo + Vencimientos) into a
single alerts section feeding the exception table. Target ≤4 sections above the fold: PageHeader → KPIs
→ Alerts → Exception table (charts move below the fold or to a secondary tab). Mostly deletions +
restructure in `page.tsx`.

**Acceptance criteria:**
- [ ] "Todas las herramientas" sitemap card removed (sidebar remains the nav source — verified it covers all 21 links)
- [ ] Daily-actions demoted to a slim "Acciones rápidas" row (no longer a full 4-card grid competing with KPIs)
- [ ] QuickAlerts merged into a single alerts section (Stock Bajo + Vencimientos) feeding the exception table
- [ ] Above-the-fold section count ≤4 (PageHeader + KPIs + Alerts + Exception table)
- [ ] Charts remain reachable (below the fold or a tab) — not deleted
- [ ] No working feature removed without a replacement path (sidebar covers all removed sitemap links)

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Manual check: above-the-fold shows ≤4 sections; daily actions still one tap away
- [ ] Manual check: every removed sitemap link is reachable via the sidebar (spot-check Operar/Comprar/Analizar/Configurar)

**Dependencies:** Tasks 3, 4, 10 (error states + table power already in place)

**Files likely touched:**
- `app/dashboard/inventory/page.tsx` (mostly deletions + restructure)

**Estimated scope:** M (1 file, but structurally significant)

---

## Checkpoint: Complete
- [ ] All acceptance criteria met
- [ ] `pnpm run build` + `pnpm run lint` clean
- [ ] Above-the-fold section count ≤4
- [ ] Forced 500 shows error states; healthy load shows recency + real numbers
- [ ] Ready for review
