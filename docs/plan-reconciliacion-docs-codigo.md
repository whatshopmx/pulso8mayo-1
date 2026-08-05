# Plan de Reconciliación — Documentos ↔ Código

> **Objetivo:** cerrar los cinco desalineamientos detectados al cruzar el corpus estratégico
> (`pulso-thesis`, `pulso-estrategia-unificada`, `pulso-diseno-grupo-restaurantero` v2,
> `platform-vision`, `pulso-executive-os-v2`) contra el código real.
>
> **Origen:** auditoría del 2026-08-05. Ninguno de los cinco hallazgos es un error de tesis;
> son fallas de coordinación entre documentos, y una de ellas ya tiene código vivo en producción
> que contradice al documento canónico.
>
> **Documento canónico de negocio:** `docs/pulso-estrategia-unificada.md` (§7 pricing manda).
> **Documento canónico técnico:** `docs/pulso-executive-os-v2.md`.

---

## Cómo leer este plan

Cada bloque tiene **decisiones** (requieren al owner; nadie más puede resolverlas) y **tareas**
(mecánicas, una vez decidido). No ejecutar las tareas de un bloque antes de cerrar su decisión.

Las decisiones pendientes están resumidas al final, en un solo lugar.

| Bloque | Qué reconcilia | Urgencia | Esfuerzo |
|---|---|---|---|
| 1 | Tiering: **cuatro** taxonomías, una ya en código | 🔴 Alta — hay código vivo divergente | Decisión + 1-2 días |
| 2 | Los dos "twins" con nombres colisionados | 🟡 Media — riesgo en demo de venta | 2 horas |
| 3 | Anexo I desactualizado a 3 días de escrito | 🟡 Media — bloquea decisión de octubre | 3-4 horas |
| 4 | Secuencia: Executive OS vs. clientes cero | 🟠 Alta — decisión de negocio, no de código | Decisión |
| 5 | Métrica `confidence > 80` no evaluable | 🟢 Baja | 1 hora |
| 6 | Bifurcación del schema (`schema.ts` vs `schema/`) | 🟢 Baja — deuda que crece | Anotar |

---

## Bloque 1 — Tiering: hay cuatro taxonomías, y la que está en código es la que ningún doc menciona

### El hallazgo

Los documentos definen tres taxonomías distintas. El código tiene una **cuarta**, y es la única
que existe de verdad:

| Fuente | Tiers | Unidad de cobro | Precio |
|---|---|---|---|
| `pulso-estrategia-unificada.md` §7 (**canónico**) | Core / Professional / Intelligence | **por sucursal/mes** | $1,500 / $2,500 / $3,500 MXN |
| `pulso-diseno-grupo-restaurantero.md` §16 | Starter / Growth / Scale | por nº de sucursales (3-5 / 6-10 / 11-15+) | no define precio |
| `pulso-executive-os-plan.md` §9.2 (v1, superada) | Foundation / Growth / Executive | no define | no define |
| **`lib/services/billing-service.ts` (CÓDIGO VIVO)** | **FREE / BASIC / PRO / ENTERPRISE** | **por company/mes** | **$0 / 2900 / 7900 cents / "contact sales"** |

Lo verificado en código:

- `lib/services/billing-service.ts:5-50` — constante `PLANS` con los 4 planes, límites de
  `branches` / `users` / `storage`, y features en inglés (`'AI Verification'`, `'API Access'`).
- `lib/db/schema/core.ts:18-20` — `companies.plan` (default **`'FREE'`**),
  `companies.billing_status` (default `'ACTIVE'`), `companies.stripe_customer_id`.
- `app/api/billing/route.ts` — GET devuelve el plan, POST llama `BillingService.subscribe()`.
  La suscripción es **mock**: escribe `companies.plan` directo, sin tocar Stripe
  (`generatePortalLink` devuelve una URL de test hardcodeada).

### Por qué es urgente y no cosmético

1. **La unidad de cobro está invertida.** El canónico cobra **por sucursal**; el código cobra
   **por company**. No es un renombrado: cambia el revenue de un grupo de 5 sucursales de
   $12,500 MXN/mes (Professional × 5) a $79 USD/mes (PRO). Dos órdenes de magnitud.
2. **El default `FREE` limita a 1 sucursal** en un producto que se vende a grupos de 3-15.
   Hoy es inofensivo porque `BillingService.checkLimit()` **no tiene ningún caller** — el límite
   está definido pero no se aplica. En el momento en que alguien lo conecte, todos los tenants
   existentes quedan fuera de límite de golpe.
3. **El plan Executive OS §9.1 propone crear tablas nuevas** (`subscription_tiers`,
   `company_subscriptions`) ignorando que el estado del plan ya vive en `companies`. Construirlo
   tal cual deja dos fuentes de verdad de suscripción.

### Decisión requerida (D1)

Elegir **una** taxonomía y **una** unidad de cobro, y declararla en el canónico.

**Recomendación:** conservar **Core / Professional / Intelligence, por sucursal/mes, en MXN**
— es el canónico, es coherente con el argumento estratégico ("el precio por sucursal comunica
que somos infraestructura, como pagar por servidor en AWS"), y es el único con precios
públicos ya definidos y justificados. El diseño §16 (Starter/Growth/Scale) **no compite**:
describe qué módulos activa cada tamaño de grupo, así que se reexpresa como mapeo
`tamaño → tier` en lugar de como una tercera taxonomía.

Alternativa real a considerar: si ya hay algún cliente o demo apuntando a `FREE`/`PRO`,
migrar los valores existentes tiene costo. Verificar primero:

```sql
select plan, billing_status, count(*) from companies group by 1, 2;
```

### Tareas (post-D1)

1. **Reescribir `PLANS`** en `billing-service.ts` con los tiers canónicos, precios en MXN y
   `unit: 'branch'`. Mantener `ENTERPRISE`/custom si se quiere el cuarto nivel de
   `platform-vision` §10 — pero entonces añadirlo al canónico, no dejarlo solo en código.
2. **Migrar los valores de `companies.plan`** (`FREE`→`CORE`, `BASIC`→`CORE`, `PRO`→`PROFESSIONAL`,
   `ENTERPRISE`→`ENTERPRISE`) con una migración de datos, no con `db:push`.
3. **Corregir el cálculo:** el precio de un tenant es `tier.pricePerBranchCents × nº de sucursales
   activas`. Hoy `getCompanyPlan` devuelve un precio plano.
4. **No crear `subscription_tiers` / `company_subscriptions`** (Executive OS §9.1) sin antes
   decidir si reemplazan o envuelven `companies.plan`. Si se crean, `companies.plan` debe pasar a
   ser columna derivada o eliminarse — nunca coexistir como segunda verdad.
5. **Marcar explícitamente que el billing es mock.** Añadir un `TODO` y un banner en
   `/api/billing` o en la UI que lo consuma: hoy cualquiera puede auto-asignarse `ENTERPRISE`
   con un POST, sin pago. Es un agujero de negocio, no de seguridad.
6. **Actualizar el diseño §16** para que sus tres tamaños mapeen a los tres tiers canónicos,
   con la matriz módulo × tier explícita (hoy los módulos por tamaño y los tiers de precio
   viven en documentos distintos y nadie los cruza).
7. **Resolver la contradicción de packaging de IA:** el plan v1 pone `morning_brief` y
   `basic_ai` en el tier más bajo; el canónico vende predicciones y AI recommendations en
   Intelligence (el más caro, +133% sobre Core). Definir en qué tier cae el Morning Brief
   **antes** de construirlo (Sprint 3), porque determina si es feature de retención o de upsell.

---

## Bloque 2 — Los dos "twins"

### El hallazgo

Dos conceptos distintos comparten nombre, y uno se vende como si fuera el otro:

| | **Digital Twin** (pitch) | **Operational / Corporate / Executive Twin** (código) |
|---|---|---|
| Qué es | Plantilla clonable de una operación | Estado vivo agregado (scores, riesgos, drift) |
| Promesa | Abrir la sucursal #6 heredando la #1 | Ver la salud del grupo en una pantalla |
| Dónde vive | `pulso-thesis` §6, diseño §5, estrategia §13.1 | `operationalTwins`, `corporateTwins`, `ExecutiveTwinEngine` |
| Estado | ❌ No existe (lo dice el Anexo I) | ✅ Existe, en Sprint 2 |

Verificado: el string `digital twin` **no aparece en el código** — solo en docs. La confusión
es puramente documental, pero es la promesa más vendible del pitch ("la sucursal #6") y la que
más fácilmente se da por cubierta al ver `ExecutiveTwinEngine` funcionando.

### Tareas

1. En `pulso-thesis.md` §6 y diseño §5, renombrar el concepto de pitch a **"Operating
   Blueprint"** (o el término que se prefiera) reservando "Twin" para el estado vivo. Añadir una
   nota de una línea: *"no confundir con los `operational_twins` / `corporate_twins` del
   sistema, que modelan estado, no plantilla clonable."*
2. En `pulso-executive-os-v2.md` §6.2, añadir la aclaración inversa: el Executive Twin **no**
   cumple la promesa de apertura de sucursal.
3. Añadir el Operating Blueprint como ítem explícito del roadmap (hoy no está en ningún sprint
   del plan técnico, pese a ser promesa de venta).

---

## Bloque 3 — El Anexo I quedó desactualizado en tres días

### El hallazgo

El Anexo I de `pulso-estrategia-unificada.md` está fechado **2026-08-02** y es la base de la
decisión de octubre. Su §13.4 lista como bloqueadores del Sprint 3 (clientes cero) un
"Sprint 2.5 — Fondo de pozo" con T9, T10, T27, T28, T34, T35. Verificado el 2026-08-05:

| Ítem del Anexo | Lo que dice el Anexo | Lo verificado en código |
|---|---|---|
| T27+T28 — ingesta corte POS | 🔵 "solo schema, falta servicio, API, UI" (3-4 semanas) | ✅ `daily_sales_cuts`, `sales-ingestion-service.ts`, `/api/sales/cuts`, `/api/sales/cuts/upload`, `/api/sales/mapping-templates`, `/dashboard/sales` |
| T34+T35 — caja chica y gastos | ⏳ "**no existe — ni schema**" (3 semanas) | ✅ `petty_cash_funds`, `petty_cash_transactions`, `operating_expenses`, `expense_authorization_rules`, `petty-cash-service.ts`, `expense-service.ts` |
| T40 — P&L por sucursal | ⏳ "no existe", bloqueado | ✅ `pnl-service.ts`, `/api/finance/pnl`, `components/finance/pnl-branch-table.tsx` (renderizado en el dashboard ejecutivo) |
| T9+T10 — WhatsApp turno/ausencia | 🟡 "faltan" (1 semana) | ⚠️ **No concluyente.** Existen `labor-workflows.ts`, `announcement-broadcast.ts` y `emergency-departure-handler.ts` (nuevo, sin commitear). Requiere verificación dirigida. |
| Portal de externos / contador (T17) | ⏳ no existe | No verificado |

Consecuencia: **el bloqueo que el Anexo pone al arranque de clientes cero probablemente ya está
levantado**, y el "Sprint 2.5" que manda ejecutar en semanas 4-12 puede ser trabajo ya hecho.
Si nadie lo actualiza, la revisión de octubre se toma con un mapa de agosto.

### Tareas

1. Verificación dirigida de T9/T10 (¿existe notificación WhatsApp de cambio de turno y de
   ausencia, disparada por evento?) y de T17 (portal de externos).
2. Reescribir la tabla de §13.4 con el estado real y fecha `2026-08-05`.
3. Recalcular la conclusión: si el fondo de pozo está cubierto, **la fecha de arranque del
   Sprint 3 se adelanta** respecto al "Septiembre 2026" que fija el Anexo.
4. Añadir al Anexo una regla de frescura: los ítems de estado-de-código caducan; cada uno lleva
   la fecha de su verificación. Un anexo que se desactualiza en 3 días necesita fecha por fila,
   no por documento.

---

## Bloque 4 — Secuencia: Executive OS vs. clientes cero

### El hallazgo

El Anexo I §13.1 decide, con argumento explícito: **no construir IA sobre supuestos**; primero
1-2 clientes cero manuales, medir con log de horas qué 20% del trabajo del consultor es
repetible, y decidir en octubre 2026 qué automatizar.

El trabajo real de estos días (Executive OS Sprints 1-2: Executive Twin, 5 engines, ABAC,
column cipher) se ejecuta **sin ningún cliente cero cerrado**.

Formalmente no viola la regla: el Executive OS no es ninguna de las cinco capacidades de
automatización del consultor (Discovery Engine, Playbook Generator, Workflow Factory, AI
Trainer, Digital Twin). Es producto para el dueño, no sustitución del consultor. Pero:

- compite por el mismo tiempo de desarrollo que el fondo de pozo;
- su valor solo se demuestra con datos reales de una operación viva;
- el propio Anexo advierte que construir sobre supuestos genera features que nadie usa — y hoy
  los 5 engines producen `insights`/`priorities`/`risks` que **ningún consumidor lee**
  (ver `docs/plan-cierre-sprint-2-track-a.md`, Fase 5).

### Decisión requerida (D2)

Declarar explícitamente en el canónico cuál es la prioridad de dev de Q4-2026, entre:

| Opción | Qué implica |
|---|---|
| **A. Cliente cero primero** | Congelar Executive OS después del cierre del Track A. Todo el dev a lo que falte del fondo de pozo + soporte a la implementación. El Executive OS se retoma con datos reales, que es cuando sus heurísticas se pueden calibrar. |
| **B. Executive OS primero** | Terminar Sprint 3 (Priority Engine + Morning Brief) porque es la demo que abre la venta. Asume que las heurísticas sin datos reales son suficientes para demostrar. |
| **C. Paralelo acotado** | Cliente cero manda; del Executive OS solo se termina lo que sea demostrable en esa implementación (Priority Engine + panel de prioridades), y se posponen Workforce/Maintenance/Knowledge. |

**Recomendación: C.** Es la que concilia el Anexo con el trabajo ya invertido: los 5 engines
existentes se vuelven visibles para el cliente cero (que es el laboratorio que valida si esas
prioridades son correctas), y no se escriben tres engines más a ciegas. Coincide con la
recomendación de la Fase 5 del plan de cierre del Track A.

### Tarea

Anotar la decisión en `pulso-estrategia-unificada.md` §13.1 y en el roadmap de
`pulso-executive-os-v2.md` §5, con fecha. Hoy la secuencia real está implícita en los commits
y eso hace que dos documentos canónicos parezcan contradecirse.

---

## Bloque 5 — La métrica `confidence > 80` no es evaluable

`pulso-executive-os-v2.md` §14 pide: *"8 engines producen `EngineOutput` con `confidence > 80`"*.
Los engines actuales son heurísticos y nadie consume sus outputs; sin consumidor no hay forma de
saber si un 80 significa algo.

### Tarea

Redefinir la métrica en dos, y dejar la segunda condicionada a que exista el consumidor:

- **Cobertura de datos** (medible hoy): `confidence` refleja qué % de los inputs que el engine
  esperaba estaban disponibles y frescos. Meta: `> 80` = el engine tuvo datos para opinar.
- **Precisión** (medible post-consumidor, con cliente cero): de las prioridades que el engine
  colocó en el top 5, qué % el dueño consideró accionables. Ese es el número que importa, y no
  se puede medir sin alguien leyéndolas.

---

## Bloque 6 — Bifurcación del schema (anotar, no arreglar)

El schema vive en dos lugares: `lib/db/schema.ts` (monolito, **99 tablas**, incluye todo lo
financiero: `daily_sales_cuts`, `petty_cash_*`, `operating_expenses`, `invoices`) y
`lib/db/schema/` (modular, 8 archivos, donde aterrizaron las tablas nuevas de Sprint Sec-0 y
Sprint 1). Coexisten vía el barrel export de `lib/db/schema/index.ts`.

No romper esto ahora. Registrar como deuda con una regla: **tabla nueva va al directorio
modular**; migración del monolito solo cuando toque un dominio por otra razón.

---

## Orden de ejecución

```
1. D1 (tiering)  ──► Bloque 1 tareas 1-5   [antes de cualquier trabajo de Sprint 5]
2. D2 (secuencia) ─► Bloque 4 tarea        [antes de abrir Sprint 3]
3. Bloque 3 (refrescar Anexo)              [antes de la revisión de octubre]
4. Bloque 2 (nombres de twins)             [antes de la próxima demo de venta]
5. Bloque 5 (métrica)                      [al escribir el Priority Engine]
6. Bloque 6                                [solo anotar]
```

Los bloques 1 y 4 son puertas: bloquean sprints. Los bloques 2, 3 y 5 son documentales y no
bloquean nada, pero el 3 caduca (su valor está en llegar fresco a octubre).

---

## Decisiones pendientes del owner

| # | Decisión | Recomendación | Bloquea |
|---|---|---|---|
| **D1** | Taxonomía y unidad de cobro del tiering | Core/Professional/Intelligence, por sucursal, MXN. Reescribir `PLANS` y migrar `companies.plan`. | Sprint 5 completo |
| **D2** | Prioridad de dev Q4-2026: cliente cero vs Executive OS | Opción C (paralelo acotado: Priority Engine + panel, posponer 3 engines) | Apertura de Sprint 3 |
| **D3** | Nombre para el concepto de plantilla clonable | "Operating Blueprint" | Nada — solo claridad |
| **D4** | ¿Se conserva un cuarto tier Enterprise/custom? | Sí, pero declararlo en el canónico | Bloque 1 tarea 1 |

---

## Checklist

- [ ] D1 resuelta y escrita en `pulso-estrategia-unificada.md` §7
- [ ] `PLANS` reescrito con tiers canónicos + `unit: 'branch'` + precios MXN
- [ ] `companies.plan` migrado (migración de datos, nunca `db:push`)
- [ ] Precio calculado como `pricePerBranch × sucursales activas`
- [ ] Billing mock marcado explícitamente (POST auto-asigna tier sin pago)
- [ ] Diseño §16 mapeado a los tiers canónicos (matriz módulo × tier)
- [ ] Tier del Morning Brief decidido antes de construirlo
- [ ] D2 resuelta y anotada en §13.1 + roadmap §5
- [ ] Anexo I §13.4 reescrito con estado verificado y fecha por fila
- [ ] T9/T10 y T17 verificados en código
- [ ] Fecha de arranque del Sprint 3 recalculada
- [ ] "Digital Twin" del pitch renombrado; aclaración cruzada en ambos docs
- [ ] Operating Blueprint añadido al roadmap técnico
- [ ] Métrica `confidence` desdoblada en cobertura + precisión
- [ ] Deuda de bifurcación del schema anotada con su regla
