# FEFO-04B-1 — Consulta común con alcance y bloqueo

Fecha: 2026-10-26. Dependencias: FEFO-04A y cierre de FEFO-03/Checkpoint 1 en `14865f7`. Incremento de cinco archivos como máximo: allocator, prueba, plan, checklist y esta evidencia. No modifica todavía consumidores operativos.

## Implementación

`allocateScopedBatches` en `lib/services/fefo-allocator.ts` conecta el motor puro a Drizzle. Recibe empresa, sucursal, producto, cantidad y opcionalmente ID de lote. Valida alcance/cantidad antes de consultar; une producto y sucursal y exige que ambos pertenezcan a la empresa indicada. Filtra AVAILABLE y saldo positivo. Para lote explícito restringe el ID en SQL y mantiene las mismas guardas.

La consulta toma `FOR UPDATE OF inventory_batches`, en orden de ID, para no bloquear también las filas de catálogo/sucursales por el join. Luego el motor aplica FEFO, conserva cuatro decimales y devuelve requerido/asignado/faltante. El reloj se vuelve a tomar **después** del await de la consulta: no conserva como autoridad el instante anterior a una posible espera de bloqueo.

El objeto de entrada no controla reloj ni política. Se extraen sólo los campos declarados. Hasta contar con políticas persistidas de FEFO-10A, la política efectiva desconocida usa FEFO y exige fecha; no hay un argumento NONE que pueda enviarse desde cliente para habilitar lotes sin fecha. FIFO y fecha nula explícitamente permitida siguen disponibles en el motor puro para su futura resolución autorizada.

## Pruebas y revisión

- RED: `pnpm run test:unit tests/unit/inventory/fefo-allocator-db.test.ts --maxWorkers=1` falló por función todavía inexistente, antes de escribirla. Se reforzó la aserción de cantidad inválida para exigir su mensaje específico y no aceptar un error cualquiera.
- `pnpm run test:unit tests/unit/inventory/fefo-allocator-db.test.ts tests/unit/inventory/batch-allocation-policy.test.ts --maxWorkers=1`: **47/47 aprobadas**, código 0. Son 15 pruebas nuevas con Drizzle/PGlite y las 32 del motor puro, incluida conservación de 300 repartos generados.
- Casos SQL: FEFO inverso a recepción, desempates completos, estados bloqueados/nulo, vencido AVAILABLE con cron detenido, instante igual al límite, fecha nula, alcance de empresa/producto/sucursal, referencias cruzadas/huérfanas, lote explícito sin sustitución, saldos negativos, fracciones/faltantes sin escrituras, política/reloj extra ignorados y validación anterior a la consulta.
- El logger de prueba adelanta el reloj al despachar la consulta con cláusula de bloqueo; el lote que vence durante ese intervalo se excluye. Esto demuestra que se usa el reloj posterior a la consulta, **no** una carrera entre dos conexiones ni espera real de un lock competidor.
- Se observa la cláusula de bloqueo solicitada y se confirma que planificar no emite INSERT/UPDATE/DELETE ni cambia saldos. PGlite ejecuta SQL real; sólo se relajan constraints del fixture para sembrar relaciones corruptas. No conecta a DATABASE_URL.
- `pnpm exec eslint lib/services/fefo-allocator.ts tests/unit/inventory/fefo-allocator-db.test.ts`: código 0, sin salida.
- `pnpm run test:unit --maxWorkers=1 --reporter=dot`: **174 archivos aprobados, 2,176 pruebas pasadas, 1 skipped y 1 todo preexistentes**, código 0; duración 293.44 s. Incluye los 47 casos nuevos de motor/consulta sin nuevas exclusiones.
- Build posterior a la implementación: `$env:NODE_OPTIONS='--max-old-space-size=3072'; pnpm run build`, con acceso de red autorizado: **código 0**, TypeScript aprobado y **430/430 páginas** generadas. Compilación: 3.5 minutos. Se ejecutó después de finalizar la suite general, sin otros builds/suites propios en paralelo. Conserva los avisos de `fetchConnectionCache` y ruta dinámica de documentos ya descritos en FEFO-03B; no se omitieron verificaciones.
- `git diff --check`: código 0; Git avisa de normalización LF/CRLF.
- Revisión separada por otro agente, conforme a `code-review-and-quality`: sin hallazgos accionables.

## Límites e integración siguiente

El allocator anterior `allocateFEFO` conserva sus consumidores hasta migrarlos por recorrido. Esta nueva consulta aún no corrige las salidas reales. FEFO-04B-2 migrará el envío automático y explícito de transferencias; FEFO-04B-3 hará lo propio con producción; FEFO-04B-4 migrará consumo teórico y retirará el allocator anterior cuando no queden usos.

Quien descuente debe pasar la misma transacción que escribirá saldo/movimiento y rechazar el faltante físico; con `db` directo el lock sólo dura la consulta y el resultado sólo sirve de preview. FEFO-05A probará concurrencia entre conexiones e idempotencia. Los faltantes teóricos sin DUMMY-NEG siguen en FEFO-05C. No se aplicaron migraciones, conciliaciones, despliegues ni operaciones sobre inventario real.
