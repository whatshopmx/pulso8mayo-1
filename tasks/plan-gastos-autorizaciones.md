# Implementation Plan: Gastos Operativos y Autorizaciones — remediación de la crítica

Fuente: `.impeccable/critique/2026-08-18T03-46-00Z__app-dashboard-finance-expenses-page-tsx.md`
(19/40 · 1 P0 · 3 P1 · 1 P2).

## Overview

`/dashboard/finance/expenses` es la pantalla donde se autoriza dinero, y hoy hace tres cosas mal en
orden de gravedad. Primero: **cualquier rol autenticado la puede abrir**. `ROUTE_PERMISSIONS` no
tiene entrada para `/dashboard/finance`, así que `hasAccess` cae al comodín `/dashboard`, que admite
`EMPLEADO` y `READONLY`; y `GET /api/expenses` toma `branchId` del query string sin pasar por
`enforceBranchScope`, de modo que un `GERENTE` fijado a una sucursal recibe el libro del grupo
entero. Segundo: enumera en vez de contestar — sin total, sin conteo, sin orden, sin `LIMIT`, con el
filtro en `ALL` y mostrando `createdAt` donde la decisión depende de `dueDate`. Tercero: promete una
bitácora en el diálogo de mayor riesgo y no la muestra en ninguna parte, mientras
`petty-cash-history-table.tsx` —misma carpeta, montos menores— sí renderiza al autorizador.

El plan cierra la fuga primero, después le da a la pantalla una pregunta que contestar, después
completa el ciclo de vida del gasto y la bitácora, y sólo al final toca tipografía y densidad.
El orden importa: subir el tamaño de tipo de una tabla que cualquier empleado puede leer no arregla
nada.

**Verificado directamente en el código antes de planear** (la crítica no se tomó al pie de la letra):

| Afirmación | Verificación |
|---|---|
| No hay entrada `/dashboard/finance` | `grep -n finance lib/rbac/permissions.ts` → sin resultados |
| `hasAccess` cae al comodín | `permissions.ts:225-237` ordena por longitud y hace `startsWith`; `/dashboard` admite los 6 roles |
| GET no escopa | `app/api/expenses/route.ts:36-40` — `searchParams.get("branchId")` va directo al servicio |
| `getOperatingExpenses` sin `LIMIT` | `expense-service.ts:391-427` — `orderBy(desc(createdAt))` y nada más |
| Enlace muerto | `expense-service.ts:113` escribe `?id=`; `hooks/use-focused-row.ts:19` lee `?focus=` |
| `dueDate` presente y no usada | seleccionada en `expense-service.ts:418`, en la interfaz en `page.tsx:73`, cero renders |
| `approvedByName` / `approvalNotes` presentes y no usados | `expense-service.ts:415-416`, `page.tsx:70-71`, cero renders |
| `ExpenseRowActions` existe y funciona | `components/finance/expense-row-actions.tsx`, contra `/api/expenses/[id]/pay` y `/reschedule`, ambas rutas con `withRoleAuth(["SUPER_ADMIN","ADMIN","GERENTE"])` |
| El sibling la usa y esta pantalla no | `cash-flow-calendar.tsx:12` la importa; `expenses/page.tsx` no |
| `text-xs` en todo el tbody | `page.tsx:381` — `focusProps(item.id, "… text-xs")` |
| Sin `tabular-nums` en el monto | `page.tsx:424`; el sibling lo usa en 10 lugares |
| Consumidores de `GET /api/expenses` | exactamente tres: `page.tsx:118`, `money-attention-panel.tsx:100`, `tests/payee.spec.ts:70` |

**Corrección a la crítica:** dice que `ExpenseForm` no tiene ningún guard de rol y que el sibling
gatea con `PUEDEN_CAPTURAR` / `PUEDEN_ACCIONAR`. Lo primero es cierto (`page.tsx:310` monta el
formulario sin condición). Lo segundo no: esas constantes no existen en `cash-flow-calendar.tsx`
—`grep` no las encuentra en el repo—. El sibling no gatea por rol en cliente; delega en
`withRoleAuth` de las rutas. Así que la lista de roles del gate no se copia de ningún lado: se
define aquí, alineada con la que ya imponen `pay` y `reschedule`.

## Architecture Decisions

1. **Esto es una cola de autorizaciones, no un libro mayor.** El h1 une dos trabajos con una
   conjunción ("Gastos Operativos **y** Autorizaciones") y eso es exactamente lo que la pantalla es:
   dos superficies apiladas sin decidir cuál es. Se decide: es la cola. El filtro arranca en
   `PENDING_APPROVAL`, la línea de encabezado dice cuántos y cuánto, y la columna de fecha es
   "Vence". El historial **no se borra** —sigue a un `Select` de distancia—, sólo deja de ser lo
   primero que se ve. Es la versión de bajo riesgo de la pregunta 1 de la crítica.
2. **El alcance aplicado se devuelve, no se supone.** `GET /api/expenses` pasa a responder
   `{ items, scope: { branchId, branchName } }` en vez de un arreglo pelado, igual que
   `/api/finance/cash-flow`. Es un cambio de forma con **tres consumidores conocidos** (arriba), y
   los tres se tocan en la misma tarea. Sin esto la insignia de alcance mentiría, que es peor que
   no tenerla: a un `GERENTE` que pide otra sucursal el servidor le devuelve la suya.
3. **El `LIMIT` no es simétrico.** Una cola tiene que estar completa —una aprobación que se quedó
   fuera del `LIMIT` es un gasto que nadie ve—, así que `PENDING_APPROVAL` se devuelve entero. Lo
   resuelto (`APPROVED` / `REJECTED` / `PAID`) se acota a los últimos 200 registros, y la respuesta
   declara si hubo corte para que la UI lo diga en voz alta en vez de callarlo.
4. **El gate de rol se define aquí, no se copia.** *(Decidido con el usuario.)* `/dashboard/finance`
   —el módulo entero, no sólo esta pantalla— queda en
   `SUPER_ADMIN | ADMIN | GERENTE | SUPERVISOR`. `EMPLEADO` y `READONLY` quedan fuera, y con ellos
   se va la captura de gastos desde piso: hoy funciona porque `ExpenseForm` no tiene gate, y se
   rompe a propósito. Si ese flujo resulta ser real, necesita otra vía (un smart link, como ya hace
   `smart-link-service.ts` para workflows), no una puerta abierta al libro del grupo. Accionar
   sobre un gasto queda en `SUPER_ADMIN | ADMIN | GERENTE`, la misma lista que `pay` y `reschedule`
   ya imponen. El cliente no inventa autoridad: refleja la del servidor.
5. **La bitácora se muestra donde se prometió.** El diálogo jura que la decisión "queda registrada
   en la bitácora de autorizaciones" y la pantalla no la enseña. `approvedByName` va bajo la
   insignia de estatus en las filas resueltas y `approvalNotes` en un `Popover` —el patrón ya está
   importado en `cash-flow-calendar.tsx:9`—. Regla heredada de `petty-cash-history-table.tsx:125-130`:
   **nunca sustituir un autorizador ausente por el solicitante**; sin `approvedByName` no hubo
   segunda persona y así se dice.
6. **El ciclo de vida vive en una fila.** `ExpenseRowActions` se renderiza en la celda Acción para
   `status === "APPROVED"`. No se reimplementa nada: el componente existe, tiene carga y error por
   fila, y ya se usa desde cash-flow.
7. **`page.tsx` no se extrae todavía.** 521 líneas y la mayoría de los cambios de la Fase 1 son
   *borrados* (10 columnas → 6); extraer al mismo tiempo volvería el diff imposible de contrastar
   contra las referencias de línea de la crítica. La fila se extrae a
   `components/finance/expense-row.tsx` en la Fase 2, cuando gane vencimiento, acciones y bitácora
   y se lo haya ganado.
8. **Los lotes se acotan al tramo de autorización.** *(Decidido con el usuario.)* La crítica pide
   aprobación por lotes y a la vez más fricción para montos grandes; son fuerzas opuestas sobre un
   control de segregación de funciones. Un "seleccionar todo" sobre gastos que cruzan umbrales
   distintos anula justo lo que el diálogo existe para imponer. La selección se limita a un mismo
   `requiredApproverRole`, la confirmación dice conteo y suma del lote, y **el rechazo por lotes no
   existe**: el motivo es obligatorio y por gasto, y un motivo copiado 30 veces no explica nada en
   la bitácora.
9. **Fuera de alcance, declarado:** (a) migrar los ~99 literales en español a `next-intl` es un
   proyecto de repo, no de esta pantalla; (b) la fricción proporcional al monto (pregunta 5 de la
   crítica) queda anotada como seguimiento; (c) ordenamiento y búsqueda por columna se reevalúan
   después de la Fase 1, cuando el filtro por defecto ya haya bajado el volumen.

## Task List

### Fase 0: Cerrar la fuga (P0) — servidor y RBAC, sin UI
- [ ] Task 0: `tests/gastos-autorizaciones.spec.ts` con los invariantes de acceso (arranca en rojo)
- [ ] Task 1: Entrada `/dashboard/finance` en `ROUTE_PERMISSIONS`
- [ ] Task 2: `enforceBranchScope` + cota + respuesta `{ items, scope }` en `GET /api/expenses`

### Checkpoint: Fuga cerrada
- [ ] Un `EMPLEADO` con la URL escrita a mano recibe redirección, no la tabla
- [ ] Un `GERENTE` con el header en "todas" recibe sólo su sucursal
- [ ] Los tres consumidores compilan y funcionan con la forma nueva
- [ ] `npx tsc --noEmit` limpio · spec de la Task 0 en verde

### Fase 1: Que la pantalla conteste una pregunta (P1)
- [ ] Task 3: Filtro por defecto `PENDING_APPROVAL` + línea de encabezado (conteo · suma · vencen esta semana)
- [ ] Task 4: Columna "Vence" sobre `dueDate`, con tratamiento de vencido
- [ ] Task 5: Insignia de alcance en pantalla + gate de rol sobre el CTA de captura

### Checkpoint: Contesta
- [ ] La dueña ve "N gastos por autorizar por $X · M vencen esta semana" antes que cualquier tabla
- [ ] La columna de fecha es la que decide, y un vencido se distingue sin leer el número
- [ ] Se ve de qué sucursales son las cifras
- [ ] Revisión humana antes de la Fase 2

### Fase 2: El ciclo completo y la bitácora (P1)
- [ ] Task 6: Extraer `expense-row.tsx` y montar `ExpenseRowActions` en `APPROVED`
- [ ] Task 7: Renderizar la bitácora — autorizador + notas
- [ ] Task 8: Reparar el enlace muerto de la notificación (`?id=` → `?focus=`)
- [ ] Task 9: Aprobación por lotes, acotada al tramo de autorización

### Checkpoint: Ciclo cerrado
- [ ] Un gasto va de pendiente a pagado sin salir de la pantalla
- [ ] Una fila `REJECTED` dice quién y por qué
- [ ] El WhatsApp que la dueña toca aterriza en la fila correcta
- [ ] Un lote de un mismo tramo se aprueba en una confirmación; mezclar tramos es imposible

### Fase 3: Tipografía, accesibilidad y densidad (P2 + banderas de persona)
- [ ] Task 10: Piso de tipo, `tabular-nums` y las cuatro opacidades de `muted`
- [ ] Task 11: Accesibilidad — `role="status"`, nombre del botón en vuelo, em-dashes, foco tras resolver
- [ ] Task 12: Densidad de columnas para tablet
- [ ] Task 13: Observaciones menores en un solo barrido

### Checkpoint: Completo
- [ ] Todos los criterios de aceptación cumplidos
- [ ] `pnpm build` (o el fallback documentado) limpio · `pnpm lint` limpio
- [ ] Suite e2e de gastos y de cash-flow en verde
- [ ] Listo para revisión

## Risks and Mitigations

| Riesgo | Impacto | Mitigación |
|---|---|---|
| El cambio de forma de `GET /api/expenses` rompe un consumidor no encontrado | Alto | Los tres consumidores están enumerados y verificados por `grep`; se tocan en la misma tarea (Task 2) y `tsc --noEmit` cierra la puerta a un cuarto |
| Cerrar `/dashboard/finance` a `EMPLEADO` rompe la captura de gastos desde piso | Medio | Aceptado a sabiendas (decisión 4). El sidebar ya oculta el enlace para ese rol, así que el uso por esa vía es marginal. Si aparece, la salida es un smart link, no reabrir la ruta |
| La selección por lotes acaba cruzando tramos por un bug de estado | Alto | El endpoint por lote evalúa `approveOperatingExpense` **gasto por gasto**, así que la regla de autorización y la de autoaprobación se vuelven a aplicar en el servidor aunque la UI se equivoque |
| Acotar el historial a 200 esconde datos sin avisar | Medio | La cota es asimétrica (decisión 3): los pendientes van completos y la respuesta declara el corte para que la UI lo diga |
| `pnpm build` no corre sin red (`next/font` no baja Geist) | Bajo | Hecho ya conocido en este repo — ver `tasks/todo.md`, Task 0. Fallback documentado: `npx tsc --noEmit` |
| Los specs corren serialmente contra la BD de desarrollo real y se pisan | Medio | Datos etiquetados `[E2E]` y limpiados con `deleteTestExpenses()`, como ya hace `cash-flow.spec.ts` |
| La Fase 1 y la Fase 3 tocan las mismas líneas de `page.tsx` | Bajo | Fase 1 borra columnas, Fase 3 ajusta las que quedan; el orden evita retrabajo |

## Open Questions

1. **`ROLE_LABELS` (`page.tsx:45-54`) incluye `OWNER` y `DIRECTOR_OPS`, que no están en la unión
   `UserRole`.** La jerarquía de aprobadores (`expenseAuthorizationRules.approverRole`) y los roles
   de RBAC son dos vocabularios, y la usuaria ve los dos. ¿Se unifican, o la escala de aprobación se
   mantiene aparte a propósito? La Task 13 sólo puede tapar el síntoma: el fallback `"OWNER"` de
   `page.tsx:203` muestra "Requiere Dueño" en cada fila de un inquilino sin reglas configuradas, sin
   camino para arreglarlo.

*Resueltas con el usuario:* alcance de RBAC (decisión 4) y forma de la aprobación por lotes
(decisión 8).
