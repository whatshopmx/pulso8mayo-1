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
| **Aplicación** | En cada lectura, sobre el periodo que se está consultando |
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
| **Aplicación** | En cada lectura del KPI de nómina |

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
| **Aplicación** | En cada cierre de conteo, con el valor vigente en ese momento |
| **Excepciones** | El sobrante nunca genera merma, con cualquier umbral |

El conteo no mueve stock: la merma automática registra la diferencia y la aprobación humana sigue siendo el único punto que escribe ajustes.

## Vigencia y periodos cerrados (decisión de C14.3)

El criterio de C14 pide definir la vigencia **antes** de habilitar efectos históricos. Esto es lo que hace el código hoy, verificado, y lo que se decide:

**Los cuatro parámetros se aplican desde su guardado a todas las lecturas posteriores, incluidos los periodos ya cerrados.** No hay vigencia por fecha.

El motivo es que los consumidores calculan en vivo: `financial-kpi-service` y `cross-branch-service` agregan `daily_sales_cuts` y `inventory_*` en cada consulta y aplican la configuración vigente en ese momento. No consultan `financial_periods` ni `pnl_snapshots`. Cambiar el IVA hoy cambia cómo se lee el mes pasado.

Dos hechos verificados en el código sostienen este hallazgo:

- `isPeriodClosed` se usa sólo para **rechazar escrituras** en periodos cerrados (`app/api/sales/cuts/route.ts`, `expense-service.ts`), no para fijar lecturas.
- `getPnLSnapshots` **no tiene consumidores**: `closeFinancialPeriod` congela el P&L al cerrar, y ninguna vista lo vuelve a leer. El snapshot es un archivo, no una fuente de verdad vigente.

Consecuencias aceptadas y sus límites:

1. Un cambio de parámetro reinterpreta los periodos abiertos ya mostrados. Es visible en los números y ahora queda registrado en `config_change_logs` (C14.2), que es lo que permite explicarlo.
2. Los KPIs calculados en vivo no distinguen "así se vio en su momento" de "así se ve hoy". La procedencia declarada en la nota de cada renglón (`DERIVED`, `GROSS_DECLARED`, `DERIVED` en nómina) es lo que sostiene hoy esa diferencia.
3. El snapshot congelado de un periodo cerrado **sí** conserva los valores con los que se cerró, porque guarda `lines` completo. Por eso puede servir de fuente histórica cuando se implemente su lectura.

### Qué queda pendiente, y por qué no se activa aquí

Habilitar efectos históricos de verdad —que un periodo cerrado siga mostrando los números con los que se cerró— requiere dos cosas que no existen y que no caben en esta tarea:

- **Que las vistas lean el snapshot cerrado.** Hoy `getPnLSnapshots` no tiene llamadores; conectarlo cambia el comportamiento de varias pantallas y pertenece al bloque de métricas consistentes ([C29](tasks/plan-conexion-frontend-backend.md#c29)–[C31](tasks/plan-conexion-frontend-backend.md#c31)).
- **Vigencia por fecha del parámetro**, para que un periodo se calcule con la tasa que estaba vigente al cerrarse. Eso exige una tabla de histórico con vigencia y una migración, no sólo un parámetro.

Mientras tanto, la postura es la honesta: los números en vivo son números con la configuración vigente, y el historial de cambios dice quién cambió qué.

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