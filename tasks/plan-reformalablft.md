# Plan de Implementación — Adaptación a Reformas Laborales LFT (2025–2030)

> **Documento:** `tasks/plan-reformalablft.md`  
> **Lista de Tareas:** `tasks/todo-reformalablft.md` (IDs `RL1`–`RL7`)  
> **Contexto Regulatorio:** Reformas Laborales México 2025–2026 / 2030 (Art. 123 CPEUM, Ley Silla DOF 2024–2025, Aguinaldo Digno y LFT Arts. 61, 66, 68, 69, 74, 75).

---

## 1. Overview Ejecutivo

El Congreso y la Secretaría del Trabajo y Previsión Social (STPS) han trazado la hoja de ruta para la reforma laboral más profunda en México en un siglo:
1. **Reducción Escalonada de la Jornada Laboral a 40 Horas:**
   - **2026:** 48 horas semanales (fase preparatoria y foros tripartitas).
   - **2027:** 46 horas semanales.
   - **2028:** 44 horas semanales.
   - **2029:** 42 horas semanales.
   - **2030:** 40 horas semanales (2 días de descanso por cada 5 laborados), **sin reducción salarial**.
2. **Ley Silla (Vigente y Exigible en 2025–2026):**
   - Obliga a disponer de asientos con respaldo y programar pausas periódicas para personal de pie (meseros, cocineros, bartenders, cajeros, hostess).
3. **Impacto Financiero en la Industria HORECA:**
   - La hostelería opera entre 12 y 16 horas diarias durante 6 o 7 días. Si los turnos actuales se mantienen (turnos de 8 horas × 6 días = 48h), la reducción a 46h (2027) o 40h (2030) convertirá de forma automática entre 2 y 8 horas ordinarias semanales por empleado en **horas extras con sobrecosto del 100% (2x) o 200% (3x)**.

Este plan técnico adapta la plataforma Pulso HORECA para:
1. Deshardcodear los límites semanales fijos de 48h en el motor laboral (`LaborCalculator`).
2. Vincular el motor de cálculo a las reglas progresivas ya tipadas en `LaborCalendarRulesService`.
3. Dotar al **Dashboard de Horas Extras** (`/dashboard/labor/overtime`) de un **Simulador Presupuestal de Reforma Laboral en Tiempo Real**, permitiendo al restaurantero prever con su plantilla real el impacto económico en nómina de cada año de la reforma (46h, 44h, 42h, 40h).
4. Reforzar el motor de descansos (`BreakManagementService`) para auditoría de pausas bajo la Ley Silla.

---

## 2. Hallazgos en el Código de Pulso

1. **`LaborCalendarRulesService` ya contenía la progresión teórica:**
   - En `lib/services/labor-calendar-rules.ts:17-53` existe el mapa `LFT_SCHEDULED_REFORMS` de 2026 a 2030 (2026: 48h, 2027: 46h, 2028: 44h, 2029: 42h, 2030: 40h).
2. **`LaborCalculator` estaba desacoplado y hardcodeado a 48h:**
   - `lib/services/labor-calculator.ts:107` tenía `const MAX_WEEKLY_HOURS = 48;` de forma estática en la línea 107 y 184, ignorando el año del período evaluado y sin capacidad de simulación.
3. **El reporte de horas extras `/api/reports/overtime` no proyectaba escenarios:**
   - La API solo calculaba retrospectivamente bajo las 48 horas fijas, sin proveer comparativas ni deltas financieros de sobrecosto.
4. **`BreakManagementService` cuenta con la infraestructura de pausas:**
   - Contamos con la tabla `break_logs` y reglas `breakComplianceRules`, listas para reportar cumplimiento ante inspecciones de la Ley Silla.

---

## 3. Decisiones de Arquitectura

1. **Un solo motor de reglas para umbrales LFT:**
   - `LaborCalculator` debe consultar `LaborCalendarRulesService.getRulesForYear(year)` por defecto, tomando el año del `startDate` evaluado.
2. **Parámetro opcional de simulación en `LaborCalculator`:**
   - Permitir `options?: { simulationWeeklyHours?: number; targetYear?: number }` en `calculateOvertime`. Esto permite simular 46h o 40h sobre períodos históricos sin mutar la fecha real.
3. **Doble evaluación en API cuando hay simulación activa:**
   - Si se invoca `/api/reports/overtime?simulationHours=40`, la API computa el escenario simulado y el escenario base vigente (48h), retornando un bloque `summary.simulation` con:
     - `deltaCostMXN` ($ adicionales en nómina por horas extras).
     - `percentIncrease` (% de incremento en costo de tiempo extraordinario).
     - `additionalOvertimeMinutes` (horas extra generadas por la reducción del tope ordinario).
4. **Experiencia de usuario de alta gama (Alineada a `DESIGN.md`):**
   - Selector limpio en toolbar con chips o tabs compactas: `48h (Vigente 2026)`, `46h (Reforma 2027)`, `44h (Reforma 2028)`, `40h (Reforma 2030)`.
   - Banner ejecutivo no intrusivo con Operational Red reservado estrictamente para advertencia de sobrecosto/infracción.
   - Datos tabulares con tipografía monoespaciada (`tabular-nums`).

---

## 4. Dependency Graph

```
RL1 (LaborCalculator dinámico + options)
 │
 ├── RL2 (Test unitario de simulación y cálculo matemático)
 │
 └── RL3 (API /api/reports/overtime con soporte de simulación y delta)
      │
      └── RL4 (Selector y Banner de Simulación en OvertimeDashboard)
           │
           └── RL5 (KPIs con badges comparativos y tabla reactiva)
                │
                └── RL6 (Auditoría de Pausas Ley Silla en BreakManagement)
                     │
                     └── RL7 (Verificación E2E, Linting y Documentación)
```

---

## 5. Matriz de Riesgos y Mitigaciones

| Riesgo | Impacto | Mitigación |
| :--- | :--- | :--- |
| **Doble conteo de horas extras en semanas simuladas** | Alto | El motor resta el `dailyOvertimeInWeek` antes de computar el excedente semanal: `Math.max(0, excessOverThreshold - dailyOvertimeInWeek)`. |
| **Lentitud en la API al calcular dos escenarios** | Medio | Las sesiones de turnos ya están cargadas en memoria para cada empleado; la segunda pasada de cálculo semanal sobre las mismas sesiones es en memoria (`O(N)` sesiones por usuario) sin consultas adicionales a la BD. |
| **Confusión del usuario entre datos reales y proyectados** | Alto | Cuando `simulationHours < 48`, se despliega un banner ámbar/azul con etiqueta explícita `MODO SIMULACIÓN REFORMA LABORAL` y notas al pie en los KPIs. |

---

## 6. Desglose de Tareas

Las tareas ejecutables y sus criterios de aceptación están formalizados en `tasks/todo-reformalablft.md`.
