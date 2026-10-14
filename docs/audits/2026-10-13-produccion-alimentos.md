# C17 — Política de producción de alimentos

Fecha: 13 de octubre de 2026. Seguimiento: [C17](../tasks/plan-conexion-frontend-backend.md#c17). Cierra los cortes C17.1 (contrato honesto en el catálogo), C17.2 (producción con empresa verificada), C17.3 (transferencias con empresa verificada) y **C17.4 (recorrido con dos empresas contra la base real)**.

## Investigación y alcance

H04 y C15: `foodProduction` se guardaba y se describía como si gobernara la producción y el abastecimiento. C15 verificó que ningún servicio leía la columna y la clasificó `descriptiva`. C17 tenía que decidir si se activa o se queda descriptiva.

El recorrido ya existe, y es el mismo para las tres dimensiones:

```
producción   POST /api/inventory/production → createOrder → recordProduction
abastecimiento PATCH /api/inventory/transfers/[id] → approve → ship → receive
```

- **Producción por sucursal.** `production_orders.branchId`; `recordProduction` descuenta lotes de esa misma sucursal (FEFO con `FOR UPDATE` en el camino automático). La receta es de la empresa y se produce en el sucursal donde se registra.
- **Abastecimiento entre sucursales = transferencias.** `inventory_transfers` ya modela el envío de una cocina a otra: solicitud → aprobación → envío → recepción. `shipTransfer` descuenta por FEFO en el origen y registra `TRANSFER` negativo; `receiveTransfer` crea el lote destino heredando folio y vencimiento y registra `TRANSFER` positivo. Mueve stock, no lo duplica, y el plan prohíbe crear un segundo motor de movimientos.
- **No existe «cocina central» como entidad.** Ninguna columna designa una sucursal como comisariato. Aplicar la dimensión deduciendo reglas de `IN_SITU`/`COCINA_CENTRAL`/`MIXTO` por el nombre del valor sería repetir H04.

**Decisión de producto (13-10-2026): `foodProduction` sigue `descriptiva`.** Nadie ha definido qué cocina abastece a cada sucursal ni quién autoriza ese envío. Lo que C17 sí hace es dejar el recorrido que la dimensión describe con empresa verificada en servidor —producción y transferencias—, que es su criterio 2 de aceptación, y escribir en el catálogo qué falta para poder aplicarla.

## Comportamiento implementado

- **C17.1 — Contrato honesto.** La entrada de `foodProduction` en `lib/company/operating-policy-catalog.ts` queda escrita contra el recorrido real: producción por sucursal y envíos entre sucursales, con los símbolos concretos (`production_orders.branchId`, `recordProduction`). La decisión pendiente se estrecha a lo que de verdad falta: decidir qué cocina abastece a cada sucursal y quién autoriza el envío. Sin cambio de clasificación.
- **C17.2 — Producción con empresa verificada.** `createOrder` y `recordProduction` comprueban, **antes del primer insert**, que la sucursal que produce y la receta son de la empresa de la sesión. Los lotes explícitos del camino manual tienen que ser de esa misma sucursal: el descuento de un lote ajeno se rechaza nombrando el lote. La comprobación va antes del bucle porque ese camino no corre dentro de una transacción y un rechazo a medias dejaría lotes descontados a medias. La ruta (`POST` y `GET`) repite la verificación de sucursal con la guarda compartida y traduce el `ApiError` a su status: sin eso una sucursal ajena llegaba al cliente como 500, que dice «falló el servidor» cuando lo que pasó es que la sucursal no es de esta empresa. La vista previa de receta comprueba también que la receta sea de la empresa (404 si no).
- **C17.3 — Transferencias con empresa verificada.** La creación acota origen, destino y artículos a la empresa y rechaza el envío a la misma sucursal. El detalle y las cuatro transiciones (aprobar, rechazar, enviar, recibir) se acotan por empresa: una transferencia ajena se lee y se opera como no encontrada (404, que no filtra su existencia). La ruta `PATCH` exige permiso de escritura de inventario y que la sucursal del actor sea el lado que ejecuta la acción, que es el que la interfaz muestra: el destino aprueba o rechaza, el origen envía, el destino recibe. El listado comprueba que la sucursal de la query sea de la empresa.

## El hueco que encontró el recorrido en navegador

El V2 no era un trámite: monta la pantalla real de transferencias y encontró que **una transferencia `APPROVED` no aparecía en ninguna pestaña**. La lista agrupaba por `PENDING` (origen), `PENDING` (destino), `IN_TRANSIT` y `COMPLETED`/`REJECTED`/`CANCELLED`; el estado aprobado —esperando envío— se quedaba fuera, así que quien tenía que enviar la mercancía no tenía cómo llegar al botón «Enviar». El recorrido de abastecimiento era, en la práctica, un tramo sin final.

Se añadió la pestaña «Por Enviar», que lista lo aprobado cuyo origen es la sucursal activa, con una prueba que la fija. El lado del que envía no es una invención del servidor: es el que ya usaba la pantalla y el que el descuento del lote exige (quien tiene la mercancía es quien la envía).

## Evidencia y límites

| Verificación | Resultado |
| --- | --- |
| `pnpm exec vitest run tests/unit/inventory/` | **36/36**: 17 de transferencias (creación, transiciones, ruta, recorrido completo) + 11 de producción (orden, registro de producción, ruta) + 8 previos de costeo. |
| `pnpm exec playwright test --config tests/playwright-shifts.config.ts transfers-scope` | **5/5** en Chromium: el motivo del 403 llega a la pantalla, el origen ve y envía la aprobada, la pantalla no ofrece enviar lo del otro extremo, una lista rechazada nombra el motivo y no muestra transferencias, y cada pestaña cuenta sólo lo de su sucursal. |
| `pnpm exec playwright test --config tests/playwright-shifts.config.ts` | **55/55** en la configuración aislada (50 previos más las 5 de C17.3). |
| `pnpm run test:unit` | 85 archivos; **1101** aprobadas, 1 omitida y 1 TODO. |
| `npx tsx scripts/verify-food-production-scope.ts` (C17.4) | **41/41 contra la base real.** Detalle abajo. |
| `pnpm exec tsc --noEmit` · `pnpm run lint` · `pnpm run build` | Limpios: `tsc` sin salida, `lint` 0 errores (2395 warnings preexistentes), `build` con salida 0. |

Límites, declarados:

- **Sin V2 de la pantalla de producción.** El recorrido en navegador es el de transferencias. La pantalla de producción (`app/dashboard/inventory/production`) no tiene V2: sus rutas están cubiertas por pruebas unitarias sobre la ruta y el servicio reales, y no se ha montado en Chromium.
- **El V2 intercepta la API.** No ejecuta Next, autenticación ni Postgres; los estados de la ruta (403, 400, 404) los producen las unitarias sobre la ruta real. Lo que el navegador demuestra es que el motivo llega al operador y que la pantalla ofrece el lado correcto.
- **El simulador de `db` es un intérprete de SQL mínimo.** Filtra igualdades e `IN` con `PgDialect`; no interpreta agregados, joins ni `FOR UPDATE`. Lo que las unitarias comprueban es que la consulta lleva el filtro y que el rechazo ocurre antes de escribir, no el comportamiento del planificador.
- **El script de verificación siembra y borra en la base compartida de Neon.** Los nombres llevan la marca `C17.4 verificación` y la limpieza va en un `finally`; si se interrumpe, quedan empresas de prueba que hay que borrar a mano. El orden importa: hijos antes que padres por la FK (movimientos, resultados, ingredientes, órdenes, líneas de transferencia, transferencias, lotes, artículos, líneas y recetas, sucursales, empresas).
- **No hay responsabilidades configurables para transferencias.** Quien tenga `inventory:update` y vea toda la empresa opera en cualquier sucursal de su empresa. Es una decisión explícita y provisional: no hay matriz como en compras (C16.2) y nadie ha pedido una. Si el negocio la quiere, es otra tarea.
- **El V2 no cubre la solicitud de transferencia.** El diálogo usa Radix `Select` para destino y artículos; el recorrido probado llega hasta el envío y la recepción. La creación queda en unitarias (servicio) y en el script contra la base real.

## Decisiones registradas

- **`foodProduction` sigue siendo descriptiva.** El producto no tiene cocinas designadas; ninguna sucursal está marcada como comisariato. Aplicarla por el nombre del valor habría sido el defecto que C15 clasificó. Lo que se puede aplicar sin inventar reglas es el alcance: quién puede producir y enviar contra lo que es suyo.
- **Lo que falta para aplicarla queda escrito en el catálogo:** qué cocina abastece a cada sucursal y quién autoriza el envío. No es un pendiente invisible: la interfaz muestra el estado de cada política desde C15.
- **La verificación no se extiende a otros recorridos.** El resto de rutas de producción (hoja de producción diaria, sugerencias, tiempos de retención) no se tocaron: entran por sus propias rutas y sus Consumidores ya acotados, y revisarlos es trabajo distinto del que C17 describe.
- **La ausencia de lote sigue siendo faltante, no excepción.** Un lote que no existe es merma por lote insuficiente (contrato T16); un lote que existe y es de otra sucursal es una escritura que no debe ocurrir y se rechaza nombrándolo. La distinción está escrita en el propio código para que no se confunda después.

## C17.4 — recorrido con dos empresas contra la base real

Qué comprueba `scripts/verify-food-production-scope.ts`, y por qué hacía falta: las unitarias simulan `db` y la pertenencia se verifica renderizando el SQL. Eso demuestra que la consulta lleva `company_id`, no que el recorrido se comporte bien con dos empresas de verdad —ni que los `numeric(12,4)`, los estados del enum y el `FOR UPDATE` del FEFO se comporten como dice el código.

Siembra dos empresas, dos sucursales cada una, un artículo, un lote y una receta por empresa, y recorre:

1. **Producción.** Orden propia correcta; receta ajena, sucursal ajena y lote de otra sucursal se rechazan, y se comprueba que el lote ajeno quedó con la misma cantidad antes y después —el rechazo ocurrió antes del descuento— y que no quedó ningún `production_results`. Después, el camino bueno: la orden cierra en `COMPLETED` y el lote baja de 20 a 15.
2. **Abastecimiento.** Destino, artículo y sucursal de origen ajenos se rechazan sin dejar transferencias. El recorrido completo crea, lee, aprueba, envía y recibe, y cuenta: **exactamente dos movimientos** con la misma referencia, uno `TRANSFER` negativo en la sucursal que envió y uno positivo en la que recibió, un único lote destino heredando folio y cantidad, y un estado final `COMPLETED`. Recibir dos veces se rechaza y no crea un segundo lote: la otra mitad del criterio de no duplicar.
3. **Aislamiento en el otro sentido.** B crea su propia transferencia y A no la lee, no la aprueba y no la envía; el lote de B queda intacto. B tampoco puede producir contra una sucursal de A.

Al terminar borra todo y comprueba que no quedó ninguna empresa de la verificación.