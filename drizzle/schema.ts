import { pgTable, foreignKey, uuid, text, integer, timestamp, jsonb, boolean, unique, uniqueIndex, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const assignmentStatus = pgEnum("assignment_status", ['PENDING', 'NOTIFIED', 'STARTED', 'COMPLETED', 'OVERDUE'])
export const assignmentType = pgEnum("assignment_type", ['ROLE', 'USER', 'AUTO', 'MANUAL'])
export const dayOfWeek = pgEnum("day_of_week", ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'])
export const documentStatus = pgEnum("document_status", ['PENDING', 'VALIDATED', 'EXPIRED', 'REJECTED'])
export const documentType = pgEnum("document_type", ['CONTRACT', 'ID', 'PROOF_OF_ADDRESS', 'TAX_ID', 'BANK_INFO', 'CERTIFICATE', 'TRAINING', 'MEDICAL_EXAM', 'PERMIT', 'OTHER'])
export const incidentSeverity = pgEnum("incident_severity", ['CRITICAL', 'WARNING', 'FATAL'])
export const incidentStatus = pgEnum("incident_status", ['DETECTED', 'IN_REMEDIATION', 'RESOLVED', 'ESCALATED'])
export const inventoryBatchStatus = pgEnum("inventory_batch_status", ['AVAILABLE', 'RESERVED', 'EXPIRED', 'QUARANTINED', 'DEPLETED'])
export const inventoryTransactionType = pgEnum("inventory_transaction_type", ['RECEIVING', 'USAGE', 'ADJUSTMENT', 'TRANSFER', 'WASTE', 'RETURN'])
export const inventoryTransferStatus = pgEnum("inventory_transfer_status", ['PENDING', 'APPROVED', 'REJECTED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED'])
export const purchaseOrderStatus = pgEnum("purchase_order_status", ['DRAFT', 'PENDING', 'SENT', 'CONFIRMED', 'RECEIVED', 'COMPLETED', 'CANCELLED', 'REJECTED'])
export const kpiAlertStatus = pgEnum("kpi_alert_status", ['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE'])
export const kpiFrequency = pgEnum("kpi_frequency", ['REALTIME', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY'])
export const kpiMetricType = pgEnum("kpi_metric_type", ['PERCENTAGE', 'COUNT', 'AVERAGE', 'SUM', 'TIME', 'RATIO'])
export const kpiThresholdType = pgEnum("kpi_threshold_type", ['MIN', 'MAX', 'TARGET', 'RANGE'])
export const notificationType = pgEnum("notification_type", ['info', 'warning', 'error', 'success'])
export const priority = pgEnum("priority", ['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
export const role = pgEnum("role", ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'EMPLEADO', 'READONLY'])
export const scheduleFrequency = pgEnum("schedule_frequency", ['DAILY', 'WEEKLY', 'MONTHLY', 'ONCE'])
export const shiftApprovalStatus = pgEnum("shift_approval_status", ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'])
export const shiftApprovalType = pgEnum("shift_approval_type", ['OVERTIME', 'SCHEDULE_CHANGE', 'TIME_OFF', 'SHIFT_SWAP', 'EARLY_DEPARTURE'])
export const shiftChangeRequestStatus = pgEnum("shift_change_request_status", ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'])
export const shiftType = pgEnum("shift_type", ['MATUTINO', 'VESPERTINO', 'NOCTURNO', 'MIXTO'])
export const whatsappSessionStatus = pgEnum("whatsapp_session_status", ['DISCONNECTED', 'CONNECTING', 'CONNECTED', 'FAILED'])


export const kpiAlerts = pgTable("kpi_alerts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	kpiId: uuid("kpi_id").notNull(),
	branchId: uuid("branch_id"),
	alertType: text("alert_type").notNull(),
	status: kpiAlertStatus().default('ACTIVE').notNull(),
	triggeredValue: integer("triggered_value").notNull(),
	threshold: integer().notNull(),
	title: text().notNull(),
	message: text().notNull(),
	acknowledgedBy: text("acknowledged_by"),
	acknowledgedAt: timestamp("acknowledged_at", { mode: 'string' }),
	resolutionNotes: text("resolution_notes"),
	resolvedBy: text("resolved_by"),
	resolvedAt: timestamp("resolved_at", { mode: 'string' }),
	notifiedUsers: jsonb("notified_users"),
	notificationSent: boolean("notification_sent").default(false),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.kpiId],
			foreignColumns: [kpiDefinitions.id],
			name: "kpi_alerts_kpi_id_kpi_definitions_id_fk"
		}),
]);

export const inventoryBatches = pgTable("inventory_batches", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	itemId: uuid("item_id").notNull(),
	branchId: uuid("branch_id").notNull(),
	supplierId: uuid("supplier_id"),
	lotNumber: text("lot_number"),
	productionDate: timestamp("production_date", { mode: 'string' }),
	expirationDate: timestamp("expiration_date", { mode: 'string' }),
	receivedAt: timestamp("received_at", { mode: 'string' }).defaultNow(),
	initialQuantity: integer("initial_quantity").notNull(),
	currentQuantity: integer("current_quantity").notNull(),
	status: inventoryBatchStatus().default('AVAILABLE'),
	supplierBatchInfo: jsonb("supplier_batch_info"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	unitCost: integer("unit_cost"),
});

export const account = pgTable("account", {
	id: text().primaryKey().notNull(),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	userId: text("user_id").notNull(),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: timestamp("access_token_expires_at", { mode: 'string' }),
	refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { mode: 'string' }),
	scope: text(),
	password: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).notNull(),
});

export const inventoryMovements = pgTable("inventory_movements", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	itemId: uuid("item_id").notNull(),
	batchId: uuid("batch_id"),
	type: inventoryTransactionType().notNull(),
	quantityChange: integer("quantity_change").notNull(),
	reason: text(),
	referenceId: text("reference_id"),
	performedBy: text("performed_by"),
	timestamp: timestamp({ mode: 'string' }).defaultNow().notNull(),
});

export const suppliers = pgTable("suppliers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	companyId: uuid("company_id").notNull(),
	name: text().notNull(),
	contactName: text("contact_name"),
	email: text(),
	phone: text(),
	address: text(),
	taxId: text("tax_id"),
	active: boolean().default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const shiftTemplates = pgTable("shift_templates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	companyId: uuid("company_id").notNull(),
	branchId: uuid("branch_id"),
	role: text().notNull(),
	startTime: text("start_time").notNull(),
	endTime: text("end_time").notNull(),
	daysOfWeek: integer("days_of_week").array(),
	validFrom: text("valid_from").notNull(),
	validUntil: text("valid_until"),
	createdBy: text("created_by").notNull(),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const breakComplianceRules = pgTable("break_compliance_rules", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	companyId: uuid("company_id").notNull(),
	ruleName: text("rule_name").notNull(),
	description: text(),
	minBreakDuration: integer("min_break_duration").default(30),
	maxContinuousWork: integer("max_continuous_work").default(300),
	mealBreakRequired: boolean("meal_break_required").default(true),
	mealBreakMinDuration: integer("meal_break_min_duration").default(30),
	maxDailyHours: integer("max_daily_hours").default(8),
	maxWeeklyHours: integer("max_weekly_hours").default(48),
	minRestBetweenShifts: integer("min_rest_between_shifts").default(12),
	lateTolerance: integer("late_tolerance").default(10),
	earlyDepartureTolerance: integer("early_departure_tolerance").default(10),
	enableBreakReminders: boolean("enable_break_reminders").default(true),
	reminderInterval: integer("reminder_interval").default(120),
	enableOvertimeAlerts: boolean("enable_overtime_alerts").default(true),
	overtimeAlertThreshold: integer("overtime_alert_threshold").default(30),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
});

export const breakReminderLogs = pgTable("break_reminder_logs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sessionId: uuid("session_id").notNull(),
	userId: text("user_id").notNull(),
	branchId: uuid("branch_id").notNull(),
	reminderType: text("reminder_type").notNull(),
	message: text().notNull(),
	channel: text().notNull(),
	triggeredAt: timestamp("triggered_at", { mode: 'string' }).defaultNow().notNull(),
	sentAt: timestamp("sent_at", { mode: 'string' }),
	acknowledged: boolean().default(false),
	acknowledgedAt: timestamp("acknowledged_at", { mode: 'string' }),
	metadata: jsonb(),
});

export const employeeDocuments = pgTable("employee_documents", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	companyId: uuid("company_id").notNull(),
	branchId: uuid("branch_id"),
	documentType: documentType("document_type").notNull(),
	documentName: text("document_name").notNull(),
	documentUrl: text("document_url").notNull(),
	fileKey: text("file_key"),
	fileSize: integer("file_size"),
	mimeType: text("mime_type"),
	uploadedBy: text("uploaded_by").notNull(),
	issueDate: timestamp("issue_date", { mode: 'string' }),
	expirationDate: timestamp("expiration_date", { mode: 'string' }),
	isValid: boolean("is_valid").default(true),
	status: documentStatus().default('PENDING').notNull(),
	validatedBy: text("validated_by"),
	validatedAt: timestamp("validated_at", { mode: 'string' }),
	rejectionReason: text("rejection_reason"),
	notes: text(),
	isRequired: boolean("is_required").default(false),
	complianceNotes: text("compliance_notes"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
});

export const shiftApprovals = pgTable("shift_approvals", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	companyId: uuid("company_id").notNull(),
	branchId: uuid("branch_id").notNull(),
	approvalType: shiftApprovalType("approval_type").notNull(),
	requestedBy: text("requested_by").notNull(),
	requestedFor: text("requested_for").notNull(),
	shiftSessionId: uuid("shift_session_id"),
	plannedShiftId: uuid("planned_shift_id"),
	title: text().notNull(),
	description: text(),
	reason: text(),
	startTime: timestamp("start_time", { mode: 'string' }),
	endTime: timestamp("end_time", { mode: 'string' }),
	durationMinutes: integer("duration_minutes"),
	overtimeMinutes: integer("overtime_minutes"),
	extraData: jsonb("extra_data"),
	status: shiftApprovalStatus().default('PENDING').notNull(),
	approvedBy: text("approved_by"),
	approvedAt: timestamp("approved_at", { mode: 'string' }),
	rejectionReason: text("rejection_reason"),
	notifiedAt: timestamp("notified_at", { mode: 'string' }),
	reminderSent: boolean("reminder_sent").default(false),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
});

export const shiftChangeRequests = pgTable("shift_change_requests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	companyId: uuid("company_id").notNull(),
	branchId: uuid("branch_id").notNull(),
	requestedBy: text("requested_by").notNull(),
	requestedShiftId: uuid("requested_shift_id").notNull(),
	targetShiftId: uuid("target_shift_id"),
	counterpartyId: text("counterparty_id").notNull(),
	counterpartyShiftId: uuid("counterparty_shift_id"),
	reason: text().notNull(),
	notes: text(),
	status: shiftChangeRequestStatus().default('PENDING').notNull(),
	approvedBy: text("approved_by"),
	approvedAt: timestamp("approved_at", { mode: 'string' }),
	rejectedBy: text("rejected_by"),
	rejectedAt: timestamp("rejected_at", { mode: 'string' }),
	rejectionReason: text("rejection_reason"),
	counterpartyAccepted: boolean("counterparty_accepted"),
	counterpartyResponseAt: timestamp("counterparty_response_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
});

export const inventoryPriceHistory = pgTable("inventory_price_history", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	itemId: uuid("item_id").notNull(),
	previousCost: integer("previous_cost"),
	newCost: integer("new_cost").notNull(),
	supplierId: uuid("supplier_id"),
	changedBy: text("changed_by").notNull(),
	changedAt: timestamp("changed_at", { mode: 'string' }).defaultNow().notNull(),
});

export const unitConversions = pgTable("unit_conversions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	companyId: uuid("company_id").notNull(),
	fromUnit: text("from_unit").notNull(),
	toUnit: text("to_unit").notNull(),
	factor: integer("factor").notNull(),
	description: text("description"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const inventoryItems = pgTable("inventory_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	companyId: uuid("company_id").notNull(),
	name: text().notNull(),
	sku: text(),
	barcode: text(),
	category: text(),
	unit: text().default('UNIT').notNull(),
	minLevel: integer("min_level").default(0),
	maxLevel: integer("max_level"),
	storageArea: text("storage_area"),
	allergenInfo: text("allergen_info"),
	storageRequirements: text("storage_requirements"),
	typicalShelfLifeDays: integer("typical_shelf_life_days"),
	active: boolean().default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	supplierId: uuid("supplier_id"),
	lastCost: integer("last_cost"),
	photoUrl: text("photo_url"),
});

export const workflowAssignments = pgTable("workflow_assignments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	instanceId: uuid("instance_id").notNull(),
	scheduleId: uuid("schedule_id"),
	assignedTo: text("assigned_to").notNull(),
	assignedBy: text("assigned_by"),
	assignmentType: assignmentType("assignment_type").notNull(),
	status: assignmentStatus().default('PENDING'),
	notifiedAt: timestamp("notified_at", { mode: 'string' }),
	startedAt: timestamp("started_at", { mode: 'string' }),
	completedAt: timestamp("completed_at", { mode: 'string' }),
	dueDate: timestamp("due_date", { mode: 'string' }),
	isOverdue: boolean("is_overdue").default(false),
	priority: priority().default('MEDIUM'),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const workflowSchedules = pgTable("workflow_schedules", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	templateId: text("template_id").notNull(),
	branchId: uuid("branch_id").notNull(),
	assignmentType: assignmentType("assignment_type").default('AUTO').notNull(),
	assignedRole: role("assigned_role"),
	assignedUserId: text("assigned_user_id"),
	frequency: scheduleFrequency().notNull(),
	dayOfWeek: integer("day_of_week"),
	dayOfMonth: integer("day_of_month"),
	timeOfDay: text("time_of_day"),
	startDate: timestamp("start_date", { mode: 'string' }).notNull(),
	endDate: timestamp("end_date", { mode: 'string' }),
	isActive: boolean("is_active").default(true),
	title: text().notNull(),
	description: text(),
	priority: priority().default('MEDIUM'),
	lastExecutedAt: timestamp("last_executed_at", { mode: 'string' }),
	nextExecutionAt: timestamp("next_execution_at", { mode: 'string' }),
	executionCount: integer("execution_count").default(0),
	createdBy: text("created_by").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const notificationPreferences = pgTable("notification_preferences", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	whatsappEnabled: boolean("whatsapp_enabled").default(true).notNull(),
	emailEnabled: boolean("email_enabled").default(true).notNull(),
	inAppEnabled: boolean("in_app_enabled").default(true).notNull(),
	workflowAssignments: boolean("workflow_assignments").default(true).notNull(),
	workflowDueSoon: boolean("workflow_due_soon").default(true).notNull(),
	workflowOverdue: boolean("workflow_overdue").default(true).notNull(),
	incidents: boolean().default(true).notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("notification_preferences_user_id_unique").on(table.userId),
]);

export const notifications = pgTable("notifications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	title: text().notNull(),
	message: text().notNull(),
	type: notificationType().notNull(),
	actionUrl: text("action_url"),
	actionLabel: text("action_label"),
	read: boolean().default(false).notNull(),
	readAt: timestamp("read_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
});

export const holidays = pgTable("holidays", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	companyId: uuid("company_id").notNull(),
	name: text().notNull(),
	date: timestamp({ mode: 'string' }).notNull(),
	description: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const workflowTemplates = pgTable("workflow_templates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	companyId: uuid("company_id").notNull(),
	branchId: uuid("branch_id"),
	name: text().notNull(),
	description: text(),
	steps: jsonb().default([]).notNull(),
	category: text().default('GENERAL'),
	active: boolean().default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	complianceType: text("compliance_type"),
	regulationSection: text("regulation_section"),
	requiredFrequency: text("required_frequency"),
	isCritical: boolean("is_critical").default(false),
});

export const breakLogs = pgTable("break_logs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sessionId: uuid("session_id").notNull(),
	startTime: timestamp("start_time", { mode: 'string' }).defaultNow().notNull(),
	endTime: timestamp("end_time", { mode: 'string' }),
	durationMinutes: integer("duration_minutes"),
	type: text().default('STANDARD'),
	isCompliant: boolean("is_compliant").default(true),
	complianceNotes: text("compliance_notes"),
	remindedAt: timestamp("reminded_at", { mode: 'string' }),
});

export const branches = pgTable("branches", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	companyId: uuid("company_id"),
	name: text().notNull(),
	code: text().unique(),
	address: text(),
	timezone: text().default('America/Mexico_City'),
	operatingHours: jsonb("operating_hours"),
	location: jsonb(),
	inviteToken: uuid("invite_token").defaultRandom(),
	active: boolean().default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	uniqueIndex("branches_invite_token_unique").using("btree", table.inviteToken.asc().nullsLast().op("uuid_ops")),
]);

export const magicLinks = pgTable("magic_links", {
	token: text().primaryKey().notNull(),
	sessionId: uuid("session_id").notNull(),
	workflowTemplateId: text("workflow_template_id").notNull(),
	status: text().default('PENDING'),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	usedAt: timestamp("used_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	instanceId: uuid("instance_id").notNull(),
});

export const sessions = pgTable("sessions", {
	id: text().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	token: text(),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	createdAt: timestamp("created_at", { mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "sessions_user_id_users_id_fk"
		}),
	unique("sessions_token_unique").on(table.token),
]);

export const shiftSessions = pgTable("shift_sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	branchId: uuid("branch_id").notNull(),
	status: text().default('PENDING'),
	startedAt: timestamp("started_at", { mode: 'string' }).defaultNow().notNull(),
	endedAt: timestamp("ended_at", { mode: 'string' }),
	totalBreakMinutes: integer("total_break_minutes").default(0),
	totalWorkMinutes: integer("total_work_minutes").default(0),
	overtimeMinutes: integer("overtime_minutes").default(0),
	complianceFlags: jsonb("compliance_flags"),
	notes: text(),
	plannedShiftId: uuid("planned_shift_id"),
	scheduledStartTime: text("scheduled_start_time"),
	scheduledEndTime: text("scheduled_end_time"),
	checkInTime: timestamp("check_in_time", { mode: 'string' }),
	checkOutTime: timestamp("check_out_time", { mode: 'string' }),
	checkInGeolocation: jsonb("check_in_geolocation"),
	checkOutGeolocation: jsonb("check_out_geolocation"),
	lateMinutes: integer("late_minutes").default(0),
	earlyDepartureMinutes: integer("early_departure_minutes").default(0),
	requiresApproval: boolean("requires_approval").default(false),
	approvedBy: text("approved_by"),
	approvedAt: timestamp("approved_at", { mode: 'string' }),
	rejectionReason: text("rejection_reason"),
});

export const incidents = pgTable("incidents", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	stepId: text("step_id").notNull(),
	severity: incidentSeverity().notNull(),
	status: incidentStatus().default('DETECTED'),
	title: text().notNull(),
	description: text(),
	initialValue: jsonb("initial_value"),
	targetValue: jsonb("target_value"),
	photoUrl: text("photo_url"),
	remediationProtocol: jsonb("remediation_protocol"),
	currentAttempt: integer("current_attempt").default(0),
	maxAttempts: integer("max_attempts").default(1),
	resolvedAt: timestamp("resolved_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	instanceId: uuid("instance_id").notNull(),
	branchId: uuid("branch_id").notNull(),
	detectedBy: text("detected_by"),
	metadata: jsonb(),
	escalationChain: jsonb("escalation_chain"),
	resolution: text(),
	resolvedBy: text("resolved_by"),
});

export const whatsappSessions = pgTable("whatsapp_sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	companyId: uuid("company_id").notNull(),
	sessionId: text("session_id").notNull(),
	phoneNumber: text("phone_number"),
	status: whatsappSessionStatus().default('DISCONNECTED').notNull(),
	qrCode: text("qr_code"),
	qrCodeExpiresAt: timestamp("qr_code_expires_at", { mode: 'string' }),
	connectedAt: timestamp("connected_at", { mode: 'string' }),
	lastActivityAt: timestamp("last_activity_at", { mode: 'string' }),
	disconnectedAt: timestamp("disconnected_at", { mode: 'string' }),
	webhookUrl: text("webhook_url"),
	isActive: boolean("is_active").default(true),
	lastError: text("last_error"),
	errorCount: integer("error_count").default(0),
	createdBy: text("created_by").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.companyId],
			foreignColumns: [companies.id],
			name: "whatsapp_sessions_company_id_companies_id_fk"
		}),
	unique("whatsapp_sessions_session_id_unique").on(table.sessionId),
]);

export const whatsappMessages = pgTable("whatsapp_messages", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sessionId: uuid("session_id").notNull(),
	direction: text().notNull(),
	from: text().notNull(),
	to: text().notNull(),
	messageType: text("message_type").notNull(),
	content: text(),
	mediaUrl: text("media_url"),
	command: text(),
	processed: boolean().default(false),
	processingError: text("processing_error"),
	externalMessageId: text("external_message_id"),
	timestamp: timestamp({ mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [whatsappSessions.id],
			name: "whatsapp_messages_session_id_whatsapp_sessions_id_fk"
		}),
]);

export const companies = pgTable("companies", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	taxId: text("tax_id"),
	plan: text().default('FREE'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	billingStatus: text("billing_status").default('ACTIVE'),
	stripeCustomerId: text("stripe_customer_id"),
});

export const verifications = pgTable("verifications", {
	id: text().primaryKey().notNull(),
	identifier: text().notNull(),
	value: text().notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }),
	updatedAt: timestamp("updated_at", { mode: 'string' }),
});

export const workflowInstances = pgTable("workflow_instances", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	workflowTemplateId: text("workflow_template_id").notNull(),
	branchId: uuid("branch_id").notNull(),
	assigneeId: text("assignee_id"),
	status: text().default('PENDING'),
	startedAt: timestamp("started_at", { mode: 'string' }),
	completedAt: timestamp("completed_at", { mode: 'string' }),
	currentStepId: text("current_step_id"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	sessionId: uuid("session_id"),
	data: jsonb().default({}),
	score: integer(),
	scheduleId: uuid("schedule_id"),
	assignmentId: uuid("assignment_id"),
	dueDate: timestamp("due_date", { mode: 'string' }),
	priority: priority().default('MEDIUM'),
});

export const workflowInstanceSteps = pgTable("workflow_instance_steps", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	instanceId: uuid("instance_id").notNull(),
	stepId: text("step_id").notNull(),
	status: text().default('PENDING'),
	value: jsonb(),
	aiAnalysis: jsonb("ai_analysis"),
	evidenceUrl: text("evidence_url"),
	comment: text(),
	completedAt: timestamp("completed_at", { mode: 'string' }),
	completedBy: text("completed_by"),
});

export const eventTriggers = pgTable("event_triggers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	templateId: text("template_id").notNull(),
	branchId: uuid("branch_id").notNull(),
	eventName: text("event_name").notNull(),
	conditions: jsonb(),
	isActive: boolean("is_active").default(true),
	createdBy: text("created_by").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const users = pgTable("users", {
	id: text().primaryKey().notNull(),
	name: text(),
	email: text().notNull(),
	emailVerified: boolean("email_verified"),
	image: text(),
	role: role().default('EMPLEADO'),
	companyId: uuid("company_id"),
	branchId: uuid("branch_id"),
	phone: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).notNull(),
	deletedAt: timestamp("deleted_at", { mode: 'string' }),
	whatsappPhone: text("whatsapp_phone"),
});

export const kpiHistory = pgTable("kpi_history", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	kpiId: uuid("kpi_id").notNull(),
	branchId: uuid("branch_id"),
	value: integer().notNull(),
	rawValue: text("raw_value"),
	periodStart: timestamp("period_start", { mode: 'string' }).notNull(),
	periodEnd: timestamp("period_end", { mode: 'string' }).notNull(),
	status: text().default('NORMAL'),
	target: integer(),
	targetAchieved: boolean("target_achieved"),
	calculatedAt: timestamp("calculated_at", { mode: 'string' }).defaultNow().notNull(),
	metadata: jsonb(),
}, (table) => [
	foreignKey({
			columns: [table.kpiId],
			foreignColumns: [kpiDefinitions.id],
			name: "kpi_history_kpi_id_kpi_definitions_id_fk"
		}),
]);

export const inventoryTransferItems = pgTable("inventory_transfer_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	transferId: uuid("transfer_id").notNull(),
	itemId: uuid("item_id").notNull(),
	batchId: uuid("batch_id"),
	requestedQuantity: integer("requested_quantity").notNull(),
	approvedQuantity: integer("approved_quantity"),
	shippedQuantity: integer("shipped_quantity"),
	receivedQuantity: integer("received_quantity"),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
});

export const inventoryTransfers = pgTable("inventory_transfers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	transferNumber: text("transfer_number").notNull(),
	fromBranchId: uuid("from_branch_id").notNull(),
	toBranchId: uuid("to_branch_id").notNull(),
	status: inventoryTransferStatus().default('PENDING').notNull(),
	requestedBy: text("requested_by").notNull(),
	approvedBy: text("approved_by"),
	shippedBy: text("shipped_by"),
	receivedBy: text("received_by"),
	requestedAt: timestamp("requested_at", { mode: 'string' }).defaultNow().notNull(),
	approvedAt: timestamp("approved_at", { mode: 'string' }),
	shippedAt: timestamp("shipped_at", { mode: 'string' }),
	receivedAt: timestamp("received_at", { mode: 'string' }),
	cancelledAt: timestamp("cancelled_at", { mode: 'string' }),
	notes: text(),
	rejectionReason: text("rejection_reason"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("inventory_transfers_transfer_number_unique").on(table.transferNumber),
]);

export const kpiDefinitions = pgTable("kpi_definitions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	companyId: uuid("company_id").notNull(),
	branchId: uuid("branch_id"),
	name: text().notNull(),
	description: text(),
	formula: text().notNull(),
	metricType: kpiMetricType("metric_type").notNull(),
	target: integer(),
	warningThreshold: integer("warning_threshold"),
	criticalThreshold: integer("critical_threshold"),
	thresholdType: kpiThresholdType("threshold_type").default('TARGET'),
	frequency: kpiFrequency().default('DAILY').notNull(),
	dataRetentionDays: integer("data_retention_days").default(90),
	unit: text().default(''),
	decimalPlaces: integer("decimal_places").default(2),
	category: text().default('OPERATIONS'),
	active: boolean().default(true),
	isSystem: boolean("is_system").default(false),
	createdBy: text("created_by").notNull(),
	updatedBy: text("updated_by"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
});

export const plannedShifts = pgTable("planned_shifts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	userId: text("user_id").notNull(),
	role: text().notNull(),
	startTime: text("start_time").notNull(),
	endTime: text("end_time").notNull(),
	notes: text(),
	status: text().default('DRAFT'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	shiftDate: text("shift_date").notNull(),
	templateId: uuid("template_id"),
	createdBy: text("created_by"),
	workflowTemplateId: text("workflow_template_id"),
}, (table) => [
	uniqueIndex("unique_shift").using("btree", table.userId.asc().nullsLast().op("text_ops"), table.shiftDate.asc().nullsLast().op("text_ops"), table.startTime.asc().nullsLast().op("text_ops")),
]);
