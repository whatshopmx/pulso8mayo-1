# Task Breakdown: Finanzas Operativas y Conciliación TPV Pulso

---

## Task 1: Backend unificado de pendientes de Hoy y desacoplamiento temporal

**Description:**
Crear o refactorizar el endpoint centralizador de atención financiera (`/api/finance/attention`) para que agregue excepciones de control interno, gastos pendientes de autorización, arqueos de caja con diferencias y discrepancias de conciliación TPV. Debe resolver el problema de paginación de cortes (calculando discrepancias a nivel SQL o con agregados completos sin truncar a 100 registros) y desacoplar las fechas históricas de consulta del estado de "pendientes abiertos al día de hoy".

**Acceptance criteria:**
- [x] La consulta de arqueos evalúa el total de cortes del período sin limitarse arbitrariamente a la primera página de 100 registros.
- [x] Los gastos devueltos para autorización reflejan todos los pendientes abiertos actualmente (`status = 'PENDING_APPROVAL'`), independientemente del rango de fechas del P&L.
- [x] La respuesta incluye metadatos de estado por cada fuente (`available`, `partial`, `unavailable`), indicando con precisión si alguna falló.

**Verification:**
- [x] Tests pasan: `pnpm test lib/services/__tests__/`
- [x] Build exitoso: `pnpm run build` (tsc --noEmit & test:unit passing)
- [x] Manual check: Probar el endpoint con más de 100 cortes y verificar que reporta el total completo de faltantes/sobrantes.

**Dependencies:** None

**Files likely touched:**
- `app/api/finance/attention/route.ts`
- `components/finance/money-attention-panel.tsx`
- `app/dashboard/finance/page.tsx`
- `lib/services/expense-service.ts`

**Estimated scope:** Medium (3-4 files)

---

## Task 2: Pruebas de integración para cierre seguro de períodos financieros

**Description:**
Verificar y blindar mediante pruebas de integración automáticas el comportamiento transaccional de `closeFinancialPeriod` en `lib/services/financial-period-service.ts`. Asegurar que si la congelación de snapshots de P&L (`freezePnLPeriod`) falla por cualquier motivo, la transacción aborte de inmediato, no marque el período como `CLOSED`, conserve el estado `OPEN` y registre el error de forma trazable e idempotente.

**Acceptance criteria:**
- [x] Existe un test unitario/integración que simula un fallo en `freezePnLPeriod` y confirma que `financial_periods.status` permanece en `OPEN`.
- [x] Reintentar el cierre tras resolver la causa raíz congela los snapshots e idempotentemente sella el período.
- [x] La reapertura de un período requiere permisos explícitos de administrador y deja registro en bitácora con motivo y autor.

**Verification:**
- [x] Tests pasan: `pnpm test -- --grep "closeFinancialPeriod"` (7/7 passed)
- [x] Build exitoso: `pnpm run build` (tsc --noEmit & test:unit 578 passing)

**Dependencies:** Task 1

**Files likely touched:**
- `lib/services/financial-period-service.ts`
- `lib/services/__tests__/financial-period-close.test.ts`
- `app/api/finance/periods/close/route.ts`

**Estimated scope:** Small (2-3 files)

---

## Checkpoint: Contratos y Confianza
- [x] Todas las pruebas de contratos y períodos pasan sin errores.
- [x] La aplicación compila limpiamente con `pnpm run build`.
- [x] La bandeja de pendientes no oculta casos por límites de paginación ni filtros temporales desalineados.

---

## Task 3: Enriquecimiento del expediente HoyCaseDossier con contexto presupuestal

**Description:**
Completar la experiencia de resolución de casos en `components/finance/hoy-case-dossier.tsx` y `FinanceTodayPage`. Para gastos pendientes de autorización, mostrar el impacto sobre el presupuesto de la categoría y sucursal, la contraparte/beneficiario y el enlace a la evidencia/factura XML, permitiendo aprobar o rechazar directamente desde el panel lateral sin abandonar la pantalla.

**Acceptance criteria:**
- [x] Al seleccionar un gasto en la lista de Hoy, el expediente muestra: partida presupuestal consumida vs. disponible, proveedor/contraparte y archivo de comprobante.
- [x] Los botones "Autorizar" y "Rechazar" ejecutan la mutación en `/api/expenses/[id]/approve` con validación de roles de autorización.
- [x] Tras resolver el caso, la lista de Hoy se actualiza optimistamente y pasa el foco al siguiente caso prioritario.

**Verification:**
- [x] Build exitoso: `pnpm run build` (tsc --noEmit & vitest passed)
- [x] Manual check: Abrir un gasto pendiente en `/dashboard/finance`, aprobarlo y confirmar que desaparece de la bandeja y se refleja en el presupuesto.

**Dependencies:** Task 1

**Files likely touched:**
- `components/finance/hoy-case-dossier.tsx`
- `app/dashboard/finance/page.tsx`
- `app/api/expenses/[id]/approve/route.ts`

**Estimated scope:** Medium (3 files)

---

## Task 4: Consolidación de navegación en app-sidebar y enlaces profundos

**Description:**
Asegurar que la navegación principal en `components/app-sidebar.tsx` refleje consistentemente los 6 espacios de trabajo de Finanzas: Hoy (`/dashboard/finance`), Gastos (`/dashboard/finance/expenses`), Pagos (`/dashboard/finance/payables`), Caja y Cobros (`/dashboard/finance/cash-flow`), Resultados (`/dashboard/finance/results`) y Cierre y Control (`/dashboard/finance/control-interno`). Garantizar que cada pendiente en la bandeja Hoy posea un enlace profundo directo que conserve el foco y contexto al regresar.

**Acceptance criteria:**
- [x] La barra lateral agrupa los accesos según la estructura de los 6 espacios sin duplicar secciones operativas confusas.
- [x] Cada tarjeta de pendiente en Hoy incluye un enlace profundo con query param (`?focus=[id]`) que abre directamente el registro en su pantalla correspondiente.
- [x] Al presionar "Volver" desde un registro enfocado, el usuario regresa exactamente a la posición previa en Hoy.

**Verification:**
- [x] Build exitoso: `pnpm run build` (tsc --noEmit & vitest passed)
- [x] Manual check: Navegar por los 6 espacios desde el sidebar y probar los enlaces directos de casos.

**Dependencies:** Task 3

**Files likely touched:**
- `components/app-sidebar.tsx`
- `components/finance/hoy-case-dossier.tsx`
- `app/dashboard/finance/expenses/page.tsx`

**Estimated scope:** Small (2-3 files)

---

## Checkpoint: Experiencia Hoy y Navegación
- [x] Navegación fluida y consistente entre los 6 espacios de Finanzas.
- [x] Resolución de casos de gasto de punta a punta en menos de 2 interacciones.
- [x] Build limpio en TypeScript y Next.js.

---

## Task 5: Cuentas por Pagar: selección de partidas y armado de lotes

**Description:**
Conectar la vista de Cuentas por Pagar (`app/dashboard/finance/payables/page.tsx`) con el flujo de creación de corridas de tesorería (`TreasuryService.createPaymentRun`). Permitir filtrar facturas y gastos autorizados, seleccionar partidas elegibles con cuenta bancaria verificada activa y congelar los datos de la cuenta en la partida de la corrida para blindar el destino del pago.

**Acceptance criteria:**
- [x] Las partidas bloqueadas por falta de cuenta bancaria o verificación muestran claramente el motivo del bloqueo y un acceso directo para resolverlo.
- [x] El usuario puede seleccionar múltiples partidas y hacer clic en "Programar lote de pago".
- [x] La creación del lote congela el número de cuenta/CLABE del proveedor en `payment_run_items.bankAccountId` / `payeeBankAccountId` / `clabeLast4Snapshot` evitando cambios posteriores no autorizados.

**Verification:**
- [x] Tests pasan: `pnpm test:unit lib/services/__tests__/treasury*` (3/3 passed, 17/17 suites passed)
- [x] Build exitoso: `tsc --noEmit` pasado limpiamente (0 errors)
- [x] Manual check: Crear una corrida con partidas seleccionadas y verificar congelamiento transaccional de cuentas bancarias.

**Dependencies:** Task 4

**Files likely touched:**
- `app/dashboard/finance/payables/page.tsx`
- `components/finance/payables-table.tsx`
- `lib/services/treasury-service.ts`
- `app/api/finance/treasury/runs/route.ts`

**Estimated scope:** Medium (4 files)

---

## Task 6: UI de liquidación individual por partida en corridas de tesorería

**Description:**
Implementar en la vista de detalle de corrida (`app/dashboard/finance/treasury/runs/[id]/page.tsx`) la interfaz de confirmación partida por partida utilizando `payment-run-settlement.ts`. Permitir ingresar el folio/referencia de transferencia o marcar la partida como fallida con motivo bancario, actualizando el saldo pendiente sin cerrar arbitrariamente la corrida completa hasta que todas las partidas estén resueltas.

**Acceptance criteria:**
- [x] Cada partida de la corrida muestra su estado individual: `PENDING`, `CONFIRMED` o `FAILED`.
- [x] Acción de confirmación solicita referencia/folio bancario y registra quién y cuándo liquidó la partida.
- [x] Si una partida falla, la factura/gasto origen regresa a estado pendiente de pago (conserva la deuda) y la corrida no se cierra como pagada en su totalidad.

**Verification:**
- [x] Tests pasan: `pnpm test:unit lib/services/__tests__/payment-run-settlement.test.ts` (21/21 passed)
- [x] Build exitoso: `tsc --noEmit` pasado limpiamente
- [x] Manual check: Confirmar 1 partida y rechazar otra; verificar que la corrida refleja estado mixto y la deuda rechazada sigue viva en Cuentas por Pagar.

**Dependencies:** Task 5

**Files likely touched:**
- `app/dashboard/finance/treasury/runs/[id]/page.tsx`
- `components/finance/payment-run-detail.tsx`
- `lib/services/treasury-service.ts`
- `app/api/finance/treasury/runs/[id]/items/[itemId]/settle/route.ts`

**Estimated scope:** Medium (4 files)

---

## Checkpoint: Ciclo de Pagos y Tesorería
- [x] Deuda autorizada fluye hacia lote de pago con cuenta bancaria congelada.
- [x] Partidas se confirman o rechazan individualmente con auditoría estricta.
- [x] Pruebas unitarias de liquidación ejecutándose con éxito.

---

## Task 7: Catálogo de terminales autorizadas (branch_terminals)

**Description:**
Crear el esquema Drizzle `branch_terminals` y su API administrativa para registrar y gestionar el parque de terminales físicas por sucursal (número de serie, alias "Barra 1", proveedor/adquirente [Clip, Mercado Pago, BBVA, Banorte, Santander], número de afiliación y estado activo). Esta tabla es la base fundamental para detectar terminales fantasma y controlar cierres de lote.

**Acceptance criteria:**
- [x] Tabla `branch_terminals` creada en `lib/db/schema/finance.ts` con índices únicos por compañía y número de serie.
- [x] API CRUD en `/api/finance/terminals` con validación Zod y aislamiento por `companyId`/`branchId`.
- [x] Vista de catálogo accesible en Configuración de Finanzas para dar de alta y editar terminales (`app/dashboard/finance/settings/terminals/page.tsx`).

**Verification:**
- [x] Tests pasan: `pnpm test:unit lib/services/__tests__/terminal-service.test.ts` (3/3 passed, 18/18 suites passed)
- [x] Build exitoso: `tsc --noEmit` pasado limpiamente
- [x] Manual check: Registrar terminal con alias y validar rechazo de duplicados de serie por compañía.

**Dependencies:** Task 1

**Files likely touched:**
- `lib/db/schema/finance.ts`
- `app/api/finance/terminals/route.ts`
- `lib/services/terminal-service.ts`
- `app/dashboard/finance/settings/terminals/page.tsx`

**Estimated scope:** Medium (4 files)

---

## Task 8: Registro de cierre de lotes de terminales en turno con foto de voucher

**Description:**
Diseñar el esquema `tpv_shift_batches` y el componente de formulario para el cierre de turno del gerente. Permite registrar por cada terminal física de la sucursal: folio de lote, monto total cobrado en tarjeta, propinas acumuladas y fotografía obligatoria del voucher de cierre de lote físico (almacenada en R2 o fallback local).

**Acceptance criteria:**
- [x] Tabla `tpv_shift_batches` vinculada a `daily_sales_cuts` y `branch_terminals`.
- [x] Componente interactivo en el cierre de turno que despliega las terminales activas de la sucursal y solicita montos y fotografía del voucher.
- [x] Validación de que la suma de lotes físicos ingresados se compare contra `daily_sales_cuts.card_sales` alertando discrepancias inmediatas al gerente.

**Verification:**
- [x] Unit tests pasan: `pnpm test:unit lib/services/__tests__/tpv-batch-service.test.ts` (5/5 passed, 42/42 suites passed)
- [x] Build exitoso: `tsc --noEmit` pasado limpiamente (0 errors)
- [x] Manual check: Completar un corte de turno capturando dos lotes de terminal con imagen adjunta.

**Dependencies:** Task 7

**Files likely touched:**
- `lib/db/schema/finance.ts`
- `app/api/sales/cuts/[id]/batches/route.ts`
- `components/sales/tpv-batch-entry-form.tsx`
- `lib/services/tpv-reconciliation-service.ts`

**Estimated scope:** Medium (4 files)

---

## Task 9: Importador de reportes CSV/Excel de pasarelas (Clip, MP, bancos)

**Description:**
Construir el parser e importador de reportes de pasarelas de pago y adquirentes en `/dashboard/finance/cash-flow/reconciliation`. Adaptar la arquitectura de plantillas existente (`pos_mapping_templates`) para normalizar archivos descargados de portales web (Clip, Mercado Pago, Stripe, portales bancarios BBVA/Banorte), extrayendo por transacción: fecha/hora, número de autorización/tarjeta, monto bruto, comisión retenida, IVA de comisión y abono neto.

**Acceptance criteria:**
- [x] Parser flexible que procesa archivos CSV y Excel (.xlsx) mapeando columnas canónicas según la pasarela seleccionada.
- [x] Detección automática de duplicados por folio de transacción o fecha/hora/monto dentro de la compañía.
- [x] Almacenamiento estructurado de transacciones conciliables vinculadas a la sucursal y período.

**Verification:**
- [x] Tests unitarios: `pnpm test:unit lib/services/__tests__/gateway-parser.test.ts` & `gateway-report-service.test.ts` (9/9 passed, 44/44 suites passed)
- [x] Build exitoso: `tsc --noEmit` pasado limpiamente (0 errors)
- [x] Manual check: Cargar un archivo CSV de prueba de Clip y verificar que extrae correctamente transacciones, comisiones y montos netos.

**Dependencies:** Task 8

**Files likely touched:**
- `lib/services/gateway-report-parser.ts`
- `app/api/finance/reconciliation/upload/route.ts`
- `app/dashboard/finance/cash-flow/reconciliation/page.tsx`
- `lib/services/__tests__/gateway-parser.test.ts`

**Estimated scope:** Medium (4 files)

---

## Task 10: Auditoría de comisiones e integridad en P&L (Línea 214)

**Description:**
Implementar el motor de auditoría matemática de comisiones contractuales vs. retenidas reales y conectar el resultado con `pnl-service.ts` respetando estrictamente la regla de integridad: la venta bruta se mantiene al 100% en ingresos (evitando distorsionar el food cost % y ticket promedio), mientras que la comisión auditada se registra como gasto financiero de venta con etiqueta `MEASURED` (o `ESTIMATED` si proviene de tarifa) segregando el 16% de IVA acreditable.

**Acceptance criteria:**
- [x] El sistema calcula la comisión contractual esperada según tarifas pactadas en `channel_commission_rates` (MDR bps + sobretasas) y la compara contra el monto cobrado por la pasarela, alertando discrepancias por sobrecobro.
- [x] En `pnl-service.ts`, el renglón de comisiones se alimenta de los montos medidos del reporte de pasarela cuando existen, marcándose como `MEASURED`.
- [x] El cálculo del porcentaje de Food Cost y utilidad operativa se realiza sobre la base neta/bruta sin restar previamente comisiones a los ingresos.

**Verification:**
- [x] Tests pasan: `pnpm test:unit lib/services/__tests__/commission-audit.test.ts` (4/4 passed, 45/45 suites passed)
- [x] TypeScript limpio: `tsc --noEmit` pasado limpiamente (0 errors)
- [x] Manual check: Visualización de auditoría de comisiones en `/dashboard/finance/cash-flow/reconciliation` con detección de sobrecobros y segregación de IVA 16%.

**Dependencies:** Task 9

**Files touched:**
- `lib/services/commission-service.ts`
- `app/api/finance/commissions/audit/route.ts`
- `app/dashboard/finance/cash-flow/reconciliation/page.tsx`
- `lib/services/__tests__/commission-audit.test.ts`

**Estimated scope:** Medium (4 files)

---

## Task 11: Motor antifraude operativo (Cancelaciones, Propinas y Terminales Fantasma)

**Description:**
Implementar las reglas de detección de anomalías y prevención de fugas operativas en `lib/services/tpv-fraud-detection-service.ts`. Ejecutar chequeos automáticos al registrar cortes y reportes:
1. Alerta de ticket cancelado en POS con cobro exitoso en terminal (±20 min).
2. Alerta de propina desproporcionada (>20% del consumo o sin comanda) y descuadre voucher vs. POS vs. tronco.
3. Alerta de terminal no autorizada cuando la tarjeta en POS excede la suma de terminales registradas.
Inyectar estas alertas directamente en la bandeja de **Hoy**.

**Acceptance criteria:**
- [ ] Detección automática de coincidencias monto/hora entre tickets cancelados y vouchers de lote.
- [ ] Generación automática de excepciones de severidad `HIGH` en `violation_records` que se reflejan de inmediato en la bandeja Hoy.
- [ ] Alerta de terminal no autorizada levantada si un corte reporta ventas con tarjeta sin respaldo en los lotes de las terminales del catálogo.

**Verification:**
- [ ] Tests unitarios: `pnpm test lib/services/__tests__/tpv-fraud-detection.test.ts`
- [ ] Build exitoso: `pnpm run build`
- [ ] Manual check: Simular ticket cancelado post-cobro y verificar aparición inmediata en la bandeja Hoy con badge "Crítico".

**Dependencies:** Task 10

**Files likely touched:**
- `lib/services/tpv-fraud-detection-service.ts`
- `app/api/finance/attention/route.ts`
- `components/finance/hoy-case-dossier.tsx`
- `lib/services/__tests__/tpv-fraud-detection.test.ts`

**Estimated scope:** Medium (4 files)

---

## Checkpoint: Conciliación TPV y Antifraude Operativo
- [ ] Ciclo completo de conciliación a 3 bandas operable con datos de prueba.
- [ ] Detección de fraude operativo alimentando alertas en Hoy en tiempo real.
- [ ] Integridad de P&L garantizada (comisiones auditadas sin alterar venta bruta ni food cost).

---

## Task 12: Checklist de cierre mensual y expediente en Cierre y Control

**Description:**
Diseñar el checklist interactivo de cierre en `app/dashboard/finance/control-interno/page.tsx`. Presentar al administrador la verificación de los pilares del mes antes de permitir el cierre definitivo: todos los cortes de venta capturados, todos los lotes de terminales conciliados con voucher, sin discrepancias abiertas de tarjeta ni gastos sin autorizar, y cálculo de P&L consistente. Al completar el checklist, invoca `closeFinancialPeriod` con confirmación explícita y generación del expediente de cierre.

**Acceptance criteria:**
- [ ] El checklist bloquea el botón de cierre si existen discrepancias financieras críticas sin justificar o lotes TPV sin voucher.
- [ ] Al ejecutar el cierre, se valida el snapshot de P&L de todas las sucursales con atomicidad garantizada.
- [ ] Vista histórica de períodos cerrados con opción de descarga de expediente completo y auditoría de reaperturas.

**Verification:**
- [ ] Build exitoso: `pnpm run build`
- [ ] Manual check: Navegar a Cierre y Control, completar el checklist y ejecutar el cierre de un período de prueba.

**Dependencies:** Task 2, Task 11

**Files likely touched:**
- `app/dashboard/finance/control-interno/page.tsx`
- `components/finance/monthly-period-close-dialog.tsx`
- `lib/services/financial-period-service.ts`

**Estimated scope:** Medium (3 files)

---

## Checkpoint Final: Sistema de Finanzas Operativas Completo
- [ ] Todos los 12 tasks completados con criterios de aceptación cumplidos.
- [ ] Suite completa de pruebas pasa: `pnpm test`.
- [ ] Compilación de producción limpia: `pnpm run build`.
- [ ] Revisión final y validación de flujos con el usuario.
