# Implementation Plan: Acciones de Remediación Contextuales en Incidentes

## Overview

El circuito de remediación externa está completo de punta a punta (detección → fila en
`remediation_actions` → confirmación de visita → `workflowSchedule` → resolución automática del
incidente), pero **su única puerta de entrada es el dashboard principal**
(`components/dashboard/pending-actions.tsx`). El módulo de incidentes —lista y detalle— no muestra
ninguna acción de remediación: un gerente que abre un incidente en `AWAITING_EXTERNAL` ve un badge
"Esperando externo" y un `RemediationWizard` que le pide *escribir evidencia de texto* para un paso
que en realidad requiere agendar a un proveedor. La acción real vive en otra pantalla.

Este plan lleva la acción al lugar donde el usuario ya está mirando el problema, y hace que esa
acción sea **contextual al incidente**: un resolver determinista decide, a partir del protocolo, los
intentos, la cadena de escalación y la configuración de proveedores de la sucursal, cuál es la
única cosa que hay que hacer ahora.

De paso cierra tres defectos reales encontrados durante el análisis (dos de ellos de tenancy).

## Contexto: cómo funciona hoy

| Pieza | Archivo | Rol |
|---|---|---|
| Creación de la acción | `lib/services/remediation-service.ts:79` (`handleExternalServiceStep`) | paso `type: 'external_service'` → fila `PENDING` + incidente a `AWAITING_EXTERNAL` |
| Listado | `app/api/remediation/actions/route.ts` | `GET ?status=PENDING,CONFIRMED` |
| UI única | `components/dashboard/pending-actions.tsx:33` | tarjeta "Acciones de Remediación Externa" |
| Confirmación | `app/api/remediation/actions/[id]/confirm/route.ts` | crea `workflowSchedule` ONCE + `complianceServiceHistory` |
| Cierre | `lib/services/remediation-service.ts:473` (`completeExternalServiceRemediation`) | resuelve incidente + actualiza historial |
| Catálogo | `lib/compliance-mapping.ts` | `serviceType` → nombre humano + plantilla por defecto |
| Detalle de incidente | `app/dashboard/incidents/[id]/page.tsx:354` | renderiza el wizard **incondicionalmente** si hay protocolo |

## Architecture Decisions

**AD-1 — El resolver es una función pura, sin acceso a BD.**
`resolveRecommendedAction({ incident, actions, activeProvider })` vive en
`lib/services/incident-recommendation.ts` y no importa `db`. Así se prueba con un script de nodo sin
sembrar la base, y podría reutilizarse en el futuro desde el router de WhatsApp o desde un smart link
sin arrastrar la capa de datos.

**AD-2 — Cascada determinista, no IA.** La v1 no llama a `/api/ai/verify` ni a ningún modelo. Toda la
información necesaria ya está en la fila del incidente. Primer match gana:

1. Hay `remediationActions` `PENDING` → **CONFIRM_EXTERNAL**
2. Hay una `CONFIRMED` → **AWAIT_SCHEDULED** (informativo, sin CTA)
3. Paso actual es `external_service`, sin fila, y la sucursal **no** tiene proveedor activo → **CONFIGURE_PROVIDER**
4. Paso actual es `external_service`, sin fila, y sí hay proveedor → **REQUEST_EXTERNAL**
5. Paso actual es self-fix y quedan intentos → **RUN_PROTOCOL_STEP**
6. Intentos agotados o `status === 'ESCALATED'` → **ESCALATE** (nivel de `escalationChain` con `triggerCondition: 'remediation_failed'`)
7. Fallback → **RESOLVE_MANUAL** (el botón que ya existe)

**AD-3 — Cada recomendación explica su base.** El tipo lleva un campo `rationale` en español
("Paso 2 de 3 del protocolo · la sucursal tiene proveedor de Fumigación activo"). Sin eso, una
recomendación automática es una orden opaca; el gerente que la ejecuta necesita saber por qué se le
pide. Esto también hace depurable el resolver desde la UI.

**AD-4 — El cruce con `branchComplianceServices` es lo que hace la recomendación contextual.**
Si el incidente pide `FUMIGATION` pero la sucursal no tiene proveedor activo, recomendar "confirmar
visita" es inútil: no hay a quién confirmarle. La recomendación cambia a "configurar proveedor",
que es el bloqueo real. Este es el diferenciador frente a un simple listado filtrado por incidente.

**AD-5 — El wizard deja de ser incondicional.** `app/dashboard/incidents/[id]/page.tsx` renderiza
`RemediationWizard` solo cuando `recommended.kind === 'RUN_PROTOCOL_STEP'`. Hoy aparece incluso en
`AWAITING_EXTERNAL`, pidiendo evidencia de texto para un paso que no la admite.

**AD-6 — `ConfirmRemediationDialog` se muda a `components/incidents/`.** Es un componente de dominio
de incidentes que hoy vive en `components/dashboard/` porque ahí nació. Con dos consumidores, la
convención `components/<domain>/` decide. Es mover el archivo y actualizar un import.

**AD-7 — La respuesta del listado migra al envelope `{ success, data }`.** `GET /api/remediation/actions`
devuelve hoy un array pelado, contra la convención del repo. Al pasarlo por `withTenantAuth` se
normaliza y se actualiza su único consumidor en el mismo commit.

**AD-8 — El resolver tolera `remediationProtocol` en sus dos formas.** `templates/TEMPLATE_SCHEMA.md:87`
lo define como objeto `{ enabled, steps[] }`, pero
`templates/compliance/inspeccion-sistema-contra-incendios-v1.json:145` lo guarda como **string**.
Normalizar las plantillas queda fuera de alcance; el resolver debe degradar a `RESOLVE_MANUAL` sin
lanzar cuando reciba la forma string.

## Dependency Graph

```
T1 tenancy (GET + confirm)  ──┐
T2 companyId real           ──┤
                              ├──> T4 GET /api/incidents/[id]/actions ──> T5 panel ──> T6 detalle
T3 resolver puro            ──┘                                                          │
                                                                                          v
                                              T7 badge en lista <──────────────────── T8 e2e
```

## Task List

### Phase 1 — Cimientos y seguridad (alto riesgo primero)

- [ ] **T1**: Cerrar la fuga de tenancy en las rutas de remediación
- [ ] **T2**: Resolver `companyId` desde la sucursal en `handleExternalServiceStep`

### Checkpoint 1: Cimientos
- [ ] `pnpm run build` limpio
- [ ] La tarjeta del dashboard sigue cargando y confirmando visitas
- [ ] Una acción de otra empresa no es visible ni confirmable (verificado a mano)

### Phase 2 — Motor de recomendación

- [ ] **T3**: Resolver puro `resolveRecommendedAction`
- [ ] **T4**: Endpoint `GET /api/incidents/[id]/actions`

### Checkpoint 2: Motor
- [ ] El script de casos del resolver pasa las 8 ramas
- [ ] El endpoint devuelve 404 para un incidente de otra empresa
- [ ] `pnpm run build` limpio

### Phase 3 — UI del detalle (la rebanada vertical que entrega valor)

- [ ] **T5**: Componente `IncidentActionPanel` + mudanza de `ConfirmRemediationDialog`
- [ ] **T6**: Cablear el panel en el detalle del incidente

### Checkpoint 3: Flujo end-to-end
- [ ] Incidente en `AWAITING_EXTERNAL` → confirmar visita **desde el detalle** → se crea el `workflowSchedule`
- [ ] La tarjeta del dashboard refleja el cambio a "PROGRAMADO"
- [ ] Un incidente con protocolo self-fix sigue mostrando el wizard, no el panel externo
- [ ] Revisión con David antes de seguir

### Phase 4 — Lista y regresión

- [ ] **T7**: Badge "Requiere acción" y filtro en la lista de incidentes
- [ ] **T8**: Spec e2e del circuito

### Checkpoint 4: Completo
- [ ] `pnpm build && PLAYWRIGHT_WEB_SERVER_CMD="npm run start" pnpm exec playwright test tests/incident-remediation-actions.spec.ts`
- [ ] `pnpm run build` y `pnpm run lint` limpios
- [ ] Listo para revisión

## Risks and Mitigations

| Riesgo | Impacto | Mitigación |
|---|---|---|
| El cambio a envelope en `GET /api/remediation/actions` rompe la tarjeta del dashboard | Alto | Único consumidor conocido; se actualiza en el mismo commit (T1). `grep -r "remediation/actions"` antes de cerrar la tarea |
| Filas históricas de `remediation_actions` con `companyId` inválido quedan invisibles tras T1 | Medio | `companyId` es `uuid NOT NULL`, así que los inserts con `''` **fallaron**: probablemente no hay filas, pero sí puede haber incidentes atorados en `AWAITING_EXTERNAL` sin acción. Contar antes con SQL y, si aparecen, backfillear desde `branchId` |
| `remediationProtocol` tiene dos formas incompatibles en las plantillas | Medio | AD-8: el resolver degrada a `RESOLVE_MANUAL` en vez de lanzar. Normalizar plantillas es otro plan |
| El e2e comparte la BD de dev con las demás specs (serial, `workers: 1`) | Medio | Sembrar y limpiar por SQL directo en `tests/support/db.ts` con el tag `[E2E]`, como el resto |
| La mudanza de `ConfirmRemediationDialog` genera conflicto con trabajo en curso | Bajo | Es un `git mv` + un import; hacerlo dentro de T5 y no antes |

## Open Questions

1. **¿Qué roles pueden confirmar una visita?** Hoy `POST /api/remediation/actions/[id]/confirm` solo
   exige sesión: cualquier `EMPLEADO` puede agendar un proveedor. Propongo
   `withRoleAuth(['SUPER_ADMIN', 'ADMIN', 'GERENTE'])` dentro de T1. **Necesita tu confirmación** —
   endurece un endpoint que hoy es abierto y podría romperle el flujo a alguien.
2. **¿`REQUEST_EXTERNAL` (caso 4) debe disparar `handleExternalServiceStep` desde la UI?** Implica un
   endpoint de escritura nuevo. Alternativa para v1: mostrarlo como estado informativo sin CTA y
   dejar que lo cree el motor de workflows como hoy. Propongo la alternativa; se puede añadir después.
3. **¿El badge de la lista cuenta solo `PENDING` o también `CONFIRMED`?** Propongo solo `PENDING`
   ("requiere acción tuya"); `CONFIRMED` ya no requiere nada de nadie.

## Fuera de alcance

- Recomendaciones con IA / aprendizaje de resoluciones pasadas (posible v2).
- Normalizar `remediationProtocol` en las plantillas que lo guardan como string.
- Notificaciones WhatsApp adicionales: el circuito ya notifica en creación y en cierre.
- Tocar `predictive-scoring-service.ts`.
