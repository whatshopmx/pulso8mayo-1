# Plan: Actions en Templates vs Builder UI

## Problema

Los templates definen dos tipos de "actions" que no aparecen completamente en el frontend del builder:

### 1. `completionActions` (nivel flujo)
- Templates usan ~25 tipos distintos
- Builder solo ofrece 5 en dropdown hardcoded
- Solo 3 tipos tienen UI de edición dedicada

### 2. Step-level `actions` (nivel paso)
- 15/19 templates usan arrays `actions` dentro de pasos
- `page.tsx` NO mapea el campo `actions` → se pierden al cargar
- `WorkflowStep` type no tiene campo `actions`
- Builder usa `logicRules` con semántica diferente

## Archivos a modificar/crear

| Archivo | Acción |
|---|---|
| `lib/workflow-actions.ts` | CREAR — catálogo de tipos de acción |
| `components/builder/workflow-settings-modal.tsx` | MODIFICAR — dropdown dinámico + UI para cada tipo |
| `components/builder/builder-context.tsx` | MODIFICAR — agregar `actions` a `WorkflowStep` |
| `components/builder/property-editor.tsx` | MODIFICAR — agregar sección de step-level actions |
| `components/builder/logic-rule-card.tsx` | MODIFICAR — agregar tipos faltantes al dropdown |
| `app/dashboard/builder/editor/[id]/page.tsx` | MODIFICAR — mapear `actions` al cargar pasos |
| `app/dashboard/builder/editor/[id]/editor-client.tsx` | MODIFICAR — pasar `initialSettings` al modal |

## Fases

### Fase 1: Registry centralizado (`lib/workflow-actions.ts`)
Catálogo de todos los tipos de acción con metadata (label, icon, fields).

### Fase 2: `completionActions` — tipos faltantes
- Dropdown dinámico desde el registry
- UI dedicada para cada tipo (~25 tipos, agrupados lógicamente)
- Extender interface `CompletionAction`
- Pasar `initialSettings` desde EditorClient

### Fase 3: Step-level `actions` — mapeo
- Agregar `actions` a `WorkflowStep`
- Mapear en `page.tsx`
- Agregar sección en `PropertyEditor`

### Fase 4: Step-level `actions` — UI
- Agregar tipos de step actions al registry
- Unificar con los 5 tipos existentes en `LogicRuleCard`

### Fase 5: Persistencia
- `completionActions` ya se guardan vía POST settings
- Step-level actions se guardan dentro de `steps` vía PATCH template

## Clasificación de tipos de `completionActions`

| Grupo | Tipos | Campos |
|---|---|---|
| Notificaciones | `SEND_NOTIFICATION` | target, channel, message, condition |
| Reportes | `GENERATE_PDF_REPORT`, `GENERATE_ANONYMOUS_REPORT`, `GENERATE_DISCREPANCY_REPORT` | template, includePhotos |
| Inventario | `UPDATE_INVENTORY`, `UPDATE_TEMPERATURE_LOG`, `UPDATE_FUMIGATION_LOG` | log type, valor |
| Mantenimiento | `CREATE_MAINTENANCE_TICKET`, `UPDATE_MAINTENANCE_SCHEDULE` | priority, assignTo |
| Empleados | `UPDATE_EMPLOYEE_STATUS`, `UPDATE_WORK_SHIFT`, `CALCULATE_HOURS`, `CREATE_EMPLOYEE_RECORD`, `ACTIVATE_SYSTEM_ACCESS`, `CALCULATE_SCORE` | status, validFor |
| Sucursal | `UPDATE_BRANCH_STATUS`, `SYNC_ACCOUNTING` | status |
| Registros legales | `CREATE_INCIDENT_RECORD`, `CREATE_COFEPRIS_REPORT`, `CREATE_STPS_REPORT`, `REGISTER_ACCESS_DB` | tipo de registro |
| Flujo | `TRIGGER_NEXT_WORKFLOW` | workflowId, delay |
| Reclamos | `CREATE_CLAIM` | proveedor, monto |

## Tipos de step-level `actions` (mapear a builder)

| Template type | Builder equivalent |
|---|---|
| `BLOCK` | `BLOCK_WORKFLOW_COMPLETION` |
| `SEND_HOME` | `SEND_HOME_PROTOCOL` |
| `NOTIFY` / `NOTIFY_RH` | `SEND_NOTIFICATION` |
| `ESCALATE` | (nuevo en RuleAction) |
| `AUTO_REJECT` | (nuevo en RuleAction) |
| `LOG_RETARD` / `LOG_ABSENCE` / `LOG_VIOLATION` | (nuevo en RuleAction) |
| `GENERATE_ACTION_PLAN` | (nuevo en RuleAction) |
| `SCHEDULE_COMPLIANCE_SERVICE` | (nuevo en RuleAction) |
| `REQUIRE_REMEDIATION` | (nuevo en RuleAction) |
