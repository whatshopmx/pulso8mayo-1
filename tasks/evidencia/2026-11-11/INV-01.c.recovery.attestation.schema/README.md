# INV-01.c.recovery.attestation.schema — Atestaciones documentales inmutables

Continuación 2026-11-14. HEAD/diff y hashes finales en `results.json`. Scope de cinco archivos: `lib/db/schema.ts`, SQL `0145_inv01c_recovery_attestations.sql`, snapshot 0145, journal y `tests/integration/sale-recovery-attestations-schema-db.test.ts`. Sin cambios en servicio de carga, auth, roles, grants de tablas existentes, ventas o stock.

## Modelo

`sale_recovery_attestations` liga un hecho de revisión a evidencia SALE_RECOVERY, venta legada, empresa y sucursal. Guarda clave idempotente por empresa, finalidad SALE/RECIPE_VERSION/NO_PRIOR_CONSUMPTION, key exacta del objeto propio, hash SHA-256 y tamaño de 1 a 20 MiB, referencia de procedencia, motivo, verificador/rol declarado y fecha finita. Verificador tiene FK a usuario existente; el rol registrado solo admite ADMIN/OWNER/SUPER_ADMIN. `verified_at` usa reloj de PostgreSQL al insertar (`clock_timestamp()`), no el inicio de una transacción larga.

`evidence_updated_at` se copia nativamente desde la fila observada: el INSERT del servicio debe conservarla con SQL, sin convertirla a Date de JavaScript que trunca microsegundos. WITH CHECK exige que siga coincidiendo con la fila viva, del mismo sujeto/empresa/sucursal, con key concordante, actor igual al contexto y fecha de verificación no anterior a creación/actualización del adjunto (timestamps legacy interpretados como UTC).

RLS habilitada y forzada: sin contexto no lee; scope de empresa/sucursal para lecturas y altas. Actor de contexto obligatorio al insertar. Mínimo SELECT/INSERT para runtime existente; sin UPDATE/DELETE/TRUNCATE. Trigger append-only también bloquea reescritura por dueño ordinario. Una baja posterior del adjunto conserva la atestación histórica: no se reescribe ni desaparece de auditoría. Su uso operativo deberá volver a consultar evidencia viva y estado observado, no asumir validez por encontrar la fila histórica.

## Pruebas y entorno

RED: falló la guardia de migración ausente antes de consultar o escribir DB. Tras generar con `pnpm.cmd exec drizzle-kit generate --name inv01c_recovery_attestations`, añadir FORCE RLS, trigger y privilegios mínimos, **5/5 SQL pasaron** en 45.40 s, exit 0. Se añadió después la comprobación de historial conservado tras baja y de key externa; controles finales en `results.json`.

Base aislada existente `soft-cloud-50478212`, rama `br-round-voice-belheola`, host fijado y distinto de `.env`; `pulso_app` comprobado NOSUPERUSER/NOBYPASSRLS. Cada caso crea migración completa y fixtures de dos empresas/tres sucursales en una transacción, ejecuta runtime con SET LOCAL ROLE y provoca rollback. Después se comprueba que la tabla nueva y las empresas sintéticas no existan. **0145 no se aplica de forma persistente a la rama aislada ni a main.**

Casos: tres finalidades y precisión temporal nativa, RLS sin WHERE/sin contexto/por sucursal y empresa, rol runtime mínimo, falta o suplantación de actor en contexto, sujeto/sucursal/empresa ajenos, key externa/estado observado cambiado, GENERAL y adjunto retirado, hash/tamaño/finalidad/rol/referencia/motivo/fecha inválidos, idempotencia duplicada, UPDATE/DELETE como runtime y dueño, preservación del hecho histórico tras retiro del adjunto.

## Límites y siguiente incremento

Esta tabla no descarga archivos ni acredita por sí sola su contenido, veracidad, origen histórico o la autoridad real del verificador. Las pruebas insertan hash/tamaño/rol sintéticos para comprobar invariantes SQL. El GUC del actor es contexto de aplicación, no una sesión autenticada: el servicio debe obtener sesión y capacidad/rol reales del servidor, descargar el objeto privado con límites, calcular SHA-256 y tamaño de bytes, exigir motivo/procedencia y persistir el hecho idempotentemente bajo lock. Un rol declarado ADMIN en un DTO o una lista vacía de movimientos no prueban consumo cero.

La finalidad no es aprobación de recuperación ni consumo aplicado. El servicio/rutas y autoridad se implementaron después en [attestation.service](../INV-01.c.recovery.attestation.service/README.md); conservan pendientes HTTP/objetos reales. Faltan bundle de receta/unidades históricas demostrado, preparación/registro de expediente desde servidor, revisión independiente y aplicación auditada/idempotente con revalidación bajo lock. Auditoría crítica y aceptación HTTP/UI/objetos reales siguen pendientes. No acepta INV-01.c.recovery, INV-01.c ni 11.11. El build previo del catálogo/acceso terminado exit 0 no se atribuye a este modelo añadido después de compilarlo.


### Cierre de esta continuación

Regresión: 38/38 unitarias y 18/18 SQL; TypeScript del modelo y lint exit 0. Trazabilidad: 239 filas, 86 hijos, 15 aceptados, cero errores; diff --check exit 0. El gate global actual falla en Tesorería concurrente (`treasury-service.ts:726`, TS2345); no se ejecuta ni acredita build nuevo. Código implementado, sin aceptación. Comandos reproducibles, hashes, logs y límites en [results.json](results.json).
