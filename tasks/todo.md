# Task Checklist: QSR System Completion (Módulos 0 al 8)

## Phase 1: Catálogos y Recetario (Módulo 0 & 1)
- [x] **Task 1: Scorecard de Evaluación de Proveedores**
  - [x] Crear agregador de métricas en `lib/services/supplier-scorecard-service.ts` (Puntualidad 35%, Calidad 35%, Temp NOM-251 30%)
  - [x] Crear endpoint `GET /api/inventory/suppliers/[id]/scorecard`
  - [x] Agregar componente `SupplierScorecardCard` en vista de proveedores
  - [x] Verificar con tests unitarios y build

- [x] **Task 2: Versionado Histórico de Fichas Técnicas de Recetas**
  - [x] Crear tabla `recipe_versions` en `lib/db/schema/`
  - [x] Implementar snapshotting inmutable en `lib/services/recipe-service.ts`
  - [x] Crear endpoint `GET /api/inventory/recipes/[id]/versions`
  - [x] Verificar auditoría histórica tras mutación

- [x] **Checkpoint 1: Catálogos y Fichas**
  - [x] Tests pasan y `pnpm run build` exitoso

---

## Phase 2: Forecast Clima MTY & Producción Diaria (Módulo 2 & 3)
- [x] **Task 3: Modificador de Clima Extremo Monterrey en Forecast y Prep List**
  - [x] Extender `forecast-service.ts` con modificador de clima (+40°C canícula / eventos locales)
  - [x] Configurar reglas de sensibilidad por categoría (Fríos +25%, Calientes -15%)
  - [x] Agregar selector de clima/evento en interfaz de Prep List
  - [x] Verificar cálculo y explosión en `prep-list-service.ts`

- [x] **Task 4: Hard Stop NOM-251 y Trazabilidad Instantánea en Recepción**
  - [x] Conectar rechazo térmico en `receiving-temperature.ts` con creación automática de `supplier_claims`
  - [x] Generar alerta inmediata por WhatsApp/In-App al Gerente de Operaciones
  - [x] Validar flujo simulado con producto cárnico >4°C

- [x] **Checkpoint 2: Operaciones y Clima**
  - [x] Flujo de forecast y recepción probado

---

## Phase 3: Control Documental OC/OS y Conciliación 3-Way (Módulo 4 & 5)
- [x] **Task 5: Consolidación de Discrepancias en 3-Way Match**
  - [x] Marcar facturas en `ALERTA_DISCREPANCIA` cuando variación de precio/cantidad supere tolerancia
  - [x] Añadir filtro y comparador visual en `app/dashboard/finance/payables/page.tsx`
  - [x] Implementar flujo de autorización de excepción para auditores
  - [x] Validar bloqueo de facturas con discrepancia en corrida de pago

- [x] **Task 6: Contracontraste de Gastos Recurrentes (Renta / CFE / Servicios)**
  - [x] Implementar validación automática de CFDIs recibidos contra `recurring_contracts`
  - [x] Generar alerta si el monto excede +10% del contrato base
  - [x] Visualizar en el tablero de control interno

- [x] **Checkpoint 3: Finanzas y Conciliación**
  - [x] 3-Way Match y contratos recurrentes validados

---

## Phase 4: Tesorería y Nómina Validada (Módulo 6 & 7)
- [x] **Task 7: Orquestador de Dispersión Bancaria y Lotes de Pago con Doble Firma**
  - [x] Validar en `payment_runs` separación de roles: `preparedBy` != `approvedBy`
  - [x] Bloquear inclusión de cuentas bancarias CLABE no verificadas
  - [x] Generar layout de dispersión bancaria
  - [x] Validar error 403 al intentar auto-aprobarse

- [x] **Task 8: Bloqueo de Nómina Pre-Timbrado por Validación de Checador**
  - [x] Implementar check previo en `payroll-service.ts` contra `shift_sessions` validadas
  - [x] Bloquear timbrado si existen empleados fantasma sin checador
  - [x] Integrar cálculo de carga social (35-40%) en costo laboral real
  - [x] Validar bloqueo preventivo

- [x] **Checkpoint 4: Tesorería y Nómina**
  - [x] Flujo de dispersión y nómina verificado

---

## Phase 5: Dashboard Corporativo Consolidado de 15 Sucursales (Módulo 8)
- [x] **Task 9: Tablero Ejecutivo Consolidado y Semáforos Multidimensionales**
  - [x] Construir vista consolidada para grupos de 3 a 15 sucursales en `app/dashboard/executive/page.tsx`
  - [x] Implementar semáforos 🟢 🟡 🔴 dinámicos con umbrales de `tenantOperatingConfig`
  - [x] Habilitar drill-down a sucursal y comparativo de Food Cost %, Labor Cost % y Prime Cost %
  - [x] Validar compilación final `pnpm run build` y `pnpm run lint`

- [x] **Checkpoint Final: Sistema Integral Operativo y Financiero Listo**
