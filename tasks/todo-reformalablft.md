# Tasks: Adaptación a Reformas Laborales LFT (2025–2030)

Source plan: `tasks/plan-reformalablft.md`.
Prefijo de tareas: **`RL1`–`RL7`** (Reforma Laboral LFT).

---

## Fase 1 — Motor Laboral Dinámico y Precisión LFT

- [ ] **RL1** Dinamización de `LaborCalculator` con `LaborCalendarRulesService` + soporte de simulación.
  - **Description:** Conectar `calculateOvertime` con las reglas legales progresivas de `LaborCalendarRulesService` para resolver el límite semanal de horas según el año del período (2026: 48h, 2027: 46h, 2028: 44h, 2030: 40h) y aceptar opciones de simulación (`simulationWeeklyHours` y `targetYear`).
  - **Acceptance criteria:**
    - [ ] `calculateOvertime` acepta parámetro opcional `options?: { simulationWeeklyHours?: number; targetYear?: number }`.
    - [ ] El límite semanal deja de ser la constante fija 48h y se resuelve dinámicamente: usa `options.simulationWeeklyHours`, o `getRulesForYear(options.targetYear).maxWeeklyHours`, o `getRulesForYear(startDate.getFullYear()).maxWeeklyHours`.
    - [ ] El excedente semanal por semana ISO descuenta adecuadamente las horas extras diarias ya computadas (`Math.max(0, excess - dailyOvertimeInWeek)`).
    - [ ] El objeto devuelto incluye `weeklyHoursThreshold` utilizado.
  - **Verification:**
    - [ ] `pnpm run build` compila sin errores de tipos.
  - **Dependencies:** None.
  - **Files likely touched:**
    - `lib/services/labor-calculator.ts`
  - **Estimated scope:** S (1 archivo).

- [ ] **RL2** Suite de pruebas unitarias de regresión y simulación de jornada.
  - **Description:** Crear una batería de tests automatizados en Jest para validar que `LaborCalculator` calcula con exactitud matemática el tiempo extraordinario bajo el esquema de 48h y bajo esquemas simulados (46h, 44h y 40h).
  - **Acceptance criteria:**
    - [ ] Test con jornada de 45h semanales en 2026 (48h límite): 0 horas extras semanales.
    - [ ] Mismo test con simulación a 40h (2030): genera exactamente 5 horas extras semanales (300 minutos).
    - [ ] Test con simulación a 46h (2027): genera 0 horas extras si suma 45h, y 2 horas extras si suma 48h.
    - [ ] Validación de que las horas extras diarias no se duplican en el corte semanal.
  - **Verification:**
    - [ ] `pnpm test lib/services/__tests__/labor-calculator-simulation.test.ts` pasa al 100%.
  - **Dependencies:** RL1.
  - **Files likely touched:**
    - `lib/services/__tests__/labor-calculator-simulation.test.ts` (nuevo)
  - **Estimated scope:** S (1 archivo nuevo).

### Checkpoint A (tras RL1–RL2)
- [ ] Pruebas unitarias de cálculo en verde.
- [ ] Regresión de H2 y festivos intacta.

---

## Fase 2 — Backend API y Comparativa Financiera

- [ ] **RL3** Soporte de simulación y deltas presupuestales en `/api/reports/overtime`.
  - **Description:** Habilitar el parámetro `simulationHours` en el endpoint GET de reportes de horas extras, calculando el escenario simulado y comparándolo con el escenario base (48h vigentes) para entregar sobrecostos en pesos ($ MXN) y porcentajes de incremento.
  - **Acceptance criteria:**
    - [ ] La API lee `searchParams.get("simulationHours")`.
    - [ ] Si `simulationHours` está presente y es diferente a 48:
      - Calcula los reportes con el umbral simulado.
      - Si `simulationHours < 48`, genera un cálculo de base a 48h para computar `deltaCostMXN`, `percentIncrease` y `additionalOvertimeMinutes`.
      - Agrega al objeto `summary` la clave `simulation` con los metadatos y deltas.
    - [ ] Si `simulationHours` no se envía, mantiene el comportamiento estándar sin sobrecarga.
  - **Verification:**
    - [ ] Solicitud de prueba a `/api/reports/overtime?startDate=...&endDate=...&simulationHours=40` devuelve `summary.simulation` con delta positivo en costo.
  - **Dependencies:** RL1.
  - **Files likely touched:**
    - `app/api/reports/overtime/route.ts`
  - **Estimated scope:** S (1 archivo).

---

## Fase 3 — Experiencia de Usuario y Simulador en Vivo

- [ ] **RL4** Controles de Simulación de Reforma LFT en `OvertimeDashboard`.
  - **Description:** Incorporar en la barra de herramientas del dashboard un selector de jornada/año de reforma (`48h Vigente 2026`, `46h Reforma 2027`, `44h Reforma 2028`, `40h Reforma 2030`) con persistencia en el estado y recarga automática.
  - **Acceptance criteria:**
    - [ ] Selector visual accesible y alineado a `DESIGN.md` en la cabecera de filtros.
    - [ ] Estado `simulationHours` inicializado en 48.
    - [ ] Al cambiar el selector, se dispara `fetchReport` con el parámetro `simulationHours`.
    - [ ] Indicador visual discreto cuando la simulación está activa.
  - **Verification:**
    - [ ] Inspección visual en navegador: cambiar selector ejecuta llamada a API y actualiza datos.
  - **Dependencies:** RL3.
  - **Files likely touched:**
    - `components/labor/overtime-dashboard.tsx`
  - **Estimated scope:** S (1 archivo).

- [ ] **RL5** Banner ejecutivo de impacto financiero y KPIs comparativos.
  - **Description:** Mostrar un banner informativo cuando la simulación esté activa con el incremento financiero proyectado en nómina y adaptar las tarjetas KPI para mostrar la variación monetaria y en horas.
  - **Acceptance criteria:**
    - [ ] Banner que resume: "Bajo la jornada de X horas ({año}), el sobrecosto quincenal proyectado en horas extras es de +$Y MXN (+Z%) para la plantilla actual".
    - [ ] Tarjeta KPI de Costo Estimado muestra el total simulado y un badge de delta vs 48h.
    - [ ] Tarjeta de Horas Extra Totales refleja las horas adicionales originadas por la reforma.
    - [ ] Tabla tabular muestra el desglose de horas semanales recalculadas.
  - **Verification:**
    - [ ] Captura de pantalla en navegador con modo simulación activo mostrando datos coherentes.
  - **Dependencies:** RL4.
  - **Files likely touched:**
    - `components/labor/overtime-dashboard.tsx`
  - **Estimated scope:** S (1 archivo).

### Checkpoint B (tras RL3–RL5)
- [ ] Flujo interactivo completo del simulador funcionando en UI.
- [ ] El restaurantero puede alternar entre 48h, 46h y 40h y ver la variación en pesos al instante.

---

## Fase 4 — Cumplimiento Ley Silla y Cierre

- [ ] **RL6** Integración y auditoría de pausas ergonómicas (Ley Silla) en `BreakManagementService`.
  - **Description:** Extender `BreakManagementService` para auditar el cumplimiento del descanso obligatorio para empleados en bipedestación continua (cocina y sala) y registrar flags de conformidad ante inspecciones de la STPS.
  - **Acceptance criteria:**
    - [ ] `BreakComplianceConfig` incluye parámetro `leySillaRestRequired` (default: true).
    - [ ] Verificación de pausas de al menos 15-30 minutos por cada 4-5 horas de trabajo continuo sin descanso.
    - [ ] Método `auditLeySillaCompliance(companyId, startDate, endDate)` para reporte de inspección laboral.
  - **Verification:**
    - [ ] `pnpm run build` sin errores.
  - **Dependencies:** None (paralelizable con Fase 2/3).
  - **Files likely touched:**
    - `lib/services/break-management-service.ts`
  - **Estimated scope:** S (1 archivo).

- [ ] **RL7** Verificación integral E2E, Linting y Walkthrough.
  - **Description:** Ejecutar linters, validar compilación de producción, tomar capturas de verificación en navegador (claro y oscuro) y documentar los resultados en `walkthrough.md`.
  - **Acceptance criteria:**
    - [ ] `pnpm run lint` reporta 0 errores.
    - [ ] Pruebas en navegador con Playwright documentadas en video/captura.
    - [ ] `walkthrough.md` actualizado con el detalle del simulador y capturas de pantalla.
  - **Verification:**
    - [ ] `pnpm run lint` pasa limpio.
    - [ ] Capturas guardadas en artefactos.
  - **Dependencies:** RL1–RL6.
  - **Files likely touched:**
    - `walkthrough.md`
  - **Estimated scope:** XS.

### Checkpoint Final (tras RL6–RL7)
- [ ] 0 errores en lint y compilación.
- [ ] Simulador LFT 40h probado en navegador.
- [ ] Plan y tareas completadas y marcadas en el checklist.
