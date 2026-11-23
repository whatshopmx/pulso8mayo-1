# Historia de vacaciones — schema y protocolo de publicación

Base: `aef282b` más árbol compartido. Código/decisión: `8fc8236635e612c18125894f2b7c7db9b3506cdc` (`e675c54` schema/migración/V1, `6b961be` nativa, `8fc8236` decisión). Checkpoint de dos componentes: **`history.contract` aceptado V1 y `history.schema` aceptado V1/V2 en aislado**. No acepta `NOM-02.c1.history`, escritores, lector de nómina ni adopción operativa.

## Preparación implementada

La candidata generada `0164_nom02c1_vacation_history.sql` crea dos tablas, metadatos y constraints. Añade SQL de funciones/triggers y privilegios como parte del mismo archivo versionado:

- `vacation_history_streams`: apertura con cobertura, fuente, motivo, actor, idempotencia y sucesor de corrección dentro de empresa/empleado. Solo hay una raíz y un sucesor por cabeza. Una apertura no se reescribe.
- `vacation_history_events`: cinco formas cerradas (cobertura, crédito, revocación, aprobación, cancelación), con FKs compuestas al stream/reversa y FKs distintas a vacaciones/permisos. Una reversa conserva el hecho original y ocurre una sola vez; las fechas/días se contrastan con la solicitud autorizada. Un permiso ajeno a VACATION no admite esos eventos.
- RLS con FORCE en las tablas nuevas. El LOGIN dedicado tiene SELECT/INSERT y predicado privado; sin lectura del catálogo personal ni acceso a la secuencia. Actor/empresa vienen del contexto, se valida la sucursal real de los roles de equipo y se comprueba autoridad después de tomar los bloqueos. No se concede un bypass sin actor a `pulso_app`.
- Inserciones imponen fecha y versión de registro en base. El bloqueo por empresa/empleado precede a asignar la versión, y la historia sustituida rechaza nuevos eventos. UPDATE/DELETE/TRUNCATE de hechos están bloqueados por triggers además de RLS/privilegios.

La [decisión de persistencia](../../../../docs/audits/2026-11-23-decision-vacation-history-persistence.md) y el [plan actualizado](../../../../plans/2026-11-23-vacation-history.md) explican el manifiesto `knownAt` + `throughVersion`, la representación decimal de bigint, la selección del stream y la ausencia de backfill automático. El lector futuro debe capturar ese manifiesto bajo el mismo bloqueo; un timestamp solo no garantiza orden de publicación. Esto aún no es un snapshot aprobado de nómina.

## Verificación ejecutada

| Gate | Resultado |
|---|---|
| `pnpm.cmd db:generate --name nom02c1_vacation_history` | exit 0; dos tablas nuevas, SQL/snapshot/journal 0164. La primera candidata local sin aplicar se respaldó y regeneró antes de probarla para retirar lectura legacy sin actor |
| `pnpm.cmd exec drizzle-kit check` | exit 0, cadena válida |
| RED SQL contra DDL/políticas sin guardas de inserción/inmutabilidad | **4 fallidas y 2 aprobadas**; `.tmp/vacation-history-schema-red2.log`. El primer intento falló por un parámetro UUID/texto del arnés y no se cuenta como reproducción funcional |
| Primeras V1 SQL + contrato/RLS previo | **47/47**, tres archivos, exit 0, 12.20 s |
| Regresión amplia, diez archivos | **142/142, exit 0**, 89.52 s; `.tmp/vacation-history-schema-final-unit.log` |
| SQL final: `pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads tests/unit/payroll/vacation-history-schema-db.test.ts` | **12/12, exit 0**, 14.33 s; `.tmp/vacation-history-schema-verified-unit.log`; añade el caso de sucursal legacy ajena. No se suman otra vez los once casos ya incluidos en la regresión amplia |
| `node --use-system-ca node_modules/vitest/vitest.mjs run --configLoader bundle --config vitest.integration.config.ts --maxWorkers=1 --pool=threads tests/integration/vacation-history-db.test.ts` | **2/2, exit 0**, última ejecución 37.25 s, `.tmp/vacation-history-native-complete.log`. Las ejecuciones anteriores se conservan y no se cuentan como casos adicionales |
| ESLint de schema y ambos tests | exit 0, sin errores; tres avisos previos de imports del schema. Test nativo final pasó lint sin avisos |
| `pnpm.cmd run build`, heap 4 GB y certificados del sistema | **exit 0**, compilación 4.4 min, TypeScript y **455/455** páginas; `BUILD_ID: O-ZCYUy2kFzMZVj3M11N1`; `.tmp/vacation-history-schema-build.log` |
| Trazabilidad y diff | `pnpm.cmd exec tsx scripts/validate-faltantes.ts`: exit 0 fuera del sandbox, **239 filas, 86 base, 127 adicionales, 82 aceptados, cero errores**. `tests/unit/faltantes-traceability.test.ts`: **11/11**, exit 0; diff sin errores |

La regresión amplia ejecutó `vacation-history-schema-db`, `vacation-history`, `pool-logging`, `vacation-runtime-rls-db`, `vacation-routes-scope-db`, `vacation-period-balance-db`, `payroll-nom02c1-vacations`, `payroll-nom02c1-balance-status`, `permissions` y `vacation-civil-days`, con `--configLoader bundle --maxWorkers=1 --pool=threads`.

## Qué acredita cada capa

PGlite ejecuta la candidata real: empresa/sucursal/propiedad/actor ausente, capacidad de crédito, catálogo/secuencia denegados, metadata impuesta, sucesores, referencias cruzadas, actor falsificado, aprobación/cancelación/reversa, cobertura que no se reduce, crédito anterior a apertura, tipos VACATION y rechazo de UPDATE/DELETE/TRUNCATE. Se corrigió un error inicial del trigger que resolvía `NEW.kind` al usarse en la tabla de streams; las pruebas completas pasaron después.

La V2 usa PostgreSQL, LOGIN independiente (`current_user = session_user`, sin BYPASSRLS), una base fresca baseline 0158 más 0163/0164 y SQL real. Comprueba lecturas, metadata y denegaciones; también ejecuta el enlace a aprobación/cancelación sobre las tablas completas y rechaza una solicitud de la otra empresa. Las actualizaciones de la solicitud y los inserts de historia se realizan por separado en este arnés: no se afirma atomicidad del escritor HTTP pendiente.

La carrera de apertura usa dos PIDs distintos y una barrera: una apertura gana y otra falla. El segundo protocolo mantiene el bloqueo de un lector sobre una apertura aún sin eventos y observa en `pg_locks` al escritor esperando un advisory lock no concedido. Al liberar el lector, el crédito recibe versión posterior; consultar con la versión capturada sigue excluyéndolo. Las barreras tienen timeout y limpieza. Este protocolo prueba la preparación SQL; el servicio público de lectura y su manifiesto aún deben implementarse.

## Checkpoint, entorno y límites

El contrato puro anterior conserva sus **22** casos y no se modifica. La revisión conjunta acredita el componente de replay V1 y la persistencia V1/V2; las dependencias de ambos están aceptadas. Son dos componentes técnicos adicionales, no dos funciones completas del producto. Continúan abiertos los cinco hijos de escritores/puente/lector/aceptación, el padre de historia y NOM-02.c1. Las filas 09.11 y 10.05 siguen parciales.

La última limpieza verificó ausencia de la base `inv_sales_next_d984c1e9ceac4834938b9f9f585d0433` y rol `inv_sales_role_f7941610b3434409880ee916a0b73d05`; manifiesto con `databaseCreated: false`, `roleCreated: false`, `closed: true`. No se modificó `.env`, no se migró el entorno operativo, no se generaron aperturas desde balances actuales y no se enviaron notificaciones. El cálculo de nómina conserva por ahora su lector anterior; retirarlo sin reemplazo no se declara trabajo completado.
