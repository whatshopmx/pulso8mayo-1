---
target: dashboard/notifications
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-09-17T02-04-20Z
slug: app-dashboard-notifications
---
⚠️ DEGRADED: single-context (no general sub-agent tool exposed in harness)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | No visual pending/loading feedback when marking items as read; no confirmation toast on "Marcar todo como leído". |
| 2 | Match System / Real World | 3 | Generic SaaS alert categories (Error, Aviso, Listo, Info) instead of HORECA operational terminology (NOM-251, Inventario, Turnos, Mantenimiento). |
| 3 | User Control and Freedom | 1 | Cannot acknowledge a single notification in-place without navigating away; no undo for "Marcar todo como leído"; cannot mark as unread or archive. |
| 4 | Consistency and Standards | 3 | Filter buttons use raw unstyled button toggles instead of standard tabs/segmented pills; semantic colors flattened (`warning` uses neutral secondary, `success` uses outline). |
| 5 | Error Prevention | 2 | "Marcar todo como leído" triggers instantly on click with zero confirmation dialog or undo toast, risking accidental bulk dismissal of critical alerts. |
| 6 | Recognition Rather Than Recall | 2 | Only a tiny dot indicates unread status; no branch badges, no category icons, forcing users to read full message text to identify context. |
| 7 | Flexibility and Efficiency | 1 | No batch selections (checkboxes), no operational filters (by branch or department), no search, and no keyboard shortcuts. |
| 8 | Aesthetic and Minimalist Design | 3 | Clean flat structure, but unread visual contrast (`bg-muted/40`) is very subtle against read items; card title and badge compete at similar size. |
| 9 | Help Users Recognize, Diagnose, and Recover from Errors | 2 | `useNotifications` silently swallows fetch and patch failures in empty `catch` blocks; users receive no indication if an action fails. |
| 10 | Help and Documentation | 2 | No contextual link to notification preferences, delivery channel settings (WhatsApp/Email), or alert routing explanation. |
| **Total** | | **21/40** | **Acceptable** |

## Design Specificity Verdict

**LLM assessment**:
The current notifications screen is a category-interchangeable SaaS notification feed that could belong to an issue tracker or a blog rather than an operational command center for HORECA chains in Mexico. In multi-unit restaurant and hotel operations, notifications are urgent operational triggers: temperature excursion alerts from NOM-251 logs, critical inventory stockouts before weekend service, unassigned kitchen shifts, or overdue maintenance. Currently, all notifications are rendered as a uniform flat list with generic labels ("Aviso", "Error", "Listo", "Info") without branch tagging (e.g. "Sucursal Polanco", "Cocina Central"), without operational severity categorization, and without quick-acknowledgment workflows for managers on the move.

**Deterministic scan**:
Automated detector scan (`detect.mjs`) on `app/dashboard/notifications/page.tsx` and related notification components found 0 structural design token violations. The implementation strictly adheres to the project's flat design system: no box-shadows, no invalid gradient text, no unauthorized colored border stripes, and font sizes honor the 12px Label floor (`text-xs`). However, passing structural token linting masks deep operational interaction gaps.

**Visual overlays**:
No visual overlay was injected. Local development server was inactive and dashboard routes require authenticated session context. Deterministic code inspection and static AST analysis were utilized as fallback signals.

## Overall Impression
The notification center provides a functional starting point with clean loading skeletons and empty states, but it treats notifications as passive inbox items rather than active operational alerts. For an operations director managing 15 restaurant branches, a flat feed of up to 100 mixed items without branch filtering, time grouping, or single-click triage creates high friction and risks missing critical compliance deadlines.

## What's Working
1. **Clean Loading & Empty States**: The integration of `Skeleton` loaders and the `EmptyState` component provides immediate feedback and clear contextual messaging when all items have been read.
2. **Strict Adherence to Flat Tokens**: Zero use of artificial drop-shadows or decorative border-left stripes. The surface uses pure tonal layering with muted background tints (`bg-muted/40`).
3. **Localized Time Formatting**: Relative timestamps use `date-fns` with Spanish locale (`es`), providing natural operational phrasing ("hace 10 minutos") rather than raw timestamps.

## Priority Issues

### [P1] Navigation Hijack & Inability to Acknowledge In-Place
- **Why it matters**: If a notification has an `actionUrl`, clicking anywhere on the card immediately navigates away to that URL. An operations manager reviewing 15 notifications during shift handoff cannot simply mark an alert as acknowledged without being thrown out of the notifications screen.
- **Fix**: Decouple the "mark as read" action from navigation. Provide an explicit in-place action button (or checkmark icon) to acknowledge/mark read without leaving the page, and make `actionLabel` an explicit, clickable button/link rather than a card-wide wrapper.
- **Suggested command**: `$impeccable layout`

### [P1] Missing Temporal & Categorical Chunking
- **Why it matters**: Up to 100 notifications are dumped into a single flat list. Users cannot distinguish between an incident that happened 5 minutes ago during lunch rush and a task completed yesterday morning. Furthermore, critical NOM-251 food safety violations are visually indistinguishable in structure from routine informational messages.
- **Fix**: Group notifications into temporal sections ("Hoy", "Ayer", "Esta semana") and introduce operational category filters (Calidad/NOM-251, Inventario, RH & Turnos, Mantenimiento) and branch indicators.
- **Suggested command**: `$impeccable layout`

### [P1] Silent Error Swallowing in Hook Layer
- **Why it matters**: In `hooks/use-notifications.ts`, all network errors in `fetchNotifications`, `markAsRead`, and `markAllAsRead` are caught with empty `catch { // ignore }` blocks. If an operations manager on spotty kitchen Wi-Fi clicks "Marcar todo como leído" and the request fails, the UI does not alert them, leaving unread status desynchronized between client and database.
- **Fix**: Expose error state and toast notifications on action failures, with retry triggers and optimistic rollbacks.
- **Suggested command**: `$impeccable harden`

### [P2] Destructive Bulk Action Without Confirmation or Undo
- **Why it matters**: "Marcar todo como leído" is a single unconfirmed click that clears all unread indicators across all branches instantly. If clicked accidentally while scrolling on a touch screen, there is no undo toast and no confirmation modal.
- **Fix**: Add a lightweight confirmation modal or an undo toast notification (e.g. "Todas las notificaciones marcadas como leídas — [Deshacer]").
- **Suggested command**: `$impeccable clarify`

### [P2] Flattened Semantic Hierarchy on Badges
- **Why it matters**: `TIPO_VARIANTE` maps `warning` to `"secondary"` and both `success` and `info` to `"outline"`. This strips away standard semantic recognition: warning states don't leverage amber/warning tokens, and success states look identical to informational text.
- **Fix**: Align notification badges with Pulso's semantic badge variants (destructive red for errors/incidents, warning amber for pending escalations, success green for resolved tasks, info blue for system notes).
- **Suggested command**: `$impeccable colorize`

## Persona Red Flags

### Alex (Power User / Director de Operaciones)
- **Red Flags**:
  - No batch actions: Cannot select 10 routine inventory notices and dismiss them simultaneously.
  - No branch filtering: Must scroll through notices from all 15 branches in one unsegmented stream.
  - No keyboard navigation: Cannot navigate with `j`/`k` or mark read with `m`.

### Jordan (Encargado de Sucursal / Floor Manager)
- **Red Flags**:
  - Unread dot is tiny (`h-2 w-2`), easy to miss under ambient kitchen glare.
  - Tapping a notification card to read it on a tablet accidentally navigates them away to another module in the middle of table service.
  - No single-tap acknowledge button.

### Sam (Accessibility-Dependent User)
- **Red Flags**:
  - Unread indicator is an unlabelled `<span>` with no `aria-label` or `<span className="sr-only">No leída</span>`.
  - Nested clickable structures: `<Card>` has an `onClick` handler, and inside is a `<Link>` wrapping `<CardContent>`, creating confusing focus order and duplicate click targets in screen readers.

### Carlos (Project Persona: Director General / Franquiciatario HORECA)
- **Red Flags**:
  - Alerts lack branch attribution: A notification saying "Cámara de refrigeración fuera de rango (8.2°C)" doesn't immediately tell Carlos whether it is the Polanco branch or the Monterrey branch without clicking through.
  - No direct link to notification preferences or WhatsApp escalation configuration.

## Minor Observations
- The filter buttons (`Todas`, `Sin leer`) use raw `<Button>` components instead of Radix `Tabs` or a segmented control, creating visual inconsistency with other dashboard filter bars (such as `/dashboard/inventory` or `/dashboard/labor`).
- The page subtitle says "Avisos de incidentes, escalaciones y tareas pendientes", but there is no quick link or button to configure alert channels (WhatsApp Wasender vs Email Resend).
- The unread badge in `PageHeader` is plain text (`12 sin leer`); wrapping it in a distinctive badge variant would heighten scannability.

## Questions to Consider
- What if notifications were grouped by branch and operational severity so critical NOM-251 health hazards always pin to the top?
- Could each notification card have an explicit two-action anatomy: [Atender] (navigates) and [Archivar / Marcar leída] (in-place)?
- Should there be a direct shortcut to configure WhatsApp alert subscriptions from this screen?
