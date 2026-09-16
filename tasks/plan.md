# Implementation Plan: Finanzas Operativas y Conciliación TPV Pulso

## Overview

Reestructuración y consolidación del módulo de Finanzas de Pulso (`app/dashboard/finance`) para cadenas HORECA (3 a 15 sucursales), organizado alrededor del ciclo diario del dinero:
**Revisar pendientes (Hoy) → Registrar y autorizar (Gastos) → Programar y confirmar pagos (Pagos) → Control de liquidez y conciliación de tarjetas (Caja y Cobros) → Explicar resultados con procedencia (Resultados) → Cerrar el período con snapshot garantizado (Cierre y Control)**.

Incluye la capa crítica de **conciliación a tres bandas de cobros con tarjeta (TPV)** sin APIs bancarias directas (corte POS vs. vouchers/cierres de lote por terminal vs. reportes CSV/Excel de pasarelas vs. depósitos bancarios D+0/D+1/D+2), la **auditoría matemática de comisiones con segregación de IVA acreditable (16%) preservando la integridad del P&L**, y un **motor antifraude operativo** (cancelaciones sospechosas post-cobro, jineteo de propinas y terminales fantasma).

## Architecture Decisions

1. **Integridad en P&L (Línea 214):** La venta bruta se registra al 100% en ingresos en `pnl-service.ts` para no distorsionar el *food cost %* ni el ticket promedio. La comisión de terminal/pasarela se clasifica como gasto financiero de venta con procedencia `MEASURED` (cuando surge de reporte de pasarela/lote conciliado) o `ESTIMATED` (cuando proyecta tarifa contractual), segregando el IVA acreditable (16%) para conciliación fiscal.
2. **Conciliación TPV basada en artefactos reales:** Sin dependencias de webhooks o APIs bancarias en vivo (inexistentes en el segmento HORECA medio en México). La conciliación cruza:
   - Banda 1: Cortes de turno POS (`daily_sales_cuts` y tickets en tarjeta).
   - Banda 2: Cierre de lote físico por terminal (`tpv_shift_batches` + foto de voucher) y reportes descargables CSV/Excel de pasarelas (Clip, Mercado Pago, bancos) procesados con plantillas configurables (`gateway_mapping_templates`).
   - Banda 3: Abono neto bancario (`tpv_deposit_cents`) desfasado por ventanas de liquidación (D+1 / lunes).
3. **Semántica de pagos por partida individual:** Uso de `paymentRunItems.settlementStatus` (`PENDING`, `CONFIRMED`, `FAILED`) con `settlementReference` congelando la cuenta bancaria de destino para evitar fraudes por cambio de CLABE post-firma. Un rechazo bancario mantiene viva la deuda; una repetición no duplica efectos.
4. **Bandeja Hoy como agregador unificado:** Los pendientes de pago, arqueos de caja, autorizaciones de gasto, alertas antifraude y discrepancias de tarjeta se consultan a través de un endpoint optimizado con conteos completos (sin truncar a 100 registros).
5. **Cierre de período transaccional y recuperable:** `closeFinancialPeriod` en `financial-period-service.ts` garantiza que el período solo pase a `CLOSED` si el snapshot de P&L de todas las sucursales quedó congelado e inmutable.

---

## Task List

### Fase 1: Contratos, Confianza y Correcciones Críticas
- [ ] **Task 1:** Backend unificado de pendientes de Hoy y desacoplamiento temporal de fuentes
- [ ] **Task 2:** Verificación y pruebas de integración para cierre seguro de períodos financieros e idempotencia

### Checkpoint 1: Contratos Base
- [ ] Pruebas unitarias de contratos y períodos pasan (`pnpm test`)
- [ ] `MoneyAttentionPanel` / `FinanceTodayPage` reciben totales sin truncar y sin filtros cruzados

---

### Fase 2: Navegación y Bandeja Hoy
- [ ] **Task 3:** Enriquecimiento del expediente `HoyCaseDossier` con contexto presupuestal y resolución directa
- [ ] **Task 4:** Consolidación de la navegación en `components/app-sidebar.tsx` y enlaces profundos de casos

### Checkpoint 2: Experiencia Hoy
- [ ] Un usuario abre un pendiente desde Hoy, visualiza su expediente y ejecuta la acción en <= 2 clics
- [ ] Los 6 espacios de trabajo están conectados sin rutas huérfanas

---

### Fase 3: Gastos y Pagos Integrados
- [ ] **Task 5:** Conexión de Cuentas por Pagar (`/dashboard/finance/payables`) con creación de corridas de tesorería y cuentas bancarias congeladas
- [ ] **Task 6:** UI de liquidación individual por partida en corridas de tesorería (`/dashboard/finance/treasury/runs/[id]`)

### Checkpoint 3: Flujo de Pagos Completo
- [ ] Partidas individuales pueden confirmarse con referencia o marcarse como fallidas conservando deuda
- [ ] Doble firma respetada; quien prepara no autoriza

---

### Fase 4: Conciliación TPV, Auditoría de Comisiones y Motor Antifraude
- [ ] **Task 7:** Esquema Drizzle y CRUD para catálogo de terminales autorizadas (`branch_terminals`)
- [ ] **Task 8:** Esquema y formulario de cierre de lotes de terminales en turno (`tpv_shift_batches` con foto de voucher)
- [ ] **Task 9:** Importador y motor de mapeo para reportes CSV/Excel de pasarelas (Clip, Mercado Pago, bancos)
- [ ] **Task 10:** Auditoría de comisiones MDR + IVA acreditable y reflejo en P&L con integridad (Línea 214)
- [ ] **Task 11:** Motor de reglas antifraude en cortes (cancelaciones post-cobro, jineteo de propinas y terminales fantasma)

### Checkpoint 4: Conciliación y Antifraude TPV
- [ ] Reporte de pasarela cruza contra lotes físicos y cortes POS
- [ ] Alertas de cancelaciones sospechosas y terminales no autorizadas aparecen en Hoy
- [ ] P&L calcula comisiones con procedencia `MEASURED` sin alterar venta bruta

---

### Fase 5: Cierre de Período y Control Interno
- [ ] **Task 12:** Checklist interactivo de fin de mes y expediente de cierre en `/dashboard/finance/control-interno`

### Checkpoint 5: Cierre Completo
- [ ] Cierre mensual bloqueado si hay discrepancias de tarjeta abiertas o snapshots fallidos
- [ ] Auditoría y trazabilidad de reaperturas con bitácora inmutable

---

## Risks and Mitigations

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Diversidad de formatos CSV/Excel entre bancos y agregadores | Alto | Sistema de plantillas de mapeo configurable (`gateway_mapping_templates`) similar a `pos_mapping_templates`. |
| Rezago bancario en depósitos de fin de semana (D+2) interpretado como faltante | Medio | Ventanas de conciliación con fecha valor que agrupan ventas de viernes a domingo para cuadre el lunes/martes. |
| Inconsistencia de timezone en cruce horario de tickets cancelados post-cobro | Medio | Normalización a hora local de la sucursal con tolerancia configurable de ±20 minutos. |
| Fuga de datos bancarios sensibles en descargas de dispersión | Alto | Exigir permisos estrictos de finanzas (`treasury:disburse`) y máscaras visuales de CLABE en UI. |

---

## Open Questions

1. **Frecuencia de carga de reportes de pasarela:** ¿La importación del CSV/Excel de Clip/MercadoPago/bancos la realizará el gerente diariamente o administración semanal/quincenalmente? (Recomendado: permitir ambas modalidades).
2. **Umbral de tolerancia para alertas de propinas:** ¿Fijar el 20% sobre el consumo como alerta predeterminada o hacerlo configurable por sucursal en `branch_terminals` / configuración operativa?
