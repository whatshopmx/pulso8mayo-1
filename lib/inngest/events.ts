import { eventType } from "inngest";

export const workflowScheduleDue = eventType("workflow/schedule.due", {});

export const workflowExecutionCreated = eventType("workflow/execution.created", {});

export const workflowStepCompleted = eventType("workflow/step.completed", {});

export const workflowExecutionCompleted = eventType("workflow/execution.completed", {});

export const inventoryAlertTriggered = eventType("inventory/alert.triggered", {});

export const complianceAlertTriggered = eventType("compliance/alert.triggered", {});

export const reportDue = eventType("report/due", {});

export const documentExpiring = eventType("document/expiring", {});

export const breakReminderDue = eventType("break/reminder.due", {});

// ── Labor Workflows ──

export const shiftClockInRequested = eventType("shift/clock-in.requested", {});

export const shiftClockOutRequested = eventType("shift/clock-out.requested", {});

export const shiftBreakStartRequested = eventType("shift/break.start.requested", {});

export const shiftBreakEndRequested = eventType("shift/break.end.requested", {});

// ── Incident Workflows ──

export const incidentDetected = eventType("incident/detected", {});

export const incidentEscalationRequested = eventType("incident/escalation.requested", {});

// ── Workflow Execution ──

export const workflowExecutionTimeout = eventType("workflow/execution.timeout", {});

// ── Operational Twin Events ──

export const domainEventEmitted = eventType("domain/event.emitted", {});

export const corporateTwinRecalculate = eventType("corporate/twin.recalculate", {});

// ── Executive OS events (Sprint 1 Task 3, docs/pulso-executive-os-v2.md §5) ──

// Twin lifecycle
export const executiveTwinRecalculate = eventType("executive/twin.recalculate", {});
export const executiveTwinUpdated = eventType("executive/twin.updated", {});

// Brief generation
export const morningBriefGenerated = eventType("executive/brief.generated", {});

// Risk & opportunity
export const riskThresholdBreached = eventType("risk/threshold.breached", {});
export const expansionOpportunity = eventType("expansion/opportunity", {});

// Financial
export const cashFlowUpdated = eventType("cashflow/updated", {});
export const budgetExceeded = eventType("budget/exceeded", {});
export const paymentExecuted = eventType("payment/executed", {});

// Compliance
export const complianceScoreChanged = eventType("compliance/score.changed", {});
export const auditDue = eventType("audit/due", {});
// documentExpiring already declared above (Workflow / Document lifecycle).

