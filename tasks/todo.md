# Performance Optimization — Task List

Baseline: CLS 0.18–0.31 on authed pages · cold /dashboard 591KB JS · suggestions route ~500+ queries · 7/381 paginated.
Measure after each phase with `scripts/perf-baseline.mjs` / `scripts/perf-cls-cold.mjs` (prod server: `pnpm build && pnpm start`).

---

## Phase 1: Quick wins

## Task 1: SSR the sidebar + `defaultOpen` from cookie

**Description:** `components/app-sidebar-client.tsx` wraps the entire sidebar in `next/dynamic({ ssr: false })` with a hidden placeholder, so the server sends no sidebar and it pops in ~1.8s after load, shifting `<main>` sideways — 0.18 of the CLS on every authenticated page. Remove the `ssr: false` wrapper and render `AppSidebar` directly in the server layout; read the `sidebar_state` cookie in `app/dashboard/layout.tsx` and pass it as `defaultOpen` to `SidebarProvider` (stock shadcn pattern) so collapsed-state users don't get an open→collapsed snap.

**Acceptance criteria:**
- [ ] Sidebar HTML present in initial server response (`curl localhost:3000/dashboard` contains sidebar nav markup when authenticated)
- [ ] `SidebarProvider` receives `defaultOpen` from the `sidebar_state` cookie
- [ ] Sidebar collapse/expand still persists across reloads

**Verification:**
- [ ] `pnpm run build` clean
- [ ] `node scripts/perf-cls-cold.mjs` → main-element shift (0.18 @ ~1.8s) gone; /dashboard CLS ≤ 0.1
- [ ] Manual: toggle collapse, reload → stays collapsed

**Dependencies:** None

**Files likely touched:**
- `components/app-sidebar-client.tsx` (delete or strip wrapper)
- `app/dashboard/layout.tsx` (import AppSidebar directly, pass defaultOpen)

**Estimated scope:** S (1–2 files)

---

## Task 2: Lazy-load jsPDF / html2canvas at click time

**Description:** jsPDF + jspdf-autotable + html2canvas (+ framer, 437KB raw / 139KB gz chunk `ef9f5781…`) are statically imported by client components, so every visitor pays for PDF generation they rarely use. Convert to `await import('jspdf')` / `import('jspdf-autotable')` inside the export click handlers. Server-side services (`lib/services/ComplianceReportService.ts`, `lib/reports/schedule-calendar-pdf.ts`) only need changing if they're reachable from client bundles — verify via import graph.

**Acceptance criteria:**
- [ ] No static `from 'jspdf'` / `from 'html2canvas'` imports in `components/**`
- [ ] Export buttons still generate identical PDFs (manual click test on compliance dashboard + report generator)
- [ ] First-load JS of `/dashboard/compliance` drops by ≥ 130KB gz

**Verification:**
- [ ] `pnpm run build` clean; chunk `ef9f5781…` no longer referenced by compliance/report page client manifests
- [ ] Manual: export PDF from compliance dashboard → downloads correctly

**Dependencies:** None

**Files likely touched:**
- `components/compliance/compliance-dashboard.tsx`
- `components/compliance/report-generator.tsx`
- (maybe) `lib/reports/schedule-calendar-pdf.ts` call sites

**Estimated scope:** S (2–3 files)

---

## Task 3: `next/image` remotePatterns + convert raw `<img>` tags

**Description:** 14 raw `<img>` tags vs 4 `next/image` usages. Evidence photos (workflow executor/review/stepper), product photos, petty-cash receipts, and dicebear avatars load full-size originals, unoptimized, eager. Add `images.remotePatterns` to `next.config.ts` (R2 public URL from `R2_PUBLIC_URL` env + `api.dicebear.com`), then convert the raw tags — prioritizing evidence galleries (heaviest images) with `fill` + `sizes`, and avatars with fixed `width`/`height`.

**Acceptance criteria:**
- [ ] `next.config.ts` has remotePatterns for R2 hostname + `api.dicebear.com`
- [ ] Evidence/review/stepper/product/petty-cash images use `next/image` with dimensions or `fill`+`sizes`
- [ ] No layout shift from unloaded images in evidence galleries (explicit aspect boxes preserved)

**Verification:**
- [ ] `pnpm run build` clean
- [ ] Manual: open workflow review with photo evidence, product page, petty-cash table → images render, served via `/_next/image`
- [ ] `rg "<img" app components` → only justified exceptions remain (e.g. camera capture preview of local blob)

**Dependencies:** None (config + components, independent of Tasks 1–2)

**Files likely touched:**
- `next.config.ts`
- `components/execution/workflow-stepper.tsx`, `components/workflow/workflow-review.tsx`, `components/workflow/workflow-executor.tsx`, `components/workflow/ai-verification-status.tsx`, `components/builder/workflow-preview-modal.tsx`
- `components/inventory/product-photo-upload.tsx`, `app/dashboard/inventory/[id]/page.tsx`
- `components/finance/petty-cash-history-table.tsx`, `app/dashboard/profile/onboarding/page.tsx`

**Estimated scope:** M (5–9 files, mechanical)

### Checkpoint: Phase 1
- [ ] Build clean; CLS ≤ 0.1 on /dashboard (target: ≤ 0.05 after sidebar fix)
- [ ] Cold /dashboard JS ≤ 450KB
- [ ] Manual smoke passed (sidebar, PDF export, images)

---

## Phase 2: Backend query hot paths

## Task 4: Fix `ProductionService.getSuggestions` nested N+1

**Description:** `lib/services/production-service.ts:132-195` loops all recipes (2 queries each) then loops each recipe's ingredients (1 query each) — ~500+ round-trips for 50 recipes × 8 ingredients, on both `GET /api/inventory/production/suggestions` and the forecast cron. Rewrite as 4 batched queries: (1) all recipes, (2) sales aggregated `GROUP BY recipeId` with `inArray(recipeIds)` + date filter, (3) all recipeItems with `inArray(recipeIds)`, (4) stock aggregated `GROUP BY itemId` with `inArray(allItemIds)` + branch filter. Assemble suggestions in memory; identical response shape.

**Acceptance criteria:**
- [ ] ≤ 6 DB queries per `getSuggestions` call regardless of recipe/ingredient count
- [ ] Response items identical to pre-change output on seeded data (snapshot before, diff after)
- [ ] Sort/filter semantics unchanged (`suggestedQuantity > 0`, desc)

**Verification:**
- [ ] Snapshot test: call route before/after on seeded DB, `diff` the JSON
- [ ] Query count logged ≤ 6 (temp `console.log` or drizzle logger)
- [ ] `pnpm run build` clean

**Dependencies:** None

**Files likely touched:**
- `lib/services/production-service.ts`

**Estimated scope:** S (1 file)

---

## Task 5: Fix alert-service N+1 loops

**Description:** Batch user/document lookups in four known loops: `advanced-alert-service.ts:17,58` (item + movements per knowledge-guide entry), `overtime-alert-service.ts:251,311` (user per session / per excessive user), `employee-document-service.ts:359` (docs per employee), `app/api/analytics/labor-compliance/route.ts:62` (user per uid). Replace with `inArray` batch fetches + in-memory maps. Insert-loops in `vacations/route.ts`, `sales-entry/route.ts`, `employees/lifecycle/route.ts`, `inventory-service.ts:451` become single multi-row `insert().values([...])` where inside a transaction.

**Acceptance criteria:**
- [ ] No `await db.*` inside `for` loops in the listed files (except chunk-batched inserts like the existing 100-row pattern)
- [ ] Notification payloads/recipients identical to before

**Verification:**
- [ ] `rg -U "for\s*\([^)]*\)\s*\{[^{}]{0,400}?await\s+(db\.|tx\.)"` on touched files → no hits
- [ ] `pnpm run build` clean
- [ ] Manual: trigger overtime alert path / vacation request → notifications arrive

**Dependencies:** None (can run parallel to Task 4)

**Files likely touched:**
- `lib/services/advanced-alert-service.ts`, `lib/services/overtime-alert-service.ts`
- `lib/services/employee-document-service.ts`
- `app/api/analytics/labor-compliance/route.ts`
- `app/api/vacations/route.ts`, `app/api/inventory/sales-entry/route.ts`, `app/api/employees/lifecycle/route.ts`, `lib/services/inventory-service.ts`

**Estimated scope:** M (5–8 files, same mechanical pattern)

---

## Task 6: Paginate top unbounded list endpoints

**Description:** Only 7 of 381 query call sites use limits. Add `limit`/`offset` (default 50, max 200) + `meta: { total, limit, offset }` to the highest-traffic unbounded GET endpoints: `notifications`, `shifts`, `shift-sessions`, `inventory/alerts`, `kpi/dashboard`. **First grep every frontend caller of each endpoint** — response stays `{ data: [...], meta }` or array-with-meta so existing UI keeps working; UI pagination controls are out of scope (follow-up).

**Acceptance criteria:**
- [ ] Listed endpoints accept `limit`/`offset`, default-capped, with total count in `meta`
- [ ] Existing callers' response fields unchanged (additive only)
- [ ] No caller found that requires full unbounded result sets (or those endpoints excluded from this task)

**Verification:**
- [ ] Caller grep documented in PR description for each endpoint
- [ ] `pnpm run build` clean; manual smoke: notifications dropdown, shifts page, inventory alerts
- [ ] curl each endpoint with/without params → capped + meta present

**Dependencies:** None (but do after Tasks 4–5 to isolate regressions)

**Files likely touched:**
- `app/api/notifications/route.ts`, `app/api/shifts/route.ts`, `app/api/shift-sessions/route.ts`, `app/api/inventory/alerts/route.ts`, `app/api/kpi/dashboard/route.ts`

**Estimated scope:** M (5 files + caller audit)

### Checkpoint: Phase 2
- [ ] Build clean; response snapshots match for Tasks 4–5
- [ ] Suggestions route ≤ 6 queries, local p95 < 500ms
- [ ] Smoke: notifications, shifts, alerts pages

---

## Phase 3: Bundle diet & guardrails

## Task 7: Recharts strategy — lazy below-fold charts + duplicate-chunk investigation

**Description:** Recharts (382KB raw / 102KB gz) appears as ~6 near-identical chunks and is statically imported by 20+ components. Two moves: (a) wrap below-the-fold charts (compliance trends, menu-engineering matrix, executive charts) in `next/dynamic` with a sized skeleton fallback; (b) timeboxed investigation (≤ 1h) into why Turbopack emits duplicate chunks — route all recharts imports through `components/ui/chart.tsx` barrel to give the splitter one canonical module.

**Acceptance criteria:**
- [ ] Below-fold charts load lazily with skeletons that reserve height (no CLS)
- [ ] Duplicate-chunk cause documented (fixed if source-level; noted as tooling artifact if not)
- [ ] Cold /dashboard JS ≤ 400KB

**Verification:**
- [ ] Build; chunk manifest diff shows fewer/smaller recharts chunks on chart-heavy routes
- [ ] `node scripts/perf-cls-cold.mjs` → no new shifts from chart skeletons
- [ ] Manual: charts render on scroll (dashboard, compliance, menu-engineering)

**Dependencies:** Task 1 (CLS must be fixed first so chart-skeleton shifts are visible in measurements)

**Files likely touched:**
- `components/compliance/compliance-dashboard.tsx`, `components/inventory/menu-engineering-matrix.tsx`, `components/sales/sales-dashboard.tsx`, `components/dashboard/executive/*`, `components/ui/chart.tsx`

**Estimated scope:** M (4–6 files)

---

## Task 8: Identify & lazy-load 313KB binary-codec chunk

**Description:** Chunk `ff181122…` (313KB raw / 68KB gz) contains base64/binary codec code with one `xlsx` string — not ExcelJS (0 matches), likely pulled by an export/import UI path. Identify its owner module from the chunk's module IDs + import graph, and if it's export-only, lazy-load like Task 2.

**Acceptance criteria:**
- [ ] Owner library identified and documented
- [ ] If export/import-only: loaded via dynamic import; out of first-load JS

**Verification:**
- [ ] Build; chunk absent from page client manifests or only loaded on demand

**Dependencies:** None

**Files likely touched:** TBD by investigation (≤ 3 files)

**Estimated scope:** S

---

## Task 9: Perf budget guardrail + baseline doc

**Description:** Prevent regression: add a lightweight bundle check script (fail if any client chunk > 450KB raw or route first-load JS > 250KB gz, thresholds tuned to post-fix reality) runnable in CI, and record the full before/after baseline in `docs/performance-baseline.md` so future work has numbers to compare.

**Acceptance criteria:**
- [ ] `scripts/check-bundle-budget.mjs` exits non-zero over budget; wired as `pnpm check:budget`
- [ ] `docs/performance-baseline.md` contains before/after CWV + transfer + query counts

**Verification:**
- [ ] Script passes on the fixed build; intentionally lowering a threshold makes it fail
- [ ] Doc reviewed by human

**Dependencies:** Tasks 1–8 (budgets set from post-fix numbers)

**Files likely touched:**
- `scripts/check-bundle-budget.mjs` (new), `package.json`, `docs/performance-baseline.md` (new)

**Estimated scope:** S (2–3 files)

### Checkpoint: Complete
- [ ] All acceptance criteria met; before/after documented
- [ ] `pnpm run lint` + `pnpm run build` clean
- [ ] Ready for human review
