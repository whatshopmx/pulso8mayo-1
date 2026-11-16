# EXC-01 — Aceptación de la persistencia canónica de excepciones

Fecha: 2026-11-16. Head: `5f6a227b9b577a02e1613ac33540e9f9d520bfbb`. Verificación **V2** sobre Neon aislado. Sin aplicación al entorno operativo.

## Qué cierra

El plan condicionaba EXC-01 a dos bloqueos que ya están resueltos:

1. **Migración reproducible** — `drizzle/0152_exc01_exceptions_rls.sql`, registrada en `drizzle/meta/_journal.json` (`idx 152`) por el commit `5f6a227`. La prueba canónica ya no instala la política desde `beforeAll`: aplica este archivo.
2. **V2 sobre esa migración** — repetida en este HEAD, no heredada de la sesión anterior.

Trabajo previo asumido: `EXC-01.rls` (aceptado, con su propia evidencia) y `SEC-00` (aceptado).

## Verificación ejecutada en este HEAD

| Comprobación | Comando | Resultado |
|---|---|---|
| Regresiones focales de excepciones | `vitest run` sobre `exception-raise-atomic`, `exception-service`, `exception-adapters`, `group-exceptions-canonical` | **28/28, exit 0** (8.98 s, 4 archivos) |
| V2 canónica + migración aplicada | `vitest run --config vitest.integration.config.ts` sobre `canonical-exception-persistence-db.test.ts` y `exc01-exceptions-rls-migration-db.test.ts` | **12/12, exit 0** (39.16 s, 2 archivos) |
| TypeScript | `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc --noEmit --incremental false` | **exit 0** |
| ESLint de servicio y pruebas | `eslint` sobre `exception-service.ts`, las cuatro suites focales y las dos pruebas de integración | **exit 0**, 0 errores, 7 advertencias previas de `any` |

Entorno de integración: Neon aislado `ep-cold-morning-bewqoz3o`, rol runtime `pulso_app` (`rolsuper: false`, `rolbypassrls: false`), `NODE_OPTIONS=--use-system-ca`. La suite canónica corre contra Postgres real, sin mocks, y limpia sus datos.

## Qué acredita

1. **Unicidad**: `(company_id, subject_type, subject_id)` con `onConflictDoUpdate` idempotente; dos altas del mismo sujeto no duplican fila.
2. **RLS**: política `exceptions_tenant_isolation` con `USING` y `WITH CHECK`, aplicada desde la migración revisada; `pulso_app` sin bypass.
3. **Aislamiento**: la empresa A no lee ni modifica filas de B; los cruces se rechazan con `42501`.
4. **Rollback**: una transacción revertida no deja filas residuales.
5. **Lifecycle**: `OPEN → ASSIGNED → IN_ACTION → RESOLVED → VERIFIED → CLOSED` persiste en DB.
6. **Segregación de funciones**: el verificador no puede ser el mismo usuario que resolvió, y la regla se aplica en la transacción.
7. **Sin mocks**: todas las aserciones de integración se ejecutan contra PostgreSQL real.

## Límites

- Es **V2**: no acredita HTTP, sesión real ni UI. Esa cobertura corresponde a V3 y a las filas de validación (VAL-01, 02.03/02.04/05.*).
- **No se aplicó `0152` a `main` ni al entorno operativo**; OPS-03 conserva la activación por entorno.
- Aceptar EXC-01 **no acepta** las filas transversales que dependen de VAL-01, ni `EXC-02` (sync legacy → canónico).
- La suite canónica aplica el lote sobre `public.exceptions` de la base **aislada**; eso no equivale a un despliegue.

## Reproducción

```powershell
# Regresiones focales
pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads `
  lib/services/__tests__/exception-raise-atomic.test.ts `
  lib/services/__tests__/exception-service.test.ts `
  lib/services/__tests__/exception-adapters.test.ts `
  lib/services/__tests__/group-exceptions-canonical.test.ts

# V2 en base aislada
$taskPreviousNodeOptions = $env:NODE_OPTIONS
try {
  $env:NODE_OPTIONS = '--use-system-ca'
  pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts `
    tests/integration/canonical-exception-persistence-db.test.ts `
    tests/integration/exc01-exceptions-rls-migration-db.test.ts
  $taskIntegrationExit = $LASTEXITCODE
} finally {
  $env:NODE_OPTIONS = $taskPreviousNodeOptions
}
exit $taskIntegrationExit
```
