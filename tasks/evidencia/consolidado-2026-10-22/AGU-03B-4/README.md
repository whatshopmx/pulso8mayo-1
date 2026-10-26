# AGU-03B.4 — Recuperación desde autorización persistida

2026-10-23 (fecha local; logs UTC del 24-oct). Base `bf2c386` + FIS/AGU/IMSS locales conservados. Incrementos 4A/4B/4C. Sin proveedores reales, datos compartidos, migraciones nuevas ni despliegue.

## Protocolo fiscal (4A)

- Los períodos `AAAA-AGU` usan una intención durable en la tabla fiscal existente antes de contactar al PAC. La huella SHA-256 cubre la solicitud, excepto el actor; conserva fecha, RFC, importes y conceptos. Una adquisición atómica por empresa/RFC/período permite un solo envío entre actores concurrentes.
- La respuesta se guarda con el ID del intento que la originó. Un timbre confirmado con la misma huella se reutiliza; una huella distinta o ausente requiere conciliación. Las filas legacy no se equiparan a una autorización nueva.
- Timeout, error de red, HTTP no exitoso, respuesta sin UUID, total emitido distinto, duplicado o `succeeded:false` genérico quedan pendientes. La intención no caduca por tiempo y reintentar no vuelve a enviar. En aguinaldo nunca se cambia de serie para evadir el dedup del proveedor.
- Se permite otro envío sólo tras una falla local anterior al fetch (configuración/payload) o rechazo explícito del PAC sin folio/ID. La solicitud debe conservar su huella. La nómina ordinaria conserva el circuito previo; su endurecimiento general no se declara terminado aquí.

## Recuperación de corrida (4B)

- Ejecución inicial y recuperación consumen el mismo servicio y los mismos snapshots persistidos; no consultan salarios, asistencias ni reglas actuales. Conservan fecha de pago, año causado, actor de autorización y centavos. El actor que recupera queda sujeto al permiso/auditoría de la API.
- Los recibos confirmados no vuelven al PAC. Si el timbre se guardó en la tabla fiscal pero falló la actualización del recibo, se recupera desde ese registro sin solicitar otro folio.
- La actualización del recibo y la comprobación/inserción de bitácora usan transacciones breves con bloqueo de la corrida de la empresa. Ninguna transacción permanece abierta frente al PAC. Un recibo confirmado nunca se degrada por una respuesta atrasada o un fallo de bitácora.
- Antes de insertar la bitácora RUN se comprueba empresa/corrida/empleado bajo el mismo bloqueo. Se reutiliza una entrada existente con igual importe; duplicados o diferencias existentes se detienen para conciliación, sin borrarlos. El texto nuevo identifica autorización, sin afirmar que ya se pagó.
- El estado final se calcula desde las filas actuales bajo bloqueo, incluyendo la bitácora necesaria. Dos actores no cierran a partir de resultados locales obsoletos.
- Las nuevas cabeceras incorporan `deliveryVersion:1`. Un recibo no confirmado de una corrida anterior no puede iniciar otro envío automáticamente: ERROR legacy no prueba que el PAC no haya emitido. Los recibos legacy ya confirmados sí pueden completar su bitácora desde el snapshot.

## API y pantalla (4C)

- POST `/api/payroll/aguinaldo` con `{action:"RECOVER", runId}`. Payload estricto: no admite fecha, empresa ni overrides. `reports:manage` FINANCIAL y empresa salen de la sesión; corrida ajena y autorización ausente/inconsistente se rechazan. Las acciones existentes mantienen su contrato.
- El historial muestra la fecha autorizada y permite recuperar corridas incompletas con snapshot. La recuperación funciona aunque la preview fiscal actual esté bloqueada. Se deshabilita durante la petición y muestra errores por empleado en una región de estado; el mensaje incierto pide conciliar antes de emitir otro.
- Diseño existente conservado; Impeccable sin hallazgos mecánicos. Navegador con componente real, API simulada, teclado, estado pendiente y anchos 320/768/1440; ninguna emisión fiscal real.

## Verificación

- Protocolo SQL: 4/4 en PGlite, incluyendo adquisición concurrente y respuesta perdida.
- Servicio fiscal real con HTTP simulado: 8/8. RED anterior a integración: 5 fallos por reenvío, cambio de serie o reutilización sin comparar solicitud.
- Ejecución/recuperación con SQL real: 11/11. Incluye caída al cerrar después de persistir recibos, dos actores recuperando bitácora, dos empresas, bloqueo legacy, caída tras timbre durable y timeout con un segundo empleado confirmado. En los dos últimos casos se usa el servicio fiscal real con HTTP simulado, sin mocks del protocolo durable.
- Consumidor previo: 28/28. API: 18/18 (401/403, empresa de sesión, payload estricto y autorización inválida).
- Suite completa: **168 archivos / 2059 aprobadas**, 1 skipped y 1 todo preexistentes, exit 0. [Resultado](unit.json), [log](unit.log). Después sólo cambió el texto del contador de revisión y un comentario del servicio; confirmación visual final separada.
- `pnpm.cmd exec tsc --noEmit --incremental false`: exit 0. Lint focalizado de código/pruebas afectados: exit 0, sin errores ni warnings.
- Navegador inicial: RED por ausencia del control; GREEN 3/3 incluyendo regresiones previas. Una confirmación posterior falló por ENOENT del CSS cuando `next build` limpió `.next/static/chunks`; [fallo del harness](browser-css-setup-failed.log), sin atribuirlo al producto. Confirmación final secuencial: **3/3, exit 0**, [resultado](browser-final.json) y [log](browser-final.log). Capturas [desktop](browser-recovery.png) y [móvil](browser-recovery-mobile.png), inspeccionadas; botón dentro del ancho a 320/768/1440 px, teclado, petición pendiente y error visible sin preview.
- Build final con TypeScript y 426 páginas: **exit 0**, [resultado](build.json) y [log](build.log). Un build anterior también terminó exit 0; se repitió para incluir la corrección final del texto de revisión, conservando ambos resultados. Se verificó el texto final en el bundle compilado. Heap de 6144 MB sólo en el proceso; acceso a fuentes de Google fuera del sandbox con aprobación reutilizada.
- Revisión final: aislamiento de empresa, solicitud fiscal estable, estados sin evidencia, carreras de finalización y bitácora, y preservación del CFDI confirmado. Sin modificaciones a los frentes ajenos ni ampliación de reglas fiscales.

## Límites y entrega siguiente

Esta evidencia usa Postgres embebido con DDL mínimo y HTTP simulado. No acredita RLS/rol runtime, pool max=1, concurrencia de conexiones Postgres independientes ni sandbox fiscal real: AGU-03C conserva esa aceptación V2. Tampoco levanta la protección de subsidio/acumulados de AGU-02C.

Un envío incierto puede requerir consulta/conciliación externa con el PAC. Aquí queda detenido y visible; no se inventa una confirmación ni se añade un control para ignorarla. No se implementa sustitución/cancelación de CFDI ni cambiar una autorización ya emitida.

Para rollout: aplicar previamente la 0122 pendiente y drenar procesos con el ejecutor anterior antes de habilitar recuperación. La exclusión de bitácora requiere que todos los escritores RUN usen este protocolo; los registros históricos inconsistentes requieren revisión. RLS de nómina/tesorería sigue en OPS-02. La bitácora no equivale a pago ni conciliación bancaria; AGU-04 mantiene su revisión global.

Cambios locales sin commit para no mezclar avances preexistentes que comparten archivos. Referencias consultadas: [UPDATE/RETURNING Postgres](https://www.postgresql.org/docs/17/sql-update.html), [bloqueos de filas](https://www.postgresql.org/docs/17/explicit-locking.html), [transacciones Drizzle](https://orm.drizzle.team/docs/transactions).
