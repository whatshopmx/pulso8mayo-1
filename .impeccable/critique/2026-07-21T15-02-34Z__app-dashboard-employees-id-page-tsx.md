---
timestamp: 2026-07-21T15-02-34Z
slug: app-dashboard-employees-id-page-tsx
---
#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Tab selection does not update URL searchParams (`?tab=...`), state resets on reload |
| 2 | Match System / Real World | 3 | Hardcoded English tab titles in Spanish HORECA NOM-251 context |
| 3 | User Control and Freedom | 2 | Mobile view collapses tab text, leaving 9 cryptic icons with no labels |
| 4 | Consistency and Standards | 2 | `grid-cols-9` breaks layout on mobile/tablet viewports |
| 5 | Error Prevention | 2 | Dead "Edit" button opens unrendered `showEditDialog` state; inert header actions |
| 6 | Recognition Rather Than Recall | 2 | Mobile users must memorize 9 icon meanings without text or tooltips |
| 7 | Flexibility and Efficiency | 2 | No keyboard navigation between tabs or deep linking support |
| 8 | Aesthetic and Minimalist Design | 2 | 9 tabs crammed into a single row violates working memory limits (≤4 items) |
| 9 | Error Recovery | 3 | Graceful error state with back navigation, but missing retry action |
| 10 | Help and Documentation | 1 | No contextual help for NOM compliance, onboarding steps, or document requirements |
| **Total** | | **22/40** | **Acceptable** |

#### Anti-Patterns Verdict

**LLM assessment**: The employee profile page exhibits cognitive overload and responsive layout breakdown. Cramming 9 tabs into a rigid `grid-cols-9` layout forces tiny, icon-only touch targets on mobile (<768px). Furthermore, multiple header action triggers ("Edit", "Message", "Export", "Archive") are dead or unconnected to UI modals, violating core product usability expectations.

**Deterministic scan**: `detect.mjs` returned 0 static rule violations across `app/dashboard/employees/[id]/page.tsx` and `components/employees/employee-header.tsx`.

**Visual overlays**: Browser overlay injection skipped as authentication is required on local dev server.

#### Overall Impression
The employee profile page contains comprehensive data structures for HORECA staff (contracts, attendance, onboarding, documents, benefits, training, audit), but suffers from structural layout fragility on non-desktop viewports and inert action triggers. Converting the 9-column grid into a smooth scrollable or grouped tab navigation and wiring up the edit/action controls will transform this into a robust command center component.

#### What's Working
1. **Modular Tab Component Architecture**: Clean separation into sub-components (`PersonalTab`, `ContractsTab`, `DocumentsTab`, `OnboardingTab`, `AttendanceTab`, etc.).
2. **Robust Data Fetching Hook**: Comprehensive API query parameters with clear fallback handling and error states.
3. **Structured Header Card**: Clear employee avatar, department, position, and status badge placement.

#### Priority Issues

- **[P0] Dead "Edit" button and inert header actions**
  - **Why it matters**: Clicking "Edit" in `EmployeeHeader` sets `showEditDialog(true)`, but no edit dialog component is rendered in `EmployeeProfilePage`, leaving the button completely unresponsive. "Message", "Export", and "Archive" dropdown items are also inert.
  - **Fix**: Render a profile edit modal (or wire `showPersonalDialog`/`showProfessionalDialog`) and complete or disable inert action buttons.
  - **Suggested command**: `$impeccable harden`

- **[P1] Rigid 9-column grid breaks tab navigation on mobile/tablet**
  - **Why it matters**: `<TabsList className="grid w-full grid-cols-9">` forces 9 items into a single row. Below 768px, text labels hide, leaving 9 cramped icon buttons (~35px wide) without tooltips or labels.
  - **Fix**: Replace `grid-cols-9` with a horizontally scrollable container (`flex overflow-x-auto whitespace-nowrap scroller-none`) or group tabs into logical sections (Info, Operations, Compliance).
  - **Suggested command**: `$impeccable layout`

- **[P1] Active tab state not synchronized with URL query params**
  - **Why it matters**: Changing active tabs does not call `router.replace` or update search params. Refreshing the browser or sharing a URL always resets the view to the "Personal" tab.
  - **Fix**: Sync `activeTab` with `searchParams` via `useRouter` so tab changes update the URL query string `?tab=...`.
  - **Suggested command**: `$impeccable harden`

- **[P2] Hardcoded English UI text in Spanish HORECA context**
  - **Why it matters**: Tab titles ("Personal", "Professional", "Contracts", "Documents", "Onboarding", "Attendance", "Benefits", "Training", "Audit") are hardcoded in English, conflicting with the app's Spanish NOM-251 / NOM-035 HORECA domain.
  - **Fix**: Translate tab titles to Spanish or wire them into `next-intl` localization.
  - **Suggested command**: `$impeccable clarify`

- **[P2] Display typography and status color token misalignment**
  - **Why it matters**: Page header uses generic `text-3xl font-bold` without Geist tracking tokens (`-0.02em`), and status badges use standard shadcn variants instead of OKLCH HORECA semantic tokens.
  - **Fix**: Apply Geist display tokens (`tracking-tight`) and OKLCH status badge tints.
  - **Suggested command**: `$impeccable typeset`

#### Persona Red Flags

- **Alex (Power User)**: Cannot bookmark or share links to specific employee tabs (e.g. Audit or Attendance) because URL search params are not updated on tab switch. Clicking "Edit" does nothing.
- **Jordan (First-Timer / Mobile Manager)**: On mobile, sees 9 unlabeled icons crammed in a tight row. Has to tap randomly to figure out which icon leads to Attendance vs Training vs Audit.
- **Sam (Accessibility-Dependent User)**: Icon-only triggers on mobile screens hide text labels with `hidden md:inline` without providing explicit `aria-label` or accessible tooltips on the tab triggers.

#### Minor Observations
- Loading state renders a simple spinner; a skeleton loader matching the header + tabs layout would eliminate layout jump.
- `TERMINATED`, `SUSPENDED`, `RESIGNED` status codes all map to the generic `"destructive"` badge variant.

#### Questions to Consider
- Should employee tabs be organized into 3 logical hubs (**Información General**, **Operación & Asistencia**, **Cumplimiento & Documentación**) to reduce cognitive clutter?
- Should employee editing occur in-place per tab section rather than via a single monolithic dialog?
- How can compliance documents (NOM-251/NOM-035) be highlighted as operational badges directly in the header?
