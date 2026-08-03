# Fases 11-14: Tenant Config + M15 Fiscal + M17 Control Interno + Packaging — Task List

Source plan: `tasks/plan-fiscal-control-interno.md`. Continúa la numeración unificada de `tasks/plan-grupo-restaurantero-unificado.md` (última tarea: T40). **Este tracker usa directamente la numeración unificada T41-T58** (sin renumeración intermedia). Baseline: gap analysis 2026-08-04 de `docs/pulso-diseno-grupo-restaurantero.md` v2.

Convenciones del repo que aplican a todas las tareas:
- Dinero en centavos (integer). Todo scoping por `companyId`/`branchId` + `requireTenant()`.
- Nuevas tablas en el monolito `lib/db/schema.ts` (drizzle.config apunta solo ahí — AD-15).
- Migraciones con `pnpm db:generate` (nunca `db:push` sin verificar `.env`).
- Crons en Inngest, registrados en `lib/inngest/functions/index.ts`.
- Verificación base de cada tarea: `pnpm run build` limpio.

Open questions (ver plan; resolver antes de las tareas indicadas):
- Q6/Q7: modelo de cuenta y timbres FiscalAPI → antes de T47.
- Q8: credenciales de descarga masiva (¿FIEL?) → spike dentro de T48.
- Q9: catálogo de cuentas seed estándar → T52.
- Q10: pólizas con IVA desglosado → T53.
- Q11: chef edita + aprueba (MVP) → T58.

---

## Fase 11 — Dimensiones de Configuración del Tenant (§2 del diseño)

- [ ] **T41** Schema `tenant_operating_config` + migración. *Files: `lib/db/schema.ts`, `drizzle/` (migración). Size M.*
  - Acceptance: tabla con una fila por company (`companyId` unique FK). Las 7 dimensiones como enums/text: `purchasingStructure` (CENTRALIZADA|POR_SUCURSAL|HIBRIDO), `foodProduction` (IN_SITU|COCINA_CENTRAL|MIXTO), `treasuryModel` (CUENTA_UNICA|CUENTA_POR_SUCURSAL|MIXTO), `supplierPayment` (CENTRALIZADO|POR_SUCURSAL|HIBRIDO), `managerAutonomy` (ALTA|MEDIA|BAJA), `payrollDispersion` (CONSOLIDADA|POR_RAZON_SOCIAL|MIXTO), `tenantType` (GRUPO_PROPIO|MIXTO_FRANQUICIAS). Umbrales: `managerAuthLimitCents`, `doubleApprovalThresholdCents`, `pettyCashLimitCents` (nullable = sin tope). Defaults sensatos tipo Caso A (centralizado, autonomía MEDIA). Al crearse una company, su config se crea con defaults (hook en `company-service` o lazy-get).
  - Verify: `pnpm db:generate` produce migración aditiva sin drops; `pnpm run build` limpio.
  - Dependencies: None.

- [ ] **T42** API + UI del modelo operativo. *Files: `app/api/tenant/operating-config/route.ts` (GET/PUT), `app/dashboard/settings/operating-model/page.tsx` (new), `components/settings/operating-model-form.tsx` (new). Size M.*
  - Acceptance: form con las 7 dimensiones (selects con descripción de cada opción) + umbrales en pesos (se persisten en centavos). Panel lateral "Cómo se comporta tu sistema" que renderiza en lenguaje natural las consecuencias de la config actual (ej. "Las OC las genera oficina central; los gerentes solo reciben mercancía" — derivado de reglas estáticas por dimensión, estilo Caso A/Caso B del diseño §2). Solo OWNER/ADMIN/SUPER_ADMIN puede editar. Entrada en settings del sidebar.
  - Verify: build limpio; cambiar autonomía a BAJA → el panel refleja el cambio; PUT persiste y GET lo devuelve.
  - Dependencies: T41.

- [ ] **T43** Helper `getTenantOperatingConfig()` + primer consumo real. *Files: `lib/services/tenant-config-service.ts` (new), `lib/services/purchase-order-service.ts` (integración), `lib/services/cross-branch-service.ts` (filtro franquicias). Size M.*
  - Acceptance: helper con cache 5 min (`unstable_cache`, patrón de cross-branch-service) que devuelve la config o defaults. **Consumo 1:** si `managerAutonomy = BAJA`, toda OC creada por GERENTE queda en status de aprobación pendiente por ADMIN/OWNER aunque esté bajo monto (enforcement en purchase-order-service; MEDIA/ALTA no cambian el comportamiento actual). **Consumo 2:** si `tenantType = MIXTO_FRANQUICIAS`, `cross-branch-service` excluye sucursales marcadas como franquicia de la consolidación del grupo (flag `branches.isFranchise` — agregar columna en esta tarea si no existe). Comentario en código señalando los hooks para M16/M17 (autorización de gastos, segregación).
  - Verify: build limpio; con autonomía BAJA, OC de gerente no pasa a aprobada sin ADMIN; script tsx de humo confirma defaults cuando no hay fila de config.
  - Dependencies: T41.

### Checkpoint L (after T41–T43)
- [ ] `pnpm run build` limpio
- [ ] El modelo operativo se edita en admin y persiste
- [ ] Cambiar autonomía del gerente cambia el flujo de aprobación de OC sin tocar código

---

## Fase 12 — M15: Fiscal y Facturación (FiscalAPI)

- [ ] **T44** Spike + cliente FiscalAPI. *Files: `lib/fiscal/fiscalapi-client.ts` (new), `.env.example` (nuevas vars), `docs/fiscal-setup.md` (new, corto). Size S.*
  - Acceptance: crear cuenta de pruebas en fiscalapi.com (test env), obtener `FISCALAPI_API_KEY` + `FISCALAPI_TENANT`. Cliente wrapper fetch con: base URL por ambiente (`FISCALAPI_ENV=test|prod`), auth headers (apiKey/tenantKey), manejo de errores tipado, y métodos stub: `getCatalog`, `queryCfdiStatus`, `stampPayrollCfdi`, `createDownloadRequest`, `getDownloadStatus`, `checkSupplierSatStatus`. **Timebox 2h.** Documentar en `docs/fiscal-setup.md`: endpoints usados, qué credenciales fiscales se necesitan del cliente (CSD vs FIEL — responde Q8), modelo de timbres/precios (insumo para Q6/Q7).
  - Verify: script `scripts/fiscal-spike.ts` corre: consulta un catálogo SAT, consulta estatus de un UUID de prueba, y loguea respuesta. Build limpio.
  - Dependencies: None.

- [ ] **T45** Schema fiscal + migración. *Files: `lib/db/schema.ts`, `drizzle/` (migración). Size M.*
  - Acceptance: `fiscal_issuers(id, companyId, branchId nullable, rfc, nombre, regimenFiscal, fiscalapiPersonId, csdUploadedAt, active, createdAt)` — unique `(companyId, rfc)`. `cfdi_emitted(id, companyId, branchId nullable, issuerId→fiscal_issuers, tipo (NOMINA|PAGO|INGRESO|EGRESO), uuid unique, receptorRfc, receptorNombre, totalCents, xmlUrl, pdfUrl, status (STAMPED|CANCELLED|ERROR), relatedEntityType (PAYROLL_PERIOD|PAYMENT|…), relatedEntityId, stampedAt, createdAt)`. Índices por `(companyId, tipo, stampedAt)`.
  - Verify: `pnpm db:generate` sin drops; build limpio.
  - Dependencies: None (paralelizable con T44; ambos alimentan T46/T47).

- [ ] **T46** Alta de emisores y carga de CSD. *Files: `app/api/fiscal/issuers/route.ts` + `[id]/route.ts` (new), `app/api/fiscal/issuers/[id]/certificate/route.ts` (new), `app/dashboard/compliance/sat/issuers/page.tsx` (new), `components/fiscal/issuer-form.tsx` (new). Size M.*
  - Acceptance: CRUD de razones sociales del grupo (RFC, nombre, régimen fiscal, sucursal opcional). Al crear, se registra la persona/issuer en FiscalAPI y se guarda `fiscalapiPersonId`. Upload de CSD (.cer + .key + password) → sube a FiscalAPI (tax-files), marca `csdUploadedAt`; el password nunca se persiste. Vinculación sucursal↔issuer (para `payrollDispersion = POR_RAZON_SOCIAL`). UI dentro de la sección SAT existente (`app/dashboard/compliance/sat/`).
  - Verify: build limpio; en test env: crear issuer con RFC de prueba + subir CSD de prueba de FiscalAPI → `fiscalapiPersonId` y `csdUploadedAt` poblados.
  - Dependencies: T44, T45.

- [ ] **T47** CFDI de nómina timbrado. *Files: `lib/fiscal/payroll-stamping-service.ts` (new), `app/api/fiscal/payroll-stamping/route.ts` (new), `app/dashboard/compliance/payroll/page.tsx` (extender: botón + listado), `components/fiscal/payroll-stamp-status.tsx` (new). Size L.*
  - Acceptance: **(a) Reporte de completitud previo:** lista empleados del período con datos fiscales faltantes para el complemento de nómina (RFC, CURP, NSS, CP fiscal del empleado, régimen; verificar cobertura en `employee_profiles` y agregar columnas `fiscalPostalCode`, `satRegimen` si faltan — migración pequeña incluida). **(b)** `stampPayrollPeriod(companyId, period, issuerId)`: usa `calculatePayrollData` existente, construye un CFDI de nómina por empleado vía complemento nómina de FiscalAPI, persiste en `cfdi_emitted` con XML/PDF a R2 (AD-16), idempotente (no re-timbrar empleado ya STAMPED en el período; reintento solo de ERROR). **(c)** UI: botón "Timbrar nómina del período" en compliance/payroll, progreso (X/Y timbrados), listado con descarga XML/PDF y estatus por empleado. **(d)** Respeta `payrollDispersion`: CONSOLIDADA → un issuer; POR_RAZON_SOCIAL → agrupa empleados por el issuer de su sucursal.
  - Verify: build limpio; en test env con datos demo: timbrar quincena → recibos STAMPED con XML/PDF descargables; correr dos veces → no duplica; empleado sin CURP aparece en reporte de completitud y no bloquea a los demás.
  - Dependencies: T44, T45. Resolver Q6/Q7 antes de empezar.

### Checkpoint M (after T44–T47)
- [ ] `pnpm run build` limpio
- [ ] Nómina timbrada end-to-end en sandbox FiscalAPI
- [ ] XML/PDF descargables por empleado; idempotencia verificada
- [ ] Revisión con humano: costos de timbres (Q6/Q7) antes de producción

---

- [ ] **T48** Descarga masiva SAT → conciliación 3 vías. *Files: `lib/fiscal/sat-download-service.ts` (new), `app/api/fiscal/sat-download/route.ts` (new), `lib/inngest/functions/cron-sat-download.ts` (new), `lib/services/notification-dispatcher.ts` (evento `INVOICE_UNMATCHED`). Size L.*
  - Acceptance: **(a) Spike 1h dentro de la tarea:** documentar qué credenciales exige FiscalAPI para descarga masiva (resuelve Q8); si requiere FIEL, el flujo de captura se documenta y el fallback (upload manual XML existente) queda como camino oficial hasta tenerla. **(b)** `requestDownload(issuerId, dateRange, tipo=RECIBIDOS)`: crea solicitud en FiscalAPI, guarda tracking; polling de estatus vía cron hasta COMPLETADA. **(c)** Al completar: parsear metadata/CFDI recibidos → upsert en `invoices` (dedupe por `uuid` unique) y disparar el three-way match existente (`invoice-matching-service`) cuando haya OC+recepción candidata por proveedor/monto/fecha. **(d)** Factura sin match tras 48h → notificación `INVOICE_UNMATCHED` a ADMIN/GERENTE (WhatsApp + in-app). **(e)** Cron semanal automático por issuer activo + botón manual "Descargar ahora".
  - Verify: build limpio; en test env: solicitud de descarga completa el ciclo (o fallback documentado); factura sembrada que coincide con OC+recepción → `matchStatus` actualizado; una huérfana → alerta a las 48h (simular en Inngest dev).
  - Dependencies: T44, T45, T46.

- [ ] **T49** Validación SAT de proveedores. *Files: `lib/fiscal/supplier-sat-service.ts` (new), `app/api/suppliers` (hook al crear), `lib/inngest/functions/cron-supplier-sat-recheck.ts` (new), `lib/services/notification-dispatcher.ts` (evento `SUPPLIER_SAT_RISK`), `app/dashboard/inventory/suppliers/page.tsx` (badge). Size M.*
  - Acceptance: al crear proveedor con `taxId` (RFC): consulta estatus/listas negras (EFOS/EDOS) vía FiscalAPI → persiste `suppliers.satStatus` (OK|NOT_FOUND|BLACKLISTED|ERROR) + `satCheckedAt` (agregar columnas en esta tarea). Proveedor en lista negra → badge rojo en UI + notificación `SUPPLIER_SAT_RISK` a OWNER/ADMIN. Cron mensual re-chequea proveedores activos; cambio de estatus → notificación.
  - Verify: build limpio; proveedor con RFC de prueba en lista negra (datos de prueba FiscalAPI) → badge + notificación; RFC inválido → NOT_FOUND sin romper el alta.
  - Dependencies: T44, T45.

- [ ] **T50** Complemento de pago CFDI. *Files: `lib/fiscal/payment-complement-service.ts` (new), `app/api/fiscal/payment-complement/route.ts` (new), `lib/services/expense-service.ts` o `app/api/finance/payments/route.ts` (hook — según estado de M16). Size M.*
  - Acceptance: al ejecutarse un pago a proveedor contra factura conciliada (M16 `operating_expenses`/`paidAt` si existe; si M16 no está listo, endpoint manual mínimo `POST /api/finance/payments` que registra pago de una `invoice`): genera CFDI tipo Pago con complemento vía FiscalAPI, persiste en `cfdi_emitted` con `relatedEntityType=PAYMENT`, liga XML/PDF. Listado de complementos generados con estatus.
  - Verify: build limpio; en test env: registrar pago de factura STAMPED → complemento timbrado y visible; doble ejecución no duplica.
  - Dependencies: T44, T45, T46. **Dependencia cross-plan:** M16 (T34-T40) o stub manual (ver riesgos del plan).

- [ ] **T51** UI fiscal consolidada. *Files: `app/dashboard/fiscal/page.tsx` (new), `components/fiscal/cfdi-emitted-list.tsx`, `components/fiscal/received-match-status.tsx`, `app/api/fiscal/dashboard/route.ts` (new). Size M.*
  - Acceptance: página `/dashboard/fiscal` con 3 secciones: **Emitidos** (nómina + pagos: filtro por tipo/período/issuer, descarga XML/PDF), **Recibidos** (facturas del SAT: matchStatus, discrepancias precio/cantidad, antigüedad sin conciliar), **Resumen** (cards: timbrados del mes, pendientes de conciliar, proveedores con riesgo SAT). Entrada "Fiscal" en sidebar (sección Finanzas si ya existe por M13/M16; si no, bajo Compliance).
  - Verify: build limpio; con datos sembrados de T47-T50, las 3 secciones renderizan con totales correctos.
  - Dependencies: T47, T48, T49, T50.

### Checkpoint N (after T48–T51)
- [ ] `pnpm run build` limpio
- [ ] Facturas recibidas se concilian automáticamente (o alertan a las 48h)
- [ ] Complemento de pago timbrado al pagar
- [ ] Vista fiscal única con emitidos/recibidos/resumen

---

## Fase 13 — M17: Contabilidad y Control Interno

- [ ] **T52** Schema M17 + catálogo de cuentas. *Files: `lib/db/schema.ts`, `drizzle/` (migración), `lib/db/seeds/chart-of-accounts.ts` (new). Size M.*
  - Acceptance: `chart_of_accounts(id, companyId, code, name, type (ACTIVO|PASIVO|CAPITAL|INGRESO|EGRESO), active)` — unique `(companyId, code)`; seed de ~25 cuentas estándar restauranteras (Caja, Bancos, Inventario, IVA acreditable, IVA trasladado, Proveedores, Sueldos por pagar, IMSS por pagar, Ventas, Costo de ventas, Nómina, Renta, Servicios, etc.). `journal_entries(id, companyId, branchId nullable, entryDate, description, sourceType (INVOICE_MATCHED|PAYMENT_EXECUTED|PAYROLL_STAMPED|SALES_CUT|EXPENSE_APPROVED), sourceId, status (DRAFT|POSTED|VOID), createdBy, createdAt)` — **unique `(sourceType, sourceId)`** (idempotencia AD-12). `journal_entry_lines(id, entryId→journal_entries cascade, accountId→chart_of_accounts, debitCents, creditCents, memo)`. `internal_control_exceptions(id, companyId, branchId nullable, type, severity, entityType, entityId, description, status (OPEN|RESOLVED|DISMISSED), detectedAt, resolvedBy, resolvedAt, resolutionNotes)`. `segregation_rules(id, companyId, action (PO_CREATE_RECEIVE|PO_CREATE_APPROVE|EXPENSE_APPROVE_EXECUTE), mode (STRICT|DOUBLE_APPROVAL|LOG_ONLY), active)`.
  - Verify: `pnpm db:generate` sin drops; seed corre idempotente; build limpio.
  - Dependencies: None (paralelizable con Fase 12).

- [ ] **T53** Motor de pólizas. *Files: `lib/services/journal-service.ts` (new), `app/api/finance/journal/route.ts` (GET list / POST regenerate). Size M.*
  - Acceptance: `generateForEvent(sourceType, sourceId)` con plantillas de asiento por evento (Q10: con IVA desglosado): **compra conciliada** → cargo Inventario + IVA acreditable, abono Proveedores; **pago ejecutado** → cargo Proveedores, abono Bancos; **nómina timbrada** → cargo Nómina, abono Bancos + IMSS por pagar (proporción configurable); **venta del día** → cargo Caja/Bancos, abono Ventas + IVA trasladado. Balance check obligatorio (Σ débitos = Σ créditos) antes de persistir. Idempotente: regenerar = void + recrear. Hooks: se invoca desde T47 (nómina), T50 (pago), T48 (factura conciliada), y queda documentado el hook para M13 sales cuts. Lista de pólizas con filtro por tipo/período/sucursal.
  - Verify: build limpio; script tsx: evento sembrado de cada tipo → póliza balanceada; regenerar → no duplica; póliza descuadrada (forzar bug) → error explícito, nada persiste.
  - Dependencies: T52. Eventos de T47/T48/T50 para pruebas reales.

- [ ] **T54** Export de pólizas. *Files: `lib/services/journal-export-service.ts` (new), `app/api/finance/journal/export/route.ts` (new), `components/finance/journal-export-button.tsx` (new). Size S.*
  - Acceptance: export CSV universal (fecha, póliza, cuenta, nombre cuenta, cargo, abono, concepto, referencia) por rango de fechas/sucursal. Layout CONTPAQi (importación de pólizas) detrás de flag `?format=contpaqi` — validado con contador piloto antes de darse por cerrado (si no hay piloto, queda documentado como no verificado). Link desde la lista de pólizas.
  - Verify: build limpio; export del período con datos sembrados → CSV abre en Excel con columnas correctas y totales cuadrados.
  - Dependencies: T53.

### Checkpoint O (after T52–T54)
- [ ] `pnpm run build` limpio
- [ ] Eventos reales del período → pólizas balanceadas exportables
- [ ] Revisión con humano/contador del formato de export

---

- [ ] **T55** Segregación de funciones / doble autorización. *Files: `lib/services/segregation-service.ts` (new), `app/api/inventory/purchase-orders/route.ts` + `[id]/route.ts` (enforcement), `lib/services/expense-approval-service.ts` (enforcement, si M16 existe; si no, hook documentado). Size M.*
  - Acceptance: `assertNotSelfServing(userId, action, entityId)`: en modo STRICT, quien creó una OC no puede marcarla como recibida ni aprobarla (403 con mensaje claro en español); en modo DOUBLE_APPROVAL, se permite pero exige segundo aprobador distinto antes de surtir efecto; en LOG_ONLY, se permite y se registra excepción tipo `SELF_APPROVAL`. Modo default derivado de `managerAutonomy` (T41): BAJA→STRICT, MEDIA→DOUBLE_APPROVAL, ALTA→LOG_ONLY; overridable por `segregation_rules`. Todo intento bloqueado persiste como excepción (bitácora anti-fraude).
  - Verify: build limpio; gerente intenta recibir su propia OC en STRICT → 403 + excepción OPEN; en DOUBLE_APPROVAL → queda pendiente hasta segundo aprobador.
  - Dependencies: T52, T41 (modo default).

- [ ] **T56** Reporte de excepciones. *Files: `lib/services/exception-detector-service.ts` (new), `lib/inngest/functions/cron-exception-detection.ts` (new), `app/api/finance/exceptions/route.ts` (new), `app/dashboard/finance/exceptions/page.tsx` (new). Size M.*
  - Acceptance: detectors diarios (cron Inngest): **(a)** pago fuera de política (monto sobre el límite de su aprobador según `expense_authorization_rules`/umbrales T41), **(b)** proveedor nuevo sin validación SAT (de T49), **(c)** gasto recurrente que sube >30% por 3 meses en la misma categoría, **(d)** auto-aprobación detectada en LOG_ONLY, **(e)** factura conciliada con discrepancia de precio > tolerancia (reusa flags de `invoices`). Dedupe: no re-crear excepción OPEN idéntica. UI: lista con severidad, estado OPEN/RESOLVED/DISMISSED, acciones de resolver con nota; badge de conteo en sidebar de Finanzas.
  - Verify: build limpio; sembrar condiciones (a)-(e) → cron las detecta sin duplicar; resolver → persiste resolvedBy/At.
  - Dependencies: T52, T49, T55.

### Checkpoint P (after T55–T56)
- [ ] `pnpm run build` limpio
- [ ] Auto-aprobación bloqueada y registrada en bitácora
- [ ] Reporte de excepciones con hallazgos reales y flujo de resolución

---

## Fase 14 — Packaging: Tiers + Chef Corporativo

- [ ] **T57** Tiers Starter/Growth/Scale. *Files: `lib/db/schema.ts` (`companies.planTier`), `lib/tiers.ts` (new), `lib/services/company-service.ts` (default), `components/app-sidebar.tsx` (gating), `lib/api/module-guard.ts` (new), `app/dashboard/settings/subscription/page.tsx` (new). Size M.*
  - Acceptance: `companies.planTier` (STARTER|GROWTH|SCALE, default STARTER) — migración aditiva. `lib/tiers.ts` con `TIER_MODULES` según §16 del diseño: STARTER = workflows, compliance, inventario básico, incidentes, notificaciones, reportes básicos, caja chica, doble autorización; GROWTH = + laboral completo, fiscal nómina, recetas/costeo, ventas POS, chef; SCALE = + equipamiento, compras, conciliación SAT, flujo efectivo, P&L, segregación, pólizas, delivery, benchmarking. `assertModuleEnabled(companyId, module)` para APIs (403 + mensaje de upgrade); sidebar oculta módulos no incluidos. Página de suscripción (solo SUPER_ADMIN/OWNER cambia tier). Aplicar gating a rutas existentes de forma incremental: esta tarea cubre sidebar + guard helper + aplicación a 3 rutas representativas (ventas, fiscal, pólizas); el resto se adopta conforme se toquen.
  - Verify: build limpio; tenant en STARTER: sidebar sin "Fiscal"/"Pólizas" y API responde 403 con mensaje; cambiar a SCALE → todo visible.
  - Dependencies: T41 (no dura; cualquier momento tras ella).

- [ ] **T58** Rol CHEF_CORPORATIVO. *Files: `lib/db/schema/auth.ts` (roleEnum), `lib/permissions.ts`, `app/api/inventory/recipes/[id]/route.ts` (aprobación), `lib/db/schema.ts` (`recipes.status/approvedBy/approvedAt`), `app/dashboard/quality/page.tsx` (new), `components/quality/quality-sampling-review.tsx` (new). Size M.*
  - Acceptance: enum `CHEF_CORPORATIVO` (migración `ALTER TYPE … ADD VALUE`, verificar sin drops). Jerarquía 70 (entre SUPERVISOR 50 y GERENTE 80). Permisos: branches read, workflows read, inventory read+update (recetas), reports read. **Aprobación de recetas:** `recipes.status` (DRAFT|ACTIVE) + `approvedBy/approvedAt`; solo CHEF/ADMIN/OWNER puede activar; receta DRAFT no aparece en producción/costeo de sucursal (filtro en recipe-service). **Dashboard de calidad:** `/dashboard/quality` con muestreos del template `muestreo-calidad-v1` de TODAS las sucursales (reusa queries de workflow history), fotos de evidencia, y sucursales con desviaciones marcadas. Asignable desde gestión de usuarios.
  - Verify: build limpio; migración enum aplica sin drops; usuario chef activa una receta DRAFT → aparece en sucursales; GERENTE no puede activar (403).
  - Dependencies: T41 (cualquier momento tras ella).

### Checkpoint Q (after T57–T58)
- [ ] `pnpm run build` limpio
- [ ] Tier STARTER sin módulos SCALE en UI y API
- [ ] Chef aprueba recetas y revisa muestreo cross-sucursal
- [ ] Revisión final con humano; decidir siguiente plan: apertura de sucursal/Digital Twin, adopción §10, offline §9, M14
