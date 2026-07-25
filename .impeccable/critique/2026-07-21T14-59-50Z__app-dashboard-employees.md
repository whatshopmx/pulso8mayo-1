---
target: app/dashboard/employees
total_score: 21
p0_count: 0
p1_count: 3
timestamp: 2026-07-21T14-59-50Z
slug: app-dashboard-employees
---
# Impeccable Critique — Employee Module

⚠️ DEGRADED: single-context (no sub-agent tool exposed; browser auth-gated — visual inspection from source only)

**Target:** `app/dashboard/employees` (directory listing) + `app/dashboard/employees/[id]` (detail profile with 9 tabs)

---

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Loading spinner used instead of skeleton states; no inline progress on tab data fetches |
| 2 | Match System / Real World | 3 | Good use of domain vocabulary (CURP, RFC, NSS); minor English-only labels in a Spanish product |
| 3 | User Control and Freedom | 2 | No undo on destructive actions; "Mark Complete" fires immediately; window.location.reload() loses scroll |
| 4 | Consistency and Standards | 2 | statusColors + statusLabels duplicated across 3 files; card status uses raw Tailwind classes vs Badge variants |
| 5 | Error Prevention | 2 | "Archive Employee" dropdown has no confirmation; bulk actions are stubs; canEdit recalculated independently |
| 6 | Recognition Rather Than Recall | 3 | Tabs have icons + labels (hidden on mobile = icon-only); dropdown menus labeled; search has placeholder |
| 7 | Flexibility and Efficiency | 1 | No keyboard shortcuts; no batch status changes; no column sorting; no saved filters; bulk actions are stubs |
| 8 | Aesthetic and Minimalist Design | 3 | Clean structure; good use of Cards and tonal layering; some tab padding inconsistency |
| 9 | Error Recovery | 2 | Toast messages for API errors but no retry mechanism; generic error messages |
| 10 | Help and Documentation | 1 | No tooltips, no contextual help, no inline guidance for complex fields |
| **Total** | | **21/40** | **Acceptable — significant improvements needed** |

---

## Anti-Patterns Verdict

### LLM Assessment

Does not read as AI-generated. Follows standard product-UI patterns with shadcn/ui. Avoids slop tells. Problem is scaffold without substance: mock data shipped as real, stub handlers, placeholder cards.

### Deterministic Scan

detect.mjs returned [] — zero findings (TSX source, no raw HTML rules triggered).

---

## Overall Impression

Solid bones, empty rooms. The directory and profile layout follow good product patterns. Experience stalls on scratch: fake attendance numbers, no-op bulk actions, mobile tab overflow. Biggest opportunity: make the 9-tab detail page functional and navigable.

---

## What's Working

1. Component vocabulary consistent (shadcn/ui Card, Badge, Table, Avatar, Dialog). InfoField helper is clean.
2. Empty states exist and have personality with icons, headings, descriptions, and CTAs.
3. Directory list/grid toggle is thoughtful with proper aria-labels.

---

## Priority Issues

### [P1] Nine-Tab Navigation Overflow and Mobile Collapse
grid-cols-9 forces 9 tabs in one row. Below ~768px, icon-only with tiny touch targets. Fix: scrollable TabsList or collapse to Select on mobile.

### [P1] Hardcoded Mock Data Shipped as Real UI
attendance-tab.tsx hardcodes currentWeekHours=32.5 etc. Bulk actions log to console. Schedule Calendar is "coming soon" stub. Fix: compute from real data or hide.

### [P1] Duplicated Status Mapping and Inconsistent Styling
statusColors/statusLabels defined in 3 files. Card uses different system. Fix: extract shared employee-status utility.

### [P2] No Confirmation on Destructive Actions
"Archive Employee" has no handler. "Mark Complete" uses window.location.reload() with no confirmation. Fix: add AlertDialog, replace reload with state mutation.

### [P2] Loading State Uses Spinner Instead of Skeleton
DESIGN.md says skeletons, not spinners. Fix: replace Loader2 with skeleton components.

---

## Persona Red Flags

**Alex (Power User):** No column sorting, no keyboard shortcuts, stub bulk actions, raw HTML select in pagination.

**Jordan (First-Timer):** 9 icon-only tabs on mobile, no tooltips on CURP/RFC/CLABE fields, buddy/mentor shows raw User IDs.

**Sam (Accessibility):** Missing aria-labels on tab triggers, unlabeled select, color-only status differentiation on onboarding steps.

---

## Minor Observations

1. i18n inconsistency: es locale for dates, English UI labels, Spanish document type labels mixed
2. profile: any types defeat TypeScript purpose
3. Missing text-wrap rules from DESIGN.md
4. showEditDialog state unused (no dialog rendered)
5. Raw select in pagination breaks design system
6. hover:shadow-md on EmployeeCard violates flat-by-default
7. EmployeeCard shows Edit button regardless of canEdit

---

## Questions to Consider

- Why does a single employee need 9 tabs? Could tabs be reduced to 5-6?
- Who is the primary user — employee or manager?
- What does "Message" actually do?
