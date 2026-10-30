# Vistas, roles y permisos — implementación local

Inicio: 2026-10-30. Base Git: `e2e8e9acf07955edb19ebbe2db1707008df69993`.
La política del plan queda **adoptada sin cambios de producto** por instrucción
del usuario. Esta evidencia es distinta de la auditoría productiva histórica.

## RP-00 · inventario y baseline

Fuentes estructurales: CodeGraph `context` (evaluateAccess, getDefaultDashboard,
resolveBranchScope), `explore` (raíz de dashboard, PERMISSIONS, proxy), `files`
(`app/api`, `app/actions`, `app/api/executive`). El índice está inicializado.
El [snapshot de fuentes](inventory.json) completa el mapa con imports, llamadas,
URLs literales y SHA-256 por archivo; se reproduce con `node
tasks/evidencia/vistas-roles-2026-10-30/inventory.mjs`. No consulta DB.
Se capturó antes de modificar comportamiento. Una URL dinámica exige seguir el
import del componente/servicio; una llamada listada no demuestra autorización.

| Entrada | Fuentes / operaciones afectadas | Guarda / alcance observado en fuente local | Incremento |
|---|---|---|---|
| `/dashboard` | LiveCommandSection → LiveCommandService.getLivePulse; GroupAreaOverview → GroupExceptionsService.listOpen/CrossBranchService.getBenchmarking; RecentActivity → workflowInstances/templates/users; PinnedAnnouncements | resolveRequestBranchScope; sin filtro assignee en RecentActivity; OWN ausente | 02,07,13,14,15 |
| `/dashboard/executive?view=cockpit/economics/liquidity` | companies; ExecutiveTwinEngine.getLatest; CrossBranchService.getBranchRanking; MorningBriefService.getLatest; ExecutiveDecisionService.list | sesión/empresa, sin capacidad de dirección antes de Promise.all; ranking recibe contexto ABAC, twin/brief globales | 03,04,17 |
| GET `/api/executive/twin` | ExecutiveTwinEngine.getLatest | reports:read; empresa de sesión, snapshot de grupo | 05a |
| GET `/api/executive/brief/latest` | MorningBriefService | reports:read; empresa de sesión | 05a |
| GET `/api/executive/brief/history` | MorningBriefService | reports:read; empresa de sesión | 05a |
| GET `/api/executive/feed` | MorningBriefService.getDecisionFeed | reports:read; empresa de sesión | 05c |
| GET/POST `/api/executive/decisions` | ExecutiveDecisionService.list/resolve/revoke | reports:read/manage; empresa de sesión | 05b |
| GET/POST `/api/executive/reason` | TierService.getFeatureGate / IntelligenceService.reasonAbout | reports:read incluso POST; puede disparar IA | 05b |
| POST `/api/executive/twin/refresh` | recálculo ejecutivo | reports:manage; revisar efectos antes de pruebas | 05b |
| GET `/api/analytics/executive-summary` | analytics-service.getExecutiveSummary | sesión/empresa, role/branch enviados al servicio; falta capacidad ejecutiva | 05c |
| `/dashboard/my-tasks`, `/dashboard/workflows`, `/dashboard/execute`, historial/review | workflow-templates, workflows/assignments, execute, instances, pasos; lib/workflows/execution-access | acceso de ruta no equivale a elegibilidad; catálogo permite elegir usuario; conservar guardas de ejecución existentes | 08a,08b,21 |
| `/dashboard/incidents`, `/dashboard/exceptions` | incidents/**, exceptions/**, group/exceptions, analytics/incidents; branch-incident-stats; GroupExceptionsService; exception-lifecycle-actions | varias guardas por rol/tenant/scope; separar read/create/resolve y autor del incidente antes de summaries/counts | 09a,09b |
| `/dashboard/team` | GET/POST users, branches; UserService.listUsers/createUser | GET tenant con branch de query; POST hasPermission/canManageRole (>= admite pares) | 10,11a,11b,12 |
| `/api/users/[id]` GET/PATCH/DELETE | UserService.getUser/updateUser/deleteUser | withTenantAuth; GET compara company; PATCH elimina role/company del body pero no autoriza objetivo; DELETE sin alcance objetivo en handler | 10,11a,11b |
| perfil propio `/api/profile`, `/api/users/profile`, preferences, `/api/me`, `/api/auth/get-session` | getSession/users; PATCH perfil | identidad desde sesión; `/api/profile` GET devuelve fila completa, PATCH returning completo; DTO pendiente | 10,11a |
| `/dashboard/employees`, Schedules, Inventory, Nómina | employees/**, shifts/sessions/templates, schedules/assignments, inventory/**, payroll/**; nav-company | GERENTE/SUPERVISOR fijos en helper; useMemo previo candidato para #185; no se atribuye aún causalidad | 06,10,14 |
| `/dashboard/compliance`, branches | corporate-status, analytics/compliance/trends, branch-service, ranking | verificar filtros comunes y denominadores, no considerar 0 ausencia de mediciones | 16,20 |
| `/dashboard/reports` | reports/generate, execute, scheduled/**, templates/**, stats, attendance/compliance/control/employee-analytics/incidents/labor-compliance/lft-violations/nom-035/nom-251/overtime; external-reports/generate | separar lectura/export de programación/jobs; clasificación y alcance deben aplicarse al worker y archivo | 15,16 |
| exportaciones financieras relacionadas | payroll/export, payroll/[id]/payslips, finance/treasury/runs/[id]/layout, inventory/reports/** | preservar guardas fiscales y clasificación; no probar mediante escritura fiscal | 05c,15,22 |
| notificaciones / enlaces de actividad | notifications GET, [id]/read, preferences, dispatch/process/test-whatsapp; profile/notification-preferences; hooks/use-notifications | lectura técnica separada de comunicación; destinos requieren reautorización; no ejecutar dispatch/process/test-whatsapp | 18b,19 |
| cambio de sucursal | app/actions/user.switchBranch; branch-context; tenant-context; effective-branch | persiste users.branchId tras resolveBranchScope; no usar como prueba de solo lectura; preferencias no son autoridad | 02 |
| acciones adicionales | inventory-transactions, inventory, shift-overrides, shifts, workflow-completion-recovery, workflow-overrides | conservar guardas de objetivo/tenant de cada dominio; inventario de imports en snapshot | 08b,09b,22 |

No se encontró un handler dedicado de exportación bajo `app/api/executive/**`:
05c incluye feed y analytics/executive-summary y debe revisar fuentes auxiliares
antes de cerrarse. No significa que los exports generales ya estén protegidos.

### Decisiones adoptadas (propuestas en plan; todavía no equivalen a entregadas)

| Decisión | Contrato |
|---|---|
| OWNER | Séptimo rol real; dirección de su empresa. Facturación no se amplía por copiar SUPER_ADMIN. |
| READONLY | BRANCH fija; sin asignación NONE; exports operativos permitidos, escrituras de negocio prohibidas. Sesión/logout y lectura técnica no son negocio. |
| EMPLEADO | OWN (userId + empresa + sucursal cuando corresponda), nunca lista de compañeros. |
| GERENTE / SUPERVISOR | BRANCH fija; GERENTE solo gestiona empleados subordinados; SUPERVISOR no recibe constructor ni tesorería. |
| Finanzas / fiscal | Agregado operativo, nómina individual, timbrado y dispersión son capacidades distintas. Las guardas fiscales actuales siguen siendo obligatorias. |
| Permisos | Catálogo en lib/permissions.ts (cliente puro); ABAC y reglas de objetivo solo reducen. No crear otra matriz completa. |

### Cambios ajenos al comienzo

Sin stage: `.codegraph/.gitignore`, `components/nav-company.tsx`, `opencode.jsonc`,
`tasks/plan-auditoria-frontend.md`, `tasks/plan-imss.md`, `tasks/todo-auditoria-frontend.md`.
El `useMemo` de nav-company ya existía y se conserva intacto.

Staged: `docs/nomina-rls-rollout.md`; todo el lote
`tasks/evidencia/consolidado-2026-10-22/OPS-02-nomina-F1/`; `REVISION-2026-10-29.md`;
`tasks/todo-consolidado-faltante.md`; los dos tests de aguinaldo
`tests/integration/aguinaldo-{reminder-runtime,runtime-recovery}-db.test.ts` y
`tests/integration/helpers/nomina-rls-batch.ts`.

Sin seguimiento: `.qoder/`, auditorías frontend demo/roles, seed-demo, plan-imss-operacion
y los documentos de plan/tracker de esta tarea. No reset, stash, limpieza ni add -A.

### Verificación actual

- Baseline focal antes de código: siete suites, **127 passed, 1 todo**, exit 0.
  ABAC, rutas, excepciones, masking, payroll-authorization, execution-access y session-scope.
- Browser local: [baseline aislado](local-baseline.json), capturado a las
  15:30:43 UTC. Tres contextos independientes, Juan/Ana/Pedro, cuatro rutas cada
  uno. Pedro recibe actividad/calificaciones de Luisa en la raíz; los tres
  reciben cabina y simulaciones ejecutivas. Pedro recibe 403 en Schedules y
  Directorio. Las páginas Schedules/Directorio de Juan/Ana solo se capturaron
  con shell inicial; **no** acredita RP-06 ni descarta #185 tras cargar datos.
  Ningún pageerror capturado en esta muestra corta. No se activaron simulaciones.
- Primer login falló por TLS de Neon (`unable to verify the first certificate`).
  SELECT 1 falló con Node normal y pasó con `node --use-system-ca`. El servidor
  de esta tarea se reinició con `NODE_OPTIONS=--use-system-ca`, sin cambiar
  configuración persistente ni desactivar validación TLS. BSK perdió sus sesiones
  repetidamente; tras recuperación y nuevo timeout de renderer se utilizó
  Playwright con contextos aislados. No se detuvo el daemon compartido.
- Ningún dato/cifra de la auditoría histórica acredita el estado actual.
- Preview y producción: pendientes; producción sin autorización.

## RP-01 · capacidades

Catálogo de recursos/acciones y matriz en `lib/permissions.ts`, sin runtime imports
de DB/auth. `manage` solo implica acciones registradas para ese recurso; rol,
recurso o acción desconocidos deniegan, también para SUPER_ADMIN.

| Acción previa | Capacidad específica para consumidores migrados |
|---|---|
| reports:read usado en cabina | executive:read |
| reports:read usado para copiloto | executive:reason |
| reports:manage usado para decisiones/refresh | executive:resolve / executive:refresh |
| reports:read / manage usado para descargar | reports:export (operativo) / executive:export (dirección), más DTO/clasificación |
| workflows:update usado para ejecutar | workflows:execute más asignación/estado/rol de plantilla |
| workflows:create/update usado para constructor | workflows:build |
| exceptions:update usado para resolver | incidents:resolve en incidentes; lifecycle de exceptions se migra explícitamente en RP-09 |
| permiso genérico para finanzas/nómina | financial-summary:read / payroll:manage; no sustituir las guardas fiscales actuales |
| users:update usado para perfil propio | profile:update más userId de sesión; gestión subordinada sigue users + objetivo en RP-11 |

RED: capabilities.test.ts tuvo 13 fallos sobre el comportamiento original.
GREEN: ocho suites focales, **142 passed, 1 todo**, exit 0. El snapshot histórico
del catálogo de exceptions se amplió con los recursos explícitos de RP-01; sus
tests de autorización se conservaron. Suite completa RP-01: **185 archivos,
2310 passed, 1 skipped, 1 todo**, exit 0 ([log](rp01-unit.log)). Incluye pruebas
de seed con dobles locales, no se ejecutó ningún comando de resiembra.
Lint focal exit 0. Typecheck primero detectó dos errores en archivos IMSS de la
sesión paralela; un segundo check tras sus cambios terminó exit 0.
Build local **exit 0**, compilación, TypeScript y generación de rutas aprobados
([log](rp01-build.log)); servidor propio detenido antes de construir.
Lint global detectó incompatibilidad del config existente con los scripts `.cjs`
de evidencia. Se convirtieron a módulos `.mjs` soportados, sin relajar reglas;
el segundo lint global terminó **exit 0** ([log](rp01-lint.log)).
Ningún consumidor puede conceder acceso por esta tabla sin autorizar el objetivo.

## RP-02a · alcance puro por recurso

`lib/rbac/resource-scope.ts` representa NONE/OWN/BRANCH/COMPANY con empresa y
propietario explícitos. El catálogo de sucursales debe proceder de servidor.
Una preferencia de dirección fuera de empresa devuelve NONE; los roles fijados
ignoran la preferencia y usan su asignación. Sin asignación válida no reciben
consolidado. Perfil propio es OWN también para dirección. Clasificación,
franquicia y elegibilidad siguen siendo restricciones adicionales obligatorias.

RED: módulo ausente; GREEN: nueve casos del resolver y quince de capacidades
(24 aprobados), lint focal exit 0. Este incremento **no migra aún consumidores**
ni declara resuelta la fuga de compañeros. RP-02b/02c aplicarán los adaptadores.

## RP-02b/c · adopción de alcance (en verificación)

- `getRoleScope` es la clasificación compartida de roles. Los helpers fijan
  GERENTE/SUPERVISOR/EMPLEADO/READONLY; un rol desconocido falla cerrado.
- ABAC exige empresa, valida empresa objetivo y rechaza falta de asignación.
  FINANCIAL con redacción continúa hasta la comprobación de franquicia.
- La regresión de lectura de compañeros detectada por execution-access se
  corrigió conservando su comprobación de responsable después del límite de
  sucursal. READONLY solo consulta su sucursal; sin asignación deniega antes de DB.
- La visibilidad se reduce antes de agregar, también para franquicias del propio
  actor fuera de su sucursal. Catálogos legacy sin companyId deben llegar ya
  filtrados por empresa; los nuevos catálogos comprueban companyId explícito.
- Layout filtra sucursales antes de serializar; Provider y NavCompany comparten
  política. El bloque useMemo preexistente queda intacto. El Provider conserva
  identidad de catálogo y ya no restaura autoridad desde cookies en un efecto.
- La preferencia se reinicia al cambiar identidad/rol/asignación. El resolver
  server comprueba sucursal/empresa: query inválida → NONE; cookie obsoleta de
  dirección → preferencia descartada; error de red → error, no vacío.
- `enforceBranchScope` legacy ya no devuelve null para un rol fijado sin
  asignación: lanza 403. Sus tests se ajustaron a esta restricción adoptada.

Verificación: 139 casos focales de helpers/ABAC/ejecución/fiscal aprobados;
visibilidad/ABAC/masking/cross-branch: 61 passed/1 todo; preferencias/petición:
13 passed; helper/petición/inventario PGlite: 76 passed. Lint focal aprobado.
La primera suite global RP-02 tuvo un contrato READONLY antiguo (ya corregido,
con nuevos negativos) y un timeout del seed aislado. No se ampliaron timeouts ni
se omitieron pruebas. Se repetirá con dos workers tras los checks en curso.
Lint global RP-02 interrumpido por contención de recursos, no aprobado; TypeScript
RP-02 todavía en curso. [Script de scope en navegador](verify-scope.mjs)
preparado; ejecución y build del cierre RP-02 pendientes.

Commits propios verificados hasta aquí: `f92dec0` (RP-01/02a), `088b4c0`
(RP-02b1a), `ae5ddc4` (RP-02b1b). Ninguno incluye los staged ajenos.
