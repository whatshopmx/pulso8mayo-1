# Tasks: Finance & Sales — Correctness Remediation

> **Plan:** `tasks/plan-critique-correctness.md` · **Source critique:** 2026-08-05
> **Package manager:** pnpm · **Build gate:** `pnpm build` typechecks *and* lints
> (`next.config.ts` sets neither `ignoreBuildErrors` nor `ignoreDuringBuilds`)
> **Test reality:** `tests/` is empty, no unit runner. Verification is `pnpm build` + scripted manual checks.

---

## Estado de implementación — 2026-08-05

**Código: tareas 1–18 implementadas.** Tarea 19 (infraestructura de tests) **diferida** por decisión
explícita: el plan la marca opcional y greenfield.

**Verificación automática ejecutada:** `npx tsc --noEmit` limpio y `npx eslint` limpio sobre todos los
archivos tocados. `pnpm build` **no** pudo correr: había otro `next build` sosteniendo el lock de
`.next/`. El typecheck y el lint son lo que esa puerta audita, pero el paso de compilación de Next
queda pendiente de correr una vez libre el lock.

**Las casillas de "Manual:" siguen sin marcar a propósito — ninguna se ejecutó.** Requieren sembrar
datos, bloquear endpoints en devtools o mover el reloj del sistema.

Decisiones tomadas con el usuario:
- **Rechazo terminal.** `REJECTED` es estado final; corregir un gasto exige registrar uno nuevo.
- **Umbral consolidado.** El `lowThreshold` sumado se reemplazó por "N de M sucursales bajo umbral".

Hallazgos y desviaciones respecto al plan:
- **`DIRECTOR_OPS` no existe en `roleEnum`** (`lib/db/schema/auth.ts:5`); solo aparece en el comentario
  de `approver_role`, que es `text` libre. No cabía en `ROLES_HIERARCHY: Record<Role, number>`, así que
  se añadió `APPROVER_ROLES_HIERARCHY` (superconjunto, `DIRECTOR_OPS: 85`) y ahí vive el
  `roleIsAtLeast` fail-closed. Ningún usuario puede portar ese rol: lo satisfacen ADMIN y superiores.
- **Chequeo pre-deploy ejecutado:** `SELECT approver_role … FROM expense_authorization_rules` devuelve
  **cero filas** en la BD de `pulso horeca`. No hay riesgo de bloqueo de aprobaciones; el agujero
  fail-open era latente, como anticipaba el plan.
- **`lib/permissions.ts` importaba `roleEnum` como valor** solo para derivar un tipo. Al consumirlo la
  página de gastos (cliente) eso habría arrastrado el schema de Drizzle al bundle; se cambió a
  `import type`.
- **`control-interno-service.ts` tenía su propia copia fail-open de `roleIsAtLeast`** (mismo defecto de
  la Tarea 4, no listado en el plan). Se eliminó a favor del helper canónico; el efecto es que ahora
  **sí** detecta `ROLE_MISMATCH` con roles desconocidos en vez de callarlo.
- **Tarea 15 cubrió 6 páginas**, como dice el plan. `app/dashboard/employees/onboarding/new/page.tsx`
  comparte el mismo fetch copiado pero llama a `/api/branches?active=true` y usa
  `branch.address || branch.location`, así que necesita un contrato distinto: **queda fuera**.
- **Tarea 17:** los colores de paleta cruda en `components/finance/audit-log-table.tsx` y
  `excepciones-panel.tsx` **no** se tocaron — el plan acota la tarea a los archivos de página. Siguen
  ahí (`bg-blue-100`, `bg-emerald-100`, …).

---

## Phase 1: Money Correctness

### Task 1: Correct arqueo variance sign and labels

**Description:** `sales/page.tsx:459` labels a cash **shortage** as `sobrante` and prefixes it with `+`.
Per `schema.ts:2369` (`cashCountedCents` = "efectivo contado físicamente") and `schema.ts:2368`
(`varianceCents` derived as `cashSales − cashCountedCents`), a positive variance means declared exceeds
counted — cash is **missing**. Extract the comparison to a pure helper so the sign is reviewable in one
place and the alert banner (`:248-253`) and the table cell share it.

**Acceptance criteria:**
- [ ] A cut with `cashSales = 50000`, `cashCountedCents = 45000` renders `−$500.00 (faltante)` in `text-destructive`
- [ ] A cut with `cashSales = 45000`, `cashCountedCents = 50000` renders `+$500.00 (sobrante)`
- [ ] Equal values render `cuadrado` in `text-success`
- [ ] The banner and the cell derive from the same exported helper

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] Manual: seed or edit one cut in each of the three states; confirm all three read correctly
- [ ] Manual: confirm the banner count matches the number of non-`cuadrado` rows on screen

**Dependencies:** None
**Files likely touched:** `app/dashboard/sales/page.tsx`, `lib/utils.ts` (or a new `lib/sales/cash-variance.ts`)
**Estimated scope:** S

---

### Task 2: Guard the missing-counterpart case

**Description:** `hasArqueo` (`sales/page.tsx:408`) tests only `cashCountedCents !== null`, but `variance`
also requires `cashSales !== null` (`:409-412`). When a cut has a count and no declared cash the cell
takes the `hasArqueo` branch with `variance === null`, and `Math.abs(null!)` renders a red
`Diferencia: $0.00 (faltante)` for a cut that has no comparison at all.

**Acceptance criteria:**
- [ ] A cut with `cashCountedCents` set and `cashSales = null` renders `Contado: $X` and `—` for the difference
- [ ] No `Math.abs`/`>` operation is performed on a possibly-null variance
- [ ] The non-null assertions (`variance!`) in this cell are gone

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] Manual: create a cut with a count but no declared cash; confirm no red `$0.00`

**Dependencies:** Task 1 (shares the helper)
**Files likely touched:** `app/dashboard/sales/page.tsx`
**Estimated scope:** XS

---

### Task 3: Build date presets in local time

**Description:** `toISODate` (`sales/page.tsx:144`) uses `toISOString()`, which converts to UTC. In
`America/Mexico_City` (UTC−6) every preset rolls forward after 18:00 local, so "Hoy" queries tomorrow and
returns nothing during peak service. Line 418 already demonstrates the correct local-parsing intent.

**Acceptance criteria:**
- [ ] `toISODate` builds the string from `getFullYear` / `getMonth` / `getDate`, never `toISOString`
- [ ] With the system clock at 21:00 local, "Hoy" sets both dates to today
- [ ] "Este mes" starts on day 01 of the current local month

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] Manual: set the OS clock past 18:00 (or stub `Date`), click each of the four presets, confirm the date inputs

**Dependencies:** None
**Files likely touched:** `app/dashboard/sales/page.tsx`
**Estimated scope:** XS

### ✅ Checkpoint: Money Correctness
- [ ] All three arqueo states read correctly; no phantom `$0.00`
- [ ] Presets correct after 18:00 local
- [ ] `pnpm build` clean — **review with human before Phase 2**

---

## Phase 2: Authorization Integrity

### Task 4: Add `DIRECTOR_OPS` and make role resolution fail closed

**Description:** `ROLES_HIERARCHY` (`lib/permissions.ts:19-27`) omits `DIRECTOR_OPS`, which
`schema.ts:2704` sanctions as an `approver_role` and `docs/plan-implementacion-pendientes.md:23` assigns
to the $5,001–$20,000 band. `roleIsAtLeast` (`expense-service.ts:59-60`) resolves it via `?? 0`, so
`requiredLevel` becomes 0 and **every role including `READONLY` satisfies it**. Currently latent — no seed
creates such a rule — but armed the moment an admin configures that band.

**Acceptance criteria:**
- [ ] `DIRECTOR_OPS` is in `ROLES_HIERARCHY` at a level between `GERENTE` (80) and `ADMIN` (90)
- [ ] `roleIsAtLeast` returns `false` when *either* role is absent from the map, instead of coercing to 0
- [ ] An unknown role is logged with enough context to diagnose a denial
- [ ] Approval by `OWNER` / `ADMIN` / `GERENTE` within their bands still succeeds

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] **Pre-deploy:** `SELECT DISTINCT approver_role FROM expense_authorization_rules` — every value present in `ROLES_HIERARCHY`
- [ ] Manual: create a rule requiring `DIRECTOR_OPS`; confirm `EMPLEADO` is denied and `DIRECTOR_OPS` is allowed
- [ ] Manual: confirm no regression on an existing `OWNER`-band expense

**Dependencies:** None
**Files likely touched:** `lib/permissions.ts`, `lib/services/expense-service.ts`
**Estimated scope:** S — **highest-risk task in the plan; see the lockout risk in the plan doc**

---

### Task 5: Delete the duplicated client role map

**Description:** `expenses/page.tsx:30-38` is a byte-for-byte copy of the canonical hierarchy. Import the
real one so the client gate cannot drift from the server's.

**Acceptance criteria:**
- [ ] The local `ROLE_HIERARCHY` const is deleted; `ROLES_HIERARCHY` is imported from `@/lib/permissions`
- [ ] `ROLE_LABELS` covers every role in the canonical map (currently it lists `DIRECTOR_OPS` that the old map lacked — the inverse gap)
- [ ] The "Requiere X" affordance still renders the right label for each band

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] Manual: as a `GERENTE`, confirm an `OWNER`-band expense still shows "Requiere Dueño"

**Dependencies:** Task 4
**Files likely touched:** `app/dashboard/finance/expenses/page.tsx`
**Estimated scope:** XS

### ✅ Checkpoint: Authorization
- [ ] `DIRECTOR_OPS` band enforced in both directions
- [ ] No approval lockout regression
- [ ] `pnpm build` clean — **review with human before Phase 3**

---

## Phase 3: Failure States That Lie

### Task 6: Fix the petty-cash permanent spinner

**Description:** `loading` initializes `true` and `fetchData` early-returns on `branches.length === 0`
without clearing it (`petty-cash/page.tsx:59-62`). If `/api/branches` fails, the catch sets `error` but
the render tests `loading` first (`:160-175`) — the error state is unreachable in exactly the case that
produces it. Same for a company with zero branches.

**Acceptance criteria:**
- [ ] Branch-fetch failure clears `loading` and renders the error `EmptyState` with retry
- [ ] A company with zero branches renders a distinct "no branches" empty state, not a spinner
- [ ] Retry re-attempts both the branches fetch and the fund fetch

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] Manual: block `/api/branches` in devtools; confirm the error state appears and retry works

**Dependencies:** None
**Files likely touched:** `app/dashboard/finance/petty-cash/page.tsx`
**Estimated scope:** S

---

### Task 7: Fix consolidated petty-cash percentages and threshold semantics

**Description:** Two defects at `petty-cash/page.tsx:92-99` and `:120-122`. When `fundAmount = 0` the
percentages become `Infinity`/`NaN` — the clamp at `:210` protects the bar width but the badge at `:190`
renders `Suficiente (NaN%)`. Separately, the consolidated view **sums `lowThreshold` across branches**,
which is not an additive quantity: the chain can sit above the aggregate while individual branches starve.

**Acceptance criteria:**
- [ ] `fundAmount = 0` renders no `NaN` or `Infinity` in any visible string
- [ ] The consolidated view reports "N de M sucursales bajo umbral" instead of a summed threshold
- [ ] The single-branch view is unchanged

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] Manual: a fund with `fundAmount = 0` renders a sane badge
- [ ] Manual: with one branch below threshold and the chain total above it, the consolidated view flags it

**Dependencies:** Task 6 (same file)
**Files likely touched:** `app/dashboard/finance/petty-cash/page.tsx`
**Estimated scope:** S — **gated on Open Question 4**

---

### Task 8: Give the mapping page an error state

**Description:** `fetchTemplates` (`mapping/page.tsx:44-52`) only `console.error`s, and the
`if (res.ok && data.success)` has no `else`. A failed load renders "Sin plantillas configuradas" with a
"Crear primera plantilla" CTA — telling users their config doesn't exist and inviting them to recreate it.
This is the only page in the set with no error state.

**Acceptance criteria:**
- [ ] Load failure sets an `error` and renders the error `EmptyState` with a working retry
- [ ] The "no templates yet" empty state renders **only** on a successful empty response
- [ ] The non-OK response branch surfaces the server's message

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] Manual: block `/api/sales/mapping-templates`; confirm the error state, not the empty state

**Dependencies:** None
**Files likely touched:** `app/dashboard/sales/mapping/page.tsx`
**Estimated scope:** XS

### ✅ Checkpoint: Failure States
- [ ] With the network blocked, no page in either directory spins forever or claims data is absent
- [ ] `pnpm build` clean

---

## Phase 4: Self-Contradicting Features

### Task 9: Load the exceptions count on mount

**Description:** `fetchViolations` runs only when `activeTab !== "audit"` (`control-interno/page.tsx:75-81`)
and `activeTab` defaults to `"audit"`. The badge whose purpose is advertising unseen violations reads `0`
until the user opens the tab it is meant to advertise.

**Acceptance criteria:**
- [ ] The violation count loads on mount, before any tab interaction
- [ ] The badge reflects the true count on first paint
- [ ] Switching tabs does not refetch data already loaded

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] Manual: with ≥1 known violation, load the page and confirm the badge without clicking

**Dependencies:** None
**Files likely touched:** `app/dashboard/finance/control-interno/page.tsx`
**Estimated scope:** XS

---

### Task 10: Apply the branch filter to exceptions

**Description:** The branch `Select` sits above both tabs, but `fetchViolations` (`:59-73`) ignores
`selectedBranch` and sends no `branchId`. Selecting a branch and switching tabs shows every branch's
violations under a control claiming otherwise.

**Acceptance criteria:**
- [ ] `fetchViolations` passes `branchId` and re-runs when `selectedBranch` changes
- [ ] If `/api/finance/control-interno/excepciones` cannot filter by branch, the endpoint is extended — the selector is **not** left silently inert
- [ ] The badge count respects the active filter

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] Manual: with violations in two branches, select one and confirm only its violations and count appear

**Dependencies:** Task 9
**Files likely touched:** `app/dashboard/finance/control-interno/page.tsx`, `app/api/finance/control-interno/excepciones/route.ts`, `lib/services/control-interno-service.ts`
**Estimated scope:** M

---

### Task 11: Add the expense rejection path

**Description:** `REJECTED` is in the status union and has a rendered badge (`expenses/page.tsx:57, 204-209`),
but no reject endpoint exists and `REJECTED` appears nowhere in `expense-service.ts` or `app/api/expenses/`.
The only action is Approve, so a bad expense sits `PENDING_APPROVAL` forever — at which point
Control Interno flags it as ">48h sin aprobar" (`control-interno/page.tsx:159`). The exceptions panel
reports a failure the UI makes unavoidable.

**Acceptance criteria:**
- [ ] `rejectOperatingExpense` enforces the same authority as approve (reuses `roleIsAtLeast` + `findAuthorizationRule`)
- [ ] `POST /api/expenses/reject` validates with zod and returns via `ApiHandler`, matching the approvals route
- [ ] A rejection **requires** a reason; it is persisted to `approvalNotes` and appears in the bitácora
- [ ] The reject button is gated by the same role check as approve and confirmed via `AlertDialog`

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] Manual: reject a pending expense; confirm the badge flips to Rechazado and the reason appears in Control Interno
- [ ] Manual: confirm an under-privileged user cannot reject

**Dependencies:** Task 4 (role resolution) · **gated on Open Question 1 (terminal vs. resubmittable)**
**Files likely touched:** `lib/services/expense-service.ts`, `app/api/expenses/reject/route.ts`, `app/dashboard/finance/expenses/page.tsx`
**Estimated scope:** M — largest task in the plan

---

### Task 12: Capture real approval notes

**Description:** `handleApprove` (`expenses/page.tsx:129`) hardcodes
`notes: "Aprobado por administración"`. The dialog promises the approval "queda registrada en la bitácora
de autorizaciones" and every row in that bitácora carries the identical string — the audit log is
populated and informationally empty. `notes` is already optional on the server (`approvals/route.ts:10`).

**Acceptance criteria:**
- [ ] The existing `AlertDialog` gains an optional notes field
- [ ] The typed value is sent; no hardcoded fallback string is submitted
- [ ] An empty note sends `undefined`, not a placeholder
- [ ] Control Interno displays the captured note

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] Manual: approve with a note and confirm it renders in the bitácora

**Dependencies:** Task 11 (shares the dialog pattern)
**Files likely touched:** `app/dashboard/finance/expenses/page.tsx`
**Estimated scope:** S

---

### Task 13: Stop the false-alarm aggregator variance and scope the input state

**Description:** Two defects in `AggregatorConciliation` (`sales/page.tsx:526-626`). The card's own copy
says liquidation "llega neta de comisión" (`:513`), so `reported > liquidated` is **expected** — yet
`:598-614` paints it `destructive`, making every healthy aggregator an error on day one. Separately,
`liquidated` (`:548`) is keyed by aggregator slug and the component never unmounts on filter change, so a
value typed under Branch A **persists while `reported` changes to Branch B**, producing a variance between
unrelated figures.

**Acceptance criteria:**
- [ ] A positive variance is presented neutrally as the commission-and-adjustment delta, not as an error
- [ ] Only a *negative* variance (liquidation exceeds reported sales) is flagged as anomalous
- [ ] `liquidated` resets when the branch or date filter changes
- [ ] The card states plainly that entries are not saved (or Open Question 3 resolves toward persistence)

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] Manual: enter a liquidation below reported; confirm it is not red
- [ ] Manual: enter a value, switch branch, confirm the field clears

**Dependencies:** None · **scope-limited by Open Questions 2 and 3 — no commission rate exists in the schema**
**Files likely touched:** `app/dashboard/sales/page.tsx`
**Estimated scope:** S

---

### Task 14: Gate and reset the timbrado form

**Description:** Stamping a CFDI de nómina files a document with the SAT, consumes a paid timbre, and needs
a formal cancellation to undo — and it fires on one unguarded click (`fiscal/page.tsx:172-184`). The form
is never cleared on success (`:58`) and the button re-enables, so a second click double-stamps the same
receipt. This codebase already gates irreversible actions with `AlertDialog` (expenses, mapping); the one
action that files with the tax authority is not gated. The two currency inputs (`:150-168`) are also
uncontrolled — they have `onChange` but no `value`, unlike the other four fields.

**Acceptance criteria:**
- [ ] Timbrado requires an `AlertDialog` confirmation summarizing employee, period and amount
- [ ] On success the form is reset or locked so the same payroll cannot be re-stamped without an explicit new entry
- [ ] Both currency inputs are controlled, displaying pesos while state holds cents
- [ ] The button stays disabled for the entire in-flight request

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] Manual: confirm the dialog appears and cancelling sends no request (devtools Network)
- [ ] Manual: after a successful stamp, confirm re-submitting the same data is not possible in one click

**Dependencies:** None
**Files likely touched:** `app/dashboard/finance/fiscal/page.tsx`
**Estimated scope:** S

### ✅ Checkpoint: Features
- [ ] Badge populated on mount; branch filter honest; rejection possible; notes meaningful
- [ ] Timbrado gated and non-repeatable
- [ ] `pnpm build` clean — **review with human before Phase 5**

---

## Phase 5: Consistency

### Task 15: Extract `useBranches()` and retire the six copy-pasted fetches

**Description:** Six pages repeat the same fetch with
`data.data || data.branches || (Array.isArray(data) ? data : [])`. `app/api/branches/route.ts:17` returns
`ApiHandler.success(branches)` — the shape is unambiguously `{ success, data }`. The triple fallback
guards against shapes the API never returns, and the copy-paste is evidence nobody checked.

**Acceptance criteria:**
- [ ] `hooks/use-branches.ts` exposes `{ branches, loading, error, refetch }` and parses the real shape only
- [ ] All six pages consume it; no page retains a local branches fetch
- [ ] Every page disables its branch `Select` while loading (only `sales` does today)

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] Manual: each of the six pages still populates its branch selector
- [ ] Manual: with `/api/branches` blocked, each page degrades to an error state (regression check on Task 6)

**Dependencies:** Tasks 6, 7, 8, 9, 10 — **sequenced last to avoid colliding with page-level work**
**Files likely touched:** `hooks/use-branches.ts` + the 6 page files
**Estimated scope:** M

---

### Task 16: Consolidate currency formatting

**Description:** `formatMXN` is defined identically three times (`sales:126`, `expenses:187`,
`petty-cash:117`) and inlined twice more (`sales:582, 610`), while `lib/utils.ts:8` already exports
`formatCurrency` — which takes **pesos**, not cents.

**Acceptance criteria:**
- [ ] A single cents-based formatter is exported from `lib/utils.ts`
- [ ] All five call sites use it; no local `formatMXN` remains in either directory
- [ ] Existing `formatCurrency` callers elsewhere are unaffected

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] Manual: spot-check one amount per page for unchanged formatting

**Dependencies:** Tasks 1-14
**Files likely touched:** `lib/utils.ts`, `sales/page.tsx`, `expenses/page.tsx`, `petty-cash/page.tsx`
**Estimated scope:** S

---

### Task 17: Semantic colors, correct retry icon, form labels

**Description:** Hardcoded palette colors break the theme system: `bg-red-500`/`bg-amber-500`
(`control-interno:127`), `bg-emerald-100 text-emerald-700` (`fiscal:197`) — while
`statusBadgeClasses` (`lib/utils.ts:21`) exists for this and is used correctly at `sales:133-137`.
`Loader2` is used as the static *retry* icon in three files (`expenses:271`, `petty-cash:171`,
`cash-flow:106`). The paired date inputs (`sales:303-315`) have no labels, the `?` affordance
(`sales:183-188`) is an unfocusable `<span>` with `title`, and evidence opens via `window.open` on a
`<Button>` (`expenses:317-324`), discarding middle-click and copy-link.

**Acceptance criteria:**
- [ ] No hardcoded palette color classes remain in either directory
- [ ] Retry buttons use `RefreshCw`; `Loader2` is reserved for in-flight state
- [ ] Both date inputs carry accessible labels; the `?` affordance is keyboard-focusable
- [ ] Evidence links are anchors, matching the `asChild` + `Link` pattern in `mapping/page.tsx:92-96`

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] Manual: toggle dark mode and confirm no washed-out badges
- [ ] Manual: tab through the sales filters and reach every control

**Dependencies:** Tasks 1-14
**Files likely touched:** `control-interno/page.tsx`, `fiscal/page.tsx`, `expenses/page.tsx`, `petty-cash/page.tsx`, `cash-flow/page.tsx`, `sales/page.tsx`
**Estimated scope:** M

---

### Task 18: Type the `any[]` state and surface audit-log truncation

**Description:** `auditEntries` and `violations` (`control-interno:19-21`) and `projection`
(`cash-flow:18`) are `any[]`, while sibling pages define proper interfaces — these feed audit and treasury
surfaces. Separately, the audit log requests `limit=100` (`control-interno:46`) with no indication more
exists; for a compliance surface a hidden cutoff is worse than a slow page.

**Acceptance criteria:**
- [ ] `AuditEntry`, `Violation` and `CashFlowDay` interfaces exist and are used; no `any[]` remains
- [ ] The audit log shows total vs. displayed count when truncated
- [ ] Types are derived from or reconciled against the service return shapes

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] Manual: with >100 entries, confirm the truncation notice appears

**Dependencies:** Tasks 9, 10
**Files likely touched:** `control-interno/page.tsx`, `cash-flow/page.tsx`, `lib/services/control-interno-service.ts`
**Estimated scope:** S

---

### Task 19 (optional): Seed Playwright coverage on the money path

**Description:** `tests/` is empty and `playwright.config.ts` has no specs, so every fix above is
protected only by manual checks. The Task 1 variance helper is pure and the highest-value thing to lock
down. **This is greenfield test infrastructure, not a fix** — see Open Question 5.

**Acceptance criteria:**
- [ ] A spec covers the three arqueo states (faltante / sobrante / cuadrado)
- [ ] A spec covers approval denial for an under-privileged role
- [ ] `pnpm test:e2e` runs green locally

**Verification:**
- [ ] `pnpm test:e2e` passes
- [ ] Manual: invert the sign in the helper and confirm the spec fails

**Dependencies:** Tasks 1, 4
**Files likely touched:** `tests/sales-arqueo.spec.ts`, `tests/expense-approval.spec.ts`
**Estimated scope:** M

### ✅ Checkpoint: Complete
- [ ] All 14 findings resolved or explicitly deferred with a written reason
- [ ] `pnpm build` and `pnpm lint` clean
- [ ] Re-run `$impeccable critique app/dashboard/finance app/dashboard/sales`

---

## Parallelization

- **Safe in parallel:** Task 3 · Task 8 · Task 14 — independent files, no shared state
- **Must be sequential:** Tasks 1→2 (shared helper) · 4→5→11 (role chain) · 6→7 (same file) · 9→10 (same file)
- **Must be last:** Task 15 (touches all six pages)
