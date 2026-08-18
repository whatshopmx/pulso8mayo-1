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

- [x] **Task 7**: Horizonte y estado de pantalla en la URL
  - **Descripción**: `days=30` está fijo en `page.tsx:28` y editar la URL no hace nada porque la
    página arma la suya. No hay control de horizonte, y los dos colapsos son `useState` local
    (`:194-195`) que se reinician en cada cambio de sucursal. Tampoco hay deep-link: no se puede
    mandar "mira la semana 3" al contador.
  - **Acceptance criteria**:
    - [x] Selector 7 / 30 / 60 días en el encabezado, con `aria-pressed`, que escribe en
          `searchParams` con `replace` (no `push`: cambiar de horizonte no debe llenar el
          historial del navegador). Un `days` inválido cae al default en vez de romperse
    - [x] `branchId`, `days` y los dos colapsos (`categorias`, `vencidos`) viven en la URL
    - [x] Pegar la URL reproduce la misma vista
    - [x] **Se eliminó la contradicción de raíz**: en vez de sólo rotular las tres ventanas,
          ahora hay una sola. El resumen y la gráfica usaban `.slice(0, 14)` mientras
          categorías, semanas y CSV usaban 30. Todo describe el horizonte seleccionado, y
          la gráfica, el resumen, el `aria-label`, el `caption` y el nombre del CSV lo dicen
    - [x] El CSV se llama `flujo-efectivo-{horizonte}d-{sucursal}-{fecha}.csv`; antes era
          `flujo-efectivo-30d.csv` fijo, así que dos descargas de sucursales distintas se
          pisaban y ninguna decía de cuál era
  - **Verificación** (manejan la pantalla real, no la API — es lo único que prueba que el
    estado sobrevive al remonte):
    - [x] Al cargar, la URL se espeja sola con `days=30`
    - [x] Cambiar a 7 días reproyecta y la gráfica **no** se queda en 14
    - [x] `?days=60` reproduce la vista con el botón correcto en `aria-pressed=true`
    - [x] `?days=999` cae a 30
    - [x] Expandir categorías escribe `categorias=todas` y sobrevive a un `reload()`
    - [x] `npx tsc --noEmit` limpio · eslint sin hallazgos nuevos · **32/32** en el spec
  - **Sincronía de la sucursal**: el selector del encabezado es un contexto global con
    cookie, no estado de URL. Se sincroniza en un solo sentido por vez para no ciclarse: al
    montar, una URL pegada manda sobre la cookie; a partir de ahí el selector escribe la URL.
    El fetch espera a esa hidratación para no pedir la proyección dos veces.
  - **Regresión encontrada y corregida**: el snapshot de un test fallido mostró
    `Saldo inicial proyectado $0.00`. La tarjeta leía `metrics?.firstBalance ?? 0`, y desde
    la Task 2 `metrics` es `null` cuando no hay cortes de venta. El saldo inicial no depende
    de las entradas: ahora se lee de `initialBalanceCents` directo. La habría escondido
    cualquier verificación que no manejara la pantalla real.
  - **Nota para la Task 19**: con horizonte de 60 días la gráfica dibuja 60 barras. La
    densidad (`interval`/scroll a 320px) ya está en el alcance de esa tarea.
  - **Dependencias**: Task 6
  - **Archivos**: `app/dashboard/finance/cash-flow/page.tsx`,
    `components/finance/cash-flow-calendar.tsx`, `tests/cash-flow.spec.ts`
  - **Alcance**: M

### Checkpoint: Alcance — ✅ cerrado
- [x] Cambiar de sucursal cambia las cifras (Condesa $64,861 · Polanco $60,138 · grupo $142,873)
- [x] `enforceBranchScope` fija a los roles de sucursal — verificado con sesión real de
      GERENTE, no sólo con la función pura
- [x] La píldora de alcance está siempre visible y rotula el alcance **aplicado**
- [x] `npx tsc --noEmit` limpio · eslint sin hallazgos nuevos · **32/32** en el spec

**Estado de la Fase 1**: el P0 de alcance está cerrado. Las cifras corresponden a la sucursal
que la pantalla dice, un rol de sucursal no puede pedir otra, y el estado de la pantalla
(horizonte, sucursal, colapsos) vive en la URL y se puede compartir.

**Lo que sigue siendo falso**: `INITIAL_BALANCE = 2000000` — $20,000 idénticos para un café de
3 sucursales y un grupo hotelero de 15. "Saldo mínimo", las bandas de color y "Te alcanza para
N días" heredan esa invención. Es el P0 de la Fase 2.

---

## Fase 2: Saldo inicial verdadero (P0)

- [x] **Task 8**: Tabla y migración de supuestos de flujo
  - **Descripción**: `INITIAL_BALANCE = 2000000` (`:81`) son $20,000 MXN idénticos para un café de 3
    sucursales y un grupo hotelero de 15, renderizados en `text-2xl font-bold` como "Saldo inicial
    proyectado" y sembrando `runningBalance` (`:343`). "Saldo mínimo", las bandas de color y "Te
    alcanza para N días" heredan todos esa invención. El esquema no tiene banco ni libro mayor: el
    dato tiene que capturarse.
  - **Acceptance criteria**:
    - [x] Tabla `cash_flow_assumptions` en `lib/db/schema/finance.ts` (módulo nuevo, como pide
          CLAUDE.md, en vez de la cola legacy de `schema.ts`)
    - [x] **Corrección a la unicidad planeada**: un `UNIQUE (company_id, branch_id)` a secas
          **no** garantiza una sola fila de grupo, porque Postgres trata los NULL como
          distintos entre sí — se podrían insertar dos supuestos de grupo para la misma
          compañía. Hacen falta dos índices: el compuesto para las sucursales y uno **parcial**
          `ON (company_id) WHERE branch_id IS NULL` para el grupo. Verificado insertando el
          duplicado y comprobando que la base lo rechaza
    - [x] Migración `0052_supuestos-flujo-efectivo` con nombre descriptivo
    - [x] `getCashFlowProjection` lee el supuesto de la sucursal, cae al del grupo, y sin
          ninguno devuelve `initialBalanceCents: null` con `openingBalance.source: 'NONE'`
    - [x] `INITIAL_BALANCE` desaparece; sólo queda su mención en el comentario que explica
          por qué se fue
  - **Verificación**:
    - [x] `npx drizzle-kit generate` → **"No schema changes, nothing to migrate"**
    - [x] `npx tsx scripts/check-migration-drift.ts` sin faltantes
    - [x] La tabla existe de verdad en la DB apuntada: columnas, tipos, nulabilidad y los
          cuatro índices leídos de `information_schema` / `pg_indexes`
    - [x] Sin registro → `null`, y **ningún día afirma un saldo acumulado**
    - [x] Sucursal > grupo; una sucursal sin supuesto propio hereda el del grupo, no el de su
          vecina; cambiar el saldo capturado desplaza toda la trayectoria exactamente esa
          diferencia
    - [x] Un saldo de hace 9 días se usa pero se marca `isStale`; uno de hace 3 no molesta
    - [x] `npx tsc --noEmit` limpio · **36/36** en el spec
  - **Fricción real: migración a mano vs. cadena de snapshots de drizzle.** Escribí primero el
    SQL a mano como pedía el plan, lo apliqué y funcionó. Pero `drizzle-kit generate` volvió a
    emitir la tabla completa: drizzle genera contra su propia cadena de snapshots, no contra la
    base, y una migración escrita a mano no deja snapshot. El resultado habría sido que **cada
    `db:generate` futuro reemitiera la tabla** — exactamente la clase de deriva que ya mordió
    en este repo. Se reconcilió: tabla eliminada (estaba vacía), registro de migración borrado,
    migración a mano descartada y en su lugar la generada por drizzle, renombrada
    descriptivamente y renumerada a 0052 para no dejar hueco en la secuencia. El snapshot
    encadena con el de 0051 (`prevId` verificado). Nunca se usó `db:push`.
  - **Dependencias**: Task 6
  - **Archivos**: `lib/db/schema/finance.ts`, `lib/db/schema/index.ts`,
    `drizzle/0052_supuestos-flujo-efectivo.sql`, `drizzle/meta/`,
    `lib/services/cash-flow-service.ts`, `components/finance/cash-flow-calendar.tsx`,
    `components/finance/cash-flow-summary-card.tsx`, `tests/cash-flow.spec.ts`,
    `tests/support/db.ts`
  - **Alcance**: M

- [x] **Task 9**: Captura en línea, línea de supuestos y "cómo se calcula"
  - **Descripción**: Cuatro supuestos que cargan toda la pantalla (saldo inicial, fecha de OC
    estimada a +14 días, quincena asumida el 15 y el 30, entradas históricas planas) se presentan
    como hechos, sin tooltip y sin "cómo se calcula". Con Task 8 el saldo ya es capturable; falta la
    superficie para capturarlo y la honestidad sobre el resto.
  - **Acceptance criteria**:
    - [x] La tarjeta permite editar el monto en línea y persiste. RBAC: SUPER_ADMIN, ADMIN y
          GERENTE (se añadió SUPER_ADMIN al par del plan — sin él, quien administra el sistema
          no podría capturar). El control se dibuja según el rol de sesión, pero **quien manda
          es `withRoleAuth` en la ruta**: la UI sólo decide qué se pinta
    - [x] Sin saldo capturado la tarjeta pide el dato y no se proyecta: `cumulativeBalanceCents`
          viaja en `null` y las tres tarjetas hero dicen qué falta. Además distingue **cuál**
          de los dos insumos falta — "captura tu saldo" y "captura tus ventas" son acciones
          distintas y mandarlas a la acción equivocada es peor que no decir nada
    - [x] Antigüedad siempre visible ("Capturado hoy" / "hace N días"); a más de 7 días se pide
          actualizarlo. También se declara cuando la sucursal está usando el dato del grupo
          por no tener el suyo
    - [x] Línea de supuestos con las cuatro estimaciones, cada una con popover "cómo se
          calcula". Los textos son **dinámicos**: el de entradas dice si la base es estacional,
          promedio simple o inexistente, con los días de historial reales
    - [x] El conteo de facturas sin sucursal ya viaja junto a la píldora de alcance (Task 6)
  - **Verificación**:
    - [x] Capturar $38,500 desde la pantalla → la cifra aparece **sin recargar** (la proyección
          se revalida sola) y "Sin capturar" desaparece
    - [x] Capturar dos veces actualiza, no duplica: una segunda fila de grupo haría ambigua la
          lectura del saldo
    - [x] Un **EMPLEADO** recibe 403 con el envelope `{ success:false, error }`, no un 500
    - [x] Un **GERENTE** que pide capturar para otra sucursal captura en la suya
          (`enforceBranchScope`, la misma regla que la lectura)
    - [x] Fecha futura rechazada · saldo negativo aceptado (una cuenta sobregirada es un saldo
          real, y redondearla a cero sería otra invención)
    - [x] La línea de supuestos nombra las cuatro y el popover de Quincena explica el 15/30
    - [x] `npx tsc --noEmit` y `npx eslint` limpios · **43/43** en el spec
  - **Nota de implementación**: el guardado no usa `onConflictDoUpdate`. Los dos índices únicos
    de la tabla no se pueden apuntar a la vez, y el parcial (el de la fila de grupo) ni siquiera
    es objetivo válido de `ON CONFLICT` sin repetir su predicado. Se lee primero y se decide
    insert o update; la lectura es puntual porque hay a lo más una fila por (compañía, sucursal).
  - **Dependencias**: Task 8
  - **Archivos**: `components/finance/opening-balance-card.tsx` (nuevo),
    `components/finance/cash-flow-calendar.tsx`, `app/api/finance/cash-flow/assumptions/route.ts`,
    `app/dashboard/finance/cash-flow/page.tsx`, `lib/services/cash-flow-service.ts`,
    `tests/cash-flow.spec.ts`, `tests/support/constants.ts`
  - **Alcance**: M

### Checkpoint: Saldo inicial — ✅ cerrado
- [x] Ningún número depende de una constante. `INITIAL_BALANCE` sólo sobrevive en el comentario
      que explica por qué se fue
- [x] Sin saldo, la pantalla pide el dato en vez de inventar — y dice cuál de los dos insumos
      (saldo o cortes de venta) es el que falta
- [x] Los cuatro supuestos declarados, con "cómo se calcula" y texto dinámico según los datos
- [x] `npx drizzle-kit generate` → "No schema changes, nothing to migrate"
- [x] **43/43** en el spec · `tsc` y `eslint` limpios

**Estado de la Fase 2**: cerrada. Los dos P0 de la crítica están resueltos. La pantalla ya no
afirma nada que no pueda sostener: el saldo lo puso una persona con fecha visible, las entradas
salen del historial o se declaran ausentes, las cifras corresponden a la sucursal rotulada, y
las cuatro estimaciones que cargan la proyección se nombran y se explican.

**Lo que sigue**: la Fase 3 (accionabilidad) es donde la pantalla deja de ser sólo un informe —
4 elementos interactivos y 0 que naveguen. Después el color (P1) y el copy (P2).

---

## Fase 3: Accionabilidad (P1)

- [x] **Task 10**: Higiene de datos del render
  - **Descripción**: `supplierName` está en el payload (`:54`) y nunca se renderiza; `isPayroll`
    (`:51`) nunca se usa. Las filas de vencidos son texto truncado sin proveedor y sin sucursal:
    identificar "Renta" exige recordar. Peor: `:302` devuelve "Sin datos de proyección disponibles"
    **antes** de que la tarjeta de vencidos se renderice en `:442`, así que un inquilino con
    facturas vencidas y sin días de proyección no ve ninguna. Y el fallback de arreglo legacy
    (`:198-208`) vacía cuatro de seis secciones sin decir nada — un estado degradado indistinguible
    de uno sano.
  - **Acceptance criteria**:
    - [x] `supplierName` se renderiza en vencidos y próximos 7 días. **Hallazgo**: los vencidos
          se construyen sólo de `operatingExpenses`, que **no tienen proveedor** — tienen
          *contraparte* (`payees.payeeId`). El campo nunca se habría llenado. Se añade el
          `leftJoin` a `payees` y su nombre viaja en `supplierName`: es lo que de verdad
          distingue una "Renta" de otra entre seis filas truncadas
    - [x] La sucursal viaja en cada partida (`branchId` + `branchName`) y se rotula sólo en
          alcance de grupo — repetirla cuando la píldora del encabezado ya la dice es ruido en
          filas que se truncan
    - [x] La tarjeta de vencidos se extrae a `tarjetaVencidos` y se renderiza en los **dos**
          caminos, incluido el de "sin proyección"
    - [x] El fallback de arreglo legacy se **elimina**: vaciaba cuatro de seis secciones sin
          decir nada, un estado degradado indistinguible de uno sano. El componente ahora
          exige `CashFlowProjection` y la página guarda `CashFlowProjection | null`
    - [x] Las dos ramas vacías usan `EmptyState` (la del componente y la nueva de la página)
  - **Verificación**:
    - [x] `branchId`/`branchName` presentes en las partidas y en los vencidos
    - [x] La línea de detalle se arma con `ItemMeta` y usa el verbo correcto ("Venció" en
          vencidos, "Vence" en próximos)
    - [x] En alcance de sucursal la sucursal **no** se repite en cada fila
    - [x] `npx tsc --noEmit` limpio · **46/46** en el spec
  - **Hallazgo que cambia el alcance de un criterio**: "la sucursal es visible cuando el alcance
    es grupo completo" **no es verificable desde la pantalla**, porque el alcance de grupo no es
    alcanzable: `BranchProvider.setBranches` (`lib/branch-context.tsx:56`) auto-selecciona la
    primera sucursal cuando no hay ninguna, y el selector del encabezado no ofrece "todas". El
    servicio y el payload sí lo soportan (y la API sin `branchId` devuelve el grupo), así que
    el comportamiento está implementado y probado por API. Que el encabezado ofrezca "Grupo
    completo" es una decisión de producto fuera de esta pantalla — **queda anotado como
    seguimiento**.
  - **Copy adelantado de la Task 17**: el título decía "Facturas y gastos vencidos" y
    `overdueItems` **nunca** contiene una factura. Como reescribí el bloque completo, quedó
    "Gastos vencidos" en vez de dejar un error de hecho a sabiendas.
  - **Limpieza de lint**: se eliminó `isProjection` (uno de los dos `no-explicit-any`
    preexistentes) y los residuos `Wallet`/`saldoDesactualizado` que dejó la Task 9 al mover la
    tarjeta de saldo a su propio componente.
  - **Dependencias**: Task 6
  - **Archivos**: `components/finance/cash-flow-calendar.tsx`,
    `app/dashboard/finance/cash-flow/page.tsx`, `lib/services/cash-flow-service.ts`,
    `tests/cash-flow.spec.ts`
  - **Alcance**: S

- [x] **Task 11**: Cada hallazgo enlaza a su registro origen
  - **Descripción**: Inventario del crítico: **4 elementos interactivos, 0 que naveguen.** Las filas
    (`:457-491`, `:587-613`) son `<div>` planos. La dueña se entera de que tiene 6 facturas vencidas
    y después tiene que salir, abrir `/dashboard/finance/expenses` y buscar por descripción truncada.
    Destinos: `OPERATING_EXPENSE` → `/dashboard/finance/expenses`, `PROCUREMENT_INVOICE` →
    `/dashboard/finance/fiscal`, `PURCHASE_ORDER` → `/dashboard/inventory/purchase-orders`.
    Ninguna de las tres listas acepta hoy un parámetro de foco.
  - **Acceptance criteria**:
    - [x] Cada fila de vencidos y de próximos 7 días es un `Link` al registro origen según su
          `source`, vía el sub-componente `ItemRow`
    - [x] Las páginas destino aceptan `?focus=<id>`, resaltan la fila y se desplazan a ella
    - [x] Enlace al pie hacia Cuentas por Pagar
    - [x] Foco de teclado (`focus-visible:ring`) y hover visibles en la fila completa, no en
          un fragmento de texto
  - **Corrección al plan — el destino de las facturas**: el plan mandaba `PROCUREMENT_INVOICE`
    a `/dashboard/finance/fiscal`. Esa pantalla es un **validador de CFDI**, no una lista: no
    tiene fila que enfocar. Las facturas pendientes se listan en `/dashboard/finance/payables`
    (con `source` e `id` por fila), que es el destino real. `fiscal` no se tocó.
  - **Decisión: la nómina no enlaza.** Se sintetiza en el servicio (`payroll-<fecha>`) y no
    existe como registro. Ofrecer un enlace que lleva a una lista donde no está sería peor que
    no ofrecerlo; `hrefParaPartida` devuelve `null` y la fila se renderiza como `div`.
  - **Hook compartido en vez de tres copias**: `hooks/use-focused-row.ts`. Tercer caso de uso,
    comportamiento idéntico — es donde una abstracción se gana su costo.
  - **Verificación**:
    - [x] La fila expone `href=/dashboard/finance/expenses?focus=<id>` con el id real
    - [x] El clic aterriza en el gasto correcto y la fila destino queda con `aria-current`,
          no sólo con color: el resaltado cromático no se anuncia en un lector de pantalla
    - [x] La fila es enfocable por teclado
    - [x] La nómina no expone enlace
    - [x] `npx tsc --noEmit` limpio · eslint sin hallazgos nuevos · **51/51** en el spec
  - **Nota de implementación (lint que enseñó algo)**: el hook leía `?focus` de
    `window.location.search` en un `useEffect` para evitar el requisito de `Suspense` de
    `useSearchParams`. `react-hooks/set-state-in-effect` lo marcó con razón: provoca render en
    cascada, y además habría causado desajuste de hidratación (el servidor renderiza sin
    resaltado, el cliente con él). Se usa `useSearchParams` y se añadió el límite de `Suspense`
    a `expenses` y `payables`, siguiendo el patrón que `purchase-orders` ya tenía.
  - **Dependencias**: Task 10
  - **Archivos**: `components/finance/cash-flow-calendar.tsx`, `hooks/use-focused-row.ts` (nuevo),
    `app/dashboard/finance/expenses/page.tsx`, `app/dashboard/finance/payables/page.tsx`,
    `app/dashboard/inventory/purchase-orders/page.tsx`, `tests/cash-flow.spec.ts`
  - **Alcance**: M

- [x] **Task 12**: Endpoints de pago y reprogramación de gastos
  - **Descripción**: `expense-service.ts` tiene `create`, `approve`, `reject` y `get`, pero no
    `markPaid` ni `reschedule`. El enum `operating_expense_status` ya incluye `PAID`. Los endpoints
    van en el dominio de gastos, no en cash-flow: esta pantalla es un consumidor más.
  - **Acceptance criteria**:
    - [x] `markPaidOperatingExpense` y `rescheduleOperatingExpense` en `expense-service.ts`
    - [x] Rutas con `withRoleAuth` (SUPER_ADMIN, ADMIN, GERENTE); `tenantId` y el actor salen
          de la sesión, nunca del body
    - [x] Bitácora con el mismo patrón que `approve`/`reject`: nota en `approvalNotes`
          ("Pagado por X", "Reprogramado de A a B por X"). **No se toca `approvedBy`** —
          sobrescribirlo borraría quién autorizó el gasto, que es justo lo que la bitácora
          existe para conservar
    - [x] Reprogramar rechaza fechas anteriores a hoy: mover un vencimiento al pasado no
          reprograma nada, sólo maquilla un vencido para que deje de aparecer como tal
    - [x] Pagar dos veces es **idempotente** y no reescribe la fecha de pago original (dos
          clics o dos personas a la vez no son un error del usuario). Lleva además un cerrojo
          optimista en el `WHERE` para el caso de carrera entre la lectura y la escritura
  - **Decisión no planeada: sólo se paga lo aprobado.** Marcar pagado un gasto en
    `PENDING_APPROVAL` saltaría la cadena de autorización por la puerta de atrás. El servicio
    lo rechaza con mensaje explícito.
  - **Sobre la auditoría**: se evaluó `logDataAccess` (`data_access_logs`) vía
    `requirePermissionApi`, pero el vocabulario ABAC (`lib/permissions.ts`) no tiene recurso
    `expenses` — el más cercano es `reports`, y escribir un gasto no es leer un reporte. El
    plan pedía "el mismo patrón que approve/reject", y ese patrón es actor + nota en la fila.
  - **Verificación**:
    - [x] Pago cambia `status` a PAID, escribe `paidAt` y deja la nota con el actor
    - [x] Segundo pago devuelve la misma `paidAt`
    - [x] Gasto sin aprobar → rechazado · fecha al pasado → rechazada · gasto pagado no se
          reprograma
    - [x] **EMPLEADO recibe 403** en ambas rutas, con el envelope `{ success:false, error }`
    - [x] `npx tsc --noEmit` limpio · **59/59** en el spec
  - **Hallazgo que el test dejó fijado**: la consulta de gastos **proyectados** no filtra por
    estado (a diferencia de la de vencidos, que sí excluye `PAID`), así que un gasto pagado
    sigue contando en "Total egresos" del período. El test lo afirma tal cual — se nombró
    primero "el gasto sale de la ventana" y hubo que corregir el nombre y la aserción a lo que
    de verdad ocurre. **Si el comportamiento correcto es excluirlos, ese test falla, que es
    exactamente lo que debe hacer.** Queda como pregunta abierta.
  - **Dependencias**: Ninguna
  - **Archivos**: `lib/services/expense-service.ts`, `app/api/expenses/[id]/pay/route.ts`,
    `app/api/expenses/[id]/reschedule/route.ts`, `tests/cash-flow.spec.ts`
  - **Alcance**: M

- [x] **Task 13**: Acciones en línea con RBAC
  - **Descripción**: Conectar Task 12 a las filas. Además, decir en voz alta qué hace y qué no esta
    pantalla — `payables/page.tsx:183-191` ya establece ese patrón y esta no lo tiene. Aquí el aviso
    cambia de sentido: sí escribe, pero no concilia contra el banco.
  - **Acceptance criteria**:
    - [x] "Pagado" y "Reprogramar" en filas de vencidos y próximos 7 días, sólo para
          SUPER_ADMIN/ADMIN/GERENTE. "Pagado" aparece **sólo si el gasto está APPROVED**, que es
          lo que el servicio admite: un botón que va a fallar es peor que ningún botón
    - [x] Sólo en gastos operativos: las OC y las facturas de procurement no tienen estos
          endpoints
    - [x] Tras la acción se revalida la proyección sin recargar (`onActionDone` → `fetchProjection`)
    - [x] Aviso explícito, que **cambia de sentido** respecto al de `payables`: esa pantalla
          avisa que es de sólo consulta; esta avisa que sí escribe pero **no concilia contra el
          banco**. "Marcar pagado registra el gasto, no el movimiento bancario."
    - [x] Carga y error **por fila**: un error global no diría cuál de las seis filas falló
  - **Restructuración que exigió el HTML**: las filas eran un `Link` completo (Task 11). Meter
    botones dentro habría anidado `<button>` en `<a>` — inválido, y el lector de pantalla
    anuncia un solo control donde hay tres. `ItemRow` ahora enlaza sólo la zona descriptiva y
    recibe `trailing` (monto) y `actions` como hermanos. Hay un test que lo fija:
    `a button` debe dar 0.
  - **Verificación**:
    - [x] Marcar pagado desde la fila hace desaparecer el botón sin recargar (el gasto deja de
          estar APPROVED) — la proyección se revalidó sola
    - [x] El aviso de "no concilia" está visible para quien puede accionar
    - [x] **EMPLEADO**: sesión real de navegador, entra a la pantalla (es lectura financiera)
          pero no ve botones ni el aviso de escritura
    - [x] Cero `<button>` dentro de `<a>`
    - [x] `npx tsc --noEmit` limpio · eslint sin hallazgos nuevos · **63/63** en el spec
  - **Bug latente propio, encontrado por la suite completa**: el test de antigüedad del saldo
    (Task 8) sembraba con `CURRENT_DATE - N` de Postgres —fecha del servidor, UTC— mientras el
    servicio mide contra la fecha local de la operación. Entre las 18:00 y la medianoche de
    CDMX las dos difieren y la edad salía un día menos. Pasó en su momento por la hora a la que
    se corrió. Ahora la fecha se calcula en la zona de la operación, igual que el servicio.
    Es la misma clase de defecto que la Task 4 arregló en el código de producción.
  - **Dependencias**: Tasks 11, 12
  - **Archivos**: `components/finance/expense-row-actions.tsx` (nuevo),
    `components/finance/cash-flow-calendar.tsx`, `app/dashboard/finance/cash-flow/page.tsx`,
    `tests/cash-flow.spec.ts`, `tests/support/db.ts`
  - **Alcance**: M

### Checkpoint: Accionabilidad — ✅ cerrado
- [x] Toda fila de vencidos y próximos 7 días navega a su registro origen (menos la nómina,
      que no existe como registro)
- [x] La contraparte (`payees`) es visible donde existe — el `supplierName` del plan nunca se
      habría llenado en vencidos, que son sólo gastos operativos
- [x] Vencidos visibles aunque no haya proyección
- [x] Marcar pagado cambia el estado, es idempotente y queda en la bitácora con el actor
- [x] `npx tsc --noEmit` limpio · eslint sin hallazgos nuevos · **63/63** en el spec

**Estado de la Fase 3**: cerrada. La pantalla dejó de ser un informe: cada hallazgo lleva a su
registro y las dos acciones que importan se ejecutan desde la fila, con RBAC en la ruta y el
aviso de que registra el gasto pero no concilia el banco.

**Pendiente de decisión (ver Task 12)**: un gasto ya pagado sigue contando en "Total egresos"
del período, porque la consulta de proyectados no filtra por estado. Hay un test que fija el
comportamiento actual; si debe excluirlos, ese test falla y avisa.

**Lo que queda**: color y contraste (P1, dos fallas AA verificadas) y copy (P2, con errores de
hecho: voseo rioplatense, "$50,000" que son $500, "promedio" donde el código usa mediana).

---

## Fase 4: Color, contraste y jerarquía (P1)

- [x] **Task 14**: Contraste (dos fallas AA verificadas)
  - **Descripción**: `text-warning` en `:354` es `oklch(0.72 0.15 80)` = **2.52:1** sobre blanco y
    **2.42:1** sobre el `bg-warning/5` real donde vive — falla incluso el piso de 3:1 para texto
    grande, en `text-2xl font-bold`. `text-success` sobre blanco es 3.68:1: pasa en `:399` (texto
    grande) pero **falla 4.5:1 en `:691` y `:710`**, que son `text-xs`. El repo ya resolvió esto:
    `globals.css:90-94` define `--warning-text` (6.61:1) y nueve archivos lo usan, incluida la
    tarjeta hermana `cash-flow-summary-card.tsx:166`. Este archivo se quedó atrás. Además, en modo
    oscuro `--info` (`:147`) y `--chart-4` (`:153`) son idénticos byte a byte: las badges "OC" y
    "Factura" se pintan del mismo color y sólo las distingue la etiqueta.
  - **Acceptance criteria**:
    - [x] `text-warning` → `text-warning-text` (2.52:1 → 6.61:1). Cero `text-warning` sueltos
    - [x] Los dos `text-success` dentro de `text-xs` pasan a `text-success-text`, **token nuevo**
          creado a imagen de `--warning-text`: `oklch(0.48 0.14 150)` = 6.08:1 claro,
          `oklch(0.78 0.13 150)` = 9.12:1 oscuro
    - [x] `--chart-4` deja de colisionar con `--info`: se mueve a h=200 (45° de separación) en
          **ambos** modos. En claro eran 240 vs 245 con croma casi igual — indistinguibles
          también, aunque la crítica sólo midió el oscuro
    - [x] Los `text-success` que quedan cumplen: uno es `text-2xl` (3.68:1 ≥ 3:1 de texto
          grande) y otro es un icono (piso 3:1 de contraste no textual)
  - **Hallazgo propio, no estaba en la crítica**: en modo oscuro `--info` daba **4.09:1** sobre
    `--card` — la badge "OC" no sólo era indistinguible de "Factura", además fallaba AA. Subido
    a `oklch(0.62 0.11 245)` = 4.82:1. El mismo cálculo destapó que `--chart-4` oscuro fallaba
    igual (4.09:1); ahora 4.98:1.
  - **Verificación** (calculada, no a ojo):
    - [x] Se escribió un conversor OKLCH→sRGB→luminancia WCAG y se reprodujeron **exactamente**
          los números de la crítica (2.52 / 6.61 / 3.68), lo que valida el método antes de
          usarlo para elegir los tokens nuevos
    - [x] **El cálculo quedó como test permanente** (`tests/support/contrast.ts`), leyendo los
          valores del `globals.css` real: si alguien aclara `--warning-text` "porque se ve
          mejor", el spec falla con el número exacto en vez de esperar a que alguien con poca
          visión no pueda leer un monto
    - [x] `npx tsc --noEmit` limpio · **68/68** en el spec
  - **Decisión de alcance**: `text-success` aparece **55 veces en el repo**. Se arreglaron las de
    esta pantalla. Barrer las otras 50 excede una tarea sobre un archivo; el token queda
    disponible para que se adopte como se adoptó `--warning-text` (nueve archivos). **Anotado
    como seguimiento.**
  - **Dependencias**: Ninguna
  - **Archivos**: `app/globals.css`, `components/finance/cash-flow-calendar.tsx`,
    `tests/support/contrast.ts` (nuevo), `tests/cash-flow.spec.ts`
  - **Alcance**: S

- [x] **Task 15**: Presupuesto de rojo y jerarquía de severidad
  - **Descripción**: En un mes malo están rojos a la vez: las tarjetas hero 2 y 3 completas, la badge
    de nómina (`:430`), toda la tarjeta de vencidos con cada monto y cada badge, la barra `NOMINA` en
    `--destructive`, la de `RENTA` en `--chart-1` (hue 25, prácticamente Rojo Operativo), hasta 5
    tarjetas semanales, las cifras de Salidas y Flujo neto, y las 14 barras "Salidas" en `--chart-5`
    (un carmesí). Más cuatro iconos `text-primary`. DESIGN.md lo topa en 10–15%. Y no sabe rangear:
    `daysUntilNegative` truthy pinta la tarjeta de destructive lo mismo si la fecha es en 2 días que
    en 29 (`:385-395`), así que "apenas bien" y "en problemas el jueves" se ven idénticos.
  - **Acceptance criteria**:
    - [x] La tarjeta de vencidos es el dueño del rojo. La tarjeta 3 lo toma prestado **sólo**
          cuando el saldo cruza a negativo dentro de 7 días
    - [x] Semanas pesadas → tinte ámbar + la palabra literal **"Semana pesada"**, que además
          resuelve que "qué semanas son malas" viajara sólo por color
    - [x] Barras "Salidas" → `var(--chart-4)`; ninguna categoría queda en la familia del rojo
    - [x] Cifras del resumen → foreground con signo negativo: el signo hace el trabajo que
          hacía el color. Que salga dinero no es una anomalía
    - [x] Tarjeta 3 rangea: roja ≤7 días, ámbar ≤14, neutra más allá (`SEVERIDAD_TARJETA` /
          `SEVERIDAD_TEXTO`). Antes `daysUntilNegative` truthy pintaba igual "en 2 días" que
          "en 29", así que "apenas bien" y "en problemas el jueves" se veían idénticos
    - [x] La tarjeta 2 (saldo mínimo) deja de teñirse: teñirla a la vez que la 3 por el mismo
          hecho —el saldo cruza a negativo— gastaba el rojo dos veces
    - [x] La badge de nómina sale del rojo: es el gasto más previsible del mes, estaba en rojo
          por ser grande, no por ser un problema
  - **Causa raíz, y por qué hubo que tocar el sistema de diseño**: `--chart-1` es h=25,
    `--chart-5` es h=0 y `--destructive` es h=22 — **tres de los cinco tokens de gráfica viven
    en la familia del rojo**. Una pantalla que debe reservar el rojo se quedaba literalmente
    sin paleta. Se añadieron `--chart-6` (violeta, h=300) y `--chart-7` (verde, h=145) sin
    tocar los existentes, que otras pantallas ya usan.
  - **Verificación**:
    - [x] Test que mide el **hue real** de cada color de categoría contra el de `--destructive`
          y exige >30° de separación — no una lista de nombres prohibidos, que se quedaría
          vieja al primer token nuevo
    - [x] La barra "Salidas" usa `chart-4` (aserción sobre el JSX)
    - [x] El tinte de semana pesada contiene `warning` y no `destructive`
    - [x] Conteo de elementos en rojo en la pantalla real, con umbral holgado: protege contra
          la regresión (volver a teñir semanas, barras o categorías), no fija píxeles
    - [x] `npx tsc --noEmit` limpio · eslint sin hallazgos nuevos · **72/72** en el spec
  - **No verificado como pedía el plan**: "captura del peor caso y estimación del área roja" no
    se hizo — estimar un porcentaje de área desde una captura no es reproducible ni se sostiene
    en CI. El conteo de elementos con tinte de alarma cumple la misma función y sí falla si
    alguien reintroduce el rojo.
  - **Dependencias**: Task 14
  - **Archivos**: `components/finance/cash-flow-calendar.tsx`, `app/globals.css`,
    `tests/cash-flow.spec.ts`
  - **Alcance**: M

- [x] **Task 16**: Jerarquía visual y agrupación
  - **Descripción**: Cinco de ocho ítems de carga cognitiva fallan. Cuatro valores `text-2xl` con el
    mismo peso (`:328, :350, :387, :399`) y ~85% del texto de datos en `text-xs` — `text-sm` aparece
    dos veces en 800 líneas. Seis bloques de primer nivel. Cuatro bloques hero apilados es
    exactamente el patrón que DESIGN.md prohíbe como layout por defecto. Nada tiene `tabular-nums`
    mientras las dos pantallas hermanas de finanzas sí (`payables/page.tsx:152,164,173`), así que los
    cuatro montos semanales que la dueña quiere comparar no alinean. `CardDescription` se pisa a
    `text-xs` cuatro veces contra su default `text-sm`, y `CardContent` es `p-4` en cinco tarjetas y
    `p-6` en el resto — dos paddings internos contra los 24px de DESIGN.md.
  - **Acceptance criteria**:
    - [x] Una sola respuesta primaria: "Te alcanza para" va **primera** y es la única en
          `text-4xl`. Las otras dos tarjetas bajan a `text-xl` — son el contexto que sostiene
          esa cifra (de cuánto parto, hasta dónde baja). Cero `text-2xl` en la pantalla
    - [x] `tabular-nums` en toda cifra monetaria visible
    - [x] Cifras de datos a `text-sm`; etiquetas y meta se quedan en `text-xs`
    - [x] Cuatro bloques de primer nivel, en `<section aria-label>`: "¿Me alcanza?",
          "Gastos vencidos", "¿En qué gasto?", "¿Cómo se ve el mes?". Eran **once** (habían
          crecido de los seis que contó la crítica con las tareas anteriores)
    - [x] `CardContent` uniforme en `p-6` (los 24px de DESIGN.md) y cero `CardDescription`
          pisado — el primitivo ya trae `text-sm`
  - **Decisión del usuario (pregunta abierta 4 del plan)**: sube **sólo las cifras** a
    `text-sm`; las etiquetas se quedan en `text-xs`. Conserva la densidad de la pantalla, que
    es lo que se quería proteger. Eran 39 `text-xs` contra 2 `text-sm`.
  - **Beneficio no planeado**: las `<section>` con `aria-label` no sólo agrupan visualmente —
    le dan al lector de pantalla una tabla de contenido navegable que antes no existía.
  - **Verificación**:
    - [x] `text-4xl` aparece exactamente 3 veces (los tres estados de la tarjeta primaria) y
          `text-2xl` cero. **Midiendo el código sin comentarios**: el archivo explica en prosa
          por qué se abandonó `text-2xl`, y contar esas menciones daba falso positivo
    - [x] Las cuatro secciones existen, y no hay una quinta
    - [x] Recorrido del DOM real: **toda** hoja cuyo texto es un monto usa `tabular-nums`
    - [x] `npx tsc --noEmit` limpio · eslint sin hallazgos nuevos · **76/76** en el spec
  - **Aprendizaje de un fallo del test**: el recorrido de montos encontró un `$0.00` sin
    `tabular-nums` en la **tabla alternativa del gráfico** (`sr-only`). La aserción estaba de
    más: esa tabla la lee un lector de pantalla, donde la alineación visual no significa nada.
    Se le puso `data-sr-table` y se excluye explícitamente, en vez de añadirle un estilo que
    nadie ve.
  - **No verificado**: "en iPad y en móvil se lee a la distancia del brazo" es una prueba
    física que no puedo hacer. La decisión de densidad la tomó el usuario con las opciones a
    la vista.
  - **Dependencias**: Task 15
  - **Archivos**: `components/finance/cash-flow-calendar.tsx`,
    `components/finance/opening-balance-card.tsx`, `tests/cash-flow.spec.ts`
  - **Alcance**: M

### Checkpoint: Visual — ✅ cerrado
- [x] Cero `text-warning` como texto y cero `text-success` en `text-xs`
- [x] El rojo se concentra en los vencidos y en el saldo a ≤7 días; ninguna categoría, barra
      ni semana lo usa
- [x] OC y Factura se distinguen en oscuro — y además ambas pasan AA, que no era el caso
- [x] Una sola respuesta primaria; cuatro bloques; `tabular-nums` en toda cifra
- [x] `npx tsc --noEmit` limpio · eslint sin hallazgos nuevos · **76/76** en el spec

**Estado de la Fase 4**: cerrada. Los contrastes están **calculados y fijados por test**, no
elegidos a ojo; el rojo volvió a significar algo; y la pantalla contesta una pregunta en vez de
enumerar once bloques.

**Decisiones del usuario tomadas en esta fase**: densidad → sólo las cifras suben a `text-sm`;
H1 → **"Flujo de efectivo"** (se aplica en la Task 17).

---

## Fase 5: Copy, accesibilidad y limpieza (P2)

- [x] **Task 17**: Copy factualmente correcto
  - **Descripción**: No es registro, es error de hecho. Cada punto está verificado contra el código.
  - **Acceptance criteria**:
    - [x] `"Prepará la tesorería"` → "Compromisos que vencen en los próximos 7 días"
    - [x] `"Facturas y gastos vencidos"` → "Gastos vencidos" (adelantado en la Task 10, al
          reescribir el bloque). También se corrigió el subtítulo del H1, que decía "¿Qué
          facturas están vencidas?"
    - [x] `"supera el promedio"` → "superan en 50% a la semana típica del período", que es lo
          que hace el código (mediana × 1.5)
    - [x] `"Sin riesgo de saldo negativo"` → "El saldo no cruza a negativo en los N días
          proyectados": describe lo proyectado en vez de garantizar el futuro
    - [x] `"{days.length}+ días"` → "Todo el período". El `+` afirmaba algo sobre el día 31 sin
          haberlo proyectado
    - [x] `"emp"` → "empleado/empleados"
    - [x] Plurales: `día/días`, `compromiso/compromisos`, `empleado/empleados`,
          `factura/facturas`
    - [x] **`metrics.minBalance < 50000` eran $500, no $50,000** — confirmado leyendo el
          servicio (`amountCents`). Pasa a `COLCHON_MINIMO_CENTS = 50_000_00`, con la unidad
          en el nombre para que no vuelva a pasar. La banda ámbar era inalcanzable: un saldo
          mínimo de $3,000 se pintaba tan tranquilo como uno de $300,000
    - [x] Title Case → sentence case: "Entradas vs. salidas de los próximos N días"
    - [x] H1 → **"Flujo de efectivo"** (elección del usuario sobre la pregunta abierta 3).
          "Panel de Alerta Temprana de Tesorería" aterrizaba en la anti-referencia que prohíbe
          PRODUCT.md, cuatro líneas arriba del comentario que rechaza "runway"
  - **Verificación**:
    - [x] `messages/es.json` **no contiene copy de esta pantalla** — está inline, así que la
          revisión se hizo contra el código y el registro de las pantallas hermanas
    - [x] El umbral ámbar se dispara con una cifra alcanzable (test sobre la constante)
    - [x] Barrido del texto **renderizado** (no del fuente): cero "prepará", cero "supera el
          promedio", cero "facturas y gastos vencidos", cero "N emp", cero "sin riesgo de
          saldo negativo"
    - [x] `npx tsc --noEmit` limpio · **81/81** en el spec
  - **Mismo falso positivo que en la Task 16, otra vez**: la aserción del H1 falló porque el
    **comentario** cita la cadena vieja para explicar por qué se fue. Los tests que miden el
    fuente tienen que quitar comentarios primero; los que miden el DOM renderizado no tienen
    ese problema — por eso el barrido de copy se hace sobre la página, no sobre el archivo.
  - **Fuera de alcance, anotado**: `cash-flow-summary-card.tsx` (la tarjeta hermana de la
    portada) sigue diciendo "Tesorería" y "Proyectando tesorería...". Es otra pantalla; si el
    registro cambia, cambia allá también.
  - **Dependencias**: Task 16
  - **Archivos**: `components/finance/cash-flow-calendar.tsx`,
    `app/dashboard/finance/cash-flow/page.tsx`, `tests/cash-flow.spec.ts`
  - **Alcance**: S

- [x] **Task 18**: Accesibilidad
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
    - [x] `aria-expanded` y `aria-controls` en ambos colapsos, apuntando a `#lista-vencidos` y
          `#lista-categorias`. Antes se anunciaba "Ver todos (12), botón" — sin estado
    - [x] Semana pesada con la palabra "Semana pesada" (hecho en la Task 15) y el
          `AlertTriangle` marcado `aria-hidden`: el texto ya dice lo que el icono decoraba
    - [x] El tooltip de la gráfica nombra la serie — pasaba `""`, así que un valor no decía si
          era lo que entra o lo que sale
    - [x] La badge sale del párrafo con `truncate`, en **ambas** listas (vencidos y próximos):
          anidada dentro, el `overflow:hidden` la cortaba al 200% de zoom, justo el marcador
          que distingue OC de Factura
    - [x] "Fuentes de egresos" envuelve (`flex-wrap`)
  - **Verificación**:
    - [x] `aria-expanded` cambia de `false` a `true` al abrir, y `aria-controls` apunta a un
          contenedor que existe
    - [x] La tabla alternativa del gráfico nombra ambas series
    - [x] Cero badges anidadas en párrafos con `truncate`
    - [x] **A 320px: cero desborde en las cuatro secciones**
    - [x] `npx tsc --noEmit` limpio · **85/85** en el spec
  - **Tres defectos reales que sólo aparecieron al medir a 320px** — ninguno estaba en la
    crítica, y dos los introduje yo en tareas anteriores:
    1. El **gráfico** desbordaba la página. Ahora hace scroll en su propia caja con un ancho
       mínimo de ~24px por barra. Esto cubre además el punto de densidad que la Task 19 tenía
       anotado para 28 barras
    2. La `Card` del gráfico necesitaba **`min-w-0`**: un grid item no encoge por debajo del
       ancho intrínseco de su contenido, así que el mínimo del gráfico estiraba toda la sección
    3. Las **acciones de la Task 13** ("Pagado" + "Reprogramar") no caben juntas en 320px, y
       el contenedor de la tarjeta de vencidos tenía el mismo problema de `min-w-0`. Las filas
       ahora envuelven
  - **Lección de medición**: la primera versión del test recorría descendientes comparando
    rectángulos y daba 455px de falso desborde — era la tabla `sr-only` del gráfico, que está
    clipada pero cuyas celdas reportan su tamaño natural. La medida correcta es
    `scrollWidth - clientWidth` de la sección: es la que de verdad significa "esto obliga a
    hacer scroll lateral". Además hubo que **esperar a que recharts asiente**, porque se
    dimensiona de forma asíncrona y medir antes da el ancho inicial.
  - **Fuera de alcance, anotado**: el **layout del dashboard** (barra lateral e iconos) sí
    desborda a 320px por su cuenta. Se verificó que no viene de esta pantalla; es otro arreglo.
  - **Dependencias**: Task 16
  - **Archivos**: `components/finance/cash-flow-calendar.tsx`,
    `components/finance/expense-row-actions.tsx`, `tests/cash-flow.spec.ts`
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
