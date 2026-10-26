# TODO: Circuito afiliatorio IMSS

Plan detallado: `tasks/plan-imss.md`
Reglas transversales: **generar ≠ registrar** (solo el acuse confirma) · **nunca inventar salario** (sin contrato no hay SDI) · **un solo generador** (`imss-parser.ts`) · **registro patronal por sucursal**, nunca el UUID del tenant · montos en **centavos enteros** · `companyId` en cada `WHERE` · migraciones **sin DROP** y **sin RLS** en esta fase · el layout **no** está validado contra el portal IMSS y la UI lo dice.

## Phase 0: Desbloqueo (sin migración)

- [x] **Task 1 (S)** — Reglas puras `imss-rules.ts` ✱secuencial primero (T2 y T16 dependen)
  - [x] `resolveAltaState` / `resolveBajaState` → `{ state, overdue (flag), daysElapsed, missing[] }`
  - [x] Validación de identidad con `validateNSS`/`validateCURP`/`validateRFC` del parser — **RFC 12 o 13** (hoy exige 12: nadie llega a LISTO)
  - [x] `overdue` deja de sobrescribir `LISTO`; plazos en **días hábiles**
  - **Verify:** `lib/services/compliance/imss-rules.test.ts` — 24 casos verdes (RFC 12/13, vencido sigue LISTO, vie→lun = 1 día hábil)

- [x] **Task 2 (S)** — Altas y bajas consumen las reglas
  - [x] `altas/route.ts`: quitar clasificación inline e imports muertos (`gte`, `lte`, `fiveDays`); excluir TERMINATED/RESIGNED e `active=false`; agregar `employeeStatus` y `baseSalary` al `select` (contrato vigente → `baseSalaryCents`, sin N+1)
  - [x] `altas/route.ts`: `requireBaseSalary: true` — sin contrato vigente la fila es `PENDING` + `SIN_SALARIO_BASE`. Antes decía `READY` y el generador la rechazaba después: se ofrecía una descarga que no existía (decisión 5)
  - [x] `bajas/route.ts`: agregar `employeeStatus` + `terminationReason` al `select`; filtro en SQL con precedencia correcta; quitar `"Voluntary Resignation"` hardcodeado
  - [x] `branches.findMany()` sin `where` en ambas rutas → la respuesta filtraba nombres de sucursal de **otras empresas** (H16)
  - **Verify:** `summary` se calcula sobre las filas devueltas; `blockedReasons` expuesto para la UI; páginas ajustadas al nuevo shape (`overdue` como flag)
  - **Verify (cerrado):** `tests/integration/imss-phase0-db.test.ts` corre las **rutas reales** contra Postgres aislado con 1 alta + 1 baja + 1 activo + 1 sin contrato + 1 inactivo + 1 de otra empresa. Sustituye la prueba manual.

- [x] **Task 3 (XS)** — Offboard escribe `terminationDate` + `terminationReason`
  - [x] `employee-service.offboardEmployeeWithAntiBuroProtection` recibe `{ reason, effectiveDate, notes }`; renuncia → `RESIGNED`, resto → `TERMINATED`; ya no existe el default inválido `'BAJA_REGULAR'`
  - [x] **Hallazgo al cerrar (H15):** ese servicio **no tiene un solo caller**. La baja real entra por el diálogo profesional → `PUT /api/employees/[id]` → `EmployeeService.updateEmployee`, que metía strings y `""` en columnas `timestamp` (Drizzle llama `value.toISOString()`) → **500** y `termination_date` nunca se guardaba. Corregido con `coerceProfileDateFields` (fechas válidas → `Date`, `""` → `NULL`, fecha imposible → 400 en el borde)
  - **Verify:** ciclo alta→baja automatizado en `tests/integration/imss-phase0-db.test.ts` (persiste fecha y motivo, la baja aparece en el aviso, el empleado sale de "pendientes de alta"; `""` limpia; `"no-es-una-fecha"` → 400)

- [x] **Task 4 (S)** — SDI y salario reales
  - [x] Borrar `const baseSalary = 0` y `sdiFactor = 1.0452` en `idse-generate` y en `sua-generate` (donde además había `|| 300`)
  - [x] `lib/services/compliance/imss-contracts.ts`: contrato vigente por empleado (1 query) + años de servicio
  - [x] Sin contrato vigente → el empleado **no** entra al archivo; se reporta en `excluded` / headers `X-Imss-Excluded-*`
  - [x] Las 4 rutas de `app/api/imss/` descifran PII (`decryptProfileRecords`) antes de validar NSS/CURP/RFC — con `PULSO_ENCRYPT_PII=true` el valor llega como `enc::…` y **todo** empleado caía en `SIN_NSS` (H17)
  - **Verify:** `imss-parser.test.ts` — $350/día → SDI 367.26 (factor 1.0493, no 1.0452); `baseSalaryCents: 35 000` visible en el test de integración de altas

### ✅ Checkpoint Phase 0 — CERRADO 2026-10-22
- [x] Altas y bajas devuelven filas reales y bien clasificadas — probado con las rutas reales contra Postgres (`tests/integration/imss-phase0-db.test.ts`, 12 casos)
- [x] `pnpm test:unit` verde (1850 passed, 1 skipped, 1 todo) + `tsc --noEmit` limpio
- [x] `pnpm run build` OK — compila y genera `BUILD_ID` (la corrida anterior al cierre murió en la etapa de TypeScript)
- [x] `pnpm test:integration` — 50 passed / 10 files. Base aislada puesta al día (109 → 121 migraciones, ninguna con `DROP`)
- [x] Pendientes laterales cerrados: H15 (fechas del offboard), H16 (fuga de sucursales), H17 (PII cifrada), `requireBaseSalary`, y los motivos de bloqueo ya se muestran con etiqueta legible en vez del código `SIN_*`
- [x] **Gate:** GO explícito recibido 2026-10-24 para aplicar 0121; aplicación verificada. Aprobación humana para tocar el schema → ver "Decisiones resueltas" en `tasks/plan-imss.md`

## Phase 1: Foundation — persistencia del estado afiliatorio

**Implementación preparada el 2026-10-24 (T5–T7).** Migración aplicada dos veces con el runner de Drizzle en PostgreSQL embebido aislado: una sola entrada en el journal. **Aplicada a Neon operativo con GO explícito el 2026-10-24; ver `migration-applied.json`.** Evidencia: `tasks/evidencia/imss-foundation-2026-10-24/README.md`.

El contrato real del servicio exige `companyId` y actor en las escrituras. `getAfiliacionState(companyId, userIds)` devuelve el último movimiento por empleado/tipo en una consulta. La adopción recibe `{ userIds, effectiveDate, actorId, nota, branchId, dryRun }`: el folio `MIGRACION` queda en auditoría y `fileId=NULL`, sin inventar archivos ni salarios. El botón con preview previo queda en T11.

Registro patronal: primera posición alfanumérica y diez dígitos; normaliza a mayúsculas, permite limpiar a NULL y no verifica asignación ante IMSS. Captura en `/api/branches` y `/api/branches/[id]`. IDSE/SUA bloquean faltantes y registros mezclados con 400 y datos accionables.

- [x] **Task 5 (S)** — Migración `0121_imss_movimientos.sql` preparada — sin DROP, sin RLS
  - [x] Enums `imss_movement_type` (`ALTA|BAJA|MOD_SALARIO`), `imss_movement_status` (`PENDIENTE|EN_ARCHIVO|CONFIRMADO|RECHAZADO`), `imss_file_status` (`GENERADO|ENVIADO|ACEPTADO|RECHAZADO`)
  - [x] `imss_files` (layout, layout_version, fecha_movimiento, file_name, content_sha256 unique por empresa, status, acuse_folio, rejection_reason, **`storage_key` + `content_unavailable`** por D2) + `imss_movements` (file_id nullable, effective_date, registro_patronal, base_salary_cents, sdi_cents, blocked_reason, unique empresa+empleado+tipo+fecha)
  - [x] `branches.imss_registro_patronal` + `companies.imss_prima_riesgo_trabajo`
  - [x] Exportar en `lib/db/schema.ts`
  - **Verify:** `pnpm db:generate` sin `DROP`; revisión manual del `.sql`; `tsc --noEmit` limpio

- [x] **Task 6 (M)** — `imss-movement-service.ts` (toda la escritura)
  - [x] `getAfiliacionState(companyId, userIds)` y en lote (sin N+1) — último movimiento por tipo
  - [x] `ensurePendingMovements(companyId, type, actorId)` idempotente con `blockedReason`
  - [x] `confirmFile(companyId, fileId, { accepted, acuseFolio, reason }, actorId)` atómico; transiciones inválidas rechazadas
  - [x] `adoptAsRegistered(companyId, input)` → `CONFIRMADO` con folio `MIGRACION` en auditoría (evita que la plantilla histórica aparezca pendiente para siempre)
  - [x] `AuditService` en cada transición; `companyId` en todos los `WHERE`
  - **Verify:** `tests/integration/imss-movement-service.test.ts` — idempotencia, aislamiento entre 2 empresas, `CONFIRMADO→PENDIENTE` rechazado

- [x] **Task 7 (S)** — Captura del registro patronal por sucursal
  - [x] Validación de 11 caracteres (primera posición alfanumérica + 10 dígitos); campo en la pantalla de sucursal
  - [x] Generador se **niega** (400 + lista) si hay sucursales sin registro
  - **Verify:** sucursal sin registro bloquea la generación con mensaje accionable

### ✅ Checkpoint Foundation
- [x] Migración aplicada sin `DROP`; enums y tablas en `schema.ts`
- [x] Servicio con integración local verde y aislamiento multi-tenant probado
- [x] Registro patronal capturable y exigido en el borde

**Verificación Foundation:** 12 pruebas locales de integración (rutas reales, idempotencia, bajas, dos empresas, transiciones, rollback y adopción), 7 de validación y captura en navegador aislado sin errores JS. Suite general de integración: **67/67 verdes**, usando `NODE_OPTIONS=--use-system-ca` para la conexión a Neon aislado. Suite unitaria: **2066 passed**, una omitida y una pendiente. **Build completo aprobado**, incluido TypeScript, con heap de 4 GB; ESLint de los archivos modificados sin errores (once advertencias preexistentes).

## Phase 2: Generadores — un solo formato, archivos persistidos

- [x] **Task 8 (M)** — Unificar en `imss-parser.ts`
  - [x] `buildIdseFile` / `buildSuaFile` puros → `{ content, sha256, lineCount, layoutVersion }`
  - [x] Guard: SDI vacío/0 nunca se emite
  - [x] Endpoints dejan de armar líneas inline (borrar duplicación)
  - **Verify:** `pnpm test:unit -- imss-parser` con golden files (alta, baja, mod. salario); mismo input → mismo hash

- [x] **Task 9 (M)** — `POST /api/imss/files`
  - [x] Valida identidad completa, contrato, **un solo registro patronal**, sin duplicar `CONFIRMADO`
  - [x] Transacción: inserta `imss_files` + pasa movimientos a `EN_ARCHIVO` con `fileId`
  - [x] 409 si `content_sha256` ya existe; excluidos listados en la respuesta
  - [x] `idse-generate` / `sua-generate` quedan como alias que delegan
  - **Verify:** integración generar → re-generar (409) → historial; sha256 del body = guardado

- [x] **Task 10 (S)** — `GET /api/imss/files` + `PATCH /api/imss/files/[id]`
  - [x] Historial paginado por `companyId`; acuse (`accepted`, `acuseFolio`, `reason`) → `confirmFile`
  - [x] RBAC **`SUPER_ADMIN`/`ADMIN`** con `requireRoleApi` (D1) — `GERENTE`/`SUPERVISOR` reciben 403
  - **Verify:** aceptar saca al empleado de "pendientes"; rechazar lo devuelve a seleccionable; 403 con rol sin permiso

**T8–T10 implementadas y verificadas el 2026-10-24.** Evidencia: `tasks/evidencia/imss-files-2026-10-24/README.md`. Suite unitaria: 2078 passed (una omitida y una pendiente); integración completa: 77 passed; focal local adicional: 20 passed; ESLint sin errores y build completo aprobado, incluido TypeScript. El binario queda privado en R2 o declarado no disponible; retención diaria conectada al cron existente. Altas/bajas ya consumen el estado persistido. Las pantallas nuevas siguen en T11–T15.

## Phase 3: Pantallas sobre estado real

**T11–T18 cerradas el 2026-10-25.** Evidencia: `tasks/evidencia/imss-ui-2026-10-25/README.md`. Se retomó la implementación preparada, se agregó el banner de adopción y se corrigió la adopción de recontrataciones (una confirmación anterior al ingreso no cubre el alta vigente). La fecha histórica no puede preceder al ingreso. Pruebas focales: **44/44**, navegador: **8/8**, suite unitaria: **2129 passed** (una omitida y una pendiente), integración general: **89/89**. Build final completo aprobado, incluido TypeScript; lint general sin errores (2454 advertencias del repositorio). Los fixtures de integración ahora usan fecha civil de México también después de medianoche UTC.

- [x] **Task 11 (M)** — `altas/page.tsx`
  - [x] Columna "Estado IMSS" real (`SIN ALTA` / `EN ARCHIVO` / `CONFIRMADA`)
  - [x] Checkbox habilitado en `LISTO` **y** `VENCIDO`; motivo de bloqueo visible
  - [x] Banner de adopción masiva (plantilla histórica); descarga desde archivo persistido
  - [x] Contadores desde el endpoint, no calculados en cliente
  - **Verify:** manual con 4 casos (listo, vencido, bloqueado, confirmado) + `pnpm run build`

- [x] **Task 12 (S)** — `bajas/page.tsx`
  - [x] Razón real, fecha real, plazo en días hábiles; mismo tratamiento de estados
  - **Verify:** manual tras offboard de prueba

- [x] **Task 13 (M)** — SUA
  - [x] `GET /api/imss/sua-candidatos` (deja de usar `/api/employees`: hoy `data.employees` no existe → lista vacía)
  - [x] Salario base de contrato en pesos + **SDI calculado visible**; sin default `300`; renglón deshabilitado si no hay contrato
  - [x] Validar fecha de movimiento contra la ventana bimestral
  - **Verify:** SDI en pantalla = SDI en la línea del archivo; sin contrato no se puede enviar

- [x] **Task 14 (M)** — `reports/page.tsx` sobre `GET /api/imss/files`
  - [x] Tipo, layout+versión, fecha, empleados, estado, folio de acuse, descarga del archivo guardado
  - [x] Borrar mapeo empleados→"archivo" y contadores hardcodeados; vacío = `—`, no `0%`
  - **Verify:** "Archivos IDSE" = filas de `imss_files`; sha256 descargado coincide

- [x] **Task 15 (S)** — Resumen y pestaña IMSS
  - [x] KPIs del estado derivado; mismo denominador en `imss/page.tsx` y `compliance-page-client.tsx`
  - [x] Corregir la promesa "acuses de recibo" (ya existe con T10) y el `complianceRate` duplicado
  - **Verify:** el `%` coincide en ambas pantallas con los mismos datos

## Phase 4: Legalidad y honestidad

- [x] **Task 16 (S)** — Días hábiles en todo el módulo, reutilizando `nthBusinessDay`/`getTodayInMx`
  - **Verify:** contratación en viernes no vence el miércoles siguiente por calendario; `pnpm test:unit`

- [x] **Task 17 (S)** — Leyenda de formato + docs honestos
  - [x] "Layout no validado contra el portal IMSS; úsese como archivo de trabajo" en las 4 pantallas
  - [x] `docs/business-invariants.md:3.9` → `⚠️ datos validados / importabilidad no verificada`
  - [x] `PROJECT_CONTEXT.md`: el "Fase 2 Reportes — COMPLETADA ✅" del bloque IMSS es falso hoy
  - **Verify:** grep de "COMPLETADA" y de "acuses" sin promesas falsas

- [x] **Task 18 (S)** — Cierre
  - [x] `tests/integration/imss-flow.test.ts`: alta pendiente → archivo → acuse → registrado; baja idem
  - [x] Limpieza de exports sin uso en `imss-parser.ts`
  - **Verify:** `pnpm test:integration`, `pnpm run build`, `pnpm run lint`

### ✅ Checkpoint final
- [x] Circuito cerrado end-to-end
- [x] Cero hardcodes de estado: `registered: 0`, `deregistered: 0`, `suaCount = 0`, `baseSalary = 0`, `1.0452`, `300`
- [x] Docs actualizados; ninguna pantalla promete importabilidad ni acuses inexistentes

## Decisiones resueltas (2026-10-22) — ya no bloquean T10, T13 ni T18

Detalle y razonamiento en `tasks/plan-imss.md` → *Decisiones resueltas*.

- [x] **D1 — Quién registra el acuse.** El repo tiene 6 roles (`SUPER_ADMIN | ADMIN | GERENTE | SUPERVISOR | EMPLEADO | READONLY`): `OWNER` y `RRHH` **no existen** (eran roles fantasma del plan). Confirman `SUPER_ADMIN` y `ADMIN`; `GERENTE`/`SUPERVISOR` no, porque el acuse llega **por registro patronal**, no por sucursal. → T10 usa `requireRoleApi(['SUPER_ADMIN','ADMIN'])`. Si hace falta un analista de RRHH: permiso `compliance.imss.acknowledge`, **no** un rol nuevo.
- [x] **D2 — Sí se conserva el `.txt`.** R2 (ya existe con fallback local), bucket privado, prefijo del tenant, retención 12 meses con borrado por cron. Motivo: un rechazo del IDSE solo se diagnostica con los bytes exactos. PII aceptada explícitamente (el `enc::` cubre columnas, no el binario) y compensada con bucket privado + RBAC + retención. Sin R2 configurado → `sha256` + metadatos y `content_unavailable = true`; la UI no ofrece descarga. → columnas extra en T5: `storage_key`, `content_unavailable`.
- [x] **D3 — Adopción de plantilla histórica: botón explícito, nunca automático.** `adoptAsRegistered` con `acuseFolio='MIGRACION'`, actor, nota obligatoria, dry-run previo y alcance por sucursal. `hire_date` antiguo **no** es criterio de adopción.
- [x] **D4 — Alcance del SUA confirmado.** Solo archivos de movimiento (IDSE 08/02/07 + SUA de actualización salarial). **Sin** cuotas obrero-patronales (SBC, topes UMA, ramas RM/O/I/P, prima de riesgo, cuota obrera, SIPARE) — módulo aparte. `companies.imss_prima_riesgo_trabajo` es dato de registro y no alimenta ningún cálculo.
- [x] **D5 — Sin RLS en esta migración** (decisión 9 del plan, sostenida): el piloto de RLS devuelve **cero filas en silencio** si el servicio corre fuera de la transacción que fija `app.current_company_id`. Se aísla por `companyId` en cada `WHERE` y RLS queda como follow-up anotado.

## Gate Phase 0 → Phase 1

**Gate resuelto el 2026-10-24:** el usuario dio el GO explícito y se aplicó únicamente `0121_imss_movimientos.sql`, que crea 3 enums y 2 tablas nuevas y agrega 2 columnas **nullable** — sin `DROP`, sin `NOT NULL` sobre datos existentes, sin RLS. No se incluyó `0122`, de otro trabajo.

### GO aplicado — 2026-10-24

El usuario dio el GO explícito. Se aplicó solo `0121_imss_movimientos.sql` a la base operativa, después de verificar `0120` y su hash. Journal id 138; sin DROP ni RLS. `0122` no se aplicó. Evidencia: `tasks/evidencia/imss-foundation-2026-10-24/migration-applied.json`.
