# Plan de Implementación: Seed Completo (10 Fases)

> Basado en análisis del código existente.
> **Estado del código**: 60+ tablas definidas en `lib/db/schema.ts` + módulos en `lib/db/schema/`.
> **Seed existente**: `scripts/seed-conversions.ts` (patrón a seguir).
> **Templates**: 19 en `templates/` cargados vía `templates/index.ts`.
> **Runner**: `tsx` disponible en devDependencies.

---

## Convenciones compartidas

1. **Archivo `scripts/seed-constants.ts`** con IDs hardcodeados (company, branches, users) reutilizados entre fases
2. **Función helper `randomDate(daysAgo)`** para fechas históricas
3. **Función helper `randomInt(min, max)`** para valores variados
4. **Cleanup inicial**: cada fase limpia sus datos antes de insertar
5. **Error handling**: patrón `main().catch()` del seed existente

---

## Fase 1: `scripts/seed-01-foundation.ts`

**Tablas**: companies, users, branches, holidays, storageLocations, suppliers, serviceProviders

| Tabla | Datos |
|---|---|
| companies | 1 empresa "Restaurante La Casa" (plan ENTERPRISE, UUID hardcodeado) |
| users | 6-8 multi-rol (SUPER_ADMIN, ADMIN, GERENTE, SUPERVISOR, EMPLEADO x3, READONLY) |
| branches | 3 sucursales (Condesa, Polanco, Roma) con operatingHours JSON |
| holidays | Días festivos MX 2026 (formato "YYYY-MM-DD") |
| storageLocations | 3-4 por sucursal (seco, refrigeración, congelación, bar) |
| suppliers | 4-6 proveedores HORECA |
| serviceProviders | 2-3 servicios (fumigación, mantenimiento) |

---

## Fase 2: `scripts/seed-02-hr-profiles.ts`

**Tablas**: employeeProfiles, employeeContracts, employeeDocuments, employeeOnboarding, onboardingSteps, employeeBenefits, salaryHistory, notifications, notificationPreferences, breakComplianceRules

| Tabla | Datos |
|---|---|
| employeeProfiles | Perfiles con CURP, RFC, NSS, banco, contacto emergencia |
| employeeContracts | Contratos con salarios, régimen DAILY, tipo INDETERMINATE |
| employeeDocuments | Documentos LFT (INE, acta nacimiento, comprobante domicilio) |
| employeeOnboarding + onboardingSteps | Onboarding completado para todos |
| employeeBenefits | Seguro, vale despensa, fondo ahorro |
| salaryHistory | 1 cambio salarial por empleado |
| notifications + notificationPreferences | Preferencias default |
| breakComplianceRules | Reglas LFT configuradas |

---

## Fase 3: `scripts/seed-03-equipment.ts`

**Tablas**: equipmentCatalog, branchEquipments, equipmentWarranties, equipmentMaintenanceSchedules, equipmentMaintenanceHistory, branchComplianceServices, complianceServiceHistory, equipmentAlerts

| Tabla | Datos |
|---|---|
| equipmentCatalog | 12 equipos (refrigerador, estufa, campana, freidora, termómetro, etc.) |
| branchEquipments | 5-8 por sucursal con equipmentCode tipo "REF-CON-001" |
| equipmentWarranties | 3-4 garantías activas |
| equipmentMaintenanceSchedules | Programas recurrentes (preventivo mensual) |
| equipmentMaintenanceHistory | 5-8 mantenimientos pasados |
| branchComplianceServices | Fumigación (mensual), limpieza profunda (semanal) |
| complianceServiceHistory | Historial completado |
| equipmentAlerts | 2-3 alertas activas |

---

## Fase 4: `scripts/seed-04-inventory.ts`

**Ejecuta `seed-conversions.ts` internamente**. Tablas: inventoryItems, unitConversions, inventoryBatches, inventoryMovements, inventoryPriceHistory, inventoryAlerts, inventoryWaste, inventoryTransfers, inventoryTransferItems, temperatureLogs, costRecords

| Tabla | Datos |
|---|---|
| inventoryItems | 25-30 productos HORECA (carnes, lácteos, verduras, bebidas, limpieza) |
| unitConversions | Delegar a seed-conversions.ts existente |
| inventoryBatches | 2-3 lotes por producto (algunos próximos a vencer) |
| inventoryMovements | 50+ en últimos 30 días |
| inventoryPriceHistory | Cambios de costo históricos |
| inventoryAlerts | 3-4 activas (stock bajo, próximo a vencer) |
| inventoryWaste | 5-8 mermas con causas |
| inventoryTransfers + inventoryTransferItems | 2 transferencias (1 en progreso, 1 completada) |
| temperatureLogs | 20+ lecturas |
| costRecords | Costos operativos |

---

## Fase 5: `scripts/seed-05-workflows.ts`

**Carga templates desde `templates/index.ts`**. Tablas: workflowTemplates, workflowSchedules, workflowInstances, workflowInstanceSteps, workflowAssignments, eventTriggers

| Tabla | Datos |
|---|---|
| workflowTemplates | Cargar 19 templates existentes vía `getAllTemplates()` |
| workflowSchedules | Programaciones diarias, semanales, quincenales |
| workflowInstances | ~300 instancias (30 días × ~10 templates/día) |
| workflowInstanceSteps | Pasos con valores, evidencia, AI analysis mock |
| workflowAssignments | Asignaciones por rol |
| eventTriggers | Triggers (temperatura, stock bajo) |

Usar `date-fns` para iterar 30 días hacia atrás. Variedad de scores (algunos bajos).

---

## Fase 6: `scripts/seed-06-labor.ts`

**Tablas**: shiftTemplates, plannedShifts, shiftSessions, breakLogs, shiftChangeRequests, shiftApprovals, breakReminderLogs

| Tabla | Datos |
|---|---|
| shiftTemplates | 4 plantillas (matutino, vespertino, nocturno, mixto) |
| plannedShifts | ~240 turnos (8 empleados × 30 días) |
| shiftSessions | Sesiones con check-in/out, geolocalización mock |
| breakLogs | Pausas registradas |
| shiftChangeRequests | 2-3 solicitudes demo |
| shiftApprovals | Aprobaciones de horas extra |
| breakReminderLogs | Recordatorios enviados |

Casos especiales: 1 con llegadas tarde, 1 horas extra, 1 pausa omitida, 1 cambio pendiente.

---

## Fase 7: `scripts/seed-07-compliance-kpi.ts`

**Tablas**: incidents, remediationActions, complianceAlerts, kpiDefinitions, kpiHistory, kpiAlerts, kpiSnapshotLogs, psychosocialSurveys

| Tabla | Datos |
|---|---|
| incidents | 5-8 severidades variadas |
| remediationActions | Acciones vinculadas |
| complianceAlerts | Activas y resueltas |
| kpiDefinitions | 8-10 KPIs (sistema + personalizados) |
| kpiHistory | 30+ días de valores por KPI |
| kpiAlerts | Threshold breaches |
| kpiSnapshotLogs | Snapshots diarios/semanales |
| psychosocialSurveys | Resultados NOM-035 |

KPIs: cumplimiento operativo, laboral, precisión inventario, costo laboral, temperaturas, alertas resueltas.

---

## Fase 8: `scripts/seed-08-hr-advanced.ts`

**Tablas**: performanceReviews, performanceReviewCriteria, performanceReviewResponses, performanceGoals, vacationRequests, vacationAccruals, leaveTypes, leaveRequests, leaveBalances, employeeTraining, employeeTrainingRecords, employeeCommunications, communicationReadReceipts, messageTemplates

| Tabla | Datos |
|---|---|
| performanceReviews | 3-5 evaluaciones (self, manager, 360) |
| performanceReviewCriteria | Criterios por categoría |
| performanceReviewResponses | Scores detallados |
| performanceGoals | Metas con estados |
| vacationRequests | 3 (1 aprobada, 1 pendiente, 1 rechazada) |
| vacationAccruals | Acumulación anual |
| leaveTypes | Tipos configurados |
| leaveRequests + leaveBalances | Permisos y saldos |
| employeeTraining + employeeTrainingRecords | Capacitaciones NOM-251 |
| employeeCommunications | 3-4 anuncios/comunicados |
| communicationReadReceipts | Lecturas |
| messageTemplates | Plantillas |

---

## Fase 9: `scripts/seed-09-whatsapp.ts`

**Tablas**: whatsappSessions, whatsappConversationStates, whatsappMessages, magicLinks

| Tabla | Datos |
|---|---|
| whatsappSessions | 1 sesión demo (DISCONNECTED) |
| whatsappConversationStates | 2-3 conversaciones simuladas |
| whatsappMessages | 10-15 mensajes demo |
| magicLinks | Links mágicos para ejecución externa |

---

## Fase 10: `scripts/seed-10-final.ts`

**Tablas**: reportTemplates, reportExecutionHistory, inventoryAuditLog, employeeAuditLogs, savedSearches

| Tabla | Datos |
|---|---|
| reportTemplates | 3-4 plantillas pre-configuradas |
| reportExecutionHistory | Historial de ejecuciones |
| inventoryAuditLog | 50+ registros auditoría |
| employeeAuditLogs | Auditoría RH (cambios salario, perfil) |
| savedSearches | Búsquedas guardadas |

---

## Script Orquestador: `scripts/seed-full.ts`

```typescript
import "dotenv/config";
import "./seed-01-foundation";
import "./seed-02-hr-profiles";
import "./seed-03-equipment";
import "./seed-04-inventory";
import "./seed-05-workflows";
import "./seed-06-labor";
import "./seed-07-compliance-kpi";
import "./seed-08-hr-advanced";
import "./seed-09-whatsapp";
import "./seed-10-final";
```

## Package.json

Agregar:
```json
"seed": "npx tsx scripts/seed-full.ts"
```

---

## Resumen de datos generados

| Métrica | Cantidad |
|---|---|
| Empresas | 1 |
| Sucursales | 3 |
| Usuarios | 6-8 |
| Perfiles RH completos | 6-8 |
| Contratos | 6-8 |
| Documentos empleado | 30+ |
| Equipos | 15-20 |
| Mantenimientos | 10-15 |
| Productos inventario | 25-30 |
| Lotes | 60-80 |
| Movimientos inventario | 50+ |
| Workflow templates | 19 (cargados) |
| Workflow instancias | ~300 (30 días) |
| Turnos planificados | ~240 |
| Sesiones reales | ~240 |
| Incidentes | 5-8 |
| KPIs con historia | 8-10 KPIs × 30 días |
| Evaluaciones | 3-5 |
| **Total registros** | **~1,500** |
