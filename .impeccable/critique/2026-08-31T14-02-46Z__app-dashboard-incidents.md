---
target: app/dashboard/incidents
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-31T14-02-46Z
slug: app-dashboard-incidents
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | List page has no loading state beyond Suspense skeleton; inline strip shows counts but no last-updated time |
| 2 | Match Between System / Real World | 3 | `AWAITING_EXTERNAL` and `ESCALATED` statuses lack human labels in the list view; detail page translates them correctly |
| 3 | User Control and Freedom | 2 | No filter, sort, or search on the list; 50-row page with no way to narrow scope before diving into a detail |
| 4 | Consistency and Standards | 3 | Severity/status badge colors differ slightly between list and detail (inline span vs. Badge component) |
| 5 | Error Prevention | 2 | "Resolver incidente" confirms but doesn't warn if the same incident is already being remediated mid-step; resolve dialog accepts an empty note until the button disables |
| 6 | Recognition Rather Than Recall | 2 | Status strip is icon+count with no label at glance for the `requiresAction` count; the icon alone (ShieldAlert) requires knowing the system |
| 7 | Flexibility and Efficiency | 1 | No keyboard shortcut to open incident, no bulk-resolve, no filter/sort, no date range picker for large datasets |
| 8 | Aesthetic and Minimalist Design | 3 | Inline strip is clean; detail page 4-card metadata row is good. Minor: Workflow instanceId card adds noise for most users |
| 9 | Error Recovery | 3 | `error.tsx` boundary is clear; detail page error state has both Retry and Back buttons |
| 10 | Help and Documentation | 1 | No contextual help on any status, severity, or what "requieren acción" means at all |
| **Total** | | **23/40** | **Acceptable — significant improvements needed** |

## Design Specificity Verdict

**LLM assessment:** The incidents module is functionally complete but tonally generic. The Operational Red from DESIGN.md never appears on the list or detail pages; every severity badge reaches for destructive/amber/orange tokens that could have come from shadcn defaults. The inline summary strip is the best-authored moment on the page. The "Command Center" north star from DESIGN.md is absent: nothing here signals authority or operational confidence to a HORECA owner scanning across 10 branches.

**Deterministic scan:** `detect.mjs` returned exit 0 with no findings on the `app/dashboard/incidents` directory. No automated violations.

**Visual overlays:** Browser not available in this session — source-only review.

## Overall Impression

A well-structured but visually under-invested surface. The data model and logic are solid. None of that operational intelligence is felt on the screen. The list page reads as "rows of text with colored dots," and the detail page is four generic cards plus a timeline. The single biggest opportunity: make severity *felt*, not just labeled.

## What's Working

**1. The inline summary strip.** The flex-wrap summary strip gives the scanning owner exactly the five numbers they need without cards or a hero block. Conditional rendering of `requiresAction` only when non-zero is a smart choice.

**2. Role-scoped branch isolation.** `resolveBranchScope()` enforcing data boundaries by role is the right call and the `sinSucursal` warning state is honest and actionable.

**3. Error boundary coverage.** Both `error.tsx` (page-level) and the detail's inline error state give two distinct recovery paths with plain, specific copy.

## Priority Issues

**[P1] Severity is visual noise, not a signal**
- **What:** CRITICAL, FATAL, HIGH, and WARNING badges use color-adjacent tokens. A list of incidents looks like a uniform wash of red-orange.
- **Why it matters:** The product's core value — "clear view of what's happening across all locations, with the authority to act" — collapses if CRITICAL doesn't register differently from WARNING at a glance.
- **Fix:** Establish severity hierarchy with distinct visual weight. CRITICAL/FATAL: red pill + left-edge row tint (`bg-destructive/5`). Add a subtle attention class only on CRITICAL rows. WARNING: amber, no special treatment beyond badge.
- **Suggested command:** `$impeccable colorize app/dashboard/incidents`

**[P1] No filtering or search on a list capped at 50**
- **What:** Users can only page through 50 incidents with no filter by severity, status, branch, or date range.
- **Why it matters:** A high-incident day can produce 20+ incidents in hours. The tool becomes unusable at scale.
- **Fix:** Add filter chips: `[Severidad ▾] [Estado ▾] [Fecha ▾]`. Server-driven via `searchParams` in Next.js App Router.
- **Suggested command:** `$impeccable shape app/dashboard/incidents`

**[P2] The Workflow instanceId card is noise for 95% of users**
- **What:** A truncated `instanceId` card on the detail page adds a working-memory item with no actionable outcome for operators.
- **Fix:** Move `instanceId` to a collapsed "Detalles técnicos" section. Replace the 4th card slot with time since detection or responsible assignee.
- **Suggested command:** `$impeccable distill app/dashboard/incidents/[id]`

**[P2] `requiresAction` count has no explanation at the point of discovery**
- **What:** `ShieldAlert` + amber number in the strip appears without an always-visible label. First-time users don't know what it means.
- **Fix:** Always show the label (even "0 requieren acción" in muted style). Add a tooltip: "Incidentes con acciones de remediación pendientes de agendar."
- **Suggested command:** `$impeccable clarify app/dashboard/incidents`

**[P2] "Resolver incidente" note has no draft persistence**
- **What:** Escape closes the dialog and loses a typed resolution note. No minimum-length hint, no autosave.
- **Fix:** Persist draft in `sessionStorage` keyed on `incidentId`. Add minimum-length hint. Constraint Textarea to `min-h-[80px]`.
- **Suggested command:** `$impeccable harden app/dashboard/incidents/[id]`

## Persona Red Flags

**Alex (Power User — HORECA operations manager, 8 branches):**
- No keyboard navigation for row selection (no `j`/`k` shortcuts).
- No filter means visual scan of 50 rows to find CRITICAL incidents.
- Three clicks minimum to resolve (button → dialog → confirm). No shortcut path.
- Pagination without URL-reflected page means links to specific pages can't be shared.

**Sam (Accessibility-dependent user):**
- `AlertCircle`, `AlertTriangle`, `XCircle`, `CheckCircle2` in the summary strip have no `aria-label`.
- Color is the primary differentiator for severity badges. No pattern or text variant for colorblind users.
- Textarea in resolve dialog has no `<label>`, only a placeholder.
- Conditional `requiresAction` item may never be discovered by screen reader users.

**Sofia (HORECA owner, project-specific persona, mobile):**
- Workflow instanceId card still occupies a full slot on mobile with content she'll never use.
- `requiresAction` — the most urgent number — may wrap off-screen below the fold depending on count width.
- Page title "Incidentes" gives no at-a-glance status; Sofia has to read the strip every time to know if there's a fire.

## Minor Observations

- `text-3xl font-bold` on list H1 vs. `text-2xl font-bold` on detail H1 diverge from DESIGN.md's `Display` spec (not clamped).
- `·` separator uses `text-border` class — slightly too light in dark mode; consider `text-muted-foreground/60`.
- `sinSucursal` amber callout uses hardcoded `amber-200/60`/`amber-950/30` instead of `warning` design token.
- `font-mono text-xs` on instanceId is at the Label-Floor edge — borderline for kitchen/tablet screens.
- Detail page is `"use client"` with `useEffect` fetch — waterfall load that Server Components would eliminate, affecting skeleton quality.

## Questions to Consider

- "What does a manager see when there are zero incidents?" No empty state is currently coded — a brand opportunity disappears into whitespace.
- "Should severity be a filter axis or a sort axis — or both?" Default sort by `severity DESC, createdAt DESC` may serve operators better than pure chronological.
- "What does the owner do with a CRITICAL incident at 2am on mobile?" Is there a WhatsApp integration path for high-severity events that should be surfaced here?
