# INV-01.c.recovery.subject.access — Adjuntos con sesión y alcance

Continuación 2026-11-13/14, HEAD inicial `5a05fb992c813031cacf4209a1bc37e525e56931` más diff compartido. Cinco archivos: `lib/services/sale-recovery-attachments.ts`, ruta `app/api/inventory/sales-entry/recovery-evidence/route.ts` y sus pruebas unitarias de servicio/ruta y SQL. No cambia auth, roles, grants, schema, ventas ni stock. 0144 ya está aplicada únicamente al enum de la rama aislada; main sigue pendiente.

## Comportamiento

Fachada específica de recuperación: obtiene `requireAuth` del servidor y exige `inventory:manage` para alta, URL y baja. Empresa/actor vienen de sesión; gerente requiere sucursal asignada y exactamente concordante con la pedida. No se amplía el store legacy, que sigue sin admitir cargas SALE_RECOVERY sin estas guardias. Cada operación usa contexto de tenant y WHERE explícito, incluso ante una conexión dueña. La venta se vincula a su empresa/sucursal y a la sucursal real; lectura/baja también cruzan la fila canónica de evidencia, sin aceptar GENERAL o entidad lateral.

Carga con bytes de hasta 20 MiB, MIME permitido y clave privada generada por servidor que incluye empresa/sucursal/venta/UUID del adjunto. Buffer clonado antes de I/O, actor persistido desde sesión, sin URL o flags de autoridad de cliente ni fallback local. Se comprueba sujeto antes de llamar R2. El valor de retorno del proveedor no decide la key guardada. Se mantiene el lock de lectura de la venta durante la carga y se inserta el adjunto en la misma transacción de contexto. Fallo de storage impide insertar; fallo SQL impide publicar referencia. Una subida remota completada antes de un fallo/resultado incierto de commit puede dejar un objeto privado huérfano; no se borra automáticamente ante commit incierto ni se declara atomicidad distribuida entre R2 y SQL.

URL: lookup por ID/empresa/sucursal/tipo/sujeto vivo; key con prefijo propio y UUID final; se firma por 600 segundos después del control de acceso. URL antigua o externa nunca se firma. DELETE es baja lógica del adjunto con lock; no borra el objeto. URLs emitidas antes de una baja conservan el TTL que ya tenían. La reparación futura debe volver a verificar registros vivos antes de aplicar.

POST multipart devuelve solo metadata del adjunto (201), GET devuelve URL con `Cache-Control: private, no-store`, DELETE acepta referencia JSON y retira lógicamente. El wrapper de sesión/capacidad corre antes de consumir body. Límite real de stream: 21 MiB para el contenedor multipart y 4096 bytes para JSON; límite del archivo 20 MiB, campos duplicados/desconocidos rechazados y stream excedido cancelado. La validación del servicio también rechaza campos de autoridad si se invoca fuera de HTTP.

## Verificación

RED de servicio y ruta: imports inexistentes antes de implementarlos. 4 unitarias del servicio más 5 de ruta pasaron tras implementar. Tests HTTP usan Request/Response y multipart/stream reales, con wrapper `withTenantAuth` real, sesión simulada y servicio simulado: no son un servidor HTTP desplegado. Prueban denegación antes de leer body, tamaño declarado y stream, bytes/id enviados al servicio, campos de autoridad, URL sin caché, 404 y JSON inválido.

SQL real con `SET LOCAL ROLE pulso_app` NOBYPASSRLS/NOSUPERUSER, sesión y proveedor R2 simulados, dos empresas/tres sucursales. Cubre clave/actor del servidor, validación de venta y sucursal antes de subir, ADMIN sin acceso a empresa ajena, lectura/baja lateral, rechazo de GENERAL/entidad corrupta/key externa, lectura de fila preexistente, baja lógica y relectura 404, error R2 y fallo SQL posterior a subir con rollback. Cada fixture se revierte y se comprueba ausencia posterior de las empresas. No se hacen llamadas reales a R2.

La primera preparación de fixtures falló por campos obligatorios del usuario sintético; se corrigió el fixture sin tocar producción. Después, dos comprobaciones de conservación de venta fallaron porque el rollback del savepoint restauraba el contexto previo vacío y RLS devolvía cero filas. Se fijó contexto explícito para esas comprobaciones, de modo que su ausencia no pueda dar un falso positivo; el servicio no necesitó cambiar. Cinco SQL pasaron y luego se añadió el caso de fila preexistente; resultados finales en `results.json`.

## Límites y continuación

La carga conserva procedencia técnica, pero no atestigua propósito SALE/RECIPE_VERSION/NO_PRIOR_CONSUMPTION, veracidad, snapshot histórico o consumo cero. Faltan atestaciones y su autoridad, registro/aprobación del expediente desde servidor, writer auditado/idempotente, carreras y recorrido visible. No se acepta INV-01.c, INV-01.b ni 11.11 por estas rutas. Persistencia/filtros SQL con R2 simulado no acreditan objetos privados reales, sesión real end-to-end, despliegue ni V3 de UI. El build del hito con catálogo/acceso se verifica por separado del build anterior del writer.


## Resultado actual

46/46 unitarias en siete archivos, 13/13 SQL en dos archivos (seis nuevas, siete de persistencia), TypeScript global y lint de los cinco archivos: exit 0. Trazabilidad: 239 filas, 84 hijos, 15 aceptaciones, cero errores; diff check exit 0. Build con heap 4 GB y red autorizada terminado exit 0, resultado terminal de sesión 5137, log `build.txt`. La compilación de este hito precede el modelo de atestaciones 0145: no se usa para acreditarlo. El hijo conserva estado código implementado; pruebas SQL con auth/R2 simulados no se usan como V2 integrada completa. La auditoría crítica de cambios de adjuntos y de recuperación sigue pendiente de AUD-02 antes de aceptación operativa.
