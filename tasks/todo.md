# Todo: Evidence Gallery Overhaul

Source critique: `.impeccable/critique/2026-08-25T23-35-35Z__app-dashboard-evidence.md`
Full plan: `tasks/plan.md`

## Phase 1: API Contract

- [ ] Task 1: Truthful evidence payload (media type, title, TEXT content)
- [ ] Task 2: Filter parity + pagination + branch filter + date guard

**Checkpoint:** dev-server curl shows derived types/titles/`total`/`branchId`; old page still renders.

## Phase 2: Client Hardening

- [ ] Task 3: Fetch hardening (debounce 300 ms, AbortController, retry, skeleton grid, result count)
- [ ] Task 4: Accessibility P0 (button semantics on cards/rows, Label htmlFor/id, aria-labels)

**Checkpoint:** keyboard-only walkthrough passes; rapid typing = one in-flight request.

## Phase 3: Brand & Dimension

- [ ] Task 5: Re-tokenize visuals + stat row → inline summary strip
- [ ] Task 6: Trust controls (download, Eye wiring, TEXT content, image fallback, score 0)
- [ ] Task 7: Branch dimension (Sucursal filter, card caption, list column)
- [ ] Task 8: Language & labels polish (Spanish type names, initials, badge copy, drift)

**Checkpoint:** build + lint clean; DESIGN.md rule review passes.
