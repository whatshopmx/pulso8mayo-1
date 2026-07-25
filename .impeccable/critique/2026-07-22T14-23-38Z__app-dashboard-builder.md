---
target: app/dashboard/builder
total_score: 20
p0_count: 2
p1_count: 2
timestamp: 2026-07-22T14-23-38Z
slug: app-dashboard-builder
---
## Critique: Pulso HORECA Workflow Builder (pp/dashboard/builder/)

### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2/4 | Autosave exists but no "last saved" timestamp; no saving indicator during autosave |
| 2 | Match System / Real World | 2/4 | Landing page in Spanish, entire editor + settings in English — core audience is Mexican operators |
| 3 | User Control and Freedom | 3/4 | Dirty-check back-nav good; no undo; native confirm() for delete |
| 4 | Consistency and Standards | 2/4 | Language mixing; duplicate interfaces; category uses free-text Input when filter is Select |
| 5 | Error Prevention | 2/4 | Dirty tracking helps; but condition fields accept arbitrary text with no validation or cycle guard |
| 6 | Recognition Rather Than Recall | 3/4 | Icons consistent; but conditional branches require typing target step IDs from memory |
| 7 | Flexibility and Efficiency | 1/4 | Zero keyboard shortcuts, no batch ops, no undo/redo, no drag-from-toolbox, no search |
| 8 | Aesthetic and Minimalist Design | 2/4 | Clean 3-panel layout; but 14 ungrouped toolbox items, fake device notch, shadow violations |
| 9 | Error Recovery | 2/4 | Autosave helps; deletion is permanent, no version history, toasts ephemeral |
| 10 | Help and Documentation | 1/4 | One hint text in the entire editor. No onboarding, no tooltips, no docs for condition syntax |
| **Total** | | **20/40** | **Acceptable — significant improvements needed** |

### Anti-Patterns Verdict

**LLM assessment**: Not AI-generated. The code reads human. Minor traces: the yellow hint box in the toolbox looks like a forgotten debug note; orphaned component files (uilder-canvas.tsx, uilder-toolkit.tsx, sortable-step.tsx) suggest mid-development churn.

**Deterministic scan**: 6 advisory findings — all 	ext-[10px] off the DESIGN.md type ramp in workflow-settings-modal.tsx:634-670. Also confirmed: order-l-4 side-stripe on sortable-step.tsx:34, missing ria-label on 4 icon-only buttons, and no skeleton loaders anywhere (spinners only).

**Design system violations found**: shadow-md on canvas step cards and preview modal card violates Flat-By-Default Rule. order-l-4 violates the side-stripe border ban. Hardcoded colors (g-blue-50, g-yellow-50) bypass OKLCH tokens.

### Overall Impression

The builder has a solid 3-panel editor chassis — toolbox, canvas, property editor — and the preview mode shows genuine care for the end-user experience. But the surface is undermined by a major language schism (Spanish landing → English editor), design system drift (shadow, side-stripe, hardcoded colors), and a surprising lack of power-user features (no undo, no keyboard shortcuts, no drag-from-toolbox) for a tool that demands daily use.

The single biggest opportunity: resolve the language split first. It's a P0 trust issue for the target audience.

### What's Working

1. **Preview mode with mobile/desktop toggle** — The device-frame preview with walkable step navigation shows real empathy for how field employees will use these workflows. Step dots, progress bar, and required-field validation make it feel concrete.

2. **Dirty-state tracking + autosave** — The beforeunload guard, 30-second autosave debounce, and save-button disable when clean is well-considered. The dirty indicator on the Save icon (turns primary when dirty) is a nice touch.

3. **Context-aware property editor** — Showing relevant validation fields per step category (number → min/max, location → GPS radius, timer → duration) reduces cognitive load. The logic rules section with severity levels and escalation chains is ambitious and genuinely useful for compliance workflows.

### Priority Issues

#### P0: Language Whiplash
- **What**: Landing page is full Spanish ("Mis Plantillas", "Catálogo Pulso", "Onboarding Rápido"). The property editor, toolbox, logic rules, and settings modal are 100% English ("Title", "Required", "Rule Name", "Workflow Settings").
- **Why matters**: Core audience is Mexican restaurant operators. English in the daily-configuration tool signals "this wasn't built for you." Erodes trust on every interaction.
- **Fix**: Localize all user-facing strings. The editor, toolbox, property editor, canvas, settings, and preview should match the landing page's Spanish.
- **Suggested command**: $impeccable clarify

#### P0: Design System Drift
- **What**: shadow-md on canvas step cards and preview modal card, order-l-4 on sortable step (side-stripe anti-pattern), 	ext-[10px] off the type ramp in settings modal, hardcoded g-blue-50 and g-yellow-50 instead of tokens.
- **Why matters**: Every violation sets a precedent. The design system was deliberately chosen (flat-by-default, OKLCH tokens, Geist scale). Drift accumulates into a disjointed product.
- **Fix**: Remove shadows (tonal layering instead). Replace order-l-4 with full border or bg tint. Replace 	ext-[10px] with 	ext-xs (12px). Use semantic color tokens.
- **Suggested command**: $impeccable polish

#### P1: No Undo / Version History
- **What**: Every action (step delete, reorder, property change, template delete) is immediate and permanent. No undo stack. The only safety net is window.confirm().
- **Why matters**: Workflow builders are exploratory. Users WILL make mistakes. Without undo, each error costs time and compounds frustration.
- **Fix**: Implement an undo stack (20+ actions) in BuilderProvider. Add soft-delete for templates with recovery.
- **Suggested command**: $impeccable harden

#### P1: Free-Text Conditions for Non-Technical Users
- **What**: Logic rules (alue > 5), conditional branches (alue == 'no'), and conditional visibility use raw expression syntax. No visual builder.
- **Why matters**: HORECA managers aren't programmers. Requiring syntax knowledge creates a hard adoption ceiling.
- **Fix**: Build a visual condition builder with field picker + operator dropdown + value input. Use natural language display ("Is greater than" not >).
- **Suggested command**: $impeccable clarify

#### P2: Toolbox Cognitive Overload
- **What**: 14 step types in a single flat ungrouped list. No search. No drag-to-add (click-to-add only).
- **Why matters**: Choice paralysis. User scans all 14 items every time. Violates the ≤4 visible choices heuristic.
- **Fix**: Group by category (Text/Input, Selection, Evidence, Layout, Timing). Add search. Consider drag-to-add from toolbox.
- **Suggested command**: $impeccable distill

#### P2: Canvas Empty State Doesn't Teach
- **What**: "Select a tool from the left to start building." is procedural, not instructional.
- **Why matters**: The product register says "empty states that teach." This one states the obvious. A first-timer still doesn't know what to build.
- **Fix**: Show a template picker or a "Quick Start" CTA that pre-fills a sample compliance workflow. The product thesis is "compliance as byproduct" — the first experience should embody that.
- **Suggested command**: $impeccable onboard

#### P3: Missing aria-labels on Icon-Only Buttons
- **What**: 4 icon-only buttons lack ria-label: two back arrows, two trash icons.
- **Why matters**: Screen reader users get "button" with no context.
- **Fix**: Add ria-label="Volver" / ria-label="Eliminar paso".
- **Suggested command**: $impeccable polish

### Persona Red Flags

**Alex (Power User)**: Zero keyboard shortcuts. No Ctrl+S, Ctrl+Z, Del for delete. No drag-from-toolbox (14 separate click cycles to add steps). No batch ops on templates. The condition builder forces memorization of step IDs.

**Jordan (First-Timer)**: English editor after Spanish landing page → trust erosion. Condition expressions assume programming literacy. No onboarding or guided tour. "Escalation Chain" and "Remediation Protocol" jargon is intimidating. The first action ("Nueva Plantilla" button) is less prominent than "Onboarding Rápido".

**Sam (Accessibility)**: confirm() dialog may not be screen-reader-friendly. Emoji-only severity indicators (🔴🔶⚠️✅) in preview modal logic rules have no accessible text alternative. 4 icon-only buttons lack aria-labels. Toast notifications likely not announced by screen readers.

### Minor Observations

1. **Duplicate ValidationConfig interface** defined twice in builder-context.tsx — dead code.
2. **~400 lines of orphaned components** (uilder-canvas.tsx, uilder-toolkit.tsx, sortable-step.tsx) — not imported by editor-client.tsx.
3. **Fake device notch in preview** — decorative, violates "nothing decorative" principle.
4. **onboardingTemplate inline object** in template-manager.tsx should live in the template library.
5. **Category is free-text Input** in property editor — no discoverability of available categories.
6. **Empty property editor shows English** "Select a step to edit properties" on an otherwise Spanish page.

### Questions to Consider

1. **If the brand is "confident, sharp, operational" and the user is a Mexican restaurant owner, why does the editor switch to English and show a fake iPhone notch?** Who is this design actually for?

2. **"Compliance as a byproduct, not a chore"** — if that's the thesis, why is the first experience a blank canvas with 14 cryptic types, instead of a pre-built NOM-251 compliance workflow?

3. **14 step types, escalation chains, remediation protocols, free-text conditions** — at what point does this become a visual programming IDE rather than a tool for restaurant operators? Is this complexity proportional to the domain?

4. **The delete flow uses window.confirm()** — unstyled native dialog — in a product with a Geist type scale, OKLCH palette, and 1.5rem card padding. How did this survive design review?
