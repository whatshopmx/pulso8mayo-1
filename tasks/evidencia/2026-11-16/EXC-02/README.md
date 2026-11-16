# EXC-02 — Aceptación del sync legacy → canónico

Fecha: 2026-11-16. Head: `754c7ea9e662c7d03c935af264fdf4d03aa18a24`. Verificación **V2 + V3** sobre Neon aislado. Sin aplicación al entorno operativo.

## Qué cierra

El plan acepta `EXC-02` cuando se cumplen tres condiciones:

1. **Repetir el sync no duplica** filas canónicas ni cambia sus identidades.
2. Se pueden **comparar conteos e identidades** entre el feed legacy y la proyección canónica, y la **bandera de lectura es reversible** sin mutar la tabla.
3. La **salida del feed legacy declara el estado canónico** cuando el sujeto ya fue proyectado.

El incremento (`754c7ea`) añade `canonical` a `GroupException` para las filas del agregador legacy, con un mapa explícito `LEGACY_SUBJECT_TYPES` que espeja el `subject_type` de cada adaptador. El sync en sí (`lib/inngest/functions/exceptions-sync.ts` + adaptadores) no cambia: el upsert ya era idempotente por `(company_id, subject_type, subject_id)`.

## Verificación ejecutada en este HEAD

| Comprobación | Comando | Resultado |
|---|---|---|
| Regresiones focales de excepciones | `vitest run` sobre `exception-raise-atomic`, `exception-service`, `exception-adapters`, `group-exceptions-canonical` | **33/33, exit 0** (6.03 s, 4 archivos) |
| V2 + V3 de EXC-02 | `vitest run --config vitest.integration.config.ts` sobre `exc02-legacy-canonical-sync-db.test.ts` | **6/6, exit 0** (29.31 s) |
| TypeScript | `tsc --noEmit` con `--max-old-space-size=8192` | **exit 0** |
| ESLint de servicio y pruebas | `eslint` sobre `group-exceptions-service.ts` y `group-exceptions-canonical.test.ts` | **exit 0**, 0 errores, 3 advertencias previas (`domain`/`qsrCategory`/`limit` desestructurados sin uso) |

Entorno de integración: Neon aislado `ep-cold-morning-bewqoz3o`, `NODE_OPTIONS=--use-system-ca`. La suite corre contra PostgreSQL real y limpia sus datos; el rol de pruebas conserva el bypass de RLS porque aquí se certifica el sync, no el aislamiento (eso es `EXC-01` / `EXC-01.rls`).

## Qué acredita

### V2 — base real

1. **Idempotencia**: dos corridas consecutivas de `runExceptionAdapters` producen las mismas 3 identidades (`incident:<id1>`, `incident:<id2>`, `cash_variance:<cutId>`) y exactamente los mismos ids canónicos. Los adaptadores vuelven a recorrer las mismas filas (`raised: 2` en ambas corridas) sin errores ni filas nuevas.
2. **Anotación del feed legacy**: el incidente y el corte proyectados aparecen con `canonical.status = "OPEN"`, el `ownerId` y `slaDueAt` canónicos. La fila sigue siendo legacy: `id` del dominio, `status` del dominio (`DETECTED`) y `lifecycle` ausente.
3. **Sujeto no alcanzado**: un incidente insertado después del sync aparece en el feed **sin** `canonical`; tras el siguiente sync lo declara, sin duplicar a los anteriores (4 filas canónicas).
4. **Paridad**: las identidades calculadas desde el feed legacy (`LEGACY_SUBJECT_TYPES[sourceTable]` + `id`) coinciden exactamente con `(subject_type, subject_id)` de `exceptions`, y todas las filas del feed declaran su proyección.
5. **Bandera reversible**: con `EXCEPTIONS_CANONICAL_READ=true` el feed lee `exceptions` (todas las filas con `lifecycle` y los mismos ids canónicos); con `false` vuelve al dominio y expone el mismo conjunto de ids vía `canonical`. La tabla canónica no cambia de tamaño entre lecturas.

### V3 — ruta HTTP

6. `GET /api/group/exceptions` con sesión mockeada (ADMIN, alcance de grupo) responde **200**, `success: true`, y entrega el incidente con `status: "DETECTED"` (fuente legacy) **y** `canonical.status: "OPEN"`. La ruta no proyecta: la tabla canónica sigue con 3 filas después de leerla.

## Límites

- **No hay cobertura de navegador/UI**: V3 es el handler de ruta invocado con `Request` y sesión mockeada, no un servidor HTTP real ni Playwright. Las acciones de lifecycle y la UI de excepciones corresponden a `EXC-05` y a las filas de validación.
- La prueba **no** certifica el cron de Inngest ni la entrega del evento `exceptions/sync.requested`; ejecuta `runExceptionAdapters` — el mismo cuerpo que corre el `step.run`. El disparo durable ya estaba cubierto por su propia implementación.
- **No se aplicó ninguna migración** en este incremento; `0151`/`0153` del frente de facturas siguen fuera de este commit.
- Aceptar `EXC-02` **no acepta** `EXC-03.a` (lifecycle concurrente) ni `EXC-05` (acciones canónicas en UI), aunque ambos dependen de este ticket.

## Reproducción

```powershell
# Regresiones focales
pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads `
  lib/services/__tests__/exception-raise-atomic.test.ts `
  lib/services/__tests__/exception-service.test.ts `
  lib/services/__tests__/exception-adapters.test.ts `
  lib/services/__tests__/group-exceptions-canonical.test.ts

# V2 + V3 en base aislada
$taskPreviousNodeOptions = $env:NODE_OPTIONS
try {
  $env:NODE_OPTIONS = '--use-system-ca'
  pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts `
    tests/integration/exc02-legacy-canonical-sync-db.test.ts
  $taskIntegrationExit = $LASTEXITCODE
} finally {
  $env:NODE_OPTIONS = $taskPreviousNodeOptions
}
exit $taskIntegrationExit
```
