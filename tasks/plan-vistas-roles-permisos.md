# Plan de implementación: vistas, datos y acciones por rol

Fecha: 2026-10-30. Estado: **plan preparado; implementación pendiente**.

Fuente principal: [auditoría de producción por roles](evidencia/frontend-roles-2026-10-30/README.md), hallazgos ROLE-01–ROLE-10 y sus archivos de evidencia. Tracker: [todo-vistas-roles-permisos.md](todo-vistas-roles-permisos.md).

Este plan sustituye la idea de que basta con ocultar menús. El cierre local del plan anterior no acredita estas correcciones. No se ha verificado el SHA desplegado ni se asume que producción coincida con el workspace.

## 1. Objetivo y límites

Cada usuario debe recibir una vista útil para su responsabilidad, con **los mismos permisos y el mismo alcance en consultas, páginas, APIs, acciones y navegación**. Un dato prohibido no debe llegar al cliente para ocultarlo después. Un 200 con «Algo salió mal» no es una verificación satisfactoria.

Construir experiencias de dirección, operación y trabajo/consulta reutilizando componentes, sin mantener seis dashboards duplicados. El rol proporciona permisos base; el objetivo de la operación, la empresa, la sucursal, la propiedad del registro y la clasificación de datos completan la decisión.

En alcance: los diez hallazgos, las vistas iniciales de las ocho cuentas del seed, rutas directas, acciones de servidor, exportaciones relacionadas y pruebas negativas entre usuarios/sucursales/empresas. Revisar también `OWNER`, que existe en el dominio aunque no esté entre esas cuentas.

Fuera de alcance: rehacer el sistema fiscal, crear un constructor de permisos configurables, introducir roles nuevos, rediseñar todo el producto, migrar todos los servicios sin relación con estas vistas o ejecutar operaciones reales para probar permisos. Conservar reglas fiscales, ABAC, cifrado, clasificación y RLS existentes.

## 2. Política de producto propuesta

Esta tabla es la base propuesta para implementar; no describe el comportamiento actual. Una instrucción posterior de implementar este plan sin cambios adopta estos valores. Si el usuario pide ajustar una decisión, registrar el cambio antes de modificar los consumidores afectados. No ampliar permisos por comodidad técnica ni convertir las dudas en permisos globales.

| Rol | Vista de entrada | Alcance predeterminado | Datos y acciones principales | Exclusiones |
|---|---|---|---|---|
| SUPER_ADMIN | Dirección del grupo | Empresa de la sesión, con selector de sus sucursales | Dirección, operación, configuración y administración dentro de su autoridad | No cruzar empresas por un bypass de rol ni saltarse reglas fiscales/segregación |
| ADMIN | Administración del grupo | Empresa de la sesión, con selector | Gestión operativa/administrativa, equipo subordinado y reportes autorizados | No editar/asignar SUPER_ADMIN ni suscripción; operaciones fiscales conservan su guarda específica |
| GERENTE | Operación de su sucursal | Sucursal asignada, fija | Pendientes, personal operativo, inventario, incidentes y resultados operativos propios; constructor según permiso existente | Sin cabina ejecutiva global, datos salariales individuales, timbrado/dispersión, gestión de pares/superiores u otras sucursales |
| SUPERVISOR | Control del turno | Sucursal asignada, fija | Asignaciones autorizadas, verificaciones, seguimiento e incidencias del turno | Sin administración de roles, constructor, cabina ejecutiva, nómina o tesorería; sin aprobar pagos |
| EMPLEADO | Mis tareas | Propio, dentro de su sucursal | Sus asignaciones/ejecuciones/evidencias y su información personal permitida; reportar incidentes | Sin actividad/calificaciones de compañeros, agregados de cadena, finanzas ni resolución general de incidentes |
| READONLY | Consulta operativa | Sucursal asignada; sin sucursal = NONE | Indicadores y reportes operativos autorizados, sin datos sensibles/financieros | Sin escrituras de negocio, ejecución, aprobación, programación de reportes, recordatorios o edición |
| OWNER, compatibilidad | Dirección de su empresa | Empresa de la sesión | Preservar capacidades legítimas existentes y definirlas explícitamente en el catálogo | No eliminarlo por no estar en el seed; resolver diferencias de facturación frente a las rutas actuales sin ampliar privilegios |

Precisiones para evitar decisiones implícitas:

- **READONLY global no se infiere del rol.** Este lote usa su sucursal asignada. Si después se necesita consulta de empresa, deberá existir una concesión explícita y probada; no crear una migración solo para anticiparla.
- **Finanzas y nómina no son una sola capacidad.** GERENTE puede consultar resultados operativos agregados de su sucursal si la política de clasificación existente lo permite. No obtiene recibos, salarios individuales, cuentas bancarias ni acciones fiscales. SUPERVISOR no recibe el módulo de tesorería por herencia de jerarquía. Consultar datos personales propios usa una capacidad diferente a administrar nómina.
- **ADMIN/SUPER_ADMIN/OWNER no reciben una concesión fiscal nueva.** Preservar las guardas específicas ya probadas; no convertir `reports:read` ni la entrada al dashboard en permiso para timbrar o dispersar.
- **Gestión de personas:** separar editar datos propios, gestionar empleados subordinados y asignar roles. GERENTE solo gestiona EMPLEADO de su sucursal dentro de campos permitidos; no promueve a GERENTE/ADMIN ni cambia empresa/sucursal arbitrariamente. ADMIN no gestiona pares ADMIN, OWNER o SUPER_ADMIN mediante el editor general. SUPER_ADMIN usa reglas explícitas; conservar protección del último administrador/propietario si existe y contemplarla en tests.
- **Plantillas y tareas:** ver un catálogo no concede ejecutar todas sus plantillas. Mantener requisitos de rol, asignación, sucursal y estado. Un flujo sin asignar se puede tomar solo cuando una regla explícita lo permita.
- **READONLY puede mantener estado técnico de sesión y lectura de notificaciones** cuando corresponda. La prohibición se refiere a escrituras de negocio; no bloquear logout ni mecanismos de seguridad.

## 3. Punto de partida técnico que la nueva sesión debe conocer

Stack: Next.js 16 App Router, React 19, TypeScript, better-auth, Drizzle/Neon, next-intl. El gestor del proyecto es pnpm.

Ya existen varias capas de autorización; no crear una cuarta matriz independiente:

| Capa existente | Observación / uso en el plan |
|---|---|
| `lib/permissions.ts` | Tipo `Role` desde schema, `PERMISSIONS`, jerarquía, `hasPermission` y `canManageRole`. Incluye OWNER. La comparación numérica `>=` no basta para decidir gestión de usuarios. |
| `lib/rbac/abac.ts` | `evaluateAccess`, `requirePermissionApi`, empresa/sucursal/ownership/clasificación y campos a ocultar. Incluye EMPLEADO entre los roles de sucursal. Preservar su protección y mejorar los contratos cuando falte contexto. |
| `lib/rbac/permissions.ts` | Matriz de rutas, tipo `UserRole` de seis roles y `getDefaultDashboard`. Puede conceder acceso por el padre `/dashboard`; no contiene una regla específica para Ejecutivo en el estado revisado. |
| `lib/branch-scope.ts` | En el estado revisado fija GERENTE/SUPERVISOR, pero no EMPLEADO. Discrepa con ABAC. Resolver semántica por recurso antes de reemplazar helpers globalmente. |
| `lib/rbac/employee-permissions.ts` | Permisos por campos; tiene un tipo local con HR y sin OWNER. HR no debe convertirse en un nuevo rol de aplicación por copiar ese tipo. |
| `lib/rbac/branch-visibility.ts`, `lib/rbac/masking.ts` | Reutilizar visibilidad y clasificación; inspeccionar contratos con CodeGraph antes de modificar. Ocultar campos no sustituye denegar un recurso completo. |
| `proxy.ts` | La puerta de páginas es adicional; no sustituye guardas en APIs, Server Actions o servicios. Conservar 403 explícitos. |
| `app/sign-in/page.tsx` | Actualmente dirige siempre a `/dashboard`. Resolver el destino en servidor con permisos vigentes, sin confiar en rol enviado por cliente. |

Hay cambios previos sin commit y archivos ya staged. En particular, `components/nav-company.tsx` ya contiene un `React.useMemo` candidato para el ciclo de render de los roles fijados. **No atribuirlo a esta implementación ni sobrescribirlo.** Revisar el diff actual al retomar: la lista puede cambiar después de guardar este plan. No usar `git add -A`, reset, stash o limpieza para conseguir un árbol limpio.

Pruebas existentes relevantes: `lib/rbac/__tests__/{abac,permissions,exceptions-permissions,masking,payroll-authorization}.test.ts`, `tests/unit/workflows/execution-access.test.ts`, `tests/unit/labor/session-scope.test.ts` y fixtures de dos empresas en `tests/fixtures/tenant-isolation.ts`.

## 4. Decisiones de arquitectura

1. **Una política ejecutable:** catálogo puro, compartible con cliente, con capacidades por recurso/acción y tipos del dominio. Integrarlo con la matriz base y ABAC; los helpers de rutas/UI serán adaptadores de esa política. Las restricciones de negocio y clasificación pueden reducir un permiso, nunca ampliarlo. Elegir la ubicación exacta en RP-01 para no duplicar matrices.
2. **Identidad confiable:** construir actor desde sesión verificada. `companyId`, rol y sucursal del actor nunca proceden del formulario, URL o cookie de preferencia. Objetivos de escritura se cargan y autorizan antes de modificar.
3. **Alcance explícito:** representar `NONE`, `OWN`, `BRANCH` y `COMPANY` con su contexto. OWN incluye `userId` y, cuando corresponda, sucursal; un filtro de sucursal no protege datos de un compañero de la misma sucursal. Aplicar empresa incluso a SUPER_ADMIN. Roles fijados sin asignación fallan cerrados.
4. **Resolver preferencias después del permiso:** una cookie puede elegir una sucursal permitida para ADMIN, pero nunca ampliar el alcance de EMPLEADO/GERENTE/READONLY. Devolver a la UI el alcance efectivo y su etiqueta. Limpiar preferencia incompatible al cambiar identidad.
5. **Páginas desconocidas:** no heredar todos los permisos de `/dashboard`. Inventariar rutas actuales antes de eliminar el fallback amplio y conservar páginas comunes autorizadas. La ruta raíz es exacta; cada grupo/subruta sensible tiene política explícita. APIs desconocidas no se autorizan por el permiso de una página.
6. **No fugas por serialización:** filtrar antes de count, summary, ranking, paginación y joins. Usar DTOs permitidos para el rol. No enviar datos prohibidos en HTML/RSC, props ocultas, exports, payloads de error ni caches compartidas. Auditar prefetch, acciones y fuentes auxiliares del mismo módulo.
7. **Jerarquía no equivale a permiso:** usar reglas actor/objetivo/rol nuevo para usuarios. Proteger cambios parciales y completos, asignaciones y activaciones/desactivaciones; una jerarquía numérica no concede permisos entre empresas o sucursales.
8. **Tres composiciones, sin duplicación:** dirección/administración, operación de sucursal/turno y trabajo personal/consulta. Reutilizar métricas, tablas y estados, pero cargar en servidor únicamente los modelos autorizados para cada composición.
9. **Contratos actuales:** mantener `{success,data}` y el manejo canónico de errores. Distinguir 401, 403, 404, ausencia de datos y fallo de red. No presentar un 403 como «Reintentar» ni una ausencia de datos como 0 %.
10. **Seguridad en cambios parciales:** un adaptador sin migrar no debe abrir acceso negado por la nueva política. Migrar por módulo con pruebas de paridad, sin una fase de allow global. Reutilizar el mecanismo RLS/contexto transaccional existente, también en workers y exports si son consumidores afectados.

## 5. Secuencia y dependencias

```text
RP-00 inventario / baseline
  └─ RP-01 política de capacidades
       ├─ RP-02 alcance efectivo
       ├─ RP-03 rutas explícitas
       └─ RP-04/RP-05 cierre de Ejecutivo

RP-06 render GERENTE/SUPERVISOR (independiente de nuevas concesiones)

RP-01..03 → RP-07 dashboard empleado → RP-08 agenda
RP-01..03 → RP-09 incidentes/excepciones
RP-01..03 → RP-10 equipo lectura → RP-11 equipo escritura → RP-12 editor
RP-01..03 → RP-13 entrada por rol → RP-14 operación → RP-15 consulta
RP-02 → RP-16 cumplimiento / RP-17 ejecutivo y alcance
vistas migradas → RP-18 navegación → RP-19 errores
RP-20 conteos / RP-21 metadatos → RP-22 pruebas completas → RP-23 preview → RP-24 publicación
```

La corrección del render puede hacerse después del inventario sin esperar al resto, pero no habilita módulos prohibidos. Las fases se ejecutan en orden y por incrementos. Si un paquete supera cinco archivos de implementación, descomponerlo en subtareas en el tracker antes de editar; cada una conserva sus tests y aceptación. No abrir un refactor masivo de permisos para entregar la primera contención.

### Fase A — Contrato y contención

#### RP-00 · Inventario y baseline reproducible · M

**Acción:** leer instrucciones actuales, informe, diff y tests; localizar con CodeGraph todos los consumidores de las páginas auditadas y sus APIs, acciones, exports y servicios. Escribir el inventario y la tabla de decisiones en evidencia de esta implementación.

**Aceptación:**
- [ ] Se distingue observado, propuesto y pendiente; OWNER, alcance READONLY y separación fiscal quedan cubiertos sin roles inventados.
- [ ] Hay mapa página → fuentes/acciones → guarda/alcance, incluyendo todos los endpoints `app/api/executive/**`, rutas de perfiles/usuarios, notificaciones y exports afectados.
- [ ] Hay baseline local con Juan/Ana/empleado y lista de cambios ajenos; ninguna cifra histórica se usa como prueba de hoy.

**Verificación:** revisión del inventario contra CodeGraph y un smoke read-only local. **Dependencias:** ninguna. **Archivos:** docs de evidencia + fixtures existentes; sin cambios de negocio.

#### RP-01 · Política ejecutable de capacidades · M

**Acción:** convertir la tabla propuesta en decisiones puras, tipadas y probables; adaptar `PERMISSIONS`/ABAC sin duplicar una lista completa en cada consumidor. Registrar la correspondencia entre acciones actuales (`read/create/update/manage`) y capacidades más específicas, como ejecutar o resolver.

**Aceptación:**
- [ ] Recurso/acción no definidos y rol desconocido se deniegan; OWNER tiene comportamiento explícito; no existe promoción automática por jerarquía.
- [ ] Hay capacidades distintas para consultar agregado financiero, administrar nómina, ejecutar flujo, resolver incidente, exportar y gestionar usuarios.
- [ ] El permiso cliente es una proyección pura de la misma política, sin imports de DB/auth/secretos; servidor vuelve a decidir con el objetivo real.

**Verificación:** tests de tabla de todas las combinaciones por rol; conservar suites ABAC/fiscal. **Dep.:** RP-00. **Archivos candidatos:** `lib/permissions.ts`, `lib/rbac/abac.ts`, módulo puro de política si hace falta y tests focales (máximo cinco en el incremento).

#### RP-02 · Alcance efectivo por actor y recurso · M

**Aceptación:**
- [ ] OWN/BRANCH/COMPANY/NONE incorporan empresa; actor sin asignación requerida o sucursal ajena no cae a ALL. OWN excluye compañeros de la misma sucursal.
- [ ] Cookies/query strings manipulados no amplían permisos; preferencia incompatible al cambiar usuario no persiste como alcance aparente.
- [ ] ABAC, helpers de sucursal y contexto visual comparten semántica; proteger regresiones de ADMIN y ownership/franquicias existentes.

**Verificación:** fixtures con dos empresas, dos sucursales y dos empleados en la misma sucursal; cookies obsoletas, sin sucursal y cambios de identidad. **Dep.:** RP-01. **Archivos:** `lib/branch-scope.ts`, `lib/rbac/branch-visibility.ts`, `lib/branch-context.tsx`, tests y adaptador de alcance si es necesario.

#### RP-03 · Rutas explícitas y guardas reutilizables · M

**Aceptación:**
- [ ] `/dashboard/executive`, raíz, grupos auditados y rutas comunes dejan de depender de un fallback que concede acceso a todo rol; variantes anidadas/query no lo eluden.
- [ ] Proxy, RSC, APIs y Server Actions usan adaptadores compatibles; solicitud directa no depende del sidebar ni del rol enviado por el cliente.
- [ ] 401/403/404 tienen contrato definido sin bucles de redirect; destinos de salida y páginas comunes siguen disponibles según rol.

**Verificación:** tests de rutas exactas/anidadas, contexto RSC/prefetch y guardas server; desconocidas fallan cerradas. **Dep.:** RP-00/01; usar RP-02 cuando la ruta carga datos. **Archivos:** `lib/rbac/permissions.ts`, `proxy.ts`, adaptadores de guarda y tests. No cambiar decenas de APIs en esta tarea.

#### RP-04 · Contener la página ejecutiva · S/M

**Aceptación:**
- [ ] EMPLEADO/READONLY/GERENTE/SUPERVISOR no reciben la cabina ni sus vistas economics/liquidity; dirección autorizada conserva el acceso.
- [ ] La autorización ocurre antes de cargar twin, brief, ranking, decisiones o proyecciones; HTML/RSC no contiene datos restringidos.
- [ ] La UI no ofrece simulaciones/consultas/exportación a quien no tiene esas capacidades.

**Verificación:** pruebas de la página con spies que confirmen que servicios prohibidos no se consultan; navegación directa negativa y positiva. **Dep.:** RP-01/03. **Archivos:** `app/dashboard/executive/page.tsx`, componentes ejecutivos afectados y tests.

#### RP-05 · Contener las fuentes y acciones de Ejecutivo · M por sublote

Dividir al inventariar: **05a** lecturas twin/brief/feed/historial; **05b** decisiones, reason y refresh; **05c** exportaciones o fuentes auxiliares descubiertas. Cada lote toca hasta tres handlers, su guarda compartida y tests. No tratar las rutas escritas aquí como inventario completo.

**Aceptación por sublote:**
- [ ] Llamadas directas sin permiso se rechazan antes de consultar/modificar datos o disparar trabajos/IA/mensajes; acceso válido conserva clasificación y tenant.
- [ ] Parámetros de empresa/sucursal/usuario no amplían alcance; errores no incluyen datos de la consulta denegada.
- [ ] Exports, prefetch/RSC y caché no ofrecen una segunda vía para recuperar el contenido bloqueado.

**Verificación:** handlers con sesión falsa y servicios simulados; efectos externos con contador cero en denegaciones. **Dep.:** RP-01/03, junto a RP-04. **Archivos:** `app/api/executive/**`, `app/api/analytics/executive-summary/route.ts` y consumidores concretos del inventario.

#### RP-06 · Corregir render de roles fijados a sucursal · S/M

**Aceptación:**
- [ ] Se reproduce y explica React #185 en local/preview antes de atribuirlo a una causa; revisar el `useMemo` preexistente sin sobreescribirlo.
- [ ] Juan y Ana abren Schedules, Directorio y Nómina sin ciclo de render; Ana abre Inventario. Si la nueva política prohíbe Nómina a esos roles, esa ruta muestra 403 deliberado y el componente se prueba con una identidad autorizada de alcance fijo en tests aislados.
- [ ] Selección de ADMIN, preferencia «Todas», cookie antigua, navegación y actualización de listas no reintroducen el bucle.

**Verificación:** regresión reproducible y Chrome DevTools con ambos roles; observar DOM y consola, no solo status HTTP. **Dep.:** RP-00; se integra con RP-02. **Archivos:** `components/nav-company.tsx`, `lib/branch-context.tsx` solo si la causa lo requiere y pruebas.

**Checkpoint A:** dirección conserva acceso; Ejecutivo queda cerrado por URL y fuentes a los demás; permisos fiscales anteriores no se amplían; estados de error se distinguen de denegaciones. Tests focales y build del incremento satisfactorios antes de integrar.

### Fase B — Datos y acciones autorizados

#### RP-07 · Dashboard seguro del empleado · M

**Aceptación:**
- [ ] `/dashboard` no carga ni serializa salud de red, caja, motivos personales o actividad de compañeros para EMPLEADO, aunque el cliente pida otra sucursal.
- [ ] Sus tareas/estado usan scope OWN y DTO mínimo; counts y KPIs no permiten inferir registros ajenos.
- [ ] Los enlaces generados corresponden a registros que puede consultar; la guarda de detalle sigue activa como segunda protección.

**Verificación:** regresiones Pedro/Luisa/Roberto, compañero en la misma sucursal y empresa ajena; inspección HTML/RSC. **Dep.:** RP-01/02/03. **Archivos:** `app/dashboard/page.tsx`, loaders/servicios realmente usados, componente personal y tests; dividir si supera cinco.

#### RP-08 · Agenda y ejecución autorizadas · M por sublote

Separar **08a** agenda/listado/historial y **08b** inicio/actualización de ejecución si son más de cinco archivos.

**Aceptación:**
- [ ] Agenda y catálogo devuelven solo tareas/plantillas elegibles; OWN no se sustituye por todas las tareas de la sucursal. Reglas para tomar tareas sin asignar son explícitas.
- [ ] Crear/iniciar/reasignar o actualizar una ejecución valida objetivo, asignación, sucursal, rol y estado en servidor; READONLY no ejecuta.
- [ ] GERENTE/SUPERVISOR conservan las tareas y acciones de su turno que la política permita; no se regresa el acceso propio a evidencias.

**Verificación:** tests de servicios y handlers con efectos simulados; navegador sin iniciar ejecuciones en producción. **Dep.:** RP-01..03/07. **Archivos:** páginas de workflows/execute, `lib/workflows/execution-access.ts`, rutas de ejecución y sus servicios, elegidos del inventario.

#### RP-09 · Incidentes y excepciones por responsabilidad · M por sublote

Separar **09a** listas/agregados/detalles y **09b** resolución/acciones operativas.

**Aceptación:**
- [ ] EMPLEADO puede reportar y consultar lo propio autorizado; no ve motivos de compañeros, faltantes de caja ni incidentes generales de otras sucursales.
- [ ] Resolver/cambiar estado/escalar/enviar recordatorio exige la capacidad adecuada sobre el registro; READONLY no tiene esos controles ni puede invocarlos directamente.
- [ ] Resúmenes y detalles respetan el mismo alcance, incluidas tablas de excepciones que agregan fuentes heterogéneas.

**Verificación:** tests de lista/detail/write para sucursal propia/ajena, misma sucursal con otro dueño y otra empresa; comprobar cero efectos externos en denegaciones. **Dep.:** RP-01..03. **Archivos:** páginas y fuentes de incidentes/excepciones que arroje RP-00.

#### RP-10 · Equipo: lectura y campos autorizados · M

**Aceptación:**
- [ ] Listado de usuarios respeta sucursal/empresa y campos visibles; GERENTE no obtiene cuentas de otras sucursales o datos de superiores mediante búsqueda, IDs, paginación o exports.
- [ ] Diferenciar lectura mínima de identidad para una asignación legítima de acceso al directorio administrativo; no romper selectores que necesiten nombre/ID autorizado.
- [ ] Totales y opciones de sucursal se calculan sobre la población permitida; no filtrar solo después de recibir el listado completo.

**Verificación:** tests `/api/users` y loader con fixtures existentes; contrastar Juan vs María en navegador. **Dep.:** RP-01/02. **Archivos:** `app/api/users/route.ts`, servicio/DTO de usuarios, `app/dashboard/team/page.tsx`, tests.

#### RP-11 · Equipo: autorización de mutaciones · M por sublote

Separar **11a** perfil/rol/branch y **11b** alta/invitación/activación/desactivación según endpoints reales. No probar estas operaciones contra las cuentas publicadas.

**Aceptación:**
- [ ] Guardar, promover, reasignar o desactivar valida actor, rol objetivo actual y nuevo, empresa, sucursal y campos; igual regla en PATCH/PUT/Server Actions/rutas de invitación.
- [ ] GERENTE no altera pares/superiores ni cambia roles por payload; ADMIN no altera OWNER/SUPER_ADMIN/pares. No se permite conceder capacidades que el actor no puede conceder.
- [ ] Cambios de rol/sucursal y revocación se reflejan en la siguiente decisión de acceso; sesión/caché obsoleta no conserva privilegios. No permitir eliminar la última cuenta administrativa necesaria.

**Verificación:** escrituras con DB de pruebas aislada o mocks con invariantes; concurrencia de downgrade/desactivación crítica según servicio. **Dep.:** RP-01/02/10. **Archivos:** handlers/acciones y servicios de gestión de usuarios, autorización de jerarquía y tests.

#### RP-12 · Editor de equipo fiel a los roles reales · M

**Aceptación:**
- [ ] Renderiza el rol actual del dominio, incluido OWNER, aunque el actor no pueda asignarlo; no hay valor vacío ni degradación al guardar otro campo.
- [ ] Opciones asignables y acciones por fila proceden de la política; no se ofrece edición/desactivación prohibida ni se depende de ocultarla como protección.
- [ ] Formulario y matriz de permisos en español; muestran capacidades reales, no solo columnas Admin/Gerente/Empleado.

**Verificación:** formularios con cada rol actual y cada actor permitido; preservar rol al editar nombre; comprobar denegación server. **Dep.:** RP-10/11. **Archivos:** `components/team/user-edit-sheet.tsx`, `components/team/role-permission-matrix.tsx`, `app/dashboard/team/page.tsx`, `messages/es.json`, pruebas.

**Checkpoint B:** no fuga entre empleados ni empresas; operaciones de gestión no escalan autoridad; las API de ejecución conservan guardas. Las escrituras negativas se prueban fuera de producción.

### Fase C — Experiencias de entrada y alcance visible

#### RP-13 · Entrada y composición por permisos · M

**Aceptación:**
- [ ] Login y acceso directo a `/dashboard` resuelven una composición autorizada en servidor; EMPLEADO llega a Mis tareas y READONLY a Consulta, no a una cabina global.
- [ ] ADMIN y dirección conservan gestión de empresa; GERENTE/SUPERVISOR muestran su sucursal/turno. No hay loops entre `getDefaultDashboard`, proxy y raíz.
- [ ] Abrir una ruta permitida guardada conserva ese destino; un `returnTo` solo se acepta si es local y autorizado. No implementar un redirect abierto.

**Verificación:** login ocho cuentas, reload, acceso directo, rol cambiado y destino denegado; tests de resolución pura y rutas. **Dep.:** RP-01..03/07/08. **Archivos:** `app/sign-in/page.tsx`, `app/dashboard/page.tsx`, resolver de entrada/rutas, tests. Reutilizar composición en lugar de copiar dashboards.

#### RP-14 · Vista de sucursal y de turno · M por sublote

**Aceptación:**
- [ ] Juan ve pendientes, inventario, incidentes y personal operativo de Condesa; Ana ve verificación/seguimiento autorizado de Polanco. Prioridades y CTAs corresponden al rol, no a la cabina de red reducida visualmente.
- [ ] No se consultan en loaders salarios individuales, tesorería o datos globales prohibidos; los resultados operativos agregados se autorizan por separado.
- [ ] Sin sucursal o sin turnos muestra un estado honesto con salida útil; render estable al navegar y refrescar.

**Verificación:** tests de loader/DTO y recorrido DevTools Juan/Ana con turnos, sin turnos y fixtures sin sucursal. **Dep.:** RP-02/06/08/09/13. **Archivos:** composiciones operativas, loaders y componentes existentes; hasta cinco por sublote.

#### RP-15 · Vista READONLY y reportes de consulta · M por sublote

**Aceptación:**
- [ ] Diana ve indicadores/reportes operativos de Condesa; no caja, nómina individual ni información de otra sucursal. Sin asignación no recibe el consolidado.
- [ ] No puede crear/programar reportes, resolver, recordar por WA ni modificar negocio; exports permitidos usan el mismo alcance y DTO que la vista.
- [ ] El módulo separa consultar/descargar de administrar reportes y protege endpoints/exportaciones prefirmadas o jobs relacionados.

**Verificación:** UI y pruebas negativas de handlers con cero trabajos/mensajes/filas en denegaciones; probar parámetros de export. **Dep.:** RP-01..03/09/13. **Archivos:** composición de consulta, páginas/reportes, handlers y servicios identificados; dividir lectura, exports y administración si excede cinco archivos.

#### RP-16 · Cumplimiento consistente con el alcance · M

**Aceptación:**
- [ ] Summary, trends, corporate-status y comparativas respetan el alcance efectivo; gerente/supervisor no reciben filas de toda la cadena.
- [ ] Ausencia de mediciones no se presenta como 0/0 o 0 %; tasas y denominadores coinciden con las bitácoras filtradas.
- [ ] Recordatorios y exports tienen capacidad propia y destino autorizado; READONLY no envía comunicaciones.

**Verificación:** mismo actor/fecha en API/UI; dos sucursales con datos diferentes y una sin mediciones; notificaciones simuladas. **Dep.:** RP-01/02/15 para READONLY. **Archivos:** página/loader de compliance, `app/api/compliance/corporate-status/route.ts`, fuente de tendencias, componente/test según inventario.

#### RP-17 · Cabina y selector con un alcance explícito · M

**Aceptación:**
- [ ] Dirección ve valores de la empresa o de la sucursal elegida según el contrato de cada sección; ni ventas ni costos ignoran silenciosamente la preferencia.
- [ ] Una sección necesariamente global lo anuncia y no presenta el selector como si la filtrara; proyecciones preliminares no parecen saldos confirmados.
- [ ] Header, consultas y fuente de datos coinciden después de cambiar sucursal, navegar, volver y refrescar; respuestas antiguas no pisan datos del nuevo alcance.

**Verificación:** Carlos/María en Todas → Condesa → Polanco; comparar URL/cookie efectiva, loaders, API y UI sin leer credenciales. **Dep.:** RP-02/04/05. **Archivos:** `app/dashboard/executive/page.tsx`, loaders y cabecera/composiciones ejecutivas, control de alcance y tests; dividir si excede cinco.

**Checkpoint C:** el primer destino es útil para cada rol y no recibe modelos prohibidos; ninguna tarjeta global queda escondida con CSS; alcance y denominadores coinciden.

### Fase D — Navegación y estados coherentes

#### RP-18 · Menús, enlaces y acciones desde la política · M por sublote

Separar **18a** sidebar/submenús y **18b** tarjetas, notificaciones, enlaces de actividad y acciones por fila. Migrar cada dominio auditado y enumerar consumidores pendientes; no declarar completo por revisar solo el menú principal.

**Aceptación:**
- [ ] Ana no recibe Constructor; Diana no recibe enlaces a AI, nómina o finanzas; EMPLEADO no recibe CTA de red ni detalles ajenos. Vaciar grupos sin hijos autorizados.
- [ ] La navegación usa la misma política de rutas/acciones; no hay listas de roles paralelas o bypasses client-only. Los destinos de notificaciones se vuelven a autorizar en servidor.
- [ ] Toda acción visible tiene una operación server permitida para ese actor/objetivo; la acción puede mostrarse deshabilitada solo cuando explique una condición de negocio subsanable.

**Verificación:** comparar enlaces/acciones con decisiones de ruta y recurso para todos los roles; usuario abre URL conocida de todos modos y recibe rechazo correcto. **Dep.:** política y dominio migrados. **Archivos:** sidebar/config real localizado con CodeGraph, `components/nav-main.tsx`, submenús y componentes por dominio.

#### RP-19 · Errores y denegaciones comprensibles · S/M

**Aceptación:**
- [ ] Un 403 muestra «No tienes permiso» y salida autorizada; no «Failed to fetch workflow» ni reintento inútil.
- [ ] 401 solicita sesión, 404 no revela registros ajenos, vacío no parece error y fallos recuperables sí admiten reintento. El documento 403 no se sustituye por redirect silencioso.
- [ ] Mensajes en `messages/es.json`, con foco/semántica accesible y sin detalles sensibles en HTML o consola.

**Verificación:** simular respuestas 401/403/404/500 en revisión de workflows y vistas migradas; teclado y DevTools. **Dep.:** RP-03/08/18. **Archivos:** manejo compartido de errores, página de review y mensajes/tests; migrar consumidores en pequeños lotes.

#### RP-20 · Conteos de empleados fiables · S

**Aceptación:**
- [ ] Definir si cuenta EMPLEADO activo, perfil activo o plantilla operativa; etiqueta y query describen la misma población.
- [ ] Conteos por sucursal coinciden con filas autorizadas; falta de datos no se convierte silenciosamente en cero.
- [ ] Carlos no ve tres ceros con empleados asignados; no filtra información a actores sin permiso de directorio.

**Verificación:** fixtures con activo/inactivo, sin perfil y otra empresa; contraste Organización vs fuente. **Dep.:** RP-02/10. **Archivos:** `app/dashboard/company/branches/page.tsx`, loader/query, tests.

#### RP-21 · Metadatos y elegibilidad en ejecución rápida · S/M

**Aceptación:**
- [ ] No hay «min», «pasos» o «ejecuciones» huérfanos; se representan números reales o se oculta la métrica ausente.
- [ ] El catálogo y sus CTAs no prometen ejecución de plantillas fuera de la capacidad/asignación del actor.
- [ ] Conservar contrato API y traducciones; no rellenar valores inventados para tapar un mapeo incorrecto.

**Verificación:** fixtures de plantilla con valores, cero real y valores ausentes; contraste API/UI sin iniciar workflows publicados. **Dep.:** RP-08. **Archivos:** `app/dashboard/execute/page.tsx`, tarjeta/mapper de plantilla y tests según ubicación real.

### Fase E — Prueba, preview y publicación

#### RP-22 · Matriz automatizada de autorización y vistas · M por sublote

**Aceptación:**
- [ ] Cobertura de siete roles de dominio (OWNER con fixture), ocho cuentas demo en navegador, dos empresas y compañeros de la misma sucursal. Probar permiso positivo y negativo, incluidas denegaciones antes de efectos.
- [ ] Cubrir URL directa, APIs/acciones, HTML/RSC, exports, cambios de rol/sucursal, sesión obsoleta y caché; jerarquía de usuarios se prueba con escrituras aisladas.
- [ ] E2E usa contextos/sesiones separados por identidad. No reutilizar `tests/.auth/admin.json` para hacer pasar una matriz que pretende probar otros roles.

**Verificación:** unitarias/handlers primero; integración en DB de pruebas identificada; Playwright con contextos por rol. Reutilizar fixtures existentes y añadir un empleado compañero donde falte. **Dep.:** fases A–D. **Archivos:** suites unitarias/fixtures y nuevo spec E2E focal; separar por dominio en el tracker.

#### RP-23 · Recorrido de aceptación en preview · M

**Aceptación:**
- [ ] Ocho logins independientes; registrar landing, menú completo, alcance, datos, acciones, acceso directo denegado y consola/red. Incluir el ciclo Juan/Ana que antes fallaba.
- [ ] Las rutas muestreadas no tienen React #185, errores 500 o respuestas 400 inesperadas; los 403 intencionales se identifican como resultado esperado.
- [ ] Evidencia por ROLE-01–ROLE-10 con estado, entorno, revisión SHA, comandos, resultado y límites. Ningún cierre depende solo de HTTP 200 o de capturas del 30 de octubre.

**Verificación:** Chrome DevTools en preview con build revisado; comparar UI/API con datos vigentes. **Dep.:** RP-22 y checks del lote. **Archivos:** `tasks/evidencia/vistas-roles-<fecha>/`; sin cambios de negocio en producción.

#### RP-24 · Publicación controlada y verificación posterior · S/M

**Aceptación:**
- [ ] Lote y revisión concretos, diff y preview revisados; excluir cambios ajenos y documentar cómo volver a la revisión previa si hay regresión.
- [ ] Obtener autorización explícita de producción **como último paso**, con el lote ya preparado y verificable. No se incluye autorización de resiembra ni operaciones fiscales.
- [ ] Tras publicar, confirmar versión y repetir casos críticos de ocho usuarios; tracker distingue código terminado, pruebas locales, preview y producción.

**Verificación:** smoke read-only de producción, fuentes ejecutivas denegadas, entrada por rol, errores de Juan/Ana y evidencia. **Dep.:** RP-23. **Archivos:** informe/release notes; sin migraciones implícitas.

## 6. Comandos y disciplina de verificación

Ejecutar desde `C:\Users\david\pulso29` en PowerShell. No instalar dependencias, correr seeds o conectar una suite de escritura antes de identificar su entorno.

```powershell
git status --short
git diff -- components/nav-company.tsx
pnpm.cmd run dev

# Pruebas existentes focales; argumentos directos, sin separador extra --
pnpm.cmd run test:unit lib/rbac/__tests__/abac.test.ts lib/rbac/__tests__/permissions.test.ts lib/rbac/__tests__/exceptions-permissions.test.ts lib/rbac/__tests__/masking.test.ts lib/rbac/__tests__/payroll-authorization.test.ts tests/unit/workflows/execution-access.test.ts tests/unit/labor/session-scope.test.ts

# Nuevos tests: pasar sus rutas reales cuando existan.
pnpm.cmd run test:unit
pnpm.cmd run lint
pnpm.cmd exec tsc --noEmit
git diff --check

# Antes de construir, comprobar si hay un dev server usando el mismo .next.
# No detener procesos ajenos; coordinar únicamente el servidor de esta tarea.
$rolesPreviousNodeOptions = $env:NODE_OPTIONS
try {
  $env:NODE_OPTIONS = '--max-old-space-size=4096'
  pnpm.cmd run build
} finally {
  $env:NODE_OPTIONS = $rolesPreviousNodeOptions
}

# Solo cuando exista el spec y la base/servidor de pruebas estén identificados:
pnpm.cmd run test:e2e tests/e2e/role-views.spec.ts --project=chromium
```

El nombre `tests/e2e/role-views.spec.ts` es una salida propuesta, no un archivo ya existente. El Playwright actual usa un storageState de admin y arranca Next/Inngest: el nuevo spec debe aislar identidades y no disparar procesos de negocio contra producción. Las pruebas de mutación se ejecutan en entorno de pruebas; el recorrido productivo es de lectura.

No repetir build/lint/tests ya aprobados sin cambios o nueva incertidumbre. La auditoría anterior tiene 57 tests históricos verdes; no sustituyen las regresiones nuevas. Un comando interrumpido o un test excluido no se marca aprobado. No relajar requisitos, borrar tests ni conceder permisos para conseguir una suite verde.

## 7. Criterios finales de aceptación

- [ ] Matriz propuesta reflejada en una política y adaptadores compatibles, sin fuentes de permiso contradictorias.
- [ ] Cada usuario aterriza en su vista útil; navegación, datos y acciones coinciden con la autorización efectiva.
- [ ] No hay información prohibida en respuestas, HTML/RSC, listas, KPIs, opciones, exports ni cachés compartidas.
- [ ] Permisos propios/sucursal/empresa, identidad del objetivo, jerarquía y revocación se prueban en servidor.
- [ ] Los diez hallazgos tienen evidencia de cierre; ROLE-03 comprueba render real y ROLE-04 comprueba servidor fuera de producción.
- [ ] OWNER y seguridad fiscal/tenant/RLS existentes no sufren regresiones. No se introduce HR ni un rol no reconocido por schema.
- [ ] Checks requeridos aprobados y recorrido de ocho usuarios en preview; producción queda separada hasta autorización y verificación.
- [ ] No se ejecutó timbrado, dispersión, comunicación externa, resiembra o escritura productiva para comprobar permisos.

## 8. Riesgos y decisiones que deben permanecer visibles

| Riesgo | Mitigación |
|---|---|
| Una matriz nueva contradice a ABAC o a permisos de campos | RP-00/01 trazan precedencia y adaptadores; denegación/clasificación no se amplían |
| Cerrar `/dashboard` por defecto rompe páginas comunes | Inventariar rutas y registrar permisos explícitos antes de quitar el fallback |
| Restricción de datos por sucursal deja ver compañeros | OWN en query/DTO y fixtures de misma sucursal con otro dueño |
| Un menú corregido oculta una API abierta | Pruebas de acceso directo a fuentes, mutaciones y exports |
| Cambiar el rol deja datos en una sesión/caché vieja | Invalidación y decisión server con datos vigentes; tests de downgrade y logout/login |
| Corregir permisos de nómina debilita reglas fiscales previas | Mantener suites y guardas específicas; no usar UI para conceder `reports:manage` |
| El `useMemo` ajeno se mezcla con cambios nuevos | Preservar diff, documentar autoría previa, probar sin sobrescribir trabajo |
| Fijar READONLY a sucursal modifica el comportamiento observado | Es una decisión propuesta explícita; cualquier alcance global exige concesión definida |
| OWNER desaparece al copiar el tipo de rutas | Un único tipo de dominio y pruebas del séptimo rol con fixtures |
| Una publicación arrastra cambios ajenos staged | Revisar lote exacto sin `git add -A`; aprobación final sobre revisión concreta |

Si se solicita más autoridad para SUPERVISOR, permisos globales para READONLY o administración entre pares, registrarlo como cambio de producto y añadir pruebas; no inferirlo de una pantalla que antes estaba abierta. La migración del schema solo se considera si las capacidades aceptadas no caben en el modelo actual; no es un requisito inicial de este plan.

## 9. Arranque en una nueva sesión

Copiar el texto siguiente:

```text
Implementa tasks/plan-vistas-roles-permisos.md y sigue
tasks/todo-vistas-roles-permisos.md en C:\Users\david\pulso29.

Lee primero AGENTS.md y la auditoría
tasks/evidencia/frontend-roles-2026-10-30/README.md.
Adopta la política propuesta del plan salvo que te indique un cambio.
Empieza por RP-00 y continúa en orden con las tareas pendientes;
no vuelvas a quedarte solo en recomendaciones o a generar otro plan.

Usa CodeGraph para estructura. Reutiliza PERMISSIONS/ABAC y los
adaptadores actuales; evita matrices de autorización independientes.
Preserva los cambios ajenos, incluido el useMemo previo en nav-company.
Implementa y verifica incrementos pequeños, actualizando tracker y evidencia.
No ejecutes seeds, operaciones fiscales ni comunicaciones/escrituras de
negocio en producción. Prepara un lote y preview verificables; solicita
autorización de producción solo al final. No confundas botones visibles
con mutaciones de servidor probadas ni HTTP 200 con render correcto.
```

Al terminar cada sesión, registrar en el tracker: último ID completado, revisión/archivos del incremento, comandos/resultados, trabajo parcial, siguiente tarea y bloqueos concretos. No marcar preview o producción por haber pasado tests locales.
