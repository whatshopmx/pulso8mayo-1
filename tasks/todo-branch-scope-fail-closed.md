# Todo List: Alcance por sucursal fail-closed

Plan: `tasks/plan-branch-scope-fail-closed.md`

**Precondición**: commitear el trabajo de `resolveBranchScope` que está en el working tree
(`lib/branch-scope.ts`, `lib/api/remediation-access.ts`, las dos rutas de remediación,
`scripts/test-branch-scope.ts`).

**Puerta de verificación**: `npx tsc --noEmit` (el `pnpm run build` no completa en esta máquina por
la descarga de Geist desde `fonts.gstatic.com`; el fallo no es de código).

---

## Phase 1 — Escritura, exportación y escalada

### T1: `switchBranch` deja de saltarse el guard con sucursal nula

**Descripción**: `app/actions/user.ts:24` guarda con
`if (userBranchId && branchId !== userBranchId)`. Cuando `userBranchId` es nulo la condición corta
en el primer operando y **el guard entero se salta**, así que un GERENTE sin sucursal pasa derecho
y la acción a continuación **escribe** `users.branchId = branchId` (línea 43): se auto-asigna la
sucursal que quiera del grupo. Va primero porque es la puerta por la que el estado latente se
convierte en escalada real.

**Acceptance criteria**:
- [ ] Un rol acotado **sin** `branchId` no puede cambiar de sucursal: la acción lanza, no escribe
- [ ] Un rol acotado **con** `branchId` sigue pudiendo "cambiar" a la suya (hoy funciona; no romperlo)
- [ ] ADMIN y SUPER_ADMIN siguen cambiando a cualquier sucursal de su empresa
- [ ] El guard se expresa con `resolveBranchScope`, no con un `&&` que dependa del orden

**Verificación**:
- [ ] `npx tsx scripts/test-branch-scope.ts` extendido con el caso del guard
- [ ] `npx tsc --noEmit`
- [ ] Manual: poner `branch_id = NULL` a `juan@pulso.mx` en una transacción, intentar el cambio de
      sucursal desde el selector, confirmar que falla, y hacer `ROLLBACK`

**Dependencias**: Ninguna
**Archivos**:
- `app/actions/user.ts`
- `scripts/test-branch-scope.ts`

**Scope**: XS (2 archivos)

---

### T2: `cash-flow/assumptions` POST — `NONE` no escribe el saldo del grupo

**Descripción**: `app/api/finance/cash-flow/assumptions/route.ts:49` pasa el `branchId` resuelto a
`saveCashFlowAssumption`. Un `null` ahí significa **saldo inicial a nivel empresa**, que es legítimo
para ADMIN y catastrófico para un GERENTE sin sucursal: escribiría el saldo de apertura del grupo
entero. Es la única escritura de la lista, por eso abre la fase.

**Acceptance criteria**:
- [ ] `NONE` → 403 con mensaje accionable ("Tu usuario no tiene sucursal asignada; pídele a un
      administrador que te asigne una"), sin tocar la BD
- [ ] `ALL` (ADMIN/SUPER_ADMIN sin pedir sucursal) **sigue** escribiendo el saldo a nivel empresa —
      este es el caso que no se puede romper
- [ ] `BRANCH` escribe el saldo de esa sucursal, igual que hoy
- [ ] La ruta usa `resolveBranchScope`; el `null` deja de ser ambiguo en este archivo

**Verificación**:
- [ ] Casos en `scripts/test-branch-scope.ts` para las tres ramas (`ALL` escribe empresa, `BRANCH`
      escribe sucursal, `NONE` no escribe)
- [ ] `npx tsc --noEmit`
- [ ] Manual: como ADMIN, guardar un saldo de empresa y confirmar que sigue guardándose
- [ ] SQL de diagnóstico: `SELECT count(*) FROM cash_flow_assumptions WHERE branch_id IS NULL`
      antes y después — la cifra no debe crecer por un rol acotado

**Dependencias**: Ninguna
**Archivos**:
- `app/api/finance/cash-flow/assumptions/route.ts`
- `scripts/test-branch-scope.ts`

**Scope**: XS (2 archivos)

---

### T3: `reports/generate` y `reports/execute` — `NONE` no exporta

**Descripción**: Las dos rutas de exportación tratan el `null` como "todas las sucursales".
`reports/generate:95` además **registra el alcance como `"ALL"` en el historial**, así que el
registro afirmaría que la exportación fue deliberadamente de grupo. `reports/execute:353` filtra con
`if (sucursal)`, y esa ruta puede incluir columnas marcadas `sensitive`. Un archivo vacío rotulado
`"ALL"` es peor que un error: parece un dato (AD-4).

**Acceptance criteria**:
- [ ] `NONE` → 403 en ambas rutas, sin generar archivo ni fila de historial
- [ ] `ALL` sigue exportando el grupo para roles no acotados, y el historial lo sigue registrando
      como `"ALL"`
- [ ] `BRANCH` exporta solo esa sucursal, igual que hoy
- [ ] El alcance que se registra en el historial es el **aplicado**, no el pedido (ya es así; no
      perderlo en el refactor)

**Verificación**:
- [ ] Casos en `scripts/test-branch-scope.ts` para las tres ramas en ambas rutas
- [ ] `npx tsc --noEmit`
- [ ] Manual: exportar como ADMIN y confirmar que el CSV sale igual que antes
- [ ] Revisar `reportExecutionHistory`: ninguna fila nueva con alcance `"ALL"` creada por un rol acotado

**Dependencias**: Ninguna
**Archivos**:
- `app/api/reports/generate/route.ts`
- `app/api/reports/execute/route.ts`
- `scripts/test-branch-scope.ts`

**Scope**: S (3 archivos)

---

### ✅ Checkpoint 1: nada escribe ni exporta fuera de alcance
- [ ] `npx tsc --noEmit` limpio
- [ ] `npx tsx scripts/test-branch-scope.ts` en verde
- [ ] Verificado a mano con un GERENTE de `branch_id` nulo (temporal, revertido con `ROLLBACK`)
- [ ] Confirmado que ADMIN no perdió ninguna capacidad

---

## Phase 2 — Lecturas

### T4: `cash-flow` GET y `expenses` GET — vacío + `scope` declarado

**Descripción**: Las dos rutas resuelven el alcance y lo pasan como `?? undefined`, que aguas abajo
significa "toda la empresa": `getCashFlowProjection` proyecta el grupo y `getOperatingExpenses`
devuelve el libro del grupo. Las dos **ya responden un envelope con `scope`** que la pantalla
rotula, así que la salida honesta para `NONE` es vacío con el alcance declarado (AD-3).
Van juntas porque comparten el envelope y el copy.

**Acceptance criteria**:
- [ ] `NONE` → `items: []` / proyección vacía, con `scope` que distinga "sin sucursal asignada" de
      "grupo completo"
- [ ] `ALL` sigue devolviendo las cifras del grupo para roles no acotados
- [ ] La pantalla rotula el caso `NONE` con un mensaje que diga qué hacer, no un cero mudo
- [ ] Ninguna cifra de grupo queda etiquetada como si fuera de una sucursal

**Verificación**:
- [ ] Casos en `scripts/test-branch-scope.ts` para las tres ramas en ambas rutas
- [ ] `npx tsc --noEmit`
- [ ] Manual: las dos pantallas cargan como hoy para ADMIN y para el GERENTE de Condesa
- [ ] `pnpm exec playwright test tests/cash-flow.spec.ts` sigue en verde (ya cubre alcance por rol)

**Dependencias**: T2 (misma familia de rutas; evita conflicto en `cash-flow`)
**Archivos**:
- `app/api/finance/cash-flow/route.ts`
- `app/api/expenses/route.ts`
- `components/finance/cash-flow-calendar.tsx` (copy del alcance)
- `scripts/test-branch-scope.ts`

**Scope**: M (4 archivos)

---

### T5: `inventory/waste` GET — vacío

**Descripción**: `app/api/inventory/waste/route.ts:57` filtra con `if (effectiveBranchId)`, así que
`NONE` devuelve las mermas de todas las sucursales del grupo. El POST de la misma ruta (línea 159)
**ya falla cerrado** vía `effectiveBranchId !== requestedBranchId` → 403; solo hay que arreglar la
lectura, sin tocar la escritura.

**Acceptance criteria**:
- [ ] `NONE` → lista vacía, no el grupo
- [ ] El POST no cambia de comportamiento (sigue dando 403 por la vía que ya tiene)
- [ ] `ALL` y `BRANCH` idénticos a hoy

**Verificación**:
- [ ] Caso en `scripts/test-branch-scope.ts`
- [ ] `npx tsc --noEmit`
- [ ] Manual: la pantalla de mermas carga igual para ADMIN y para el GERENTE de Condesa

**Dependencias**: Ninguna
**Archivos**:
- `app/api/inventory/waste/route.ts`
- `scripts/test-branch-scope.ts`

**Scope**: XS (2 archivos)

---

### ✅ Checkpoint 2: lecturas acotadas
- [ ] Las tres pantallas cargan sin romperse y rotulan el alcance
- [ ] `npx tsc --noEmit` limpio
- [ ] Ningún consumidor de la tabla del plan sigue marcado 🟠

---

## Phase 3 — Incidentes

### T6: `findIncidentForTenant` acepta `BranchScope`; migrar las 4 rutas

**Descripción**: `lib/api/incident-access.ts:13` filtra solo por tenant, así que un GERENTE alcanza
**cualquier** incidente de su empresa: lo lee (`[id]` GET), lo edita (PATCH), lo borra (DELETE), lo
remedia y lo escala. El alcance se resuelve en el helper y no en cada ruta (AD-5), conservando el
404 indistinguible que ya tiene.

**Acceptance criteria**:
- [ ] `findIncidentForTenant` acepta un tercer parámetro `BranchScope` con default `{ kind: 'ALL' }`,
      de modo que los call sites no migrados compilan y no cambian de comportamiento
- [ ] `NONE` → `null` → 404, igual que un incidente ajeno
- [ ] `BRANCH` → 404 para incidentes de otra sucursal, indistinguible de uno inexistente
- [ ] Las 4 rutas (`[id]`, `remediate`, `escalate`, `actions`) pasan el alcance de la sesión

**Verificación**:
- [ ] `npx tsx scripts/test-incident-recommendation.ts` y `scripts/test-remediation-circuit.ts` siguen en verde
- [ ] `npx tsc --noEmit`
- [ ] Manual: como GERENTE de Condesa, pedir por id un incidente de Polanco → 404 en las 6 rutas
- [ ] Manual: como ADMIN, las mismas 6 rutas siguen respondiendo 200

**Dependencias**: Ninguna (independiente de las Phases 1–2)
**Archivos**:
- `lib/api/incident-access.ts`
- `app/api/incidents/[id]/route.ts`
- `app/api/incidents/[id]/remediate/route.ts`
- `app/api/incidents/[id]/escalate/route.ts`
- `app/api/incidents/[id]/actions/route.ts`

**Scope**: M (5 archivos — en el techo; si se complica, partir en detalle vs acciones)

---

### T7: la lista de incidentes respeta el rol, no solo la cookie

**Descripción**: `app/dashboard/incidents/page.tsx:154` toma la sucursal de una cookie
(`BRANCH_COOKIE_NAME`) y `buildConditions` la aplica tal cual, sin mirar el rol. Un GERENTE que
cambia de sucursal ve la lista de otra. Con T1 el cambio de sucursal ya no es posible sin tener una
asignada, pero la página debe acotar por su cuenta y no depender de eso.

**Acceptance criteria**:
- [ ] La sucursal efectiva sale de `resolveBranchScope(rol, sucursalDelUsuario, cookie)`, no de la cookie sola
- [ ] `NONE` → lista vacía con un mensaje que explique por qué, no un "no hay incidentes" engañoso
- [ ] ADMIN y SUPER_ADMIN siguen pudiendo filtrar por cualquier sucursal vía cookie
- [ ] El badge y el filtro "Requieren acción" siguen funcionando igual

**Verificación**:
- [ ] `npx tsc --noEmit`
- [ ] Manual: como GERENTE de Condesa con la cookie apuntando a Polanco, la lista no muestra incidentes de Polanco
- [ ] Manual: el conteo de la cabecera coincide con las filas mostradas

**Dependencias**: T6 (mismo dominio; evita dos definiciones distintas de alcance)
**Archivos**:
- `app/dashboard/incidents/page.tsx`

**Scope**: S (1 archivo)

---

### ✅ Checkpoint 3: circuito de incidentes acotado
- [ ] Un GERENTE no alcanza un incidente de otra sucursal (404) ni por detalle ni por lista
- [ ] Los dos scripts de incidentes en verde
- [ ] `npx tsc --noEmit` limpio
- [ ] **Revisión con David antes de Phase 4**

---

## Phase 4 — Prevención y regresión

### T8: validar en el alta/edición de usuario + script de diagnóstico

**Descripción**: Cerrar los consumidores evita el daño; impedir el estado evita el bug. Un usuario
`GERENTE`/`SUPERVISOR` sin `branchId` no debería poder crearse ni quedarse así tras una edición.
Se hace en la aplicación, no con una constraint, hasta que el diagnóstico confirme que la tabla está
limpia (Open Question #2).

**Acceptance criteria**:
- [ ] Crear o editar un usuario a rol acotado **sin** sucursal falla con un mensaje en español que
      diga qué falta
- [ ] Cambiar a un rol no acotado (ADMIN/SUPER_ADMIN) sigue permitiendo `branchId` nulo
- [ ] `scripts/check-branch-scope-drift.ts` (nuevo) lista los usuarios en el estado inválido y sale
      con código ≠ 0 si encuentra alguno

**Verificación**:
- [ ] `npx tsx scripts/check-branch-scope-drift.ts` sale en 0 contra la BD actual (hoy: 0 filas)
- [ ] `npx tsc --noEmit`
- [ ] Manual: intentar crear un GERENTE sin sucursal desde la UI de usuarios → error claro

**Dependencias**: T1 (misma superficie: `app/actions/user.ts`)
**Archivos**:
- `app/actions/user.ts` (o la ruta de alta de usuarios que corresponda)
- `scripts/check-branch-scope-drift.ts` (nuevo)

**Scope**: S (2 archivos)

---

### T9: spec e2e de alcance por sucursal

**Descripción**: `tests/branch-scope.spec.ts` fija el comportamiento con el GERENTE ya sembrado
(`juan@pulso.mx`, fijado a Condesa) usando el patrón `sesionDe` de `gastos-autorizaciones.spec.ts:49`
— contexto con `storageState: undefined`, porque el compartido es de SUPER_ADMIN y el test pasaría
por la razón equivocada.

**Acceptance criteria**:
- [ ] Caso 1: el GERENTE de Condesa pide un incidente de Polanco por id → 404
- [ ] Caso 2: la lista de incidentes del GERENTE no incluye filas de Polanco aunque la cookie apunte allí
- [ ] Caso 3: el GERENTE exporta un reporte y el archivo trae solo Condesa
- [ ] Caso 4: ADMIN conserva el acceso de grupo en las mismas tres superficies (el control negativo)
- [ ] `afterAll` limpia todo lo sembrado con el tag `[E2E]`

**Verificación**:
- [ ] `pnpm build && PLAYWRIGHT_WEB_SERVER_CMD="npm run start" pnpm exec playwright test tests/branch-scope.spec.ts`
- [ ] Correr dos veces seguidas sin limpiar a mano: pasa igual (idempotente)

**Dependencias**: T6, T7 (y T3 para el caso 3)
**Archivos**:
- `tests/branch-scope.spec.ts` (nuevo)
- `tests/support/db.ts` (helpers de siembra)

**Scope**: M (2 archivos)

---

### ✅ Checkpoint 4: completo
- [ ] Spec e2e en verde contra un build
- [ ] Ningún consumidor de `enforceBranchScope` que falle abierto sigue sin migrar
- [ ] `npx tsc --noEmit` limpio
- [ ] Todos los criterios de aceptación marcados
- [ ] Decidida la Open Question #3 (borrar o no `enforceBranchScope`)

---

## Resumen de scope

| Task | Scope | Archivos | Depende de |
|---|---|---|---|
| T1 `switchBranch` | XS | 2 | — |
| T2 assumptions | XS | 2 | — |
| T3 reportes | S | 3 | — |
| T4 cash-flow + expenses | M | 4 | T2 |
| T5 waste | XS | 2 | — |
| T6 incidentes (helper + rutas) | M | 5 | — |
| T7 lista incidentes | S | 1 | T6 |
| T8 prevención | S | 2 | T1 |
| T9 e2e | M | 2 | T3, T6, T7 |

Ninguna tarea supera los 5 archivos. **T1, T2, T3, T5 y T6 son paralelizables entre sí** (tocan
archivos disjuntos); el resto encadena por dependencia.
