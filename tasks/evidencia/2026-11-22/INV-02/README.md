# INV-02 — contrato de consumo por versión y vigencia

Base: `d05eae09d67ed0b190b6785da168a8fb8b564fd0` + árbol compartido. **En curso, sin aceptación dependiente**: contrato, schema, publicación, snapshot y writer cuentan con código, V1 local y ocho casos nativos independientes; faltan INV-01.c, integración histórica/recovery y activación externa revisada. No se habilitó consumo de elaborados ni se modificó stock externo. [V2 y límites](runtime.md); build final con tipos/455 páginas exit 0.

## Contrato implementado

`lib/services/recipe-consumption-policy.ts` define una política para empresa/receta, versión identificada por `recipe_versions.id` y día civil de inicio. El modo es excluyente:

- `INGREDIENTS_ON_SALE`: la venta expande insumos; no admite producto terminado en la misma definición.
- `FINISHED_PRODUCT_ON_SALE`: la venta consume un artículo elaborado identificado y su unidad; la producción será quien consuma insumos. Requiere ambos datos.

El resolvedor selecciona la vigencia `[effectiveFrom, siguiente effectiveFrom)` correspondiente al día de venta; el orden devuelto por la base no importa. Valida todo el conjunto, incluso futuras vigencias, para rechazar IDs duplicados, dos inicios el mismo día, mezcla de empresas/recetas y configuraciones incompletas. Sin cobertura explícita falla; no inventa consumo de ingredientes. Usa una copia para no mutar datos del lector ni el snapshot del caller.

El catálogo actual `recipe_versions` ya conserva fichas e ingredientes, pero no declara modo/vigencia. La demanda canónica actual expande subrecetas hasta insumos en `sale-consumption-snapshot.ts`; de ahí la necesidad del contrato antes de crear un lote terminado utilizable.

## Persistencia, conexión y pendientes de aceptación

1. **Código de persistencia implementado:** migración aditiva 0159 con FK de versión/receta/empresa y artículo propio, unicidad de inicio/versión, modo excluyente, FORCE RLS, grants mínimos y trigger append-only. [Evidencia SQL y límites](schema.md). Ocho casos nativos independientes sobre baseline vacía/0159/0160 comprobados; aplicación revisada sobre datos existentes y entorno operativo pendiente. No editar snapshots históricos ni asumir datos vacíos en una migración real.
2. **Publicador implementado:** controla retroactividad, comprueba versión/artículo/unidad propios y no confía en un JSON cliente. [Evidencia](publication.md). También protege padres de subrecetas mediante grafo actual y snapshots congelados. Dos carreras nativas con espera observada y rollback de auditoría comprobados; caracterización/migración explícita de históricos legacy sin definición archivada y aceptación dependiente pendientes.
3. **Lector/snapshot implementados:** misma transacción, política/versión/vigencia/demanda congeladas; sólo ficha archivada, sin mezclarla con contenido mutable. Una subreceta elaborada detiene expansión. [Evidencia](snapshot.md). V2 de raíz/subreceta y saldos por fecha comprobada en la baseline aislada; integración histórica/operativa pendiente.
4. **Writer conectado bajo activación del servidor:** corrección/anulación conserva demanda/asignaciones anteriores; nueva definición usa política publicada al habilitar el modo, sin fallback por falta de cobertura. Elaborado positivo bloqueado hasta PROD-01. Retirar la activación no permite degradar una receta publicada a mutable. [Evidencia y límites](apply.md). Regresión final 183/183; activación externa y aceptación dependiente pendientes.
5. Coordinación con PROD-01: alta del terminado y descuento de insumos en la misma transacción, vínculo único al resultado, genealogía, costo/cantidad/unidad/caducidad. No activar el modo elaborado antes de ese recorrido. Aceptar dos empresas/sucursales, insuficiencia, rollback y reintentos/concurrencia con runtime independiente.

## Verificación local

- RED: suite no puede cargar el módulo todavía inexistente, exit 1.
- GREEN: `pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads lib/services/__tests__/recipe-consumption-policy.test.ts` → **19/19**, exit 0, 1.96 s. Cobertura: límite de vigencia, versión previa/nueva, orden de filas, copia independiente, día inválido/sin cobertura, duplicados, alcance y definición excluyente/incompleta.
- `pnpm.cmd exec eslint lib/services/recipe-consumption-policy.ts lib/services/__tests__/recipe-consumption-policy.test.ts` → exit 0, sin advertencias.
- `pnpm.cmd exec tsc --noEmit --target ES2020 --module NodeNext --moduleResolution NodeNext --esModuleInterop --skipLibCheck lib/services/recipe-consumption-policy.ts lib/services/__tests__/recipe-consumption-policy.test.ts` → exit 0. Este chequeo focal no sustituye tipos/build globales.
- `pnpm.cmd exec tsx scripts/validate-faltantes.ts` → exit 0, 239 filas, 86 tareas base, 108 hijos, 25 aceptaciones y cero errores. INV-02/PROD-00 se registran en curso, sin nuevas aceptaciones.

Puerta global compartida: build inicial compiló y falló por heap de Node al ejecutar TypeScript (worker 134). **Tipos globales con `NODE_OPTIONS=--max-old-space-size=4096`, `pnpm.cmd exec tsc --noEmit`: exit 0**, sesión `95514` terminada. Sin diagnósticos. Se solicita ahora build con `NODE_OPTIONS='--use-system-ca --max-old-space-size=4096'`, `pnpm.cmd run build --webpack`, sin tipos independientes en paralelo. No atribuir al árbol final el build anterior.

Esto prueba el contrato puro. No prueba FK/RLS, publicación, snapshots, aplicación de stock, UI ni despliegue; INV-02 y PROD-00 permanecen pendientes de aceptación.

Continuación de persistencia: el contrato valida también unicidad de versión, alineada con SQL; RED específico reproducido y corregido. **20/20 contrato + 14/14 SQL**; regresión conjunta **101/101 en cinco archivos**, exit 0. Las verificaciones FK/RLS locales corresponden a `schema.md`, sin elevarlas a V2 independiente. Se materializaron cinco hijos en plan/mapa/matriz, conservando las 239 filas y sin nuevas aceptaciones. Publicación/snapshot/apply siguen pendientes; contrato y schema registran código implementado.

Checkpoint global posterior a 0159: sesión `87389` terminada, **exit 0**. `NODE_OPTIONS='--use-system-ca --max-old-space-size=4096' pnpm.cmd run build --webpack`: compilación 9.9 min, TypeScript aprobado, 455/455 páginas, optimización y trazas completas. Emitió advertencias existentes de `fetchConnectionCache` y render dinámico de documentos laborales; no impidieron el build. Este resultado precede a cualquier preparación/publicador 0160, que deberá verificar sus propios cambios.

Continuación de publicación: código de **INV-02.publish.rls** ([0160](publication-access.md)) y **INV-02.publish** ([servicio](publication.md)) implementado. **51/51 focales**, con permisos reales de columna en PGlite, auditoría atómica, protección de fechas legacy/canónicas, idempotencia con prueba previa y recuperación ante fallo de bitácora capturado por el caller. El contrato/bitácora quedan bajo AUD-02; no se inventa sucursal para un catálogo global. Se añade un sexto hijo al mapa/matriz, sin aumentar aceptaciones. SQL 0159/0160 no aplicado a entornos externos; políticas aún no conectadas al snapshot/escritor de venta ni a API/UI. Tipos globales posteriores: sesión `46789`, heap 4 GB, activa al último sondeo; no reiniciar por falta de salida.

Resultado posterior de esa sesión: **tipos globales exit 0**. Trazabilidad con sexto hijo: 239 filas, 86 bases, 114 hijos, 25 aceptaciones, cero errores. Build nuevo solicitado después de tipos; conservar el resultado del build anterior como checkpoint previo.
