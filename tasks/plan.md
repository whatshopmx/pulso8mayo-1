# Implementation Plan: Cierre del circuito bancario — destino de depósitos, matching de entradas y plataformas

**Fuente (spec):** `plans/2026-cierre-circuito-bancario.md`
**Estado del círculo:** el lado pagador (cuentas 0107 + matching de salidas 0108) ya vive
en producción; este plan cierra el lado receptor: a dónde aterrizan los depósitos,
el matching de las **entradas** del estado de cuenta, y las plataformas
(Rappi/Uber Eats/DiDi/DoorDash) como adquirentes de primera clase.

## Overview

Cuatro fases que convierten el catálogo plano de cuentas en un catálogo con
**propósito** (dispersión / recepción / mixto), estampan el **destino** de cada
depósito de pasarela, dan a los movimientos **positivos** del estado de cuenta el
mismo protocolo de matching que ya tienen los negativos, y dejan importar
**payouts de plataformas** con su comisión segregada y cruce contra el banco.
Fase D (saldo por cuenta por ancla propia) queda bloqueada como follow-up de diseño.

## Architecture Decisions

- **Montos en centavos enteros, siempre firmados** (entrada = positivo, salida = negativo). Idéntico a 0107/0108.
- **La sugerencia nunca es confirmación** — regla 4 de `bank-statement-service.ts`; el matching de entradas hereda el mismo protocolo atómico (bloqueo optimista + re-check en la misma transacción, 409 en carrera).
- **Últimos 4 dígitos o nada** — ninguna respuesta HTTP transporta número de cuenta completo; join a `company_bank_accounts` sólo expone `accountLastFour`.
- **Multi-tenant estricto** — toda query por `companyId`; la validación de FK al catálogo lleva `companyId` en el mismo `WHERE` (criterio de `createPaymentRun`).
- **Migraciones sin DROP, `pnpm db:generate`** — nunca `db:push` directo. `ALTER TYPE ... ADD VALUE` fuera de bloque transaccional con otros DDL (limitación de Postgres), un `ADD VALUE` por statement.
- **`matched_gateway_transaction_id` sin FK** — referencia lógica, mismo criterio que el ya existente `matched_payment_run_item_id` (cruza tipos de match distintos).
- **Default ≠ jaula** — los preselection por propósito (`DISPERSION`/`RECEPCION`) siempre overridables a mano; catálogo sin clasificar no preselecciona nada.
- **1↔1 honesto en fase B** — el depósito bancario que agrupa varios lotes queda `UNMATCHED` con nota; la extensión 1↔N es follow-up, no se inventa aquí.

## Task List

### Phase 1: Foundation — propósito de cuenta y destino del depósito (Fase A)

- [ ] **Task 1 (M).** Propósito de cuenta. Migración `0110_account_purpose.sql`:
      pgEnum `account_purpose` (`'DISPERSION' | 'RECEPCION' | 'MIXTO'`) +
      `ALTER TABLE company_bank_accounts ADD COLUMN purpose ... NOT NULL DEFAULT 'MIXTO'`
      (backfill implícito: cuentas viejas = `MIXTO`, no pierden capacidad).
      Helpers en `company-bank-account-service.ts`:
      `getDefaultDisbursementAccount(companyId)` (primera activa `DISPERSION`, sino `MIXTO`) y
      `getDefaultDepositAccount(companyId)` (primera activa `RECEPCION`, sino `MIXTO`); ambos
      devuelven `null` con catálogo vacío. Alta/edición con select de propósito + badge en
      listing. Preselección en `create-payment-run-modal.tsx` (dispersión) y en el upload de
      pasarela (recepción), ambos overridables.

      **Files:** `lib/db/schema.ts` (+`finance.ts`), `lib/services/company-bank-account-service.ts`,
      `app/dashboard/finance/settings/bank-accounts/page.tsx`,
      `components/finance/create-payment-run-modal.tsx`.

- [ ] **Task 2 (S).** Migración `0111_gateway_destination.sql`:
      `ALTER TABLE gateway_transactions ADD COLUMN destination_bank_account_id uuid REFERENCES
      company_bank_accounts(id)` (nullable; `null` = "aún no conciliado", NO "sin cuenta") +
      índice `gateway_transactions_destination_idx (company_id, destination_bank_account_id)`.
      Sin backfill. Export de columna en `lib/db/schema/finance.ts` types.
      → *Verify: `pnpm db:generate` sin DROP; `tsc --noEmit` limpio.*

- [ ] **Task 3 (M).** Captura del destino en importación. `GatewayReportService.importReport`
      acepta `destinationBankAccountId?: string`, valida (existe, `active`, misma empresa con la
      query de `createPaymentRun`) y lo estampa en cada fila. `POST /api/finance/reconciliation/upload`
      lo recibe del form (`branchId` + `acquirer` + `destinationBankAccountId`),
      **preseleccionando `getDefaultDepositAccount(companyId)`** y recordando en localStorage
      por sucursal+adquirente como memoria secundaria del override.
      → *Verify: import válido estampa cuenta; cuenta de baja/otra empresa → 400; re-import idempotente (no re-estampa).*

      **Files:** `lib/services/gateway-report-service.ts`,
      `app/api/finance/reconciliation/upload/route.ts`,
      `app/dashboard/finance/terminals/page.tsx` (form).

- [ ] **Task 4 (M).** Asignación retroactiva y visualización.
      `PATCH /api/finance/reconciliation/transactions/[id]` (body: `destinationBankAccountId`,
      valida catálogo activo) para filas importadas, con selección múltiple en UI.
      `GET` listado/summary devuelven `destinationAccountLastFour` SOLO (jamás el número).
      `app/dashboard/finance/terminals` muestra cuenta destino por fila, badge "Sin destino"
      en `null` y filtro "sin conciliar".
      → *Verify: badge desaparece al asignar; respuesta jamás trae `accountNumber`/`accountNumberEncrypted` (test).*

      **Files:** `app/api/finance/reconciliation/transactions/[id]/route.ts` (nuevo),
      `app/api/finance/reconciliation/transactions/route.ts`,
      `lib/services/gateway-report-service.ts`, `app/dashboard/finance/terminals/page.tsx`.

### Checkpoint: Foundation (Fase A)
- [ ] `pnpm db:generate` produce 0110/0111 sin DROP; migración aplicada
- [ ] `tsc --noEmit` y `pnpm run lint` limpios
- [ ] Flujo manual: alta de cuenta con propósito → corrida preselecciona dispersión →
      upload de pasarela preselecciona recepción → asignación retroactiva → badge "Sin destino" desaparece
- [ ] Test de no-fuga: ninguna respuesta con número completo de cuenta

### Phase 2: Core — matching de entradas (Fase B)

- [ ] **Task 5 (S).** Migración `0112_bank_deposit_match.sql`:
      `ALTER TABLE bank_transactions ADD COLUMN matched_gateway_transaction_id uuid` **sin FK**
      (mismo criterio que `matched_payment_run_item_id`) + índice parcial
      `where(matched_gateway_transaction_id is not null)`. Sólo movimientos positivos.
      → *Verify: migración sin DROP; `tsc` limpio.*

- [ ] **Task 6 (M).** `suggestDepositMatches` en `bank-statement-service.ts`, espejo de
      `suggestMatches`: movimentos positivos `UNMATCHED` contra `gateway_transactions` de la
      misma empresa con `destinationBankAccountId` = cuenta del movimiento,
      `netAmountCents == tx.amountCents` (exacto, misma política), ventana de días
      `settlementDate` ↔ `valueDate` (reusar `MATCH_DATE_WINDOW_DAYS`; `scoreDepositCandidate`
      como espejo de `scoreCandidate`). Fila gateway ya cruzada se excluye. Respuesta incluye
      acquirer + sucursal + last-4 destino ("Depositó Clip (Suc. Centro) a BBVA ····1234").
      Alcance honesto: **1↔1**; el depósito que agrupa varios lotes queda `UNMATCHED` con nota;
      1↔N va a follow-up.
      → *Verify: tests en `lib/services/__tests__/bank-statement-service.test.ts` —
      monto exacto en ventana sugiere; monto distinto no; settlementDate fuera de ventana no;
      fila ya cruzada no reaparece; movimiento negativo jamás produce candidatos de entrada.*

      **Files:** `lib/services/bank-statement-service.ts`,
      `lib/services/__tests__/bank-statement-service.test.ts`.

- [ ] **Task 7 (M).** `confirmDepositMatch` / `ignoreDepositMatch` con el tratamiento atómico
      del match de salidas: transacción con bloqueo optimista
      (`UPDATE ... WHERE match_status='UNMATCHED' AND matched_... IS NULL` + re-check de la fila
      gateway en la misma tx; 0 filas = 409). Des-cruzar sólo con `matchStatus` devolviendo a
      `UNMATCHED`; historial del lado bank.
      → *Verify: doble confirmación simulada = 1 cruzado + 409 en el segundo; ignore reversible, confirm no.*

      **Files:** `lib/services/bank-statement-service.ts` (+tests),
      `app/api/finance/bank-reconciliation` routes.

- [ ] **Task 8 (M).** UI "Entradas" en `app/dashboard/finance/bank-reconciliation`: tabla de
      movimientos positivos con badge de candidato (acquirer + last-4 + sucursal), botones
      Confirmar/Ignorar idénticos a salidas, stats "depósitos sin cruzar" y
      "monto cruzado vs gateway". La sugerencia NO se confirma sola nunca.
      → *Verify: flujo manual en dev — CSV con depósito → confirmar → fila gateway cruzada + movimiento MATCHED.*

      **Files:** `app/dashboard/finance/bank-reconciliation/page.tsx` (+components).

### Checkpoint: Core (Fase B)
- [ ] Tests verdes de suite `bank-statement-service` (entradas + salidas)
- [ ] Flujo end-to-end manual: CSV → sugerencia → confirmación atómica → cruce visible en ambos lados
- [ ] `pnpm run build` verde

### Phase 3: Platforms (Fase C)

- [ ] **Task 9 (M).** Adquirentes de plataforma: migración `0113_aggregator_acquirers.sql` con
      `ALTER TYPE terminal_acquirer_enum ADD VALUE 'RAPPI';` / `'UBER_EATS';` / `'DIDI';` /
      `'DOORDASH';` — **un ADD VALUE por statement, NUNCA dentro de un bloque transaccional con
      otros DDL** (limitación de Postgres). El payout semanal/quincenal se importa con el MISMO
      pipeline de `gateway_transactions` (gross = cobro al cliente, fee = comisión de
      plataforma, net = abono real). `gateway-report-parser.ts` gana mapeo configurado para
      CSVs de agregadores (columnas: fecha, orden/folio, bruto, comisión, neto) reusando la
      dedupe `(companyId, acquirer, externalId)`. Upload UI expone nuevos adquirentes.
      → *Verify: payout Rappi sintético → filas con fee>0 y externalId folio; re-import no duplica;
      el corte `aggregatorSales` (JSONB del negocio) NO se toca.*

      **Files:** `lib/db/schema/finance.ts`, `lib/services/gateway-report-parser.ts`,
      `lib/services/gateway-report-service.ts`, upload route + terminals UI.

- [ ] **Task 10 (M).** Reporte de cruce de plataforma (reusa UI de Task 8 + filtro acquirer):
      "venta cobrada por la plataforma vs neto aterrizado" — SUM(gross), SUM(fee), SUM(net) de
      `gateway_transactions` por acquirer/período, contra movimientos MATCHED de fase B;
      % comisión efectiva por plataforma.
      → *Verify: dev con 2 payouts de la misma plataforma → el cruce cuadra en centavos contra el estado de cuenta.*

      **Files:** `lib/services/gateway-report-service.ts`,
      `app/dashboard/finance/terminals/page.tsx` (o componente de reporte).

### Checkpoint: Platforms (Fase C)
- [ ] Import de payouts con dedupe verificado
- [ ] Cruce neto↔banco cuadra en centavos con fase B activa
- [ ] `aggregatorSales` sin cambios; build + tests verdes

### Phase 4: Deferred — saldo por cuenta (Fase D, bloqueada)

- [ ] **Task 11 — NO estimar aún.** Saldo computado por cuenta
      (`openingBalanceCents + asOfDate` en `company_bank_accounts` capturada a mano; saldos
      derivados = apertura + SUM desde `asOfDate`). Bloqueante real:
      `cash_flow_assumptions.openingBalanceCents` es por sucursal y la ancla por cuenta es
      propia. **Pregunta de producto abierta:** ¿qué cuenta alimenta el cash-flow?
      → *Verify: propuesta escrita antes de estimar; sin migración.*

### Checkpoint: Complete
- [ ] Done When (del spec):
  - [ ] Propósito declarado por cuenta y preselección por propósito con override a mano
  - [ ] El reporte de pasarela declara el destino por fila (o "sin destino" visible, no oculto)
  - [ ] Entradas del estado de cuenta con sugerencia, confirmación atómica y reversión — mismo protocolo que salidas
  - [ ] Rappi/Uber Eats/DiDi/DoorDash de primera clase: import con comisión y dedupe, cruce por plataforma
  - [ ] Cero números de cuenta completos en HTTP; sólo last-4
  - [ ] Suite `bank-statement-service` cubre entradas; `pnpm run build` y tests verdes

## Dependency Graph

```
Task 1 (propósito, migración 0110)
    ├─> Task 2 (col destino, 0111) ─> Task 3 (capture import) ─> Task 4 (retroactivo/UI)
    │                                      │
    │                                      └── (Fase B necesita destinationBankAccountId poblado)
    └──────────────── Fase A: 1 → 2 → 3 → 4 secuencial; 2/3/4 paralelizables tras 1

Task 5 (col match gateway, 0112) → Task 6 (suggest) → Task 7 (confirm/ignore) → Task 8 (UI)

Task 9 (ADenum parsers) → Task 10 (reporte cruce, reusa UI de 8)

Task 11: bloqueado hasta A+B en producción
```

## Parallelization Opportunities

- **Después de Task 1:** Tasks 2, 3 y 4 son paralelizables entre sesiones (comparten el
  contrato `destination_bank_account_id` definido en la migración 0111 de Task 2 — definir
  el contrato primero).
- **Tasks 5 (migración) puede ir en paralelo con 2/3/4** — toca tabla distinta (`bank_transactions`).
- **Tests de Tasks 6/7** una vez exista el servicio: paralelizable con Task 8 si se define
  primero el contracto de respuesta de `suggestDepositMatches`.
- **Must be sequential:** cada migración (0110→0111→0112→0113) respecto a `pnpm db:generate`.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `ALTER TYPE ADD VALUE` dentro de transacción rompe la migración (limitación PG) | High | Un `ADD VALUE` por statement, fuera de bloques transaccionales; verify con import real |
| Depósito bancario agrupa varios lotes → match 1↔1 insuficiente en la práctica | Med | Queda `UNMATCHED` con nota visible; 1↔N (sumas exactas por grupo `settlementDate`) es follow-up declarado, no se fuerza |
| Fuga de número completo de cuenta en respuesta nueva (`join` a `company_bank_accounts`) | High | Test explícito: respuesta sin propiedades `accountNumber`/`accountNumberEncrypted`; exponer sólo `accountLastFour` |
| Doble confirmación en carrera (dos usuarios confirmando el mismo candidato) | Med | Bloqueo optimista + re-check en la misma tx, 409 en 0 filas — patrón probado de `confirmMatch` |
| `drizzle-kit push` Puede dropear tablas | High | Sólo `pnpm db:generate`; revisar SQL generado antes de `db:migrate` |
| Preselección por propósito se vuelve jaula operativa | Low | Override a mano siempre disponible; catálogo único `MIXTO` no preselecciona nada |

## Open Questions

- **(Task 11 / Fase D)** ¿Qué cuenta es "la oficial del flujo" — qué cuenta alimenta el cash-flow? Decisión de producto pendiente antes de estimar la Fase D.
- **(Task 3)** ¿El destino del depósito se declara por (sucursal, adquirente) fijo, o el override manual de cada import es común? localStorage por sucursal+adquirente cubre el caso estático; si hay rotación de cuentas, mandar el destino explícito en cada upload.
- **(Task 9)** ¿Rappi/Uber traen settlement por folio individual o payout agregado semanal? El mapeo de columnas del parser depende de muestras reales — pedir 1 CSV de cada plataforma antes de implementar el mapping.

<!-- Dependencias verificadas contra el código: migrations 0107/0108 en drizzle/,
     matcher en lib/services/bank-statement-service.ts (exclusión `< 0` con comentario
     "entradas cruzan a mano"), gatewayTransactions en lib/db/schema/finance.ts:217,
     terminalAcquirerEnum en :147, upload route + tests existentes. -->
