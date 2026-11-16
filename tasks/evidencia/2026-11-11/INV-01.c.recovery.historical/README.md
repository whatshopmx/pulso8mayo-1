# INV-01.c.recovery.historical — Receta desde documento atestiguado

Continuación 2026-11-14. Cuatro archivos: `sale-recovery-historical-recipe.ts`, `sale-recovery-historical.ts`, prueba unitaria `sale-recovery-historical.test.ts` y SQL `sale-recovery-historical-db.test.ts`. Sin migración, cambios de permisos ni escritura de ventas/stock. 0145 se instala solamente dentro del rollback de cada fixture aislado. El checklist y el padre siguen abiertos.

## Recorrido del servidor

`readRecoveryHistoricalRecipe` recibe únicamente branchId, legacySaleId y attestationId. Obtiene sesión del servidor, exige ADMIN/OWNER/SUPER_ADMIN y inventory:manage, resuelve sucursal y fija empresa/actor desde esa sesión. No acepta flags, snapshot, clave de storage ni autoridad del cuerpo.

Carga la atestación RECIPE_VERSION del mismo tenant/sucursal/venta, vinculada a evidencia SALE_RECOVERY viva y a venta/sucursal reales. Compara updated_at nativo entre adjunto y atestación y storageKey exacta, fecha de revisión no futura. Mantiene SHARE sobre adjunto y venta durante descarga y reconstrucción. La identidad de receta debe existir en la misma empresa; esa consulta no utiliza su definición mutable.

Descarga el objeto privado con límite de **2 MiB/15 s** para el documento estructurado (el canal general de adjuntos admite hasta 20 MiB). Vuelve a calcular SHA-256 y tamaño real contra la atestación. Ausencia/cambio devuelve 409; error de proveedor 502 y storage no configurado 503. Solo después decodifica JSON/UTF8 estrictos y reconstruye el snapshot usando el motor existente `buildSaleRecipeSnapshot`. Nunca usa `saleRecipeReader` ni toma numeradores/demanda precomputados de un formulario. No firma URL ni hace DML. Fallos SQL se convierten en error interno controlado sin propagar query/parámetros/documento.

## Documento versión 1

Campos exactos: schemaVersion=1, kind=SALE_RECOVERY_RECIPE, companyId, branchId, legacySaleId, recipeId, sourceReference, saleDay, validFrom, validThrough, recipes, ingredients y conversions. Los IDs son UUID; la procedencia debe coincidir con la referencia que revisó el administrador al atestiguar. La ventana de vigencia es inclusiva y debe contener saleDay. Cada registro de receta/ingrediente/conversión lleva companyId propio y debe ser del tenant.

`recipes` contiene id, companyId, baseYield decimal, unit e items; cada línea tiene id, itemId, quantity decimal, unit, isSubRecipe boolean y yieldPercent entero 1..100 o null. `ingredients` contiene id, companyId y unit. `conversions` contiene id, companyId, fromUnit, toUnit y factor decimal. Puede estar vacío cuando no hay conversiones. Se rechazan recursos duplicados o sobrantes, árboles incompletos, ciclos y conversiones ambiguas/inconsistentes mediante el codec y el motor de snapshot existente. Máximos: 1000 recetas, 10000 líneas totales, 10000 ingredientes/conversiones y el límite total de bytes. El JSON no admite campos desconocidos ni snapshot/verified/demanda prefabricada.

Ejemplo reproducido en test: receta de dos porciones que usa 500 G, conversión histórica G→KG=0.001 y cantidad vendida de tres porciones produce **0.7500 KG**, aunque la receta mutable se cambie después a rendimiento 99. La subreceta con merma 50% también se expande con aritmética exacta del motor existente. El orden del catálogo documental no cambia la huella.

## Pruebas y alcance

RED inicial por codec inexistente; seis casos unitarios pasaron tras implementarlo. Primera SQL: tres casos pasaron y uno falló en la preparación del fixture, porque pulso_app no tiene UPDATE sobre recipes. Se corrigió únicamente el fixture: RESET ROLE para modificar la receta sintética como dueño, vuelta a SET LOCAL ROLE pulso_app antes de ejecutar el servicio; no se concedió ningún permiso. Regresión posterior: 60/60 unitarias y 9/9 SQL (histórico 4 + atestaciones 5). Casos y controles finales adicionales en `results.json`.

SQL real en `soft-cloud-50478212` / `br-round-voice-belheola`, host fijado y distinto de `.env`, rol pulso_app NOSUPERUSER/NOBYPASSRLS. Dos empresas/tres sucursales y usuarios sintéticos, atestaciones creadas por el servicio real, versión nativa con 123456 microsegundos y modificación de un microsegundo. DDL y datos dentro de rollback; se comprueba ausencia de tabla/empresas al final. Auth y R2 simulados. No es prueba de navegador/HTTP/sesión real ni bucket privado real. No se aplica DDL persistente ni a main.

## Límites del hecho histórico

Un administrador revisa y clasifica el documento y su procedencia. El sistema demuestra concordancia de sujeto, integridad de bytes, coherencia de unidades/árbol y vigencia declarada; **no demuestra automáticamente la verdad histórica de esos datos**. El día y la vigencia proceden del documento revisado: no se infiere el día operativo desde sale_date. El expediente posterior debe contrastarlos con la fuente SALE y conservar la procedencia/atestación exactas. También debe comprobar unidades físicas actuales y stock al aplicar, sin recalcular la receta histórica contra catálogo actual.

Este lector no prueba NO_PRIOR_CONSUMPTION, no registra propuesta/decisión ni autoriza recuperaciones. Faltan fuente de venta/no aplicación concordantes, expediente persistido del servidor, revisión independiente y aplicación auditada/idempotente con revalidación y carreras. AUD-02, UI y aceptación integrada siguen pendientes. El resultado retornado en memoria no reemplaza la revalidación bajo la transacción de la aplicación futura.


Cierre: los cinco casos SQL finales pasan (65.01 s), después de añadir una guardia de identidad de receta propia. RED adicional: antes se rechazaba 409 tras descargar y decodificar el documento discordante; ahora 404 antes de R2 por JOIN de identidad de receta/empresa. El servicio continúa sin consultar definiciones mutables. Lint final exit 0 sin advertencias; 60 unitarias de regresión exit 0. TypeScript permanece en su proceso original 37425; resultado pendiente, no build ni aceptación. Ver [results.json](results.json) para hashes/comandos/alcance.


Seguimiento de tipos y procedencia (2026-11-14): el proceso 37425 terminó exit 2 por yieldPercent opcional inferido por Zod con strictNullChecks=false. Se construye ahora explícitamente esa propiedad en el adaptador, sin cast; caso nuevo acepta null y rechaza ausencia. El proceso 36567 pasa TypeScript global. [Seguimiento](../INV-01.c.recovery.provenance/README.md): 21 unitarias finales y 15 SQL de regresión; build 13731 en curso. Hashes anteriores conservados en previousFiles de results.json; el lector sigue sin usar definiciones mutables.
