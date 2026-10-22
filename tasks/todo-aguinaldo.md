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

- [x] **Task 4 (M)** — Percepción 002 + nómina extraordinaria en `fiscal-service.ts` — depende de Task 2
  - [x] `payrollTypeCode: 'O' | 'E'` (default 'O') + fechas del año causado
  - [x] Desglose 002 taxed/exempt
  - **Verify:** test del payload: tipo E, 002, `expectedTotal` cuadra; ordinaria sin cambios

- [x] **Task 5 (M)** — Run de aguinaldo: esquema + `aguinaldo-payroll-service.ts` — depende de Tasks 2, 4
  - [x] Migración: `payroll_runs.aguinaldoFiscalYear` + `payroll_payslips.aguinaldoCents` (sin DROP)
  - [x] `previsualizarAguinaldo(companyId, anioFiscal, branchId?)`
  - [x] `executeAguinaldoRun` con idempotencia por companyId+año
  - **Verify:** migración generada revisada; smoke sandbox: preview → run → payslip tipo E

- [x] **Task 6 (S)** — API `app/api/payroll/aguinaldo/route.ts` — depende de Task 5
  - [x] GET preview / POST execute; `getSession()` + scoping companyId; warning fuera de diciembre
  - **Verify:** 401 sin sesión; datos de otro tenant no accesibles

### Checkpoint 2
- [x] Migración aplicada sin DROP
- [x] Smoke dev: preview → timbrado E → payslip con uuid
- [x] `pnpm test:unit` verde

## Phase 3: Polish — UI, diciembre, provisiones

- [x] **Task 7 (M)** — UI "Aguinaldo {año}" en `app/dashboard/labor/payroll/page.tsx` — depende de Task 6
  - [x] Preview por empleado + botón ejecutar + historial runs de aguinaldo
  - [x] Badge estatus legal + nota "30 días por antigüedad: NO vigente"

- [x] **Task 8 (S)** — Recordatorio Inngest diciembre — depende de Tasks 5, 7
  - [x] Cron `0 8 1-19 12 *` + dedupe companyId+año → admins antes del 19-dic
  - **Verify:** no duplica notificaciones el mismo día

- [x] **Task 9 (XS)** — Provisión mensual informativa (decisión Q3: dentro) — depende de Task 2
  - [x] Línea "provisión aguinaldo estimada / 12" en `labor-cost`/`labor-cost-table`, `DERIVED`, toggle por tenant

**Checkpoint 3**
- [x] Flujo end-to-end en dev (preview→timbrado→payslip)
- [x] `pnpm build` + `pnpm run lint` limpios
- [x] `docs/user-guide.md` actualizado (aguinaldo, exención, límites)

## Phase 4: Sub-registro — salario efectivo, prácticas, liabilidad

- [x] **Task 10 (M)** — Esquema de compensación configurable — puede ir en paralelo con Phase 2
  - [x] Migración: `employeeContracts.effectiveSalaryCents` (NULL = formal) SIN DROP — `drizzle/0119*
  - [x] `tenantOperatingConfig.payrollPracticeMode` (FORMAL/MIXED) + `aguinaldoBase` (REGISTERED/EFFECTIVE)
  - [x] Captura de salario efectivo en perfil/contrato (contract-dialog + PATCH `app/api/employees/contracts/[id]/route.ts`)
  - **✅Verify:** `pnpm test:unit` verde — `lib/__tests__/effective-salary.test.ts` fija regresión cero; empleados sin dato efectivo se comportan igual que hoy

- [x] **Task 11 (M)** — Aguinaldo base configurable + liabilidad contingente + excedente en efectivo — depende de Tasks 4-6, 10
  - [x] `aguinaldo-service` acepta base REGISTERED/EFFECTIVE (exención 30 UMA sobre el bruto elegido) — tests de ambas bases en `aguinaldo-service.test.ts`
  - [x] Preview SIEMPRE con ambas columnas + liabilidad contingente (art. 516 LFT, J. 1a./J. 24/2023) — `diferenciaCents` por fila y total
  - [x] Dispersión del excedente con bitácora (tabla `payroll_aguinaldo_dispersiones`, migración 0120) SIN CFDI: automática en el run + POST manual `action: "DISPERSION"` + GET `?dispersiones=1`
  - **✅Verify:** el gap nunca se oculta (columnas lado a lado); excedente con bitácora y fecha

- [x] **Task 12 (S)** — Finiquito y costo laboral sobre salario efectivo — depende de Task 10 (+ Tasks 2-3)
  - [x] `settlement-calculator` con gap visible lado a lado y fuente declarada; `ai-severance-calculator` acepta `registeredSalaryMXN` y declara el gap (`registeredSalaryDeclared`)
  - [x] `labor-cost` usa salario efectivo como piso; nota del renglón verbaliza si trae la parte de efectivo
  - [x] Notas legales de sub-registro en la UI de config (IMSS LSS 280-B, demandas de prestaciones, prescripción 1 año)
  - **✅Verify:** formales idénticos (regresión cero en tests); con gap, ambos números con fuente declarada

**Checkpoint 4**
- [x] Migración sin DROP (0119 + 0120); cero regresión en empleados formales
- [x] Preview de aguinaldo con dos bases
- [x] `pnpm test:unit` (1799 verdes) + `pnpm run build` limpio (EXIT=0, requería NODE_OPTIONS=--max-old-space-size=8192 en esta máquina: fallo de heap ambiental, no del código)

## Phase 5: Follow-ups con decisión resuelta

- [x] **Task 13 (M)** — Retención ISR Art. 174 RLISR (decisión Q1) — después del Checkpoint 2
  - [x] `lib/services/isr-annual-withholding.ts`: tarifa mensual/anual 2026 (Anexo 8 RMF, DOF 28-dic-2025) + subsidio al empleo (Decreto 31-dic-2025; tope $11,492.66, enero 15.59%)
  - [x] Integración a `executeAguinaldoRun`: tarifa del año/mes de dispersión, retención sobre el aguinaldo íntegro, deducción clave 002 en el CFDI; nómina ordinaria queda acoplada al módulo (`calcularISRMensual96` exportado)
  - **✅Verify:** caso de estudio verde — SD $600 (mensual $18,240), aguinaldo $9,000 → retención $1,922.37; ejemplo SAT $15,000 → $1,402.82 y contigüidad de renglones verificados en `isr-annual-withholding.test.ts`

- [x] **Task 14 (M)** — Conteo automático de días laborados (decisión Q2 fase 2) — depende de Tasks 2, 7
  - [x] Cruce `shiftSessions` (COMPLETED) + `leaveRequests` (APPROVED/COMPLETED, `leaveTypes.isPaid`) → `conteoDiasLaboradosAnual(year)` con unión unique (sin doble conteo); fuente declarada por empleado
  - [x] Prellenar el campo editable de la preview: MANUAL prevalece > TURNOS_Y_PERMISOS > CALENDARIO; la punta de la celda verbaliza la fuente
  - **✅Verify:** helpers puros en `dias-laborados.test.ts` verdes; ajuste manual se respeta (semántica `diasLaboradosPorUsuario` intacta)

**Checkpoint 5**
- [x] Retención ISR con caso de estudio verde
- [x] Conteo de días reproducible con fuente declarada
- [x] `pnpm test:unit` (1850 verdes) + `pnpm run build` limpio (EXIT=0 con NODE_OPTIONS=--max-old-space-size=8192)

## ESTADO: PLAN COMPLETO (Phases 1–5, Tasks 1–14)

## Decisiones resueltas (2026-10-20)
1. **Q1 ISR** → Tarifa anual Art. 174 RLISR en Task 13, independiente del hito de diciembre
2. **Q2 Días laborados** → Manual primero (preview editable); automático en Task 14
3. **Q3 Provisión** → Dentro, informativa (DERIVED) con toggle por tenant; pasivo contable fuera
4. **Q4 Comisionistas** → Sólo salario ordinario del contrato; propinas NO entran (test-documentación)
5. **Q5 Excedente en efectivo** → Dispersión con bitácora (autorizador, motivo), sin CFDI
