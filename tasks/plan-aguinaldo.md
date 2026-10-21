# Implementation Plan: Aguinaldo proporcional por antigüedad + nómina de diciembre (CFDI 002)

**Fuente:** investigación del 2026-10-20 (código + marco legal LFT art. 87 vigente, DOF 14-may-2026).
**Estado actual del sistema:**
- Finiquito calcula aguinaldo proporcional 15/365 (`components/employees/settlement-calculator.tsx:52-56`), pero **la nómina no paga ni timbra aguinaldo** (sólo claves 001/038/025; `payrollTypeCode: "O"` fijo en `lib/services/fiscal-service.ts:476`).
- `calculateLFT2026Benefits` (`lib/services/payroll-service.ts:50-62`) usa 30 días planos (reforma **NO vigente**, es iniciativa pendiente) y sin prorrateo; sólo la usa un test.
- Antigüedad ya existe: `employeeProfiles.hireDate` / `seniorityDate` (`lib/db/schema.ts:1874-1875`) y `seniority: P{n}W` en el CFDI (`fiscal-service.ts:471`).

## Overview

Tres fases que hacen tres cosas: (1) un **servicio puro de cálculo de aguinaldo** con la fórmula legal vigente (15/365 × días laborados × SD), la exención de 30 UMA del ISR (art. 93-XIV LISR) y el estatuto legal del catálogo de reformas; (2) la **integración a nómina**: percepción clave 002, nómina extraordinaria `TipoNomina E`, run de aguinaldo con migración mínima de `payroll_payslips`; (3) la **superficie de uso**: UI en labor/payroll, recordatorio de dispersión antes del 19-dic y alineación de los cálculos existentes (finiquito y benefits) al servicio compartido.

## Architecture Decisions

- **Una sola fuente de verdad de días de aguinaldo**, con vigencia por fecha, igual que el salario mínimo (`resolveLaborLawRules`): hoy 15 días (art. 87 LFT vigente); la propuesta de 30 días progresivos por antigüedad (MC, jul-2026: 1-2 años→15, 3-4→20, 5→25, 6+→30) entra como `PENDING_INITIATIVE` en `lib/company/labor-reform-status-catalog.ts` — contrato [H04]: ningún servicio puede alegar "ley" que no es ley.
- **Cálculo puro y testeable** en un servicio propio (`lib/services/aguinaldo-service.ts`), reutilizado por nómina, benefits y finiquito. Montos en **centavos enteros** (convención del repo).
- **Proporcional por año fiscal, no por aniversario**: art. 87 prorratea "conforme al tiempo trabajado en el año"; usamos `diasEnElAno/365 × días`. Base: salario ordinario vigente al pago (Jurisprudencia 1a./J. 24/2023).
- **Exención no se prorratea**: min(aguinaldo bruto, 30 × UMA diaria vigente al pago). El exceso va gravado (clave 002, exento/gravado separados).
- **Timbrado como nómina extraordinaria** (`payrollTypeCode: "E"`), periodo de pago 01-ene→31-dic del año causado, un CFDI 002 por empleado. No se mezcla con la nómina ordinaria del periodo.
- **Migraciones sin DROP, `pnpm db:generate`** — nunca `db:push` directo (regla del repo).
- **ISR gravado: exento/gravado se declaran en el CFDI de aguinaldo desde Task 5; la RETENCIÓN de ISR va en Task 13 (tarifa anual Art. 174 RLISR), independiente del hito de diciembre** — hoy el sistema nunca calcula retenciones (`totalDeduccionesCents: 0` en todo el código), y esa carencia también aflige la nómina ordinaria, así que es tarea propia, no una decisión postponible dentro del run de aguinaldo.

## Task List

### Phase 1: Foundation — cálculo legal puro

- [ ] **Task 1 (S): Estatuto legal del aguinaldo en el catálogo de reformas.**
  - Entrada `AGUINALDO_30_DIAS` en `lib/company/labor-reform-status-catalog.ts` (`PENDING_INITIATIVE`, basis con iniciativas oct-2024/jul-2026, effectNote).
  - `aguinaldoDaysMxn: 15` como regla de ley con vigencia en `lib/db/schema/labor-law-ref.ts` + `lib/services/labor-rules-resolver.ts` + seed (`scripts/seed-labor-law-rules.ts`), igual patrón que `minimumWageMxn`.
  - **AC:** `resolveLaborLawRules(fecha).aguinaldoDaysMxn === 15` para 2026; el catálogo expone el estatus de la iniciativa 30 días.
  - **Files:** `lib/company/labor-reform-status-catalog.ts`, `lib/db/schema/labor-law-ref.ts`, `lib/services/labor-rules-resolver.ts`, `scripts/seed-labor-law-rules.ts`.
  - **Depends:** None.

- [ ] **Task 2 (M): Servicio puro `lib/services/aguinaldo-service.ts`.**
  - `calcularAguinaldoAnual({ anioFiscal, salarioDiarioMxn, seniorityDate|diasLaborados })` → `{ diasAguinaldo, bruto, exento, gravado, aguinaldoDaysMxn, estatusLegal }`.
  - Días = `min(15, porAntigüedad proyectada si la reforma entra en vigencia) / 365 × díasLaboradosEnElAno`. `diasLaborados` opcional (ajuste manual en la preview, Task 7: columna editable "días a considerar" por empleado; decisión resuelta Q2: manual primero, automatización en Task 14). Si no viene, fallback a días calendario del año fiscal desde `seniorityDate`.
  - Incidencias manuales: faltas/permisos sin goce/SL general NO cuentan; vacaciones, festivos, riesgo de trabajo, maternidad, paternidad SÍ (criterio PROFEDET para el conteo manual).
  - Exención por fecha: UMA diaria vigente × 30 (tabla como la del salario mínimo; 2026: $113.14).
  - Base de cálculo: salario ordinario del contrato (decisión resuelta Q4); las propinas NO son salario (CFDI 038) y NO entran al aguinaldo — un test documenta la regla. Sueldo mixto con comisiones: la comisión debe vivir en el `baseSalary`/`effectiveSalary` del contrato. El promedio de 30 días del art. 89 LFT (destajo) queda como override futuro, no en este scope.
  - Tests `lib/__tests__/aguinaldo-service.test.ts` con los casos de la investigación: año completo ($600×15), proporcional 200 días (8.219178 días), faltas descontadas, exención cap 30 UMA, trabajador <1 año, y el test-documentación de la regla comisionistas.
  - **AC:** pruebas verdes; la función no toca DB.
  - **Depends:** Task 1.

- [ ] **Task 3 (S): Alinear los dos cálculos existentes al servicio compartido.**
  - `calculateLFT2026Benefits` (`lib/services/payroll-service.ts`): default 15 días + prorrateo opcional + `estatusLegal` en el output; el 30 se queda como *config explícita* para proyecciones, con advertencia del catálogo.
  - `settlement-calculator.tsx`: sustituir la fórmula inline por el servicio compartido (sin cambiar UI ni firmas del componente).
  - **AC:** finiquito da el mismo número que antes con 15 días vigentes; test batch3 actualizado.
  - **Depends:** Task 2.

**Checkpoint 1:** `pnpm test:unit` verde · `pnpm build` limpio · los 3 escenarios de la investigación reproducidos en tests.

### Phase 2: Core Features — nómina + timbrado

- [ ] **Task 4 (M): Percepción 002 + nómina extraordinaria en `fiscal-service.ts`.**
  - `NominaTimbradoInput`: `payrollTypeCode?: 'O' | 'E'` (default 'O', retrocompatible) y permitir fechas `paymentDate/initialPaymentDate/finalPaymentDate` del año causado.
  - `construirDesgloseNomina` (en `payroll-service.ts`) o variante aguinaldo: genera percepción `{ earningTypeCode: "002", concept: "Gratificación anual (Aguinaldo)", taxedAmount, exemptAmount }`.
  - Test del payload: tipo E + 002 exenta/gravada + `seniority` intacto.
  - **AC:** payload CFDI de nómina extraordinaria con 002 construye y suma línea por línea (cuadra `expectedTotal`).
  - **Depends:** Task 2.

- [ ] **Task 5 (M): Run de aguinaldo — esquema + servicio.**
  - Migración (`tasks/` la numera; `pnpm db:generate`): `payroll_runs.aguinaldoFiscalYear int NULL` (o `payrollType` en runs) + `payroll_payslips.aguinaldoCents int NOT NULL DEFAULT 0`. Sin DROP.
  - Nuevo `lib/services/aguinaldo-payroll-service.ts`:
    - `previsualizarAguinaldo(companyId, anioFiscal, branchId?)`: por empleado activo con contrato → días, bruto, exento, gravado (usa Task 2 + `employeeContracts.baseSalary` y `employeeProfiles`).
    - `executeAguinaldoRun(companyId, anioFiscal, performedBy)`: crea `payrollRuns` con año fiscal, timbra tipo E por empleado, guarda payslip con `aguinaldoCents` y uuid; guard de idempotencia (no re-run del mismo companyId+año; si re-run, 409/ERROR).
  - **AC:** preview suma al total de la pre-flight; run timbra en sandbox EKU9003173C9 y guarda payslip; re-run bloqueado.
  - **Depends:** Tasks 2, 4.

- [ ] **Task 6 (S): API `app/api/payroll/aguinaldo/route.ts`.**
  - GET preview y POST execute; `getSession()` + scoping por `companyId` (multi-tenant estricto); guard de ventana (sólo >=01-dic tolerado, fuera con warning en la respuesta, no bloqueo duro).
  - **AC:** 401 sin sesión; respuestas acotadas al tenant; errores del timbrado están en `results[]` como en `executePayrollRun`.
  - **Depends:** Task 5.

**Checkpoint 2:** migración aplicada sin DROP · smoke manual en dev: preview → run → payslip timbrado tipo E en sandbox · `pnpm test:unit` verde.

### Phase 3: Polish — UI, diciembre y provisiones

- [ ] **Task 7 (M): UI "Aguinaldo {año}" en `app/dashboard/labor/payroll/page.tsx`.**
  - Bloque/pestaña con: preview tabla (empleado, días, bruto, exento, gravado), botón **Ejecutar dispersión**, AGUINALDO runs en el historial, badge de estatus legal (catálogo) y nota "iniciativa 30 días por antigüedad: NO vigente".
  - **AC:** la UI refleja el estatus del catálogo ([H04]); flujo completo usable en dev.
  - **Depends:** Task 6.

- [ ] **Task 8 (S): Recordatorio Inngest de dispersión de aguinaldo (diciembre).**
  - Función en `lib/inngest/functions/` con cron `0 8 1-19 12 *` y dedupe por companyId+año: alerta a admins antes del 19-dic (límite legal; multa art. 1002 LFT 50–5,000 UMA) vía `NotificationService`/`NotificationDispatcher`.
  - **AC:** no duplica notificaciones el mismo día; expone el estatus legal del cálculo.
  - **Depends:** Tasks 5, 7.

- [ ] **Task 9 (XS): provisión mensual informativa (decisión resuelta Q3: incluida, informativa).**
  - Línea informativa "provisión aguinaldo bruto / 12" en `labor-cost-service.ts`/tooltip de `labor-cost-table.tsx`, marcada `DERIVED`/estimación (no crédito contable), con toggle por tenant para ocultarla (la postura contable formal de pasivo queda fuera de este scope).
  - **AC:** no altera el KPI de semáforo; línea desactivable por inquilino.
  - **Depends:** Task 2.

**Checkpoint 3:** flujo end-to-end en dev (preview→timbrado→payslip) · `pnpm build` limpio · `pnpm run lint` limpio · documentación de usuario (`docs/user-guide.md`, sección nómina: qué incluye el aguinaldo, exención y límites).

### Phase 4: Realidad del sub-registro — salario efectivo, prácticas y liabilidad contingente

Situación de partida: `employeeContracts` tiene UN solo salario (`baseSalary`, `lib/db/schema.ts:1915`) que alimenta CFDI, nómina, finiquito y costo laboral indistintamente. La práctica real del HORECA (formal / mixta con parte en efectivo / informal) no es representable. Esta fase agrega la capa configurada sin romper la retrocompatibilidad del dato existente (todo empleado sin `effectiveSalaryCents` sigue siendo FORMAL).

- [ ] **Task 10 (M): Estructura de compensación configurable (formal/mixta).**
  - Esquema (migración `pnpm db:generate`, sin DROP):
    - `employeeContracts.effectiveSalaryCents int NULL` — salario real recibido incluyendo la parte en efectivo. La parte en efectivo es DERIVADA (`effective − baseSalary`), jamás capturada por separado. `NULL`/igual a `baseSalary` = empleado formal.
    - `tenantOperatingConfig.payrollPracticeMode text NULL` (`FORMAL` | `MIXED`; default `FORMAL`) y `aguinaldoBase text NULL` (`REGISTERED` | `EFFECTIVE`; default `REGISTERED`).
  - UI: captura de salario efectivo en el perfil/contrato del empleado (sólo visible si practice mode permite); nota de que el "salario de registro" (mínimo/proporción regional) es decisión manual de la empresa, no lo auto-calcula el sistema.
  - **AC:** empleados sin dato efectivo se comportan exactamente igual que hoy (regresión cero); migración sin DROP; la parte en efectivo no se puede capturar como campo suelto.
  - **Files:** `lib/db/schema.ts` (o módulo), migración, `lib/services/employee-service.ts`, UI de perfil/contrato.
  - **Depends:** Nada de la Phase 4; puede ir en paralelo con Tasks 5-6.

- [ ] **Task 11 (M): Aguinaldo con base configurable + liabilidad contingente + excedente en efectivo.**
  - `aguinaldo-service.ts` (Task 2) acepta `base: REGISTERED | EFFECTIVE` con la misma exención 30 UMA sobre el bruto elegido.
  - `previsualizarAguinaldo` (Task 5) SIEMPRE muestra ambas columnas: aguinaldo sobre base registrada y sobre base real; si `aguinaldoBase = REGISTERED` y hay gap, calcula la **liabilidad contingente** (diferencia acumulada pagable si el trabajador reclama; prescripción 1 año, LFT art. 516; base de salario real: Jurisprudencia 1a./J. 24/2023).
  - Flujo "excedente en efectivo" cuando `aguinaldoBase = EFFECTIVE`: la parte que excede el timbrable es dispersión registrable con bitácora (acción POST propia de la API de Task 6), **sin CFDI** — nunca se disfraza de percepción timbrada.
  - **AC:** la preview nunca oculta el gap; el excedente en efectivo queda con bitácora y fecha; CFDI 002 sólo cubre la parte registrada.
  - **Depends:** Tasks 4, 5, 6 (contrato API) y Task 10 (esquema).

- [ ] **Task 12 (S): Finiquito, costo laboral y notas legales sobre salario efectivo.**
  - `settlement-calculator.tsx` y `ai-severance-calculator.ts`: cálculo sobre `effectiveSalary` cuando exista, con el gap (base registrada vs base real) visible lado a lado — en juicio las prestaciones se calculan sobre el salario realmente recibido.
  - `labor-cost-service.ts`: el costo del renglón usa salario efectivo (hoy el semáforo de nómina está torcido por este gap exacto); la nota del renglón (@labor-burden) verbaliza si la cifra trae o no la parte de efectivo.
  - Notas legales de sub-registro en la UI de config: diferencias de prestaciones demandables, recargos IMSS (LSS art. 280-B) y art. 516 LFT (prescripción 1 año).
  - **AC:** empleados formales siguen idénticos; con gap, ambos números visibles y la fuente de cada uno declarada.
  - **Depends:** Task 10; Tasks 2 y 3 para reusar el servicio compartido.

**Checkpoint 4:** migración sin DROP · empleados sin `effectiveSalaryCents` con cero regresión · preview de aguinaldo muestra las dos bases · `pnpm test:unit` + `pnpm build` limpios.

### Phase 5: Follow-ups con decisión resuelta — retención ISR y conteo automático de días

Módulos distintos del run de aguinaldo (decididos en la sesión de resolución de preguntas), que NO bloquean el hito de diciembre pero completan el ciclo:

- [ ] **Task 13 (M): Retención ISR del aguinaldo — tarifa anual Art. 174 RLISR.**
  - Módulo propio `lib/services/isr-annual-withholding.ts`: tarifa anual del año del pago + subsidio al empleo aplicable; aguinaldo como ingreso separado con su propia tarifa anual (método Art. 174, el favorable al trabajador).
  - Integración: `executeAguinaldoRun` (Task 5) y, después, `construirDesgloseNomina` de la nómina ordinaria (hoy con deducciones en 0).
  - Libera el riesgo de la empresa como deudora del ISR no retenido.
  - **AC:** caso numérico de estudio documentado en test; deducción integrada al timbrado (no decisionada por run individual); nómina ordinaria retiene correctamente o queda acoplada a este módulo.
  - **Depends:**** Tasks 5 y 6 (para integrarse al run); puede empezar después del Checkpoint 2, en paralelo con Phase 3.

- [ ] **Task 14 (M): Conteo automático de días laborados (decisión resuelta Q2: fase 2 de Q2).**
  - Cruce `shiftSessions` (COMPLETED) + `leaveRequests`/vacaciones aprobadas + incidencias sin goce → `diasLaboradosPorEmpleado(year)`, con revisión manual de las que requieran criterio humano.
  - Prellenado en el campo editable de la preview de Task 7 (el valor automático propuesto, el admin sigue pudiendo ajustarlo).
  - **AC:** conteo reproducible y auditable (fuente declarada por empleado); el valor manual del admin prevalece si lo toca.
  - **Depends:** Task 7 (preview ya existe) y Task 2 (el servicio ya acepta el número externo).

**Checkpoint 5:** retención ISR con caso de estudio verde · conteo de días reproducible con fuente declarada · `pnpm test:unit` + `pnpm build` limpios.

## Risks and Mitigations

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Retención de ISR sobre la parte gravada: hoy el sistema nunca calcula deducciones | Alto | Decisión resuelta (Q1): Task 13 con tarifa anual Art. 174 RLISR, después del Checkpoint 2; mientras, 002 se timbra con exento/gravado declarado y deducciones en 0, documentado en el run |
| Días laborados reales (faltas/incapacidades) no hay conteo sólido automático | Medio | Fallback a días calendario del año fiscal desde `seniorityDate`; ajuste manual en preview/re-sync |
| Migraciones: `db:push` puede DROPear | Alto | Sólo `pnpm db:generate` + revisar SQL: `ADD COLUMN` nullable o con default, nunca `NOT NULL` sin default |
| UMA y salario mínimo cambian cada año | Bajo | Tabla con vigencia por fecha (mismo patrón que `minimumWageMxn`), seed actualizable |
| `payrollTypeCode` afecta la nómina ordinaria existente | Medio | Default 'O' retrocompatible + tests del payload ordinaria sin cambios |
| 30 días "reforma 2026" en el código puede inducir a error | Medio | Catálogo de estatus + tests que fijan 15 como vigente |
| Sub-registro: la config podría "normalizar" la práctica informal | Alto | La parte en efectivo SIEMPRE visible como gap (nunca se mezcla con el timbrado); el excedente de aguinaldo en efectivo lleva bitácora sin CFDI; notas legales en las pantallas donde se elige la base |

## Decisiones resueltas (2026-10-20)

1. **Q1 — Retención ISR del aguinaldo gravado** → **Opción A**: módulo propio de tarifa anual Art. 174 RLISR (favorable al trabajador) en Task 13, independiente del hito de diciembre; hasta entonces, 002 se timbra con exento/gravado declarado y retención en 0, documentado en el run.
2. **Q2 — Días laborados** → **Manual primero**: columna editable "días a considerar" en la preview (Task 7); fallback a días calendario del año fiscal; automatización del conteo con `shiftSessions` + `leaveRequests` en Task 14. Criterio PROFEDET documentado en el Task 2.
3. **Q3 — Provisiones** → **Incluida como informativa**: provisión estimada bruta / 12, `DERIVED`, con toggle por tenant; la postura contable formal de pasivo queda fuera (pertenece al ciclo de cierre financiero).
4. **Q4 — Comisionistas** → **Salario ordinario del contrato únicamente**: las propinas no son salario (CFDI 038) y NO entran al aguinaldo; test-documentación en Task 2; las comisiones deben vivir en el salario del contrato; promedio 30 días (art. 89 LFT) como override futuro.
5. **Q5 — Excedente de aguinaldo en efectivo** → **Dispersión registrable con bitácora** (empleado, monto, fecha, autorizador, motivo), sin CFDI, en Task 11; no asiento contable puro.

## Parallelization

- Task 1 → 2 → 3 y Task 4 son las únicas dependencias duras.
- Task 7 (UI) y Task 8 (Inngest) se pueden paralelizar una vez Task 5/6 definen el contrato de la API.
- Task 9 es independiente de la fase 3.
- Task 10 es independiente de las Phases 2-3 (sólo toca esquema/perfil) y puede ir en paralelo.
- Tasks 11 y 12 son secuenciales después de Task 10 (11 antes de 12; 12 sólo depende del esquema y del servicio puro de la Task 2).
- Task 13 (ISR) y Task 14 (conteo de días) son independientes entre sí y arrancan después del Checkpoint 2; Task 13 no bloquea el hito de diciembre, Task 14 mejora Task 7.
