---
target: components/builder and app/dashboard/builder
total_score: 28
p0_count: 0
p1_count: 3
timestamp: 2026-07-22T17-44-44Z
slug: components-builder-and-app-dashboard-builder
---
# Heuristic Usability Review & Design Critique
**Target:** components/builder & app/dashboard/builder

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Autosave is indicated at template level, but individual step updates lack feedback. |
| 2 | Match System / Real World | 3 | Uses HORECA terms (NOMs, shifts), but mixes DB implementation names (e.g. `TimeField`) in user labels. |
| 3 | User Control and Freedom | 4 | Robust undo/redo functionality (Ctrl+Z) and clear confirmation/exit safety nets. |
| 4 | Consistency and Standards | 2 | Uses shadows (`shadow-sm`, `shadow-md`) which violates the Flat-By-Default design system rule. |
| 5 | Error Prevention | 3 | Step deletion confirmation and input range limits. |
| 6 | Recognition Rather Than Recall | 3 | Steps cannot be edited inline on the canvas; properties are separated in a slide-out drawer. |
| 7 | Flexibility and Efficiency | 2 | Settings dialog is a massive "wall of options" with no shortcuts or bulk-edit capabilities. |
| 8 | Aesthetic and Minimalist Design | 2 | Workflow Settings modal has heavy cognitive load (20+ inputs). Some cards use visual shadows. |
| 9 | Error Recovery | 3 | Sonner toast error notifications and unsaved changes warn on page exit. |
| 10 | Help and Documentation | 3 | Dialogs/Forms utilize Info/Help tooltips for complex configurations. |
| **Total** | | **28/40** | **Good (Solid foundation, address weak areas)** |

## Anti-Patterns Verdict

### LLM Assessment
The builder codebase displays high usability, but exhibits several aesthetic and structural Tells:
- **Shadow Cliché:** The use of `shadow-sm` on Canvas step items at rest and `shadow-md` on preview cards violates the **Flat-by-Default** constraint of Pulso. Tonal layers and crisp borders should carry the structure instead.
- **Form Wall:** The Workflow Settings modal acts as an administrative dump of settings, packing AI providers, compliance checks, scheduling, shift times, and custom webhook actions into a single scrollable pane.

### Deterministic Scan
- The automated design scanner detected **0 violations** on code structures (clean parser run), indicating no severe raw markup issues or disallowed inline styles.

### Visual Overlays
- No live browser visualization overlay was injected (visual test skipped: local browser tab context is inactive).

## Overall Impression
The builder interface is a functional, feature-rich workspace with excellent undo/redo safety controls. However, it suffers from visual drift (incorrectly applying shadows) and excessive density in the configuration modals. Refactoring settings into tabs and purging drop-shadows will dramatically elevate the professional feel of the product.

## What's Working
- **Command Control:** The built-in Undo/Redo stack with keyboard binding (`Ctrl+Z`) and dirty-state tracking keeps the user in total control of changes.
- **Compliance Alignment:** The settings modal features direct checkboxes and standard terminology for Mexican NOM regulations, translating complex regulatory frameworks into simple operational settings.

## Priority Issues

### [P1] Visual System Consistency (Design System Deviation)
- **Why it matters:** The builder cards use `shadow-sm` and `shadow-md` for visual division. This deviates from Pulso's core aesthetic rule (Flat-By-Default, depth conveyed solely by tonal layering), making the canvas feel generic and "AI-slop standard."
- **Fix:** Replace `shadow-*` utility classes with border configurations (`border border-border`) and color-contrasting backdrops (e.g. `bg-card` at rest, `bg-muted` for background).
- **Suggested command:** `$impeccable layout`

### [P1] Information Overload in Workflow Settings
- **Why it matters:** Packing versions, compliance dropdowns, AI retry logic, schedules, and post-action lists into one modal triggers choice paralysis. First-time users will abandon the form before completing it.
- **Fix:** Divide the settings modal into distinct tabs: *General*, *Programación*, *Cumplimiento e IA*, and *Acciones Finales*.
- **Suggested command:** `$impeccable distill`

### [P1] Interactive Canvas Semantics & Keyboard Focus
- **Why it matters:** Sortable canvas steps are constructed of plain `div` elements with custom click listeners. They lack `tabIndex={0}`, appropriate keyboard event handlers (`onKeyDown`), or ARIA roles, rendering them completely inaccessible to keyboard-only and screen reader users (Sam).
- **Fix:** Convert step containers into semantic `<button>` wrappers or append `tabIndex={0}`, `role="button"`, and keyboard handlers, with a visible outline focus ring.
- **Suggested command:** `$impeccable audit`

### [P2] Inconsistent/Mixed Field Nomenclature
- **Why it matters:** Step types in the toolbox display database/class jargon (`TimeField`, `TemperatureField`, `OPSLocationField`) alongside common lowercase tags (`text`, `checklist`). This leaks technical backend naming conventions to the end user and hurts readability.
- **Fix:** Align all step types to lowercase snake_case keywords and display clean, consistent Spanish labels.
- **Suggested command:** `$impeccable clarify`

## Persona Red Flags

### Alex (Power User)
- **Red Flag:** Canvas lacks quick keyboard hotkeys (e.g., Delete, Duplicate) to manipulate selected steps. The user is forced to target small hover-only trash icons or use the property sidebar to delete a step.
- **Impact:** Slows down template creation for managers setting up multi-step audit tasks.

### Jordan (First-Timer)
- **Red Flag:** The Settings modal greets the user with acronyms and configurations like "Proveedor de Respaldo", "NOM-030", and "Válido por (min)" with zero explanation or progressive disclosure.
- **Impact:** High confusion and abandonment at the template customization step.

### Sam (Accessibility-Dependent)
- **Red Flag:** Tab navigation bypasses the Canvas steps completely. Screen readers cannot focus or select steps, making it impossible to configure field details in the property editor.
- **Impact:** Core editor flow is entirely broken for keyboard/assistive tool users.

## Minor Observations
- In `WorkflowSettingsModal`, custom tags are added via text input but suggestions require clicking buttons. A unified combobox pattern would be more intuitive.
- The `duracionEstimada` input has a plain text placeholder (`5-10 min`) instead of a structured duration picker.

## Questions to Consider
- *Could we replace the sidebar-based property editor with inline editing for basic titles and placeholders to reduce layout jumping?*
- *Should we make the preview modal represent the actual mobile screen viewport directly rather than a desktop dialog, since operators perform these tasks on mobile devices?*
- *Could the AI verification config toggle be moved directly to the Photo component property options rather than living in the global settings modal?*
