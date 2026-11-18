# Reporte ejecutivo bajo contexto transaccional y RLS

Continuación 2026-11-18 sobre HEAD `7ad1ef6f9817a8f034fc1ef325bceb86ac15d750` más diff local. Código implementado, V2 focal comprobada; sin nueva aceptación ni instalación persistente.

## Incrementos

1. Servicio y prueba SQL (dos archivos): `executive-report-service.ts` usa `withCompanyContext` para todas las consultas, pasando el mismo executor a los KPIs. Selecciona columnas explícitas, conserva contratos/cálculos y rechaza sucursal ajena en el servicio, también para consumidores que no pasan por la ruta HTTP.
2. `INV-01.b4.coverage.executive.catalog.rls`: migración custom generada 0157, journal, snapshot y prueba (cuatro archivos). Solo SELECT de `inventory_items.min_level/active`; conserva RLS y no concede DML ni lectura general.
3. `INV-01.b4.coverage.executive.sources.rls`: schema raíz, migración generada 0158, journal, snapshot y prueba (cinco archivos). Habilita RLS SELECT de `inventory_waste`, `workflow_instances` y `workflow_templates`, con grants por columna. Instancias solo de conteos de inventario en sucursales propias; las plantillas propias/globales requieren contexto y alcance; merma exige empresa y pertenencia de sucursal. Sin FORCE: conserva escritores dueños. No concede DML runtime.

## Verificación

- Generación: `pnpm.cmd db:generate --custom --name inv01b_executive_reader` y `pnpm.cmd db:generate --name inv01b_executive_sources`, exit 0. SQL revisado: tres ENABLE RLS, tres políticas SELECT y grants explícitos; no DROP ni cambios de datos.
- RED inicial: el reporte ignoraba el executor del contexto y devolvía NO_DATA. Tras pasarlo por transacción, SQLSTATE 42501 reprodujo falta de lectura de catálogo y workflows. Una aserción intermedia de la prueba se corrigió para `min_level`, que es integer (5), no numeric ('5.00').
- GREEN: `NODE_OPTIONS='--use-system-ca --max-old-space-size=4096' pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/executive-revenue-coverage-db.test.ts tests/integration/menu-revenue-coverage-db.test.ts tests/integration/cogs-revenue-coverage-db.test.ts --maxWorkers=1 --pool=threads`: **10/10, tres archivos, exit 0**, 80.12 s; tres casos ejecutivos, cuatro menú, tres COGS.
- Unitarias: `pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads tests/unit/inventory/executive-report-route.test.ts tests/unit/inventory/menu-engineering-coverage.test.ts lib/services/__tests__/executive-report-coverage.test.ts lib/services/__tests__/cogs-revenue-coverage.test.ts`: **41/41, cuatro archivos, exit 0**.
- `pnpm.cmd exec eslint lib/services/executive-report-service.ts lib/db/schema.ts tests/integration/executive-revenue-coverage-db.test.ts`: exit 0, siete advertencias preexistentes (tres imports schema, dos any de conteo y dos parámetros del consolidado).
- `node tasks/evidencia/2026-11-18/INV-01.b4.coverage.executive/verify-snapshots.cjs`: exit 0. Cadena 0156→0157→0158 válida, 0157 sin cambio de esquema y 0158 cambia exclusivamente políticas/isRLSEnabled de las tres tablas declaradas, comparando objetos sin depender de orden JSON.
- `git diff --check` focal: exit 0. `NODE_OPTIONS='--max-old-space-size=4096' pnpm.cmd exec tsc --noEmit`: exit 0.
- `NODE_OPTIONS='--use-system-ca --max-old-space-size=4096' pnpm.cmd run build`: **exit 0**, compilación 2.1 min, TypeScript y 455/455 páginas, optimización final. Avisos previos conservados: `fetchConnectionCache` deprecado y `DYNAMIC_SERVER_USAGE` en documentos laborales por `headers` (la ruta aparece dinámica). El intento anterior con lock ocupado fue independiente; no se eliminó ningún lock ni se interrumpió otro proceso.
- `node --experimental-strip-types scripts/validate-faltantes.ts`: exit 0, 239 filas, 86 tareas base, 102 adicionales, 24 aceptaciones, cero errores. La matriz actualiza únicamente la fila 11.11, manteniendo estado Parcial.

## Casos y aislamiento

Postgres real de `.env.test`, host distinto del operativo verificado antes de escribir. Dos empresas, tres sucursales; fixtures de recetas/ventas/revisiones, lotes, merma y workflows dentro de rollback. Rol `pulso_app` verificado NOSUPERUSER/NOBYPASSRLS mediante SET LOCAL ROLE. Se reconstruyen grants de catálogo/workflows/merma para que permisos amplios de otras suites no oculten el fallo. Las migraciones candidatas 0157/0158 se ejecutan solo dentro de esa transacción; empresas sintéticas ausentes después del rollback.

Oráculos: 3 porciones × 0.5 kg × 200 centavos = 300 de COGS; ingreso firme 1200 → 25% food cost. Lote 4 × 200 = 800 de stock → 2.7 días / rotación 0.38, mínimo 5 → fill rate 0. Merma aceptada 100 / (300 + 100) → 25%; STAFF y pendiente se excluyen. Conteo 10→10 → exactitud 100%; empresa B 10→1 → 0%, sin contaminar A. Plantilla global de conteo funciona para sucursal propia. Workflow RH propio no aparece en SELECT de instancias runtime.

Ingresos parciales anulan total y porcentaje pero conservan subtotal; consolidado solo incluye sucursales propias. Período vacío es NO_DATA. Revisiones sucesivas distinguen cero explícito COMPLETE de ingreso null PARTIAL. Sin contexto no se ven plantillas, conteos ni merma. Sucursal ajena se rechaza. SELECT general y UPDATE sobre fuentes se rechazan realmente en savepoints; privilegios no incluyen INSERT/UPDATE/DELETE de tabla.

## Límites y siguiente paso

El arnés sustituye solo la apertura de transacción para usar el fixture con rollback; no es una conexión autenticada independiente de runtime. No acredita sesión Better Auth, servidor Next ni navegador. No cierra costos históricos, rendimiento con volumen operativo, SEC-05 ni escritores runtime de los dominios. Antes de OPS-03 inventariar consumidores/roles y aceptar DML afectado por RLS: los escritores dueños conservan compatibilidad, otros roles requieren políticas explícitas. No se aplicó a main ni se cambió el total de 24 aceptaciones.

La [continuación HTTP](session-http.md) comprueba por separado Better Auth y lecturas con conexión dueña; el checkpoint de este incremento tiene unitarias, V2, HTTP focal, tipos/lint, revisión del diff, snapshots y build aprobados. No acepta padres ni sustituye el recorrido conjunto con navegador.
