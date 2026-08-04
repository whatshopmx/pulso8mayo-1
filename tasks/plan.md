# Implementation Plan: Performance Optimization (Baseline Findings)

## Overview

Fix the performance issues found in the 2026-08 baseline sweep (`build-output.txt`, `scripts/perf-baseline.mjs`, `scripts/perf-cls-cold.mjs`). Three fronts, ordered by impact/effort: (1) kill the layout shift that affects every authenticated page and strip export-only libraries out of first-load JS, (2) eliminate the worst N+1 query patterns and unbounded fetches in API routes, (3) verify with before/after measurements and add guardrails.

**Baseline numbers to beat:**
- CLS on all `/dashboard/*` pages: **0.18–0.31** → target ≤ 0.1
- Cold `/dashboard` first load: **733KB total / 591KB JS** → target ≤ 400KB JS
- `GET /api/inventory/production/suggestions`: ~**500+ DB round-trips** per request → target ≤ 6
- Pagination usage: **7 of 381** query call sites → all list endpoints capped

## Architecture Decisions

- **Sidebar must be server-rendered.** `next/dynamic({ ssr: false })` on above-the-fold chrome is the CLS root cause. `AppSidebar` stays a client component (interactivity) but renders via SSR; open-state comes from the `sidebar_state` cookie via `defaultOpen` (stock shadcn pattern), avoiding hydration mismatch.
- **Export libs load on demand.** jsPDF / jspdf-autotable / html2canvas are only needed after an "Export" click → dynamic `import()` in the click handler. No UI change, no new deps.
- **Batch, don't loop.** N+1 fixes use `inArray` + `GROUP BY` aggregates (Drizzle), keeping existing response shapes so no frontend changes are required.
- **Pagination is additive.** List endpoints get `limit`/`offset` params with sane defaults (e.g. 50) and a `meta` block; existing clients that ignore `meta` keep working as long as default limits exceed their current data volumes — flagged as an open question where that's uncertain.

## Task List

### Phase 1: Quick wins (frontend, independent)

- [ ] Task 1: SSR the sidebar + `defaultOpen` from cookie (CLS fix)
- [ ] Task 2: Lazy-load jsPDF / html2canvas at click time
- [ ] Task 3: `next/image` remotePatterns + convert raw `<img>` on evidence/product photos

### Checkpoint: Phase 1
- [ ] `pnpm run build` clean
- [ ] `node scripts/perf-cls-cold.mjs` → CLS ≤ 0.1 on /dashboard, cold JS ≤ 450KB
- [ ] Manual: sidebar renders instantly, PDF export still works, photos display

### Phase 2: Backend query hot paths

- [ ] Task 4: Fix `ProductionService.getSuggestions` nested N+1 (batch with GROUP BY/inArray)
- [ ] Task 5: Fix alert-service N+1s (advanced-alert-service, overtime-alert-service, labor-compliance)
- [ ] Task 6: Paginate top unbounded list endpoints (notifications, shifts, shift-sessions, inventory/alerts, kpi/dashboard)

### Checkpoint: Phase 2
- [ ] `pnpm run build` clean; endpoints return identical shapes for existing fields
- [ ] Suggestions route: ≤ 6 queries per request (count via logging), p95 local < 500ms
- [ ] Manual smoke: notifications dropdown, shifts page, inventory alerts page

### Phase 3: Bundle diet & guardrails

- [ ] Task 7: Recharts strategy — lazy below-fold charts, investigate 6 duplicate 382KB chunks
- [ ] Task 8: Identify & lazy-load 313KB binary-codec chunk (`ff181122…`)
- [ ] Task 9: Perf budget guardrail (chunk-size check) + record before/after in docs

### Checkpoint: Complete
- [ ] All acceptance criteria met
- [ ] Baseline scripts re-run; before/after committed to `docs/performance-baseline.md`
- [ ] `pnpm run lint` + `pnpm run build` clean

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Sidebar SSR breaks something that motivated `ssr:false` originally (hydration mismatch, cookie state) | Med | Pass `defaultOpen` from server-read cookie; test expand/collapse persistence manually; revert path is trivial (one file) |
| Pagination breaks existing clients expecting full arrays | High | Additive `meta` block, keep array field; default limit 50–100; grep all fetch callers of each endpoint before changing |
| Batched queries return subtly different aggregates (NULL handling, decimals) | Med | Snapshot current API responses on seeded data before each fix; diff after |
| Lazy PDF import delays first export click by ~1s | Low | Prefetch chunk on hover/`pointerdown`; show existing loading state |
| Recharts chunk duplication is a Turbopack emission artifact, not fixable at source level | Low | Timebox investigation; win comes from lazy-loading below-fold charts anyway |

## Open Questions

- [ ] Do any external consumers (WhatsApp smart links, mobile clients) call the endpoints in Task 6 and expect unpaginated arrays?
- [ ] Is `/dashboard/inventory/production` (suggestions) heavily used, or is the cron the main `getSuggestions` consumer? (Affects urgency of Task 4 vs. cron cost.)
- [ ] Was `ssr: false` on the sidebar added to fix a specific bug? (No comment in code; git blame may tell.)
