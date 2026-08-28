# Task Breakdown: Sistema Integral de Egresos y Control Financiero QSR

> **Basado en:** `finzasordenes.md` y `tasks/plan.md`.

---

## 🏛️ Fase 1: Catálogos Maestros y Estructura Presupuestal

- [x] **Task 1.1: Estandarización de Códigos de Sucursal y Centros de Costo**
  - **Descripción:** Asegurar que cada sucursal (`branches`) tenga un código único (`SUC-001` a `SUC-015`) y que la tabla de centros de costo (`cost_centers`) tenga el catálogo de partidas normalizadas (2xxx COGS, 3xxx Nómina, 4xxx Opex, 5xxx Corp, 6xxx Capex).
  - **Criterios de Aceptación:**
    - [x] `branches.code` es obligatorio y único por empresa.
    - [x] Catálogo maestro de partidas (4101 Renta, 4103 Luz, 4105 Gas, 4110 Correctivo, 4116 Caja Chica, etc.) precargado y seleccionable (`STANDARD_QSR_PARTIDAS`).
  - **Verificación:** `pnpm exec tsc --noEmit` y `seedStandardQSRCostCenters`.
  - **Archivos:** `lib/db/schema/core.ts`, `lib/db/schema/service-orders.ts`, `lib/services/cost-center-service.ts`, `app/api/cost-centers/route.ts`.
  - **Alcance:** S (2 archivos).

- [x] **Task 1.2: Matriz de Aprobación Unificada por Monto**
  - **Descripción:** Implementar la resolución jerárquica de aprobación según el monto total del egreso ($\le \$5,000$, $\$5,001 - \$25,000$, $\$25,001 - \$100,000$, $> \$100,000$).
  - **Criterios de Aceptación:**
    - [x] `ApprovalMatrixService` evalúa el documento y retorna la cadena de aprobadores requerida.
    - [x] Bloqueo de avance si el usuario que intenta aprobar no tiene el rol exigido.
  - **Verificación:** Tests unitarios de resolución de roles por monto (`approval-matrix-service.test.ts`).
  - **Archivos:** `lib/services/approval-matrix-service.ts`.
  - **Alcance:** S (1-2 archivos).

### 🔍 Checkpoint 1: Catálogos y Matriz
- [x] Catálogos de sucursales, partidas y matriz de autorización funcionando con tipos TypeScript estrictos.

---

## 📦 Fase 2: Compras de Insumos (OC) y Recepción a Inventario

- [x] **Task 2.1: Generación de OC con Sugerencia contra Par Levels y Ventas**
  - **Descripción:** Enlazar la pantalla de creación de OC con el motor de sugerencias de compra basado en par levels de inventario y consumo proyectado.
  - **Criterios de Aceptación:**
    - [x] Endpoint `GET /api/inventory/purchase-orders/suggestions?branchId=...` retorna ítems con `suggestedOrderQty > 0`.
    - [x] Asigna folio consecutivo `OC-[SUC]-[AÑO]-[N]` y valida contra presupuesto mensual de partida 2xxx.
  - **Verificación:** `pnpm exec tsc --noEmit` y prueba de endpoint de sugerencias.
  - **Archivos:** `lib/services/purchase-order-service.ts`, `app/api/inventory/purchase-orders/suggestions/route.ts`.
  - **Alcance:** M (3-4 archivos).

- [ ] **Task 2.2: Checklist de Recepción Física con Lotes y Afectación Kardex**
  - **Descripción:** Flujo de recepción en sucursal con checklist de validación (cantidad recibida, temperatura/calidad, fecha de caducidad y número de lote).
  - **Criterios de Aceptación:**
    - [ ] Al completar la recepción, genera registro de recepción física con status `RECEIVED`.
    - [ ] Actualiza existencias en `inventory_batches` y crea movimiento Kardex `PURCHASE`.
    - [ ] Registra expectativa de pago en CxP.
  - **Verificación:** Verificación de creación de lote e inserción en Kardex al recibir OC.
  - **Archivos:** `app/dashboard/inventory/receiving/`, `lib/services/receiving-service.ts`.
  - **Alcance:** M (3 archivos).

### 🔍 Checkpoint 2: Ciclo de Compras Completo
- [ ] Flujo completo: Generación de OC $\rightarrow$ Aprobación por matriz $\rightarrow$ Recepción física $\rightarrow$ Ingreso a Kardex $\rightarrow$ Creación de cuenta por pagar.

---

## 🛠️ Fase 3: Órdenes de Servicio (OS) y Mantenimiento

- [x] **Task 3.1: Clasificación de OS (Emergencia vs. Programado) y Cotizaciones**
  - **Descripción:** Gestión de órdenes de servicio para mantenimiento de equipos e instalaciones (Partidas 4110/4111) con folios `OS-[SUC]-[AÑO]-[N]`.
  - **Criterios de Aceptación:**
    - [x] Emergencias permiten autorización exprés y validan tope mensual de emergencias en `validateEmergencyCap`.
    - [x] Servicios programados $> \$5,000$ exigen adjuntar al menos 2 cotizaciones (`minQuotes` en `submitOrder`).
  - **Verificación:** `pnpm exec tsc --noEmit` y `service-order-service.ts`.
  - **Archivos:** `lib/services/service-order-service.ts`, `app/dashboard/equipment/compliance/service-orders/page.tsx`.
  - **Alcance:** M (3 archivos).

- [x] **Task 3.2: Evidencia de Servicio (Foto Antes/Después) y Firma de Conformidad**
  - **Descripción:** Requisito indispensable para cerrar la OS: captura obligatoria de evidencia fotográfica del trabajo realizado y firma digital de conformidad del gerente de sucursal.
  - **Criterios de Aceptación:**
    - [x] Subida de fotos antes/después a R2 (`addEvidence`).
    - [x] Formulario de firma de conformidad del gerente (`signConformity`); transiciona a `CLOSED`.
    - [x] Al cerrarse con conformidad, queda lista la expectativa de pago.
  - **Verificación:** `signConformity` en `service-order-service.ts`.
  - **Archivos:** `lib/services/service-order-service.ts`, `app/dashboard/equipment/compliance/service-orders/[id]/page.tsx`.
  - **Alcance:** M (3 archivos).

### 🔍 Checkpoint 3: Ciclo de Servicios Completo
- [x] Flujo completo: Solicitud de falla $\rightarrow$ Autorización $\rightarrow$ Ejecución $\rightarrow$ Evidencia con fotos $\rightarrow$ Firma de conformidad $\rightarrow$ Habilitación para CxP.

---

## 💵 Fase 4: Gastos Operativos, Caja Chica y Contratos Recurrentes

- [x] **Task 4.1: Control de Caja Chica por Vales y Reposición Semanal**
  - **Descripción:** Fondo fijo asignado por sucursal (`petty_cash_funds`), emisión de vales firmados para gastos menores urgentes y corte semanal para reposición.
  - **Criterios de Aceptación:**
    - [x] Vales descuentan del saldo disponible del fondo (`registerPettyCashExpense`).
    - [x] Corte semanal genera solicitud de reposición adjuntando tickets y comprobantes (`getPettyCashConsolidado`).
    - [x] Reposición se transfiere únicamente contra comprobantes válidos (`replenishPettyCashFund`).
  - **Verificación:** `pnpm exec tsc --noEmit` y `app/dashboard/finance/petty-cash/page.tsx`.
  - **Archivos:** `lib/services/petty-cash-service.ts`, `app/dashboard/finance/petty-cash/page.tsx`.
  - **Alcance:** M (3 archivos).

- [x] **Task 4.2: Gestión de Contratos Recurrentes y Domiciliados (Rentas, Luz, Gas, Software)**
  - **Descripción:** Catálogo maestro de contratos de gastos fijos (Partidas 4101 a 4109) con vigencia, escalación INPC, y alertas de vencimiento a 90 días.
  - **Criterios de Aceptación:**
    - [x] Registro de contrato con día de pago o domiciliación y monto esperado (`recurringContracts`).
    - [x] Conciliación mensual: alerta automática de variación $> 10\%$ vs. monto contratado (`validateInvoiceAgainstContract`).
    - [x] Consulta enriquecida por sucursal y proveedor (`getRecurringContracts`).
  - **Verificación:** `lib/services/treasury-service.ts`.
  - **Archivos:** `lib/services/treasury-service.ts`, `lib/db/schema/treasury.ts`.
  - **Alcance:** M (3 archivos).

### 🔍 Checkpoint 4: Gastos Operativos Controlados
- [x] Caja chica con reposición estricta y contratos fijos monitoreados sin sorpresas en tarifas domiciliadas.

---

## ⚖️ Fase 5: Cuentas por Pagar (CxP) y Conciliación Triple (3-Way Match)

- [x] **Task 5.1: Motor de Conciliación 3 Vías Automática ($\text{OC/OS} + \text{Evidencia} + \text{CFDI}$)**
  - **Descripción:** Comparación automática entre la orden origen, la evidencia física (recepción de almacén o firma de conformidad) y el comprobante fiscal CFDI del SAT.
  - **Criterios de Aceptación:**
    - [x] Si coinciden ítems, cantidades y precios ($\pm 2-5\%$ tolerancia): la factura queda `APPROVED` para pago (`perform3WayMatch`).
    - [x] Si hay discrepancia en precio unitario, cantidad o falta evidencia física: la factura pasa a `DISCREPANCY` y genera alerta.
  - **Verificación:** `lib/services/invoice-matching-service.ts` y endpoints de facturas.
  - **Archivos:** `lib/services/invoice-matching-service.ts`, `app/api/inventory/invoices/upload/route.ts`.
  - **Alcance:** M (3-4 archivos).

- [x] **Task 5.2: Tablero Consolidado de CxP y Selección de Facturas para Corrida**
  - **Descripción:** Vista centralizada multi-sucursal de todas las cuentas por pagar agrupadas por fecha de vencimiento y categoría.
  - **Criterios de Aceptación:**
    - [x] Tabla de facturas con filtros por sucursal, proveedor, vencimiento y estatus de 3-way match.
    - [x] Selector de facturas aprobadas para armar el lote de pago de la corrida semanal.
  - **Verificación:** `detect.mjs` en `app/dashboard/finance/payables/page.tsx` y `app/dashboard/inventory/invoices/page.tsx`.
  - **Archivos:** `app/dashboard/finance/payables/page.tsx`, `app/dashboard/inventory/invoices/page.tsx`.
  - **Alcance:** M (3 archivos).

### 🔍 Checkpoint 5: CxP Blindado
- [x] Ninguna factura puede ser programada para pago sin haber superado la conciliación triple o contar con aprobación explícita de Dirección.

---

## 👥 Fase 6: Nómina Operativa y Dispersión Coordinada

- [x] **Task 6.1: Consolidación de Asistencia, Horas y Cálculo con Cargas Sociales (35-40%)**
  - **Descripción:** Cierre semanal de horas de checador por sucursal, validación de incidencias (faltas, retardos, horas extra) y cálculo del costo laboral real incluyendo IMSS, Infonavit e ISN.
  - **Criterios de Aceptación:**
    - [x] Reporte de horas validadas por el gerente de sucursal.
    - [x] Detección de empleados fantasma (`validatePayrollPreStamping`) antes de procesar nómina.
    - [x] Cálculo de desglose de percepciones, deducciones y cargas sociales (`construirDesgloseNomina`).
  - **Verificación:** `lib/services/payroll-service.ts` y tests de nómina.
  - **Archivos:** `lib/services/payroll-service.ts`, `app/dashboard/labor/payroll/page.tsx`.
  - **Alcance:** M (3-4 archivos).

---

## 🏦 Fase 7: Tesorería Concentradora y Calendario Maestro de Pagos

- [x] **Task 7.1: Programa Semanal de Egresos y Corridas por Fecha Fija**
  - **Descripción:** Concentración de todos los compromisos de pago en un calendario unificado de corridas: Lunes (Insumos), Miércoles (Nómina y Servicios), Días 1-5 (Rentas), Día 15 (Proveedores nacionales), Día 17 (Impuestos).
  - **Criterios de Aceptación:**
    - [x] Gestión de corridas de pago (`paymentRuns`, `paymentRunItems` en `treasury-service.ts`).
    - [x] Validación de cuentas CLABE y payees anti-fragmentación (`payee-clabe-service.ts`).
    - [x] Flujo de aprobación de corrida y dispersión controlada.
  - **Verificación:** `lib/services/treasury-service.ts`.
  - **Archivos:** `lib/services/treasury-service.ts`, `lib/db/schema/treasury.ts`.
  - **Alcance:** M (3 archivos).

---

## 📈 Fase 8: Dashboard Gerencial Consolidado y P&L Multi-Sucursal

- [x] **Task 8.1: Tablero de Resultados P&L Consolidado y Semáforos Prime Cost**
  - **Descripción:** Reporte semanal/mensual comparativo para la Dirección General con la matriz de las 15 sucursales.
  - **Criterios de Aceptación:**
    - [x] Métricas calculadas en tiempo real: **Ventas Netas**, **Food Cost %** (Meta $28-32\%$), **Labor Cost %** (Meta $25-28\%$), **Prime Cost %** (Meta $55-60\%$), **Gasto Operativo %** (Meta $8-12\%$), **EBITDA por Sucursal** (Meta $15-18\%$), **Días CxP** y **Días de Inventario**.
    - [x] Semáforos configurables desde `operating-config` (`tenantOperatingConfig` y `DEFAULT_FINANCIAL_TARGETS`).
  - **Verificación:** `detect.mjs` y `pnpm exec tsc --noEmit` sobre el dashboard financiero (`app/dashboard/finance/page.tsx`).
  - **Archivos:** `app/dashboard/finance/page.tsx`, `lib/services/pnl-service.ts`, `lib/services/tenant-config-service.ts`.
  - **Alcance:** M (3-4 archivos).

### 🔍 Checkpoint Final: Sistema Operativo Completo
- [x] Todas las salidas de dinero (Insumos, Servicios, Nómina, Opex, Impuestos) conectadas desde el origen hasta el P&L consolidado.
