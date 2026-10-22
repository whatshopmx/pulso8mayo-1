# TODO: Cierre del circuito bancario

Spec: `plans/2026-cierre-circuito-bancario.md` · Plan detallado: `tasks/plan.md`
Reglas transversales: centavos firmados · sugerencia nunca es confirmación ·
sólo last-4 en HTTP · multi-tenant por `companyId` · migraciones sin DROP (`pnpm db:generate`, nunca `db:push`).

## Phase 1: Foundation (Fase A — propósito y destino)

- [x] **Task 1 (M)** — Propósito de cuenta ✱secuencial primero — commits 14b44d9, 2f16e17, 0cc50da
  - [x] Migración `0110_account_purpose.sql`: enum `account_purpose` (`DISPERSION`/`RECEPCION`/`MIXTO`) + columna `purpose NOT NULL DEFAULT 'MIXTO'` (aplicada; sin DROP)
  - [x] `getDefaultDisbursementAccount` / `getDefaultDepositAccount` + `setCompanyBankAccountPurpose` en `company-bank-account-service.ts` (`null` si el catálogo no clasifica)
  - [x] Select de propósito (alta, PUT inline) + badge en `app/dashboard/finance/settings/bank-accounts`
  - [x] Preselección overridable en `create-payment-run-modal.tsx` (dispersión); la de upload de pasarela llega con Task 3 (captura del destino) para no tocar el form dos veces
  - **Verify:** ✅ tsc/lint limpios, suite unitaria verde (1 fallo preexistente en seed-safety, ajen aeste cambio); verify manual de UI pendiente en dev

- [x] **Task 2 (S)** — Migración `0111_gateway_destination.sql` — aplicada, sin DROP
  - [ ] `destination_bank_account_id uuid REFERENCES company_bank_accounts(id)` nullable (`null` = aún no conciliado) + índice `(company_id, destination_bank_account_id)`
  - [ ] Columna exportada en `lib/db/schema/finance.ts` types
  - **Verify:** `pnpm db:generate` sin DROP; `tsc --noEmit` limpio

- [x] **Task 3 (M)** — Capture del destino en importación — validación + estampa + preselección de recepción + localStorage
  - [ ] `GatewayReportService.importReport` acepta/valida/estampa `destinationBankAccountId`
  - [ ] Upload API + form con preselección de `getDefaultDepositAccount` y memoria localStorage por sucursal+adquirente
  - **Verify:** import estampa cuenta; cuenta dada de baja/otra empresa → 400; re-import idempotente

- [x] **Task 4 (M)** — Asignación retroactiva y visualización — PATCH [id], badge Sin destino, filtro sin conciliar, multi-select, only last-4
  - [ ] `PATCH /api/finance/reconciliation/transactions/[id]` con selección múltiple en UI
  - [ ] `GET` listado/summary devuelven sólo `destinationAccountLastFour`
  - [ ] Badge "Sin destino" + filtro "sin conciliar" en `app/dashboard/finance/terminals`
  - **Verify:** badge desaparece al asignar; respuesta sin `accountNumber`/`accountNumberEncrypted` (test)

### ✅ Checkpoint Foundation
- [x] Migraciones 0110/0111 aplicadas, sin DROP; lint + `tsc` limpios
- [x] `pnpm run build` verde (Turbopack error 1450 transitorio del OS en 1er intento)
- [x] Tests: gateway-report-service con destino válido/ajeno/estampa+idempotencia; suite completa verde salvo fallo preexistente en seed-safety (ajeno)
- [ ] Verify manual de UI en dev (alta de propósito, preselección en corrida y upload, badge/asignación) — pendiente de sesión con dev server

## Phase 2: Core (Fase B — matching de entradas)

- [x] **Task 5 (S)** — Migración `0112_bank_deposit_match.sql` — aplicada, sin DROP, índice parcial where not null
  - [ ] `matched_gateway_transaction_id uuid` SIN FK (criterio igual a `matched_payment_run_item_id`) + índice parcial `where not null`
  - **Verify:** migración sin DROP; `tsc` limpio

- [x] **Task 6 (M)** — `suggestDepositMatches` + `scoreDepositCandidate` (espejo exacto + ventana + cuenta destino + fila ya cruzada excluida)
  - [ ] Positivos `UNMATCHED` ↔ `gateway_transactions` misma empresa + misma cuenta destino + `netAmountCents` exacto + ventana `MATCH_DATE_WINDOW_DAYS` (`scoreDepositCandidate`)
  - [ ] Fila gateway ya cruzada se excluye; respuesta: acquirer + sucursal + last-4
  - [ ] Alcance 1↔1 declarado; depósito que agrupa lotes queda `UNMATCHED` con nota
  - **Verify:** tests nuevos en `bank-statement-service.test.ts` (5 casos del spec, incl. negativo jamás sugiere entrada)

- [x] **Task 7 (M)** — `confirmDepositMatch` (tx + FOR UPDATE + cerrojo final 0 filas = 409) + `unmatchDepositTransaction`; ignore reusa `ignoreTransaction`
  - [ ] Transacción con bloqueo optimista + re-check de fila gateway; 0 filas = 409
  - [ ] Des-cruzar → `UNMATCHED`; ignore reversible, confirm no
  - **Verify:** doble confirmación simulada = 1 cruzado + 409

- [x] **Task 8 (M)** — UI "Entradas" + badge candidato ('Depositó Clip (Suc. X) a ····1234') + Confirmar/Ignorar/Deshacer + stats
  - [ ] Tabla de positivos + badge candidato + Confirmar/Ignorar iguales a salidas
  - [ ] Stats: "depósitos sin cruzar" y "monto cruzado vs gateway"
  - **Verify:** flujo manual en dev: CSV → confirmar → fila gateway cruzada + movimiento MATCHED

### ✅ Checkpoint Core
- [ ] Suite `bank-statement-service` verde (entradas + salidas)
- [ ] `pnpm run build` verde

## Phase 3: Platforms (Fase C)

- [x] **Task 9 (M)** — Adquirentes de plataforma (0113 aplicada, ADD VALUE por statement fuera de transacción) + parser de payouts + UI
  - [ ] `ALTER TYPE terminal_acquirer_enum ADD VALUE` RAPPI / UBER_EATS / DIDI / DOORDASH — **uno por statement, fuera de transacción con otros DDL**
  - [ ] Parser genérico: mapeo CSV agregador (fecha, orden/folio, bruto, comisión, neto) reusando dedupe `(companyId, acquirer, externalId)`
  - [ ] Upload UI expone nuevos adquirentes; `aggregatorSales` del negocio NO se toca
  - **Verify:** payout Rappi sintético → filas fee>0 + folio; re-import no duplica
  - ⚠️ *Open question: pedir 1 CSV real de cada plataforma antes de implementar el mapping*

- [x] **Task 10 (M)** — Reporte de cruce por plataforma: tab Plataformas en conciliación de pasarelas (+ API platform-report)
  - [ ] SUM(gross)/SUM(fee)/SUM(net) por acquirer/período vs movimientos MATCHED de fase B; % comisión efectiva
  - **Verify:** 2 payouts de la misma plataforma → cruce cuadra en centavos

### ✅ Checkpoint Platforms
- [ ] Import de payouts con dedupe verificado; `aggregatorSales` sin cambios
- [ ] Build + tests verdes

## Phase 4: Saldo por cuenta (Fase D — diseño aprobado: suma de ancladas + fallback)

- [x] **Task D1 (S/M)** — Ancla por cuenta, migración `0114_account_anchor.sql` — aplicada; captura a mano en settings con pareja all-or-nothing y fecha no futura
  - [ ] `opening_balance_cents` (firmada, nullable, SIN default) + `opening_as_of_date` en `company_bank_accounts`
  - [ ] Captura a mano en settings ("Saldo al = $X, fecha"); fecha no futura; pareja all-or-nothing
  - **Verify:** migración sin DROP; ancla sin pareja rechazada; fecha futura 400
- [x] **Task D2 (M)** — `getComputedAccountBalances(companyId)` + `getAccountAnchorStatus` (tests de invariantes)
  - [ ] apertura + SUM(amount_cents) desde `asOfDate`, por cuenta; cuenta sin ancla excluida (no cero inventado)
  - **Verify:** apertura + suma exacta en centavos; cuenta sin ancla no aparece con saldo
- [x] **Task D3 (M)** — Saldo computado en settings + selector de corrida `· disp. $X` en cuentas ancladas
  - **Verify:** saldo del listing cuadra con banco; cuenta sin ancla muestra "sin ancla", nunca $0
- [x] **Task D4 (M/L)** — Conmutación del cash-flow: fuente `ACCOUNTS` con desglose por cuenta (solo last-4) a 100% anclado; fallback al supuesto con aviso "N cuenta(s) sin saldo base"; en proyección por sucursal no aplica
  - **Verify:** grupo anclado cuadra en centavos; con 1 cuenta sin ancla vuelve al fallback y nombra cuál falta

## Done When (del spec) — estado de esta corrida

Seguimiento consolidado: [TRACK-01](todo-consolidado-faltante.md). Las marcas siguientes conservan la evidencia de implementación de la corrida original; la aceptación DB/UI de BAN-01–04 y BAN-05/06 continúa pendiente en ese checklist. No equivalen a despliegue ni a conciliación operativa acreditada.
- [x] Propósito declarado por cuenta + preselección con override a mano (Tasks 1-4)
- [x] Reporte de pasarela declara destino por fila (o "Sin destino" visible, no oculto) — Tasks 2-4
- [x] Entradas con sugerencia, confirmación atómica y reversión — mismo protocolo que salidas (Tasks 5-8)
- [x] Rappi/Uber Eats/DiDi/DoorDash de primera clase con comisión, dedupe y cruce por plataforma (Tasks 9-10)
- [x] Cero números de cuenta completos en HTTP; sólo last-4 (proyección en todos los joins nuevos)
- [x] `pnpm run build` verde; suite unitaria verde (fallo preexistente en seed-safety, ajeno)
- [ ] **Verify manual en dev pendiente:** import CSV con depósito → confirmar → cruce visible en ambos lados; 2 payouts de la misma plataforma → cuadre en centavos (necesita dev server + datos; Task 11 bloqueada igualmente por diseño pendiente)
