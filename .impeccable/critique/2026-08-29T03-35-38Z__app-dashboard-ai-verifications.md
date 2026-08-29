---
target: app/dashboard/ai-verifications
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-08-29T03-35-38Z
slug: app-dashboard-ai-verifications
---
# Design Critique: app/dashboard/ai-verifications

### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2/4 | No integration with global `useBranch()` context; full-page loader replaces entire table |
| 2 | Match System / Real World | 2/4 | Raw monospace UUIDs without friendly workflow links; "Ver Flujo" and "Ver Incidente" are inert dummy buttons |
| 3 | User Control and Freedom | 2/4 | Filter operates only on the first 50 client-side records; no quick way to navigate to related workflows |
| 4 | Consistency and Standards | 2/4 | Does not use standard `PageContainer` or `PageHeader`; uses inline custom empty state instead of shared component |
| 5 | Error Prevention | 3/4 | Export formats CSV without human-readable dates or status translations |
| 6 | Recognition Rather Than Recall | 2/4 | AI confidence percentage shown as raw number without indicating approval threshold (e.g. 85% rule) |
| 7 | Flexibility and Efficiency | 2/4 | No search filter by workflow name, assignee, or date; no batch approval or manual review resolution |
| 8 | Aesthetic and Minimalist Design | 2/4 | Rainbow text colors (`text-green-600`, `text-red-600`, `text-orange-600`) clash with Pulso's OKLCH design tokens |
| 9 | Help Users Recognize & Recover from Errors | 2/4 | Fetch failure only triggers a fleeting toast; no in-page `ErrorState` with retry button |
| 10 | Help and Documentation | 2/4 | No explanatory guidance on how AI vision models analyze evidence or how manual review works |
| **Total** | | **21/40** | **Acceptable (52.5%)** |

### Design Specificity Verdict

**LLM assessment**: The page functions as a basic viewer for AI verification logs, but lacks the polish and operational context required for HORECA compliance audits. It displays raw technical IDs (`instanceId`, `stepId`) rather than actionable operational workflows (e.g., "Apertura de Cocina - Verificación de Termómetros"). The action buttons ("Ver Flujo", "Ver Incidente") are non-functional placeholders. Furthermore, the visual system deviates from Pulso standards by using arbitrary text colors instead of semantic badges, missing the standard page header/container scaffolding, and lacking manual approval/override controls for managers.

**Deterministic scan**: `detect.mjs` returned 0 hard token syntax errors, confirming no banned raw Hex codes or missing Tailwind classes, but architectural and UX inconsistencies are prominent across layout, accessibility, and state handling.

### Overall Impression
A functional start for AI audit tracking, but currently disconnected from Pulso's global branch context and design system. Transforming it into an operational command center for AI verifications requires standard layout components, functional navigation to workflows/incidents, clear threshold indicators, and manual review resolution actions.

### What's Working
1. **Master-Detail Flow**: Split layout allowing inspection of full photo evidence alongside the verification timeline.
2. **AI Metric Breakdown**: Clear capture of confidence score, AI provider (e.g., Claude Vision / OpenAI), and failure reasons.
3. **Data Export**: Built-in CSV export for external compliance archiving and reporting.

### Priority Issues

#### [P0] Dummy Action Buttons & Disconnected Navigation
- **Why it matters**: Managers inspecting a failed or escalated verification click "Ver Flujo" or "Ver Incidente" expecting to see the workflow execution or create a corrective action, but nothing happens.
- **Fix**: Wire buttons to dynamic routes (e.g., `/dashboard/workflows/review/${instanceId}` or `/dashboard/incidents?verificationId=${id}`) and provide proper fallbacks.
- **Suggested command**: `$impeccable harden app/dashboard/ai-verifications`

#### [P1] Missing Global Branch Context Integration
- **Why it matters**: Changing the active branch in the top header does not filter AI verifications because the page uses `session?.user?.branchId` rather than `useBranch().selectedBranchId`.
- **Fix**: Consume `useBranch()` and re-fetch when `selectedBranchId` changes.
- **Suggested command**: `$impeccable harden app/dashboard/ai-verifications`

#### [P1] Layout & Design System Inconsistencies
- **Why it matters**: The page uses a generic `container mx-auto py-8 space-y-8`, ad-hoc stats cards with hardcoded utility colors (`text-green-600`, `text-red-600`), and a local `cn` fallback function, breaking visual rhythm with the rest of Pulso.
- **Fix**: Standardize with `PageContainer`, `PageHeader`, `EmptyState`, and `ErrorState` from `@/components/shared`, and use semantic OKLCH badge tokens.
- **Suggested command**: `$impeccable layout app/dashboard/ai-verifications`

#### [P2] Unclear AI Confidence Thresholds & Decision Feedback
- **Why it matters**: Operators see "78% Confianza" but don't know whether this auto-approved or was flagged. Pulso's core model auto-approves >=85%, flags for review between 60-84%, and rejects <60%.
- **Fix**: Add a visual threshold guide and status explanation chip explaining why an item was approved, escalated, or requires review.
- **Suggested command**: `$impeccable clarify app/dashboard/ai-verifications`

#### [P2] Lack of Search and Operational Filter Controls
- **Why it matters**: Finding a specific verification among dozens of daily checklist steps requires scrolling through all records.
- **Fix**: Add a real-time search input for workflow name, assignee, and failure reason.
- **Suggested command**: `$impeccable harden app/dashboard/ai-verifications`

### Persona Red Flags

- **Alex (Operations Director / Power User)**: Cannot filter by branch dynamically from the dashboard header, cannot search by employee name, and cannot execute bulk manual approvals for borderline evidence.
- **Jordan (Store Manager / First-Timer)**: Sees technical terms like "Instancia: 8a4f9..." and "Paso: e2b1c..." with no plain-language explanation of what went wrong in the kitchen or what corrective action is needed.
- **Sam (Accessibility-Dependent User)**: Relies on color alone for stats cards without descriptive aria labels; loader replaces the entire table without announcing loading state to screen readers.

### Minor Observations
- The local helper function `cn` at line 310 should be imported from `@/lib/utils`.
- The stats cards should use consistent 4-column or auto-fit layout rather than a cramped 5-column grid on smaller desktop screens.
- Empty states should offer a clear call to action to run a workflow with AI verification enabled.

### Questions to Consider
- Should managers be able to manually approve or reject flagged AI verifications directly from this screen with one click?
- Should the detail view display the original checklist criteria / prompt that the AI evaluated against the photo?
