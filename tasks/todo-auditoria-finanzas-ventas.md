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

- [ ] **A6c: La pantalla fiscal deja de afirmar el timbrado**
  - **Description:** El badge lee `timbradoResult.status` en vez de pintar "TIMBRADO" fijo, y la
    pantalla puede recuperar el timbrado existente de un período ya timbrado en vez de depender del
    estado de React.
  - **Acceptance criteria:**
    - [ ] Un status distinto de `TIMBRADO` no pinta el badge verde.
    - [ ] Recargar la página tras timbrar sigue mostrando UUID y fecha del comprobante.
    - [ ] Reintentar un período ya timbrado avisa que existe, en vez de ofrecer timbrar de nuevo.
  - **Verification:**
    - [ ] Verificación manual con FiscalAPI sin configurar (el servicio ya lanza mensaje claro) y con respuesta mockeada.
    - [ ] `pnpm build` limpio.
  - **Dependencies:** A6b
  - **Files:** `app/dashboard/finance/fiscal/page.tsx`, `app/api/finance/fiscal/timbrar-nomina/route.ts`
  - **Scope:** S

### ☑ Checkpoint: Fiscal
- [ ] Timbrar dos veces el mismo período devuelve el mismo UUID y un solo folio consumido
- [ ] Recargar después de timbrar sigue mostrando el comprobante
- [ ] Un status distinto de TIMBRADO no pinta verde
- [ ] **Revisar con David** — decidir si la cancelación de CFDI bloquea o va a su propio plan

---

## Fase 3 — Pantallas que afirman de más

- [ ] **A8: `/api/sales/cuts` acota, pagina y declara el total**
  - **Description:** Sin `startDate`/`endDate` la ruta usa el mes en curso. Añade `limit`/`offset` con
    tope, y devuelve `{ items, total, scope }` en vez de un arreglo pelado.
  - **Acceptance criteria:**
    - [ ] Una petición sin fechas devuelve solo el mes en curso y lo declara en `scope`.
    - [ ] `total` refleja las filas que existen en el rango, no las devueltas.
    - [ ] La página consume la forma nueva sin romper el banner de diferencias ni la conciliación.
  - **Verification:**
    - [ ] Spec nuevo `tests/cortes-cota.spec.ts`: sembrar ~300 cortes en dos meses, verificar rango por defecto y `total`.
    - [ ] `pnpm exec playwright test --no-deps --project=chromium tests/cortes-cota.spec.ts`
  - **Dependencies:** None
  - **Files:** `app/api/sales/cuts/route.ts`, `app/dashboard/sales/page.tsx`, `tests/cortes-cota.spec.ts`
  - **Scope:** M

- [ ] **A7: Ventas distingue "falló" de "vacío"**
  - **Description:** Estado `error` con `EmptyState` y reintento, como en las otras nueve pantallas.
    `setCuts([])` en el fallo para que un error tras cambiar de sucursal no deje las filas anteriores
    bajo la etiqueta de alcance nueva.
  - **Acceptance criteria:**
    - [ ] Un fallo de red muestra error con botón de reintento, no una tabla vacía ni una tabla vieja.
    - [ ] Tras un fallo al cambiar de sucursal, no quedan filas de la sucursal anterior.
    - [ ] El banner de diferencias no nombra sucursales fuera del alcance.
  - **Verification:**
    - [ ] Caso nuevo en `tests/corte-arqueo.spec.ts` interceptando la ruta con `page.route` y devolviendo 500.
    - [ ] Verificación manual del cambio de sucursal con la red cortada.
  - **Dependencies:** A8 (mismo `fetch`; hacerlo después evita rehacer el parseo)
  - **Files:** `app/dashboard/sales/page.tsx`, `tests/corte-arqueo.spec.ts`
  - **Scope:** S

- [ ] **A9: Un cero capturado deja de ser "no capturado"**
  - **Description:** `?? null` en lugar de `|| null` para `cashSales`, `cardSales`, `otherPayments`,
    `cashCountedCents`, `depositedCents` y `ticketCount` en el `INSERT` de cortes.
  - **Acceptance criteria:**
    - [ ] Un corte con `cashSales: 0` y `cashCountedCents: 0` se guarda con ceros, no con `null`.
    - [ ] Ese corte aparece en el banner de diferencias si el arqueo no cuadra.
    - [ ] Un campo omitido sigue guardándose como `null`.
  - **Verification:**
    - [ ] Caso nuevo en `tests/corte-arqueo.spec.ts`: capturar cero y verificar la fila y `computeCashVariance`.
    - [ ] `pnpm exec playwright test --no-deps --project=chromium tests/corte-arqueo.spec.ts`
  - **Dependencies:** None
  - **Files:** `app/api/sales/cuts/route.ts`, `tests/corte-arqueo.spec.ts`
  - **Scope:** S

- [ ] **A10: Gastos declara su alcance, su cota y el caso sin sucursal**
  - **Description:** La página ya recibe `scope` y `truncated` y no los pinta. Se rotula el alcance
    aplicado, se avisa cuando el historial viene acotado —como ya hace Control Interno
    (`control-interno/page.tsx:542`)— y se distingue `scope.kind === "NONE"` ("tu usuario no tiene
    sucursal asignada") del vacío genérico.
  - **Acceptance criteria:**
    - [ ] Con historial acotado, la pantalla dice cuántas entradas muestra y por qué.
    - [ ] A un GERENTE que pidió otra sucursal se le rotula la que de verdad se aplicó.
    - [ ] `kind === "NONE"` muestra un mensaje distinto al de "sin gastos registrados".
  - **Verification:**
    - [ ] Caso de UI nuevo en `tests/gastos-autorizaciones.spec.ts` reusando `seedManyOperatingExpenses`.
    - [ ] `pnpm build && PLAYWRIGHT_WEB_SERVER_CMD="npm run start" pnpm test:e2e -g "alcance"`
  - **Dependencies:** None
  - **Files:** `app/dashboard/finance/expenses/page.tsx`, `tests/gastos-autorizaciones.spec.ts`
  - **Scope:** S

- [ ] **A11: Código muerto fuera de Gastos**
  - **Description:** Eliminar `PUEDEN_CAPTURAR`, `localDateString`, `addCalendarDays` y `focusId`. Si
    `PUEDEN_CAPTURAR` debía condicionar `ExpenseForm`, se cablea; si no, se borra. `dueDate` se
    muestra o se saca de la interfaz — hoy es lo que decide si un gasto está vencido y no se ve.
  - **Acceptance criteria:**
    - [ ] `pnpm lint` sin avisos de variables sin usar en el archivo.
    - [ ] La decisión sobre `PUEDEN_CAPTURAR` y `dueDate` queda escrita en el código, no implícita.
  - **Verification:**
    - [ ] `npx eslint app/dashboard/finance/expenses --ext .tsx` limpio.
  - **Dependencies:** A10 (mismo archivo)
  - **Files:** `app/dashboard/finance/expenses/page.tsx`
  - **Scope:** XS

- [ ] **A12: La notificación de gasto pendiente llega a alguien**
  - **Description:** `createOperatingExpense` notifica con `userId: input.companyId`
    (`expense-service.ts:108`), que no es un id de usuario: `getUserPreferences` no lo encuentra y
    retorna sin enviar nada. Se resuelven los usuarios con el rol aprobador requerido en la empresa
    (y la sucursal, si aplica) y se les notifica a cada uno.
  - **Acceptance criteria:**
    - [ ] Al crear un gasto pendiente, los usuarios con el rol requerido reciben la notificación.
    - [ ] Sin ningún usuario con ese rol, se registra un warning explícito en vez de fallar en silencio.
    - [ ] El `actionUrl` sigue llevando al gasto con `?focus=<id>` que la pantalla ya sabe resaltar.
  - **Verification:**
    - [ ] Spec nuevo `tests/gasto-notifica-aprobador.spec.ts`: crear gasto pendiente y verificar filas en `notifications`.
    - [ ] `pnpm exec playwright test --no-deps --project=chromium tests/gasto-notifica-aprobador.spec.ts`
  - **Dependencies:** None
  - **Files:** `lib/services/expense-service.ts`, `tests/gasto-notifica-aprobador.spec.ts`
  - **Scope:** S

### ☑ Checkpoint: Honestidad
- [ ] Un fallo de red en Ventas muestra error con reintento, sin filas del alcance anterior
- [ ] Un corte con cero efectivo contado aparece en el banner de diferencias
- [ ] `pnpm lint` sin avisos en `app/dashboard/finance/expenses`
- [ ] El aprobador recibe la notificación de un gasto pendiente

---

## Fase 4 — Controles y consistencia

- [ ] **A13: Contrapartes y plantillas POS exigen rol**
  - **Description:** `POST`/`DELETE /api/finance/payees` y `PUT`/`DELETE
    /api/sales/mapping-templates/[id]` pasan a `withRoleAuth` con la lista de Finanzas. Son las
    últimas rutas del módulo en `lib/tenant-context.ts` sin guarda de rol.
  - **Acceptance criteria:**
    - [ ] Un EMPLEADO recibe 403 al crear o dar de baja una contraparte.
    - [ ] Un EMPLEADO recibe 403 al borrar o editar una plantilla POS.
    - [ ] Los roles de finanzas conservan el comportamiento actual.
  - **Verification:**
    - [ ] Casos nuevos en `tests/payee.spec.ts` y `tests/ventas-rbac.spec.ts`.
  - **Dependencies:** A2 (comparte el spec de ventas)
  - **Files:** `app/api/finance/payees/route.ts`, `app/api/finance/payees/[id]/route.ts`, `app/api/sales/mapping-templates/[id]/route.ts`, `tests/payee.spec.ts`
  - **Scope:** S

- [ ] **A14: `isDefault` en transacción**
  - **Description:** El `PUT` limpia `isDefault` de todas las plantillas y después actualiza la
    objetivo. Sin transacción, un fallo en el segundo paso deja a la empresa sin plantilla default y
    rompe la autodetección de archivos POS.
  - **Acceptance criteria:**
    - [ ] Un `PUT` con id inexistente no deja a la empresa sin default.
    - [ ] Marcar una plantilla como default sigue desmarcando exactamente a las demás.
  - **Verification:**
    - [ ] Caso nuevo en `tests/ventas-rbac.spec.ts` o spec propio: `PUT` con id inválido y verificar que el default sobrevive.
  - **Dependencies:** None
  - **Files:** `app/api/sales/mapping-templates/[id]/route.ts`
  - **Scope:** XS

- [ ] **A15: El corte duplicado por carrera devuelve 409**
  - **Description:** El pre-`SELECT` da un 409 con mensaje en español, pero dos envíos simultáneos lo
    pasan los dos y el segundo choca contra `daily_sales_cut_unique` como 500 crudo. Se usa
    `onConflictDoNothing().returning()` y se traduce el resultado vacío al mismo 409.
  - **Acceptance criteria:**
    - [ ] Dos `POST` concurrentes del mismo corte: uno crea, el otro recibe 409 con el mensaje legible.
    - [ ] Ninguno de los dos produce un 500.
  - **Verification:**
    - [ ] Spec nuevo siguiendo el patrón de `tests/extractor-idempotente.spec.ts` (`Promise.all` de dos escrituras).
  - **Dependencies:** None
  - **Files:** `app/api/sales/cuts/route.ts`, `tests/corte-duplicado.spec.ts`
  - **Scope:** S

- [ ] **A16: La UI refleja la política real de auto-aprobación**
  - **Description:** `createOperatingExpense` auto-aprueba cuando el rol basta para la regla, y
    `approveOperatingExpense` solo bloquea la auto-resolución cuando hay umbral (`minAmount > 0`). La
    UI, en cambio, esconde el botón para el propio gasto siempre. Se alinea la UI con la política
    real, o se cambia la política — **decisión de producto, ver Open Questions del plan**.
  - **Acceptance criteria:**
    - [ ] La condición de la UI y la del servicio se derivan de la misma regla.
    - [ ] El comentario de `renderApproveAction` describe lo que el código hace.
  - **Verification:**
    - [ ] Casos nuevos en `tests/gastos-autorizaciones.spec.ts` para gasto con umbral y sin umbral.
  - **Dependencies:** A4 (mismo servicio). **Bloqueada por decisión de producto.**
  - **Files:** `app/dashboard/finance/expenses/page.tsx`, `lib/services/expense-service.ts`, `tests/gastos-autorizaciones.spec.ts`
  - **Scope:** S

---

## Fase 5 — Rendimiento y pulido

- [ ] **A17: Endpoint consolidado de Caja Chica**
  - **Description:** `GET /api/petty-cash/consolidado?branchId=` devuelve el agregado más las filas
    por sucursal y los movimientos paginados, en una consulta. Reemplaza el abanico de 2×N peticiones
    del cliente (30 con 15 sucursales, cada una pasando por rate limiting y verificación de sesión).
    El aviso de sucursales que no respondieron pasa a distinguir el fallo real de la ausencia de fondo.
  - **Acceptance criteria:**
    - [ ] La página hace una sola petición con alcance "todas".
    - [ ] El orden por urgencia y el conteo bajo umbral salen del servidor.
    - [ ] "No respondió" y "no tiene fondo" son dos mensajes distintos.
  - **Verification:**
    - [ ] Spec nuevo `tests/caja-chica-consolidado.spec.ts` comparando el agregado contra SQL directo.
    - [ ] Contar peticiones con `page.on("request")` en el caso de UI.
  - **Dependencies:** A1
  - **Files:** `app/api/petty-cash/consolidado/route.ts`, `lib/services/petty-cash-service.ts`, `app/dashboard/finance/petty-cash/page.tsx`, `tests/caja-chica-consolidado.spec.ts`
  - **Scope:** M

- [ ] **A18: Debounce y cancelación en Contrapartes**
  - **Description:** La búsqueda dispara un `fetch` con `ILIKE` por tecla y la última respuesta en
    llegar gana, que no es necesariamente la del texto actual. Debounce de ~300 ms y `AbortController`.
  - **Acceptance criteria:**
    - [ ] Escribir "Inmobiliaria" produce una petición, no trece.
    - [ ] La respuesta de una búsqueda abandonada no pisa la lista.
  - **Verification:**
    - [ ] Caso nuevo en `tests/payee.spec.ts` contando peticiones con `page.on("request")`.
  - **Dependencies:** None
  - **Files:** `app/dashboard/finance/payees/page.tsx`, `tests/payee.spec.ts`
  - **Scope:** S

- [ ] **A19: Paginar Cuentas por Pagar y la bitácora de Caja Chica**
  - **Description:** "Detalle de partidas" pinta `data.items` entero y la bitácora recibe el `flatMap`
    de todas las sucursales. Se corta declarando el resto, con el patrón que la tabla "Por contraparte"
    ya usa en la misma pantalla.
  - **Acceptance criteria:**
    - [ ] Ambas tablas cortan y declaran cuántas partidas existen en total.
    - [ ] Los tres números de encabezado de CxP siguen calculándose sobre el total, no sobre lo mostrado.
  - **Verification:**
    - [ ] Caso de UI sembrando >200 partidas y verificando el aviso de corte.
  - **Dependencies:** A17 (la bitácora se sirve del endpoint consolidado)
  - **Files:** `app/api/finance/payables/route.ts`, `app/dashboard/finance/payables/page.tsx`, `app/dashboard/finance/petty-cash/page.tsx`
  - **Scope:** M

- [ ] **A20: Leyenda accesible de CxP y confirmación de borrado de plantillas**
  - **Description:** El `TableCaption` de CxP anuncia "monto y acción de pago" y no hay columna de
    acción —contradice, justo para quien no ve la tabla, la nota que dice que la vista es de consulta.
    Y el `AlertDialogAction` de mapeo POS es el único de las cinco confirmaciones del módulo sin
    `e.preventDefault()`: se cierra antes de saber el resultado.
  - **Acceptance criteria:**
    - [ ] La leyenda describe las seis columnas que existen.
    - [ ] El diálogo de borrado permanece abierto con spinner hasta que responde el servidor.
    - [ ] Un `DELETE` fallido deja el diálogo abierto con el error visible.
  - **Verification:**
    - [ ] Caso de UI interceptando el `DELETE` con 500 y verificando que el diálogo sigue abierto.
  - **Dependencies:** None
  - **Files:** `app/dashboard/finance/payables/page.tsx`, `app/dashboard/sales/mapping/page.tsx`
  - **Scope:** S

- [ ] **A21: Dejar de silenciar el fallo de proveedores y tipar el `catch`**
  - **Description:** En Cuentas Bancarias, el fallo de `/api/inventory/suppliers` no tiene rama
    `else`: el `Select` queda vacío —no se puede registrar una cuenta— y las cuentas existentes se
    rotulan "Proveedor desconocido", que se lee como dato corrupto. Se surfacea el error. Además,
    `catch (err: any)` en Contrapartes son los dos únicos errores de lint del módulo, y
    `data.error?.message || data.error` produce "[object Object]" con errores estructurados.
  - **Acceptance criteria:**
    - [ ] Un fallo al cargar proveedores se muestra y no se confunde con "sin proveedores".
    - [ ] `pnpm lint` sin errores en `app/dashboard/finance`.
    - [ ] Un error estructurado del servidor se muestra como texto, nunca como "[object Object]".
  - **Verification:**
    - [ ] `npx eslint app/dashboard/finance app/dashboard/sales --ext .tsx,.ts` sin errores.
    - [ ] Caso de UI interceptando `/api/inventory/suppliers` con 500.
  - **Dependencies:** None
  - **Files:** `app/dashboard/finance/supplier-bank-accounts/page.tsx`, `app/dashboard/finance/payees/page.tsx`
  - **Scope:** S

### ☑ Checkpoint: Completo
- [ ] Los 27 hallazgos cerrados o diferidos con su razón escrita
- [ ] `pnpm build` limpio · `pnpm lint` sin errores
- [ ] Suite de finanzas y ventas en verde
- [ ] Sin casillas abiertas en este archivo
