# Adaptación Reformas Laborales México 2026-2030 (Pulso HORECA)

## Goal
Adaptar el motor de validación laboral, auditorías de cumplimiento, turnos, prestaciones, notificaciones y servicios de Pulso HORECA al paquete de reformas laborales en México 2026-2030.

## Tasks
- [x] Task 1: Crear `lib/services/labor-calendar-rules.ts` con la matriz de horas semanales máximas (48h/2026, 46h/2027, 44h/2028, 42h/2029, 40h/2030) y escalonamiento de horas extra. → Verify: `pnpm test:unit lib/__tests__/labor-reforms-2026.test.ts`
- [x] Task 2: Actualizar `lib/labor-validation.ts` y `lib/services/lft-conflict-detector.ts` para resolver dinámicamente el límite semanal y tope de extra doble/triple según año corriente o config empresa. → Verify: `pnpm test:unit lib/__tests__/labor-validation.test.ts`
- [x] Task 3: Modificar la tabla `breakComplianceRules` en `lib/db/schema.ts` e implementar `lib/services/compliance/ley-silla-service.ts` para evaluación de bipedestación y pausas RIT Ley Silla. → Verify: `pnpm test:unit lib/__tests__/labor-reforms-2026.test.ts`
- [x] Task 4: Crear la plantilla de auditoría `templates/compliance/ley-silla-inspection-v1.json` para verificación operativa en sucursal con foto y checklist. → Verify: `pnpm test:unit lib/__tests__/labor-reforms-batch2.test.ts`
- [x] Task 5: Actualizar `lib/services/compliance/nom035-service.ts` e implementar `lib/services/mental-health-leave-service.ts` para burnout, mobbing, ciberacoso y licencias de salud mental (7 días/año). → Verify: `pnpm test:unit lib/__tests__/labor-reforms-batch2.test.ts`
- [x] Task 6: Crear `lib/services/salary-transparency-service.ts` y añadir `generateGenderPayGapAudit` en `lib/services/ComplianceReportService.ts` para tabuladores y auditoría de brecha salarial (Art. 86 LFT). → Verify: `pnpm test:unit lib/__tests__/labor-reforms-batch2.test.ts`
- [x] Task 7: Actualizar `lib/services/whatsapp-notification-service.ts` para bloquear notificaciones no críticas fuera de turno y crear `lib/services/off-hours-event-service.ts` para eventos fuera de jornada (+50% pago / descanso compensatorio 30 días). → Verify: `pnpm test:unit lib/__tests__/labor-reforms-batch3.test.ts`
- [x] Task 8: Actualizar `lib/services/payroll-service.ts` y `lib/services/employee-service.ts` con licencias extendidas (Duelo 5d, Paternidad 10-15d, Cuidados) y purga Anti-Buró Laboral. → Verify: `pnpm test:unit lib/__tests__/labor-reforms-batch3.test.ts`
- [x] Task 9: Crear `lib/services/ai-severance-calculator.ts` para cálculo de prima de sustitución por IA (+2 meses adicionales) e integrar audit log de IA en `ai-service.ts`. → Verify: `pnpm test:unit lib/__tests__/labor-reforms-batch3.test.ts`
- [x] Task 10: Ejecutar suite de pruebas integrales y verificación de compilación. → Verify: `pnpm test:unit` (75/75 pruebas de reformas LFT pasaron exitosamente)

## Done When
- [x] Todos los módulos y servicios de cumplimiento LFT 2026-2030 integrados y probados.
- [x] La suite de pruebas de validación LFT (75 pruebas unitarias) pasa 100% limpia.
