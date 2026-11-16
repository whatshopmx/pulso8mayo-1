# INV-01.c.recovery.objects — Integridad de objetos privados

Continuación 2026-11-13. HEAD inicial `5a05fb992c813031cacf4209a1bc37e525e56931` más diff compartido previo. Scope de cuatro archivos: servicio `sale-recovery-evidence.ts`, cliente `lib/storage/r2-client.ts` y pruebas `sale-recovery-evidence.test.ts`/`sale-recovery-storage.test.ts`. Sin migraciones ni escrituras de datos. Se conserva trabajo de otras sesiones sin commit automático.

El lector valida el lote completo antes de I/O (1–100 referencias, UUIDs únicos, hashes SHA-256, claves privadas de la empresa sin URLs, segmentos vacíos, puntos ni traversal). Clona las referencias antes de esperar I/O. Descarga los bytes mediante el cliente R2 existente y calcula SHA-256; no usa ETag, metadata de IA ni una bandera de verificación como prueba de contenido. Devuelve referencias verificadas y tamaño únicamente si todas las descargas coinciden. Objeto vacío, ausente, alterado o error bloquea el lote completo sin resultado parcial.

El cliente conserva su firma compatible y admite límites opcionales: para recuperación se usan 20 MiB por objeto y 15 segundos, con AbortSignal del SDK. La lectura deja de acumular chunks al exceder el límite, aborta y cierra el iterador; limpia el timer al finalizar. No usa enlaces públicos, presignados ni fallback local. El consumidor debe cargar referencias desde registros propios acotados, comprobar estado vigente y vincularlas al hash del expediente con el contrato existente.

## Verificación local

RED: la nueva prueba falló por módulo inexistente. GREEN: 62/62 pruebas en cinco archivos con `pnpm.cmd exec vitest run --configLoader bundle lib/services/__tests__/sale-recovery-storage.test.ts lib/services/__tests__/sale-recovery-evidence.test.ts lib/services/__tests__/sale-recovery-review.test.ts lib/services/__tests__/sale-consumption-snapshot.test.ts lib/services/__tests__/sale-consumption-contract.test.ts --maxWorkers=1 --pool=threads`, exit 0. Ocho pruebas nuevas; R2 simulado en memoria, sin acceso a secretos ni servicios externos.

Casos: SHA-256 de bytes y clave exacta, lote vacío/duplicado/ajeno antes de descarga, ausencia/vacío/alteración/exceso/error, mutación del input durante I/O, rechazo de resultado parcial, lectura previa sin opciones, límite exacto, cierre del stream con abort, timeout SDK y límites inválidos antes de I/O. Tipos, lint, build y trazabilidad se registran al cierre en `results.json`.

Estado de verificación: TypeScript global exit 0; lint focal exit 0 con una advertencia previa en `fileExistsInR2`; diff check exit 0; validador documental exit 0 (239 filas, 81 hijos, cero errores). El primer build falló exclusivamente al descargar Geist/Geist Mono de Google Fonts (`build.txt`). El reintento con red autorizada terminó con exit 0 (`build-network.txt`), comprobado al continuar la sesión 47236. Dos intentos del validador durante compilación dieron ENOMEM; el intento posterior pasó.

## Límites y siguiente paso

V2 pendiente con objetos privados reales y credenciales del entorno aislado. No se afirma aceptación operativa. Integridad de bytes no demuestra veracidad del documento, inexistencia de consumo previo, pertenencia del registro a sucursal/venta, identidad del verificador ni aprobación administrativa. La función no se expone por HTTP ni habilita la reparación. Faltan modelo persistido y políticas de aislamiento del expediente/decisión, carga desde DB con sesión/capacidad, revisión independiente y writer auditado idempotente que revalide bajo lock. INV-01.c.recovery, INV-01.c y 11.11 siguen abiertos.
