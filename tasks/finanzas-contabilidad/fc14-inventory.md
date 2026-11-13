# FC-14 — Valoración original de inventario

Estado 2026-11-13: historial 0141–0142 integrado en Git. La base real de Netlify, identificada por el propietario y distinta de `.env`, recibió **0135–0142 atómicamente**, con ensayo revertido y verificación independiente. Las 194 tablas anteriores conservaron sus datos. Se verificó también la captura original en esa base mediante una transacción revertida. Publicación y bandera `ACCOUNTING_INVENTORY_ENABLED=1` pendientes de comprobar en vivo. Evidencia: [fc14-netlify-migration-2026-11-13.json](fc14-netlify-migration-2026-11-13.json).

Cierre técnico local: 2026-11-13. Build definitivo, tipos, regresión financiera y lectura bajo RLS aprobados. Resumen estructurado: [fc14-verification.json](fc14-verification.json).

## Comportamiento

La migración aditiva `0142_fc14_inventory_valuation.sql` captura consumo, devolución de consumo, merma, salida/entrada de traslado y merma en tránsito en `accounting_inventory_valuations`. El trigger de inserción guarda cantidad, método efectivo, costo disponible, importe, fecha y procedencia junto con el movimiento físico. La captura y el movimiento se confirman o revierten juntos, incluso con el escritor SERIALIZABLE de consumo de recetas. Los triggers participan de la misma transacción según la [documentación de PostgreSQL](https://www.postgresql.org/docs/current/trigger-definition.html).

No se modifica ni elimina el movimiento valorado ni su valoración. Las funciones privilegiadas usan tablas calificadas, `search_path=pg_catalog`, comprobación de empresa y permisos mínimos; se revoca ejecución pública en las funciones privilegiadas. Sigue las precauciones de [SECURITY DEFINER](https://www.postgresql.org/docs/current/sql-createfunction.html). El rol runtime puede leer únicamente valoraciones de su empresa; no puede escribirlas directamente.

La cantidad conserva cuatro decimales; el importe se congela en centavos enteros, con redondeo por movimiento y límite de entero seguro. Si faltaba el costo original, permanece pendiente aunque después se capture un precio. Un movimiento que redondea a cero no genera una póliza vacía. No hay reconstrucción retroactiva del histórico.

Las devoluciones de consumo requieren la referencia canónica al movimiento original y conservan sus cuentas y centros de costo. Cada devolución parcial prorratea el valor acumulado original; no puede exceder su cantidad. El consumo original debe estar contabilizado antes de publicar la devolución.

Los traslados propios cargan inventario en tránsito al salir y lo descargan al recibir o documentar merma en tránsito. No generan venta. Recepción y merma distribuyen acumulativamente el valor de todas las salidas originales del artículo, incluidos lotes FEFO fraccionarios. No se vuelve a costear al precio del destino. La identidad de la transferencia queda protegida; la publicación exige la fase operativa confirmada y la misma cuenta en tránsito del envío.

`receiveTransfer` confirma el estado con una actualización condicional; dos recepciones concurrentes no duplican existencias. Rechaza partidas ajenas/repetidas y cantidades negativas, excesivas o fraccionarias que las columnas enteras de la partida no pueden representar. La valoración de los movimientos constituyentes sí admite cuatro decimales.

Las pólizas usan reglas explícitas por evento: `INVENTORY_USED`, `INVENTORY_USAGE_RETURNED`, `INVENTORY_WASTED`, `INVENTORY_SHIPPED`, `INVENTORY_RECEIVED` e `INVENTORY_TRANSIT_WASTED`. Roles: `INVENTORY`, `IN_TRANSIT` (activo), `COGS`, `WASTE` (gasto). La guarda SQL comprueba identidad, importe, regla y renglones, además de las guardas generales del diario. La corrección requiere movimientos físicos vinculados; se bloquea la reversa manual aislada.

## Activación y recuperación

- `ACCOUNTING_INVENTORY_ENABLED` está apagada por defecto. Sin ella, el worker no consulta la nueva tabla ni descubre hechos de inventario; Resultados conserva su consulta anterior y sigue siendo compatible con una base sin 0142.
- Con la migración instalada, la captura física funciona aunque la publicación esté apagada. La recuperación descubre como máximo 25 valoraciones por barrido. Para descubrir/publicar se requieren ambas banderas: inventario y `ACCOUNTING_POSTING_ENABLED=1`.
- Desactivar publicación detiene nuevas pólizas y conserva fuentes, valoraciones y hechos. Mantener la bandera de inventario permite seguir consultando sus valores congelados en Resultados.
- El adaptador exige apertura revisada anterior, periodo abierto, actor y sucursal propia activos, regla vigente y cuentas utilizables. Una regla o cuenta faltante conserva un pendiente que puede reintentarse tras corregir la configuración. Un costo original ausente no se rellena después con el precio actual: requiere revisión de la fuente y una corrección operativa documentada, fuera de la recuperación automática. No se inventa una cuenta.
- Una fuente sin actor elegible conserva su valoración y motivo, pero no se transforma en un evento con actor ficticio. La recuperación administrativa de esas fuentes queda fuera de esta entrega.
- Antes de activar: revisar 0141 concurrente y aplicar en orden 0141–0142 con ensayo y verificación independiente; configurar las seis reglas, apertura y cuentas; habilitar inventario solo después del ensayo. No se cambian banderas ni se ejecutan migraciones operativas en esta entrega.

## Resultados

Al habilitar inventario, consumo y merma usan el importe congelado. Las devoluciones restan el importe original. La merma se conserva en su renglón; no se añade otra vez al consumo. Los movimientos anteriores a la migración conservan el cálculo al costo actual y se identifican explícitamente como heredados. El detalle distingue valoración congelada, actual o mixta.

Un costo original faltante se excluye del importe y degrada la cifra a parcial/derivada, con aviso visible. No se presenta como un costo recuperado a partir del precio actual. La aproximación por compras sigue siendo una aproximación y no adquiere valoración histórica por esta entrega.

## Evidencia

- Contrato aritmético: 23 pruebas aprobadas; cantidades fraccionarias, centavos seguros, prorrateo acumulado y roles sin venta.
- Área financiera: 226 pruebas aprobadas en 19 archivos (`.tmp/fc14-finance-unit.log`, salida 0).
- Integración aislada: primer cierre de 43 pruebas en inventario y regresión del detalle (`.tmp/fc14-final-integration.log`, salida 0); cierre adicional de inventario **22/22** con rechazo de escritura desde un contexto de otra empresa y conservación del fallback original al cambiar de método (`.tmp/fc14-runtime-final.log`, salida 0). La regresión de detalle aporta 22 pruebas; son **44 casos distintos** entre ambos archivos. Incluye escritor runtime sin BYPASSRLS, captura SERIALIZABLE, rollback, aislamiento por empresa, inmutabilidad, cambio posterior de precios/método, parciales, concurrencia, recepción real FEFO, conservación del tránsito, rechazo de póliza balanceada con importe incorrecto y correspondencia con Resultados.
- Navegador: 8 pruebas aprobadas (`.tmp/fc14-browser.log`, salida 0). Componentes/CSS reales y HTTP sintético: mensajes congelado/mixto/costo faltante, teclado, móvil, paginación, errores y permisos. Sin escrituras a la base operativa.
- Suite general: **208 archivos aprobados, 2573 pruebas aprobadas, una skipped y una todo, salida 0** (`.tmp/fc14-all-unit.log`). Los mensajes de error de recuperación son escenarios deliberados de prueba; no son fallos de la suite.
- La revisión del rol runtime detectó que las consultas nuevas debían establecer el contexto de empresa para leer RLS. Se corrige el agregado de food cost y el detalle. Prueba final de inventario **23/23, salida 0** (`.tmp/fc14-rls-read-final.log`), incluidos los valores congelados bajo el rol restringido. Con las 22 regresiones de detalle son **45 casos distintos**. Regresión financiera posterior **226/226, salida 0** (`.tmp/fc14-finance-rls.log`).
- TypeScript después del ajuste RLS **salida 0** (`.tmp/fc14-types-rls.log`, `.tmp/fc14-types-rls-exit.txt`); lint de los tres archivos ajustados **salida 0, sin advertencias** (`.tmp/fc14-lint-rls.log`).
- Lint global **salida 0, cero errores y 2435 advertencias** (`.tmp/fc14-global-lint.log`). Build autorizado anterior al ajuste RLS **salida 0** (`.tmp/fc14-build-network.log`). Se repite el build con el ajuste final. El primer intento restringido falló al descargar Geist/Geist Mono; el reintento autorizado conserva configuración, bundler y fuentes.
- **Build definitivo posterior al ajuste RLS: salida 0**, compilación, tipos y generación aprobados (`.tmp/fc14-build-final.log`, `.tmp/fc14-build-final-exit.txt`). La suite general y el lint global corresponden al checkpoint anterior a ese último ajuste; después se ejecutan las 23 integraciones de inventario, las 226 unitarias financieras, tipos, lint de los tres archivos ajustados y este build. No se presentan los controles anteriores como una ejecución nueva sobre el ajuste final.
- Lint focalizado: cero errores; dos advertencias preexistentes en `inventory-service.ts`.

Las pruebas de implementación corresponden a esquemas sintéticos en `TEST_DATABASE_URL`. La aplicación operativa y su ensayo tienen evidencia separada enlazada arriba. No se acredita auditoría contable ni cierre del piloto FC-20/21. `.env` continúa apuntando a la base vacía anterior, sin modificarla. Se conservan intactas las anomalías heredadas del journal del demo: nueve discrepancias de hash, 25 diferencias de finales de línea, 13 timestamps duplicados y una fila antigua sin correspondencia local. Se añaden ocho registros nuevos después de verificar los requisitos de esquema; no se reescribe ni se finge ejecutar el historial antiguo.

Incrementos: `ee87eae` (contrato), `fddc05d` (recepción), `dce8b74` (0141 independiente), `82fa91b` (0142 y esquema), `f13efea` (adaptador y diagnóstico de bandera), `a816208` (Resultados). Se integran solo el permiso/snapshot necesarios de 0141; los demás cambios concurrentes de ventas/ingesta siguen fuera de estos commits.

## Verificación del release aislado

El commit `a816208` se comprueba en un checkout separado, sin las modificaciones concurrentes: **205 archivos, 2556 unitarias aprobadas, una skipped y una todo; lint cero errores y 2437 advertencias; build de producción salida 0**, con inventario habilitado y credenciales ficticias de build. Logs `.tmp/fc14-release-{unit,lint,build}.log`. La regresión de integración tras añadir `inventoryEnabled` al diagnóstico de preparación vuelve a pasar **23/23**. Los manifiestos de dependencias del checkout y workspace coinciden tras normalizar finales de línea; se reutiliza la instalación existente sin modificarla.

La respuesta autenticada de preparación incluye `inventoryEnabled` para comprobar la bandera real del servidor. En Netlify debe guardarse en Production con alcance Builds/Functions; una variable solo en `netlify.toml` no basta para las funciones, según la [documentación de Netlify](https://docs.netlify.com/build/functions/environment-variables/). Desactivar esa variable y redesplegar detiene nuevas publicaciones de inventario; las valoraciones físicas y pólizas anteriores se conservan.
