# Todo List: Panel de Flujo de Efectivo — remediación de la crítica

Plan: `tasks/plan.md` · Crítica: `.impeccable/critique/2026-08-16T02-10-32Z__app-dashboard-finance-cash-flow-page-tsx.md`

Archivos principales:
- `app/dashboard/finance/cash-flow/page.tsx` (87 líneas)
- `components/finance/cash-flow-calendar.tsx` (800 líneas)
- `lib/services/cash-flow-service.ts` (470 líneas)
- `app/api/finance/cash-flow/route.ts` (32 líneas)

---

## Fase 0: La aritmética (sólo servicio, sin riesgo de UI)

- [x] **Task 0**: Crear `tests/cash-flow.spec.ts` con los invariantes
  - **Descripción**: No existe spec para esta pantalla (`ls tests/` lo confirma), así que las
    verificaciones de todas las tareas siguientes no tienen dónde vivir. Se crea primero, con los
    invariantes aritméticos que las Tasks 1-5 tienen que hacer pasar. Arranca en rojo: eso es el
    punto.
  - **Acceptance criteria**:
    - [x] Invariante de egresos: `Σ days[].projectedOutflowCents == Σ outflowItems[]` en la ventana
    - [x] Invariante semanal: total de la semana == suma de los días que la componen
    - [ ] Caso de inquilino sin `dailySalesCuts` → no produce saldo negativo — `test.fixme`,
          necesita el `inflowBasis` de la Task 2 (la sesión sembrada sí tiene cortes)
    - [x] Datos creados y limpiados por SQL directo en `tests/support/db.ts`, etiquetados `[E2E]`
          (`seedOperatingExpense`, un gasto en cada día de nómina de la ventana: sin esa
          colisión el doble conteo no se manifiesta)
    - [x] Los casos que aún no aplican quedan con `test.fixme`, no borrados
  - **Verificación**:
    - [x] `pnpm build` **no corre sin red**: `next/font` no puede bajar Geist de Google Fonts.
          Se usó el fallback documentado en el plan, `npx tsc --noEmit` → limpio.
          El spec se corrió contra `next dev` (el spec pega a la API con el fixture
          `request`, así que no compila páginas salvo el login de `auth.setup.ts`).
    - [x] Los invariantes fallan antes de la Task 1 y pasan después
  - **Invariantes añadidos sobre lo planeado** (salieron de leer el servicio):
    - conteo de partidas del día == partidas de esa fecha
    - ninguna partida cae fuera del rango de días proyectados
    - las semanas cubren la ventana sin traslaparse
  - **Dependencias**: Ninguna
  - **Archivos**: `tests/cash-flow.spec.ts`, `tests/support/db.ts`
  - **Alcance**: M

- [x] **Task 1**: Nómina contada dos veces
  - **Descripción**: En `cash-flow-service.ts:349`, `dayOutflows` es una *referencia* dentro de
    `outflowsByDate` cuando la fecha ya existe. La línea 360 hace `dayOutflows.count += 1`, después
    `addItem` (`:241-249`) vuelve a sumar el mismo monto y el mismo conteo, y `:373` calcula
    `dayOutflows.amount + payrollExtra`. En cualquier 15 o 30 que comparta fecha con otro gasto, el
    día cuenta la nómina dos veces y un compromiso de más. La agregación semanal (`:432-436`) lee
    `outflowsByDate` *después* y la cuenta una sola vez: por eso la barra "Salidas", el total de la
    semana y "Total egresos" se contradicen en pantalla.
  - **Acceptance criteria**:
    - [x] Se elimina el `dayOutflows.count += 1` manual y se lee `outflowsByDate[dateStr]` *después*
          de `addItem`
    - [x] En una fecha con nómina + un gasto: `projectedOutflowCents == gasto + nómina` y
          `outflowItemsCount == 2` (verificado con datos reales: `2026-08-16` pasó de
          `día=15323400 / 3 partidas` a `día=7723400 / 2 partidas`)
    - [x] `hasHighConcentration` (`count >= 3`) deja de dispararse por el conteo inflado
  - **Verificación**:
    - [x] Script en scratchpad que llama `getCashFlowProjection` y asserta
          `Σ days[].projectedOutflowCents == Σ outflowItems[] dentro de la ventana`
    - [x] El mismo script asserta que el total de cada semana == suma de sus días
    - [x] `npx tsc --noEmit` limpio (fallback: `pnpm run build` no corre sin red, ver Task 0)
  - **Arreglo adicional, mismo invariante**: la ventana de consulta cerraba en `hoy + days`
    mientras el timeline sólo emite `days` filas, así que una partida del último día se cobraba
    en "Total egresos" y en ninguna barra. `endDate` pasa a `startDate + (days - 1)`.
  - **Hallazgo para la Task 4**: con datos reales la nómina cayó en `2026-08-16` y `2026-08-31`,
    no en 15 y 30 — `getDate()` lee local (UTC-6) y `dateStr` es el corte UTC del mismo instante.
  - **Dependencias**: Ninguna
  - **Archivos**: `lib/services/cash-flow-service.ts`
  - **Alcance**: XS

- [x] **Task 2**: Entradas con estacionalidad y sin historial declarado
  - **Descripción**: `avgDailyInflowCents` (`:104-107`) es un promedio de toda la historia aplicado
    plano a los 30 días, así que la serie "Entradas" es una línea recta por construcción — la mitad
    de la tinta de la gráfica no informa nada. Y el fallback `1500000` es **inalcanzable**:
    `Number(daysCount || 1)` nunca da 0, así que un inquilino sin cortes de venta recibe **$0/día** y
    una pantalla roja completa en su primer login. Se reemplaza por promedio por día de la semana
    sobre los últimos 90 días, y por un estado explícito cuando no hay historial.
  - **Acceptance criteria**:
    - [x] El promedio se calcula por día de la semana sobre los últimos 90 días de
          `dailySalesCuts`. Se agrupa por `business_date` en SQL y el día de la semana se
          deriva en JS (`dayOfWeekOf`): `EXTRACT(DOW)` lo habría calculado en la zona del
          servidor de Postgres, que es justo la mezcla de zonas que ataca la Task 4.
    - [x] Con menos de 14 días de historial se cae al promedio simple y se marca `AVERAGE`
    - [x] Sin ningún corte: `basis: 'NONE'`, `projectedInflowCents: null`, y **no** se pinta rojo
    - [x] Se agrega `inflow: { basis, historyDays, lookbackDays, avgDailyInflowCents }` al
          payload — objeto en vez de un campo suelto: la antigüedad del historial es parte
          de la declaración que la Task 9 tiene que mostrar en pantalla
  - **Verificación**:
    - [x] Lunes y sábado difieren en la serie (verificado con 60 días sembrados:
          `lun=$9,000 sáb=$24,000`; cada día de la semana proyecta exactamente el monto
          sembrado para ese día)
    - [x] `companyId` sin cortes → `NONE`, cero días con saldo, cero días negativos
    - [x] `npx tsc --noEmit` limpio (fallback documentado: `pnpm build` no baja Geist sin red)
    - [x] `pnpm exec playwright test tests/cash-flow.spec.ts` → 10/10 en verde
  - **Hallazgo**: la compañía sembrada **no tiene un solo corte de venta**, así que la rama
    muerta era la que estaba corriendo en desarrollo: `Number(0 || 1)` daba 1, el promedio
    daba $0/día y la pantalla de estreno salía roja. El `test.fixme` de la Task 0 se pudo
    promover a test real sin sembrar nada.
  - **Alcance fuera del archivo planeado**: `netFlowCents` y `cumulativeBalanceCents` también
    pasan a `number | null` — un saldo calculado restando egresos contra cero es la misma
    invención con otro nombre. Eso obligó a tocar los dos consumidores que leían esos campos:
    `executive-twin-engine.ts` (un `Math.min` sobre `null` habría hundido el `liquidityRisk`
    con un dato que nadie afirmó) y `cash-flow-summary-card.tsx` (`null < 0` es `false`, pero
    `formatCents(null)` no) . `strict: false` no los habría delatado.
  - **Dependencias**: Task 1
  - **Archivos**: `lib/services/cash-flow-service.ts`, `components/finance/cash-flow-calendar.tsx`,
    `components/finance/cash-flow-summary-card.tsx`, `lib/services/executive-twin-engine.ts`,
    `tests/cash-flow.spec.ts`, `tests/support/db.ts`
  - **Alcance**: M

- [x] **Task 3**: Semana 5 fantasma y la mediana que contamina
  - **Descripción**: `floor(i/7)+1` sobre 30 días emite **5** semanas en un grid `lg:grid-cols-4`
    (`:640`), así que siempre hay una tarjeta huérfana. La semana 5 cubre 2 días reales pero imprime
    una etiqueta de 7 días (`:420-423`), y ese muñón casi vacío jala la mediana hacia abajo
    (`:440-441`), marcando *más* semanas como `isHeavy`. Falsas alarmas por un artefacto de división.
  - **Acceptance criteria**:
    - [x] La etiqueta de la semana refleja los días que realmente cubre: `endDate` se cierra
          con el último día que la semana toca, en vez de `weekStart + 6` a ciegas
    - [x] La mediana se calcula sólo sobre semanas completas (`isPartial === false`), y una
          semana parcial nunca se marca `isHeavy`: su total es más chico por dónde cae el
          corte de la ventana, no por estar descargada
    - [x] El grid se ajusta al número de semanas
          (`lg:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]`) en vez de `lg:grid-cols-4`
          fijo, que con 30 días (5 semanas) dejaba siempre una tarjeta huérfana
    - [x] La semana parcial se distingue: borde punteado, fondo atenuado y el conteo de días
          que cubre junto a los compromisos
  - **Verificación**:
    - [x] Con `days=30`: 5 semanas, la última con `dayCount: 2`, `isPartial: true` y
          `endDate` == último día de la ventana
    - [x] Con `days=7`, `30` y `60`: el número de semanas es `ceil(días/7)`, la suma de
          `dayCount` es exactamente la ventana, y el rango declarado de cada semana contiene
          exactamente `dayCount` días
    - [x] `npx tsc --noEmit` limpio · `pnpm exec playwright test tests/cash-flow.spec.ts` 15/15
  - **Añadido sobre lo planeado**: `key` estable (`week-N`) en el payload. La etiqueta ahora
    se deriva de las fechas, así que usarla de llave de React —lo que hacía el render— es
    todavía más frágil que antes. Adelanta un punto de la Task 19.
  - **No cubierto por test**: que la mediana excluya el muñón se sostiene por construcción,
    no por aserción — probarlo directo exigiría sembrar montos controlados semana por semana.
    El síntoma que la crítica nombró (falsas alarmas por el muñón) sí queda cerrado por
    "una semana parcial nunca se marca pesada".
  - **Dependencias**: Ninguna
  - **Archivos**: `lib/services/cash-flow-service.ts`, `components/finance/cash-flow-calendar.tsx`,
    `tests/cash-flow.spec.ts`
  - **Alcance**: S

- [x] **Task 4**: Frontera de fecha en zona horaria de la sucursal
  - **Descripción**: `toISOString().slice(0,10)` (`:91, :272, :280, :347, :415, :447`) calcula en UTC.
    En UTC-6, después de las 6pm local —la hora a la que una dueña revisa el dinero— "hoy" se vuelve
    mañana: la ventana se recorre un día y las partidas saltan entre "vencido" y "próximo".
    `branches.timezone` ya existe con default `America/Mexico_City`.
  - **Acceptance criteria**:
    - [x] Cero `toISOString().slice(0,10)` en la lógica del servicio (verificado por grep). Los
          reemplazan `localDateString` (instante → día local) y `addCalendarDays` (aritmética
          de calendario sobre la cadena, sin husos de por medio)
    - [x] La zona sale de `branches.timezone`. **Corrección al plan**: `companies` **no tiene
          columna `timezone`** — `branches` es la única fuente de husos del esquema. Sin
          sucursal se usa la zona de las sucursales sólo si todas coinciden; un grupo entre
          Cancún y Tijuana no tiene un "hoy" único y cae al default `America/Mexico_City`
    - [x] A las 19:00 de Ciudad de México `startDateStr` sigue siendo hoy
  - **Verificación**:
    - [x] `localDateString(2026-08-16T01:00:00Z, America/Mexico_City)` → `2026-08-15`,
          contra el `2026-08-16` que devolvía `toISOString()`. El test deja los dos lado a lado
    - [x] Tijuana / CDMX / Cancún leen su propio día a las 23:30 CDMX
    - [x] Zona inválida o `null` cae al default en vez de reventar
    - [x] `addCalendarDays` cruza fin de mes, fin de año y 29 de febrero
    - [x] La nómina ya cae en el **30**; antes caía en el 16 y el 31 (hallazgo de la Task 1:
          `getDate()` leía local y `dateStr` era el corte UTC del mismo instante)
    - [x] `npx tsc --noEmit` limpio · `pnpm exec playwright test tests/cash-flow.spec.ts` 20/20
  - **Decisión de alcance**: se resistió la tentación de agregarle ya el parámetro `branchId`
    a `getCashFlowProjection`. Un `branchId` que cambia la zona horaria pero **no** filtra los
    datos es exactamente la trampa que la Task 6 existe para cerrar: cifras del grupo entero
    con fechas de una sucursal. La resolución por sucursal entra completa en la Task 6.
  - **Dependencias**: Ninguna
  - **Archivos**: `lib/services/cash-flow-service.ts`, `lib/workflows/today.ts`,
    `tests/cash-flow.spec.ts`
  - **Reutilización**: los helpers viven en `lib/workflows/today.ts`, que ya resolvía este
    problema para el tablero (`localMoment`, `safeTimeZone`, `startOfLocalDayUtc`) y documenta
    por qué se usa `Intl` nativo. Crear un `lib/date-*.ts` nuevo habría sumado justo el tipo
    de módulo duplicado contra el que advierte CLAUDE.md.
  - **Alcance**: S

- [x] **Task 5**: `procurementCommitments` fuera de la ventana
  - **Descripción**: `:462-467` suma **todas** las OC comprometidas y facturas pendientes, incluidas
    las que caen fuera de los 30 días; la proyección sólo admite las de la ventana (`:284`, `:313`).
    Dos cifras en una pantalla afirmando describir la misma proyección.
  - **Acceptance criteria**:
    - [x] Se hacen **las dos cosas**: los totales de `procurementCommitments` pasan a ser sólo
          los admitidos, y lo que vence después se declara en `outsideWindow`. Los contadores
          se llevan en el mismo bucle donde se decide la admisión, así la tira no puede
          desviarse de lo que la proyección incluyó
    - [x] La tira y "Total egresos" concuerdan; la diferencia queda explicada en pantalla
          ("Además hay $X comprometidos que vencen después de esta ventana. No se incluyen en
          las cifras de arriba.")
  - **Verificación**:
    - [x] Con una OC de $50,000 fechada a 60 días: la tira sigue diciendo `3 OC = $3,541`
          (== suma real de OC admitidas), "Total egresos" no se mueve, y la OC aparece
          declarada como `outsideWindow: 1 OC = $50,000`. Antes la tira habría dicho
          `4 OC = $53,541` sobre una proyección que sólo contiene $3,541
    - [x] Invariante en el spec: `purchaseOrdersTotalCents` == Σ partidas `PURCHASE_ORDER`
          admitidas, e igual para facturas — vale con cualquier semilla
    - [x] `npx tsc --noEmit` limpio · `pnpm exec playwright test tests/cash-flow.spec.ts` 22/22
  - **Dependencias**: Ninguna
  - **Archivos**: `lib/services/cash-flow-service.ts`, `components/finance/cash-flow-calendar.tsx`,
    `tests/cash-flow.spec.ts`
  - **Alcance**: S

### Checkpoint: Aritmética — ✅ cerrado
- [x] `pnpm run build` **no corre sin red**: falla con `Failed to fetch 'Geist' from Google
      Fonts` y nada más (es el riesgo previsto en el plan). Fallback documentado:
      `npx tsc --noEmit` → limpio
- [x] `npx eslint` sobre los cinco archivos tocados: los 3 hallazgos
      (2 `no-explicit-any`, 1 `weeklyChartData` sin usar) **ya existían antes de esta fase**
      — verificado con `git stash`, mismos tres con otro número de línea. `weeklyChartData`
      es un punto explícito de la Task 19
- [x] Invariante de egresos: días == partidas
- [x] Invariante semanal: semana == suma de sus días
- [x] Un inquilino sin cortes de venta no ve pantalla roja
- [x] `pnpm exec playwright test tests/cash-flow.spec.ts` → **22/22 en verde**

**Estado de la Fase 0**: las cinco tareas cerradas. El servicio ya no se contradice consigo
mismo: los días suman las partidas, las semanas suman sus días, la tira de fuentes suma lo
que la proyección admitió, el día lo decide el reloj de la operación y las entradas se
estiman o se declaran, pero no se inventan.

**Lo que sigue siendo falso en la pantalla** (y por qué el orden del plan no era negociable):
el saldo inicial sigue siendo `INITIAL_BALANCE = 2000000` para todo inquilino, y el selector
de sucursal sigue sin llegar al servicio. Fases 1 y 2.

---

## Fase 1: Alcance por sucursal (P0)

- [x] **Task 6**: Hilar `branchId` de la ruta al servicio
  - **Descripción**: `page.tsx:29-31` manda `branchId`; `route.ts:23-27` sólo lee `days` y llama
    `getCashFlowProjection(ctx.userCompanyId, days)`. Cada consulta filtra únicamente por
    `companyId`. Una dueña que cambia a "Polanco" ve las cifras del grupo entero etiquetadas como una
    sucursal, y actúa sobre ellas. Es peor que una función faltante: es un número equivocado
    presentado con confianza en la única pantalla cuyo nombre promete alertar.
  - **Acceptance criteria**:
    - [x] `route.ts` lee `branchId` y lo pasa por `enforceBranchScope` (`lib/branch-scope.ts`),
          con `ctx.userRole` / `ctx.userBranchId` de sesión — nunca del query
    - [x] `getCashFlowProjection(companyId, days, branchId?)` filtra las cinco consultas:
          `operatingExpenses` (proyectados **y** vencidos), `purchaseOrders`, `invoices`,
          `dailySalesCuts` y `employeeContracts`→`users.branchId`
    - [x] Facturas con `branch_id` NULL: se traen con `(branch_id = X OR branch_id IS NULL)`,
          se excluyen del cálculo y su conteo viaja como `unassignedInvoicesCount`
    - [x] Píldora de alcance arriba de todo, siempre visible ("Grupo completo" / nombre de
          sucursal). Rotula el alcance **aplicado**, que es lo que devuelve `scope` en el
          payload: a un GERENTE que pide otra sucursal el servidor le devuelve la suya, y la
          pantalla tiene que decir la verdad sobre lo que calculó
    - [x] GERENTE y SUPERVISOR quedan fijados a su sucursal aunque pidan otra
  - **Verificación**:
    - [x] Dos `branchId` distintos devuelven cifras distintas, y ninguna sucursal ve la
          partida de la otra (Condesa $11,111 vs Polanco $22,222 sembrados a propósito:
          sin montos distintos el test podría pasar por casualidad)
    - [x] El grupo tampoco coincide con ninguna sucursal sola
    - [x] **Sesión real de GERENTE** (`juan@pulso.mx`, fijado a Condesa) pidiendo Polanco →
          el payload responde con Condesa y sin la partida de Polanco. Se levanta un contexto
          limpio en el spec y se inicia sesión contra `/api/auth/sign-in/email`: el
          `storageState` compartido es de SUPER_ADMIN, que sí puede pedir cualquier sucursal
    - [x] La factura sin sucursal aparece en el alcance de grupo, desaparece del alcance por
          sucursal y su conteo se declara
    - [x] Los invariantes de la Fase 0 (días == partidas, semana == suma de sus días) se
          sostienen con alcance de sucursal
    - [x] `npx tsc --noEmit` y `npx eslint` limpios · **27/27** en el spec
  - **Dependencias**: Tasks 1-5
  - **Archivos**: `app/api/finance/cash-flow/route.ts`, `lib/services/cash-flow-service.ts`,
    `components/finance/cash-flow-calendar.tsx`, `tests/cash-flow.spec.ts`,
    `tests/support/constants.ts`
  - **Nota**: `page.tsx` no necesitó cambios — ya mandaba `branchId` desde el selector del
    encabezado. El defecto era enteramente del lado del servidor: la ruta lo recibía y lo
    tiraba.
  - **Nota sobre la nómina**: se filtra por `users.branchId`, no por
    `employee_contracts.branch_id`, que es nullable y viene vacío en la base sembrada.
  - **Alcance**: M

- [ ] **Task 7**: Horizonte y estado de pantalla en la URL
  - **Descripción**: `days=30` está fijo en `page.tsx:28` y editar la URL no hace nada porque la
    página arma la suya. No hay control de horizonte, y los dos colapsos son `useState` local
    (`:194-195`) que se reinician en cada cambio de sucursal. Tampoco hay deep-link: no se puede
    mandar "mira la semana 3" al contador.
  - **Acceptance criteria**:
    - [ ] Selector de horizonte 7 / 30 / 60 días que escribe en `searchParams`
    - [ ] `branchId`, `days` y los colapsos se leen de la URL y sobreviven al remonte
    - [ ] Pegar la URL en otra sesión reproduce la misma vista
    - [ ] La gráfica y el CSV declaran el horizonte que están usando (hoy hay tres en la pantalla:
          14d gráfica y resumen, 30d categorías y semanas, 30d CSV — sólo la gráfica lo dice)
  - **Verificación**:
    - [ ] Cambiar a 7 días recarga la proyección y la gráfica no queda en 14
    - [ ] Cambiar de sucursal conserva el estado de los colapsos
  - **Dependencias**: Task 6
  - **Archivos**: `app/dashboard/finance/cash-flow/page.tsx`, `components/finance/cash-flow-calendar.tsx`
  - **Alcance**: M

### Checkpoint: Alcance
- [ ] Cambiar de sucursal cambia las cifras
- [ ] `enforceBranchScope` fija a los roles de sucursal
- [ ] La píldora de alcance está siempre visible

---

## Fase 2: Saldo inicial verdadero (P0)

- [ ] **Task 8**: Tabla y migración de supuestos de flujo
  - **Descripción**: `INITIAL_BALANCE = 2000000` (`:81`) son $20,000 MXN idénticos para un café de 3
    sucursales y un grupo hotelero de 15, renderizados en `text-2xl font-bold` como "Saldo inicial
    proyectado" y sembrando `runningBalance` (`:343`). "Saldo mínimo", las bandas de color y "Te
    alcanza para N días" heredan todos esa invención. El esquema no tiene banco ni libro mayor: el
    dato tiene que capturarse.
  - **Acceptance criteria**:
    - [ ] Tabla `cash_flow_assumptions`: `companyId`, `branchId` (nullable = grupo),
          `openingBalanceCents`, `asOfDate`, `updatedBy`, `updatedAt`, único por (company, branch)
    - [ ] Migración escrita a mano con nombre descriptivo, al estilo de `0032_arqueo-cierre-turno`
    - [ ] `getCashFlowProjection` lee el supuesto de la sucursal, cae al de la compañía, y si no hay
          ninguno devuelve `initialBalanceCents: null` con `openingBalanceSource: 'NONE'`
    - [ ] La constante `INITIAL_BALANCE` desaparece del archivo
  - **Verificación**:
    - [ ] `pnpm db:generate` no reporta drift después de aplicar (nunca `db:push`)
    - [ ] `npx tsx scripts/check-migration-drift.ts`
    - [ ] Inquilino sin registro → payload con `null`, no con un número
  - **Dependencias**: Task 6
  - **Archivos**: `lib/db/schema/` (módulo nuevo o `finance`), `drizzle/00XX_supuestos-flujo-efectivo.sql`,
    `lib/services/cash-flow-service.ts`
  - **Alcance**: M

- [ ] **Task 9**: Captura en línea, línea de supuestos y "cómo se calcula"
  - **Descripción**: Cuatro supuestos que cargan toda la pantalla (saldo inicial, fecha de OC
    estimada a +14 días, quincena asumida el 15 y el 30, entradas históricas planas) se presentan
    como hechos, sin tooltip y sin "cómo se calcula". Con Task 8 el saldo ya es capturable; falta la
    superficie para capturarlo y la honestidad sobre el resto.
  - **Acceptance criteria**:
    - [ ] La tarjeta de saldo permite editar el monto en línea (RBAC: ADMIN y GERENTE) y persiste
    - [ ] Sin saldo capturado la tarjeta pide el dato y **la proyección no se dibuja** en vez de
          proyectar sobre cero
    - [ ] Se muestra la antigüedad del dato; a más de 7 días se pide actualizarlo
    - [ ] Línea de supuestos bajo la fila hero que nombra las cuatro estimaciones, con popover
          "cómo se calcula" por cada una
    - [ ] Incluye el conteo de facturas sin sucursal de la Task 6
  - **Verificación**:
    - [ ] Capturar un saldo y recargar → persiste y las cifras derivadas cambian
    - [ ] Un EMPLEADO no ve el input de edición
    - [ ] `pnpm exec playwright test tests/cash-flow.spec.ts -g "saldo"`
  - **Dependencias**: Task 8
  - **Archivos**: `components/finance/cash-flow-calendar.tsx`, `app/api/finance/cash-flow/assumptions/route.ts`,
    `lib/services/cash-flow-service.ts`
  - **Alcance**: M

### Checkpoint: Saldo inicial
- [ ] Ningún número depende de una constante
- [ ] Sin saldo, la pantalla pide el dato en vez de inventar
- [ ] Los cuatro supuestos están declarados en pantalla

---

## Fase 3: Accionabilidad (P1)

- [ ] **Task 10**: Higiene de datos del render
  - **Descripción**: `supplierName` está en el payload (`:54`) y nunca se renderiza; `isPayroll`
    (`:51`) nunca se usa. Las filas de vencidos son texto truncado sin proveedor y sin sucursal:
    identificar "Renta" exige recordar. Peor: `:302` devuelve "Sin datos de proyección disponibles"
    **antes** de que la tarjeta de vencidos se renderice en `:442`, así que un inquilino con
    facturas vencidas y sin días de proyección no ve ninguna. Y el fallback de arreglo legacy
    (`:198-208`) vacía cuatro de seis secciones sin decir nada — un estado degradado indistinguible
    de uno sano.
  - **Acceptance criteria**:
    - [ ] `supplierName` se renderiza en filas de vencidos y de próximos 7 días cuando existe
    - [ ] La sucursal de la partida es visible cuando el alcance es "grupo completo"
    - [ ] La tarjeta de vencidos se renderiza *antes* del guard `!days.length`
    - [ ] El fallback de arreglo legacy se elimina (el API ya devuelve siempre el objeto) o avisa
    - [ ] La rama vacía usa `EmptyState`, que la página ya importa
  - **Verificación**:
    - [ ] Inquilino con vencidos y sin proyección ve la tarjeta de vencidos
    - [ ] `pnpm run build`
  - **Dependencias**: Task 6
  - **Archivos**: `components/finance/cash-flow-calendar.tsx`
  - **Alcance**: S

- [ ] **Task 11**: Cada hallazgo enlaza a su registro origen
  - **Descripción**: Inventario del crítico: **4 elementos interactivos, 0 que naveguen.** Las filas
    (`:457-491`, `:587-613`) son `<div>` planos. La dueña se entera de que tiene 6 facturas vencidas
    y después tiene que salir, abrir `/dashboard/finance/expenses` y buscar por descripción truncada.
    Destinos: `OPERATING_EXPENSE` → `/dashboard/finance/expenses`, `PROCUREMENT_INVOICE` →
    `/dashboard/finance/fiscal`, `PURCHASE_ORDER` → `/dashboard/inventory/purchase-orders`.
    Ninguna de las tres listas acepta hoy un parámetro de foco.
  - **Acceptance criteria**:
    - [ ] Cada fila es un `Link` al registro origen según su `source`
    - [ ] Las tres páginas destino aceptan `?focus=<id>` y resaltan/desplazan a esa fila
    - [ ] Enlace al pie hacia Cuentas por Pagar
    - [ ] El foco de teclado y el estado hover son visibles en la fila completa
  - **Verificación**:
    - [ ] Click en una fila de vencidos aterriza en el gasto correcto y resaltado
    - [ ] `pnpm exec playwright test tests/cash-flow.spec.ts -g "navega"`
  - **Dependencias**: Task 10
  - **Archivos**: `components/finance/cash-flow-calendar.tsx`,
    `app/dashboard/finance/expenses/page.tsx`, `app/dashboard/finance/fiscal/page.tsx`,
    `app/dashboard/inventory/purchase-orders/page.tsx`
  - **Alcance**: M

- [ ] **Task 12**: Endpoints de pago y reprogramación de gastos
  - **Descripción**: `expense-service.ts` tiene `create`, `approve`, `reject` y `get`, pero no
    `markPaid` ni `reschedule`. El enum `operating_expense_status` ya incluye `PAID`. Los endpoints
    van en el dominio de gastos, no en cash-flow: esta pantalla es un consumidor más.
  - **Acceptance criteria**:
    - [ ] `markPaidOperatingExpense` y `rescheduleOperatingExpense` en `lib/services/expense-service.ts`
    - [ ] Rutas con `withTenantAuth`/`withRoleAuth`, `tenantId` y `userId` de sesión
    - [ ] Ambas registran auditoría con el mismo patrón que `approve`/`reject`
    - [ ] Reprogramar valida que la fecha nueva no sea anterior a hoy
    - [ ] Un gasto ya `PAID` no se puede volver a pagar (idempotente o error claro)
  - **Verificación**:
    - [ ] `curl` de pago cambia `status` y deja fila de auditoría
    - [ ] Rol sin permiso recibe 403 con el envelope `{ success:false, error }`
  - **Dependencias**: Ninguna (paralelizable con Tasks 10-11)
  - **Archivos**: `lib/services/expense-service.ts`, `app/api/expenses/[id]/pay/route.ts`,
    `app/api/expenses/[id]/reschedule/route.ts`
  - **Alcance**: M

- [ ] **Task 13**: Acciones en línea con RBAC
  - **Descripción**: Conectar Task 12 a las filas. Además, decir en voz alta qué hace y qué no esta
    pantalla — `payables/page.tsx:183-191` ya establece ese patrón y esta no lo tiene. Aquí el aviso
    cambia de sentido: sí escribe, pero no concilia contra el banco.
  - **Acceptance criteria**:
    - [ ] "Marcar pagado" y "Reprogramar" en filas de vencidos y próximos 7 días, sólo donde el rol
          lo permite
    - [ ] Tras la acción, la proyección se revalida y las cifras se actualizan sin recargar
    - [ ] Aviso explícito: registra el estado del gasto, no concilia el movimiento bancario
    - [ ] Estados de carga y error por fila, no globales
  - **Verificación**:
    - [ ] Marcar pagado desde aquí saca la partida de vencidos y recalcula el saldo mínimo
    - [ ] Un SUPERVISOR sin permiso no ve los botones
    - [ ] `pnpm exec playwright test tests/cash-flow.spec.ts -g "marcar pagado"`
  - **Dependencias**: Tasks 11, 12
  - **Archivos**: `components/finance/cash-flow-calendar.tsx`, `hooks/queries/`
  - **Alcance**: M

### Checkpoint: Accionabilidad
- [ ] Toda fila navega a su registro origen
- [ ] `supplierName` visible donde existe
- [ ] Vencidos visibles aunque no haya proyección
- [ ] Marcar pagado cambia el estado y queda auditado

---

## Fase 4: Color, contraste y jerarquía (P1)

- [ ] **Task 14**: Contraste (dos fallas AA verificadas)
  - **Descripción**: `text-warning` en `:354` es `oklch(0.72 0.15 80)` = **2.52:1** sobre blanco y
    **2.42:1** sobre el `bg-warning/5` real donde vive — falla incluso el piso de 3:1 para texto
    grande, en `text-2xl font-bold`. `text-success` sobre blanco es 3.68:1: pasa en `:399` (texto
    grande) pero **falla 4.5:1 en `:691` y `:710`**, que son `text-xs`. El repo ya resolvió esto:
    `globals.css:90-94` define `--warning-text` (6.61:1) y nueve archivos lo usan, incluida la
    tarjeta hermana `cash-flow-summary-card.tsx:166`. Este archivo se quedó atrás. Además, en modo
    oscuro `--info` (`:147`) y `--chart-4` (`:153`) son idénticos byte a byte: las badges "OC" y
    "Factura" se pintan del mismo color y sólo las distingue la etiqueta.
  - **Acceptance criteria**:
    - [ ] `text-warning` → `text-warning-text` en `:354`
    - [ ] `text-success` en `text-xs` (`:691`, `:710`) pasa a un token que cumple 4.5:1
    - [ ] `--chart-4` en `.dark` deja de colisionar con `--info`, o la badge de Factura cambia de token
    - [ ] Cero usos restantes de `text-warning`/`text-success` como color de texto que no cumplan
  - **Verificación**:
    - [ ] `grep -n "text-warning\b\|text-success\b" components/finance/cash-flow-calendar.tsx` limpio
    - [ ] Revisión de contraste en claro y oscuro
  - **Dependencias**: Ninguna
  - **Archivos**: `components/finance/cash-flow-calendar.tsx`, `app/globals.css`
  - **Alcance**: S

- [ ] **Task 15**: Presupuesto de rojo y jerarquía de severidad
  - **Descripción**: En un mes malo están rojos a la vez: las tarjetas hero 2 y 3 completas, la badge
    de nómina (`:430`), toda la tarjeta de vencidos con cada monto y cada badge, la barra `NOMINA` en
    `--destructive`, la de `RENTA` en `--chart-1` (hue 25, prácticamente Rojo Operativo), hasta 5
    tarjetas semanales, las cifras de Salidas y Flujo neto, y las 14 barras "Salidas" en `--chart-5`
    (un carmesí). Más cuatro iconos `text-primary`. DESIGN.md lo topa en 10–15%. Y no sabe rangear:
    `daysUntilNegative` truthy pinta la tarjeta de destructive lo mismo si la fecha es en 2 días que
    en 29 (`:385-395`), así que "apenas bien" y "en problemas el jueves" se ven idénticos.
  - **Acceptance criteria**:
    - [ ] Un solo dueño del rojo: la tarjeta de vencidos
    - [ ] Semanas pesadas → tinte ámbar más la palabra literal "Semana pesada"
    - [ ] Barras "Salidas" → `var(--chart-4)`; barra `RENTA` fuera del rango de hue rojo
    - [ ] Cifras del resumen → foreground con signo negativo
    - [ ] Tarjeta 3: roja sólo a ≤7 días, ámbar hasta 14, neutra más allá
    - [ ] El rojo cabe en 10–15% en el peor escenario de datos
  - **Verificación**:
    - [ ] Captura del peor caso con la seed y estimación del área roja
    - [ ] Con saldo negativo a 25 días la tarjeta 3 no es roja
  - **Dependencias**: Task 14
  - **Archivos**: `components/finance/cash-flow-calendar.tsx`
  - **Alcance**: M

- [ ] **Task 16**: Jerarquía visual y agrupación
  - **Descripción**: Cinco de ocho ítems de carga cognitiva fallan. Cuatro valores `text-2xl` con el
    mismo peso (`:328, :350, :387, :399`) y ~85% del texto de datos en `text-xs` — `text-sm` aparece
    dos veces en 800 líneas. Seis bloques de primer nivel. Cuatro bloques hero apilados es
    exactamente el patrón que DESIGN.md prohíbe como layout por defecto. Nada tiene `tabular-nums`
    mientras las dos pantallas hermanas de finanzas sí (`payables/page.tsx:152,164,173`), así que los
    cuatro montos semanales que la dueña quiere comparar no alinean. `CardDescription` se pisa a
    `text-xs` cuatro veces contra su default `text-sm`, y `CardContent` es `p-4` en cinco tarjetas y
    `p-6` en el resto — dos paddings internos contra los 24px de DESIGN.md.
  - **Acceptance criteria**:
    - [ ] Una sola respuesta primaria dominante ("¿me alcanza?"); las demás bajan un nivel
    - [ ] `tabular-nums` en toda cifra monetaria
    - [ ] Piso de `text-sm` para texto de datos; `text-xs` sólo para etiquetas secundarias
    - [ ] Máximo 4 bloques de primer nivel
    - [ ] Padding de tarjeta consistente; se deja de pisar `CardDescription`
  - **Verificación**:
    - [ ] Los cuatro montos semanales alinean verticalmente
    - [ ] En iPad y en móvil la pantalla se lee a la distancia del brazo
  - **Dependencias**: Task 15
  - **Archivos**: `components/finance/cash-flow-calendar.tsx`
  - **Alcance**: M

### Checkpoint: Visual
- [ ] Cero `text-warning` como texto y cero `text-success` en `text-xs`
- [ ] El rojo cabe en 10–15% en el peor caso
- [ ] OC y Factura se distinguen en oscuro

---

## Fase 5: Copy, accesibilidad y limpieza (P2)

- [ ] **Task 17**: Copy factualmente correcto
  - **Descripción**: No es registro, es error de hecho. Cada punto está verificado contra el código.
  - **Acceptance criteria**:
    - [ ] `"Prepará la tesorería"` (`:581`) — voseo rioplatense en un producto es-MX
    - [ ] `"Facturas y gastos vencidos"` (`:450`) — `overdueItems` se construye **sólo** de
          `operatingExpenses` (`cash-flow-service.ts:330-339`): nunca contiene una factura
    - [ ] `"la concentración de pagos supera el promedio"` (`:636`) — el código usa **mediana × 1.5** (`:443`)
    - [ ] `"Sin riesgo de saldo negativo"` (`:404`) — garantía absoluta sobre una base estimada
    - [ ] `"{days.length}+ días"` (`:400`) — inventa conocimiento más allá del horizonte
    - [ ] `"emp"` (`:431`) — no es abreviatura de ningún hispanohablante
    - [ ] `"1 días"` (`:388`) — sin manejo de plural
    - [ ] `metrics.minBalance < 50000` (`:339`, `:353`) — son **$500 MXN**, no $50,000. La banda
          ámbar es inalcanzable para cualquier grupo real: la constante está 100× fuera
    - [ ] `Title Case` en `:735` contra sentence case en todos los demás títulos
    - [ ] "Tesorería", "ventana de proyección" (`:404`) revisados contra el registro del producto
    - [ ] Propuesta de H1 nuevo (ver pregunta abierta 3 del plan)
  - **Verificación**:
    - [ ] Lectura completa de las cadenas de ambos archivos contra `messages/es.json`
    - [ ] El umbral ámbar se dispara con datos reales
  - **Dependencias**: Task 16
  - **Archivos**: `components/finance/cash-flow-calendar.tsx`, `app/dashboard/finance/cash-flow/page.tsx`
  - **Alcance**: S

- [ ] **Task 18**: Accesibilidad
  - **Descripción**: El `AlertTriangle` de `:657` es el único marcador no cromático de una semana
    pesada y no tiene nombre accesible: "qué semanas son malas" es información sólo por color, igual
    que el tinte destructive de las tarjetas. Los dos botones de colapso (`:494-509`, `:544-559`) no
    tienen `aria-expanded`/`aria-controls`: se anuncia "Ver todos (12), botón" sin estado. El
    `Tooltip` de la gráfica pasa `""` como nombre de serie (`:757-760`), así que un valor no tiene
    etiqueta. Al 200% de zoom la `<Badge>` está anidada *dentro* del párrafo con `truncate`
    (`:466-472`), y `overflow:hidden` corta la píldora a la mitad — justo el marcador que dice OC vs
    Factura. La tira "Fuentes de egresos" (`:415`) es `flex` sin `flex-wrap` con badges `shrink-0`:
    en teléfono se sale por la derecha sin contenedor con scroll.
  - **Acceptance criteria**:
    - [ ] `aria-expanded` y `aria-controls` en ambos colapsos
    - [ ] Semana pesada con marcador textual además del color, e icono con nombre accesible
    - [ ] El tooltip de la gráfica nombra la serie
    - [ ] La badge sale del párrafo truncado y sobrevive al zoom 200%
    - [ ] "Fuentes de egresos" envuelve o hace scroll en 320px
  - **Verificación**:
    - [ ] Recorrido con lector de pantalla de los dos colapsos y la rejilla semanal
    - [ ] 320px y zoom 200% sin scroll horizontal de página
  - **Dependencias**: Task 16
  - **Archivos**: `components/finance/cash-flow-calendar.tsx`
  - **Alcance**: M

- [ ] **Task 19**: Limpieza
  - **Descripción**: Deuda menor verificada en el archivo.
  - **Acceptance criteria**:
    - [ ] `formatMXN` local (`:145`) → `formatCents` de `lib/utils.ts`, cuyo docstring existe
          precisamente para matar estas copias
    - [ ] `weeklyChartData` (`:270-274`) se elimina o se usa: hoy se calcula en cada render y no se
          referencia en ningún lado del repo, cargando un campo `Presión: "Alta"|"Normal"` que
          habría sido la alternativa textual que necesitan las tarjetas semanales (ver Task 18)
    - [ ] Llaves de React: `key={week.weekLabel}` (`:642`) y `key={d.fecha}` (`:787`) usan cadenas de
          presentación; pasan a identificadores estables
    - [ ] `min-w-0`/`shrink-0` en las cinco filas `justify-between` de moneda (`:173-180, :562-568,
          :686-694, :695-703, :704-715`) — el patrón correcto ya existe en el mismo archivo (`:460`, `:590`)
    - [ ] Gráfica: valores numéricos en vez de cadenas `.toFixed(2)`, `YAxis tickFormatter` (hoy los
          ticks dicen "1500000"), margen `left` que no los corte, y `interval`/scroll para 28 barras
          a 320px
    - [ ] `Math.max(widthPct, 2)` (`:184`) deja de hacer que 0% y 2% se vean igual
    - [ ] CSV: nombre con fecha y sucursal, y exporta también vencidos, categorías y semanas — hoy
          es `flujo-efectivo-30d.csv` fijo con sólo la serie diaria
  - **Verificación**:
    - [ ] `pnpm run build` y `pnpm run lint` limpios
    - [ ] `grep -rn "weeklyChartData\|formatMXN" components/finance/cash-flow-calendar.tsx` vacío
  - **Dependencias**: Task 18
  - **Archivos**: `components/finance/cash-flow-calendar.tsx`
  - **Alcance**: M

### Checkpoint: Completo
- [ ] `pnpm run build` y `pnpm run lint` limpios
- [ ] `pnpm exec playwright test tests/cash-flow.spec.ts` en verde
- [ ] Crítica repasada punto por punto; lo no atendido anotado con razón
- [ ] Listo para revisión
