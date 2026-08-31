# TODO: Incidents UX — Critique Fixes

## Phase 1 — Signal Clarity

- [x] **Task 1** · `components/incidents/incident-list.tsx`
  Add `bg-destructive/5` row tint for CRITICAL/FATAL rows using a `data-severity` attribute on `<TableRow>`. Increase badge border opacity for CRITICAL: `border-destructive/40` (up from `/20`). FATAL: `border-destructive/50`.
  **AC:** CRITICAL and FATAL rows have a visible background tint; WARNING rows do not. Badge borders are heavier for the two highest severities.
  **Scope:** S (1 file)

- [x] **Task 2** · `components/incidents/incident-list.tsx`
  Reorder severity Select options to FATAL → CRITICAL → HIGH → WARNING. Change default sort to `severity` (asc) with `createdAt` as secondary sort applied in the filter pipeline.
  **AC:** Select shows FATAL first. Default page load shows most critical incidents first.
  **Scope:** XS (1 file, ~15 lines)

---
### Checkpoint: Phase 1
- [x] CRITICAL/FATAL rows visually distinct from WARNING at a glance
- [x] Severity filter select ordered by weight
- [x] `pnpm run build` clean

---

## Phase 2 — Accessibility & Labels

- [x] **Task 3** · `app/dashboard/incidents/page.tsx`
  Add `aria-label` props to `AlertCircle`, `AlertTriangle`, `XCircle`, `CheckCircle2`, and `ShieldAlert` icons in the summary strip. Use descriptive labels: `"Icono: total de incidentes"`, `"Icono: incidentes activos"`, etc.
  **AC:** Each icon in the strip has an `aria-label`. Screen reader announces the icon purpose before the count.
  **Scope:** XS (1 file, ~10 lines)

- [x] **Task 4** · `app/dashboard/incidents/page.tsx`
  Remove the conditional `&&` guard around the `requiresAction` strip item. When `stats.requiresAction === 0`, render the item with `text-muted-foreground` for both the count and label (instead of hiding). Add a `title` tooltip on `ShieldAlert`: `"Incidentes con acciones de remediación pendientes de agendar."`.
  **AC:** `requiresAction` item always renders in the strip. When 0, it renders muted. ShieldAlert has a tooltip.
  **Scope:** XS (1 file, ~20 lines)

- [x] **Task 5** · `components/incidents/incident-list.tsx` + `app/dashboard/incidents/[id]/page.tsx`
  Wrap the resolve Textarea with a visually hidden `<label>` (`sr-only`) associated via `htmlFor`/`id`. Both the list resolve dialog and the detail page resolve dialog need this fix.
  **AC:** Textarea has an associated `<label>`. Screen reader announces the field label on focus.
  **Scope:** S (2 files, ~8 lines each)

---
### Checkpoint: Phase 2
- [x] Screen reader describes every summary strip icon
- [x] `requiresAction` count always visible (muted at 0)
- [x] Both resolve Textareas have associated `<label>` elements
- [x] `pnpm run build` clean

---

## Phase 3 — Detail Page Cleanup

- [x] **Task 6** · `app/dashboard/incidents/[id]/page.tsx`
  Replace the 4th metadata card (Workflow/instanceId when not resolved) with a "Tiempo activo" card showing `formatDistanceToNow(new Date(incident.createdAt))`. Move `instanceId` to a collapsed `<details>` element at the bottom of the page (inside a "Detalles técnicos" section).
  **AC:** 4th card shows "Tiempo activo" with a human-readable duration. `instanceId` is still accessible (for support/dev) in a collapsed details section. No card uses truncated UUID as primary content.
  **Scope:** S (1 file, ~30 lines changed)

- [x] **Task 7** · `app/dashboard/incidents/[id]/page.tsx`
  Persist the resolve dialog draft note in `sessionStorage` with key `resolve-note-${incidentId}`. Restore on dialog open. Clear on successful resolve. Add a minimum-length hint below the Textarea: `"Mínimo 20 caracteres"` (shown with count, e.g. "12 / 20").
  **AC:** Typing a note, closing dialog, reopening restores the note. Successful resolve clears the draft. A character count hint is visible below the Textarea.
  **Scope:** S (1 file, ~40 lines)

---
### Checkpoint: Phase 3
- [x] Detail page 4th card shows "Tiempo activo", not a UUID
- [x] instanceId accessible in collapsed section
- [x] Resolve note persists on dialog close/reopen for the same incident
- [x] Character count hint visible in resolve dialog
- [x] `pnpm run build` clean

---

## Phase 4 — Empty State

- [x] **Task 8** · `app/dashboard/incidents/page.tsx`
  When `stats.total === 0` AND `!sinSucursal`, render an affirming empty state instead of the summary strip + list. Use a CheckCircle2 icon in emerald, headline "Operaciones limpias", subtext "No hay incidentes activos. Todo en orden." No card, no hero block — a simple centered section within the existing `space-y-6` flow.
  **AC:** Zero-incident state shows the affirming view. Non-zero state shows the strip + list as before. `sinSucursal` state takes priority and still shows the amber warning.
  **Scope:** XS (1 file, ~25 lines)

---
### Checkpoint: Complete
- [x] All 8 tasks done
- [x] CRITICAL rows tinted; filter ordered; aria-labels present; requiresAction always visible; Textareas labeled; instanceId replaced; draft persists; zero state affirming
- [x] `pnpm run build` passes with 0 TypeScript errors
- [x] Manual verification:
  - [x] Visit `/dashboard/incidents` — CRITICAL rows have background tint
  - [x] Filter to "Crítico" — only CRITICAL rows shown
  - [x] Open a resolve dialog, type a note, press Escape, reopen — note is restored
  - [x] Force `stats.total = 0` in dev — affirming empty state visible
