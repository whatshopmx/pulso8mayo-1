# FIS-02 — Semilla, vigencias y lectura fiscal exigible

Base de trabajo: `bf2c386`. Ejecución local del 22-oct-2026 (los logs de madrugada se registran en UTC del 23-oct). Alcance: hijos FIS-02A/B/C; no equivale a despliegue ni cierre de Fase 1.

## Cambio y contrato

- Catálogo de 11 intervalos con mínimo GENERAL 2025/2026, UMA por vigencia real y fuentes publicadas. Enero 2026 conserva 113.14; febrero usa 117.31; mínimo 2026 315.04. Enero 2027 conserva la UMA conocida, pero no inventa mínimo 2027; desde febrero ambos desconocidos permanecen null.
- Seed en una sola transacción, upsert por `effectiveFrom` (índice único existente), cerrojo transaccional y validación final de continuidad. Acota el intervalo legacy, mantiene IDs y rechaza filas ajenas superpuestas con rollback completo. No usa DELETE, DROP ni db:push. El esquema actual es suficiente; no hay nueva migración ni cambios al journal/0121.
- El selector conserva la fila completa y rechaza ambigüedad. La lectura general conserva su fallback informativo y caché de 300 segundos, con clave de versión nueva al desplegar. La lectura **fiscal** evita esa caché, exige los datos declarados por el consumidor y fuente publicada; un vacío/nulo/cero/negativo/NaN produce 409 visible. Una fuente inaccesible produce 503 sin copiar detalles de conexión.
- Preview y run de aguinaldo exigen UMA verificada antes de cargar cálculos o crear una corrida. No se interpreta null como exención cero. El mínimo de la tabla es GENERAL; la resolución por zona del finiquito pertenece a FIS-03.

Fuentes y oráculos independientes: [FIS-01](../FIS-01/README.md), [CONASAMI 2026](https://sidof.segob.gob.mx/notas/docFuente/5775534), [INEGI 2026](https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2026/uma/uma2026.pdf), [INEGI 2025](https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2025/uma/uma2025.pdf) y [decreto de jornada](https://sidof.segob.gob.mx/notas/docFuente/5786537). Topes operativos heredados ajenos a esta corrección monetaria quedan identificados para revisión en LEG-03; no se presentan aquí como nueva evidencia legal.

## Entorno V2 y protección del dato

`db-probe.json` acredita endpoint aislado distinto de `.env`/`.env.local`, tabla con las columnas necesarias y rol operador `neondb_owner` (no superuser, con bypass RLS). Es una prueba de seed global de operador; **no** acredita runtime `pulso_app` ni rollout RLS de OPS-02.

Las pruebas crean tablas `pg_temp` mediante `LIKE public... INCLUDING ALL`, comprueban su namespace y las eliminan automáticamente al terminar la transacción. El catálogo público no se modifica. Se comparó el digest de recibos públicos y además un recibo TIMBRADO explícito temporal con DDL real, para no depender de que el entorno ya contenga historia. El lock se probó con una segunda conexión real. No hay timbres reales ni notificaciones.

La primera lectura TLS falló por la cadena local de certificados. Se repitió con `--use-system-ca`, manteniendo activa la validación TLS; no se usó `rejectUnauthorized: false`. Tests/types aplican esa opción solo al proceso hijo. El primer build rechazó esa opción en su worker; se repite sin ella, usando el soporte TLS nativo ya configurado en Next. Types/build usan heap 6144 MB sin editar `.env` ni configuración del producto.

## Resultados

| Control | Comando | Resultado |
|---|---|---|
| Catálogo | `pnpm run test:unit lib/__tests__/labor-law-seed-data.test.ts` | 11/11, exit 0; `data.log` |
| Regresión inicial | Focalizadas antes del resolver estricto | 10 fallos y 57 passed, exit 1; `focused-red.log`; incluye el run que aceptaba UMA ausente |
| Focalizadas finales | `pnpm run test:unit lib/__tests__/labor-law-seed-data.test.ts lib/__tests__/labor-rules-resolver.test.ts lib/__tests__/labor-fiscal-resolution.test.ts lib/__tests__/aguinaldo-payroll-service.test.ts lib/__tests__/fiscal-fixtures.test.ts --maxWorkers=2` | 5 archivos, 67/67, exit 0; `focused.log` |
| Postgres real | `pnpm run test:integration tests/integration/labor-law-seed-db.test.ts` | 5/5, exit 0; `integration.log`; seed 2 veces, rollback, historial, lock y lectura fresca |
| Seed maestro | `pnpm run test:unit tests/unit/seed-integration.test.ts` | 1/1, dos recorridos completos, exit 0; `seed.log` (PGlite; no sustituye V2) |
| Suite unitaria | `pnpm run test:unit --maxWorkers=2` | 159 archivos, 1899 passed, 1 skipped, 1 todo; exit 0; `unit.log` |
| TypeScript | `pnpm exec tsc --noEmit --incremental false` | Exit 0; `types.log` |
| Lint afectado | Ver lista de archivos en `lint.json` | Exit 0, 0 errores, 1 warning preexistente `no-explicit-any` en mergeCompanyLaborOverride; `lint.log` |
| Build | `pnpm run build` | Exit 0; `build.json` registra fin 2026-10-23T03:45:48.265Z; `build.log` termina en EXIT=0. Confirmado al retomar el 23-oct |

Los JSON guardan comando/inicio/fin/exit. Se conservan intentos previos: catálogo aún no implementado (`data-red`), regresiones del resolver/run (`focused-red`), primera prueba DB del seed (`integration-A`), lectura fiscal antes del recibo temporal explícito (`integration-before-issued-fixture`), lint antes de corregir una variable de prueba no usada (`lint-before-review`) y build con opción Node incompatible (`build-system-ca-failed`). V3/API en servidor no se acredita con estos tests: el test de respuesta usa el manejador real de errores en proceso y los de run usan proveedor/DB simulados.

## Revisión y despliegue pendiente

Revisión de corrección, claridad, arquitectura, seguridad y costo: se reutilizan esquema y transacciones del proyecto; el seed solo escribe ley global; la lectura fiscal ejecuta una consulta pequeña por resolución y el run la comparte a través de su preview. Sin nuevas dependencias ni refactor de los cambios IMSS. El caso de recibo histórico temporal se agregó durante revisión para evitar una aceptación vacía.

No se ejecutó el seed sobre el catálogo público ni sobre la base operativa. Antes de liberar: identificar entorno/rol, respaldar filas de ley y revisar el manifiesto OPS-01; ejecutar únicamente el seed correctivo revisado en la ventana de OPS-03, revisar sus 11 intervalos y después habilitar el código con la nueva clave de caché. Si hay un intervalo ajeno superpuesto, el seed aborta: resolver esa discrepancia sin borrar filas a ciegas. La validación de presencia no certifica importes legacy positivos desfasados; la corrección de datos forma parte obligatoria del despliegue. No atribuir despliegue a estos resultados locales.

Pendientes independientes: FIS-03 (mínimo por fecha/zona del finiquito), AGU-02 (retención sobre gravado y tarifa sin extrapolación), AGU-03/04 y DIA-01/02. No se modificaron importes de recibos existentes ni se acredita recuperación del timbrador con FIS-02.
