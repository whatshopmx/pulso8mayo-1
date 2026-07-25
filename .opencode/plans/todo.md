# TODO: Integración Template Conteo Inventario

## Phase 1: AI Verification Fixes

- [ ] **Task 1**: Fix aiVerification lookup path in `WorkflowExecutionService.updateStep()`
  - [ ] Change `currentStepDef?.config?.aiVerification?.enabled` → `currentStepDef?.aiVerification?.enabled` (with fallback)
  - [ ] Update usage of `currentStepDef.config.aiVerification` (line 245)
  - Files: `lib/services/workflow-execution-service.ts`
  - Scope: Small

- [ ] **Task 2**: Normalize `threshold` → `confidenceThreshold` in template ingestion
  - [ ] Add mapping in `normalizeTemplate()` at `templates/index.ts`
  - Files: `templates/index.ts`
  - Scope: XS

### Checkpoint: Phase 1
- [ ] Build passes: `pnpm run build`

## Phase 2: Unificación

- [ ] **Task 3**: Consolidate stock count step generation
  - [ ] Extract `StockCountService.generateStockCountSteps()` shared method
  - [ ] Refactor `createStockCountInstance()` to use shared method
  - [ ] Refactor `WorkflowExecutionService.createExecution()` stock count branch to use shared method
  - Files: `lib/services/stock-count-service.ts`, `lib/services/workflow-execution-service.ts`
  - Scope: Medium

### Checkpoint: Phase 2
- [ ] Build passes: `pnpm run build`

## Phase 3: Polish

- [ ] **Task 4**: Preserve stable values (yes/no) in confirm-count
  - [ ] Fix `normalizeOptions` behavior or bypass for confirm-count step
  - [ ] Update `completeStockCount()` confirmation check to use stable value
  - [ ] Update `checkProgress()` confirmation check to use stable value
  - Files: `lib/services/stock-count-service.ts`, `lib/services/workflow-execution-service.ts`, `lib/workflow-type-map.ts`
  - Scope: Small

- [ ] **Task 5**: Store template metadata on instance
  - [ ] Add `aiConfig`, `complianceConfig`, `completionActions` to `instance.data` in `createStockCountInstance()`
  - Files: `lib/services/stock-count-service.ts`
  - Scope: Small

### Checkpoint: Complete
- [ ] Build: `pnpm run build`
- [ ] Lint: `pnpm run lint`
