# IMSS Foundation — revisión de T5–T7

Fecha: 2026-10-24. Alcance autorizado: implementar Foundation y preparar la migración para revisión. Esta verificación inicial se hizo antes del GO operativo. Actualización: el usuario dio el GO el 2026-10-24 y se aplicó solo 0121; ver `migration-applied.json`.

## Cambio preparado

- `drizzle/0121_imss_movimientos.sql`: tres enums, tablas `imss_files`/`imss_movements`, dos columnas nullable en sucursales/empresas, claves foráneas e índices por empresa. Sin DROP y sin RLS. Fechas civiles como `date`, instantes de auditoría como `timestamptz`.
- Snapshots `0121` y `0122` alineados con el schema. `0122_aguinaldo_snapshot.sql` ya existía al iniciar y pertenece a otro trabajo; no se modificó su SQL. Un `db:migrate` general puede incluir esa migración: revisar el journal completo antes del despliegue.
- `ImssMovementService`: estado por empleado/tipo con `DISTINCT ON`, pendientes idempotentes, snapshots de salario real, bloqueos, acuses atómicos y rechazo de estados finales. La auditoría usa el mismo executor: si falla, revierte toda la transición.
- Adopción histórica explícita por sucursal, actor, nota y modo de simulación. El folio `MIGRACION` queda en `employee_audit_logs.new_value.acuseFolio`; los movimientos confirmados tienen `fileId=NULL`. No se crean archivos ficticios ni salarios. El preview obligatorio del botón corresponde a T11.
- Captura de registro patronal en la pantalla de sucursal y contratos POST/PATCH existentes. Normalización a mayúsculas y limpieza a NULL. IDSE/SUA exigen registro de sucursal y rechazan mezclarlos; ya no usan el UUID de la empresa.

## Evidencia

- `unit.json` / `unit.log`: 2066 pruebas pasadas, una omitida y una pendiente, 169 archivos.
- `focused.json` / `focused.log`: 12 pruebas de integración con PostgreSQL embebido aislado (PGlite), ejecutando el servicio y generadores reales. Incluye dos empresas, idempotencia, bajas, último movimiento por fecha efectiva, rechazo, rollback al fallar auditoría, adopción con/sin pendientes y bloqueo de registros patronales.
- `integration.json` / `integration.log`: suite general completa, 67 pruebas pasadas en 12 archivos, incluidas las pruebas existentes contra Neon aislado y las nuevas de PGlite.
- El setup ejecuta dos veces el runner de Drizzle sobre el SQL real y verifica una sola entrada en `drizzle.__drizzle_migrations`.
- `schema.json` / `schema.log`: Drizzle no propone cambios adicionales.
- ESLint de los archivos modificados: cero errores; once advertencias preexistentes en la pantalla y servicio de sucursales.
- Navegador Chromium aislado con pantalla real y API simulada: registro inválido bloqueado; `a1234567890` enviado como `A1234567890`; cero errores JS. Captura móvil: `branch-mobile.png`.
- TypeScript inicial limpio. `build.json` / `build.log`: build completo aprobado, incluidas compilación, TypeScript y generación de páginas. Se ejecutó con `NODE_OPTIONS=--use-system-ca --max-old-space-size=4096`: el primer intento compiló pero su worker de TypeScript agotó el heap predeterminado de 2 GB. No se omitieron comprobaciones.

La integración contra Neon inicialmente falló con `unable to verify the first certificate`. En Node 22.17 la opción explícita `NODE_OPTIONS=--use-system-ca` resolvió el problema; `NODE_USE_SYSTEM_CA=1` por sí sola no lo resolvía en este entorno. Se mantuvo la validación TLS y no se aplicaron migraciones para resolverlo.

## Estado operativo

GO operativo recibido y 0121 aplicada el 2026-10-24; T8–T10 implementadas. Evidencia de continuación: `../imss-files-2026-10-24/README.md`. Las pantallas T11–T15 siguen pendientes.

La estructura del registro se contrastó con la [documentación de movimientos afiliatorios del IMSS](https://www.imss.gob.mx/sites/all/statics/pdf/formatos/EstrucMovAfil.pdf). Esta validación no acredita asignación del registro ni importabilidad de los archivos de trabajo.
