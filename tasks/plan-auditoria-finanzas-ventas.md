# Plan de Implementación: Auditoría de Finanzas y Ventas

> Cierra los hallazgos de la auditoría del 2026-08-20 sobre `app/dashboard/finance/*` y
> `app/dashboard/sales/*` (11 páginas, 22 rutas, 6 servicios).
> Tracker operativo: `tasks/todo-auditoria-finanzas-ventas.md`.
> Reporte de origen: artifact `Auditoría Finanzas y Ventas`.
>
> **Convención de numeración:** prefijo **A#** (auditoría) para no colisionar con `C#`
> (`plan-cierre-gaps-ventas-gastos.md`), `T#u` (`plan-grupo-restaurantero-unificado.md`) ni
> `T41–T58` (`plan-fiscal-control-interno.md`).

## Overview

La capa de presentación de este módulo está bien construida —los estados de error distinguen "falló"
de "vacío", las acciones irreversibles piden confirmación, y `cash-flow` ya sincroniza su estado con
la URL. El problema está debajo: **tres superficies de dinero escriben o exponen datos sin el control
que la UI da por hecho**, y varias pantallas afirman cosas que su fuente de datos no sostiene.

Este plan tiene 21 tareas en 6 fases. Las dos primeras fases (5 tareas) son de contención: detienen
escritura de datos falsos y cierran un hueco de RBAC. El resto se puede repartir o diferir sin que el
sistema quede a medias.

**Fuera de alcance, a su propio plan:** migrar el módulo a `hooks/queries/` (TanStack Query). Es la
raíz de los hallazgos de carreras, debounce y abanico de peticiones, pero es una refactorización
transversal de 11 páginas. Ver "Deuda diferida" al final.

## Correcciones a la auditoría publicada

Al leer los servicios a fondo para dimensionar el trabajo, tres cosas cambiaron:

| Hallazgo original | Corrección | Efecto |
|---|---|---|
| **05** Auto-aprobación: "el servidor permite lo que la UI bloquea" | `createOperatingExpense` **auto-aprueba a propósito** cuando el rol basta para la regla (`expense-service.ts:78`), y lo deja escrito en `approvalNotes`. El carve-out `minAmount > 0` de `approveOperatingExpense` es coherente con esa política, no un hueco. | Baja de Alto a **Medio** y cambia de naturaleza: es una **inconsistencia de UI**, no una falla de segregación. Ver A16. |
| **11** Gastos: "el filtro en cliente sobre lista truncada puede esconder pendientes" | **Falso.** La cota del servidor es asimétrica a propósito: devuelve la cola de pendientes completa y solo acota el historial resuelto. Hay un spec que lo prueba (`gastos-autorizaciones.spec.ts:180`). | Se reduce a lo que sí es cierto —`truncated` y `scope` se piden y nunca se pintan— y **gana** el caso `scope.kind === "NONE"`. Ver A10. |
| — | **Hallazgo nuevo (Alto).** `createOperatingExpense` notifica con `userId: input.companyId` (`expense-service.ts:108`). `getUserPreferences` no encuentra ese id, registra "No preferences found" y **retorna sin enviar nada**. Ningún aprobador se entera jamás de un gasto pendiente. | Nueva tarea **A12**. Explica por qué la cola de autorizaciones depende de que alguien recuerde abrir la pantalla. |

El conteo final queda en **4 críticos, 7 altos, 10 medios, 6 menores** — el hallazgo nuevo ocupa el
lugar que dejó el 05 al bajar.

## Architecture Decisions

- **AD-A1 — El GET de caja chica deja de crear el fondo, y abrir uno pasa a ser un acto explícito.**
  `getOrCreateFund` se parte en `getFund` (lectura pura, devuelve `null`) y `openFund` (recibe el
  monto que se entregó a la sucursal). El default de $5,000 desaparece: no hay un monto correcto que
  el sistema pueda inventar, y el que había se estaba presentando como saldo real de la cadena.
  `registerOutflow`/`registerInflow` siguen llamando a `getFund` y fallan con un mensaje claro si no
  hay fondo, en vez de crearlo bajo la mesa.

- **AD-A2 — La sucursal de una escritura se valida contra el tenant en el servicio, no en la ruta.**
  Ya hay precedente en el mismo archivo: `createOperatingExpense` valida `payeeId` con
  `getPayeeForCompany` y rechaza sin revelar por qué (`expense-service.ts:61`). Se sigue ese patrón
  con un helper `assertBranchOfCompany(companyId, branchId)` en `lib/branch-scope.ts`, junto a
  `resolveBranchScope`, para que la frontera de tenant y la de sucursal vivan en el mismo módulo.

- **AD-A3 — Se reutiliza `resolveBranchScope`, no se inventa un tercer helper.** El trabajo de
  `plan-branch-scope-fail-closed.md` ya introdujo `BranchScope = ALL | BRANCH | NONE` y
  `/api/expenses` ya lo usa correctamente. A5 extiende ese mismo helper a las 5 rutas ABAC en lugar
  de resolver el pinning dentro de `requirePermissionApi`, que es un cambio de superficie global.
  **Este plan no toca los call sites que ese plan ya reclama** (`cash-flow`, `reports/*`,
  `inventory/waste`); si ambos avanzan en paralelo, A5 se limita a `kpis`, `pnl`, `payables` y las dos
  de `control-interno`.

- **AD-A4 — El timbrado se persiste antes de devolverse, y la idempotencia es de base de datos.**
  Tabla nueva `cfdi_nomina_timbrados` con índice único sobre `(company_id, empleado_rfc, periodo)`.
  El folio del SAT no puede depender de un guard de cliente: se pide el timbre, se escribe la fila, y
  un segundo intento del mismo período choca contra el índice y devuelve el timbrado existente en vez
  de consumir otro folio. Es el mismo patrón que la rama actual aplicó a los extractores de workflow
  (`0055_idempotencia-extractores.sql`).

- **AD-A5 — El status del PAC se mapea, no se afirma.** `fiscal-service.ts:174` devuelve
  `status: "TIMBRADO"` fijo. Pasa a leer la respuesta real y a distinguir al menos `TIMBRADO` /
  `RECHAZADO` / `PENDIENTE`. El `uuid` sale del schema de entrada: un folio fiscal no se acepta del
  cliente.

- **AD-A6 — El rango por defecto de cortes es el mes en curso, no "todo".** Es el filtro que la
  operación usa de todos modos, y convierte una consulta sin cota en una acotada sin quitarle nada al
  usuario, que puede ampliarla desde el control del encabezado. La ruta además devuelve `total` para
  que la página pueda declarar lo que no muestra, como ya hace Control Interno.

- **AD-A7 — `?? null` en vez de `|| null` en la ingesta de cortes.** Zod ya distingue `undefined` de
  `0`; el `||` es lo único que borra la diferencia. Un cajón contado que dio cero es un dato, no una
  ausencia.

- **AD-A8 — Verificación con specs de Playwright que llaman servicios y SQL directo.** Es la
  convención del repo para lógica financiera (`corte-arqueo`, `gastos-autorizaciones`, `payee`,
  `branch-scope`), y los specs de servicio corren en segundos sin servidor ni Inngest:
  `pnpm exec playwright test --no-deps --project=chromium <spec>`. Los que tocan UI necesitan build:
  `pnpm build && PLAYWRIGHT_WEB_SERVER_CMD="npm run start" pnpm test:e2e`.

- **AD-A9 — Cada fase deja el sistema desplegable.** No hay tarea que dependa de otra fase para no
  romper. A1 y A2 pueden ir solas a producción el mismo día.

## Grafo de dependencias

```
A1  petty-cash GET deja de escribir ──────┐
                                          ├── A17 endpoint consolidado de caja chica
A3  assertBranchOfCompany ────────────────┤
     ├── A4 alcance en aprobar/rechazar
     └── (cortes y caja chica)

A2  RBAC de /dashboard/sales ─── independiente

A5  targetBranchId desde sesión ─── depende de resolveBranchScope (ya existe)

A6a schema cfdi_nomina_timbrados
     └── A6b servicio persiste + idempotencia
              └── A6c UI lee status real

A8  limit + rango por defecto en /api/sales/cuts
     └── A7 estado de error en la página de ventas   (mismo fetch, orden importa)

A9, A10, A11, A12 ─── independientes entre sí
A13..A21 ─── independientes, pulido
```

## Task List

### Fase 0 — Contención: lo que hoy escribe o expone mal
- [x] **A1** El `GET` de caja chica deja de crear fondos, y se auditan los fondos fantasma existentes
- [x] **A2** `/dashboard/sales` entra a `ROUTE_PERMISSIONS` y las 3 rutas de `/api/sales` reciben guarda de rol

### Checkpoint: Contención
- [x] Abrir Caja Chica con alcance "todas" no inserta ninguna fila
- [x] Un EMPLEADO recibe 403 en `/dashboard/sales` y en `/api/sales/cuts`
- [x] `pnpm build` limpio · specs `corte-arqueo` y el nuevo `ventas-rbac` en verde
- [x] **Revisado con David (2026-08-21)** — los fondos fantasma se dan de baja
      (`active = false`), no se borran. Aplicado a dev: 3 fondos, $15,000 fuera del saldo.
      Detalle en `tasks/todo.md`, Checkpoint: Contención.

### Fase 1 — Frontera de tenant y de sucursal
- [x] **A3** `assertBranchOfCompany` y su aplicación a las escrituras de cortes y caja chica
- [x] **A4** Aprobar y rechazar un gasto respetan la sucursal, y el `UPDATE` se guarda por status
- [x] **A5** `targetBranchId` se resuelve desde la sesión cuando el rol está fijado a una sucursal

### Checkpoint: Frontera
- [x] Un `branchId` de otra empresa se rechaza en las tres rutas de escritura
- [x] Un GERENTE de Condesa no aprueba un gasto de Polanco ni por API
- [x] Un GERENTE sin `branchId` en el query recibe su sucursal, no el grupo
- [x] Spec `branch-scope-finanzas` en verde (9/9)

### Fase 2 — El timbrado deja rastro
- [x] **A6a** Tabla `cfdi_nomina_timbrados` con índice único por `(company, rfc, periodo)`
- [ ] **A6b** `timbrarNomina` recibe `companyId`, persiste, es idempotente y mapea el status real
- [ ] **A6c** La pantalla fiscal lee el status real y recupera el último timbrado del período

### Checkpoint: Fiscal
- [ ] Timbrar dos veces el mismo período devuelve el mismo UUID y consume un solo folio
- [ ] Recargar la página después de timbrar sigue mostrando el comprobante
- [ ] Un status distinto de TIMBRADO no pinta el badge verde
- [ ] **Revisar con David** — la cancelación de CFDI queda fuera de alcance y hay que decidir si bloquea

### Fase 3 — Pantallas que afirman de más
- [ ] **A8** `/api/sales/cuts` acota por defecto al mes en curso, pagina y devuelve `total`
- [ ] **A7** La página de ventas distingue "falló" de "vacío" y no conserva filas del alcance anterior
- [ ] **A9** La ingesta de cortes deja de convertir un cero capturado en "no se capturó"
- [ ] **A10** Gastos declara el alcance aplicado, el truncamiento del historial y el caso sin sucursal
- [ ] **A11** Se elimina el código muerto de Gastos
- [ ] **A12** La notificación de gasto pendiente llega a un aprobador real

### Checkpoint: Honestidad
- [ ] Un fallo de red en Ventas muestra error con reintento, no las filas de la sucursal anterior
- [ ] Un corte con cero efectivo contado aparece en el banner de diferencias
- [ ] `pnpm lint` sin avisos en `app/dashboard/finance/expenses`
- [ ] Al crear un gasto pendiente, el aprobador recibe la notificación

### Fase 4 — Controles y consistencia
- [ ] **A13** Contrapartes y plantillas POS exigen rol para escribir y borrar
- [ ] **A14** Marcar una plantilla como default corre en transacción
- [ ] **A15** El corte duplicado por carrera devuelve el 409 que ya existe, no un 500 de Postgres
- [ ] **A16** La UI de Gastos refleja la política real de auto-aprobación

### Fase 5 — Rendimiento y pulido
- [ ] **A17** Un endpoint consolidado reemplaza el abanico de 2×N peticiones de Caja Chica
- [ ] **A18** La búsqueda de contrapartes hace debounce y cancela la petición anterior
- [ ] **A19** Cuentas por Pagar y la bitácora de Caja Chica se paginan
- [ ] **A20** Se corrigen la leyenda accesible de CxP y la confirmación de borrado de plantillas
- [ ] **A21** Se dejan de silenciar los fallos de carga de proveedores y se tipa el `catch` de Contrapartes

### Checkpoint: Completo
- [ ] Los 27 hallazgos están cerrados o explícitamente diferidos con su razón
- [ ] `pnpm build` limpio · `pnpm lint` sin errores
- [ ] Suite de specs de finanzas y ventas en verde
- [ ] `tasks/todo-auditoria-finanzas-ventas.md` sin casillas abiertas

## Risks and Mitigations

| Riesgo | Impacto | Mitigación |
|---|---|---|
| **Ya hay fondos fantasma en la base.** A1 detiene la creación pero no limpia lo escrito, y un fondo con $5,000 inventados es indistinguible de uno real que nadie ha movido. | **Alto** | A1 incluye `scripts/check-fondos-fantasma.ts`: un fondo con `currentBalance === fundAmount === 500000` y **cero transacciones** es fantasma con alta confianza. Se reporta, no se borra: la decisión de qué hacer con ellos es de David. |
| **Migración aplicada ≠ migración commiteada.** La tabla de A6a puede generar drift, y ya hay precedente en este repo. | Medio | `scripts/check-migration-drift.ts` antes y después de A6a. La migración se inspecciona a mano antes de aplicarse; nunca `db:push`. |
| **A5 choca con `plan-branch-scope-fail-closed.md`** si ambos avanzan a la vez sobre los mismos call sites. | Medio | AD-A3 acota A5 a las 5 rutas ABAC que ese plan no reclama. Si ese plan se ejecuta primero, A5 se reduce a verificar. |
| **A8 cambia el default de una pantalla en uso**: quien esperaba ver el histórico completo verá el mes. | Bajo | El control del encabezado ya escribe `startDate`/`endDate` en la URL; la página declara el alcance que está mostrando y el total que existe. |
| **A2 puede dejar fuera a un rol que hoy usa Ventas legítimamente.** | Bajo | Se copia exactamente la lista de `/dashboard/finance`, que ya se decidió con este criterio. Verificar con David si algún SUPERVISOR captura cortes. |
| **A6b toca el camino de nómina** (`payroll-service.ts` llama a la misma función). | Medio | La firma nueva agrega `companyId` como parámetro requerido: el compilador señala el call site de nómina, no se descubre en runtime. `strict: false` no protege aquí, pero un parámetro faltante sí es error de tipo. |

## Open Questions

- **A1 — ¿Qué se hace con los fondos ya creados?** ¿Se ponen en cero a la espera de que alguien
  capture el monto real, se borran los que no tienen transacciones, o se dejan y se marcan? Afecta a
  cuántas sucursales y es la única decisión de este plan que toca datos existentes.
- **A2 — ¿Un SUPERVISOR captura cortes hoy?** La lista de Finanzas lo incluye; confirmar que sea lo
  correcto también para Ventas antes de cerrar la puerta.
- **A6 — ¿La cancelación de CFDI entra a este plan?** Persistir el timbrado hace la cancelación
  *posible*; implementarla es otro alcance. Si el negocio la necesita ya, A6 crece y conviene su
  propio plan.
- **A16 — ¿Cuál es la política real de auto-aprobación?** Hoy el sistema auto-aprueba al crear si el
  rol basta, y la UI nunca deja aprobar lo propio. Ambas no pueden ser ciertas para el usuario.

## Deuda diferida (no en este plan)

- **Migrar el módulo a `hooks/queries/` (TanStack Query).** Resuelve de raíz las carreras (A17/A18
  las parchan por pantalla), el debounce y la deduplicación. **Prerrequisito bloqueante:**
  `hooks/queries/use-branches.ts:10` lee `data.branches` cuando `/api/branches` devuelve
  `{ success, data }` — devuelve `[]` siempre. Finanzas y Ventas usan el hook bueno
  (`hooks/use-branches.ts`); `app/dashboard/inventory/transfers/page.tsx:8` importa el roto. Migrar
  por nombre sin arreglarlo primero rompe la selección de sucursal en silencio.
- **Alinear los dos índices del módulo.** La portada de Finanzas lista Contrapartes y no Cuentas de
  Proveedores; el sidebar hace lo contrario. Es una línea en cada archivo, pero conviene decidir si
  ambas listas salen de una sola fuente.
- **`/api/inventory/suppliers` devuelve `{ success, suppliers }`** en vez del envelope del proyecto.
  A21 solo defiende al consumidor; corregir la ruta toca a sus otros llamadores.
