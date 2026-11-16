# EXC-01.rls — migración reproducible de aislamiento de excepciones

Fecha: 2026-11-16. Base: `189376a50f9f20c20a41200e7e66a51ca74d40c0` más el árbol local de este incremento. Sin commit, sin aplicación al entorno operativo.

## Alcance

Aportar el artefacto que faltaba para aceptar EXC-01: una migración aditiva y revisada que habilita RLS sobre `exceptions` y crea la política `exceptions_tenant_isolation`, más la verificación runtime en Postgres aislado. El `beforeAll` de la prueba canónica deja de instalar la política a mano: ahora aplica este archivo.

## Archivos

| Archivo | Tipo |
|---|---|
| `drizzle/0152_exc01_exceptions_rls.sql` | migración nueva |
| `drizzle/meta/_journal.json`, `drizzle/meta/0152_snapshot.json` | metadata generada por `drizzle-kit generate --custom` |
| `tests/integration/exc01-exceptions-rls-migration-db.test.ts` | prueba V2 focal nueva |
| `tests/integration/canonical-exception-persistence-db.test.ts` | reemplaza el DDL improvisado del `beforeAll` por la migración revisada |

## Contrato de la migración

- `ALTER TABLE "exceptions" ENABLE ROW LEVEL SECURITY`.
- `GRANT SELECT, INSERT, UPDATE, DELETE` a `pulso_app` sólo si el rol existe; no crea credenciales.
- Política `exceptions_tenant_isolation` con `USING` y `WITH CHECK` sobre `company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid`.
- Reaplicable: la creación de la política se guarda con `IF NOT EXISTS` sobre `pg_policies`; el `GRANT` y el `ENABLE` son idempotentes.

No usa `FORCE ROW LEVEL SECURITY`; el rol dueño conserva su bypass y el runtime debe ser `NOBYPASSRLS`. No se aplica a `main` ni al operativo: OPS-03 conserva la activación por entorno.

## Verificación

| Comprobación | Resultado |
|---|---|
| Prueba focal de la migración | **4/4, exit 0** (9.42 s) |
| Migración + canónica EXC-01 | **12/12, exit 0** (34.42 s), 2 archivos |
| `tsc --noEmit --incremental false` | **exit 0** |
| ESLint de las dos pruebas | **exit 0**, 1 advertencia previa de `any` |

Entorno: Neon aislado `ep-cold-morning-bewqoz3o`, rol `pulso_app` (`rolsuper: false`, `rolbypassrls: false`), certificados del sistema (`NODE_OPTIONS=--use-system-ca`). La prueba focal crea un esquema privado, copia `exceptions` con `LIKE ... INCLUDING ALL` y aplica el SQL real; la canónica aplica el mismo archivo sobre `public` de la base aislada.

## Qué acredita

1. El SQL habilita RLS y crea `USING`/`WITH CHECK`; `pulso_app` recibe DML.
2. El archivo se puede reaplicar sin duplicar políticas ni romper privilegios.
3. Sin contexto de empresa, el runtime no ve filas y la escritura se rechaza con `42501`.
4. Cada empresa ve sólo lo suyo; insertar o mover una fila a otra empresa se rechaza.
5. La conexión reutilizada (`pool max=1`) no hereda el contexto anterior.
6. La suite canónica de EXC-01 (persistencia, unicidad, rollback, lifecycle) corre con la migración revisada y sin mocks.

## Registro en el journal

`drizzle/meta/_journal.json` registra `0152_exc01_exceptions_rls` en `idx 152`, después de `0150_fc20_company_activation`. La cadena queda con un hueco deliberado en `idx 151` porque esa posición pertenece a `0151_invoice_destination`, que vive en el frente de facturas y no forma parte de este incremento: el journal versionado no puede referenciar un SQL que no está en el repositorio.

Verificado con el journal candidato:

| Comprobación | Resultado |
|---|---|
| `drizzle-kit generate --custom` con hueco en `idx 151` | **ok**; añade `idx 153` sin fallar por el `0151` ausente |
| `drizzle-kit check` | **`Everything's fine`** |
| Tags del journal con SQL versionado ausente | **ninguno** (151 entradas) |

El frente de facturas completará el journal con `idx 151` y `idx 153`; al ser adiciones, la unión con este commit no renumera nada.

## Límites

- No se aplicó la migración a `main` ni a un entorno operativo; OPS-03 sigue siendo el punto de aplicación por entorno.
- No se ejecutó `drizzle-kit migrate` como verificación: la base aislada sólo tiene 4 registros en `drizzle.__drizzle_migrations`, así que migrarla aplicaría el historial completo. La aplicación del lote se comprobó aplicando el SQL real, no el runner.
- La prueba canónica usa la base aislada y limpia sus datos; no acredita HTTP/sesión real ni UI.
- Aceptar EXC-01.rls no acepta por sí solo EXC-01 ni las filas 02.03/02.04/05.*: esas filas dependen además de VAL-01 y del resto del frente.

## Comandos reproducibles

```powershell
$taskPreviousNodeOptions = $env:NODE_OPTIONS
try {
  $env:NODE_OPTIONS = '--use-system-ca'
  pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts `
    tests/integration/exc01-exceptions-rls-migration-db.test.ts `
    tests/integration/canonical-exception-persistence-db.test.ts
  $taskIntegrationExit = $LASTEXITCODE
} finally {
  $env:NODE_OPTIONS = $taskPreviousNodeOptions
}
exit $taskIntegrationExit
```
