# Plan de Cierre — Sprint 2 Track A (Intelligence Engines I)

> **Objetivo:** dejar el Track A formalmente cerrado (build verde, snapshots verificados
> en DB, contrato de tipos coherente) antes de abrir Sprint 3.
>
> **Origen:** auditoría del 2026-08-05 de `docs/pulso-executive-os-plan.md` (v1) y
> `docs/pulso-executive-os-v2.md` contra el código real. Complementa
> `docs/sprint-2-handoff.md` §3 ("Aceptación Track A"), que hoy **no se cumple**.
>
> **Documento de referencia del roadmap:** `docs/pulso-executive-os-v2.md`.
> La v1 está superada (ver Fase 4).

---

## Estado de partida (verificado)

| Elemento | Estado |
|---|---|
| Sprint 1 (Foundation) | ✅ Completo y commiteado |
| 5 engines Track A | ✅ Escritos (`operations`, `finance`, `brand`, `compliance`, `procurement`), los 5 implementan `IntelligenceEngine` y llaman `ExecutiveTwinEngine.setEngineSnapshot` |
| `refresh-engines.ts` | ❌ Sin commitear y **rompe la compilación** (48 errores de parseo) |
| `npx tsc --noEmit` | ❌ 48 errores, **todos** en `lib/inngest/functions/refresh-engines.ts` — el resto del repo está limpio |
| Migraciones `0028`, `0029` | ⚠️ Marcadas como pendientes de aplicar en el handoff; sin verificar contra la DB |
| Consumidor de los snapshots | ❌ No existe (solo `cashFlowProjection` se renderiza) |

Alcance de este plan: **Fases 0–4**. La Fase 5 queda como decisión de scope para Sprint 3,
no como trabajo comprometido aquí.

---

## Fase 0 — Desbloquear la compilación

**Archivo:** `lib/inngest/functions/refresh-engines.ts`

### 0.1 El bloque JSDoc se cierra solo (bug de build)

Línea 7 del header:

```
 * Trigger: cron "0 */6 * * *" (every 6 hours). For each company, calls
```

La secuencia `*/` de `*/6` **cierra el comentario de bloque**. Todo lo que sigue se
parsea como código: 48 errores (`TS1109`, `TS1002 Unterminated string literal`,
`TS1434`…). `pnpm run build` falla.

**Fix (preferido):** no repetir la expresión cron en la prosa; apuntar al bloque
`triggers`, que es la fuente de verdad.

```diff
- * Trigger: cron "0 */6 * * *" (every 6 hours). For each company, calls
- * "engine.refresh(companyId)" for each of the 5 engines. Each engine refresh runs
+ * Trigger: cron cada 6 horas (expresión exacta en `triggers`, abajo) + evento
+ * `executive/engines.refresh`. Para cada company llama `engine.refresh(companyId)`
+ * en cada uno de los 5 engines. Cada refresh corre
```

**Alternativa** si se quiere conservar la expresión en el comentario: escribirla
escapada (`0 *\/6 * * *`) o moverla a un comentario de línea `//`.

**Regla de repo a recordar:** una expresión cron con paso (`*/N`) nunca va dentro de
un comentario `/** … */`. `recalculate-executive-twin.ts` no tiene el problema porque
su `*/15 * * * *` vive en código, dentro de `triggers`.

### 0.2 `companyId` se pasa como `undefined`

`refresh-engines.ts:52-85`. `companyIds` es `string[]`, pero el loop lo trata como
objetos:

```diff
-    for (const company of companyIds) {
+    for (const companyId of companyIds) {
       for (const { engineId, engine } of ENGINES) {
         const res = await step.run(
-          `refresh-${company.id}-${engineId}`,
+          `refresh-${companyId}-${engineId}`,
           async (): Promise<{ ok: boolean; error?: string }> => {
             try {
-              await engine.refresh(company.id);
+              await engine.refresh(companyId);
               return { ok: true };
             } catch (err) {
               return {
                 ok: false,
                 error: err instanceof Error ? err.message : String(err),
               };
             }
           },
         );
         results.push({
-          companyId: company.id,
+          companyId,
           engineId,
           ...(res as { ok: boolean; error?: string }),
         });
```

Dos consecuencias, no una:

1. `engine.refresh(undefined)` — el engine consulta con un companyId inválido.
2. El **step ID no varía por company** (`refresh-undefined-operations` para todas).
   Inngest memoiza por step ID: con varios tenants, el resultado de la primera
   company se reutiliza para el resto y solo un tenant se refresca de verdad.

Este bug está enmascarado por 0.1: en cuanto el archivo parsee, `tsc` lo habría
señalado como error de tipo (`Property 'id' does not exist on type 'string'`).

### 0.3 Limpieza opcional (mismo archivo)

`import type { EngineOutput }` + `export type { EngineOutput }` al final del archivo
existen solo para justificarse mutuamente. Si nadie importa `EngineOutput` desde este
módulo, borrar ambas líneas.

```bash
grep -rn "from \"@/lib/inngest/functions/refresh-engines\"" app lib components
```

### 0.4 Verificación de la fase

```bash
npx tsc --noEmit          # debe salir sin output
pnpm run build            # verde (referencia handoff: ~317 páginas, Turbopack)
npx eslint lib/inngest/functions/refresh-engines.ts
```

**Criterio de salida:** `tsc` limpio. Nada más de este plan se valida hasta aquí.

---

## Fase 1 — Migraciones y verificación funcional de snapshots

El handoff avisa que `drizzle/0028_melted_reavers.sql` (Sec-0) y
`drizzle/0029_vengeful_scarlet_spider.sql` (Sprint 1, las +13 columnas ejecutivas)
quedaron **sin aplicar**. Todo lo que lee columnas nuevas falla en runtime si `0029`
no está en la DB.

### 1.1 Confirmar estado de la DB antes de tocar nada

```bash
# ¿A dónde apunta DATABASE_URL? Confirmar que NO es prod antes de migrar.
# Recomendado: Neon branch de prueba primero (v2 §6.1 "brownfield safety").
```

Comprobar si las columnas ya existen (vía Neon MCP o psql):

```sql
select column_name from information_schema.columns
where table_name = 'corporate_twins'
  and column_name in ('projected_cash_flow_cents', 'executive_state', 'people_risk');
```

- Si devuelven filas → `0029` ya está aplicada, seguir a 1.3.
- Si no → 1.2.

### 1.2 Aplicar

```bash
pnpm db:migrate     # NUNCA db:push (v2 §6.1)
```

`0029` debe ser solo `ALTER TABLE … ADD COLUMN` con defaults. Si el SQL contiene
`DROP`, detenerse y revisar el diff de schema.

### 1.3 Orden de verificación (importa)

`ExecutiveTwinEngine.setEngineSnapshot` (`lib/services/executive-twin-engine.ts:239`)
hace `if (!row) return;` — **es un no-op silencioso si la company todavía no tiene
fila en `corporate_twins`**. Por eso el twin se recalcula *antes* que los engines:

1. `POST /api/executive/twin/refresh` (o disparar el evento
   `executive/twin.recalculate`) → crea/actualiza la fila del twin.
2. Disparar `executive/engines.refresh` con `{ "companyId": "<uuid>" }` desde el
   Dev Server de Inngest (`npx inngest-cli@latest dev`).
3. Comprobar los 5 snapshots:

```sql
select
  jsonb_object_keys(executive_state -> 'engineSnapshots') as engine_id
from corporate_twins
where company_id = '<uuid>';
```

Esperado: `operations`, `finance`, `brand`, `compliance`, `procurement`.

4. Comprobar el criterio de aceptación del handoff (`confidence > 0` con datos reales):

```sql
select
  key as engine_id,
  value -> 'score' as score,
  value -> 'confidence' as confidence,
  jsonb_array_length(value -> 'priorities') as priorities
from corporate_twins,
     jsonb_each(executive_state -> 'engineSnapshots')
where company_id = '<uuid>';
```

**Criterio de salida:** 5 snapshots presentes, `confidence > 0` en una company con
datos, y el `return` del run reporta `ok: 5`.

### 1.4 Riesgo a anotar (no arreglar aquí)

El cron recorre **todas** las companies × 5 engines de forma secuencial, un `step.run`
por par. Con muchos tenants el run se alarga de forma lineal. Cuando el número de
companies crezca, la forma correcta es fan-out por evento (una run por company) o
`concurrency` con key por company — no un loop secuencial. Registrar como deuda,
no cambiarlo dentro de este cierre.

---

## Fase 2 — Coherencia del contrato `EngineId`

`lib/services/intelligence/types.ts:25-34` define 9 ids:

```
operations | finance | compliance | labor | inventory | brand | expansion | knowledge | procurement
```

Problemas contra el roadmap de la v2:

- **Falta `maintenance`**, y `MaintenanceEngine` está comprometido en Sprint 3 → el
  union hay que editarlo igual.
- `inventory` y `expansion` no corresponden a ningún engine del roadmap (el trabajo de
  inventario vive en `procurement`; expansión es una *dimensión* del twin,
  `expansionReadiness`, no un engine).
- El engine de personal se llamará `WorkforceEngine` pero el id disponible es `labor`.

**Acción (10 minutos, ahora):** dejar el union alineado con los 8 engines del roadmap y
decidir el nombre del de personal de una vez:

```diff
 export type EngineId =
   | 'operations'
   | 'finance'
   | 'compliance'
-  | 'labor'
-  | 'inventory'
+  | 'workforce'
+  | 'maintenance'
   | 'brand'
-  | 'expansion'
   | 'knowledge'
   | 'procurement';
```

Antes de aplicarlo, confirmar que ningún engine ya escrito usa `labor`/`inventory`/
`expansion` como su `engineId`, y que no hay snapshots persistidos con esas claves:

```bash
grep -rn "engineId: \"" lib/services/intelligence/
grep -rn "'labor'\|'inventory'\|'expansion'" lib/services lib/inngest app components
```

Si ya hubiera snapshots en DB con claves viejas, quedan como basura inofensiva en el
jsonb (`engineSnapshots` es un mapa parcial); opcionalmente limpiarlos en la misma
sesión de verificación de la Fase 1.

**Criterio de salida:** `tsc` limpio con el union nuevo; el nombre del engine de
personal decidido y escrito (afecta el nombre de archivo de Sprint 3).

---

## Fase 3 — Commit del cierre

Un solo commit, con el scope del Track A:

```
fix(intelligence): cerrar Sprint 2 Track A — refresh-engines cron

- refresh-engines.ts: el JSDoc se cerraba en "*/6" y rompía el parseo (48 errores)
- refresh-engines.ts: iteraba string[] usando company.id → refresh(undefined) y
  step IDs colisionando entre companies (memoización cruzada en Inngest)
- types.ts: EngineId alineado con los 8 engines del roadmap v2 (+maintenance,
  labor→workforce, -inventory, -expansion)

Verificado: tsc limpio, build verde, 5 snapshots en
corporate_twins.executive_state.engineSnapshots con confidence > 0.
```

**No incluir** en este commit los archivos modificados ajenos al Track A que ya venían
sueltos en el working tree (`app/api/workflows/smart-links/corte-caja/route.ts`,
`lib/inngest/functions/check-financial-alerts.ts`, la feature de
`emergency-departure`, los `.impeccable/critique/*`). El handoff §1 los declara
deliberadamente fuera de scope: van en sus propios commits.

---

## Fase 4 — Marcar la v1 como superada

`docs/pulso-executive-os-plan.md` (v1) sigue leyéndose como plan vigente, y contiene
tres afirmaciones que ya son falsas y que costarían trabajo duplicado a quien lo tome:

- pone el **CEO Dashboard como nuevo en Sprint 4** — existe desde antes
  (`app/dashboard/executive/page.tsx`, 8 componentes);
- dice **11 funciones Inngest** — hay 26;
- trata **Brand Intelligence como nuevo** — es reuso de
  `CrossBranchService.getBenchmarking` + `BranchRanking`.

**Acción:** añadir un banner al inicio de la v1, sin borrar el documento (el contexto
histórico del gap analysis sigue siendo útil):

```markdown
> ⚠️ **SUPERADO por `docs/pulso-executive-os-v2.md`.**
> Este documento subestimaba lo ya construido (CEO Dashboard, 26 funciones Inngest,
> CrossBranchService). Usar la v2 como plan de referencia. Se conserva por contexto
> histórico del gap analysis original.
```

Y actualizar `docs/sprint-2-handoff.md` §3 marcando la aceptación del Track A como
cumplida, con la fecha y el commit del cierre.

---

## Fase 5 — Decisión de scope para Sprint 3 (no comprometida aquí)

Hallazgo de la auditoría que conviene resolver **antes** de escribir tres engines más:

Los 5 engines calculan `insights`, `priorities` y `risks` cada 6 horas y los persisten,
pero **nada los lee**. El dashboard ejecutivo solo consume
`executiveState.cashFlowProjection`. Es inteligencia sin consumidor.

Dos caminos, a elegir al abrir Sprint 3:

| Opción | Qué implica | Cuándo conviene |
|---|---|---|
| **A. Seguir el orden de la v2** | Workforce + Maintenance + Knowledge → `PriorityEngine` → Morning Brief. Los outputs siguen sin verse hasta el `PriorityEngine`. | Si el objetivo es completar los 8 engines antes de exponer nada. |
| **B. Adelantar el consumidor** | `PriorityEngine` (consolidador) + un panel de prioridades en el dashboard ya existente, con 5 engines. Luego los 3 engines restantes se suman a un consumidor que ya funciona. | Si se necesita algo demostrable a un cliente pronto (métrica de negocio de la v1 §12: "demo con datos reales"). |

Recomendación: **B**. El `PriorityEngine` es el punto donde la arquitectura deja de ser
teórica, y validar el contrato `EngineOutput` con 5 engines es más barato que con 8. La
v2 también recorta Sprint 4 a "2 componentes + API" precisamente porque el dashboard ya
vive; el panel de prioridades es uno de esos dos.

Pendiente asociado: de las 7 rutas `/api/executive/*` del plan solo existen 2
(`twin`, `twin/refresh`). Faltan `brief`, `priorities`, `cashflow`, `reason`, `feed`.
`priorities` es la que desbloquea la opción B.

---

## Checklist de aceptación del cierre

- [ ] `npx tsc --noEmit` sin output
- [ ] `pnpm run build` verde
- [ ] `npx eslint` sin errores nuevos en los archivos tocados
- [ ] `0028` y `0029` aplicadas (o confirmadas ya presentes) vía `db:migrate`
- [ ] `executive_state.engineSnapshots` con los 5 engines y `confidence > 0`
- [ ] `EngineId` alineado con los 8 engines del roadmap
- [ ] Commit del cierre sin arrastrar cambios fuera de scope
- [ ] Banner de superado en la v1 + handoff §3 actualizado
- [ ] Opción A/B de Sprint 3 decidida y anotada en el handoff
