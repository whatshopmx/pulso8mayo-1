# TODO: gastos recurrentes de monto variable

Plan: `tasks/plan-gastos-recurrentes-variables.md`

Convenciones del repo:
- Dinero en centavos (integer). Scoping por `companyId`/`branchId`, siempre desde la sesión.
- Verificación base: `pnpm run build` limpio.
- Specs contra la DB de desarrollo real. Datos etiquetados `[E2E]`, y con fechas fuera de
  julio-agosto de 2026, que es lo que ocupa el seed.
- Copy de usuario en español.

**Orden recomendado:** Fases 0, 1 y 2 hechas. Queda la 3, cuya decisión (D3) ya está cerrada en
el plan: el recurrente entra al flujo de efectivo con `source` propio y apagable.

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

## Fase 1: acotar la detección — ✅ IMPLEMENTADA

> **Estado (2026-09-01).** Rama `fix/deteccion-contratos-recurrentes`. Era P0 porque
> `control-interno-service.ts:329` cruzaba cada contrato contra las últimas 5 facturas del
> proveedor: sin acotar por contrato, ni por período, ni por sucursal cuando el contrato era
> corporativo. Con dos contratos del mismo arrendador —una renta y un servicio— toda factura
> disparaba sobrecosto contra el de base menor. No era teórico: apareció al verificar la Fase 0,
> y `scripts/verify-tolerancia-recurrentes.ts` tenía que acotar sus aserciones por título de
> contrato para no medir este defecto por accidente.
>
> La regla y el emparejamiento viven ahora en `lib/services/recurring-contract-variance.ts`;
> `control-interno-service` sólo redacta la excepción, igual que hace con los faltantes
> recurrentes de `cash-variance-alert-service`.

- [x] **V1.1** Ligar la factura al contrato, no al proveedor
  - **Decisión:** columna `invoices.recurring_contract_id` (migración 0082), nullable y con
    `ON DELETE SET NULL` — borrar un contrato no puede borrar un CFDI. Se llena al capturar la
    factura (`app/api/inventory/invoices/upload/route.ts`) y no en tiempo de consulta: es el
    único momento en que la deducción se puede congelar. Si mañana el grupo firma un segundo
    contrato con el mismo arrendador, la factura ya sabe cuál era el suyo.
  - **Acceptance criteria:**
    - [x] Una factura se compara contra **un** contrato, no contra todos los del proveedor
    - [x] Dos contratos del mismo proveedor con bases distintas no se contaminan entre sí —
          `resolveContract` no elige ante empate: sin hallazgo es mejor que con hallazgo falso
    - [x] Un contrato corporativo (`branchId` null) no mezcla recibos de sucursales distintas:
          se evalúa por factura y el hallazgo nombra la sucursal **de la factura**. De paso, el
          corporativo ahora sí aparece con alcance de sucursal — antes quedaba fuera del filtro
          y un gerente nunca veía la desviación de su propio recibo de luz
    - [x] Las aserciones de `verify-tolerancia-recurrentes.ts` dejan de necesitar el acotado por
          título, y el comentario que lo explica se retiró
  - **Files:** `drizzle/0082_factura-contrato-recurrente.sql`, `lib/db/schema.ts`,
    `lib/services/recurring-contract-variance.ts`, `app/api/inventory/invoices/upload/route.ts`
  - **Scope:** M

- [x] **V1.2** Acotar por período y dejar de re-reportar lo viejo
  - **Decisión:** `CONTRACT_VARIANCE_WINDOW_DAYS = 90`, acotada por los dos lados. 90 y no 30
    porque CFE factura bimestral: una ventana de un mes puede no contener un solo recibo de luz.
    El techo existe porque una factura con fecha futura es un error de captura, y sin él se
    reportaría para siempre — el mismo defecto que la ventana viene a quitar.
  - **Acceptance criteria:**
    - [x] La detección mira una ventana explícita, no "las últimas 5"
    - [x] Un hallazgo sale de la lista cuando su factura sale de la ventana (mismo criterio que
          `RECURRING_SHORTAGE`)
    - [x] La ventana se declara en la UI — viaja en la respuesta de
          `/api/finance/control-interno/excepciones` y la pinta `excepciones-panel.tsx`, también
          en el estado vacío: "sin excepciones" no dice nada sin el período que lo respalda
  - **Nota:** la factura se ubica por `invoices.fecha` (la del CFDI, que es cuándo ocurrió el
    consumo), con caída a `created_at` cuando el texto no es una fecha reconocible — así ninguna
    factura queda fuera de toda ventana en silencio.
  - **Scope:** S

- [x] **V1.3** Borrar `validateInvoiceAgainstContract`
  - **Acceptance criteria:**
    - [x] Se eliminó de `treasury-service.ts`, dejando en su lugar un comentario que dice dónde
          vive la regla. La única implementación es `evaluateContractVariance`, pura y sin I/O,
          y `control-interno-service` la consume vía `getContractVarianceFindings`
    - [x] `pnpm run build` limpio
  - **Hallazgo de paso:** la función muerta elegía contrato con
    `contracts.find(...) || contracts[0]` — con dos contratos del mismo proveedor tomaba el
    primero que devolviera la base de datos. Si alguien la hubiera conectado, habría comparado
    contra un contrato arbitrario.
  - **Scope:** S

### ☑ Checkpoint: la detección dice la verdad
- [x] Un contrato sólo se compara contra sus propias facturas
- [x] Ningún hallazgo sobrevive a su propia ventana
- [x] Una sola implementación de la regla

> **Verificación.** `npx tsx scripts/verify-tolerancia-recurrentes.ts` — los 12 checks de la
> Fase 0 más 9 de la Fase 1. Las fechas se calculan contra hoy y no se escriben a mano: la
> ventana es relativa al día en que corre el script, así que una constante literal deja de estar
> dentro con sólo esperar unos meses.
>
> | Escenario | Resultado |
> |---|---|
> | Factura de $14,000 con tres contratos del mismo proveedor | **un** hallazgo, contra el suyo (antes: uno por contrato) |
> | Hallazgo de una factura ligada | nombra el contrato correcto y declara el período |
> | Factura de hace 120 días fuera de tolerancia | sin hallazgo (antes: excepción abierta para siempre) |
> | Factura sin contrato capturado, proveedor con un solo contrato | se deduce, se compara, y el detalle dice "deducido" |
> | Factura sin contrato capturado, proveedor con tres | sin hallazgo — no se adivina |
> | Contrato corporativo contra el recibo de una sucursal | hallazgo atribuido a esa sucursal (antes: "Corporativo / Cadena") |

---

## Fase 2: base móvil para servicios medidos — ✅ IMPLEMENTADA

> **Estado (2026-09-01).** Rama `fix/deteccion-contratos-recurrentes`, junto con la Fase 1. Un
> solo `base_amount_cents` no puede describir el consumo eléctrico de un restaurante: con
> tolerancias configurables el problema se mitiga —se puede poner ±35%— pero una banda tan ancha
> ya no detecta nada. Una fuga de agua que sube el consumo 30% queda dentro de la tolerancia que
> hizo falta para callar el verano. Por eso la referencia pasa a salir del historial, y la
> pendiente se mira aparte del recibo suelto.
>
> D1 y D2 se resolvieron antes de empezar: ventana en **recibos** (no meses), umbral de 3, y sin
> estacionalidad — V2.2 queda fuera de alcance.

- [x] **V2.1** Referencia por historial para `SERVICIO_BASICO`
  - **Decisión:** mediana de hasta `ROLLING_REFERENCE_RECEIPTS = 6` recibos previos, con
    `MIN_ROLLING_RECEIPTS = 3` para que sustituya a la base. Seis recibos son un año de luz o
    medio de agua. Historia leída: 730 días, para que un cambio de tarifa viejo no pese hoy.
  - **Acceptance criteria:**
    - [x] Con menos de 3 recibos se usa `base_amount_cents` y el detalle dice "monto base
          capturado en el contrato"
    - [x] Con 3 o más, mediana móvil, declarada como "mediana de sus N recibos anteriores"
    - [x] La referencia se congela: **sólo entran recibos anteriores** al que se juzga, así que
          releer el hallazgo un mes después devuelve el mismo número. Eso también evita que un
          pico eleve su propia referencia y se absuelva solo
    - [x] Un contrato pactado (RENTA, SOFTWARE) **no** usa base móvil
  - **Nota sobre `MANTENIMIENTO`:** el tablero de tesorería lo agrupa con `SERVICIO_BASICO` como
    "monto variable", pero **no** entra en la base móvil: varía con lo que se rompa, no con un
    consumo que el recibo anterior permita anticipar. Una mediana de reparaciones no predice la
    siguiente reparación.
  - **Nota sobre sucursales:** el historial se agrupa por (contrato, sucursal de la factura). La
    mediana de un contrato corporativo que mezclara locales de tamaños distintos no describiría
    ninguno — es el mismo defecto de V1.1, que aquí sí corrompería el número y no sólo el rótulo.
  - **Files:** `lib/services/recurring-contract-variance.ts`, `lib/services/control-interno-service.ts`,
    `components/finance/create-recurring-contract-modal.tsx`, `components/finance/excepciones-panel.tsx`
  - **Scope:** L

- [ ] **V2.2** Estacionalidad contra el mismo período del año anterior — ⏭️ FUERA DE ALCANCE (D2)
  - **Por qué no se hizo:** necesita un año de historia que casi ningún tenant tiene, y un solo
    recibo raro del año pasado contamina la referencia de este. La mediana móvil de V2.1 ya
    absorbe buena parte de la estacionalidad al deslizarse con los recibos.
  - **Cuándo retomarlo:** cuando haya tenants con doce meses de CFDI capturados. El diseño de
    V2.1 lo deja preparado — `VarianceReferenceBasis` es un tipo abierto y el hallazgo ya declara
    su procedencia, así que añadir `SAME_PERIOD_LAST_YEAR` no obliga a tocar la UI.
  - **Scope:** M

- [x] **V2.3** Alerta de tendencia, no sólo de recibo
  - **Decisión:** hallazgo `CONTRACT_TREND_RISING`, tipo propio y sin factura asociada
    (`expenseId: null`, como `RECURRING_SHORTAGE`): no nace de un recibo sino de la pendiente de
    varios. Compara la mediana de los últimos 3 recibos contra la de los 3 anteriores y dispara
    por encima de `TREND_RISE_PERCENT = 20`.
  - **Acceptance criteria:**
    - [x] Una subida sostenida genera hallazgo aunque cada recibo caiga dentro de la tolerancia
  - **Además de la subida se exige que los 3 recibos recientes estén por encima de la mediana
    previa.** Si sólo uno la rebasa es un pico, y de eso ya se encarga la desviación por factura;
    lo que esta alerta busca es el escalón que la mediana móvil va a absorber si nadie lo mira.
  - **Se cierra solo,** como los demás: si el recibo más reciente sale de la ventana de 90 días,
    el hallazgo desaparece — dejó de describir lo que está pasando.
  - **Scope:** M

### ☑ Checkpoint: la referencia es del propio historial
- [x] Un verano normal no genera excepción; una fuga sí
- [x] Cada hallazgo declara contra qué se comparó y con qué procedencia

> **Verificación.** `npx tsx scripts/verify-base-movil-recurrentes.ts` — 19 checks, con proveedor
> propio por contrato para que ninguna deducción cruce contratos.
>
> | Escenario | Resultado |
> |---|---|
> | Recibo al doble de la base capturada, normal para su historial | **sin** excepción (antes: excepción segura) |
> | Recibo +30% sobre su mediana, tolerancia 20% | excepción, declarando "mediana de sus N recibos anteriores" |
> | Renta con recibos históricos al doble | se sigue midiendo contra el monto pactado |
> | Servicio medido con sólo 2 recibos previos | base capturada, declarada como tal |
> | Historial [10k, 10k, 40k] | referencia $10,000 — la mediana aguanta el recibo de ajuste; el promedio ($20,000) no |
> | Llega un recibo posterior descomunal | el hallazgo anterior no cambia de referencia |
> | Contrato corporativo, local chico vs local grande | cada sucursal contra su propia mediana |
> | Subida sostenida +30% con tolerancia 100% | `CONTRACT_TREND_RISING`, sin una sola excepción por factura |
> | Un solo recibo alto en el bloque reciente | sin tendencia — es un pico, no un escalón |

---

## Fase 3: recurrentes en el flujo de efectivo

> D3 está resuelta en el plan (2026-09-01): `source` propio, apagable, y suprimido en cuanto
> existe factura o gasto capturado del período.

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
