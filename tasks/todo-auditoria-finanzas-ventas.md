# Todo: Auditoría de Finanzas y Ventas

Plan: `tasks/plan-auditoria-finanzas-ventas.md`

Ninguna tarea toca más de 5 archivos. Los specs de servicio corren sin servidor ni Inngest:
`pnpm exec playwright test --no-deps --project=chromium <spec>`. Los de UI necesitan build:
`pnpm build && PLAYWRIGHT_WEB_SERVER_CMD="npm run start" pnpm test:e2e`.

---

## Fase 0 — Contención

- [x] **A1: El GET de caja chica deja de crear fondos**
  - **Description:** `getOrCreateFund` se parte en `getFund` (lectura pura) y `openFund` (recibe el
    monto entregado). El `GET /api/petty-cash` usa `getFund` y devuelve `null` si no hay fondo; la
    página ya sabe pintar ese caso. `registerOutflow`/`registerInflow` fallan con mensaje claro en vez
    de crear el fondo. Se agrega un script que reporta los fondos fantasma ya escritos.
  - **Acceptance criteria:**
    - [x] `GET /api/petty-cash?branchId=X` no ejecuta ningún `INSERT` y devuelve `null` sin fondo.
    - [x] El default de $5,000 desaparece del código; abrir un fondo exige monto explícito.
    - [x] `scripts/check-fondos-fantasma.ts` lista los fondos con `currentBalance === fundAmount === 500000` y cero transacciones, sin borrar nada.
  - **Verification:**
    - [x] Spec nuevo `tests/petty-cash-lectura-pura.spec.ts`: contar filas de `petty_cash_funds`, pegar al GET de una sucursal sin fondo, verificar que el conteo no cambió.
    - [x] `pnpm exec playwright test --no-deps --project=chromium tests/petty-cash-lectura-pura.spec.ts` — **8 passed**
    - [x] `npx tsx scripts/check-fondos-fantasma.ts` corre y reporta contra la DB de dev.
    - [x] `npx tsx scripts/baja-fondos-fantasma.ts --apply` aplicado a dev (decisión de David).
  - **Dependencies:** None
  - **Files:** `lib/services/petty-cash-service.ts`, `app/api/petty-cash/route.ts`, `app/dashboard/finance/petty-cash/page.tsx`, `scripts/check-fondos-fantasma.ts`, `tests/petty-cash-lectura-pura.spec.ts`
  - **Scope:** M
  - **Cómo quedó:**
    - `getOrCreateFund` se partió en `getFund` (lectura pura, devuelve `null`), `requireFund`
      (interno; las escrituras fallan con mensaje en español si no hay fondo) y `openFund`
      (`fundAmountCents` obligatorio, umbral por omisión 20% del fondo). La apertura corre en
      transacción y deja su propio movimiento en la bitácora: un fondo con saldo y bitácora
      vacía era justamente la huella del bug, y ahora no se vuelve a producir.
    - `POST /api/petty-cash` acepta `type: "OPEN"`. El componente de registro ganó un tercer
      modo *Abrir Fondo*; sin él, quitarle al `GET` la creación dejaba a la gerente sin ninguna
      forma de estrenar una caja.
    - **Fuera de la lista de archivos del plan:** `components/finance/petty-cash-register.tsx`
      (el modo *Abrir Fondo*) y `tests/support/db.ts` + `constants.ts` (helpers del spec).
    - La página distingue ahora "no respondió" de "no tiene fondo". Estaban conflacionados desde
      antes, pero con A1 la segunda pasa a ser el caso normal y el aviso habría gritado "no
      respondió" por cada sucursal sana. A17 se queda con la parte de agregación.
    - **Residuo consciente:** `lib/db/schema.ts:2907-2909` mantiene `.default(500000)` en las
      columnas. Es inerte —`openFund` siempre pasa valores explícitos— y quitarlo exige una
      migración `ALTER COLUMN … DROP DEFAULT` que chocaría con la numeración de A6a. Anotado
      para llevarlo junto a esa migración.

- [x] **A2: Ventas entra a la tabla de rutas y sus APIs exigen rol**
  - **Description:** Entrada de `/dashboard/sales` en `ROUTE_PERMISSIONS` con la misma lista que
    `/dashboard/finance`, y migración de `/api/sales/cuts`, `/api/sales/analytics` y
    `/api/sales/mapping-templates` de `requireTenant`/`requireAuth` a `withRoleAuth`.
  - **Acceptance criteria:**
    - [x] Un EMPLEADO recibe redirect a su dashboard al pedir `/dashboard/sales` y `/dashboard/sales/mapping`.
    - [x] Un READONLY recibe 403 en las tres rutas de API.
    - [x] Un GERENTE conserva acceso completo a las cuatro superficies.
  - **Verification:**
    - [x] Spec nuevo `tests/ventas-rbac.spec.ts`, copiando el patrón de `gastos-autorizaciones.spec.ts:94` y `:116` — **11 passed**
    - [x] `pnpm build` limpio.
  - **Dependencies:** None
  - **Files:** `lib/rbac/permissions.ts`, `app/api/sales/cuts/route.ts`, `app/api/sales/analytics/route.ts`, `app/api/sales/mapping-templates/route.ts`, `tests/ventas-rbac.spec.ts`
  - **Scope:** M
  - **Cómo quedó:**
    - Entrada `/dashboard/sales` en `ROUTE_PERMISSIONS` con la lista de Finanzas. `hasAccess`
      ordena por longitud de path, así que `/dashboard/sales/mapping` cae en la misma entrada.
    - Las tres rutas pasan a `withRoleAuth([...ROLES_VENTAS])`. El `try/catch` interior **se
      conserva a propósito**: `withRoleAuth` traduce `ApiError`, pero un `ZodError` caería a
      500 y estas rutas ya devolvían 400. `tenant.id` y `user.id` salen ahora de `auth`.
    - `READONLY_EMAIL` (diana@pulso.mx) se agregó a `tests/support/constants.ts`.

### ☑ Checkpoint: Contención
- [x] Abrir Caja Chica con alcance "todas" no inserta ninguna fila
- [x] Un EMPLEADO recibe 403 en `/dashboard/sales` y en `/api/sales/cuts`
- [x] `pnpm build` limpio · specs `corte-arqueo` (2 passed) y `ventas-rbac` (11 passed) en verde
- [x] **Revisado con David (2026-08-21)** — los fondos fantasma se dan de baja (`active = false`)

**Lo que encontró el script en la base de dev (2026-08-21):**

```
Fondos de caja chica en la base: 3
  fantasma (alta confianza): 3    ← Condesa, Polanco, Roma
  sospechosos:               0
  con actividad real:        0
Efectivo inventado que hoy suma al saldo de la cadena: $15,000.00
```

Los tres traen `$5,000.00` de fondo y de saldo, **cero movimientos**, `created_at = updated_at`
y fecha 2026-08-05. Ningún seed crea fondos de caja chica (`grep petty_cash scripts/seed-*.ts`
no devuelve nada), así que los escribió el `GET`: el 100% del saldo de caja chica que hoy
reporta la cadena es inventado. En una base de cliente el ratio será otro, pero la firma es la
misma y el script la distingue.

**Decisión tomada:** darlos de baja (`active = false`). La fila queda como evidencia de que el
sistema la escribió, el saldo inventado sale del total de la cadena, y la sucursal vuelve a
leerse como "sin fondo abierto" hasta que alguien capture el efectivo real. Es reversible.

Lo que exigió, más allá de un `UPDATE`:

- **`active` era decorativa.** Ningún consumidor la leía —`grep pettyCashFunds` da solo el
  servicio—, así que dar de baja no habría cambiado nada visible. `getFund` la filtra ahora, y
  con eso una baja significa algo: el fondo desaparece del saldo y las escrituras lo rechazan.
- **`openFund` reabre.** El índice único es por `(company, branch)` sin mirar `active`, así que
  una sucursal saneada habría quedado con la pantalla diciendo "sin fondo" y el botón chocando
  contra un conflicto invisible. Si la fila existe dada de baja, se reabre con el monto nuevo y
  el movimiento se rotula "Reapertura".
- **`scripts/baja-fondos-fantasma.ts`**, con simulacro por omisión y `--apply` explícito. Acota
  a `active = true`, así que correrlo dos veces no toca a los ya dados de baja.
- El diagnóstico ganó la categoría "ya dados de baja". Sin ella, el `updated_at` que mueve el
  propio saneo hacía que los saneados reaparecieran como "sospechosos" — el arreglo se
  delataba a sí mismo como hallazgo.

Aplicado a la base de dev: 3 fondos dados de baja, $15,000 fuera del saldo. Dos casos nuevos en
el spec cubren la baja y la reapertura (**10 passed**).

---

## Fase 1 — Frontera de tenant y de sucursal

- [x] **A3: `assertBranchOfCompany` en las escrituras**
  - **Description:** Helper en `lib/branch-scope.ts` que valida que un `branchId` pertenece al tenant
    y lanza `ApiError.badRequest` si no, siguiendo el patrón de `getPayeeForCompany`
    (`expense-service.ts:61`). Se aplica en `POST /api/sales/cuts`, `POST /api/petty-cash` y el
    `branchId` que llega al `GET` de caja chica.
  - **Acceptance criteria:**
    - [x] Un `branchId` de otra empresa se rechaza con 400 sin revelar que existe.
    - [x] Un `branchId` inexistente se rechaza igual, sin llegar a la llave foránea.
    - [x] Las escrituras válidas no cambian de comportamiento.
  - **Verification:**
    - [x] Spec nuevo `tests/frontera-tenant-sucursal.spec.ts`: sembrar dos empresas, intentar la escritura cruzada en las tres rutas.
    - [x] `pnpm build && PLAYWRIGHT_WEB_SERVER_CMD="npm run start" pnpm exec playwright test --project=chromium tests/frontera-tenant-sucursal.spec.ts` — **9 passed**
  - **Dependencies:** None (A1 toca el mismo archivo de caja chica — hacerlas en orden evita conflicto)
  - **Files:** `lib/branch-scope.ts`, `app/api/sales/cuts/route.ts`, `app/api/petty-cash/route.ts`, `tests/frontera-tenant-sucursal.spec.ts`
  - **Scope:** M

  **Cómo quedó.** El helper vive en `lib/branch-scope.ts` (AD-A2) y rechaza con un solo
  mensaje tanto "no es tuya" como "no existe", igual que `getPayeeForCompany`: distinguirlos
  le confirmaría a quien prueba ids qué sucursales tienen las demás empresas. Comprueba
  primero la **forma** del UUID, porque un id mal escrito llegaba a Postgres y volvía como
  un 500 de casteo (22P02) donde correspondía un 400.

  Dónde se aplica, que no es exactamente lo que decía el plan: en **caja chica va en el
  servicio**, no en la ruta — `openFund` (la única escritura que inserta la sucursal tal
  cual llega) y `requireFund` (retiros y reposiciones). Es lo que pide AD-A2 y además deja
  la guarda cubriendo a cualquier llamador futuro, no sólo al `POST`. En **ventas va en la
  ruta**, porque el corte se arma y se inserta en `app/api/sales/cuts/route.ts` y no hay
  servicio donde ponerla; va antes del chequeo de duplicados para no responder "ya existe un
  corte" sobre la sucursal de otra empresa. El `GET` de caja chica también valida en la
  ruta: `getFund` se queda como lectura pura, que es todo el punto de A1.

  **La fuga era real y estaba en la base de dev.** La primera corrida en rojo dejó una fila
  en `petty_cash_funds` con el `company_id` de Pulso y el `branch_id` del tenant ajeno del
  spec: la llave foránea no la detecta porque esa sucursal *existe*, sólo que no es tuya. Se
  limpió a mano. `cleanupForeignTenant` en `tests/support/db.ts` ahora borra caja chica y
  cortes por `branch_id` **sin filtrar por empresa** — filtrando por `companyId` no vería
  justo las filas cruzadas que este spec produce, el `DELETE` de la sucursal chocaría contra
  la llave foránea y el tenant ajeno quedaría vivo en dev.

  Cuatro casos pegan al servicio y corren en segundos; los otros cinco necesitan servidor
  (`/api/sales/cuts` y el `GET`), así que la verificación se corre contra el build y no con
  `--no-deps`, como decía la línea de arriba antes de corregirla.

- [x] **A4: Aprobar y rechazar respetan la sucursal**
  - **Description:** `approveOperatingExpense` y `rejectOperatingExpense` reciben el alcance de
    sucursal y lo añaden al `WHERE`, junto con `status = 'PENDING_APPROVAL'` para que el propio
    `UPDATE` sea la guarda contra dos resoluciones concurrentes.
  - **Acceptance criteria:**
    - [x] Un GERENTE de Condesa recibe 403 al aprobar o rechazar un gasto de Polanco por API.
    - [x] Un ADMIN sin sucursal fijada conserva el acceso a ambas.
    - [x] Aprobar dos veces el mismo gasto: la segunda falla con el mensaje de estado, no pisa la bitácora.
  - **Verification:**
    - [x] Casos nuevos en `tests/gastos-autorizaciones.spec.ts`, reusando su seed y el patrón de `:130`.
    - [x] `pnpm build && PLAYWRIGHT_WEB_SERVER_CMD="npm run start" pnpm exec playwright test --project=chromium tests/gastos-autorizaciones.spec.ts` — **14 passed, 8 skipped** (los `fixme` previos)
  - **Dependencies:** None
  - **Files:** `lib/services/expense-service.ts`, `app/api/expenses/approvals/route.ts`, `app/api/expenses/reject/route.ts`, `tests/gastos-autorizaciones.spec.ts`
  - **Scope:** M

  **Cómo quedó.** El alcance entra como tercer parámetro (`scope: BranchScope`), justo
  después de `companyId`, en las dos funciones. El tipo distinto del que estaba en esa
  posición hace que el compilador señale cada call site, que es lo que se quería.

  El orden de las guardas importa: el alcance se comprueba **antes** que el estado y antes
  que el rol, para no responder en qué estado está un gasto que no es tuyo. `kind: "NONE"`
  niega — es el caso para el que existe `resolveBranchScope`, y fallar abierto ahí es poder
  firmar cualquier gasto.

  El `UPDATE` repite el alcance y además exige `status = 'PENDING_APPROVAL'`. El `SELECT`
  previo da buenos mensajes pero tiene una ventana: dos aprobaciones simultáneas lo pasaban
  las dos y la segunda pisaba `approved_by` y `approval_notes`, así que la bitácora
  terminaba nombrando a quien llegó tarde. Si el `UPDATE` no devuelve fila, se lanza el
  error de "ya fue resuelto" en vez de devolver `undefined`.

  De paso, los errores de estas dos funciones pasan de `Error` pelado a `ApiError`: tal como
  estaban, "no encontrado" y "estado inválido" salían como **500**, así que la UI mostraba
  un error genérico en lugar del mensaje. El criterio pide un 403 para la sucursal ajena, y
  eso no se puede dar con un `Error` pelado.

  **Dos cosas que el plan no anticipaba.** (1) La base de dev **no tiene reglas de
  autorización sembradas**, así que `findAuthorizationRule` no encuentra ninguna, el
  aprobador exigido cae a `OWNER` y ningún GERENTE puede aprobar nada. Un caso de frontera de
  sucursal se habría negado por el rol y no habría probado nada; el spec siembra su regla
  (`seedExpenseAuthorizationRule`) y la borra en `afterAll`. (2) `sesionDe` iniciaba sesión
  en cada caso y better-auth limita `/sign-in/email` a 3 intentos cada 10 segundos —valores
  por omisión que sólo se activan con `NODE_ENV=production`, o sea al verificar contra el
  build. Se le añadió reintento sobre 429; ver el commit gemelo en `ventas-rbac`.


- [x] **A5: `targetBranchId` se resuelve desde la sesión**
  - **Description:** Las 5 rutas ABAC (`kpis`, `pnl`, `payables`, `control-interno/audit-log`,
    `control-interno/excepciones`) dejan de tratar la ausencia de `branchId` como "todas": para un rol
    fijado a sucursal, el `targetBranchId` sale de la sesión vía `resolveBranchScope`.
  - **Acceptance criteria:**
    - [x] Un GERENTE sin `branchId` en el query recibe los datos de su sucursal, no los del grupo.
    - [x] Un ADMIN sin `branchId` sigue recibiendo el grupo.
    - [x] Un rol de sucursal **sin** sucursal asignada no recibe el grupo (`kind === "NONE"`) — vacío en las listas, 403 en los agregados de dinero; ver "Cómo quedó".
  - **Verification:**
    - [x] Spec nuevo `tests/branch-scope-finanzas.spec.ts` cubriendo las cinco rutas con los tres roles — **9 passed**.
    - [x] `npx tsx scripts/check-branch-scope-drift.ts` sin regresiones (antes y después: sin deriva).
  - **Dependencies:** None. **Coordinar con `plan-branch-scope-fail-closed.md`** — si ese plan ya corrió, esta tarea se reduce a verificar.
  - **Files:** `app/api/finance/kpis/route.ts`, `app/api/finance/pnl/route.ts`, `app/api/finance/payables/route.ts`, `app/api/finance/control-interno/audit-log/route.ts`, `app/api/finance/control-interno/excepciones/route.ts`, `tests/branch-scope-finanzas.spec.ts`
  - **Scope:** M

  **Cómo quedó.** No estaba hecha: ninguna de las cinco rutas usaba
  `resolveBranchScope`. El plan de `plan-branch-scope-fail-closed.md` sólo había tocado
  `cash-flow`, `reports/*` e `inventory/waste`, tal como preveía AD-A3.

  El hueco no era pedir de más sino **no pedir nada**: las rutas pasaban el `branchId` del
  query como `targetBranchId`, así que ABAC ya daba 403 a un rol acotado que pedía la
  sucursal de otro. Pero al omitir el parámetro, el paso 2 del gate se salta y la consulta
  agregada corría sin filtro — un GERENTE que abría la pantalla sin tocar el selector veía
  las cifras de la cadena entera.

  `/api/finance/pnl` era el peor caso: ni siquiera **leía** `branchId`. Como
  `getPnLByBranch` agrega por empresa en cuatro consultas que no escalan con el número de
  sucursales, el alcance se aplica sobre el resultado en vez de multiplicar consultas, y el
  bloque `meta` se recalcula sobre lo que de verdad se devuelve: describir el grupo en la
  respuesta de una sola sucursal sería la misma mentira corrida un renglón.

  **`NONE` no devuelve lo mismo en todas.** El criterio decía "recibe vacío"; se siguió en
  cambio la convención que este repo ya fijó en `/api/finance/cash-flow`, que es más
  fail-closed y está mejor razonada. Las **listas** (`audit-log`, `excepciones`) devuelven
  vacío: "ninguna fila" se lee correctamente como ninguna. Los **agregados de dinero**
  (`kpis`, `pnl`, `payables`) devuelven **403 con mensaje**, porque un P&L en ceros afirma un
  margen operativo y un saldo en cero dice "no debes nada" — ninguna de las dos es "no hay
  datos" y las dos serían falsas sobre el dinero de alguien.

  El caso `NONE` no existe en la base sembrada y `assertBranchAssignment` impide crearlo
  desde la app, así que el spec lo fabrica quitándole la sucursal al GERENTE y la restaura en
  un `finally`; `check-branch-scope-drift.ts` confirma que quedó como estaba.

  **Cota del spec:** la comparación "sin `branchId` == pidiendo mi sucursal" es fuerte en
  `audit-log` y `pnl`, donde el fixture siembra gastos en dos sucursales y se comprueba que
  el ADMIN sí ve más de una. En `kpis` y `payables` puede pasar por empate si no hay datos
  cruzados de esas fuentes; sembrarlos exigiría facturas y ventas por sucursal.

### ☑ Checkpoint: Frontera
- [x] `branchId` de otra empresa rechazado en las tres rutas de escritura
- [x] Un GERENTE de Condesa no aprueba un gasto de Polanco ni por API
- [x] Un GERENTE sin `branchId` en el query recibe su sucursal, no el grupo
- [x] `pnpm build` limpio · `branch-scope-finanzas` 9/9 y `frontera-tenant-sucursal` 9/9 en verde
      (suite completa de Fase 1: **55 passed, 8 skipped** — los `fixme` previos de gastos)

---

## Fase 2 — El timbrado deja rastro

- [x] **A6a: Tabla `cfdi_nomina_timbrados`**
  - **Description:** Tabla nueva en `lib/db/schema/` con `companyId`, `empleadoRfc`, `empleadoNombre`,
    `periodo`, `uuid`, `status`, `cadenaOriginal`, `selloDigital`, `totalPercepcionesCents`,
    `totalDeduccionesCents`, `rawResponse`, `timbradoPor`, `fechaTimbrado`. Índice único sobre
    `(company_id, empleado_rfc, periodo)`.
  - **Acceptance criteria:**
    - [x] La tabla existe con el índice único y `companyId` con FK a `companies`.
    - [x] La migración es generada, inspeccionada a mano y aplicada — nunca `db:push`.
  - **Verification:**
    - [x] `pnpm db:generate` produce SQL revisable; `check-migration-drift` limpio antes y después de `pnpm db:migrate` (57 → 58 aplicadas).
  - **Dependencies:** None
  - **Files:** `lib/db/schema/` (módulo fiscal), `drizzle/00XX_cfdi-nomina-timbrados.sql`, `drizzle/meta/*`
  - **Scope:** S

  **Cómo quedó.** La tabla vive en `lib/db/schema/finance.ts` (el módulo que ya tenía
  `cash_flow_assumptions`), con el enum `cfdi_timbrado_status` en
  `TIMBRADO | PENDIENTE | RECHAZADO | ERROR` — AD-A5 pedía distinguir al menos los tres
  primeros; `ERROR` ya existía en el tipo del servicio.

  **`uuid` quedó nullable**, y no es un descuido: un intento **rechazado** no tiene folio, y
  es justamente el que hay que poder guardar para no repetirlo a ciegas. Eso define la
  semántica de A6b: el índice único es por `(company, rfc, periodo)`, así que un reintento
  sobre una fila que no quedó en `TIMBRADO` **actualiza** esa fila, y una que sí se devuelve
  tal cual sin volver a llamar al PAC. Si el índice fuera del folio, un rechazo bloquearía el
  reintento legítimo.

  La migración se renombró a mano a `0056_cfdi-nomina-timbrados.sql` (drizzle la generó como
  `0056_slim_ezekiel_stane`), con su entrada del `_journal.json` actualizada, siguiendo la
  convención de nombres descriptivos del repo.

  **Se aprovechó para saldar la deuda de A1**: los `.default(500000)` / `.default(100000)` de
  `petty_cash_funds` salen del esquema en esta misma migración (tres `ALTER COLUMN … DROP
  DEFAULT`). Eran inertes —`openFund` siempre pasa valores explícitos— pero eran el monto que
  el sistema inventaba, y el criterio de A1 pedía que desaparecieran del código. Se llevaron
  juntos porque un `DROP DEFAULT` suelto habría chocado con la numeración de esta migración.
  `petty-cash-lectura-pura` sigue en verde (11/11) después del cambio.

- [x] **A6b: El servicio persiste, es idempotente y dice el status real**
  - **Description:** `timbrarNomina` recibe `companyId` y `performedBy`. Antes de llamar al PAC busca
    un timbrado existente para `(company, rfc, periodo)` y lo devuelve si existe. Después de timbrar,
    escribe la fila; el índice único es la red si dos peticiones corren a la vez. El `status` se mapea
    de la respuesta del PAC en vez de afirmarse. `uuid` sale del schema de entrada de la ruta.
  - **Acceptance criteria:**
    - [x] Dos llamadas al mismo `(company, rfc, periodo)` devuelven el mismo UUID y consumen un solo folio.
    - [x] La respuesta del PAC decide el `status`; un rechazo no se guarda como `TIMBRADO`.
    - [x] `payroll-service.ts` compila con la firma nueva y sigue guardando su payslip.
    - [x] El body de la ruta ya no acepta `uuid`.
  - **Verification:**
    - [x] Spec nuevo `tests/timbrado-idempotente.spec.ts` con el PAC mockeado, contando llamadas salientes.
    - [x] `pnpm exec playwright test --no-deps --project=chromium tests/timbrado-idempotente.spec.ts` — **6 passed**
    - [x] `pnpm build` limpio (el call site de nómina lo señaló el compilador, como preveía el riesgo del plan).
  - **Dependencies:** A6a
  - **Files:** `lib/services/fiscal-service.ts`, `app/api/finance/fiscal/timbrar-nomina/route.ts`, `lib/services/payroll-service.ts`, `tests/timbrado-idempotente.spec.ts`
  - **Scope:** M

  **Cómo quedó.** `timbrarNomina` recibe `companyId` y `performedBy`, busca la fila del
  período antes de llamar al PAC y **sólo corta si está en `TIMBRADO`**. Un intento que quedó
  en `RECHAZADO` o `PENDIENTE` sí se reintenta y actualiza su fila
  (`onConflictDoUpdate` sobre el índice único), que es la razón de que el índice sea por
  período y no por folio.

  El `setWhere` del upsert es `status <> 'TIMBRADO'`: si dos peticiones corren a la vez y una
  ya dejó el período timbrado, la otra **no la pisa** con su propio intento — se quedaría el
  comprobante equivocado en la fila. Cuando ese `setWhere` bloquea el `UPDATE` no hay
  `RETURNING`, así que el perdedor relee la fila ganadora y devuelve esa.

  **El mapeo de status no adivina.** `mapPacStatus` traduce lo que el PAC reporta; si el PAC
  no manda `status` —el contrato no lo promete— la regla es pedir evidencia: un folio **con
  sello** es un timbre, y cualquier otra cosa queda `PENDIENTE`. Nunca `TIMBRADO` por
  omisión, que es justo lo que hacía la versión anterior. Un HTTP no-ok se guarda como
  `RECHAZADO` con el cuerpo del error antes de relanzar: sin esa fila, el siguiente intento
  repite la petición a ciegas y nadie sabe qué contestó el PAC.

  `uuid` salió del schema de entrada y del cuerpo que se manda al PAC: un folio fiscal lo
  asigna el SAT, no quien llama a la API.

  **Nota de método:** a diferencia de A3/A4/A5, aquí no hubo corrida en rojo previa — el spec
  y la implementación aterrizaron juntos, porque los seis casos dependen de una tabla que no
  existía hasta A6a y de una firma que no compilaba. Los casos siguen siendo significativos
  (cuentan llamadas salientes al PAC), pero no se observó el rojo.

- [x] **A6c: La pantalla fiscal deja de afirmar el timbrado**
  - **Description:** El badge lee `timbradoResult.status` en vez de pintar "TIMBRADO" fijo, y la
    pantalla puede recuperar el timbrado existente de un período ya timbrado en vez de depender del
    estado de React.
  - **Acceptance criteria:**
    - [x] Un status distinto de `TIMBRADO` no pinta el badge verde.
    - [x] Recargar la página tras timbrar sigue mostrando UUID y fecha del comprobante.
    - [x] Reintentar un período ya timbrado avisa que existe, en vez de ofrecer timbrar de nuevo.
  - **Verification:**
    - [x] En vez de sólo manual: cuatro casos de API sobre el `GET` nuevo en `tests/timbrado-idempotente.spec.ts` (describe `A6c`). El pintado del badge sí queda como revisión de código.
    - [x] `pnpm build` limpio.
  - **Dependencies:** A6b
  - **Files:** `app/dashboard/finance/fiscal/page.tsx`, `app/api/finance/fiscal/timbrar-nomina/route.ts`
  - **Scope:** S

  **Cómo quedó.** El badge sale de una tabla `ESTADO_TIMBRADO` que mapea el status del PAC a
  etiqueta, tono e ícono: verde sólo para `TIMBRADO`, ámbar para `PENDIENTE`, rojo para
  `RECHAZADO` y `ERROR`, y un tono de aviso para un status que no reconozca — nunca verde por
  omisión, que es lo que hacía antes.

  Para que recargar no borre el comprobante hacía falta poder leerlo: se agregó
  **`GET /api/finance/fiscal/timbrar-nomina?empleadoRfc=…&periodo=…`** (permiso `read`, no
  `manage`) sobre `getTimbrado`. La pantalla lo consulta cuando RFC y período están
  completos, con **debounce de 400 ms y `AbortController`**: se teclea letra por letra, y sin
  cancelar la anterior una respuesta lenta puede pisar a una más nueva — la misma clase de
  carrera que A18 arregla en Contrapartes.

  **`isLocked` pasó de `timbradoResult !== null` a `status === "TIMBRADO"`.** Antes, un
  rechazo bloqueaba el formulario igual que un timbre bueno, así que no se podía reintentar
  desde la pantalla; ahora sólo cierra el período un timbre válido, que es la misma semántica
  que A6b le dio al servicio. Como consecuencia, `handleNominaChange` limpia
  `timbradoResult`: con el formulario abierto tras un rechazo, cambiar de RFC dejaba en
  pantalla el comprobante del anterior.

  **La verificación no se quedó en manual.** El plan pedía revisión a ojo; en su lugar hay
  cuatro casos de API sobre el `GET` nuevo (`A6c` en `tests/timbrado-idempotente.spec.ts`),
  que es el mecanismo del que dependen los tres criterios: recuperar un período timbrado,
  recuperar uno rechazado **sin** presentarlo como timbre, `null` para uno sin timbrar, y 400
  si falta RFC o período. Lo que sigue siendo sólo revisión de código es el pintado del badge
  en sí.

### ☑ Checkpoint: Fiscal
- [x] Timbrar dos veces el mismo período devuelve el mismo UUID y un solo folio consumido
- [x] Recargar después de timbrar sigue mostrando el comprobante
- [x] Un status distinto de TIMBRADO no pinta verde
- [x] **Revisado con David (2026-08-21)** — la cancelación de CFDI **va a su propio plan** y no
      bloquea el cierre. A6 la dejó *posible* (antes no había fila que cancelar: el timbrado no
      se persistía) y ése era el punto correcto donde parar. Implementarla requiere el endpoint de
      cancelación del PAC, los motivos SAT (01–04), la mecánica de acepta/rechaza del receptor y
      decidir qué pasa con el payslip ya emitido. Timbrado 11/11, suite de finanzas y ventas
      65 passed / 8 skipped.

---

## Fase 3 — Pantallas que afirman de más

- [x] **A8: `/api/sales/cuts` acota, pagina y declara el total**
  - **Description:** Sin `startDate`/`endDate` la ruta usa el mes en curso. Añade `limit`/`offset` con
    tope, y devuelve `{ items, total, scope }` en vez de un arreglo pelado.
  - **Acceptance criteria:**
    - [x] Una petición sin fechas devuelve solo el mes en curso y lo declara en `scope.rangoPorDefecto`.
    - [x] `total` refleja las filas que existen en el rango, no las devueltas.
    - [x] La página consume la forma nueva sin romper el banner de diferencias ni la conciliación (el caso de UI previo de `corte-arqueo` sigue verde).
  - **Verification:**
    - [x] Spec nuevo `tests/cortes-cota.spec.ts`: 12 cortes en el mes en curso y 7 en el anterior, sobre una sucursal propia.
    - [x] `cortes-cota` **6 passed**. Necesita servidor: pega a la ruta con sesión.
  - **Dependencies:** None
  - **Files:** `app/api/sales/cuts/route.ts`, `app/dashboard/sales/page.tsx`, `tests/cortes-cota.spec.ts`
  - **Scope:** M

  **Cómo quedó.** Rango por defecto = mes en curso, calculado con `localDateString` de
  `lib/workflows/today.ts` y **no** con `toISOString()`: en UTC-6, después de las 6pm, el
  primer día del mes se corre uno. `limit` por defecto 100, tope 500, y tanto un `limit`
  desmedido como uno basura (`?limit=abc`) se recortan en vez de tumbar la consulta.

  La respuesta pasa de arreglo pelado a `{ items, total, scope }`. `total` se cuenta aparte
  con `count()` sobre las mismas condiciones: son las filas que **existen** en el rango, no
  las devueltas, que es lo que permite decir "muestro 100 de 342".

  **Un efecto secundario que había que atender:** la etiqueta de alcance de la página decía
  "todo el período" cuando no había fechas. Con A8 la ruta acota al mes en curso, así que esa
  frase se habría vuelto **falsa justo en el caso por omisión** — el pecado que esta fase
  existe para corregir. Ahora se lee de `scope`, que es el rango que de verdad se aplicó, y
  añade "(mes en curso)" cuando lo puso la ruta. Con `truncated` se avisa cuántos se ven de
  cuántos hay, como ya hace Control Interno.

  **Cota del spec:** usa una sucursal `[E2E]` propia. `total` cuenta todas las filas del
  rango, así que sobre una sucursal sembrada —donde otros specs escriben— los conteos
  exactos serían una lotería.

- [x] **A7: Ventas distingue "falló" de "vacío"**
  - **Description:** Estado `error` con `EmptyState` y reintento, como en las otras nueve pantallas.
    `setCuts([])` en el fallo para que un error tras cambiar de sucursal no deje las filas anteriores
    bajo la etiqueta de alcance nueva.
  - **Acceptance criteria:**
    - [x] Un fallo de red muestra error con botón de reintento, no una tabla vacía ni una tabla vieja.
    - [x] Tras un fallo, no quedan filas del alcance anterior.
    - [x] El banner de diferencias no nombra sucursales fuera del alcance (se vacía junto con las filas).
  - **Verification:**
    - [x] Dos casos nuevos en `tests/corte-arqueo.spec.ts` interceptando con `page.route` y devolviendo 500.
    - [x] El segundo caso lo automatiza: filas visibles, luego 500, y se comprueba que no sobreviva ninguna.
  - **Dependencies:** A8 (mismo `fetch`; hacerlo después evita rehacer el parseo)
  - **Files:** `app/dashboard/sales/page.tsx`, `tests/corte-arqueo.spec.ts`
  - **Scope:** S

- [x] **A9: Un cero capturado deja de ser "no capturado"**
  - **Description:** `?? null` en lugar de `|| null` para `cashSales`, `cardSales`, `otherPayments`,
    `cashCountedCents`, `depositedCents` y `ticketCount` en el `INSERT` de cortes.
  - **Acceptance criteria:**
    - [x] Un corte con `cashSales: 0` se guarda con cero, no con `null`.
    - [x] Ese corte aparece en el banner de diferencias si el arqueo no cuadra (`computeCashVariance` deja de devolver `null`).
    - [x] Un campo omitido sigue guardándose como `null`.
  - **Verification:**
    - [x] Dos casos nuevos en `tests/corte-arqueo.spec.ts`: el cero capturado y la ausencia.
    - [x] `corte-arqueo` **4 passed** (los 2 previos + los 2 nuevos). Necesita servidor: los casos pegan a la ruta real.
  - **Dependencies:** None
  - **Files:** `app/api/sales/cuts/route.ts`, `tests/corte-arqueo.spec.ts`
  - **Scope:** S

  **Cómo quedó.** Seis campos pasaron de `|| null` a `?? null`. El caso que lo hace algo más
  que cosmético: `computeCashVariance` (`lib/sales/cash-variance.ts:32`) devuelve `null` si
  falta **cualquiera** de los dos lados, así que un turno que declaró $0 de efectivo y contó
  dinero en el cajón —una venta en efectivo que nadie registró— se guardaba con `cash_sales`
  en `null` y **desaparecía del banner de diferencias** en vez de saltar como sobrante. El
  spec lo prueba justo así, y el caso gemelo comprueba que `??` no convierta una ausencia en
  cero, que sería inventar un dato igual de falso.

- [x] **A10: Gastos declara su alcance, su cota y el caso sin sucursal**
  - **Description:** La página ya recibe `scope` y `truncated` y no los pinta. Se rotula el alcance
    aplicado, se avisa cuando el historial viene acotado —como ya hace Control Interno
    (`control-interno/page.tsx:542`)— y se distingue `scope.kind === "NONE"` ("tu usuario no tiene
    sucursal asignada") del vacío genérico.
  - **Acceptance criteria:**
    - [x] Con historial acotado, la pantalla lo dice y aclara que la cola de pendientes va completa.
    - [x] Se rotula el alcance **aplicado**, no el pedido.
    - [x] `kind === "NONE"` muestra "Tu usuario no tiene una sucursal asignada", no el vacío genérico.
  - **Verification:**
    - [x] Se convirtió el `test.fixme` "el alcance aplicado se rotula en pantalla" en un caso real.
    - [x] `gastos-autorizaciones` **16 passed** (14 previos + los 2 `fixme` cerrados).
  - **Dependencies:** None
  - **Files:** `app/dashboard/finance/expenses/page.tsx`, `tests/gastos-autorizaciones.spec.ts`
  - **Scope:** S

- [x] **A11: Código muerto fuera de Gastos**
  - **Description:** Eliminar `PUEDEN_CAPTURAR`, `localDateString`, `addCalendarDays` y `focusId`. Si
    `PUEDEN_CAPTURAR` debía condicionar `ExpenseForm`, se cablea; si no, se borra. `dueDate` se
    muestra o se saca de la interfaz — hoy es lo que decide si un gasto está vencido y no se ve.
  - **Acceptance criteria:**
    - [x] `pnpm lint` sin avisos de variables sin usar en el archivo.
    - [x] La decisión sobre `PUEDEN_CAPTURAR` y `dueDate` queda escrita en el código.
  - **Verification:**
    - [x] `pnpm exec eslint app/dashboard/finance/expenses --ext .tsx,.ts` limpio.
  - **Dependencies:** A10 (mismo archivo)
  - **Files:** `app/dashboard/finance/expenses/page.tsx`
  - **Scope:** XS

- [x] **A12: La notificación de gasto pendiente llega a alguien**
  - **Description:** `createOperatingExpense` notifica con `userId: input.companyId`
    (`expense-service.ts:108`), que no es un id de usuario: `getUserPreferences` no lo encuentra y
    retorna sin enviar nada. Se resuelven los usuarios con el rol aprobador requerido en la empresa
    (y la sucursal, si aplica) y se les notifica a cada uno.
  - **Acceptance criteria:**
    - [x] Al crear un gasto pendiente, los usuarios con el rol requerido reciben la notificación.
    - [x] Sin ningún usuario con ese rol, se registra un warning explícito con empresa y sucursal.
    - [x] El `actionUrl` pasa de `?id=` a `?focus=<id>`, que es el que la pantalla sabe resaltar.
  - **Verification:**
    - [x] Spec nuevo `tests/gasto-notifica-aprobador.spec.ts`, **3 passed**.
    - [x] Corre sin servidor: llama al servicio y lee `notifications`.
  - **Dependencies:** None
  - **Files:** `lib/services/expense-service.ts`, `tests/gasto-notifica-aprobador.spec.ts`
  - **Scope:** S

### ☑ Checkpoint: Honestidad
- [x] Un fallo de red en Ventas muestra error con reintento, sin filas del alcance anterior
- [x] Un corte con cero efectivo contado aparece en el banner de diferencias
- [x] `pnpm lint` sin avisos en `app/dashboard/finance/expenses`
- [x] El aprobador recibe la notificación de un gasto pendiente
      (suite completa de la auditoría: **80 passed, 6 skipped** — dos `fixme` menos que antes)

---

## Fase 4 — Controles y consistencia

- [x] **A13: Contrapartes y plantillas POS exigen rol**
  - **Description:** `POST`/`DELETE /api/finance/payees` y `PUT`/`DELETE
    /api/sales/mapping-templates/[id]` pasan a `withRoleAuth` con la lista de Finanzas. Son las
    últimas rutas del módulo en `lib/tenant-context.ts` sin guarda de rol.
  - **Acceptance criteria:**
    - [x] Un EMPLEADO recibe 403 al crear, leer o dar de baja una contraparte.
    - [x] Un EMPLEADO recibe 403 al borrar o editar una plantilla POS.
    - [x] Los roles de finanzas conservan el comportamiento actual (casos de GERENTE en ambos specs).
  - **Verification:**
    - [x] Casos nuevos en `tests/payee.spec.ts` (4) y `tests/ventas-rbac.spec.ts` (3).
  - **Dependencies:** A2 (comparte el spec de ventas)
  - **Files:** `app/api/finance/payees/route.ts`, `app/api/finance/payees/[id]/route.ts`, `app/api/sales/mapping-templates/[id]/route.ts`, `tests/payee.spec.ts`
  - **Scope:** S

- [x] **A14: `isDefault` en transacción**
  - **Description:** El `PUT` limpia `isDefault` de todas las plantillas y después actualiza la
    objetivo. Sin transacción, un fallo en el segundo paso deja a la empresa sin plantilla default y
    rompe la autodetección de archivos POS.
  - **Acceptance criteria:**
    - [x] Un `PUT` con id inexistente no deja a la empresa sin default.
    - [x] Marcar una plantilla como default sigue desmarcando exactamente a las demás.
  - **Verification:**
    - [x] Dos casos en `tests/ventas-rbac.spec.ts` (describe `A13/A14`).
  - **Dependencies:** None
  - **Files:** `app/api/sales/mapping-templates/[id]/route.ts`
  - **Scope:** XS

- [x] **A15: El corte duplicado por carrera devuelve 409**
  - **Description:** El pre-`SELECT` da un 409 con mensaje en español, pero dos envíos simultáneos lo
    pasan los dos y el segundo choca contra `daily_sales_cut_unique` como 500 crudo. Se usa
    `onConflictDoNothing().returning()` y se traduce el resultado vacío al mismo 409.
  - **Acceptance criteria:**
    - [x] Dos `POST` concurrentes: uno crea, el otro recibe 409 con el mensaje legible.
    - [x] Ninguno de los dos produce un 500.
  - **Verification:**
    - [x] Spec nuevo `tests/corte-duplicado.spec.ts`, **2 passed**.
  - **Dependencies:** None
  - **Files:** `app/api/sales/cuts/route.ts`, `tests/corte-duplicado.spec.ts`
  - **Scope:** S

  **Cómo quedó (A13/A14/A15).** A13 resultó ser una fuga de **A2 a medias**: A2 cerró
  `/dashboard/sales/mapping` y la ruta de colección, pero `PUT`/`DELETE` de
  `mapping-templates/[id]` seguía abierta — un EMPLEADO no podía *crear* una plantilla y sí
  podía **editar o borrar la que ya existía**, que es la que decide cómo se ingesta la venta.
  En contrapartes se cerró también el `GET`: sus dos únicos consumidores (la pantalla de
  Contrapartes y el formulario de gasto) viven bajo `/dashboard/finance`, que admite
  exactamente esos cuatro roles, así que nadie legítimo se queda fuera y deja de exponerse el
  catálogo completo de proveedores.

  A14 iba en el mismo `PUT`, así que se hizo junto: los dos pasos entran en `db.transaction`
  y el `throw` de "no encontrada" ocurre **dentro**, de modo que deshace el `isDefault` que ya
  se había limpiado. Antes, un id inexistente dejaba a la empresa sin ninguna plantilla
  default y con eso muere la autodetección de archivos POS.

  A15 usa `onConflictDoNothing` sobre las cinco columnas de `daily_sales_cut_unique` y
  traduce el resultado vacío al mismo 409 legible que da el pre-`SELECT`. El pre-`SELECT` se
  queda: no había que sustituirlo, sólo cubrir su ventana.

  **Dos cosas que aparecieron de paso.** (1) `deleteTestBranch` no borraba los cortes de la
  sucursal, y `deleteTestSalesCuts()` sólo ve los que llevan la etiqueta en
  `validation_notes` — que un spec que escribe **por la API** no controla. La limpieza
  chocaba contra la llave foránea. Es la misma clase de bug que ya se había corregido en
  `cleanupForeignTenant` durante A3. (2) `tests/payee.spec.ts` tenía un **rojo preexistente**,
  anterior a esta sesión: la pantalla abre en la cola de pendientes desde otro plan, y sin
  reglas de autorización sembradas un gasto creado por SUPER_ADMIN nace auto-aprobado, así que
  su fila no estaba en esa cola. Se le añadió el cambio de filtro al test.

- [x] **A16: La UI refleja la política real de auto-aprobación**
  - **Description:** `createOperatingExpense` auto-aprueba cuando el rol basta para la regla, y
    `approveOperatingExpense` solo bloquea la auto-resolución cuando hay umbral (`minAmount > 0`). La
    UI, en cambio, esconde el botón para el propio gasto siempre. Se alinea la UI con la política
    real, o se cambia la política — **decisión de producto, ver Open Questions del plan**.
  - **Acceptance criteria:**
    - [x] La condición de la UI y la del servicio se derivan de la misma regla.
    - [x] El comentario de `renderApproveAction` describe lo que el código hace.
  - **Verification:**
    - [x] Casos nuevos en `tests/gastos-autorizaciones.spec.ts` para gasto con umbral y sin umbral.
  - **Dependencies:** A4 (mismo servicio). **Bloqueada por decisión de producto.**
  - **Files:** `app/dashboard/finance/expenses/page.tsx`, `lib/services/expense-service.ts`, `tests/gastos-autorizaciones.spec.ts`
  - **Scope:** S
  - **Cómo quedó:** **Decidido con David (2026-08-21): gana la segregación de funciones.** De las
    tres opciones (que ganara el servidor, que ganara la UI, o un umbral que auto-aprobara lo chico)
    se eligió la que el sistema ya afirmaba tener. Consecuencias:
    (1) La regla vive en **`lib/expenses/approval-policy.ts`**, un módulo puro sin `db` ni schema
    para que el servicio y el componente cliente la importen **los dos** en vez de mantener copias.
    Devuelve un motivo (`"ROLE" | "SELF" | null`), no un booleano: la pantalla contestaba
    "Requiere OWNER" a quien registró el gasto, que se lee como falta de rango cuando lo que pasa es
    que nadie firma lo suyo. Ahora dice "Lo registraste tú".
    (2) `createOperatingExpense` **ya no auto-aprueba**: `initialStatus` es constante y `userRole`
    salió de `CreateExpenseInput` (y del call site en `app/api/expenses/route.ts`) porque ya no
    decide nada. Con él se fue la rama de `approvalNotes` que escribía "Auto-aprobado según regla".
    (3) El carve-out `minAmount > 0` de `approveOperatingExpense` desapareció — dejaba pasar
    justamente el tramo bajo, donde vive la mayoría de los gastos de una sucursal.
    (4) **`rejectOperatingExpense` no comprobaba nada.** No estaba en el hallazgo: quien registraba
    un gasto podía cerrarlo como rechazado y sacarlo de la cola sin que ningún aprobador lo viera.
    Ahora pasa por la misma regla, que es lo que la UI ya suponía al esconder los dos botones juntos.
    (5) Los dos `throw new Error` de autoridad pasaron a `ApiError.forbidden`: caían a 500 donde el
    caso es 403, y `assertScopeCoversBranch` ya devolvía 403 al lado.
    (6) **`findApprovers` excluye a `requestedBy`.** Es consecuencia directa: avisarle "pendiente de
    tu aprobación" a quien ya no puede aprobarlo lleva a una fila sin botón y enseña a ignorar los
    avisos. Mismo criterio que A12 usó para los roles de otra sucursal. El `console.warn` de "nadie
    recibirá la notificación" ahora también cubre el caso de que el único con rol sea quien lo pidió.
    (7) Código muerto que se llevó por delante: la rama `status === "APPROVED"` del toast de
    `expense-form.tsx` ("El gasto ha sido auto-aprobado exitosamente"), inalcanzable desde (2).
  - **⚠️ Consecuencia operativa que hay que revisar con David.** La segregación de funciones tiene
    un supuesto: que exista alguien más con autoridad suficiente. En la base de dev **no lo hay** —
    al correr los specs saltó el aviso del servicio: *"no hay ningún usuario distinto de quien lo
    registró con rol >= OWNER"*. Sin reglas de autorización sembradas el aprobador exigido cae a
    `OWNER`, y si el dueño es el único con ese rango, **sus propios gastos quedan atrapados en
    PENDING_APPROVAL para siempre**: nadie puede firmarlos y no entran a Cuentas por Pagar, que
    sólo lista lo autorizado. En un grupo de 3 sucursales donde el dueño captura y firma, eso es
    la pantalla entera bloqueada. Dos salidas, ninguna implementada aquí porque es decisión de
    producto: sembrar reglas de autorización con `approver_role` alcanzable por más de una persona
    (`GERENTE`, p. ej.), o dar de alta un segundo aprobador por empresa. El `console.warn` ya lo
    dice en voz alta; lo que falta es decidir cuál de las dos.
  - **Specs:** 6 casos nuevos en `gastos-autorizaciones` (A16 · segregación de funciones) — nace
    pendiente con y sin umbral, quien registra no aprueba ni rechaza lo suyo en ninguno de los dos
    tramos, y otra persona sí resuelve. En `gasto-notifica-aprobador`, el caso "un gasto
    auto-aprobado no genera aviso" describía conducta que dejó de existir: se reemplazó por "quien
    registra el gasto no se avisa a sí mismo", que es el invariante que sí quedó. **9 passed.**
  - **Comentarios corregidos porque quedaron mintiendo:** `tests/support/db.ts` (el `minAmount: 0`
    ya no esquiva ningún carve-out) y `tests/payee.spec.ts` (el gasto ya no nace auto-aprobado; el
    cambio de filtro sigue siendo necesario por otra razón).

---

## Fase 5 — Rendimiento y pulido

- [x] **A17: Endpoint consolidado de Caja Chica**
  - **Description:** `GET /api/petty-cash/consolidado?branchId=` devuelve el agregado más las filas
    por sucursal y los movimientos paginados, en una consulta. Reemplaza el abanico de 2×N peticiones
    del cliente (30 con 15 sucursales, cada una pasando por rate limiting y verificación de sesión).
    El aviso de sucursales que no respondieron pasa a distinguir el fallo real de la ausencia de fondo.
  - **Acceptance criteria:**
    - [x] La página hace una sola petición con alcance "todas".
    - [x] El orden por urgencia y el conteo bajo umbral salen del servidor.
    - [x] "No respondió" y "no tiene fondo" son dos mensajes distintos.
  - **Verification:**
    - [x] Spec nuevo `tests/caja-chica-consolidado.spec.ts` comparando el agregado contra SQL directo.
    - [x] Contar peticiones con `page.on("request")` en el caso de UI.
  - **Dependencies:** A1
  - **Files:** `app/api/petty-cash/consolidado/route.ts`, `lib/services/petty-cash-service.ts`, `app/dashboard/finance/petty-cash/page.tsx`, `tests/caja-chica-consolidado.spec.ts`
  - **Scope:** M
  - **Cómo quedó:** `getPettyCashConsolidado(companyId, scope, opts)` resuelve todo en **tres
    consultas fijas** —fondos por sucursal, movimientos acotados y su conteo— sin importar cuántas
    sucursales haya. La pieza que lo hace posible es un `LEFT JOIN` de `branches` contra
    `petty_cash_funds`: mandan las sucursales, no los fondos, así que la sucursal **sin fondo
    abierto** sale en el mismo resultado como fila con `fund_id` nulo.
    **La tercera casilla se cerró por sustracción, no por un mensaje nuevo.** A1 ya había separado
    "no respondió" de "no tiene fondo" en la pantalla; con una sola petición el primer estado deja
    de existir —falla entera o no falla— así que "no respondió" pasa a ser el estado de error de la
    página y no una nota al pie del saldo. Se borró el banner de sucursales inalcanzables y el
    estado que lo alimentaba.
    El orden por urgencia y el conteo bajo umbral se mudaron al servicio: son la respuesta a "¿a
    dónde mando dinero?" y no pueden depender de qué respuestas llegaron primero. El umbral sigue
    sin ser aditivo — se cuenta cuántas sucursales están bajo el suyo, no se suman los umbrales.
    `fetchData` dejó de depender de `branches`: pide en cuanto monta, en vez de esperar a que el
    hook de sucursales resuelva para recién entonces abrir el abanico. La ruta devuelve el `scope`
    que aplicó, como A10 en Gastos.
  - **Fuera del alcance escrito, incluido a propósito (1):** `/api/petty-cash/transactions` tomaba
    `branchId` del query sin pasarlo por la sesión. La frontera de **empresa** sí estaba (el
    servicio filtra por `company_id`); la de **sucursal** no: un GERENTE de Condesa podía leer la
    bitácora de efectivo de Polanco, y sin `branchId` recibía la cadena entera. Se le aplicó
    `resolveBranchScope` con `NONE` negando, igual que el resto del módulo. Se hizo aquí porque
    A17 deja esa ruta sin llamadores en la pantalla, y una ruta sin uso con un hueco de alcance es
    peor que una en uso: nadie la mira.
  - **Fuera del alcance escrito, incluido a propósito (2) — el que más importa:**
    **elegir "Todas" en el encabezado no aguantaba, en ninguna pantalla del producto.**
    Lo destapó el caso que cuenta peticiones: la pantalla se pintaba consolidada y un instante
    después volvía a una sola sucursal. No era una carrera, era determinista.
    La cadena: `setBranches` de `lib/branch-context.tsx` es un `useCallback` que depende de
    `selectedBranchId`, así que **cada cambio de alcance le da identidad nueva**; el efecto de
    `components/nav-company.tsx:62` lo tiene en sus dependencias y vuelve a llamarlo; y al entrar
    con `selectedBranchId === null` la rama "si no hay sucursal elegida, toma la primera" reponía
    una sucursal. El `null` significaba dos cosas incompatibles —"todavía no se sabe" y "todas"— y
    la segunda perdía siempre.
    La corrección distingue las dos: un `alcanceElegido` que `setSelectedBranchId` levanta, para
    que la autoselección sea una **sugerencia inicial** y no una corrección de lo que el usuario
    acaba de decidir. El caso de UI lo sostiene con una aserción después del margen de espera:
    sin el arreglo, a esa altura la pantalla ya rebotó.
    Se corrigió aquí porque dejaba inalcanzable justo lo que A17 construye —la vista de cadena—,
    pero **afecta a todas las pantallas que usan `BranchScopeControl`**, así que conviene mirarlo
    con ojos de regresión.
    **Lo que no se tocó:** "Todas" sigue sin sobrevivir a un recargado. El alcance se guarda en
    la cookie `pulso_selected_branch`, que para "todas" se **borra**, y al montar sin cookie el
    contexto vuelve a autoseleccionar. Persistir un centinela cambiaría también a los lectores del
    lado del servidor; queda anotado, no hecho.
  - **Ajuste menor que A17 volvió necesario:** el orden de `const error = branchesError ?? fundError`
    se invirtió. Las sucursales iban primero porque sin ellas no había a quién pedirle el fondo —la
    pantalla armaba el abanico a partir de esa lista—. Ahora el consolidado lo resuelve el servidor
    y `branches` sólo alimenta el diálogo de registro, así que el fallo que le importa a quien mira
    el saldo es el del saldo.

- [x] **A18: Debounce y cancelación en Contrapartes**
  - **Description:** La búsqueda dispara un `fetch` con `ILIKE` por tecla y la última respuesta en
    llegar gana, que no es necesariamente la del texto actual. Debounce de ~300 ms y `AbortController`.
  - **Acceptance criteria:**
    - [x] Escribir "Inmobiliaria" produce una petición, no trece.
    - [x] La respuesta de una búsqueda abandonada no pisa la lista.
  - **Verification:**
    - [x] Caso nuevo en `tests/payee.spec.ts` contando peticiones con `page.on("request")`.
  - **Dependencies:** None
  - **Files:** `app/dashboard/finance/payees/page.tsx`, `tests/payee.spec.ts`
  - **Scope:** S
  - **Cómo quedó:** Dos estados en vez de uno: `search` es lo que el usuario ve escrito y
    `busqueda` lo que se consulta. El debounce de 300 ms vive en su propio efecto —el `clearTimeout`
    del cleanup es lo que hace que sólo la última tecla pida—, y el `load` depende de `busqueda`,
    no de `search`.
    La cancelación necesitó más cuidado del que parecía: el `AbortController` se aborta en el
    cleanup del efecto, pero el `finally` corre igual después del `return` del `catch`, así que sin
    la guarda `if (!signal?.aborted) setLoading(false)` una búsqueda cancelada apagaba el spinner
    de la que la reemplazó. Y en el `catch` hay que salir **antes** de tocar el estado: sin eso,
    cancelar pintaba "Error de conexión" y vaciaba la lista justo mientras el usuario escribía.
    El segundo caso del spec es el que importa. El conteo lo arregla el debounce solo; la carrera
    no. Se montan dos peticiones en vuelo (la primera con 2.5 s de retraso desde `page.route`, la
    segunda inmediata) y se verifica que la vieja no pise a la nueva ni cuando llega tarde — sin
    el `abort`, el `setPayees` de la vieja gana por ser el último en ejecutarse.
    **Trampas que costaron un intento cada una:** el botón de borrar de las tarjetas se llama
    "Eliminar la plantilla X", no "Eliminar plantilla"; y en `page.route` el `?` es comodín de un
    carácter, así que los patrones de URL van como predicado.

- [x] **A19: Paginar Cuentas por Pagar y la bitácora de Caja Chica**
  - **Description:** "Detalle de partidas" pinta `data.items` entero y la bitácora recibe el `flatMap`
    de todas las sucursales. Se corta declarando el resto, con el patrón que la tabla "Por contraparte"
    ya usa en la misma pantalla.
  - **Acceptance criteria:**
    - [x] Ambas tablas cortan y declaran cuántas partidas existen en total.
    - [x] Los tres números de encabezado de CxP siguen calculándose sobre el total, no sobre lo mostrado.
  - **Verification:**
    - [x] Caso de servicio verificando que el corte no toca los agregados, y que el total los declara.
  - **Dependencies:** A17 (la bitácora se sirve del endpoint consolidado)
  - **Files:** `app/api/finance/payables/route.ts`, `app/dashboard/finance/payables/page.tsx`, `app/dashboard/finance/petty-cash/page.tsx`
  - **Scope:** M
  - **Cómo quedó:** El corte va **después** de recorrer todas las partidas, no antes: el servicio
    calcula totales, tramos de antigüedad y el agrupado por contraparte sobre el conjunto completo y
    sólo entonces hace `items.slice(0, itemsLimit)`. Por eso los tres números del encabezado y la
    tabla "Por contraparte" siguen describiendo la deuda entera aunque el detalle muestre 200 filas.
    Hizo falta un campo nuevo, `itemsTotal`. El encabezado titulaba con `data.items.length`, que al
    acotar pasaría a describir **la página** en vez de la deuda: "200 partidas" bajo un total de la
    cadena es una afirmación falsa sobre dinero. Es el mismo error que A8 corrigió en la lista de
    cortes, en otra pantalla.
    En Caja Chica la cota entra por el consolidado (`movimientos.limit` / `movimientos.total`), y la
    bitácora dejó de llamarse "historial completo" — nunca lo fue: antes traía lo que las N
    peticiones alcanzaran a devolver. Ahora declara cuántos muestra de cuántos hay y sugiere acotar
    por sucursal. La línea de comprobantes también se corrigió: contaba "N movimientos" sobre lo
    cargado, así que ahora el conteo sale del total y la proporción con comprobante se declara
    explícitamente sobre los que sí están a la vista.
    **Cotas elegidas:** 200 partidas en CxP y 100 movimientos en la bitácora, ambas ampliables por
    query (`limit` / `movimientosLimit`) con tope. No hay "página siguiente": la pregunta de las dos
    pantallas es qué es urgente, y para lo demás está el filtro de sucursal — mismo criterio que
    A8 aplicó al rango por defecto de cortes.

- [x] **A20: Leyenda accesible de CxP y confirmación de borrado de plantillas**
  - **Description:** El `TableCaption` de CxP anuncia "monto y acción de pago" y no hay columna de
    acción —contradice, justo para quien no ve la tabla, la nota que dice que la vista es de consulta.
    Y el `AlertDialogAction` de mapeo POS es el único de las cinco confirmaciones del módulo sin
    `e.preventDefault()`: se cierra antes de saber el resultado.
  - **Acceptance criteria:**
    - [x] La leyenda describe las seis columnas que existen.
    - [x] El diálogo de borrado permanece abierto con spinner hasta que responde el servidor.
    - [x] Un `DELETE` fallido deja el diálogo abierto con el error visible.
  - **Verification:**
    - [x] Caso de UI interceptando el `DELETE` con 500 y verificando que el diálogo sigue abierto.
  - **Dependencies:** None
  - **Files:** `app/dashboard/finance/payables/page.tsx`, `app/dashboard/sales/mapping/page.tsx`
  - **Scope:** S
  - **Cómo quedó:** La leyenda de CxP nombra las seis columnas que existen (referencia,
    contraparte, sucursal, origen, vencimiento, monto) y **declara que la vista es de consulta**,
    en vez de prometer una "acción de pago" ausente. Lo segundo se añadió a propósito: el aviso
    visible que dice que aquí no se registran pagos era justo lo que le faltaba a quien navega con
    lector de pantalla, que es a quien la leyenda existe para orientar.
    El diálogo de plantillas POS necesitó dos cambios, no uno. El `e.preventDefault()` es el que ya
    usaban las otras cuatro confirmaciones del módulo, pero además el `finally` cerraba el diálogo
    **también cuando fallaba**: `setPendingDelete(null)` se movió a la rama de éxito. Se añadió un
    `deleteError` propio —separado del `error` de la carga de la lista— que se pinta dentro del
    diálogo con `role="alert"`; un toast aparece detrás del overlay, que es donde el usuario no
    está mirando. El `onOpenChange` limpia el error al cerrar para que el siguiente intento no
    herede el anterior.

- [x] **A21: Dejar de silenciar el fallo de proveedores y tipar el `catch`**
  - **Description:** En Cuentas Bancarias, el fallo de `/api/inventory/suppliers` no tiene rama
    `else`: el `Select` queda vacío —no se puede registrar una cuenta— y las cuentas existentes se
    rotulan "Proveedor desconocido", que se lee como dato corrupto. Se surfacea el error. Además,
    `catch (err: any)` en Contrapartes son los dos únicos errores de lint del módulo, y
    `data.error?.message || data.error` produce "[object Object]" con errores estructurados.
  - **Acceptance criteria:**
    - [x] Un fallo al cargar proveedores se muestra y no se confunde con "sin proveedores".
    - [x] `pnpm lint` sin errores en `app/dashboard/finance`.
    - [x] Un error estructurado del servidor se muestra como texto, nunca como "[object Object]".
  - **Verification:**
    - [x] `npx eslint app/dashboard/finance app/dashboard/sales --ext .tsx,.ts` sin errores.
    - [x] Caso de UI interceptando `/api/inventory/suppliers` con 500.
  - **Dependencies:** None
  - **Files:** `app/dashboard/finance/supplier-bank-accounts/page.tsx`, `app/dashboard/finance/payees/page.tsx`
  - **Scope:** S
  - **Cómo quedó:** El `else` que faltaba no bastaba solo: había que decidir qué dice la pantalla
    en cada uno de los tres lugares donde la ausencia del catálogo se notaba.
    (1) Un `suppliersError` propio, separado del `error` de las cuentas, porque son dos peticiones
    con dos destinos distintos y mezclarlas escondía cuál falló.
    (2) `supplierName` distingue por fin **dos ausencias que no son la misma**: si el catálogo no
    cargó devuelve "Nombre no disponible"; si cargó y el id no está, sigue diciendo "Proveedor
    desconocido", que ahí sí es correcto —la cuenta apunta a un proveedor que ya no existe.
    Rotular las dos igual hacía que un fallo de red se leyera como base de datos corrupta.
    (3) El `Select` se deshabilita y su placeholder dice por qué, con el motivo y un "Reintentar"
    debajo. Un desplegable vacío sin explicación se lee como "esta empresa no tiene proveedores".
    Los `catch (err: any)` de Contrapartes pasaron a `catch (err)` con `(err as Error).message`.
    El "[object Object]" se resolvió con **`lib/api/client-error.ts` → `mensajeDeError(data, fallback)`**,
    compartido con A20: el patrón `data.error?.message || data.error` cae al segundo operando
    cuando el error es estructurado (los de Zod, que traen los campos y no un `message`) y el
    usuario leía un objeto serializado. El helper junta los detalles que sean texto y, si no queda
    ninguno, usa el respaldo — que dice más que "[object Object]".
    **Deuda anotada, no corregida:** `/api/inventory/suppliers` devuelve `{ success, suppliers }`
    en vez del envelope del proyecto, así que `mensajeDeError` no encuentra `error` y cae al
    respaldo. Se defiende al consumidor; corregir la ruta toca a sus otros llamadores.

### ☑ Checkpoint: Completo
- [x] Los 27 hallazgos cerrados o diferidos con su razón escrita. **Diferidos, con su razón:**
      la **cancelación de CFDI** (decidido con David: plan propio — necesita el endpoint del PAC,
      los motivos SAT 01–04, la mecánica de acepta/rechaza del receptor y qué pasa con el payslip
      ya emitido); la **migración a `hooks/queries/`** (deuda declarada en el plan, con su
      prerrequisito bloqueante ya anotado); el **envelope de `/api/inventory/suppliers`**, que
      devuelve `{ success, suppliers }` en vez de `{ success, data }` — A21 defendió al consumidor
      y corregir la ruta toca a sus otros llamadores; y la **persistencia del alcance "Todas"**,
      que sigue sin sobrevivir a un recargado (ver A17).
- [x] `pnpm build` limpio · `pnpm lint` sin errores en lo tocado
      (`app/dashboard/finance`, `app/dashboard/sales`, `app/api/{petty-cash,finance,expenses}`,
      `lib/expenses`, `lib/api/client-error.ts` y los tres servicios). `lib/branch-context.tsx`
      arrastra 1 error y 2 avisos **preexistentes** de `react-hooks`, idénticos antes y después
      del cambio de A17 — se verificó aislando el archivo.
- [x] Suite de finanzas y ventas en verde: **111 passed, 0 failed** sobre los 13 specs del plan
      (`frontera-tenant-sucursal`, `branch-scope-finanzas`, `gastos-autorizaciones`,
      `gasto-notifica-aprobador`, `timbrado-idempotente`, `cortes-cota`, `corte-duplicado`,
      `corte-arqueo`, `petty-cash-lectura-pura`, `ventas-rbac`, `payee`, y los dos nuevos
      `caja-chica-consolidado` y `fallos-visibles`).
- [x] Sin casillas abiertas en este archivo

---

## Lo que queda en manos de David

Tres cosas que este plan **no** puede decidir y que conviene no perder de vista:

1. **La segregación de funciones necesita un segundo aprobador que hoy no existe.** Ver la nota
   de A16. En la base de dev el dueño es el único con rol >= `OWNER`, así que sus propios gastos
   quedan atrapados en `PENDING_APPROVAL` y no entran a Cuentas por Pagar. El servicio ya lo grita
   por `console.warn`; falta decidir si se siembran reglas con un `approver_role` alcanzable por
   más de una persona, o si se da de alta un segundo aprobador por empresa.
2. **El arreglo del alcance "Todas" toca todas las pantallas con `BranchScopeControl`.** Es un
   cambio en `lib/branch-context.tsx` y conviene mirarlo con ojos de regresión más allá de
   Finanzas y Ventas.
3. **La cancelación de CFDI** y la **migración a TanStack Query** son planes propios, cada uno con
   su alcance ya descrito arriba.
