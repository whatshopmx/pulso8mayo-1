# AGU-03C.1 — Recuperación sobre conexiones Postgres independientes

2026-10-26. Base `534c5a8`. Incremento de aceptación de la implementación existente, sin cambios a servicios productivos. Al iniciar había cambios locales en `tasks/todo-lotes-fefo.md` y `tests/unit/inventory/production-fefo-db.test.ts`; se conservaron.

## Alcance y resultado

`tests/integration/aguinaldo-recovery-db.test.ts`: **9/9, exit 0**, [log](integration.log). Ejecución con `pnpm.cmd run test:integration tests/integration/aguinaldo-recovery-db.test.ts`, `NODE_OPTIONS=--use-system-ca` sólo en el proceso. Primer recorrido de seis escenarios: 6/6; se añadieron tres comprobaciones y el recorrido final fue 9/9. No se presenta un RED de producto: estas pruebas amplían aceptación de comportamiento ya implementado.

- Dos actores reciben adaptadores Drizzle mediante AsyncLocalStorage; cada uno tiene su propio pool Neon WebSocket de tamaño 1. El arranque comprueba distintos `pg_backend_pid()` y el esquema privado de ambas conexiones.
- Caída al actualizar recibo después de persistir el timbre: dos recuperadores conservan el ID y snapshot del recibo, reutilizan un solo folio y producen una sola bitácora con el actor autorizador.
- PAC detenido con una barrera controlada: una consulta usa el mismo pool max=1 durante la espera, acreditando que no se retiene su conexión. El segundo actor observa la intención pendiente y no emite. Tras liberar la respuesta, la recuperación termina sin duplicar envío.
- Respuesta perdida: otro actor conserva el estado incierto y no repite el envío. No se crea bitácora de pago.
- Configuración fiscal ausente antes del fetch: no hay envío y, al corregirse, otro actor completa un solo folio.
- Snapshots con gravado o neto inconsistente: rechazo antes de crear intención o llamar al proveedor.
- Fallos de bitácora y de cierre posteriores a la persistencia del recibo: recuperación conserva recibo/UUID/importes y no pide otro folio.
- Dos empresas con igual RFC/período reciben folios distintos; recuperar la corrida de la otra empresa se rechaza. Se conservan bruto 900000, exento 339420, gravado 560580, deducciones 119731 y neto 780269 centavos; año causado 2025 y pago 2026-01-31. Los importes vienen del oráculo previo de AGU-03A, sin recalcular expectativas con código productivo.

## Aislamiento

Sólo se usa `TEST_DATABASE_URL` de `.env.test`, comprobada distinta de la URL operativa sin imprimir credenciales. Se crea un esquema aleatorio `agu03c_<uuid>` y se elimina al terminar. Las cuatro tablas se clonan con `LIKE public.<tabla> INCLUDING ALL`: conservan tipos/defaults/índices; no copian datos, FK ni políticas RLS. Si 0122 está pendiente, las columnas e índice de snapshots se añaden únicamente a la copia privada. No se aplican migraciones al esquema público ni se aprovisionan roles.

El servicio de recuperación, el servicio fiscal y el protocolo durable son reales; se simulan únicamente el transporte HTTP al PAC y los certificados/personas SAT. No se emiten CFDI reales ni se envían mensajes. Los fallos de persistencia se inducen con triggers privados. El esquema y sus triggers/tablas se eliminan en `afterAll`, también si falla un escenario.

El primer intento falló antes de crear el esquema por `unable to verify the first certificate`; se reprodujo fuera del sandbox. Node 22 admite el almacén de certificados del sistema: `--use-system-ca` resolvió la conexión, sin desactivar TLS ni cambiar configuración persistente.

## Controles globales

- Lint del archivo nuevo: `pnpm.cmd exec eslint tests/integration/aguinaldo-recovery-db.test.ts`, **exit 0**, [log](lint.log).
- Suite completa: `pnpm.cmd run test:unit --maxWorkers=2`, **175 archivos aprobados / 1 fallido; 2205 pruebas aprobadas / 19 fallidas / 1 skipped / 1 todo; exit 1**, [log](unit.log). Los 19 fallos se concentran en `tests/unit/inventory/production-fefo-db.test.ts`, archivo local sin seguimiento que ya existía antes del incremento y no se modificó. La suite completa no se declara verde. El archivo de integración nuevo no entra en el glob unitario.
- Build inicial: **exit 1** al descargar Geist/Geist Mono desde Google Fonts, [log](build.log). Reintento autorizado con acceso de red registrado por separado; no se modifican fuentes ni configuración del producto para evitar esa comprobación.
- Build final con TypeScript y 430 páginas: **exit 0**, [log](build-network-retry.log), `pnpm.cmd run build` con heap de 6144 MB sólo en el proceso. El log incluye avisos de renderizado dinámico durante la generación; no impidieron terminar el build. No se repitieron las pruebas tras cambios exclusivamente documentales.
- Revisión del incremento: sólo prueba de aceptación, tracker y evidencia; aislamiento de esquema, incertidumbre fiscal, exclusión de conexiones, conservación del snapshot y ausencia de modificaciones a FEFO. `git diff --check` sin errores.

## Límites y siguientes incrementos

AGU-03C permanece abierto. C.2 debe comprobar preview→autorización→ejecución inicial con fuentes aisladas y carreras de autorización. C.3 debe acreditar rol runtime, RLS y contexto HTTP/job después de OPS-02.nomina; las conexiones aquí usan el rol de pruebas y tablas privadas sin RLS. No acredita migraciones aplicadas al entorno objetivo ni despliegue. La conciliación de subsidio/acumulados reales de AGU-02C sigue pendiente y su protección permanece activa.

La bitácora de excedente conserva su carácter de autorización; esta aceptación no la equipara con pago o conciliación bancaria.
