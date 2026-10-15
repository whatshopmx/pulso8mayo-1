# Contratos de política operativa

Fecha: 13 de octubre de 2026. Seguimiento: [C14](../tasks/plan-conexion-frontend-backend.md#c14), [C15](../tasks/plan-conexion-frontend-backend.md#c15) y [C16](../tasks/plan-conexion-frontend-backend.md#c16).

Este documento fija el contrato de cada parámetro que un operador puede cambiar desde la pantalla de **Modelo Operativo**: qué unidad usa, qué rango admite, qué significa su estado vacío, quién lo lee y desde cuándo aplica.

Las reglas se escriben a partir del código que las consume, no del nombre del campo. Un parámetro que nadie lee es documentación; uno que se lee en otra dirección es un número falso. Cada consumidor está nombrado abajo para que un cambio en el contratorompa aquí y no tres meses después en un tablero.

## Los cuatro parámetros fiscales, laborales y de merma (C14.3)

Se exposición porque los motores ya los leían sin que existiera forma de editarlos ([H05](docs/audits/2026-10-10-backend-frontend-wiring-audit.md)). Los tres primeros son tasas del grupo; el cuarto es un umbral operativo.

### `vatRatePercent` — Tasa de IVA estimada

| | |
| --- | --- |
| **Unidad** | Porcentaje sobre la venta bruta (0–100) |
| **Estado vacío (`null`)** | No estimar. La venta se toma bruta y el renglón lo declara |
| **Valor `0`** | Comportamiento idéntico a `null` en `resolveSalesBase`; se guarda como 0 capturado |
| **Alcance** | Grupo (empresa), no sucursal |
| **Permiso** | `settings/update` (administrador, owner, super admin) |
| **Consumidores** | `resolveSalesBase` (`lib/services/sales-base.ts`), que la comparten P&L, KPI financiero, costo laboral y comisiones |
| **Aplicación** | En cada lectura, con el valor vigente al cierre del periodo (ver abajo) |
| **Excepciones** | El IVA capturado por corte (`tax_amount`) manda siempre sobre la tasa: la base medida no se reestima |

El valor por defecto (16) es **un supuesto**, no un cálculo: no todos los inquilinos venden al 16%. Por eso la tasa es editable y su apagado es una decisión legítima.

### `laborBurdenFactorPercent` — Carga patronal sobre nómina bruta

| | |
| --- | --- |
| **Unidad** | Porcentaje sobre el salario bruto (0–100) |
| **Estado vacío (`null`)** | Sin factor capturado: la nómina se rotula **bruta** y el semáforo no pinta color |
| **Valor `0`** | Capturado explícitamente: total 0%, que es distinto de no capturar |
| **Alcance** | Grupo |
| **Permiso** | `settings/update` |
| **Consumidores** | `buildLaborBurden` (`lib/services/labor-burden.ts`) → ratio cargado en `labor-cost-service.ts` |
| **Aplicación** | En cada lectura del KPI de nómina, con el valor vigente al cierre del periodo |

No es un cálculo de IMSS: es un factor que pone la cifra medida en el mismo orden de magnitud que el objetivo de industria, que sí viene cargado. La interfaz lo dice así y no promete más.

### `payrollStateTaxPercent` — Impuesto estatal sobre nóminas (ISN)

| | |
| --- | --- |
| **Unidad** | Porcentaje (0–100) |
| **Estado vacío (`null`)** | No se conoce; no se suma al factor |
| **Alcance** | Grupo. **No hay** una tasa por sucursal: un grupo con sucursales en dos estados no tiene una sola tasa |
| **Permiso** | `settings/update` |
| **Consumidores** | `buildLaborBurden`, como línea propia dentro de la carga |
| **Aplicación** | En cada lectura del KPI de nómina |

Se suma al factor patronal. Si sólo hay ISN capturado, el total es ese ISN.

### `mermaVarianceThresholdPct` — Umbral de varianza para merma automática

| | |
| --- | --- |
| **Unidad** | Porcentaje de faltante entre lo contado y lo calculado (0–100) |
| **Estado vacío (`null`)** | Se usa el 5% del sistema, igual que antes de exponerlo |
| **Valor `0`** | Cualquier faltante, por pequeño, genera merma |
| **Alcance** | Grupo |
| **Permiso** | `settings/update` |
| **Consumidores** | Conteo de inventario (`stock-count-from-workflow.ts`) → fila en `inventory_waste` con origen `diferencia_conteo` |
| **Aplicación** | En cada cierre de conteo, con el umbral vigente en la fecha del conteo |
| **Excepciones** | El sobrante nunca genera merma, con cualquier umbral |

El conteo no mueve stock: la merma automática registra la diferencia y la aprobación humana sigue siendo el único punto que escribe ajustes.

## Vigencia y periodos cerrados (decisión de C14.3, implementada)

**Un periodo se calcula con los parámetros que estaban vigentes al cerrarse.** Cada parámetro se resuelve con el último cambio anterior al cierre del periodo, tomado de `config_change_logs`, que ya registra cada cambio con su fecha. El corte es el último instante del día final en UTC (`cierreDelPeriodo`).

Consecuencia práctica: cambiar el IVA hoy **no mueve los meses que ya cerraron**; sólo el periodo en curso cambia cuando se edita un parámetro.

Cómo queda repartido:

- **Lectura con fecha** — P&L (`pnl-service`), KPI financiero (`financial-kpi-service`), costo laboral (`labor-cost-service`) y conteo de merma (`stock-count-from-workflow`) pasan el cierre de su periodo a `getVatRatePercent`, `getLaborBurden` y `parametrosVigentesEn`.
- **Lectura sin fecha** — sigue devolviendo el valor actual, sin consultas extra. Es lo que usan los caminos que no tienen periodo (catálogos, configuración).

Tres decisiones de diseño que conviene no romper:

1. **La vigencia no tiene tabla propia.** `config_change_logs` es la fuente; si algún día esa tabla pierde un registro, el parámetro cae al valor actual y la lectura no falla.
2. **Si el historial no se puede leer** —una base sin la migración aplicada, un fallo puntual— se usa el valor actual en vez de propagating error. Un tablero vacío es peor que un tablero con el valor vigente.
3. **Sin historial previo, el valor de la fila es el vigente.** El primer cambio registrado es el que separa "valor original" de "valores que se fueron substituyendo".

Lo que sigue sin cubrirse:

- `getPnLSnapshots` continúa sin consumidores. El P&L congelado al cerrar el periodo es un archivo que ninguna vista lee; la vigencia por fecha de los parámetros es la que impide hoy la reescritura del pasado en los cálculos. Conectar esas lecturas sigue siendo trabajo de C29–C31.
- La consulta de vigencia cuesta **una** consulta extra por lectura con fecha (`distinct on (field_name)` sobre el índice `config_change_logs_param_idx`), no una por parámetro.
- Los objetivos de semáforo y los umbrales monetarios no tienen vigencia: se leen siempre del valor actual, porque calibran el objetivo contra el que se compara, no un hecho del periodo.

## Cómo se verifica un parámetro

Cada parámetro de esta página tiene una prueba que lo pasa por la función que lo consume y comprueba que el resultado cambia ([`tests/unit/company/financial-config.test.ts`](../../tests/unit/company/financial-config.test.ts)). Una prueba que sólo comprueba que el campo se guardó no demuestra efecto: para eso están `resolveSalesBase`, `buildLaborBurden` y `excedeUmbralMerma`.

## Añadir un parámetro aquí

1. Declarar su columna con su unidad y su semántica de `null` en el esquema.
2. Aceptarlo en el `PUT` de `/api/company/operating-config` con mensajes por campo.
3. Exponerlo en el formulario declarando qué lee y qué significa vacío.
4. Añadir el caso controlado que lo pase por su consumidor real.
5. Declararlo aquí antes de que alguien lo lea.

## Catálogo de dimensiones y caja chica (C15)

El catálogo que consume la interfaz está en [`lib/company/operating-policy-catalog.ts`](../lib/company/operating-policy-catalog.ts). C15 describe el comportamiento actual; las decisiones de C16–C23 siguen abiertas. Ninguna de las siete dimensiones cambia hoy permisos, aprobaciones, agrupaciones de nómina, visibilidad o movimientos de inventario.

La pantalla distingue tres estados:

- **Se aplica hoy:** un consumidor usa el valor para decidir. En esta sección corresponde a los cuatro umbrales monetarios descritos abajo.
- **Descriptiva:** se guarda y se recupera al abrir configuración. No restringe la operación. Puede tener una decisión de negocio abierta para una futura aplicación.
- **Pendiente de decisión:** se guarda como descripción; existe un recorrido relacionado, pero falta acordar cómo esta dimensión lo modificaría. Hoy tampoco aplica una restricción.

### Contrato común de las siete dimensiones

| Aspecto | Contrato |
| --- | --- |
| Alcance | Empresa/grupo seleccionado en sesión; no configuración individual por sucursal |
| Escritura | `PUT /api/company/operating-config`, con sesión y permiso `settings/update` |
| Valores | Sólo los enums de la tabla siguiente; `null` y cadena vacía se rechazan |
| Campo omitido | Se conserva el valor anterior; no significa borrar ni volver al default |
| Empresa sin fila | `getTenantOperatingConfig` devuelve los defaults de módulo; el primer guardado crea la fila |
| Aplicación actual | Persistencia y presentación del valor; la actualización invalida la caché de configuración |
| Vigencia | No hay efecto por periodo ni transición de documentos históricos; la selección no reescribe compras, pagos, fondos ni propiedad de sucursales |
| Excepciones | Los permisos y políticas existentes de cada recorrido siguen aplicando; ninguna selección los evita |

Cada valor de la tabla queda **clasificado como descriptivo en su comportamiento actual**, incluidos los campos cuyo estado de interfaz es «Pendiente de decisión». Para todos ellos: dado un valor válido y permiso de configuración, cuando se guarda y se recarga, entonces vuelve la misma selección; no se deduce un efecto operativo de su nombre.

| Campo | Valores y default | Estado en UI | Consumidor operativo actual y límites |
| --- | --- | --- | --- |
| `purchasingStructure` | `CENTRALIZADA` (default), `POR_SUCURSAL`, `HIBRIDO` | Descriptiva | Ninguno. No cambia quién solicita, aprueba o emite una compra. El tope de emergencias y la matriz de aprobación son independientes. |
| `foodProduction` | `IN_SITU` (default), `COCINA_CENTRAL`, `MIXTO` | Descriptiva | Ninguno. No crea abastecimientos, traspasos ni movimientos de recetas/inventario. El umbral de merma automática es independiente. |
| `treasuryModel` | `CUENTA_UNICA` (default), `CUENTA_POR_SUCURSAL`, `MIXTO` | Descriptiva | Ninguno. No elige cuentas ni limita preparación, aprobación o liquidación de corridas de tesorería. |
| `supplierPayment` | `CENTRALIZADO` (default), `POR_SUCURSAL`, `HIBRIDO` | Descriptiva | Ninguno. El pago se decide en la corrida de tesorería. La columna no programa pagos ni modifica el método capturado del proveedor. |
| `payrollDispersion` | `CONSOLIDADA` (default), `POR_RAZON_SOCIAL`, `MIXTO` | Descriptiva | Ninguno. No agrupa corridas, exportaciones o recibos ni activa pagos automáticos. |
| `managerAutonomy` | `ALTA`, `MEDIA` (default), `BAJA` | Se aplica hoy | Aplica en la resolución y autorización de gastos ordinarios en `rolExigidoPorMonto` (`lib/expenses/approval-policy.ts` y `expense-service.ts`). En `BAJA`, el gerente no resuelve gastos (exige `ADMIN`); en `ALTA`, resuelve gastos ordinarios hasta el umbral de dueño; en `MEDIA`, resuelve hasta `managerAuthLimitCents`. El umbral de dueño (`doubleApprovalThresholdCents`) y la segregación de funciones (A16) se preservan transversalmente. |
| `tenantType` | `GRUPO_PROPIO` (default), `MIXTO_FRANQUICIAS` | Se aplica hoy | Se lee en la Liga de Sucursales: `segmentaRed` (`lib/company/tenant-network-policy.ts`) decide si el consolidado se mide como una red o dos, y `CrossBranchService.getBranchQSRRanking` promedia, rankea y detecta anomalías dentro de cada red. No concede permisos: `branchVisibilityFilter` acota las sucursales visibles antes de agregar. La propiedad de cada sucursal sigue siendo `branches.ownershipType`; una franquicia nunca entra en el promedio de la red propia y la contradicción queda declarada. |

### `pettyCashLimitCents` — fondo fijo de caja chica por sucursal

| Aspecto | Contrato |
| --- | --- |
| Unidad y rango | Centavos enteros MXN, 0–2,147,483,647; la pantalla captura pesos |
| Alcance y permiso | Declaración del grupo; `settings/update` para editar |
| Estado en UI | Se aplica hoy |
| `null` | Sin tope de grupo declarado. No impone tope en `openFund`; permite cualquier monto autorizado positivo |
| `0` | Cero declarado. Caja chica deshabilitada en el grupo: rechaza aperturas y reposiciones de fondos |
| Positivo | Monto máximo corporativo del fondo fijo por sucursal. En `openFund`, `fundAmountCents <= pettyCashLimitCents`. En `replenishFund`, la reposición no puede exceder el fondo fijo autorizado (`currentBalance + amount <= fundAmount`) |
| Default sin fila | 500,000 centavos ($5,000 MXN) como tope corporativo por sucursal |
| Consumidor y momento | `validarAperturaFondo` y `validarReposicionFondo` (`lib/finance/petty-cash-policy.ts`) consumidos por `openFund` y `replenishFund` en `lib/services/petty-cash-service.ts` |
| Fondos existentes | Conservan su fondo asignado y saldo operativo. Los retiros (`registerOutflow`) se validan contra el saldo disponible en caja y exigen comprobante |
| Excepciones | Distinción tripartita: límite de fondo (corporativo), límite de retiro (saldo en caja) y límite de aprobación (gastos corporativos en cuentas por pagar) son independientes |

El contrato distingue claramente tres niveles de límite:
1. **Límite de Fondo (`pettyCashLimitCents`):** Regla corporativa en `tenant_operating_config`. Acota la apertura y reposición de fondos de caja chica por sucursal.
2. **Límite de Retiro (`currentBalance`):** Saldo físico en caja. Todo retiro en `registerOutflow` exige `currentBalance >= amountCents` y comprobante adjunto.
3. **Límite de Aprobación (`managerAuthLimitCents` / `doubleApprovalThresholdCents` / `managerAutonomy`):** Escalera de cuentas por pagar para compras y facturas corporativas. Ortogonal a la caja chica física.

### Decisiones pendientes por dimensión

| Tarea | Decisión necesaria antes de activar efectos |
| --- | --- |
| C16 — Compras | **Resuelto el 13-10-2026 (C16.2).** Los responsables se configuran de forma explícita —matriz de aprobación para quién aprueba, controles de delegación para quién solicita y emite— y la modalidad no concede permisos. Sigue abierta una pregunta: si una compra de emergencia puede saltarse algún control, y con qué condición. |
| C17 — Producción | Cocina abastecedora, sucursales receptoras, responsables y movimientos de envío/recepción. Confirmar si continúa descriptiva. |
| C18 — Tesorería | Cuentas permitidas, responsables de preparación/aprobación/liquidación y excepciones por modalidad. No hay una restricción acordada. |
| C19 — Proveedores | **Resuelto el 14-10-2026 (C19) en una de sus tres partes.** Una factura, gasto o nómina se agenda una vez y sólo mientras debe pagarse. Siguen abiertas dos: quién programa y aprueba cada pago por modalidad, y cómo se reparten las facturas entre corporativo y sucursal. |
| C20 — Autonomía | **Resuelto el 14-10-2026 (C20).** Se aplica en la escalera de autorización de gastos (`lib/expenses/approval-policy.ts` y `expense-service.ts`) combinando los tres niveles (ALTA, MEDIA, BAJA) con los umbrales monetarios existentes y la segregación de funciones (A16). |
| C21 — Nómina | Descripción o agrupación de exportación; entidad legal y responsables. No interpretar la selección como autorización para enviar dinero. |
| C22 — Tipo de grupo | **Resuelto el 15-10-2026 (C22).** `tenantType` segmenta las redes en la Liga de Sucursales y panel ejecutivo (`segmentaRed`), reportando contradicciones si un grupo propio tiene franquicias capturadas sin alterar el aislamiento de datos. |
| C23 — Caja chica | **Resuelto el 15-10-2026 (C23).** Se aplica la distinción tripartita de límites: fondo corporativo (`pettyCashLimitCents`), saldo físico en caja (`currentBalance`) y escalera de autorización corporativa (`managerAuthLimitCents`/`doubleApprovalThresholdCents`). Cero deshabilita, `null` es sin tope corporativo y positivo limita apertura y reposición. Fondos existentes conservan su saldo. |

Estas decisiones no bloquean los parámetros de C14 ni las reglas monetarias ya aplicadas. La decisión de quién revisa workflows de C05 y la excepción de auto-revisión siguen abiertas: no se resuelven mediante `managerAutonomy`.

### Cinco umbrales monetarios que sí se aplican

Comparten permiso `settings/update`, captura en pesos y almacenamiento en centavos enteros de 0 a 2,147,483,647 o `null`. Se leen con el valor actual, sin vigencia por periodo. Los casos siguientes describen la regla consumida, no conceden permisos al usuario.

| Campo y consumidor | Dado/cuando/entonces | Excepciones y alcance |
| --- | --- | --- |
| `managerAuthLimitCents` → `rolExigidoPorMonto` en `lib/expenses/approval-policy.ts`, usado por `expense-service.ts` | Dado `null`, si el gasto no alcanza el umbral del dueño, exige `GERENTE`. Dado `0`, todo gasto no negativo exige al menos `ADMIN`. Dado un tope positivo, por debajo exige `GERENTE`; desde el tope exige `ADMIN`, salvo escalada a `OWNER`. | Grupo. Una regla explícita de autorización que cubre el monto prevalece. La segregación de funciones y los controles de acceso siguen aplicando. |
| `doubleApprovalThresholdCents` → `rolExigidoPorMonto`; `umbralesDeAutorizacion` en `control-interno-service.ts` | Dado `null`, no escala al dueño por este umbral. Dado `0`, todo gasto no negativo exige `OWNER`. Dado un umbral positivo, desde ese monto exige `OWNER`. | No es doble firma: hay un aprobador por gasto. Una regla explícita prevalece en gastos. Control interno añade un umbral positivo a la detección de fraccionamiento; no añade `0` ni `null`. |
| `emergencyPurchaseCapCents` → `validateEmergencyCap`/`evaluateEmergencyCap` en `budget-service.ts`; envío de órdenes de compra y servicio | Dado `null`, no bloquea por acumulado. Dado `0`, un documento positivo se rechaza si el total excede cero. Dado un tope positivo, acumulado + documento igual al tope se permite; mayor se rechaza con 400. | Tope del grupo atribuido por sucursal y mes de creación del documento. Sólo `EMERGENCIA`; matriz, cotizaciones y demás requisitos siguen aplicando. La lectura del tope no garantiza atomicidad de envíos concurrentes. |
| `courtesyWasteMonthlyCapCents` → `evaluateApproval` en `lib/inventory/waste-approval.ts`, usado por la ruta de aprobación de merma | Dado `null`, exige `GERENTE` sin escalar por monto. Dado `0`, un costo positivo que rebasa el acumulado exige `ADMIN`. Dado un tope positivo, hasta el tope exige `GERENTE`; al superarlo exige `ADMIN`. | Vive en `companies`. Acumulado aprobado de `STAFF`/`COURTESY` de todo el grupo. `thisLossCents === null` no escala por monto. Los controles de existencia, estado y stock de la ruta son independientes. |
| `pettyCashLimitCents` → `validarAperturaFondo` y `validarReposicionFondo` en `lib/finance/petty-cash-policy.ts`, usado por `petty-cash-service.ts` | Dado `null`, permite abrir fondo sin tope de grupo. Dado `0`, la caja chica está deshabilitada y rechaza aperturas y reposiciones. Dado un tope positivo, al abrir `fundAmountCents <= pettyCashLimitCents` y al reponer el saldo no puede superar el fondo fijo autorizado. | Grupo en la política, sucursal en el fondo. Retiros limitados al saldo disponible en caja con comprobante. No sustituye la escalera de cuentas por pagar. |

### Controles de solicitud y emisión de compras (C16.2)

La primera política que el proyecto aplica a partir de una decisión escrita aquí. Vive en `purchase_delegation_rules` (`lib/purchasing/delegation-policy.ts`), se configura en Configuración operativa y se aplica en el recorrido de compras. Queda registrada en el catálogo como `aplicada` con su consumidor: un control que el contrato no menciona sería el defecto de H04 al revés, código aplicando una regla que nadie escribió.

| Aspecto | Contrato |
| --- | --- |
| Qué decide | Quién puede **solicitar** (crear requisición u orden en borrador) y quién puede **emitir** (enviar la orden aprobada al proveedor). No decide quién aprueba: eso es la matriz de la C16.1 |
| Valores | Una regla por acción (`REQUEST`/`EMIT`), alcance (`COMPANY`/`BRANCH`/`CATEGORY`), rol exigido y `active` |
| Coherencia | `BRANCH` exige sucursal; `CATEGORY` exige la categoría del artículo; `COMPANY` no admite ninguna de las dos. Una sucursal que no sea de la empresa se rechaza al guardar |
| Alcance | Empresa de la sesión; `branchId` nunca viene del cuerpo del `PUT` |
| Permiso | `settings:update` **y** rol `ADMIN` o superior |
| Sin reglas | No hay control adicional y decide el permiso de inventario vigente. Es el comportamiento previo a C16.2, no una puerta abierta por omisión: no hay siembra perezosa como en la matriz, porque aquí una regla concede permisos |
| Con reglas | Hace falta al menos una regla activa que cubra la operación y cuyo rol exigido alcance al actor. Varias reglas que cubren: gana la más permisiva que el actor alcance |
| Sin cobertura | Si las reglas existen y ninguna cubre la sucursal o la categoría, se rechaza nombrando el hueco. No se imputa la regla más cercana |
| Actor de sistema | Puede dejar un borrador —una sugerencia del PAR— y nunca emitir, con controles o sin ellos |
| Montos | No se consultan aquí: pertenecen a la matriz (C16.1) y a la autonomía del gerente (C20) |
| Vigencia | Se leen al intentar la acción. Cambiar un control no reescribe solicitudes ni órdenes ya emitidas |
| Excepciones | La matriz de aprobación, el presupuesto, el tope de emergencias y la transición de estados siguen aplicando; ningún control los evita |

Casos que la tabla no cubre, y por qué: la categoría del artículo es texto libre (`inventory_items.category`), así que la comparación normaliza mayúsculas y espacios y **no** puede exigir un catálogo que no existe; un artículo sin categoría no queda cubierto por reglas de categoría. Dos reglas activas sobre el mismo ámbito se permiten con aviso, porque la más permisiva gana y la otra queda muerta: es confuso de leer, no roto.

### La obligación agendada una vez (C19)

La segunda regla que el proyecto aplica a partir de una decisión escrita aquí. No viene de una columna de configuración: viene de una pregunta que el catálogo tenía abierta —*cómo se evitan pagos duplicados*— y que resultó tener respuesta en el recorrido, no en `supplierPayment`.

**El pago a un proveedor no tiene máquina de estados propia.** Se decide dentro de la corrida de tesorería, que es el mismo recorrido que C18 acotó por rol:

| Paso | Ruta | Qué hace |
| --- | --- | --- |
| Programar | `POST /api/finance/treasury/runs/[id]/items` | `assertCounterpartyPayable` valida empresa, contraparte y CLABE, y **C19** añade que la obligación sea agendable y no esté ya agendada |
| Aprobar y dispersar | `PATCH /api/finance/treasury/runs/[id]/status` | Los pasos que mueven dinero exigidos por `lib/treasury/disbursement-policy.ts` |
| Liquidar | `POST .../items/[itemId]/settle` | Marca la partida y **saldarDocumentosDePartidas** salda sus facturas y gastos |
| Descargar | `GET /api/finance/treasury/runs/[id]/layout` | Un renglón SPEI por partida |

La liquidación usa `saldarDocumentosDePartidas` para reflejar el pago en la factura. C19 conserva ese recorrido y su máquina de estados.

| Aspecto | Contrato |
| --- | --- |
| Qué decide | `puedeAgendar` en `lib/treasury/scheduling-policy.ts` (módulo puro) aplicado por `addItemToRun` |
| Regla | Una obligación —el par (tipo de partida, referencia)— se agenda **una vez** y sólo mientras el documento debe dinero |
| Documento no pagable | Factura `PAID` o `CANCELLED`, gasto `PAID`: se rechaza nombrando el estado |
| Obligación ya retenida | Se rechaza nombrando la corrida que la retiene y su estado. Cancelarla la libera si la máquina de estados admite la cancelación; `PROCESSING` y `COMPLETED` no se cancelan |
| Misma corrida | Se rechaza y se pide revisar las partidas; no se promete una acción para eliminar que la pantalla no ofrece |
| Carrera | La comprobación y el alta ocurren en la misma transacción con `FOR UPDATE` sobre corrida y documento. Se repiten estado, pertenencia, monto y contraparte dentro de la transacción; una segunda alta lee la primera confirmada |
| Alcance | Empresa de la sesión. Las corridas de otra empresa ni retienen ni bloquean |
| Tipos sin documento pagable | Impuestos y reposiciones se serializan por empresa/tipo/referencia con `pg_advisory_xact_lock`. `OTHER` sigue rechazado por la validación de contraparte |
| Fondo recurrente | Una reposición `COMPLETED` libera el fondo para futuras reposiciones; las corridas abiertas lo retienen. El cierre de una factura, gasto o nómina sigue reteniendo su documento |
| Interfaz | Los tres listados «para pagar» excluyen lo que ya es partida de una corrida viva, de modo que el doble pago deja de poder provocarse desde la pantalla |
| Lote parcial | Se retiran sólo éxitos, se conserva selección de rechazados y se muestra cuenta exacta y motivos. Reintentar manda sólo los fallidos; cero éxitos no se anuncia como éxito |
| Excepciones | El filtro de rol de C18, la CLABE verificada, la discrepancia de 3-Way Match y la máquina de transiciones siguen aplicando; esta regla no los evita |

No se reparan automáticamente duplicados históricos ni se crea un recorrido de pagos parciales. Los listados son una lectura; la decisión definitiva se repite al agregar. [Evidencia de C19](audits/2026-10-14-pago-proveedores.md).

### La política de autonomía del gerente (C20)

La tercera política que el proyecto aplica a partir de una decisión escrita aquí. Conecta la dimensión `managerAutonomy` de `tenant_operating_config` directamente con la resolución y autorización de gastos en `rolExigidoPorMonto` (`lib/expenses/approval-policy.ts`) y su consumidor autoritativo en `expense-service.ts` (`approveOperatingExpense` y `rejectOperatingExpense`).

| Aspecto | Contrato |
| --- | --- |
| Qué decide | Quién tiene facultad para aprobar o rechazar un gasto operativo ordinario de la sucursal cuando no existe una regla explícita en `expense_authorization_rules`. |
| Niveles y comportamiento | **`BAJA`**: el gerente no tiene autoridad de aprobación ni rechazo (exige al menos `ADMIN`), centralizando el control en corporativo.<br>**`ALTA`**: el gerente está facultado para resolver gastos ordinarios de su sucursal hasta el umbral del dueño, sin escalada intermedia a `ADMIN`.<br>**`MEDIA`** (default): aplica la escalera monetaria estándar (`< managerAuthLimitCents` resuelve `GERENTE`, `>= managerAuthLimitCents` escala a `ADMIN`). |
| Umbral de dueño | La escalada a `OWNER` por `doubleApprovalThresholdCents` es obligatoria y transversal en todos los niveles de autonomía: ningún nivel (ni siquiera `ALTA`) exime de aprobación ejecutiva a gastos mayores o iguales a este umbral. |
| Segregación de funciones (A16) | Prevalece de forma absoluta sobre cualquier nivel de autonomía: quien registra un gasto no puede aprobarlo ni rechazarlo (`SELF`), sin importar si la autonomía es `ALTA`. Sólo ejecutivos `OWNER` o `SUPER_ADMIN` están exentos de auto-bloqueo. |
| Aislamiento de sucursal | Un gerente acotado por rol o sucursal no puede resolver gastos de otra sucursal (`assertScopeCoversBranch`). |
| Aislamiento multi-tenant | Las operaciones verifican rigurosamente la empresa del gasto y del contexto; intentos cruzados entre empresas devuelven 404 (NotFound). |
| Dinamismo | Se consulta en caliente desde `tenant_operating_config`; actualizar la configuración surte efecto inmediato en las siguientes autorizaciones sin requerir migraciones ni dejar estados inconsistentes. |

[Evidencia de C20](audits/2026-10-14-autonomia-gerente.md).

### Verificación de C15

La prueba del catálogo contrasta valores con el `PUT`, referencias declaradas con sus archivos y ausencia de referencias en servicios/rutas de las entradas descriptivas. Es una comprobación estática: una referencia textual no demuestra efecto de ejecución y un escáner no detecta todos los accesos dinámicos. La inspección de los consumidores fija la semántica anterior; las pruebas de navegador comprueban clasificación, selección y guardado/recarga con respuestas controladas. El resultado y sus límites se registran en la [evidencia de C15](audits/2026-10-13-operating-policy-catalog.md).
