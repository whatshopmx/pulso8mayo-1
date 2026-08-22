# TODO: Capa de datos del cliente

Plan: `tasks/plan-capa-datos-cliente.md`. Las decisiones se citan como **AD-B1**…**AD-B6**.

**Numeración `B`** para no chocar con las tareas `A1`…`A21` de la auditoría de Finanzas y Ventas.

Cómo verificar (de `CLAUDE.md`; `next start` sirve el **build**, no el árbol de trabajo):

```bash
pnpm build && PLAYWRIGHT_WEB_SERVER_CMD="npm run start" \
  pnpm exec playwright test --project=chromium tests/<spec>.spec.ts
```

---

## Fase 1 — Una sola manera de listar sucursales

### - [x] B1: `hooks/queries/use-branches.ts` parsea el envelope y falla ruidosamente

**Descripción:** El hook lee `data.branches` sobre una respuesta `{ success, data }` y por eso
devuelve `[]` siempre (`hooks/queries/use-branches.ts:10`). Se le traslada la semántica que
`hooks/use-branches.ts:17-59` ya tiene documentada: parsear `json.data`, y **lanzar** cuando la
respuesta no es `ok` o `success` es falso, para que `useQuery` lo exponga como `isError` y no como
lista vacía (AD-B2).

**Criterios de aceptación:**
- [x] Con `/api/branches` respondiendo normal, el hook devuelve las sucursales, no `[]`
- [x] Con la ruta devolviendo 500 o `{ success: false }`, el hook queda en `isError` con el mensaje
      del servidor — **no** en `data: []`
- [x] El tipo de retorno expone `Branch[]`, no `any`

**Verificación:**
- [x] `pnpm exec eslint hooks/queries/use-branches.ts`
- [x] `pnpm build` limpio
- [x] Comprobación manual: Transferencias sigue mostrando su lista de sucursales (hoy la recibe del
      contexto, no del hook — no debe cambiar nada visible)

**Dependencias:** Ninguna
**Archivos:** `hooks/queries/use-branches.ts`
**Tamaño:** XS

---

### - [x] B2: Caja Chica y Gastos leen el hook único

**Descripción:** Ambas pantallas importan hoy `@/hooks/use-branches` y desestructuran
`{ branches, loading, error }`. Pasan a `@/hooks/queries/use-branches` con
`{ data, isLoading, isError, error }`. **El estado de error tiene que seguir pintándose**: es lo que
A7 y A10 dejaron y lo que `fallos-visibles.spec.ts` vigila (AD-B2).

**Criterios de aceptación:**
- [x] Las dos pantallas listan sucursales igual que antes
- [x] **Caja Chica**: el fallo sigue mostrando error con reintento, no una lista vacía
      (`:84` compone `fundError ?? branchesError`, y `:237` reintenta)
- [x] No queda ningún `import ... from "@/hooks/use-branches"` en `app/dashboard/finance`

> **Corregido al implementar (2026-08-22).** El criterio decía "las dos pantallas muestran el
> error". **Gastos nunca lo leyó**: sólo desestructuraba `{ branches }` y, si la carga fallaba,
> `ExpenseForm` recibía un selector de sucursal vacío sin decir por qué. La migración **no
> introduce** ese silencio, lo hereda. Cerrarlo pide un prop nuevo en
> `components/finance/expense-form.tsx` —archivo que hoy tiene cambios sin commitear de otro
> frente— así que **se cierra en B9**, que es la tarea dueña de esa pantalla. Anotado, no olvidado.

**Verificación:**
- [x] `pnpm exec playwright test --project=chromium tests/fallos-visibles.spec.ts tests/caja-chica-consolidado.spec.ts`
- [x] `pnpm exec eslint app/dashboard/finance/petty-cash/page.tsx app/dashboard/finance/expenses/page.tsx`

**Dependencias:** B1
**Archivos:** `app/dashboard/finance/petty-cash/page.tsx`, `app/dashboard/finance/expenses/page.tsx`
**Tamaño:** S

---

### - [x] B3: Ventas y Propinas migran, y `hooks/use-branches.ts` se retira

**Descripción:** Los dos consumidores que quedan (`app/dashboard/sales/page.tsx:27`,
`app/dashboard/labor/propinas/page.tsx:9`) pasan al hook único y se borra el módulo viejo, con lo
que desaparece el nombre duplicado (AD-B1). `pnpm build` es la red: si quedó un importador, falla.

> **Ojo con Propinas:** `tasks/todo-propinas-payroll.md` es un plan ajeno sin seguimiento sobre esa
> misma pantalla. Revisar antes de tocar, y no commitear ese archivo.

**Criterios de aceptación:**
- [x] `hooks/use-branches.ts` ya no existe y ningún módulo lo importa
- [x] Ventas y Propinas listan sucursales y siguen distinguiendo fallo de vacío
- [x] `hooks/queries/index.ts` sigue siendo el único punto de exportación

**Verificación:**
- [x] `pnpm build` limpio (atrapa cualquier importador huérfano)
- [x] `pnpm exec playwright test --project=chromium tests/ventas-rbac.spec.ts tests/fallos-visibles.spec.ts`

**Dependencias:** B2
**Archivos:** `app/dashboard/sales/page.tsx`, `app/dashboard/labor/propinas/page.tsx`,
`hooks/use-branches.ts` (borrado)
**Tamaño:** S

---

### ☐ Checkpoint: Hook único
- [x] Un solo `useBranches` en el repo, y es el de `hooks/queries/`
- [x] `pnpm build` limpio · `pnpm exec eslint` sin errores nuevos en lo tocado
      (queda 1 aviso preexistente: `Clock` sin usar en Propinas)
- [x] `pnpm exec tsc --noEmit` sin errores
- [x] Retiro de golpe, sin alias de gracia (**AD-B9**)
- [x] **`fallos-visibles`, `caja-chica-consolidado` y `ventas-rbac` en verde: 26 passed, 0 failed.**
      La primera corrida dio 23 passed / 3 failed y **los tres fallos eran del entorno**: las
      pantallas se estrellaban con `ChunkLoadError` porque `playwright.config.ts:71` tiene
      `reuseExistingServer: !process.env.CI`, así que Playwright **ignoró**
      `PLAYWRIGHT_WEB_SERVER_CMD` y reutilizó un servidor levantado antes del build, sirviendo un
      manifiesto cuyos chunks ya no existían en disco. Los 23 que pasaron eran de API y de
      servicio, que no cargan chunks: no probaban la UI. Repetido contra un servidor propio, los
      26 pasan.

> **Trampa de entorno que conviene añadir a `CLAUDE.md`.** `PLAYWRIGHT_WEB_SERVER_CMD="npm run start"`
> **no garantiza** que se corra contra el build: si algo ya escucha en `:3000`, Playwright lo
> reutiliza y la variable no hace nada. Un build recién hecho contra un servidor viejo da
> `ChunkLoadError` y tiñe de rojo pantallas que no tienen nada roto. Antes de verificar por UI,
> comprobar que el puerto esté libre.
>
> **Cómo correr sin desalojar a nadie** (útil cuando otra sesión tiene el :3000 con su Inngest):
> levantar un segundo `next start` en otro puerto y apuntar sólo los specs ahí. `baseURL` sí es
> overrideable (`playwright.config.ts:30`), pero hay que mover **las dos** variables o
> better-auth rechaza el login con `Invalid origin` — `BETTER_AUTH_URL` está fijo a `:3000` en
> `.env`:
>
> ```bash
> BETTER_AUTH_URL="http://localhost:3200" npx next start -p 3200
> PLAYWRIGHT_TEST_BASE_URL="http://localhost:3200" pnpm exec playwright test --project=chromium <specs>
> ```
>
> `webServer.url` sigue mirando a `:3000` y reutiliza lo que haya ahí, así que no arranca nada;
> los casos navegan al puerto nuevo.

---

## Fase 2 — El alcance "Todas" sobrevive al recargado

> **Desbloqueada** por AD-B7 (2026-08-22): el alcance por omisión de un ADMIN o SUPER_ADMIN es
> **"Todas"**, que es lo que `lib/branch-scope.ts:82` ya aplica del lado del servidor.

### - [x] B4: La cookie gana un valor explícito para "Todas"

**Descripción:** Hoy elegir "Todas" **borra** la cookie (`lib/branch-context.tsx:74-76`), así que al
recargar es indistinguible de "el usuario nunca eligió" y `:95` repone `branches[0]`. Se introduce
un centinela (`__todas__`) exportado junto a `BRANCH_COOKIE_NAME` en `lib/tenant-context.ts`, y
`branch-context` lo escribe, lo lee al montar y lo usa para nacer con `alcanceElegido = true`
(AD-B3).

**Criterios de aceptación:**
- [x] Elegir "Todas" y recargar deja "Todas" seleccionado
- [x] Elegir una sucursal y recargar deja esa sucursal
- [x] Un ADMIN o SUPER_ADMIN que nunca eligió abre en **"Todas"**, no en `branches[0]` (AD-B7).
      Desaparece la autoselección de `lib/branch-context.tsx:95` para esos roles
- [x] Una cookie que nombra una sucursal **muerta** se sigue descartando — la guarda de
      `lib/branch-context.tsx:46-49` y `:109` no se pierde (la puso el commit `a1f936a`)

**Verificación:**
- [x] `pnpm exec eslint lib/branch-context.tsx lib/tenant-context.ts` — comparar contra **1 error y
      2 avisos preexistentes** de `react-hooks`, no contra cero
- [x] Comprobación manual: los tres casos de arriba en el navegador

**Dependencias:** Ninguna (paralelizable con B2/B3) · decidido en **AD-B7**
**Archivos:** `lib/branch-context.tsx`, `lib/tenant-context.ts`
**Tamaño:** S

---

### - [x] B5: El servidor entiende el tri-estado antes de caer a la sesión

**Descripción:** `app/dashboard/layout.tsx:39` hace
`cookieStore.get(BRANCH_COOKIE_NAME)?.value || session.user.branchId`. Con el centinela, ese `||`
tiene que reconocerlo y pasar `initialBranchId = null` **con la marca de que fue una elección**, en
vez de dejar que `session.user.branchId` gane. Si algún otro lector de la cookie del lado servidor
aparece, se ajusta aquí.

**Criterios de aceptación:**
- [x] Con la cookie en "Todas", el render del servidor no manda `session.user.branchId`
- [x] El primer pintado y el del cliente coinciden — no hay parpadeo de sucursal
- [x] `lib/tenant-context.ts:24` (el otro lector de la cookie) se comporta consistente

**Verificación:**
- [x] `pnpm build` limpio
- [x] Comprobación manual: recargar con "Todas" no muestra un instante la primera sucursal

**Dependencias:** B4
**Archivos:** `app/dashboard/layout.tsx`, `lib/tenant-context.ts`
**Tamaño:** XS

---

### - [x] B6: Los dos selectores concuerdan y el rol fijado no ve "Todas"

**Descripción:** El del encabezado (`components/shared/branch-scope-control.tsx:145`) ofrece "Todas"
a cualquier rol; el de la barra lateral (`components/nav-company.tsx:56`) ya filtra la lista para
GERENTE y SUPERVISOR. **No es un hueco de seguridad** —el servidor los vuelve a fijar (AD-B4)— sino
una pantalla que promete lo que no ocurre. Por **AD-B8**, para esos roles el control deja de ser un
menú y pasa a ser **texto plano** con el motivo a mano — un ítem deshabilitado invita a preguntarse
qué falta para habilitarlo; un rótulo no promete nada.
De paso, el comentario de `branch-scope-control.tsx:68` apunta a `tasks/plan.md`, que hoy contiene
otro plan: se corrige la referencia.

**Criterios de aceptación:**
- [x] Un GERENTE o SUPERVISOR ve `Sucursal: <la suya>` como rótulo, sin chevron ni desplegable
- [x] Ese rótulo explica por qué no se puede cambiar ("Tu usuario está asignado a …")
- [x] Un GERENTE **sin** sucursal asignada (`kind: "NONE"`) lee ese caso, no "Todas" — el mensaje
      ya existe en `app/actions/user.ts:34`
- [x] Un ADMIN sigue viendo el menú completo, con "Todas" funcionando
- [x] Los dos selectores muestran la misma sucursal activa en todo momento
- [x] La referencia a `tasks/plan.md` apunta al plan canónico

**Verificación:**
- [x] `pnpm exec playwright test --project=chromium tests/branch-scope-finanzas.spec.ts`
- [x] Comprobación manual con sesión de GERENTE y de ADMIN

**Dependencias:** B5 · decidido en **AD-B8**
**Archivos:** `components/shared/branch-scope-control.tsx`, `components/nav-company.tsx`
**Tamaño:** S

---

### - [x] B7: Spec de regresión de alcance **fuera** de Finanzas

**Descripción:** El riesgo alto de esta fase es que `lib/branch-context.tsx` lo leen 25 módulos y
los specs de la auditoría sólo miran Finanzas y Ventas. Se escribe un spec nuevo que ejerza el
alcance en pantallas de **otros dominios** — Inventario, Operaciones, Cumplimiento — eligiendo
"Todas", recargando y comprobando que el encabezado y los datos siguen en "Todas".

**Criterios de aceptación:**
- [x] Cubre al menos tres pantallas de dominios distintos a Finanzas
- [x] Cada caso **falla** contra el código anterior a B4 (si pasa en rojo y en verde, no prueba nada)
- [x] Usa `storageState` en `beforeAll`, no login por caso (el límite de `better-auth` sólo aparece
      contra `npm run start`)

**Verificación:**
- [x] `pnpm build && PLAYWRIGHT_WEB_SERVER_CMD="npm run start" pnpm exec playwright test --project=chromium tests/alcance-todas.spec.ts`
- [x] El mismo spec contra `git stash` de B4–B6 debe salir rojo

**Dependencias:** B6
**Archivos:** `tests/alcance-todas.spec.ts`, y `tests/support/db.ts` si hace falta sembrar
**Tamaño:** S

---

### ☑ Checkpoint: Alcance
- [x] "Todas" sobrevive al recargado en Finanzas **y** fuera de Finanzas
      (Inventario, Operaciones, Cumplimiento — `alcance-todas.spec.ts`)
- [x] Una sucursal dada de baja sigue sin dejar la app en callejón sin salida (no se perdió `a1f936a`)
- [x] `pnpm build` limpio · `pnpm exec tsc --noEmit` sin errores
- [x] Lint sin errores nuevos: **3 errores y 5 avisos, todos preexistentes** — medido linteando la
      versión de HEAD de los mismos archivos, no de memoria. `app/dashboard/layout.tsx` **bajó de 2
      errores a 0**: cuatro `as any` sustituidos por una aserción tipada.
- [x] Suite de Finanzas y Ventas de la auditoría en verde: **118 passed** de 123 en la primera
      corrida, y los **5 fallos eran una sola causa** — dos specs cuya premisa AD-B7 invalidó, no
      una regresión. Corregidos y en verde: 14/14.
- [ ] **Revisar con David antes de seguir** — esta fase toca todas las pantallas con alcance

> **Dos hallazgos de la implementación, más allá de AD-B3:**
>
> 1. **AD-B7 tenía un segundo camino que el plan no vio.** Desactivar la autoselección de
>    `branches[0]` no bastaba: `app/dashboard/layout.tsx` caía a `session.user.branchId`, y eso
>    contradice al servidor — `lib/branch-scope.ts:82` **ni consulta** `userBranchId` para un rol no
>    fijado. El encabezado anunciaba una sucursal mientras el servidor respondía por la cadena
>    entera. Ahora la sesión sólo fija a quien el servidor fija.
> 2. **Los dos selectores se contradecían con "Todas".** El de la barra lateral
>    (`components/nav-company.tsx`) caía a `displayBranches[0]` y anunciaba una sucursal concreta
>    mientras el del encabezado decía "Todas". Dos controles del mismo alcance en desacuerdo es
>    peor que uno equivocado: el usuario no sabe cuál le está contestando.
>
> **Spec ajeno modificado, con su razón:** `caja-chica-consolidado.spec.ts:171` esperaba a que el
> alcance "se asentara" en una sucursal concreta, y su comentario declaraba que *"el alcance por
> omisión no es «Todas»"*. AD-B7 volvió falsa esa premisa. Ahora **elige** una sucursal concreta
> antes de medir. **Ninguna de sus aserciones cambió**: sigue exigiendo una sola petición a
> `/consolidado` sin `branchId` y cero peticiones por las rutas viejas.

---

## Fase 3 — Migración a TanStack Query, pantalla por pantalla

> Acotada a Finanzas y Ventas (AD-B5). Cada tarea es una pantalla, con su lectura, su estado de
> error y su invalidación tras escribir.

### - [ ] B8: Caja Chica

**Descripción:** `app/dashboard/finance/petty-cash/page.tsx` sostiene el consolidado en siete
`useState` (`:64-77`) más un `useEffect`. Pasa a `useQuery` sobre `/api/petty-cash/consolidado`,
con `queryKey` que incluya el alcance para que cambiar de sucursal refetchee solo.

**Criterios de aceptación:**
- [ ] La pantalla muestra lo mismo, incluidos `branchesWithoutFund` y el total de movimientos
- [ ] Un fallo de red se distingue de "no hay fondo" — es la mitad de honestidad de A17
- [ ] Cambiar de sucursal no dispara la cascada de peticiones que A17 eliminó

**Verificación:**
- [ ] `pnpm exec playwright test --project=chromium tests/caja-chica-consolidado.spec.ts tests/petty-cash-lectura-pura.spec.ts`

**Dependencias:** B3, B7
**Archivos:** `app/dashboard/finance/petty-cash/page.tsx`, `hooks/queries/use-petty-cash.ts` (nuevo)
**Tamaño:** M

---

### - [ ] B9: Gastos

**Descripción:** `app/dashboard/finance/expenses/page.tsx` a `useQuery` + `useMutation`. Aprobar o
rechazar invalida la lista en vez de refetchear a mano.

> **Hay cambios sin commitear en este archivo** (arreglos responsive de otro frente). Coordinar
> antes de tocarlo.

**Criterios de aceptación:**
- [ ] El filtro de estatus y el alcance viajan en la `queryKey`
- [ ] Aprobar invalida y la fila cambia de estado sin recargar
- [ ] El mensaje de "ningún aprobador posible" que dejó A16b se sigue viendo
- [ ] **Deuda heredada de B2**: un fallo al cargar sucursales deja de verse como "esta empresa no
      tiene sucursales" en el selector de `ExpenseForm`. Pide un prop de error en
      `components/finance/expense-form.tsx`

**Verificación:**
- [ ] `pnpm exec playwright test --project=chromium tests/gastos-autorizaciones.spec.ts tests/gasto-notifica-aprobador.spec.ts tests/cash-flow.spec.ts`

**Dependencias:** B8
**Archivos:** `app/dashboard/finance/expenses/page.tsx`, `hooks/queries/use-expenses.ts` (nuevo)
**Tamaño:** M

---

### - [ ] B10: Contrapartes

**Descripción:** `app/dashboard/finance/payees/page.tsx` a `useQuery`. A18 escribió a mano el
debounce y la cancelación del buscador; TanStack los reemplaza con `queryKey` + cancelación propia.
**Leer la sección "Cómo quedó" de A18 antes de tocarlo.**

**Criterios de aceptación:**
- [ ] El buscador no dispara una petición por tecla
- [ ] Una respuesta tardía de una búsqueda vieja no pisa a la nueva
- [ ] **`tests/payee.spec.ts` pasa sin modificarlo** — si hay que editar el spec, es que cambió el
      comportamiento y hay que parar

**Verificación:**
- [ ] `pnpm exec playwright test --project=chromium tests/payee.spec.ts`

**Dependencias:** B9
**Archivos:** `app/dashboard/finance/payees/page.tsx`, `hooks/queries/use-payees.ts` (nuevo)
**Tamaño:** M

---

### - [ ] B11: Cuentas por Pagar y Flujo de Efectivo

**Descripción:** Las dos pantallas restantes de Finanzas con fetch manual. CxP tiene la paginación
declarada de A19 y la leyenda accesible de A20: las dos tienen que sobrevivir intactas.

**Criterios de aceptación:**
- [ ] La leyenda de CxP sigue declarando cuántas filas existen frente a cuántas se muestran
- [ ] El 403 del alcance `NONE` en los agregados de dinero se sigue mostrando como negativa
      explícita, no como ceros (precedente de `/api/finance/cash-flow`)

**Verificación:**
- [ ] `pnpm exec playwright test --project=chromium tests/cash-flow.spec.ts tests/branch-scope-finanzas.spec.ts`

**Dependencias:** B10
**Archivos:** `app/dashboard/finance/payables/page.tsx`, `app/dashboard/finance/cash-flow/page.tsx`,
`hooks/queries/use-payables.ts` (nuevo)
**Tamaño:** M

---

### - [ ] B12: Se retira el puente manual de Transferencias

**Descripción:** `app/dashboard/inventory/transfers/page.tsx:15-20` copia a mano el resultado del
hook al contexto con un `useEffect` guardado por `branches.length === 0` — un puente que hoy es un
no-op porque `nav-company` ya pobló el contexto. Con el hook arreglado (B1) y el contexto estable
(B4–B6), el puente sobra.

**Además — condición de AD-B7.** Con "Todas" por omisión, esta pantalla es la única que pide con
`branchId=""` (`:34`): una cadena vacía haciéndose pasar por sucursal. Tiene que **decir** que
necesita una sucursal concreta, como ya hacen `purchase-orders/page.tsx:542` y
`recurring-shift-builder.tsx:226`.

**Criterios de aceptación:**
- [ ] Transferencias lista sucursales y `TransferRequest` se renderiza igual que antes
- [ ] No queda `useEffect` que sincronice hook y contexto en esa pantalla
- [ ] Con el alcance en "Todas", la pantalla pide elegir una sucursal en vez de consultar con `""`

**Verificación:**
- [ ] `pnpm build` limpio
- [ ] Comprobación manual de la pantalla de Transferencias

**Dependencias:** B11
**Archivos:** `app/dashboard/inventory/transfers/page.tsx`
**Tamaño:** XS

---

### ☐ Checkpoint: Completo
- [ ] Finanzas y Ventas leen por TanStack Query; no queda `fetch(` suelto en esas pantallas
- [ ] `pnpm build` limpio · `pnpm exec eslint` sin errores nuevos en lo tocado
- [ ] Suite de la auditoría en verde (13 specs) más `alcance-todas`
- [ ] **Deuda restante declarada por escrito**: Inventario, Operaciones, Cumplimiento, Reportes y
      Labor siguen con fetch manual; el envelope de `/api/inventory/suppliers` sigue diferido
      (AD-B6); la cancelación de CFDI sigue en su propio plan
- [ ] Sin casillas abiertas en este archivo
