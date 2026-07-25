---
target: app/dashboard/builder/editor/[id]
total_score: 34
p0_count: 0
p1_count: 0
timestamp: 2026-07-22T17-34-45Z
slug: app-dashboard-builder-editor-id
---
# Impeccable Critique: Workflow Builder Editor (After Overhaul)

**Method**: ⚠️ DEGRADED: single-context (no sub-agent tool exposed)

**Target**: `app/dashboard/builder/editor/[id]` (Workflow Builder Editor)

---

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Autosave is now idle-based (3s inactivity) and shows a save status indicator ("X pasos • Sin guardar" / "X pasos • Guardado") in the header; console.log removed |
| 2 | Match System / Real World | 4 | Canvas card labels now use human-readable display names (e.g. "GPS Location") from `STEP_TYPE_DISPLAY` instead of internal type identifiers |
| 3 | User Control and Freedom | 4 | Complete undo/redo stack implemented (accessible via Ctrl+Z/Ctrl+Shift+Z and header buttons); unsaved exit confirm replaced with Radix AlertDialog; delete step has AlertDialog warning |
| 4 | Consistency and Standards | 4 | Inline duplicate SortableStep component removed and canvas migrated to polished standalone SortableStep; removed banned side-stripe border-l-4; duplicate ValidationConfig interface removed |
| 5 | Error Prevention | 4 | Step deletion has confirmation dialog; conditional branches and logic visibility have dropdown select fields populated with valid target step titles to prevent typos |
| 6 | Recognition Rather Than Recall | 4 | Dropdowns show step titles instead of asking users to remember and type raw UUIDs/field IDs; tooltips provide context and explanation on hover |
| 7 | Flexibility and Efficiency | 3 | Ctrl+Z, Ctrl+Shift+Z, and Ctrl+S shortcuts introduced; undo/redo buttons in header |
| 8 | Aesthetic and Minimalist Design | 4 | Common fields (placeholder, defaultValue, required, readOnly) are conditionally hidden for irrelevant step types (Info, Photo, Timer, etc.) to reduce clutter; Checklist and Select options blocks merged |
| 9 | Error Recovery | 4 | Autosave and manual save have proper toast states and retry/confirmation; deleted steps are recoverable via Undo/Redo |
| 10 | Help and Documentation | 3 | Contextual help tooltips added to all complex inputs in AI verification, conditional visibility, and branch configs |
| **Total** | | **34/40** | **Excellent (Flagship Grade)** |

---

## Anti-Patterns Verdict

### LLM Assessment
The overhaul successfully addressed all identified AI-code tells:
1. Removed `border-l-4` side-stripe from `sortable-step.tsx`.
2. Consolidated the two competing `SortableStep` implementations into a single polished standalone component.
3. Replaced raw internal identifiers with human-readable labels in the canvas.
4. Merged duplicated select and checklist options blocks into a single clean section.
5. Removed production console logs.

### Deterministic Scan
Re-running the detector shows **0 findings**. The `side-tab` warning is resolved, and all 17 typography sizing violations (`text-[10px]`) have been aligned with the `DESIGN.md` type ramp floor (`text-xs`).

---

## Summary of Changes

1. **Context & State (P0 & P1)**:
   - Added a history/future stack to `BuilderProvider` (max 50 snapshots).
   - Exposed `undo`, `redo`, `canUndo`, `canRedo` actions.
2. **Keyboard Shortcuts (P1)**:
   - Ctrl+Z (Undo), Ctrl+Shift+Z / Ctrl+Y (Redo), Ctrl+S (Manual Save) in `editor-client.tsx`.
3. **Save UX (P1)**:
   - Replaced fixed 30s timer with an idle-based 3s autosave.
   - Added a live status indicator (e.g. "12 pasos • Sin guardar" / "12 pasos • Guardado").
4. **Error Prevention (P0 & P1)**:
   - Replaced raw branch target step text inputs with `<Select>` dropdowns showing step titles.
   - Replaced conditional visibility field ID inputs with `<Select>` dropdowns showing step titles.
   - Replaced conditional visibility value input with conditional select options (e.g. "Sí" / "No" for yes/no steps, and option values for select steps).
   - Replaced browser `confirm()` with Radix `AlertDialog` for unsaved exit confirmation.
   - Replaced trash button in step header with a Radix `AlertDialog` confirmation wrapper.
5. **Indentation & Formatting**:
   - Fixed mixed 1-space indentation mapping block in `page.tsx` to clean 4-space indent.
   - Replaced hardcoded toolbox info callout yellow classes (`bg-yellow-50`, etc.) with design system-compliant `bg-muted` and `border-border`.
6. **Code Cleanup**:
   - Merged duplicated options list blocks (CHECKBOX vs SELECT) into a single reusable configuration block.
   - Gated fields like placeholder, default value, required, and readonly to hide them on irrelevant step types.
   - Removed duplicate `ValidationConfig` interface in `builder-context.tsx`.
   - Removed `console.log` from `canvas.tsx`.
