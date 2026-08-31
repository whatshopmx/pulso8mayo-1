# Implementation Plan: Incident Resolution — System Action Gaps

## Overview

After tracing the full resolution flow (Camino A: manual, Camino B: protocol, Camino C: recommendation), three structural gaps were found where resolutions don't properly trigger downstream system actions. This plan fixes them in dependency order: service layer first, UI layer last.

## Architecture Context

- `IncidentEngine.resolveIncident()` — manual resolution. Calls `cancelEscalation` + `unblockInstanceIfClear` (which calls `recalculateProgress`).
- `RemediationService.trackRemediationAttempt()` — protocol auto-resolution. Calls `cancelEscalation` but **does NOT** call `unblockInstanceIfClear`. Workflow stays BLOCKED.
- `resolveRecommendedAction()` — pure function, no side effects. Returns `kind: 'RESOLVE_MANUAL'` as fallback.
- `IncidentActionPanel` — renders recommended action. Has no CTA branch for `RESOLVE_MANUAL`.

## Architecture Decisions

- **Consolidate post-resolution side effects into a shared method.** Instead of duplicating `cancelEscalation` + `unblockInstanceIfClear` in both services, add a public static `IncidentEngine.afterResolution(incidentId, instanceId)` that owns both calls. This prevents future drift.
- **`RESOLVE_MANUAL` CTA goes via a callback prop**, not a router push. The panel doesn't know how to open the detail page's dialog — it fires `onResolveManual?.()` and the parent (`[id]/page.tsx`) handles it.
- **English resolution strings in Camino B are a data fix**, not an architectural change. One-line swap.

## Task List

### Phase 1: Service Layer — Shared Post-Resolution Method

- [ ] Task 1: Add `IncidentEngine.afterResolution(incidentId, instanceId)` public static method
- [ ] Task 2: Update `RemediationService.trackRemediationAttempt` to call `afterResolution` instead of its inline `cancelEscalation` (+ add the missing `unblockInstanceIfClear` call)
- [ ] Task 3: Update `IncidentEngine.resolveIncident` to call `afterResolution` instead of its inline side effects

### Checkpoint: Phase 1
- [ ] Both resolution paths call the same shared cleanup
- [ ] `pnpm run build` passes

### Phase 2: Data Consistency — Spanish Resolution Strings

- [ ] Task 4: Change the hardcoded English `resolution` string in `trackRemediationAttempt` to `'Remediación completada por protocolo'`
- [ ] Task 5: Change the English `message` in `trackRemediationAttempt` return values to Spanish

### Checkpoint: Phase 2
- [ ] All user-visible resolution strings are in Spanish
- [ ] `pnpm run build` passes

### Phase 3: UI — RESOLVE_MANUAL CTA in IncidentActionPanel

- [ ] Task 6: Add `onResolveManual?: () => void` prop to `IncidentActionPanelProps`
- [ ] Task 7: Add a CTA Button branch for `RESOLVE_MANUAL` kind that calls `onResolveManual`
- [ ] Task 8: Wire `onResolveManual` in `[id]/page.tsx` to call `openResolveDialog()`

### Checkpoint: Phase 3
- [ ] RESOLVE_MANUAL panel shows "Resolver manualmente" button that opens the resolve dialog
- [ ] `pnpm run build` passes

### Checkpoint: Complete
- [ ] All 3 gaps closed
- [ ] Manual verify: complete a remediation protocol in dev → workflow unblocks
- [ ] Manual verify: incident without protocol shows "Resolver manualmente" CTA that opens dialog

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `unblockInstanceIfClear` is private | Low | We add `afterResolution` as the public surface; keep `unblockInstanceIfClear` private |
| `afterResolution` called with wrong `instanceId` | Medium | `trackRemediationAttempt` already has the incident row in scope; read `instanceId` from it directly |
| `resolveIncident` return value changes | None | No callsites depend on the return value of the side-effect calls |

## Open Questions

None — all decisions resolved from source.
