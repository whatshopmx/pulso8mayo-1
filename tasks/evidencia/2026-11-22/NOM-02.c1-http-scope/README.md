# NOM-02.c1.http — Alcance y transiciones HTTP de vacaciones

Base: `a6e103db2d7452dce9c228b1a22c35026b28da7a` más árbol local compartido. Código implementado y V1; no acepta NOM-02.c1 ni aislamiento runtime del dominio.

## Problema y comportamiento

Las rutas activas `/api/vacations` y `/api/vacations/approve` verificaban sesión, pero no empresa, propiedad, permiso de decisión ni sucursal. Un colaborador autenticado podía aprobar un ID ajeno; el listado sin filtros devolvía otras empresas; dos decisiones simultáneas publicaban éxito y notificaban dos veces.

- `vacation-access.ts` reutiliza `resolveResourceScope`, `hasPermission` y el catálogo real de sucursales. La empresa sale de sesión; colaboradores quedan en `OWN`, gerentes/supervisores/lectores en su sucursal y corporativos en su empresa. Sin empresa o sucursal requerida, falla cerrado.
- Aprobación/rechazo requieren `users.update`; crear/cancelar requieren `profile.update` y, para otro empleado, `users.update`. No se agregan capacidades ni roles.
- Lecturas y modificaciones filtran empresa, sucursal y dueño, tanto al cargar como al escribir. Se excluyen referencias legacy a usuarios o sucursales de otra empresa. La creación valida también la sucursal real del perfil y deriva de él la sucursal persistida.
- Inputs malformados, fechas civiles inválidas, estados desconocidos y filtros de fecha incompletos devuelven 400. Se conserva el cuerpo de error con texto compatible con la pantalla.
- La escritura compara el estado observado: una decisión solo cambia `PENDING`, una cancelación solo el estado que cargó; el perdedor devuelve 409. Solo la decisión que actualizó notifica. Rechazar registra actor/fecha de rechazo sin afirmar aprobación.
- Los responsables notificados por una solicitud nueva pertenecen a la empresa y, para gerentes, a la sucursal del empleado. Las notificaciones de decisión siguen usando el dispatcher existente.
- La intersección de fechas también encuentra solicitudes que contienen todo el rango consultado o solicitado.

## Evidencia de pruebas

1. El primer arnés falló al cargar schema con `require` de TypeScript; se corrigió el arnés para usar importación de Vitest. No se cuenta como reproducción funcional.
2. RED funcional contra las rutas originales: **10/10 fallaron** con SQL real en PGlite y sesión simulada. El log está en `.tmp/vacation-scope-red.log`.
3. Extensión: dos casos adicionales reprodujeron referencias cruzadas heredadas; una tercera falla se debía a columnas ausentes de `notifications` en el fixture y se corrigió únicamente el fixture. Log `.tmp/vacation-scope-extended-red.log`.
4. GREEN final: `pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads tests/unit/payroll/vacation-routes-scope-db.test.ts tests/unit/payroll/vacation-period-balance-db.test.ts lib/services/__tests__/payroll-nom02c1-vacations.test.ts lib/services/__tests__/payroll-nom02c1-balance-status.test.ts`: **56/56, cuatro archivos, exit 0**, 43.60 s. Incluye 23 pruebas de rutas y regresión de saldos/vacaciones.
5. ESLint focal: **exit 0**, cero errores; cuatro advertencias de símbolos previamente no usados en las rutas. El archivo de pruebas final pasó una ejecución adicional sin avisos.
6. Tipos globales: `node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit --incremental false`: **exit 0**, sin diagnósticos; log `.tmp/vacation-scope-types.log`.
7. Build con acceso de red autorizado y `NODE_OPTIONS=--max-old-space-size=4096`: `pnpm.cmd run build`, **exit 0**, compilación en 4.1 min, TypeScript y **455/455** páginas; `BUILD_ID: 9jkaWSbepgST02Gi__BPj`, log `.tmp/vacation-scope-build.log`. La variable se restauró al terminar; no se cambió configuración del proyecto.
8. Trazabilidad: se registró el incremento separado `NOM-02.c1.http` en el mapa, checklist y tareas de las filas 09.11/10.05, con dependencias explícitas de sus aceptaciones de módulo. El primer intento del validador falló por `uv_os_get_passwd ENOMEM` durante la compilación del build. Reintento después de terminar el build: `pnpm.cmd exec tsx scripts/validate-faltantes.ts`, **exit 0**, **239 filas, 86 tareas base, 115 entradas adicionales, 75 aceptados, cero errores**; ambos estados `Parcial` conservados. `tests/unit/faltantes-traceability.test.ts`: **11/11, exit 0**. `git diff --check`: exit 0.

## Límites y aceptación pendiente

Las rutas y SQL son los reales; Better Auth y el envío del dispatcher se simulan. PGlite usa una conexión, sin RLS. Las llamadas concurrentes prueban el `UPDATE` condicionado, no acreditan carreras entre conexiones PostgreSQL independientes.

Faltan V2 con runtime NOBYPASSRLS y conexiones independientes, V3 con sesión/navegador integrados y los controles/saldos históricos restantes de NOM-02.c1. No se ejecutaron migraciones ni DML externo. No se tocó la UI laboral preexistente, el cálculo fiscal ni el estado de las filas 09.11/10.05. La entrega de notificaciones sigue siendo best effort, sin outbox durable ni garantía ante caída posterior al commit.
