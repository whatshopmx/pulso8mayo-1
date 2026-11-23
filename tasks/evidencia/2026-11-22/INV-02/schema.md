# INV-02.schema — persistencia local, sin aplicación a entorno externo

Base `d05eae09d67ed0b190b6785da168a8fb8b564fd0` más diff compartido. Estado: código implementado, SQL efímero comprobado; **V2 PostgreSQL independiente y aceptación pendientes**.

Incremento de cinco archivos: schema raíz, migración 0159, journal, snapshot 0159 y `recipe-consumption-policy-db.test.ts`. Generación mediante `pnpm.cmd db:generate --name inv02_consumption_policy`, exit 0. Se revisó el SQL: una tabla nueva y tres claves candidatas para FK compuestas; no hay DROP, backfill ni escritura de stock.

La tabla registra versión/receta/empresa, modo excluyente, inicio de vigencia, artículo/unidad para elaborado y procedencia de publicación (actor/motivo/hora). La versión puede publicarse una sola vez y no puede haber dos políticas con el mismo inicio para la misma receta. Las claves compuestas impiden asociar versión, receta o artículo de otra empresa. Las claves candidatas añadidas a catálogos contienen su PK existente; no imponen una nueva unicidad de nombres o SKU.

El generador ordenó inicialmente las FK antes de crear sus claves candidatas. Se ordenaron estas sentencias dentro de la migración NUEVA, aún no aplicada, y se añadieron FORCE RLS, trigger de inmutabilidad y grants mínimos. El snapshot generado conserva la estructura de Drizzle; FORCE/triggers/grants se mantienen explícitos en SQL, como en migraciones anteriores. No se editaron migraciones previas.

Política de lectura/inserción por empresa, compartida entre sucursales propias por tratarse de un catálogo de receta. Sin contexto o desde otra empresa no hay lectura ni escritura. `pulso_app` sólo obtiene SELECT/INSERT; se revocan UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER y permisos PUBLIC. Un trigger rechaza UPDATE/DELETE también desde un propietario ordinario NOBYPASSRLS. No se pretende impedir DDL de un administrador del servidor.

Verificación:

- RED: falta el SQL todavía no generado, exit 1. Primer recorrido SQL: 13 pasan y una aserción de fecha falla porque PGlite entrega `date` como Date; se verifica el día civil con `effective_from::text`.
- GREEN: **14/14 SQL** y **20/20 contrato**. Regresión conjunta con producción/scope/prep list: **101/101 en 5 archivos**, exit 0, 26.25 s.
- SQL ejecutado íntegro desde `0159_inv02_consumption_policy.sql` en PGlite efímero. Prueba restricciones reales, rol runtime NOSUPERUSER/NOBYPASSRLS, FORCE RLS, ausencia de contexto, dos empresas, contexto de dos sucursales propias, rechazo de referencias ajenas/modos incompletos, unicidad, inmutabilidad y rollback. PGlite no sustituye servidor PostgreSQL independiente, carreras ni LOGIN separado.
- `pnpm.cmd exec drizzle-kit check`: exit 0, snapshots coherentes.
- `pnpm.cmd exec eslint lib/db/schema.ts tests/unit/inventory/recipe-consumption-policy-db.test.ts`: exit 0, tres warnings previos de imports en schema raíz.
- Tipos focales del contrato y ambas pruebas: `pnpm.cmd exec tsc --noEmit --target ES2017 --lib dom,dom.iterable,esnext --module esnext --moduleResolution bundler --esModuleInterop --skipLibCheck lib/services/recipe-consumption-policy.ts lib/services/__tests__/recipe-consumption-policy.test.ts tests/unit/inventory/recipe-consumption-policy-db.test.ts` → exit 0. Se usaron target/lib/resolution del proyecto; una invocación inicial con lib ES2020 no reconoció `replaceAll` del harness, sin modificar código para ocultarlo.
- Fixture reforzada: dos sucursales propias reales en el arnés y versión de otra receta de la misma empresa; **14/14 SQL** de nuevo, exit 0, 9.62 s. Se comprueban por separado la fecha duplicada (con versión distinta) y la versión duplicada (con otra fecha).
- Lint final de contrato/ambas pruebas: exit 0 sin warnings. `git diff --check`: exit 0 (avisos CRLF).
- Trazabilidad tras subdividir INV-02: exit 0; 239 filas, 86 bases, 113 hijos, 25 aceptaciones, cero errores.
- Tipos globales con heap 4 GB pasaron ANTES de añadir este schema. Build Webpack en curso al terminar este incremento; no atribuir automáticamente la compilación anterior a todos los cambios nuevos. Registrar gates posteriores en el README.

Estado de la ejecución global: build con heap 4 GB/TLS del sistema, sesión `87389`, **compilación Webpack correcta en 9.9 min**, TypeScript aún activo en la última consulta. No reiniciar por falta de salida; volver a consultar esa sesión hasta resultado terminal. La compilación comenzó antes de este incremento; para cualquier aceptación del árbol final comprobar alcance de artefactos/tipos y repetir el gate que falte.

Pendientes: escritor de publicación y control de retroactividad/concurrencia, lector de versiones con privilegios propios, snapshot/demanda, aplicación canónica y activación de elaborado coordinada con PROD-01. La migración por sí sola no publica políticas ni cambia ventas históricas. No se aplicó 0159 a Neon/main/operativo. Para retirar la funcionalidad, mantener publicación/lectura desactivadas y conservar hechos; no hacer rollback destructivo de tablas o históricos.
