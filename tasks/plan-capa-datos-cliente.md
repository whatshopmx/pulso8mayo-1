# Plan de implementación: Capa de datos del cliente

**Fecha:** 2026-08-22 · **Rama base:** `auditoria-conteo-produccion-merma`
**Origen:** dos de los cuatro diferidos del Checkpoint Completo de
`tasks/plan-auditoria-finanzas-ventas.md` — la migración a `hooks/queries/` y la persistencia
del alcance "Todas".

> **Archivo canónico.** Este plan vive aquí y en `tasks/todo-capa-datos-cliente.md`.
> `tasks/plan.md` y `tasks/todo.md` son borradores que hoy contienen *otros* planes
> (Inventory Movements y Propinas→Payroll). **No se escribe en ellos.**

---

## Resumen

El tablero tiene **tres maneras paralelas** de contestar la misma pregunta —"¿qué sucursales hay y
cuál está en alcance?"— y las pantallas hacen de puente entre ellas a mano:

| Mecanismo | Qué devuelve | Quién lo usa |
|---|---|---|
| `lib/branch-context.tsx` | contexto de React + cookie | 25 módulos vía `useBranch` |
| `hooks/use-branches.ts` | `{ branches, loading, error, refetch }`, fetch manual | 4 pantallas |
| `hooks/queries/use-branches.ts` | `useQuery`, **parsea mal el envelope** | 1 pantalla |

Este plan las reduce a una, y de paso cierra el bug de que el alcance "Todas" no sobreviva a un
recargado. Los dos problemas comparten raíz: **la ausencia de un valor se usa como si fuera un
valor**. `data.branches` ausente se lee como "no hay sucursales"; la cookie ausente se lee a la vez
como "todas" y como "aún no se sabe".

---

## Estado de partida (verificado en el código el 2026-08-22)

- **`/api/branches` responde `{ success, data }`** — `app/api/branches/route.ts:17` llama
  `ApiHandler.success(branches)`.
- **`hooks/queries/use-branches.ts:10` lee `data.branches || []`**, o sea **siempre `[]`**.
- **El bug es latente, no vivo.** Su único consumidor es
  `app/dashboard/inventory/transfers/page.tsx:13`, y ahí el efecto que copia el resultado al
  contexto está guardado por `branches.length === 0` — que ya es falso, porque
  `components/nav-company.tsx:62` pobló el contexto en el montaje. Hoy no se ve nada roto.
  **Lo que hay es una trampa armada**: el día que alguien use ese hook creyendo el nombre, recibe
  una lista vacía sin error. Es el mismo patrón de nombres duplicados que advierte `CLAUDE.md`.
- **`hooks/use-branches.ts` ya está bien** y lo documenta en `:17-26`: parsea `{success, data}` y
  **distingue "falló" de "está vacío"**. La corrección no es escribir código nuevo, es **mover esa
  semántica al hook que sobrevive**.
- **"Todas" no persiste** porque elegirlo *borra* la cookie (`lib/branch-context.tsx:74-76`). Al
  recargar, `alcanceElegido` nace en `false` y sin cookie `lib/branch-context.tsx:95` repone
  `newBranches[0]`. A17 arregló el rebote *dentro* de la sesión; el mismo ambiguo quedó mudado a
  la cookie.
- **El servidor tampoco puede expresarlo**: `app/dashboard/layout.tsx:39` resuelve
  `cookie ?? session.user.branchId`, y `session.user.branchId` gana siempre que la cookie falte.
- **Dos selectores de sucursal a la vez**: el del encabezado
  (`components/shared/branch-scope-control.tsx`, montado en `app/dashboard/layout.tsx:73`) y el de
  la barra lateral (`components/nav-company.tsx`). El segundo filtra la lista por rol
  (`isBranchScoped`); el primero **ofrece "Todas" a cualquiera**.

### Sobre "Todas" y los roles fijados a sucursal

**No es un hueco de seguridad.** Un GERENTE que elige "Todas" manda `branchId` ausente, y el
servidor lo vuelve a fijar a su sucursal (`enforceBranchScope` / `resolveBranchScope` en
`lib/branch-scope.ts`), tal como A5 dejó asentado. Es un problema de **honestidad de pantalla**: el
control dice "Todas" y los datos son de una. Se corrige en la UI, sin tocar la frontera.

---

## Decisiones de arquitectura

**AD-B1 — Sobrevive `hooks/queries/use-branches.ts`; se retira `hooks/use-branches.ts`.**
El destino declarado es TanStack Query, y dejar los dos mantiene la colisión de nombres. Pero el
código *correcto* está hoy en el que se retira: **se migra la semántica, no el archivo**.

**AD-B2 — "Falló" y "no hay sucursales" siguen siendo estados distintos.**
`useQuery` ya lo permite (`isError` + `error` frente a `data === []`), *siempre que el `queryFn`
lance*. Los cuatro consumidores actuales leen `{ branches, loading }` y, migrados por nombre, se
comerían el error. Cada migración de pantalla tiene que **leer `isError` explícitamente**. Es la
misma regla que A7 fijó para Ventas y que `fallos-visibles.spec.ts` ya vigila.

**AD-B3 — El alcance "Todas" necesita decirse, y va en una cookie aparte.**
Ausencia ≠ "todas", y el servidor tiene que entenderlo **antes** de caer a
`session.user.branchId`.

> **Corregido al implementar (2026-08-22).** El plan decía "un centinela (`__todas__`) dentro de
> `pulso_selected_branch`". **No se puede.** Esa cookie la leen **cinco** lugares del servidor
> —`lib/tenant-context.ts:24`, `app/dashboard/layout.tsx`, `app/dashboard/incidents/page.tsx`,
> `app/dashboard/page.tsx`, `app/dashboard/workflows/history/page.tsx`— y todos la tratan como un
> id de sucursal. El centinela se habría ido a las consultas como si fuera una sucursal real:
> `getCurrentTenant` devolviendo `branchId: "__todas__"` es la misma sucursal fantasma que arregló
> el commit `a1f936a`, pero en cinco pantallas a la vez.
>
> Lo que quedó: una segunda cookie, `pulso_branch_scope=all` (`lib/branch-cookies.ts`). Es
> **aditiva** —para los cinco lectores existentes "Todas" sigue siendo la ausencia de
> `pulso_selected_branch`, que es lo que ya significaba— así que ninguno cambia de comportamiento.

**AD-B4 — La frontera de sucursal no se toca.**
`resolveBranchScope`, `enforceBranchScope` y `assertBranchOfCompany` quedan como están. Lo único
que cambia es **qué ofrece la pantalla**, no qué concede el servidor. Cualquier tarea que se
descubra necesitando tocar `lib/branch-scope.ts` se detiene y se consulta.

**AD-B5 — La migración es por pantalla, no por hook.**
Cada pantalla se mueve completa —lectura, error, invalidación— en un commit con su verificación.
Migrar "todos los `useState` de una vez" deja el módulo a medio camino y sin forma de saber qué
quedó verde.

**AD-B6 — El envelope de `/api/inventory/suppliers` sigue diferido.**
Devuelve `{ success, suppliers }` y A21 ya defendió al consumidor. Corregir la ruta toca a sus
otros llamadores y es su propio cambio. Fuera de alcance aquí, a propósito.

---

## Grafo de dependencias

```
B1  hooks/queries/use-branches.ts parsea el envelope y lanza en fallo
     │
     ├── B2  Caja Chica y Gastos leen el hook único
     │        │
     │        └── B3  Ventas y Propinas; se borra hooks/use-branches.ts
     │
B4  La cookie gana el valor "Todas"        (independiente de B1:
     │                                      se puede paralelizar con B2/B3)
     ├── B5  El servidor lee el tri-estado
     │        │
     │        └── B6  Los dos selectores concuerdan; el rol fijado no ve "Todas"
     │                 │
     │                 └── B7  Spec de regresión de alcance fuera de Finanzas
     │
     └── (B3 + B7) ──┬── B8   Caja Chica a useQuery
                     ├── B9   Gastos
                     ├── B10  Contrapartes (reemplaza el debounce de A18)
                     ├── B11  CxP y Flujo de Efectivo
                     └── B12  Se retira el puente manual de Transferencias
```

**Se puede paralelizar:** la Fase 1 (B1–B3) y la Fase 2 (B4–B7) no se tocan entre sí. La Fase 3
depende de las dos.

---

## Fases

### Fase 1 — Una sola manera de listar sucursales (B1–B3)
Cierra la trampa de nombres duplicados y deja el hook que la Fase 3 va a usar.

### Fase 2 — El alcance "Todas" sobrevive al recargado (B4–B7)
La de mayor riesgo: toca `lib/branch-context.tsx`, que leen 25 módulos. Va antes que la Fase 3
para que la migración no herede un contexto que rebota.

### Fase 3 — Migración a TanStack Query, pantalla por pantalla (B8–B12)
Acotada a **Finanzas y Ventas**, que es donde la auditoría dejó specs verdes que sirven de red.
El resto del tablero queda fuera y se declara como deuda restante.

---

## Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| `lib/branch-context.tsx` lo leen 25 módulos: una regresión de alcance sale lejos de Finanzas | **Alto** | B7 es un spec de regresión sobre Inventario, Operaciones y Cumplimiento, no sobre Finanzas. Checkpoint humano obligatorio al cerrar la Fase 2. |
| La cookie es compartida con el servidor; un tri-estado a medias deja pantallas que se contradicen entre el render del servidor y el del cliente | **Alto** | B4 y B5 comparten checkpoint: no se cierra la fase con uno hecho y el otro no. |
| Migrar por nombre a `useQuery` se traga el error de red | Medio | AD-B2; `fallos-visibles.spec.ts` ya cubre parte y B2/B3 lo extienden. |
| B10 reemplaza el debounce y la cancelación que A18 escribió a mano | Medio | Leer la sección "Cómo quedó" de A18 antes de tocarlo; el criterio de aceptación es **el spec de A18 en verde sin modificarlo**. |
| `lib/branch-context.tsx` arrastra **1 error y 2 avisos preexistentes** de `react-hooks` | Bajo | Ya medidos en el Checkpoint Completo de la auditoría. Comparar contra ese número, no contra cero. |
| El build tarda 5–8 min y `next start` sirve el build, no el árbol | Bajo | Agrupar cambios; nunca dos `pnpm build` solapados (comparten `.next`). |
| Los specs corren seriales contra la **BD de dev compartida**; hoy ya hubo otra sesión corriendo la suite | Bajo | Confirmar que no hay otra corrida viva antes de lanzar la suite. |
| `better-auth` limita `/sign-in/email` a 3 intentos / 10 s **sólo en `NODE_ENV=production`** | Bajo | `storageState` por rol en `beforeAll` + reintento sobre 429, como en `ventas-rbac.spec.ts`. |

---

## Decisiones tomadas con David (2026-08-22)

Las tres preguntas abiertas de este plan quedaron resueltas antes de empezar. Ninguna mueve el
grafo de dependencias; aprietan el alcance de B3, B4, B6 y B12.

**AD-B7 — El alcance por omisión de un ADMIN o SUPER_ADMIN es "Todas".**
No es una política nueva: **el servidor ya la aplica.** `lib/branch-scope.ts:82` devuelve
`{ kind: "ALL" }` cuando un rol no fijado a sucursal no pide ninguna. El que inventa una sucursal
concreta es el cliente, en `lib/branch-context.tsx:95`, eligiendo `branches[0]` — que no es "la
principal" ni "la más reciente", es la que la consulta devolvió primero. Un default arbitrario que
se ve autoritativo es lo mismo que la auditoría corrigió veinte veces: un KPI que dice "$180,000"
sin decir "de una de tus doce sucursales" afirma de más. El cliente de Pulso es el dueño del grupo
y abre el tablero preguntando cómo va **el grupo**.

*Costo medido:* ninguna pantalla se rompe al cargar sin sucursal. Las que necesitan una concreta
bloquean al guardar con mensaje claro (`app/dashboard/inventory/purchase-orders/page.tsx:542`,
`components/labor/recurring-shift-builder.tsx:226`). La excepción es Transferencias, que pide con
`branchId=""` (`app/dashboard/inventory/transfers/page.tsx:34`) — una cadena vacía haciéndose pasar
por sucursal. **Condición de esta decisión: B12 lo corrige.**

*Contrapartida aceptada:* la primera carga agrega sobre todas las sucursales en vez de una. Es la
consulta que el dueño iba a pedir igual, y A17 ya quitó el abanico de peticiones que la encarecía.

**AD-B8 — Para GERENTE y SUPERVISOR el selector de sucursal es un rótulo, no un menú.**
`lib/branch-scope.ts:85` **ignora `requestedBranchId` por completo** para esos roles, y
`components/nav-company.tsx:56` ya filtra la lista a su única sucursal. El desplegable tiene una
opción real y ningún efecto: es un indicador de estado disfrazado de control. Se muestra texto
plano (`Sucursal: Condesa`, sin chevron) con el motivo a mano. Un ítem deshabilitado sería peor —
invita a preguntarse qué falta para habilitarlo; un rótulo no promete nada.
*Caso borde que entra en B6:* el GERENTE **sin** sucursal asignada cae en `kind: "NONE"`; el rótulo
tiene que decir eso, no "Todas". El mensaje ya existe en `app/actions/user.ts:34`.

**AD-B9 — `hooks/use-branches.ts` se retira de golpe en B3, sin alias de gracia.**
El alias conservaría el nombre duplicado, que *es* el defecto: no son dos comportamientos, son dos
archivos que se llaman igual y uno miente. *Matiz verificado:* `pnpm build` es la red, pero
`tests/**` está excluido de `tsconfig.json` y no atraparía un spec que lo importara. **Se comprobó
que ningún spec lo importa**, así que para este caso la red alcanza.

---

## Fuera de alcance

- La **cancelación de CFDI** — plan propio, ya descrito en la auditoría.
- El **envelope de `/api/inventory/suppliers`** — AD-B6.
- La migración a TanStack Query **fuera de Finanzas y Ventas** (Inventario, Operaciones,
  Cumplimiento, Reportes, Labor). Se declara como deuda restante al cerrar.
- Cualquier cambio en `lib/branch-scope.ts` o en la política de RBAC — AD-B4.
