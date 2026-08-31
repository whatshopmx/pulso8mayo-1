# Implementation Plan: Incidents UX — Critique Fixes

## Overview

Five targeted improvements derived from the `/impeccable critique` of `app/dashboard/incidents` (score: 23/40). Changes are concentrated in three files: `components/incidents/incident-list.tsx`, `app/dashboard/incidents/page.tsx`, and `app/dashboard/incidents/[id]/page.tsx`. No schema or API changes are required.

## Discovery Notes (post-critique)

After reading the full source, two critique findings need adjustment:

- **Filter/search already exists** in `IncidentList` as client-side state (search input + severity select + status select + "Requieren acción" toggle). What is **missing**: default sort is `createdAt DESC` only (no severity-first default), and the severity order in the filter select is wrong (`HIGH` appears before `FATAL`/`CRITICAL`).
- **`requiresAction` label** is conditionally shown as "requieren acción" text in the strip. The `ShieldAlert` icon has no `aria-label`. Fixing means making the item always visible (muted at 0).

All other critique findings are confirmed by source review.

## Architecture Decisions

- No server-side filter params — the existing client-side filter in `IncidentList` is correct; we improve it, not replace it.
- Draft persistence for the resolve note uses `sessionStorage` keyed by `incidentId`. `[id]/page.tsx` is already `"use client"` — no SSR risk.
- Row severity tinting uses a `data-[severity]` pattern on `<TableRow>` to avoid class collision with existing hover styles.
- The Workflow instanceId card is replaced by "Tiempo activo" (time since detection) for unresolved incidents.

## Task List

### Phase 1: Signal Clarity

- [ ] Task 1: Severity row tinting + CRITICAL/FATAL badge border weight in `incident-list.tsx`
- [ ] Task 2: Fix severity filter select order (FATAL → CRITICAL → HIGH → WARNING) + default sort to severity-first

### Checkpoint: Phase 1
- [ ] CRITICAL rows visually distinct from WARNING at a glance
- [ ] Filter select shows FATAL and CRITICAL before HIGH and WARNING

### Phase 2: Accessibility & Labels

- [ ] Task 3: `aria-label` on all icon-only summary strip elements in `page.tsx`
- [ ] Task 4: `requiresAction` strip item always visible (muted when 0) + ShieldAlert tooltip
- [ ] Task 5: Associate `<label>` with resolve Textarea in both `incident-list.tsx` and `[id]/page.tsx`

### Checkpoint: Phase 2
- [ ] Screen reader describes every icon in summary strip
- [ ] `requiresAction` count visible even at 0
- [ ] Textarea has associated label

### Phase 3: Detail Page Cleanup

- [ ] Task 6: Replace Workflow instanceId card with "Tiempo activo" card in `[id]/page.tsx`
- [ ] Task 7: Add draft persistence to resolve dialog in `[id]/page.tsx` (`sessionStorage` keyed on `incidentId`)

### Checkpoint: Phase 3
- [ ] Detail page 4-card grid is fully operational (no developer noise)
- [ ] Resolve note survives dialog close/reopen on the same incident

### Phase 4: Empty State

- [ ] Task 8: Affirming zero-incidents empty state on `page.tsx` when `stats.total === 0`

### Checkpoint: Complete
- [ ] All 5 critique P1/P2 findings addressed
- [ ] `pnpm run build` passes without TypeScript errors
- [ ] Manual: CRITICAL row tinting visible; note persists on dialog reopen

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Row tinting class conflicts with hover styles | Low | Use `data-[severity]` attribute pattern |
| instanceId card replacement breaks downstream code | None | No code reads DOM card content |
| sessionStorage unavailable | None | `[id]/page.tsx` is already client-only |

## Open Questions

None — all decisions can be resolved from the source without human input.
