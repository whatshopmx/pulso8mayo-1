# Cobertura menú: contexto runtime y permiso mínimo

Base 2026-11-18: HEAD `7ad1ef6f9817a8f034fc1ef325bceb86ac15d750` más este diff. Código implementado y V2 focal comprobada; sin aceptación del ticket ni de sus padres. Cambios concurrentes de marketing quedan fuera de este incremento.

Se corrige la ruta de menú: consultas en `withCompanyContext`, alcance resuelto por `resolveBranchScope`, rechazo de sucursal ajena, selección explícita de columnas y validación de UUID/fechas/orden. GERENTE sin asignación recibe 403 antes de consultar; su sucursal asignada prevalece sobre el query. Se preservan errores API de sesión con su código HTTP. No cambia la fórmula de costo ni la clasificación del menú.

Se separa el incremento SQL `INV-01.b4.coverage.menu.rls`: migración custom generada mediante `pnpm.cmd db:generate --custom --name inv01b_menu_reader` (exit 0), SQL 0156, journal y snapshot. Concede únicamente SELECT de `calculated_cost` a `pulso_app`; conserva RLS y permisos anteriores. No se aplica de forma persistente.

## Evidencia reproducible

- RED unitario: cinco fallos nuevos reproducidos (gerente sin sucursal devolvía 200, ausencia de contexto, UUID inválido y rango inverso aceptados, fecha inválida devolvía 500).
- GREEN: `pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads tests/unit/inventory/menu-engineering-coverage.test.ts lib/services/__tests__/executive-report-coverage.test.ts lib/services/__tests__/cogs-revenue-coverage.test.ts`: **32/32, tres archivos, exit 0**.
- RED Postgres: dos casos fallaban con SQLSTATE 42501 al leer `calculated_cost` bajo permisos declarados de 0138/0141.
- GREEN Postgres: `NODE_OPTIONS='--use-system-ca --max-old-space-size=4096' pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/menu-revenue-coverage-db.test.ts tests/integration/cogs-revenue-coverage-db.test.ts --maxWorkers=1 --pool=threads`: **7/7, dos archivos, exit 0**, 47.95 s (cuatro de menú, tres de regresión COGS).
- `pnpm.cmd exec eslint app/api/inventory/menu-engineering/route.ts tests/unit/inventory/menu-engineering-coverage.test.ts tests/integration/menu-revenue-coverage-db.test.ts`: exit 0, incluida la verificación final.
- `NODE_OPTIONS='--max-old-space-size=4096' pnpm.cmd exec tsc --noEmit`: **exit 0**.
- Build: `NODE_OPTIONS='--use-system-ca --max-old-space-size=4096' pnpm.cmd run build`, exit 1: otro proceso Next mantiene `.next/lock`; no hubo compilación de este intento. No se elimina el lock ni se interrumpe trabajo concurrente.
- `node --experimental-strip-types scripts/validate-faltantes.ts`: exit 0, 239 filas, 86 tareas base, 100 adicionales, 24 aceptaciones y cero errores. `git diff --check`: exit 0. Snapshot 0156: `prevId` coincide con 0155 y todos los campos de esquema coinciden exactamente; solo cambia identidad/cadena.

## Alcance probado

Postgres real configurado en `.env.test`, con comprobación de host distinto del operativo antes de escribir. Dos empresas y tres sucursales sintéticas. `SET LOCAL ROLE pulso_app` comprueba NOSUPERUSER y NOBYPASSRLS. Se revocan grants amplios de recetas y reconstruyen 0138/0141/0156 dentro de la transacción, evitando que permisos de otras suites oculten el fallo. DDL y fixtures se revierten; se verifica que las empresas no persistan.

Caso completo: tres porciones a 100 centavos de costo y 1200 de ingreso producen 25% de food cost y 75% de margen. Fuente sin ingreso conserva subtotal pero anula total/margen/cuadrante medido; el consolidado propio queda parcial. Empresa ajena se rechaza y sus recetas no aparecen en consultas sin WHERE. Período vacío no publica margen. La revisión vigente distingue cero explícito COMPLETE de null PARTIAL. Sin contexto no se leen costos; SELECT general y UPDATE se rechazan realmente usando savepoints.

## Límites

Continuación posterior del mismo día: [HTTP con sesión real](../INV-01.b4.coverage.executive/session-http.md), 6/6 con regresión COGS/ejecutivo; dos casos de menú con login Better Auth, sucursal y cobertura parcial. La prueba runtime anterior y la de sesión HTTP son independientes; navegador y recorrido conjunto siguen pendientes.

El checkpoint posterior acredita `pnpm.cmd run build` con certificados del sistema y heap 4096: exit 0, TypeScript y 455/455 páginas; [registro](../INV-01.b4.coverage.executive/runtime.md). El intento previo con lock ocupado se conserva como historia.

La sesión está simulada en estas pruebas de ruta; SQL, rol, políticas y cálculos son reales. La frontera de apertura de transacción se conecta al fixture con rollback: no equivale a conexión autenticada independiente de runtime. Pendientes Better Auth/Next/navegador, dependencias sin aceptar, instalación mediante OPS-03, build global y aceptación de costos históricos. El reporte ejecutivo conserva su V2 pendiente. No se acepta la fila 11.11 ni se cambia el total de 24 aceptaciones.
