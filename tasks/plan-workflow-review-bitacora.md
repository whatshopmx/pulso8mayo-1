# Implementation Plan: Revisión de Workflows — de inspector de campos a bitácora

> **Origen:** investigación de `app/dashboard/workflows/review/[id]/page.tsx` (2026-08-11). Síntoma
> reportado: "sale *Paso 1 · Step abc-123*, *Comentario del Operador* y *Valor Registrado*; se siente mal
> conceptualmente para revisar un flujo".
> **Predecesor:** `tasks/plan-workflow-review-critique.md` — ese plan cerró la ambigüedad del veredicto, la
> accesibilidad y el cierre del bucle en el historial. **No tocó el contenido de los pasos**, que es
> justamente lo que aquí se corrige. Sus decisiones bloqueadas (finalidad de la revisión, rojo operativo en
> Aprobar, badge de veredicto compartido) se conservan.
> **Objetivos:** `components/workflow/workflow-review.tsx`, `app/dashboard/workflows/review/[id]/page.tsx`,
> `lib/services/workflow-execution-service.ts`, `lib/db/schema.ts`, `drizzle/0050_*`, `tests/`.
> **Build gate:** `pnpm build` (typecheck + lint). **Tests:** Playwright (`pnpm test:e2e`).

## Overview

La pantalla de revisión pinta columnas de base de datos en lugar de narrar qué pasó. La causa raíz es
estructural, no cosmética: `workflow_instance_steps` (`lib/db/schema.ts:90-101`) guarda **la respuesta**
(`value`, `comment`, `evidenceUrl`, `aiAnalysis`) pero no **la pregunta** — no tiene `title`, `type` ni
orden. La página pide ambos y cae en silencio a los fallbacks `Step ${stepId}` y `'TEXT'`
(`page.tsx:49-50`), y sin `type` el valor se imprime como `JSON.stringify` (`workflow-review.tsx:610-617`).

La definición del paso sí existe, en `workflow_templates.steps` (JSONB, forma `WorkflowStep` en
`lib/types/workflow.ts:77-95`: `title`, `description`, `type`, `unit`, `options`, `validation`), y **el
endpoint ya la devuelve** dentro de `template` (`workflow-execution-service.ts:157`) — el executor la
consume (`workflow-executor.tsx:173`), la revisión la ignora. Por eso la Fase 1 no necesita migración.

El plan convierte cada fila en una unidad narrativa — *se pidió → se registró → qué dijo la IA → quién y
cuándo* — y termina congelando la definición del paso en la instancia, que es lo único que hace la
revisión auditable frente a ediciones de plantilla y pasos dinámicos.

## Architecture Decisions

- **La definición del paso es la mitad faltante, y se resuelve en un solo lugar.** Un módulo puro
  (`lib/workflows/step-definitions.ts`) toma `template.steps` + `instance.steps` y devuelve un view model
  unido. Ni la página ni el componente vuelven a leer `template.steps` por su cuenta. Esto permite que la
  Fase 3 cambie la fuente (columnas congeladas) sin tocar la UI.
- **El render despacha por `type`, no por `typeof value`.** `YESNO`/`CHECKBOX` → Sí/No con color;
  `NUMBER` → valor + `unit` + si cayó fuera de `validation.min/max`; `SELECT` → opción elegida contra las
  disponibles; `PHOTO`/`SIGNATURE`/`VIDEO` → la imagen **es** el valor, no una sección aparte; `INFO` → no
  es un dato y no ocupa fila de revisión. `JSON.stringify` queda como último recurso visible sólo para
  tipos desconocidos.
- **El orden canónico pasa a ser el índice del array del template.** El plan anterior asumió "orden físico
  de inserción" y lo marcó como riesgo abierto (`plan-workflow-review-critique.md:353`). Se cierra aquí:
  `getExecution` gana `orderBy` explícito y la numeración se deriva de la posición en la plantilla.
- **La degradación es honesta.** Un paso sin definición resoluble se rotula "Paso sin definición en la
  plantilla" con su `stepId` en `<code>`, no "Step abc-123" disfrazado de título. El revisor debe poder
  distinguir *dato faltante* de *dato raro*.
- **Fases 1–2 no tocan el esquema.** Todo lo visible se arregla sin migración; la migración (Fase 3) sólo
  compra durabilidad e historia, y por eso va al final, cuando ya hay E2E que la protejan.
- **Congelar > re-resolver.** En Fase 3 la definición se copia a la instancia al crearla. Re-resolver
  pasos dinámicos en tiempo de lectura daría un conjunto distinto si el inventario cambió — inaceptable en
  una superficie de cumplimiento.
- **Los tabs bajan de 4 a 2.** "Con Evidencia" y "Verificados por IA" fragmentan la secuencia, que es
  justo lo que impide leer el flujo. Quedan "Todo" y "Requiere atención". Esto **modifica** la superficie
  probada por T8b del plan anterior; la cobertura de numeración canónica se conserva reescribiendo esas
  aserciones sobre los dos tabs restantes (T11), no eliminándolas.

## Dependency Graph

```
T1 resolver de definiciones (puro) ──┬──► T2 render por tipo ──► T3 fila-bitácora ──► T4 tabs + orden
                                     │                                                    │
                                     └──────────────────────────────────────────┐         │
T5 getExecution: branch + orderBy (independiente, paralelizable) ───────────────┼─────────┤
T6 valor sólo si el paso se completó (cliente) ─────────────────────────────────┘         │
                                                                                          ▼
                                                                        CP2 ──► T11 E2E actualizado
                                                                                          │
T7 migración 0050 ──► T8 createExecution congela ──► T9 backfill ──► T10 resolver prefiere ─┴──► T12 E2E dinámicos
```

## Task List

---

### Fase 1: La bitácora (cliente, sin migración)

#### Task 1: Resolver de definiciones de paso
**Description:** Nuevo módulo puro `lib/workflows/step-definitions.ts` que expone
`resolveStepDefinitions(templateSteps, instanceSteps)` y devuelve un arreglo ordenado de
`ResolvedReviewStep` = respuesta de la instancia + definición del template (`title`, `description`, `type`,
`unit`, `options`, `required`, `validation`) + `position` + `resolved: boolean`. El join es por
`instanceStep.stepId === templateStep.id`. Los pasos sin definición se conservan al final con
`resolved: false` (nunca se descartan: son evidencia de que algo se ejecutó). Sin React, sin acceso a BD —
testeable en aislamiento y reutilizable por el futuro export a PDF.

**Acceptance criteria:**
- [ ] `resolveStepDefinitions` devuelve los pasos en orden del array del template, con `position` 1..N
- [ ] Un `stepId` sin definición produce `resolved: false` y conserva la respuesta (valor, evidencia, comentario)
- [ ] Sin dependencias de React ni de `@/lib/db`

**Verification:**
- [ ] `pnpm build` limpio
- [ ] Comprobación manual con un template de 5 pasos y una instancia con un `stepId` inventado

**Dependencies:** None
**Files likely touched:** `lib/workflows/step-definitions.ts` (nuevo), `lib/types/workflow.ts`
**Estimated scope:** S (2 archivos)

#### Task 2: Render del valor por tipo de paso
**Description:** Nuevo `components/workflow/step-value.tsx` que recibe `{ type, value, unit, options,
validation }` y renderiza la respuesta legible según el tipo (ver decisión de arquitectura). Incluye el
contraste con lo pedido cuando existe: `NUMBER` fuera de `min/max` se marca con `text-destructive` y el
rango esperado; `SELECT` muestra la opción elegida y, en `title` accesible, las disponibles. Tipos
desconocidos: `<pre>` con el JSON, rotulado como "formato no reconocido". Reemplaza el bloque
`JSON.stringify` de `workflow-review.tsx:610-617`.

**Acceptance criteria:**
- [ ] `YESNO`, `CHECKBOX`, `NUMBER` (con `unit`), `SELECT`, `TEXT`, `DATE`, `TIME`, `PHOTO`, `SIGNATURE` renderizan sin JSON crudo
- [ ] Un `NUMBER` fuera de `validation.min/max` se marca visualmente y declara el rango esperado
- [ ] Un tipo fuera de `WorkflowStepType` cae al bloque JSON rotulado, sin romper el render
- [ ] Sólo tokens del sistema de diseño (`rg "text-(green|red|amber|emerald)-[0-9]" components/workflow/step-value.tsx` → vacío)

**Verification:**
- [ ] `pnpm build` limpio
- [ ] Manual: instancia sembrada con un paso de cada tipo; captura en claro y oscuro

**Dependencies:** Task 1
**Files likely touched:** `components/workflow/step-value.tsx` (nuevo)
**Estimated scope:** M (1 archivo, lógica por tipo)

#### Task 3: La fila del paso se lee como bitácora
**Description:** Reescribir `StepDetail` (`workflow-review.tsx:532-697`) para que cada fila exprese
*se pidió → se registró → veredicto IA → quién y cuándo*. El título es el real (T1); debajo, la
`description` del template como "Se pidió"; la respuesta vía `<StepValue>` (T2); `completedBy` y
`completedAt` en la fila, no escondidos en el acordeón. Se eliminan las etiquetas de campo de BD
("Comentario del Operador:", "Valor Registrado:", "Análisis de Inteligencia Artificial:") en favor de
lenguaje de bitácora ("Registró", "Nota del operador", "Verificación IA"). Los pasos con hallazgo
(IA fallida, `status` FAILED/REJECTED, o comentario) **vienen expandidos**; el resto colapsado. Los pasos
`INFO` se renderizan como separador de contexto, sin badge de estado ni fila de respuesta.

**Acceptance criteria:**
- [ ] Ninguna fila muestra `Step <id>`; los pasos sin definición dicen "Paso sin definición en la plantilla" con el `stepId` en `<code>`
- [ ] Un paso con hallazgo aparece expandido al cargar; uno limpio, colapsado
- [ ] `completedBy` (nombre, no ID) y hora visibles sin expandir
- [ ] `rg "Valor Registrado|Comentario del Operador" components/` → vacío
- [ ] Se conserva el camino de teclado del plan anterior: `<button>` real, `aria-expanded`, `aria-controls`

**Verification:**
- [ ] `pnpm build` limpio
- [ ] Manual: recorrido sólo con teclado (Tab → Enter) sigue expandiendo y abriendo evidencia
- [ ] Cubierto por T11

**Dependencies:** Task 2
**Files likely touched:** `components/workflow/workflow-review.tsx`
**Estimated scope:** M (1 archivo, sección grande)

#### Task 4: Dos tabs y numeración canónica
**Description:** Colapsar los cuatro tabs (`workflow-review.tsx:270-349`) a "Todo (N)" y
"Requiere atención (N)". El conteo de evidencia y de verificados por IA se conserva en la tarjeta resumen
"Verificación IA", que ya existe (`:220-256`) — no se pierde información, se deja de fragmentar la
secuencia. La numeración pasa a venir de `position` (T1) en lugar del `Map` local `stepNumbers`
(`:102-106`). La página deja de transformar `execution.steps` a mano (`page.tsx:46-57`) y delega en
`resolveStepDefinitions`.

**Acceptance criteria:**
- [ ] Quedan exactamente 2 tabs; los conteos de evidencia/IA siguen visibles en la tarjeta resumen
- [ ] En "Requiere atención", un paso que es el 3.º del flujo muestra "Paso 3" (nunca renumerado)
- [ ] `page.tsx` construye `WorkflowReviewData` vía `resolveStepDefinitions`, sin fallbacks `|| 'Step ...'` ni `|| 'TEXT'`
- [ ] `rg "Step \\$\\{|\\|\\| 'TEXT'" app/dashboard/workflows/review` → vacío

**Verification:**
- [ ] `pnpm build` limpio
- [ ] Cubierto por T11

**Dependencies:** Task 3
**Files likely touched:** `components/workflow/workflow-review.tsx`, `app/dashboard/workflows/review/[id]/page.tsx`
**Estimated scope:** M (2 archivos)

---

### Checkpoint 1 (tras T1–T4)
- [ ] `pnpm build` limpio
- [ ] Una ejecución real se lee de arriba a abajo sin abrir un solo acordeón para entender qué pasó
- [ ] Capturas claro/oscuro revisadas por humano **antes** de tocar backend

---

### Fase 2: Backend chico (sin migración)

#### Task 5: `getExecution` devuelve sucursal, orden y revisor
**Description:** `WorkflowExecutionService.getExecution` (`:111-159`) no consulta la sucursal — por eso
"Sucursal: N/A" es permanente (`page.tsx:38` lee `execution.branch?.name`) — y trae los pasos sin
`orderBy`, dejando la numeración a merced del heap de Postgres. Añadir el fetch de `branches` por
`instance.branchId`, `orderBy` explícito en `workflowInstanceSteps`, y resolver los nombres de
`completedBy` en un solo query (`inArray` sobre los IDs distintos) para T3. Respuesta aditiva: ningún
consumidor existente cambia de forma.

**Acceptance criteria:**
- [ ] La respuesta incluye `branch: { id, name }` y la página muestra la sucursal real
- [ ] Los pasos llegan con orden estable y determinista entre peticiones
- [ ] `completedBy` viene resuelto a nombre; los IDs sin usuario caen a `null`, no a string vacío
- [ ] Una sola consulta adicional para todos los usuarios (sin N+1)

**Verification:**
- [ ] `pnpm build` limpio
- [ ] Manual: `GET /api/workflows/executions/<id>` incluye `branch` y pasos ordenados en 3 llamadas seguidas

**Dependencies:** None (paralelizable con T1–T4)
**Files likely touched:** `lib/services/workflow-execution-service.ts`
**Estimated scope:** S (1 archivo)

#### Task 6: Un paso no completado no tiene "respuesta"
**Description:** `createExecution` pre-siembra `value` con `step.metadata` al crear la instancia
(`:94-96`), así que un paso jamás contestado llega a la revisión con un blob JSON que la UI presenta como
"Valor Registrado". Corrección acotada y segura en el cliente: `<StepValue>` sólo se renderiza cuando
`status === 'COMPLETED'`; en PENDING/SKIPPED la fila dice "Sin registrar" / "Omitido". **No** se cambia la
siembra en el backend en este plan: `value` es leído por el executor y por el conteo de inventario
(`systemQuantity`, `itemId`) y desenredarlo merece su propio cambio con sus propias pruebas — queda
registrado como seguimiento en `PROJECT_CONTEXT.md`.

**Acceptance criteria:**
- [ ] Un paso PENDING o SKIPPED nunca muestra un valor; muestra "Sin registrar" u "Omitido"
- [ ] Un paso COMPLETED sin `value` (p. ej. sólo foto) no muestra una caja vacía
- [ ] El conteo de inventario sigue mostrando su cantidad registrada

**Verification:**
- [ ] `pnpm build` limpio
- [ ] Manual: instancia con un paso PENDING y una de conteo de inventario

**Dependencies:** Task 2
**Files likely touched:** `components/workflow/workflow-review.tsx`, `components/workflow/step-value.tsx`
**Estimated scope:** XS (2 archivos, cambio pequeño)

---

### Checkpoint 2 (tras T5–T6)
- [ ] `pnpm build` limpio
- [ ] Sucursal real, orden estable, sin valores fantasma
- [ ] **T11 se ejecuta aquí**: la suite anterior debe quedar verde antes de abrir la Fase 3

---

### Fase 3: Congelar la definición (migración)

#### Task 7: Migración 0050 — la instancia guarda su propia definición
**Description:** Añadir a `workflow_instance_steps` (`lib/db/schema.ts:90-101`): `step_order integer`,
`title text`, `type text`, `definition jsonb` (copia íntegra del `WorkflowStep` resuelto). Todas
nullable, para que el backfill (T9) sea incremental y el código de Fase 1 siga funcionando mientras tanto.
Generar con `pnpm db:generate` → `drizzle/0050_*.sql`.

**Acceptance criteria:**
- [ ] Migración generada, revisada a mano y aplicada; sin cambios destructivos
- [ ] Todas las columnas nuevas son nullable
- [ ] **La migración está aplicada en la base, no sólo commiteada** — verificado consultando el esquema real

**Verification:**
- [ ] `pnpm db:migrate` y luego inspección del esquema en Neon confirmando las 4 columnas
- [ ] `pnpm build` limpio

**Dependencies:** Checkpoint 2
**Files likely touched:** `lib/db/schema.ts`, `drizzle/0050_*.sql`, `drizzle/meta/*`
**Estimated scope:** S (2 archivos + meta)

#### Task 8: `createExecution` congela la definición
**Description:** En el `insert` de `workflowInstanceSteps` (`workflow-execution-service.ts:84-105`),
escribir `stepOrder` (índice del array ya resuelto), `title`, `type` y `definition` desde el `steps` que la
función **ya tiene en memoria tras expandir** conteo de inventario y `dynamicSource` (`:36-57`). Este es el
único punto donde los pasos dinámicos existen completos; hoy se descartan.

**Acceptance criteria:**
- [ ] Una instancia nueva de conteo de inventario guarda el título real de cada sub-paso dinámico
- [ ] `stepOrder` refleja el orden de ejecución resuelto
- [ ] `definition` contiene el `WorkflowStep` completo (con `unit`, `options`, `validation`)

**Verification:**
- [ ] `pnpm build` limpio
- [ ] Manual: crear una ejecución de conteo y consultar los pasos en BD

**Hallazgo durante la implementación (2026-08-11):** `createExecution` **no es la única** ruta de creación.
`StockCountService.startStockCount` (`lib/services/stock-count-service.ts:249`) inserta sus propios pasos
de instancia, y son precisamente los generados por SKU — los que no existen en la plantilla y cuyo título
sería irrecuperable. Congelar sólo en `workflow-execution-service` habría dejado el AC sin cumplir para
los conteos nuevos. Ambas rutas congelan ahora.

**Dependencies:** Task 7
**Files likely touched:** `lib/services/workflow-execution-service.ts`, `lib/services/stock-count-service.ts`
**Estimated scope:** S (2 archivos)

#### Task 9: Backfill de instancias existentes
**Description:** Script `scripts/backfill-step-definitions.ts` (patrón de `scripts/seed-*.ts`, ejecutable
con `npx tsx`) que, por instancia, une contra su template y rellena `step_order`/`title`/`type`/
`definition` donde estén NULL. Idempotente y re-ejecutable. Los pasos dinámicos históricos **no** son
recuperables: se dejan NULL y el resolver los degrada honestamente (T1) — el script reporta cuántos quedaron
así, para que el número sea conocido y no una sorpresa en producción.

**Acceptance criteria:**
- [ ] Re-ejecutar el script no cambia filas ya rellenadas
- [ ] Informe final: instancias procesadas, pasos rellenados, pasos irrecuperables
- [ ] No modifica `value`, `comment`, `evidence_url` ni `ai_analysis` bajo ninguna circunstancia

**Verification:**
- [ ] Ejecución en rama de Neon primero, comparando conteos antes/después
- [ ] Segunda ejecución reporta 0 filas modificadas

**Dependencies:** Task 8
**Files likely touched:** `scripts/backfill-step-definitions.ts` (nuevo), `package.json`
**Estimated scope:** M (2 archivos)

#### Task 10: El resolver prefiere la definición congelada
**Description:** `resolveStepDefinitions` (T1) pasa a usar `title`/`type`/`definition`/`stepOrder` de la
instancia cuando existen, y sólo cae al join con `template.steps` cuando son NULL (instancias previas al
backfill o pasos irrecuperables). La UI no cambia; cambia de dónde salen los datos. Es el paso que hace la
revisión inmune a ediciones posteriores de la plantilla.

**Acceptance criteria:**
- [ ] Editar el título de un paso en la plantilla **no** altera una revisión ya ejecutada y backfilleada
- [ ] Una instancia sin columnas congeladas sigue resolviendo por template (sin regresión)
- [ ] Un paso dinámico histórico irrecuperable se muestra degradado, no como "Step <id>"

**Verification:**
- [ ] `pnpm build` limpio
- [ ] Manual: editar la plantilla y recargar una revisión anterior
- [ ] Cubierto por T12

**Dependencies:** Task 9
**Files likely touched:** `lib/workflows/step-definitions.ts`
**Estimated scope:** S (1 archivo)

---

### Fase 4: Prueba

#### Task 11: Actualizar la suite E2E existente
**Description:** `tests/workflow-review.spec.ts` se apoya en la superficie anterior y **fallará** tras la
Fase 1: asume 4 tabs (`:174-191`), el texto literal `"Valor Registrado:"` (`:217`) y
`aria-expanded="false"` inicial en el paso 3 (`:211`) — que ahora vendrá expandido por tener hallazgo.
Actualizar sin perder cobertura: la numeración canónica se prueba sobre "Todo" (1–5) y "Requiere atención"
(Paso 3); el camino de teclado se prueba sobre un paso **sin** hallazgo (que sí llega colapsado); las
aserciones de valor pasan al nuevo lenguaje. Ampliar `seedReviewInstance` (`tests/support/db.ts:855-924`)
para que los pasos sembrados lleven `type`, `unit` y `validation` reales, y añadir una aserción de que un
`NUMBER` fuera de rango se marca.

**Acceptance criteria:**
- [ ] Los 4 tests existentes pasan contra la superficie nueva
- [ ] La cobertura de numeración canónica se conserva (con el caso desalineado de `pasosDesalineados()`)
- [ ] Nuevo caso: un paso con `stepId` sin definición se muestra degradado, no como "Step ..."
- [ ] Nuevo caso: `NUMBER` fuera de `validation.min/max` se marca

**Verification:**
- [ ] `pnpm test:e2e tests/workflow-review.spec.ts` verde

**Dependencies:** Task 4 (se ejecuta en Checkpoint 2)
**Files likely touched:** `tests/workflow-review.spec.ts`, `tests/support/db.ts`
**Estimated scope:** M (2 archivos)

#### Task 12: E2E — pasos dinámicos y durabilidad
**Description:** Nuevo caso que siembra una instancia con definición congelada (post-T8), edita el título
del paso en la plantilla, recarga la revisión y verifica que sigue mostrando el título histórico. Segundo
caso: instancia con pasos dinámicos que muestra sus títulos reales.

**Acceptance criteria:**
- [ ] Editar la plantilla no altera la revisión ya ejecutada
- [ ] Los pasos dinámicos muestran su título real
- [ ] Limpieza idempotente en `afterEach`

**Verification:**
- [ ] `pnpm test:e2e tests/workflow-review.spec.ts` verde

**Dependencies:** Task 10, Task 11
**Files likely touched:** `tests/workflow-review.spec.ts`, `tests/support/db.ts`
**Estimated scope:** M (2 archivos)

---

### Checkpoint 3 (Completo)
- [ ] `pnpm build` verde
- [ ] `pnpm test:e2e tests/workflow-review.spec.ts` verde
- [ ] Migración 0050 verificada como **aplicada** en la base, no sólo commiteada
- [ ] Backfill ejecutado con informe archivado
- [ ] Seguimientos registrados en `PROJECT_CONTEXT.md` (pre-siembra de `value`; export a PDF de la bitácora)
- [ ] `tasks/todo-workflow-review-bitacora.md` actualizado; humano aprueba antes de merge

## Riesgos y Mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Migración commiteada pero **no aplicada** en la base (ya ocurrió en este repo) | Alto | AC explícito en T7: verificar el esquema real, no el archivo. Columnas nullable ⇒ el código funciona igual si el backfill se retrasa |
| La suite E2E existente falla al terminar la Fase 1 | Alto | Previsto: T11 es parte del plan y se ejecuta en el Checkpoint 2, no al final |
| Colapsar a 2 tabs contradice la decisión #3 del plan anterior ("Por Revisar" sin cambios) | Medio | La semántica de "Por Revisar" se conserva íntegra en "Requiere atención"; sólo desaparecen los dos tabs de filtro. Pregunta abierta para el humano antes de T4 |
| Conteo de inventario: instancias con cientos de pasos + auto-expandir | Medio | Sólo se auto-expanden pasos con hallazgo; medir con una instancia real de conteo en CP1 antes de dar por buena la Fase 1 |
| Fase 1 muestra el título **actual** de la plantilla, no el histórico | Medio | Limitación aceptada y declarada; es exactamente lo que cierra la Fase 3. No prometer inmutabilidad hasta T10 |
| `definition` jsonb duplica datos del template (crecimiento de tabla) | Bajo | Es el precio de una acta autocontenida; los pasos son decenas por instancia, no miles (salvo conteo, ya acotado) |
| Backfill toca datos de producción | Alto | Sólo escribe columnas nuevas y sólo donde son NULL; se prueba primero en rama de Neon; idempotente por construcción |

## Decisiones Bloqueadas (2026-08-11)

1. **Tabs → colapsar a 2** ("Todo" / "Requiere atención"). Supersede la decisión #3 del plan anterior, que
   dejaba los cuatro tabs intactos. La semántica de "Por Revisar" se conserva íntegra bajo el nuevo nombre;
   lo que desaparece son los dos tabs de filtro puro. T11 reescribe las aserciones afectadas.
2. **Alcance → las 4 fases completas**, incluida la migración 0050 y el backfill.
3. **Export a PDF → resuelto por diseño, no se implementa.** T1 ya exige que el resolver sea un módulo puro
   y serializable, así que la puerta queda abierta sin costo adicional. No se construye hasta que se pida.

## Preguntas Abiertas

1. **¿Backfill de todo el histórico o sólo de instancias sin revisar?** El histórico ya revisado es
   inmutable por diseño; rellenarlo mejora su legibilidad pero reescribe filas de un acta cerrada.
   **Bloquea T9** — se decide al llegar a la Fase 3, no antes.
2. **Ejecución del backfill contra producción requiere confirmación explícita** en el momento. Se prueba
   primero en rama de Neon y se presenta el informe antes de tocar la base real.
