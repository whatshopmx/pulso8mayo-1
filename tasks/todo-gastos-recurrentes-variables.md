# TODO: gastos recurrentes de monto variable

Plan: `tasks/plan-gastos-recurrentes-variables.md`

Convenciones del repo:
- Dinero en centavos (integer). Scoping por `companyId`/`branchId`, siempre desde la sesión.
- Verificación base: `pnpm run build` limpio.
- Specs contra la DB de desarrollo real. Datos etiquetados `[E2E]`, y con fechas fuera de
  julio-agosto de 2026, que es lo que ocupa el seed.
- Copy de usuario en español.

**Orden recomendado:** Fase 0 ya está hecha. La Fase 1 (acotar la consulta) va primero porque
hoy produce hallazgos falsos, y sin ella cualquier medición de las fases siguientes queda
contaminada. Las fases 2 y 3 son independientes entre sí.

---

## Fase 0: tolerancias configurables — ✅ IMPLEMENTADA

> **Estado (2026-09-01).** Rama `fix/gastos-recurrentes-variables`. Era la mitad barata del
> problema: la columna `variance_tolerance_percent` existía desde el diseño original pero
> `createRecurringContract` no la recibía, así que todo contrato quedaba en el 10% por omisión.

- [x] **V0.1** Tolerancia superior configurable, y firma por objeto
  - `createRecurringContract` pasó de nueve parámetros posicionales a un objeto (mismo criterio
    que `addItemToRun`): con las tolerancias eran once en fila y la llamada dejaba de ser legible.
  - Validación en el servicio y no sólo en la ruta: los seeds y los scripts cruzan por ahí.
- [x] **V0.2** Tolerancia inferior (`variance_tolerance_below_percent`, migración 0081)
  - Nullable, y `null` = "no alertar por debajo" — el comportamiento que tenían todos los
    contratos antes de la columna, así que ninguno cambia de conducta al migrar.
  - Dos campos y no uno con signo porque las dos desviaciones no significan lo mismo: en agua un
    consumo disparado es una fuga; en luz un recibo muy bajo suele ser lectura estimada.
- [x] **V0.3** Hallazgo `CONTRACT_VARIANCE_BELOW`
  - Tipo propio y no un `CONTRACT_VARIANCE_EXCEEDED` con signo: se investigan distinto. Severidad
    menor a propósito — no es dinero que se fue, es dinero que probablemente llegue después.
- [x] **V0.4** KPI de tesorería: prorrateo por frecuencia y rótulo honesto
  - Sumaba `baseAmountCents` de todos los contratos y lo rotulaba "MXN/mes", así que una licencia
    anual entraba completa como si fuera mensual — el número salía inflado por doce.
  - "Gastos **Fijos** Recurrentes" pasó a "Compromiso Recurrente": llamar fija a la luz invita a
    presupuestar con un número que no se va a cumplir.

> **Verificación.** 12 checks con `npx tsx scripts/verify-tolerancia-recurrentes.ts`, sembrando y
> borrando con marca `[E2E]`.
>
> | Escenario | Resultado |
> |---|---|
> | Tolerancias 35%/30% capturadas | se persisten (antes: siempre 10%) |
> | Tolerancia inferior omitida | `null`, no alerta por debajo |
> | Tolerancia superior omitida | 10% por omisión, sin cambio de conducta |
> | Tolerancia inferior de 150% | rechazada |
> | Recibo +25% con tolerancia 35% | **sin** excepción (antes: excepción cada temporada) |
> | Recibo +40% con tolerancia 35% | excepción |
> | Recibo −40% con tolerancia inferior 30% | hallazgo `CONTRACT_VARIANCE_BELOW`, severidad LOW |
> | Recibo bajo en contrato sin tolerancia inferior | nada, como antes |

---

## Fase 1: acotar la detección (P0 — hoy produce hallazgos falsos)

> **Por qué es P0.** `control-interno-service.ts:329` cruza cada contrato contra las últimas 5
> facturas del proveedor. No acota por contrato, ni por período, ni por sucursal cuando el
> contrato es corporativo. Con dos contratos del mismo arrendador —una renta y un servicio— toda
> factura dispara sobrecosto contra el de base menor. No es teórico: apareció al verificar la
> Fase 0, y `scripts/verify-tolerancia-recurrentes.ts` tiene que acotar sus aserciones por título
> de contrato para no medir este defecto por accidente.

- [ ] **V1.1** Ligar la factura al contrato, no al proveedor
  - **Descripción:** Un proveedor puede tener varios contratos. Hoy la única llave es
    `supplier_id`, y eso no basta. Hace falta decidir cómo se resuelve: columna
    `recurring_contract_id` en `invoices` (explícita, pide captura o inferencia al conciliar), o
    resolución por `(supplier_id, branch_id, contractType)` cuando sea única.
  - **Acceptance criteria:**
    - [ ] Una factura se compara contra **un** contrato, no contra todos los del proveedor
    - [ ] Dos contratos del mismo proveedor con bases distintas no se contaminan entre sí
    - [ ] Un contrato corporativo (`branchId` null) no mezcla recibos de sucursales distintas
    - [ ] Las aserciones de `verify-tolerancia-recurrentes.ts` dejan de necesitar el acotado por
          título, y el comentario que lo explica se retira
  - **Dependencies:** None
  - **Files:** `lib/services/control-interno-service.ts`, posiblemente `lib/db/schema.ts`
  - **Scope:** M

- [ ] **V1.2** Acotar por período y dejar de re-reportar lo viejo
  - **Descripción:** `limit: 5` ordenado por `createdAt`, sin filtro de fecha: un recibo de hace
    ocho meses sigue apareciendo como excepción abierta para siempre.
  - **Acceptance criteria:**
    - [ ] La detección mira una ventana explícita, no "las últimas 5"
    - [ ] Un hallazgo sale de la lista cuando su factura sale de la ventana (mismo criterio que
          `RECURRING_SHORTAGE`, que se cierra solo al salir de sus 30 cortes)
    - [ ] La ventana se declara en la UI: quien lee las excepciones debe saber qué período cubren
  - **Dependencies:** None
  - **Scope:** S

- [ ] **V1.3** Borrar `validateInvoiceAgainstContract`
  - **Descripción:** Código muerto: nadie la llama, y duplica la regla que sí corre en
    `control-interno-service` con otro criterio de severidad.
  - **Acceptance criteria:**
    - [ ] La función se elimina, o se convierte en la única implementación y `control-interno`
          la consume — pero no las dos versiones a la vez
    - [ ] `pnpm run build` limpio
  - **Dependencies:** V1.1 (si se decide unificar en vez de borrar)
  - **Scope:** S

### ☑ Checkpoint: la detección dice la verdad
- [ ] Un contrato sólo se compara contra sus propias facturas
- [ ] Ningún hallazgo sobrevive a su propia ventana
- [ ] Una sola implementación de la regla

---

## Fase 2: base móvil para servicios medidos

> Depende de **D1** y **D2** del plan. No empezar sin resolverlas: la ventana y el criterio de
> estacionalidad cambian el alcance de V2.1 por completo.

- [ ] **V2.1** Referencia por historial para `SERVICIO_BASICO`
  - **Descripción:** La mediana de los últimos N recibos de esa sucursal con ese proveedor, en
    lugar del punto capturado. Mediana y no promedio: un recibo de ajuste al doble arrastra el
    promedio y deja de detectar el siguiente.
  - **Acceptance criteria:**
    - [ ] Con menos de N recibos se usa `base_amount_cents` y se **declara** que es el capturado
    - [ ] Con N o más, mediana móvil, también declarada
    - [ ] La referencia usada se congela en el hallazgo — releerlo un mes después no puede
          devolver otro número (mismo problema que `pnl-snapshot-service` documenta)
    - [ ] Un contrato pactado (RENTA, SOFTWARE) **no** usa base móvil: su importe sí está pactado
  - **Dependencies:** D1, V1.1
  - **Scope:** L

- [ ] **V2.2** Estacionalidad contra el mismo período del año anterior
  - **Acceptance criteria:**
    - [ ] Se usa sólo cuando existe historia del año anterior; si no, mediana móvil
    - [ ] Nunca se mezclan las dos referencias en el mismo número
    - [ ] La UI dice cuál se usó
  - **Dependencies:** D2, V2.1
  - **Scope:** M

- [ ] **V2.3** Alerta de tendencia, no sólo de recibo
  - **Descripción:** El riesgo que la base móvil introduce: si el consumo sube y se queda arriba,
    la mediana lo absorbe y la fuga se vuelve la nueva normalidad. Hace falta mirar la pendiente
    además del recibo suelto.
  - **Acceptance criteria:**
    - [ ] Una subida sostenida a lo largo de N períodos genera hallazgo aunque cada recibo
          individual caiga dentro de la tolerancia
  - **Dependencies:** V2.1
  - **Scope:** M

### ☑ Checkpoint: la referencia es del propio historial
- [ ] Un verano normal no genera excepción; una fuga sí
- [ ] Cada hallazgo declara contra qué se comparó y con qué procedencia

---

## Fase 3: recurrentes en el flujo de efectivo

> Depende de **D3** del plan.

- [ ] **V3.1** Proyectar los contratos recurrentes como egreso etiquetado
  - **Descripción:** Hoy `cash-flow-service` no los mira: sus salidas son `OPERATING_EXPENSE`,
    `PURCHASE_ORDER` y `PROCUREMENT_INVOICE`. La nómina sí se proyecta desde contratos; la renta,
    la luz y el agua no. La obligación es invisible para "¿me alcanza?" hasta que llega el recibo.
  - **Acceptance criteria:**
    - [ ] `OutflowItem.source` gana un valor propio para el recurrente proyectado
    - [ ] Se distingue en la UI de un egreso comprometido real — no se suman como si fueran lo mismo
    - [ ] Un contrato de monto variable se proyecta con su referencia (Fase 2) y se marca estimado
    - [ ] Se apaga en cuanto existe factura o gasto capturado de ese período: proyectar y cobrar
          el mismo recibo dos veces miente al alza, que es la dirección peligrosa
  - **Dependencies:** D3
  - **Scope:** L

### ☑ Checkpoint: la obligación recurrente se ve antes de llegar
- [ ] El calendario a 30 días incluye renta y servicios
- [ ] Ningún período cuenta el mismo recibo dos veces
- [ ] `pnpm run build` limpio
