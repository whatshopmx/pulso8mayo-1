/# Plan de Implementación — Pendientes Finance & Sales

> Basado en la evaluación del diseño `pulso-diseno-grupo-restaurantero.md` vs lo implementado en `app/dashboard/finance/` y `app/dashboard/sales/`.
>
> **Buena noticia:** Gran parte del backend ya existe. La tabla `expenseAuthorizationRules`, el servicio `financial-kpi-service.ts` (con food cost + labor cost + semáforos), y el `NotificationDispatcher` ya están implementados. El trabajo es mayormente **UI + conectar lo existente**.

---

## FASE 1: Corregir lo ya construido (2-3 días)

### 1.1 — Thresholds de autorización por monto en expenses

**Archivos a tocar:**
- `app/api/expenses/route.ts` — el POST debe consultar `expenseAuthorizationRules` y decidir `status` (auto-aprobado o pendiente)
- `app/dashboard/finance/expenses/page.tsx` — el botón "Aprobar" solo debe aparecer si el usuario tiene el rol requerido por la regla
- `app/dashboard/finance/expenses/page.tsx` — agregar columna o badge que muestre qué nivel de autorización necesita cada gasto

**Qué existe ya:**
- Tabla `expenseAuthorizationRules` en schema (`minAmount`, `maxAmount`, `approverRole`):
  ```sql
  minAmount   | maxAmount   | approverRole
  0           | 500000      | GERENTE       -- hasta $5,000 MXN
  500001      | 2000000     | DIRECTOR_OPS  -- $5,001 - $20,000
  2000001    | NULL        | OWNER         -- +$20,000
  ```
- Solo falta usarla en el POST y en la UI.

**Cambios precisos:**

1. **`app/api/expenses/route.ts` — POST handler:**
   - Después de crear el expense, hacer una query a `expenseAuthorizationRules` donde `minAmount <= amountCents AND (maxAmount IS NULL OR maxAmount >= amountCents)`
   - Si la regla dice `GERENTE` y el rol del usuario actual es `GERENTE` o superior → `status = "APPROVED"`
   - Si la regla dice `DIRECTOR_OPS` u `OWNER` y el usuario no tiene ese rol → `status = "PENDING_APPROVAL"`
   - Guardar en el expense el `requiredApproverRole` para que la UI sepa qué nivel necesita

2. **`app/dashboard/finance/expenses/page.tsx` — columna de acción:**
   - Cambiar el botón "Aprobar" para que solo sea visible cuando `session.user.role >= item.requiredApproverRole`
   - Mostrar un badge con el nivel requerido cuando está pendiente: "Requiere Gerente", "Requiere Director Ops", "Requiere Owner"

3. **`app/api/expenses/approvals/route.ts` — POST handler:**
   - Verificar que quien aprueba tenga el rol requerido por la regla antes de aprobar

**Estimado:** 1 día

---

### 1.2 — Food cost % y labor cost % en dashboard de ventas

**Archivos a tocar:**
- `components/sales/financial-kpi-cards.tsx` — agregar foodCost y laborCost al `kpis` state y renderizarlos
- `app/api/sales/analytics/route.ts` — opcional: ya devuelve summary, podemos extenderlo o crear un endpoint `/api/finance/kpis` que llame a `calculateFinancialKPIs()`

**Qué existe ya:**
- `lib/services/financial-kpi-service.ts` con `calculateFinancialKPIs()` — devuelve `foodCostPercent`, `foodCostStatus`, `laborCostPercent`, `laborCostStatus`, semáforos OK/WARNING/CRITICAL
- `FinancialKpiCards` ya tiene la estructura de tarjetas con `Efectivo vs Tarjeta`
- Solo falta llamar al servicio y mostrar los KPIs adicionales

**Cambios precisos:**

1. **`components/sales/financial-kpi-cards.tsx`:**
   - Agregar fetch a `/api/finance/kpis?branchId=...` (o extender el fetch existente a `/api/sales/analytics`)
   - Agregar al state `kpis`: `foodCostPercent`, `foodCostStatus`, `laborCostPercent`, `laborCostStatus`
   - Renderizar **debajo** de la barra Efectivo/Tarjeta:
     ```
     ┌──────────────────────────────────────────┐
     │ Food Cost       ████████████░░  28.5% 🟢 │
     │ Labor Cost      ██████████░░░░  26.2% 🟢 │
     │ Margen Saludable             45.3%       │
     └──────────────────────────────────────────┘
     ```
   - Usar color de barra según status: 🟢 success, 🟡 warning, 🔴 destructive

2. **`app/api/finance/kpis/route.ts`** (NUEVO — endpoint ligero):
   ```typescript
   // GET /api/finance/kpis?branchId=xxx&startDate=...&endDate=...
   // Llama calculateFinancialKPIs() y devuelve { foodCostPercent, laborCostPercent, ... }
   ```

**Estimado:** 1 día

---

## FASE 2: Módulos faltantes (5-8 días)

### 2.1 — Módulo 15: Fiscal y Facturación (Validación SAT + Timbrado Nómina)

**Alcance MVP:** Validación de facturas recibidas + timbrado CFDI de nómina.

**Archivos nuevos:**
- `app/dashboard/finance/fiscal/page.tsx` — dashboard de fiscal
- `app/api/finance/fiscal/validate-invoice/route.ts` — consulta estatus SAT
- `app/api/finance/fiscal/timbrar-nomina/route.ts` — emisión CFDI nómina vía FiscalAPI
- `lib/services/fiscal-service.ts` — servicio de facturación
- `components/finance/fiscal-invoice-validator.tsx` — formulario de validación

**Qué requiere:**
- API key de FiscalAPI (sandbox para pruebas)
- Conectar con complemento de nómina de FiscalAPI
- La tabla de `expenses` ya tiene `invoiceUrl`, `invoiceVerified` — se pueden usar

**Estimado:** 2-3 días

---

### 2.2 — Módulo 17: Control Interno (Doble autorización + Bitácora)

**Alcance Starter:** Doble autorización + bitácora de auditoría + reporte básico de excepciones.

**Archivos a tocar:**
- `app/dashboard/finance/control-interno/page.tsx` — NUEVO dashboard
- `app/api/finance/control-interno/audit-log/route.ts` — bitácora de autorizaciones
- `app/api/finance/control-interno/excepciones/route.ts` — reporte de excepciones
- `components/finance/audit-log-table.tsx` — tabla de bitácora
- `components/finance/excepciones-panel.tsx` — panel de excepciones
- `lib/services/control-interno-service.ts` — lógica de validación

**Qué existe ya:**
- `expenses` tiene `approvedByName`, `requestedByName`, `approvalNotes`, `createdAt` — base de bitácora
- `expenseAuthorizationRules` — base de políticas
- La bitácora se puede construir como una vista/materialized query sobre expenses + approvals

**Cambios precisos:**

1. **`app/api/expenses/route.ts` — POST handler (extender Fase 1.1):**
   - Si `requestedBy.id === approvedBy.id` y el gasto es > cierto monto → rechazar: "Segregación: misma persona no puede crear y aprobar"
   - Guardar en bitácora cada acción: create, approve, reject, edit

2. **`app/dashboard/finance/control-interno/page.tsx` — NUEVO:**
   ```
   ┌──────────────────────────────────────────┐
   │ 🔍 Bitácora de Autorizaciones            │
   │ Tabla: Fecha | Usuario | Acción | Monto  │
   ├──────────────────────────────────────────┤
   │ ⚠️ Excepciones                           │
   │ • 3 gastos sin aprobación (>48h)         │
   │ • Misma persona creó y aprobó (2 casos)   │
   │ • Proveedor nuevo sin validar (1 caso)    │
   └──────────────────────────────────────────┘
   ```

3. **`lib/services/control-interno-service.ts`:**
   - `detectViolations(companyId)` — query que detecta: misma persona creó/aprobó, gasto >48h sin aprobar, aprobador sin rol requerido
   - `getAuditTrail(companyId, filters)` — historial completo de autorizaciones

**Estimado:** 2-3 días

---

### 2.3 — Módulo 14: Delivery y Agregadores (baja prioridad)

**Alcance:** Dashboard de rentabilidad por agregador. Solo si el cliente tiene delivery.

**Archivos nuevos:**
- `app/dashboard/sales/delivery/page.tsx` — dashboard
- `components/sales/delivery-commission-form.tsx` — carga de estados de cuenta de agregadores
- `app/api/sales/delivery/route.ts` — CRUD comisiones

**El canal DELIVERY ya existe** en los sales cuts. Faltan las comisiones para calcular rentabilidad real. Este módulo puede esperar a que un cliente concreto lo pida.

**Estimado:** 2 días (cuando se necesite)

---

## FASE 3: Robustecer (3-4 días)

### 3.1 — Alertas proactivas (Módulo 11)

**Archivos a tocar:**
- `lib/inngest/functions/check-financial-alerts.ts` — NUEVA función Inngest cron
- Ya existe `NotificationDispatcher` y `compliance-alert-service.ts`

**Cambios precisos:**

1. **`lib/inngest/functions/check-financial-alerts.ts` — NUEVO:**
   - Cron: `0 8 * * *` (cada mañana 8 AM)
   - Itera sucursales con ventas registradas
   - Llama `calculateFinancialKPIs()` por sucursal
   - Si `foodCostStatus === "CRITICAL"` → notifica Owner + Director Ops vía WhatsApp/email/in-app
   - Si `laborCostStatus === "CRITICAL"` → igual
   - Si `foodCostStatus === "WARNING"` → notifica solo Director Ops
   - Incluye: "Food Cost de Centro subió a 34.2% (objetivo: <30%). Revisa merma y recepción de mercancía."

2. **Registrar la función en `lib/inngest/functions/index.ts`**

**Estimado:** 1 día

---

### 3.2 — Workflow Corte de Caja + Cierre con verificación automática

**Archivos a tocar:**
- `templates/workflows/corte-caja.json` — NUEVO template
- `templates/workflows/cierre-sucursal.json` — ACTUALIZAR template existente
- `lib/services/smart-link-service.ts` — ya existe, verificar que soporte los nuevos Smart Links
- `app/api/workflows/smart-links/corte-caja/route.ts` — endpoint del Smart Link
- `app/api/workflows/smart-links/upload-pos/route.ts` — endpoint del Smart Link

**Cambios precisos:**

1. **Template `corte-caja.json`:**
   - 6 pasos, 1 responsable (rol `CAJERO`)
   - Paso con `type: "smart_link"`, target: `/api/workflows/smart-links/corte-caja`
   - Campos: efectivo, tarjeta, cupones, rappi, uber, didi, tickets
   - Se dispara 15 min antes del fin de turno

2. **Template `cierre-sucursal.json` (actualizar):**
   - Paso 22: `type: "smart_link"`, target: `/api/workflows/smart-links/upload-pos`
   - Acepta file upload (CSV/Excel) o verifica si ya llegó por correo automático
   - Si el sistema detecta el archivo en el buzón `ventas-[sucursal]@pulso.mx` → auto-completa el paso

3. **`app/api/workflows/smart-links/corte-caja/route.ts`:**
   - Misma lógica que `SalesCutUpload` en modo manual pero expuesto como endpoint de Smart Link
   - Recibe `workflowInstanceId`, `stepId`
   - Al completar: marca el paso del workflow como ✓ y crea el registro en `dailySalesCuts`

4. **`lib/inngest/functions/check-pos-email.ts`** (opcional, para futuro):
   - Cron que monitorea el buzón de correo y hace ingest del archivo automáticamente

**Estimado:** 2-3 días

---

## Resumen de fases

| Fase | Items | Días estimados | Dependencias |
|---|---|---|---|
| **Fase 1** | 1.1 Thresholds autorización + 1.2 KPIs en dashboard | 2-3 días | Ninguna — backend ya existe |
| **Fase 2** | M15 Fiscal + M17 Control Interno + (M14 Delivery opcional) | 5-8 días | FiscalAPI sandbox key |
| **Fase 3** | Alertas proactivas + Workflows Corte/Cierre | 3-4 días | Fases 1 y 2 completas |

**Total estimado:** 10-15 días hábiles

---

## Orden recomendado de ejecución

```
Día 1-2:   Fase 1.1 (Thresholds autorización) → Fase 1.2 (KPIs dashboard)
           ↳ Entrega: el dueño ya ve Food Cost % y Labor Cost % en Ventas.
             El sistema ya auto-aprueba/rechaza según nivel de autoridad.

Día 3-7:   Fase 2.2 (Control Interno) → Fase 2.1 (Fiscal)
           ↳ Entrega: bitácora de auditoría, doble autorización activa,
             validación SAT de facturas, timbrado de nómina.

Día 8-10:  Fase 3.2 (Workflows Corte/Cierre) → Fase 3.1 (Alertas)
           ↳ Entrega: cajeros registran corte desde su celular,
             gerentes cierran con verificación automática del POS,
             alertas proactivas cada mañana.

Día 11+:   Fase 2.3 (Delivery) — solo si se necesita
```

---

## Notas técnicas

- **FiscalAPI**: requiere registro en [fiscalapi.com](https://fiscalapi.com) (sandbox gratuito). El SDK Node.js se integra directamente.
- **Smart Links**: `smart-link-service.ts` ya existe en `lib/services/`. Soporta creación, validación, expiración y marca de uso. Solo hay que crear los endpoints de callback específicos para corte de caja y upload POS.
- **Correo automático**: el buzón `ventas-[sucursal]@pulso.mx` requiere un servicio de inbound email (Resend, SendGrid Inbound Parse, o similar). Es un item separado que se puede implementar después; mientras tanto el gerente sube el archivo manualmente por el Smart Link.
- **Inngest**: todas las funciones cron ya están en `lib/inngest/functions/`. Solo hay que agregar la nueva función de alertas financieras.
