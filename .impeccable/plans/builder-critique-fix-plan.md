# Plan: Builder Critique Fix

**Target:** `app/dashboard/builder/`
**Critique score:** 20/40 → target: 32+
**Created:** 2026-07-22
**Status:** ✅ Completed 2026-07-22

---

## Phase 1-3: Polish preview page (visual + contrast + a11y) ✅

**File:** `app/dashboard/builder/preview/[id]/preview-client.tsx`

| Issue | Fix |
|-------|-----|
| Gradient bg `from-slate-50 to-slate-100` | `bg-background` |
| Device frame `border-slate-800`, `bg-slate-800/900` | `border-border`, theme tokens |
| `rounded-[2.5rem]` (40px) | `rounded-xl` (12px) |
| Emoji severity: 🔴🔶⚠️✅📋 | Lucide icons + design token colors |
| Emoji headers: 🤖🔧📢 | Lucide icons |
| Hardcoded colors (~30 instances) | Design token classes |
| Badge contrast `text-red-600 bg-red-50` etc. | `text-destructive bg-destructive/10` etc. |
| Unlabeled form controls | `htmlFor`/`id` pairs + `Label` component |

**Command:** `$impeccable polish app/dashboard/builder/preview/[id]/preview-client.tsx`

---

## Phase 4: Localize editor header ✅

**File:** `app/dashboard/builder/editor/[id]/editor-client.tsx`

| English | Spanish |
|---------|---------|
| "Settings" | "Configuración" |
| "Preview" | "Vista Previa" |
| "Save" / "Saving..." | "Guardar" / "Guardando..." |
| "steps" | "pasos" |
| "Template Name" | "Nombre de la Plantilla" |
| "Template saved successfully!" | "Plantilla guardada" |
| "Failed to save template" | "Error al guardar la plantilla" |

**Command:** `$impeccable clarify app/dashboard/builder/editor/[id]/editor-client.tsx`

---

## Phase 5: Localize preview text ✅

**File:** `app/dashboard/builder/preview/[id]/preview-client.tsx`

| English | Spanish |
|---------|---------|
| "Preview Mode" | "Modo de Vista Previa" |
| "Workflow Steps" | "Pasos del Flujo" |
| "{n} steps total" | "{n} pasos en total" |
| "Step X of Y" | "Paso X de Y" |
| "Previous" / "Next" | "Anterior" / "Siguiente" |
| "Enter value" / "Enter text" | "Ingresa valor" / "Ingresa texto" |
| "Select option" / "Choose..." | "Selecciona opción" / "Elige..." |
| "Tap to take photo" etc. | "Toca para tomar foto" etc. |
| "This is what the user will interact with" | "Vista previa del campo" |

**Command:** `$impeccable clarify app/dashboard/builder/preview/[id]/preview-client.tsx`

---

## Phase 6: Autosave / dirty state ✅

**File:** `app/dashboard/builder/editor/[id]/editor-client.tsx`

- Add `beforeunload` warning when dirty
- Debounced autosave to PATCH `/api/templates/${id}`
- Dirty state tracking (compare current steps to last saved)

**Command:** `$impeccable harden app/dashboard/builder/editor/[id]`

---

## Final verification ✅

**Command:** `$impeccable critique app/dashboard/builder`
Also removed stray `console.log` statements from `editor/[id]/page.tsx` and `builder-context.tsx`.
