---
target: app/dashboard/builder
total_score: 20
p0_count: 0
p1_count: 2
timestamp: 2026-07-22T14-03-43Z
slug: app-dashboard-builder
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Toast notifications exist for save/delete/clone, but editor lacks autosave indicator |
| 2 | Match System / Real World | 3 | Spanish UI labels, date-fns/es locale. English/ES mix in editor (English button text, Spanish placeholders) |
| 3 | User Control and Freedom | 2 | Delete uses `confirm()` dialog (browser-native, no undo). No bulk operations. No "discard changes" on back-navigation |
| 4 | Consistency and Standards | 2 | Preview uses hardcoded Tailwind colors instead of design tokens. Builder uses shadcn components; preview uses raw `<input>`, `<select>`, `<button>` |
| 5 | Error Prevention | 2 | Form controls in preview are disabled but unlabeled. No validation preview. Save can fail silently on network error |
| 6 | Recognition Rather Than Recall | 3 | Template categories, step type icons, and tabs are visible. Step numbering clear. Category filter visible |
| 7 | Flexibility and Efficiency | 1 | No keyboard shortcuts. Single-step operations only (no batch edit, no bulk delete, no reorder save). Clone requires navigating away |
| 8 | Aesthetic and Minimalist Design | 2 | Preview page is visually noisy: gradient background, device frame with slate borders, hardcoded colors compete with design system. Template manager card grid is solid but the preview page over-decorates |
| 9 | Error Recovery | 1 | `confirm()` for delete is the only guard. No toast undo. No draft recovery if browser refreshes mid-edit |
| 10 | Help and Documentation | 1 | No contextual help, no tooltips on icons, no onboarding for first-time template creators |
| **Total** | | **20/40** | **Acceptable — significant improvements needed** |

---

## Anti-Patterns Verdict

**LLM assessment**: The template manager and editor follow the design system reasonably well (shadcn components, proper use of `Card`, `Button`, `Tabs`, consistent spacing). The preview page, however, is a different product: hardcoded `from-slate-50 to-slate-100` gradient background, device frame with `border-slate-800`, emoji (`🔴`, `🔶`, `🤖`, `🔧`, `📢`) in semantic content, direct `<input>`/`<select>`/`<button>` elements without form labels, and hardcoded color classes everywhere (`text-red-600 bg-red-50`, `border-green-500 bg-green-50 text-green-700`, etc.). The gap between the design system polish in the manager/editor and the freeform styling in the preview is the biggest symptom.

**Deterministic scan**: CLI detector returned `[]` (no findings) — a false negative; it likely doesn't parse TSX/JSX. Manual inspection found ~30 hardcoded Tailwind color values, 8 emoji in semantic content, 6 unlabeled form controls, 5 low-contrast severity badge patterns, and preview-only components that bypass the design system entirely.

---

## Overall Impression

The template manager is the most polished surface — clear card layout, sensible tab structure, proper loading/empty states. The editor's three-panel layout (toolbox → canvas → properties) is a proven pattern for builders. **The preview page is the outlier**: it ignores the design system, uses hardcoded colors everywhere, and relies on emoji for status indicators. The core issue is that the preview page was built as a standalone prototype rather than extending the design system.

---

## What's Working

1. **Template manager card grid** (`template-manager.tsx`): Clean 3-column responsive grid, proper use of `Card` components with header/content/footer, category badges, empty state with actionable CTA. The tabs (Mis Plantillas / Catálogo Pulso) are well-organized.

2. **Editor three-panel layout** (`editor-client.tsx`): Toolbox → Canvas → PropertyEditor is the right pattern for a workflow builder. The header has clear save/preview/settings actions. The breadcrumb back-button is a nice touch.

3. **Spanish-first localization**: Date formatting with `date-fns/locale/es`, Spanish category labels, template descriptions in Spanish. The UI clearly targets a Mexican audience.

---

## Priority Issues

**[P1] Preview page bypasses the entire design system**
- **What**: `preview-client.tsx` uses `bg-gradient-to-br from-slate-50 to-slate-100` (gradient background), hardcoded `border-slate-800` for device frame, `rounded-[2.5rem]` (40px — exceeds the 16px card max), raw `<input>`/`<select>`/`<textarea>` elements with no form labels, and emoji for severity/status indicators.
- **Why it matters**: This page looks like a different application. Users will question consistency and trust. The gradient background alone contradicts the "flat with tonal layering" principle. 40px border-radius is a Codex tell.
- **Fix**: Rewrite preview to use the design system: `bg-background` or `bg-card` instead of slate gradient, `rounded-xl` (12px) instead of `rounded-[2.5rem]`, replace emoji with Lucide icons, use `Button`/`Input`/`Label` components instead of raw HTML.
- **Suggested command**: `$impeccable polish preview-client.tsx`

**[P1] Severity badge contrast failures**
- **What**: Lines 51-55 of `preview-client.tsx` use `text-red-600 bg-red-50`, `text-orange-600 bg-orange-50`, `text-yellow-600 bg-yellow-50`, `text-green-600 bg-green-50`, `text-gray-600 bg-gray-50` — text and background are the same hue at different lightness, producing very low contrast ratios.
- **Why it matters**: WCAG requires 4.5:1 for body text. These badge texts are likely 2:1-3:1. Operations managers reading severity levels at a glance will struggle.
- **Fix**: Use the design system's semantic colors: `text-destructive` / `text-warning` / `text-success` / `text-muted-foreground` with their corresponding backgrounds from the OKLCH palette.
- **Suggested command**: `$impeccable colorize preview-client.tsx`

**[P2] Unlabeled form controls**
- **What**: `<input>`, `<textarea>`, `<select>`, `<input type="checkbox">` elements in `preview-client.tsx` lack proper `<label htmlFor>` associations. The visible text above each control is a `<label>` element, but it's not programmatically linked.
- **Why it matters**: Screen readers won't associate the label with the control. Keyboard navigation is degraded. Sam (accessibility persona) would struggle.
- **Fix**: Add `htmlFor`/`id` pairs to all form controls. Use the shadcn `Label` component where possible.
- **Suggested command**: `$impeccable audit preview-client.tsx`

**[P2] No undo / draft recovery in editor**
- **What**: The editor has save (`handleSave`), but no autosave, no "discard changes" confirmation on back-navigation, and no undo for step changes. Deleting steps from the canvas is permanent within a session until the user saves.
- **Why it matters**: A browser refresh mid-edit loses all unsaved changes. Riley (stress tester) would find this immediately. Operations managers with unstable connections will lose work.
- **Fix**: Add `beforeunload` warning when dirty. Consider debounced autosave. Add undo/redo stack.
- **Suggested command**: `$impeccable harden editor`

**[P3] Emoji in semantic content**
- **What**: 8 emoji used across `preview-client.tsx` — `🔴`, `🔶`, `⚠️`, `✅`, `📋`, `🤖`, `🔧`, `📢` — for severity indicators and section headers.
- **Why it matters**: Emoji render inconsistently across OS/browser, fail for screen readers, and look unprofessional in a B2B product.
- **Fix**: Replace with Lucide icons (`AlertTriangle`, `CheckCircle2`, `Info`, `Wrench`, `Megaphone`, `Bot`, etc.).
- **Suggested command**: `$impeccable polish preview-client.tsx`

---

## Persona Red Flags

### Alex (Power User)
- **No keyboard shortcuts** detected anywhere. Creating a template requires 4 clicks (button → loading → redirect → editor). Cloning a template from catalog requires clicking "Usar Plantilla", waiting for creation, then being redirected.
- **No bulk operations**: Can't select multiple templates and batch-delete or batch-archive. Can't reorder steps without drag-and-drop (if reorder exists, it's not visible in this surface).
- **No bulk clone from catalog**: Each template must be cloned individually.
- **Category filter causes re-render** but provides no keyboard-accessible way to clear the filter.

### Sam (Accessibility)
- **Preview is largely inaccessible**: unlabeled form controls, color-only severity indicators (🔴/🟢/🔶) with no text alternatives, emoji that screen readers will announce as "red circle" / "warning sign" / "robot face".
- **Custom interactive elements**: Step list items are `<button>` elements with no `aria-current` on the active step. Yes/No buttons in preview have no `aria-pressed`.
- **No visible focus indicators** beyond browser defaults.
- **Gradient background** (`bg-gradient-to-br from-slate-50 to-slate-100`) may create insufficient contrast for text on the preview page.

---

## Minor Observations

- **Template manager empty state** uses `border-2 border-dashed` with `bg-card` background — solid pattern, but the "Crear desde cero" link goes to `/dashboard/builder` which is the same page, creating a refresh loop.
- **Editor header English mix**: Button text is English ("Settings", "Preview", "Save", "Template Name", "steps") while the surrounding UI is Spanish. The `toast.success` message says "Template saved successfully!" — should be "Plantilla guardada".
- **Duplicate page.tsx**: `app/dashboard/builder/page.tsx` and `app/dashboard/builder/templates/page.tsx` both render `TemplateManager` with the same data fetch — this is a routing/duplication issue.
- **Preview step counter** shows "Step X of Y" in English while the rest of the project is Spanish-localized.
- **Template names with emoji** from the template library (🧼, 🌅, 🌙, etc.) propagate to the UI. Fine for the catalog tab, but may look inconsistent when cloned to user templates.
- **console.log statements** left in production code (`editor-client.tsx:124`, `editor/[id]/page.tsx:39-55`) — debugging noise in the shipped component.

---

## Questions to Consider

1. **"Does the preview page need to exist as built?"** It reimplements form controls that already exist in shadcn/ui, with custom styling that contradicts the design system. What if it reused the actual workflow execution form with a `previewMode` prop instead?

2. **"Would English button labels in an otherwise Spanish UI confuse a restaurant manager?"** The editor's header buttons are English ("Settings", "Save", "Preview") while template descriptions, categories, and navigation are Spanish. Pick one language per surface.

3. **"What would it take to make the preview page feel like it belongs to the same product?"** It currently reads as a standalone prototype. A `$impeccable polish` pass that replaces hardcoded colors with design tokens and emoji with Lucide icons would close half the gap.
