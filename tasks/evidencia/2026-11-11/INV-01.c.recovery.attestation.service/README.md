# INV-01.c.recovery.attestation.service — Verificación física y atestación administrativa

Continuación 2026-11-14. Cinco archivos: `lib/services/sale-recovery-attestations.ts`, `app/api/inventory/sales-entry/recovery-attestations/route.ts`, unitarias de servicio/ruta y SQL `sale-recovery-attestations-db.test.ts`. HEAD/diff y hashes de cierre en `results.json`. No modifica auth, roles, grants, adjuntos, ventas ni stock. Usa 0145 únicamente dentro de rollback aislado para V2 SQL; main no cambia.

## Contrato y autoridad

GET `recovery-attestations?branchId=...&evidenceId=...` es preview administrativo: devuelve venta real, ID/sucursal, SHA-256/tamaño calculados desde bytes y URL privada de 600 s, con `Cache-Control: private, no-store`. No persiste ni atestigua. El consumidor debe contrastar la venta devuelta con la venta elegida antes de presentar la revisión.

POST JSON recibe branchId, legacySaleId esperado, evidenceId, idempotencyKey, purpose, sourceReference, reason y expectedContentSha256. Requiere JSON real y limita el stream a 16 KiB antes de parsearlo. Campos desconocidos se rechazan, incluidos empresa, rol, verificador, hash de resultado, snapshot o bandera verified. Referencia/motivo se normalizan y limitan a 2000 caracteres. Respuestas del proyecto: 201 al crear, 200 al repetir, 400 DTO/header/JSON inválido, 401/403 sesión/autoridad, 404 fuente fuera del alcance/no viva, 409 hash/sujeto/estado/clave discordantes, 413 tamaño, 502/503 proveedor/almacenamiento, 500 fallo SQL controlado.

Wrapper real `withTenantAuth` comprueba sesión/empresa y la ruta aplica rol/capacidad del catálogo canónico antes de leer body. El tipo legacy de withRoleAuth omitía OWNER; la ruta no modifica ese contrato compartido y usa la misma comprobación canónica ADMIN/OWNER/SUPER_ADMIN + inventory:manage que el servicio. El servicio también obtiene `requireAuth`, copia los campos del actor y aplica `resolveBranchScope`. Ninguna autoridad sale del cuerpo. Empresa/actor/rol se fijan desde sesión del servidor. El lookup usa tipo SALE_RECOVERY, adjunto vivo y joins con venta y sucursal propias, incluso con conexión dueña; key exacta generada por el servidor, nunca URL de cliente o GENERAL. La venta esperada se comprueba antes de R2.

## Bytes, estado e idempotencia

Lectura con `getFromR2` limitado a 20 MiB/15 s, SHA-256 de bytes calculado con Node crypto y tamaño real. Null/vacío/exceso/error impiden persistir; hash esperado solo es control optimista y nunca sustituye la descarga. El preview no se convierte en aprobación ni el POST en consumo aplicado.

La transacción mantiene lock compartido del adjunto mientras lee/verifica/atestigua. INSERT SELECT conserva updatedAt nativo y vuelve a comprobar sujeto/scope/key/versión/tiempo, también si el pool usa dueño con bypass. Clave única por empresa, ON CONFLICT DO NOTHING y comprobación del hecho resultante. Una repetición idéntica devuelve ID, verificador, rol y fecha originales; vuelve a leer bytes y estado. Otro cuerpo/actor/hash/sujeto o un microsegundo de cambio requiere nueva atestación. El rol guardado captura la autorización del actor de la operación, no una propiedad elegida por cliente.

Un fallo después de INSERT revierte la atestación aunque el caller conserve su transacción. Se reproduce con trigger de fixture, sin hooks de producción. Antes de corregir, el error de DB arrastraba parámetros con nota/referencia: ahora el error del servicio es controlado y el log contiene solo namespace/SQLSTATE validado, sin query, parámetros ni texto documental. Esto no pretende regular logs internos del proveedor de DB.

## Verificación

RED de imports inexistentes de servicio y ruta; después 3 unitarias de autoridad/DTO y 4 de contrato HTTP pasaron. Al afinar la venta esperada se reprodujo el contrato previo que no admitía ese campo; ahora se valida contra el sujeto real antes de leer R2. La prueba de fallo post-INSERT falló con error SQL crudo antes de envolverlo y pasó después. Prueba SQL inicial del servicio: 4/4; final con fallo post-INSERT y sujeto esperado: 5/5, 58.77 s, exit 0.

SQL en `soft-cloud-50478212` / `br-round-voice-belheola`, host distinto de `.env`, rol `pulso_app` NOSUPERUSER/NOBYPASSRLS. DDL 0145 y fixtures de dos empresas/tres sucursales/administradores solo dentro de rollback, con ausencia de tabla/empresas después. Auth y R2 simulados; bytes de prueba `hello` contrastados contra SHA-256 conocido, no contra un helper de la implementación. Caso nativo 123456 microsegundos y diferencia de 1 microsegundo prueban que Date no sustituye la versión observada.

No son pruebas de sesión de navegador, servidor HTTP desplegado ni bucket real. Unitarias HTTP usan Request/Response, wrapper de rol real, sesión y servicio simulados. Controles finales de regresión/tipos/lint/build/trazabilidad en `results.json`.

## Límites

El actor registra que revisó esa finalidad/procedencia de esos bytes; el sistema verifica objeto/estado/autoridad de la llamada. No interpreta automáticamente la verdad del documento, no infiere consumo cero de una consulta vacía, no sustituye el bundle histórico de receta/unidades ni aprueba stock. Faltan preparación/registro del expediente desde servidor, revisión independiente y aplicación auditada/idempotente con carreras y revalidación, además de AUD-02, UI y V2 integrada con sesión/objetos reales. Ningún padre ni la fila 11.11 se aceptan por este servicio. El build anterior de adjuntos no se atribuye a este nuevo modelo/servicio.


### Cierre de esta continuación

Regresión: 53/53 unitarias; después 8/8 finales del servicio/ruta, con siete casos repetidos y uno nuevo OWNER. SQL: 23/23 en cuatro archivos; lint exit 0. Trazabilidad: 239 filas, 86 hijos, 15 aceptados, cero errores; diff --check exit 0. El gate global actual falla en Tesorería concurrente (`treasury-service.ts:726`, TS2345); no se ejecuta ni acredita build nuevo. Código implementado, sin aceptación. Comandos reproducibles, hashes, logs y límites en [results.json](results.json).
