---
target: app/dashboard/compliance/
total_score: 18
p0_count: 0
p1_count: 4
timestamp: 2026-07-28T23-06-29Z
slug: app-dashboard-compliance
---
# Design Critique: app/dashboard/compliance/ (DEGRADED single-context)

Scope: main page (7-tab shell), ComplianceDashboard (nested 5 tabs), NOM251Report, CorporateComplianceGrid, IMSS + SAT sub-pages, sidebar nav, deterministic scan of all 27 files.

## Design Health Score: 18/40 (Poor)

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Spinner-only loading; WhatsApp reminder fires toast.success without checking response.ok |
| 2 | Match System / Real World | 2 | ES/EN mixing; auditor PDF headers in English (Alert/Severity/Status/Workflow/Date) |
| 3 | User Control and Freedom | 2 | Two competing filter scopes (page branch selector vs dashboard's own); WA reminder disabled ≥95% unexplained |
| 4 | Consistency and Standards | 1 | Badge "default" = Operational Red used for ≥90% "Excelente"; hardcoded green/yellow/red utilities bypass OKLCH tokens; two IMSS surfaces |
| 5 | Error Prevention | 2 | Date inputs accept end < start, no validation; irreversible WA sends without confirm |
| 6 | Recognition Rather Than Recall | 1 | 13 sub-pages orphaned (imss, sat, overtime, schedules, expediente, breaks, payroll) — zero inbound links |
| 7 | Flexibility and Efficiency | 2 | No bulk reminder action; every filter change triggers full-spinner reload |
| 8 | Aesthetic and Minimalist | 2 | Dead buttons, stub tabs, vanity metrics, decorative blob + animate-pulse sparkles |
| 9 | Error Recovery | 2 | Branch fetch failure silent (console.error); EN dead-end empty states |
| 10 | Help and Documentation | 2 | Info tab is marketing copy, not task help; no SUA/IDSE/IMSS guidance |

## Anti-Patterns Verdict

Not classic AI slop — the failure is semantic: red badge meaning "excellent", 6 unclickable buttons, unreachable IMSS management, fake stats ("RFC Válidos" = certificate count). Detector (exit 2, 3 advisories, all corporate-compliance-grid.tsx): borderRadius 8px inline in tooltip (line 319); text-[10px] off type ramp (lines 369, 413). Detector findings accurate; cannot see structural issues. No browser overlay (no browser tool available).

## What's Working

1. Corporate semáforo table: branch → manager → % → incidents → Recordatorio WA in one row; finding and action co-located.
2. NOM-251 report flow: preview → PDF/Excel gated on preview; digital fingerprint card; CSV with BOM for Excel ES.
3. Token-disciplined base layer: Card/Tabs/Button follow DESIGN.md; trend chart uses var(--primary).

## Priority Issues

1. [P1] Orphaned IA — 13 pages (imss/altas, imss/bajas, imss/reports, imss/sua, sat/certificates, sat/validation, overtime, schedules, expediente, breaks, payroll) have zero inbound links; sidebar "Cumplimiento" links only to /dashboard/compliance, audit, reports, ai-verifications. IMSS altas with overdue tracking unreachable. Also duplicate IMSS tab on main page vs orphaned imss page. → $impeccable shape app/dashboard/compliance
2. [P1] Dead and fake UI — 6 permanently disabled buttons on IMSS page; stub tabs that only link elsewhere; "Configuración" tab = "next version"; "Generar IDSE" links to /altas (wrong); SAT validRFCs = certData.generated (fake); monthlyWithholding hardcoded 0; Info tab "100% Cumple con normativa vigente" vanity claim. → $impeccable distill app/dashboard/compliance
3. [P1] Inverted/bypassed color semantics — Badge has warning but NO success variant; ≥90% compliance renders red "default" badge; 40+ hardcoded green-*/yellow-*/red-*/orange-* utilities bypass success/warning/destructive OKLCH tokens; text-success and text-green-600 mixed in adjacent cards. → $impeccable colorize components/compliance
4. [P1] Two languages — "Últimos 7 días"/"Last 30 days" same dropdown; "Total Workflows", "Need IMSS registration", "No compliance data available"; en-US chart dates; PDF table headers in English + off-palette blue [59,130,246]. → $impeccable clarify app/dashboard/compliance components/compliance
5. [P2] Nested tab maze + dual filter contexts — 3 tab layers deep; conditional "Vista Corporativa" tab shifts positions; header branch selector inert on Dashboard tab; dashboard branch selector defaults differently ("all" vs first branch); PayrollExport receives branchId as companyId. → $impeccable layout app/dashboard/compliance/page.tsx

## Persona Red Flags

- Alex (Power User): no keyboard accelerators; one-at-a-time reminders, no bulk; filter changes nuke view to spinner; trends buried 2 clicks deep.
- Sam (Accessibility): date labels lack htmlFor/id association; compliance status often color-only; spinners lack role=status; Radix primitives are the one solid base.
- Don Roberto (project persona, owner of 8 branches): English labels on ES dashboard; Vista Corporativa conditionally rendered breaks muscle memory; finds worst branch but no path to schedules/overtime to act on it.

## Minor Observations

- font-extrabold (800) off the ≤700 type scale in corporate KPI cards.
- Area chart fill stopOpacity 1.0 too heavy for flat-by-default.
- Conditional corporate tab: prefer disabled + tooltip over mount/unmount.
- Double titling: PageHeader + per-tab text-2xl headers.
- Branch Select widths inconsistent (300px page vs 200px dashboard).
- /api/branches failure silently removes report-tab content.

## Questions to Consider

- What if Compliance were three destinations — Semáforo (act now), Reportes (generate for authorities), Registros (IMSS/SAT/labor)?
- Which numbers would you bet $1,000 are accurate? What does it cost that the answer isn't "all"?
- If Badge had a success variant from day one, how many hardcoded green-* utilities would exist?
- The Info tab sells NOM compliance to users who already bought it — what would that space do for Don Roberto instead?
