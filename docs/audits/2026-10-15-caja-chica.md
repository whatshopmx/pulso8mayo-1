# Auditoría de Conexión: C23 — Resolución del Límite de Caja Chica (`pettyCashLimitCents`)

**Fecha:** 15 de octubre de 2026  
**Tarea:** C23 — Resolver el límite de caja chica  
**Fase:** Fase 3 — Configuración que produce efectos (Cierre de Puerta de Fase)  
**Hallazgos atendidos:** H04 (Políticas decorativas vs reglas operativas aplicadas en servidor)

---

## 1. Contexto y Problema

En la auditoría inicial de C15 (`lib/company/operating-policy-catalog.ts`), `pettyCashLimitCents` se clasificó honestamente como `descriptiva`: ningún servicio leía la columna para limitar nada, y `petty-cash-service.ts` abría y reponía fondos con los montos escritos libremente por el operador.

Existía el riesgo de confundir tres conceptos completamente diferentes:
1. El monto máximo de efectivo asignado como fondo fijo a una sucursal (`fundAmount`).
2. El saldo disponible en caja física contra el cual se descuentan retiros menores (`currentBalance`).
3. La escalera de autorización de gastos corporativos y cuentas por pagar (`managerAuthLimitCents`, `doubleApprovalThresholdCents`, `managerAutonomy`).

---

## 2. Contrato y Distinción Tripartita

La implementación en C23 formaliza la distinción tripartita mediante el módulo puro `lib/finance/petty-cash-policy.ts`:

### A. Límite del Fondo (`pettyCashLimitCents` en `tenant_operating_config`)
- **Nivel:** Corporativo / Grupo.
- **Aplicación:** Gobierna `openFund` y `replenishFund` en `lib/services/petty-cash-service.ts`.
- **Semántica:**
  - `null`: Sin tope corporativo. Cada sucursal puede abrir fondo por cualquier monto positivo autorizado por gerencia.
  - `0`: Caja chica **deshabilitada** en la empresa. Se rechazan intentos de apertura y reposiciones de fondos.
  - `> 0`: Tope máximo por sucursal (`fundAmountCents <= pettyCashLimitCents`).
  - **Reposición (`replenishFund`):** Un fondo fijo no puede ser repuesto por encima de su capacidad autorizada (`currentBalance + amount <= fundAmount`).
  - **Fondos existentes (Grandfathering):** Reducir el límite o deshabilitar la política no destruye ni recorta fondos preexistentes; conservan su saldo y permiten retiros ordinarios.

### B. Límite por Gasto / Retiro (`fund.currentBalance` en `petty_cash_funds`)
- **Nivel:** Físico / Sucursal.
- **Aplicación:** Gobierna `registerOutflow`. Todo retiro exige que el saldo en caja cubra el monto (`currentBalance >= amountCents`).
- **Auditoría:** Exige concepto explícito y comprobante fotográfico (`evidenceUrl`).
- **Naturaleza:** Desembolso inmediato de efectivo para necesidades operativas menores en sucursal (hielo, taxis, compras menores de mostrador).

### C. Límite de Aprobación (`managerAuthLimitCents`, `doubleApprovalThresholdCents`, `managerAutonomy`)
- **Nivel:** Cuentas por pagar corporativas (`expense-service.ts`, `rolExigidoPorMonto`).
- **Aplicación:** Determina qué rol (`GERENTE`, `ADMIN`, `OWNER`) debe aprobar compras o gastos facturados según su importe.
- **Relación:** **Ortogonal** a la caja chica física. Un retiro en efectivo de caja chica no pasa por cuentas por pagar ni escala a Dirección General.

---

## 3. Implementación

1. **Módulo de Política:** `lib/finance/petty-cash-policy.ts`
   - `validarAperturaFondo`: valida monto > 0, bloqueo por deshabilitación (0), tope corporativo positivo y coherencia de `lowThresholdCents`.
   - `validarReposicionFondo`: valida monto > 0, bloqueo por deshabilitación (0) y tope al fondo fijo autorizado (`newBalance <= fundAmount`).
   - `validarRetiroFondo`: valida monto > 0, saldo suficiente en caja y concepto obligatorio.
   - `distinguirLimitesDeCajaChica`: descriptor formal del contrato.

2. **Servicio Integrado:** `lib/services/petty-cash-service.ts`
   - `openFund`: lee `getTenantOperatingConfig(companyId)` y aplica `validarAperturaFondo`.
   - `replenishFund`: lee configuración corporativa y aplica `validarReposicionFondo`.
   - `registerOutflow`: aplica `validarRetiroFondo` con errores estructurados `ApiError.badRequest`.

3. **Catálogo y UI:**
   - `lib/company/operating-policy-catalog.ts`: `pettyCashLimitCents` reclasificada como `aplicada` con sus consumidores `validarAperturaFondo`, `openFund` y `replenishFund`. Se retira de decisiones pendientes.
   - `components/company/financial-thresholds-section.tsx`: Muestra el badge `Se aplica hoy` y texto de ayuda actualizado indicando que gobierna apertura y reposición.
   - `docs/operating-policy-contracts.md`: Actualizado con los 5 umbrales monetarios aplicados y contrato de caja chica.

---

## 4. Evidencia de Verificación

### V1 — Pruebas Unitarias
- `tests/unit/finance/petty-cash-limit.test.ts`: **18 pruebas aprobadas** (distinción tripartita, apertura, reposición, retiros, fondos preexistentes y ortogonalidad con `rolExigidoPorMonto`).
- `tests/unit/company/operating-policy-catalog.test.ts`: **24 pruebas aprobadas** (resumen de 8 políticas aplicadas, 5 descriptivas, 0 pendientes).
- Suite unitaria completa: **93 archivos, 1,244 pruebas aprobadas**, 1 omitida, 1 TODO, 0 fallos.

### V2 — Pruebas de Navegador
- `tests/e2e/operating-config.spec.ts`: **31 pruebas aprobadas en Chromium**, verificando la etiqueta `Se aplica hoy`, persistencia y textos de ayuda.
- Suite aislada de navegador (`tests/playwright-shifts.config.ts`): **75 pruebas aprobadas**, 0 fallos.

### Neon — Base de Datos Real
Ejecutado con `node --use-system-ca --import tsx scripts/verify-petty-cash-limit.ts` sobre dos empresas de prueba aisladas:
1. `Empresa A` con tope corporativo ($3,000 MXN) rechaza apertura de $5,000 MXN.
2. `Empresa A` permite apertura dentro del tope ($2,000 MXN).
3. `Empresa B` con `pettyCashLimitCents = null` abre exitosamente fondo por $10,000 MXN sin tope de grupo.
4. Salida en efectivo en A1 descuenta saldo atómicamente a $1,500 MXN.
5. Retiro superior a $1,500 MXN rechazado por saldo insuficiente.
6. Reposición superior al fondo fijo autorizado ($2,000 MXN) rechazada en servidor.
7. Reposición exacta al 100% aprobada.
8. `Empresa A` actualiza política a `pettyCashLimitCents = 0` (deshabilitada).
9. Apertura y reposición rechazadas por deshabilitación.
10. Grandfathering comprobado: fondo preexistente conserva saldo y permite retiros residuales.
11. Aislamiento multi-tenant estricto: `Empresa B` no puede operar fondo de `Empresa A`.
12. Limpieza total y confirmada en Neon sin datos residuales.

---

## 5. Cierre de Fase 3 (Puerta de Fase)

Con C23 completada y verificada, todas las tareas de la **Fase 3 — Configuración que produce efectos** (C13 a C23) están al 100%:
- C13: Configuración ida y vuelta.
- C14: Parámetros consumidos (fiscales, laborales, merma) con vigencia por periodo.
- C15: Catálogo de políticas operativas.
- C16: Estructura de compras (matriz OC y controles de delegación).
- C17: Producción de alimentos (aislamiento de transferencias y producción).
- C18: Tesorería (autorización por rol en corrida de pagos).
- C19: Pagos a proveedores (deduplicación con bloqueo transaccional FOR UPDATE).
- C20: Autonomía del gerente (escalera de gastos con ALTA/MEDIA/BAJA).
- C21: Dispersión de nómina (declaración descriptiva honesta con timbrado sandbox FiscalAPI).
- C22: Tipo de empresa (segmentación de redes en Liga de Sucursales).
- C23: Límite de caja chica (distinción tripartita y validación en servidor).

`tsc --noEmit` limpio (0 errores) y `pnpm run lint` limpio (0 errores, 2,412 warnings preexistentes).  
**La Puerta de Fase de la Fase 3 queda cerrada.**
