# TODO: Incident Resolution — System Action Gaps

## Phase 1 — Service Layer (shared post-resolution cleanup)

- [ ] **Task 1** · `lib/services/incident-engine.ts`
  Add `static async afterResolution(incidentId: string, instanceId: string): Promise<void>` as a PUBLIC static method.
  Body: `await EscalationService.cancelEscalation(incidentId)` + `await this.unblockInstanceIfClear(instanceId)`.
  This is the single place both paths call after writing RESOLVED to the DB.
  **AC:** Method exists and is public. Calling it cancels any active escalation and triggers workflow recalculation if the instance is BLOCKED with no remaining open incidents.
  **Scope:** XS (1 file, ~10 lines)

- [ ] **Task 2** · `lib/services/remediation-service.ts`
  In `trackRemediationAttempt`, in the "Remediation complete" branch (around line 207):
  1. Remove the inline `EscalationService.cancelEscalation(incidentId)` call.
  2. After the `db.update`, call `await IncidentEngine.afterResolution(incidentId, incident.instanceId)`.
  3. Add `IncidentEngine` to the imports at the top of the file (or use a dynamic import to avoid circular deps — check if circular first).
  **AC:** Auto-resolution via protocol calls `afterResolution`. If the workflow was BLOCKED and this was the last open incident, it transitions out of BLOCKED.
  **Scope:** S (1 file, ~15 lines)

- [ ] **Task 3** · `lib/services/incident-engine.ts`
  In `resolveIncident` (line 907), replace the inline side-effect calls:
  ```ts
  // Before:
  await EscalationService.cancelEscalation(incidentId);
  await this.unblockInstanceIfClear(incident.instanceId);
  // After:
  await IncidentEngine.afterResolution(incidentId, incident.instanceId);
  ```
  **AC:** `resolveIncident` delegates to `afterResolution`. Behaviour unchanged for Camino A.
  **Scope:** XS (1 file, ~5 lines changed)

---
### Checkpoint: Phase 1
- [ ] `IncidentEngine.afterResolution` exists as public static
- [ ] Both `resolveIncident` and `trackRemediationAttempt` call it
- [ ] `pnpm run build` clean

---

## Phase 2 — Data Consistency (Spanish strings)

- [ ] **Task 4** · `lib/services/remediation-service.ts`
  Line 214: Change `resolution: 'Resolved through remediation protocol'`
  to `resolution: 'Remediación completada por protocolo'`.
  **AC:** Auto-resolved incidents show a Spanish resolution string in the DB and in the detail page.
  **Scope:** XS (1 file, 1 line)

- [ ] **Task 5** · `lib/services/remediation-service.ts`
  Lines 231, 308: Change English `message` return values to Spanish:
  - `'Remediation completed successfully'` → `'Remediación completada exitosamente'`
  - `'Remediation failed after maximum attempts'` → `'Remediación fallida: se agotaron los intentos'`
  **AC:** All user-visible strings returned by `trackRemediationAttempt` are in Spanish.
  **Scope:** XS (1 file, 2 lines)

---
### Checkpoint: Phase 2
- [ ] Resolution strings in DB are in Spanish
- [ ] `pnpm run build` clean

---

## Phase 3 — UI (RESOLVE_MANUAL CTA connects to resolve dialog)

- [ ] **Task 6** · `components/incidents/incident-action-panel.tsx`
  Add `onResolveManual?: () => void` to `IncidentActionPanelProps`.
  Thread it through to the render function.
  **AC:** Prop exists and TypeScript is happy.
  **Scope:** XS (1 file, ~3 lines)

- [ ] **Task 7** · `components/incidents/incident-action-panel.tsx`
  In the CTA section (around line 291), add a branch for `RESOLVE_MANUAL`:
  ```tsx
  {recommended.kind === 'RESOLVE_MANUAL' && onResolveManual && (
    <Button size="sm" variant="outline" onClick={onResolveManual} className="gap-1.5 text-xs font-semibold w-full sm:w-auto">
      Resolver manualmente
      <ArrowRight className="w-3.5 h-3.5" />
    </Button>
  )}
  ```
  **AC:** When `kind === 'RESOLVE_MANUAL'` and the prop is provided, a "Resolver manualmente" button appears in the panel CTA area. Clicking it fires `onResolveManual`.
  **Scope:** XS (1 file, ~8 lines)

- [ ] **Task 8** · `app/dashboard/incidents/[id]/page.tsx`
  Pass `onResolveManual={openResolveDialog}` to `<IncidentActionPanel>`.
  `openResolveDialog` already exists (added in the previous critique-fix plan); it reads the draft from sessionStorage and opens the dialog.
  **AC:** When the panel shows RESOLVE_MANUAL and user clicks the button, the resolve dialog opens. Draft restoration works normally.
  **Scope:** XS (1 file, 1 line)

---
### Checkpoint: Complete
- [ ] All 8 tasks done
- [ ] `pnpm run build` passes with 0 errors
- [ ] Manual verify:
  - [ ] Trigger a remediation protocol to completion in dev → confirm workflow is no longer BLOCKED
  - [ ] Create an incident without a `remediationProtocol` → panel shows RESOLVE_MANUAL → click button → dialog opens
  - [ ] Check DB: `resolution` column shows Spanish text after protocol auto-resolve
