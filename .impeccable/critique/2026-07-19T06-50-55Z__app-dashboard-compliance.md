---
target: app/dashboard/compliance (compliance main + SAT + IMSS + Expediente pages)
total_score: 22
p0_count: 1
p1_count: 2
timestamp: 2026-07-19T06-50-55Z
slug: app-dashboard-compliance
---
Method: dual-agent (A: ses_086de2864ffeskBkPaF3v2eMBZ · B: CLI detect.mjs)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3/4 | Spinners present; no progress indication for file generation (SUA/IDSE) |
| 2 | Match System / Real World | 2/4 | Mixed English/Spanish across pages; Info tab reads like a legal textbook |
| 3 | User Control and Freedom | 3/4 | No breadcrumbs in deep sub-pages; browser back only |
| 4 | Consistency and Standards | 2/4 | Shadows exist in corporate grid but not elsewhere; purple used for NOM-035 but not in palette; language switches between pages |
| 5 | Error Prevention | 2/4 | Bug: `companyId={selectedBranch ? '' : ''}` always empty (P0). No destructive-action confirmations |
| 6 | Recognition Rather Than Recall | 2/4 | 7-tab + sub-tabs + 14 route files forces navigation recall; no "you are here" indicators |
| 7 | Flexibility and Efficiency | 3/4 | Branch selector well-placed; no bulk actions for power users |
| 8 | Aesthetic and Minimalist Design | 2/4 | 4-card stat row repeated identically on 6+ pages; inconsistent shadow use; Info tab is a content dump |
| 9 | Error Recovery | 2/4 | Toast errors with no guidance on how to fix or retry |
| 10 | Help and Documentation | 1/4 | Info tab is an educational wall of text; no tooltips, no contextual help, no search |
| **Total** | | **22/40** | **Acceptable — significant improvements needed** |

## Anti-Patterns Verdict

**LLM assessment**: Medium-high AI slop contamination. Three absolute bans violated: hero-metric template (the 4-card stat row on every page), identical card grids (same structure on 6+ pages), and glassmorphism (`backdrop-blur-sm` on corporate grid control bar). Two product-specific bans violated: shadows on cards (`shadow-md`/`shadow-lg` on corporate grid — directly contradicts Flat-By-Default Rule) and hardcoded purple (`text-purple-600`, `bg-purple-50`) for NOM-035 — not in the palette. The overall aesthetic reads as generic SaaS dashboard with compliance labels swapped in, not "purpose-built for HORECA." It lacks the confident, operational feel the brand calls for.

**Deterministic scan**: 4 advisory findings in `corporate-compliance-grid.tsx`: undocumented color `rgba(0,0,0,0.1)` (line 322, Tooltip border), border-radius `8px` outside the DESIGN.md scale (line 323, Tooltip), and `10px` font size off the type ramp (lines 373, 417 — inactive branch badge and criticality label). All advisory — no hard violations.

**Visual overlays**: No browser automation available in this session. Skipped.

## Overall Impression

The compliance section is functional but visually monotonous. Every sub-page follows the same 4-stat-card + tabs + cards formula. The strongest page is the Expediente (expandable employee document table) — it has actual interaction depth. The weakest is the Info tab, which is an educational article competing with operational tools for tab-bar real estate. The biggest opportunity: differentiate each sub-page's visual treatment by what kind of data it presents (stats vs documents vs forms) instead of stamping the same card grid everywhere.

## What's Working

1. **Export-first features**: NOM-251 PDF/CSV export, payroll export, compliance dashboard PDF — tangible outputs that operators can file with authorities. This aligns with "operational at every pixel."
2. **Progressive disclosure**: Corporate tab hidden for single-branch tenants. Smart.
3. **Consistent empty/loading states**: Icon + message pattern for empties, `Loader2` spinner for loading — uniform across all pages.

## Priority Issues

### P0 — Bug: Payroll export always broken
- **What**: `page.tsx:195` — `companyId={selectedBranch ? '' : ''}` evaluates to empty string always. PayrollExport receives `companyId=""` regardless of branch.
- **Why**: Feature is dead on arrival. User selects a branch, clicks into Nómina, gets a broken component.
- **Fix**: Change to `companyId={selectedBranch}`.
- **Suggested command**: `/impeccable harden`

### P1 — Shadows violate Flat-By-Default Rule
- **What**: `corporate-compliance-grid.tsx` uses `shadow-md` and `hover:shadow-lg` on 6+ cards (lines 215, 236, 255, 276, 303, 343). Directly contradicts DESIGN.md's explicit "no shadows on cards" rule.
- **Why**: Makes the interface feel like generic SaaS, not "command center." Erodes brand differentiation.
- **Fix**: Remove `shadow-md`/`shadow-lg` classes. Use tonal layering (background color shifts) for card hierarchy instead.
- **Suggested command**: `/impeccable polish`

### P1 — Hardcoded purple outside palette
- **What**: `page.tsx:146` uses `text-purple-600` on NOM-035 Brain icon. Info tab uses `bg-purple-50 border-purple-100 text-purple-900` (lines 306-316). Purple is not in any DESIGN.md token.
- **Why**: Color system drift. New team members won't know what colors are intentional. NOM-035 should use a tint of primary red or info blue.
- **Fix**: Replace with `text-info` (blue) or a muted variant of Operational Red.
- **Suggested command**: `/impeccable colorize`

### P2 — 4-card stat row overused across all sub-pages
- **What**: The hero-metric template (icon + big number + small label) appears identically on compliance, SAT, IMSS, expediente, overtime, and breaks pages. Same `grid-cols-1 md:grid-cols-4 gap-4` structure, same card component, same pattern.
- **Why**: Every compliance sub-page looks the same. Users can't visually differentiate "this is an alert page" from "this is a form page." The emotional urgency of compliance issues is flattened.
- **Fix**: Vary the lead component per page type. Alert-heavy pages should lead with a list or timeline; form pages should lead with the primary action; stat pages should lead with the single most important number, not four equal cards.
- **Suggested command**: `/impeccable layout`

### P2 — Mixed language (English/Spanish) throughout
- **What**: SAT page tabs: "Overview", "Valid RFCs", "Settings", "Salary Certificates", "Annual Tax Summary" — all English. IMSS page: "Active Employees", "Settings", "Compliance Status" — English. Main page: Spanish. Info tab: Spanish.
- **Why**: Forces Mexican restaurant managers to code-switch mid-session. Undermines "purpose-built for Mexican HORECA."
- **Fix**: Translate UI labels to Spanish consistently. Keep data values and technical terms (RFC, CURP, NOM) as-is.
- **Suggested command**: `/impeccable clarify`

### P3 — Nested tab overload
- **What**: Compliance main has 7 tabs, each with sub-tabs (IMSS has 5, SAT has 5, dashboard has 5), leading to sub-sub-pages with 14 route files. No breadcrumbs in deep paths.
- **Why**: Users lose positional awareness. Jordan (first-timer) won't know where `/compliance/imss/altas` fits.
- **Fix**: Add breadcrumbs; move SAT, IMSS, Nómina to sidebar sub-items instead of tabs; shorten the tab list to 3-4 operational categories.
- **Suggested command**: `/impeccable distill`

### P3 — Expediente table rows not keyboard accessible
- **What**: `expediente/page.tsx` — expandable table rows use `cursor-pointer` with `onClick`. No `onKeyDown`, no `role="button"`, no `tabIndex`. Keyboard-only users can't expand employee rows.
- **Why**: WCAG failure (non-text content must have keyboard alternative). Sam (accessibility-dependent user) is blocked.
- **Fix**: Add `onKeyDown` handler for Enter/Space, `tabIndex={0}`, and `role="button"`.
- **Suggested command**: `/impeccable audit`

### P3 — Fear-based compliance messaging
- **What**: Info tab: "Evita multas de COFEPRIS (hasta 16,000 UMAS)" — penalty-focused tone. Contradicts "Compliance as a byproduct, not a chore" and "Confidence without bureaucracy."
- **Why**: Compliance already carries anxiety for operators. The UI should project readiness, not threat.
- **Fix**: Reframe as operational benefits ("Keep your kitchens audit-ready," "Your inspection record is clean").
- **Suggested command**: `/impeccable clarify`

## Detector Findings

4 advisory issues in `corporate-compliance-grid.tsx`:
- Line 322: Undocumented color `rgba(0,0,0,0.1)` (Tooltip border)
- Line 323: Border-radius 8px outside DESIGN.md scale
- Lines 373, 417: Font size 10px off the type ramp (inactive branch badge, criticality count)

All advisory — no hard violations. The lack of hard violations means the code surface is broadly design-system compliant at the literal-check level, though the higher-level design issues (shadows, purple) are not caught by the detector.

## Persona Red Flags

**Alex (Power User) — operations manager, 15 branches**:
- No bulk actions. Overtime approvals, reminders, branch comparisons — all one-at-a-time.
- Branch selector changes scope but the dashboard doesn't show cross-branch comparison (only the Corporate tab does). Alex must switch contexts.
- Deep IA (compliance > imss > altas = 3-4 clicks). No shortcut path.

**Jordan (First-Timer) — new branch manager**:
- 7-tab page opens to "Dashboard" — but what's the difference from "Corporate"? Not explained anywhere.
- No onboarding hint about which tab does what. The "Info" tab seems helpful but is a wall of legal text.
- English tabs in a Spanish product are disorienting. "Settings" vs "Configuración" — Jordan might not know they're the same thing.

**Sam (Accessibility-Dependent)**:
- Expediente table expandable rows: no keyboard handler, no ARIA role, no tabIndex.
- `text-xs` (12px) in `text-muted-foreground` (oklch 0.50, ~50% lightness) — likely fails 4.5:1 contrast at small text sizes.
- Color-only compliance badges (green/amber/red) — no icon or text pattern for color vision deficiency.
- No `prefers-reduced-motion` found anywhere.

## Minor Observations

- `imss/page.tsx:48` — typo: `bassesData` should be `bajasData`
- `corporate-compliance-grid.tsx:118` — `await new Promise(resolve => setTimeout(resolve, 800))` adds an unconditional 800ms delay after the API call
- Info tab uses `Shield` icon — same icon as the PageHeader. Redundant.
- Page header description is Spanish but branch selector placeholder is also Spanish — inconsistent with the English tabs below.
- Page.tsx `page.tsx:119-126` — description paragraph is 200+ characters, overflows a reasonable prose measure.
- `compliance-dashboard.tsx` uses "en-US" date formatting in trend labels (month names), even though the audience is Mexican.
- Chart tooltip in corporate grid uses `rgba(0,0,0,0.1)` border and 8px radius — both outside the DESIGN.md tokens.
- The "Sparkles" icon with `animate-pulse` in corporate grid (line 229) is decorative motion that doesn't convey state.

## Questions to Consider

1. **Should Compliance be the command center it claims to be, or a monitoring dashboard?** Currently it's neither — it's a collection of sub-pages that all look the same. If this is the owner's "single pane of glass," the main Compliance landing page should summarize across NOM-251, NOM-035, IMSS, SAT — not require tab-hopping.

2. **What would happen if you removed the Info tab and served that content inline via tooltips or a `/docs` route?** The Info tab is the weakest part — it's educational content competing with operational tools. Users needing the fine of 16,000 UMAS don't need it as a top-level tab.

3. **The 4-card stat row is on 6+ pages. What if each page led with the ONE number the user should act on, not four equal numbers?** The expediente page's "67% compliance" and the IMSS page's "14 pending altas" are very different kinds of urgency. Same visual weight for both means urgency is invisible.
