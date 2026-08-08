
# Implementation Plan: Finance & Sales — Correctness Remediation

> **Source:** `$impeccable critique app/dashboard/finance app/dashboard/sales` (2026-08-05)
> **Predecessor:** `plan-finance-sales-critique.md` (2026-08-04) — that plan's 7 findings are shipped
> (`statusBadgeClasses`, date presets, `?` tooltips, cash-flow early-warning redesign are all in the tree).
> This plan addresses a **different and more serious class of finding** surfaced by the follow-up review:
> correctness defects, not design polish.

## Overview

Fourteen findings across seven page files. Unlike the previous round, the majority are **defects that
report false financial facts or silently disable a control**, not aesthetic issues. Three touch server
code (`lib/permissions.ts`, `lib/services/expense-service.ts`, a new reject endpoint); the rest are
frontend. The work is ordered so that the two findings which actively misinform an owner about cash
ship first, and the authorization hole closes second.

## Architecture Decisions

- **Fix the arqueo sign bug in place, and extract the variance calculation to a pure helper.** The
  comparison currently lives inline in JSX (`sales/page.tsx:409-413`) and is duplicated with different
  semantics in the alert banner (`:248-253`). One exported helper — `computeCashVariance(cut)` returning
  `{ variance, direction: 'faltante' | 'sobrante' | 'cuadrado' } | null` — makes the sign
  reviewable in one place and lets the banner and the cell agree by construction.

- **`roleIsAtLeast` must fail closed.** Both the client gate and `expense-service.ts:59-60` resolve
  unknown roles with `?? 0`, so an unrecognized `approverRole` grants access to everyone including
  `READONLY`. Adding `DIRECTOR_OPS` to `ROLES_HIERARCHY` fixes today's gap; changing the fallback to
  reject unknown roles fixes the entire class. Both are required — the first alone leaves the next typo
  fail-open.

- **The client stops maintaining its own role hierarchy.** `expenses/page.tsx:30-38` is a byte-for-byte
  copy of `lib/permissions.ts:19-27`. It gets deleted and the canonical map imported. The client gate
  remains a UX affordance only; `expense-service.ts:145-160` is and stays the enforcement point.

- **Aggregator reconciliation is descoped to a *presentation* fix in this plan.** The card flags
  `reported > liquidated` as `destructive`, but its own copy says liquidation arrives net of commission —
  so the expected case is painted as an error. A correct fix compares against an expected commission
  rate, and **no commission rate exists anywhere in the schema** (`aggregatorSales` is a bare `jsonb`
  blob at `schema.ts:2373`). Building that config is a separate initiative. Here we stop the false
  alarm and stop the cross-branch data bleed; we do not invent a rate.

- **No new test framework.** `tests/` is empty, there is no vitest/jest, and `playwright.config.ts` has
  zero specs. Standing up a unit runner is not in scope for a correctness patch. `pnpm build` is a real
  gate (`next.config.ts` does not set `ignoreBuildErrors` or `ignoreDuringBuilds`, so it typechecks and
  lints); everything else is a scripted manual check. Task 15 optionally seeds the first Playwright spec
  on the money path — see Open Questions.

- **File naming follows repo convention, not the skill default.** `tasks/todo.md` is an active Executive
  OS sprint with 76 open items and `tasks/plan.md` does not exist; every plan here is suffixed. Writing
  to `tasks/plan.md` / `tasks/todo.md` would have destroyed live work.

## Dependency Graph

```
lib/permissions.ts (ROLES_HIERARCHY + fail-closed)
    │
    ├── lib/services/expense-service.ts (roleIsAtLeast, reject fn)
    │       │
    │       ├── app/api/expenses/reject/route.ts  ── new
    │       │       │
    │       │       └── expenses/page.tsx (reject UI + notes capture)
    │       │
    │       └── expenses/page.tsx (import canonical map)
    │
    └── (independent) sales/page.tsx  · petty-cash · mapping · control-interno · fiscal
                                    │
                                    └── hooks/use-branches.ts (consumed by 6 pages, refactor last)
```

Nothing in Phase 1 depends on anything. Phase 5's `useBranches` refactor touches six files and is
deliberately last so it does not collide with every preceding task.

## Task List

### Phase 1: Money Correctness — ship first
- [ ] Task 1: Correct arqueo variance sign and labels
- [ ] Task 2: Guard the missing-counterpart case
- [ ] Task 3: Build date presets in local time

### Checkpoint: Money Correctness
- [ ] A short till reads `−$X (faltante)`; an over till reads `+$X (sobrante)`
- [ ] A cut with a count but no declared cash shows `—`, not a red `$0.00`
- [ ] "Hoy" returns today's date when the clock is past 18:00 local
- [ ] `pnpm build` clean

### Phase 2: Authorization Integrity
- [ ] Task 4: Add `DIRECTOR_OPS` and make role resolution fail closed
- [ ] Task 5: Delete the duplicated client role map

### Checkpoint: Authorization
- [ ] An expense requiring `DIRECTOR_OPS` is **not** approvable by `EMPLEADO` or `READONLY`
- [ ] A `DIRECTOR_OPS` user *can* approve within their band
- [ ] Existing `OWNER` / `GERENTE` approvals still succeed — **no lockout regression**
- [ ] `pnpm build` clean

### Phase 3: Failure States That Lie
- [ ] Task 6: Fix the petty-cash permanent spinner
- [ ] Task 7: Fix consolidated petty-cash percentages and threshold semantics
- [ ] Task 8: Give the mapping page an error state

### Checkpoint: Failure States
- [ ] With `/api/branches` forced to 500, every page shows an error with retry — none spin forever
- [ ] A failed template load says "failed to load", never "you have no templates"
- [ ] A fund with `fundAmount = 0` renders no `NaN%` / `Infinity%`

### Phase 4: Self-Contradicting Features
- [ ] Task 9: Load the exceptions count on mount
- [ ] Task 10: Apply the branch filter to exceptions (or scope the control)
- [ ] Task 11: Add the expense rejection path
- [ ] Task 12: Capture real approval notes
- [ ] Task 13: Stop the false-alarm aggregator variance and scope the input state
- [ ] Task 14: Gate and reset the timbrado form

### Checkpoint: Features
- [ ] The exceptions badge shows a count before the tab is opened
- [ ] A pending expense can be rejected, and the >48h exception stops being unavoidable
- [ ] The approval bitácora contains distinguishable notes
- [ ] Timbrado requires confirmation and cannot be double-fired

### Phase 5: Consistency
- [ ] Task 15: Extract `useBranches()` and retire the six copy-pasted fetches
- [ ] Task 16: Consolidate currency formatting
- [ ] Task 17: Semantic colors, correct retry icon, form labels
- [ ] Task 18: Type the `any[]` state and surface audit-log truncation

### Checkpoint: Complete
- [ ] All 14 findings resolved or explicitly deferred with a written reason
- [ ] `pnpm build` and `pnpm lint` clean
- [ ] Re-run `$impeccable critique app/dashboard/finance app/dashboard/sales`

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Fail-closed role resolution locks out live approvals** if any rule row holds a role string absent from `ROLES_HIERARCHY` | **High** | Before deploying Task 4, run `SELECT DISTINCT approver_role FROM expense_authorization_rules` and confirm every value is in the map. Log-and-deny on unknown roles so the lockout is diagnosable, never silent. |
| Sign fix applied to the wrong side, doubling the error | High | Task 1 is driven by the schema comment (`schema.ts:2369`, "efectivo contado físicamente") and `schema.ts:2368` (`varianceCents` derived `cashSales − cashCountedCents`), and verified against a hand-computed fixture in both directions before merge. |
| Rejection endpoint bypasses the same-role checks the approve path enforces | Medium | Task 11 reuses `roleIsAtLeast` and the `findAuthorizationRule` lookup; reject requires the same authority as approve. |
| Zero automated coverage on these pages — regressions are invisible | **High** | Accepted for this patch and stated plainly. Manual verification is scripted per task. Task 19 (optional) seeds Playwright coverage on the arqueo path. |
| `useBranches` refactor across 6 files collides with earlier tasks | Low | Sequenced last, after every page-level change has landed. |

## Open Questions

1. **Rejection semantics (blocks Task 11's design, not its start).** Should a rejected expense be
   terminal, or should it return to `PENDING_APPROVAL` for correction and resubmission? The status enum
   only offers `REJECTED`, which implies terminal. Confirm before building the UI.
2. **Aggregator commission rates.** Reconciliation cannot be meaningfully correct without an expected
   commission per aggregator. Should this become a config surface (`aggregator_commission_rates` keyed
   by company + aggregator), and is that a separate initiative? Task 13 only removes the false alarm.
3. **Reconciliation persistence.** Is the liquidation grid meant to be a saved record or a scratchpad?
   If saved, it needs a table and an endpoint — a new initiative, not a fix. Task 13 assumes scratchpad
   and makes it behave like one (clears on filter change).
4. **Consolidated petty-cash threshold.** Confirm replacing the summed `lowThreshold` with
   "N de M sucursales bajo umbral". Summing thresholds is not meaningful, but the current number may be
   in use in reporting.
5. **Test infrastructure.** Is standing up vitest in scope for a follow-up? The money helpers extracted
   in Task 1 are pure and ideal to lock down, but there is currently nothing to run them with.
