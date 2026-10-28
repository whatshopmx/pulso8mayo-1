# OPS-01 — Inventario del entorno y preparación operativa

2026-10-26. Incremento A: diagnóstico de sólo lectura con archivo/clave de entorno explícitos, comparación de hashes/timestamps del journal completo, existencia de columnas/índices del snapshot local, roles y políticas RLS.

La herramienta no ejecuta migraciones, seeds ni cambios de rol. Todas las consultas se ejecutan dentro de una transacción READ ONLY, con timeout local. No imprime URL, contraseña ni contenido de las variables de entorno.

## Resultados del inventario

- [Operativo](operational-manifest.json): 0122 pendiente; faltan únicamente sus dos columnas y su índice en la comparación de existencia del snapshot 0122. 0102/0119/0120/0121 aparecen aplicadas. Conexión configurada `neondb_owner` con bypass; `pulso_app` no existe. Las cuatro tablas de nómina/CFDI inventariadas no tienen RLS.
- El historial operativo tiene 87 coincidencias exactas, 25 variaciones explicadas exclusivamente por LF/CRLF, nueve hashes distintos en 0000–0008, trece timestamps duplicados y una entrada sin equivalente local. **No se corrige ni se da por íntegro ese historial.** La herramienta exige revisión y no recomienda correr el migrador global.
- [Aislado](isolated-manifest.json): 0122 pendiente; 0102 figura como hueco histórico, 0121 tiene hash distinto e índice IMSS ausente; 0119/0120 coinciden. `pulso_app` existe sin superuser/bypass, pero nómina todavía no tiene políticas.
- La clasificación no normaliza silenciosamente los hashes del runner. Conserva el hash exacto y calcula las dos variantes LF/CRLF sólo para explicar diferencias. `requiresReview` permanece activo.

## Respaldo y restauración aislados del lote 0122

`tests/integration/aguinaldo-migration-recovery-db.test.ts`: **1/1, exit 0**, [log](recovery.log). Se copian las estructuras de las dos tablas afectadas a un esquema aleatorio de TEST_DATABASE_URL; sólo en esas copias vacías se retira una eventual columna 0122 para reproducir la línea base. No hay DROP en la migración.

Se crean datos sintéticos de dos empresas, incluidos recibos históricos duplicados. Se serializan todas las columnas/filas del lote, se ejecuta el SQL real 0122 en una transacción con search_path privado y se acredita que los históricos permanecen iguales y con snapshot NULL. El archivo lógico se restaura en un segundo esquema con la estructura previa: UUIDs, importes y registros coinciden íntegramente. Se comprueba que el índice parcial rechaza duplicar un recibo nuevo y permite el mismo usuario en otro run. Ambos esquemas se eliminan al terminar.

Este ensayo acredita recuperación lógica del lote de dos tablas con datos sintéticos. **No es un respaldo ni una restauración integral del proyecto Neon operativo**, ni acredita FK/RLS de las tablas clonadas. El respaldo operativo previo al rollout sigue siendo una condición de OPS-03.

## Lote RLS de nómina 0123 — inventario, sin aplicar

`drizzle/0123_rls_nomina.sql` (journal idx 123) es aditivo: habilita RLS en `payroll_runs`, `payroll_payslips`, `payroll_aguinaldo_dispersiones` y `cfdi_nomina_timbrados`, otorga DML a `pulso_app` sólo si el rol ya existe y crea una política por tabla con `USING`/`WITH CHECK`. Los recibos se aíslan por su corrida padre (también al cambiar `run_id`); la dispersión exige coherencia entre `company_id` y la corrida referenciada.

Los dos manifiestos de esta carpeta se generaron antes del lote y **siguen describiendo el estado previo**: no incluyen 0123 y no autorizan activar RLS bajo el dueño con bypass. Antes de OPS-03 hay que regenerarlos con archivo/clave explícitos y confirmar: las cuatro tablas sin RLS, 0123 como único lote RLS pendiente, `pulso_app` existente (o el aprovisionamiento previsto) y el journal con idx 123. La prueba de E aplica el SQL en un esquema privado; no sustituye ese inventario ni la aceptación HTTP/job de F.

## Runbook del lote revisable

1. Regenerar ambos manifiestos con archivo/clave explícitos. Confirmar host/base/rol, HEAD y hash exacto de `0122_aguinaldo_snapshot.sql`; no renumerar 0121.
2. No usar `db:push`, no modificar hashes del historial y no ejecutar el migrador global sobre el historial divergente. Investigar/explicar las diferencias de 0000–0008 y duplicados antes de un rollout general. La ausencia de columnas nuevas impide liberar aguinaldo nuevo en ese entorno.
3. Preparar revisión operativa separada de **sólo 0122** con precondiciones del esquema, respaldo recuperable del entorno y registro de aplicación. No incluir RLS ni otros SQL incidentalmente. No aplicar desde esta herramienta; OPS-03 conserva la operación.
4. Tras aplicación autorizada: confirmar columnas jsonb nullable, índice parcial, entrada/hash/fecha del journal y recorrido fiscal simulado del entorno. Nunca emitir CFDI reales como sanity check.
5. Reversión preferida: detener ejecuciones nuevas y volver al consumidor anterior manteniendo las columnas aditivas y todos los snapshots/intenciones emitidos. No borrar columnas ni recibos, no restaurar datos operativos a ciegas y no reenviar un timbre incierto. Si se necesita restauración de datos, comparar primero contra emisiones/auditoría posteriores al respaldo y ejecutar un plan específico revisado.
6. El lote RLS de nómina 0123 ya existe y está inventariado arriba; añadirlo al manifiesto regenerado y preparar consumidores HTTP/job y rol runtime antes de activar políticas. El manifiesto actual no autoriza activar RLS bajo el dueño con bypass.

## Comandos y límites

`node_modules\\.bin\\tsx.cmd scripts/migration-manifest.ts --env-file .env --url-key DATABASE_URL` y equivalente `.env.test/TEST_DATABASE_URL`, ambos exit 0, `NODE_OPTIONS=--use-system-ca` sólo en el proceso. El sandbox impidió iniciar tsx (`uv_os_get_passwd`); los diagnósticos se ejecutaron fuera con autorización. Neon pooler rechazó opciones de arranque (08P01); la versión final fija READ ONLY y timeout dentro de la transacción.

Unitarias de clasificación: **6/6** (RED por módulo ausente; GREEN inicial 5/5, luego 6/6 al distinguir LF/CRLF). Lint de script y pruebas sin errores. La comparación de existencia no certifica tipos/defaults/FK/enums ni los datos fiscales. OPS-01 cierra la preparación local de este lote, con divergencias explícitas; no cierra OPS-02/03 ni una puerta de fase.

## Checkpoint de los incrementos

- Regresiones de API/pago de aguinaldo: **34/34, exit 0** (`pnpm.cmd run test:unit tests/unit/aguinaldo-api.test.ts tests/unit/aguinaldo-payment.test.ts`).
- TypeScript: `pnpm.cmd exec tsc --noEmit --incremental false`, **exit 0**; ejecutado tras el manifiesto y antes de crear el contrato puro DIA-01.
- Suite general: `pnpm.cmd run test:unit --maxWorkers=2`, **176 archivos aprobados / 1 fallido; 2211 passed / 19 failed / 1 skipped / 1 todo; exit 1**, [log](unit-checkpoint.log). Todos los fallos están en `tests/unit/inventory/production-fefo-db.test.ts`, archivo local preexistente que no se modificó. No se declara la suite verde, no se excluye el archivo y no se rebajan sus pruebas. Esta corrida no incluyó el contrato DIA-01, creado después de descubrirse la suite.
- Build restringido: **exit 1**, [log](build.log), por descargas de Geist/Geist Mono de Google Fonts. Reintento con acceso de red autorizado registrado por separado; ninguna verificación se omite ni se cambia la configuración de fuentes.
- Build final confirmado el **2026-10-27**: **exit 0**, TypeScript y **430/430 páginas**, [log](build-network-retry.log), `pnpm.cmd run build` con heap de 6144 MB sólo en el proceso. Incluye el módulo puro DIA-01. El cierre se confirmó al recuperar el resultado del proceso; no se repite la compilación ni se equipara con despliegue.
