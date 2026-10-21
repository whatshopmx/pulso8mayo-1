# Cierre del circuito bancario — destino de depósitos, matching de entradas y plataformas

## Contexto (por qué)

El lado pagador ya está cerrado: `company_bank_accounts` (migración 0107) alimenta el
`sourceBankAccountId` de las corridas, el layout imprime `CUENTA_ORIGEN` y
`bank_transactions` (0108) cruza las **salidas** del estado de cuenta contra partidas
`CONFIRMED` (`lib/services/bank-statement-service.ts`).

Lo que queda abierto son cuatro huecos entre el dinero que ENTRA y esa misma cuenta:

| Hueco | Hoy | Consecuencia |
|---|---|---|
| Depósito de TPV sin destino | `gateway_transactions` vincula a `branchId` pero no sabe **a qué cuenta aterrizó** el neto | El reporte de Clip y el estado de cuenta viven en módulos distintos; nadie puede decir "el depósito del $X del Clip cayó en BBVA ····1234" |
| Entradas sin matching | El matcher de `bank-statement-service.ts` excluye movimientos positivos a propósito (`sql\`${bankTransactions.amountCents} < 0\``); los comentarios lo declaran: "entradas cruzan a mano" | Conciliar depósitos es manual y auditable a medias: la entrada del banco queda `UNMATCHED` para siempre |
| Canales / plataformas | El corte ya tiene `salesChannelEnum` (SALON/DELIVERY/EVENTOS) y `aggregatorSales` JSONB (rappi/uber/didi) (`lib/db/schema.ts:2875-2888`), pero **el dinero de plataformas** solo entra como acquirer `OTHER` del importador genérico | La comisión de Rappi/Uber no puede contrastarse contra el payout que llegó al banco |
| Cuentas sin propósito | `company_bank_accounts` no distingue cuenta de **dispersión** de cuenta de **recepción** — el catálogo es plano y ningún selector puede preseleccionar la correcta | El grupo que paga desde una cuenta y recibe en otra no tiene forma de declararlo: cada corrida y cada import agarran la última por fecha, con error de dedo de por medio |
| Saldo por cuenta | `cash_flow_assumptions.openingBalanceCents` es "caja y bancos" por **sucursal**, no por cuenta; no hay libro mayor ni saldo computado | El saldo real de la cuenta operativa solo lo sabe el banco, no el sistema |

Principios que heredan estos cambios (mismo libro que 0107/0108):

- **Montos en centavos enteros, siempre firmados.** Entrada = positivo, salida = negativo.
- **La sugerencia nunca es confirmación** (regla 4 de `bank-statement-service.ts`).
- **Últimos 4 dígitos es todo lo que la UI muestra jamás** de las cuentas propias.
- **Multi-tenant:** toda query filtrada por `companyId`; el FK al catálogo de cuentas
  validations con `companyId` en la misma `WHERE` (criterio de `createPaymentRun`).
- **Migraciones sin DROP** — `pnpm db:generate`, nunca `db:push` directo.

## Tasks

### Fase A — Cuentas con propósito y destino del depósito

- [ ] **Task 1.** Propósito de cuenta. Migración `0110_account_purpose.sql`: pgEnum nuevo `account_purpose` (`'DISPERSION' | 'RECEPCION' | 'MIXTO'`) + `ALTER TABLE company_bank_accounts ADD COLUMN purpose account_purpose NOT NULL DEFAULT 'MIXTO'` (backfill implícito: las cuentas viejas quedan `MIXTO`, no pierden ninguna capacidad). Helpers en `company-bank-account-service.ts`: `getDefaultDisbursementAccount(companyId)` → primera activa `DISPERSION`, sino `MIXTO`; `getDefaultDepositAccount(companyId)` → primera activa `RECEPCION`, sino `MIXTO`; ambos devuelven `null` sin catálogo — la UI lo pide, no adivina. Alta/edición en `app/dashboard/finance/settings/bank-accounts` con select de propósito y badge en el listado. El selector del modal de corrida (`create-payment-run-modal.tsx`) preselecciona `getDefaultDisbursementAccount` y el upload de pasarela `getDefaultDepositAccount` — ambos overridables a mano: el default no es una jaula. → *Verify: alta con propósito se lee en el listado; default de corrida acierta con catálogo DISPERSION+RECEPCION separados y con cuenta única MIXTA; catálogo vacío no preselecciona nada.*
- [ ] **Task 2.** Migración `0111_gateway_destination.sql`: `ALTER TABLE gateway_transactions ADD COLUMN destination_bank_account_id uuid REFERENCES company_bank_accounts(id)` (nullable; `null` = "aún no conciliado", no "sin cuenta") + índice `gateway_transactions_destination_idx` en `(company_id, destination_bank_account_id)`. Nada de backfill: los importados viejos no sabían a dónde fueron. → *Verify: `pnpm db:generate` produce migración sin DROP; `tsc --noEmit` limpio; exportar columna en `lib/db/schema.ts` types.*
- [ ] **Task 3.** Capture del destino en importación: `GatewayReportService.importReport` acepta `destinationBankAccountId?: string` → valida (existe, `active`, misma empresa — misma query de `createPaymentRun`) y lo estampa en cada fila insertada. `POST /api/finance/reconciliation/upload` lo recibe del form (`branchId` + `acquirer` + `destinationBankAccountId`), **preseleccionando `getDefaultDepositAccount(companyId)`** (la cuenta de recepción declarada) y recordando en localStorage por sucursal+adquirente como memoria secundaria del override. → *Verify: import válido estampa la cuenta; cuenta dada de baja o de otra empresa rechaza 400; re-import del mismo reporte sigue idempotente (no re-estampa).*
- [ ] **Task 4.** Asignación retroactiva y visualización: `PATCH /api/finance/reconciliation/transactions/[id]` (body: `destinationBankAccountId`, válida contra catálogo activo) para filas ya importadas, con soporte de selección múltiple en el UI. `GET` del listado y summary devuelven `destinationAccountLastFour` (join a `company_bank_accounts`, SOLO last-4 — nunca el número). La página `app/dashboard/finance/terminals` muestra la cuenta destino por fila con badge "Sin destino" cuando es `null` y filtro "sin conciliar". → *Verify: badge "Sin destino" desaparece al asignar; el listado jamás devuelve el número completo (test: respuesta sin propiedades `accountNumber`/`accountNumberEncrypted`).*

### Fase B — Matching de entradas (estado de cuenta ↔ depósitos)

- [ ] **Task 5.** Migración `0112_bank_deposit_match.sql`: `ALTER TABLE bank_transactions ADD COLUMN matched_gateway_transaction_id uuid` **sin FK** (mismo criterio que `matched_payment_run_item_id`, que tampoco lo tiene: es referencia lógica entre tipos de match distintos) + índice parcial en `where(matched_gateway_transaction_id is not null)`. Sólo aplica a movimientos positivos. → *Verify: migración sin DROP; `tsc` limpio.*
- [ ] **Task 6.** `suggestDepositMatches` en `bank-statement-service.ts`, espejo de `suggestMatches`: movimientos positivos `UNMATCHED` contra filas `gateway_transactions` de la misma empresa con `destinationBankAccountId` = la cuenta del movimiento, `netAmountCents == tx.amountCents` (exacto, misma política que salidas), ventana de días por `settlementDate` ↔ `valueDate` (reusar `MATCH_DATE_WINDOW_DAYS` y el patrón `scoreCandidate` como `scoreDepositCandidate`). La fila candidata se excluye si ya está cruzada por otro movimiento. Respuesta incluye acquirer, sucursal y last-4 destino para que el UI diga "Depositó Clip (Suc. Centro) a BBVA ····1234". NOTA de alcance honesto: 1 movimiento bancario ↔ 1 fila gateway en esta fase. El depósito bancario que agrupa varios lotes/días queda `UNMATCHED` con nota — la extensión 1↔N (sumas exactas por grupo `settlementDate`) va al follow-up, no se inventa aquí. → *Verify: tests nuevos en `lib/services/__tests__/bank-statement-service.test.ts`: monto exacto dentro de ventana sugiere; monto distinto no; setlementDate futura fuera de ventana no; fila ya cruzada no reaparece; movimiento negativo nunca produce candidatos de entrada.*
- [ ] **Task 7.** `confirmDepositMatch / ignoreDepositMatch` con el mismo tratamiento atómico que el match de salidas: transacción con bloqueo optimista (`UPDATE ... WHERE match_status = 'UNMATCHED' AND matched_... IS NULL` y re-check de la fila gateway en la misma tx; 0 filas = 409). Lo contrario (des-cruzar) sólo permitido con `matchStatus` volviendo a `UNMATCHED` y dejando el historial del lado bank. → *Verify: doble confirmación simulada da exactamente 1 cruzado y 409 en el segundo; ignore es reversible, confirm no.*
- [ ] **Task 8.** UI: sección "Entradas" en `app/dashboard/finance/bank-reconciliation` — tabla de movimientos positivos con badge de candidato (acquirer + last4 + sucursal), botones Confirmar / Ignorar idénticos a los de salidas, y stats: "depósitos sin cruzar" y "monto cruzado vs gateway". La sugerencia NO se confirma sola nunca. → *Verify: flujo manual completo en dev — importar CSV con depósito, confirmar, verificar en gateway la row cruzada y movimiento MATCHED.*

### Fase C — Plataformas (canal de venta monetario)

- [ ] **Task 9.** `ALTER TYPE terminal_acquirer_enum ADD VALUE 'RAPPI';` + `ALTER TYPE terminal_acquirer_enum ADD VALUE 'UBER_EATS';` + `ADD VALUE 'DIDI'` + `ADD VALUE 'DOORDASH'` (ADD VALUE, uno por statement; en migración `0113_aggregator_acquirers.sql`, NUNCA dentro de un bloque transaccional con otros DDL — limitación de Postgres). El corte de venta ya captura el lado comercial por JSONB (`aggregatorSales`); estas valores cubren el lado del dinero: el payout semanal o quincenal de la plataforma se importa con el MISMO pipeline de `gateway_transactions` (gross = venta cobrada al cliente, fee = comisión de plataforma, net = abono real). El parser genérico (`gateway-report-parser.ts`) gana un mapeo configurado para CSVs de agregadores (columnas: fecha, orden/folio, bruto, comisión, neto) reusando la dedupe `(companyId, acquirer, externalId)`. El upload UI expone los nuevos adquirentes. → *Verify: import de payout de muestra Rappi (CSV sintético) genera filas con fee>0 y externalId folio; re-import no duplica; el corte `aggregatorSales` del negocio NO se toca.*
- [ ] **Task 10.** Reporte de cruce de plataforma (pantalla de la fase B + filtro acquirer): "venta cobrada por la plataforma vs neto aterrizado" — query: SUM(gross), SUM(fee), SUM(net) de `gateway_transactions` por acquirer/período, contra movimientos MATCHED de fase B. % de comisión efectiva por plataforma. → *Verify: levantar dev, importar 2 payouts de la misma plataforma, el cruce cuadra en centavos contra el estado de cuenta cuando la fase B está activa.*

### Fase D — Saldo por cuenta (follow-up, cerrar tras A/B)

- [ ] **Task 11 (diseño pendiente, NO estimar aún).** Saldo computado por cuenta: `bank_transactions` ya tiene todo (monto firmado, cuenta, fecha). El bloqueante real es que `cash_flow_assumptions.openingBalanceCents` es por sucursal y el saldo por cuenta necesita su **propio** ancla. Diseño propuesto: columna `openingBalanceCents + asOfDate` en `company_bank_accounts` capturada a hand, saldos derivados = apertura + SUM(movimientos) desde `asOfDate`. La decisión de qué es "la cuenta oficial del flujo" (qué cuenta alimenta el cash-flow) queda como pregunta de producto. → *Verify: propuesta escrita antes de estimar; sin migración.*

## Orden de ejecución

1 → 2 → 3 → 4 (Fase A, secuencial) — 2, 3 y 4 pueden paralelizarse una vez aplicada la 1.
5 → 6 → 7 → 8 (Fase B, secuencial; depende de A para tener la cuenta destino en las filas gateway).
9 → 10 (Fase C; el UI de 10 reusa la de 8). Los valores de enum `ALTER TYPE`.

Fase D bloqueada hasta que A y B estén en producción — es la única que responde "¿cuánto hay en la cuenta?", también se puede responder "cualquiera puede hacerlo hoy con el CSV del banco".

## Done When
- [ ] Cada empresa declaró el propósito de cada cuenta (`DISPERSION` / `RECEPCION` / `MIXTO`) y el sistema preselecciona por propósito en corridas, import de pasarela y matching — siempre con override a mano.
- [ ] El reporte de pasarela declara, por fila, a qué cuenta activa de la empresa aterrizó su neto (o "sin destino" ser visible, no oculto).
- [ ] Los movimientos positivos del estado de cuenta tienen sugerencia de match contra depósitos de pasarela, confirmación atómica y reversión visible — mismo protocolo que salidas.
- [ ] Rappi/Uber Eats/DiDi/DoorDash son adquirentes de primera clase: import de payout con comisión segregada y dedupe, y cruce neto vs banco por plataforma.
- [ ] Cero números de cuenta completos en cualquier respuesta HTTP; sólo last-4.
- [ ] Suite de `bank-statement-service` cubre entradas con las mismas garantías que salidas; `pnpm run build` y tests verdes.
