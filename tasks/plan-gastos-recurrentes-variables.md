# Plan: gastos recurrentes de monto variable

## Problema

`recurring_contracts` se diseñó para montos variables — la columna se llama
`base_amount_cents` con el comentario *"Monto base **esperado**"*, tiene
`variance_tolerance_percent` al lado, y el `contractType` incluye
`SERVICIO_BASICO`, que la UI rotula *"Servicios Básicos (CFE/Agua)"*. **El
modelo es correcto; el código lo trata como si fuera fijo.**

Eso importa porque en un restaurante la luz y el agua no son gastos menores ni
estables: el recibo de CFE de un local con cocina y aire acondicionado cambia
por temporada, por tarifa horaria y por lectura estimada. Un sistema que los
presenta como fijos produce dos daños concretos:

1. **Presupuesta con un número que no se va a cumplir.** El tablero de tesorería
   suma los contratos y los rotula "Gastos Fijos Recurrentes … MXN/mes".
2. **Entrena a la gente a ignorar las alertas.** Una tolerancia de ±10% sobre un
   punto fijo se rebasa cada temporada alta, así que la excepción de Control
   Interno aparece siempre y deja de significar algo.

## Estado actual (2026-09-01)

Lo barato ya se arregló en la rama `fix/gastos-recurrentes-variables`:

| Arreglado | Dónde |
|---|---|
| Tolerancia superior configurable (era siempre 10%) | `treasury-service.ts`, ruta y modal |
| Tolerancia inferior, nullable (`null` = no alertar por debajo) | migración 0081 |
| Hallazgo `CONTRACT_VARIANCE_BELOW`, con su propio tipo y severidad | `control-interno-service.ts` |
| KPI prorrateado por frecuencia y renombrado a "Compromiso Recurrente" | `treasury-dashboard.tsx` |

Este plan cubre lo que quedó pendiente.

## Lo que falta, y por qué

### 1. La base es un punto, no una banda, y no tiene estacionalidad

Un solo `base_amount_cents` no puede describir el consumo eléctrico de un
restaurante. Con tolerancias configurables el problema se mitiga —se puede poner
±35%— pero una banda tan ancha ya no detecta nada: una fuga de agua que sube el
consumo 30% queda dentro de la tolerancia que hizo falta para callar el verano.

**La comparación correcta para un servicio medido no es contra un número
capturado, es contra su propio historial.** El sistema ya tiene los recibos.

### 2. La consulta de facturas no está acotada

`control-interno-service.ts:329` toma las últimas 5 facturas del proveedor:

- sin filtro de fecha, así que un recibo viejo se re-reporta indefinidamente;
- si el contrato es corporativo (`branchId` null) tampoco filtra por sucursal, y
  compara recibos de sucursales distintas contra la misma base;
- y no acota por contrato, así que **cada factura se mide contra todos los
  contratos del mismo proveedor**. Con dos contratos de bases distintas —una
  renta y un servicio con el mismo arrendador— toda factura dispara sobrecosto
  contra el de base menor.

Este último punto no es teórico: apareció al verificar el trabajo de arriba, y
`scripts/verify-tolerancia-recurrentes.ts` tiene que acotar sus aserciones por
título de contrato para no medirlo por accidente.

### 3. El flujo de efectivo ignora los contratos recurrentes

Las salidas del proyector a 30 días vienen sólo de `OPERATING_EXPENSE`,
`PURCHASE_ORDER` y `PROCUREMENT_INVOICE` (`cash-flow-service.ts:78`). La nómina
**sí** se proyecta desde contratos; la luz, el agua y la renta no.

Así, la obligación recurrente es invisible para "¿me alcanza?" hasta que alguien
captura el recibo — que en un servicio de monto variable es justo cuando ya no
se puede hacer nada al respecto.

### 4. `validateInvoiceAgainstContract` es código muerto

Nadie la llama. La misma regla vive duplicada en `control-interno-service` con
distinto criterio de severidad. Dos implementaciones de una regla de dinero, una
sin ejecutar, es una invitación a arreglar la equivocada.

## Enfoque propuesto

**Base móvil para los servicios medidos, base pactada para los contratos
pactados.** No es la misma pregunta y no debe ser el mismo cálculo:

- Una **renta** o una **licencia** tienen un importe pactado. Ahí el
  `base_amount_cents` capturado es la verdad, y una desviación es un error de
  facturación o un aumento no avisado. Tolerancia chica, sin banda inferior.
- Un **servicio medido** (`SERVICIO_BASICO`) no tiene importe pactado. Su
  referencia debe salir del historial de recibos de esa sucursal con ese
  proveedor: mediana de los últimos N, y cuando haya un año de historia,
  comparación contra el mismo período del año anterior, que es lo único que
  captura la estacionalidad sin pedirle al usuario que capture doce números.

El `base_amount_cents` capturado no desaparece: es el arranque mientras no haya
historial suficiente, y la procedencia de la referencia se declara — igual que
el P&L declara `MEASURED` / `ESTIMATED` renglón por renglón. Un umbral que el
sistema calculó solo y uno que el dueño capturó no valen lo mismo, y la pantalla
tiene que decir cuál está usando.

## Decisiones pendientes

**D1 — ¿Cuántos recibos hacen una base móvil creíble, y qué se hace mientras no
los haya?**
Tres recibos de CFE son medio año (facturación bimestral) y ya dicen algo;
mediana de tres es robusta contra un solo outlier. Pero un tenant nuevo no tiene
ninguno. Propuesta: por debajo de 3 recibos se usa el `base_amount_cents`
capturado y se etiqueta como tal; con 3 o más, mediana móvil. Falta decidir si
la ventana se mide en recibos o en meses.

**D2 — ¿La estacionalidad se compara contra el año anterior o contra un perfil?**
Contra el mismo período del año anterior es simple y honesto, pero necesita un
año de historia y un solo recibo raro del año pasado contamina la referencia de
este. Un perfil mensual (doce factores) es más estable y mucho más caro.
Recomendación: año anterior cuando exista, mediana móvil si no, y nunca ambas
mezcladas en el mismo número.

**D3 — ¿El recurrente proyectado en el flujo de efectivo es un egreso o un
supuesto?**
Si entra como egreso normal se suma al comprometido real y el flujo deja de
distinguir lo que se debe de lo que se estima. `cash-flow-service` ya tiene el
concepto de procedencia (`InflowBasis`, `OpeningBalanceSource`); el egreso
recurrente debería entrar con su propia marca y poder apagarse.

## Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| La base móvil absorbe una fuga: si el consumo sube y se queda, la mediana lo vuelve normal | **Alto** — el sistema deja de ver justo lo que debe ver | Comparar también contra el año anterior, y alertar sobre la tendencia además del recibo |
| Cambiar la referencia mueve el histórico de excepciones | Medio | Congelar la referencia usada en el hallazgo, como hace `pnl-snapshot-service` |
| Proyectar recurrentes duplica el egreso cuando llega el recibo real | **Alto** — el flujo de efectivo miente al alza | El proyectado se apaga en cuanto existe factura o gasto del período |
| Tolerancias anchas para callar el ruido dejan de detectar fugas | Medio | Es la razón de ser de la base móvil; mientras no exista, documentarlo en la UI |

## Overlap con otros planes

| Tema | Tracker | Estado |
|---|---|---|
| Renglón de comisiones y procedencia por línea | `todo-finance-module-gaps.md` F4 | Hecho — el patrón de `LineSource` es el que conviene reusar aquí |
| Cierre de período financiero | `todo-finance-module-gaps.md` F5 | Bloqueado por D2 de ese plan (`business_date` en gastos) |
