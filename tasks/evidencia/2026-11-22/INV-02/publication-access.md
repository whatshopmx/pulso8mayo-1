# INV-02.publish.rls — preparación de publicación con privilegios mínimos

Base: `d05eae09d67ed0b190b6785da168a8fb8b564fd0` + diff local. Código implementado y SQL efímero comprobado; **sin V2 independiente ni aplicación a Neon/main/operativo**.

Incremento de cinco archivos: schema raíz, SQL 0160, journal, snapshot 0160 y `recipe-policy-publication-access-db.test.ts`. Generación: `pnpm.cmd db:generate --name inv02_policy_publication_access`, exit 0. SQL revisado: habilita RLS y añade políticas en dos tablas existentes; añade triggers/grants explícitos, sin DROP ni backfill.

- `recipe_versions`: runtime sólo lee id, receta/empresa, número, rendimiento, unidad e ingredientes del snapshot, con RLS por empresa. No lee precio/autor ni puede escribir versiones. UPDATE se rechaza también desde un propietario ordinario: las fichas son snapshots y un cambio crea otra versión. Una versión publicada no puede borrarse por la FK de 0159. Los consumidores localizados mediante CodeGraph (`RecipeService` y seed 14) insertan versiones; no necesitan reescribirlas.
- `config_change_logs`: runtime sólo inserta empresa/actor/campo/antes/después y lee id/empresa/campo para acreditar un reintento. No puede insertar id/hora ni consultar JSON o bitácoras de otros parámetros. RLS limita al prefijo `recipe_consumption_policy:<uuid>` de su empresa y exige motivo de al menos cuatro caracteres en el JSON de auditoría. No obtiene UPDATE/DELETE/TRUNCATE.
- Triggers preservan hechos del prefijo de políticas frente a UPDATE/DELETE, incluso desde conexión dueña. Los logs existentes de otros campos conservan sus escrituras del propietario. No se usa una sucursal ficticia para una política de catálogo que afecta toda la empresa.

No se fuerza RLS en estas tablas compartidas existentes: se conserva el contrato de escritores propietarios sin contexto. Esto no acredita seguridad de conexiones dueñas ni compatibilidad de toda conexión desplegada. Antes de aplicar, V2 debe comprobar LOGIN independiente, sin propiedad/bypass/membresías, privilegios efectivos previos y escritores reales. No ampliar permisos para ocultar un fallo de runtime.

Verificación: RED por SQL inexistente, exit 1; GREEN **6/6 SQL PGlite**, exit 0. Prueba lectura propia/sin contexto/UUID ajeno, columnas sensibles denegadas, versiones inmutables, INSERT de auditoría propio y devolución de id, denegaciones DML, compatibilidad del dueño con otros campos y rollback. La regresión conjunta de publicación/acceso/reintentos/AUD-02 pasa **51/51**, exit 0, 32.32 s.

Drizzle check: exit 0. Lint de los archivos nuevos y servicios afectados: exit 0; schema raíz conserva tres warnings previos de imports. Tipos globales finales en ejecución (sesión 46789, heap 4 GB), sin build simultáneo. El build anterior con tipos y 455 páginas pasó antes de 0160/publicador; no acredita automáticamente estos cambios nuevos.

Falta V2 con servidor PostgreSQL/LOGIN separado y aplicación revisada. Los roles de estas pruebas sólo existen dentro de PGlite efímero.

Checkpoint posterior a los cambios: tipos globales con heap 4 GB **exit 0**, sesión 46789 terminada. Build nuevo Webpack/heap 4 GB solicitado después, sin tipos independientes simultáneos. Validador documental exit 0: 239 filas, 114 hijos, 25 aceptaciones, cero errores.
