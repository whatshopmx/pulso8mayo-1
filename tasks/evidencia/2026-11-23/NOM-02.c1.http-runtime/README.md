# Vacaciones — RLS, conexión dedicada y logs seguros

Base: `b236e1f257965d2ffd5b7856934e01514f2d5b9f` más árbol local compartido. Implementación y V1/V2 en bases desechables; sin despliegue operativo ni aceptación V3 del recorrido de vacaciones.

## Incrementos revisables

1. **Cadena previa:** `0162_snapshot.json` ya existía sin seguimiento en Git. Su `prevId` enlaza con `0161` y `0163` enlaza con él. `generateMigration(0161,0162)` de Drizzle devuelve **cero sentencias**. Se conserva como prerrequisito reproducible, sin atribuir implementación nueva a PROD-01.b.
2. **`NOM-02.c1.http.rls`:** schema, migración generada `0163`, snapshot/journal y pruebas SQL. Políticas por actor/empresa/sucursal, lectura legacy de nómina por propósito, función booleana privada para referencias y trigger de transición/procedencia. Permisos limitados a solicitudes; sin catálogos personales para el nuevo rol.
3. **`NOM-02.c1.http.runtime`:** selector `VACATIONS_RUNTIME_DATABASE_URL`, contexto transaccional y rutas conectadas. Lecturas/escrituras de solicitudes van por el selector; metadatos y notificaciones conservan sus conexiones. Admisión rechaza URI dueña, rol legacy, elevación, membresías, propiedad, RLS/trigger ausentes y concesiones indebidas.
4. **`SEC-00.db-pool-logs`:** un evento real de limpieza mostró que el logger anterior volcaba el cliente del driver. Se redactaron los dos logs de prueba afectados y se reemplazó el volcado por evento y código SQLSTATE/red allowlisted. No se registra el objeto, mensaje ni URI. Dos pruebas RED reprodujeron la exposición con valores sintéticos antes de la corrección.

La [decisión técnica](../../../../docs/audits/2026-11-23-decision-runtime-vacaciones.md) explica la separación de conexiones, las alternativas y la adopción gradual.

## Comandos y resultados

| Gate | Resultado |
|---|---|
| `pnpm.cmd db:generate --name nom02c1_vacation_runtime` | exit 0; candidata aditiva `0163`, sin `db:push` |
| `pnpm.cmd exec drizzle-kit check` | exit 0, cadena válida |
| Unitarias finales de seis archivos | **77/77, exit 0**, 41.62 s: 14 SQL/RLS, 28 de rutas/configuración, 2 de logs y 33 de saldo/vacaciones |
| `node --use-system-ca node_modules/vitest/vitest.mjs run --configLoader bundle --config vitest.integration.config.ts --maxWorkers=1 --pool=threads tests/integration/vacation-runtime-db.test.ts` | **2/2, exit 0**, 62.60 s en la última ejecución con compatibilidad de nómina y barrera; `.tmp/vacation-runtime-native-compat.log` |
| Misma capa con `tests/integration/vacation-runtime-db.test.ts tests/integration/production-finished-consumption-db.test.ts` | **3/3, dos archivos, exit 0**, 120.77 s; regresión del modo de concesiones anterior del arnés, sin sumar otra vez los casos de vacaciones |
| `node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit --incremental false` | exit 0, sin diagnósticos; `.tmp/vacation-runtime-types.log` |
| ESLint focal de 11 archivos | exit 0, cero errores y siete avisos de símbolos previamente no usados; archivo nativo final pasó lint adicional sin avisos |
| `pnpm.cmd run build` con `NODE_OPTIONS=--max-old-space-size=4096` | **exit 0**, compilación 2.0 min, TypeScript y **455/455** páginas; `BUILD_ID: yEyeFz40xrtGLO4-aeMf8`; `.tmp/vacation-runtime-build.log` |
| `pnpm.cmd exec tsx scripts/validate-faltantes.ts` | exit 0 fuera del sandbox: **239 filas, 86 base, 118 adicionales, 78 aceptados, cero errores**. Dentro del sandbox falló `uv_os_get_passwd ENOMEM`; no se atribuye este fallo a datos documentales |
| `tests/unit/faltantes-traceability.test.ts` y `git diff --check` | **11/11, exit 0**; diff sin errores |

Comando de unitarias: `pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads tests/unit/db/pool-logging.test.ts tests/unit/payroll/vacation-runtime-rls-db.test.ts tests/unit/payroll/vacation-routes-scope-db.test.ts tests/unit/payroll/vacation-period-balance-db.test.ts lib/services/__tests__/payroll-nom02c1-vacations.test.ts lib/services/__tests__/payroll-nom02c1-balance-status.test.ts`.

## Qué acreditan las pruebas

- SQL/PGlite: ausencia de actor, empresa/sucursal, datos ajenos, cero concesiones de catálogo, restricciones de columnas/transiciones, cancelación sin falsificar aprobación, lector de nómina y matriz de roles. Las rutas conservan regresión de alcance y rechazan configuraciones inválidas con 503 sin escribir ni usar fallback.
- PostgreSQL nativo: LOGIN nuevo no dueño, `current_user = session_user`, sin bypass; lector corporativo, sucursal y propio; contexto local sin actor; denegación del catálogo y de aprobación por colaborador; URI dueña, RLS deshabilitado o concesión adicional de fecha rechazados antes del callback.
- Compatibilidad: `SET LOCAL ROLE pulso_app` dentro de la base desechable conserva lectura por empresa sin actor. No se cambian contraseñas ni membresías de roles compartidos.
- Handlers: creación, listado, denegación a sujeto ajeno, cancelación y repetición. La aprobación concurrente mantiene abiertas dos transacciones con **PIDs distintos**, ambas leyendo `PENDING` antes de liberar la barrera; resultado **200/409**, una notificación y actor persistido correcto. El arnés solo intercepta la planificación posterior a la lectura, sin simular consultas o escrituras.
- Regresión: el modo por defecto del arnés conserva los permisos de ventas; el flujo nativo de producción/elaborado sigue aprobado.

El primer ensayo nativo devolvió 503 porque el arnés concedía también columnas de sucursal destinadas a ventas. Se corrigió el arnés con `grants: 'none'`; la guarda no se relajó. La base y el rol de cada intento se retiraron antes de repetir. El pool host del worker ahora se cierra antes del DROP de su propia base.

## Entorno y límites

Se aceptan **solo** los componentes `NOM-02.c1.http.rls` y `NOM-02.c1.http.runtime` en V1/V2 aisladas y `SEC-00.db-pool-logs` en V1. `NOM-02.c1.http` conserva estado V2 y su casilla pendiente por V3. Las nuevas dependencias quedan materializadas en mapa/matriz; estos registros incluyen preparación técnica y no representan un porcentaje funcional del sistema.

`createSalesRuntimeDatabase({ baseline: '0158', grants: 'none' })` verifica que el endpoint de prueba difiera del operativo, crea con `template0` y aplica la candidata únicamente en la base generada. La última limpieza dejó `databaseCreated: false`, `roleCreated: false`, `closed: true` en `.tmp/sales-runtime-database-fixture.json`. No se guardan URIs ni contraseñas en ese manifiesto.

La variable runtime se restauró por proceso y no se modificó `.env`. La candidata no usa FORCE: el propietario y callers legacy siguen fuera de la aceptación runtime. El selector rechaza esos privilegios al activar la conexión dedicada. La política de lectura `pulso_app` corresponde a nómina y no debe usarse como identidad HTTP.

Auth y el envío del dispatcher se simulan en V2. Faltan Next/Better Auth/navegador reales para `NOM-02.c1.http`, aplicación por lote en OPS-03, adopción global de nómina y sus jobs, saldo histórico por período, NOM-06 y snapshots/timbrado. Las filas 09.11 y 10.05 permanecen parciales. La aceptación de componentes aislados no acredita despliegue ni cierre de módulos.
