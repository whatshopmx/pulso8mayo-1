# Implementation Plan: Alcance por sucursal fail-closed

## Overview

`enforceBranchScope` colapsa dos situaciones distintas en el mismo `null`: **"este rol ve toda la
empresa"** y **"este rol está acotado a sucursal pero no tiene ninguna asignada"**. Todos sus
consumidores leen ese `null` como "no filtres por sucursal", así que un `GERENTE`/`SUPERVISOR` sin
`branchId` **falla abierto** justo en el caso que el helper existe para cerrar.

`users.branch_id` es `uuid` sin `.notNull()` (`lib/db/schema/auth.ts:35`), así que ese usuario es
representable. Hoy **no existe ninguno** (consulta del 2026-08-19: 1 GERENTE y 1 SUPERVISOR, ambos
con sucursal), de modo que esto es preventivo y **no necesita backfill**.

El helper fail-closed ya existe —`resolveBranchScope` en `lib/branch-scope.ts`, con
`BranchScope = ALL | BRANCH | NONE`— y las rutas de remediación ya lo usan. Este plan migra al resto
de consumidores que sí fallan abierto, cierra el hueco equivalente en incidentes, y elimina el
estado en origen.

> **Precondición**: el trabajo de `resolveBranchScope` está en el working tree **sin commitear**
> (`lib/branch-scope.ts`, `lib/api/remediation-access.ts`, las dos rutas de remediación y
> `scripts/test-branch-scope.ts`). Commitearlo antes de empezar la Phase 1.

## Inventario: qué falla abierto y qué no

Auditados los 15 call sites. **La mayoría ya está a salvo** — el trabajo real son 6 rutas más el
circuito de incidentes.

| Call site | Qué hace con `null` | Veredicto |
|---|---|---|
| `analytics/trends:315` | cae a `accessibleBranchIds` + guard `length === 0` | ✅ ya cierra |
| `analytics/temperature-monitoring:42` | ídem | ✅ ya cierra |
| `analytics/branch-performance:52` | ídem | ✅ ya cierra |
| `analytics/inventory/stock-valuation:29` | ídem | ✅ ya cierra |
| `analytics-service.ts:120` | ídem (`EMPTY_SUMMARY`) | ✅ ya cierra |
| `expenses:97` (POST) | `if (!branchId) throw badRequest` | ✅ ya cierra |
| `inventory/waste:159` (POST) | `effectiveBranchId !== requestedBranchId` → 403 | ✅ ya cierra |
| **`cash-flow/assumptions:49` (POST)** | **escribe el saldo inicial de la EMPRESA** | 🔴 abre (escritura) |
| **`reports/generate:95`** | exporta el grupo, y lo registra como `"ALL"` | 🔴 abre (exportación) |
| **`reports/execute:353`** | `if (sucursal)` → exporta el grupo, columnas sensibles incluidas | 🔴 abre (exportación) |
| **`cash-flow:32` (GET)** | `?? undefined` → proyección del grupo | 🟠 abre (lectura) |
| **`expenses:68` (GET)** | `?? undefined` → libro del grupo | 🟠 abre (lectura) |
| **`inventory/waste:57` (GET)** | `if (effectiveBranchId)` → mermas del grupo | 🟠 abre (lectura) |

Los cinco de analytics se salvan porque se emparejan con `getAccessibleBranchIds`, que **sí**
devuelve `[]` para un rol acotado sin sucursal. Esa asimetría entre los dos helpers es la raíz del
bug: uno falla cerrado y el otro abierto.

### Dos huecos más, de la misma familia

1. **`switchBranch` (`app/actions/user.ts:24`)** — el guard es
   `if (userBranchId && branchId !== userBranchId)`. Con `userBranchId` nulo el guard **se salta
   entero**, y la acción acto seguido **escribe** `users.branchId = branchId`. Es decir: el GERENTE
   sin sucursal puede auto-asignarse cualquier sucursal del grupo. Es el pivote que convierte el
   estado latente en escalada real, y por eso va en la Phase 1.

2. **`findIncidentForTenant` (`lib/api/incident-access.ts:13`)** no filtra por sucursal en absoluto,
   solo por tenant. Un GERENTE lee, edita, remedia y escala **cualquier** incidente de su empresa.
   6 call sites en 4 archivos de ruta. La lista (`app/dashboard/incidents/page.tsx:154`) se acota
   por *cookie* sin comprobar el rol, así que basta cambiar de sucursal para verla.

## Architecture Decisions

- **AD-1 — `enforceBranchScope` no cambia de semántica; se migra call site por call site.** Tiene
  15 consumidores y cambiarle el retorno en silencio convierte un bug de lectura en una caída. Se
  deprecia por sustitución, no por edición. Cuando el último consumidor migre, se borra.

- **AD-2 — `NONE` no es `ALL` ni es "su sucursal": es cero.** En lecturas se traduce a resultado
  vacío **declarando el alcance**; en escrituras y exportaciones, a error explícito. El repo ya
  eligió esta línea en finanzas ("cifras del grupo etiquetadas como una sucursal son peor que no
  tener el filtro", `expenses/route.ts:61`).

- **AD-3 — Lecturas devuelven vacío + `scope`, no 403.** `cash-flow` y `expenses` ya responden un
  envelope `{ items, scope }` que la pantalla rotula. Un 403 en una pantalla de dashboard es un
  callejón sin salida; un vacío rotulado "sin sucursal asignada" le dice al usuario qué pedirle a su
  admin. Ver Open Question #1.

- **AD-4 — Exportaciones y escrituras fallan con error explícito.** Un CSV vacío rotulado `"ALL"` es
  peor que un 403: parece un dato. Para `reports/*` y `cash-flow/assumptions`, `NONE` → 403 con
  mensaje accionable.

- **AD-5 — El alcance de incidentes se resuelve en `incident-access.ts`, no en cada ruta.** Añadir
  un parámetro `BranchScope` opcional a `findIncidentForTenant` mantiene el 404 indistinguible que
  ya tiene y evita repetir el filtro en 6 sitios.

- **AD-6 — Eliminar el estado en origen es parte del arreglo, no un extra.** Cerrar las lecturas
  sin cerrar `switchBranch` deja la puerta por la que se entra. Y validar el alta de usuario evita
  que el estado vuelva a aparecer.

## Task List

### Phase 1 — Escritura, exportación y escalada (mayor severidad primero)
- [ ] **T1**: `switchBranch` deja de saltarse el guard con sucursal nula
- [ ] **T2**: `cash-flow/assumptions` POST — `NONE` no escribe el saldo del grupo
- [ ] **T3**: `reports/generate` y `reports/execute` — `NONE` no exporta

### ✅ Checkpoint 1: nada escribe ni exporta fuera de alcance
- [ ] `npx tsc --noEmit` limpio
- [ ] `npx tsx scripts/test-branch-scope.ts` en verde
- [ ] Verificado a mano con un GERENTE de `branch_id` nulo (temporal, en transacción revertida)

### Phase 2 — Lecturas
- [ ] **T4**: `cash-flow` GET y `expenses` GET — vacío + `scope` declarado
- [ ] **T5**: `inventory/waste` GET — vacío

### ✅ Checkpoint 2: lecturas acotadas
- [ ] Las tres pantallas cargan sin romperse y rotulan el alcance
- [ ] `npx tsc --noEmit` limpio

### Phase 3 — Incidentes
- [ ] **T6**: `findIncidentForTenant` acepta `BranchScope`; migrar las 4 rutas
- [ ] **T7**: la lista de incidentes respeta el rol, no solo la cookie

### ✅ Checkpoint 3: circuito de incidentes acotado
- [ ] Un GERENTE no alcanza un incidente de otra sucursal (404) ni por detalle ni por lista
- [ ] `npx tsx scripts/test-incident-recommendation.ts` y `test-remediation-circuit.ts` en verde
- [ ] **Revisión con David antes de Phase 4**

### Phase 4 — Prevención y regresión
- [ ] **T8**: validar en el alta/edición de usuario + script de diagnóstico
- [ ] **T9**: spec e2e de alcance por sucursal

### ✅ Checkpoint 4: completo
- [ ] Spec e2e en verde contra un build
- [ ] Ningún consumidor de `enforceBranchScope` que falle abierto sigue sin migrar
- [ ] Todos los criterios marcados

## Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Migrar un call site cambia el comportamiento de un ADMIN sin `branchId` | **Alto** | Para roles no acotados `resolveBranchScope` devuelve `ALL`, no `NONE`. El script de paridad (`scripts/test-branch-scope.ts`) ya fija esa frontera; extenderlo en cada task |
| En `cash-flow/assumptions`, `branchId: null` es un valor **legítimo** (saldo a nivel empresa para ADMIN) | Alto | Es justo lo que `ALL` vs `NONE` separa. La task exige un caso de prueba por cada uno |
| T6 toca 5 archivos y roza el techo de tamaño | Medio | El cambio es mecánico (un argumento). Si se complica, partir en detalle (`[id]`) vs acciones (`remediate`/`escalate`/`actions`) |
| El spec e2e comparte la BD de dev y corre serial | Medio | Usar el GERENTE ya sembrado (`juan@pulso.mx`, fijado a Condesa) y el patrón `sesionDe` de `gastos-autorizaciones.spec.ts:49`; sembrar y limpiar por SQL con el tag `[E2E]` |
| `pnpm run build` no completa en este entorno (fuentes de Google) | Bajo | La puerta de tipos es `npx tsc --noEmit`; el build queda para CI o para una máquina con salida a `fonts.gstatic.com` |

## Open Questions

1. **¿`NONE` en lecturas devuelve vacío o 403?** AD-3 propone **vacío + `scope` rotulado**, porque
   las pantallas de finanzas ya tienen el envelope para decirlo y un 403 deja al usuario sin salida.
   La alternativa (403 en todo) es más consistente pero peor de usar. **Necesita tu decisión** —
   cambia el contrato de tres rutas y el copy de tres pantallas.

2. **¿T8 valida en la aplicación o en la base?** Un `CHECK (role NOT IN ('GERENTE','SUPERVISOR') OR
   branch_id IS NOT NULL)` es la garantía dura, pero si hay filas históricas que lo violen la
   migración falla al aplicarse. Propongo validación en el alta/edición + script de diagnóstico
   ahora, y la constraint después, cuando el diagnóstico confirme que la tabla está limpia.

3. **¿Se borra `enforceBranchScope` al final?** Una vez migrados los 6 call sites que fallan abierto,
   quedan 7 que ya cierran por otra vía. Migrarlos también es mecánico y dejaría un solo helper, a
   cambio de tocar archivos que hoy no tienen bug. Propongo migrarlos y borrar la función vieja,
   pero es scope opcional: no está en las tasks de arriba.

## Fuera de alcance

- `getAccessibleBranchIds` — ya falla cerrado; no se toca.
- El resto de rutas que no usan ninguno de los dos helpers (su alcance es solo por tenant y esa es
  otra auditoría).
- Cambiar `users.branch_id` a `NOT NULL` (rompería a ADMIN y SUPER_ADMIN, que legítimamente no
  tienen sucursal).
