# Pulso — Concepto "El Dinero Primero"

> **Versión alternativa del concepto para grupos restauranteros mexicanos de 3 a 15 sucursales.**
>
> Misma tesis de fondo que `pulso-thesis.md` (la operación distribuida necesita memoria y
> evidencia). Cambia el **reframe**, la **cuña de venta**, el **orden de construcción** y el
> **alcance**. No reemplaza al corpus canónico — es una propuesta de reordenamiento para
> contrastar contra `pulso-estrategia-unificada.md` §7-8 y el roadmap de
> `pulso-executive-os-v2.md` §5.
>
> **Fecha:** 2026-08-05. Estado de código verificado en esa fecha, archivo por archivo.

---

## 1. La posición

El corpus actual se posiciona como *"capa de inteligencia ejecutiva"* / *"director ejecutivo
digital"*. Eso describe el entregable, no el problema.

El dueño de 3 a 15 sucursales tiene un problema muy concreto: **el negocio funciona en
proporción inversa a su distancia física.** Cada sucursal se degrada según qué tan lejos esté él.

La banda 3-15 no es arbitraria: por debajo de 3 el dueño está presente en todas; por encima de
15 ya existe estructura corporativa que lo sustituye. **Entre 3 y 15, el dueño *es* el sistema
operativo — y ese sistema operativo no escala.**

La posición, en el idioma del comprador:

> **Tus sucursales operan igual cuando no estás. Con evidencia, no con confianza.**

Twins, engines, memoria y benchmarks son maquinaria interna. Valiosa, pero interna. No se
mencionan en una venta.

---

## 2. La cuña: el dinero, no el compliance

Aquí está la divergencia principal con el corpus, que trata NOM-251/COFEPRIS como cuña porque es
obligatorio. **Obligatorio no equivale a urgente-con-presupuesto:** el grupo mexicano ha
sobrevivido a COFEPRIS por décadas con mecanismos informales. El riesgo es real pero está
domesticado.

Lo que no está domesticado es el dinero que desaparece. La investigación de campo que ya está en
`pulso-estrategia-unificada.md` §1 lo dice: la primera frase del comprador es *"me está robando
el gerente"*; la segunda, *"la merma fue del 22%"*. Ambas son dinero.

Columna vertebral del producto:

> **Cada peso que entra y sale de cada sucursal, con evidencia, en un solo lugar.**

El compliance no desaparece: pasa de cuña a **capa de retención**. Es recurrente, tiene fechas,
crea calendario y convierte el producto en hábito diario. Pero no es lo que abre la cartera.

---

## 3. La columna vertebral: cinco features

No 17 módulos. Cinco cosas, todas dinero, todas diarias o semanales, y juntas producen los
denominadores que hacen posible todo lo demás.

Cada una con su estado real de código, verificado.

---

### 3.1 Cierre de turno con dinero — **~80% construido**

**Qué es.** El cajero cierra su turno desde el celular en 5 minutos: efectivo, tarjeta,
agregadores, número de tickets, y el **arqueo** (cuánto efectivo hay físicamente). Sale un solo
número que importa: la diferencia.

**Por qué gana.** Es el denominador de todo (sin venta no hay food cost %, ni labor %, ni P&L), y
la diferencia de caja es la respuesta a la primera frase del comprador.

**Lo que ya existe:**
- `dailySalesCuts` (`lib/db/schema.ts:2349`) — `businessDate`, `shift`, `channel`, `totalSales`,
  `cashSales`, `cardSales`, `otherPayments`, `avgTicket`, `ticketCount`, `source`, `status`, con
  índice único por `company+branch+date+shift+channel` (duplicados rechazados en ingesta).
- **Smart Link operativo** — `app/api/workflows/smart-links/corte-caja/route.ts` recibe el
  formulario del cajero e inserta el corte. Sin app, sin login, desde el celular.
- **Ingesta de POS** — `sales-ingestion-service.ts`, `/api/sales/cuts/upload`, y
  `posMappingTemplates` con mapeo de columnas *por sistema de POS* (Soft Restaurant, Aloha,
  Square, genérico) más `paymentMethodMapping`. Esto es trabajo serio y ya está hecho.
- Template `templates/finanzas/corte-caja.json`, UI en `/dashboard/sales`.

**Lo que falta (crítico):**
1. **El arqueo no existe.** No hay campo para el efectivo *contado físicamente*, ni para el
   depósito bancario. Sin eso, `cashSales` es lo que el cajero *declara* y **no hay diferencia de
   caja** — precisamente el número que detecta el faltante. Son 3 campos
   (`cashCountedCents`, `depositedCents`, `varianceCents` derivado) más un paso en el Smart Link.
2. **Los agregadores están agregados.** `salesChannelEnum` = `SALON | DELIVERY | EVENTOS | TOTAL`.
   Sin desglose por agregador no se puede conciliar la liquidación (que llega neta de comisión)
   contra la venta reportada — que es una segunda fuga, distinta del robo en caja.

---

### 3.2 Caja chica y gasto con foto — **~85% construido**

**Qué es.** Cada peso que sale, con foto del ticket y categoría, desde el celular.

**Por qué gana.** Es la feature con **mayor probabilidad de adopción de todo el producto**:
sustituye algo que ya hacen, todos los días, y lo hacen mal. Y hace visible el faltante sin
acusar a nadie — la única forma en que un dueño puede tratar el tema con un gerente al que
aprecia.

**Lo que ya existe:**
- `pettyCashFunds` (`schema.ts:2629`) — fondo, saldo actual, umbral de reposición, por sucursal.
- `pettyCashTransactions` — tipo (`OUT`/`REPLENISHMENT`/`ADJUSTMENT`), monto, concepto, categoría,
  **`evidenceUrl`** (la foto), `workflowInstanceId`, `registeredBy` / `approvedBy`.
- `expenseAuthorizationRules` — `minAmount` / `maxAmount` / `approverRole`. Doble autorización por
  monto, configurable. Esto es exactamente lo correcto y ya está.
- `petty-cash-service.ts`, `expense-service.ts`, template `retiro-caja-chica-v1.json`.

**Lo que falta (crítico, y es una columna):**
- **`operatingExpenses` no tiene `evidenceUrl`** — solo `invoiceId`. El gasto **sin CFDI** (hielo,
  ferretería, taxi, propina de descarga, el plomero) es justo el contenido de la libreta que este
  producto promete sustituir, y hoy no tiene dónde guardar la foto del ticket. Una columna
  `evidenceUrl` + el campo en el formulario.

---

### 3.3 Recepción de mercancía contra orden de compra — **~40% construido**

**Qué es.** Pesar, contar y fotografiar lo que llega, contra lo que se ordenó y al precio que se
acordó.

**Por qué gana.** Aquí **nace** la merma. Y es la otra mitad de la historia del robo: proveedor y
gerente, que a menudo son el mismo problema.

**Lo que ya existe:**
- `purchase_orders` (`schema.ts:836`) y `purchase_order_items`.
- Template `templates/inventory/recepcion-mercancia-v2-enhanced.json` — pasos con evidencia
  fotográfica, lecturas de temperatura, rechazo.
- `purchase-order-service.ts`, `supplier-claim-service.ts`.

**Lo que falta (el gap mayor de esta capa):**
- **No existe tabla de recepción.** La recepción vive como *workflow con evidencia* (fotos y
  lecturas dentro de la instancia), no como **datos estructurados** de `ordenado vs. recibido vs.
  precio pagado` por ítem. Consecuencia: no hay varianza calculable, no hay patrón por proveedor
  ("este proveedor entrega 4% menos los viernes"), y la merma sigue invisible en el punto exacto
  donde se origina. Las fotos prueban que alguien estuvo ahí; no prueban cuánto llegó.
- Es la pieza de construcción real de esta capa: tabla `goods_receipts` + `goods_receipt_items`
  ligadas a la OC, alimentadas desde el mismo workflow que ya existe.

---


### 3.4 Inventario de alto valor únicamente — **~60% construido, mal enfocado**

**Qué es.** No inventario completo. **15-30 SKUs** que son el 80% del costo de alimentos
(proteínas, quesos, alcohol). Conteo semanal. Teórico vs. real.

**Por qué gana.** El inventario completo es el cementerio de estas implementaciones: se abandona
en la semana seis. Treinta SKUs contados religiosamente valen más que trescientos contados dos
veces.

**Lo que ya existe:** `inventoryItems` (`schema.ts:675`), `stock-count-service.ts`,
`theoretical-consumption-service.ts`, `costing-service.ts`, template `conteo-inventario-v1.json`.

**Lo que falta:**
- **No hay clasificación de alto valor.** `inventoryItems` tiene solo `category` como texto libre.
  Nada en el producto dirige al cliente a contar 30 SKUs en lugar de 300 — al contrario, lo invita
  a capturar todo el catálogo en el onboarding.
- Es más **recorte de alcance que construcción**: un flag `isHighValue` (o `abcClass`), el conteo
  semanal filtrado por ese flag, y una regla de onboarding que prohíba cargar más de 30 al inicio.

---

### 3.5 P&L operativo semanal por sucursal — **construido, pero el número es falso**

**Qué es.** Ventas − COGS − nómina − gastos, por sucursal, semanal. Estimado, no contable.

**Por qué gana.** Es el artefacto que el dueño **nunca ha tenido**: saber cuál de sus cinco
sucursales gana dinero de verdad y cuál se lo come.

**Lo que ya existe:** `pnl-service.ts`, `/api/finance/pnl`,
`components/finance/pnl-branch-table.tsx` renderizado en el dashboard ejecutivo, y un
`dataCoveragePercent` + `coverageNote` honesto sobre la cobertura de **ventas**.

**El problema, y es el más grave de todo el producto:**

`lib/services/pnl-service.ts:66-71`

```ts
// Heuristic Food Cost (28.5%) & Labor Cost (26.2%)
const foodCostCents = Math.round(totalSalesCents * 0.285);
const laborCostCents = Math.round(totalSalesCents * 0.262);
```

El food cost y la nómina **no se calculan: se asumen**. El "P&L operativo por sucursal" es
literalmente `ventas × 0.453 − gastos`, lo que significa que:

- el food cost del cliente **nunca cambia**, por más que mejore su operación;
- las cinco sucursales tienen exactamente el mismo food cost %;
- el margen operativo es una constante menos gastos.

Un dueño lo detecta en la segunda semana. Y cuando lo detecta, **deja de creer en todo lo demás**
— incluido lo que sí es real. Es el mayor riesgo de credibilidad del producto entero, y no está
etiquetado como estimación en la UI.

**Lo irónico: los insumos reales ya existen.**
- Nómina real: `LaborCalculator` (`lib/services/labor-calculator.ts`, 380 líneas, con reglas de
  horas extra) sobre `shift_sessions`.
- Food cost real: `theoretical-consumption-service.ts` + `costing-service.ts` + los conteos, o en
  su defecto compras recibidas del período (3.3).

No es construir. Es **cablear** lo que ya está, y mientras no esté cableado, etiquetar el número
como estimación sectorial en la UI.

---

## 4. La secuencia: tres capas, no seis sprints

| Capa | Contenido | Se vende contra | Horizonte |
|---|---|---|---|
| **1. El dinero** | Las cinco features de §3 | *"No sé cuánto pierdo"* | Mes 0-6 |
| **2. La evidencia** | Apertura, cierre, limpieza NOM-251, temperaturas, expedientes IMSS/LFT — con foto y timestamp | *"Si mañana llega el inspector"* | Mes 6-12 |
| **3. El blueprint** | Clonar la sucursal que mejor opera hacia la siguiente | *"Quiero abrir la sexta"* | Mes 12+ |

**La inteligencia no es una capa.** Es una propiedad emergente que aparece cuando las capas 1 y 2
llevan 6-12 meses corriendo. No se vende de antemano: se descubre, y se entrega como *"esto es lo
que aprendimos de tu propia operación"*. Prometerla antes de tener los datos es la forma más
rápida de quemar credibilidad con un comprador que es escéptico por default.

Nota: la capa 3 es la que **justifica el precio por sucursal** y genera upsell automático — cada
apertura es una sucursal más facturada. Hoy no está en ningún sprint del roadmap técnico
(ver `plan-reconciliacion-docs-codigo.md`, Bloque 2).

---

## 5. Qué corto del alcance actual

| Corte | Razón |
|---|---|
| **Fiscal / timbrado CFDI propio (M15)** | Competir con CONTPAQi y Aspel en un dominio donde el error es multa, contra el contador del cliente que ya tiene flujo. **Leer** CFDI del SAT sí (conciliar factura vs OC vs recepción es valor único); **emitir**, no. |
| **Delivery y agregadores (M14) como módulo** | Reducido a "canal de venta desglosado dentro del corte". 90% del valor, 10% del trabajo. |
| **Pólizas contables automáticas (M17 parcial)** | El contador existe y tiene su sistema. Exportar, no contabilizar. |
| **8 Intelligence Engines → 3** | El principio rector (fachadas que delegan, no recalculan) es correcto y se conserva íntegro. Pero con tres —dinero, cumplimiento, personas— se cubre todo lo accionable en una mañana. Ocho engines producen más output que capacidad de decisión del cliente. |
| **Morning Brief diario → semanal al inicio** | Un dueño de 5 sucursales toma ~3 decisiones ejecutivas por semana, no 5 por día. Un brief diario que no cambia nada entrena al usuario a ignorarlo — y eso no se recupera. Diario es la meta cuando la operación ya corre sobre Pulso. |

---

## 6. El diagnóstico *es* el producto (cambio de GTM)

El corpus propone el diagnóstico gratuito de 2 horas como lead magnet ejecutado como visita de
consultor. Mi versión:

> **El diagnóstico no es una visita. Es el primer uso del software.**

Se piden tres cosas: los cortes del POS de las últimas 4 semanas, la libreta de gastos, y una
semana de recepciones. Se cargan a Pulso. Se le devuelve **el P&L por sucursal que nunca ha
visto**, con la merma real y las diferencias de caja.

Resuelve cuatro cosas de golpe:

1. Es la demo — y con **sus** datos, no con un tenant de ejemplo.
2. Es la respuesta cuantificada a *"¿cuánto pierdo?"*, que es con lo que se abre la venta.
3. Es el onboarding: al terminar el diagnóstico, el tenant ya está configurado.
4. **Es recolección de datos disfrazada de venta.**

El punto 4 rompe la circularidad que hoy tiene el modelo: la IA necesita datos de
implementaciones → las implementaciones dependen del calendario del founder → la caducidad de la
consultoría nunca llega. Si el diagnóstico produce datos estructurados **antes** de la venta, el
dataset crece con cada prospecto y no con cada cliente cerrado. **Diez diagnósticos que no
cierran siguen valiendo.**

Prerequisito: el diagnóstico solo funciona si el P&L es real (§3.5). Con food cost hardcodeado a
28.5%, el diagnóstico le devuelve al dueño un número inventado sobre sus propios datos — que es
la peor primera impresión posible.

---

## 7. Pricing: dos tiers, no tres

Por sucursal/mes en MXN — en eso el canónico acierta, y además hace que el revenue crezca solo
cuando el cliente abre sucursales.

Pero **dos tiers**, no tres: una banda de 3-15 sucursales no necesita tres niveles, y tres tiers
× 17 módulos produce una matriz que nadie puede vender en una mesa frente a un dueño.

- **Operación** — capas 1 y 2.
- **Inteligencia** — + capa 3, predicción, benchmark.

**Método de anclaje** (no cifra): el precio se ancla contra **una fracción de un punto de food
cost**, medido en la operación real del cliente durante el diagnóstico. Así el precio se justifica
con la aritmética del propio dueño y no con comparativas de mercado. La cifra concreta sale del
primer diagnóstico; no la fijo aquí porque dependería de números que todavía no tenemos.

---

## 8. La métrica única

Por encima de revenue y de "% de automatización":

> **Días consecutivos en que todas las sucursales cerraron su corte de caja sin que nadie lo
> persiguiera.**

Si crece, el sistema operativo es real, el hábito existe y ese cliente no se va. Si se queda en
dos, nada más importa — ni el morning brief, ni los engines, ni el twin. Es medible en la primera
semana de la primera implementación, sin construir nada nuevo.

---

## 9. Lo que se conserva del corpus, sin cambios

- **La observación como unidad atómica.** Correcto y estructural.
- **Las 7 dimensiones de configuración del tenant** (`tenant_config`,
  `tenant_operating_config`). La mejor pieza de ingeniería del corpus: es la respuesta
  estructural a la muerte por customización, y ya está en código.
- **WhatsApp como interfaz de campo**, no como canal de notificación.
- **La memoria de decisiones con su contrafactual.** Es lo que convierte el log en dataset.
- **Engines como fachadas** — una sola fuente de verdad por métrica (`pulso-executive-os-v2` §3).
- **El hábito del Anexo I**: auditar la propia retórica contra el código y recortarse las metas.

---

## 10. Backlog de la capa 1, ordenado

Estimaciones gruesas, para dimensionar — no compromisos.

| # | Trabajo | Por qué en esta posición | Esfuerzo |
|---|---|---|---|
| **P0** | **P&L con nómina real** (`LaborCalculator` + `shift_sessions`) y **food cost real** (consumo teórico o compras recibidas). Mientras no esté: etiquetar en la UI como *"estimado sectorial"*. | Un número inventado presentado como medido destruye la confianza en todo lo demás, y bloquea el GTM de §6 | 1-2 sem + 1 h el etiquetado |
| **P0** | **Arqueo y diferencia de caja** — `cashCountedCents`, `depositedCents`, varianza; paso extra en el Smart Link | Es la respuesta a la frase #1 del comprador, y hoy no existe | 2-3 días |
| **P0** | **`evidenceUrl` en `operatingExpenses`** + campo en el formulario | Una columna. Sin ella, el gasto sin CFDI —el contenido real de la libreta— no tiene foto | 1 día |
| **P1** | **`goods_receipts` + `goods_receipt_items`** ligadas a la OC, alimentadas desde el workflow de recepción existente | Sin varianza estructurada, la merma sigue invisible donde nace | 1-2 sem |
| **P1** | **Flag de alto valor** en `inventoryItems` + conteo semanal filtrado + regla de onboarding (máx. 30 SKUs) | Es recorte de alcance, y evita el abandono del inventario en la semana 6 | 3-4 días |
| **P2** | **Desglose por agregador** en el corte + conciliación de liquidación neta de comisión | Segunda fuga, distinta del robo en caja | 1 sem |

Nota de secuencia: los tres P0 son **días de trabajo, no semanas**, y son exactamente lo que
separa un diagnóstico creíble de uno que devuelve constantes. Esa es la razón de ponerlos antes
de cualquier engine nuevo.

---

## 11. Riesgos de esta versión (no solo de la otra)

**a) Entrar por el dinero pone al gerente a la defensiva desde el día 1.** Este es el riesgo más
serio y es de adopción, no de producto: si el gerente percibe Pulso como el instrumento con el
que el dueño va a probar que roba, sabotea la captura y el sistema muere de datos incompletos.

La contra-narrativa tiene que estar en el discurso desde la primera sesión, y es verdadera: **el
arqueo con evidencia es la coartada del gerente honesto.** Hoy, cuando falta dinero, la sospecha
se reparte entre todos y no hay forma de limpiarse. Con corte firmado y foto, el gerente que
cuadra queda protegido por escrito. Hay que vendérselo a él, no solo al dueño.

**b) El P&L operativo puede chocar con el contador.** Va a dar números distintos a los
contables (es operativo, sin IVA, estimado, semanal). Si el dueño lo interpreta como
contabilidad, el contador lo desacredita en una llamada. Hay que nombrarlo y explicarlo como
*operativo, no contable* desde la primera pantalla.

**c) Cortar fiscal/CFDI cede terreno.** Un competidor que integre contabilidad puede posicionarse
como "todo en uno". Riesgo asumido: preferible ceder ese frente que perder la credibilidad en un
dominio donde el error es multa.

**d) Dos tiers dejan menos escalones de upsell** que tres. Se compensa con el crecimiento por
sucursal (capa 3), que es un upsell mejor porque no requiere convencer de nada: llega solo cuando
el cliente crece.

---

## 12. En una línea

**El mismo Pulso, entrado por el dinero en lugar de por la inteligencia:** un tercio del alcance,
dos tiers, tres engines, un diagnóstico que es producto y no visita, y la inteligencia como
consecuencia y no como promesa.

La diferencia práctica: la versión del corpus es demostrable en una junta y tarda ~18 meses en ser
verificable con datos reales. Esta es vendible en la primera semana con datos que el cliente ya
tiene en un cajón, y llega al mismo destino —memoria operacional que nadie puede copiar— por la
ruta que además financia el camino.
