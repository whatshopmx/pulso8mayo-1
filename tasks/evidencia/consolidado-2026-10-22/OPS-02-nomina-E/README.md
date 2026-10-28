# OPS-02.nomina.E — migración aditiva de RLS y grants de nómina

Base `c02c6e6`; 2026-10-28. Dos archivos de código/pruebas (`drizzle/0123_rls_nomina.sql` y el journal) más dos pruebas. No se aplica la migración al operativo ni a `public` de la base aislada, no se crean roles ni credenciales y no se regeneran los manifiestos de OPS-01.

## Lote generado

`drizzle/0123_rls_nomina.sql`, inventariado en `drizzle/meta/_journal.json` como idx 123. Sigue el patrón de los lotes SEC-04/SEC-05: `ENABLE ROW LEVEL SECURITY`, grants condicionados a que `pulso_app` ya exista y una política `FOR ALL` con `USING` y `WITH CHECK` por tabla.

| Tabla | Frontera | Motivo |
|---|---|---|
| `payroll_runs` | `company_id = contexto` | Raíz del lote; el resto de tablas cuelga de ella. |
| `payroll_payslips` | `EXISTS` sobre la corrida padre | No tiene `company_id`; el `WITH CHECK` también rechaza mover un recibo a una corrida ajena. |
| `payroll_aguinaldo_dispersiones` | `company_id = contexto` **y** coherencia con `run_id` | Evita registrar una dispersión de A colgada de una corrida de B; `run_id NULL` sigue permitido (bitácora manual). |
| `cfdi_nomina_timbrados` | `company_id = contexto` | Conserva la unicidad por empresa/RFC/período bajo la política. |

El rechazo por defecto es el mismo de los lotes anteriores: `NULLIF(current_setting('app.current_company_id', true), '')::uuid`. El SQL no crea roles, no contiene contraseñas y no usa `FORCE ROW LEVEL SECURITY`: el dueño/migración conserva su bypass y el runtime debe ser `NOBYPASSRLS`.

## Pruebas

| Ejecución | Resultado | Registro |
|---|---|---|
| Contrato estático de la migración (cobertura, USING/WITH CHECK, journal, sin DROP/credenciales) | 7/7, exit 0 | [unit.log](unit.log), [unit-exit.log](unit-exit.log) |
| SQL real 0123 aplicado en esquema privado con `pulso_app`, dos empresas y pool max=1 | 5/5, exit 0 | [runtime.log](runtime.log), [runtime-exit.log](runtime-exit.log) |
| TypeScript (`tsc --noEmit --incremental false`), heap 6144 MB | exit 0 | [tsc.log](tsc.log), [tsc-exit.log](tsc-exit.log) |
| ESLint de las dos pruebas | exit 0, sin errores | [lint.log](lint.log), [lint-exit.log](lint-exit.log) |
| Build de producción con TypeScript, heap 6144 MB | exit 0, `✓ Compiled successfully` y 430 páginas generadas | [build.log](build.log), [build-exit.log](build-exit.log) |
| Suite unitaria completa (`pnpm test:unit`) | 181 archivos, 2284 pruebas pasadas, 1 omitida, 1 pendiente, 0 fallos | [unit-full.log](unit-full.log), [unit-full-exit.log](unit-full-exit.log) |

Los dos primeros intentos de build fallaron por presión de memoria del equipo (0.8 GB libres con el editor abierto): el primero con `Next.js build worker exited with code 3221226505` tras compilar, el segundo con `3221225725` al iniciar. Se conservan ambos registros ([intento 1](build-attempt1.log), [intento 2](build-attempt2.log)) y el tercero, con `.next` limpio y sin procesos concurrentes, terminó en exit 0. No se cambió configuración de build, fuentes ni pruebas para lograrlo.

La prueba de runtime copia las cuatro tablas con `LIKE public.* INCLUDING ALL` a un esquema aleatorio, aplica el SQL real dentro de una transacción con `search_path` privado y comprueba: RLS activo y una política con `USING`/`WITH CHECK` por tabla; DML de `pulso_app` sin superuser ni bypass; cero filas y escritura rechazada sin contexto; aislamiento de corridas, recibos, dispersiones y CFDI entre dos empresas; rechazo de un recibo o dispersión que apunta a la corrida ajena (incluido `UPDATE run_id`); y que la conexión reutilizada con `max=1` no hereda el contexto. Al terminar elimina el esquema; `public` no se modifica.

## Límites y revisión

- **No aplicada**: ni el operativo ni `public` de la base aislada tienen 0123. La activación corresponde a OPS-03 y la aceptación HTTP/job con login real a OPS-02.nomina.F / AGU-03C.3. Esta evidencia no acredita RLS operativo.
- **Manifiestos**: los JSON de OPS-01 se generaron antes del lote y no incluyen 0123. Se añadió el inventario al README de OPS-01; regenerarlos y confirmar el estado real es una precondición de OPS-03, no de este lote.
- **Cobertura acotada**: sólo las cuatro tablas de nómina/CFDI. Otras tablas de tesorería y del dominio quedan fuera y requieren su propio lote. No se valida rendimiento de las subconsultas de política ni el comportamiento bajo cargas concurrentes.
- **Rol**: `pulso_app` debe existir y ser `NOBYPASSRLS`; la migración no lo crea. Una empresa sin rol runtime aprovisionado no queda cubierta por este SQL.
- **Sin FORCE**: el dueño conserva el bypass para migraciones y operación; si en el futuro se requiere que el dueño también quede sujeto a RLS, es un cambio separado con su propio ensayo.
- No se modifican importes, snapshots ni el protocolo fiscal; NOM-04/NOM-05 conservan su aceptación.

Revisión del diff: la empresa sale del contexto transaccional, nunca de un `company_id` de entrada; las políticas no filtran por `user_id`; no hay transacciones anidadas ni DDL destructivo; los grants están dentro del guard de existencia del rol; el journal conserva el orden y no renumera 0121/0122.
