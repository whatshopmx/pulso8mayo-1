# INV-01.b4 smart-link POS upload: design review

Date: 2026-11-21. Mode: **Operate**. Scope: the existing workflow execution surface, extended by `components/workflow/pos-upload-step.tsx` and its integration in `components/execution/workflow-stepper.tsx`.

This is a component-local record following the shipped Impeccable documenter and `reference/document.md`, under the explicit narrow-extension boundary. `PRODUCT.md`, `DESIGN.md`, and `.impeccable/design.json` remain the established product and visual authorities. This extension introduces no replacement world, redesign, composition exploration, seed, or new global token rule.

## persistence

The shipped finish reviewer returned **ship**, with no material findings. This disposition is a bounded design-review verdict; it does not establish deployment, task acceptance, or verification in the real Next.js execution UI.

The form receives its branch and workflow instance from the execution. There is no branch selector. The business date preserves a saved value when available; otherwise it initializes to the browser's civil day after hydration. The operator can explicitly change it.

File selection, the date, and CSV column mappings precede **Guardar archivo POS**. Saving is explicit and distinct from the stepper's Next action. Selecting a file or changing its date/mapping clears the previous confirmed reference. Reading, uploading, or an unconfirmed/non-durable upload keeps the step pending and blocks advance. Preview disables the upload controls and performs no upload writes.

A durable evidence reference is distinct from confirmed sales ingestion. The result separately reports durable storage, linkage to cuts, inserted/corrected/unchanged product-day totals, revenue coverage, and individual row errors. A durable file may still show pending sales/linkage warnings; the UI does not present those as complete sales ingestion. Repeating an unchanged product-day total is explained without promising a second inventory deduction.

## fidelity

The extension uses incumbent `Button`, `Input`, and `Label` primitives inside the existing stepper card. Save uses the primary button; remove uses the ghost variant. Native file and date inputs and native CSV mapping selects preserve browser interaction conventions. CSV product-key guidance calls for the stable POS SKU when it differs from the recipe name.

Visual roles remain existing semantic tokens: primary/primary-foreground for the main action; background, muted-foreground, border, and input for the form; destructive for errors/non-durable evidence; warning for saved evidence with pending results; ring for keyboard focus. Type inherits the established Geist family, with small body copy, smaller helper text, and semibold result headings. No token values are duplicated or redefined here.

The layout uses a vertical field rhythm, full-width controls, shrinkable content, wrapping action buttons, and a rounded bordered result region. It adds no decorative depth or new shadow. Existing primitive focus treatments and the select's visible ring outline remain in place. Labels bind to unique input IDs; errors use alerts and results use a named polite live region.

Recovery remains local and actionable: 401 offers sign-in in another tab and retry; 403 surfaces the server's error; network failure asks the operator to check the connection and retry. Those states do not supply a confirmed reference or release a pending upload.

## ceiling

The finish review used the supplied desktop and mobile success screenshots:

- `.tmp/pos-workflow-desktop.png`
- `.tmp/pos-workflow-mobile.png`

These are **two synthetic success screenshots**. Error, pending, and keyboard-focus states were assessed from code only. The screenshots do not establish real Next.js integration behavior, authenticated end-to-end recovery, or every viewport/state. Automated tests and code checks are tracked separately by the parent task; this document makes no claim about their final results.

The bounded finish review is complete. No further visual polish pass is required by its verdict.

## material_fixes

None requested by the shipped finish reviewer. No UI changes were made by this documentation pass.

## keep

Keep execution-scoped branch identity, the explicit editable civil day, native selectors, stable-SKU guidance, and the separate Save then Next sequence. Keep pending/non-durable gating and the distinction between evidence storage, cut linkage, sales counts, revenue coverage, and row errors.

Keep the established semantic palette, Geist hierarchy, flat surfaces, shared primitives, responsive wrapping, and status copy tied to actual server results. These observations describe this component and do not promote one-off layout details into global design policy.

Not canonized: synthetic screenshot conditions, unobserved error/focus rendering, and implementation-specific layout utilities; none provides evidence for a new durable design-system rule.
