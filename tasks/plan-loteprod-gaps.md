# Implementation Plan: Cierre de Gaps loteprod.md ↔ Módulo Inventario

## Overview

Cerrar los 9 gaps detectados entre el manual operativo `loteprod.md` (producción diaria, FEFO,
recetario para QSR 3–15 sucursales) y la implementación actual del módulo
`app/dashboard/inventory/`. La investigación (2026-08-25) confirmó ~75% de cobertura: los 4
pilares (recetario/BOM, lotes FEFO, producción planificada, varianza/merma) ya existen. Este plan
agrega lo que falta, ordenado por impacto operativo: hold times, pars por franja y prep list
(núcleo §6), alertas escalonadas y temperatura de congelados (seguridad §5), y gobernanza
(versionado, ABC, auditoría sorpresa, tope de cortesías).

**Pre-requisito ya completado:** los 3 detalles menores fueron corregidos antes de este plan
(etiqueta FIFO→FEFO, transfers sin lote vía `allocateFEFO`, `unitConversions.factor` →
`numeric(12,6)` con migración `0064_closed_shen.sql`).

## Architecture Decisions

- **Vertical slicing:** cada tarea entrega un flujo completo usable (esquema → servicio → API/UI),
  no capas horizontales.
- **Convenciones numéricas del repo:** cantidades en `numeric(12,4)` (string en TS, coacción con
  `Number()` al leer, `String()` al escribir); dinero en centavos `integer`.
- **Migraciones seguras:** `pnpm db:generate` + `pnpm db:migrate`. Jamás `db:push` (puede dropear
  tablas — AGENTS.md).
- **Idempotencia patrón A9:** crons y capturas desde workflow llevan clave única parcial sobre
  `workflowInstanceId`; las capturas manuales pueden repetirse.
- **Reuso del allocator FEFO:** toda nueva lógica que descuenta o mueve stock pasa por
  `allocateFEFO()` (`lib/services/fefo-allocator.ts`) dentro de transacción — nunca descuentos
  ad-hoc.
- **Notificaciones por `NotificationDispatcher`:** canales WhatsApp/email/in-app ya resuelven
  preferencias de usuario; no llamar Wasender directo.
- **Alertas escalonadas sin spam:** estado de notificación persistido por (lote, umbral) para que
  el cron cada 6h no re-notifique.
- **Hold times como extensión de producción real:** `productionResults.expiresAt` derivado de
  `recipes.holdTimeMinutes`; el vencimiento genera merma con causa nueva `HOLD_TIME`, no un
  subsistema aparte.
- **Pars por franja como tabla nueva,** no columnas jsonb: consultables por slot, editables en
  matriz, agregables por receta.

## Task List

### Phase 1: Quick wins de seguridad y control (§5, §8)

- [ ] **Task 1: Validación de temperatura por tipo de almacenamiento en recepción**
  - Description: El servicio de recepción solo rechaza >4°C genérico. El manual exige rangos por
    tipo: congelado ≤ -18°C, refrigerado 0–4°C, fuera de rango = rechazo (§5.2). Derivar rango
    esperado del tipo de almacenamiento del ítem y validar ambos extremos.
  - Acceptance criteria:
    - [ ] Ítem congelado recibido a -10°C queda QUARANTINED + incidente automático
    - [ ] Ítem refrigerado fuera de 0–4°C queda QUARANTINED
    - [ ] Secos no exigen temperatura (opcional)
    - [ ] La UI de recepción muestra el rango esperado del ítem
  - Verification:
    - [ ] Test unitario de la validación (3 casos: ok/refrigerado-fuera/congelado-fuera)
    - [ ] `npx tsc --noEmit` limpio
    - [ ] Manual: recibir 1 ítem de cada tipo contra dev local
  - Dependencies: None
  - Files likely touched: `lib/services/receiving-service.ts`,
    `components/inventory/receiving-form.tsx` (o equivalente), `lib/services/__tests__/`
  - Estimated scope: Small–Medium

- [ ] **Task 2: Alertas escalonadas de caducidad 48h/24h + bloqueo de vencidos**
  - Description: Hoy solo hay umbral genérico configurable. El manual exige (§5.4): caduca en
    ≤48h → notificación a gerente de cocina; ≤24h → urgente + sugerencia de uso/promoción;
    caducado sin usar → lote marcado EXPIRED (bloqueo FEFO automático) + merma obligatoria.
  - Acceptance criteria:
    - [ ] Cron clasifica lotes por ventana (48h/24h/vencido) y notifica según rol
    - [ ] No re-notifica el mismo lote por la misma ventana (estado persistido)
    - [ ] Lotes vencidos quedan status=EXPIRED y desaparecen del allocator FEFO
    - [ ] Vencido sin merma registrada aparece en dashboard como pendiente obligatorio
  - Verification:
    - [ ] Test del clasificador de ventanas con lotes sembrados
    - [ ] Corrida local del cron (`INNGEST_DEV=1`) no duplica alertas en 2ª corrida
    - [ ] `pnpm run build` pasa
  - Dependencies: None
  - Files likely touched: `lib/services/stock-alert-service.ts` (o nuevo
    `expiration-alert-service.ts`), `lib/inngest/functions/cron-stock-check.ts`,
    `components/inventory/dashboard-kpis.tsx`
  - Estimated scope: Medium

- [ ] **Task 3: Tope y aprobación de mermas STAFF/COURTESY**
  - Description: El manual dice que cortesía/empleado "tiene tope y se aprueba" (§8.1/8.3). Hoy se
    registran sin aprobación ni límite. Agregar `approvalStatus/approvedBy/approvedAt` a
    `inventoryWaste`, tope mensual configurable por empresa, y cola de aprobación para gerente.
  - Acceptance criteria:
    - [ ] Merma STAFF/COURTESY nace PENDING_APPROVAL; otras razones nacen AUTO
    - [ ] Gerente aprueba/rechaza desde historial de mermas; rechazada NO descuenta inventario
    - [ ] Tope mensual configurable; excederlo exige aprobación de rol superior
    - [ ] KPI de merma solo suma mermas aprobadas/auto
  - Verification:
    - [ ] Test: flujo registrar → aprobar → inventario descontado solo tras aprobar
    - [ ] Migración generada y aplicable sin destructiva
    - [ ] `pnpm run build` pasa
  - Dependencies: None
  - Files likely touched: `lib/db/schema.ts` + migración, `lib/services/inventory-service.ts`
    (waste), `app/dashboard/inventory/waste/*`, `lib/services/merma-from-workflow.ts`
  - Estimated scope: Medium

### Checkpoint: Phase 1
- [ ] tsc limpio, build pasa, migraciones aplican en dev
- [ ] Los 3 flujos verificables manualmente contra dev

### Phase 2: Núcleo de producción diaria (§6)

- [ ] **Task 4: Hold times — esquema y captura**
  - Description: Cada producto cocinado tiene ventana máxima en línea (pollo 30 min, hamburguesa
    armada 10 min — §6.4). Agregar `holdTimeMinutes` a recetas y `expiresAt` calculado en
    `productionResults`; nueva causa de merma `HOLD_TIME`.
  - Acceptance criteria:
    - [ ] `recipes.holdTimeMinutes` nullable + `production_results.expires_at` poblado al producir
    - [ ] Enum `inventory_waste_reason` ampliado con HOLD_TIME (migración ALTER TYPE)
    - [ ] Producción sin hold time definido sigue funcionando (nullable)
  - Verification:
    - [ ] Producir receta con holdTime=30 → expires_at = produced_at + 30min
    - [ ] Migración ALTER TYPE aplica (nota: verificar fuera de transacción si hace falta)
    - [ ] tsc limpio
  - Dependencies: None
  - Files likely touched: `lib/db/schema.ts` + migración, `lib/services/production-service.ts`,
    `lib/services/production-from-workflow.ts`, formulario de recetas
  - Estimated scope: Medium

- [ ] **Task 5: Hold times — ciclo de vencimiento en línea**
  - Description: Al vencer el tiempo de retención, el sistema notifica al turno y registra la merma
    con causa (§6.4: "al vencer, se registra en waste log y se tira").
  - Acceptance criteria:
    - [ ] Cron horario detecta `production_results` vencidos no descartados
    - [ ] Notificación al responsable del turno con lista de productos a tirar
    - [ ] Confirmación crea `inventoryWaste` reason=HOLD_TIME idempotente (A9)
    - [ ] Dashboard muestra "en línea por vencer" vs "vencidos sin tirar"
  - Verification:
    - [ ] Sembrar resultado producido con expires_at pasado → cron genera merma una sola vez
    - [ ] Varianza del día refleja la merma HOLD_TIME
    - [ ] build pasa
  - Dependencies: Task 4
  - Files likely touched: nuevo `lib/inngest/functions/cron-hold-times.ts`,
    `lib/services/merma-from-workflow.ts` (o nuevo servicio), `components/inventory/dashboard-kpis.tsx`
  - Estimated scope: Medium

- [ ] **Task 6: Prep list por estación, turno y hora límite**
  - Description: La hoja de producción diaria del manual (§6.2) tiene estación, cantidad, lote FEFO
    a usar, turno, responsable, hora límite y estatus. `productionOrders` solo tiene fecha/cantidad/
    estatus.
  - Acceptance criteria:
    - [ ] `productionOrders` += station, shift, responsibleUserId, deadlineTime, completedBy/At
    - [ ] Vista "Prep List del día" agrupada por estación con checkbox de completado
    - [ ] Cada línea muestra el lote FEFO que consumirá al producirse
    - [ ] Completar línea dispara el flujo de producción real existente
  - Verification:
    - [ ] Crear órdenes de 2 estaciones → vista agrupa correctamente
    - [ ] Completar línea descuenta lote correcto vía allocateFEFO
    - [ ] build + smoke E2E de la vista
  - Dependencies: None (paralelizable con Tasks 4–5)
  - Files likely touched: `lib/db/schema.ts` + migración, `lib/services/production-service.ts`,
    `app/dashboard/inventory/production/production-client.tsx`, API de production orders
  - Estimated scope: Large (dividir en 6a esquema/servicio, 6b UI si hace falta)

- [ ] **Task 7: Pars por franja horaria (batch cooking)**
  - Description: Cuánto producto LISTO debe haber por franja (11:00/14:00/17:00/20:00 — §6.3). Se
    cocina en tandas contra estos pars. Nueva tabla `recipeParSlots` + sugeridor que compara par vs
    stock listo del día.
  - Acceptance criteria:
    - [ ] CRUD de slots por receta/sucursal (matriz editable)
    - [ ] Sugerencia = par del próximo slot − producción vigente hoy (no vencida)
    - [ ] Integrada al panel de sugerencias existente de producción
    - [ ] Respeta regla "tanda grande = merma": sugiere contra el próximo slot, no el día entero
  - Verification:
    - [ ] Test del cálculo de sugerencia con slots sembrados
    - [ ] UI matriz guarda y recarga
    - [ ] build pasa
  - Dependencies: Task 6 (misma página), conceptualmente Task 4 (vigencia = expires_at)
  - Files likely touched: `lib/db/schema.ts` + migración, nuevo `recipe-par-slot` service/API,
    `production-client.tsx`
  - Estimated scope: Large (dividir en 7a datos/servicio, 7b UI)

### Checkpoint: Phase 2
- [ ] Flujo completo: forecast → prep list por estación → producir con FEFO → hold time vence →
  merma HOLD_TIME → varianza del día lo refleja
- [ ] Revisión con humano antes de Phase 3

### Phase 3: Gobernanza y control (§3.3, §4, §9.2)

- [ ] **Task 8: Versionado de fichas técnicas**
  - Description: Cada cambio de receta debe quedar versionado con fecha y autorización (§3.3);
    sin esto el costo teórico diverge silenciosamente.
  - Acceptance criteria:
    - [ ] Tabla `recipeVersions` (snapshot jsonb de receta+líneas, changedBy, createdAt)
    - [ ] Toda edición de receta archiva la versión previa automáticamente
    - [ ] Historial visible en detalle de receta con costo teórico de cada versión
    - [ ] Variance report puede atribuir cambio de costo a versión específica
  - Verification:
    - [ ] Editar receta 2 veces → 2 versiones archivadas + actual
    - [ ] Costo histórico del variance coincide con versión vigente en cada fecha
    - [ ] build pasa
  - Dependencies: None
  - Files likely touched: `lib/db/schema.ts` + migración, `lib/services/recipe-service.ts`,
    `costing-service.ts`, UI de detalle de receta
  - Estimated scope: Medium

- [ ] **Task 9: Clasificación ABC con frecuencias de conteo**
  - Description: A = proteínas/lácteos (80% valor, conteo diario), B = abarrotes (semanal),
    C = consumibles (mensual) (§4/§9.2). Hoy solo existe `isHighValue`.
  - Acceptance criteria:
    - [ ] `inventoryItems.abcClass` enum A/B/C + servicio clasificador por valor de consumo 90d
      (80/15/5)
    - [ ] Cron mensual reclasifica; botón manual en products
    - [ ] Plantillas de conteo filtran por clase (A diario vía isHighValue existente, B semanal,
      C mensual)
    - [ ] Badge ABC visible en catálogo
  - Verification:
    - [ ] Test clasificador: distribución 80/15/5 sobre dataset sembrado
    - [ ] Conteo filtrado por clase B trae solo abarrotes
    - [ ] build pasa
  - Dependencies: None
  - Files likely touched: `lib/db/schema.ts` + migración, nuevo `abc-classification-service.ts`,
    `stock-count-service.ts`, `products/page.tsx`
  - Estimated scope: Medium

- [ ] **Task 10: Auditoría sorpresa trimestral**
  - Description: Conteo sorpresa trimestral por auditor corporativo — "es el conteo que vale"
    (§9.2). Workflow generado cada trimestre con muestra aleatoria de SKUs por sucursal.
  - Acceptance criteria:
    - [ ] Cron trimestral crea workflow de auditoría por sucursal con muestra aleatoria (mezcla ABC)
    - [ ] Evidencia fotográfica obligatoria por SKU auditado
    - [ ] Resultado alimenta % de cumplimiento (KPI §12) y ranking corporativo
    - [ ] Asignación al rol auditor, no al gerente auditado
  - Verification:
    - [ ] Disparo manual del cron crea exactamente 1 workflow por sucursal (idempotente)
    - [ ] Muestra cambia entre corridas (aleatoriedad) manteniendo mezcla ABC
    - [ ] build pasa
  - Dependencies: Task 9 (usa clases ABC para la muestra)
  - Files likely touched: nuevo `lib/inngest/functions/cron-surprise-audit.ts`,
    `workflow-template-service.ts` (plantilla auditoría), morning-brief/executive reports
  - Estimated scope: Medium

### Checkpoint: Complete
- [ ] Los 9 gaps del informe cerrados; trazabilidad de cada uno a sección del manual
- [ ] Suite de tests nueva pasa; build limpio; migraciones aplican en staging
- [ ] Documentación: actualizar `PROJECT_CONTEXT.md` y `docs/admin-guide.md`

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `ALTER TYPE ... ADD VALUE` falla dentro de transacción en algunos runners | Med | Verificar migración 0064+ en dev primero; drizzle permite statement standalone |
| Regresión en allocator FEFO al tocarlo desde varios frentes | Alto | `allocateFEFO` ya es puro (no escribe) y con lock FOR UPDATE; añadir tests de concurrencia antes de Phase 2 |
| Cróns duplicando notificaciones/mermas | Medio | Patrón A9 (índice único parcial sobre workflowInstanceId) + estado de notificación por (lote, ventana) |
| Scope creep en prep list/pars (UI ambiciosa) | Medio | Dividir L en 2 tareas (datos/servicio + UI); UI mínima funcional primero |
| `numeric` como string rompe cálculos nuevos | Medio | Convención repo: `Number()` al leer, `String()` al escribir; revisión cruzada en code review |
| Cambios de enum rompen clientes viejos | Bajo | Valores nuevos son aditivos; UI mapea labels en español |

## Open Questions

1. **Tope de cortesías (Task 3):** ¿monto fijo mensual por sucursal o % de ventas del mes?
   El manual no especifica unidad.
2. **Hold times (Tasks 4–5):** ¿aplican solo a recetas de venta o también a sub-recetas madre
   (salsas, marinados) que esperan en cámara?
3. **Pars por franja (Task 7):** ¿slots fijos 11/14/17/20 como el ejemplo del manual o
   configurables por sucursal? Propuesta: configurables con defaults del manual.
4. **Muestra de auditoría (Task 10):** ¿tamaño de muestra por sucursal (ej. 10 SKUs) o % del
   catálogo?
