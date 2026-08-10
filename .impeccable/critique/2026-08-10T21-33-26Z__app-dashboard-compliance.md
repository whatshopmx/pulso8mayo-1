---
target: app/dashboard/compliance/
total_score: 19
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
timestamp: 2026-08-10T21-33-26Z
slug: app-dashboard-compliance
---
# Critique — app/dashboard/compliance/ (Pulso HORECA)

Operation mode surface: compliance command center for Mexican restaurant chains (NOM-251/NOM-035, IMSS, SAT, payroll, labor-break compliance).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Spinners everywhere but no skeletons; compliance-dashboard conflates empty with error ("No compliance data available"); imss/sat swallow failures to console leaving "0" KPIs with no toast |
| 2 | Match System / Real World | 1 | Pervasive Spanglish on the main branded surface ("Total Workflows", "Upcoming Deadlines", "No active alerts", "critical", "Con Issues", "Need IMSS registration", "En Break") for Mexican managers who read Spanish |
| 3 | User Control and Freedom | 2 | Reject-overtime dialog has cancel; but schedule-template delete has no confirmation or undo; nested tab stacks provide no escape affordance |
| 4 | Consistency and Standards | 1 | ≥90% compliance renders **red** (`Badge variant="default"` = primary) in the dashboard Scorecards and "Por Sucursal" tabs but **green** in the sibling CorporateComplianceGrid; two KPI-card systems, two header systems, two branch-scope mechanisms |
| 5 | Error Prevention | 2 | Good: reject reason required, NOM-251 period validation, IMSS select-all. Bad: delete without confirm, `text-[10px]` below the label floor, payroll tab passes `selectedBranchId \|\| ''` as companyId |
| 6 | Recognition Rather Than Recall | 2 | Visible tabs, good empty states with CTAs; but icon-only delete button (no label/aria), split branch scope across header select + in-page select forces recall of "which branch am I looking at?" |
| 7 | Flexibility and Efficiency | 3 | Corporate grid: segmented 7/30/90 control, inline WhatsApp reminder per row with tooltips; IMSS altas: batch select-all. But no keyboard shortcuts, per-row-only overtime approval, duplicated nav |
| 8 | Aesthetic and Minimalist | 2 | MetricCard + chart clean where used; but 6→5→2 nested tabs, four-KPI rows on every page, hand-rolled cards with raw Tailwind 600-level colors add noise |
| 9 | Error Recovery | 2 | Breaks/overtime/schedules toast errors; but compliance-dashboard fails silently to "No compliance data available", imss/sat never surface errors, no retry affordance |
| 10 | Help and Documentation | 2 | Legal-reference cards on breaks/overtime/schedules are genuinely useful contextual help; no searchable docs, no in-flow guidance for the header-scope dependency |
| **Total** | | **19/40** | **Poor (borderline Acceptable)** |

## Design Specificity Verdict

The section is a patchwork. The **CorporateComplianceGrid** is the most product-authored surface in the project: semáforo vocabulary, manager names, per-row WhatsApp reminders, OKLCH token colors, thoughtful Spanish ("Semáforo de Sucursales", "Recordatorio WA" with disabled+tooltip states). The root compliance dashboard uses canonical MetricCard and the chart config correctly. But the sub-pages (breaks, overtime, imss, sat, schedules) are generic CRUD tables with raw Tailwind color classes and mixed-language copy — interchangeable with any HR backoffice. The compliance identity ("command center, not government portal") lives in a few components, not across the section.

Deterministic scan: detector on `app/dashboard/compliance/` → clean (0 findings). Detector on `components/compliance/` (the pages' actual implementations) → 3 advisories: `text-[10px]` ×2 (below the 12px Label-Floor) and `borderRadius: 8px` (off the rounded scale) in corporate-compliance-grid — all three real, all three in the same component that is otherwise the best in the section. The detector could not see the red-vs-green badge collision, the Spanglish, or the orphaned routes — those came from the design review.

Browser visualization: not available in this session (managed-session policy layer fails validation, and the headless Chrome that does launch cannot resolve DNS — `net::ERR_NAME_NOT_RESOLVED` even for `https://example.com`). No reliable user-visible overlay; fallback signal = source-level review + deterministic scan.

## Overall Impression

Functioning, data-rich, and genuinely helpful in spots (corporate semáforo, legal-requirement cards, IMSS batch tools) — but it behaves like three different products joined by one sidebar icon. The single biggest opportunity: the compliance dashboard's scorecards tell the owner their best branch is red while the corporate grid says the same number is green. When compliance is the product, the color that means "all good" must be the same everywhere or the system loses the trust it exists to build.

## What's Working

1. **CorporateComplianceGrid (Vista Corporativa)** — semáforo legend, manager names, per-row WhatsApp reminder with disabled/tooltip states and color-from-OKLCH getters. This is DESIGN.md's "one pane of glass" made real, and the strongest craft in the section.
2. **Contextual legal help cards** — breaks, overtime, and schedules each carry a "Según la Ley Federal del Trabajo" reference block. Compliance as a byproduct: the user learns the rule exactly where they act on it.
3. **Empty states with purpose** — schedules empty state offers a CTA ("Crear Plantilla"); alerts/deadlines use icon + reassurance copy. Most tables degrade gracefully.

## Priority Issues

1. **[P1] Red means "excellent" in the dashboard, green means "excellent" in the corporate grid — same number, opposite meanings**
   - What: `compliance-dashboard.tsx` Scorecards (`variant={rate >= 90 ? "default" : ...}`) and "Por Sucursal" tab render ≥90% with `default` = Operational Red + check/"Excelente", while `corporate-compliance-grid.tsx` `getComplianceColor` renders ≥90% green. A 98% branch is simultaneously red and green in this section.
   - Why it matters: owners make compliance decisions off this color. A red "Excelente" badge is a false alarm; a wall of red KPI cards reads as crisis. Trust in a compliance product is the product.
   - Fix: single shared rate→semantic mapping (util), use the existing `success` Badge variant for ≥90, keep green/yellow/red; delete the `default` mapping for compliance levels.
   - Suggested command: $impeccable colorize

2. **[P1] Compliance sub-pages are unreachable from navigation — and half of them duplicate /dashboard/labor/**
   - What: `breaks`, `overtime`, `schedules`, `expediente`, `imss/*`, `sat/*`, `payroll` under `/dashboard/compliance/` are not linked in the sidebar (Cumplimiento shows only Dashboard/Auditoría/Protección Civil/Reportes/Verificaciones AI; IMSS is reachable only via cron notification URL). Meanwhile `labor/breaks` and `labor/overtime` exist as separate implementations and ARE in the sidebar.
   - Why it matters: features that can't be found don't exist for users; two implementations of "breaks" and "overtime" invite drift (they already differ — Breaks page even names its card "Con Issues"). An owner hunting for IMSS obligations will not find them.
   - Fix: decide one canonical home per capability (consolidate compliance breaks/overtime into the Personal set or link them in Cumplimiento), then dedupe the code.
   - Suggested command: $impeccable shape

3. **[P1] Spanglish across the section, including the auditor-facing PDF export**
   - What: `compliance-dashboard.tsx` mixes "Cumplimiento General" with "Total Workflows", "Upcoming Deadlines", "No active alerts", subtitle "critical"; breaks card "Con Issues"; imss "Need IMSS registration"; and `exportToPDF` emits an entirely-English "Compliance Dashboard Report" with hard-coded Tailwind blue-500 table headers [59,130,246].
   - Why it matters: the audience is Mexican restaurant owners/GERENTES; the PDF is a document a manager may literally hand to COFEPRIS/IMSS. English headers plus off-brand blue undermine the "confident, no-bureaucracy" voice and the Operational Red identity.
   - Fix: complete es-MX localization pass; brand the PDF tables with the Neutral/Operational Red palette instead of blue; format dates `es-MX`.
   - Suggested command: $impeccable clarify

4. **[P1] Two systems for the same things: KPI cards, page headers, and branch scope**
   - What: breaks/overtime/imss/sat hand-roll KPI cards with raw `text-green-600`/`text-orange-600`/`text-blue-600` while dashboard + corporate grid use `MetricCard` (which exists precisely to replace these — see its docstring); sub-pages hand-roll `text-3xl font-bold` headers vs `PageHeader` on the root; branch scope lives both in the header control (AD-1) and in an in-page Select on the Dashboard tab.
   - Why it matters: the design system explicitly unifies KPI cards and headers; the section bypasses it. Two branch-scope controls means the manager must hold "which branch is selected now?" in working memory across the page.
   - Fix: migrate sub-page KPI rows to MetricCard with semantic tones; use PageHeader everywhere; surface the active scope + let the in-page dashboard select drive a visible scope chip.
   - Suggested command: $impeccable layout

5. **[P2] Silent failures masquerade as "no data"**
   - What: compliance-dashboard's catch leaves `data` null → renders "No compliance data available" for BOTH empty data and API failure; imss/sat `catch` only `console.error` → user sees permanent "0%"/"Sin datos" with no toast; no retry anywhere.
   - Why it matters: an owner who can't load compliance data believes compliance is zero. Distinguishing "no records" from "couldn't load" is a trust and correctness issue, and error==empty hides outages.
   - Fix: typed state (loading/empty/error), error view with retry button + toast, distinguish zero-records from failure.
   - Suggested command: $impeccable harden

6. **[P2] Nested tab stacks and dense control rows exceed the ≤4 working-memory rule**
   - What: root page = 6 tabs; Dashboard tab = 2 Selects + export button + 5 more tabs; IMSS tab = 2 more tabs. The Dashboard tab's first screen exposes 8 simultaneous controls/options.
   - Why it matters: the primary audience is a busy owner overseeing 15 branches who decided to check one thing; the default view asks them to re-decide 8 times.
   - Fix: flat the top level (make Vista Corporativa/Dashboard one view with inline scope), or progressive-disclosure the Dashboard sub-tabs; keep selects on demand, not always visible.
   - Suggested command: $impeccable distill

7. **[P3] Detector-verified: 10px text below the documented label floor + 8px radius off-scale (corporate-compliance-grid)**
   - What: `text-[10px]` on the "Inactiva" badge and the "(N Críticas)" span; `borderRadius: 8px` in the chart tooltip contentStyle, plus a tooltip box-shadow that violates flat-by-default.
   - Why it matters: 10px is unreadable at arm's length in a kitchen-grade tablet; the type floor exists specifically to prevent it; radius/shadow drift from the tokens.
   - Fix: `text-xs`, `rounded-md` token, drop the tooltip shadow.
   - Suggested command: $impeccable typeset

8. **[P3] Delete without confirmation + icon-only button; day-picker toggles lack pressed semantics**
   - What: schedules `deleteTemplate` fires DELETE with no confirm and the row button is `<Trash2>` with no aria-label; the day-of-week picker uses Buttons as toggles without aria-pressed.
   - Why it matters: a misplaced tap deletes a shift template; screen-reader users can't identify the icon-only button or hear toggle state.
   - Fix: confirm dialog or optimistic-undo; add label/aria; use a real toggle control with aria-pressed.
   - Suggested command: $impeccable harden

## Persona Red Flags

**Alex (Power User)** — Overtime approval is strictly row-by-row: no bulk-approve, no keyboard shortcut, and the row buttons disable globally while any request is in flight (`actionLoading`), so approving is sequential and slow. Duplicate breaks/overtime implementations force extra hunting; no way to jump to "worst branch" from the dashboard — 5 sub-tabs deep.

**Sam (Accessibility-Dependent)** — Icon-only Trash2 without aria-label; day-of-week Buttons-as-toggles with no aria-pressed; `text-[10px]` micro-badges; "Iniciar Break"/"En Break" states rely on icon+text (good) but the KPI card colors (green/orange/blue numbers) carry meaning without a non-color channel.

**Owner of 3–15 branches (project-specific)** — Arrives at Compliance → sees a red "Excelente" badge on a 98% branch and stops trusting the panel. IMSS "Estado de Cumplimiento" is an opaque computed percentage with no drill-down. Finding IMSS/expediente features at all requires knowing the URL — “single pane of glass” breaks the moment a top-level obligation (IMSS registration) isn't in the pane.

**GERENTE (branch manager, project-specific)** — Forced into the header scope control for NOM-251/NOM-035 with a dead-end notice if scope is "Todas"; breaks/overtime pages show every branch's rows with no branch filter, so a single-branch manager wades through all branches' data to find their own team.

## Minor Observations

- Payroll tab passes `companyId={selectedBranchId || ''}` while the standalone payroll page fetches real companyId from `/api/me` — two data sources for the same widget, empty string at "Todas" scope.
- `TabsList grid-cols-3 lg:grid-cols-6` on the root: six text+icon triggers on one row at desktop width; cramped in Spanish.
- The default badge for breaks is a red "default" overwritten with `className="bg-green-600"` — works, but signals the missing success variant.
- Compliance-dashboard chart X-axis formats dates with `en-US` while the page is Spanish — inconsistent month names.
- PDF "Período" line is Spanish then the document body is English — the file reads half-translated.
- `variant="default"` on thresholds elsewhere (equipment outside scope) suggests the pattern is systemic, not page-local.
- Sat page "Sin datos" card is an honest placeholder but has no path guidance beyond the button; fine as-is.

## Questions to Consider

- What if the section had ONE rate→color mapping in `lib/utils` and every badge/progress/chart consumed it?
- Does the Dashboard tab need both an in-page branch Select AND the header scope control — which one should own the truth?
- What would the compliance section look like if IMSS/expediente/SAT were organized by obligation deadline instead of by institution?
- Should the breaks/overtime features live under Personal or Cumplimiento — or nowhere duplicated?
- What does "Excelente" mean if a red badge can say it?
