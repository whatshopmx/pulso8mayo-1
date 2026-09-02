# TODO activo: cierre de la auditoría de Finanzas

> **Puntero.** El detalle por tarea —aceptación, verificación, archivos, tamaño y el porqué de
> cada una— vive en `tasks/todo-cierre-auditoria-finanzas.md`. Plan: `tasks/plan.md` →
> `tasks/plan-cierre-auditoria-finanzas.md`.

**Estado (2026-09-01): fases 0–5 cerradas, más A6.1 y A6.3.** D1 se resolvió con tasa de IVA
configurable por inquilino, D2 con factor de carga patronal nullable, y D3 dejando sólo el
formato SPEI genérico. Siguen abiertas A6.2 (🔒 D4), A6.4 (diferida por alcance) y A6.5 (🔒 D5).
Lo verificado, las migraciones aplicadas y las dos desviaciones declaradas están al final de
`tasks/todo-cierre-auditoria-finanzas.md`.

Convenciones: dinero en centavos · `companyId`/`branchId` siempre desde la sesión ·
`pnpm run build` limpio antes de cada commit · specs con datos `[E2E]` fuera de julio–agosto de
2026 · copy en español · `pnpm db:generate`, nunca `db:push`.

## Fase 0 — Los dos huecos de control · P0
- [x] **A0.1** `BranchScope` en `markPaid` y `reschedule` de gastos — S
- [x] **A0.2** Máquina de estados en `updatePaymentRunStatus` — S
- [x] **A0.3** Specs de alcance y de transición — S

## Fase 1 — Encender el flujo de efectivo · P0
- [x] **A1.1** Ventana de historial propia, separada de la proyectada — S
- [x] **A1.2** Estimación estacional por día de la semana (quitar `inflowBasis = "NONE"`) — M
- [x] **A1.3** Spec de las tres bases de procedencia — S

## Fase 2 — Tesorería que opera · P0
- [x] **A2.1** Congelar la cuenta bancaria en la partida (migración) — S
- [x] **A2.2** Autorización y auditoría del layout — S · **antes que A2.3**
- [x] **A2.3** CLABE en claro, escape de CSV, referencia única — M
- [x] **A2.4** Emitir `PAYROLL`; declarar lo no dispersable con su motivo — M
      (`PETTY_CASH_REIMBURSEMENT` y `OTHER` **no** se emiten: no hay cuenta destino en el esquema)
- [x] **A2.5** Quitar el N+1 del generador — S
- [x] **A2.6** Un solo formato honesto — D3 → sólo el SPEI genérico

## Fase 3 — La base de los números
- [x] **A3.1** Persistir `tax_amount` en `daily_sales_cuts` (migración) — S
- [x] **A3.2** Porcentajes sobre venta neta, con procedencia — D1 → opción (c)
- [x] **A3.3** Factor de carga patronal + ISN estatal — D2 → opción (a)

## Fase 4 — Cerrar el circuito del gasto
- [x] **A4.1** `payment_method`, `tax_amount`, `paid_by` en `operating_expenses` (migración) — M
- [x] **A4.2** Caja chica al P&L y al presupuesto — M
- [x] **A4.3** Regla de deducibilidad: efectivo > $2,000 MXN — S

## Fase 5 — Control interno que detecta
- [x] **A5.1** Filtro de período y cota en `detectViolations` — S
- [x] **A5.2** Quitar el carve-out `minAmount > 0` de `SELF_APPROVAL` — XS
- [x] **A5.3** Regla de fraccionamiento — M
- [x] **A5.4** Regla de pago duplicado — S
- [x] **A5.5** Extender `branch-scope-finanzas.spec.ts` a las 7 superficies fuera de la red — S
- [x] **A5.6** Migrar las 7 rutas del `requireAuth` legacy — M

## Fase 6 — Producto
- [x] **A6.1** Comisiones: IVA sobre la comisión y tarifa por sucursal — M
- [ ] **A6.2** Promociones financiadas por el restaurante — 🔒 D4
- [x] **A6.3** Revalidar vigencia de CFDI ya conciliados — M
- [ ] **A6.4** Pago parcial de factura — M · diferida por decisión de alcance
- [ ] **A6.5** Complemento de pago (REP) y DIOT — 🔒 D5
