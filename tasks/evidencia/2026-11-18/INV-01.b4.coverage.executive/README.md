# Cobertura ejecutiva: frontera HTTP por sucursal

Base 2026-11-18: HEAD `7ad1ef6f9817a8f034fc1ef325bceb86ac15d750` más diff local. Incremento de dos archivos: ruta `app/api/inventory/reports/executive/route.ts` y `tests/unit/inventory/executive-report-route.test.ts`. Sin aceptación del ticket.

Se aplica `resolveBranchScope`: un GERENTE sin asignación recibe 403 antes de consultar; su sucursal asignada prevalece frente a otra pedida en query. ADMIN conserva consolidación por empresa. `assertBranchOfCompany` verifica el par empresa/sucursal antes del servicio. UUID y fechas inválidos o rango inverso reciben 400, y errores ApiError de autenticación conservan su código HTTP.

RED: 7/9 pruebas nuevas fallaban contra la ruta anterior (alcance, entrada, empresa y sesión). GREEN: `pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads tests/unit/inventory/executive-report-route.test.ts tests/unit/inventory/menu-engineering-coverage.test.ts lib/services/__tests__/executive-report-coverage.test.ts lib/services/__tests__/cogs-revenue-coverage.test.ts`: **41/41, cuatro archivos, exit 0** (9 de esta ruta).

`pnpm.cmd exec eslint app/api/inventory/reports/executive/route.ts tests/unit/inventory/executive-report-route.test.ts`: exit 0. `NODE_OPTIONS='--max-old-space-size=4096' pnpm.cmd exec tsc --noEmit`: exit 0. `git diff --check` focal: exit 0. El intento de build de este turno no adquirió `.next/lock` por otra instancia Next (exit 1, sin compilar); no se borra ni se interrumpe trabajo ajeno.

Límites de este incremento HTTP: sesión, catálogo y reporte simulados; no acredita Postgres, Better Auth ni navegador. La [continuación runtime](runtime.md) ya incorpora contexto transaccional, permisos/RLS mínimos y pruebas SQL reales; no sustituye la aceptación de sesión/navegador. No se modifica la fórmula de costo ni se declara aceptación/despliegue o cierre de fila 11.11.
