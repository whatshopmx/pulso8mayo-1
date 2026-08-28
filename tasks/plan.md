# Plan de Implementación: Sistema Integral de Egresos, Control Documental y Financiero QSR (3-15 Sucursales)

> **Documento de Referencia:** `finzasordenes.md` (Arquitectura Integral del Sistema: Compras, Pagos, Nómina y Gastos Operativos para Grupo QSR).
> **Principio Rector:** Todo egreso nace con Centro de Costo + Partida Presupuestal, pasa por autorización, cuenta con evidencia física/digital, se concilia a 3 vías contra CFDI y se dispersa en días fijos desde la cuenta concentradora.

---

## 1. Visión y Objetivos del Sistema

Construir y consolidar el ecosistema integral financiero-operativo de Pulso HORECA para grupos restauranteros de 3 a 15 sucursales, conectando 5 módulos operativos en una sola tesorería y un dashboard gerencial unificado de P&L y Prime Cost.

### Los 3 Principios Innegociables
1. **Separación de Funciones:** Quien solicita $\neq$ Quien autoriza $\neq$ Quien recibe $\neq$ Quien paga $\neq$ Quien concilia.
2. **Conciliación de 3 Vías:** Documento de origen ($\text{OC}/\text{OS}$) + Evidencia (Recepción / Conformidad) + Factura $\text{CFDI}$ = Requisito obligatorio para pago.
3. **Punto Único de Verdad:** Base de datos compartida y clasificada por `Sucursal` + `Centro de Costo` + `Partida Presupuestal` (2xxx a 6xxx).

---

## 2. Decisiones Arquitectónicas y Estructura de Datos

1. **Estructura Contable y Centros de Costo (`cost_centers` & `budget_line_items`):**
   - `2xxx` = COGS / Insumos y Empaques.
   - `3xxx` = Nómina Operativa y Cargas Sociales (IMSS, Infonavit, ISN).
   - `4xxx` = Gastos Operativos de Sucursal (Renta, CAM, Luz, Gas, Mantenimiento, Caja Chica).
   - `5xxx` = Gastos Corporativos y Honorarios.
   - `6xxx` = CAPEX y Equipamiento Mayor.
2. **Folios Documentales Transaccionales:**
   - Formato estandarizado sin saltos: `OC-[SUC]-[AÑO]-[N]` y `OS-[SUC]-[AÑO]-[N]` mediante `folio_counters` con bloqueo a nivel de fila (`SELECT ... FOR UPDATE`).
3. **Matriz de Autorización Configurable:**
   - Umbrales por rango de monto: Gerente Sucursal ($\le \$3,000 / \$5,000$), Gerente Operaciones ($\$5,001 - \$25,000$), Director Financiero ($\$25,001 - \$100,000$), Dirección General ($> \$100,000$).
4. **Conciliación Triple Automatizada (3-Way Match):**
   - Validación cruzada entre `purchase_orders` / `service_orders` + `receiving_logs` / `service_order_evidence` + `supplier_invoices` / `cfdi_recibidos`. Tolerancia configurable $\pm 2\%$.
5. **Calendario Maestro de Tesorería:**
   - Corridas fijas de pago: Lunes (Insumos/Perecederos), Miércoles (Nómina y Servicios/Correctivos), Días 1-5 (Rentas y CAM), Día 15 (Proveedores nacionales 30 días), Día 17 (Impuestos y cuotas IMSS).
6. **Dashboard Gerencial y Prime Cost:**
   - Cálculo automático de **Prime Cost %** ($\text{Food Cost} + \text{Labor Cost}$, meta $55-60\%$), **Gasto Operativo %** ($8-12\%$), **Días CxP** y **Días de Inventario**.

---

## 3. Fases y Rebanadas Verticales

```
┌─────────────────────────────────────────────────────────────┐
│ FASE 1: Catálogos Maestros, Partidas y Centros de Costo    │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ FASE 2: Compras (OC), Par Levels y Recepción a Kardex       │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ FASE 3: Órdenes de Servicio (OS) y Evidencia de Conformidad │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ FASE 4: Gastos Operativos, Caja Chica y Contratos Recurrentes│
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ FASE 5: Cuentas por Pagar (CxP) y Conciliación 3 Vías       │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ FASE 6: Nómina Operativa, Asistencia y Provisión de Cargas  │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ FASE 7: Tesorería Concentradora y Calendario Maestro Pagos  │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ FASE 8: Dashboard Gerencial Consolidado y P&L Multi-Unidad  │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Riesgos y Mitigaciones

| Riesgo | Impacto | Estrategia de Mitigación |
| :--- | :---: | :--- |
| **Colisiones de folios concurrentes** | Alto | Uso de `folio_counters` con upsert atómico y bloqueo transaccional. |
| **Descuadre en 3-way match por redondeo de centavos en CFDI** | Medio | Tolerancia de discrepancia configurable ($\pm \$0.50$ o $\pm 2\%$) y semáforo amarillo para revisión manual. |
| **Pagos dispersados fuera de calendario** | Alto | Bloqueo por permisos en API de dispersión; solo usuarios con rol `ADMIN` / `OWNER` pueden autorizar lotes extraordinarios. |
| **Falta de cumplimiento en checador de personal** | Medio | Alerta automática de empleados sin registro de asistencia antes de procesar la nómina semanal. |
