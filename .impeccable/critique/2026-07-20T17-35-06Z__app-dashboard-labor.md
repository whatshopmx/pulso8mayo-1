---
timestamp: 2026-07-20T17-35-06Z
slug: app-dashboard-labor
---
# Impeccable Critique Report: `app/dashboard/labor`

⚠️ DEGRADED: single-context (spawn_agent unavailable in this session)

#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3/4 | Core metrics updated live; client sub-dashboards lack skeleton loading states |
| 2 | Match System / Real World | 3/4 | Excellent use of Mexican labor law (LFT, NOM-035) and HORECA terms |
| 3 | User Control and Freedom | 2/4 | Lacks dashboard-level date range or branch filter controls |
| 4 | Consistency and Standards | 2/4 | Visual chaos: top KPIs use 2-color gradients, cards use side-stripe borders, bottom cards use pastel fills |
| 5 | Error Prevention | 3/4 | RBAC and missing tenant fallbacks implemented cleanly |
| 6 | Recognition Rather Than Recall | 2/4 | 20+ competing colored Lucide icons creates visual noise |
| 7 | Flexibility and Efficiency | 2/4 | No keyboard shortcuts or direct inline approval actions |
| 8 | Aesthetic and Minimalist Design | 1/4 | **Critical failure**: 16 side-tab accent borders (`border-l-4`), rainbow gradient backgrounds, rainbow text colors |
| 9 | Error Recovery | 3/4 | Clear empty/error states for unassigned company |
| 10 | Help and Documentation | 2/4 | Static LFT legal cards consume half the page space instead of contextual help |
| **Total** | | **23/40** | **[Acceptable]** |

---

#### Anti-Patterns Verdict

**Start here.** Does this look AI-generated?

**LLM assessment**: **Yes, unequivocally.** The page exhibits textbook AI slop anti-patterns:
1. **Side-tab colored accent borders**: 16 separate cards feature `border-l-4 border-l-[color]` side-stripes.
2. **Rainbow card palette**: Gradients and background fills in blue, green, yellow, purple, orange, red, cyan, indigo, pink, teal, amber, and emerald scattered randomly across the page.
3. **Card Grid Overload**: Dumping 33+ individual cards on a single page to cover every feature sub-route instead of structuring a clear visual hierarchy.

**Deterministic scan**:
- **Findings count**: 20 detector violations.
- **Primary anti-patterns**:
  - `side-tab` (Thick colored border on one side of a card - absolute ban): 16 occurrences in `app/dashboard/labor/page.tsx` (lines 259, 274, 289, 304, 328, 343, 358, 373, 397, 412, 427, 442, 466, 481, 496, 511).
  - `ai-color-palette` (Purple/violet gradients and cyan accents): 4 occurrences in `page.tsx`, `breaks/page.tsx`, `documents/page.tsx`.

---

#### Overall Impression

The Labor Management module (`app/dashboard/labor`) is functionally comprehensive—covering Mexican LFT and NOM-035 requirements with rich database queries. However, visually it suffers from severe AI slop clutter: 16 colored side-stripe cards, rainbow gradients, and over 33 competing cards. Transforming this into a flat, command-center dashboard with restrained Geist typography and clear action hierarchy will turn it into a world-class operational tool for restaurant and hotel managers.

---

#### What's Working

1. **Rich Domain Integration**: Real LFT concepts (Art 58, 63, 65, 69, 80, NOM-035) and live operational data metrics (scheduled vs actual attendance, dossier completeness, overtime minutes).
2. **Solid Layout Structure**: Clear sub-section categorizations (Gestión de Empleados, Control de Asistencia, Gestión de Turnos, Aprobaciones).
3. **Robust Fallbacks**: Graceful missing-tenant fallback and RBAC guard checks (`requireManagementRole`).

---

#### Priority Issues

##### [P1] AI Slop Side-Tab Accent Borders & Rainbow Colors
- **Why it matters**: 16 cards use `border-l-4` side borders with rainbow colors (`border-l-blue-500`, `border-l-yellow-500`, etc.) and pastel gradient fills (`from-purple-50`, `from-slate-50`). This violates Pulso's flat design system (no shadows, flat tonal layering, Operational Red used sparingly at 10-15%) and is an explicit Impeccable absolute ban.
- **Fix**: Strip all `border-l-4` side stripes and background gradients. Replace with clean flat neutral card containers (`bg-card border border-border`), dark high-contrast headings, and subtle monochrome/red indicators.
- **Suggested command**: `$impeccable quieter app/dashboard/labor/page.tsx`

##### [P1] Card Overload & Cognitive Overload
- **Why it matters**: Presenting 33+ cards simultaneously violates working memory rules (≤4 items per group). Operational managers overseeing 15 branches cannot spot urgent alerts (e.g. pending approvals or active violations).
- **Fix**: Elevate urgent alerts to a top "Command Banner" (e.g. 3 pending approvals, 1 NOM-035 violation), collapse quick links into clean structured navigation panels, and limit main dashboard cards to 4 core operational KPIs.
- **Suggested command**: `$impeccable layout app/dashboard/labor/page.tsx`

##### [P2] Rigid Static LFT Reference Cards
- **Why it matters**: 6 large static cards summarizing LFT articles occupy permanent real estate on the dashboard, creating massive scroll depth.
- **Fix**: Move LFT compliance references into a compact slide-over drawer or interactive tooltip helper accessible via a single "Guía LFT" button.
- **Suggested command**: `$impeccable distill app/dashboard/labor/page.tsx`

##### [P2] Missing Direct Management Actions
- **Why it matters**: Managers must click into nested sub-routes (`/dashboard/labor/approvals`) to approve routine requests, slowing down shift operations.
- **Fix**: Add inline quick-action buttons or modal drawers for instant approval of pending shift swaps and leave requests directly from the main view.
- **Suggested command**: `$impeccable polish app/dashboard/labor/page.tsx`

---

#### Persona Red Flags

**Alex (Power User / Multi-Branch Manager)**
- *Red Flag*: Must click through 3 layers of navigation to approve shift swaps. Cannot filter the dashboard by branch or date range from the top header. Forced to scroll past 33 cards to find relevant metrics.

**Jordan (First-Time Supervisor)**
- *Red Flag*: Overwhelmed by rainbow cards and visual noise. Cannot distinguish between informational LFT legal text and high-priority operational emergencies.

**Sam (Accessibility User)**
- *Red Flag*: Text on light pastel cards (`text-blue-700` on `from-blue-50`, `text-yellow-700` on `from-yellow-50`) relies on low-contrast color differentiation. Icon-heavy cards lack explicit aria-labels.

---

#### Minor Observations

- The header features a hardcoded badge `<Badge className="bg-green-50 text-green-700 border-green-200">Cumplimiento LFT</Badge>` which doesn't reflect actual dynamic compliance status.
- Card hover states use `hover:shadow-md`, which violates the project's **Flat-By-Default** rule. Interaction feedback should rely on border/background shifts, not drop shadows.
- Empty "+" cards like "Constructor: Crear nuevo horario" and "Reportes: Ver análisis" feel like placeholder text rather than polished action triggers.

---

#### Questions to Consider

- *What if the Labor dashboard acted as an operational command center—showing an urgent action queue at the top and consolidating sub-page links into a clean tab bar?*
- *How can we make LFT compliance feel like a dynamic operational score rather than 6 static text cards?*
- *Can we enable 1-click approvals for shift swaps directly from this dashboard view?*
