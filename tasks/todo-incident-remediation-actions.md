# Todo List: Acciones de Remediación Contextuales en Incidentes

Plan: `tasks/plan-incident-remediation-actions.md`

---

## Phase 1 — Cimientos y seguridad

### T1: Cerrar la fuga de tenancy en las rutas de remediación

**Descripción**: `GET /api/remediation/actions` filtra únicamente por `status`
(`app/api/remediation/actions/route.ts:51`), así que cualquier usuario autenticado ve las acciones de
remediación de **todas** las empresas. `POST .../[id]/confirm` busca la acción solo por id
(`app/api/remediation/actions/[id]/confirm/route.ts:36`), así que cualquier usuario autenticado puede
agendar un workflow en la sucursal de otra empresa. Ambas rutas pasan a `withTenantAuth`, filtran por
`companyId` de sesión y aplican `enforceBranchScope` para GERENTE/SUPERVISOR. Se crea
`lib/api/remediation-access.ts` con `findRemediationActionForTenant`, espejo de
`lib/api/incident-access.ts`.

**Acceptance criteria**:
- [ ] `GET` usa `withTenantAuth` y añade `eq(remediationActions.companyId, auth.tenantId)` al `where`
- [ ] GERENTE y SUPERVISOR solo reciben acciones de su propia sucursal (vía `enforceBranchScope`)
- [ ] `POST /confirm` devuelve 404 —no 403— cuando la acción pertenece a otro tenant, igual que `findIncidentForTenant`
- [ ] La respuesta del `GET` usa el envelope `{ success, data }` y `pending-actions.tsx` lee `data.data`

**Verificación**:
- [ ] `pnpm run build`
- [ ] `grep -rn "remediation/actions" --include=*.tsx --include=*.ts` no deja consumidores sin actualizar
- [ ] Manual: iniciar sesión con un usuario de otra empresa → la tarjeta del dashboard queda vacía
- [ ] Manual: `curl -X POST` a `/confirm` con el id de una acción ajena → 404

**Dependencias**: Ninguna
**Archivos**:
- `app/api/remediation/actions/route.ts`
- `app/api/remediation/actions/[id]/confirm/route.ts`
- `lib/api/remediation-access.ts` (nuevo)
- `components/dashboard/pending-actions.tsx`

**Scope**: S (4 archivos)
**Nota**: resolver antes la pregunta abierta #1 del plan (¿`withRoleAuth` en `/confirm`?).

---

### T2: Resolver `companyId` desde la sucursal en `handleExternalServiceStep`

**Descripción**: `lib/services/remediation-service.ts:99` inserta
`companyId: serviceConfig?.companyId || ''` en una columna `uuid NOT NULL`. Cuando la sucursal no
tiene un `branchComplianceServices` activo para ese `serviceType` —justo el caso que más importa,
porque es cuando no hay proveedor contratado— el insert revienta y el paso `external_service` falla
entero. El `companyId` debe salir de `branches` a partir de `incident.branchId`, y la acción debe
crearse igual con `serviceConfigId: null`.

**Acceptance criteria**:
- [ ] `companyId` se resuelve con un `select` a `branches` por `incident.branchId`
- [ ] Con sucursal sin `serviceConfig` activo, la fila se crea con `serviceConfigId: null` y `companyId` válido
- [ ] Si la sucursal no existe, se registra el error y no se inserta una fila corrupta

**Verificación**:
- [ ] Extender `scripts/test-remediation-circuit.ts` con un caso "sucursal sin proveedor configurado"
- [ ] `pnpm run build`
- [ ] SQL de diagnóstico previo: `SELECT count(*) FROM remediation_actions WHERE service_config_id IS NULL` para saber si hay filas afectadas

**Dependencias**: Ninguna (independiente de T1, pero se entrega junto)
**Archivos**:
- `lib/services/remediation-service.ts`
- `scripts/test-remediation-circuit.ts`

**Scope**: XS (2 archivos)

---

### ✅ Checkpoint 1: Cimientos
- [ ] `pnpm run build` limpio
- [ ] La tarjeta del dashboard carga y confirma visitas como antes
- [ ] Verificado a mano que el aislamiento por empresa funciona en ambas rutas

---

## Phase 2 — Motor de recomendación

### T3: Resolver puro `resolveRecommendedAction`

**Descripción**: Nuevo módulo `lib/services/incident-recommendation.ts` que, dado un incidente, sus
acciones de remediación y el proveedor activo de la sucursal, devuelve la única acción recomendada.
Función pura: **no importa `db`**. Implementa la cascada de 7 casos de AD-2 y tolera
`remediationProtocol` en forma de string (AD-8).

```ts
export type RecommendedActionKind =
  | 'CONFIRM_EXTERNAL' | 'AWAIT_SCHEDULED' | 'CONFIGURE_PROVIDER'
  | 'REQUEST_EXTERNAL' | 'RUN_PROTOCOL_STEP' | 'ESCALATE' | 'RESOLVE_MANUAL';

export interface RecommendedAction {
  kind: RecommendedActionKind;
  label: string;      // "Confirmar visita de Fumigación y Control de Plagas"
  rationale: string;  // "Paso 2 de 3 · la sucursal tiene proveedor activo"
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
  payload?: {
    remediationActionId?: string; serviceType?: string;
    stepIndex?: number; escalationLevel?: number; scheduledDate?: string;
  };
}
```

**Acceptance criteria**:
- [ ] Las 7 ramas de AD-2 se resuelven en el orden especificado (primer match gana)
- [ ] `label` y `rationale` en español; el nombre del servicio sale de `getServiceNameForType` (`lib/compliance-mapping.ts:67`)
- [ ] No lanza con `remediationProtocol` `null`, string, o sin `steps`: degrada a `RESOLVE_MANUAL`
- [ ] El módulo no importa `@/lib/db`

**Verificación**:
- [ ] `scripts/test-incident-recommendation.ts` (nuevo, patrón de `scripts/test-remediation-circuit.ts`) cubre las 7 ramas + los 3 casos degradados
- [ ] `pnpm exec tsx scripts/test-incident-recommendation.ts` sale en verde
- [ ] `pnpm run build`

**Dependencias**: Ninguna
**Archivos**:
- `lib/services/incident-recommendation.ts` (nuevo)
- `scripts/test-incident-recommendation.ts` (nuevo)

**Scope**: S (2 archivos)

---

### T4: Endpoint `GET /api/incidents/[id]/actions`

**Descripción**: Devuelve las acciones de remediación del incidente más la recomendación calculada.
Sigue el patrón de las rutas hermanas: `withTenantAuth` + `findIncidentForTenant` para que un
incidente de otra empresa dé 404 indistinguible de uno inexistente.

**Acceptance criteria**:
- [ ] Responde `{ success: true, data: { actions, recommended } }`
- [ ] 404 para incidente inexistente **o** de otro tenant
- [ ] `actions` sale de una sola query con `leftJoin` a `branchComplianceServices` (nombre del proveedor)
- [ ] El proveedor activo de la sucursal se consulta una vez y se pasa al resolver; sin N+1

**Verificación**:
- [ ] Manual: incidente propio en `AWAITING_EXTERNAL` → `recommended.kind === 'CONFIRM_EXTERNAL'`
- [ ] Manual: id de un incidente de otra empresa → 404
- [ ] `pnpm run build`

**Dependencias**: T1 (patrón de scoping), T3
**Archivos**:
- `app/api/incidents/[id]/actions/route.ts` (nuevo)
- `lib/api/remediation-access.ts` (extender con el query por incidente)

**Scope**: S (2 archivos)

---

### ✅ Checkpoint 2: Motor
- [ ] Script del resolver en verde (7 ramas + degradados)
- [ ] Endpoint devuelve 404 cross-tenant
- [ ] `pnpm run build` limpio

---

## Phase 3 — UI del detalle

### T5: Componente `IncidentActionPanel`

**Descripción**: Tarjeta "Acción recomendada" que renderiza `label`, `rationale` y un único CTA
primario según `kind`, reutilizando el lenguaje visual ámbar de `pending-actions.tsx`. Incluye la
mudanza de `ConfirmRemediationDialog` a `components/incidents/` (AD-6) y corrige el typo
"Proveedor **Extero**" (`components/dashboard/confirm-remediation-dialog.tsx:100`).

**Acceptance criteria**:
- [ ] `CONFIRM_EXTERNAL` abre `ConfirmRemediationDialog` y refetchea al cerrar con éxito
- [ ] `AWAIT_SCHEDULED` muestra la fecha en `es-MX` sin CTA; `CONFIGURE_PROVIDER` enlaza a la config de servicios de la sucursal
- [ ] Estados de carga, error y "sin acción pendiente" resueltos, sin layout shift
- [ ] `ConfirmRemediationDialog` vive en `components/incidents/` y `pending-actions.tsx` importa desde ahí

**Verificación**:
- [ ] Manual: los 7 `kind` se ven correctos (forzar con datos sembrados o con un stub temporal)
- [ ] `pnpm run build` y `pnpm run lint`

**Dependencias**: T4
**Archivos**:
- `components/incidents/incident-action-panel.tsx` (nuevo)
- `components/incidents/confirm-remediation-dialog.tsx` (movido)
- `components/dashboard/pending-actions.tsx` (import)

**Scope**: M (3 archivos)

---

### T6: Cablear el panel en el detalle del incidente

**Descripción**: `app/dashboard/incidents/[id]/page.tsx` monta `IncidentActionPanel` arriba del grid
de timeline y deja de renderizar `RemediationWizard` incondicionalmente: el wizard solo aparece
cuando `recommended.kind === 'RUN_PROTOCOL_STEP'` (AD-5).

**Acceptance criteria**:
- [ ] El panel aparece encima del grid timeline/protocolo en incidentes no resueltos
- [ ] El wizard ya no se muestra en `AWAITING_EXTERNAL`
- [ ] Confirmar una visita desde el detalle refetchea incidente **y** acciones, y el badge de estado se actualiza

**Verificación**:
- [ ] Manual con incidente `AWAITING_EXTERNAL` sembrado: confirmar visita → `workflowSchedule` creado en BD
- [ ] Manual con incidente self-fix: el wizard sigue funcionando igual que antes
- [ ] `pnpm run build`

**Dependencias**: T5
**Archivos**:
- `app/dashboard/incidents/[id]/page.tsx`

**Scope**: S (1 archivo)

---

### ✅ Checkpoint 3: Flujo end-to-end
- [ ] `AWAITING_EXTERNAL` → confirmar desde el detalle → schedule creado
- [ ] El dashboard refleja "PROGRAMADO"
- [ ] Self-fix intacto
- [ ] **Revisión con David antes de Phase 4**

---

## Phase 4 — Lista y regresión

### T7: Badge "Requiere acción" en la lista de incidentes

**Descripción**: `getIncidentsPage` (`app/dashboard/incidents/page.tsx:61`) agrega el conteo de
acciones `PENDING` por incidente en la misma query, y `IncidentList` muestra un badge ámbar + un
filtro "Requieren acción". Respeta la sucursal seleccionada por cookie como el resto de la página.

**Acceptance criteria**:
- [ ] `pendingActionCount` se obtiene con un solo `leftJoin` agregado, sin N+1
- [ ] Badge ámbar visible en la fila y en la franja de resumen
- [ ] Nuevo filtro combina correctamente con los de severidad, estado y búsqueda existentes
- [ ] Solo cuenta `PENDING` (pregunta abierta #3)

**Verificación**:
- [ ] Manual: incidente con acción pendiente muestra el badge; al confirmar la visita, desaparece
- [ ] Revisar el log de queries: una sola query adicional por carga de página
- [ ] `pnpm run build`

**Dependencias**: T1
**Archivos**:
- `app/dashboard/incidents/page.tsx`
- `components/incidents/incident-list.tsx`

**Scope**: S (2 archivos)

---

### T8: Spec e2e del circuito

**Descripción**: `tests/incident-remediation-actions.spec.ts` cubre el flujo desde el detalle del
incidente. Datos sembrados por SQL directo en `tests/support/db.ts` con el tag `[E2E]`, siguiendo el
patrón del resto de specs (corren serial contra la BD de dev real).

**Acceptance criteria**:
- [ ] Helpers `seedIncidentWithRemediationAction` / `cleanupIncidentRemediation` en `tests/support/db.ts`
- [ ] Caso 1: incidente `AWAITING_EXTERNAL` muestra el panel con CTA "Confirmar visita"
- [ ] Caso 2: confirmar crea el `workflowSchedule` y el panel pasa a "Programado"
- [ ] Caso 3: incidente con protocolo self-fix muestra el wizard, no el panel externo
- [ ] `afterAll` limpia todas las filas `[E2E]` creadas

**Verificación**:
- [ ] `pnpm build && PLAYWRIGHT_WEB_SERVER_CMD="npm run start" pnpm exec playwright test tests/incident-remediation-actions.spec.ts`
- [ ] Correr dos veces seguidas sin limpiar a mano: pasa igual (idempotente)

**Dependencias**: T6, T7
**Archivos**:
- `tests/incident-remediation-actions.spec.ts` (nuevo)
- `tests/support/db.ts`

**Scope**: M (2 archivos)

---

### ✅ Checkpoint 4: Completo
- [ ] Spec e2e en verde contra un build
- [ ] `pnpm run build` y `pnpm run lint` limpios
- [ ] Todos los criterios de aceptación marcados
- [ ] Listo para revisión

---

## Resumen de scope

| Task | Scope | Archivos | Depende de |
|---|---|---|---|
| T1 Tenancy | S | 4 | — |
| T2 companyId | XS | 2 | — |
| T3 Resolver | S | 2 | — |
| T4 Endpoint | S | 2 | T1, T3 |
| T5 Panel | M | 3 | T4 |
| T6 Detalle | S | 1 | T5 |
| T7 Lista | S | 2 | T1 |
| T8 E2E | M | 2 | T6, T7 |

Ninguna tarea supera los 4 archivos. T1+T2 y T3 son paralelizables entre sí; el resto es secuencial
por la cadena de dependencias.

---

## Resultado de la implementación (2026-08-12)

Las 8 tareas están implementadas en la rama `feat/incident-remediation-actions`, un commit por tarea.

| Commit | Tarea |
|---|---|
| `c2433a5` | T1 tenancy |
| `a02c2ed` | T2 companyId |
| `2fccd17` | T3 resolver |
| `b2c4450` | T4 endpoint |
| `248c798` | T5 panel + mudanza |
| `943b8af` | T6 detalle |
| `e3e4515` | T7 lista |
| `78f41bb` + `9d63641` | T8 e2e |

### Verificación

- `pnpm run build` limpio; `/api/incidents/[id]/actions` aparece en el manifiesto de rutas.
- `npx tsx scripts/test-incident-recommendation.ts`: 17 casos en verde (7 ramas + 3 degradados +
  6 bordes + la comprobación de que el módulo no importa `@/lib/db`).
- `npx tsx scripts/test-remediation-circuit.ts`: 6 aserciones del caso "sucursal sin proveedor" +
  el guard de sucursal inexistente, contra la BD real.
- `PLAYWRIGHT_WEB_SERVER_CMD="npm run start" npx playwright test tests/incident-remediation-actions.spec.ts`:
  4/4 en verde, **corrido dos veces seguidas sin limpiar a mano**. La BD queda como estaba
  (3 `remediation_actions`, 0 incidentes `[E2E]`, 0 schedules residuales).

### Preguntas abiertas: cómo se resolvieron

1. **Roles en `/confirm`** → `withRoleAuth(['SUPER_ADMIN','ADMIN','GERENTE'])`, la propuesta del plan.
2. **`REQUEST_EXTERNAL`** → informativo sin CTA; no se añadió endpoint de escritura.
3. **Badge de la lista** → sólo cuenta `PENDING`.

### Desviaciones del plan

- **Caso 5 del resolver lleva un guard `status !== 'ESCALATED'`** que AD-2 no pide literalmente.
  Leída al pie de la letra, la cascada haría que un incidente escalado *a mano* con intentos
  restantes recomendara volver a correr el protocolo. En la escalación normal los intentos ya están
  agotados y ambas lecturas coinciden. Está comentado en el código.
- **`pnpm run lint` no queda limpio**: el repo arrastra 2814 problemas (1062 errores) previos a esta
  rama. Se corrigieron los 3 errores que introdujo este trabajo; el lint acotado a los archivos
  tocados queda limpio salvo dos líneas preexistentes del diálogo mudado.
- **`pnpm run build` necesita `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1`** en este entorno,
  o falla intermitentemente al bajar las fuentes de Google. No es de esta rama.

### Riesgo retirado

El diagnóstico previo a T1 (`SELECT` sobre `remediation_actions` y `incidents`) devolvió 3 filas,
todas con `company_id` consistente con su sucursal, y **0 incidentes atorados en
`AWAITING_EXTERNAL`**. No hizo falta backfill.
