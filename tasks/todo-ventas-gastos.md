# M13 Ventas/POS + M16 Pagos y Gastos — Task List

Source plan: `tasks/plan-ventas-gastos.md`. Continúa numeración de `tasks/todo-grupo-restaurantero.md` (última tarea: T23). Baseline: gap analysis 2026-08-04 de `docs/pulso-diseno-grupo-restaurantero.md` v2.

Convenciones del repo que aplican a todas las tareas:
- Dinero en centavos (integer). Todo scoping por `companyId`/`branchId` + `requireTenant()`.
- Migraciones con `pnpm db:generate` (nunca `db:push` sin verificar `.env`).
- Verificación base de cada tarea: `pnpm run build` limpio.

Open questions (resolver antes de T25/T30/T33 — ver plan):
- Q1: ¿Buzón de correo CC diferido? (recomendado: sí)
- Q2: ¿Cortes POS reales del cliente piloto disponibles?
- Q3: Caja chica: ¿solo monto + foto? (recomendado: sí)
- Q4: P&L sin IVA (recomendado)
- Q5: Formulario fallback dentro del workflow de cierre (recomendado)

---

## Phase 9 — M13: Ventas y POS

- [x] **T24** Schema de ventas: tablas `daily_sales_cuts` y `pos_mapping_templates`. *Files: `lib/db/schema.ts`, `drizzle/0021_striped_wallop.sql` (migración aplicada a dev 2026-08-05; FKs a `users.id` como `text`). Size M.*
  - Acceptance: `daily_sales_cuts` con `id, companyId, branchId, businessDate, shift (MATUTINO/VESPERTINO/COMPLETO), channel (SALON/DELIVERY/EVENTOS/TOTAL), totalSales, cashSales, cardSales, ticketCount, avgTicket, source (UPLOAD/WHATSAPP/MANUAL_FORM), rawFileUrl, status (VALIDATED/PENDING_REVIEW/REJECTED), validationNotes, receivedBy, receivedAt`; unique compuesto `(companyId, branchId, businessDate, shift, channel)`. `pos_mapping_templates` con `id, companyId, name, posSystem, mapping (jsonb: columna→campo canónico), paymentMethodMapping (jsonb), isDefault, createdBy`. Índices por `(companyId, branchId, businessDate)`.
  - Verify: `pnpm db:generate` produce migración sin drops inesperados; `pnpm run build` limpio.
  - Dependencies: None.

- [ ] **T25** Servicio de ingesta de cortes: esquema canónico, diccionario de alias, parseo y validación. *Files: `lib/services/sales-ingestion-service.ts` (new), `lib/services/pos-column-aliases.ts` (new, archivo de datos). Size M.*
  - Acceptance: **(a) Esquema canónico** con campos: `businessDate` (requerido), `totalSales` (requerido), `cashSales`, `cardSales`, `otherPayments`, `ticketCount`, `taxAmount`, `discounts`, `cancellations`, `paymentMethod` (columna en modo detalle), `category` (opcional). **(b) Diccionario de alias** por campo con variantes comunes de POS mexicanos (ej. totalSales: "Total", "Venta Total", "Total Ventas", "Importe Total", "Venta Neta", "Gran Total", "Net Sales"; ticketCount: "Tickets", "No. Tickets", "Cuentas", "Transacciones", "Folios"; efectivo: "Efectivo", "Cash"; tarjeta: "Tarjeta", "TDC", "TDD", "Crédito", "Débito"), normalizando acentos/mayúsculas/puntuación. Agregadores como valores de forma de pago: Rappi/Uber Eats/DiDi → canal DELIVERY. **(c) Detección de file shape** (`summary` | `payment_summary` | `ticket_detail` | `multi_sheet`): en `ticket_detail` agrega por forma de pago y cuenta tickets. **(d)** `detectMapping(headers)` retorna mapeo propuesto con confianza (alta=alias exacto, media=fuzzy, ninguna=sin match) sin persistir. **(e)** `ingestSalesCut()` valida: totales > 0, `cash + card + otros ≈ total` (±2%), `ticketCount > 0`, fecha no futura, sin duplicado `(branchId, businessDate, shift)`; rechazo con motivo legible en español. `previewSalesCut()` retorna N filas mapeadas para la UI.
  - Verify: build limpio; script tsx con 3 fixtures sintéticos (uno por file shape: summary llave-valor, tabla por forma de pago, detalle de tickets) → los 3 producen corte VALIDATED con los mismos totales; totales que no cuadran → PENDING_REVIEW; duplicado → 409 lógico; headers en inglés sin acentos → detección por alias igual funciona.
  - Dependencies: T24.

- [ ] **T26** Upload manual de corte: API + UI. *Files: `app/api/sales/cuts/route.ts` (GET list / POST create), `app/api/sales/cuts/upload/route.ts` (new), `app/dashboard/sales/page.tsx` (new), `components/sales/sales-cut-upload.tsx` (new). Size M.*
  - Acceptance: POST `/api/sales/cuts/upload` acepta multipart (archivo + branchId + fecha + turno), corre T25, persiste en `daily_sales_cuts`. GET lista cortes con filtro por sucursal/rango de fechas. Página `/dashboard/sales` con dropzone de upload, selector de sucursal/fecha/turno, y tabla de cortes recientes con status. Auth + tenant verificados. Entrada "Ventas" en sidebar (nueva sección Finanzas).
  - Verify: build limpio; upload de fixture desde la UI → fila en tabla con status VALIDATED; re-upload mismo día/turno → error 409 con mensaje claro.
  - Dependencies: T25.

- [ ] **T27** Configuración de plantillas de mapeo POS con auto-detección. *Files: `app/api/sales/mapping-templates/route.ts` (new), `app/dashboard/sales/mapping/page.tsx` (new), `components/sales/mapping-template-form.tsx` (new). Size M.*
  - Acceptance: CRUD de plantillas por tenant. Flujo: subir archivo de ejemplo → `detectMapping()` propone asignación columna→campo canónico con badge de confianza (🟢 alias exacto / 🟡 fuzzy / ⚪ sin mapear) → usuario confirma o cambia vía dropdowns → preview de 5 filas ya mapeadas → guardar persiste JSONB (incluye `fileShape`, `headerRow`, `paymentMethodMapping`, formato de fecha/decimal). Campo `posSystem` texto libre con sugerencias (Soft Restaurant, Aloha, Simphony, Poster, Square, Aspel CAJA, Eleventa, SICAR, genérico). Plantilla "genérica" pre-cargada usable sin configuración.
  - Verify: build limpio; subir fixture de detalle de tickets → columnas detectadas con confianza correcta; guardar → usar esa plantilla en T26 mapea sin configuración adicional.
  - Dependencies: T25, T26.

- [ ] **T28** Dashboard de ventas por sucursal/turno/canal. *Files: `lib/services/sales-analytics-service.ts` (new), `app/api/sales/analytics/route.ts` (new), `app/dashboard/sales/page.tsx` (extender), `components/sales/sales-dashboard.tsx` (new). Size M.*
  - Acceptance: KPIs del período: venta total, ticket promedio, # tickets, venta por canal (si el corte trae formas de pago de agregadores, se agrupan como DELIVERY). Gráfica de tendencia diaria (Recharts), comparativa entre sucursales, desglose por turno. Filtros: rango de fechas + sucursal. Reusa componentes de `components/analytics/`.
  - Verify: build limpio; con 7+ días de cortes sembrados, gráficas renderizan y los totales cuadran con la suma de cortes.
  - Dependencies: T26.

- [ ] **T29** KPIs financieros: food-cost % y labor % de venta + alertas de desviación. *Files: `lib/services/financial-kpi-service.ts` (new), `lib/services/notification-dispatcher.ts` (nuevos event types), `components/sales/financial-kpi-cards.tsx` (new). Size M.*
  - Acceptance: `getFoodCostPercent(branchId, period)` = consumo teórico de inventario (reusa `theoretical-consumption-service`) ÷ venta del período. `getLaborCostPercent(branchId, period)` = costo laboral (reusa `labor-calculator`) ÷ venta. Cards en `/dashboard/sales` con semáforo configurable (default food cost objetivo 28-30%, alerta >35%; labor objetivo <30%). Event type `FINANCIAL_KPI_DEVIATION` en el dispatcher con template WhatsApp + in-app.
  - Verify: build limpio; con datos sembrados donde food cost = 34%, card muestra 🟡; forzar 36% → notificación generada.
  - Dependencies: T28.

### Checkpoint H (after T24–T29)
- [ ] `pnpm run build` limpio
- [ ] Upload manual de corte funciona end-to-end con plantilla de mapeo
- [ ] Dashboard de ventas muestra datos reales por sucursal/turno/canal
- [ ] Food-cost % y labor % calculan contra ventas reales
- [ ] Revisión con humano antes de seguir a WhatsApp

---

- [ ] **T30** WhatsApp: recepción de documento de corte + formulario fallback. *Files: `lib/whatsapp/workflow-conversation-handler.ts` (extender), `lib/whatsapp/evidence-processor.ts` (extender para `document`), `app/api/whatsapp/webhook/route.ts` (media type document). Size L.*
  - Acceptance: cuando el paso activo del workflow de cierre espera evidencia tipo `document`, el handler acepta CSV/XLSX adjunto por WhatsApp, lo pasa a `ingestSalesCut` (T25) y responde "✅ Corte recibido: $X, Y tickets" o el motivo de rechazo. **Spike primero (timebox 1h):** verificar que WasenderAPI entrega documentos con URL descargable; si no, fallback a foto+OCR y se documenta la decisión. Formulario fallback conversacional (venta total, efectivo vs tarjeta, # tickets) que crea un corte `MANUAL_FORM` cuando no hay archivo POS.
  - Verify: build limpio; envío de CSV real por WhatsApp sandbox → corte VALIDATED y confirmación en el chat; formulario fallback completo crea corte con source MANUAL_FORM.
  - Dependencies: T25, T26.

- [ ] **T31** Integración al workflow de cierre + cron de recordatorio. *Files: `templates/operaciones_diarias/cierre-restaurante-v2-enhanced.json` (paso de corte), `lib/inngest/functions/cron-sales-cut-reminder.ts` (new), `lib/inngest/functions/index.ts`, `lib/services/sales-ingestion-service.ts` (método `isCutReceived(branchId, date)`). Size M.*
  - Acceptance: plantilla de cierre incluye paso "Ventas del día registradas" que se auto-completa si `isCutReceived()` es true (evidencia ligada al corte). Cron corre 30 min después del horario de cierre configurado: si no hay corte → notificación `SALES_CUT_MISSING` al gerente por WhatsApp; si pasan 2h → escala a Director Ops (reusa patrón de `cron-check-overdue`).
  - Verify: build limpio; ejecutar cierre con corte ya recibido → paso ✓ automático; simular cierre sin corte → recordatorio y escalamiento en Inngest dev server.
  - Dependencies: T30.

### Checkpoint I (after T30–T31)
- [ ] `pnpm run build` limpio
- [ ] Corte por WhatsApp cierra el paso del workflow automáticamente
- [ ] Falta de corte genera recordatorio y escalamiento
- [ ] Flujo completo de cierre de sucursal probado end-to-end en dev

---

## Phase 10 — M16: Pagos y Gastos

- [ ] **T32** Schema de gastos: `petty_cash_funds`, `petty_cash_transactions`, `operating_expenses`, `expense_authorization_rules`. *Files: `lib/db/schema.ts`, `drizzle/` (migración). Size M.*
  - Acceptance: `petty_cash_funds(id, companyId, branchId unique por sucursal, fundAmount, currentBalance, lowThreshold, active)`. `petty_cash_transactions(id, fundId→petty_cash_funds, type (OUT/REPLENISHMENT/ADJUSTMENT), amount, concept, evidenceUrl, registeredBy, approvedBy, createdAt)`. `operating_expenses(id, companyId, branchId, category (RENTA/SERVICIOS/MANTENIMIENTO/PUBLICIDAD/SERVICIOS_PROFESIONALES/OTROS), amount, description, invoiceId→invoices nullable, status (PENDING_APPROVAL/APPROVED/REJECTED/PAID), requestedBy, approvedBy, paidAt, dueDate, createdAt)`. `expense_authorization_rules(id, companyId, minAmount, maxAmount, approverRole, branchId nullable para overrides por sucursal)`. Montos en centavos.
  - Verify: `pnpm db:generate` sin drops inesperados; build limpio.
  - Dependencies: None (paralelizable con T24).

- [ ] **T33** Caja chica: servicio + API + UI. *Files: `lib/services/petty-cash-service.ts` (new), `app/api/petty-cash/route.ts` + `app/api/petty-cash/transactions/route.ts` (new), `app/dashboard/finance/petty-cash/page.tsx` (new), `components/finance/petty-cash-register.tsx` (new). Size M.*
  - Acceptance: servicio con `getOrCreateFund(branchId)`, `registerOutflow(fundId, amount, concept, evidenceUrl)` (valida saldo suficiente, descuenta atómicamente), `getBalance(branchId)`, historial paginado. UI: card con saldo actual vs fondo, formulario de salida (monto, concepto, foto de ticket vía `use-photo-upload`), tabla de movimientos. Solo gerente/admin registra salidas.
  - Verify: build limpio; registrar salida de $180 con foto → saldo baja, movimiento en historial, evidencia visible; salida mayor al saldo → error claro.
  - Dependencies: T32.

- [ ] **T34** Reposición y alerta de umbral de caja chica. *Files: `lib/services/petty-cash-service.ts` (método `replenish()`), `lib/inngest/functions/cron-petty-cash-check.ts` (new), `lib/services/notification-dispatcher.ts` (event `PETTY_CASH_LOW`). Size S.*
  - Acceptance: cron diario detecta fondos bajo `lowThreshold` → notificación `PETTY_CASH_LOW` a gerente + admin con monto sugerido de reposición (fondo − saldo). `replenish()` registra transacción REPLENISHMENT y restaura saldo, con aprobador registrado.
  - Verify: build limpio; fondo con saldo < umbral → notificación en Inngest dev; `replenish()` → saldo restaurado y transacción en historial.
  - Dependencies: T33.

- [ ] **T35** Gastos operativos por categoría. *Files: `lib/services/expense-service.ts` (new), `app/api/expenses/route.ts` (new), `app/dashboard/finance/expenses/page.tsx` (new), `components/finance/expense-form.tsx` + `expense-list.tsx` (new). Size M.*
  - Acceptance: CRUD de gastos con categoría, monto, descripción, sucursal, fecha de vencimiento y vínculo opcional a factura conciliada (`invoiceId`). Reglas: monto > 0, categoría requerida. Lista con filtros (sucursal, categoría, status, rango de fechas) y totales por categoría del mes. Al crearse, aplica `expense_authorization_rules` para asignar aprobador y status inicial.
  - Verify: build limpio; crear gasto de renta $25,000 → status PENDING_APPROVAL con aprobador según regla; filtro por categoría RENTA suma correcto.
  - Dependencies: T32.

- [ ] **T36** Autorización de gastos por niveles de monto. *Files: `lib/services/expense-approval-service.ts` (new, patrón de `shift-approval-service.ts`), `app/api/expenses/approvals/route.ts` (new), `components/finance/expense-approval-list.tsx` (new), `lib/services/notification-dispatcher.ts` (event `EXPENSE_PENDING_APPROVAL`). Size M.*
  - Acceptance: servicio con `getPendingForApprover(userId, role)`, `approve(expenseId, decision, comment)`, `reject(...)`. Reglas default del tenant (ej. <$5,000 → GERENTE; $5,000-$50,000 → Director Ops/ADMIN; >$50,000 → OWNER). Al crearse gasto → notificación al aprobador con monto y concepto. Aprobar/rechazar notifica al solicitante. Bitácora: toda decisión persiste `approvedBy` + timestamp + comentario (base para M17).
  - Verify: build limpio; gasto de $3,000 → pendiente con GERENTE; aprobar → status APPROVED y notificación al solicitante; $60,000 → pendiente con OWNER.
  - Dependencies: T35.

### Checkpoint J (after T32–T36)
- [ ] `pnpm run build` limpio
- [ ] Caja chica opera con evidencia, saldo y reposición
- [ ] Gasto pasa por el aprobador correcto según monto
- [ ] Notificaciones de aprobación funcionan por WhatsApp + in-app

---

- [ ] **T37** Flujo de efectivo consolidado. *Files: `lib/services/cash-flow-service.ts` (new), `app/api/finance/cash-flow/route.ts` (new), `app/dashboard/finance/cash-flow/page.tsx` (new), `components/finance/cash-flow-calendar.tsx` (new). Size M.*
  - Acceptance: `getCashFlowProjection(companyId, days=30)` agrega: entradas proyectadas (promedio de ventas diarias de `daily_sales_cuts`), salidas: facturas por pagar con vencimiento (`invoices` no pagadas), gastos aprobados pendientes de pago (`operating_expenses`), nómina estimada de la quincena (`labor-calculator`). Vista calendario semanal con saldo proyectado acumulado y alerta de concentración de vencimientos (≥3 pagos grandes el mismo día, como el mockup de la Sección 19). Cache 5 min.
  - Verify: build limpio; con datos sembrados, proyección a 30 días cuadra entradas − salidas = saldo; concentración de vencimientos genera la alerta visual.
  - Dependencies: T28, T35.

- [ ] **T38** P&L estimado por sucursal + widget en dashboard ejecutivo. *Files: `lib/services/pnl-service.ts` (new), `app/api/finance/pnl/route.ts` (new), `components/finance/pnl-branch-table.tsx` (new), `app/dashboard/executive/page.tsx` (integrar widget). Size M.*
  - Acceptance: `getPnLByBranch(companyId, period)` = venta − costo alimentos (teórico) − costo laboral − gastos operativos, por sucursal, sin IVA. Tabla como el mockup (Venta, Alim%, Labor%, Gastos, Util. Est.) con semáforos. Siempre muestra **cobertura de datos** ("18/30 días de ventas, 4/6 categorías de gasto") — nunca un número sin contexto. Integrado en el dashboard ejecutivo existente junto a los KPIs operativos.
  - Verify: build limpio; P&L de sucursal con datos completos cuadra manualmente; sucursal sin ventas muestra "sin datos" en vez de número falso.
  - Dependencies: T37.

### Checkpoint K (after T37–T38)
- [ ] `pnpm run build` limpio
- [ ] Flujo de efectivo proyectado visible con datos reales
- [ ] P&L por sucursal en dashboard ejecutivo con indicador de cobertura
- [ ] KPIs financieros de la Sección 19 del diseño completos
- [ ] Revisión final con humano; decidir siguiente: M15 (Fiscal) o M17 (Control Interno)
