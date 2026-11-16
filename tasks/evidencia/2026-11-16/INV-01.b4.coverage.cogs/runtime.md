# COGS — lector runtime y consulta integrada

Continuación del 2026-11-16 sobre HEAD `0442fd8b5052f8d47cd922065552c265173678f2` más cambios locales. **Código corregido y V2 transaccional comprobada; sin aceptación integrada**. Se conserva la evidencia V1 anterior, sin atribuirle pruebas de sesión real.

## Alcance fijado

Dos incrementos acotados: lector/consulta/prueba (`sale-revenue-coverage.ts`, `inventory-reports-service.ts`, `cogs-revenue-coverage-db.test.ts`) y privilegios (`0154_inv01b_cogs_reader.sql`, snapshot y journal). La migración custom fue generada por `pnpm.cmd db:generate --custom --name inv01b_cogs_reader`; el snapshot conserva todo el esquema anterior, con nueva identidad y cadena válida. No modifica tablas ni políticas. Añade únicamente SELECT de `average_cost`, `last_cost` y `standard_cost` al runtime existente.

## Fallos reproducidos y corrección

La primera ejecución de las dos pruebas nuevas terminó **2/2 fallidas**: la consulta real del servicio falló al seleccionar cobertura y la lectura directa de costos carecía de permisos. El SELECT de una sola tabla de Drizzle quitaba calificadores de objetos Column también dentro de la subconsulta correlacionada. PGlite con `PgDialect.sqlToQuery` no reproducía esa transformación del SELECT del servicio. Ahora las seis referencias externas son SQL estático explícitamente calificado con `sales_entries`; no contienen entradas del usuario. Se reduce además la selección de líneas a receta, ingrediente, cantidad y bandera de subreceta: el SELECT general pedía columnas ajenas al catálogo concedido.

## V2 comprobada

`NODE_OPTIONS='--use-system-ca --max-old-space-size=4096' pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/cogs-revenue-coverage-db.test.ts --maxWorkers=1 --pool=threads`: **3/3, exit 0**, 23.12 s.

PostgreSQL real en la base aislada configurada por `.env.test`, con comprobación previa de host distinto de `.env`. Se usa `SET LOCAL ROLE pulso_app` y se verifica NOBYPASSRLS y NOSUPERUSER. La prueba sustituye únicamente la frontera de apertura de transacción para reutilizar el fixture con rollback: ejecuta `setTenantContext`, servicio, SQL y políticas reales, sin sustituir resultados de consultas. No es conexión autenticada independiente del rol.

- Dos empresas y tres sucursales: cada reporte ve una entrada y el nombre de receta propio. Una sucursal de otra empresa se rechaza.
- Oráculo: 3 porciones × 0.5 kg × 200 centavos/kg = 300 centavos de costo; contra 1200 de ingreso, 25%.
- Fuente sin ingreso: subtotal 1200 conservado, total y porcentaje ausentes. Periodo vacío: NO_DATA.
- Revisiones 1→2→3: 1200→cero explícito→null. Solo el head vigente decide la cobertura; cero es COMPLETE sin porcentaje y null es PARTIAL.
- Sin contexto no se leen costos; con empresa A una consulta sin WHERE no devuelve costos de B. Sin SELECT general, sin nombre de artículo y sin UPDATE.

Los grants amplios de otras suites no enmascaran el defecto: dentro de cada transacción se revocan permisos de tabla y columna de los tres catálogos y se reconstruyen los SELECT declarados por 0138/0141 más la candidata 0154. **Todo ese DDL y los fixtures terminan en rollback**, y se comprueba después que no permanecen las empresas sintéticas. No se aplica 0154 de forma persistente en ningún entorno.

## Regresión y límites

- Focal COGS + contrato/diferencial/snapshot + trazabilidad: **88/88**, cinco archivos, exit 0.
- `pnpm.cmd exec tsc --noEmit`, heap 4096: **exit 0**.
- ESLint de ambos servicios modificados y prueba nueva: **exit 0**, sin salida de errores ni advertencias.
- Integridad documental: `node --experimental-strip-types scripts/validate-faltantes.ts`, **exit 0**, 239 filas, 86 tareas base, 99 adicionales y 24 aceptaciones. El lanzador `tsx` falló con `uv_os_get_passwd returned ENOMEM`; se ejecutó el mismo validador directamente con Node, sin omitir comprobaciones.
- `git diff --check`: **exit 0** (avisos LF/CRLF).
- Build final: `NODE_OPTIONS='--use-system-ca --max-old-space-size=4096' pnpm.cmd run build`, **interrumpido por el agente (exit 1)** tras mantenerse en “Creating an optimized production build” mientras el entorno reportaba ENOMEM. No produjo resultado de compilación; no se atribuye un error de código ni se declara build exitoso. TypeScript pasó antes de ese intento. El build global continúa pendiente.

No se acepta `INV-01.b4.coverage.cogs`, el padre coverage ni INV-01.b. Pendientes: dependencia b4b, sesión/HTTP/UI integrados, migración desplegada, conexión runtime independiente y medición de rendimiento con volumen operativo. Los lectores ejecutivo y menú continúan pendientes. La valoración histórica de costos sigue fuera de este cambio.
