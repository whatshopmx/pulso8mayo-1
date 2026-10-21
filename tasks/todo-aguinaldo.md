# TODO: Aguinaldo proporcional + nómina de diciembre (CFDI 002)

Spec: investigación 2026-10-20 (código + LFT art. 87 / ISR art. 93-XIV) · Plan detallado: `tasks/plan-aguinaldo.md`
Reglas transversales: centavos enteros · migraciones sin DROP (`pnpm db:generate`) · multi-tenant por `companyId` ·
catálogo de estatus legal [H04]: 15 días vigentes, iniciativa 30 días = `PENDING_INITIATIVE`.

## Phase 1: Foundation — cálculo legal puro

- [x] **Task 1 (S)** — Estatuto legal del aguinaldo
  - [x] `AGUINALDO_30_DIAS` en `lib/company/labor-reform-status-catalog.ts` (`PENDING_INITIATIVE`)
  - [x] `aguinaldoDaysMxn` con vigencia por fecha en `labor-law-ref` + `labor-rules-resolver` + seed
  - **✅Verify:** `pnpm test:unit` — `resolveLaborLawRules(hoy).aguinaldoDaysMxn === 15`

- [x] **Task 2 (M)** — Servicio puro `lib/services/aguinaldo-service.ts` — depende de Task 1
  - [x] `calcularAguinaldoAnual`: dias = 15/365 × días año fiscal; prorrateo; exención min(30 × UMA fecha)
  - [x] Tests `lib/__tests__/aguinaldo-service.test.ts`: año completo, 200 días, comisionista, faltas, cap exención, <1 año
  - **✅Verify:** `pnpm test:unit -- aguinaldo` verde; función sin DB

- [x] **Task 3 (S)** — Alinear cálculos existentes — depende de Task 2
  - [x] `calculateLFT2026Benefits`: default 15 + prorrateo + `estatusLegal`
  - [x] `settlement-calculator.tsx` usa el servicio compartido (misma UI)
  - [x] Test batch3 actualizado
  - **✅Verify:** `pnpm test:unit` verde · números de finiquito sin regresión

### Checkpoint 1
- [x] `pnpm test:unit` verde (fallo preexistente fuera de scope: seed-safety)
- [x] `pnpm build` limpio

## Phase 2: Core — nómina + timbrado

- [ ] **Task 4 (M)** — Percepción 002 + nómina extraordinaria en `fiscal-service.ts` — depende de Task 2
  - [ ] `payrollTypeCode: 'O' | 'E'` (default 'O') + fechas del año causado
  - [ ] Desglose 002 taxed/exempt
  - **Verify:** test del payload: tipo E, 002, `expectedTotal` cuadra; ordinaria sin cambios

- [ ] **Task 5 (M)** — Run de aguinaldo: esquema + `aguinaldo-payroll-service.ts` — depende de Tasks 2, 4
  - [ ] Migración: `payroll_runs.aguinaldoFiscalYear` + `payroll_payslips.aguinaldoCents` (sin DROP)
  - [ ] `previsualizarAguinaldo(companyId, anioFiscal, branchId?)`
  - [ ] `executeAguinaldoRun` con idempotencia por companyId+año
  - **Verify:** migración generada revisada; smoke sandbox: preview → run → payslip tipo E

- [ ] **Task 6 (S)** — API `app/api/payroll/aguinaldo/route.ts` — depende de Task 5
  - [ ] GET preview / POST execute; `getSession()` + scoping companyId; warning fuera de diciembre
  - **Verify:** 401 sin sesión; datos de otro tenant no accesibles

### Checkpoint 2
- [ ] Migración aplicada sin DROP
- [ ] Smoke dev: preview → timbrado E → payslip con uuid
- [ ] `pnpm test:unit` verde

## Phase 3: Polish — UI, diciembre, provisiones

- [ ] **Task 7 (M)** — UI "Aguinaldo {año}" en `app/dashboard/labor/payroll/page.tsx` — depende de Task 6
  - [ ] Preview por empleado + botón ejecutar + historial runs de aguinaldo
  - [ ] Badge estatus legal + nota "30 días por antigüedad: NO vigente"

- [ ] **Task 8 (S)** — Recordatorio Inngest diciembre — depende de Tasks 5, 7
  - [ ] Cron `0 8 1-19 12 *` + dedupe companyId+año → admins antes del 19-dic
  - **Verify:** no duplica notificaciones el mismo día

- [ ] **Task 9 (XS)** — Provisión mensual informativa (decisión Q3: dentro) — depende de Task 2
  - [ ] Línea "provisión aguinaldo estimada / 12" en `labor-cost`/`labor-cost-table`, `DERIVED`, toggle por tenant

**Checkpoint 3**
- [ ] Flujo end-to-end en dev (preview→timbrado→payslip)
- [ ] `pnpm build` + `pnpm run lint` limpios
- [ ] `docs/user-guide.md` actualizado (aguinaldo, exención, límites)

## Phase 4: Sub-registro — salario efectivo, prácticas, liabilidad

- [ ] **Task 10 (M)** — Esquema de compensación configurable — puede ir en paralelo con Phase 2
  - [ ] Migración: `employeeContracts.effectiveSalaryCents` (NULL = formal) SIN DROP
  - [ ] `tenantOperatingConfig.payrollPracticeMode` (FORMAL/MIXED) + `aguinaldoBase` (REGISTERED/EFFECTIVE)
  - [ ] Captura de salario efectivo en perfil/contrato
  - **Verify:** empleados sin dato efectivo con cero regresión

- [ ] **Task 11 (M)** — Aguinaldo base configurable + liabilidad contingente + excedente en efectivo — depende de Tasks 4-6, 10
  - [ ] `aguinaldo-service` acepta base REGISTERED/EFFECTIVE (exención 30 UMA sobre el bruto elegido)
  - [ ] Preview SIEMPRE con ambas columnas + liabilidad contingente (art. 516 LFT, J. 1a./J. 24/2023)
  - [ ] Dispersión del excedente con bitácora, SIN CFDI
  - **Verify:** el gap nunca se oculta; excedente con bitácora y fecha

- [ ] **Task 12 (S)** — Finiquito y costo laboral sobre salario efectivo — depende de Task 10 (+ Tasks 2-3)
  - [ ] `settlement-calculator` / `ai-severance-calculator` con gap visible lado a lado
  - [ ] `labor-cost` usa salario efectivo; nota verbaliza si trae la parte de efectivo
  - [ ] Notas legales de sub-registro en la UI (IMSS LSS 280-B, demandas de prestaciones, prescripción 1 año)
  - **Verify:** formales idénticos; con gap, ambos números con fuente declarada

**Checkpoint 4**
- [ ] Migración sin DROP; cero regresión en empleados formales
- [ ] Preview de aguinaldo con dos bases
- [ ] `pnpm test:unit` + `pnpm build` limpios

## Phase 5: Follow-ups con decisión resuelta

- [ ] **Task 13 (M)** — Retención ISR Art. 174 RLISR (decisión Q1) — después del Checkpoint 2
  - [ ] `lib/services/isr-annual-withholding.ts`: tarifa anual + subsidio al empleo, aguinaldo como ingreso separado
  - [ ] Integración a `executeAguinaldoRun` y después a la nómina ordinaria (hoy deducciones en 0)
  - **Verify:** caso numérico de estudio en test verde

- [ ] **Task 14 (M)** — Conteo automático de días laborados (decisión Q2 fase 2) — depende de Tasks 2, 7
  - [ ] Cruce `shiftSessions` + `leaveRequests` → `diasLaboradosPorEmpleado(year)` con fuente declarada
  - [ ] Prellenar el campo editable de la preview; el ajuste manual del admin prevalece
  - **Verify:** conteo reproducible; ajuste manual se respeta

**Checkpoint 5**
- [ ] Retención ISR con caso de estudio verde
- [ ] Conteo de días reproducible con fuente declarada
- [ ] `pnpm test:unit` + `pnpm build` limpios

## Decisiones resueltas (2026-10-20)
1. **Q1 ISR** → Tarifa anual Art. 174 RLISR en Task 13, independiente del hito de diciembre
2. **Q2 Días laborados** → Manual primero (preview editable); automático en Task 14
3. **Q3 Provisión** → Dentro, informativa (DERIVED) con toggle por tenant; pasivo contable fuera
4. **Q4 Comisionistas** → Sólo salario ordinario del contrato; propinas NO entran (test-documentación)
5. **Q5 Excedente en efectivo** → Dispersión con bitácora (autorizador, motivo), sin CFDI
