/**
 * Services Barrel Export
 * Re-exports all services for convenient imports
 */

// Shift services
export { ShiftService } from "./shift-service";
export {
  PlannedShiftServiceImpl,
  plannedShiftService,
} from "./shift-service-extended";
export type { PlannedShiftService } from "./shift-service-extended";

// Validation services
export {
  ShiftValidationService,
  shiftValidationService,
  LFT_LIMITS,
} from "./shift-validation-service";

// Template services
export {
  ShiftTemplateService,
  shiftTemplateService,
  DEFAULT_TEMPLATES,
  SHIFT_TYPE_SCHEDULES,
} from "./shift-template-service";

// Inventory services
export { TheoreticalConsumptionService } from "./theoretical-consumption-service";
export { ForecastService } from "./forecast-service";
export { SuggestedOrderService } from "./suggested-order-service";
export { AdvancedAlertService } from "./advanced-alert-service";
export { ExecutiveReportService } from "./executive-report-service";
export { CostingService } from "./costing-service";
export { IntelligenceService } from "./intelligence-service";
export { InsightGeneratorService } from "./insight-generator-service";
export { SupplierScorecardService } from "./supplier-scorecard-service";
