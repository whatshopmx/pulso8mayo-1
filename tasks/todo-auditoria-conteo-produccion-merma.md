# Todo: Auditoría de calidad — conteo, producción y merma

Plan: `tasks/plan-auditoria-conteo-produccion-merma.md`
Audita: `tasks/plan-conteo-produccion-merma.md` (implementado, commits hasta `0049`)

> Regla del plan (AD-A1): **ninguna observación se arregla antes de tener un test que la demuestre.**
> Las nueve observaciones son hipótesis de lectura estática. Anotar el veredicto de cada una aquí.

## Veredicto por observación

| # | Observación | Severidad | Veredicto | Nota |
|---|---|---|---|---|
| O-1 | Extractores `void` en serverless — ¿corren en prod? | Crítica | ✅ **confirmada** · daño histórico **cero** | A1 (2026-08-20). El deploy es **Netlify**, no Vercel — el `vercel.json` del repo está vacío (`{}`). Netlify sirve Next sobre Lambda: el contenedor se **congela** al responder, así que el defecto no es "nunca corre" sino **no determinístico**. Sin usuarios reales todavía → nada que reprocesar (cancela OQ-A3). **Radio acotado:** el conteo clásico 80/20 no está expuesto (`stock-count-service.ts:353` sí hace `await`). Expuestos: conteo dinámico, merma, producción, recepción |
| O-2 | Fechas UTC: el conteo de cierre se pierde | Alta | ⬜ sin probar | A3 |
| O-3 | Cache de sub-recetas escaladas | Alta | ⬜ sin probar | A5 |
| O-4 | Idempotencia por `notes LIKE` (3 de 4 rutas) | **Alta** ⬆️ | ✅ **confirmada con spec** · **corregida** en 3 de 4 | A8/A9 (2026-08-20). Dos extracciones simultáneas duplicaban en las tres rutas, y en producción **descontaban el lote dos veces** (94 esperado, 88 real). Subió de Media: no era sólo histórico sucio, era inventario perdido. Cerrada con columna + único parcial. **Queda recepción**, ver la nota de A9 |
| O-5 | `production_ingredients` integer: la cantidad fraccionaria de insumo no entra | **Crítica** ⬆️⬆️ | ✅ **confirmada con spec** · daño histórico **cero** | A7 (2026-08-20). **El síntoma que decía el plan estaba mal:** Postgres no redondea, **rechaza** el insert, y con él se cae la producción entera. Sube de Alta. A7b migra |
| O-6 | Sin tope de expansión en el resolver | Media | ✅ **confirmada con spec** · **corregida** | A10 (2026-08-20). 35 SKUs etiquetados generaban 35 pasos; y un filtro sin coincidencias creaba la instancia **vacía** con un 200 |
| O-7 | `console.*` en vez de `createChildLogger` | Media | ✅ confirmada · **corregida** | A11 (2026-08-20). 21 llamadas en 5 archivos → logger estructurado. `instanceId`/`companyId`/`branchId` como campos, no interpolados |
| O-8 | `branchId` muerto; snapshot sin `companyId` | Baja | ✅ confirmada · **corregida** | A12 (2026-08-20). `branchId` fuera de `DynamicResolveContext`; el cruce con `stock_counts` filtra por `companyId` |
| O-9 | `inventory_snapshots` sin retención | Baja | ✅ **medida** · sin cambio, con política escrita | A12 (2026-08-20). ~164 000 filas/año para un grupo de 15 sucursales: no es un problema. La política y su disparador quedan en la cabecera del servicio |
| **O-10** | *Hallazgo nuevo (A11):* el extractor de merma trata como ítem cualquier paso que termine en UUID, incluidos los `prod-qty-{recipeId}` de producción | Baja | ⬜ **sin arreglar** — anotada para decisión | A11 (2026-08-20). No escribe nada (sin motivo no hay merma), pero recorre la instancia y deja **dos WARN por instancia de producción**. Se vio al pasar a logs estructurados. Arreglo probable: exigir que el prefijo sea `merma-` ANTES de dar de alta el item en el mapa (`parseMermaSteps`, 3 líneas). **No se toca sin spec rojo (AD-A1)** |

---

## Phase 0 — ¿Corre esto en producción? (fail fast)

- [x] **A1 — Probar si los extractores sobreviven a la respuesta HTTP** · S · deps: ninguna
  - [x] **La premisa del plan era falsa: el deploy es Netlify, no Vercel.** `netlify.toml` es real;
        `vercel.json` existe pero su contenido es literalmente `{}`. Cero `waitUntil` en código de app.
  - [x] **El método del plan no servía.** En Lambda un preview deploy puede *confirmar* O-1 pero jamás
        *descartarla*: si la línea final aparece, sólo prueba que ese contenedor siguió caliente. El
        Checkpoint 0 dependía de una rama ("si A1 descarta O-1") que no existe en esta plataforma.
  - [x] **Evidencia en los datos** (`scripts/audit-extractores-perdidos.ts`, sólo lectura): instancias
        COMPLETED con pasos capturados vs filas realmente escritas por cada extractor.
  - [x] Resultado contra la base de `.env`: **la feature nunca se ejecutó ahí.** Cero pasos
        `prod-qty-*` / `merma-*` / `count-*` en toda la base, `stock_counts` con 0 filas, una sola
        compañía ("Pulso HORECA Demo") y las 470 instancias completadas son seed. Las 3 de recepción
        se insertaron directo en la tabla, nunca pasaron por `completeStep` — su `0 extraídas` no
        es evidencia de nada.
  - [x] **Veredicto O-1: confirmada por semántica de plataforma, con daño histórico cero.** Confirmado
        con el humano que aún no hay usuarios reales. A2 sigue siendo necesario — antes de lanzar,
        no después — pero no hay nada que reprocesar.
  - Archivo dejado en el repo: `scripts/audit-extractores-perdidos.ts` (lo necesitará cualquier
    revisión futura de instancias sin extraer)

- [x] **A2 — Extractores a Inngest** (A1 confirmó O-1: procede) · M · deps: A1
  - [x] Evento `workflow/instance.completed` en `lib/inngest/events.ts`
  - [x] `lib/inngest/functions/workflow-extractors.ts` — un `step.run` por extractor
  - [x] Registrar en `lib/inngest/functions/index.ts`
  - [x] `workflow-execution-service.ts`: los 4 `void import()` → un `inngest.send`
        (con `id: workflow-extractors:{instanceId}` → dedupe de 24 h, y try/catch:
        el instance ya está COMPLETED y commiteado, tumbar la petición no lo revierte)
  - [x] **R-5 cerrado de paso:** los cuatro `*-from-workflow.ts` ya no se tragan el
        error en su `catch` terminal — lo relanzan. Sin eso ningún `step.run` fallaría
        nunca y la corrida siempre se vería verde. El otro llamador
        (`stock-count-service.ts:353`) ya traía su propio try/catch, así que su ruta
        no cambia.
  - [x] Verificar que un extractor que lanza no impide los otros tres
        **Método: inyección de falla.** `throw new Error("FAULT INJECTION")` temporal
        dentro del `try` de `extractStockCountFromInstance` (el 2.º de 4), evento
        enviado al dev server, y revertido después. La señal que discrimina es el
        mensaje de error final del run:
        - aislamiento OK → `Extractores fallidos para la instancia …: stock-count`
          (mi `NonRetriableError` terminal, sólo alcanzable si el loop recorrió los 4)
        - aislamiento roto → el `FAULT INJECTION` crudo saldría del run
        **Resultado real:** run `Failed` con el mensaje del `NonRetriableError` y sólo
        `stock-count` en la lista → receiving, merma y production sí corrieron. R-5
        confirmado en el mismo experimento: la corrida queda visiblemente FALLIDA.
  - [x] Verificar: `INNGEST_DEV=1 pnpm run dev` + `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest`
        App `pulso29` sincronizada, 39 funciones, `workflow-extractors` entre ellas.
        Baseline con una instancia real que no es de ninguno de los 4 tipos → run
        `Completed` (los extractores se auto-descartan, como se esperaba).
  - ℹ️ **Semántica confirmada en vivo:** el `catch` alrededor de `await step.run(...)`
        **no** se dispara en los intentos intermedios — Inngest reintenta el paso
        (4 intentos con `retries: 3`) y sólo entrega el error al código de usuario
        cuando los agota. Es exactamente el comportamiento que el diseño asume.
  - ✅ **Confirmación extra del aislamiento:** el `logger.error` del catch —
        `ERROR: Extractor agotó sus reintentos`— **sí** quedó en el stdout del dev
        server (18:37:14). Es evidencia directa de que el catch corrió, más fuerte que
        inferirlo del mensaje de error final.
        (Antes anoté aquí que `createChildLogger` no imprimía nada en dev. **Era falso:**
        el grep con el que lo "comprobé" buscaba `^HH:MM:SS` y pino-pretty prefija con
        `[HH:MM:SS]`. A11 no tiene ningún problema de visibilidad que resolver.)

### ✅ Checkpoint 0 — resuelto, ya no bloquea
- [x] **Decisión humana tomada (2026-08-20):** O-1 confirmada, pero sin usuarios reales el daño
      histórico es cero. No hay datos faltantes que reprocesar → **OQ-A3 y AD-A7 quedan sin objeto**
      y el checkpoint deja de ser bloqueante.
- [x] `pnpm run build` limpio (tras A2) — exit 0
      ⚠️ En esta máquina el build fallaba con `Failed to fetch \`Geist\`` de Google Fonts.
      **No era mi cambio ni falta de red:** hay interceptación TLS local y Turbopack usa
      su propio almacén de certificados mientras `curl` usa el del sistema. Con
      `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1` compila limpio.
- [x] Los 6 specs de la feature siguen verdes (tras A2) — **13 passed (3.7m)**
      Contra `next start` (no `next dev`) y con el dev server de Inngest arriba, que es
      quien ejecuta la extracción. Los specs ya usaban `expect.poll` con 30 s, así que
      toleraron el salto a asíncrono sin tocarlos.
      🔧 `tests/auth.setup.ts` sí necesitó un arreglo: su `page.goto("/sign-in")` heredaba
      el `navigationTimeout: 60_000` del config aunque el resto del archivo ya asumía
      300 s, y el setup moría antes de escribir las cookies.

## Phase 1 — La fecha operativa

- [x] **A3 — Spec del conteo de cierre perdido** · S · deps: ninguna
  - [x] `tests/conteo-fecha-local.spec.ts`: conteo a las 18:30 hora CDMX → `buildSnapshot` del mismo día
  - [x] Confirmar que falla por `countedStock` NULL, no por otra razón
        **Rojo confirmado:** `Expected "2026-03-15" · Received "2026-03-16"` en la
        aserción de `count_date`. Falla en el sello de la fecha, que es exactamente
        donde vive O-2. (La aserción de `countedStock` NULL viene después en el mismo
        caso; al fallar antes la fecha, no llega a evaluarse — el orden es a propósito:
        señala la causa, no el síntoma.)
  - [x] Caso borde inverso: 00:30 local (mismo día en ambas zonas) sigue funcionando
        **Verde**, y es lo que descarta que el rojo venga del andamiaje.
  - [x] Helpers en `tests/support/db.ts` — `seedCompletedCountInstance`
  - ℹ️ **Por qué el spec llama al extractor directo** (como ya hacía
        `snapshot-idempotente.spec.ts` con `buildSnapshot`): la hora de cierre *es* la
        variable bajo prueba y cerrando por la API `completedAt` siempre es `NOW()`.
        Cerrar y luego reescribir `completed_at` tampoco sirve: tras A2 el reintento
        de la extracción cae en el dedupe de 24 h del `inngest.send`.
  - ⚠️ **Efecto de A2 sobre los specs:** la extracción ya no corre en proceso, así que
        los 6 specs de la feature ahora **exigen el dev server de Inngest levantado**
        (`npx inngest-cli@latest dev -u http://localhost:3000/api/inngest`). Sin él se
        quedan esperando filas que nadie escribe. Pendiente anotarlo en CLAUDE.md.

- [ ] **A4 — Fecha operativa por zona horaria de la SUCURSAL** · M · deps: A3 + **OQ-A1 decidida**
  - ⚠️ **Corrección a AD-A3 (A1, 2026-08-20):** la columna es **`branches.timezone`**, no
    `companies.timezone` — `companies` no la tiene (verificado en `information_schema` y en
    `lib/db/schema/core.ts:34`). Es la zona *correcta*: el conteo y el snapshot son por sucursal, y
    una cadena con sucursal en Quintana Roo (UTC-5) y en CDMX (UTC-6) sólo se sella bien así.
    `buildSnapshot(companyId, branchId, date?)` ya recibe el `branchId`: sigue sin haber cambio de firma.
  - [x] `countDate` → `localDateString(completedAt, branch.timezone)`
        La sucursal ahora se consulta **siempre**, no sólo como respaldo del `companyId`.
  - [x] `snapshotDate` → misma función, no `toISOString().slice(0,10)`
        Sólo cuando la fecha no viene ya resuelta como string: si el llamador pasó
        `'2026-03-15'` se respeta tal cual. Los dos lados del cruce tienen que sellar
        con el mismo huso o el conteo de cierre no aparece.
  - [x] Cron: `TZ=America/Mexico_City` + hora posterior al cierre
        `"0 5 * * *"` (= 23:00 locales del día anterior) → `"TZ=America/Mexico_City 0 4 * * *"`,
        pasando **D−1 calculado por sucursal**, no global: Quintana Roo (UTC-5) y CDMX
        (UTC-6) no siempre cierran el mismo día.
  - [x] Verificar: cero `toISOString().slice(0,10)` en el flujo ✓
  - **Verificación:** `npx tsc --noEmit` exit 0 · `conteo-fecha-local` + `snapshot-idempotente`
    **4 passed** (A3 en verde, el snapshot sin romperse) · `merma-automatica` 2/2 y el caso
    de idempotencia de `conteo-dinamico` también verdes, que son los que cruzan la misma ruta.
  - ✅ **Resuelto:** los 3 casos que navegan la UI fallaban por **timeout de navegación
    contra `next dev`**, no por aserción. Contra `next start` sobre un build pasan:
    **17 passed (3.7m)**.
  - Archivos: `stock-count-from-workflow.ts`, `inventory-snapshot-service.ts`, `cron-inventory-snapshot.ts`

### ✅ Checkpoint 1
- [x] `pnpm run build` limpio; los 7 specs de la feature verdes
      `build exit=0` · **17 passed (3.7m)** contra `next start` (8 specs: los 6 de la
      feature + `snapshot-idempotente` + el nuevo `conteo-fecha-local`).
- [x] Manual: conteo a las 19:00 local aparece en el snapshot de **ese** día
      Cubierto por `conteo-fecha-local.spec.ts` con 18:30 —el mismo caso, ya en UTC del
      día siguiente— más el borde inverso de 00:30. Es una comprobación automatizada y
      determinista (fecha fija 2026-03-15), mejor que la manual que pedía el plan.
- [x] Revisar filas ya selladas con fecha equivocada y decidir si se corrigen
      **Nada que corregir:** A1 estableció que la base es la de demo y no hay usuarios
      reales. `stock_counts` estaba vacía y los snapshots son sólo de seeds. El
      backfill de fechas queda sin objeto, igual que OQ-A3.

## Phase 2 — El cálculo del consumo

- [x] **A5 — Spec del cache envenenado de sub-recetas** · S · deps: ninguna
  - [x] `tests/subreceta-compartida.spec.ts`: 2 recetas, 1 sub-receta compartida, cantidades distintas
        Base (sub-receta) = 1 de harina · Guiso = 2 × Base · Sopa = 5 × Base.
        Producir 1 de cada una en la misma instancia debe consumir 7.
  - [x] Confirmar la diferencia numérica exacta que produce el defecto
        **Rojo:** `Sopa = 5 × Base · Expected 5 · Received 2`. La Sopa recibió las
        hojas ya escaladas del Guiso — el cache envenenado, literal.
  - [x] El orden de las recetas no debe cambiar el resultado
        La segunda aserción es sobre el consumo TOTAL del lote (7). Con el defecto da
        4 o 10 según qué receta se expandió primero, nunca 7: atrapa ambos órdenes sin
        depender del orden de iteración del `Map`.
  - ℹ️ Cantidades enteras a propósito, para que el redondeo de O-5
        (`production_ingredients.actual_quantity` es `integer`) no se mezcle con lo que
        mide este spec.

- [x] **A6 — Cachear hojas sin escalar** · S · deps: A5
  - [x] Cache por unidad de `baseYield`; escalar al leer, no al guardar
        `expandRecipeLeaves` queda como envoltura de una nueva `leavesPerUnit`, que es
        lo único que se cachea. `expandRecipeLeaves(r, n)` es siempre
        `n × leavesPerUnit(r)`, así que la entrada no depende de quién la pidió primero.
  - [x] A5 verde; `produccion-diaria` / `consumo-fefo` / `lote-insuficiente` siguen verdes
        **5 passed (1.3m)** contra `next start` · `npx tsc --noEmit` exit 0 ·
        `pnpm run build` exit 0
  - [x] `yieldPercent` sigue aplicándose una sola vez por nivel
        Vive dentro de `leavesPerUnit`: es un factor de la línea de receta, no de la
        cantidad, así que multiplicar después no lo altera.
  - ℹ️ **La aritmética es idéntica**, sólo cambia dónde se aplica la escala:
        antes `quantity × quantityNeeded / baseYield` de una vez; ahora
        `quantity / baseYield` al cachear y `× quantityNeeded` al leer. Para las
        sub-recetas los factores se componen igual. Por eso los tres specs previos no
        se movieron.
  - Archivo: `lib/services/production-from-workflow.ts`

- [x] **A7 — Evaluar el daño ya causado en `production_ingredients`** · S · deps: ninguna
  - [x] Contar filas con `actual_quantity = 0` y `total_cost > 0` — firma de insumo fraccionario perdido
        **Cero filas**, y `production_ingredients` entera tiene **9 filas** (una por
        `production_results`, todas de corridas de specs, 2026-08-10 → 2026-08-21). Igual que
        en A1: la base de `.env` es la de demo y la feature nunca corrió ahí con datos reales.
        Script dejado en el repo: `scripts/audit-redondeo-ingredientes.ts` (sólo lectura).
        Confirmado de paso que las 4 columnas siguen en `integer` en la base, no sólo en el schema.
  - [x] `tests/redondeo-ingredientes.spec.ts`: 0.35 kg registra `0` en ambas columnas
        **Rojo confirmado, y el síntoma NO es el que decía el plan.** Postgres no redondea al
        insertar un parámetro fraccionario en una columna `integer`: lo rechaza con
        `invalid input syntax for type integer`. El insert vive dentro de la transacción del
        extractor, así que **se pierde la producción completa** — ni `production_results`, ni
        descuento de lote, y tras A2 la corrida de Inngest queda FALLIDA. Por eso O-5 sube a
        Crítica: no es una fila mal escrita, es el registro que no existe.
        Son **tres** columnas `integer` en la ruta, y el caso 1 las va destapando en orden:
        `production_results.ingredient_cost` (431.9) → `production_ingredients.total_cost` →
        `production_ingredients.expected_quantity` (0.35). Las dos primeras son centavos y se
        arreglan redondeando; sólo la tercera exige `numeric`. El spec fija `total_cost = 432`
        justamente para que A7b no migre las cantidades y deje el insert cayéndose por el costo.
        La fila que O-5 describía —"consumió 0 kg, costó $12.34"— sí se llegó a ver, en los
        `params` del insert rechazado: `expected_quantity=0.35, actual_quantity=0, total_cost=432`.
        Es el `Math.round` de `production-service.ts:150` haciendo su parte antes de que la base
        rechazara la fila entera.
  - [x] **Caso 2 — el redondeo silencioso sí existe, por otra vía.** Receta de 2 kg enteros que
        FEFO reparte entre dos lotes (0.5 + 1.5): `expected_quantity` viaja entero, los costos
        caen en centavos exactos y **el insert pasa** con las cantidades redondeadas a 1 y 2.
        La producción aparenta haber gastado 3 kg de los 2 que salieron del inventario. Éste es
        el único camino por el que podrían existir filas corruptas en la base, y no es el que
        el plan tenía en la mira.
        **Rojo:** `el lote viejo aportó 0.5 · Expected 0.5 · Received 1`.
  - [x] ¿Las filas corruptas se pueden reconstruir con `total_cost / unit_cost`?
        **Sí, exactamente, cuando existen** — `total_cost` se calcula con la cantidad exacta, así
        que la división la devuelve íntegra (0.5 = 50/100 en el caso 2). Pero: (a) hoy no hay
        ninguna que reconstruir, y (b) la reconstrucción sólo alcanza a las filas del caso 2,
        porque las del caso 1 nunca se escribieron. **No se programa backfill**; si algún día
        hace falta, la consulta ya está en el script.
  - ⚠️ **Para A7b:** `app/api/inventory/production/route.ts` valida los ingredientes con
        `z.number().int()`. La ruta manual hoy rechaza fracciones en el borde (400, no corrupción),
        pero después de migrar las columnas ese `.int()` es lo único que seguiría prohibiendo
        capturar 0.35 kg a mano.
  - ℹ️ El spec llama al extractor directo, como `conteo-fecha-local`: no necesita servidor ni dev
        server de Inngest y corre en ~1 min con `--no-deps --project=chromium`.
  - Helpers nuevos en `tests/support/db.ts`: `seedCompletedProductionInstance`;
    `findProductionIngredients` ahora devuelve `unit_cost`/`total_cost` y `findBatchQuantity`
    dejó de castear a `::int` (redondeaba justo lo que este spec mide; para cantidades enteras
    devuelve lo mismo — verificado contra la base: `4::numeric::float8` llega como `4`).

- [x] **A7b — Migrar `production_ingredients` a `numeric(12,4)`** · M · deps: A7
  - [x] `expected_quantity` y `actual_quantity` → `numeric(12,4)`, patrón de la migración `0051`
        `drizzle/0054_produccion-cantidades-decimales.sql`. Renombrada del
        `0054_secret_lockjaw` que generó drizzle-kit (convención del repo para migraciones
        con intención, como `0051`) y con el `USING …::numeric` explícito que `0051` ya traía.
  - [x] Retirar el `Math.round` de `production-service.ts:150`
        Las columnas son numeric → string en TS: `String(ing.expectedQuantity)` /
        `String(ing.actualQuantity)`, el mismo patrón que ya usaba la merma para `quantity`.
  - [x] **Redondear los costos** (A7): `ingredient_cost` de `production_results` y `total_cost`
        de `production_ingredients` siguen en centavos `integer` y hoy reciben el producto
        fraccionario sin redondear — revientan antes que la cantidad
        `Math.round` en los dos. **Se quedan en integer a propósito:** el centavo ya es la
        unidad mínima, no hay medio centavo que guardar.
  - [x] Decidir el `.int()` de `app/api/inventory/production/route.ts` (captura manual)
        **Fuera.** Era lo único que seguiría prohibiendo capturar 0.35 kg a mano después de
        migrar las columnas. Queda `z.number().nonnegative()`. `producedQuantity` sigue
        entero: son porciones, y `production_results.produced_quantity` no se migró.
  - [x] Revisar los lectores de costo de producción
        Un solo lector real: `operational-twin-engine.ts:141` restaba las dos cantidades, que
        ahora llegan como string → `Number()` en ambas. Sin eso el build lo habría atrapado
        (resta de strings), pero el resultado en runtime habría sido correcto por coerción:
        justo el tipo de arreglo que hay que hacer mirando, no confiando en el compilador.
        `app/api/inventory/production/route.ts` importa la tabla pero no lee esas columnas.
  - [x] `pnpm db:generate` y **revisar el SQL**: si trae `DROP`, no aplicar
        **Sin `DROP`:** dos `ALTER COLUMN … SET DATA TYPE numeric(12,4)`. El cast es ampliante
        (integer → numeric), ninguna de las 9 filas existentes pierde valor. Revisada con el
        humano antes de aplicar; la aplicó él con `pnpm db:migrate`.
        Verificado en `information_schema`: las dos columnas ya son `numeric(12,4)`.
  - [x] A7 verde con `0.3500`; los 3 specs de producción siguen verdes
        **8 passed (1.7m)** contra `next start` sobre el build nuevo, con el dev server de
        Inngest arriba: `redondeo-ingredientes` (2), `produccion-diaria` (2), `consumo-fefo`,
        `lote-insuficiente` y `subreceta-compartida`.
  - 🔧 `produccion-diaria` y `consumo-fefo` fallaron en la primera corrida con
        `Expected 6 · Received "6.0000"`: **no era regresión**, era el driver devolviendo
        numeric como string. Se arregló en `findProductionIngredients`, que ahora convierte
        las dos cantidades a número —lo que su tipo `ProductionIngredientRow` ya prometía—
        en vez de parchear cada aserción.
  - ⚠️ El `next start` que había levantado servía el build ANTERIOR. Verificar contra él
        habría dado un verde falso; hay que reconstruir después de tocar código de servicio.

### 🛑 Checkpoint 2
- [x] `pnpm run build` limpio; specs de producción verdes
      `build exit=0` · **8 passed (1.7m)** · `npx tsc --noEmit` exit 0
- [x] Migración de A7b revisada, sin `DROP`
      `0054_produccion-cantidades-decimales.sql`, dos `ALTER COLUMN`, cast ampliante.
- [x] Daño histórico cuantificado y decidido si se reconstruyen las filas en `0`
      **Cero filas corruptas** (`scripts/audit-redondeo-ingredientes.ts`) sobre 9 filas en
      total, todas de specs. **No hay nada que reconstruir y no se programa backfill.**
      Si algún día hiciera falta, sólo alcanzaría a las filas del caso 2 —`total_cost /
      unit_cost` devuelve la cantidad exacta— porque las del caso 1 nunca se escribieron.
- [ ] **Revisar con humano antes de Phase 3**

## Phase 3 — Idempotencia real

- [x] **A8 — Spec de doble procesamiento concurrente** · M · deps: ninguna
  - [x] `tests/extractor-idempotente.spec.ts`: dos llamadas sin esperar entre ellas
        `Promise.all([extract(id), extract(id)])`. Las dos leen el histórico antes de que
        ninguna haya escrito: el hueco exacto del check-then-insert.
  - [x] Demostrar duplicación en producción y en merma manual
        **Producción — rojo:** `el lote se descontó más de una vez · Expected 94 · Received 88`.
        La aserción del lote va PRIMERO a propósito: sólo puede fallar si hubo una segunda
        escritura, así que es señal más fuerte que contar filas, y enseña la consecuencia cara
        —duplicar aquí mueve inventario, no sólo ensucia el histórico—. Detrás,
        `production_results` con 2 filas para la misma instancia.
        **Merma manual — rojo:** `Expected length 3 · Received length 6`, dos filas idénticas
        por SKU con el mismo marcador `origen=workflow_merma`.
  - [x] Cubrir también la merma por varianza
        **Rojo:** `Expected length 2 · Received length 4`. El mismo caso deja ver el contraste
        que da sentido a A9: `stock_counts` —que sí tiene índice único y hace
        `onConflictDoUpdate`— aguanta la doble extracción sin despeinarse; la merma que ese
        mismo conteo dispara, que va por `notes LIKE`, se duplica.
  - ℹ️ **Por qué "simultáneo" no es hipotético:** tras A2 el que ejecuta es Inngest, que
        reintenta cada `step.run` hasta 4 veces. Un reintento por timeout —el paso tardó, no
        falló— corre contra el intento anterior, que sigue vivo. El `id` del `inngest.send`
        deduplica el EVENTO durante 24 h, no los intentos de un mismo run.
  - Helper nuevo: `seedCompletedMermaInstance` (gemelo del de producción y conteo).

- [x] **A9 — `workflow_instance_id` + único parcial (cierra AD-4)** · M · deps: A8
  - [x] Columna en `production_results` e `inventory_waste`
  - [x] Índice único parcial; la merma por varianza necesita distinguirse de la manual en la misma instancia
        `production_results (workflow_instance_id, recipe_id)` — con la receta, porque una
        instancia produce una fila por cada receta capturada (lo demuestra `subreceta-compartida`).
        `inventory_waste (workflow_instance_id, item_id, origin)`, donde `origin` es la columna
        nueva: `workflow_merma` / `diferencia_conteo` / `lote_insuficiente`. El origen es lo que
        separa la merma del operador de la varianza cuando conviven en la misma instancia.
  - [x] **`lote_insuficiente` queda FUERA del único, a propósito.** Una instancia con dos recetas
        cortas del mismo insumo escribe dos filas legítimas; el único las borraría en silencio.
        Y no lo necesita: su idempotencia la da el único de `production_results`, que corta antes
        de llegar ahí. El índice lleva `AND origin <> 'lote_insuficiente'` en el `WHERE`.
  - [x] Los 3 extractores → `onConflictDoNothing`, fuera el `notes LIKE`
        **`recordProduction` hubo que reordenarlo**, no bastaba con cambiar la guarda: descontaba
        los lotes ANTES de insertar el resultado, así que un `onConflictDoNothing` al final habría
        dejado pasar el segundo descuento igual que el `notes LIKE`. Ahora el resultado se inserta
        primero (con `ingredientCost: 0`), y si no devuelve fila se sale sin tocar inventario; el
        costo se escribe con un UPDATE al cerrar, cuando ya se conoce.
  - [x] `pnpm db:generate` y **revisar el SQL**: si trae `DROP`, no aplicar
        **Sin `DROP`:** 3 `ADD COLUMN` nullables y 2 `CREATE UNIQUE INDEX` parciales. Las filas
        existentes (todas con `workflow_instance_id` NULL) quedan fuera de los índices y siguen
        válidas: nada que rellenar. Revisada con el humano; renombrada a
        `0055_idempotencia-extractores.sql`.
  - [x] Los logs de inserción dicen lo que REALMENTE se escribió (`N de M`), leyendo el
        `returning()` del `onConflictDoNothing`. Un log que canta 3 cuando escribió 0 es
        justamente lo que vuelve invisible este defecto en producción (ver O-7).
  - ⚠️ **Recepción sigue con `notes LIKE`** (`receiving-from-workflow.ts:85`), y es la única que
        queda. **No entró en A9 a propósito:** su insert vive dentro de `processReceiving`, un
        servicio compartido con la API manual que además valida con Zod y encadena ítems,
        incidencias y factura. Darle la misma guarda no es añadir una columna, es cambiar la
        firma y la semántica de salida de ese servicio — reescribir, no auditar (AD-A5). Su daño
        potencial también es menor: duplica reportes, no mueve inventario. **Queda anotado como
        trabajo aparte**; con esto O-4 pasa de 3 rutas rotas a 1.
  - Archivos: `lib/db/schema.ts`, `drizzle/0055_idempotencia-extractores.sql`,
    `production-service.ts`, los 3 `*-from-workflow.ts`, `app/api/inventory/production/route.ts`

### ✅ Checkpoint 3
- [x] `pnpm run build` limpio; migración sin `DROP`
      `build exit=0` · `npx tsc --noEmit` exit 0 · `0055` son 3 `ADD COLUMN` y 2 índices.
- [x] Todos los specs de la feature verdes
      **29 passed (5.4m)** contra `next start` sobre el build nuevo, con el dev server de
      Inngest arriba: los 6 originales de la feature más `snapshot-idempotente`,
      `conteo-fecha-local`, `subreceta-compartida`, `redondeo-ingredientes`,
      `extractor-idempotente`, `limite-30-skus`, `conteo-alto-valor` y `recepcion-workflow`.
- [x] Un único mecanismo de idempotencia en los 4 extractores
      **En 3 de 4.** Conteo, producción y las dos mermas van por columna + único parcial.
      Recepción sigue con `notes LIKE` por la razón anotada arriba en A9, y es la única
      ocurrencia que queda en `lib/services/`. Decisión consciente y anotada, no un olvido.

## Phase 4 — Robustez y observabilidad

- [x] **A10 — Tope de expansión en el resolver** · S · deps: ninguna
  - [x] Límite alineado con el que ya respeta el conteo (`tests/limite-30-skus.spec.ts`)
        `MAX_DYNAMIC_STEPS = 30`, ajustable por paso con `metadata.dynamicSource.limit`.
        Por paso y no global porque una expansión sobre recetas no tiene por qué heredar
        el límite de los SKUs de alto valor. El recorte es estable —las entidades ya venían
        ordenadas por nombre— y el aviso dice cuántas coincidieron y cuántas entraron.
        **Rojo previo:** `Expected length 30 · Received length 35`.
  - [x] Filtro sin coincidencias: fallo visible, no instancia vacía en silencio
        `DynamicStepsEmptyError` cuando la expansión no deja NI UN paso, traducida a **422**
        con el motivo en `/api/workflows/execute`. 422 y no 500: la plantilla es válida, lo
        que no hay es contra qué expandirla; el operador puede accionar el mensaje.
        **Rojo previo:** `Expected 422 · Received 200`, con la instancia vacía creada.
        El disparo es "cero pasos", no "el paso dinámico no coincidió": un template con pasos
        estáticos sigue creándose, y el aviso de la expansión vacía queda en el log.
  - **Verificación:** **9 passed (1.2m)** — `conteo-dinamico` (4, dos nuevos) y
    `limite-30-skus` (4) · `npx tsc --noEmit` exit 0 · `pnpm run build` exit 0
  - Archivos: `lib/workflows/dynamic-steps.ts`, `lib/types/workflow.ts`,
    `app/api/workflows/execute/route.ts`, `tests/conteo-dinamico.spec.ts`

- [x] **A11 — `createChildLogger` en vez de `console.*`** · S · deps: A2
  - [x] 17 `console.*` → logger estructurado
        Eran **21** al llegar aquí: 17 del inventario original más 4 que añadieron A9 y A10.
        Cinco archivos: el resolver dinámico y los cuatro extractores. Componentes
        `workflows:dynamic-steps` y `services:<extractor>`, la convención que ya usan
        `inngest:workflow-extractors` y `cron:inventory-snapshot`.
  - [x] `instanceId` / `companyId` / `branchId` como campos, no interpolados
        Y de paso los conteos dejan de ser prosa: `{ escritas, candidatas }` en vez de
        "3 mermas persistidas". Es lo que permite preguntarle al log "¿cuántas veces
        escribimos 0 de 3?", que es exactamente la señal de O-4 en producción.
  - [x] Verificar: `grep -c "console\." lib/workflows/dynamic-steps.ts lib/services/*-from-workflow.ts` → 0
        Los 5 archivos en 0.
  - ℹ️ **A11 no tenía ningún problema de visibilidad que resolver** (ver la corrección
        anotada en A2): `createChildLogger` sí imprime bajo `next dev`. Esto es higiene de
        logs —campos consultables en vez de texto—, no un arreglo de logs mudos.

- ℹ️ **Hallazgo O-10, anotado y NO arreglado.** Al leer los logs estructurados de la corrida
  de verificación aparecieron dos WARN por cada instancia de producción:
  `services:merma-from-workflow … "Motivo de merma desconocido: se omite el item"` con
  `motivo: ""` y un `itemId` que en realidad era un `recipeId`. Causa: `parseMermaSteps` da de
  alta en su mapa **cualquier** paso cuyo `stepId` termine en UUID —y `prod-qty-{recipeId}`
  termina en UUID— y sólo después mira el prefijo. No escribe nada (sin motivo no hay merma),
  así que es ruido, no corrupción; pero el extractor de merma recorre entera cada instancia de
  producción. Queda en la tabla como O-10. **No se arregla aquí:** AD-A1 pide spec rojo primero
  y el síntoma es ruido de log, no comportamiento — es una decisión del humano.

- [x] **A12 — Scoping por `companyId` y retención** · S · deps: ninguna
  - [x] `buildSnapshot` filtra `stock_counts` también por `companyId`
        Los `itemIds` ya venían de la compañía, así que no había fuga real; el filtro entra
        igual porque el cruce que decide la varianza de un tenant no debe depender de que
        otro filtro esté bien puesto.
  - [x] `DynamicResolveContext.branchId`: usarlo o quitarlo de la firma
        **Fuera.** Ni `inventory_items` ni `recipes` tienen sucursal —son de la compañía—,
        así que nunca se usó: el campo sugería un scoping por sucursal que no existe.
        Quitarlo es la única de las dos opciones que no inventa una semántica nueva.
  - [x] Decidir si el snapshot omite ítems sin stock ni conteo
        **No los omite, y queda escrito por qué:** la ausencia de fila sería indistinguible
        de "el snapshot no corrió ese día", y un cero es un dato —dice que ese día no había
        existencias—. El snapshot es una foto del día, no un listado de novedades.
  - [x] Escribir la política de retención (aunque sea "ninguna, por ahora")
        **Ninguna, con el cálculo que lo justifica:** una fila por SKU de alto valor × sucursal
        × día, con los SKUs topados en 30 por la regla 80/20 → un grupo de 15 sucursales genera
        ~164 000 filas al año. Irrelevante para Postgres y valioso, porque la varianza histórica
        es justo lo que deja ver si una sucursal mejora. El disparador para revisarla queda
        escrito (un tenant que suba el tope, o la tabla pasando de unos pocos millones), y el
        borrado sería por `snapshot_date` con un cron.
  - Archivos: `lib/services/inventory-snapshot-service.ts`, `lib/workflows/dynamic-steps.ts`,
    `lib/services/workflow-execution-service.ts`

### Checkpoint 4 — Completo
- [ ] `pnpm run build` limpio; `pnpm lint` sin errores nuevos vs baseline
- [ ] `pnpm test:e2e` completo verde (7 previos de la feature + 4 nuevos de auditoría)
- [ ] Las nueve observaciones tienen veredicto en la tabla de arriba
- [ ] `tasks/todo-conteo-produccion-merma.md` corregido: OQ-2 la resolvió la migración `0051` y sigue marcada como abierta
- [ ] Listo para review

## Open Questions — las tres decididas 2026-08-20

- [x] **OQ-A1 → D−1.** El snapshot lee el estado **vivo** de los lotes; a las 4:00 locales ese estado
      *es* el cierre de ayer. Y tras A4 los conteos de cierre quedan con `countDate = D−1`: sólo D−1
      hace que crucen. Cron `TZ=America/Mexico_City 0 4 * * *` pasando D−1 explícito; `buildSnapshot`
      ya acepta la fecha, cero cambios de firma.
      ⚠️ La UI debe etiquetar "cierre del <fecha>", no "hoy".
- [x] **OQ-A2 → Sí, migrar; no depende de medir.** O-5 es peor que un redondeo: todo insumo bajo 0.5
      unidades registra `0`. Ver AD-A6. A7 mide daño histórico, A7b ejecuta la migración.
- [x] ~~**OQ-A3 → Backfill sí, acotado, nunca antes de A9.**~~ → **CANCELADA por A1 (2026-08-20):**
      no hay instancias reales sin extraer porque no hay usuarios reales. Nada que reprocesar, y
      **AD-A7 ("ningún backfill antes de A9") queda sin objeto**. El análisis de abajo se conserva
      sólo por si el backfill vuelve a hacer falta después del lanzamiento.
      Verificado: **sólo producción mueve stock**
      (vía `recordProduction`). Conteo, merma y recepción sólo escriben registros → seguros de
      reprocesar. Producción **jamás en automático**: descontaría lotes por movimientos de hace meses
      que la realidad ya consumió. A9 va primero o el backfill duplica el histórico (AD-A7).
      El backfill es un plan aparte.
