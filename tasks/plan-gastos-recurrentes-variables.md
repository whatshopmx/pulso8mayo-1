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

**Fases 1 y 2 implementadas** en la rama `fix/deteccion-contratos-recurrentes`. Cubren los
puntos 1, 2 y 4 de "Lo que falta": la detección está acotada por contrato, período y sucursal; la
referencia de un servicio medido sale de su propio historial; y la regla dejó de estar duplicada.
Queda el punto 3 (flujo de efectivo), con su decisión ya resuelta — ver "Decisiones" abajo.

Lo barato se había arreglado antes en la rama `fix/gastos-recurrentes-variables`:

| Arreglado | Dónde |
|---|---|
| Tolerancia superior configurable (era siempre 10%) | `treasury-service.ts`, ruta y modal |
| Tolerancia inferior, nullable (`null` = no alertar por debajo) | migración 0081 |
| Hallazgo `CONTRACT_VARIANCE_BELOW`, con su propio tipo y severidad | `control-interno-service.ts` |
| KPI prorrateado por frecuencia y renombrado a "Compromiso Recurrente" | `treasury-dashboard.tsx` |
| Factura ligada a **su** contrato (`invoices.recurring_contract_id`, migración 0082) | esquema, captura de CFDI |
| Ventana de 90 días en la detección, declarada en la UI | `recurring-contract-variance.ts`, ruta y panel |
| Una sola implementación de la regla (se borró `validateInvoiceAgainstContract`) | `treasury-service.ts` |
| Mediana móvil de 6 recibos como referencia de `SERVICIO_BASICO`, con procedencia declarada | `recurring-contract-variance.ts` |
| Hallazgo `CONTRACT_TREND_RISING` para la subida sostenida | `control-interno-service.ts`, `excepciones-panel.tsx` |

Este plan cubre lo que quedó pendiente.

## Lo que falta, y por qué

### 1. La base es un punto, no una banda, y no tiene estacionalidad — ✅ RESUELTO (Fase 2)

Un solo `base_amount_cents` no podía describir el consumo eléctrico de un
restaurante. Con tolerancias configurables el problema se mitigaba —se puede
poner ±35%— pero una banda tan ancha ya no detecta nada: una fuga de agua que
sube el consumo 30% queda dentro de la tolerancia que hizo falta para callar el
verano.

**La comparación correcta para un servicio medido no es contra un número
capturado, es contra su propio historial.** El sistema ya tiene los recibos.

**Cómo quedó.** `rollingReference` en `recurring-contract-variance.ts`: mediana de hasta 6
recibos previos de ese contrato **en esa sucursal**, con un mínimo de 3 para sustituir a la base
capturada. Sólo para `SERVICIO_BASICO` — un contrato pactado se sigue midiendo contra lo pactado,
y `MANTENIMIENTO`, aunque sea de monto variable, no es medido: una mediana de reparaciones no
predice la siguiente reparación. La procedencia se declara en cada hallazgo.

La estacionalidad contra el año anterior **no** se implementó (D2): necesita un año de historia
que casi ningún tenant tiene. La mediana móvil absorbe buena parte de ella al deslizarse.

Y el riesgo que la base móvil introduce —si el consumo sube y se queda, la mediana lo vuelve
normal— tiene su propia alerta: `CONTRACT_TREND_RISING` compara la mediana de los últimos 3
recibos contra la de los 3 anteriores y dispara aunque ninguno rebase su tolerancia.

### 2. La consulta de facturas no está acotada — ✅ RESUELTO (Fase 1)

`control-interno-service.ts:329` tomaba las últimas 5 facturas del proveedor:

- sin filtro de fecha, así que un recibo viejo se re-reporta indefinidamente;
- si el contrato es corporativo (`branchId` null) tampoco filtra por sucursal, y
  compara recibos de sucursales distintas contra la misma base;
- y no acota por contrato, así que **cada factura se mide contra todos los
  contratos del mismo proveedor**. Con dos contratos de bases distintas —una
  renta y un servicio con el mismo arrendador— toda factura dispara sobrecosto
  contra el de base menor.

Este último punto no era teórico: apareció al verificar el trabajo de arriba, y
`scripts/verify-tolerancia-recurrentes.ts` tenía que acotar sus aserciones por
título de contrato para no medirlo por accidente.

**Cómo quedó.** La detección vive ahora en `lib/services/recurring-contract-variance.ts`:
`invoices.recurring_contract_id` da la liga explícita, y cuando falta se deduce por
(proveedor, sucursal) **sólo si el candidato es único** — ante empate no se compara nada, porque
sin hallazgo es mejor que con hallazgo falso. La ventana es de 90 días acotada por los dos lados
(CFE factura bimestral; con 30 días podía no haber un solo recibo de luz), y el hallazgo se
atribuye a la sucursal *de la factura*, no a la del contrato.

### 3. El flujo de efectivo ignora los contratos recurrentes

Las salidas del proyector a 30 días vienen sólo de `OPERATING_EXPENSE`,
`PURCHASE_ORDER` y `PROCUREMENT_INVOICE` (`cash-flow-service.ts:78`). La nómina
**sí** se proyecta desde contratos; la luz, el agua y la renta no.

Así, la obligación recurrente es invisible para "¿me alcanza?" hasta que alguien
captura el recibo — que en un servicio de monto variable es justo cuando ya no
se puede hacer nada al respecto.

### 4. `validateInvoiceAgainstContract` es código muerto — ✅ RESUELTO (Fase 1)

Nadie la llamaba. La misma regla vivía duplicada en `control-interno-service` con
distinto criterio de severidad. Dos implementaciones de una regla de dinero, una
sin ejecutar, es una invitación a arreglar la equivocada.

**Cómo quedó.** Se borró. La regla es `evaluateContractVariance` en
`recurring-contract-variance.ts`, pura y sin I/O, y es la única que corre. De paso se fue un
defecto que nadie había visto: elegía contrato con `contracts.find(...) || contracts[0]`, es
decir, el primero que devolviera la base de datos.

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

## Decisiones

> **Resueltas el 2026-09-01.** D1 y D2 no se implementaron todavía (son la Fase 2), pero quedan
> cerradas para que quien la tome no vuelva a abrirlas. D3 es la Fase 3.
>
> - **D1:** ventana medida en **recibos, no en meses** — CFE factura bimestral y el agua
>   mensual, y una ventana en meses da muestras de tamaño distinto según el servicio. Por debajo
>   de 3 recibos se usa el `base_amount_cents` capturado y se declara como tal.
> - **D2:** **mediana móvil, sin estacionalidad por ahora.** La comparación contra el año
>   anterior queda fuera de alcance: un solo recibo raro del año pasado contamina la referencia
>   de este, y hace falta un año de historia que casi ningún tenant tiene.
> - **D3:** el recurrente proyectado entra con **`source` propio y apagable**, se pinta aparte
>   del comprometido real, se marca estimado cuando el monto es variable, y se suprime en cuanto
>   existe factura o gasto capturado de ese período.

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
