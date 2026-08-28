---
target: app/dashboard/reports
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-28T15-37-45Z
slug: app-dashboard-reports
---
#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Skeletons and loading spinner present; "Próximamente" badges clear. Missing: no inline generation progress (spinner replaces button text but card doesn't communicate que el reporte está tardando). |
| 2 | Match System / Real World | 3 | Plain Spanish throughout. "Armar un reporte desde cero" y "¿Qué necesitas saber?" son conversacionales y apropiados. Minor: "Fuente de datos" is semi-technical for a restaurant owner who just wants "Empleados". |
| 3 | User Control and Freedom | 3 | Back buttons present on sub-pages; tab filter is reversible; collapsible builder is togglable. Gap: no "limpiar filtros" shortcut on the reports tab (must click "Todos" manually). |
| 4 | Consistency and Standards | 2 | `control/page.tsx` uses completely different layout patterns — raw `div.container` instead of `PageContainer`, custom `h1` instead of `PageHeader`, `EmptyState` from different import path (`@/components/ui/empty-state` vs `@/components/shared`). It is visually and structurally a different product page. |
| 5 | Error Prevention | 3 | Schedule form requires name + dataSource before submit; custom builder validates fields before running. Gap: schedule form allows "Correo electrónico" method with empty deliveryEmails field — server may reject but no client-side guard. |
| 6 | Recognition Rather Than Recall | 3 | Saved questions use plain conversational phrases. "Oficial" badge on NOM-251 is a helpful trust signal. Gap: report cards don't show what date range they'll cover — the user must remember that scope comes from the header branch selector. |
| 7 | Flexibility and Efficiency | 2 | Power users must open the collapsible, configure fields, add filters, and click run — no way to save a partially-configured builder state. No keyboard shortcut to trigger a query. Scheduled reports list is read-only — no edit or delete from the main page. |
| 8 | Aesthetic and Minimalist Design | 2 | `control/page.tsx` breaks visual unity: raw `text-2xl font-bold tracking-tight` h1 with explicit `container mx-auto py-6` sits next to pages using the shared `PageHeader` component. The main reports page stacks 5+ distinct content zones vertically with no visual breathing room or hierarchy — catalog tabs → cards → scheduled card → schedule button — all share identical visual weight. |
| 9 | Error Recovery | 3 | `ErrorState` with retry present on both catalog and custom builder. Custom builder shows toast errors near the action. Gap: scheduled reports error state doesn't let you retry from the card; only an `ErrorState` inside the card appears, but no action button. |
| 10 | Help and Documentation | 1 | Report cards describe what they contain but not when they're useful, their date range, or what happens after clicking "Descargar". The schedule form has no explanation of the difference between "Solo descarga" and "Correo electrónico". "Datos sensibles" in the custom builder are flagged with a `ShieldAlert` icon alone — no tooltip explaining what "sensible" means or its implications. |
| **Total** | | **25/40** | **Acceptable (63%)** |

#### Design Specificity Verdict

**LLM assessment**:
The surface is functionally competent and has good bones — the conversational saved-questions pattern in the custom builder is genuinely well-adapted to a non-technical HORECA audience. However, the Reports section suffers from structural divergence: `control/page.tsx` (the Control Gerencial report) reads as a completely different product from the same team. It uses different layout primitives, different heading conventions, different icon sizing, and lacks the shared `PageHeader` chrome. The main reports catalog is visually monotonous — nine cards in a grid with identical visual weight and no hierarchy signal to distinguish "official regulatory" from "operational convenience" beyond a small "Oficial" badge. The scheduling UX is functional but sparse; nothing in the form tells users what they're committing to or when the first run will fire.

**Deterministic scan**:
`detect.mjs` exited **0 — zero automated rule violations**. The surface uses design system primitives throughout (shadcn/Radix). The architectural divergences are above the AST layer.

**Visual overlays**:
Browser subagent confirmed page loads cleanly with no console errors across all three sub-routes. Screenshots captured confirm the tab filtering works, the collapsible custom builder expands, and the scheduled reports list renders. No overlay injection was attempted (deterministic scan clean, dev server already running).

#### Overall Impression
A reports section that works but doesn't feel like one thing. The catalog page is solid and readable; the custom builder's conversational questions are a genuine UX strength; the schedule form is functional but blank. The biggest problem is that `control/page.tsx` is a structural rogue — it breaks every shared layout convention and communicates to developers that the reports section has no enforced architecture.

#### What's Working
1. **Conversational saved questions**: "¿A quién se le venció un documento?" is exactly the language a restaurant owner uses. The `resolverFecha` token system (`hoy`, `hoy+30`) resolves date-relative queries transparently. This is the section's strongest UX decision.
2. **Sensitive data guard**: The `AlertDialog` confirmation before exporting personal data (with specific field names and record count) is thoughtful and appropriately friction-filled for a high-risk action.
3. **Scope communication**: The inline "Los reportes se generan para [Todas las sucursales]" note, combined with a branch-comparison CTA when no branch is selected, correctly addresses the most common confusion point in multi-unit operator UIs.

#### Priority Issues

- **[P1] Control Gerencial page breaks shared layout architecture**
  - **What**: `control/page.tsx` uses raw `div.container mx-auto py-6` instead of `PageContainer`, a hand-rolled `h1` with `text-2xl font-bold tracking-tight flex items-center gap-2` instead of `PageHeader`, and imports `EmptyState` from `@/components/ui/empty-state` instead of `@/components/shared`. It is visually and structurally different from every other dashboard page.
  - **Why it matters**: Users experience an inconsistent shell; developers face a choice between the "right" convention and the "existing" one every time they touch this file. It actively teaches wrong patterns.
  - **Fix**: Wrap the entire page body in `<PageContainer>`, replace the hand-rolled header with `<PageHeader title="Control gerencial" description="..." icon={Gauge} />`, and update the `EmptyState` import to `@/components/shared`.
  - **Suggested command**: `$impeccable harden`

- **[P1] No hierarchy between report tiers — "Oficial" badge does all the work**
  - **What**: All nine report cards are rendered with identical visual weight. The NOM-251 card — a legally required document accepted by COFEPRIS — looks the same as the "Incidentes" card. The only differentiation is a small `bg-info` "Oficial" badge.
  - **Why it matters**: HORECA operators responding to an inspector need to find their compliance reports instantly. A visual scan of the grid gives no priority signal.
  - **Fix**: Either group cards by tier (separate section header "Reportes oficiales" above the compliance cards) or give the "Oficial" variant cards a left-border tint in the system's info/primary color, distinct from the neutral card border.
  - **Suggested command**: `$impeccable layout`

- **[P2] Schedule form: no confirmation of what gets committed**
  - **What**: After filling the 8-field schedule form and clicking "Programar Reporte," the user gets a toast success and is redirected. There's no preview of the full schedule ("Se generará cada lunes a las 08:00 y se enviará a correo@ejemplo.com en formato PDF"), no email validation regex, and no client-side guard preventing "EMAIL" delivery method with an empty `deliveryEmails` field.
  - **Why it matters**: A misconfigured schedule runs silently for weeks. Operators will think they're receiving reports when they're not.
  - **Fix**: (1) Add a client-side check for empty `deliveryEmails` when method is EMAIL or BOTH. (2) Show an inline confirmation summary before submit that reads the configured values back in plain language.
  - **Suggested command**: `$impeccable harden`

- **[P2] No date-range context on report cards — scope is invisible**
  - **What**: Report cards say what they contain but not the implied time window. "Estado de inventario — Existencias, mermas, caducidades y movimientos del período" doesn't tell the user which period. When "Todas las sucursales" is selected, the period is also unknown. 
  - **Why it matters**: Operators may download a report expecting last month's data and receive a rolling all-time snapshot. Or they download the wrong scope.
  - **Fix**: Add a secondary line to the scope note: "Los reportes cubren [el período del mes en curso / últimos 30 días] para [sucursal]." Link the note to wherever the period is configurable if applicable.
  - **Suggested command**: `$impeccable clarify`

- **[P3] Help text missing from "Datos sensibles" flag and schedule delivery options**
  - **What**: `ShieldAlert` icon in the custom builder has only `aria-label="Dato sensible"` — no tooltip on hover, no inline explanation of what "sensible" means for non-technical users. Schedule delivery method options ("Solo descarga" vs "Correo y descarga") have no description of what each means.
  - **Why it matters**: First-time users will avoid sensitive fields unnecessarily or select the wrong delivery option.
  - **Suggested command**: `$impeccable clarify`

#### Persona Red Flags

**Rodrigo (Multi-Unit Operations Director)**:
- Opens the reports catalog looking for the monthly executive package for his 8-branch chain. All 9 cards look identical. He scans for "Oficial" but also sees it only on the NOM-251 card. He doesn't know that "KPIs de rendimiento" is where the branch comparison starts — the category "Desempeño" is not what he searches for.
- Clicks into Control Gerencial (from sidebar). The page looks different from every other dashboard section — no shared header, no branch awareness in the header, just a lone `h1`. Loses trust in the data provenance.

**Alex (Power User / Operations Manager)**:
- Wants to re-run a custom query from last week. Opens the builder, finds no "saved queries" section visible unless already saved via the builder. Realizes he can't edit a saved template — only re-run it. No delete button.
- Tries to run the custom builder without opening the collapsible. The "Armar un reporte desde cero" ghost button doesn't visually communicate it's a collapsible — the ChevronDown is small and the button has no border or background.

**Sam (Accessibility User)**:
- The `Collapsible` trigger button is a `Button` with `variant="ghost"` and no visible border/background at rest. Focus ring is the only affordance. Screen reader will announce "Armar un reporte desde cero, collapsed" which is acceptable, but the visual affordance is missing.
- The `fieldset` + `legend` in the custom builder is correct and accessible. The `sr-only` "Descargar [reporte] en [formato]" labels on download buttons are good. However, the filter row's `li key={index}` will produce unstable ARIA identity when filters are reordered.

#### Minor Observations
- `control/page.tsx` L161: `div.container mx-auto py-6` — the `py-6` creates different top-padding from `PageContainer`'s layout, making the Control page appear to "start higher" than all other pages.
- `schedule/page.tsx` L143: `PageHeader title="Programar Reporte"` uses title-case ("Reporte") while the rest of the system uses sentence case. The description "Configura un reporte automático con entrega periódica" is functionally accurate but cold — no mention of when the first run fires.
- The scheduled reports list shows `Activo` badge for all non-failed reports with no sense of health. A report active but never run shows the same badge as one that ran 500 times. Consider adding "Nunca ejecutado" if `lastRunAt` is null.
- The collapsible builder (`Armar un reporte desde cero`) is styled with `variant="ghost"` making it look like a navigation item rather than an expandable tool. A ghost button with full-width `justify-between` pattern works visually but there's no border or background change on hover to communicate "this opens something."

#### Questions to Consider
- What if "Reportes oficiales" (NOM-251, NOM-035) lived in a permanently visible pinned section above the catalog grid, not behind a tab filter? Operators with a pending inspection don't want to click "Cumplimiento" first.
- Does the control/page need to exist under `/reports/control`? It feels like it belongs in `/dashboard/analytics` with the KPI and branch comparison surfaces, not in the reports download workflow.
- What if the saved-questions list on the custom builder showed the last-run date and result count for each question? "¿A quién se le venció un documento? — 3 resultados · hace 2 días" would save a click for power users who just want to check if anything changed.
