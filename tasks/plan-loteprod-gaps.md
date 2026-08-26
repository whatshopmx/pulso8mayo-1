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

**Ampliación (2026-08-26):** una segunda lectura del manual, sección por sección, encontró brechas
que el informe original no había listado. Se agregan las **Phases 4 y 5** (Tasks 11–20): brechas
puntuales de §4/§5.3/§6.1/§8.1/§8.4/§9.3/§12 primero, y el bloque grande de cocina central (§11) +
trazabilidad/recall (§5.5) al final. Cuatro puntos que la revisión inicial marcaba como faltantes
resultaron ya implementados — quedan documentados abajo en *Verificado en código (NO son gaps)*
para no re-planearlos.

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
- **Umbrales y metas configurables por empresa, no hardcodeados:** varianza (1.5%/3%), metas de
  merma por categoría y días de cobertura por tipo de almacenamiento nacen con los defaults del
  manual pero viven en configuración del tenant — los números del manual son benchmarks QSR, no
  ley para todos los clientes.
- **Nada se sobrescribe en silencio:** los valores calculados (par levels, reclasificación ABC,
  forecast ajustado) se *proponen*; el usuario acepta o edita. La captura manual siempre gana.
- **Cocina central como capa sobre lo existente:** reusa `productionOrders`, `inventoryTransfers`
  y la validación de temperatura de Task 1; no es un módulo paralelo. La sucursal central es una
  sucursal con bandera, no una entidad nueva.

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

### Checkpoint: Phase 3
- [ ] Los 9 gaps del informe original cerrados; trazabilidad de cada uno a sección del manual
- [ ] Suite de tests nueva pasa; build limpio; migraciones aplican en staging

### Phase 4: Segunda pasada del manual — brechas puntuales (§4, §5.3, §6.1, §8.1, §8.4, §9.3, §12)

- [ ] **Task 11: Causas de merma faltantes (preparación y devolución de cliente)**
  - Description: El §8.1 lista 7 tipos de merma; el enum `inventory_waste_reason` solo mapea 5
    (`EXPIRED, DAMAGED, QUALITY, SPILLAGE, OTHER` + `STAFF, COURTESY` de cortesías). Faltan
    **merma por preparación** (recorte/grasa contra rendimiento esperado — se contrasta con
    `recipes.yieldPercent`, que ya existe) y **devolución del cliente**. Hoy caen en
    `QUALITY`/`OTHER` y rompen el análisis causa→acción del §8.3.
  - Acceptance criteria:
    - [ ] Enum ampliado con `PREPARATION` y `CUSTOMER_RETURN` (migración ALTER TYPE aditiva)
    - [ ] Merma `PREPARATION` captura receta/ítem y compara contra el rendimiento esperado
      (`yieldPercent`); desviación mayor al umbral marca la merma para revisión
    - [ ] Labels en español en la UI de captura e historial de mermas
    - [ ] Reporte de mermas agrupa por las 7 causas del manual
  - Verification:
    - [ ] Migración aplica en dev sin romper filas existentes
    - [ ] Test: merma PREPARATION con rendimiento por debajo del esperado queda marcada
    - [ ] `pnpm run build` pasa
  - Dependencies: None (independiente de Task 4, que agrega `HOLD_TIME` al mismo enum — coordinar
    el orden de migraciones si van en paralelo)
  - Files likely touched: `lib/db/schema.ts` + migración, `lib/services/inventory-service.ts`,
    `app/dashboard/inventory/waste/*`, `messages/es.json`
  - Estimated scope: Small

- [ ] **Task 12: Metas de merma por categoría + investigación obligatoria**
  - Description: El §8.4 fija benchmarks QSR por categoría (proteínas 2–4%, vegetales 5–8%, etc.)
    y exige investigación cuando se supera la meta. Hoy el KPI de merma es un número sin meta.
  - Acceptance criteria:
    - [ ] Config de metas de merma por categoría de insumo, editable por ADMIN con defaults del manual
    - [ ] Cálculo mensual de % de merma por categoría vs meta, por sucursal
    - [ ] Superar la meta dispara incidente/tarea de investigación asignada al gerente (vía
      `incident-engine` + `NotificationDispatcher`)
    - [ ] Semáforo por categoría visible en el dashboard de inventario
  - Verification:
    - [ ] Test del cálculo con dataset sembrado (una categoría dentro y otra fuera de meta)
    - [ ] El incidente se dispara una sola vez por (categoría, mes, sucursal)
    - [ ] `pnpm run build` pasa
  - Dependencies: Task 11 (las causas nuevas cambian el desglose del análisis)
  - Files likely touched: `lib/db/schema.ts` + migración, nuevo `waste-benchmark-service.ts`,
    `lib/services/incident-engine.ts`, `components/inventory/dashboard-kpis.tsx`
  - Estimated scope: Medium

- [ ] **Task 13: Umbrales de varianza con semáforo e investigación (§9.3/§10)**
  - Description: El manual define bandas: < 1.5% aceptable, 1.5–3% investigar, > 3% investigación
    a fondo. El reporte teórico vs real existe pero no clasifica ni alerta.
  - Acceptance criteria:
    - [ ] Umbrales configurables por empresa con defaults 1.5% / 3%
    - [ ] El reporte de varianza clasifica cada SKU y el total en verde/amarillo/rojo
    - [ ] Varianza roja crea tarea de investigación con responsable y fecha límite
    - [ ] La interpretación del §10 queda visible en el reporte (qué significa cada banda)
  - Verification:
    - [ ] Test del clasificador con varianzas de 1.0%, 2.0% y 4.0%
    - [ ] El cierre diario/mensual no duplica la tarea de investigación
    - [ ] `pnpm run build` pasa
  - Dependencies: None
  - Files likely touched: `lib/services/inventory-reports-service.ts`, `lib/services/kpi-calculator.ts`,
    `app/dashboard/inventory/reports/*`
  - Estimated scope: Medium

- [ ] **Task 14: Par levels calculados por tipo de almacenamiento (§4)**
  - Description: `inventoryItems.minLevel/maxLevel` existen pero se capturan a mano, y
    `suggested-order-service` calcula el punto de reorden con *lead time*, no con los días de
    cobertura del manual (perecederos 2–4 d, refrigerados 5–7 d, congelados/secos 7–15 d). Los
    insumos de la fórmula ya están en la tabla: `storageType` y `typicalShelfLifeDays` (Task 1).
  - Acceptance criteria:
    - [ ] Servicio que sugiere par level = uso diario promedio × días de cobertura + stock de
      seguridad, con la cobertura derivada de `storageType`/`typicalShelfLifeDays`
    - [ ] Coberturas por tipo configurables por empresa con los defaults del manual
    - [ ] Acción "recalcular pars" (masiva y por ítem) que propone valores; el usuario acepta o
      edita — nunca sobrescribe en silencio
    - [ ] `suggested-order-service` usa el par recalculado
  - Verification:
    - [ ] Test de la fórmula para cada tipo de almacenamiento
    - [ ] Recalcular en dev no modifica `minLevel` sin confirmación
    - [ ] `pnpm run build` pasa
  - Dependencies: Task 1 (usa `storageType`), Task 9 (la clase ABC modula el stock de seguridad)
  - Files likely touched: nuevo `par-level-service.ts`, `lib/services/suggested-order-service.ts`,
    `app/dashboard/inventory/products/*`
  - Estimated scope: Medium

- [ ] **Task 15: Etiqueta de producto preparado + código de colores por vida útil (§5.3)**
  - Description: El pre-requisito cubrió la etiqueta FEFO de materia prima. Falta la etiqueta del
    producto PREPARADO: fecha de preparación, caducidad, **lote origen** y quién elaboró; más el
    código visual verde/amarillo/rojo por días de vida útil restante en los listados de lotes.
  - Acceptance criteria:
    - [ ] Etiqueta imprimible de `productionResults` con prep/caducidad/lote origen/elaboró
    - [ ] La caducidad sale de `expiresAt` (Task 4) o de la vida útil de la receta
    - [ ] Semáforo verde/amarillo/rojo por vida útil restante en lotes y en la vista de caducidades
    - [ ] Formato imprimible consistente con la etiqueta FEFO existente
  - Verification:
    - [ ] Imprimir la etiqueta de una producción con lote origen conocido y verificar los 4 datos
    - [ ] Los umbrales del semáforo coinciden con las ventanas de alerta (Task 2)
    - [ ] `pnpm run build` pasa
  - Dependencies: Task 4 (`expiresAt`); Task 19 si el lote origen viene de producción central
  - Files likely touched: `components/inventory/` (etiqueta), `app/dashboard/inventory/production/*`,
    `app/dashboard/inventory/lotes/*`
  - Estimated scope: Small–Medium

- [ ] **Task 16: Ajustes manuales al forecast (§6.1)**
  - Description: `ForecastService` solo expone `calculate`/`calculateAll`. El manual planea la
    producción sobre el forecast **ajustado** por clima, promociones, quincena y eventos locales.
  - Acceptance criteria:
    - [ ] Ajuste manual por fecha/sucursal/receta con motivo tipificado (CLIMA, PROMOCION,
      QUINCENA, EVENTO, OTRO) y % o cantidad
    - [ ] El plan de producción y la prep list consumen el forecast ajustado, no el base
    - [ ] Se conservan base y ajustado para medir exactitud del forecast (Task 17)
    - [ ] Queda registrado quién ajustó y cuándo
  - Verification:
    - [ ] Ajustar +20% por evento → la sugerencia de producción sube proporcionalmente
    - [ ] Sin ajuste, el comportamiento actual no cambia
    - [ ] `pnpm run build` pasa
  - Dependencies: Task 6 (la prep list consume el forecast ajustado)
  - Files likely touched: `lib/db/schema.ts` + migración, `lib/services/forecast-service.ts`,
    `app/dashboard/inventory/production/production-client.tsx`
  - Estimated scope: Medium

- [ ] **Task 17: KPIs faltantes del §12 y ranking corporativo (§15)**
  - Description: De los 9 KPIs del manual quedan sin cálculo: días de inventario de perecederos
    (meta 2–4), exactitud del forecast (±10%), cumplimiento de etiquetado (>95%) y el tablero
    corporativo consolidado con ranking entre sucursales.
  - Acceptance criteria:
    - [ ] Días de inventario de perecederos = stock actual ÷ consumo diario promedio, por sucursal
    - [ ] Exactitud del forecast = |real − pronosticado| ÷ pronosticado sobre el forecast ajustado
    - [ ] Cumplimiento de etiquetado alimentado por la evidencia de auditoría (Task 10) y los lotes
      con etiqueta registrada
    - [ ] Tablero corporativo con ranking de sucursales por los KPIs del §12 y sus metas
  - Verification:
    - [ ] Test de cada fórmula con dataset sembrado
    - [ ] El ranking respeta el alcance por sucursal (`enforceBranchScope`): GERENTE ve su posición,
      no el detalle ajeno
    - [ ] `pnpm run build` pasa
  - Dependencies: Task 10 (evidencia de etiquetado), Task 16 (forecast ajustado)
  - Files likely touched: `lib/services/kpi-calculator.ts`, `lib/services/inventory-reports-service.ts`,
    reportes ejecutivos/morning-brief, `app/dashboard/` (tablero corporativo)
  - Estimated scope: Large (dividir en 17a KPIs, 17b tablero/ranking)

### Checkpoint: Phase 4
- [ ] build limpio y migraciones aplicadas; los KPIs del §12 calculan sobre datos reales de dev
- [ ] Revisión con humano antes de Phase 5

### Phase 5: Cocina central y trazabilidad (§11, §5.5)

> Bloque más grande y con dependencia funcional entre sus tres tareas. Solo aplica a tenants con
> `foodProduction = COCINA_CENTRAL | MIXTO` (el valor ya existe en `operating-config`, hoy sin
> nada operativo detrás). Puede ejecutarse como plan aparte si el cliente piloto es 100% in situ.

- [ ] **Task 18: Consolidación de demanda D-2 y plan de producción central**
  - Description: §11.2 pasos 1–2: cada sucursal envía su necesidad de sub-recetas dos días antes y
    la central consolida las N sucursales en un plan de producción propio.
  - Acceptance criteria:
    - [ ] Sucursal marcable como cocina central (bandera de sucursal, no solo config de empresa)
    - [ ] Requerimiento por sucursal/receta/fecha objetivo, generado desde el forecast ajustado y
      editable antes del corte D-2
    - [ ] Vista de consolidación en central: demanda total por sub-receta con desglose por sucursal
    - [ ] La consolidación genera órdenes de producción de la central (reusa `productionOrders`)
  - Verification:
    - [ ] 3 sucursales pidiendo la misma sub-receta → 1 orden central con la suma y su desglose
    - [ ] Cambiar el requerimiento después del corte no altera el plan ya emitido
    - [ ] `pnpm run build` pasa
  - Dependencies: Task 6 (prep list/órdenes), Task 16 (forecast ajustado)
  - Files likely touched: `lib/db/schema.ts` + migración, nuevo `central-kitchen-service.ts`,
    `lib/services/production-service.ts`, `app/dashboard/inventory/production/*`
  - Estimated scope: Large

- [ ] **Task 19: Lotes de producción central con herencia de lote origen y distribución**
  - Description: §11.2 pasos 3–5: la central produce por lotes propios (L-PM-45) que **heredan el
    lote del proveedor original**; cada lote sale con etiqueta (producción, caducidad, lote origen)
    y se distribuye por ruta refrigerada; la sucursal recibe contra orden de transferencia con la
    misma disciplina de temperatura que una recepción de proveedor.
  - Acceptance criteria:
    - [ ] `productionResults` registra los lotes de insumo consumidos (herencia origen → lote hijo)
    - [ ] El envío usa `inventoryTransfers` con lote y documento; nunca movimiento sin documento
    - [ ] La recepción en sucursal valida temperatura por `storageType` (reusa Task 1) y cantidad
      contra la orden; fuera de rango = QUARANTINED + incidente
    - [ ] Diferencia recibido vs enviado genera varianza atribuida a la ruta, no a la sucursal
  - Verification:
    - [ ] Producir en central con 2 lotes de insumo → el lote hijo apunta a ambos
    - [ ] Recibir a temperatura fuera de rango deja el transfer en cuarentena
    - [ ] Test de que el stock sale de central y entra a sucursal sin doble conteo
    - [ ] `pnpm run build` pasa
  - Dependencies: Task 18, Task 1 (validación de temperatura)
  - Files likely touched: `lib/db/schema.ts` + migración, `lib/services/production-service.ts`,
    `lib/services/inventory-service.ts` (transfers), `lib/services/receiving-service.ts`,
    `lib/services/fefo-allocator.ts` (consumo por lote)
  - Estimated scope: Large

- [ ] **Task 20: Trazabilidad y recall extremo a extremo (§5.5)**
  - Description: "Proveedor → lote L-0112 → sub-receta L-PM45 → sucursales 003/007/012 → productos
    vendidos X, Y", resoluble en 15 minutos. El dato de lote existe; no hay consulta ni UI que
    recorra la cadena (grep confirma: sin servicio de trazabilidad en el repo).
  - Acceptance criteria:
    - [ ] Consulta directa: dado un lote de proveedor, devuelve lotes de producción derivados
      (incluidos los de central), sucursales destino, stock remanente y ventas asociadas por fecha
    - [ ] Consulta inversa: dado un producto vendido, qué lotes lo compusieron
    - [ ] Vista de recall con acción masiva: bloquear lotes afectados (salen del allocator FEFO) y
      notificar a las sucursales involucradas
    - [ ] La cadena se resuelve en segundos sobre el dataset de dev (índices donde haga falta)
  - Verification:
    - [ ] Escenario sembrado: 1 lote de proveedor → 2 producciones → 3 sucursales; la consulta
      devuelve esas 3 y solo esas
    - [ ] Bloquear el lote lo saca del allocator FEFO de inmediato
    - [ ] `pnpm run build` pasa
  - Dependencies: Task 19 (la herencia de lote es lo que cierra la cadena en modelo central)
  - Files likely touched: nuevo `lib/services/traceability-service.ts`, API de trazabilidad,
    `app/dashboard/inventory/lotes/*`, `lib/services/fefo-allocator.ts` (respeto del bloqueo)
  - Estimated scope: Large

### Checkpoint: Complete
- [ ] Los 9 gaps originales + las brechas de la segunda pasada cerrados, con trazabilidad de cada
  uno a su sección del manual
- [ ] Suite de tests nueva pasa; build limpio; migraciones aplican en staging
- [ ] Documentación: actualizar `PROJECT_CONTEXT.md` y `docs/admin-guide.md`

## Verificado en código (NO son gaps)

Segunda pasada del manual (2026-08-26). Estos puntos se señalaron como faltantes pero ya existen:

| Punto del manual | Dónde está |
|---|---|
| §3.3 factor de rendimiento crudo→cocido | `recipes.yieldPercent` y líneas de receta (`schema.ts:370, 901, 2594`) |
| §15 temperatura de cámaras | Tabla `temperature_logs` con equipo, umbrales, foto e `isCompliant` (`schema.ts:981`) |
| §7 sugerencia de OC nocturna | `lib/services/suggested-order-service.ts` (reorden = consumo diario × lead time + seguridad) |
| §4 par mínimo/máximo | `inventoryItems.minLevel/maxLevel` (`schema.ts:868`) — falta el cálculo, no el campo (Task 14) |

## Pendientes de verificar antes de planear

- **§5.2 conciliación triple** (factura ↔ nota de recepción firmada ↔ OC; la nota firmada habilita
  el pago): probablemente ya vive en compras/facturas. Revisar antes de crear tarea.
- **§3.2 explosión en cascada de sub-recetas**: la investigación la dio por cubierta; confirmar que
  la explosión del POS (§3.4) atraviesa sub-recetas anidadas.

## Fuera de alcance de este plan

§0 contexto, §2 pilares (se materializan en las demás secciones), §7 cronograma del día, §13 roles
y §14 tecnología: disciplina operativa que emerge de los features ya planeados, sin trabajo de
software propio.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `ALTER TYPE ... ADD VALUE` falla dentro de transacción en algunos runners | Med | Verificar migración 0064+ en dev primero; drizzle permite statement standalone |
| Regresión en allocator FEFO al tocarlo desde varios frentes | Alto | `allocateFEFO` ya es puro (no escribe) y con lock FOR UPDATE; añadir tests de concurrencia antes de Phase 2 |
| Cróns duplicando notificaciones/mermas | Medio | Patrón A9 (índice único parcial sobre workflowInstanceId) + estado de notificación por (lote, ventana) |
| Scope creep en prep list/pars (UI ambiciosa) | Medio | Dividir L en 2 tareas (datos/servicio + UI); UI mínima funcional primero |
| `numeric` como string rompe cálculos nuevos | Medio | Convención repo: `Number()` al leer, `String()` al escribir; revisión cruzada en code review |
| Cambios de enum rompen clientes viejos | Bajo | Valores nuevos son aditivos; UI mapea labels en español |
| Dos migraciones tocan `inventory_waste_reason` (Tasks 4 y 11) | Bajo | Son `ADD VALUE` aditivos e idempotentes con `IF NOT EXISTS`; aplicar en orden de numeración |
| Cocina central (Phase 5) duplica stock si transfer y producción se contabilizan dos veces | Alto | Un solo camino de escritura: producción descuenta insumos en central, el transfer mueve el producto terminado; test de balance central+sucursal en Task 19 |
| Consulta de recall lenta sobre historial grande | Medio | Índices sobre lote origen y `productionResults`; medir con dataset de dev antes de dar por buena Task 20 |
| Umbrales del manual tomados como universales | Medio | Todos configurables por tenant con defaults del manual (ver Architecture Decisions) |
| Phase 5 aplica solo a tenants con cocina central | Bajo | Puede desprenderse como plan propio si el cliente piloto es 100% producción in situ |

## Open Questions

1. **Tope de cortesías (Task 3):** ¿monto fijo mensual por sucursal o % de ventas del mes?
   El manual no especifica unidad.
2. **Hold times (Tasks 4–5):** ¿aplican solo a recetas de venta o también a sub-recetas madre
   (salsas, marinados) que esperan en cámara?
3. **Pars por franja (Task 7):** ¿slots fijos 11/14/17/20 como el ejemplo del manual o
   configurables por sucursal? Propuesta: configurables con defaults del manual.
4. **Muestra de auditoría (Task 10):** ¿tamaño de muestra por sucursal (ej. 10 SKUs) o % del
   catálogo?
5. **Merma por preparación (Task 11):** ¿se captura como merma explícita o se deriva sola de la
   diferencia entre cantidad bruta y `yieldPercent` al producir? Lo segundo evita doble captura,
   pero sin causa registrada por la persona.
6. **Metas de merma (Task 12):** ¿la categoría del benchmark es la categoría de insumo existente
   o hace falta un agrupador nuevo (proteínas/vegetales/lácteos/abarrotes)?
7. **Ranking corporativo (Task 17):** ¿el gerente ve el ranking completo con nombres de las otras
   sucursales o solo su posición? Afecta el diseño de permisos, no el cálculo.
8. **Cocina central (Phase 5):** ¿hay cliente con este modelo hoy, o se construye anticipado? Si
   no lo hay, la recomendación es dejar Phase 5 fuera del plan activo y quedarse con Task 20
   (trazabilidad) limitada a producción en sucursal.
9. **Corte D-2 (Task 18):** ¿hora fija de corte configurable por empresa, o la central lo cierra
   manualmente cuando decide?
