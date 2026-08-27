# Implementation Plan: QSR Group Management System (Módulos 0 al 8 + NFRs)

## Overview

Plan de ejecución estructurado y dividido en tareas atómicas y verificables para consolidar y cerrar las brechas identificadas en el sistema integral multitenant para grupos QSR de 3 a 15 sucursales (Área Metropolitana de Monterrey: NOM-251, CFDI 4.0, clima extremo).

---

## Architecture & Dependency Graph

```
[M0 & M1: Catálogos & Recetario con Versionado]
  │  ├── Scorecard de Proveedores (Puntualidad / Calidad / NOM-251)
  │  └── Fichas Técnicas & Versionado Histórico (recipe_versions)
  ▼
[M2 & M3: Inventario FEFO, Clima MTY & Prep List]
  │  ├── Ajustador de Clima Extremo en Forecast (+40°C Canícula / Eventos)
  │  └── Motor FEFO & Registro de Merma con afectación contable
  ▼
[M4 & M5: OC/OS, Matriz de Autorización & 3-Way Match]
  │  ├── Folios Consecutivos Atómicos & Token WhatsApp
  │  └── Conciliación Triple (OC/OS + Recepción/Firma + CFDI 4.0) & Contratos
  ▼
[M6 & M7: Tesorería, Dispersión & Nómina Validadas]
  │  ├── Lotes de Pago con Doble Firma & Cuentas CLABE verificadas
  │  └── Checador Biométrico/GPS & Validación Pre-Timbrado Nómina
  ▼
[M8: Dashboard Gerencial & P&L Consolidado 15 Sucursales]
     └── Single Source of Truth (Food Cost %, Labor Cost %, Prime Cost %, EBITDA)
```

---

## Task Breakdown

### Phase 1: Catálogos y Recetario (Módulo 0 & 1)

#### Task 1: Scorecard de Evaluación de Proveedores
**Description:** Implementar el cálculo mensual y vista de evaluación de proveedores basada en puntualidad de entrega, calidad de insumos y cumplimiento de temperatura de recepción NOM-251.
**Acceptance criteria:**
- [ ] Servicio de agregación de métricas de proveedor que cruza `receiving_reports`, `temperature_logs` y `supplier_claims`.
- [ ] Scorecard de 0 a 100 con desglose: Puntualidad (35%), Calidad/Faltantes (35%), Temperatura conforme NOM-251 (30%).
- [ ] Endpoint `GET /api/inventory/suppliers/[id]/scorecard` con histórico mensual.
**Verification:**
- [ ] Tests unitarios en `lib/services/__tests__/supplier-scorecard.test.ts`.
- [ ] `pnpm run build` sin errores.
**Dependencies:** None
**Files likely touched:**
- `lib/services/supplier-scorecard-service.ts`
- `app/api/inventory/suppliers/[id]/scorecard/route.ts`
- `components/inventory/supplier-scorecard-card.tsx`

---

#### Task 2: Versionado Histórico de Fichas Técnicas de Recetas
**Description:** Crear la tabla `recipe_versions` y lógica de snapshotting inmutable cada vez que el Chef Ejecutivo o Administrador actualiza ingredientes, factores de rendimiento o tiempos de retención.
**Acceptance criteria:**
- [ ] Tabla `recipe_versions` con `recipeId`, `versionNumber`, `snapshotJson` (ingredientes, cantidades, yield, holdTime), `costCalculatedCents`, `changedBy`, `changeReason`.
- [ ] Trigger/Servicio en `recipe-service.ts` que crea una versión inmutable antes de aplicar mutaciones a `recipe_items`.
- [ ] Endpoint `GET /api/recipes/[id]/versions` para auditoría histórica.
**Verification:**
- [ ] Modificar una receta y verificar que se genera la fila de versión en Postgres con el histórico íntegro.
- [ ] `pnpm run build` sin errores.
**Dependencies:** None
**Files likely touched:**
- `lib/db/schema/core.ts` o `lib/db/schema/index.ts`
- `lib/services/recipe-service.ts`
- `app/api/recipes/[id]/versions/route.ts`

---

### Checkpoint 1: Catálogos y Fichas
- [ ] Scorecard de proveedores activo y calculando ponderación.
- [ ] Versionado de recetas auditando cambios de costo histórico.
- [ ] `pnpm run build` limpio.

---

### Phase 2: Forecast Clima MTY & Producción Diaria (Módulo 2 & 3)

#### Task 3: Modificador de Clima Extremo Monterrey en Forecast y Prep List
**Description:** Extender el motor de proyección de ventas para incorporar un multiplicador por temperatura ambiente extrema (>38°C en verano/canícula) y eventos locales sobre categorías sensibles (bebidas, postres fríos vs platillos calientes).
**Acceptance criteria:**
- [ ] Campo opcional `weatherModifier` y `localEvent` en el cálculo de forecast diario (`forecast-service.ts`).
- [ ] Regla de sensibilidad por categoría: Bebidas/Fríos (+15% a +35%), Sopas/Guisos calientes (-10% a -20%).
- [ ] Selector rápido en la UI de Prep List: "Día Normal", "Ola de Calor (>40°C)", "Día Lluvioso", "Evento Deportivo MTY".
**Verification:**
- [ ] Probar cálculo de forecast con modificador climático y validar explosión de ingredientes en `prep-list-service.ts`.
- [ ] `pnpm run build` sin errores.
**Dependencies:** Task 2
**Files likely touched:**
- `lib/services/forecast-service.ts`
- `lib/services/prep-list-service.ts`
- `components/inventory/prep-list-view.tsx`

---

#### Task 4: Hard Stop NOM-251 y Trazabilidad Instantánea en Recepción
**Description:** Asegurar que el bloqueo físico por temperatura fuera de rango en recepción (`receiving-temperature.ts`) genere automáticamente un `supplier_claim` y notifique al comprador corporativo en tiempo real.
**Acceptance criteria:**
- [ ] Al detectar temperatura no conforme (>4°C en refrigerado o >-18°C en congelado), se rechaza la línea de recepción de la OC.
- [ ] Creación automática de fila en `supplier_claims` con tipo `QUALITY` y evidencia de lectura térmica.
- [ ] Despacho de alerta urgente al Gerente de Operaciones por WhatsApp/In-App.
**Verification:**
- [ ] Simular recepción a 6°C en producto cárnico y verificar rechazo + claim generado.
- [ ] `pnpm run build` sin errores.
**Dependencies:** None
**Files likely touched:**
- `lib/services/receiving-service.ts`
- `lib/services/receiving-temperature.ts`
- `lib/services/supplier-claim-service.ts`

---

### Checkpoint 2: Operaciones y Clima
- [ ] Ajuste climático de Monterrey afectando el forecast y la hoja de prep list.
- [ ] Hard stop térmico NOM-251 generando reclamo a proveedor y alerta inmediata.

---

### Phase 3: Control Documental OC/OS y Conciliación 3-Way (Módulo 4 & 5)

#### Task 5: Consolidación de Discrepancias en 3-Way Match
**Description:** Afinar el motor de conciliación triple para que discrepancias de precio o cantidad (>1% o tolerancia del proveedor) pongan la factura en estado `ALERTA_DISCREPANCIA` y bloqueen la inclusión en la corrida de pagos hasta visto bueno.
**Acceptance criteria:**
- [ ] `invoice-matching-service.ts` marca `matchStatus = 'DISCREPANCY'` cuando variación > tolerancia.
- [ ] Vista en `app/dashboard/finance/payables/page.tsx` con filtro de facturas con discrepancia y comparativo visual (OC vs Recepción vs CFDI).
- [ ] Botón de autorización de excepción con motivo justificado para auditores/directores.
**Verification:**
- [ ] Cargar CFDI con precio $105 vs OC $100 (variación 5% > 1%) y verificar estado de discrepancia.
- [ ] `pnpm run build` limpio.
**Dependencies:** None
**Files likely touched:**
- `lib/services/invoice-matching-service.ts`
- `lib/services/accounts-payable-service.ts`
- `app/dashboard/finance/payables/page.tsx`

---

#### Task 6: Contracontraste de Gastos Recurrentes (Renta / CFE / Servicios)
**Description:** Comparar automáticamente los CFDIs de gastos operativos recurrentes contra los contratos marco en `recurring_contracts` y alertar variaciones >10%.
**Acceptance criteria:**
- [ ] Servicio de validación recurrente que contrasta monto de factura mensual contra `baseAmountCents` del contrato.
- [ ] Generación de `compliance_alerts` si el recibo excede la tolerancia contractual (+10%).
- [ ] Visualización en el módulo de control interno y gastos.
**Verification:**
- [ ] Simular factura de luz con 15% de sobreconsumo y verificar alerta de contracontraste.
- [ ] `pnpm run build` sin errores.
**Dependencies:** None
**Files likely touched:**
- `lib/services/fiscal-buzon-service.ts`
- `lib/services/cfdi-recibidos-service.ts`
- `lib/services/expense-service.ts`

---

### Phase 4: Tesorería y Nómina Validada (Módulo 6 & 7)

#### Task 7: Orquestador de Dispersión Bancaria y Lotes de Pago con Doble Firma
**Description:** Consolidar el flujo de corridas de pago semanales/quincenales con bloqueo de dispersión sin doble firma y validación de cuentas bancarias CLABE activas.
**Acceptance criteria:**
- [ ] `payment_runs` solo transiciona a `PROCESSING`/`COMPLETED` si `preparedBy` ≠ `approvedBy` (separación de funciones estricta).
- [ ] Rechazo automático de líneas de pago cuya cuenta CLABE esté en `PENDING_VERIFICATION` o `REJECTED`.
- [ ] Generación de layout bancario estándar / webhook de dispersión.
**Verification:**
- [ ] Intentar aprobar corrida con el mismo usuario preparador y validar error 403 / Forbidden.
- [ ] `pnpm run build` sin errores.
**Dependencies:** Task 5
**Files likely touched:**
- `lib/services/treasury-service.ts`
- `lib/services/supplier-bank-account-service.ts`
- `app/dashboard/finance/treasury/page.tsx`

---

#### Task 8: Bloqueo de Nómina Pre-Timbrado por Validación de Checador
**Description:** Prohibir el timbrado y generación de CFDIs de nómina para empleados sin asistencia/incidencias validadas por el Gerente de Sucursal (regla cero empleados fantasma).
**Acceptance criteria:**
- [ ] `payroll-service.ts` valida que todo colaborador en el período tenga turnos confirmados en `shift_sessions` o incidencias justificadas en `shift_approvals`.
- [ ] Alerta bloqueante con listado de colaboradores no validados que detiene la ejecución del timbrado.
- [ ] Cálculo exacto de carga social (35-40%) para costeo real de mano de obra en P&L.
**Verification:**
- [ ] Intentar procesar nómina con empleado sin sesiones y verificar bloqueo preventivo.
- [ ] `pnpm run build` sin errores.
**Dependencies:** None
**Files likely touched:**
- `lib/services/payroll-service.ts`
- `lib/services/labor-calculator.ts`
- `lib/services/labor-cost-service.ts`

---

### Phase 5: Dashboard Corporativo Consolidado de 15 Sucursales (Módulo 8)

#### Task 9: Tablero Ejecutivo Consolidado y Semáforos Multidimensionales
**Description:** Construir la vista ejecutiva de dirección que consolida en tiempo real las 3 a 15 sucursales con métricas clave: Ventas, Food Cost %, Labor Cost %, Prime Cost %, EBITDA y Varianza Presupuestal.
**Acceptance criteria:**
- [ ] Tabla matricial con ordenamiento por sucursal y totales consolidados de la cadena.
- [ ] Semáforos 🟢 🟡 🔴 dinámicos alimentados de `tenantOperatingConfig` (Food cost target 30%, Labor 28%, Margen 45%).
- [ ] Drill-down con 1-clic a la sucursal para ver desglose de varianza en insumos o partidas de mantenimiento.
**Verification:**
- [ ] Verificar renderizado y cálculo de métricas en la página ejecutiva con datos consolidados.
- [ ] `pnpm run build` y `pnpm run lint` limpios.
**Dependencies:** Tasks 1, 3, 5, 8
**Files likely touched:**
- `app/dashboard/executive/page.tsx`
- `components/sales/financial-kpi-cards.tsx`
- `lib/services/cross-branch-service.ts`
- `lib/services/financial-kpi-service.ts`

---

## Checkpoint Final: Integración Completa
- [ ] Todas las pruebas automatizadas pasan.
- [ ] Build de producción compila limpiamente (`pnpm run build`).
- [ ] Flujo físico y flujo financiero unificados en la base de datos sin fricción.
