# Contratos de política operativa

Fecha: 13 de octubre de 2026. Seguimiento: [C14](../tasks/plan-conexion-frontend-backend.md#c14) y [C15](../tasks/plan-conexion-frontend-backend.md#c15).

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
| `supplierPayment` | `CENTRALIZADO` (default), `POR_SUCURSAL`, `HIBRIDO` | Descriptiva | Ninguno. No programa pagos ni modifica el método capturado del proveedor. |
| `payrollDispersion` | `CONSOLIDADA` (default), `POR_RAZON_SOCIAL`, `MIXTO` | Descriptiva | Ninguno. No agrupa corridas, exportaciones o recibos ni activa pagos automáticos. |
| `managerAutonomy` | `ALTA`, `MEDIA` (default), `BAJA` | Pendiente de decisión | No hay consumidor de esta columna. La aprobación de gastos usa reglas y montos en `rolExigidoPorMonto`; elegir `ALTA` no concede más autoridad. |
| `tenantType` | `GRUPO_PROPIO` (default), `MIXTO_FRANQUICIAS` | Pendiente de decisión | No hay consumidor de esta columna. La visibilidad de franquicias depende de `branches.ownershipType` en `lib/rbac/abac.ts` y `lib/rbac/branch-visibility.ts`. La selección no cambia ese atributo. |

### `pettyCashLimitCents` — monto de referencia de caja chica

| Aspecto | Contrato |
| --- | --- |
| Unidad y rango | Centavos enteros MXN, 0–2,147,483,647; la pantalla captura pesos |
| Alcance y permiso | Declaración del grupo; `settings/update` para editar |
| Estado en UI | Descriptiva |
| `null` | Sin monto declarado. No elimina ni modifica fondos; no representa una política de «sin tope» aplicada |
| `0` | Cero declarado. No cierra fondos ni impide aperturas, reposiciones o gastos |
| Positivo | Monto de referencia declarado. No es un máximo de apertura, de reposición o por gasto |
| Default sin fila | 500,000 centavos ($5,000 MXN) como declaración; no entrega efectivo ni crea un fondo |
| Consumidor y momento | Ningún consumidor operativo. Se guarda y se recupera al cargar configuración |
| Fondos existentes | Conservan `fund_amount`, saldo y `low_threshold`; `openFund` registra el efectivo explícitamente entregado y `registerOutflow` exige saldo suficiente |
| Excepciones | El umbral de reposición del fondo y la autorización de gastos pertenecen a contratos separados |

Los tres estados (`null`, `0`, positivo) son descriptivos. Cambiarlos no modifica efectivo ni autoriza un gasto. C23 debe decidir su relación con apertura/reposición y los fondos existentes antes de imponer una restricción.

### Decisiones pendientes por dimensión

| Tarea | Decisión necesaria antes de activar efectos |
| --- | --- |
| C16 — Compras | Quién solicita, aprueba y emite por modalidad; categorías delegables a sucursal y tratamiento de emergencias. Confirmar si continúa descriptiva. |
| C17 — Producción | Cocina abastecedora, sucursales receptoras, responsables y movimientos de envío/recepción. Confirmar si continúa descriptiva. |
| C18 — Tesorería | Cuentas permitidas, responsables de preparación/aprobación/liquidación y excepciones por modalidad. No hay una restricción acordada. |
| C19 — Proveedores | Reparto de facturas entre corporativo y sucursal, programación/aprobación e idempotencia. Confirmar si continúa descriptiva. |
| C20 — Autonomía | Relación de cada nivel con roles, montos y escalada de compras/gastos; preservar una sola política de autorización. |
| C21 — Nómina | Descripción o agrupación de exportación; entidad legal y responsables. No interpretar la selección como autorización para enviar dinero. |
| C22 — Tipo de grupo | Si sólo declara propiedad o fija el atributo de sucursales nuevas; quién captura `ownershipType` y cómo tratar sucursales existentes. |
| C23 — Caja chica | Fondo máximo, máximo por gasto o límite de aprobación; reposición, excepciones y fondos existentes. Confirmar si continúa descriptiva. |

Estas decisiones no bloquean los parámetros de C14 ni las reglas monetarias ya aplicadas. La decisión de quién revisa workflows de C05 y la excepción de auto-revisión siguen abiertas: no se resuelven mediante `managerAutonomy`.

### Cuatro umbrales monetarios que sí se aplican

Comparten permiso `settings/update`, captura en pesos y almacenamiento en centavos enteros de 0 a 2,147,483,647 o `null`. Se leen con el valor actual, sin vigencia por periodo. Los casos siguientes describen la regla consumida, no conceden permisos al usuario.

| Campo y consumidor | Dado/cuando/entonces | Excepciones y alcance |
| --- | --- | --- |
| `managerAuthLimitCents` → `rolExigidoPorMonto` en `lib/expenses/approval-policy.ts`, usado por `expense-service.ts` | Dado `null`, si el gasto no alcanza el umbral del dueño, exige `GERENTE`. Dado `0`, todo gasto no negativo exige al menos `ADMIN`. Dado un tope positivo, por debajo exige `GERENTE`; desde el tope exige `ADMIN`, salvo escalada a `OWNER`. | Grupo. Una regla explícita de autorización que cubre el monto prevalece. La segregación de funciones y los controles de acceso siguen aplicando. |
| `doubleApprovalThresholdCents` → `rolExigidoPorMonto`; `umbralesDeAutorizacion` en `control-interno-service.ts` | Dado `null`, no escala al dueño por este umbral. Dado `0`, todo gasto no negativo exige `OWNER`. Dado un umbral positivo, desde ese monto exige `OWNER`. | No es doble firma: hay un aprobador por gasto. Una regla explícita prevalece en gastos. Control interno añade un umbral positivo a la detección de fraccionamiento; no añade `0` ni `null`. |
| `emergencyPurchaseCapCents` → `validateEmergencyCap`/`evaluateEmergencyCap` en `budget-service.ts`; envío de órdenes de compra y servicio | Dado `null`, no bloquea por acumulado. Dado `0`, un documento positivo se rechaza si el total excede cero. Dado un tope positivo, acumulado + documento igual al tope se permite; mayor se rechaza con 400. | Tope del grupo atribuido por sucursal y mes de creación del documento. Sólo `EMERGENCIA`; matriz, cotizaciones y demás requisitos siguen aplicando. La lectura del tope no garantiza atomicidad de envíos concurrentes. |
| `courtesyWasteMonthlyCapCents` → `evaluateApproval` en `lib/inventory/waste-approval.ts`, usado por la ruta de aprobación de merma | Dado `null`, exige `GERENTE` sin escalar por monto. Dado `0`, un costo positivo que rebasa el acumulado exige `ADMIN`. Dado un tope positivo, hasta el tope exige `GERENTE`; al superarlo exige `ADMIN`. | Vive en `companies`. Acumulado aprobado de `STAFF`/`COURTESY` de todo el grupo. `thisLossCents === null` no escala por monto. Los controles de existencia, estado y stock de la ruta son independientes. |

### Verificación de C15

La prueba del catálogo contrasta valores con el `PUT`, referencias declaradas con sus archivos y ausencia de referencias en servicios/rutas de las entradas descriptivas. Es una comprobación estática: una referencia textual no demuestra efecto de ejecución y un escáner no detecta todos los accesos dinámicos. La inspección de los consumidores fija la semántica anterior; las pruebas de navegador comprueban clasificación, selección y guardado/recarga con respuestas controladas. El resultado y sus límites se registran en la [evidencia de C15](audits/2026-10-13-operating-policy-catalog.md).
