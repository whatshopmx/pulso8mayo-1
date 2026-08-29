---
timestamp: 2026-08-29T04-12-19Z
slug: app-dashboard-labor
---
# Critique: app/dashboard/labor

⚠️ DEGRADED: single-context (spawn_agent unavailable in this session)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|:-----:|-----------|
| 1 | Visibility of System Status | **2** | Top stat cards in Breaks page permanently show 0; Attendance page does not fetch data when initialData is empty |
| 2 | Match System / Real World | **3** | Strong Mexican labor context (LFT Art. 63/346, IMSS patronal, CFDI 4.0), but English titles remain ("Schedule Builder") |
| 3 | User Control and Freedom | **2** | Payroll history "Ver Detalles" button has no click handler; absence focus banner does not filter to the session |
| 4 | Consistency and Standards | **2** | LFT cards use hardcoded light pastels (`bg-blue-50`) broken in dark mode; attendance charts use arbitrary rainbow hex colors |
| 5 | Error Prevention | **3** | Excellent two-step pre-validation gate in Payroll, but date inputs lack quincenal/semanal boundary presets |
| 6 | Recognition Rather Than Recall | **2** | Absence alert banner displays raw 8-character ID without employee name; attendance lacks top-level branch filter |
| 7 | Flexibility and Efficiency | **2** | No 1-click quincena shortcuts for payroll; time range tabs on attendance overflow on mobile/tablet viewports |
| 8 | Aesthetic and Minimalist Design | **2** | Duplicate stat wrappers in Breaks page; dense attendance charts occupy excessive vertical space |
| 9 | Error Recovery | **3** | Payroll validation lists specific blocking error causes with employee names |
| 10 | Help and Documentation | **3** | Clear inline normative cards referencing LFT Art. 63 and NOM-035 requirements |
| **Total** | | **24/40** | **Acceptable (60%)** |

---

## Design Specificity Verdict

- **LLM Assessment**: The Labor module (`attendance`, `payroll`, `schedule-builder`, `breaks`) contains strong HORECA domain foundations (such as tip pooling under Art. 346 LFT, real employer tax loads ~35%, and mandatory 30-min breaks under Art. 63 LFT). However, the implementation suffers from integration disconnections: static wrapper cards stuck at `0`, disconnected history actions, hardcoded light-theme pastels that break in dark mode, and an absence of standard Mexican quincenal scheduling shortcuts.
- **Deterministic Scan**: 0 findings from `detect.mjs` on regex rules. Code review revealed hardcoded pastel classes (`bg-blue-50`, `bg-green-50`, `bg-orange-50`), hardcoded chart colors (`#0088FE`, `#FFBB28`), and hardcoded zero-state statistics.
- **Visual Overlays**: Browser mutation overlay not injected; CLI deterministic scan returned clean.

---

## Overall Impression

The Labor suite has impressive domain-specific features for Mexican restaurant operations (especially the pre-payroll checador audit and break compliance alerts). Fixing the disconnected data bindings in Breaks, adding quincenal presets in Payroll, and unifying chart and card aesthetics under the OKLCH design system will turn this module into an enterprise-grade labor command center.

---

## What's Working

1. **Two-Step Pre-Timbrado Validation Gate**: The `Validar Pre-Timbrado & Checador` step in Payroll prevents costly fiscal and labor penalties before generating CFDI 4.0 receipts.
2. **Comprehensive LFT Normative Rules**: Clear integration of Mexican labor regulations (Art. 63 rest periods, Art. 346 tip integrations, NOM-035 psychosocial break tracking).
3. **Multi-View Scheduling Capabilities**: Support for matrix, calendar, list, and compliance views within the shift scheduler.

---

## Priority Issues

### [P0] Hardcoded Zero Statistics & Disconnected Client Fetching
- **What**: The 4 KPI cards at the top of `app/dashboard/labor/breaks/page.tsx` are hardcoded to `0` and never update from API data. In `app/dashboard/labor/attendance/page.tsx`, empty initial props cause the dashboard to render blank with no client-side fetch.
- **Why it matters**: Restaurant owners see false "0% Cumplimiento" and "0 Empleados" metrics on page load, undermining trust in the system.
- **Fix**: Connect `breaks/page.tsx` stats directly to `/api/labor/breaks/status` (or remove the redundant outer wrapper). Enable dynamic client-side fetching with branch and period parameters in `AttendanceDashboard`.
- **Suggested command**: `$impeccable harden app/dashboard/labor`

### [P1] Dark Mode Incompatibilities & Non-System Chart Palette
- **What**: The LFT information cards in `breaks/page.tsx` use hardcoded light pastel backgrounds (`bg-blue-50 text-blue-900`, `bg-green-50 text-green-900`) that turn unreadable in dark mode. Attendance charts use arbitrary rainbow hex values (`#0088FE`, `#00C49F`) rather than OKLCH tokens.
- **Why it matters**: Violates DESIGN.md standards, creates visual glare in dark mode, and feels like disconnected third-party widgets.
- **Fix**: Refactor LFT cards to use `bg-card border-border` with semantic badges. Update chart series to consume CSS custom properties (`--chart-1` through `--chart-5`).
- **Suggested command**: `$impeccable polish app/dashboard/labor`

### [P2] Missing Quincenal Shortcuts & Dead Actions in Payroll
- **What**: Payroll generation requires manual date picking with calendar inputs instead of standard Mexican payroll periods (Quincena 1: 1–15, Quincena 2: 16–fin de mes). The "Ver Detalles" action in the payroll history table has no click handler.
- **Why it matters**: Slows down restaurant accountants who run payroll bi-weekly and leaves historical runs inaccessible.
- **Fix**: Add 1-click period preset chips ("Quincena Actual", "Quincena Anterior", "Semana Pasada"). Wire up a detail sheet/drawer for past payroll runs.
- **Suggested command**: `$impeccable clarify app/dashboard/labor/payroll`

### [P3] English Nomenclature & Layout Padding Inconsistencies
- **What**: Schedule Builder is titled "Schedule Builder" in English with excessive outer padding (`p-6` inside dashboard shell), while Attendance lacks a top-level branch selector.
- **Why it matters**: Disconnects from the Spanish HORECA language standard and creates layout misalignment.
- **Fix**: Rename to "Constructor de Horarios y Turnos", normalize container padding, and add a branch selector to Attendance.
- **Suggested command**: `$impeccable layout app/dashboard/labor/schedule-builder`

---

## Persona Red Flags

- **Alex (Director General / Multi-Unit Owner)**: Has to manually enter start/end dates for every payroll calculation; cannot filter the attendance dashboard by branch; clicking "Ver Detalles" on previous payroll runs does nothing.
- **Jordan (Gerente de Sucursal / Shift Manager)**: Opens Breaks page and is confused by 4 cards showing "0 Empleados", "0 En Break", "0% Cumplimiento" while staff is actively clocked in; intimidated by the English "Schedule Builder" title.
- **Sam (Auditor NOM-035 / Accessibility User)**: LFT cards in Breaks page have broken contrast in dark mode (`bg-blue-50` with white text overrides or dark text on dark surfaces); time range tabs in Attendance overflow narrow mobile screens.

---

## Minor Observations

- In `AbsenceFocusBanner`, clicking the banner should auto-filter or jump to the flagged session rather than displaying a raw 8-character ID string.
- Chart tooltips in Attendance should format currency and hours consistently using localized Spanish labels.
- In Schedule Builder, the employee list sidebar in matrix view should remain sticky when scrolling horizontally across days.

---

## Questions to Consider

- Should Payroll support automatic splitting of propinas (tips) by point-system or hours-worked directly in the pre-validation step?
- Would a 1-click WhatsApp broadcast ("Recordar a todos los empleados con break pendiente") be useful directly from the Breaks overview?
- Should the Attendance and Breaks metrics be unified into a single daily shift command center?
