# Contratos de política operativa

Fecha: 12 de octubre de 2026. Seguimiento: [C14](tasks/plan-conexion-frontend-backend.md#c14).

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

## Pendiente de C15

Esta página cubre hoy los cuatro parámetros de C14. [C15](tasks/plan-conexion-frontend-backend.md#c15) añade aquí el catálogo de las siete dimensiones y el límite de caja chica, con su clasificación entre política aplicada y descripción honesta.