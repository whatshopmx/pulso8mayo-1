# AGU-03B — Snapshot persistido y recibo único durante la ejecución

Continuación posterior: [AGU-03B.4 — recuperación desde autorización persistida](../AGU-03B-4/README.md). Este documento conserva el estado y la evidencia del incremento B.1/B.2/B.3.

2026-10-23. Base `bf2c386177ebec8a9e2bd411e6c6132980869e01` más cambios locales FIS/AGU/IMSS preexistentes. Incrementos B.1/B.2/B.3; B.4 y el padre siguen abiertos. No hay conexión a bases compartidas, timbres reales ni despliegue.

## Comportamiento

- B.1: contrato versionado de cabecera y empleado. Conserva empresa, sucursal seleccionada, actor, instante de autorización, fecha civil de pago, año causado, configuración, UMA/días y resultados completos del cálculo/retención. Valida identidades y RFC únicos, ámbito, centavos representables e invariantes bruto=exento+gravado y neto=bruto−deducciones; mantiene el bloqueo de subsidio sin acumulados. La copia no comparte referencias con la preview ni consulta datos vivos.
- B.2: migración generada con `pnpm.cmd db:generate --name=aguinaldo_snapshot`: `0122_aguinaldo_snapshot.sql`, después de la 0121 local de IMSS. Agrega dos columnas JSONB nullable y unicidad parcial `(run_id, user_id)` sólo para recibos con snapshot. No altera recibos históricos ni infiere autorizaciones antiguas. SQL revisado: dos ADD COLUMN y un CREATE UNIQUE INDEX; sin DROP.
- B.3: una transacción guarda corrida y todos los recibos PENDIENTE antes del primer contacto al proveedor. Si un snapshot falla, no queda corrida ni se solicitan folios. El proveedor recibe los datos retornados por la persistencia; salario, reglas y configuración no se releen después para determinar esos importes. La cuenta empresa/año conserva su índice único y el conflicto durante el INSERT se traduce al error de duplicado existente.
- El recibo pendiente se actualiza en su misma fila. El error conserva bruto/ISR y el neto del snapshot; no inserta otro recibo ERROR. RECHAZADO/PENDIENTE/ERROR y TIMBRADO sin UUID no son éxito. Un fallo de bitácora posterior no degrada el timbre confirmado y produce un solo resultado por empleado.
- La consulta del contrato activo incluye `employee_contracts.company_id`: un contrato de otra empresa no autoriza salario ni duplica la plantilla.

El snapshot es la autorización de la ejecución que el servidor recalculó en el preflight. No introduce un token de aprobación de la preview del navegador ni garantiza detección de cambios ocurridos entre GET y POST. Tampoco convierte el registro de excedente en evidencia de pago bancario (revisión AGU-04 pendiente).

## Pruebas realizadas

- RED contrato: módulo aún inexistente; GREEN: 16/16 casos, incluidos cero manual, independencia de referencias, fechas imposibles, duplicados e importes inconsistentes.
- RED almacenamiento: 2 fallos por ausencia de columnas/migración; GREEN: 2/2 en PGlite, con SQL generado aplicado, recibos históricos duplicados preservados e índice parcial efectivo.
- RED servicio: 7 fallos / 21 aprobadas. GREEN: 28/28, cubriendo persistencia previa al proveedor, rollback, estados sin timbre, excepción y fallo de bitácora.
- Recorrido SQL real en PGlite con proveedor/fuentes fiscales/configuración simulados: 5/5. Comprueba dos empleados pendientes antes del proveedor, mutación posterior de datos vivos, rollback inducido por trigger, fallo de bitácora, dos empresas, repetición empresa/año y contrato ajeno. La prueba adicional de contrato ajeno falló antes de acotar el JOIN; tras corregirlo, servicio+DB 33/33.
- TypeScript: `pnpm.cmd exec tsc --noEmit --incremental false`, exit 0. Build final vuelve a incluir su comprobación de tipos.
- Lint focalizado: exit 0; 3 warnings preexistentes de imports en schema.ts, cero errores. Los módulos y pruebas nuevos no añaden warnings.
- Revisión con la skill code-review-and-quality: recorrido de éxito/error, persistencia previa al PAC, aislamiento de contrato y conservación de timbre; sin delegación ni cambios ajenos.

Suite completa: `pnpm.cmd run test:unit --maxWorkers=2`, 166 archivos / 2034 aprobadas, 1 skipped y 1 todo preexistentes, exit 0 (321 s). [Resultado](unit.json) y [log](unit.log). Incluye los cambios locales previos, sin excluir pruebas.

El primer build falló al descargar Geist/Geist Mono desde Google Fonts en el sandbox: exit 1, [resultado](build.json) y [log](build.log). El reintento con escalación aprobada terminó con **exit 0**, incluyendo TypeScript y generación de páginas, sin cambiar el código ni sustituir las fuentes: [resultado final](build-retry.json) y [log final](build-retry.log). Heap de 6144 MB sólo en el proceso del build.

## Límites y continuidad

AGU-03B.4 conserva la recuperación explícita del run parcial: bloquear ejecuciones concurrentes, reutilizar el timbre confirmado, recuperar bitácora sin duplicarla, definir qué hacer con respuesta incierta/caída entre PAC y persistencia y exponer recuperación en API/UI. Por ahora repetir una corrida existente sigue devolviendo conflicto y nunca reconstruye su autorización desde datos actuales. Una excepción del proveedor conserva ERROR local; ese estado no prueba que el PAC no haya emitido el CFDI.

AGU-03C conserva V2 completo: Postgres del entorno aislado, rol runtime/RLS, pool y actores concurrentes, fallos antes/después del timbre y recuperación. PGlite con DDL mínimo acredita el SQL y el flujo local, no RLS, todas las FK del esquema completo, concurrencia de conexiones ni sandbox fiscal real.

La migración queda pendiente de OPS-01/03 y debe acompañar al código antes de habilitarlo en un entorno con DB. No se ejecutó `db:migrate` ni `db:push`. Los cambios previos comparten schema, journal, servicio y tests: se conservan sin crear un commit que los mezcle.

Referencias de implementación consultadas: [transacciones Drizzle](https://orm.drizzle.team/docs/transactions), [UPDATE RETURNING](https://orm.drizzle.team/docs/update). No se modificaron reglas fiscales ni criterios legales en este incremento.
