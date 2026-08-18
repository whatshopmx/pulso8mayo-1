# Todo List: Gastos Operativos y Autorizaciones — remediación de la crítica

Plan: `tasks/plan-gastos-autorizaciones.md` ·
Crítica: `.impeccable/critique/2026-08-18T03-46-00Z__app-dashboard-finance-expenses-page-tsx.md`

Archivos principales:
- `app/dashboard/finance/expenses/page.tsx` (521 líneas)
- `components/finance/expense-form.tsx` (441 líneas)
- `components/finance/expense-row-actions.tsx` (136 líneas, ya existe — se monta, no se escribe)
- `lib/services/expense-service.ts` (444 líneas)
- `app/api/expenses/route.ts` (75 líneas)
- `lib/rbac/permissions.ts` (266 líneas)

Comandos de verificación de este repo:
- `pnpm build` es la reja que atrapa errores de TS. **Puede fallar sin red** (`next/font` no baja
  Geist de Google Fonts); fallback documentado: `npx tsc --noEmit`.
- `tests/**` está excluido de `tsconfig.json`, así que `pnpm build` **no** typechequea los specs.
- Los specs corren serialmente contra la BD de desarrollo real. Datos etiquetados `[E2E]`.
- Preferir correr contra un build:
  `pnpm build && PLAYWRIGHT_WEB_SERVER_CMD="npm run start" pnpm test:e2e`

---

## Fase 0: Cerrar la fuga (P0) — servidor y RBAC, sin UI

- [x] **Task 0**: `tests/gastos-autorizaciones.spec.ts` con los invariantes de acceso
  - **Descripción**: No existe spec que cubra el acceso a esta pantalla (`gasto-evidencia.spec.ts`
    cubre la subida de evidencia y `payee.spec.ts` toca `GET /api/expenses` de pasada, ninguno el
    RBAC). Se crea primero, con los invariantes que las Tasks 1-2 tienen que poner en verde.
    Arranca en rojo: ese es el punto.
  - **Acceptance criteria**:
    - [x] Invariante de ruta: un usuario `EMPLEADO` que navega a `/dashboard/finance/expenses`
          termina en `getDefaultDashboard('EMPLEADO')`, no en la tabla
    - [x] Invariante de alcance: `GET /api/expenses?branchId=<otra>` como `GERENTE` fijado a la
          sucursal A devuelve **cero** filas de la sucursal B
    - [x] Invariante de cola: con N pendientes sembrados, la respuesta los trae **todos** (la cota
          del historial no recorta pendientes)
    - [x] Datos sembrados y limpiados con `seedOperatingExpense` / `deleteTestExpenses` de
          `tests/support/db.ts`, etiquetados `[E2E]`
    - [x] Los casos que dependen de tareas posteriores quedan con `test.fixme`, no borrados
  - **Verificación**:
    - [x] Los tres invariantes **fallan** antes de las Tasks 1-2 — corrida inicial: **5 fallaron**,
          1 pasó (el setup), 8 en `fixme`
    - [x] `pnpm exec playwright test tests/gastos-autorizaciones.spec.ts` → 5/5 tras Tasks 1-2
  - **Anadidos sobre lo planeado** (salieron de escribir el spec):
    - `seedManyOperatingExpenses` en `tests/support/db.ts`: 240 inserciones una por una excedian
      el timeout, asi que van por `generate_series` en una sola ida a Neon
    - Un caso extra, **"un EMPLEADO tampoco lee el libro por la API"**: `proxy.ts:151` salta
      `hasAccess` en todo `/api/*`, asi que la entrada de RBAC sola **no** cierra la API. Sin este
      caso la Task 1 habria parecido suficiente
    - El caso de redireccion usa `waitUntil: "domcontentloaded"`, no `networkidle`: el dashboard
      mantiene sondeos abiertos y la red nunca se queda quieta
  - **Dependencias**: Ninguna
  - **Archivos**: `tests/gastos-autorizaciones.spec.ts` (nuevo), `tests/support/db.ts` (helper de
    sesión con otro rol, si `seedForeignTenant` no alcanza)
  - **Alcance**: S (2 archivos)

- [x] **Task 1**: Entrada `/dashboard/finance` en `ROUTE_PERMISSIONS`
  - **Descripción**: `hasAccess` ordena las rutas por longitud y hace prefix-match; sin entrada para
    `/dashboard/finance` cae al comodín `/dashboard` (`permissions.ts:215-218`), que admite los seis
    roles. El sidebar oculta el enlace y eso es cosmético: una URL escrita, un marcador o el
    `actionUrl` de una notificación aterrizan igual.
  - **Acceptance criteria**:
    - [x] Entrada `{ path: '/dashboard/finance', allowedRoles: ['SUPER_ADMIN','ADMIN','GERENTE','SUPERVISOR'], description: … }`
    - [x] `EMPLEADO` y `READONLY` quedan fuera; el prefix-match cubre `/finance/expenses`,
          `/finance/cash-flow` y el resto del módulo
    - [x] Ninguna sub-ruta de finance que hoy funcione para un rol autorizado deja de funcionar
          (`payee.spec.ts`, que navega a `/dashboard/finance/payees`, sigue en verde)
  - **Verificación**:
    - [x] Invariante de ruta de la Task 0 en verde
    - [x] `npx tsc --noEmit` limpio
    - [x] Cubierto por el spec en vez de a mano: el caso abre sesion como `pedro@pulso.mx` y
          comprueba que `goto` aterriza fuera de `/finance/expenses`
  - **Dependencias**: Task 0
  - **Archivos**: `lib/rbac/permissions.ts`
  - **Alcance**: XS (1 archivo)
  - **Decidido**: `EMPLEADO` y `READONLY` quedan fuera del módulo completo. Si alguien captura
    gastos desde piso hoy, ese flujo se rompe a propósito y hay que darle otra vía.

- [x] **Task 2**: `enforceBranchScope` + cota + respuesta `{ items, scope }` en `GET /api/expenses`
  - **Descripción**: La ruta toma `branchId` del query string y lo pasa tal cual
    (`route.ts:36-40`), así que un `GERENTE` con el header en "todas" recibe el libro del grupo.
    `getOperatingExpenses` además no tiene `LIMIT` (`expense-service.ts:391-427`): ocho sucursales
    por un año de rentas y servicios son miles de filas, todas traídas y todas renderizadas. Se
    aplica el mismo patrón que `/api/finance/cash-flow` ya usa, incluido devolver el alcance
    **aplicado** para que la pantalla pueda rotularlo sin mentir.
  - **Acceptance criteria**:
    - [x] La ruta llama `enforceBranchScope(role, userBranchId, searchParams.get("branchId"))` y
          usa el resultado; el `branchId` del query deja de llegar al servicio sin filtrar
    - [x] La respuesta es `{ items, scope: { branchId, branchName }, truncated }` en vez de un
          arreglo pelado
    - [x] Cota asimétrica: `PENDING_APPROVAL` completo; el resto acotado a 200 por
          `desc(createdAt)`, con `truncated: true` cuando se cortó. Se pide uno de mas
          (`limit + 1`) para detectar el corte sin un `COUNT` aparte
    - [x] **Los tres consumidores actualizados en esta misma tarea**: `page.tsx:118`,
          `money-attention-panel.tsx:100`, `tests/payee.spec.ts:70`
    - [x] La ruta se mueve de `requireTenant()` a `withRoleAuth` — expone `user.role` y `branchId`,
          y de paso devuelve 403 a `EMPLEADO`/`READONLY`, que es lo que la entrada de RBAC **no**
          puede hacer porque `proxy.ts:151` salta `hasAccess` en `/api/*`
  - **Verificación**:
    - [x] Invariantes de alcance y de cola de la Task 0 en verde
    - [x] `pnpm exec playwright test tests/payee.spec.ts` en verde (consumidor tocado; dos fallos
          intermitentes por conectividad a Neon, verdes al reintentar)
    - [x] `npx tsc --noEmit` limpio — es lo que atrapa un cuarto consumidor no encontrado
    - [ ] Manual: `money-attention-panel` sigue listando alertas de gastos — **pendiente**
  - **Anadido sobre lo planeado**: el **POST** tambien pasa por `enforceBranchScope`. Cerrar la
    lectura y dejar que un rol fijado a una sucursal registre gastos en otra es la misma fuga en
    forma de escritura, y ensucia el libro de alguien mas.
  - **Dependencias**: Task 0
  - **Archivos**: `app/api/expenses/route.ts`, `lib/services/expense-service.ts`,
    `app/dashboard/finance/expenses/page.tsx`, `components/finance/money-attention-panel.tsx`,
    `tests/payee.spec.ts`
  - **Alcance**: M (5 archivos)

### ✅ Checkpoint: Fuga cerrada
- [x] `EMPLEADO` con URL a mano → redirección, no la tabla
- [x] `EMPLEADO` por la API → 403 (no estaba en el plan; la entrada de RBAC sola no bastaba)
- [x] `GERENTE` con el header en "todas" → sólo su sucursal
- [x] Los tres consumidores compilan y funcionan con la forma nueva
- [x] `npx tsc --noEmit` limpio · `tests/gastos-autorizaciones.spec.ts` en verde (5/5)
- [ ] **Revisión humana antes de seguir** — esto es el P0

---

## Fase 1: Que la pantalla conteste una pregunta (P1)

- [ ] **Task 3**: Filtro por defecto `PENDING_APPROVAL` + línea de encabezado
  - **Descripción**: El filtro arranca en `ALL` (`page.tsx:96`), así que la cola de aprobación viene
    mezclada con el historial: una renta pendiente de $80,000 entre un taxi pagado y un recibo de
    ferretería rechazado. Y no hay total ni conteo en ninguna parte. El sibling contesta
    "¿Me alcanza?" en `text-4xl`; esta pantalla tiene que contestar "¿qué tengo que autorizar hoy?".
  - **Acceptance criteria**:
    - [ ] `useState<StatusFilter>("PENDING_APPROVAL")` como valor inicial
    - [ ] Una línea sobre la tabla: *"N gastos por autorizar por $X · M vencen esta semana"*,
          con `tabular-nums`, calculada sobre los pendientes del alcance aplicado
    - [ ] Con cero pendientes la línea no muestra "0 gastos": muestra que la cola está limpia
    - [ ] El estado vacío tras filtrar sigue distinguiéndose del de cero datos (hoy ya lo hace,
          `page.tsx:336-354`) y ahora tiene que decir que el filtro por defecto es "pendientes"
    - [ ] Si la respuesta trae `truncated: true`, la pantalla lo dice en voz alta
  - **Verificación**:
    - [ ] Caso nuevo en el spec: al cargar, sólo se ven filas `PENDING_APPROVAL`
    - [ ] Caso nuevo: la suma de la línea == suma de los montos de las filas pendientes visibles
    - [ ] `npx tsc --noEmit` limpio
  - **Dependencias**: Task 2 (la línea se calcula sobre el alcance aplicado)
  - **Archivos**: `app/dashboard/finance/expenses/page.tsx`, `tests/gastos-autorizaciones.spec.ts`
  - **Alcance**: S (2 archivos)

- [ ] **Task 4**: Columna "Vence" sobre `dueDate`, con tratamiento de vencido
  - **Descripción**: La columna rotulada "Fecha" (`page.tsx:365,384`) muestra `createdAt` —cuándo se
    capturó— cuando la fecha que decide es `dueDate`, que está seleccionada, tipada y no se
    renderiza. Es la mitad rota del puente que cash-flow construyó: la dueña llega desde
    "tienes 6 gastos vencidos", `useFocusedRow` resalta la fila, y la fila no dice que está vencida.
  - **Acceptance criteria**:
    - [ ] La columna se llama "Vence" y muestra `dueDate`
    - [ ] `dueDate < hoy && status !== "PAID"` recibe tratamiento destructivo, y el estado se
          comunica **además del color** (palabra o icono), no sólo por color
    - [ ] Un gasto sin `dueDate` no inventa uno: dice que no tiene vencimiento
    - [ ] `createdAt` no se pierde — pasa a `title`/tooltip o al detalle, no a una columna propia
    - [ ] El día de "hoy" se calcula con `localDateString` de `lib/workflows/today`, el mismo helper
          que usa `/api/expenses/[id]/reschedule` — dos definiciones de "vencido" en el mismo
          dominio es lo que hace que una fila se vea vencida y la API la rechace
  - **Verificación**:
    - [ ] Caso nuevo: gasto sembrado con `dueDate` de ayer y estado `APPROVED` aparece marcado
          como vencido; el mismo con `dueDate` de mañana, no
    - [ ] Caso nuevo: llegar por `?focus=<id>` a un vencido muestra la fila resaltada **y** vencida
    - [ ] `npx tsc --noEmit` limpio
  - **Dependencias**: Task 3
  - **Archivos**: `app/dashboard/finance/expenses/page.tsx`, `tests/gastos-autorizaciones.spec.ts`
  - **Alcance**: S (2 archivos)

- [ ] **Task 5**: Insignia de alcance + gate de rol sobre el CTA de captura
  - **Descripción**: La pantalla consume `selectedBranchId` (`page.tsx:95`) y nunca lo muestra: la
    columna Sucursal o repite un nombre 200 veces o mezcla ocho en silencio. Y `ExpenseForm` se monta
    sin condición (`page.tsx:310`), así que el botón de captura aparece para roles que el servidor
    va a rechazar. Se rotula el alcance **aplicado** (el que devolvió el servidor en la Task 2), no
    el pedido.
  - **Acceptance criteria**:
    - [ ] Insignia arriba de la tabla con `scope.branchName ?? "Grupo completo"`, siempre visible,
          siguiendo el patrón de `cash-flow-calendar.tsx:832-846`
    - [ ] A un `GERENTE` que pidió otra sucursal la insignia le dice la suya, porque eso es lo que
          está viendo
    - [ ] `ExpenseForm` sólo se monta para los roles que pueden capturar (decisión 4 del plan)
    - [ ] Un rol sin permiso de captura no ve un botón muerto ni un error después de llenarlo
  - **Verificación**:
    - [ ] Caso nuevo: `GERENTE` con el header en "todas" ve la insignia con su sucursal
    - [ ] Manual: el CTA desaparece para el rol correspondiente
    - [ ] `npx tsc --noEmit` limpio
  - **Dependencias**: Task 2 (necesita `scope` en la respuesta)
  - **Archivos**: `app/dashboard/finance/expenses/page.tsx`, `tests/gastos-autorizaciones.spec.ts`
  - **Alcance**: S (2 archivos)

### ✅ Checkpoint: Contesta
- [ ] La línea de encabezado se lee antes que cualquier tabla
- [ ] La columna de fecha es la que decide, y un vencido se distingue sin leer el número
- [ ] Se ve de qué sucursales son las cifras
- [ ] `npx tsc --noEmit` limpio · spec en verde
- [ ] **Revisión humana antes de la Fase 2**

---

## Fase 2: El ciclo completo y la bitácora (P1)

- [ ] **Task 6**: Extraer `expense-row.tsx` y montar `ExpenseRowActions` en `APPROVED`
  - **Descripción**: Las filas `PENDING_APPROVAL` tienen Aprobar/Rechazar; todo lo demás tiene `—`
    (`page.tsx:437`). Pero `APPROVED` es justo el estado donde existe la siguiente acción, y
    `components/finance/expense-row-actions.tsx` **ya la implementa** contra
    `/api/expenses/[id]/pay` y `/reschedule`, con carga y error por fila. La importa
    `cash-flow-calendar.tsx:12` y no la pantalla que se llama "Gastos Operativos y Autorizaciones".
    La fila se extrae aquí, no antes: ahora ya se lo ganó (vencimiento + acciones + bitácora).
  - **Acceptance criteria**:
    - [ ] La fila vive en `components/finance/expense-row.tsx`; `page.tsx` queda como cascarón
    - [ ] `<ExpenseRowActions>` se renderiza en la celda Acción cuando `status === "APPROVED"`,
          con `minDate` = hoy en la zona de la operación (mismo helper que la Task 4)
    - [ ] Gateado a `SUPER_ADMIN | ADMIN | GERENTE` — la misma lista que `withRoleAuth` impone en
          ambas rutas, para que el botón no prometa lo que el servidor niega
    - [ ] `onDone` dispara `fetchExpenses(true)` (el refetch silencioso de `page.tsx:110-114`,
          escrito porque "una sesión de 30 aprobaciones perdía su lugar 30 veces")
    - [ ] Ningún cambio de comportamiento en la extracción: es mover, no reescribir
  - **Verificación**:
    - [ ] Caso nuevo: aprobar → aparece "Pagado" → marcar pagado → la fila queda `PAID` sin recargar
    - [ ] Caso nuevo: un rol sin permiso no ve los botones
    - [ ] `pnpm exec playwright test tests/cash-flow.spec.ts` sigue en verde (comparten componente)
    - [ ] `npx tsc --noEmit` limpio
  - **Dependencias**: Task 4
  - **Archivos**: `components/finance/expense-row.tsx` (nuevo),
    `app/dashboard/finance/expenses/page.tsx`, `tests/gastos-autorizaciones.spec.ts`
  - **Alcance**: M (3 archivos)

- [ ] **Task 7**: Renderizar la bitácora — autorizador + notas
  - **Descripción**: El diálogo promete que la decisión "queda registrada en la bitácora de
    autorizaciones" (`page.tsx:466-467`) y el toast lo repite (`:178`). `approvedByName` y
    `approvalNotes` están en la interfaz (`:70-71`) y en la consulta (`expense-service.ts:415-416`)
    y no se renderizan en ninguna parte: una fila `REJECTED` es una insignia roja sin motivo, y de
    un `PAID` nadie sabe quién lo autorizó. `petty-cash-history-table.tsx:125-130` —misma carpeta,
    montos menores— sí lo hace.
  - **Acceptance criteria**:
    - [ ] `approvedByName` bajo la insignia de estatus en filas resueltas
          (`APPROVED` / `REJECTED` / `PAID`)
    - [ ] `approvalNotes` en un `Popover` (patrón ya importado en `cash-flow-calendar.tsx:9`), con
          disparador que tiene nombre accesible
    - [ ] **Sin `approvedByName` no se sustituye por el solicitante**: se dice "Sin autorización
          registrada", literal de `petty-cash-history-table.tsx:126-128`. Esta celda la lee un
          auditor como un hecho
    - [ ] Un `REJECTED` sin motivo guardado lo declara en vez de mostrar una insignia muda
  - **Verificación**:
    - [ ] Caso nuevo: rechazar con motivo → el motivo es recuperable desde la fila
    - [ ] Caso nuevo: una fila resuelta sin `approvedByName` no muestra el nombre del solicitante
    - [ ] `npx tsc --noEmit` limpio
  - **Dependencias**: Task 6
  - **Archivos**: `components/finance/expense-row.tsx`, `tests/gastos-autorizaciones.spec.ts`
  - **Alcance**: S (2 archivos)

- [ ] **Task 8**: Reparar el enlace muerto de la notificación
  - **Descripción**: `expense-service.ts:113` escribe `actionUrl: '/dashboard/finance/expenses?id=<id>'`
    y `hooks/use-focused-row.ts:19` lee `?focus=`. El WhatsApp que la dueña toca la deja en una lista
    sin filtrar donde tiene que cazar por memoria de una descripción truncada (`page.tsx:406`,
    `max-w-xs truncate`, sin `title`).
  - **Acceptance criteria**:
    - [ ] `actionUrl` usa `?focus=<id>`
    - [ ] Llegar con `?focus=` fuerza el filtro a mostrar esa fila aunque su estatus no sea el del
          filtro por defecto de la Task 3 — un enlace a un gasto ya aprobado no puede aterrizar en
          una cola de pendientes que lo esconde
    - [ ] `title` en la celda de descripción para que el truncado sea recuperable
    - [ ] `grep -rn "expenses?id=" --include=*.ts --include=*.tsx .` sin resultados
  - **Verificación**:
    - [ ] Caso nuevo: navegar a `?focus=<id de un gasto pagado>` muestra y resalta esa fila
    - [ ] `pnpm exec playwright test tests/cash-flow.spec.ts -g "focus"` en verde
          (`cash-flow.spec.ts:1051` ya ejercita el enlace desde el otro lado)
  - **Dependencias**: Task 3
  - **Archivos**: `lib/services/expense-service.ts`,
    `app/dashboard/finance/expenses/page.tsx` o `components/finance/expense-row.tsx`,
    `tests/gastos-autorizaciones.spec.ts`
  - **Alcance**: S (3 archivos)

- [ ] **Task 9**: Aprobación por lotes, acotada al tramo de autorización
  - **Descripción**: Una sesión de 30 aprobaciones cuesta hoy ~120 clics y 30 diálogos — el propio
    autor lo describe en el comentario del refetch silencioso (`page.tsx:110-114`). Pero esto es un
    control de segregación de funciones, no una bandeja de correo: un "seleccionar todo" sobre
    gastos que cruzan umbrales distintos anula justo lo que el diálogo existe para imponer.
    **Decisión tomada:** el lote se limita a gastos que comparten `requiredApproverRole`, y la
    confirmación dice el total.
  - **Acceptance criteria**:
    - [ ] Columna de checkbox sólo en filas `PENDING_APPROVAL` que la usuaria puede resolver
          (mismo `roleIsAtLeast` + no-autoaprobación de `page.tsx:207-208`)
    - [ ] La selección **no puede cruzar tramos**: seleccionar en un `requiredApproverRole` limpia o
          bloquea los de otro, y la UI dice por qué. La agrupación se rotula
    - [ ] "Seleccionar todo" selecciona el tramo, no la tabla
    - [ ] La confirmación muestra conteo y **suma del lote**, y conserva las dos propiedades que ya
          tiene el diálogo individual: describe la consecuencia y no se cierra antes de que el
          servidor conteste
    - [ ] Rechazo por lotes **no** se implementa: el motivo es obligatorio y por gasto, y un motivo
          copiado 30 veces no explica nada en la bitácora
    - [ ] Resolución parcial declarada: si 3 de 12 fallan, se dice cuáles y por qué; las 9 buenas no
          se revierten
    - [ ] Endpoint por lote reutilizando `approveOperatingExpense` gasto por gasto, para que la
          regla de autorización y la de autoaprobación se evalúen una vez por gasto en el servidor
  - **Verificación**:
    - [ ] Caso nuevo: aprobar un lote de 4 del mismo tramo → los 4 quedan `APPROVED`
    - [ ] Caso nuevo: intentar mezclar tramos → la UI lo impide y lo explica
    - [ ] Caso nuevo: lote donde un gasto es propio de la aprobadora → ese falla, los demás pasan,
          y la respuesta lo dice
    - [ ] `npx tsc --noEmit` limpio
  - **Dependencias**: Task 7
  - **Archivos**: `app/dashboard/finance/expenses/page.tsx`, `components/finance/expense-row.tsx`,
    `app/api/expenses/approvals/route.ts`, `lib/services/expense-service.ts`,
    `tests/gastos-autorizaciones.spec.ts`
  - **Alcance**: M (5 archivos) — si al implementarla crece, se parte en UI (selección) y
    servidor (endpoint por lote)

### ✅ Checkpoint: Ciclo cerrado
- [ ] Un gasto va de pendiente a pagado sin salir de la pantalla
- [ ] Una fila `REJECTED` dice quién y por qué
- [ ] El WhatsApp aterriza en la fila correcta, con cualquier estatus
- [ ] Un lote de un mismo tramo se aprueba en una confirmación; mezclar tramos es imposible
- [ ] `tests/gastos-autorizaciones.spec.ts` y `tests/cash-flow.spec.ts` en verde

---

## Fase 3: Tipografía, accesibilidad y densidad (P2 + banderas de persona)

- [ ] **Task 10**: Piso de tipo, `tabular-nums` y las cuatro opacidades de `muted`
  - **Descripción**: `focusProps(item.id, "… text-xs")` (`page.tsx:381`) pone **todo el cuerpo de la
    tabla en 12px**. DESIGN.md pone las celdas en Body (0.875rem) y reserva Label (0.75rem) para
    botones, insignias y metadatos, y prohíbe explícitamente "dense tables con tiny type". El monto
    (`:424`) es `font-bold` sin `tabular-nums`, así que una columna de pesos no alinea por dígito
    mientras el sibling lo usa en cada cifra que imprime. Y hay cuatro opacidades sobre
    `--muted-foreground` (`/40`, `/50`, `/60`, `/70`), que a `oklch(0.50 0.01 85)` ≈ 4.6:1 dejan
    `/60` cerca de 2:1. El peor caso es `:212-215`: la explicación de por qué no puedes actuar es
    el texto menos legible de la pantalla.
  - **Acceptance criteria**:
    - [ ] Se quita `text-xs` de la fila; las celdas quedan en Body
    - [ ] El monto con `tabular-nums`
    - [ ] Cero ocurrencias de `text-muted-foreground/{40,50,60,70}` en los archivos de esta pantalla
    - [ ] El mensaje "Requiere {rol}" en tamaño Body, con el token sólido, y **diciendo el umbral
          de monto que lo disparó** — hoy nunca dice por qué
  - **Verificación**:
    - [ ] `grep -n "text-muted-foreground/" app/dashboard/finance/expenses/page.tsx components/finance/expense-row.tsx` → vacío
    - [ ] `grep -n "text-xs" …` → sólo en insignias, botones y metadatos
    - [ ] Manual: contraste del mensaje de aprobador bloqueado ≥ 4.5:1
  - **Dependencias**: Task 9
  - **Archivos**: `app/dashboard/finance/expenses/page.tsx`, `components/finance/expense-row.tsx`
  - **Alcance**: S (2 archivos)

- [ ] **Task 11**: Accesibilidad
  - **Descripción**: Cinco defectos concretos, todos verificados en el archivo. Las bases están
    bien —`<table>` semántica, `scope="col"`, `<caption>` `sr-only`, `aria-current` en la fila
    enfocada—; lo que falta es lo que pasa durante y después de una acción.
  - **Acceptance criteria**:
    - [ ] El estado de carga (`page.tsx:322-325`) con `role="status"` / `aria-live`
    - [ ] El botón Aprobar en vuelo conserva nombre accesible y anuncia `aria-busy` — hoy
          `{busy ? <Loader2/> : "Aprobar"}` (`:232`) lo deja sin nombre a media operación, porque
          lucide pone `aria-hidden` en iconos sin hijos
    - [ ] Los `—` de las celdas vacías dejan de leerse como una raya suelta (texto para lector de
          pantalla o marcado que los excluya)
    - [ ] El foco no cae a `<body>` tras resolver: Radix lo devuelve al disparador y el disparador
          se desmonta cuando la celda pasa a otro estado. Se mueve a un destino estable de la fila
    - [ ] El botón de 28×28 que sólo envuelve `<X/>` en `expense-form.tsx:414-422` recibe nombre
          accesible y área táctil de 44px
    - [ ] `<Suspense>` (`:80`) con `fallback`
  - **Verificación**:
    - [ ] Caso nuevo: aprobar con teclado y comprobar que el foco sigue dentro de la tabla
    - [ ] Manual con lector de pantalla: el botón en vuelo se anuncia; las celdas vacías no dicen
          "raya"
  - **Dependencias**: Task 10
  - **Archivos**: `app/dashboard/finance/expenses/page.tsx`, `components/finance/expense-row.tsx`,
    `components/finance/expense-form.tsx`, `tests/gastos-autorizaciones.spec.ts`
  - **Alcance**: M (4 archivos)

- [ ] **Task 12**: Densidad de columnas para tablet
  - **Descripción**: Diez columnas (`page.tsx:365-374`), dos de las cuales muestran `—` en la
    mayoría de las filas, dentro de dos `overflow-x-auto` anidados (`:356` y `components/ui/table.tsx:11`),
    y con **tres clases con prefijo de breakpoint en toda la página**, las tres en el encabezado
    (`:281`). Monto y Acción son las dos últimas de diez: la dueña con la tablet hace scroll
    horizontal para llegar a la única columna por la que vino.
  - **Acceptance criteria**:
    - [ ] La tabla baja a las columnas que deciden: Vence · Contraparte · Monto · Sucursal ·
          Estatus · Acción. Lo demás pasa a una segunda línea de la fila o al detalle
    - [ ] La columna Sucursal sólo se rotula en alcance de grupo, como hace
          `cash-flow-calendar.tsx:688-691` — repetirla 200 veces con la insignia de alcance arriba
          diciendo lo mismo es ruido
    - [ ] Se elimina el doble contenedor: `Card` envolviendo un `border rounded-md` envolviendo la
          tabla son dos bordes de 1px donde DESIGN.md pide divisores horizontales
    - [ ] Se quita el `CardHeader` (`:316-319`) que repite el h1 sin añadir información
    - [ ] Sin scroll horizontal en 768px de ancho
  - **Verificación**:
    - [ ] Manual a 768px: Monto y Acción visibles sin scroll horizontal
    - [ ] Caso nuevo: en alcance de una sucursal, el nombre no se repite en cada fila
  - **Dependencias**: Task 11
  - **Archivos**: `app/dashboard/finance/expenses/page.tsx`, `components/finance/expense-row.tsx`,
    `tests/gastos-autorizaciones.spec.ts`
  - **Alcance**: M (3 archivos)

- [ ] **Task 13**: Observaciones menores en un solo barrido
  - **Descripción**: Lo que queda de la crítica, agrupado porque cada pieza es de una línea y
    separarlas cuesta más que hacerlas.
  - **Acceptance criteria**:
    - [ ] La categoría deja de imprimirse cruda (`:393` muestra `SERVICIOS_PROFESIONALES`): se
          extrae el mapa que ya existe en `expense-form.tsx:247-252` a un módulo compartido y lo
          usan ambos, para que no vuelvan a divergir
    - [ ] El h1 deja de unir dos trabajos con una conjunción, y el subtítulo (`:286-288`) deja de
          explicar la taxonomía del dominio y dice qué hacer
    - [ ] Un solo botón "Nuevo Gasto Operativo" en el estado vacío — hoy se montan dos (`:310`
          y `:342`), cada uno con su propio `loadPayees()`
    - [ ] Los tres `console.error` del camino renderizado (`:132`, `:189`,
          `expense-form.tsx:59`) pasan a `createChildLogger` de `lib/logger.ts`, como manda CLAUDE.md
    - [ ] El fallback `"OWNER"` de `:203` deja de mostrar "Requiere Dueño" sin salida en un
          inquilino sin reglas: dice que no hay reglas configuradas y a dónde ir
          (parche del síntoma — la causa es la *Open Question 3*)
    - [ ] `<Receipt className="h-7 w-7 text-primary" />` (`:284`): 28px de Rojo Operativo sin
          información, contra la regla de DESIGN.md de que el acento es 10-15%, no relleno.
          El sibling hace lo mismo, así que se corrige aquí y se anota como hábito de la casa
  - **Verificación**:
    - [ ] `grep -n "console.error" app/dashboard/finance/expenses/page.tsx components/finance/expense-form.tsx` → vacío
    - [ ] Caso nuevo: la categoría se muestra como "Servicios Profesionales", no como el enum
    - [ ] `pnpm lint` limpio
  - **Dependencias**: Task 12
  - **Archivos**: `app/dashboard/finance/expenses/page.tsx`, `components/finance/expense-form.tsx`,
    `lib/finance/expense-labels.ts` (nuevo), `tests/gastos-autorizaciones.spec.ts`
  - **Alcance**: M (4 archivos)

### ✅ Checkpoint: Completo
- [ ] Todos los criterios de aceptación cumplidos
- [ ] `pnpm build` (o `npx tsc --noEmit` sin red) limpio · `pnpm lint` limpio
- [ ] `pnpm exec playwright test tests/gastos-autorizaciones.spec.ts tests/cash-flow.spec.ts tests/payee.spec.ts tests/gasto-evidencia.spec.ts` en verde
- [ ] Todos los `test.fixme` de la Task 0 activados o justificados por escrito
- [ ] Listo para revisión

---

## Seguimiento (fuera de este plan, anotado para no perderse)

- **Fricción proporcional al monto** (pregunta 5 de la crítica): mostrar en la confirmación de un
  gasto grande qué proporción del saldo mínimo proyectado se lleva — cifra que
  `cash-flow-service.ts` ya calcula.
- **Ordenamiento y búsqueda por columna**: la crítica los pide; con el filtro por defecto en
  pendientes y la cola completa, el volumen baja lo suficiente para que dejen de ser urgentes.
  Reevaluar después de la Fase 1.
- **`next-intl` en el dominio de finanzas**: ~58 literales en la página y ~41 en el formulario,
  y `messages/es.json` no tiene namespace de finanzas. Es un proyecto de repo.
- **Unificar `ROLE_LABELS` con la unión `UserRole`** — *Open Question 1* del plan, la única que
  sigue abierta. La Task 13 sólo tapa el síntoma.
