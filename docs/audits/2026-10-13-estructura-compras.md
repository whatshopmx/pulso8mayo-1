# C16 — Política de estructura de compras

Fecha: 13 de octubre de 2026. Seguimiento: [C16](../tasks/plan-conexion-frontend-backend.md#c16). Cierra los cortes C16.1 (matriz de aprobadores), C16.2.1 (contrato y almacenamiento), C16.2.2 (solicitud y emisión con pertenencia verificada) y C16.2.3 (interfaz). **C16.3 sigue pendiente**: falta comprobar el recorrido completo con dos empresas.

## Investigación y alcance

H04 decía que las siete dimensiones se guardaban y se describían como si gobernaran la operación. C15 verificó que era cierto y clasificó `purchasingStructure` como `descriptiva`. C16 tenía que decidir qué se hace con eso, y la respuesta salió de la decisión de producto del 13-10-2026: **cada empresa elige a sus responsables desde Configuración operativa**, sin una matriz universal y sin deducir permisos del nombre de la modalidad.

El recorrido de compras, leído antes de tocarlo:

```
solicitud  POST /api/inventory/purchase-orders (type=requisition → createRequisition | type=po → createPO)
envío      PATCH action="submit" → submitForApproval  (matriz + presupuesto + tope de emergencias)
aprobación PATCH action="approve" → approval_requests por nivel (matriz de C16.1)
emisión    PATCH action="send"   → sendPO            ← el único camino que compromete a un tercero
```

Tres huecos tenían que cerrarse **antes** de poder aplicar cualquier política, porque una regla que decide sobre una sucursal u orden que el actor no controla no decide nada:

1. **Escrituras sin empresa verificada.** `sendPO` y las demás transiciones buscaban la orden sólo por id; `PATCH` con el id de otra empresa la cambiaba y la auditaba como propia. Crear una solicitud o una orden aceptaba `branchId`, `supplierId`, `requisitionId` y artículos del cuerpo sin comprobarlos, y una solicitud ajena quedaba además marcada `CONVERTED`.
2. **No había responsable.** `inventory:create` para todos al solicitar, `inventory:update` para emitir.
3. **Entrada alternativa.** `suggested-order-service.generatePurchaseOrders` crea borradores, y `workflow-action-runner` sólo registra recepciones —no crea órdenes—, así que la alternativa real es una.

## Comportamiento implementado

- **Controles configurables (C16.2.1).** Tabla `purchase_delegation_rules` con acción (`REQUEST`/`EMIT`), alcance (`COMPANY`/`BRANCH`/`CATEGORY`), rol exigido y `active`, más `GET`/`PUT /api/purchase-delegation` con `settings:update` **y** `ADMIN+`. Resolución pura en `lib/purchasing/delegation-policy.ts`: sin reglas no hay control adicional y decide el permiso vigente; con reglas hace falta una que cubra la operación y que el actor alcance su rol; si existen y ninguna cubre, se rechaza nombrando el hueco. Varias reglas que cubren: gana la más permisiva que el actor alcance. Un actor de sistema puede dejar un borrador y nunca emite. **No hay montos** —pertenecen a la matriz y a C20— ni semilla perezosa: aquí una regla concede permisos.
- **Aplicación y pertenencia (C16.2.2).** `createRequisition` y `createPO` verifican sucursal, artículos, proveedor y solicitud antes de calcular o escribir, y aplican el control de solicitud. `sendPO` verifica la empresa, resuelve el control de emisión y sólo entonces cambia el estado. Todas las transiciones y ediciones (detalle y artículos) quedan acotadas por la empresa de la sesión. El rechazo es `403` con el motivo que construyó la política, y ocurre antes de escribir.
- **Interfaz (C16.2.3).** Sección «Quién solicita y quién emite» junto a la matriz, con editor por acción, alcance, sucursal o categoría, guardado independiente por acción, error que conserva el borrador, avisos de cobertura que no bloquean, carga rechazada con reintento y el efecto legible («Hoy: …»).
- **Modalidad: sigue descriptiva.** El catálogo de C15 la mantiene en `descriptiva` y su decisión abierta se reduce a una pregunta —si una compra de emergencia puede saltarse algún control—. El contrato escrito dice que la modalidad no concede permisos; la tarjeta de la interfaz lo repite junto al editor, porque es la confusión más probable.

## Evidencia y límites

| Verificación | Resultado |
| --- | --- |
| `pnpm exec vitest run tests/unit/purchasing/` | **53/53**: 34 de contrato, resolución, carga, reemplazo y ruta real (C16.2.1) + 19 del recorrido con pertenencia verificada (C16.2.2). |
| `pnpm exec playwright test --config tests/playwright-shifts.config.ts operating-config` | **31/31** en Chromium: 23 previos (C13, C14.1, C15 y C16.1) más 8 de C16.2.3 — estado sin controles, regla por sucursal con guardado y recarga, acciones independientes, rechazo que conserva el borrador, regla sin destino que no llega al servidor, carga rechazada con reintento, avisos no bloqueantes y los cuatro tamaños de pantalla—. |
| `pnpm exec playwright test --config tests/playwright-shifts.config.ts` | **50/50** en la configuración aislada (42 de la línea base más los 8 de C16.2.3). |
| `pnpm run test:unit` | 83 archivos; **1073** aprobadas, 1 omitida y 1 TODO. |
| Migración 0095 | Aditiva: dos enums, una tabla, FK a `companies` y dos índices. Aplicada con `db:migrate` tras comprobar el journal (`se aplicarían: ['0095_square_gladiator']`) y verificada en la base real: tabla, enums, índices, inserción, lectura y borrado de filas de prueba. |
| `pnpm exec tsc --noEmit` · `pnpm exec eslint` de los archivos tocados · `pnpm run build` | Limpios; el lint sin errores y sin warnings nuevos. |

Límites, declarados:

- **Sin V2 contra el servidor real.** El recorrido en navegador intercepta `GET`/`PUT` y `GET /api/branches`; no ejecuta Next, autenticación ni Postgres. La autorización (`ADMIN` + `settings:update`), la validación y el aislamiento por empresa quedan en pruebas unitarias sobre las rutas y el servicio reales.
- **El aislamiento se comprueba sobre el SQL, no en runtime.** La prueba renderiza cada `where` con `PgDialect` y exige `company_id` en las consultas de la orden: un mock que devuelve filas pasaría igual con o sin filtro, pero una ejecución real con dos empresas sigue sin ejercitarse —eso es C16.3.
- **La categoría del artículo es texto libre.** La comparación normaliza mayúsculas y espacios porque no existe catálogo de categorías; un artículo sin categoría no queda cubierto por reglas de categoría y el rechazo lo dice. Si el negocio quiere un catálogo, es otra tarea.
- **Sin V2 del recorrido de compras.** Nadie ha visto todavía, en el navegador, que un supervisor reciba un 403 al emitir ni que un sistema no pueda emitir; la evidencia de esa parte es la del servicio real, no la de una pantalla.
- **C16.3 pendiente.** El recorrido completo —solicitud, aprobación por matriz y emisión— con dos empresas y la conservación de órdenes ya enviadas sigue sin verificarse.

## Decisiones registradas

- **Los responsables se configuran de forma explícita; la modalidad no concede permisos.** Es la continuación de la decisión de producto del 13-10-2026 y de la clasificación `descriptiva` de C15. Deducir reglas de `CENTRALIZADA`/`POR_SUCURSAL`/`HIBRIDO` habría sido repetir H04 con otro nombre.
- **Sin reglas no significa «cualquiera puede».** Significa que esta política no añade nada y sigue decidiendo el permiso de inventario vigente. No hay siembra perezosa como en la matriz, porque una regla sembrada concede permisos que nadie eligió; la tarjeta lo dice con esas palabras.
- **La excepción es la más permisiva, no la más restrictiva.** Con dos reglas que cubren lo mismo, gana la que el actor alcanza si es más permisiva; la diferencia se avisa, no se bloquea, y el operador puede dejar una sola regla si quería dos niveles.
- **Los montos no entran aquí.** Pertenecen a la matriz de la C16.1 y a la autonomía del gerente de C20. Añadirlos a estos controles sería un segundo contrato con el mismo consumidor.
- **Sin cobertura se rechaza y se nombra el hueco.** Igual que en la matriz: lo que no cubre una regla activa no se improvisa, y el mensaje dice qué falta para que el operador sepa qué escribir.
