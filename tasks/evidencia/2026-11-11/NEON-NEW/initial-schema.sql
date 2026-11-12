CREATE TYPE "public"."aggregator_settlement_status" AS ENUM('PENDING', 'RECONCILED', 'DISCREPANCY');--> statement-breakpoint
CREATE TYPE "public"."assignment_status" AS ENUM('PENDING', 'NOTIFIED', 'STARTED', 'COMPLETED', 'OVERDUE');--> statement-breakpoint
CREATE TYPE "public"."assignment_type" AS ENUM('ROLE', 'USER', 'AUTO', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('CREATE', 'UPDATE', 'DELETE', 'VIEW', 'EXPORT', 'IMPORT');--> statement-breakpoint
CREATE TYPE "public"."blood_type" AS ENUM('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-');--> statement-breakpoint
CREATE TYPE "public"."cfdi_conciliation_status" AS ENUM('SIN_MATCH', 'CONCILIADA');--> statement-breakpoint
CREATE TYPE "public"."compliance_alert_status" AS ENUM('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."compliance_alert_type" AS ENUM('LOW_SCORE', 'MISSED_DEADLINE', 'MISSING_WORKFLOW', 'EXPIRED_DOCUMENT', 'NON_COMPLIANCE');--> statement-breakpoint
CREATE TYPE "public"."contract_type" AS ENUM('DETERMINATE', 'INDETERMINATE', 'PROBATION', 'TRAINING', 'SEASONAL', 'PART_TIME');--> statement-breakpoint
CREATE TYPE "public"."day_of_week" AS ENUM('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');--> statement-breakpoint
CREATE TYPE "public"."discrepancy_type" AS ENUM('NONE', 'QUANTITY', 'PRICE', 'QUALITY', 'SUBSTITUTION');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('PENDING', 'VALIDATED', 'EXPIRED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('CONTRACT', 'ID', 'PROOF_OF_ADDRESS', 'TAX_ID', 'BANK_INFO', 'CERTIFICATE', 'TRAINING', 'MEDICAL_EXAM', 'PERMIT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."employee_status" AS ENUM('ONBOARDING', 'ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED', 'RESIGNED');--> statement-breakpoint
CREATE TYPE "public"."expense_payment_method" AS ENUM('EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'DOMICILIADO', 'CHEQUE');--> statement-breakpoint
CREATE TYPE "public"."expense_payment_source" AS ENUM('MANUAL', 'TREASURY');--> statement-breakpoint
CREATE TYPE "public"."expense_payment_status" AS ENUM('PENDING', 'CONFIRMED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."financial_period_status" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."food_production" AS ENUM('IN_SITU', 'COCINA_CENTRAL', 'MIXTO');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."imss_file_status" AS ENUM('GENERADO', 'ENVIADO', 'ACEPTADO', 'RECHAZADO');--> statement-breakpoint
CREATE TYPE "public"."imss_movement_status" AS ENUM('PENDIENTE', 'EN_ARCHIVO', 'CONFIRMADO', 'RECHAZADO');--> statement-breakpoint
CREATE TYPE "public"."imss_movement_type" AS ENUM('ALTA', 'BAJA', 'MOD_SALARIO');--> statement-breakpoint
CREATE TYPE "public"."incident_severity" AS ENUM('CRITICAL', 'WARNING', 'FATAL', 'HIGH');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('DETECTED', 'IN_REMEDIATION', 'AWAITING_EXTERNAL', 'CONFIRMED', 'RESOLVED', 'ESCALATED');--> statement-breakpoint
CREATE TYPE "public"."inventory_alert_status" AS ENUM('ACTIVE', 'VIEWED', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."inventory_alert_type" AS ENUM('LOW_STOCK', 'OUT_OF_STOCK', 'EXPIRING_SOON', 'EXPIRED', 'PRICE_INCREASE', 'HIGH_VARIANCE', 'ANOMALOUS_WASTE', 'YIELD_DROP');--> statement-breakpoint
CREATE TYPE "public"."inventory_audit_action" AS ENUM('CREATE', 'UPDATE', 'DELETE');--> statement-breakpoint
CREATE TYPE "public"."inventory_audit_entity" AS ENUM('ITEM', 'BATCH', 'MOVEMENT', 'TRANSFER', 'WASTE', 'RECEIVING', 'ADJUSTMENT', 'SUPPLIER', 'PURCHASE_ORDER', 'PAYEE');--> statement-breakpoint
CREATE TYPE "public"."inventory_batch_status" AS ENUM('AVAILABLE', 'RESERVED', 'EXPIRED', 'QUARANTINED', 'DEPLETED');--> statement-breakpoint
CREATE TYPE "public"."inventory_period_status" AS ENUM('OPEN', 'LOCKED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."inventory_transaction_type" AS ENUM('RECEIVING', 'USAGE', 'ADJUSTMENT', 'TRANSFER', 'WASTE', 'RETURN');--> statement-breakpoint
CREATE TYPE "public"."inventory_transfer_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."inventory_waste_reason" AS ENUM('EXPIRED', 'DAMAGED', 'QUALITY', 'SPILLAGE', 'OTHER', 'STAFF', 'COURTESY', 'HOLD_TIME', 'PREPARATION', 'CUSTOMER_RETURN');--> statement-breakpoint
CREATE TYPE "public"."invoice_payment_status" AS ENUM('PENDING', 'PAID', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."item_storage_type" AS ENUM('DRY', 'REFRIGERATED', 'FROZEN');--> statement-breakpoint
CREATE TYPE "public"."kpi_alert_status" AS ENUM('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE');--> statement-breakpoint
CREATE TYPE "public"."kpi_frequency" AS ENUM('REALTIME', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY');--> statement-breakpoint
CREATE TYPE "public"."kpi_metric_type" AS ENUM('PERCENTAGE', 'COUNT', 'AVERAGE', 'SUM', 'TIME', 'RATIO');--> statement-breakpoint
CREATE TYPE "public"."kpi_threshold_type" AS ENUM('MIN', 'MAX', 'TARGET', 'RANGE');--> statement-breakpoint
CREATE TYPE "public"."leave_request_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."leave_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."leave_type" AS ENUM('VACATION', 'SICK_LEAVE', 'PERSONAL', 'MATERNITY', 'PATERNITY', 'BEREAVEMENT', 'TRAINING', 'JURY_DUTY', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."manager_autonomy" AS ENUM('ALTA', 'MEDIA', 'BAJA');--> statement-breakpoint
CREATE TYPE "public"."marital_status" AS ENUM('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'COMMON_LAW');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('info', 'warning', 'error', 'success');--> statement-breakpoint
CREATE TYPE "public"."offboarding_reason" AS ENUM('VOLUNTARY_RESIGNATION', 'TERMINATION_WITH_CAUSE', 'TERMINATION_WITHOUT_CAUSE', 'CONTRACT_EXPIRED', 'RETIREMENT', 'DEATH', 'MUTUAL_AGREEMENT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."onboarding_step_status" AS ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."operating_expense_category" AS ENUM('RENTA', 'SERVICIOS', 'MANTENIMIENTO', 'PUBLICIDAD', 'SERVICIOS_PROFESIONALES', 'OTROS');--> statement-breakpoint
CREATE TYPE "public"."operating_expense_status" AS ENUM('PENDING_APPROVAL', 'PENDING_OVERBUDGET_APPROVAL', 'APPROVED', 'REJECTED', 'PAID');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('BANK_TRANSFER', 'CHECK', 'CASH', 'PAYROLL_CARD');--> statement-breakpoint
CREATE TYPE "public"."payroll_dispersion" AS ENUM('CONSOLIDADA', 'POR_RAZON_SOCIAL', 'MIXTO');--> statement-breakpoint
CREATE TYPE "public"."performance_category" AS ENUM('TECHNICAL', 'SOFT_SKILLS', 'LEADERSHIP', 'COMMUNICATION', 'PROBLEM_SOLVING', 'TEAMWORK');--> statement-breakpoint
CREATE TYPE "public"."performance_goal_status" AS ENUM('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."performance_review_status" AS ENUM('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'SUBMITTED');--> statement-breakpoint
CREATE TYPE "public"."performance_review_type" AS ENUM('SELF', 'MANAGER', 'PEER', '360');--> statement-breakpoint
CREATE TYPE "public"."petty_cash_transaction_type" AS ENUM('OUT', 'REPLENISHMENT', 'ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT');--> statement-breakpoint
CREATE TYPE "public"."production_order_status" AS ENUM('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."propina_status" AS ENUM('CALCULATED', 'DISBURSED');--> statement-breakpoint
CREATE TYPE "public"."psychosocial_risk_level" AS ENUM('MINIMO', 'BAJO', 'MEDIO', 'ALTO', 'MUY_ALTO');--> statement-breakpoint
CREATE TYPE "public"."purchase_order_item_status" AS ENUM('PENDING', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."purchase_order_status" AS ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SENT', 'PARTIALLY_RECEIVED', 'CLOSED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."purchasing_structure" AS ENUM('CENTRALIZADA', 'POR_SUCURSAL', 'HIBRIDO');--> statement-breakpoint
CREATE TYPE "public"."remediation_action_status" AS ENUM('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'SUBMITTED');--> statement-breakpoint
CREATE TYPE "public"."review_type" AS ENUM('SELF', 'MANAGER', 'PEER', '360');--> statement-breakpoint
CREATE TYPE "public"."sales_channel" AS ENUM('SALON', 'DELIVERY', 'EVENTOS', 'TOTAL');--> statement-breakpoint
CREATE TYPE "public"."sales_cut_shift" AS ENUM('MATUTINO', 'VESPERTINO', 'COMPLETO');--> statement-breakpoint
CREATE TYPE "public"."sales_cut_source" AS ENUM('UPLOAD', 'WHATSAPP', 'MANUAL_FORM');--> statement-breakpoint
CREATE TYPE "public"."sales_cut_status" AS ENUM('VALIDATED', 'PENDING_REVIEW', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."schedule_frequency" AS ENUM('DAILY', 'WEEKLY', 'MONTHLY', 'ONCE');--> statement-breakpoint
CREATE TYPE "public"."shift_approval_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."shift_approval_type" AS ENUM('OVERTIME', 'SCHEDULE_CHANGE', 'TIME_OFF', 'SHIFT_SWAP', 'EARLY_DEPARTURE');--> statement-breakpoint
CREATE TYPE "public"."shift_change_request_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."shift_type" AS ENUM('MATUTINO', 'VESPERTINO', 'NOCTURNO', 'MIXTO');--> statement-breakpoint
CREATE TYPE "public"."storage_location_org_type" AS ENUM('CENTRAL', 'BRANCH', 'VIRTUAL', 'TRANSIT');--> statement-breakpoint
CREATE TYPE "public"."storage_location_type" AS ENUM('DRY_STORAGE', 'REFRIGERATOR', 'FREEZER', 'BAR', 'KITCHEN', 'PRODUCTION', 'PACKAGING', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."supplier_bank_account_status" AS ENUM('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."supplier_claim_status" AS ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."supplier_claim_type" AS ENUM('SHORTAGE', 'DAMAGE', 'PRICE_DIFFERENCE', 'QUALITY');--> statement-breakpoint
CREATE TYPE "public"."supplier_payment_method" AS ENUM('TRANSFER', 'CASH', 'CHECK', 'CREDIT_CARD', 'DEBIT_CARD', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."supplier_payment_model" AS ENUM('CENTRALIZADO', 'POR_SUCURSAL', 'HIBRIDO');--> statement-breakpoint
CREATE TYPE "public"."tenant_type" AS ENUM('GRUPO_PROPIO', 'MIXTO_FRANQUICIAS');--> statement-breakpoint
CREATE TYPE "public"."treasury_model" AS ENUM('CUENTA_UNICA', 'CUENTA_POR_SUCURSAL', 'MIXTO');--> statement-breakpoint
CREATE TYPE "public"."vacation_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_conversation_status" AS ENUM('ACTIVE', 'WAITING_EVIDENCE', 'COMPLETED', 'TIMEOUT', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_session_status" AS ENUM('DISCONNECTED', 'CONNECTING', 'CONNECTED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."work_regime" AS ENUM('DAILY', 'MIXED', 'NIGHT', 'SPLIT_SHIFT', 'ON_CALL');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'EMPLEADO', 'READONLY');--> statement-breakpoint
CREATE TYPE "public"."branch_ownership" AS ENUM('OWNED', 'FRANCHISE');--> statement-breakpoint
CREATE TYPE "public"."compliance_service_type" AS ENUM('FUMIGATION', 'FIRE_SYSTEM_CHECK', 'ELECTRICAL_INSPECTION', 'GAS_INSPECTION', 'WATER_QUALITY', 'AIR_QUALITY', 'PEST_CONTROL', 'HYGIENE_AUDIT', 'SAFETY_INSPECTION', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."equipment_status" AS ENUM('ACTIVE', 'INACTIVE', 'UNDER_MAINTENANCE', 'OUT_OF_ORDER', 'DISPOSED');--> statement-breakpoint
CREATE TYPE "public"."equipment_type" AS ENUM('REFRIGERATOR', 'FREEZER', 'OVEN', 'STOVE', 'GRILL', 'FRYER', 'DISHWASHER', 'COFFEE_MACHINE', 'BLENDER', 'MIXER', 'EXHAUST_HOOD', 'AIR_CONDITIONER', 'FIRE_SUPPRESSION', 'SECURITY_CAMERA', 'POS_SYSTEM', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."maintenance_status" AS ENUM('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'OVERDUE');--> statement-breakpoint
CREATE TYPE "public"."maintenance_type" AS ENUM('PREVENTIVE', 'CORRECTIVE', 'INSPECTION', 'CLEANING', 'CALIBRATION', 'EMERGENCY');--> statement-breakpoint
CREATE TYPE "public"."service_frequency" AS ENUM('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."service_provider_type" AS ENUM('INTERNAL', 'EXTERNAL', 'CERTIFIED');--> statement-breakpoint
CREATE TYPE "public"."warranty_status" AS ENUM('ACTIVE', 'EXPIRED', 'VOID', 'CLAIMED');--> statement-breakpoint
CREATE TYPE "public"."civil_drill_result" AS ENUM('EXITOSO', 'ACEPTABLE', 'REQUIERE_MEJORA', 'FALLIDO');--> statement-breakpoint
CREATE TYPE "public"."civil_drill_type" AS ENUM('EVACUACION', 'CONFINAMIENTO', 'SIMULACRO_GENERAL', 'SISMO', 'INCENDIO', 'OTRO');--> statement-breakpoint
CREATE TYPE "public"."civil_extinguisher_status" AS ENUM('OPTIMO', 'ACEPTABLE', 'REQUIERE_RECARGA', 'DESCARTADO', 'PERDIDO');--> statement-breakpoint
CREATE TYPE "public"."operational_twin_state" AS ENUM('CREATE', 'ACTIVE', 'DEGRADING', 'CRITICAL', 'RECOVERING');--> statement-breakpoint
CREATE TYPE "public"."cfdi_timbrado_status" AS ENUM('TIMBRADO', 'PENDIENTE', 'RECHAZADO', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."terminal_acquirer" AS ENUM('CLIP', 'MERCADO_PAGO', 'BBVA', 'BANORTE', 'SANTANDER', 'RAPPI', 'UBER_EATS', 'DIDI', 'DOORDASH', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."approval_doc_type" AS ENUM('OC', 'OS');--> statement-breakpoint
CREATE TYPE "public"."approval_request_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."evidence_type" AS ENUM('ANTES', 'DESPUES');--> statement-breakpoint
CREATE TYPE "public"."purchase_delegation_action" AS ENUM('REQUEST', 'EMIT');--> statement-breakpoint
CREATE TYPE "public"."purchase_delegation_scope" AS ENUM('COMPANY', 'BRANCH', 'CATEGORY');--> statement-breakpoint
CREATE TYPE "public"."purchase_type" AS ENUM('PROGRAMADA', 'STOCK', 'EMERGENCIA');--> statement-breakpoint
CREATE TYPE "public"."service_order_status" AS ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'IN_PROGRESS', 'PENDING_CONFORMITY', 'CLOSED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."service_order_type" AS ENUM('CORRECTIVO', 'PREVENTIVO', 'CONTRACTUAL', 'EXTRAORDINARIO');--> statement-breakpoint
CREATE TYPE "public"."service_urgency" AS ENUM('NORMAL', 'URGENTE', 'EMERGENCIA');--> statement-breakpoint
CREATE TYPE "public"."account_purpose" AS ENUM('DISPERSION', 'RECEPCION', 'MIXTO');--> statement-breakpoint
CREATE TYPE "public"."bank_transaction_match_status" AS ENUM('UNMATCHED', 'MATCHED', 'IGNORED');--> statement-breakpoint
CREATE TYPE "public"."payee_bank_account_status" AS ENUM('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."payment_run_item_settlement" AS ENUM('PENDING', 'CONFIRMED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."payment_run_item_type" AS ENUM('INVOICE', 'PAYROLL', 'TAXES', 'PETTY_CASH_REIMBURSEMENT', 'OTHER', 'OPERATING_EXPENSE');--> statement-breakpoint
CREATE TYPE "public"."payment_run_status" AS ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PROCESSING', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."recurring_payable_status" AS ENUM('OPEN', 'INVOICED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."production_plan_item_status" AS ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."production_plan_status" AS ENUM('DRAFT', 'PUBLISHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."exception_domain" AS ENUM('operacion', 'cumplimiento', 'equipos', 'personal', 'inventario', 'finanzas');--> statement-breakpoint
CREATE TYPE "public"."exception_severity" AS ENUM('info', 'warning', 'high', 'critical', 'fatal');--> statement-breakpoint
CREATE TYPE "public"."exception_status" AS ENUM('OPEN', 'ASSIGNED', 'IN_ACTION', 'RESOLVED', 'VERIFIED', 'CLOSED', 'REOPENED', 'ESCALATED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."qsr_risk_category" AS ENUM('DINERO', 'INOCUIDAD', 'ABASTO', 'PERSONAL');--> statement-breakpoint
CREATE TYPE "public"."evidence_entity_type" AS ENUM('WORKFLOW_STEP', 'INCIDENT', 'DOCUMENT', 'EXPENSE', 'SERVICE_ORDER', 'WASTE', 'RECEIVING', 'GENERAL');--> statement-breakpoint
CREATE TYPE "public"."evidence_kind" AS ENUM('PHOTO', 'FILE', 'VOICE', 'VIDEO', 'TEXT');--> statement-breakpoint
CREATE TABLE "accounting_sales_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"cut_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"original_id" uuid,
	"business_date" date NOT NULL,
	"shift" text NOT NULL,
	"channel" text NOT NULL,
	"total_cents" integer NOT NULL,
	"cash_cents" integer NOT NULL,
	"card_cents" integer NOT NULL,
	"platform_cents" integer NOT NULL,
	"other_cents" integer NOT NULL,
	"revenue_cents" integer NOT NULL,
	"discount_cents" integer NOT NULL,
	"tax_cents" integer NOT NULL,
	"tips_cents" integer NOT NULL,
	"document_reference" text NOT NULL,
	"reason" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_sales_company_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "accounting_sales_kind_check" CHECK (("accounting_sales_documents"."kind" = 'SALE' AND "accounting_sales_documents"."version" >= 1
      AND (("accounting_sales_documents"."version" = 1) = ("accounting_sales_documents"."original_id" IS NULL)))
      OR ("accounting_sales_documents"."kind" = 'REFUND' AND "accounting_sales_documents"."version" = 1 AND "accounting_sales_documents"."original_id" IS NOT NULL)),
	CONSTRAINT "accounting_sales_scope_check" CHECK ("accounting_sales_documents"."shift" IN ('MATUTINO','VESPERTINO','COMPLETO')
      AND "accounting_sales_documents"."channel" IN ('TOTAL','SALON','DELIVERY','EVENTOS')),
	CONSTRAINT "accounting_sales_amounts_check" CHECK ("accounting_sales_documents"."total_cents" > 0 AND "accounting_sales_documents"."cash_cents" >= 0 AND "accounting_sales_documents"."card_cents" >= 0
      AND "accounting_sales_documents"."platform_cents" >= 0 AND "accounting_sales_documents"."other_cents" >= 0 AND "accounting_sales_documents"."revenue_cents" >= "accounting_sales_documents"."discount_cents"
      AND "accounting_sales_documents"."discount_cents" >= 0 AND "accounting_sales_documents"."tax_cents" >= 0 AND "accounting_sales_documents"."tips_cents" >= 0
      AND "accounting_sales_documents"."total_cents"::bigint = "accounting_sales_documents"."cash_cents"::bigint + "accounting_sales_documents"."card_cents" + "accounting_sales_documents"."platform_cents" + "accounting_sales_documents"."other_cents"
      AND "accounting_sales_documents"."total_cents"::bigint = "accounting_sales_documents"."revenue_cents"::bigint - "accounting_sales_documents"."discount_cents" + "accounting_sales_documents"."tax_cents" + "accounting_sales_documents"."tips_cents"),
	CONSTRAINT "accounting_sales_reference_check" CHECK (length(btrim("accounting_sales_documents"."document_reference")) BETWEEN 1 AND 200
      AND length(btrim("accounting_sales_documents"."reason")) BETWEEN 5 AND 500)
);
--> statement-breakpoint
ALTER TABLE "accounting_sales_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aggregator_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"gross_sales_cents" integer NOT NULL,
	"commission_cents" integer NOT NULL,
	"net_deposited_cents" integer NOT NULL,
	"pos_sales_cents" integer,
	"variance_cents" integer,
	"status" "aggregator_settlement_status" DEFAULT 'PENDING' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "break_compliance_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"rule_name" text NOT NULL,
	"description" text,
	"min_break_duration" integer DEFAULT 30,
	"max_continuous_work" integer DEFAULT 300,
	"meal_break_required" boolean DEFAULT true,
	"meal_break_min_duration" integer DEFAULT 30,
	"max_daily_hours" integer DEFAULT 8,
	"max_weekly_hours" integer DEFAULT 48,
	"min_rest_between_shifts" integer DEFAULT 12,
	"late_tolerance" integer DEFAULT 10,
	"early_departure_tolerance" integer DEFAULT 10,
	"enable_break_reminders" boolean DEFAULT true,
	"reminder_interval" integer DEFAULT 120,
	"enable_overtime_alerts" boolean DEFAULT true,
	"overtime_alert_threshold" integer DEFAULT 30,
	"is_active" boolean DEFAULT true,
	"requires_backrest_chair" boolean DEFAULT true,
	"standing_risk_level" text DEFAULT 'PROLONGADA',
	"rest_area_location" text DEFAULT 'WORKSTATION',
	"rit_pause_interval_minutes" integer DEFAULT 120,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "break_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"start_time" timestamp DEFAULT now() NOT NULL,
	"end_time" timestamp,
	"duration_minutes" integer,
	"type" text DEFAULT 'STANDARD',
	"is_compliant" boolean DEFAULT true,
	"compliance_notes" text,
	"reminded_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "break_reminder_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"reminder_type" text NOT NULL,
	"message" text NOT NULL,
	"channel" text NOT NULL,
	"triggered_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"acknowledged" boolean DEFAULT false,
	"acknowledged_at" timestamp,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "cfdi_recibidos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"invoice_uuid" text NOT NULL,
	"issuer_tin" text NOT NULL,
	"issuer_name" text,
	"recipient_tin" text,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'MXN',
	"invoice_date" timestamp with time zone,
	"sat_certification_date" timestamp with time zone,
	"download_request_id" text,
	"conciliation_status" "cfdi_conciliation_status" DEFAULT 'SIN_MATCH' NOT NULL,
	"matched_supplier_id" uuid,
	"matched_payee_id" uuid,
	"matched_purchase_order_id" uuid,
	"matched_expense_id" uuid,
	"raw_metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cfdi_recibidos_invoice_uuid_unique" UNIQUE("invoice_uuid")
);
--> statement-breakpoint
CREATE TABLE "channel_commission_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"branch_id" uuid,
	"rate_bps" integer NOT NULL,
	"vat_bps" integer DEFAULT 1600 NOT NULL,
	"effective_from" date NOT NULL,
	"notes" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communication_read_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"communication_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"read_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"alert_type" "compliance_alert_type" NOT NULL,
	"severity" "incident_severity" NOT NULL,
	"status" "compliance_alert_status" DEFAULT 'ACTIVE' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"compliance_type" text,
	"workflow_template_id" uuid,
	"current_score" integer,
	"threshold" integer,
	"acknowledged_by" text,
	"acknowledged_at" timestamp,
	"resolved_by" text,
	"resolved_at" timestamp,
	"resolution_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "config_change_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"field_name" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"performed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"category" text NOT NULL,
	"amount" integer NOT NULL,
	"description" text,
	"reference_id" text,
	"recorded_by" text,
	"period_start" timestamp,
	"period_end" timestamp,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"invoice_id" uuid,
	"uuid" text NOT NULL,
	"folio" text,
	"serie" text,
	"fecha" text NOT NULL,
	"subtotal" integer NOT NULL,
	"tax_amount" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"currency" text DEFAULT 'MXN' NOT NULL,
	"reason" text,
	"xml_content" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_notes_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "daily_sales_cuts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"shift" "sales_cut_shift" NOT NULL,
	"channel" "sales_channel" DEFAULT 'TOTAL' NOT NULL,
	"total_sales" integer NOT NULL,
	"cash_sales" integer,
	"card_sales" integer,
	"other_payments" integer,
	"cash_counted_cents" integer,
	"deposited_cents" integer,
	"aggregator_sales" jsonb,
	"commission_cents" integer,
	"tpv_deposit_cents" integer,
	"tax_amount" integer,
	"avg_ticket" integer,
	"ticket_count" integer,
	"source" "sales_cut_source" NOT NULL,
	"raw_file_url" text,
	"status" "sales_cut_status" DEFAULT 'PENDING_REVIEW' NOT NULL,
	"validation_notes" text,
	"received_by" text,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"action" "audit_action" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"field_name" text,
	"old_value" jsonb,
	"new_value" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"reason" text,
	"is_sensitive" boolean DEFAULT false,
	"requires_approval" boolean DEFAULT false,
	"approved_by" text,
	"approved_at" timestamp,
	"retention_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_benefits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"benefit_type" text NOT NULL,
	"provider" text,
	"policy_number" text,
	"coverage_amount" integer,
	"is_active" boolean DEFAULT true,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp,
	"employee_contribution" integer DEFAULT 0,
	"employer_contribution" integer DEFAULT 0,
	"beneficiaries" jsonb,
	"document_id" uuid,
	"notes" text,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_communications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"communication_type" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"target_type" text NOT NULL,
	"target_ids" jsonb,
	"target_roles" jsonb,
	"status" text DEFAULT 'DRAFT',
	"is_pinned" boolean DEFAULT false,
	"sent_at" timestamp,
	"delivered_via" jsonb,
	"read_count" integer DEFAULT 0,
	"total_recipients" integer DEFAULT 0,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"contract_number" text NOT NULL,
	"contract_type" "contract_type" DEFAULT 'INDETERMINATE' NOT NULL,
	"work_regime" "work_regime" DEFAULT 'DAILY' NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp,
	"probation_period_days" integer,
	"signature_date" timestamp,
	"base_salary" integer NOT NULL,
	"monthly_salary" integer,
	"weekly_salary" integer,
	"currency" text DEFAULT 'MXN',
	"effective_salary_cents" integer,
	"has_health_insurance" boolean DEFAULT false,
	"has_life_insurance" boolean DEFAULT false,
	"has_savings_fund" boolean DEFAULT false,
	"has_food_vouchers" boolean DEFAULT false,
	"has_transportation_bonus" boolean DEFAULT false,
	"benefits_notes" text,
	"work_start_time" text,
	"work_end_time" text,
	"work_days" integer[],
	"break_duration_minutes" integer DEFAULT 60,
	"status" text DEFAULT 'ACTIVE',
	"renewal_date" timestamp,
	"auto_renew" boolean DEFAULT false,
	"contract_document_id" uuid,
	"approved_by" text,
	"approved_at" timestamp,
	"terms" text,
	"notes" text,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"document_type" "document_type" NOT NULL,
	"document_name" text NOT NULL,
	"document_url" text NOT NULL,
	"file_key" text,
	"file_size" integer,
	"mime_type" text,
	"uploaded_by" text NOT NULL,
	"issue_date" timestamp,
	"expiration_date" timestamp,
	"is_valid" boolean DEFAULT true,
	"status" "document_status" DEFAULT 'PENDING' NOT NULL,
	"validated_by" text,
	"validated_at" timestamp,
	"rejection_reason" text,
	"notes" text,
	"is_required" boolean DEFAULT false,
	"compliance_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_offboarding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"reason" "offboarding_reason" NOT NULL,
	"reason_details" text,
	"resignation_date" timestamp,
	"last_working_day" timestamp NOT NULL,
	"final_pay_date" timestamp,
	"accrued_vacation_days" integer DEFAULT 0,
	"vacation_pay" integer DEFAULT 0,
	"seniority_bonus" integer DEFAULT 0,
	"severance_pay" integer DEFAULT 0,
	"final_pay_amount" integer DEFAULT 0,
	"deductions" integer DEFAULT 0,
	"currency" text DEFAULT 'MXN',
	"assets_to_return" jsonb,
	"assets_returned" boolean DEFAULT false,
	"assets_return_date" timestamp,
	"assets_notes" text,
	"exit_interview_completed" boolean DEFAULT false,
	"exit_interview_date" timestamp,
	"exit_interview_notes" text,
	"conducted_by" text,
	"benefits_settled" boolean DEFAULT false,
	"social_security_cancelled" boolean DEFAULT false,
	"documents_archived" boolean DEFAULT false,
	"access_revoked" boolean DEFAULT false,
	"access_revoked_date" timestamp,
	"status" text DEFAULT 'IN_PROGRESS',
	"completed_date" timestamp,
	"approved_by" text,
	"approved_at" timestamp,
	"hr_notes" text,
	"notes" text,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_onboarding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"status" text DEFAULT 'IN_PROGRESS',
	"start_date" timestamp NOT NULL,
	"target_end_date" timestamp,
	"completed_date" timestamp,
	"assigned_buddy_id" text,
	"assigned_mentor_id" text,
	"total_steps" integer DEFAULT 0,
	"completed_steps" integer DEFAULT 0,
	"progress_percentage" integer DEFAULT 0,
	"notes" text,
	"hr_notes" text,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"date_of_birth" timestamp,
	"curp" text,
	"rfc" text,
	"nss" text,
	"gender" "gender",
	"marital_status" "marital_status",
	"blood_type" "blood_type",
	"nationality" text DEFAULT 'MEXICANA',
	"personal_email" text,
	"personal_phone" text,
	"address" jsonb,
	"city" text,
	"state" text,
	"zip_code" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"emergency_contact_email" text,
	"emergency_contact_relationship" text,
	"bank_name" text,
	"clabe" text,
	"card_number" text,
	"payment_method" "payment_method" DEFAULT 'BANK_TRANSFER',
	"employee_number" text,
	"department" text,
	"position" text,
	"supervisor_id" text,
	"hire_date" timestamp,
	"seniority_date" timestamp,
	"probation_end_date" timestamp,
	"employee_status" "employee_status" DEFAULT 'ONBOARDING',
	"is_active" boolean DEFAULT false,
	"termination_date" timestamp,
	"termination_reason" "offboarding_reason",
	"rehire_eligible" boolean DEFAULT true,
	"default_shift_id" uuid,
	"standard_hours_per_week" integer DEFAULT 48,
	"languages" jsonb,
	"skills" jsonb,
	"notes" text,
	"profile_photo_url" text,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_training" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"training_name" text NOT NULL,
	"training_type" text NOT NULL,
	"provider" text,
	"instructor" text,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp,
	"completion_date" timestamp,
	"expiration_date" timestamp,
	"status" text DEFAULT 'IN_PROGRESS',
	"grade" text,
	"passed" boolean,
	"certification_number" text,
	"issuing_authority" text,
	"is_mandatory" boolean DEFAULT false,
	"certificate_document_id" uuid,
	"cost" integer DEFAULT 0,
	"company_paid" boolean DEFAULT true,
	"notes" text,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_training_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"course_name" text NOT NULL,
	"completed_at" timestamp DEFAULT now() NOT NULL,
	"score" integer NOT NULL,
	"certificate_url" text,
	"status" text DEFAULT 'ACTIVE',
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"event_name" text NOT NULL,
	"conditions" jsonb,
	"is_active" boolean DEFAULT true,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "expense_authorization_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"min_amount" integer NOT NULL,
	"max_amount" integer,
	"approver_role" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"expense_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"paid_at" date NOT NULL,
	"payment_method" "expense_payment_method",
	"status" "expense_payment_status" DEFAULT 'PENDING' NOT NULL,
	"source" "expense_payment_source" NOT NULL,
	"payment_run_item_id" uuid,
	"accounting_journal_id" uuid,
	"pending_reason" text,
	"reference" text,
	"failure_reason" text,
	"created_by" text NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "expense_payments_company_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "expense_payments_amount_check" CHECK ("expense_payments"."amount_cents" > 0 AND "expense_payments"."amount_cents" <= 2147483647),
	CONSTRAINT "expense_payments_status_check" CHECK ("expense_payments"."status" IN ('PENDING','CONFIRMED','FAILED')),
	CONSTRAINT "expense_payments_source_check" CHECK ("expense_payments"."source" IN ('MANUAL','TREASURY')),
	CONSTRAINT "expense_payments_settlement_check" CHECK (
        ("expense_payments"."status" = 'PENDING' AND "expense_payments"."confirmed_by" IS NULL AND "expense_payments"."confirmed_at" IS NULL
          AND "expense_payments"."failure_reason" IS NULL)
        OR ("expense_payments"."status" = 'CONFIRMED' AND "expense_payments"."confirmed_by" IS NOT NULL AND "expense_payments"."confirmed_at" IS NOT NULL
          AND "expense_payments"."failure_reason" IS NULL)
        OR ("expense_payments"."status" = 'FAILED' AND "expense_payments"."confirmed_by" IS NULL AND "expense_payments"."confirmed_at" IS NULL
          AND "expense_payments"."failure_reason" IS NOT NULL)),
	CONSTRAINT "expense_payments_source_link_check" CHECK (
        ("expense_payments"."source" = 'TREASURY') = ("expense_payments"."payment_run_item_id" IS NOT NULL)),
	CONSTRAINT "expense_payments_reference_check" CHECK ("expense_payments"."reference" IS NULL OR
        ("expense_payments"."reference" = btrim("expense_payments"."reference") AND length("expense_payments"."reference") BETWEEN 1 AND 200)),
	CONSTRAINT "expense_payments_pending_reason_check" CHECK ("expense_payments"."pending_reason" IS NULL OR
        ("expense_payments"."pending_reason" = btrim("expense_payments"."pending_reason") AND length("expense_payments"."pending_reason") BETWEEN 1 AND 500)),
	CONSTRAINT "expense_payments_failure_reason_check" CHECK ("expense_payments"."failure_reason" IS NULL OR
        ("expense_payments"."failure_reason" = btrim("expense_payments"."failure_reason") AND length("expense_payments"."failure_reason") BETWEEN 1 AND 500)),
	CONSTRAINT "expense_payments_journal_link_check" CHECK (
        "expense_payments"."accounting_journal_id" IS NULL OR "expense_payments"."status" = 'CONFIRMED')
);
--> statement-breakpoint
ALTER TABLE "expense_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "financial_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"status" "financial_period_status" DEFAULT 'OPEN' NOT NULL,
	"closed_at" timestamp,
	"closed_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forecast_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"recipe_id" uuid NOT NULL,
	"forecast_date" timestamp NOT NULL,
	"predicted_quantity" integer NOT NULL,
	"confidence_score" integer DEFAULT 0,
	"actual_quantity" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imss_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"layout" text NOT NULL,
	"layout_version" text NOT NULL,
	"movement_type" "imss_movement_type",
	"fecha_movimiento" date NOT NULL,
	"file_name" text NOT NULL,
	"content_sha256" text NOT NULL,
	"line_count" integer NOT NULL,
	"status" "imss_file_status" DEFAULT 'GENERADO' NOT NULL,
	"acuse_folio" text,
	"acuse_received_at" timestamp with time zone,
	"rejection_reason" text,
	"storage_key" text,
	"content_unavailable" boolean DEFAULT false NOT NULL,
	"generated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imss_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"file_id" uuid,
	"movement_type" "imss_movement_type" NOT NULL,
	"movement_code" text NOT NULL,
	"effective_date" date NOT NULL,
	"registro_patronal" text,
	"base_salary_cents" integer,
	"sdi_cents" integer,
	"status" "imss_movement_status" DEFAULT 'PENDIENTE' NOT NULL,
	"blocked_reason" text,
	"confirmed_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"step_id" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"severity" "incident_severity" NOT NULL,
	"status" "incident_status" DEFAULT 'DETECTED',
	"title" text NOT NULL,
	"description" text,
	"detected_by" text,
	"initial_value" jsonb,
	"target_value" jsonb,
	"photo_url" text,
	"metadata" jsonb,
	"remediation_protocol" jsonb,
	"escalation_chain" jsonb,
	"current_attempt" integer DEFAULT 0,
	"max_attempts" integer DEFAULT 1,
	"resolution" text,
	"resolution_type" text,
	"resolved_by" text,
	"resolved_at" timestamp,
	"source_playbook_id" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inventory_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"type" "inventory_alert_type" NOT NULL,
	"severity" text NOT NULL,
	"status" "inventory_alert_status" DEFAULT 'ACTIVE' NOT NULL,
	"current_stock" integer NOT NULL,
	"min_level" integer NOT NULL,
	"batch_id" uuid,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"viewed_at" timestamp,
	"resolved_at" timestamp,
	"resolved_by" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"action" "inventory_audit_action" NOT NULL,
	"entity_type" "inventory_audit_entity" NOT NULL,
	"entity_id" text,
	"old_value" jsonb,
	"new_value" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier_id" uuid,
	"lot_number" text,
	"production_date" timestamp,
	"expiration_date" timestamp,
	"received_at" timestamp DEFAULT now(),
	"initial_quantity" numeric(12, 4) NOT NULL,
	"current_quantity" numeric(12, 4) NOT NULL,
	"unit_cost" integer,
	"status" "inventory_batch_status" DEFAULT 'AVAILABLE',
	"supplier_batch_info" jsonb,
	"origin" text,
	"parent_batch_ids" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inventory_expiration_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"window" text NOT NULL,
	"notified_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"barcode" text,
	"category" text,
	"unit" text DEFAULT 'UNIT' NOT NULL,
	"min_level" integer DEFAULT 0,
	"max_level" integer,
	"lead_time_days" integer DEFAULT 3,
	"storage_area" text,
	"allergen_info" text,
	"storage_requirements" text,
	"storage_type" "item_storage_type",
	"typical_shelf_life_days" integer,
	"active" boolean DEFAULT true,
	"is_high_value" boolean DEFAULT false,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"supplier_id" uuid,
	"last_cost" integer,
	"photo_url" text,
	"brand" text,
	"presentation" text,
	"standard_cost" integer,
	"average_cost" integer,
	"average_cost_updated_at" timestamp,
	"yield_percent" integer DEFAULT 100,
	"tax_rate" integer DEFAULT 16 NOT NULL,
	"ieps_rate" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inventory_knowledge_graph" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"avg_daily_consumption" integer,
	"consumption_trend" integer,
	"consumption_volatility" integer,
	"avg_waste_percent" integer,
	"waste_trend" integer,
	"total_waste_loss" integer,
	"avg_stock_level" integer,
	"stockout_count" integer,
	"avg_lead_time_days" integer,
	"period" text DEFAULT 'DAILY' NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"last_movement_at" timestamp,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid,
	"type" "inventory_transaction_type" NOT NULL,
	"quantity_change" numeric(12, 4) NOT NULL,
	"from_location_id" uuid,
	"to_location_id" uuid,
	"reason" text,
	"reference_id" text,
	"performed_by" text,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"status" "inventory_period_status" DEFAULT 'OPEN' NOT NULL,
	"closed_by" text,
	"closed_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"previous_cost" integer,
	"new_cost" integer NOT NULL,
	"supplier_id" uuid,
	"changed_by" text NOT NULL,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"snapshot_date" date NOT NULL,
	"calculated_stock" numeric(12, 4) NOT NULL,
	"counted_stock" numeric(12, 4),
	"variance" numeric(12, 4) GENERATED ALWAYS AS ((counted_stock - calculated_stock)) STORED,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_transfer_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid,
	"requested_quantity" integer NOT NULL,
	"approved_quantity" integer,
	"shipped_quantity" integer,
	"received_quantity" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_number" text NOT NULL,
	"from_branch_id" uuid NOT NULL,
	"to_branch_id" uuid NOT NULL,
	"status" "inventory_transfer_status" DEFAULT 'PENDING' NOT NULL,
	"requested_by" text NOT NULL,
	"approved_by" text,
	"shipped_by" text,
	"received_by" text,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"approved_at" timestamp,
	"shipped_at" timestamp,
	"received_at" timestamp,
	"cancelled_at" timestamp,
	"notes" text,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_transfers_transfer_number_unique" UNIQUE("transfer_number")
);
--> statement-breakpoint
CREATE TABLE "inventory_waste" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"batch_id" uuid,
	"item_id" uuid,
	"quantity" numeric(12, 4) NOT NULL,
	"unit" text NOT NULL,
	"reason" "inventory_waste_reason" NOT NULL,
	"cost_per_unit" integer,
	"total_loss" integer,
	"workflow_instance_id" uuid,
	"origin" text,
	"evidence_url" text,
	"approval_status" text DEFAULT 'AUTO' NOT NULL,
	"approved_by" text,
	"approved_at" timestamp,
	"recipe_id" uuid,
	"processed_quantity" numeric(12, 4),
	"expected_quantity" numeric(12, 4),
	"yield_flagged" boolean DEFAULT false NOT NULL,
	"production_result_id" uuid,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"item_id" uuid,
	"clave_prod_serv" text NOT NULL,
	"no_identificacion" text,
	"cantidad" numeric(10, 4) NOT NULL,
	"clave_unidad" text NOT NULL,
	"unidad" text,
	"descripcion" text NOT NULL,
	"valor_unitario" integer NOT NULL,
	"importe" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"supplier_id" uuid,
	"purchase_order_id" uuid,
	"receiving_report_id" uuid,
	"recurring_contract_id" uuid,
	"service_order_id" uuid,
	"uuid" text NOT NULL,
	"folio" text,
	"serie" text,
	"fecha" text NOT NULL,
	"subtotal" integer NOT NULL,
	"tax_amount" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"currency" text DEFAULT 'MXN' NOT NULL,
	"rfc_emisor" text NOT NULL,
	"nombre_emisor" text,
	"rfc_receptor" text NOT NULL,
	"nombre_receptor" text,
	"match_status" text DEFAULT 'PENDING' NOT NULL,
	"sat_status" text,
	"sat_checked_at" timestamp,
	"has_price_discrepancy" boolean DEFAULT false NOT NULL,
	"has_qty_discrepancy" boolean DEFAULT false NOT NULL,
	"exception_approved_by" text,
	"exception_approved_at" timestamp,
	"exception_reason" text,
	"due_date" date,
	"payment_status" "invoice_payment_status" DEFAULT 'PENDING' NOT NULL,
	"paid_at" timestamp,
	"paid_by" text,
	"payment_notes" text,
	"xml_content" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "kpi_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kpi_id" uuid NOT NULL,
	"branch_id" uuid,
	"alert_type" text NOT NULL,
	"status" "kpi_alert_status" DEFAULT 'ACTIVE' NOT NULL,
	"triggered_value" integer NOT NULL,
	"threshold" integer NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"acknowledged_by" text,
	"acknowledged_at" timestamp,
	"resolution_notes" text,
	"resolved_by" text,
	"resolved_at" timestamp,
	"notified_users" jsonb,
	"notification_sent" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"formula" text NOT NULL,
	"metric_type" "kpi_metric_type" NOT NULL,
	"target" integer,
	"warning_threshold" integer,
	"critical_threshold" integer,
	"threshold_type" "kpi_threshold_type" DEFAULT 'TARGET',
	"frequency" "kpi_frequency" DEFAULT 'DAILY' NOT NULL,
	"data_retention_days" integer DEFAULT 90,
	"unit" text DEFAULT '',
	"decimal_places" integer DEFAULT 2,
	"category" text DEFAULT 'OPERATIONS',
	"active" boolean DEFAULT true,
	"is_system" boolean DEFAULT false,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kpi_id" uuid NOT NULL,
	"branch_id" uuid,
	"value" integer NOT NULL,
	"raw_value" text,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"status" text DEFAULT 'NORMAL',
	"target" integer,
	"target_achieved" boolean,
	"calculated_at" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "kpi_snapshot_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"snapshot_type" text NOT NULL,
	"snapshot_date" timestamp NOT NULL,
	"metrics" jsonb NOT NULL,
	"period_start" timestamp,
	"period_end" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"total_entitlement" integer NOT NULL,
	"used" integer DEFAULT 0,
	"pending" integer DEFAULT 0,
	"balance" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"leave_type_id" uuid NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"total_days" integer NOT NULL,
	"reason" text NOT NULL,
	"status" "leave_request_status" DEFAULT 'PENDING' NOT NULL,
	"supporting_document_id" uuid,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"approved_by" text,
	"approved_at" timestamp,
	"rejected_by" text,
	"rejected_at" timestamp,
	"rejection_reason" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_paid" boolean DEFAULT true,
	"requires_documentation" boolean DEFAULT false,
	"max_days_per_year" integer,
	"accrual_rate" integer,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"content" text NOT NULL,
	"communication_type" text NOT NULL,
	"variables" jsonb,
	"is_active" boolean DEFAULT true,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nom035_action_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"risk_category" text DEFAULT 'GENERAL' NOT NULL,
	"priority" text DEFAULT 'MEDIUM' NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"assigned_to" text,
	"due_date" timestamp,
	"remediation_measures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"whatsapp_enabled" boolean DEFAULT true NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"in_app_enabled" boolean DEFAULT true NOT NULL,
	"workflow_assignments" boolean DEFAULT true NOT NULL,
	"workflow_due_soon" boolean DEFAULT true NOT NULL,
	"workflow_overdue" boolean DEFAULT true NOT NULL,
	"incidents" boolean DEFAULT true NOT NULL,
	"inventory_alerts" boolean DEFAULT true NOT NULL,
	"shift_reminders" boolean DEFAULT true NOT NULL,
	"schedule_changes" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"type" "notification_type" NOT NULL,
	"action_url" text,
	"action_label" text,
	"read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"onboarding_id" uuid NOT NULL,
	"step_name" text NOT NULL,
	"step_category" text NOT NULL,
	"description" text,
	"assigned_to" text,
	"status" "onboarding_step_status" DEFAULT 'PENDING',
	"due_date" timestamp,
	"completed_date" timestamp,
	"completed_by" text,
	"required_document_id" uuid,
	"notes" text,
	"depends_on_step_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operating_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"payee_id" uuid,
	"cost_center_id" uuid,
	"category" "operating_expense_category" NOT NULL,
	"amount" integer NOT NULL,
	"description" text NOT NULL,
	"evidence_url" text,
	"invoice_id" uuid,
	"status" "operating_expense_status" DEFAULT 'PENDING_APPROVAL' NOT NULL,
	"requested_by" text NOT NULL,
	"approved_by" text,
	"approval_notes" text,
	"paid_at" timestamp,
	"payment_method" "expense_payment_method",
	"tax_amount" integer,
	"paid_by" text,
	"business_date" date,
	"overbudget_approved_by" text,
	"overbudget_approved_at" timestamp,
	"due_date" date,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "operating_expenses_company_id_unique" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "payees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"tax_id" text,
	"contact_name" text,
	"email" text,
	"phone" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_aguinaldo_dispersiones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"run_id" uuid,
	"source" text DEFAULT 'RUN' NOT NULL,
	"user_id" text NOT NULL,
	"anio_fiscal" integer NOT NULL,
	"monto_cents" integer NOT NULL,
	"motivo" text NOT NULL,
	"fecha_dispersion" timestamp DEFAULT now() NOT NULL,
	"performed_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_payslips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"aguinaldo_snapshot" jsonb,
	"base_salary_cents" integer DEFAULT 0 NOT NULL,
	"propinas_cents" integer DEFAULT 0 NOT NULL,
	"holiday_pay_cents" integer DEFAULT 0 NOT NULL,
	"overtime_pay_cents" integer DEFAULT 0 NOT NULL,
	"aguinaldo_cents" integer DEFAULT 0 NOT NULL,
	"total_percepciones_cents" integer DEFAULT 0 NOT NULL,
	"total_deducciones_cents" integer DEFAULT 0 NOT NULL,
	"cfdi_uuid" text,
	"cfdi_status" text,
	"sello_digital" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"aguinaldo_fiscal_year" integer,
	"aguinaldo_snapshot" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"category" text,
	"status" "performance_goal_status" DEFAULT 'NOT_STARTED' NOT NULL,
	"target_date" timestamp,
	"completed_date" timestamp,
	"metrics" jsonb,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_review_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" "performance_category" NOT NULL,
	"weight" integer DEFAULT 1,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_review_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"criteria_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"comments" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"reviewer_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"review_type" "performance_review_type" NOT NULL,
	"review_period" text NOT NULL,
	"review_date" timestamp DEFAULT now() NOT NULL,
	"status" "performance_review_status" DEFAULT 'DRAFT' NOT NULL,
	"overall_rating" numeric(2, 1),
	"strengths" text,
	"areas_for_improvement" text,
	"goals" jsonb,
	"achievements" jsonb,
	"development_plan" text,
	"comments" text,
	"submitted_at" timestamp,
	"completed_at" timestamp,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "petty_cash_funds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"fund_amount" integer NOT NULL,
	"current_balance" integer NOT NULL,
	"low_threshold" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "petty_cash_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fund_id" uuid NOT NULL,
	"type" "petty_cash_transaction_type" NOT NULL,
	"amount" integer NOT NULL,
	"concept" text NOT NULL,
	"category" "operating_expense_category",
	"cost_center_id" uuid,
	"evidence_url" text,
	"workflow_instance_id" text,
	"registered_by" text NOT NULL,
	"approved_by" text,
	"authorization_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planned_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"shift_date" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"template_id" uuid,
	"workflow_template_id" text,
	"role" text NOT NULL,
	"status" text DEFAULT 'DRAFT',
	"notes" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pnl_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"sales_cents" integer NOT NULL,
	"food_cost_cents" integer NOT NULL,
	"waste_cents" integer NOT NULL,
	"labor_cost_cents" integer NOT NULL,
	"operating_expenses_cents" integer NOT NULL,
	"operating_profit_cents" integer NOT NULL,
	"weakest_line" text NOT NULL,
	"lines" jsonb NOT NULL,
	"commission_cents" integer,
	"costing_method" text,
	"frozen_at" timestamp DEFAULT now() NOT NULL,
	"frozen_by" text
);
--> statement-breakpoint
CREATE TABLE "pos_mapping_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"pos_system" text,
	"mapping" jsonb NOT NULL,
	"payment_method_mapping" jsonb,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"result_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid,
	"expected_quantity" numeric(12, 4) NOT NULL,
	"actual_quantity" numeric(12, 4) NOT NULL,
	"unit" text NOT NULL,
	"unit_cost" integer,
	"total_cost" integer,
	"yield_percent" integer DEFAULT 100,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"planned_quantity" integer NOT NULL,
	"unit" text DEFAULT 'PORTION' NOT NULL,
	"planned_date" timestamp NOT NULL,
	"status" "production_order_status" DEFAULT 'PLANNED' NOT NULL,
	"notes" text,
	"station" text,
	"shift" "shift_type",
	"responsible_user_id" text,
	"deadline_time" time,
	"completed_by" text,
	"created_by" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"order_id" uuid,
	"recipe_id" uuid NOT NULL,
	"workflow_instance_id" uuid,
	"produced_quantity" integer NOT NULL,
	"unit" text DEFAULT 'PORTION' NOT NULL,
	"expires_at" timestamp,
	"ingredient_cost" integer DEFAULT 0,
	"hold_alert_notified_at" timestamp,
	"discarded_at" timestamp,
	"discarded_quantity" numeric(12, 4),
	"discarded_by" text,
	"notes" text,
	"recorded_by" text NOT NULL,
	"production_date" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "propina_asignaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"propina_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"hours_worked" numeric DEFAULT '0' NOT NULL,
	"points" numeric DEFAULT '1.0' NOT NULL,
	"assigned_amount_cents" integer NOT NULL,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "propinas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"shift" "sales_cut_shift" NOT NULL,
	"total_pool_cents" integer NOT NULL,
	"distributed_cents" integer NOT NULL,
	"status" "propina_status" DEFAULT 'CALCULATED' NOT NULL,
	"registered_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "psychosocial_surveys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"entorno_organizacional" integer DEFAULT 0 NOT NULL,
	"cargas_trabajo" integer DEFAULT 0 NOT NULL,
	"liderazgo" integer DEFAULT 0 NOT NULL,
	"comunicacion" integer DEFAULT 0 NOT NULL,
	"desarrollo_profesional" integer DEFAULT 0 NOT NULL,
	"clima_laboral" integer DEFAULT 0 NOT NULL,
	"overall_score" integer DEFAULT 0 NOT NULL,
	"risk_level" "psychosocial_risk_level" DEFAULT 'MINIMO' NOT NULL,
	"responses" jsonb DEFAULT '[]'::jsonb,
	"survey_version" text DEFAULT 'v1',
	"completed_at" timestamp,
	"is_complete" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"ordered_quantity" integer NOT NULL,
	"received_quantity" integer DEFAULT 0,
	"unit_cost" integer NOT NULL,
	"line_total" integer,
	"tax_rate" integer DEFAULT 16 NOT NULL,
	"tax_amount" integer DEFAULT 0 NOT NULL,
	"ieps_rate" integer DEFAULT 0 NOT NULL,
	"ieps_amount" integer DEFAULT 0 NOT NULL,
	"status" "purchase_order_item_status" DEFAULT 'PENDING' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"po_number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" "purchase_order_status" DEFAULT 'DRAFT' NOT NULL,
	"requisition_id" uuid,
	"requested_by" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp,
	"rejection_reason" text,
	"date_ordered" timestamp,
	"date_required" timestamp,
	"expected_delivery_date" timestamp,
	"subtotal" integer,
	"tax_amount" integer,
	"ieps_amount" integer DEFAULT 0 NOT NULL,
	"total_amount" integer,
	"currency" text DEFAULT 'MXN',
	"notes" text,
	"terms_conditions" text,
	"purchase_type" "purchase_type" DEFAULT 'PROGRAMADA',
	"cost_center_id" uuid,
	"folio_year" integer,
	"folio_sequence" integer,
	"sent_at" timestamp,
	"received_at" timestamp,
	"cancelled_at" timestamp,
	"cancellation_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_po_number_unique" UNIQUE("po_number")
);
--> statement-breakpoint
CREATE TABLE "receiving_report_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receiving_report_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"ordered_quantity" integer,
	"received_quantity" integer NOT NULL,
	"unit_cost" integer,
	"line_total" integer,
	"discrepancy_type" "discrepancy_type" DEFAULT 'NONE' NOT NULL,
	"discrepancy_qty" integer DEFAULT 0,
	"discrepancy_notes" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receiving_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier_id" uuid,
	"purchase_order_id" uuid,
	"received_by" text NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"notes" text,
	"discrepancy_notes" text,
	"invoice_number" text,
	"signature_url" text,
	"photo_urls" jsonb,
	"idempotency_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" numeric(10, 4) NOT NULL,
	"unit" text NOT NULL,
	"is_sub_recipe" boolean DEFAULT false NOT NULL,
	"yield_percent" integer DEFAULT 100,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"base_yield" numeric(10, 2) NOT NULL,
	"unit" text NOT NULL,
	"hold_time_minutes" integer,
	"calculated_cost" integer NOT NULL,
	"price_selling" integer NOT NULL,
	"food_cost_percentage" numeric(5, 2) NOT NULL,
	"items_snapshot" jsonb NOT NULL,
	"change_reason" text,
	"changed_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"base_yield" numeric(10, 2) DEFAULT '1.00' NOT NULL,
	"unit" text DEFAULT 'PORTION' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"hold_time_minutes" integer,
	"calculated_cost" integer DEFAULT 0 NOT NULL,
	"price_selling" integer DEFAULT 0 NOT NULL,
	"food_cost_percentage" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "remediation_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"service_config_id" uuid,
	"branch_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"action_type" text NOT NULL,
	"service_type" text NOT NULL,
	"workflow_template_id" text,
	"status" "remediation_action_status" DEFAULT 'PENDING',
	"confirmed_by" text,
	"confirmed_at" timestamp,
	"scheduled_date" timestamp,
	"schedule_id" uuid,
	"workflow_instance_id" uuid,
	"completed_at" timestamp,
	"result" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_execution_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid,
	"company_id" uuid NOT NULL,
	"report_type" text NOT NULL,
	"data_source" text NOT NULL,
	"executed_by" text NOT NULL,
	"executed_at" timestamp DEFAULT now() NOT NULL,
	"filters" jsonb,
	"fields" jsonb,
	"status" text NOT NULL,
	"row_count" integer,
	"file_size" integer,
	"file_url" text,
	"file_key" text,
	"duration_ms" integer,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"report_type" text NOT NULL,
	"data_source" text NOT NULL,
	"fields" jsonb NOT NULL,
	"filters" jsonb,
	"group_by" jsonb,
	"sort_by" jsonb,
	"schedule" jsonb,
	"next_run_at" timestamp,
	"last_run_at" timestamp,
	"last_run_status" text,
	"delivery_method" text,
	"delivery_emails" text[],
	"created_by" text NOT NULL,
	"is_public" boolean DEFAULT false,
	"shared_with" text[],
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requisition_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requisition_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"requested_quantity" integer NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requisitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"requisition_number" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"requested_by" text NOT NULL,
	"approved_by" text,
	"notes" text,
	"date_required" timestamp,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "requisitions_requisition_number_unique" UNIQUE("requisition_number")
);
--> statement-breakpoint
CREATE TABLE "salary_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"contract_id" uuid,
	"previous_salary" integer,
	"new_salary" integer NOT NULL,
	"percentage_change" integer,
	"change_type" text NOT NULL,
	"reason" text,
	"effective_date" timestamp NOT NULL,
	"approved_by" text NOT NULL,
	"approved_at" timestamp DEFAULT now() NOT NULL,
	"document_id" uuid,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_cut_cashiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_cut_id" uuid NOT NULL,
	"cashier_name" text NOT NULL,
	"cashier_user_id" text,
	"declared_cash_cents" integer NOT NULL,
	"expected_cash_cents" integer,
	"variance_cents" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"quantity_sold" numeric(10, 2) NOT NULL,
	"sale_date" timestamp DEFAULT now() NOT NULL,
	"total_revenue" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"search_criteria" jsonb NOT NULL,
	"entity_type" text DEFAULT 'EMPLOYEE' NOT NULL,
	"is_shared" boolean DEFAULT false,
	"shared_with" text[],
	"usage_count" integer DEFAULT 0,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"template_id" text NOT NULL,
	"cron_expression" text NOT NULL,
	"target_roles" text[] NOT NULL,
	"enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shift_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"approval_type" "shift_approval_type" NOT NULL,
	"requested_by" text NOT NULL,
	"requested_for" text NOT NULL,
	"shift_session_id" uuid,
	"planned_shift_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"reason" text,
	"start_time" timestamp,
	"end_time" timestamp,
	"duration_minutes" integer,
	"overtime_minutes" integer,
	"extra_data" jsonb,
	"status" "shift_approval_status" DEFAULT 'PENDING' NOT NULL,
	"approved_by" text,
	"approved_at" timestamp,
	"rejection_reason" text,
	"notified_at" timestamp,
	"reminder_sent" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"day_of_week" integer,
	"specific_date" text,
	"shift_name" text,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shift_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"requested_shift_id" uuid NOT NULL,
	"target_shift_id" uuid,
	"counterparty_id" text NOT NULL,
	"counterparty_shift_id" uuid,
	"reason" text NOT NULL,
	"notes" text,
	"status" "shift_change_request_status" DEFAULT 'PENDING' NOT NULL,
	"approved_by" text,
	"approved_at" timestamp,
	"rejected_by" text,
	"rejected_at" timestamp,
	"rejection_reason" text,
	"counterparty_accepted" boolean,
	"counterparty_response_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"planned_shift_id" uuid,
	"user_id" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"status" text DEFAULT 'PENDING',
	"scheduled_start_time" text,
	"scheduled_end_time" text,
	"check_in_time" timestamp,
	"check_out_time" timestamp,
	"total_break_minutes" integer DEFAULT 0,
	"total_work_minutes" integer DEFAULT 0,
	"overtime_minutes" integer DEFAULT 0,
	"check_in_geolocation" jsonb,
	"check_out_geolocation" jsonb,
	"compliance_flags" jsonb,
	"late_minutes" integer DEFAULT 0,
	"early_departure_minutes" integer DEFAULT 0,
	"requires_approval" boolean DEFAULT false,
	"approved_by" text,
	"approved_at" timestamp,
	"rejection_reason" text,
	"break_reminder_sent" boolean DEFAULT false,
	"notes" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "shift_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"role" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"days_of_week" integer[],
	"valid_from" text NOT NULL,
	"valid_until" text,
	"created_by" text NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "stock_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"workflow_instance_id" uuid,
	"counted_quantity" numeric(12, 4) NOT NULL,
	"system_quantity" numeric(12, 4) NOT NULL,
	"evidence_url" text,
	"counted_by" text,
	"count_date" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "storage_location_type" DEFAULT 'DRY_STORAGE' NOT NULL,
	"org_type" "storage_location_org_type" DEFAULT 'CENTRAL',
	"active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "supplier_bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"clabe" text NOT NULL,
	"clabe_last4" text NOT NULL,
	"clabe_fingerprint" text NOT NULL,
	"bank_code" text NOT NULL,
	"bank_name" text NOT NULL,
	"account_holder_name" text NOT NULL,
	"status" "supplier_bank_account_status" DEFAULT 'PENDING_VERIFICATION' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"verified_at" timestamp,
	"verified_by" text,
	"verification_method" text,
	"verification_evidence_url" text,
	"rejected_at" timestamp,
	"rejected_by" text,
	"rejection_reason" text,
	"registered_by" text NOT NULL,
	"replaces_account_id" uuid,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"invoice_id" uuid,
	"branch_id" uuid NOT NULL,
	"claim_number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" "supplier_claim_status" DEFAULT 'OPEN' NOT NULL,
	"type" "supplier_claim_type" NOT NULL,
	"description" text,
	"total_amount" integer,
	"resolution" text,
	"resolved_by" text,
	"resolved_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_claims_claim_number_unique" UNIQUE("claim_number")
);
--> statement-breakpoint
CREATE TABLE "supplier_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"supplier_sku" text,
	"price" integer,
	"presentation" text,
	"lead_time_days" integer DEFAULT 3,
	"preference_rank" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"address" text,
	"tax_id" text,
	"active" boolean DEFAULT true,
	"match_tolerance_percent" integer DEFAULT 5,
	"payment_method" "supplier_payment_method",
	"payment_terms_days" integer DEFAULT 0 NOT NULL,
	"payee_id" uuid,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "temperature_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"equipment_id" uuid,
	"workflow_instance_id" uuid,
	"reading_value" integer NOT NULL,
	"unit" text DEFAULT 'C',
	"location" text,
	"is_compliant" boolean DEFAULT true,
	"min_threshold" integer,
	"max_threshold" integer,
	"captured_by" text,
	"capture_method" text DEFAULT 'MANUAL',
	"photo_url" text,
	"notes" text,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tenant_operating_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"purchasing_structure" "purchasing_structure" DEFAULT 'CENTRALIZADA' NOT NULL,
	"food_production" "food_production" DEFAULT 'IN_SITU' NOT NULL,
	"treasury_model" "treasury_model" DEFAULT 'CUENTA_UNICA' NOT NULL,
	"supplier_payment" "supplier_payment_model" DEFAULT 'CENTRALIZADO' NOT NULL,
	"manager_autonomy" "manager_autonomy" DEFAULT 'MEDIA' NOT NULL,
	"payroll_dispersion" "payroll_dispersion" DEFAULT 'CONSOLIDADA' NOT NULL,
	"tenant_type" "tenant_type" DEFAULT 'GRUPO_PROPIO' NOT NULL,
	"manager_auth_limit_cents" integer DEFAULT 100000,
	"double_approval_threshold_cents" integer DEFAULT 1000000,
	"petty_cash_limit_cents" integer DEFAULT 500000,
	"emergency_purchase_cap_cents" integer,
	"food_cost_target_percent" numeric(5, 2) DEFAULT '30.00',
	"food_cost_warn_percent" numeric(5, 2) DEFAULT '35.00',
	"labor_cost_target_percent" numeric(5, 2) DEFAULT '28.00',
	"labor_cost_warn_percent" numeric(5, 2) DEFAULT '32.00',
	"healthy_margin_target_percent" numeric(5, 2) DEFAULT '45.00',
	"healthy_margin_warn_percent" numeric(5, 2) DEFAULT '35.00',
	"merma_variance_threshold_pct" numeric(5, 2) DEFAULT '5.00',
	"payroll_practice_mode" text,
	"aguinaldo_base" text,
	"show_aguinaldo_provision" boolean DEFAULT true NOT NULL,
	"vat_rate_percent" numeric(5, 2) DEFAULT '16.00',
	"labor_burden_factor_percent" numeric(5, 2),
	"payroll_state_tax_percent" numeric(5, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tpv_shift_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"sales_cut_id" uuid NOT NULL,
	"terminal_id" uuid NOT NULL,
	"batch_number" text NOT NULL,
	"card_amount_cents" integer NOT NULL,
	"tip_amount_cents" integer DEFAULT 0 NOT NULL,
	"voucher_photo_url" text,
	"notes" text,
	"captured_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_conversions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"from_unit" text NOT NULL,
	"to_unit" text NOT NULL,
	"factor" numeric(12, 6) NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "vacation_accruals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"month" integer,
	"days_accrued" integer NOT NULL,
	"days_taken" integer DEFAULT 0,
	"days_balance" integer NOT NULL,
	"years_of_service" integer NOT NULL,
	"applicable_law_days" integer NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"is_processed" boolean DEFAULT false,
	"processed_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vacation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"total_days" integer NOT NULL,
	"status" "vacation_status" DEFAULT 'PENDING' NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"approved_by" text,
	"approved_at" timestamp,
	"rejected_by" text,
	"rejected_at" timestamp,
	"cancelled_at" timestamp,
	"reason" text,
	"manager_comments" text,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_conversation_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_phone" text NOT NULL,
	"user_id" text,
	"workflow_instance_id" uuid,
	"current_step_id" uuid,
	"step_index" integer,
	"status" "whatsapp_conversation_status" DEFAULT 'ACTIVE' NOT NULL,
	"last_message_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"context" jsonb DEFAULT '{}',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"from" text NOT NULL,
	"to" text NOT NULL,
	"message_type" text NOT NULL,
	"content" text,
	"media_url" text,
	"command" text,
	"processed" boolean DEFAULT false,
	"processing_error" text,
	"status" text DEFAULT 'pending',
	"updated_at" timestamp DEFAULT now(),
	"external_message_id" text,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"phone_number" text,
	"status" "whatsapp_session_status" DEFAULT 'DISCONNECTED' NOT NULL,
	"qr_code" text,
	"qr_code_expires_at" timestamp,
	"connected_at" timestamp,
	"last_activity_at" timestamp,
	"disconnected_at" timestamp,
	"webhook_url" text,
	"is_active" boolean DEFAULT true,
	"last_error" text,
	"error_count" integer DEFAULT 0,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_sessions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"schedule_id" uuid,
	"assigned_to" text NOT NULL,
	"assigned_by" text,
	"assignment_type" "assignment_type" NOT NULL,
	"status" "assignment_status" DEFAULT 'PENDING',
	"notified_at" timestamp,
	"started_at" timestamp,
	"completed_at" timestamp,
	"due_date" timestamp,
	"is_overdue" boolean DEFAULT false,
	"priority" "priority" DEFAULT 'MEDIUM',
	"notes" text,
	"reminders_sent" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workflow_completion_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"intent" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"completed_extractors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp,
	"processed_at" timestamp,
	CONSTRAINT "workflow_completion_outbox_instance_id_unique" UNIQUE("instance_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_instance_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"step_id" text NOT NULL,
	"status" text DEFAULT 'PENDING',
	"value" jsonb,
	"ai_analysis" jsonb,
	"evidence_url" text,
	"comment" text,
	"completed_at" timestamp,
	"completed_by" text,
	"step_order" integer,
	"title" text,
	"type" text,
	"definition" jsonb
);
--> statement-breakpoint
CREATE TABLE "workflow_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_template_id" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"assignee_id" text,
	"session_id" uuid,
	"schedule_id" uuid,
	"assignment_id" uuid,
	"status" text DEFAULT 'PENDING',
	"started_at" timestamp,
	"completed_at" timestamp,
	"due_date" timestamp,
	"priority" "priority" DEFAULT 'MEDIUM',
	"current_step_id" text,
	"data" jsonb DEFAULT '{}'::jsonb,
	"score" integer,
	"review_status" text,
	"review_comment" text,
	"reviewed_at" timestamp,
	"reviewed_by" text,
	"completion_effects_status" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workflow_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"assignment_type" "assignment_type" DEFAULT 'AUTO' NOT NULL,
	"assigned_role" "role",
	"assigned_user_id" text,
	"assigned_roles" jsonb DEFAULT '[]'::jsonb,
	"assigned_shifts" jsonb DEFAULT '[]'::jsonb,
	"frequency" "schedule_frequency" NOT NULL,
	"day_of_week" integer,
	"days_of_week" jsonb DEFAULT '[]'::jsonb,
	"day_of_month" integer,
	"time_of_day" text,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp,
	"is_active" boolean DEFAULT true,
	"title" text NOT NULL,
	"description" text,
	"priority" "priority" DEFAULT 'MEDIUM',
	"last_executed_at" timestamp,
	"next_execution_at" timestamp,
	"execution_count" integer DEFAULT 0,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workflow_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid,
	"branch_id" uuid,
	"name" text,
	"description" text,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category" text DEFAULT 'GENERAL',
	"scope" text DEFAULT 'branch' NOT NULL,
	"compliance_type" text,
	"regulation_section" text,
	"required_frequency" text,
	"is_critical" boolean DEFAULT false,
	"active" boolean DEFAULT true,
	"json_schema" jsonb,
	"original_template_id" text,
	"title" text,
	"is_custom" boolean DEFAULT false,
	"version" integer DEFAULT 1,
	"duracion_estimada" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"ai_config" jsonb,
	"compliance_config" jsonb,
	"completion_actions" jsonb DEFAULT '[]'::jsonb,
	"cumplimiento_normativo" jsonb DEFAULT '[]'::jsonb,
	"reminder_intervals" jsonb DEFAULT '[1440, 60, 30]'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "magic_links" (
	"token" text PRIMARY KEY NOT NULL,
	"session_id" uuid,
	"instance_id" uuid NOT NULL,
	"workflow_template_id" text NOT NULL,
	"status" text DEFAULT 'PENDING',
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" boolean,
	"image" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"role" "role" DEFAULT 'EMPLEADO',
	"company_id" uuid,
	"branch_id" uuid,
	"phone" text,
	"pin_code" text,
	"status" text DEFAULT 'ACTIVE',
	"active" boolean DEFAULT true,
	"whatsapp_phone" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"name" text NOT NULL,
	"code" text,
	"address" text,
	"timezone" text DEFAULT 'America/Mexico_City',
	"operating_hours" jsonb,
	"location" jsonb,
	"manager_id" text,
	"invite_token" uuid DEFAULT gen_random_uuid(),
	"manager_invite_token" uuid DEFAULT gen_random_uuid(),
	"active" boolean DEFAULT true,
	"costing_method" text,
	"imss_registro_patronal" text,
	"ownership_type" "branch_ownership" DEFAULT 'OWNED' NOT NULL,
	"franchisee_user_id" text,
	"franchise_agreement_ref" text,
	"franchise_royalty_percent" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"tax_id" text,
	"plan" text DEFAULT 'FREE',
	"billing_status" text DEFAULT 'ACTIVE',
	"stripe_customer_id" text,
	"blind_stock_count" boolean DEFAULT false,
	"courtesy_waste_monthly_cap_cents" integer,
	"costing_method" text DEFAULT 'LAST_PRICE',
	"tax_rate" integer DEFAULT 16,
	"imss_prima_riesgo_trabajo" numeric(5, 4),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"date" text NOT NULL,
	"description" text,
	"is_mandatory" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "branch_compliance_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"service_type" "compliance_service_type" NOT NULL,
	"service_name" text NOT NULL,
	"regulation_reference" text,
	"is_mandatory" boolean DEFAULT true,
	"frequency" "service_frequency" NOT NULL,
	"custom_days" integer,
	"provider_id" uuid,
	"provider_name" text,
	"provider_contact" text,
	"next_service_date" timestamp,
	"last_service_date" timestamp,
	"service_areas" jsonb,
	"special_instructions" text,
	"workflow_template_id" text,
	"is_active" boolean DEFAULT true,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branch_equipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"catalog_id" uuid,
	"name" text NOT NULL,
	"equipment_code" text NOT NULL,
	"type" "equipment_type" NOT NULL,
	"brand" text,
	"model" text,
	"serial_number" text,
	"asset_tag" text,
	"location" text,
	"area" text,
	"specifications" jsonb,
	"purchase_date" timestamp,
	"purchase_price" integer,
	"vendor" text,
	"vendor_contact" text,
	"invoice_number" text,
	"status" "equipment_status" DEFAULT 'ACTIVE' NOT NULL,
	"status_reason" text,
	"last_maintenance_date" timestamp,
	"next_maintenance_date" timestamp,
	"maintenance_frequency" text DEFAULT 'MONTHLY',
	"is_critical" boolean DEFAULT false,
	"notes" text,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_service_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_config_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"service_type" "compliance_service_type" NOT NULL,
	"service_name" text NOT NULL,
	"scheduled_date" timestamp NOT NULL,
	"completed_date" timestamp,
	"provider_id" uuid,
	"provider_name" text,
	"technician_name" text,
	"technician_license" text,
	"description" text,
	"work_performed" text,
	"areas_serviced" jsonb,
	"result" text DEFAULT 'PASSED',
	"findings" text,
	"recommendations" text,
	"follow_up_required" boolean DEFAULT false,
	"follow_up_date" timestamp,
	"cost" integer,
	"invoice_number" text,
	"certificate_url" text,
	"report_url" text,
	"photos" jsonb,
	"documents" jsonb,
	"signature_url" text,
	"compliance_status" text DEFAULT 'COMPLIANT',
	"next_due_date" timestamp,
	"workflow_instance_id" uuid,
	"approved_by" text,
	"approved_at" timestamp,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"equipment_id" uuid,
	"service_config_id" uuid,
	"alert_type" text NOT NULL,
	"severity" text DEFAULT 'MEDIUM' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"due_date" timestamp,
	"status" text DEFAULT 'ACTIVE',
	"acknowledged_by" text,
	"acknowledged_at" timestamp,
	"resolved_by" text,
	"resolved_at" timestamp,
	"resolution_notes" text,
	"notification_sent" boolean DEFAULT false,
	"notification_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "equipment_type" NOT NULL,
	"brand" text,
	"model" text,
	"serial_number_format" text,
	"specifications" jsonb,
	"default_maintenance_frequency" text,
	"default_maintenance_tasks" jsonb,
	"manual_url" text,
	"technical_specs_url" text,
	"is_active" boolean DEFAULT true,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_maintenance_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"equipment_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"maintenance_type" "maintenance_type" NOT NULL,
	"status" "maintenance_status" DEFAULT 'SCHEDULED' NOT NULL,
	"scheduled_date" timestamp NOT NULL,
	"completed_date" timestamp,
	"duration_minutes" integer,
	"description" text NOT NULL,
	"work_performed" text,
	"tasks_completed" jsonb,
	"parts_used" jsonb,
	"parts_cost" integer,
	"labor_cost" integer,
	"total_cost" integer,
	"provider_type" "service_provider_type" DEFAULT 'INTERNAL' NOT NULL,
	"provider_name" text,
	"provider_contact" text,
	"technician_name" text,
	"technician_license" text,
	"findings" text,
	"recommendations" text,
	"next_maintenance_date" timestamp,
	"before_photos" jsonb,
	"after_photos" jsonb,
	"documents" jsonb,
	"signature_url" text,
	"workflow_instance_id" uuid,
	"approved_by" text,
	"approved_at" timestamp,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_maintenance_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"equipment_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"maintenance_type" "maintenance_type" NOT NULL,
	"frequency" "service_frequency" NOT NULL,
	"custom_days" integer,
	"tasks" jsonb NOT NULL,
	"estimated_duration_minutes" integer,
	"preferred_day_of_week" integer,
	"preferred_time_of_day" text,
	"next_scheduled_date" timestamp,
	"last_executed_date" timestamp,
	"provider_type" "service_provider_type" DEFAULT 'INTERNAL' NOT NULL,
	"default_provider_id" text,
	"workflow_template_id" text,
	"is_active" boolean DEFAULT true,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_warranties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"equipment_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"warranty_number" text,
	"warranty_type" text DEFAULT 'MANUFACTURER',
	"provider" text NOT NULL,
	"provider_contact" text,
	"provider_phone" text,
	"provider_email" text,
	"coverage_description" text,
	"warranty_terms" text,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"status" "warranty_status" DEFAULT 'ACTIVE' NOT NULL,
	"claims_made" integer DEFAULT 0,
	"max_claims" integer,
	"warranty_document_url" text,
	"purchase_receipt_url" text,
	"alert_days_before" integer DEFAULT 30,
	"alert_sent" boolean DEFAULT false,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"business_name" text,
	"tax_id" text,
	"provider_type" "service_provider_type" DEFAULT 'EXTERNAL' NOT NULL,
	"services" jsonb NOT NULL,
	"specializations" jsonb,
	"contact_name" text,
	"phone" text,
	"email" text,
	"address" text,
	"certifications" jsonb,
	"is_certified" boolean DEFAULT false,
	"rating" integer,
	"notes" text,
	"is_active" boolean DEFAULT true,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "civil_protection_drills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"drill_type" "civil_drill_type" NOT NULL,
	"result" "civil_drill_result",
	"drill_date" timestamp NOT NULL,
	"participants_count" integer,
	"evacuation_time_sec" integer,
	"activated_alarm" boolean DEFAULT true,
	"observations" text,
	"evidence_urls" jsonb DEFAULT '[]'::jsonb,
	"report_url" text,
	"coordinator_name" text,
	"coordinator_phone" text,
	"workflow_instance_id" uuid,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exit_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"exit_location" text NOT NULL,
	"is_clear" boolean NOT NULL,
	"signage_ok" boolean NOT NULL,
	"emergency_light_ok" boolean NOT NULL,
	"door_opens_ok" boolean NOT NULL,
	"access_width_cm" integer,
	"photo_url" text,
	"photos" jsonb DEFAULT '[]'::jsonb,
	"notes" text,
	"issues_detected" text,
	"inspected_at" timestamp NOT NULL,
	"inspected_by" text NOT NULL,
	"inspection_round" text,
	"workflow_instance_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extinguisher_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"extinguisher_id" text NOT NULL,
	"location" text NOT NULL,
	"extinguisher_type" text,
	"capacity_kg" integer,
	"inspection_date" timestamp NOT NULL,
	"pressure_ok" boolean,
	"seal_ok" boolean,
	"hose_ok" boolean,
	"label_ok" boolean,
	"general_status" "civil_extinguisher_status",
	"expiration_date" timestamp,
	"last_recharge_date" timestamp,
	"next_inspection_date" timestamp,
	"ocr_raw_data" jsonb,
	"ocr_processed_at" timestamp,
	"evidence_url" text,
	"inspector_name" text,
	"inspector_notes" text,
	"workflow_instance_id" uuid,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corporate_twins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"health_score" integer DEFAULT 100 NOT NULL,
	"drift_score" integer DEFAULT 0 NOT NULL,
	"margin_leakage_score" integer DEFAULT 0 NOT NULL,
	"network_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"projected_cash_flow_cents" bigint DEFAULT 0 NOT NULL,
	"upcoming_obligations_cents" bigint DEFAULT 0 NOT NULL,
	"liquidity_risk" integer DEFAULT 0 NOT NULL,
	"operational_risk" integer DEFAULT 0 NOT NULL,
	"compliance_risk" integer DEFAULT 0 NOT NULL,
	"people_risk" integer DEFAULT 0 NOT NULL,
	"expansion_readiness" integer DEFAULT 0 NOT NULL,
	"execution_capacity" integer DEFAULT 0 NOT NULL,
	"brand_consistency" integer DEFAULT 0 NOT NULL,
	"knowledge_index" integer DEFAULT 0 NOT NULL,
	"playbook_count" integer DEFAULT 0 NOT NULL,
	"best_practices_count" integer DEFAULT 0 NOT NULL,
	"executive_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_twins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"current_state" "operational_twin_state" DEFAULT 'CREATE' NOT NULL,
	"health_score" integer DEFAULT 100 NOT NULL,
	"drift_score" integer DEFAULT 0 NOT NULL,
	"confidence_score" integer DEFAULT 100 NOT NULL,
	"margin_leakage_score" integer DEFAULT 0 NOT NULL,
	"execution_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"inventory_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recipe_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"labor_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quality_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"maintenance_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"compliance_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"finance_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"customer_experience_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arco_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"request_type" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"fulfilled_at" timestamp,
	"fulfilled_by" text,
	"response_document_id" uuid
);
--> statement-breakpoint
CREATE TABLE "data_access_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"action" text NOT NULL,
	"resource" text NOT NULL,
	"resource_id" text,
	"access_decision" jsonb,
	"redacted_fields" text,
	"ip_address" text,
	"user_agent" text,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"retention_until" timestamp
);
--> statement-breakpoint
CREATE TABLE "data_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"privacy_notice_version" text NOT NULL,
	"consent_type" text NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"ip_address" text,
	"user_agent" text,
	"proof_document_id" uuid
);
--> statement-breakpoint
CREATE TABLE "payment_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'MXN' NOT NULL,
	"payment_ref" text NOT NULL,
	"payment_ref_type" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"requested_by" text NOT NULL,
	"approved_by" text,
	"second_approved_by" text,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"approved_at" timestamp,
	"executed_at" timestamp,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "policy_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"domain" text NOT NULL,
	"rule" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"granted_by" text NOT NULL,
	"reason" text NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"revoked_by" text,
	"revoked_reason" text
);
--> statement-breakpoint
CREATE TABLE "privacy_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"company_id" uuid,
	"content_url" text NOT NULL,
	"published_at" timestamp DEFAULT now() NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "privacy_notices_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "tenant_keys" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"encrypted_dek" text NOT NULL,
	"dek_version" integer DEFAULT 1 NOT NULL,
	"rotated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"monthly_price_cents" integer DEFAULT 0 NOT NULL,
	"max_branches" integer NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playbook_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'PUBLISHED' NOT NULL,
	"published_by" text,
	"published_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playbook_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" text,
	"description" text,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"change_note" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "morning_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"brief_date" text NOT NULL,
	"brief" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"twin_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branch_terminals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"serial_number" text NOT NULL,
	"alias" text NOT NULL,
	"acquirer" "terminal_acquirer" NOT NULL,
	"affiliation_number" text,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_flow_assumptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"opening_balance_cents" integer NOT NULL,
	"as_of_date" date NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cfdi_nomina_timbrados" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"empleado_rfc" text NOT NULL,
	"empleado_nombre" text NOT NULL,
	"periodo" text NOT NULL,
	"uuid" text,
	"status" "cfdi_timbrado_status" NOT NULL,
	"cadena_original" text,
	"sello_digital" text,
	"total_percepciones_cents" integer NOT NULL,
	"total_deducciones_cents" integer NOT NULL,
	"raw_response" jsonb,
	"timbrado_por" text,
	"fecha_timbrado" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gateway_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"acquirer" "terminal_acquirer" NOT NULL,
	"external_id" text,
	"authorization_code" text,
	"transaction_date" timestamp NOT NULL,
	"card_last_4" text,
	"card_brand" text,
	"card_type" text,
	"gross_amount_cents" integer NOT NULL,
	"fee_amount_cents" integer NOT NULL,
	"fee_vat_cents" integer DEFAULT 0 NOT NULL,
	"net_amount_cents" integer NOT NULL,
	"destination_bank_account_id" uuid,
	"settlement_date" date,
	"batch_number" text,
	"status" text DEFAULT 'SETTLED' NOT NULL,
	"raw_report_file_url" text,
	"imported_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_matrix_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"doc_type" "approval_doc_type" NOT NULL,
	"amount_min" integer NOT NULL,
	"amount_max" integer,
	"required_role" text NOT NULL,
	"min_quotes" integer DEFAULT 1 NOT NULL,
	"sequence" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_type" "approval_doc_type" NOT NULL,
	"doc_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"required_role" text NOT NULL,
	"min_quotes" integer DEFAULT 1 NOT NULL,
	"status" "approval_request_status" DEFAULT 'PENDING' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branch_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"cost_center_id" uuid NOT NULL,
	"month" text NOT NULL,
	"amount" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_centers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"accounting_line" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cost_centers_company_id_unique" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "folio_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"doc_type" "approval_doc_type" NOT NULL,
	"year" integer NOT NULL,
	"last_sequence" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_delegation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"action" "purchase_delegation_action" NOT NULL,
	"scope" "purchase_delegation_scope" NOT NULL,
	"branch_id" uuid,
	"category" text,
	"required_role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_order_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_order_id" uuid NOT NULL,
	"type" "evidence_type" NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_order_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_order_id" uuid NOT NULL,
	"url" text NOT NULL,
	"supplier_name" text,
	"amount" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"folio" text NOT NULL,
	"type" "service_order_type" NOT NULL,
	"urgency" "service_urgency" DEFAULT 'NORMAL' NOT NULL,
	"status" "service_order_status" DEFAULT 'DRAFT' NOT NULL,
	"equipment_id" uuid,
	"compliance_service_id" uuid,
	"scope" text,
	"justification" text,
	"technical_report" text,
	"supplier_id" uuid,
	"service_provider_id" uuid,
	"amount" integer,
	"scheduled_date" timestamp,
	"completed_at" timestamp,
	"cost_center_id" uuid,
	"conformity_signed_by" text,
	"conformity_signed_at" timestamp,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "service_orders_folio_unique" UNIQUE("folio")
);
--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_bank_account_id" uuid,
	"value_date" date NOT NULL,
	"description" text NOT NULL,
	"reference" text,
	"amount_cents" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"match_status" "bank_transaction_match_status" DEFAULT 'UNMATCHED' NOT NULL,
	"matched_payment_run_item_id" uuid,
	"matched_gateway_transaction_id" uuid,
	"matched_at" timestamp,
	"matched_by" text,
	"match_notes" text,
	"imported_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"label" text NOT NULL,
	"account_number" text NOT NULL,
	"account_last_four" text NOT NULL,
	"account_fingerprint" text NOT NULL,
	"bank_code" text NOT NULL,
	"bank_name" text NOT NULL,
	"clabe" text,
	"clabe_last_four" text,
	"currency" text DEFAULT 'MXN' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"purpose" "account_purpose" DEFAULT 'MIXTO' NOT NULL,
	"opening_balance_cents" integer,
	"opening_as_of_date" date,
	"registered_by" text NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "company_bank_accounts_company_id_unique" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "payee_bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"payee_id" uuid NOT NULL,
	"clabe" text NOT NULL,
	"clabe_last4" text NOT NULL,
	"clabe_fingerprint" text NOT NULL,
	"bank_code" text NOT NULL,
	"bank_name" text NOT NULL,
	"account_holder_name" text NOT NULL,
	"status" "payee_bank_account_status" DEFAULT 'PENDING_VERIFICATION' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"verified_at" timestamp,
	"verified_by" text,
	"verification_method" text,
	"verification_evidence_url" text,
	"rejected_at" timestamp,
	"rejected_by" text,
	"rejection_reason" text,
	"registered_by" text NOT NULL,
	"replaces_account_id" uuid,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_run_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_run_id" uuid NOT NULL,
	"item_type" "payment_run_item_type" NOT NULL,
	"reference_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"notes" text,
	"settlement_status" "payment_run_item_settlement" DEFAULT 'PENDING' NOT NULL,
	"settled_at" timestamp,
	"settled_by" text,
	"settlement_reference" text,
	"settlement_notes" text,
	"failure_reason" text,
	"bank_account_id" uuid,
	"payee_bank_account_id" uuid,
	"clabe_last4_snapshot" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"title" text NOT NULL,
	"run_date" timestamp NOT NULL,
	"status" "payment_run_status" DEFAULT 'DRAFT' NOT NULL,
	"total_amount_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'MXN' NOT NULL,
	"source_account" text,
	"source_bank_account_id" uuid,
	"prepared_by" text,
	"approved_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"supplier_id" uuid NOT NULL,
	"contract_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp,
	"auto_renew" boolean DEFAULT false NOT NULL,
	"base_amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'MXN' NOT NULL,
	"variance_tolerance_percent" integer DEFAULT 10 NOT NULL,
	"variance_tolerance_below_percent" integer,
	"payment_frequency" text DEFAULT 'MONTHLY' NOT NULL,
	"payment_method" text DEFAULT 'TRANSFER' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_payables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"branch_id" uuid,
	"label" text NOT NULL,
	"contract_type" text NOT NULL,
	"currency" text DEFAULT 'MXN' NOT NULL,
	"period_key" text NOT NULL,
	"due_date" date NOT NULL,
	"estimated_amount_cents" integer NOT NULL,
	"status" "recurring_payable_status" DEFAULT 'OPEN' NOT NULL,
	"linked_invoice_id" uuid,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"production_plan_item_id" uuid,
	"recipe_id" uuid NOT NULL,
	"batch_number" text NOT NULL,
	"quantity_produced" numeric(12, 4) NOT NULL,
	"unit_of_measure" text NOT NULL,
	"production_date" timestamp NOT NULL,
	"expiration_date" timestamp NOT NULL,
	"inventory_batch_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"planned_quantity" numeric(12, 4) NOT NULL,
	"actual_quantity" numeric(12, 4),
	"unit_of_measure" text NOT NULL,
	"status" "production_plan_item_status" DEFAULT 'PENDING' NOT NULL,
	"assigned_to" text,
	"target_time" timestamp,
	"completed_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"target_date" timestamp NOT NULL,
	"shift" text,
	"status" "production_plan_status" DEFAULT 'DRAFT' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "executive_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"decision_key" text NOT NULL,
	"resolution" text NOT NULL,
	"resolved_by" uuid,
	"resolved_by_name" text,
	"resolved_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "electronic_registry_readiness" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"status" text DEFAULT 'OFF' NOT NULL,
	"registry_system_name" text,
	"signed_agreement_url" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "labor_law_calendar_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"max_weekly_hours" integer NOT NULL,
	"max_double_overtime_hours" integer NOT NULL,
	"max_triple_overtime_hours" integer NOT NULL,
	"max_daily_sum_hours" integer NOT NULL,
	"max_extra_hours_per_day" integer NOT NULL,
	"max_extra_days_per_week" integer NOT NULL,
	"min_rest_between_shifts_hours" integer DEFAULT 12 NOT NULL,
	"aguinaldo_days_mxn" integer DEFAULT 15 NOT NULL,
	"uma_daily_mxn" numeric(8, 2),
	"minimum_wage_mxn" numeric(8, 2),
	"source_dof_url" text,
	"source_published_on" date,
	"legal_note" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"domain" "exception_domain" NOT NULL,
	"qsr_category" "qsr_risk_category" NOT NULL,
	"severity" "exception_severity" DEFAULT 'warning' NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"reason" text NOT NULL,
	"status" "exception_status" DEFAULT 'OPEN' NOT NULL,
	"owner_id" text,
	"sla_due_at" timestamp,
	"action_meta" jsonb,
	"resolution" text,
	"resolved_by" text,
	"resolved_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"closed_at" timestamp,
	"evidence_id" uuid,
	"reopened_from_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"entity_type" "evidence_entity_type" NOT NULL,
	"entity_id" text NOT NULL,
	"kind" "evidence_kind" DEFAULT 'PHOTO' NOT NULL,
	"mime_type" text,
	"url" text NOT NULL,
	"storage_key" text,
	"ai_metadata" jsonb,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "accounting_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"normal_balance" text NOT NULL,
	"parent_id" uuid,
	"postable" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_accounts_company_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "accounting_accounts_code_check" CHECK ("accounting_accounts"."code" ~ '^[A-Z0-9][A-Z0-9._-]{0,31}$'),
	CONSTRAINT "accounting_accounts_name_check" CHECK ("accounting_accounts"."name" = btrim("accounting_accounts"."name") AND length("accounting_accounts"."name") BETWEEN 1 AND 160),
	CONSTRAINT "accounting_accounts_kind_check" CHECK ("accounting_accounts"."kind" IN ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE')),
	CONSTRAINT "accounting_accounts_normal_balance_check" CHECK ("accounting_accounts"."normal_balance" IN ('DEBIT','CREDIT')),
	CONSTRAINT "accounting_accounts_dates_check" CHECK ("accounting_accounts"."valid_to" IS NULL OR "accounting_accounts"."valid_to" >= "accounting_accounts"."valid_from"),
	CONSTRAINT "accounting_accounts_parent_self_check" CHECK ("accounting_accounts"."parent_id" IS NULL OR "accounting_accounts"."parent_id" <> "accounting_accounts"."id")
);
--> statement-breakpoint
ALTER TABLE "accounting_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "accounting_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"source_version" integer DEFAULT 1 NOT NULL,
	"actor_id" text NOT NULL,
	"accounting_date" date,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"journal_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_events_source_check" CHECK (("accounting_events"."source_type" = 'OPERATING_EXPENSE' AND "accounting_events"."event_type" = 'EXPENSE_RECOGNIZED')
    OR ("accounting_events"."source_type" = 'EXPENSE_PAYMENT' AND "accounting_events"."event_type" = 'EXPENSE_PAYMENT')
    OR ("accounting_events"."source_type" = 'DAILY_SALES_CUT' AND "accounting_events"."event_type" = 'SALE_RECOGNIZED')
    OR ("accounting_events"."source_type" = 'SALES_REFUND' AND "accounting_events"."event_type" = 'SALE_REFUNDED')
    OR ("accounting_events"."source_type" = 'GATEWAY_SETTLEMENT' AND "accounting_events"."event_type" = 'SETTLEMENT_RECOGNIZED')),
	CONSTRAINT "accounting_events_version_check" CHECK ("accounting_events"."source_version" >= 1
    AND ("accounting_events"."source_type" = 'DAILY_SALES_CUT' OR "accounting_events"."source_version" = 1)),
	CONSTRAINT "accounting_events_attempts_check" CHECK ("accounting_events"."attempts" >= 0),
	CONSTRAINT "accounting_events_status_check" CHECK (("accounting_events"."status" = 'PENDING' AND "accounting_events"."journal_id" IS NULL)
    OR ("accounting_events"."status" = 'POSTED' AND "accounting_events"."journal_id" IS NOT NULL AND "accounting_events"."last_error" IS NULL)),
	CONSTRAINT "accounting_events_error_check" CHECK ("accounting_events"."last_error" IS NULL OR length("accounting_events"."last_error") BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "accounting_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "accounting_gateway_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"gateway_acquirer" "terminal_acquirer" NOT NULL,
	"sales_destination" text NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_gateway_links_destination_check" CHECK ("accounting_gateway_links"."sales_destination" IN ('CARD','PLATFORM','OTHER'))
);
--> statement-breakpoint
ALTER TABLE "accounting_gateway_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "accounting_journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"journal_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"cost_center_id" uuid,
	"debit_cents" bigint DEFAULT 0 NOT NULL,
	"credit_cents" bigint DEFAULT 0 NOT NULL,
	"memo" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_journal_lines_number_unique" UNIQUE("company_id","journal_id","line_number"),
	CONSTRAINT "accounting_journal_lines_number_check" CHECK ("accounting_journal_lines"."line_number" BETWEEN 1 AND 999),
	CONSTRAINT "accounting_journal_lines_side_check" CHECK (("accounting_journal_lines"."debit_cents" > 0) <> ("accounting_journal_lines"."credit_cents" > 0)),
	CONSTRAINT "accounting_journal_lines_range_check" CHECK ("accounting_journal_lines"."debit_cents" >= 0 AND "accounting_journal_lines"."credit_cents" >= 0
    AND "accounting_journal_lines"."debit_cents" <= 9007199254740991 AND "accounting_journal_lines"."credit_cents" <= 9007199254740991),
	CONSTRAINT "accounting_journal_lines_memo_check" CHECK ("accounting_journal_lines"."memo" IS NULL OR ("accounting_journal_lines"."memo" = btrim("accounting_journal_lines"."memo") AND length("accounting_journal_lines"."memo") BETWEEN 1 AND 200))
);
--> statement-breakpoint
ALTER TABLE "accounting_journal_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "accounting_journals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" integer,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"accounting_date" date NOT NULL,
	"business_date" date,
	"description" text NOT NULL,
	"currency" text DEFAULT 'MXN' NOT NULL,
	"branch_id" uuid,
	"source_type" text,
	"source_id" text,
	"source_version" integer,
	"event_type" text,
	"rule_id" uuid,
	"rule_version" integer,
	"reversal_of_id" uuid,
	"replacement_of_id" uuid,
	"posting_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"posted_by" text,
	"posted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_journals_company_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "accounting_journals_correction_check" CHECK (num_nonnulls("accounting_journals"."reversal_of_id", "accounting_journals"."replacement_of_id") <= 1
    AND ("accounting_journals"."replacement_of_id" IS NULL OR "accounting_journals"."replacement_of_id" <> "accounting_journals"."id")),
	CONSTRAINT "accounting_journals_reason_check" CHECK ("accounting_journals"."posting_reason" IS NULL OR
    ("accounting_journals"."posting_reason" = btrim("accounting_journals"."posting_reason") AND length("accounting_journals"."posting_reason") BETWEEN 5 AND 500)),
	CONSTRAINT "accounting_journals_status_check" CHECK ("accounting_journals"."status" IN ('DRAFT','POSTED')),
	CONSTRAINT "accounting_journals_currency_check" CHECK ("accounting_journals"."currency" = 'MXN'),
	CONSTRAINT "accounting_journals_description_check" CHECK ("accounting_journals"."description" = btrim("accounting_journals"."description") AND length("accounting_journals"."description") BETWEEN 1 AND 500),
	CONSTRAINT "accounting_journals_number_check" CHECK ("accounting_journals"."number" IS NULL OR "accounting_journals"."number" > 0),
	CONSTRAINT "accounting_journals_version_check" CHECK ("accounting_journals"."version" >= 1),
	CONSTRAINT "accounting_journals_posting_check" CHECK (
    ("accounting_journals"."status" = 'DRAFT' AND "accounting_journals"."number" IS NULL AND "accounting_journals"."posted_at" IS NULL AND "accounting_journals"."posted_by" IS NULL)
    OR ("accounting_journals"."status" = 'POSTED' AND "accounting_journals"."number" IS NOT NULL AND "accounting_journals"."posted_at" IS NOT NULL AND "accounting_journals"."posted_by" IS NOT NULL)),
	CONSTRAINT "accounting_journals_source_check" CHECK (
    num_nonnulls("accounting_journals"."source_type", "accounting_journals"."source_id", "accounting_journals"."source_version", "accounting_journals"."event_type") IN (0, 4)
    OR ("accounting_journals"."source_type" = 'OPENING' AND "accounting_journals"."source_id" IS NOT NULL
      AND "accounting_journals"."source_version" IS NOT NULL AND "accounting_journals"."event_type" IS NULL)),
	CONSTRAINT "accounting_journals_source_version_check" CHECK ("accounting_journals"."source_version" IS NULL OR "accounting_journals"."source_version" >= 1),
	CONSTRAINT "accounting_journals_rule_check" CHECK (num_nonnulls("accounting_journals"."rule_id", "accounting_journals"."rule_version") IN (0, 2)
    AND ("accounting_journals"."rule_version" IS NULL OR "accounting_journals"."rule_version" >= 1)),
	CONSTRAINT "accounting_journals_reversal_self_check" CHECK ("accounting_journals"."reversal_of_id" IS NULL OR "accounting_journals"."reversal_of_id" <> "accounting_journals"."id")
);
--> statement-breakpoint
ALTER TABLE "accounting_journals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "accounting_opening_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"opening_id" uuid NOT NULL,
	"label" text NOT NULL,
	"reference" text NOT NULL,
	"amount_cents" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_opening_documents_label_unique" UNIQUE("company_id","opening_id","label"),
	CONSTRAINT "accounting_opening_documents_label_check" CHECK ("accounting_opening_documents"."label" = btrim("accounting_opening_documents"."label") AND length("accounting_opening_documents"."label") BETWEEN 1 AND 120),
	CONSTRAINT "accounting_opening_documents_reference_check" CHECK ("accounting_opening_documents"."reference" = btrim("accounting_opening_documents"."reference") AND length("accounting_opening_documents"."reference") BETWEEN 1 AND 200),
	CONSTRAINT "accounting_opening_documents_amount_check" CHECK ("accounting_opening_documents"."amount_cents" IS NULL OR ("accounting_opening_documents"."amount_cents" >= 0 AND "accounting_opening_documents"."amount_cents" <= 9007199254740991))
);
--> statement-breakpoint
ALTER TABLE "accounting_opening_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "accounting_openings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"journal_id" uuid NOT NULL,
	"opening_date" date NOT NULL,
	"memo" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_openings_company_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "accounting_openings_memo_check" CHECK ("accounting_openings"."memo" IS NULL OR ("accounting_openings"."memo" = btrim("accounting_openings"."memo") AND length("accounting_openings"."memo") BETWEEN 1 AND 500))
);
--> statement-breakpoint
ALTER TABLE "accounting_openings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "accounting_rule_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"role" text NOT NULL,
	"account_id" uuid NOT NULL,
	"cost_center_id" uuid,
	"required" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_rule_entries_role_unique" UNIQUE("company_id","rule_id","role"),
	CONSTRAINT "accounting_rule_entries_role_check" CHECK ("accounting_rule_entries"."role" ~ '^[A-Z][A-Z0-9_]{2,39}$')
);
--> statement-breakpoint
ALTER TABLE "accounting_rule_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "accounting_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"event_type" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"effective_from" date NOT NULL,
	"supersedes_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_rules_company_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "accounting_rules_code_check" CHECK ("accounting_rules"."code" ~ '^[A-Z][A-Z0-9_]{2,31}$'),
	CONSTRAINT "accounting_rules_event_type_check" CHECK ("accounting_rules"."event_type" ~ '^[A-Z][A-Z0-9_]{2,39}$'),
	CONSTRAINT "accounting_rules_name_check" CHECK ("accounting_rules"."name" = btrim("accounting_rules"."name") AND length("accounting_rules"."name") BETWEEN 1 AND 160),
	CONSTRAINT "accounting_rules_version_check" CHECK ("accounting_rules"."version" >= 1),
	CONSTRAINT "accounting_rules_supersedes_self_check" CHECK ("accounting_rules"."supersedes_id" IS NULL OR "accounting_rules"."supersedes_id" <> "accounting_rules"."id"),
	CONSTRAINT "accounting_rules_notes_check" CHECK ("accounting_rules"."notes" IS NULL OR ("accounting_rules"."notes" = btrim("accounting_rules"."notes") AND length("accounting_rules"."notes") BETWEEN 1 AND 500))
);
--> statement-breakpoint
ALTER TABLE "accounting_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "accounting_source_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"cost_center_id" uuid,
	"bank_account_id" uuid,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_links_one_source_check" CHECK (("accounting_source_links"."cost_center_id" IS NOT NULL) <> ("accounting_source_links"."bank_account_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "accounting_source_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounting_sales_documents" ADD CONSTRAINT "accounting_sales_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_sales_documents" ADD CONSTRAINT "accounting_sales_documents_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_sales_documents" ADD CONSTRAINT "accounting_sales_documents_cut_id_daily_sales_cuts_id_fk" FOREIGN KEY ("cut_id") REFERENCES "public"."daily_sales_cuts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_sales_documents" ADD CONSTRAINT "accounting_sales_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_sales_documents" ADD CONSTRAINT "accounting_sales_original_fk" FOREIGN KEY ("company_id","original_id") REFERENCES "public"."accounting_sales_documents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aggregator_settlements" ADD CONSTRAINT "aggregator_settlements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aggregator_settlements" ADD CONSTRAINT "aggregator_settlements_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cfdi_recibidos" ADD CONSTRAINT "cfdi_recibidos_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cfdi_recibidos" ADD CONSTRAINT "cfdi_recibidos_matched_supplier_id_suppliers_id_fk" FOREIGN KEY ("matched_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cfdi_recibidos" ADD CONSTRAINT "cfdi_recibidos_matched_payee_id_payees_id_fk" FOREIGN KEY ("matched_payee_id") REFERENCES "public"."payees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cfdi_recibidos" ADD CONSTRAINT "cfdi_recibidos_matched_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("matched_purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cfdi_recibidos" ADD CONSTRAINT "cfdi_recibidos_matched_expense_id_operating_expenses_id_fk" FOREIGN KEY ("matched_expense_id") REFERENCES "public"."operating_expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_commission_rates" ADD CONSTRAINT "channel_commission_rates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_commission_rates" ADD CONSTRAINT "channel_commission_rates_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_commission_rates" ADD CONSTRAINT "channel_commission_rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_read_receipts" ADD CONSTRAINT "communication_read_receipts_communication_id_employee_communications_id_fk" FOREIGN KEY ("communication_id") REFERENCES "public"."employee_communications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_read_receipts" ADD CONSTRAINT "communication_read_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config_change_logs" ADD CONSTRAINT "config_change_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_sales_cuts" ADD CONSTRAINT "daily_sales_cuts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_sales_cuts" ADD CONSTRAINT "daily_sales_cuts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_sales_cuts" ADD CONSTRAINT "daily_sales_cuts_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_audit_logs" ADD CONSTRAINT "employee_audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_benefits" ADD CONSTRAINT "employee_benefits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_benefits" ADD CONSTRAINT "employee_benefits_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_communications" ADD CONSTRAINT "employee_communications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_communications" ADD CONSTRAINT "employee_communications_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_contracts" ADD CONSTRAINT "employee_contracts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_contracts" ADD CONSTRAINT "employee_contracts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_contracts" ADD CONSTRAINT "employee_contracts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_offboarding" ADD CONSTRAINT "employee_offboarding_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_offboarding" ADD CONSTRAINT "employee_offboarding_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_offboarding" ADD CONSTRAINT "employee_offboarding_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_onboarding" ADD CONSTRAINT "employee_onboarding_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_onboarding" ADD CONSTRAINT "employee_onboarding_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_onboarding" ADD CONSTRAINT "employee_onboarding_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_training" ADD CONSTRAINT "employee_training_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_training" ADD CONSTRAINT "employee_training_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_authorization_rules" ADD CONSTRAINT "expense_authorization_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_authorization_rules" ADD CONSTRAINT "expense_authorization_rules_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_payment_run_item_id_payment_run_items_id_fk" FOREIGN KEY ("payment_run_item_id") REFERENCES "public"."payment_run_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_expense_fk" FOREIGN KEY ("company_id","expense_id") REFERENCES "public"."operating_expenses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_journal_fk" FOREIGN KEY ("company_id","accounting_journal_id") REFERENCES "public"."accounting_journals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_periods" ADD CONSTRAINT "financial_periods_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_periods" ADD CONSTRAINT "financial_periods_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imss_files" ADD CONSTRAINT "imss_files_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imss_files" ADD CONSTRAINT "imss_files_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imss_movements" ADD CONSTRAINT "imss_movements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imss_movements" ADD CONSTRAINT "imss_movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imss_movements" ADD CONSTRAINT "imss_movements_file_id_imss_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."imss_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_source_playbook_id_workflow_templates_id_fk" FOREIGN KEY ("source_playbook_id") REFERENCES "public"."workflow_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_alerts" ADD CONSTRAINT "inventory_alerts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_alerts" ADD CONSTRAINT "inventory_alerts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_alerts" ADD CONSTRAINT "inventory_alerts_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_expiration_alerts" ADD CONSTRAINT "inventory_expiration_alerts_batch_id_inventory_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."inventory_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_periods" ADD CONSTRAINT "inventory_periods_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_periods" ADD CONSTRAINT "inventory_periods_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_snapshots" ADD CONSTRAINT "inventory_snapshots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_snapshots" ADD CONSTRAINT "inventory_snapshots_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_snapshots" ADD CONSTRAINT "inventory_snapshots_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_waste" ADD CONSTRAINT "inventory_waste_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_waste" ADD CONSTRAINT "inventory_waste_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_waste" ADD CONSTRAINT "inventory_waste_batch_id_inventory_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."inventory_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_waste" ADD CONSTRAINT "inventory_waste_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_waste" ADD CONSTRAINT "inventory_waste_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_receiving_report_id_receiving_reports_id_fk" FOREIGN KEY ("receiving_report_id") REFERENCES "public"."receiving_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_recurring_contract_id_recurring_contracts_id_fk" FOREIGN KEY ("recurring_contract_id") REFERENCES "public"."recurring_contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_service_order_id_service_orders_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "public"."service_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_exception_approved_by_users_id_fk" FOREIGN KEY ("exception_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_alerts" ADD CONSTRAINT "kpi_alerts_kpi_id_kpi_definitions_id_fk" FOREIGN KEY ("kpi_id") REFERENCES "public"."kpi_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_history" ADD CONSTRAINT "kpi_history_kpi_id_kpi_definitions_id_fk" FOREIGN KEY ("kpi_id") REFERENCES "public"."kpi_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nom035_action_plans" ADD CONSTRAINT "nom035_action_plans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nom035_action_plans" ADD CONSTRAINT "nom035_action_plans_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nom035_action_plans" ADD CONSTRAINT "nom035_action_plans_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_steps" ADD CONSTRAINT "onboarding_steps_onboarding_id_employee_onboarding_id_fk" FOREIGN KEY ("onboarding_id") REFERENCES "public"."employee_onboarding"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_payee_id_payees_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."payees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_overbudget_approved_by_users_id_fk" FOREIGN KEY ("overbudget_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payees" ADD CONSTRAINT "payees_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_aguinaldo_dispersiones" ADD CONSTRAINT "payroll_aguinaldo_dispersiones_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_aguinaldo_dispersiones" ADD CONSTRAINT "payroll_aguinaldo_dispersiones_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_aguinaldo_dispersiones" ADD CONSTRAINT "payroll_aguinaldo_dispersiones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payslips" ADD CONSTRAINT "payroll_payslips_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payslips" ADD CONSTRAINT "payroll_payslips_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_goals" ADD CONSTRAINT "performance_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_goals" ADD CONSTRAINT "performance_goals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_goals" ADD CONSTRAINT "performance_goals_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_review_criteria" ADD CONSTRAINT "performance_review_criteria_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_review_responses" ADD CONSTRAINT "performance_review_responses_review_id_performance_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."performance_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_review_responses" ADD CONSTRAINT "performance_review_responses_criteria_id_performance_review_criteria_id_fk" FOREIGN KEY ("criteria_id") REFERENCES "public"."performance_review_criteria"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_funds" ADD CONSTRAINT "petty_cash_funds_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_funds" ADD CONSTRAINT "petty_cash_funds_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD CONSTRAINT "petty_cash_transactions_fund_id_petty_cash_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."petty_cash_funds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD CONSTRAINT "petty_cash_transactions_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD CONSTRAINT "petty_cash_transactions_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD CONSTRAINT "petty_cash_transactions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pnl_snapshots" ADD CONSTRAINT "pnl_snapshots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pnl_snapshots" ADD CONSTRAINT "pnl_snapshots_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pnl_snapshots" ADD CONSTRAINT "pnl_snapshots_frozen_by_users_id_fk" FOREIGN KEY ("frozen_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_mapping_templates" ADD CONSTRAINT "pos_mapping_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_mapping_templates" ADD CONSTRAINT "pos_mapping_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "propina_asignaciones" ADD CONSTRAINT "propina_asignaciones_propina_id_propinas_id_fk" FOREIGN KEY ("propina_id") REFERENCES "public"."propinas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "propina_asignaciones" ADD CONSTRAINT "propina_asignaciones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "propinas" ADD CONSTRAINT "propinas_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "propinas" ADD CONSTRAINT "propinas_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "propinas" ADD CONSTRAINT "propinas_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remediation_actions" ADD CONSTRAINT "remediation_actions_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remediation_actions" ADD CONSTRAINT "remediation_actions_service_config_id_branch_compliance_services_id_fk" FOREIGN KEY ("service_config_id") REFERENCES "public"."branch_compliance_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_execution_history" ADD CONSTRAINT "report_execution_history_template_id_report_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."report_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_execution_history" ADD CONSTRAINT "report_execution_history_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_history" ADD CONSTRAINT "salary_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_history" ADD CONSTRAINT "salary_history_contract_id_employee_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."employee_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_cut_cashiers" ADD CONSTRAINT "sales_cut_cashiers_sales_cut_id_daily_sales_cuts_id_fk" FOREIGN KEY ("sales_cut_id") REFERENCES "public"."daily_sales_cuts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_cut_cashiers" ADD CONSTRAINT "sales_cut_cashiers_cashier_user_id_users_id_fk" FOREIGN KEY ("cashier_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_counted_by_users_id_fk" FOREIGN KEY ("counted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bank_accounts" ADD CONSTRAINT "supplier_bank_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bank_accounts" ADD CONSTRAINT "supplier_bank_accounts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bank_accounts" ADD CONSTRAINT "supplier_bank_accounts_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bank_accounts" ADD CONSTRAINT "supplier_bank_accounts_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bank_accounts" ADD CONSTRAINT "supplier_bank_accounts_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bank_accounts" ADD CONSTRAINT "supplier_bank_accounts_replaces_account_id_fk" FOREIGN KEY ("replaces_account_id") REFERENCES "public"."supplier_bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_claims" ADD CONSTRAINT "supplier_claims_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_claims" ADD CONSTRAINT "supplier_claims_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_claims" ADD CONSTRAINT "supplier_claims_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_claims" ADD CONSTRAINT "supplier_claims_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_items" ADD CONSTRAINT "supplier_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_items" ADD CONSTRAINT "supplier_items_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_items" ADD CONSTRAINT "supplier_items_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_payee_id_payees_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."payees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_operating_config" ADD CONSTRAINT "tenant_operating_config_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tpv_shift_batches" ADD CONSTRAINT "tpv_shift_batches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tpv_shift_batches" ADD CONSTRAINT "tpv_shift_batches_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tpv_shift_batches" ADD CONSTRAINT "tpv_shift_batches_sales_cut_id_daily_sales_cuts_id_fk" FOREIGN KEY ("sales_cut_id") REFERENCES "public"."daily_sales_cuts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tpv_shift_batches" ADD CONSTRAINT "tpv_shift_batches_terminal_id_branch_terminals_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."branch_terminals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tpv_shift_batches" ADD CONSTRAINT "tpv_shift_batches_captured_by_users_id_fk" FOREIGN KEY ("captured_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_accruals" ADD CONSTRAINT "vacation_accruals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_accruals" ADD CONSTRAINT "vacation_accruals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_requests" ADD CONSTRAINT "vacation_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_requests" ADD CONSTRAINT "vacation_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_requests" ADD CONSTRAINT "vacation_requests_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_conversation_states" ADD CONSTRAINT "whatsapp_conversation_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_conversation_states" ADD CONSTRAINT "whatsapp_conversation_states_workflow_instance_id_workflow_instances_id_fk" FOREIGN KEY ("workflow_instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_session_id_whatsapp_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."whatsapp_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_completion_outbox" ADD CONSTRAINT "workflow_completion_outbox_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_compliance_services" ADD CONSTRAINT "branch_compliance_services_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_compliance_services" ADD CONSTRAINT "branch_compliance_services_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_compliance_services" ADD CONSTRAINT "branch_compliance_services_provider_id_service_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."service_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_compliance_services" ADD CONSTRAINT "branch_compliance_services_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_compliance_services" ADD CONSTRAINT "branch_compliance_services_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_equipments" ADD CONSTRAINT "branch_equipments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_equipments" ADD CONSTRAINT "branch_equipments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_equipments" ADD CONSTRAINT "branch_equipments_catalog_id_equipment_catalog_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."equipment_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_equipments" ADD CONSTRAINT "branch_equipments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_equipments" ADD CONSTRAINT "branch_equipments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_service_history" ADD CONSTRAINT "compliance_service_history_service_config_id_branch_compliance_services_id_fk" FOREIGN KEY ("service_config_id") REFERENCES "public"."branch_compliance_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_service_history" ADD CONSTRAINT "compliance_service_history_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_service_history" ADD CONSTRAINT "compliance_service_history_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_service_history" ADD CONSTRAINT "compliance_service_history_provider_id_service_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."service_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_service_history" ADD CONSTRAINT "compliance_service_history_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_service_history" ADD CONSTRAINT "compliance_service_history_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_service_history" ADD CONSTRAINT "compliance_service_history_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_alerts" ADD CONSTRAINT "equipment_alerts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_alerts" ADD CONSTRAINT "equipment_alerts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_alerts" ADD CONSTRAINT "equipment_alerts_equipment_id_branch_equipments_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."branch_equipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_alerts" ADD CONSTRAINT "equipment_alerts_service_config_id_branch_compliance_services_id_fk" FOREIGN KEY ("service_config_id") REFERENCES "public"."branch_compliance_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_alerts" ADD CONSTRAINT "equipment_alerts_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_alerts" ADD CONSTRAINT "equipment_alerts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_catalog" ADD CONSTRAINT "equipment_catalog_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_catalog" ADD CONSTRAINT "equipment_catalog_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_maintenance_history" ADD CONSTRAINT "equipment_maintenance_history_equipment_id_branch_equipments_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."branch_equipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_maintenance_history" ADD CONSTRAINT "equipment_maintenance_history_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_maintenance_history" ADD CONSTRAINT "equipment_maintenance_history_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_maintenance_history" ADD CONSTRAINT "equipment_maintenance_history_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_maintenance_history" ADD CONSTRAINT "equipment_maintenance_history_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_maintenance_history" ADD CONSTRAINT "equipment_maintenance_history_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_maintenance_schedules" ADD CONSTRAINT "equipment_maintenance_schedules_equipment_id_branch_equipments_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."branch_equipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_maintenance_schedules" ADD CONSTRAINT "equipment_maintenance_schedules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_maintenance_schedules" ADD CONSTRAINT "equipment_maintenance_schedules_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_maintenance_schedules" ADD CONSTRAINT "equipment_maintenance_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_maintenance_schedules" ADD CONSTRAINT "equipment_maintenance_schedules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_warranties" ADD CONSTRAINT "equipment_warranties_equipment_id_branch_equipments_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."branch_equipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_warranties" ADD CONSTRAINT "equipment_warranties_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_warranties" ADD CONSTRAINT "equipment_warranties_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_warranties" ADD CONSTRAINT "equipment_warranties_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_providers" ADD CONSTRAINT "service_providers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_providers" ADD CONSTRAINT "service_providers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_providers" ADD CONSTRAINT "service_providers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "civil_protection_drills" ADD CONSTRAINT "civil_protection_drills_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "civil_protection_drills" ADD CONSTRAINT "civil_protection_drills_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "civil_protection_drills" ADD CONSTRAINT "civil_protection_drills_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "civil_protection_drills" ADD CONSTRAINT "civil_protection_drills_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_checklist_items" ADD CONSTRAINT "exit_checklist_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_checklist_items" ADD CONSTRAINT "exit_checklist_items_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_checklist_items" ADD CONSTRAINT "exit_checklist_items_inspected_by_users_id_fk" FOREIGN KEY ("inspected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extinguisher_inspections" ADD CONSTRAINT "extinguisher_inspections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extinguisher_inspections" ADD CONSTRAINT "extinguisher_inspections_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extinguisher_inspections" ADD CONSTRAINT "extinguisher_inspections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extinguisher_inspections" ADD CONSTRAINT "extinguisher_inspections_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_twins" ADD CONSTRAINT "corporate_twins_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_twins" ADD CONSTRAINT "operational_twins_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arco_requests" ADD CONSTRAINT "arco_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_access_logs" ADD CONSTRAINT "data_access_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_access_logs" ADD CONSTRAINT "data_access_logs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_consents" ADD CONSTRAINT "data_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_consents" ADD CONSTRAINT "data_consents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_approvals" ADD CONSTRAINT "payment_approvals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_approvals" ADD CONSTRAINT "payment_approvals_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_overrides" ADD CONSTRAINT "policy_overrides_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_overrides" ADD CONSTRAINT "policy_overrides_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_notices" ADD CONSTRAINT "privacy_notices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_keys" ADD CONSTRAINT "tenant_keys_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_subscriptions" ADD CONSTRAINT "company_subscriptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_subscriptions" ADD CONSTRAINT "company_subscriptions_tier_id_subscription_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."subscription_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_publications" ADD CONSTRAINT "playbook_publications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_publications" ADD CONSTRAINT "playbook_publications_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_versions" ADD CONSTRAINT "playbook_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "morning_briefs" ADD CONSTRAINT "morning_briefs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_terminals" ADD CONSTRAINT "branch_terminals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_terminals" ADD CONSTRAINT "branch_terminals_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_terminals" ADD CONSTRAINT "branch_terminals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_terminals" ADD CONSTRAINT "branch_terminals_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_flow_assumptions" ADD CONSTRAINT "cash_flow_assumptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_flow_assumptions" ADD CONSTRAINT "cash_flow_assumptions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_flow_assumptions" ADD CONSTRAINT "cash_flow_assumptions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cfdi_nomina_timbrados" ADD CONSTRAINT "cfdi_nomina_timbrados_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cfdi_nomina_timbrados" ADD CONSTRAINT "cfdi_nomina_timbrados_timbrado_por_users_id_fk" FOREIGN KEY ("timbrado_por") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_transactions" ADD CONSTRAINT "gateway_transactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_transactions" ADD CONSTRAINT "gateway_transactions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_transactions" ADD CONSTRAINT "gateway_transactions_destination_bank_account_id_company_bank_accounts_id_fk" FOREIGN KEY ("destination_bank_account_id") REFERENCES "public"."company_bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_transactions" ADD CONSTRAINT "gateway_transactions_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_matrix_rules" ADD CONSTRAINT "approval_matrix_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_budgets" ADD CONSTRAINT "branch_budgets_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_budgets" ADD CONSTRAINT "branch_budgets_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folio_counters" ADD CONSTRAINT "folio_counters_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folio_counters" ADD CONSTRAINT "folio_counters_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_delegation_rules" ADD CONSTRAINT "purchase_delegation_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_evidence" ADD CONSTRAINT "service_order_evidence_service_order_id_service_orders_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "public"."service_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_quotes" ADD CONSTRAINT "service_order_quotes_service_order_id_service_orders_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "public"."service_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_compliance_service_id_branch_compliance_services_id_fk" FOREIGN KEY ("compliance_service_id") REFERENCES "public"."branch_compliance_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_service_provider_id_service_providers_id_fk" FOREIGN KEY ("service_provider_id") REFERENCES "public"."service_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_source_bank_account_id_company_bank_accounts_id_fk" FOREIGN KEY ("source_bank_account_id") REFERENCES "public"."company_bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_matched_by_users_id_fk" FOREIGN KEY ("matched_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_bank_accounts" ADD CONSTRAINT "company_bank_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_bank_accounts" ADD CONSTRAINT "company_bank_accounts_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payee_bank_accounts" ADD CONSTRAINT "payee_bank_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payee_bank_accounts" ADD CONSTRAINT "payee_bank_accounts_payee_id_payees_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."payees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payee_bank_accounts" ADD CONSTRAINT "payee_bank_accounts_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payee_bank_accounts" ADD CONSTRAINT "payee_bank_accounts_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payee_bank_accounts" ADD CONSTRAINT "payee_bank_accounts_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payee_bank_accounts" ADD CONSTRAINT "payee_bank_accounts_replaces_account_id_fk" FOREIGN KEY ("replaces_account_id") REFERENCES "public"."payee_bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_run_items" ADD CONSTRAINT "payment_run_items_payment_run_id_payment_runs_id_fk" FOREIGN KEY ("payment_run_id") REFERENCES "public"."payment_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_run_items" ADD CONSTRAINT "payment_run_items_settled_by_users_id_fk" FOREIGN KEY ("settled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_run_items" ADD CONSTRAINT "payment_run_items_bank_account_id_supplier_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."supplier_bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_run_items" ADD CONSTRAINT "payment_run_items_payee_bank_account_id_payee_bank_accounts_id_fk" FOREIGN KEY ("payee_bank_account_id") REFERENCES "public"."payee_bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_runs" ADD CONSTRAINT "payment_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_runs" ADD CONSTRAINT "payment_runs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_runs" ADD CONSTRAINT "payment_runs_prepared_by_users_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_runs" ADD CONSTRAINT "payment_runs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_runs" ADD CONSTRAINT "payment_runs_source_bank_company_fk" FOREIGN KEY ("company_id","source_bank_account_id") REFERENCES "public"."company_bank_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_contracts" ADD CONSTRAINT "recurring_contracts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_contracts" ADD CONSTRAINT "recurring_contracts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payables" ADD CONSTRAINT "recurring_payables_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payables" ADD CONSTRAINT "recurring_payables_contract_id_recurring_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."recurring_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_production_plan_item_id_production_plan_items_id_fk" FOREIGN KEY ("production_plan_item_id") REFERENCES "public"."production_plan_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plan_items" ADD CONSTRAINT "production_plan_items_plan_id_production_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."production_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plan_items" ADD CONSTRAINT "production_plan_items_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executive_decisions" ADD CONSTRAINT "executive_decisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_resolved_by_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_verified_by_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_accounts" ADD CONSTRAINT "accounting_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_accounts" ADD CONSTRAINT "accounting_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_accounts" ADD CONSTRAINT "accounting_accounts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_accounts" ADD CONSTRAINT "accounting_accounts_parent_company_fk" FOREIGN KEY ("company_id","parent_id") REFERENCES "public"."accounting_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_events" ADD CONSTRAINT "accounting_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_events" ADD CONSTRAINT "accounting_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_events" ADD CONSTRAINT "accounting_events_branch_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_events" ADD CONSTRAINT "accounting_events_journal_fk" FOREIGN KEY ("company_id","journal_id") REFERENCES "public"."accounting_journals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_gateway_links" ADD CONSTRAINT "accounting_gateway_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_gateway_links" ADD CONSTRAINT "accounting_gateway_links_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_gateway_links" ADD CONSTRAINT "accounting_gateway_links_account_company_fk" FOREIGN KEY ("company_id","account_id") REFERENCES "public"."accounting_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_journal_lines" ADD CONSTRAINT "accounting_journal_lines_journal_fk" FOREIGN KEY ("company_id","journal_id") REFERENCES "public"."accounting_journals"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_journal_lines" ADD CONSTRAINT "accounting_journal_lines_account_fk" FOREIGN KEY ("company_id","account_id") REFERENCES "public"."accounting_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_journal_lines" ADD CONSTRAINT "accounting_journal_lines_cost_center_fk" FOREIGN KEY ("company_id","cost_center_id") REFERENCES "public"."cost_centers"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_journals" ADD CONSTRAINT "accounting_journals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_journals" ADD CONSTRAINT "accounting_journals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_journals" ADD CONSTRAINT "accounting_journals_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_journals" ADD CONSTRAINT "accounting_journals_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_journals" ADD CONSTRAINT "accounting_journals_reversal_company_fk" FOREIGN KEY ("company_id","reversal_of_id") REFERENCES "public"."accounting_journals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_journals" ADD CONSTRAINT "accounting_journals_replacement_company_fk" FOREIGN KEY ("company_id","replacement_of_id") REFERENCES "public"."accounting_journals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_journals" ADD CONSTRAINT "accounting_journals_rule_company_fk" FOREIGN KEY ("company_id","rule_id") REFERENCES "public"."accounting_rules"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_opening_documents" ADD CONSTRAINT "accounting_opening_documents_opening_fk" FOREIGN KEY ("company_id","opening_id") REFERENCES "public"."accounting_openings"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_openings" ADD CONSTRAINT "accounting_openings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_openings" ADD CONSTRAINT "accounting_openings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_openings" ADD CONSTRAINT "accounting_openings_journal_fk" FOREIGN KEY ("company_id","journal_id") REFERENCES "public"."accounting_journals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_rule_entries" ADD CONSTRAINT "accounting_rule_entries_rule_fk" FOREIGN KEY ("company_id","rule_id") REFERENCES "public"."accounting_rules"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_rule_entries" ADD CONSTRAINT "accounting_rule_entries_account_fk" FOREIGN KEY ("company_id","account_id") REFERENCES "public"."accounting_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_rule_entries" ADD CONSTRAINT "accounting_rule_entries_cost_center_fk" FOREIGN KEY ("company_id","cost_center_id") REFERENCES "public"."cost_centers"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_rules" ADD CONSTRAINT "accounting_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_rules" ADD CONSTRAINT "accounting_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_rules" ADD CONSTRAINT "accounting_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_rules" ADD CONSTRAINT "accounting_rules_supersedes_company_fk" FOREIGN KEY ("company_id","supersedes_id") REFERENCES "public"."accounting_rules"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_source_links" ADD CONSTRAINT "accounting_source_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_source_links" ADD CONSTRAINT "accounting_source_links_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_source_links" ADD CONSTRAINT "accounting_links_account_company_fk" FOREIGN KEY ("company_id","account_id") REFERENCES "public"."accounting_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_source_links" ADD CONSTRAINT "accounting_links_cost_center_company_fk" FOREIGN KEY ("company_id","cost_center_id") REFERENCES "public"."cost_centers"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_source_links" ADD CONSTRAINT "accounting_links_bank_company_fk" FOREIGN KEY ("company_id","bank_account_id") REFERENCES "public"."company_bank_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_sales_cut_version_unique" ON "accounting_sales_documents" USING btree ("company_id","cut_id","version") WHERE "accounting_sales_documents"."kind" = 'SALE';--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_sales_replacement_unique" ON "accounting_sales_documents" USING btree ("company_id","original_id") WHERE "accounting_sales_documents"."kind" = 'SALE';--> statement-breakpoint
CREATE INDEX "accounting_sales_scope_idx" ON "accounting_sales_documents" USING btree ("company_id","branch_id","business_date");--> statement-breakpoint
CREATE INDEX "accounting_sales_original_idx" ON "accounting_sales_documents" USING btree ("company_id","original_id");--> statement-breakpoint
CREATE INDEX "cfdi_recibidos_company_date_idx" ON "cfdi_recibidos" USING btree ("company_id","invoice_date");--> statement-breakpoint
CREATE INDEX "cfdi_recibidos_company_issuer_idx" ON "cfdi_recibidos" USING btree ("company_id","issuer_tin");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_commission_rate_unique" ON "channel_commission_rates" USING btree ("company_id","channel","branch_id","effective_from") WHERE "channel_commission_rates"."branch_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_commission_rate_group_unique" ON "channel_commission_rates" USING btree ("company_id","channel","effective_from") WHERE "channel_commission_rates"."branch_id" IS NULL;--> statement-breakpoint
CREATE INDEX "config_change_logs_company_time_idx" ON "config_change_logs" USING btree ("company_id","performed_at");--> statement-breakpoint
CREATE INDEX "config_change_logs_param_idx" ON "config_change_logs" USING btree ("company_id","field_name","performed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_sales_cut_unique" ON "daily_sales_cuts" USING btree ("company_id","branch_id","business_date","shift","channel");--> statement-breakpoint
CREATE INDEX "daily_sales_cuts_date_idx" ON "daily_sales_cuts" USING btree ("company_id","branch_id","business_date");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_payments_run_item_unique" ON "expense_payments" USING btree ("company_id","payment_run_item_id") WHERE "expense_payments"."payment_run_item_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "expense_payments_expense_idx" ON "expense_payments" USING btree ("company_id","expense_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_periods_company_year_month_unique" ON "financial_periods" USING btree ("company_id","year","month");--> statement-breakpoint
CREATE INDEX "financial_periods_company_idx" ON "financial_periods" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "imss_files_company_sha_unique" ON "imss_files" USING btree ("company_id","content_sha256");--> statement-breakpoint
CREATE INDEX "imss_files_company_created_idx" ON "imss_files" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "imss_files_company_fecha_idx" ON "imss_files" USING btree ("company_id","fecha_movimiento");--> statement-breakpoint
CREATE UNIQUE INDEX "imss_movements_idempotency_unique" ON "imss_movements" USING btree ("company_id","user_id","movement_type","effective_date");--> statement-breakpoint
CREATE INDEX "imss_movements_company_user_idx" ON "imss_movements" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX "imss_movements_company_status_idx" ON "imss_movements" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "imss_movements_company_effective_date_idx" ON "imss_movements" USING btree ("company_id","effective_date");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_expiration_alerts_batch_window_unique" ON "inventory_expiration_alerts" USING btree ("batch_id","window");--> statement-breakpoint
CREATE INDEX "kg_branch_item_idx" ON "inventory_knowledge_graph" USING btree ("branch_id","item_id");--> statement-breakpoint
CREATE INDEX "movements_branch_item_idx" ON "inventory_movements" USING btree ("branch_id","item_id","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_snapshots_unique" ON "inventory_snapshots" USING btree ("company_id","branch_id","item_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "inventory_snapshots_branch_date_idx" ON "inventory_snapshots" USING btree ("branch_id","snapshot_date" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_waste_instance_item_origin_unique" ON "inventory_waste" USING btree ("workflow_instance_id","item_id","origin") WHERE "inventory_waste"."workflow_instance_id" IS NOT NULL AND "inventory_waste"."origin" <> 'lote_insuficiente';--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_waste_production_result_unique" ON "inventory_waste" USING btree ("production_result_id") WHERE "inventory_waste"."production_result_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "invoices_service_order_idx" ON "invoices" USING btree ("service_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payees_company_name_unique" ON "payees" USING btree ("company_id",lower("name"));--> statement-breakpoint
CREATE INDEX "payroll_aguinaldo_dispersiones_company_year_idx" ON "payroll_aguinaldo_dispersiones" USING btree ("company_id","anio_fiscal","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_payslips_aguinaldo_snapshot_employee_unique" ON "payroll_payslips" USING btree ("run_id","user_id") WHERE "payroll_payslips"."aguinaldo_snapshot" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_company_aguinaldo_year_unique" ON "payroll_runs" USING btree ("company_id","aguinaldo_fiscal_year") WHERE "payroll_runs"."aguinaldo_fiscal_year" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "petty_cash_fund_branch_unique" ON "petty_cash_funds" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_shift" ON "planned_shifts" USING btree ("user_id","shift_date","start_time");--> statement-breakpoint
CREATE UNIQUE INDEX "pnl_snapshot_branch_period_unique" ON "pnl_snapshots" USING btree ("branch_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "pnl_snapshots_company_period_idx" ON "pnl_snapshots" USING btree ("company_id","period_end");--> statement-breakpoint
CREATE INDEX "pos_mapping_templates_company_idx" ON "pos_mapping_templates" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "production_orders_prep_list_idx" ON "production_orders" USING btree ("company_id","branch_id","planned_date");--> statement-breakpoint
CREATE UNIQUE INDEX "production_results_instance_recipe_unique" ON "production_results" USING btree ("workflow_instance_id","recipe_id") WHERE "production_results"."workflow_instance_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "production_results_hold_pending_idx" ON "production_results" USING btree ("expires_at") WHERE "production_results"."expires_at" IS NOT NULL AND "production_results"."discarded_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "propinas_branch_date_shift_unique" ON "propinas" USING btree ("company_id","branch_id","business_date","shift");--> statement-breakpoint
CREATE UNIQUE INDEX "receiving_reports_company_idempotency_idx" ON "receiving_reports" USING btree ("company_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "recipe_versions_recipe_idx" ON "recipe_versions" USING btree ("recipe_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_entries_unique_sale" ON "sales_entries" USING btree ("company_id","branch_id","sale_date","recipe_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_counts_instance_item_unique" ON "stock_counts" USING btree ("workflow_instance_id","item_id") WHERE "stock_counts"."workflow_instance_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "stock_counts_branch_date_idx" ON "stock_counts" USING btree ("branch_id","count_date" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_bank_accounts_one_verified_active" ON "supplier_bank_accounts" USING btree ("supplier_id") WHERE "supplier_bank_accounts"."status" = 'VERIFIED' AND "supplier_bank_accounts"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_bank_accounts_supplier_clabe_unique" ON "supplier_bank_accounts" USING btree ("supplier_id","clabe_fingerprint") WHERE "supplier_bank_accounts"."active";--> statement-breakpoint
CREATE INDEX "supplier_bank_accounts_company_supplier_idx" ON "supplier_bank_accounts" USING btree ("company_id","supplier_id");--> statement-breakpoint
CREATE INDEX "supplier_bank_accounts_fingerprint_idx" ON "supplier_bank_accounts" USING btree ("company_id","clabe_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_item_unique" ON "supplier_items" USING btree ("supplier_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_item_primary_unique" ON "supplier_items" USING btree ("company_id","item_id") WHERE "supplier_items"."preference_rank" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_operating_config_company_unique" ON "tenant_operating_config" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tpv_shift_batches_cut_terminal_unique" ON "tpv_shift_batches" USING btree ("sales_cut_id","terminal_id");--> statement-breakpoint
CREATE INDEX "tpv_shift_batches_company_branch_idx" ON "tpv_shift_batches" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "tpv_shift_batches_sales_cut_idx" ON "tpv_shift_batches" USING btree ("sales_cut_id");--> statement-breakpoint
CREATE INDEX "workflow_completion_outbox_status_idx" ON "workflow_completion_outbox" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "workflow_completion_outbox_instance_idx" ON "workflow_completion_outbox" USING btree ("instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "branches_invite_token_unique" ON "branches" USING btree ("invite_token");--> statement-breakpoint
CREATE UNIQUE INDEX "branches_manager_invite_token_unique" ON "branches" USING btree ("manager_invite_token");--> statement-breakpoint
CREATE UNIQUE INDEX "branches_company_code_unique" ON "branches" USING btree ("company_id","code") WHERE code is not null;--> statement-breakpoint
CREATE INDEX "cp_drills_company_idx" ON "civil_protection_drills" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "cp_drills_branch_idx" ON "civil_protection_drills" USING btree ("branch_id","drill_date");--> statement-breakpoint
CREATE INDEX "cp_exits_branch_idx" ON "exit_checklist_items" USING btree ("branch_id","inspected_at");--> statement-breakpoint
CREATE INDEX "cp_ext_branch_idx" ON "extinguisher_inspections" USING btree ("branch_id","inspection_date");--> statement-breakpoint
CREATE INDEX "cp_ext_company_idx" ON "extinguisher_inspections" USING btree ("company_id","extinguisher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_company_twin" ON "corporate_twins" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_branch_twin" ON "operational_twins" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_override_unico" ON "policy_overrides" USING btree ("company_id","domain","rule","resource_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_subscriptions_company_unique" ON "company_subscriptions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "company_subscriptions_tier_idx" ON "company_subscriptions" USING btree ("tier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_tiers_slug_unique" ON "subscription_tiers" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "playbook_publications_template_branch_unique" ON "playbook_publications" USING btree ("template_id","branch_id");--> statement-breakpoint
CREATE INDEX "playbook_publications_company_idx" ON "playbook_publications" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "playbook_publications_branch_idx" ON "playbook_publications" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "playbook_versions_template_version_unique" ON "playbook_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "morning_briefs_company_date_unique" ON "morning_briefs" USING btree ("company_id","brief_date");--> statement-breakpoint
CREATE INDEX "morning_briefs_company_generated_idx" ON "morning_briefs" USING btree ("company_id","generated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "branch_terminals_company_serial_unique" ON "branch_terminals" USING btree ("company_id","serial_number");--> statement-breakpoint
CREATE INDEX "branch_terminals_branch_idx" ON "branch_terminals" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "branch_terminals_company_idx" ON "branch_terminals" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_flow_assumptions_company_branch_unique" ON "cash_flow_assumptions" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_flow_assumptions_company_group_unique" ON "cash_flow_assumptions" USING btree ("company_id") WHERE "cash_flow_assumptions"."branch_id" IS NULL;--> statement-breakpoint
CREATE INDEX "cash_flow_assumptions_company_idx" ON "cash_flow_assumptions" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cfdi_nomina_timbrados_company_rfc_periodo_unique" ON "cfdi_nomina_timbrados" USING btree ("company_id","empleado_rfc","periodo");--> statement-breakpoint
CREATE INDEX "cfdi_nomina_timbrados_company_idx" ON "cfdi_nomina_timbrados" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_transactions_company_acquirer_ext_unique" ON "gateway_transactions" USING btree ("company_id","acquirer","external_id");--> statement-breakpoint
CREATE INDEX "gateway_transactions_company_branch_date_idx" ON "gateway_transactions" USING btree ("company_id","branch_id","transaction_date");--> statement-breakpoint
CREATE INDEX "gateway_transactions_company_settlement_idx" ON "gateway_transactions" USING btree ("company_id","settlement_date");--> statement-breakpoint
CREATE INDEX "gateway_transactions_destination_idx" ON "gateway_transactions" USING btree ("company_id","destination_bank_account_id");--> statement-breakpoint
CREATE INDEX "approval_matrix_rules_company_idx" ON "approval_matrix_rules" USING btree ("company_id","doc_type");--> statement-breakpoint
CREATE INDEX "approval_requests_doc_idx" ON "approval_requests" USING btree ("doc_type","doc_id");--> statement-breakpoint
CREATE INDEX "approval_requests_pending_idx" ON "approval_requests" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "branch_budgets_branch_cc_month_unique" ON "branch_budgets" USING btree ("branch_id","cost_center_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_centers_company_code_unique" ON "cost_centers" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "folio_counters_unique" ON "folio_counters" USING btree ("company_id","branch_id","doc_type","year");--> statement-breakpoint
CREATE INDEX "purchase_delegation_rules_company_idx" ON "purchase_delegation_rules" USING btree ("company_id","action");--> statement-breakpoint
CREATE INDEX "purchase_delegation_rules_branch_idx" ON "purchase_delegation_rules" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "service_orders_company_branch_idx" ON "service_orders" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "service_orders_status_idx" ON "service_orders" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transactions_fingerprint_unique" ON "bank_transactions" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "bank_transactions_company_date_idx" ON "bank_transactions" USING btree ("company_id","value_date");--> statement-breakpoint
CREATE INDEX "bank_transactions_account_idx" ON "bank_transactions" USING btree ("source_bank_account_id");--> statement-breakpoint
CREATE INDEX "bank_transactions_match_status_idx" ON "bank_transactions" USING btree ("company_id","match_status");--> statement-breakpoint
CREATE INDEX "bank_transactions_gateway_match_idx" ON "bank_transactions" USING btree ("matched_gateway_transaction_id") WHERE "bank_transactions"."matched_gateway_transaction_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "company_bank_accounts_active_number_unique" ON "company_bank_accounts" USING btree ("company_id","account_fingerprint") WHERE "company_bank_accounts"."active";--> statement-breakpoint
CREATE INDEX "company_bank_accounts_company_idx" ON "company_bank_accounts" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payee_bank_accounts_one_verified_active" ON "payee_bank_accounts" USING btree ("payee_id") WHERE "payee_bank_accounts"."status" = 'VERIFIED' AND "payee_bank_accounts"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "payee_bank_accounts_payee_clabe_unique" ON "payee_bank_accounts" USING btree ("payee_id","clabe_fingerprint") WHERE "payee_bank_accounts"."active";--> statement-breakpoint
CREATE INDEX "payee_bank_accounts_company_payee_idx" ON "payee_bank_accounts" USING btree ("company_id","payee_id");--> statement-breakpoint
CREATE INDEX "payee_bank_accounts_fingerprint_idx" ON "payee_bank_accounts" USING btree ("company_id","clabe_fingerprint");--> statement-breakpoint
CREATE INDEX "payment_run_items_run_settlement_idx" ON "payment_run_items" USING btree ("payment_run_id","settlement_status");--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_payables_contract_period_unique" ON "recurring_payables" USING btree ("contract_id","period_key");--> statement-breakpoint
CREATE INDEX "recurring_payables_company_status_idx" ON "recurring_payables" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "recurring_payables_due_date_idx" ON "recurring_payables" USING btree ("due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "executive_decisions_company_key_unique" ON "executive_decisions" USING btree ("company_id","decision_key");--> statement-breakpoint
CREATE INDEX "executive_decisions_company_resolved_idx" ON "executive_decisions" USING btree ("company_id","resolved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "electronic_registry_branch_unique" ON "electronic_registry_readiness" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "labor_law_rules_effective_range_idx" ON "labor_law_calendar_rules" USING btree ("effective_from");--> statement-breakpoint
CREATE INDEX "labor_law_rules_from_idx" ON "labor_law_calendar_rules" USING btree ("effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "exceptions_company_subject_unique" ON "exceptions" USING btree ("company_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "exceptions_company_status_severity_sla_idx" ON "exceptions" USING btree ("company_id","status","severity","sla_due_at");--> statement-breakpoint
CREATE INDEX "exceptions_company_branch_status_idx" ON "exceptions" USING btree ("company_id","branch_id","status");--> statement-breakpoint
CREATE INDEX "exceptions_owner_status_idx" ON "exceptions" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "evidence_company_entity_idx" ON "evidence" USING btree ("company_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "evidence_company_branch_idx" ON "evidence" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "evidence_created_by_idx" ON "evidence" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_accounts_company_code_unique" ON "accounting_accounts" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "accounting_accounts_parent_idx" ON "accounting_accounts" USING btree ("company_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_events_source_unique" ON "accounting_events" USING btree ("company_id","source_type","source_id","event_type","source_version");--> statement-breakpoint
CREATE INDEX "accounting_events_pending_idx" ON "accounting_events" USING btree ("company_id","status","next_attempt_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_gateway_links_company_acquirer_unique" ON "accounting_gateway_links" USING btree ("company_id","gateway_acquirer");--> statement-breakpoint
CREATE INDEX "accounting_gateway_links_account_idx" ON "accounting_gateway_links" USING btree ("company_id","account_id");--> statement-breakpoint
CREATE INDEX "accounting_journal_lines_journal_idx" ON "accounting_journal_lines" USING btree ("company_id","journal_id");--> statement-breakpoint
CREATE INDEX "accounting_journal_lines_account_idx" ON "accounting_journal_lines" USING btree ("company_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_journals_company_number_unique" ON "accounting_journals" USING btree ("company_id","number") WHERE "accounting_journals"."number" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_journals_source_unique" ON "accounting_journals" USING btree ("company_id","source_type","source_id","event_type","source_version") WHERE "accounting_journals"."source_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "accounting_journals_business_idx" ON "accounting_journals" USING btree ("company_id","status","accounting_date");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_journals_reversal_unique" ON "accounting_journals" USING btree ("company_id","reversal_of_id") WHERE "accounting_journals"."reversal_of_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_journals_replacement_unique" ON "accounting_journals" USING btree ("company_id","replacement_of_id") WHERE "accounting_journals"."replacement_of_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "accounting_opening_documents_opening_idx" ON "accounting_opening_documents" USING btree ("company_id","opening_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_openings_company_unique" ON "accounting_openings" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_openings_journal_unique" ON "accounting_openings" USING btree ("company_id","journal_id");--> statement-breakpoint
CREATE INDEX "accounting_rule_entries_rule_idx" ON "accounting_rule_entries" USING btree ("company_id","rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_rules_company_code_version_unique" ON "accounting_rules" USING btree ("company_id","code","version");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_rules_company_code_from_unique" ON "accounting_rules" USING btree ("company_id","code","effective_from");--> statement-breakpoint
CREATE INDEX "accounting_rules_effective_idx" ON "accounting_rules" USING btree ("company_id","event_type","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_links_cost_center_unique" ON "accounting_source_links" USING btree ("company_id","cost_center_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_links_bank_unique" ON "accounting_source_links" USING btree ("company_id","bank_account_id");--> statement-breakpoint
CREATE INDEX "accounting_links_account_idx" ON "accounting_source_links" USING btree ("company_id","account_id");--> statement-breakpoint
CREATE POLICY "accounting_sales_tenant" ON "accounting_sales_documents" AS PERMISSIVE FOR ALL TO public USING ("accounting_sales_documents"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("accounting_sales_documents"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);--> statement-breakpoint
CREATE POLICY "expense_payments_tenant" ON "expense_payments" AS PERMISSIVE FOR ALL TO public USING ("expense_payments"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("expense_payments"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);--> statement-breakpoint
CREATE POLICY "accounting_accounts_tenant" ON "accounting_accounts" AS PERMISSIVE FOR ALL TO public USING ("accounting_accounts"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("accounting_accounts"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);--> statement-breakpoint
CREATE POLICY "accounting_events_tenant" ON "accounting_events" AS PERMISSIVE FOR ALL TO public USING ("accounting_events"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("accounting_events"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);--> statement-breakpoint
CREATE POLICY "accounting_gateway_links_tenant" ON "accounting_gateway_links" AS PERMISSIVE FOR ALL TO public USING ("accounting_gateway_links"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("accounting_gateway_links"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);--> statement-breakpoint
CREATE POLICY "accounting_journal_lines_tenant" ON "accounting_journal_lines" AS PERMISSIVE FOR ALL TO public USING ("accounting_journal_lines"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("accounting_journal_lines"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);--> statement-breakpoint
CREATE POLICY "accounting_journals_tenant" ON "accounting_journals" AS PERMISSIVE FOR ALL TO public USING ("accounting_journals"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("accounting_journals"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);--> statement-breakpoint
CREATE POLICY "accounting_opening_documents_tenant" ON "accounting_opening_documents" AS PERMISSIVE FOR ALL TO public USING ("accounting_opening_documents"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("accounting_opening_documents"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);--> statement-breakpoint
CREATE POLICY "accounting_openings_tenant" ON "accounting_openings" AS PERMISSIVE FOR ALL TO public USING ("accounting_openings"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("accounting_openings"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);--> statement-breakpoint
CREATE POLICY "accounting_rule_entries_tenant" ON "accounting_rule_entries" AS PERMISSIVE FOR ALL TO public USING ("accounting_rule_entries"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("accounting_rule_entries"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);--> statement-breakpoint
CREATE POLICY "accounting_rules_tenant" ON "accounting_rules" AS PERMISSIVE FOR ALL TO public USING ("accounting_rules"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("accounting_rules"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);--> statement-breakpoint
CREATE POLICY "accounting_links_tenant" ON "accounting_source_links" AS PERMISSIVE FOR ALL TO public USING ("accounting_source_links"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("accounting_source_links"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);
--> statement-breakpoint
-- Fuente 0103_tenant_rls_evidence
-- SEC-04 (Fase 2): RLS piloto sobre el dominio de evidencia.
--
-- Frontera de aislamiento en la BASE, no sólo en el servicio: la política exige
-- que `company_id` coincida con `app.current_company_id`, que la aplicación fija
-- con `set_config(..., is_local => true)` dentro de la transacción del actor
-- (`lib/db/tenant-context.ts`). Sin ajuste, `current_setting(..., true)` es NULL
-- (o cadena vacía cuando una conexión reutilizada ya revirtió un ajuste local)
-- y `NULLIF(..., '')::uuid` deja la comparación en NULL: la fila queda
-- invisible/rechazada. Es decir, rechazo por defecto.
--
-- El rol de MIGRACIÓN (dueño de la tabla) conserva su bypass para DDL y seeds;
-- el rol de RUNTIME debe ser NOBYPassrls y no dueño. `ENABLE` (sin `FORCE`)
-- deja ese reparto explícito; SEC-05 replica el patrón por dominio y en tablas
-- hijas. No se habilita RLS en las 173 tablas de una sola vez.
ALTER TABLE "evidence" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Si el rol de runtime ya existe (provisto por operación), se le dan los
-- privilegios mínimos del piloto. El rol NO se crea aquí para no sembrar
-- credenciales en el historial de migraciones.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
		GRANT USAGE ON SCHEMA "public" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "evidence" TO "pulso_app";
	END IF;
END $$;
--> statement-breakpoint
CREATE POLICY "evidence_tenant_isolation" ON "evidence"
	USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
	WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);

--> statement-breakpoint
-- Fuente 0104_rls_receiving
-- SEC-05.recepcion (Fase 2): RLS por lote sobre el dominio de recepción.
--
-- Primer lote de SEC-05 tras el piloto `evidence` (SEC-04). Cubre una tabla raíz
-- con `company_id` (`receiving_reports`) y su tabla hija SIN `company_id`
-- (`receiving_report_items`), que se acota por el reporte padre. Mismo patrón de
-- rechazo por defecto: `NULLIF(current_setting('app.current_company_id', true), '')::uuid`.
--
-- Excepciones / límites declarados (aceptación 3):
-- - `inventory_batches`, `inventory_movements`, `inventory_*` y demás tablas del
--   dominio inventario NO se incluyen en este lote: quedan fuera y se migrarán
--   en sus propias subtareas SEC-05.*; no se declara cobertura universal.
-- - El rol dueño/migración conserva su bypass; el runtime debe ser NOBYPASSRLS.
ALTER TABLE "receiving_reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "receiving_report_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
		GRANT USAGE ON SCHEMA "public" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "receiving_reports" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "receiving_report_items" TO "pulso_app";
	END IF;
END $$;
--> statement-breakpoint
CREATE POLICY "receiving_reports_tenant_isolation" ON "receiving_reports"
	USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
	WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- La línea hija no tiene `company_id`: se aísla vía su reporte padre. La
-- subconsulta también queda filtrada por la política de `receiving_reports`.
CREATE POLICY "receiving_report_items_tenant_isolation" ON "receiving_report_items"
	USING (EXISTS (
		SELECT 1 FROM "receiving_reports" r
		WHERE r.id = "receiving_report_items"."receiving_report_id"
		  AND r.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
	))
	WITH CHECK (EXISTS (
		SELECT 1 FROM "receiving_reports" r
		WHERE r.id = "receiving_report_items"."receiving_report_id"
		  AND r.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
	));

--> statement-breakpoint
-- Fuente 0105_rls_inventory_monitoring
-- SEC-05.inventario-monitoreo (Fase 2): RLS por lote sobre las salidas de
-- monitoreo de inventario.
--
-- Lote pequeño y de bajo radio: `inventory_snapshots` (cierre calculado vs
-- contado) y `inventory_expiration_alerts` (anti-spam de vencimientos) tienen
-- `company_id` directo y un único servicio dueño cada una. Igual que los lotes
-- anteriores, rechazo por defecto con
-- `NULLIF(current_setting('app.current_company_id', true), '')::uuid`.
--
-- Excepciones / límites declarados (aceptación 3):
-- - `inventory_items`, `inventory_batches` y `inventory_movements` NO entran en
--   este lote: son tablas centrales tocadas por decenas de servicios y exigen su
--   propia subtarea con el wiring del servicio de inventario; no se declara
--   cobertura universal.
-- - El cron de vencimientos recorre EMPRESAS: escribe con el `companyId` de cada
--   lote (alcance explícito), no con un rol privilegiado.
ALTER TABLE "inventory_snapshots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory_expiration_alerts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
		GRANT USAGE ON SCHEMA "public" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "inventory_snapshots" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "inventory_expiration_alerts" TO "pulso_app";
	END IF;
END $$;
--> statement-breakpoint
CREATE POLICY "inventory_snapshots_tenant_isolation" ON "inventory_snapshots"
	USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
	WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "inventory_expiration_alerts_tenant_isolation" ON "inventory_expiration_alerts"
	USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
	WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);

--> statement-breakpoint
-- Fuente 0106_rls_stock_counts
-- SEC-05.inventario-conteos (Fase 2): RLS por lote sobre los conteos físicos.
--
-- `stock_counts` tiene `company_id` directo y un único escritor
-- (`stock-count-from-workflow`) más dos lectores (`inventory-reports-service`,
-- `inventory-snapshot-service`). Rechazo por defecto con
-- `NULLIF(current_setting('app.current_company_id', true), '')::uuid`.
--
-- Excepciones / límites declarados (aceptación 3):
-- - `inventory_items`, `inventory_batches` y `inventory_movements` NO entran en
--   este lote (38 y 18 archivos las tocan; requieren su propia subtarea con el
--   wiring de todos sus productores). No se declara cobertura universal.
-- - `inventory_periods` tampoco: se aborda en su propia subtarea.
-- - El rol dueño/migración conserva su bypass; el runtime debe ser NOBYPASSRLS.
ALTER TABLE "stock_counts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
		GRANT USAGE ON SCHEMA "public" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "stock_counts" TO "pulso_app";
	END IF;
END $$;
--> statement-breakpoint
CREATE POLICY "stock_counts_tenant_isolation" ON "stock_counts"
	USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
	WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);

--> statement-breakpoint
-- Fuente 0123_rls_nomina
-- OPS-02.nomina.E: lote aditivo de RLS para nómina ordinaria, aguinaldo y CFDI.
--
-- Cuatro tablas, tres formas de frontera:
-- - `payroll_runs` y `cfdi_nomina_timbrados` tienen `company_id` directo.
-- - `payroll_payslips` no tiene `company_id`: se acota por su corrida padre.
-- - `payroll_aguinaldo_dispersiones` tiene `company_id` y un `run_id` opcional;
--   cuando hay corrida, la empresa declarada debe coincidir con la del padre.
--
-- Mismo rechazo por defecto que los lotes SEC-04/SEC-05:
-- `NULLIF(current_setting('app.current_company_id', true), '')::uuid`.
--
-- Límites declarados:
-- - El rol dueño/migración conserva su bypass; el runtime debe ser NOBYPASSRLS.
--   No se usa FORCE ROW LEVEL SECURITY para no romper las rutas del dueño.
-- - No crea roles ni credenciales: sólo otorga privilegios si `pulso_app` ya
--   existe (lo aprovisiona el entorno, no este SQL).
-- - No incluye otras tablas de nómina/tesorería ni se aplica al operativo;
--   OPS-03 conserva la activación.
ALTER TABLE "payroll_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payroll_payslips" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payroll_aguinaldo_dispersiones" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cfdi_nomina_timbrados" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
		GRANT USAGE ON SCHEMA "public" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_runs" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_payslips" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_aguinaldo_dispersiones" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "cfdi_nomina_timbrados" TO "pulso_app";
	END IF;
END $$;
--> statement-breakpoint
CREATE POLICY "payroll_runs_tenant_isolation" ON "payroll_runs"
	USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
	WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- La línea hija no tiene `company_id`: se aísla vía su corrida padre. La
-- subconsulta queda filtrada además por la política de `payroll_runs`, de modo
-- que un cambio de `run_id` hacia una corrida ajena también se rechaza.
CREATE POLICY "payroll_payslips_tenant_isolation" ON "payroll_payslips"
	USING (EXISTS (
		SELECT 1 FROM "payroll_runs" r
		WHERE r.id = "payroll_payslips"."run_id"
		  AND r.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
	))
	WITH CHECK (EXISTS (
		SELECT 1 FROM "payroll_runs" r
		WHERE r.id = "payroll_payslips"."run_id"
		  AND r.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
	));
--> statement-breakpoint
-- Bitácora de dispersión: la empresa declarada manda, pero si la fila referencia
-- una corrida, esa corrida debe pertenecer a la misma empresa del contexto. Así
-- no se puede registrar una dispersión de A colgada de una corrida de B.
CREATE POLICY "payroll_aguinaldo_dispersiones_tenant_isolation" ON "payroll_aguinaldo_dispersiones"
	USING (
		company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
		AND (
			"payroll_aguinaldo_dispersiones"."run_id" IS NULL
			OR EXISTS (
				SELECT 1 FROM "payroll_runs" r
				WHERE r.id = "payroll_aguinaldo_dispersiones"."run_id"
				  AND r.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
			)
		)
	)
	WITH CHECK (
		company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
		AND (
			"payroll_aguinaldo_dispersiones"."run_id" IS NULL
			OR EXISTS (
				SELECT 1 FROM "payroll_runs" r
				WHERE r.id = "payroll_aguinaldo_dispersiones"."run_id"
				  AND r.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
			)
		)
	);
--> statement-breakpoint
CREATE POLICY "cfdi_nomina_timbrados_tenant_isolation" ON "cfdi_nomina_timbrados"
	USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
	WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);

--> statement-breakpoint
-- Fuente 0126_fc05_account_guards
-- FC-05: no data backfill or automatic mappings. The application already sets
-- app.current_company_id transaction-locally through withCompanyContext.
ALTER TABLE "public"."accounting_accounts" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
-- Fuente 0126_fc05_account_guards

ALTER TABLE "public"."accounting_source_links" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
-- Fuente 0126_fc05_account_guards

-- VOLATILE uses a fresh snapshot for each query at READ COMMITTED. Serialize
-- validation per company so concurrent reparenting cannot create write skew.
-- Other isolation levels are rejected rather than silently using stale reads.
CREATE FUNCTION "public"."accounting_accounts_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Account changes require READ COMMITTED' USING ERRCODE = '0A000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text, 505));
  IF TG_OP = 'UPDATE' AND (OLD.id, OLD.company_id, OLD.code, OLD.kind, OLD.normal_balance)
    IS DISTINCT FROM (NEW.id, NEW.company_id, NEW.code, NEW.kind, NEW.normal_balance) THEN
    RAISE EXCEPTION 'Account identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id FROM "public"."accounting_accounts"
        WHERE company_id = NEW.company_id AND id = NEW.parent_id
      UNION
      SELECT p.id, p.parent_id FROM "public"."accounting_accounts" p JOIN ancestors a ON p.id = a.parent_id
        WHERE p.company_id = NEW.company_id
    ) SELECT 1 FROM ancestors WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Account hierarchy cycle' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "public"."accounting_accounts" p
    WHERE p.company_id = NEW.company_id AND p.id = NEW.parent_id AND (p.kind <> NEW.kind OR p.postable)) THEN
    RAISE EXCEPTION 'Parent must be a non-postable account of the same kind' USING ERRCODE = '23514';
  END IF;
  IF NEW.postable AND EXISTS (SELECT 1 FROM "public"."accounting_accounts" c
    WHERE c.company_id = NEW.company_id AND c.parent_id = NEW.id) THEN
    RAISE EXCEPTION 'An account with children cannot be postable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
-- Fuente 0126_fc05_account_guards

CREATE TRIGGER accounting_accounts_validate AFTER INSERT OR UPDATE ON "public"."accounting_accounts"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_accounts_guard"();

--> statement-breakpoint
-- Fuente 0126_fc05_account_guards

CREATE FUNCTION "public"."accounting_source_links_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE target_kind text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Account link changes require READ COMMITTED' USING ERRCODE = '0A000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text, 505));
  IF TG_OP = 'UPDATE' AND (OLD.id, OLD.company_id) IS DISTINCT FROM (NEW.id, NEW.company_id) THEN
    RAISE EXCEPTION 'Link identity is immutable' USING ERRCODE = '23514';
  END IF;
  SELECT kind INTO target_kind FROM "public"."accounting_accounts"
    WHERE company_id = NEW.company_id AND id = NEW.account_id AND active AND postable;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Link target must be an active postable account' USING ERRCODE = '23514';
  END IF;
  IF NEW.bank_account_id IS NOT NULL THEN
    IF target_kind <> 'ASSET' OR NOT EXISTS (
      SELECT 1 FROM "public"."company_bank_accounts" WHERE company_id = NEW.company_id
        AND id = NEW.bank_account_id AND active AND currency = 'MXN'
    ) THEN
      RAISE EXCEPTION 'Bank link requires an active MXN own bank account and an asset account' USING ERRCODE = '23514';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM "public"."cost_centers"
    WHERE company_id = NEW.company_id AND id = NEW.cost_center_id AND active) THEN
    RAISE EXCEPTION 'Cost center must be active in this company' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
-- Fuente 0126_fc05_account_guards

CREATE TRIGGER accounting_source_links_validate AFTER INSERT OR UPDATE ON "public"."accounting_source_links"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_source_links_guard"();

--> statement-breakpoint
-- Fuente 0126_fc05_account_guards

-- Reuse the existing runtime DB role. No elevated role or DELETE privilege.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT USAGE ON SCHEMA "public" TO pulso_app;
    GRANT SELECT, INSERT, UPDATE ON "public"."accounting_accounts", "public"."accounting_source_links" TO pulso_app;
    GRANT SELECT (id, company_id, role, active, deleted_at) ON "public"."users" TO pulso_app;
    GRANT SELECT (id, company_id, active) ON "public"."cost_centers" TO pulso_app;
    GRANT SELECT (id, company_id, active, currency) ON "public"."company_bank_accounts" TO pulso_app;
  END IF;
END $$;

--> statement-breakpoint
-- Fuente 0128_fc06_journal_guards
-- FC-06: database boundary for journals. Drafts stay editable; the DRAFT ->
-- POSTED transition re-checks balance, line count, account validity and
-- overflow inside PostgreSQL, so a caller bug cannot publish a bad journal.
-- No data backfill; no journal is created here.
ALTER TABLE "public"."accounting_journals" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
-- Fuente 0128_fc06_journal_guards

ALTER TABLE "public"."accounting_journal_lines" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
-- Fuente 0128_fc06_journal_guards

-- Atomicity: BEFORE triggers run inside the same statement as the status
-- change, so a rejected posting leaves the draft untouched. Identity, source
-- and reversal links are frozen; version only grows.
CREATE FUNCTION "public"."accounting_journals_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  debit_total numeric;
  credit_total numeric;
  line_count integer;
  invalid_account text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Journal changes require READ COMMITTED' USING ERRCODE = '0A000';
  END IF;
  -- Same lock as account changes: validate against committed account state.
  IF TG_OP = 'DELETE' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(OLD.company_id::text, 505));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text, 505));
    IF NEW.branch_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "public"."branches" b
      WHERE b.id = NEW.branch_id AND b.company_id = NEW.company_id AND coalesce(b.active, true)
    ) THEN
      RAISE EXCEPTION 'Journal branch must be active in this company' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM "public"."financial_periods" p
      WHERE p.company_id = NEW.company_id AND p.year = extract(year FROM NEW.accounting_date)
      AND p.month = extract(month FROM NEW.accounting_date) AND p.status = 'CLOSED') THEN
      RAISE EXCEPTION 'Financial period is closed' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM "public"."financial_periods" p
    WHERE p.company_id = OLD.company_id AND p.year = extract(year FROM OLD.accounting_date)
    AND p.month = extract(month FROM OLD.accounting_date) AND p.status = 'CLOSED') THEN
    RAISE EXCEPTION 'Financial period is closed' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Journals must be created as drafts' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Posted journals cannot be deleted' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF (OLD.id, OLD.company_id) IS DISTINCT FROM (NEW.id, NEW.company_id) THEN
    RAISE EXCEPTION 'Journal identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF (OLD.source_type, OLD.source_id, OLD.source_version, OLD.event_type)
    IS DISTINCT FROM (NEW.source_type, NEW.source_id, NEW.source_version, NEW.event_type) THEN
    RAISE EXCEPTION 'Journal source is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.reversal_of_id IS DISTINCT FROM NEW.reversal_of_id THEN
    RAISE EXCEPTION 'Journal reversal link is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.version <= OLD.version THEN
    RAISE EXCEPTION 'Journal version must grow on every edit' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'Posted journals are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'POSTED' THEN
    IF NEW.number IS NULL OR NEW.posted_at IS NULL OR NEW.posted_by IS NULL THEN
      RAISE EXCEPTION 'Posted journal requires number, actor and timestamp' USING ERRCODE = '23514';
    END IF;
    SELECT count(*), coalesce(sum(l.debit_cents), 0), coalesce(sum(l.credit_cents), 0)
      INTO line_count, debit_total, credit_total
      FROM "public"."accounting_journal_lines" l
      WHERE l.company_id = NEW.company_id AND l.journal_id = NEW.id;
    IF line_count < 2 THEN
      RAISE EXCEPTION 'Journal needs at least two lines to post' USING ERRCODE = '23514';
    END IF;
    IF debit_total <> credit_total THEN
      RAISE EXCEPTION 'Journal debits and credits differ' USING ERRCODE = '23514';
    END IF;
    IF debit_total > 9007199254740991 THEN
      RAISE EXCEPTION 'Journal total exceeds the safe integer range' USING ERRCODE = '23514';
    END IF;
    SELECT a.code INTO invalid_account
      FROM "public"."accounting_accounts" a
      WHERE a.company_id = NEW.company_id
        AND a.id IN (SELECT l.account_id FROM "public"."accounting_journal_lines" l
          WHERE l.company_id = NEW.company_id AND l.journal_id = NEW.id)
        AND (NOT a.active OR NOT a.postable
          OR a.valid_from > NEW.accounting_date
          OR (a.valid_to IS NOT NULL AND a.valid_to < NEW.accounting_date))
      LIMIT 1;
    IF invalid_account IS NOT NULL THEN
      RAISE EXCEPTION 'Journal account % is not active, postable or valid at the accounting date', invalid_account
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
-- Fuente 0128_fc06_journal_guards

CREATE TRIGGER accounting_journals_validate BEFORE INSERT OR UPDATE OR DELETE ON "public"."accounting_journals"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_journals_guard"();

--> statement-breakpoint
-- Fuente 0128_fc06_journal_guards

-- Lines: only drafts accept changes, and the account/center must live in the
-- same company. Deleting a journal cascades lines after the parent row is gone,
-- so a missing parent is accepted on DELETE only.
CREATE FUNCTION "public"."accounting_journal_lines_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  parent_status text;
  parent_date date;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Journal changes require READ COMMITTED' USING ERRCODE = '0A000';
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD.id, OLD.company_id, OLD.journal_id)
    IS DISTINCT FROM (NEW.id, NEW.company_id, NEW.journal_id) THEN
    RAISE EXCEPTION 'Journal line identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(OLD.company_id::text, 505));
    SELECT j.status, j.accounting_date INTO parent_status, parent_date FROM "public"."accounting_journals" j
      WHERE j.company_id = OLD.company_id AND j.id = OLD.journal_id FOR UPDATE;
    IF FOUND AND parent_status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Posted journal lines are immutable' USING ERRCODE = '23514';
    END IF;
    IF FOUND AND EXISTS (SELECT 1 FROM "public"."financial_periods" p
      WHERE p.company_id = OLD.company_id AND p.year = extract(year FROM parent_date)
      AND p.month = extract(month FROM parent_date) AND p.status = 'CLOSED') THEN
      RAISE EXCEPTION 'Financial period is closed' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text, 505));
  SELECT j.status, j.accounting_date INTO parent_status, parent_date FROM "public"."accounting_journals" j
    WHERE j.company_id = NEW.company_id AND j.id = NEW.journal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal line requires its journal in the same company' USING ERRCODE = '23503';
  END IF;
  IF parent_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Posted journal lines are immutable' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "public"."financial_periods" p
    WHERE p.company_id = NEW.company_id AND p.year = extract(year FROM parent_date)
    AND p.month = extract(month FROM parent_date) AND p.status = 'CLOSED') THEN
    RAISE EXCEPTION 'Financial period is closed' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "public"."accounting_accounts" a
    WHERE a.company_id = NEW.company_id AND a.id = NEW.account_id AND a.active AND a.postable) THEN
    RAISE EXCEPTION 'Journal line account must be active and postable' USING ERRCODE = '23514';
  END IF;
  IF NEW.cost_center_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "public"."cost_centers" c
      WHERE c.company_id = NEW.company_id AND c.id = NEW.cost_center_id AND c.active
  ) THEN
    RAISE EXCEPTION 'Journal line cost center must be active in this company' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
-- Fuente 0128_fc06_journal_guards

CREATE TRIGGER accounting_journal_lines_validate BEFORE INSERT OR UPDATE OR DELETE ON "public"."accounting_journal_lines"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_journal_lines_guard"();

--> statement-breakpoint
-- Fuente 0128_fc06_journal_guards

-- Reuse the existing runtime DB role. DELETE is needed for drafts only and the
-- triggers above reject it on posted journals.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "public"."accounting_journals", "public"."accounting_journal_lines" TO pulso_app;
    GRANT SELECT (id, company_id, active) ON "public"."branches" TO pulso_app;
    GRANT SELECT (company_id, year, month, status) ON "public"."financial_periods" TO pulso_app;
  END IF;
END $$;

--> statement-breakpoint
-- Fuente 0129_fc07_review

-- Supplement FC-06 without changing already posted rows or backfilling motives.
CREATE FUNCTION "public"."accounting_journals_review_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE original "public"."accounting_journals"%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Journal changes require READ COMMITTED' USING ERRCODE = '0A000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text,505));
  IF TG_OP = 'UPDATE' AND OLD.replacement_of_id IS DISTINCT FROM NEW.replacement_of_id THEN
    RAISE EXCEPTION 'Replacement link is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'POSTED' AND NEW.posting_reason IS NULL THEN
    RAISE EXCEPTION 'Posting requires an explicit reason' USING ERRCODE = '23514';
  END IF;
  IF coalesce(NEW.reversal_of_id,NEW.replacement_of_id) IS NOT NULL THEN
    SELECT * INTO original FROM "public"."accounting_journals"
      WHERE company_id=NEW.company_id AND id=coalesce(NEW.reversal_of_id,NEW.replacement_of_id);
    IF NOT FOUND OR original.status <> 'POSTED' OR original.reversal_of_id IS NOT NULL
      OR NEW.branch_id IS DISTINCT FROM original.branch_id OR NEW.accounting_date < original.accounting_date THEN
      RAISE EXCEPTION 'Correction requires a posted original in the same branch and a non-earlier date' USING ERRCODE = '23514';
    END IF;
    IF NEW.replacement_of_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "public"."accounting_journals" WHERE company_id=NEW.company_id
        AND reversal_of_id=original.id AND status='POSTED' AND accounting_date=NEW.accounting_date
    ) THEN
      RAISE EXCEPTION 'Replacement requires a posted reversal' USING ERRCODE = '23514';
    END IF;
    IF NEW.status='POSTED' AND NEW.reversal_of_id IS NOT NULL AND EXISTS (
      (SELECT account_id,cost_center_id,debit_cents,credit_cents FROM "public"."accounting_journal_lines"
        WHERE company_id=NEW.company_id AND journal_id=NEW.id
       EXCEPT ALL
       SELECT account_id,cost_center_id,credit_cents,debit_cents FROM "public"."accounting_journal_lines"
        WHERE company_id=NEW.company_id AND journal_id=original.id)
      UNION ALL
      (SELECT account_id,cost_center_id,credit_cents,debit_cents FROM "public"."accounting_journal_lines"
        WHERE company_id=NEW.company_id AND journal_id=original.id
       EXCEPT ALL
       SELECT account_id,cost_center_id,debit_cents,credit_cents FROM "public"."accounting_journal_lines"
        WHERE company_id=NEW.company_id AND journal_id=NEW.id)
    ) THEN
      RAISE EXCEPTION 'Reversal must exactly invert the original lines' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
-- Fuente 0129_fc07_review

CREATE TRIGGER accounting_journals_review_validate BEFORE INSERT OR UPDATE ON "public"."accounting_journals"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_journals_review_guard"();

--> statement-breakpoint
-- Fuente 0129_fc07_review

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT (branch_id) ON "public"."users" TO pulso_app;
  END IF;
END $$;

--> statement-breakpoint
-- Fuente 0130_fc08_rules

ALTER TABLE "public"."accounting_rule_entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Fuente 0130_fc08_rules

ALTER TABLE "public"."accounting_openings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Fuente 0130_fc08_rules

ALTER TABLE "public"."accounting_opening_documents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Fuente 0130_fc08_rules

-- A revision is a new row: version grows by one, effective date advances and the
-- event type cannot change. Editing or deleting a rule would silently rewrite
-- history, so both are rejected.
CREATE FUNCTION "public"."accounting_rules_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  previous "public"."accounting_rules"%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Rule changes require READ COMMITTED' USING ERRCODE = '0A000';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Recognition rules are append-only; create a new version with its own effective date'
      USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text, 507));
  SELECT * INTO previous FROM "public"."accounting_rules" r
    WHERE r.company_id = NEW.company_id AND r.code = NEW.code
    ORDER BY r.version DESC LIMIT 1;
  IF previous.id IS NOT NULL THEN
    IF NEW.supersedes_id IS NULL OR NEW.supersedes_id <> previous.id THEN
      RAISE EXCEPTION 'A new rule version must supersede the current one' USING ERRCODE = '23514';
    END IF;
    IF NEW.version <> previous.version + 1 THEN
      RAISE EXCEPTION 'Rule version must increase by exactly one' USING ERRCODE = '23514';
    END IF;
    IF NEW.effective_from <= previous.effective_from THEN
      RAISE EXCEPTION 'A rule version needs a later effective date' USING ERRCODE = '23514';
    END IF;
    IF NEW.event_type <> previous.event_type THEN
      RAISE EXCEPTION 'Rule event type is immutable across versions' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.supersedes_id IS NOT NULL THEN
      RAISE EXCEPTION 'The first rule version cannot supersede another' USING ERRCODE = '23514';
    END IF;
    IF NEW.version <> 1 THEN
      RAISE EXCEPTION 'The first rule version must be 1' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Fuente 0130_fc08_rules

CREATE TRIGGER accounting_rules_validate BEFORE INSERT OR UPDATE OR DELETE ON "public"."accounting_rules"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_rules_guard"();
--> statement-breakpoint
-- Fuente 0130_fc08_rules

-- Entries of a version are immutable and must map to accounts usable at the
-- rule effective date. Missing accounts are caught again on posting.
CREATE FUNCTION "public"."accounting_rule_entries_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  target "public"."accounting_rules"%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Rule changes require READ COMMITTED' USING ERRCODE = '0A000';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Rule entries are immutable; create a new rule version' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text, 507));
  SELECT * INTO target FROM "public"."accounting_rules" r
    WHERE r.company_id = NEW.company_id AND r.id = NEW.rule_id;
  IF target.id IS NULL THEN
    RAISE EXCEPTION 'Rule not found in this company' USING ERRCODE = '23503';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "public"."accounting_accounts" a
    WHERE a.company_id = NEW.company_id AND a.id = NEW.account_id
      AND a.active AND a.postable AND a.valid_from <= target.effective_from
      AND (a.valid_to IS NULL OR a.valid_to >= target.effective_from)) THEN
    RAISE EXCEPTION 'Rule account must be active, postable and valid at the rule effective date'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.cost_center_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "public"."cost_centers" c
      WHERE c.company_id = NEW.company_id AND c.id = NEW.cost_center_id AND c.active) THEN
    RAISE EXCEPTION 'Rule cost center must be active in this company' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Fuente 0130_fc08_rules

CREATE TRIGGER accounting_rule_entries_validate BEFORE INSERT OR UPDATE OR DELETE ON "public"."accounting_rule_entries"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_rule_entries_guard"();
--> statement-breakpoint
-- Fuente 0130_fc08_rules

-- Posting freezes the applied rule: version must match, the rule must be
-- effective at the accounting date, retired versions are rejected, and every
-- required role must still map to a usable account. A fact without a rule
-- cannot be posted, so a missing rule is visible instead of silently posting.
CREATE FUNCTION "public"."accounting_journals_rule_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  selected "public"."accounting_rules"%ROWTYPE;
  missing_role text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Journal changes require READ COMMITTED' USING ERRCODE = '0A000';
  END IF;
  IF NEW.rule_id IS NULL THEN
    IF NEW.status = 'POSTED' AND NEW.event_type IS NOT NULL THEN
      RAISE EXCEPTION 'A posted fact requires a recognition rule' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO selected FROM "public"."accounting_rules" r
    WHERE r.company_id = NEW.company_id AND r.id = NEW.rule_id;
  IF selected.id IS NULL THEN
    RAISE EXCEPTION 'Rule not found in this company' USING ERRCODE = '23503';
  END IF;
  IF NEW.rule_version IS DISTINCT FROM selected.version THEN
    RAISE EXCEPTION 'Journal rule version does not match the selected rule' USING ERRCODE = '23514';
  END IF;
  IF selected.effective_from > NEW.accounting_date THEN
    RAISE EXCEPTION 'The selected rule is not effective at the accounting date' USING ERRCODE = '23514';
  END IF;
  IF NEW.event_type IS NOT NULL AND NEW.event_type <> selected.event_type THEN
    RAISE EXCEPTION 'Journal fact and rule event type differ' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'POSTED' THEN
    IF NOT selected.active THEN
      RAISE EXCEPTION 'The selected rule version is retired' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "public"."accounting_rule_entries" e
      WHERE e.company_id = NEW.company_id AND e.rule_id = NEW.rule_id) THEN
      RAISE EXCEPTION 'The selected rule has no account mapping' USING ERRCODE = '23514';
    END IF;
    SELECT e.role INTO missing_role FROM "public"."accounting_rule_entries" e
      WHERE e.company_id = NEW.company_id AND e.rule_id = NEW.rule_id AND e.required
        AND NOT EXISTS (SELECT 1 FROM "public"."accounting_accounts" a
          WHERE a.company_id = e.company_id AND a.id = e.account_id
            AND a.active AND a.postable AND a.valid_from <= NEW.accounting_date
            AND (a.valid_to IS NULL OR a.valid_to >= NEW.accounting_date))
      ORDER BY e.role LIMIT 1;
    IF missing_role IS NOT NULL THEN
      RAISE EXCEPTION 'Rule account for role % is not usable at the accounting date', missing_role
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Fuente 0130_fc08_rules

CREATE TRIGGER accounting_journals_rule_validate BEFORE INSERT OR UPDATE ON "public"."accounting_journals"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_journals_rule_guard"();
--> statement-breakpoint
-- Fuente 0130_fc08_rules

-- One opening per company, immutable, dated and sourced as the opening, with no
-- posted history on or before its date.
CREATE FUNCTION "public"."accounting_openings_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  linked "public"."accounting_journals"%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Opening changes require READ COMMITTED' USING ERRCODE = '0A000';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'The opening is immutable; correct it with a journal reversal' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text, 508));
  SELECT * INTO linked FROM "public"."accounting_journals" j
    WHERE j.company_id = NEW.company_id AND j.id = NEW.journal_id;
  IF linked.id IS NULL THEN
    RAISE EXCEPTION 'Opening journal not found in this company' USING ERRCODE = '23503';
  END IF;
  IF linked.source_type IS DISTINCT FROM 'OPENING' OR linked.accounting_date <> NEW.opening_date THEN
    RAISE EXCEPTION 'The opening needs a journal sourced as OPENING and dated as the opening'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "public"."accounting_journals" j
    WHERE j.company_id = NEW.company_id AND j.id <> NEW.journal_id AND j.status = 'POSTED'
      AND j.accounting_date <= NEW.opening_date) THEN
    RAISE EXCEPTION 'The opening cannot overlap posted journals on or before its date'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Fuente 0130_fc08_rules

CREATE TRIGGER accounting_openings_validate BEFORE INSERT OR UPDATE OR DELETE ON "public"."accounting_openings"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_openings_guard"();
--> statement-breakpoint
-- Fuente 0130_fc08_rules

-- The opening must carry at least one supporting document; checked at commit so
-- the service can insert the opening and its documents in one statement.
CREATE FUNCTION "public"."accounting_openings_documents_check"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "public"."accounting_opening_documents" d
    WHERE d.company_id = NEW.company_id AND d.opening_id = NEW.id) THEN
    RAISE EXCEPTION 'The opening requires at least one supporting document' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Fuente 0130_fc08_rules

CREATE CONSTRAINT TRIGGER accounting_openings_documents_required AFTER INSERT ON "public"."accounting_openings"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public"."accounting_openings_documents_check"();
--> statement-breakpoint
-- Fuente 0130_fc08_rules

-- The opening defines the start of the ledger: nothing may be dated on or
-- before it, and posting the opening journal re-checks committed history.
CREATE FUNCTION "public"."accounting_journals_opening_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  opening "public"."accounting_openings"%ROWTYPE;
BEGIN
  SELECT * INTO opening FROM "public"."accounting_openings" o
    WHERE o.company_id = NEW.company_id AND o.journal_id = NEW.id;
  IF opening.id IS NULL THEN
    IF EXISTS (SELECT 1 FROM "public"."accounting_openings" o
      WHERE o.company_id = NEW.company_id AND o.opening_date >= NEW.accounting_date) THEN
      RAISE EXCEPTION 'Journals cannot be dated on or before the opening' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status <> 'POSTED' THEN
    RETURN NEW;
  END IF;
  IF opening.opening_date <> NEW.accounting_date THEN
    RAISE EXCEPTION 'The opening journal date must match the opening date' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "public"."accounting_journals" j
    WHERE j.company_id = NEW.company_id AND j.id <> NEW.id AND j.status = 'POSTED'
      AND j.accounting_date <= opening.opening_date) THEN
    RAISE EXCEPTION 'The opening cannot overlap posted journals on or before its date'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Fuente 0130_fc08_rules

CREATE TRIGGER accounting_journals_opening_validate BEFORE INSERT OR UPDATE ON "public"."accounting_journals"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_journals_opening_guard"();
--> statement-breakpoint
-- Fuente 0130_fc08_rules

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT, INSERT ON "public"."accounting_rules", "public"."accounting_rule_entries",
      "public"."accounting_openings", "public"."accounting_opening_documents" TO pulso_app;
  END IF;
END $$;
--> statement-breakpoint
-- Fuente 0131_fc09_expense_payments

ALTER TABLE "public"."expense_payments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Fuente 0131_fc09_expense_payments

CREATE FUNCTION "public"."expense_payments_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  expense "public"."operating_expenses"%ROWTYPE;
  item "public"."payment_run_items"%ROWTYPE;
  run_company uuid;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Expense payments require READ COMMITTED' USING ERRCODE = '0A000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Expense payments are append-only; settle with a new application' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.id, OLD.company_id, OLD.branch_id, OLD.expense_id, OLD.amount_cents,
        OLD.source, OLD.payment_run_item_id, OLD.created_by, OLD.created_at)
      IS DISTINCT FROM
       (NEW.id, NEW.company_id, NEW.branch_id, NEW.expense_id, NEW.amount_cents,
        NEW.source, NEW.payment_run_item_id, NEW.created_by, NEW.created_at) THEN
      RAISE EXCEPTION 'Expense payment identity and amount are immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.status = 'CONFIRMED' THEN
      -- A confirmed fact is immutable. Only recovery metadata may advance:
      -- linking its posted journal and clearing/updating the pending reason.
      IF (OLD.status, OLD.paid_at, OLD.payment_method, OLD.reference, OLD.failure_reason,
          OLD.confirmed_by, OLD.confirmed_at) IS DISTINCT FROM
         (NEW.status, NEW.paid_at, NEW.payment_method, NEW.reference, NEW.failure_reason,
          NEW.confirmed_by, NEW.confirmed_at)
        OR (OLD.accounting_journal_id IS NOT NULL AND
          OLD.accounting_journal_id IS DISTINCT FROM NEW.accounting_journal_id) THEN
        RAISE EXCEPTION 'Confirmed expense payments are immutable' USING ERRCODE = '23514';
      END IF;
    ELSIF OLD.status <> 'PENDING' THEN
      RAISE EXCEPTION 'Only a pending expense payment can be settled' USING ERRCODE = '23514';
    ELSIF NEW.status = 'PENDING' THEN
      RAISE EXCEPTION 'A settled payment cannot return to pending' USING ERRCODE = '23514';
    END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text, 509));
  SELECT * INTO expense FROM "public"."operating_expenses" e
    WHERE e.company_id = NEW.company_id AND e.id = NEW.expense_id FOR UPDATE;
  IF expense.id IS NULL THEN
    RAISE EXCEPTION 'Expense payment requires an expense in this company' USING ERRCODE = '23503';
  END IF;
  IF NEW.branch_id <> expense.branch_id THEN
    RAISE EXCEPTION 'Expense payment branch must match the expense branch' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "public"."financial_periods" p WHERE p.company_id = NEW.company_id
    AND p.year = extract(year FROM NEW.paid_at) AND p.month = extract(month FROM NEW.paid_at) AND p.status = 'CLOSED') THEN
    RAISE EXCEPTION 'Expense payment period is closed' USING ERRCODE = '23514';
  END IF;
  IF NEW.paid_at < expense.business_date THEN
    RAISE EXCEPTION 'Expense payment cannot precede expense recognition' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "public"."users" u WHERE u.id = NEW.created_by
    AND u.company_id = NEW.company_id AND u.active AND u.deleted_at IS NULL)
    OR (NEW.confirmed_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "public"."users" u
      WHERE u.id = NEW.confirmed_by AND u.company_id = NEW.company_id AND u.active AND u.deleted_at IS NULL)) THEN
    RAISE EXCEPTION 'Expense payment actor must be active in this company' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "public"."branches" b
    WHERE b.id = NEW.branch_id AND b.company_id = NEW.company_id AND coalesce(b.active, true)) THEN
    RAISE EXCEPTION 'Expense payment branch must be active in this company' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'CONFIRMED' AND expense.status NOT IN ('APPROVED', 'PAID') THEN
    RAISE EXCEPTION 'Only an approved expense can be paid' USING ERRCODE = '23514';
  END IF;
  IF NEW.source = 'TREASURY' THEN
    SELECT i.id, i.payment_run_id, i.item_type, i.reference_id, i.amount_cents, i.settlement_status
      INTO item.id, item.payment_run_id, item.item_type, item.reference_id, item.amount_cents, item.settlement_status
      FROM "public"."payment_run_items" i
      WHERE i.id = NEW.payment_run_item_id;
    SELECT r.company_id INTO run_company FROM "public"."payment_runs" r WHERE r.id = item.payment_run_id;
    IF item.id IS NULL THEN
      RAISE EXCEPTION 'Expense payment requires its treasury item' USING ERRCODE = '23503';
    END IF;
    IF run_company <> NEW.company_id OR item.item_type <> 'OPERATING_EXPENSE'
      OR item.reference_id <> NEW.expense_id::text THEN
      RAISE EXCEPTION 'Treasury item does not pay this expense in this company' USING ERRCODE = '23514';
    END IF;
    IF item.amount_cents <> NEW.amount_cents THEN
      RAISE EXCEPTION 'Expense payment amount must match its treasury item' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'CONFIRMED' AND item.settlement_status <> 'CONFIRMED' THEN
      RAISE EXCEPTION 'Treasury item must be confirmed before its application' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.accounting_journal_id IS NOT NULL THEN
    IF NEW.status <> 'CONFIRMED' THEN
      RAISE EXCEPTION 'Only a confirmed payment links its journal' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "public"."accounting_journals" j
      WHERE j.company_id = NEW.company_id AND j.id = NEW.accounting_journal_id
        AND j.status = 'POSTED' AND j.source_type = 'EXPENSE_PAYMENT'
        AND j.source_id = NEW.id::text) THEN
      RAISE EXCEPTION 'Expense payment journal must be posted from this application' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Fuente 0131_fc09_expense_payments

CREATE TRIGGER expense_payments_validate BEFORE INSERT OR UPDATE OR DELETE ON "public"."expense_payments"
FOR EACH ROW EXECUTE FUNCTION "public"."expense_payments_guard"();
--> statement-breakpoint
-- Fuente 0131_fc09_expense_payments

CREATE FUNCTION "public"."expense_payments_total_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  expense_amount integer;
  confirmed_total bigint;
BEGIN
  IF NEW.status <> 'CONFIRMED' THEN
    RETURN NEW;
  END IF;
  SELECT e.amount INTO expense_amount FROM "public"."operating_expenses" e
    WHERE e.company_id = NEW.company_id AND e.id = NEW.expense_id;
  IF expense_amount IS NULL THEN
    RAISE EXCEPTION 'Expense payment requires an expense in this company' USING ERRCODE = '23503';
  END IF;
  SELECT coalesce(sum(p.amount_cents), 0) INTO confirmed_total
    FROM "public"."expense_payments" p
    WHERE p.company_id = NEW.company_id AND p.expense_id = NEW.expense_id AND p.status = 'CONFIRMED';
  IF confirmed_total > expense_amount THEN
    RAISE EXCEPTION 'Confirmed payments exceed the expense amount' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Fuente 0131_fc09_expense_payments

CREATE CONSTRAINT TRIGGER expense_payments_total_check AFTER INSERT OR UPDATE ON "public"."expense_payments"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public"."expense_payments_total_guard"();
--> statement-breakpoint
-- Fuente 0131_fc09_expense_payments

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "public"."expense_payments" TO pulso_app;
    -- The adapter reads the expense row and locks it before checking the balance.
    -- Only settlement fields may be changed; no INSERT/DELETE or amount edits.
    GRANT SELECT ON "public"."operating_expenses" TO pulso_app;
    GRANT UPDATE (status, paid_at, paid_by, payment_method, updated_at) ON "public"."operating_expenses" TO pulso_app;
    GRANT SELECT (id) ON "public"."financial_periods" TO pulso_app;
    GRANT SELECT (id, payment_run_id, item_type, reference_id, amount_cents, settlement_status) ON "public"."payment_run_items" TO pulso_app;
    GRANT SELECT (id, company_id, status) ON "public"."payment_runs" TO pulso_app;
  END IF;
END $$;

--> statement-breakpoint
-- Fuente 0132_fc09_treasury_source

-- No backfill: a legacy account number is not a verified bank identity.
-- Freeze both the selected identity and the number used by the signed layout.
CREATE FUNCTION "public"."payment_runs_source_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.company_id, OLD.source_bank_account_id, OLD.source_account, OLD.currency)
      IS NOT DISTINCT FROM (NEW.company_id, NEW.source_bank_account_id, NEW.source_account, NEW.currency) THEN
      RETURN NEW;
    END IF;
    IF OLD.source_bank_account_id IS NOT NULL OR OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'The treasury source identity and number are frozen; prepare a new run'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.source_bank_account_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM "public"."company_bank_accounts" b
      WHERE b.company_id = NEW.company_id AND b.id = NEW.source_bank_account_id) THEN
      RAISE EXCEPTION 'Treasury source must belong to this company' USING ERRCODE = '23503';
    END IF;
    IF NEW.currency <> 'MXN' OR NOT EXISTS (SELECT 1 FROM "public"."company_bank_accounts" b
      WHERE b.company_id = NEW.company_id AND b.id = NEW.source_bank_account_id AND b.active AND b.currency = 'MXN')
      OR nullif(btrim(NEW.source_account), '') IS NULL THEN
      RAISE EXCEPTION 'Treasury source requires an active MXN own bank account and its number'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Fuente 0132_fc09_treasury_source

CREATE TRIGGER payment_runs_source_validate BEFORE INSERT OR UPDATE OF company_id, source_bank_account_id, source_account, currency
ON "public"."payment_runs" FOR EACH ROW EXECUTE FUNCTION "public"."payment_runs_source_guard"();
--> statement-breakpoint
-- Fuente 0132_fc09_treasury_source

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT (source_bank_account_id) ON "public"."payment_runs" TO pulso_app;
  END IF;
END $$;

--> statement-breakpoint
-- Fuente 0133_fc10_accounting_events

ALTER TABLE "public"."accounting_events" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
-- Fuente 0133_fc10_accounting_events

CREATE FUNCTION "public"."accounting_events_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM "public"."branches" b
    WHERE b.id = NEW.branch_id AND b.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'La sucursal no pertenece a la empresa del hecho' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los hechos contables no se eliminan' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    ROW(NEW.id, NEW.company_id, NEW.branch_id, NEW.source_type, NEW.source_id,
      NEW.event_type, NEW.source_version, NEW.actor_id, NEW.accounting_date, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.company_id, OLD.branch_id, OLD.source_type, OLD.source_id,
      OLD.event_type, OLD.source_version, OLD.actor_id, OLD.accounting_date, OLD.created_at)
    OR (OLD.status = 'POSTED' AND NEW IS DISTINCT FROM OLD)) THEN
    RAISE EXCEPTION 'La identidad del hecho y su publicación son inmutables' USING ERRCODE = '23514';
  END IF;
  IF NEW.journal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "public"."accounting_journals" j
    WHERE j.company_id = NEW.company_id AND j.id = NEW.journal_id AND j.status = 'POSTED'
      AND j.source_type = NEW.source_type AND j.source_id = NEW.source_id::text
      AND j.event_type = NEW.event_type AND j.source_version = NEW.source_version) THEN
    RAISE EXCEPTION 'La póliza no corresponde al hecho publicado' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
-- Fuente 0133_fc10_accounting_events

CREATE TRIGGER accounting_events_guard BEFORE INSERT OR UPDATE OR DELETE
ON "public"."accounting_events" FOR EACH ROW EXECUTE FUNCTION "public"."accounting_events_guard"();

--> statement-breakpoint
-- Fuente 0133_fc10_accounting_events

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT (id) ON "public"."companies" TO pulso_app;
    GRANT SELECT, INSERT ON "public"."accounting_events" TO pulso_app;
    GRANT UPDATE (status, journal_id, attempts, last_error, next_attempt_at, updated_at)
      ON "public"."accounting_events" TO pulso_app;
  END IF;
END $$;

--> statement-breakpoint
-- Fuente 0134_fc11_sales

ALTER TABLE "public"."accounting_sales_documents" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
-- Fuente 0134_fc11_sales

CREATE FUNCTION "public"."accounting_sales_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source "public"."daily_sales_cuts"%ROWTYPE;
  original "public"."accounting_sales_documents"%ROWTYPE;
  amount_column text;
  returned bigint;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'El documento contable de venta es inmutable' USING ERRCODE = '23514';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Las declaraciones requieren READ COMMITTED para reservar saldos actuales' USING ERRCODE = '0A000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text, 601));
  IF NOT EXISTS (SELECT 1 FROM "public"."branches" b WHERE b.id = NEW.branch_id
    AND b.company_id = NEW.company_id AND b.active AND b.ownership_type = 'OWNED')
    OR NOT EXISTS (SELECT 1 FROM "public"."users" u WHERE u.id = NEW.created_by
      AND u.company_id = NEW.company_id AND u.active AND u.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Empresa, sucursal o actor inválidos' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "public"."financial_periods" p WHERE p.company_id=NEW.company_id
    AND p.year=extract(year from NEW.business_date) AND p.month=extract(month from NEW.business_date) AND p.status='CLOSED') THEN
    RAISE EXCEPTION 'El periodo está cerrado' USING ERRCODE='23514';
  END IF;
  SELECT * INTO source FROM "public"."daily_sales_cuts" c WHERE c.id = NEW.cut_id AND c.company_id = NEW.company_id;
  IF NOT FOUND OR source.branch_id <> NEW.branch_id THEN
    RAISE EXCEPTION 'El corte no pertenece a esta empresa y sucursal' USING ERRCODE = '23514';
  END IF;
  IF NEW.original_id IS NOT NULL THEN
    SELECT * INTO original FROM "public"."accounting_sales_documents" d
      WHERE d.id = NEW.original_id AND d.company_id = NEW.company_id;
    IF NOT FOUND OR original.kind <> 'SALE' OR original.branch_id <> NEW.branch_id OR original.cut_id <> NEW.cut_id
      OR (NEW.kind = 'SALE' AND NEW.version <> original.version + 1)
      OR (NEW.kind = 'REFUND' AND (NEW.business_date < original.business_date
        OR NEW.shift <> original.shift OR NEW.channel <> original.channel)) THEN
      RAISE EXCEPTION 'La corrección no corresponde a la venta original' USING ERRCODE = '23514';
    END IF;
    FOREACH amount_column IN ARRAY ARRAY['total_cents','cash_cents','card_cents','platform_cents',
      'other_cents','revenue_cents','discount_cents','tax_cents','tips_cents'] LOOP
      IF NEW.kind = 'REFUND' THEN
        SELECT coalesce(sum((to_jsonb(d)->>amount_column)::bigint),0) INTO returned
          FROM "public"."accounting_sales_documents" d
          WHERE d.company_id = NEW.company_id AND d.original_id = original.id AND d.kind = 'REFUND';
        IF returned + (to_jsonb(NEW)->>amount_column)::bigint > (to_jsonb(original)->>amount_column)::bigint THEN
          RAISE EXCEPTION 'La devolución excede el saldo del componente %', amount_column USING ERRCODE = '23514';
        END IF;
      ELSIF amount_column NOT IN ('revenue_cents','discount_cents') THEN
        SELECT coalesce(sum((to_jsonb(d)->>amount_column)::bigint),0) INTO returned
          FROM "public"."accounting_sales_documents" d
          JOIN "public"."accounting_events" e ON e.company_id = d.company_id AND e.source_id = d.id
            AND e.source_type = 'SALES_REFUND' AND e.event_type = 'SALE_REFUNDED' AND e.status = 'POSTED'
          WHERE d.company_id = NEW.company_id AND d.original_id = original.id AND d.kind = 'REFUND';
        IF returned <> (to_jsonb(original)->>amount_column)::bigint THEN
          RAISE EXCEPTION 'El reemplazo requiere devolución total publicada' USING ERRCODE = '23514';
        END IF;
      END IF;
    END LOOP;
    SELECT coalesce(sum(d.revenue_cents::bigint-d.discount_cents),0) INTO returned
      FROM "public"."accounting_sales_documents" d
      WHERE d.company_id=NEW.company_id AND d.original_id=original.id AND d.kind='REFUND'
        AND (NEW.kind='REFUND' OR EXISTS (SELECT 1 FROM "public"."accounting_events" e
          WHERE e.company_id=d.company_id AND e.source_id=d.id AND e.source_type='SALES_REFUND' AND e.status='POSTED'));
    IF (NEW.kind='REFUND' AND returned+NEW.revenue_cents::bigint-NEW.discount_cents > original.revenue_cents::bigint-original.discount_cents)
      OR (NEW.kind='SALE' AND returned <> original.revenue_cents::bigint-original.discount_cents) THEN
      RAISE EXCEPTION 'La corrección no respeta el ingreso neto original' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.kind = 'SALE' AND (source.status <> 'VALIDATED' OR source.business_date <> NEW.business_date
    OR source.shift::text <> NEW.shift OR source.channel::text <> NEW.channel OR source.total_sales <> NEW.total_cents
    OR (source.tax_amount IS NOT NULL AND source.tax_amount <> NEW.tax_cents)
    OR (source.cash_sales IS NOT NULL AND source.cash_sales <> NEW.cash_cents)
    OR (source.card_sales IS NOT NULL AND source.card_sales <> NEW.card_cents)
    OR (source.other_payments IS NOT NULL AND source.other_payments::bigint <> NEW.platform_cents::bigint + NEW.other_cents)) THEN
    RAISE EXCEPTION 'La declaración no coincide con el corte validado' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
-- Fuente 0134_fc11_sales

CREATE TRIGGER accounting_sales_guard BEFORE INSERT OR UPDATE OR DELETE ON "public"."accounting_sales_documents"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_sales_guard"();

--> statement-breakpoint
-- Fuente 0134_fc11_sales

-- These sources use linked, component-limited refunds, rather than an untracked
-- manual reversal that could repay the same sale twice.
CREATE FUNCTION "public"."accounting_sales_reversal_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reversal_of_id IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."accounting_journals" j
    WHERE j.company_id = NEW.company_id AND j.id = NEW.reversal_of_id
      AND j.source_type IN ('DAILY_SALES_CUT','SALES_REFUND')) THEN
    RAISE EXCEPTION 'Utiliza una devolución vinculada a la venta' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
-- Fuente 0134_fc11_sales

CREATE TRIGGER accounting_sales_reversal_guard BEFORE INSERT OR UPDATE ON "public"."accounting_journals"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_sales_reversal_guard"();

--> statement-breakpoint
-- Fuente 0134_fc11_sales

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT, INSERT ON "public"."accounting_sales_documents" TO pulso_app;
    GRANT SELECT, INSERT ON "public"."daily_sales_cuts" TO pulso_app;
    GRANT SELECT (ownership_type) ON "public"."branches" TO pulso_app;
  END IF;
END $$;

--> statement-breakpoint
-- Fuente 0134_fc11_sales

CREATE FUNCTION "public"."accounting_capture_sales_cut"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('app.accounting_posting_enabled', true),'') <> '1' THEN RETURN NEW; END IF;
  IF NEW.company_id::text IS DISTINCT FROM nullif(current_setting('app.current_company_id',true),'')
    OR NEW.received_by IS DISTINCT FROM nullif(current_setting('app.current_actor_id',true),'') THEN
    RAISE EXCEPTION 'El corte requiere contexto de empresa y actor' USING ERRCODE='23514';
  END IF;
  INSERT INTO "public"."accounting_events" (company_id,branch_id,source_type,source_id,event_type,source_version,actor_id,accounting_date)
    VALUES (NEW.company_id,NEW.branch_id,'DAILY_SALES_CUT',NEW.id,'SALE_RECOGNIZED',1,NEW.received_by,NEW.business_date)
    ON CONFLICT (company_id,source_type,source_id,event_type,source_version) DO NOTHING;
  RETURN NEW;
END $$;

--> statement-breakpoint
-- Fuente 0134_fc11_sales

CREATE TRIGGER accounting_capture_sales_cut AFTER INSERT ON "public"."daily_sales_cuts"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_capture_sales_cut"();

--> statement-breakpoint
-- Fuente 0135_fc_preparation_permissions
-- Read only the operational labels required by accounting preparation.
-- Account numbers, fingerprints, encrypted data and bank balances stay private.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT (code, name, accounting_line) ON "public"."cost_centers" TO pulso_app;
    GRANT SELECT (label, account_last_four, purpose) ON "public"."company_bank_accounts" TO pulso_app;
  END IF;
END $$;

--> statement-breakpoint
-- Fuente 0136_fc12_settlements

ALTER TABLE "public"."accounting_gateway_links" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
-- Fuente 0136_fc12_settlements

-- The acquirer link is configuration, so it takes the same company configuration
-- lock as every other catalog change and enforces the same shape: an active,
-- postable account of the balance sheet. The destination is declared, never
-- derived from the account code or name.
CREATE FUNCTION "public"."accounting_gateway_links_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE target_kind text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Account link changes require READ COMMITTED' USING ERRCODE = '0A000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text, 505));
  IF TG_OP = 'UPDATE' AND (OLD.id, OLD.company_id, OLD.gateway_acquirer)
    IS DISTINCT FROM (NEW.id, NEW.company_id, NEW.gateway_acquirer) THEN
    RAISE EXCEPTION 'Gateway link identity is immutable' USING ERRCODE = '23514';
  END IF;
  SELECT kind INTO target_kind FROM "public"."accounting_accounts"
    WHERE company_id = NEW.company_id AND id = NEW.account_id AND active AND postable;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Link target must be an active postable account' USING ERRCODE = '23514';
  END IF;
  IF target_kind NOT IN ('ASSET','LIABILITY') THEN
    RAISE EXCEPTION 'El vínculo de un adquirente debe apuntar la cuenta por liquidar registrada en el balance' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
-- Fuente 0136_fc12_settlements

CREATE TRIGGER accounting_gateway_links_validate AFTER INSERT OR UPDATE ON "public"."accounting_gateway_links"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_gateway_links_guard"();

--> statement-breakpoint
-- Fuente 0136_fc12_settlements

-- FC-12: a gateway settlement only clears the "por liquidar" balance that sales
-- cuts actually recognized. Crediting more than the published cuts debited would
-- turn an unsupported deposit into income. Same-table triggers fire in name order,
-- so "capacity" precedes accounting_journals_validate and the company lock 601 is
-- taken before the 505 configuration lock.
CREATE FUNCTION "public"."accounting_capacity_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  line record;
  outstanding bigint;
BEGIN
  IF NEW.status <> 'POSTED' OR OLD.status <> 'DRAFT' OR NEW.source_type IS DISTINCT FROM 'GATEWAY_SETTLEMENT' THEN
    RETURN NEW;
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Las liquidaciones requieren READ COMMITTED para reservar el saldo por liquidar' USING ERRCODE = '0A000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text, 601));
  FOR line IN
    SELECT l.account_id, a.code AS account_code
      FROM "public"."accounting_journal_lines" l
      JOIN "public"."accounting_accounts" a ON a.company_id = l.company_id AND a.id = l.account_id
      WHERE l.company_id = NEW.company_id AND l.journal_id = NEW.id
        AND l.memo = 'SETTLEMENT:RECEIVABLE' AND l.credit_cents > 0
  LOOP
    SELECT coalesce(sum(l.debit_cents::bigint - l.credit_cents::bigint), 0) INTO outstanding
      FROM "public"."accounting_journal_lines" l
      JOIN "public"."accounting_journals" j ON j.company_id = l.company_id AND j.id = l.journal_id
      WHERE l.company_id = NEW.company_id AND l.account_id = line.account_id
        AND (l.memo LIKE 'SALE:%\_RECEIVABLE' OR l.memo = 'SETTLEMENT:RECEIVABLE')
        AND (j.source_type IN ('DAILY_SALES_CUT','SALES_REFUND','GATEWAY_SETTLEMENT')
          OR EXISTS (SELECT 1 FROM "public"."accounting_journals" o
            WHERE o.company_id = j.company_id AND o.id = j.reversal_of_id
              AND o.source_type IN ('DAILY_SALES_CUT','SALES_REFUND','GATEWAY_SETTLEMENT')))
        AND (j.status = 'POSTED' OR j.id = NEW.id);
    IF outstanding < 0 THEN
      RAISE EXCEPTION 'La liquidación excede la cuenta por liquidar % registrada por los cortes', line.account_code
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

--> statement-breakpoint
-- Fuente 0136_fc12_settlements

CREATE TRIGGER accounting_capacity_validate BEFORE UPDATE OF "status" ON "public"."accounting_journals"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_capacity_guard"();

--> statement-breakpoint
-- Fuente 0136_fc12_settlements

-- The runtime role writes the acquirer link and reads only the identity, amounts
-- and dates of the settlement fact. Account numbers, card data, descriptions and
-- third-party references stay out of the grant.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "public"."accounting_gateway_links" TO pulso_app;
    GRANT SELECT (id, company_id, branch_id, acquirer, external_id, transaction_date, settlement_date,
      gross_amount_cents, fee_amount_cents, fee_vat_cents, net_amount_cents,
      destination_bank_account_id, status, imported_by) ON "public"."gateway_transactions" TO pulso_app;
    GRANT SELECT (id, company_id, source_bank_account_id, value_date, amount_cents,
      match_status, matched_gateway_transaction_id) ON "public"."bank_transactions" TO pulso_app;
  END IF;
END $$;
