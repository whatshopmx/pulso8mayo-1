# C15 — Definir el contrato de cada política operativa

Fecha: 13 de octubre de 2026. Seguimiento: [C15](../tasks/plan-conexion-frontend-backend.md#c15).

## Investigación y alcance

C15 abre la política de la Fase 3 con H04: la pantalla de **Modelo Operativo** guardaba siete dimensiones y cinco umbrales, y describía en su interfaz reglas que ningún servicio aplicaba. En el encabezado de `tenant-config-service.ts` vive la misma mentira en forma de lista: `purchase-order-service` leyendo `managerAutonomy=BAJA` y `cross-branch-service` leyendo `tenantType` para excluir franquicias de la consolidación. Ninguna de las dos existe. Es el defecto de H04 enunciado por el propio código que lo sufre.

El arreglo no es escribir la intención, que ya estaba escrita en la pantalla. Es separar lo que el código hace de lo que el operador imagina y decirlo sin ambigüedad. C15 es catálogo y promesas de interfaz: **no cambia comportamiento**, no aplica ninguna política nueva y no toca el esquema. Aplicar las siete dimensiones es C16–C23, una por tarea.

El alcance previsto era de cuatro archivos y terminó siendo siete: el catálogo, sus pruebas, las dos secciones de la pantalla, el contrato en `docs/operating-policy-contracts.md`, el encabezado corregido de `tenant-config-service.ts` y las pruebas de navegador. Se dividió en C15.1 (catálogo y consumidores), C15.2 (promesas de la interfaz) y C15.3 (evidencia y seguimiento) antes de implementar, con los criterios de aceptación de C15 repartidos entre las tres.

**Hallazgo colateral:** la matriz de aprobación por monto (OC) sí se aplicaba, pero sólo era editable desde la pantalla de órdenes de compra —un recorrido que el operador de configuración no tiene—. C16.1 la expone en Configuración operativa como parte del mismo corte; se registra en la fila de C16, no en esta.

## Comportamiento implementado

- **Catálogo (`lib/company/operating-policy-catalog.ts`).** Un solo lugar que dice, campo por campo, unidad, alcance, permiso, clasificación, consumidor, momento de aplicación, excepciones y estado vacío. Tres clasificaciones excluyentes: `aplicada` (hay un consumidor que cambia una decisión), `descriptiva` (se guarda y se muestra, y ningún código lo lee para decidir) y `pendiente` (hay consumidor o atributo que lo podría leer y falta la decisión de qué debe pasar).
- **Resultado de la revisión, campo por campo.** Cuatro umbrales monetarios **sí se aplican hoy**: `managerAuthLimitCents` y `doubleApprovalThresholdCents` vía `rolExigidoPorMonto` (`lib/expenses/approval-policy.ts`), `emergencyPurchaseCapCents` vía `validateEmergencyCap` (`lib/services/budget-service.ts`) y `courtesyWasteMonthlyCapCents` vía `evaluateApproval` (`lib/inventory/waste-approval.ts`). Seis entradas son **descriptivas**: las cinco dimensiones sin recorrido (`purchasingStructure`, `foodProduction`, `treasuryModel`, `supplierPayment`, `payrollDispersion`) más `pettyCashLimitCents`, que ningún servicio lee — `petty-cash-service` trabaja con el monto que el operador escribe en cada movimiento y con el `fund_amount` de cada fondo. Dos son **pendientes**: `managerAutonomy` (la escalera de gastos existe y funciona, pero se construye con los dos umbrales monetarios y el nivel no participa) y `tenantType` (el aislamiento de franquicias existe y funciona, pero se decide por `branches.ownershipType` en `lib/rbac/`, no por la columna del grupo).
- **Interfaz.** Cada dimensión y cada umbral llevan un distintivo cuyo texto sale del catálogo, no del JSX: «Se aplica hoy», «Descriptiva» o «Pendiente de decisión». Los radiogrupos pasan a `aria-labelledby` + `aria-describedby` con la explicación de su estado, y a `tabindex` rotatorio con navegación por flechas. Se corrigieron cuatro promesas falsas: el encabezado «enrutar autorizaciones, consolidar reportes y gobernar sucursales», los distintivos «Control Estricto» y «Visibilidad Total», la frase de doble firma —el sistema tiene un aprobador por gasto, no dos— y «Monto máximo asignado al fondo revolvente», que sonaba a tope y no lo es.
- **Contrato escrito.** `docs/operating-policy-contracts.md` pasa de cuatro parámetros a trece, con la tabla de decisiones pendientes por dimensión (C16–C23) y los casos dado/cuando/entonces de los cuatro umbrales aplicados.

## Evidencia y límites

| Verificación | Resultado |
| --- | --- |
| `pnpm exec vitest run tests/unit/company/operating-policy-catalog.test.ts` | **23/23**. Cada política aplicada nombra un consumidor que existe y cuyo símbolo está declarado —no sólo mencionado—; cada descriptiva **no aparece** en ningún archivo de servicio, ruta o biblioteca fuera de la lista blanca de esquema, API, mapeo del formulario, catálogo y semillas; los valores del catálogo son los que el `PUT` acepta y los que el esquema declara; el escáner de ausencia tiene un control anti-vacío con tres campos que sí se leen. |
| `pnpm exec playwright test --config tests/playwright-shifts.config.ts operating-config` | **19/19** en Chromium: los 15 previos (C13 y C14.1) más 4 de C15 — estado declarado por dimensión y por caja chica, los 20 valores de las siete dimensiones sobreviviendo a guardado y recarga, navegación por flechas con foco conservado, y los estados cabiendo en 320/768/1024/1440 px sin desbordamiento horizontal—. |
| `pnpm exec playwright test --config tests/playwright-shifts.config.ts` | **42/42**: los 34 de la línea base más los 4 de C15 y los 4 de C16.1. |
| `pnpm run test:unit` | 81 archivos; **1019** aprobadas, 1 omitida y 1 TODO. Las 23 de C15 más las 23 de `stock-count-*`, que llegaron entre la línea base de C14 y esta sesión por la funcionalidad de conteo por categoría y lote. |
| `pnpm run lint` (archivos de C15) | 0 errores; 6 warnings preexistentes (`_c` y `_u` sin usar en `tenant-config-service.ts`). |
| `npx tsc --noEmit` | Limpio. |
| `pnpm run build` | OK. El primer intento falló con `TurbopackInternalError` al parsear `app/globals.css` (`os error 10054`, «reading packet length»): caída del proceso, no fallo de aplicación —`globals.css` no está modificado—; el segundo intento terminó sin errores. |

Límites, declarados:

- **El navegador no ejecuta Next, autenticación ni Postgres.** El V2 intercepta `GET`/`PUT` con respuestas controladas y sirve la pantalla real con estilos compilados de `app/globals.css`. La autorización —sesión, `requireTenant`, permiso `settings/update`, rechazo 403— sigue cubierta por pruebas unitarias sobre la ruta real, igual que en C13 y C14. No hay V2 con el servidor real para esta pantalla.
- **El escáner del catálogo es textual, no de comportamiento.** Detecta una referencia a `purchasingStructure` fuera de las rutas exentas, pero no un acceso dinámico ni un efecto que sólo exista en ejecución. Sirve para que el catálogo no vuelva a ser la prosa que H04 critiquó; no sustituye a pasar el valor por su consumidor, que es lo que hacen las pruebas de C14 para los cuatro parámetros fiscales.
- **C15 no cambia ningún comportamiento.** Ninguna de las siete dimensiones empieza a regir algo: se declara honesta su falta de efecto y queda escrita la decisión que falta. Aplicarlas es C16–C23.
- **El sello «Se aplica hoy» no es una garantía permanente.** Si un servicio deja de leer un umbral, la prueba de ausencia no lo detecta —la comprobación de símbolo declarado sólo mira el archivo—; la de sí-aplicada seguiría verde hasta que alguien actualice el catálogo. Es un riesgo aceptado del corte: la revisión contra consumidores se hizo a mano y queda registrada aquí.
- **La decisión de C05 (quién revisa un workflow) no se resuelve con esto.** `managerAutonomy` quedó clasificada como pendiente precisamente porque la escalera de gastos que existe no la lee; ligar ambas cosas sin acuerdo sería inventar una política.

## Decisiones registradas

- **Cada dimensión se clasifica por lo que el código hace hoy, no por lo que su nombre sugiere.** `managerAutonomy` y `tenantType` son `pendiente` y no `descriptiva` porque existe el recorrido relacionado —escalera de aprobación, aislamiento de franquicias— y lo que falta es el acuerdo de cómo lo modificarían, no el hecho de que no hagan nada.
- **`pettyCashLimitCents` es `descriptiva`, no «sin tope».** En los otros umbrales `null` significa «sin tope» porque el valor se usa. Aquí `null` no limita nada, y el texto de la pantalla lo dice: vacío, cero y un monto positivo son tres descripciones, y cada fondo conserva su efectivo entregado y su propio umbral de reposición. C23 decide si es el tope al abrir, el máximo por gasto o el monto que exige aprobación.
- **Las decisiones pendientes no bloquean lo aplicado.** Los cuatro umbrales siguen rigiendo igual; las ocho decisiones abiertas están escritas por dimensión, con la tarea que debe resolverlas.

## Continuidad

C16 — aplicar la política de estructura de compras — parte del catálogo. Su primer corte (C16.1) quedó implementado y verificado en esta misma sesión: la matriz de aprobación OC, que ya decidía los niveles al enviar cada orden, ahora es editable desde Configuración operativa con guardado propio, error visible que conserva el borrador, avisos de cobertura corregidos y recarga. Se registra en la fila de C16, que sigue abierta: falta C16.2 (solicitud, emisión y delegación) y C16.3 (verificación del recorrido con dos empresas).