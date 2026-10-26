# Implementation Plan: Circuito afiliatorio IMSS (altas, bajas, SUA, acuses y reportes)

**Fuente (diagnóstico):** auditoría de `app/dashboard/compliance/imss/` + `app/api/imss/` (5 pantallas, 3 endpoints, `imss-parser.ts`, cron `imss-deadlines`).
**Diagnóstico inicial (anterior a Phase 0):** el módulo **no cierra el ciclo**. Las pantallas recalculan "qué falta" a partir de `hireDate` / `terminationDate` porque no existe ningún registro del estado afiliatorio. Dos de los tres flujos (bajas, SUA) devuelven lista vacía siempre; altas está bloqueado por un bug de validación (RFC). Los "archivos" se descargan al navegador y no quedan registrados, por lo que la pantalla de Reportes fabrica su historial a partir de la lista de empleados.

## Hallazgos que este plan corrige (con línea)

| # | Hallazgo | Ubicación |
|---|---|---|
| H1 | `hasRFC = rfc.length === 12` → el RFC de persona física tiene **13**. Nadie alcanza `READY` → no se puede generar IDSE de altas | `app/api/imss/altas/route.ts:98` |
| H2 | `OVERDUE` **sobrescribe** `READY`, y los checkboxes solo se habilitan en `READY` → los vencidos son los únicos que no se pueden incluir en el archivo | `altas/route.ts:100-104`, `altas/page.tsx:250` |
| H3 | El `select` de bajas **no trae** `employeeStatus`; el filtro lo lee → siempre `undefined` → lista vacía. Además precedencia `A && B || C` mal puesta | `app/api/imss/bajas/route.ts:59-77` |
| H4 | El offboard escribe `employeeStatus='TERMINATED'` pero **nunca** `terminationDate` ni `terminationReason` | `lib/services/employee-service.ts:585-592` |
| H5 | SUA lee `data.employees`, pero `/api/employees` responde `{ success, data, pagination }` → lista vacía → el botón de generar es inalcanzable. Y el servicio devuelve `contractBaseSalary`, no `baseSalary`, y no devuelve `nss` | `app/dashboard/compliance/imss/sua/page.tsx:44`, `lib/services/employee-service.ts:102-125` |
| H6 | IDSE escribe `const baseSalary = 0` → **SDI `0000000`** en todo archivo de altas; y factor de integración hardcodeado `1.0452` (pre-reforma LFT 2023; el correcto para 12 días es ≈`1.0493`) | `app/api/imss/idse-generate/route.ts:67-70` |
| H7 | `registro patronal` se fabrica con `tenant.id.slice(0,11)` (prefijo de UUID). No existe el campo en el schema | `idse-generate/route.ts:60`, `sua-generate/route.ts:60` |
| H8 | No hay estado IMSS: `summary.registered` y `summary.deregistered` hardcodeados en `0` | `altas/route.ts:129`, `bajas/route.ts:114` |
| H9 | Reportes convierte **cada empleado** en una fila de "archivo"; `suaCount` y `totalContributions` hardcodeados en 0 | `app/dashboard/compliance/imss/reports/page.tsx:51,56-75,95` |
| H10 | `baseSalary` se promete en el tipo y se lee, pero no se selecciona en la query → siempre 0 | `altas/route.ts:117` vs `:70-83` |
| H11 | Plazos contados en **días calendario** mientras la UI dice "días hábiles"; `nthBusinessDay()` ya existe y no se usa | `altas/route.ts:88`, `bajas/route.ts:67` |
| H12 | `lib/services/compliance/imss-parser.ts` es **código muerto** (0 imports) y contiene la única implementación correcta del SDI | repo |
| H13 | Altas no filtra terminados ni ya registrados; incluye `GERENTE`/`SUPERVISOR` sin distinguir | `altas/route.ts:92` |
| H14 | La UI y `compliance-page-client.tsx:349` prometen "acuses de recibo" que no existen | varias |
| H15 | `updateEmployee` metía strings (y el `""` del formulario) en columnas `timestamp` → el offboard desde la UI devolvía **500** y `termination_date` nunca se guardaba. El servicio "correcto" (`offboardEmployeeWithAntiBuroProtection`) **no tiene un solo caller** | `lib/services/employee-service.ts:100,522,542` |
| H16 | `db.query.branches.findMany()` sin `where` → la respuesta de altas/bajas incluía nombres de sucursales de **otras empresas** | `altas/route.ts:134`, `bajas/route.ts:94` |
| H17 | Las 4 rutas leían `nss`/`curp`/`rfc` en crudo; con `PULSO_ENCRYPT_PII=true` (cifrado `enc::` ya implementado + job de backfill) **todo** empleado caía en `SIN_NSS` | 4 rutas de `app/api/imss/` |

## Architecture Decisions

1. **Un registro de movimientos como fuente de verdad, no un campo de estado.**
   Tabla `imss_movements` (una fila por movimiento por empleado) y el estado actual se **deriva** del último movimiento. Un `imssStatus` denormalizado en `employee_profiles` se desincroniza en cuanto alguien corrige un acuse; derivarlo cuesta un `NOT EXISTS`/`DISTINCT ON` y es correcto por construcción.

2. **Archivo y movimientos son entidades distintas.** `imss_files` (un `.txt` generado, con hash y layout versionado) 1→N `imss_movements`. Es el modelo real del IMSS: un envío contiene N movimientos. Esto es lo que hace posible un "historial" verdadero y un acuse con consecuencias.

3. **El estado afiliatorio solo se confirma con evidencia.** Los estados son `PENDIENTE → EN_ARCHIVO → CONFIRMADO | RECHAZADO`. Nada pasa a `CONFIRMADO` por el hecho de generar el archivo: se confirma cuando un humano registra el acuse (número de folio o fecha de respuesta del IDSE). Generar ≠ registrar.

4. **Registro patronal por sucursal, no por tenant.** En México el registro patronal se asigna por **centro de trabajo**; IDSE y SUA se envían por registro. Va en `branches.imssRegistroPatronal` (11 chars). El generador **rechaza** una selección que mezcle dos registros patronales distintos, con mensaje explícito, en vez de emitir un archivo inválido en silencio.

5. **Nunca inventar salario.** Si el empleado no tiene contrato vigente con `baseSalary`, el movimiento queda `PENDIENTE` con motivo `SIN_SALARIO_BASE` y no se incluye. Se elimina el default `300` de la UI: un SDI inventado en un archivo oficial es peor que un archivo que no se genera.

6. **Una sola implementación del formato.** `imss-parser.ts` pasa a ser el **único** generador; los endpoints lo consumen. Se borra la duplicación inline. Cada salida estampa `layoutVersion` (`IDSE_2025_v1`, `SUA_AFIL_v1`) para que un cambio de layout sea auditable y no silencioso.

7. **Montos en centavos enteros**, igual que `employeeContracts.baseSalary` (que ya es `integer` en centavos) y que el resto del repo. Conversión a pesos solo en el borde del formato.

8. **Factor de integración calculado, no constante.** `calculateSDI()` por años de servicio (LFT 2023: 12 días el primer año → 1.0493). Se elimina `1.0452`.

9. **Sin RLS en esta migración.** Las tablas nuevas llevan NSS y salarios, pero el piloto de RLS (`0103`-`0106`) exige que toda lectura ocurra dentro de la transacción que fija `app.current_company_id`; si el servicio corre fuera, las filas quedan **invisibles** en silencio. Se aísla por `companyId` en el servicio (criterio vigente del repo) y se anota RLS como follow-up explícito, no como deuda invisible.

10. **El layout no está validado contra la fuente oficial.** `docs/business-invariants.md:3.9` ya lo marca como no verificado. Este plan **no** promete archivos importables: los rotula en la UI como "archivo de trabajo (layout no validado contra IMSS)" y esa leyenda se mantiene hasta que alguien valide contra el portal. Lo que sí se arregla es que los datos dentro del archivo sean correctos (SDI, registro patronal, fechas, nombres).

## Modelo de datos (nuevo)

```sql
-- Una migración, sin DROP.
pgEnum imss_movement_type   ('ALTA','BAJA','MOD_SALARIO')
pgEnum imss_movement_status ('PENDIENTE','EN_ARCHIVO','CONFIRMADO','RECHAZADO')
pgEnum imss_file_status     ('GENERADO','ENVIADO','ACEPTADO','RECHAZADO')

ALTER TABLE branches ADD imss_registro_patronal text;          -- 11 chars, nullable
ALTER TABLE companies ADD imss_prima_riesgo_trabajo numeric(5,4); -- ej. 0.5000, solo registro

CREATE TABLE imss_files (
  id uuid pk, company_id uuid not null, branch_id uuid,
  layout text not null,              -- 'IDSE' | 'SUA'
  layout_version text not null,      -- 'IDSE_2025_v1' | 'SUA_AFIL_v1'
  movement_type imss_movement_type,
  fecha_movimiento date not null,
  file_name text not null,
  content_sha256 text not null,
  line_count integer not null,
  status imss_file_status not null default 'GENERADO',
  acuse_folio text, acuse_received_at timestamptz, rejection_reason text,
  -- D2: el .txt se conserva en R2 (bucket privado, 12 meses). Si no hay R2 en el
  -- entorno, se guarda solo el hash y `content_unavailable` lo declara para que la
  -- UI no ofrezca una descarga inexistente.
  storage_key text, content_unavailable boolean not null default false,
  generated_by text not null, created_at timestamptz not null default now(),
  unique (company_id, content_sha256)          -- reenviar lo mismo no duplica
);

CREATE TABLE imss_movements (
  id uuid pk, company_id uuid not null, user_id text not null references users(id),
  file_id uuid references imss_files(id),      -- null = pendiente sin archivo
  movement_type imss_movement_type not null,
  movement_code text not null,                 -- 08 | 02 | 07
  effective_date date not null,                -- alta: hireDate / baja: terminationDate
  registro_patronal text,
  base_salary_cents integer,                   -- snapshot al momento del movimiento
  sdi_cents integer,                           -- snapshot calculado
  status imss_movement_status not null default 'PENDIENTE',
  blocked_reason text,                         -- 'SIN_NSS' | 'SIN_CURP' | 'SIN_RFC' | 'SIN_SALARIO_BASE' | 'SIN_REGISTRO_PATRONAL'
  confirmed_at timestamptz, rejection_reason text,
  created_at timestamptz not null default now(),
  unique (company_id, user_id, movement_type, effective_date)  -- idempotencia
);
```

## Task List

### Phase 0: Desbloqueo — arreglar la lógica sin tocar el schema

- [x] **Task 1 (S).** Módulo puro `lib/services/compliance/imss-rules.ts`: `resolveAltaState(profile, today)` y `resolveBajaState(profile, today)` que devuelven `{ state: 'SIN_DATOS' | 'LISTO' | 'REGISTRADO', overdue: boolean, daysElapsed, missing: string[] }`. Valida identidad con `validateNSS`/`validateCURP`/`validateRFC` de `imss-parser.ts` (**RFC 12 o 13**). El estado vencido es un **flag independiente**, nunca reemplaza a `LISTO` (H1, H2, H11, H12).
  **Aceptación:** RFC de 13 chars con NSS+CURP válidos → `LISTO` y `overdue=false` en día 3; `overdue=true` y **sigue** `LISTO` en día 9. Días hábiles (vie→lun cuenta 1).
  **Verificación:** `pnpm test:unit -- imss-rules`, casos de borde RFC 12/13, NSS con letras, fecha futura.
  **Dependencias:** ninguna. **Archivos:** `lib/services/compliance/imss-rules.ts`, `lib/services/compliance/imss-rules.test.ts`.

- [x] **Task 2 (S).** Altas y bajas consumen las reglas nuevas. `altas/route.ts`: borrar el bloque de clasificación inline y los imports muertos (`gte`, `lte`, `fiveDays`); excluir `employeeStatus ∈ {TERMINATED, RESIGNED}` y `users.active = false` (H13); agregar `employeeStatus` y `baseSalary` al `select` (H10). `bajas/route.ts`: agregar `employeeStatus` y `terminationReason` al `select`, corregir la precedencia con paréntesis, dejar de hardcodear `"Voluntary Resignation"` (H3).
  **Aceptación:** GET bajas devuelve los empleados con `employeeStatus='TERMINATED'`; GET altas no incluye terminados; `summary` cuadra con las filas devueltas.
  **Verificación:** chequeo manual contra base dev de 1 alta + 1 baja + 1 activo; test de integración de ambos GET (Task 16).
  **Dependencias:** T1. **Archivos:** `app/api/imss/altas/route.ts`, `app/api/imss/bajas/route.ts`.

- [x] **Task 3 (XS).** Offboard escribe `terminationDate` y `terminationReason` en `employeeProfiles` (H4), usando la fecha y el motivo de la request (`app/api/employees/lifecycle/route.ts:20`), no `new Date()` a ciegas.
  **Aceptación:** tras offboard, `termination_date` = fecha enviada y `termination_reason` = motivo; el GET de bajas lo refleja con `daysSinceTermination` correcto.
  **Verificación:** `pnpm test:unit` + prueba manual del ciclo completo alta→baja.
  **Dependencias:** ninguna (paralelizable con T1/T2). **Archivos:** `lib/services/employee-service.ts`.

- [x] **Task 4 (S).** SDI y salario reales en los generadores. Borrar `const baseSalary = 0` y `sdiFactor = 1.0452`; leer `employeeContracts.baseSalary` (centavos) del contrato vigente y usar `calculateSDI(baseSalary/100, añosDeServicio)` de `imss-parser.ts`. Sin contrato → el empleado no entra al archivo (H6).
  **Aceptación:** IDSE de altas emite SDI en centavos ≠ `0000000` para un contrato de $350/día; empleado sin contrato se omite con mensaje en la respuesta, no en silencio.
  **Verificación:** test unitario del armado de línea; comparar `1 + (15 + 12*0.25)/365` = `1.0493`.
  **Dependencias:** ninguna. **Archivos:** `app/api/imss/idse-generate/route.ts`, `app/api/imss/sua-generate/route.ts`.

> **Checkpoint Phase 0:** altas y bajas devuelven filas reales y clasificadas correctamente; `pnpm run build` y `pnpm test:unit` verdes. **Revisar con humano antes de la migración.**
>
> **Cerrado el 2026-10-22.** Verificación real: `tsc --noEmit` limpio, `pnpm test:unit` 1850/1850, `pnpm run build` OK (BUILD_ID generado) y `tests/integration/imss-phase0-db.test.ts` 12 casos contra base Postgres aislada — ejecutando las rutas **reales**, no una réplica de su lógica. La "prueba manual con 1 alta + 1 baja + 1 activo" quedó automatizada. Al cerrar aparecieron H15/H16/H17, también corregidos.

### Phase 1: Foundation — persistencia del estado afiliatorio

**T5–T7 implementadas para revisión el 2026-10-24; migración operativa aplicada con GO explícito el 2026-10-24.** Evidencia: `tasks/evidencia/imss-foundation-2026-10-24/README.md`. Ver detalle y resultados en `tasks/todo-imss.md`.

Precisiones respecto del diseño inicial: todas las funciones reciben `companyId` explícito. La adopción conserva `fileId=NULL` y folio `MIGRACION` en la auditoría transaccional: no existe `acuseFolio` en el schema de movimientos, y crear un `imss_files` sin `.txt` falsearía el historial. El botón con preview previo sigue en T11. Registro patronal: primera posición alfanumérica + diez dígitos, sin presuponer una letra de clase. Las fechas de creación/acuse/confirmación usan `timestamptz`.

- [x] **Task 5 (S).** Migración `drizzle/0121_imss_movimientos.sql` (nombre a mano, patrón de `0103`/`0110`): 3 enums, 2 tablas, 2 columnas nuevas, índices (`company_id, user_id`, `company_id, status`, `company_id, fecha_movimiento`), sin `DROP`, sin RLS (decisión 9). Exportar ambas tablas en `lib/db/schema.ts` (el archivo monolítico sigue siendo la casa de las tablas laborales) y, si se modulariza, en `lib/db/schema/index.ts`.
  **Aceptación:** `pnpm db:generate` no propone `DROP`; migración aplica idempotente en base de prueba; `tsc --noEmit` limpio.
  **Verificación:** `pnpm db:generate` + revisión del `.sql` generado + `pnpm test:integration` (setup).
  **Dependencias:** Checkpoint 0. **Archivos:** `drizzle/0121_imss_movimientos.sql`, `lib/db/schema.ts`.

- [x] **Task 6 (M).** Servicio `lib/services/compliance/imss-movement-service.ts` — toda la escritura pasa por aquí, con `companyId` en **cada** `WHERE` y `AuditService` en cada transición:
  - `getAfiliacionState(userId)` → último movimiento por tipo (`DISTINCT ON`), sin N+1 cuando se pide en lote.
  - `ensurePendingMovements(companyId, type)` → crea/reutiliza movimientos `PENDIENTE` para altas (sin ALTA confirmada) y bajas (terminados sin BAJA), con `blockedReason`.
  - `confirmFile(fileId, { acuseFolio, accepted, reason })` → transición de los N movimientos, en una transacción.
  - `adoptAsRegistered(userIds, effectiveDate, actorId, nota)` → carga inicial: crea movimientos `CONFIRMADO` con `acuseFolio = 'MIGRACION'` para la plantilla que ya estaba registrada antes de Pulso. **Es el mecanismo que evita que los 80 empleados históricos aparezcan como pendientes para siempre.**
  **Aceptación:** `ensurePendingMovements` es idempotente (correr 2 veces no duplica, gracias a `unique`); `confirmFile` es atómico; ninguna función acepta `companyId` implícito; `adoptAsRegistered` deja rastro auditable distinguible de una confirmación real.
  **Verificación:** `tests/integration/imss-movement-service.test.ts` — idempotencia, aislamiento entre dos empresas, transición inválida (`CONFIRMADO → PENDIENTE` rechazada).
  **Dependencias:** T5. **Archivos:** `lib/services/compliance/imss-movement-service.ts` (nuevo), `tests/integration/imss-movement-service.test.ts` (nuevo).

- [x] **Task 7 (S).** Carga del registro patronal: `PATCH /api/company/branches/[id]` (o el endpoint que ya exista) acepta `imssRegistroPatronal` con validación de 11 caracteres (primera posición alfanumérica + diez dígitos); campo en la pantalla de sucursal (`app/dashboard/company/...`). Sin este dato, el generador se niega a emitir (H7, decisión 4).
  **Aceptación:** sucursal sin registro patronal → el generador responde 400 con la lista de sucursales faltantes; valor inválido rechazado en el borde.
  **Verificación:** prueba manual + test de validación.
  **Dependencias:** T5. **Archivos:** `lib/db/schema/core.ts` (tipo), endpoint de sucursales, `app/dashboard/company/`.

> **Checkpoint Foundation:** migración aplicada sin `DROP`; servicio con tests de integración verdes; aislamiento multi-tenant probado con dos empresas.

### Phase 2: Generadores con un solo formato y archivos persistidos

- [x] **Task 8 (M).** Unificar generación en `imss-parser.ts`: `buildIdseFile(movements, { registroPatronal, layoutVersion })` y `buildSuaFile(...)` puros (sin DB), devolviendo `{ content, sha256, lineCount, layoutVersion }`. Los endpoints dejan de armar líneas inline (decisión 6). El parser gana un guard: si `sdiCents` viene vacío o 0, lanza y no emite la línea.
  **Aceptación:** el mismo movimiento produce byte-idéntico en dos llamadas (hash estable); línea con SDI 0 nunca se emite; `layoutVersion` presente en cada salida.
  **Verificación:** `pnpm test:unit -- imss-parser` con golden files (un alta, una baja, una modificación) comparando el string completo.
  **Dependencias:** T4. **Archivos:** `lib/services/compliance/imss-parser.ts`, `lib/services/compliance/imss-parser.test.ts` (nuevo).

- [x] **Task 9 (M).** `POST /api/imss/files`: recibe `{ movementType, employeeIds, fechaMovimiento }`, valida (identidad completa, contrato, **uno solo registro patronal**, sin duplicar un movimiento ya `CONFIRMADO`), llama al parser, y en **una transacción** inserta `imss_files` + actualiza los `imss_movements` a `EN_ARCHIVO` con `fileId`. Responde el binario con `Content-Disposition` y cabeceras `X-File-Id`. Sustituye a `idse-generate` y `sua-generate` (que quedan como alias que delegan, para no romper nada).
  **Aceptación:** archivo persistido con sha256; segunda llamada con la misma selección devuelve 409 (unique por `content_sha256`) en vez de duplicar; mezclar dos registros patronales → 400 con mensaje; empleado sin NSS → excluido y listado en la respuesta.
  **Verificación:** integración: generar, re-generar, consultar historial; el `sha256` del body coincide con el guardado.
  **Dependencias:** T6, T8. **Archivos:** `app/api/imss/files/route.ts` (nuevo), endpoints viejos como wrapper.

- [x] **Task 10 (S).** `GET /api/imss/files` (historial paginado por `companyId`, con `status`, `lineCount`, `acuseFolio`) y `PATCH /api/imss/files/[id]` para registrar acuse (`{ accepted, acuseFolio, reason }`) → propaga a `confirmFile`. **Solo `SUPER_ADMIN`/`ADMIN`** vía `requireRoleApi` (D1: `GERENTE`/`SUPERVISOR` no confirman acuses, y `OWNER`/`RRHH` no existen como rol).
  **Aceptación:** confirmar un archivo pone sus movimientos en `CONFIRMADO` y el empleado desaparece de "pendientes de alta"; rechazar deja `motivo` y devuelve el movimiento a seleccionable.
  **Verificación:** integración de aceptar y de rechazar; verificar RBAC (rol sin permiso → 403).
  **Dependencias:** T6, T9. **Archivos:** `app/api/imss/files/[id]/route.ts` (nuevo).

### Phase 3: Pantallas sobre el estado real

**Cierre 2026-10-25:** T11–T18 completadas y comprobadas con navegador y rutas reales. Se completó el banner de incorporación histórica, se corrigió la adopción tras reingreso y se añadió `tests/integration/imss-flow.test.ts`. Controles finales: 2129 unitarias, 89 de integración y 8 de navegador verdes; build completo con TypeScript aprobado y lint general sin errores. Resultados y límites: `tasks/evidencia/imss-ui-2026-10-25/README.md`.

- [x] **Task 11 (M).** `altas/page.tsx`: columna "Estado IMSS" real (`SIN ALTA` / `EN ARCHIVO` / `CONFIRMADA`), checkbox habilitado en `LISTO` **y** `VENCIDO` (H2), motivo del bloqueo como texto (no un `-`), banner de adopción masiva para la plantilla histórica, y descarga desde el archivo persistido. Se elimina el cálculo local de contadores: los números vienen del endpoint.
  **Aceptación:** un vencido se puede seleccionar y generar; un bloqueado por `SIN_SALARIO_BASE` muestra por qué; tras confirmar acuse la fila sale de la tabla.
  **Verificación:** manual en dev server con 4 casos (listo, vencido, bloqueado, confirmado) + `pnpm run build`.
  **Dependencias:** T9, T10. **Archivos:** `app/dashboard/compliance/imss/altas/page.tsx`.

- [x] **Task 12 (S).** `bajas/page.tsx`: mismo tratamiento; razón real de terminación; plazo en días hábiles; aviso "liquidación final" conservado pero con la fecha real.
  **Aceptación:** lista poblada con bajas reales; razón y fecha correctas.
  **Verificación:** manual tras offboard de prueba.
  **Dependencias:** T10, T3. **Archivos:** `app/dashboard/compliance/imss/bajas/page.tsx`.

- [x] **Task 13 (M).** SUA: endpoint propio `GET /api/imss/sua-candidatos` que devuelve `{ userId, name, nss, employeeNumber, branchName, registroPatronal, baseSalaryPesos, sdiPesos, contractId }` con `companyId` en el `WHERE` — se deja de usar `/api/employees` (H5). La pantalla muestra salario base y **SDI calculado** por renglón, sin default `300`; si falta contrato, el renglón queda deshabilitado con motivo. La fecha de movimiento se valida contra la ventana bimestral (decisión 5, H6).
  **Aceptación:** ningún empleado se puede enviar con SDI inventado; el SDI mostrado coincide con el del archivo generado (mismo helper).
  **Verificación:** integración del endpoint + comparación UI vs línea del archivo en un caso.
  **Dependencias:** T4, T9. **Archivos:** `app/api/imss/sua-candidatos/route.ts` (nuevo), `app/dashboard/compliance/imss/sua/page.tsx`.

- [x] **Task 14 (M).** `reports/page.tsx` sobre `GET /api/imss/files`: tipo, layout+versión, fecha de movimiento, empleados, estado, folio de acuse, descarga del archivo guardado, y acción "registrar acuse". Se borran el mapeo de empleados→archivo y los contadores hardcodeados (H9). Los KPIs se calculan sobre archivos reales; si no hay archivos, `—`, no `0%`.
  **Aceptación:** el número de "Archivos IDSE" es el número de filas de `imss_files`; el `sha256` descargado coincide con el del registro.
  **Verificación:** manual con 1 archivo generado + 1 confirmado.
  **Dependencias:** T10. **Archivos:** `app/dashboard/compliance/imss/reports/page.tsx`.

- [x] **Task 15 (S).** Resumen (`imss/page.tsx`) y `compliance-page-client.tsx`: KPIs desde el estado derivado (altas pendientes / vencidas / confirmadas, bajas idem), y se quita la promesa "acuses de recibo" hasta que exista el flujo de acuse (H14) — con T10 ya existe, así que aquí solo se corrige el cálculo de `complianceRate` para usar el mismo denominador en ambas pantallas.
  **Aceptación:** el `%` de Resumen y de la pestaña IMSS coincide con la misma definición y mismo número.
  **Verificación:** comparar ambas pantallas con datos dev.
  **Dependencias:** T11-T14. **Archivos:** `app/dashboard/compliance/imss/page.tsx`, `app/dashboard/compliance/compliance-page-client.tsx`.

### Phase 4: Legalidad, honestidad y red de seguridad

- [x] **Task 16 (S).** Plazos en días hábiles en todo el módulo, reutilizando `nthBusinessDay`/`getTodayInMx` de `lib/cron/imss-deadlines.ts` (H11). Los tests de T1 fijan el comportamiento (viernes→lunes = 1 día hábil).
  **Aceptación:** contratación en viernes no vence el miércoles siguiente por calendario; copy y cálculo coinciden.
  **Verificación:** `pnpm test:unit`.
  **Dependencias:** T1. **Archivos:** `lib/services/compliance/imss-rules.ts`.

- [x] **Task 17 (S).** Leyenda de formato en las 3 pantallas de generación y en `reports`: "Layout no validado contra el portal IMSS; úsese como archivo de trabajo". Actualizar `docs/business-invariants.md:3.9` con el estado real (`⚠️ layout propio, datos validados / importabilidad no verificada`) y `PROJECT_CONTEXT.md` (el "COMPLETADA ✅" de la Fase 2 es falso hoy).
  **Aceptación:** ninguna pantalla promete importabilidad ni acuses inexistentes.
  **Verificación:** lectura de los 2 docs + grep de "COMPLETADA" en la sección IMSS.
  **Dependencias:** T14. **Archivos:** `docs/business-invariants.md`, `PROJECT_CONTEXT.md`, 3 páginas.

- [x] **Task 18 (S).** Cierre: `tests/integration/imss-flow.test.ts` end-to-end del circuito (alta pendiente → archivo → acuse → empleado registrado; baja idem) y limpieza de `imss-parser.ts` (quitar exports sin uso) con `tsc`/lint verdes.
  **Aceptación:** el test demuestra el ciclo completo y falla si se rompe cualquiera de T1-T13.
  **Verificación:** `pnpm test:integration`, `pnpm run build`, `pnpm run lint`.
  **Dependencias:** todas. **Archivos:** `tests/integration/imss-flow.test.ts` (nuevo).

> **Checkpoint final:** circuito cerrado end-to-end; 0 hardcodes de estado (`registered: 0`, `suaCount = 0`, `baseSalary = 0`, `1.0452`, `300`); docs honestos.

## Riesgos y mitigación

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Migración en producción con 173 tablas y RLS parcial | Alto | Sin `DROP`, sin RLS, columnas nullable; `db:generate` revisado a mano antes de aplicar |
| Los empleados históricos aparecen todos como "pendientes de alta" el día 1 | Alto (credibilidad del módulo) | `adoptAsRegistered` con `acuseFolio='MIGRACION'` es parte de la entrega, no un follow-up |
| El formato sigue sin ser importable y el cliente lo descubre tarde | Alto | Task 17 lo declara en la UI; validación contra portal es tarea aparte con el cliente |
| Registro patronal por sucursal no capturado aún | Medio | T7 lo pide en el borde; el generador se niega en vez de inventar |
| `imss-parser.ts` cambia y rompe un consumidor oculto | Bajo | Verificado: 0 imports hoy; los golden files de T8 fijan el contrato |
| Tests de integración requieren `.env.test` con Neon aislado | Medio | Resuelto: base aislada operativa (121 migraciones al día) y `tests/integration/imss-phase0-db.test.ts` ya corre el circuito |
| Cifrado PII (`PULSO_ENCRYPT_PII`) activado en producción | Alto | H17: las 4 rutas descifran con `decryptProfileRecords` (no-op cuando el dato está en claro) antes de validar NSS/CURP/RFC |

## Decisiones resueltas (2026-10-22)

Las cuatro preguntas abiertas quedaron cerradas. Cada una se resolvió contra lo que el repo **ya tiene**, no contra un ideal: si una decisión exigía un rol o un servicio inexistente, se ancló a la pieza real y se anotó la salida.

### D1 — Quién registra el acuse (RBAC de T10)

`lib/rbac/permissions.ts` define exactamente seis roles: `SUPER_ADMIN | ADMIN | GERENTE | SUPERVISOR | EMPLEADO | READONLY`. **No existen `OWNER` ni `RRHH`**, así que el plan original nombraba roles fantasma.

- **Pueden confirmar/rechazar un acuse: `SUPER_ADMIN` y `ADMIN`.**
- **No pueden: `GERENTE`/`SUPERVISOR`.** El acuse es un acto ante la autoridad con folio, no una operación de sucursal; además el acuse llega **por registro patronal**, y aceptarlo desde una sucursal invita a confirmar el archivo equivocado.
- Implementación en T10: `requireRoleApi(['SUPER_ADMIN', 'ADMIN'])` en `PATCH /api/imss/files/[id]`.
- **Salida si el cliente exige que un analista de RRHH sin rol admin lo haga:** agregar el permiso puntual `compliance.imss.acknowledge` (verificable en el handler) **sin** agregar un valor a `UserRole` — un rol nuevo reabre `hasAccess`, `getDefaultDashboard` y las 30+ rutas que enumeran roles.

### D2 — ¿Se conserva el `.txt`? Sí, en R2 con retención de 12 meses

Un acuse `RECHAZADO` solo se puede diagnosticar con los **bytes exactos** que se enviaron; con `sha256` y metadatos se puede probar que el archivo cambió, pero no ver qué decía.

- Se guarda en `lib/storage/r2-client.ts` (ya existe, con fallback local), bajo el prefijo del tenant, en bucket **privado**, con descarga por rol.
- Retención 12 meses y borrado por cron de Inngest.
- **PII aceptada explícitamente:** el archivo contiene NSS/CURP/RFC/nombres en claro. El cifrado `enc::` de `employee-cipher.ts` aplica a columnas de `employee_profiles`, **no** al binario. Se compensa con bucket privado + retención + RBAC, no con cifrado del archivo.
- **Si R2 no está configurado** (dev/local): se guarda `sha256` + metadatos y `content_unavailable = true`; la UI **no** ofrece descargar. No se finge un archivo que no existe.
- Columnas añadidas a `imss_files` en T5: `storage_key text`, `content_unavailable boolean not null default false`.

### D3 — Adopción de la plantilla histórica: botón explícito, nunca automática

Se adopta como `CONFIRMADO` **solo** por acción humana:

- `adoptAsRegistered` con `acuseFolio = 'MIGRACION'`, `actorId` y nota obligatoria (T6), en un lote = una sucursal.
- **Preview (dry-run) previo** con el conteo de quién cambiaría de estado; sin preview no hay botón.
- `hire_date` anterior a la implantación de Pulso **no** es criterio de adopción. Es exactamente el tipo de inferencia que el módulo viene a eliminar.

### D4 — Alcance del SUA: confirmado, sin cuotas obrero-patronales

El módulo emite **archivos de movimiento**: IDSE altas (08), bajas (02), modificación de salario (07) y SUA de actualización salarial. **No** calcula cuotas obrero-patronales: SBC, topes UMA, ramas RM/O/I/P, prima de riesgo de trabajo, cuota obrera ni SIPARE. Eso es un módulo propio.

`companies.imss_prima_riesgo_trabajo` se captura como **dato de registro** y no alimenta ningún cálculo de este módulo. Si alguien la usa para "estimar" cuotas, está fuera de alcance por definición.

### D5 — No RLS en esta migración (ya era la decisión 9): se sostiene

Confirmado al cerrar Phase 0 con evidencia: el piloto de RLS exige leer dentro de la transacción que fija `app.current_company_id`. Un servicio que corre fuera ve **cero filas en silencio**. Se aísla por `companyId` en cada `WHERE` (criterio vigente del repo) y RLS queda como follow-up **anotado**, no como deuda invisible.

---

## Gate Phase 0 → Phase 1 (aprobación humana, no delegable)

La migración `0121` no se aplica sin GO explícito. Estado de la evidencia para decidir:

| Verificación | Resultado |
|---|---|
| `npx tsc --noEmit` | limpio |
| `pnpm test:unit` | 1850 passed, 1 skipped, 1 todo |
| `pnpm run build` | OK — `BUILD_ID` generado |
| `pnpm test:integration` | 50 passed / 10 files (incluye 12 casos nuevos de IMSS contra Postgres real) |
| Migraciones en base aislada | al día (121), sin `DROP` en las pendientes |

Lo que la migración `0121` toca: **3 enums nuevos, 2 tablas nuevas, 2 columnas nullable en tablas existentes** (`branches.imss_registro_patronal`, `companies.imss_prima_riesgo_trabajo`). Sin `DROP`, sin `NOT NULL` sobre datos existentes, sin RLS. Reversible con `DROP TABLE` de las dos tablas nuevas.

## Ejecución autorizada — 2026-10-24

GO explícito recibido y `0121` aplicada en una transacción a la base operativa (journal id 138; hash y schema verificados). `0122` no se incluyó. T8–T10 implementadas: parser único, archivos persistidos, historial, descarga privada, acuses por rol y retención. Evidencia y límites: `tasks/evidencia/imss-files-2026-10-24/README.md`. T11–T18 se cerraron el 2026-10-25; ver `tasks/evidencia/imss-ui-2026-10-25/README.md`.
