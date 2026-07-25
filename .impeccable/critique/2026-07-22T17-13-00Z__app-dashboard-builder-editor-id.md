---
target: app/dashboard/builder/editor/[id]
total_score: 16
p0_count: 1
p1_count: 3
timestamp: 2026-07-22T17-13-00Z
slug: app-dashboard-builder-editor-id
---
# Impeccable Critique: Workflow Builder Editor

**Method**: ⚠️ DEGRADED: single-context (no sub-agent tool exposed)

**Target**: `app/dashboard/builder/editor/[id]` (Workflow Builder Editor)

---

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Autosave runs silently (30s timer) but no persistent indicator shows dirty/saved state; no progress indicator during save; `console.log` left in production canvas |
| 2 | Match System / Real World | 3 | Spanish labels are consistent and domain-appropriate; raw `step.type` strings like `TimeField`, `TemperatureField`, `OPSLocationField` leak into the canvas cards instead of human-readable labels |
| 3 | User Control and Freedom | 2 | No undo/redo for step edits; deleting a step has no confirmation dialog; `beforeunload` guard exists but in-app navigation guard uses a raw `confirm()` that can be bypassed |
| 4 | Consistency and Standards | 2 | Two competing `SortableStep` implementations (`canvas.tsx` inline vs `sortable-step.tsx` standalone) with different visual treatments; `sortable-step.tsx` uses `border-l-4` side-stripe accent while `canvas.tsx` uses `border-2 border-transparent`; duplicate `ValidationConfig` interface in builder-context |
| 5 | Error Prevention | 1 | Delete step has no confirmation; conditional branches accept free-text "condition" and "targetStepId" (raw UUID input, no dropdown); no validation that branch target IDs exist; NaN on empty number inputs (`parseFloat('')` → NaN) |
| 6 | Recognition Rather Than Recall | 1 | Branches require typing raw step UUIDs; conditional logic requires typing raw field IDs; no autocomplete or picker for either; step type badges show internal identifiers |
| 7 | Flexibility and Efficiency | 1 | No keyboard shortcuts; no bulk operations; no duplicate-step action; no copy-paste steps between templates; toolbox only appends to end (no insert-at-position) |
| 8 | Aesthetic and Minimalist Design | 2 | PropertyEditor always shows Placeholder + Default Value + Category + Conditional Logic + Logic Rules for every step type, even when irrelevant (e.g., Instruction steps showing "Placeholder"); canvas shows raw type strings; overall layout is competent but plain |
| 9 | Error Recovery | 1 | No undo/redo; autosave error is silently swallowed (no retry, no notification); failed manual save shows a toast but doesn't offer retry; deleted steps are gone permanently |
| 10 | Help and Documentation | 1 | Single tooltip-quality help text in the toolbox yellow callout; no contextual help for AI verification fields, conditional logic, logic rules, or branches; no documentation links |
| **Total** | | **16/40** | **Poor** |

---

## Anti-Patterns Verdict

### LLM Assessment

The editor doesn't scream "AI made this" at the layout level — the three-column Toolbox / Canvas / Properties pattern is the correct archetype for a builder. But the implementation has several AI-code tells:

1. **Side-stripe accent border** in `sortable-step.tsx` line 34: `border-l-4` with `border-l-primary` on selected cards is the most recognizable AI-generated UI pattern. The design system explicitly bans borders >1px as colored accents on cards.
2. **Duplicated component implementations**: Two `SortableStep` components exist — one inline in `canvas.tsx` and one in `sortable-step.tsx` — each with different visual treatments. This is typical of AI-generated code that doesn't check for existing implementations.
3. **Raw internal identifiers exposed to users**: `step.type` shown as-is (`TimeField`, `OPSLocationField`, `TemperatureField`) instead of using the available `STEP_TYPE_DISPLAY` map.
4. **Copy-paste code blocks**: The checklist options and select options sections in `property-editor.tsx` (lines 376-431 and 433-488) are nearly identical 55-line blocks — differing only in the heading text.
5. **Console.log in production**: `canvas.tsx` line 52 logs every render with step data.

### Deterministic Scan

The detector found **18 findings** across the builder surface:

- **1 warning**: `side-tab` anti-pattern in `sortable-step.tsx:34` — `border-l-4` side-stripe accent on cards
- **17 advisories**: `design-system-font-size` — `text-[10px]` used across `logic-rule-card.tsx` (5 hits), `escalation-section.tsx` (5 hits), `remediation-section.tsx` (4 hits), `workflow-settings-modal.tsx` (3 hits). The 10px size is not on the DESIGN.md type ramp (smallest documented step is Label at 0.75rem / 12px).

The side-tab finding aligns perfectly with the LLM assessment. The 10px font-size findings are legitimate — the design system's smallest step is `Label` at 0.75rem (12px), and 10px is below the floor. These are all in deeply nested property editor sub-components where density pressure led to shrinking text below the design system floor.

---

## Overall Impression

A structurally sound three-panel builder with working drag-and-drop, autosave, and a rich property editor — but it reads as an engineering prototype, not a shipped product. The biggest opportunity: this builder asks users to type raw UUIDs for critical workflow logic (conditional branches, visibility rules) instead of offering pickers. That single gap makes the advanced features effectively unusable for the target audience (HORECA chain operators, not developers).

---

## What's Working

1. **Three-panel layout is correct**: Toolbox → Canvas → Properties is the established builder pattern (Google Forms, Typeform, Tally). Users will immediately understand the spatial model.
2. **Autosave + dirty detection**: The `beforeunload` guard, 30-second autosave timer, and dirty-state tracking on `lastSavedRef` are well-implemented; the core data-preservation machinery is solid.
3. **Progressive disclosure in PropertyEditor**: Type-specific sections (AI Verification, Timer config, GPS validation) only appear for relevant step types, which manages cognitive load well for the conditional sections.

---

## Priority Issues

### [P0] Branch and Conditional Logic Requires Raw UUID Input

**What**: Conditional branches (`targetStepId`) and conditional visibility (`fieldId`) require users to type or paste raw step UUIDs — identifiers they cannot see anywhere in the interface.

**Why it matters**: These are the power features that differentiate Pulso's builder from a simple form builder. If users can't practically use conditional logic, the builder's value proposition collapses. A HORECA operations manager will never type `3a7f29c1-...` into a field.

**Fix**: Replace raw text inputs with `<Select>` dropdowns populated from the current step list (`steps.map(s => ({ value: s.id, label: s.title }))`). Show step titles in the dropdown, not IDs.

**Suggested command**: `$impeccable harden app/dashboard/builder/editor`

---

### [P1] No Undo/Redo — Destructive Actions Are Permanent

**What**: Deleting a step, removing a branch, or removing an option has no confirmation and no undo. The autosave can commit destructive changes within 30 seconds with no recovery path.

**Why it matters**: In a builder where complex workflow logic can take 30+ minutes to configure, accidentally deleting a step with logic rules, AI verification, and escalation chains is a catastrophic loss. Users working in-flow (the primary persona) will make mistakes.

**Fix**: Add an undo stack (at minimum, a one-level "undo last action" via a state snapshot before mutations). Add confirmation dialogs for step deletion. Consider making autosave only commit after a 2-second idle gap, not a fixed timer.

**Suggested command**: `$impeccable harden app/dashboard/builder/editor`

---

### [P1] Raw Step Type Strings Leak Into UI

**What**: The canvas card subtitle shows raw `step.type` values like `TimeField`, `TemperatureField`, `OPSLocationField` instead of human-readable labels. The `STEP_TYPE_DISPLAY` map exists in `workflow-type-map.ts` but isn't used in the canvas `SortableStep`.

**Why it matters**: Internal identifiers exposed to users break the "match between system and real world" heuristic. Users see `OPSLocationField` instead of "Ubicación GPS" and question whether they picked the right component.

**Fix**: Replace `{step.type}` in `canvas.tsx:41` with `{STEP_TYPE_DISPLAY[step.type] || step.type}`. The map already exists and is imported by `property-editor.tsx`.

**Suggested command**: `$impeccable clarify app/dashboard/builder/editor`

---

### [P1] Two Competing SortableStep Implementations

**What**: `canvas.tsx` defines an inline `SortableStep` component (lines 13-46) while `sortable-step.tsx` exports a standalone `SortableStep` with different visual treatment (side-stripe border-l-4 vs border-2 transparent). The inline version is the one actually rendered.

**Why it matters**: Dead code creates maintenance confusion. The `sortable-step.tsx` version uses a banned anti-pattern (`border-l-4` side-stripe), and if someone later switches to using it, the builder regresses. Meanwhile, the inline version misses features the standalone has (step description display, required indicator).

**Fix**: Delete the inline `SortableStep` from `canvas.tsx`. Migrate to the standalone `sortable-step.tsx` after removing the `border-l-4` side-stripe accent and replacing it with the `border-2 border-primary` selection indicator from the inline version. Merge the best of both: the description display and required badge from standalone, the clean border treatment from inline.

**Suggested command**: `$impeccable polish app/dashboard/builder/editor`

---

### [P2] PropertyEditor Shows Irrelevant Fields for All Step Types

**What**: Every step type shows Título, Placeholder, Valor por Defecto, Categoría, Descripción, Obligatorio, Solo Lectura, Visibilidad Condicional, and Reglas Lógicas. An "Instrucción" step (read-only informational text) shows "Placeholder" and "Valor por Defecto" fields that have no meaning for it.

**Why it matters**: Irrelevant fields add cognitive load and make users question what they should fill in. In a form with 8+ always-visible fields, users scan past the ones that matter.

**Fix**: Gate common fields by step category. `Placeholder` and `defaultValue` are meaningless for `PHOTO`, `SIGNATURE`, `TIMER`, `LOCATION`, and `INFO` types. Hide them conditionally.

**Suggested command**: `$impeccable distill app/dashboard/builder/editor`

---

## Persona Red Flags

### Alex (Power User)
- **No keyboard shortcuts**: Can't press `Ctrl+Z` to undo, `Ctrl+S` to save (though autosave exists), `Del` to delete selected step, or `Ctrl+D` to duplicate.
- **No bulk operations**: Can't multi-select steps, can't duplicate a step, can't copy steps between templates.
- **Toolbox only appends**: No way to insert a step at a specific position — must add to end then drag. For a 30-step workflow, this is 29 drag operations.
- **Autosave toast suppressed**: Alex won't know when the autosave ran unless watching the network tab.

### Jordan (First-Timer)
- **"ID del Campo Fuente" means nothing**: Conditional logic expects a raw field ID with no guidance on where to find it.
- **"Condición (ej. valor == 'no')" is developer syntax**: Branch conditions expect code-like expressions with no visual builder or examples beyond the placeholder.
- **AI Verification section has no explanation**: "Umbral de Confianza (0-1)" and "ID de Campo a Auto-Llenar" are expert-level fields with no tooltips or help text.
- **Delete is silent**: Jordan will click the trash icon, lose a step, and have no way to recover.

### Sam (Accessibility-Dependent)
- **Drag handle is mouse-only in the inline SortableStep**: While `@dnd-kit` supports keyboard sensors (configured), the drag handle icon has no visible focus indicator and no ARIA label.
- **No ARIA live region for step addition/deletion**: Screen reader users won't hear confirmation when steps are added or removed.
- **Color-only "required" indicator**: The asterisk in `sortable-step.tsx` is red (`text-red-500`) with no non-color indicator beyond the `*` character — functional but marginal.

---

## Minor Observations

- **`console.log` in production** (`canvas.tsx:52`): `console.log('[Canvas] Rendering with steps:', steps.length, steps)` fires on every render. Remove it.
- **Duplicate `ValidationConfig` interface** in `builder-context.tsx` (lines 22-29 and 31-38): Exact duplicate. TypeScript allows it but it signals copy-paste code.
- **Mixed indentation**: `page.tsx` uses 4-space indent for most code but 1-space indent in the `steps` mapping block (lines 39-84). The inconsistency suggests machine-generated code that wasn't formatted.
- **Yellow callout in Toolbox** (`bg-yellow-50`): This hardcoded color bypasses the design system's semantic tokens. Use `bg-muted` or a semantic warning variant.
- **`confirm()` for unsaved changes**: The native browser confirm dialog (line 90) is jarring in a polished product. Replace with a custom dialog component.
- **Autosave timer at 30s is long**: Most modern builders autosave after 2-5s of idle time. 30 seconds is long enough for a user to make many destructive changes that get committed in bulk.
- **No empty state in PropertyEditor is missing an illustration or action**: The "Selecciona un paso" message is text-only; adding a subtle visual cue would reinforce the three-panel mental model.

---

## Questions to Consider

- What if branch conditions had a visual builder (dropdown: "If [step name] [operator] [value] → Go to [step name]") instead of free-text expressions?
- Does a HORECA operator ever need to see step IDs, or can they be hidden entirely?
- What would this builder feel like with a minimap or progress bar showing the workflow shape at a glance — especially for templates with 20+ steps?
