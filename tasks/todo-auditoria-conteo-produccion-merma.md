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
| O-4 | Idempotencia por `notes LIKE` (3 de 4 rutas) | Media | ⬜ sin probar | A8 |
| O-5 | `production_ingredients` integer: todo insumo <0.5 registra `0` | **Alta** ⬆️ | ✅ confirmada por lectura | Subida de Media. A7 mide daño, A7b migra |
| O-6 | Sin tope de expansión en el resolver | Media | ⬜ sin probar | A10 |
| O-7 | `console.*` en vez de `createChildLogger` | Media | ✅ confirmada por lectura | A11 |
| O-8 | `branchId` muerto; snapshot sin `companyId` | Baja | ✅ confirmada por lectura | A12 |
| O-9 | `inventory_snapshots` sin retención | Baja | ⬜ sin medir | A12 |

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
  - ⚠️ **Para A11:** `createChildLogger` usa pino con transport `pino-pretty` en
        development, que escribe desde un worker thread; su salida **no** apareció en
        el stdout del dev server durante esta prueba. A11 tiene que verificar que el
        log realmente se vea, no sólo que se llame.

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

- [ ] **A3 — Spec del conteo de cierre perdido** · S · deps: ninguna
  - [ ] `tests/conteo-fecha-local.spec.ts`: conteo a las 18:30 hora CDMX → `buildSnapshot` del mismo día
  - [ ] Confirmar que falla por `countedStock` NULL, no por otra razón
  - [ ] Caso borde inverso: 00:30 local (mismo día en ambas zonas) sigue funcionando
  - [ ] Helpers en `tests/support/db.ts`

- [ ] **A4 — Fecha operativa por zona horaria de la SUCURSAL** · M · deps: A3 + **OQ-A1 decidida**
  - ⚠️ **Corrección a AD-A3 (A1, 2026-08-20):** la columna es **`branches.timezone`**, no
    `companies.timezone` — `companies` no la tiene (verificado en `information_schema` y en
    `lib/db/schema/core.ts:34`). Es la zona *correcta*: el conteo y el snapshot son por sucursal, y
    una cadena con sucursal en Quintana Roo (UTC-5) y en CDMX (UTC-6) sólo se sella bien así.
    `buildSnapshot(companyId, branchId, date?)` ya recibe el `branchId`: sigue sin haber cambio de firma.
  - [ ] `countDate` → `localDateString(completedAt, branch.timezone)`
  - [ ] `snapshotDate` → misma función, no `toISOString().slice(0,10)`
  - [ ] Cron: `TZ=America/Mexico_City` + hora posterior al cierre
  - [ ] Verificar: cero `toISOString().slice(0,10)` en el flujo
  - Archivos: `stock-count-from-workflow.ts`, `inventory-snapshot-service.ts`, `cron-inventory-snapshot.ts`

### Checkpoint 1
- [ ] `pnpm run build` limpio; los 7 specs de la feature verdes
- [ ] Manual: conteo a las 19:00 local aparece en el snapshot de **ese** día
- [ ] Revisar filas ya selladas con fecha equivocada y decidir si se corrigen

## Phase 2 — El cálculo del consumo

- [ ] **A5 — Spec del cache envenenado de sub-recetas** · S · deps: ninguna
  - [ ] `tests/subreceta-compartida.spec.ts`: 2 recetas, 1 sub-receta compartida, cantidades distintas
  - [ ] Confirmar la diferencia numérica exacta que produce el defecto
  - [ ] El orden de las recetas no debe cambiar el resultado

- [ ] **A6 — Cachear hojas sin escalar** · S · deps: A5
  - [ ] Cache por unidad de `baseYield`; escalar al leer, no al guardar
  - [ ] A5 verde; `produccion-diaria` / `consumo-fefo` / `lote-insuficiente` siguen verdes
  - [ ] `yieldPercent` sigue aplicándose una sola vez por nivel
  - Archivo: `lib/services/production-from-workflow.ts`

- [ ] **A7 — Evaluar el daño ya causado en `production_ingredients`** · S · deps: ninguna
  - [ ] Contar filas con `actual_quantity = 0` y `total_cost > 0` — firma de insumo fraccionario perdido
  - [ ] `tests/redondeo-ingredientes.spec.ts`: 0.35 kg registra `0` en ambas columnas
  - [ ] ¿Las filas corruptas se pueden reconstruir con `total_cost / unit_cost`?

- [ ] **A7b — Migrar `production_ingredients` a `numeric(12,4)`** · M · deps: A7
  - [ ] `expected_quantity` y `actual_quantity` → `numeric(12,4)`, patrón de la migración `0051`
  - [ ] Retirar el `Math.round` de `production-service.ts:150`
  - [ ] Revisar los lectores de costo de producción
  - [ ] `pnpm db:generate` y **revisar el SQL**: si trae `DROP`, no aplicar
  - [ ] A7 verde con `0.3500`; los 3 specs de producción siguen verdes

### 🛑 Checkpoint 2
- [ ] `pnpm run build` limpio; specs de producción verdes
- [ ] Migración de A7b revisada, sin `DROP`
- [ ] Daño histórico cuantificado y decidido si se reconstruyen las filas en `0`
- [ ] **Revisar con humano antes de Phase 3**

## Phase 3 — Idempotencia real

- [ ] **A8 — Spec de doble procesamiento concurrente** · M · deps: ninguna
  - [ ] `tests/extractor-idempotente.spec.ts`: dos llamadas sin esperar entre ellas
  - [ ] Demostrar duplicación en producción y en merma manual
  - [ ] Cubrir también la merma por varianza

- [ ] **A9 — `workflow_instance_id` + único parcial (cierra AD-4)** · M · deps: A8
  - [ ] Columna en `production_results` e `inventory_waste`
  - [ ] Índice único parcial; la merma por varianza necesita distinguirse de la manual en la misma instancia
  - [ ] Los 3 extractores → `onConflictDoNothing`, fuera el `notes LIKE`
  - [ ] `pnpm db:generate` y **revisar el SQL**: si trae `DROP`, no aplicar
  - Archivos: `lib/db/schema.ts`, `drizzle/00XX_*.sql`, los 3 `*-from-workflow.ts`

### Checkpoint 3
- [ ] `pnpm run build` limpio; migración sin `DROP`
- [ ] Todos los specs de la feature verdes
- [ ] Un único mecanismo de idempotencia en los 4 extractores

## Phase 4 — Robustez y observabilidad

- [ ] **A10 — Tope de expansión en el resolver** · S · deps: ninguna
  - [ ] Límite alineado con el que ya respeta el conteo (`tests/limite-30-skus.spec.ts`)
  - [ ] Filtro sin coincidencias: fallo visible, no instancia vacía en silencio
  - Archivo: `lib/workflows/dynamic-steps.ts`

- [ ] **A11 — `createChildLogger` en vez de `console.*`** · S · deps: A2
  - [ ] 17 `console.*` → logger estructurado
  - [ ] `instanceId` / `companyId` / `branchId` como campos, no interpolados
  - [ ] Verificar: `grep -c "console\." lib/workflows/dynamic-steps.ts lib/services/*-from-workflow.ts` → 0

- [ ] **A12 — Scoping por `companyId` y retención** · S · deps: ninguna
  - [ ] `buildSnapshot` filtra `stock_counts` también por `companyId`
  - [ ] `DynamicResolveContext.branchId`: usarlo o quitarlo de la firma
  - [ ] Decidir si el snapshot omite ítems sin stock ni conteo
  - [ ] Escribir la política de retención (aunque sea "ninguna, por ahora")

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
