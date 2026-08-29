---
timestamp: 2026-08-29T04-00-47Z
slug: app-dashboard-evidence
---
# Critique: app/dashboard/evidence

⚠️ DEGRADED: single-context (spawn_agent unavailable in this session)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Binary AI badge with no score threshold on cards; no visual debounce indicator during search |
| 2 | Match System / Real World | 2 | Focuses on raw media file types (Fotos/Videos/Audios) instead of HORECA operational context (Turnos, Checklists, NOM-251, Sucursales) |
| 3 | User Control and Freedom | 2 | Dead "Descargar" button; no next/prev modal navigation; no in-place evidence review or approval |
| 4 | Consistency and Standards | 2 | Violates Flat-By-Default rule with `hover:shadow-lg`; uses ad-hoc Tailwind colors (`bg-purple-100`, `bg-blue-100`) instead of OKLCH tokens |
| 5 | Error Prevention | 2 | No validation between dateFrom and dateTo; no broken image fallback handling for remote evidence URLs |
| 6 | Recognition Rather Than Recall | 2 | Branch name is hidden on grid cards; no branch filter in filter bar for multi-unit restaurant owners |
| 7 | Flexibility and Efficiency | 1 | Search input fires fetch on every keystroke without debounce; no batch actions or quick date presets |
| 8 | Aesthetic and Minimalist Design | 3 | Clean grid foundation, but top metric cards consume excessive space with low-value media counters |
| 9 | Error Recovery | 2 | Toast notification only; no inline recovery state or retry trigger on API/image failure |
| 10 | Help and Documentation | 2 | No contextual explanation of AI verification criteria or actionable guidance on empty state |
| **Total** | | **20/40** | **Acceptable (50%)** |

---

## Design Specificity Verdict

**LLM Assessment**: The current implementation treats evidence as a generic media gallery (resembling an unsorted file browser or photo library) rather than a mission-critical operational audit tool for restaurant chains. Pulso HORECA is built for multi-branch operators who need immediate visibility into kitchen checklist execution, food safety compliance (NOM-251), and incident documentation. Hiding branch attribution on cards and prioritizing media format breakdown over operational compliance health misses the product's core value proposition.

**Deterministic Scan**: 0 findings flagged by automated regex rules (`detect.mjs`). However, manual code inspection reveals direct design system rule violations: `hover:shadow-lg` (violating DESIGN.md Flat-by-default rule) and non-standard palette usage (`bg-purple-100`, `bg-blue-100`, `text-orange-600`).

**Visual Overlays**: Browser mutation overlay not injected; CLI deterministic scan returned clean.

---

## Overall Impression

The page provides a functional baseline for querying media records, but it operates like a generic media asset manager rather than the command center of a restaurant chain. Transforming the KPI metrics to reflect operational health (e.g. pending audits, AI verification flags, branch compliance) and adding branch-level filtering will immediately elevate this surface into an indispensable oversight tool.

---

## What's Working

1. **Dual View Layout Switcher**: Clean and instant toggle between Grid (`Cuadrícula`) and List (`Lista`) modes with dedicated layout adaptations.
2. **Detailed Modal Inspection View**: Shows the full evidence payload, timestamp formatting localized in Spanish (`date-fns/locale/es`), AI reason text block, and a direct link to the parent workflow instance.
3. **Multi-Format Media Renderers**: Native support for conditional rendering of photos (`next/image`), HTML5 video players, audio player controls, and text snippets.

---

## Priority Issues

### [P0] Dead "Descargar" Action & Missing Branch Filter for Multi-Unit Chains
- **What**: The "Descargar" button in the detail modal has no `onClick` handler or file download trigger. Furthermore, there is no branch filter dropdown in the filter bar, and the branch name is omitted from the grid cards.
- **Why it matters**: Multi-branch owners (3–15 locations) cannot filter evidence by specific restaurant branches, and managers cannot export evidence needed during official sanitary inspections (COFEPRIS/NOM-251).
- **Fix**: Wire up download/export functionality to download the asset or copy its secure URL. Add a Branch selector in `EvidenceFilters` and display a branch badge directly on each card thumbnail.
- **Suggested command**: `$impeccable harden app/dashboard/evidence`

### [P1] Un-debounced Search Input & Missing Quick Operational Presets
- **What**: The search input triggers `setFilters` and executes a network request on every single keystroke without debouncing (`useEffect` on `filters`). There are also no quick preset filters (e.g. "Hoy", "Turno Apertura", "Solo Pendientes").
- **Why it matters**: Causes severe API request thrashing and network latency while typing, and forces mobile/tablet kitchen managers to manually select dates via calendar pickers.
- **Fix**: Implement a 300ms debounce on text search. Provide 1-click filter chips for common audit timeframes ("Hoy", "Ayer", "Pendientes de Verificación").
- **Suggested command**: `$impeccable optimize app/dashboard/evidence`

### [P2] Metric Cards Track Media Types Instead of Operational Compliance
- **What**: The 5 stat cards above the fold track file extensions ("Total", "Fotos", "Videos", "Audios", "Verificadas"), using large numbers for low-value counters (e.g. Audios: 0).
- **Why it matters**: Restaurant owners need to know if food safety checklists passed, which branch has unverified items, and where anomalies occurred — not how many bytes/files are MP4 vs JPEG.
- **Fix**: Reframe stat cards around operational KPIs: "Evidencias Hoy", "Tasa Aprobación AI %", "Requieren Atención / Rechazadas", and "Sucursales Activas".
- **Suggested command**: `$impeccable distill app/dashboard/evidence`

### [P3] Design System Violations: Shadows and Non-OKLCH Palette Usage
- **What**: Evidence cards use `hover:shadow-lg` (forbidden in DESIGN.md Elevation rules). Type badges and stats use arbitrary hardcoded Tailwind colors (`text-blue-600`, `text-orange-600`, `bg-purple-100`).
- **Why it matters**: Dilutes the brand aesthetic and breaks consistency with the flat, tonal-layered Pulso command center design language.
- **Fix**: Replace shadow hover effects with subtle border/background shifts (`hover:border-foreground/25`). Re-map badges to OKLCH semantic tokens (`--primary`, `--success`, `--warning`, `--muted`).
- **Suggested command**: `$impeccable polish app/dashboard/evidence`

---

## Persona Red Flags

- **Alex (Director Multiusuario / Power User)**: Cannot filter evidence by branch; cannot see branch names without clicking every single card modal; no keyboard navigation (Esc/Arrow keys) inside detail modal to cycle through evidence; download button does nothing.
- **Jordan (Gerente de Turno / First-Timer)**: Confronted with 5 media metric cards instead of shift checklists; cannot tell why an item is marked "AI" without opening the dialog; empty state provides no button to reset filters or launch pending workflow checklists.
- **Sam (Auditor de Cumplimiento / Accessibility-Dependent)**: Card elements are non-interactive `<div>` containers with click handlers (missing `tabIndex`, `role="button"`, and keyboard trigger support); status colors alone convey AI verification without explicit text descriptions for screen readers.

---

## Minor Observations

- The initials generator `assigneeName.split(" ").map(n => n[0]).join("").slice(0, 2)` should be guarded against empty or null assignee strings.
- The `TEXT` evidence type renders `selectedEvidence.url` directly as plain text; if `url` is a link or JSON payload, it should be formatted safely.
- List view lacks thumbnail preview on mobile viewports.
- No batch selection or batch export mechanism for audit compliance reporting.

---

## Questions to Consider

- Should the evidence gallery allow Gerentes and Administradores to manually override and approve/reject AI verifications directly from the modal?
- Would an "Exportar Paquete de Auditoría NOM-251" (ZIP with PDF index + timestamped photos) be the primary workflow for health inspection prep?
- How should evidence be grouped — by date, by branch, or by workflow category (Apertura, Temperaturas, Higiene, Mantenimiento)?
