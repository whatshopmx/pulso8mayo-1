# FEFO-03A — Lectura de lotes aislada

Se cerró el alcance de GET en `app/api/inventory/batches/route.ts`. La empresa sale de la sesión y se comprueba tanto en sucursal como en producto. GERENTE/SUPERVISOR/EMPLEADO quedan en su sucursal; los roles con consulta de empresa siguen dentro de su empresa activa. Sin rol válido o sin sucursal local asignada se deniega, sin asumir ADMIN.

Listado y trazabilidad usan el mismo alcance. Un ID ajeno o inexistente responde 404 en trazabilidad; filtros a sucursal ajena no devuelven sus lotes. Se validan UUID, estado, trace y aliases incompatibles antes de consultar. El filtro por ID también funciona sin trace. No se cambió el filtro histórico que excluye cantidades negativas: su consulta explícita corresponde a FEFO-11A.

La trazabilidad filtra movimientos, mermas y producción por el producto/sucursal del lote autorizado y, donde existe, su empresa. Los joins de nombre de proveedor y receta también se acotan a la empresa. Así no se revelan datos de otras empresas a través de referencias históricas inconsistentes.

## Verificación

Pruebas de la ruta REAL con Drizzle/PGlite aislado, sin DATABASE_URL. Se sustituyen únicamente driver y sesión; el SQL y las respuestas HTTP son reales. Tablas derivadas del esquema con constraints relajadas para sembrar cruces de forma deliberada.

- Ciclo rojo: 20 de 22 casos fallaron con el GET anterior, incluidos lectura de empresa/sucursal ajena, falta de asignación y filtros inválidos.
- Ciclo verde inicial: 22/22 pasan.
- Ampliación: ID sin trace, aliases incompatibles e historial mal vinculado. Ruta + diagnóstico + regresiones de transferencias/producción: **54 pruebas, 4 archivos, todos aprobados**.
- `pnpm run test:unit tests/unit/inventory/batch-access.test.ts tests/unit/inventory/batch-diagnostic.test.ts tests/unit/inventory/transfer-scope.test.ts tests/unit/inventory/production-scope.test.ts`: código 0.
- `pnpm exec eslint app/api/inventory/batches/route.ts tests/unit/inventory/batch-access.test.ts`: código 0, sin advertencias.

No se modificaron permisos globales, tablas ni datos reales. PATCH permanece como siguiente incremento FEFO-03B; FEFO-03 completo sigue abierto hasta cerrar cambio de estado, motivo y auditoría. Build/tipos generales se verifican al cerrar los cambios de la fase; no se declaran aprobados aquí por pruebas locales.
