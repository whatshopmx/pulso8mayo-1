# TODO: Registro de Mermas overhaul

Plan: `tasks/plan-inventory-waste.md` · Critique: `.impeccable/critique/2026-08-11T17-12-38Z__app-dashboard-inventory-waste.md`

Decisiones de producto resueltas: inversión **aditiva** (Fase 6) · foto **por monto/motivo** (Fase 3) · vocabulario de cocina **sin migrar el enum** (Fase 4) · **solo anulación**, sin undo de 30s (Fase 3).

Regla estricta: **nada de la Fase 2 en adelante arranca antes de que pase el Checkpoint 0.**

## Fase 0 — Fundación decimal (P0, alto riesgo, primero)

- [ ] **1. Migrar columnas a `numeric(12,4)`** — S — deps: ninguna
  - [ ] `inventory_waste.quantity` · `inventory_movements.quantity_change`
  - [ ] `inventory_batches.initial_quantity` + `current_quantity` *(omitido por la crítica; sin esto, una merma fraccionaria redondea el stock restante)*
  - [ ] `0051_merma-decimal-quantities.sql` a mano, `USING <col>::numeric`
  - [ ] Confirmar y documentar si drizzle 0.45 devuelve string o `mode: 'number'`
  - [ ] Verificar: `pnpm db:generate` sin drift extra · `pnpm db:migrate` (**nunca `db:push`**) · `check-migration-drift.ts` limpio · filas sobreviven como `N.0000`

- [ ] **2. Barrer rutas de escritura + las tres fronteras AD-6** — M — deps: 1
  - [ ] `inventory-service` · `receiving-service` · `stock-count-service` · `workflow-action-runner` · `app/actions/inventory-transactions`
  - [ ] Borrar marcadores AD-6: `merma-from-workflow.ts:239` · `stock-count-from-workflow.ts:309` · `production-from-workflow.ts:216/222/272` *(el workflow ya recibe fracciones y las redondea hoy)*
  - [ ] Verificar: `pnpm run build` · `tests/stock-count.spec.ts` · workflow con 2.5 kg guarda `2.5000`, no `3`

- [ ] **3. Barrer agregaciones** — M — deps: 1
  - [ ] `food-cost-service` · `kpi-calculator` · `reports-service` · `theoretical-consumption-service` · `suggested-order-service` · `operational-twin-engine` · `advanced-alert-service` · `knowledge-service`
  - [ ] Coercionar resultados de `sum()` (Postgres devuelve numeric sums como string)
  - [ ] Verificar: merma % y food-cost idénticos a pre-migración sobre datos enteros

- [ ] **4. Barrer lecturas API/UI** — M — deps: 1
  - [ ] `api/inventory/movements` · `api/analytics/inventory/activity` · `api/analytics/trends` · `movements-client` · `inventory-activity-feed` · `stock-manager`
  - [ ] Recortar ceros de cola (`2.5`, no `2.5000`)

### ✅ Checkpoint 0 — requiere revisión humana
- [ ] `pnpm run build` limpio · `pnpm test:e2e` verde (contra un build, no `next dev`)
- [ ] Fracción sobrevive escritura → lectura → agregación → display, por **ambas puertas**
- [ ] Datos históricos enteros reportan los mismos números que antes

## Fase 1 — Corrección de API

- [ ] **5. Escrituras decimales + fuga de tenancy en `api/inventory/waste/route.ts`** — S — deps: 1
  - [ ] `withTenantAuth`; `companyId`/`userId` solo de sesión
  - [ ] `branchId` por `enforceBranchScope` *(hoy se confía del body)*
  - [ ] Lookup de lote scopeado al tenant *(`:105` filtra solo por id — baja cross-tenant)*
  - [ ] Corregir la deriva de centavo en decimales editados
  - [ ] Envelope `{ success, data|error }` vía `ApiHandler`
  - [ ] Verificar: `tests/inventory-waste.spec.ts` — fracción OK, exceso rechazado, cross-tenant 404

- [ ] **6. Entrada fraccionaria validada antes del diálogo destructivo** — S — deps: 1, 5
  - [ ] `step="0.001"` + `inputMode="decimal"`; quitar `min="1"`
  - [ ] Zod `.positive()` + `.max(maxQuantity, 'Solo quedan {N} {unidad} en este lote')` — falla en `FormMessage`, **no** después de confirmar
  - [ ] Error vía `aria-describedby`, no burbuja nativa
  - [ ] `humanizeWasteError` con códigos, no substrings en inglés

### ✅ Checkpoint 1 — P0 cerrado
- [ ] 0.5 kg se registra de punta a punta y todo aguas abajo refleja 0.5

## Fase 2 — Confianza y captura repetida (P1)

- [ ] **7. Quitar el `Cancelar` muerto** — XS — deps: ninguna *(paralelizable)*
  - [ ] `waste-form.tsx:497` → `Limpiar` con `form.reset()`, o render condicional a `onCancel`

- [ ] **8. Matar el remount; cachear el catálogo** — S — deps: ninguna *(paralelizable)*
  - [ ] Quitar `key={refreshKey}` (`waste-client.tsx:23`)
  - [ ] Productos por TanStack Query, cacheados entre guardados
  - [ ] Fallo de catálogo → `ErrorState` con reintento *(hoy el form queda inservible)*
  - [ ] Verificar: 3 guardados seguidos, sin flash, un solo request de productos

- [ ] **9. Flujo de captura repetida + recibo** — M — deps: 8
  - [ ] "Guardar y registrar otra" conserva `itemId`, foco → Cantidad
  - [ ] El foco nunca cae en `document.body`
  - [ ] Tira "Registradas hoy: N · $X" + últimas 5, desde el `GET /api/inventory/waste` ya construido
  - [ ] Toast dice "3 piezas de Jitomate", nunca "3 UNIT"
  - [ ] Cada renglón enlaza al historial (la reversa vive ahí — decisión: sin undo de 30s)

### ✅ Checkpoint 2 — bucle de operación
- [ ] 6 mermas seguidas sin flash, sin perder foco, sin re-elegir producto

## Fase 3 — Evidencia y anulación

*Va antes del layout para que la Fase 4 diseñe con el bloque de foto ya puesto.*

- [ ] **10. Migración de evidencia + anulación** — S — deps: Checkpoint 0
  - [ ] `inventory_waste` += `evidence_url`, `voided_at`, `voided_by`, `void_reason` (nullable)
  - [ ] `tenant_operating_config` += `merma_photo_required_above_cents` (default 50000 = $500), siguiendo el precedente de `mermaVarianceThresholdPct`
  - [ ] Motivos que siempre exigen foto (`DAMAGED`, `QUALITY`) en una constante exportada
  - [ ] `0052_merma-evidencia-anulacion.sql`

- [ ] **11. Persistir evidencia en ambas puertas + capturarla en el form** — M — deps: 10
  - [ ] `merma-from-workflow.ts` guarda `evidenceUrl` *(hoy lo parsea y lo tira en el insert `:233-246` — la foto obligatoria del workflow se está perdiendo)*
  - [ ] Campo de foto con `camera-capture.tsx` + `use-photo-upload.ts` (R2, con fallback local)
  - [ ] Requerida si `totalLoss` > umbral o motivo `DAMAGED`/`QUALITY`; opcional en el resto, avisando **antes** de enviar
  - [ ] Exigencia también server-side en el POST
  - [ ] El campo aparece sin mover el botón de envío bajo el dedo
  - [ ] Verificar: $600 sin foto rechazado; $100 sin foto aceptado; foto de workflow recuperable

- [ ] **12. Endpoint de anulación + acción en historial** — M — deps: 10
  - [ ] `POST /api/inventory/waste/[id]/void`: restaura stock, escribe movimiento compensatorio, marca anulado — **nunca borra**
  - [ ] Solo roles de gestión (`requireRoleApi`), scopeado al tenant
  - [ ] En transacción (por eso el repo usa el driver `neon-serverless`)
  - [ ] Rechaza doble anulación y restauraciones en conflicto
  - [ ] Filas anuladas excluidas de merma % y de todas las agregaciones de la Tarea 3
  - [ ] `AuditService` registra actor y motivo
  - [ ] Actualizar el copy del diálogo — ya puede prometer anulación por gerente, con verdad
  - [ ] Verificar: anular restaura la fracción exacta; segunda anulación 409; EMPLEADO 403

### ✅ Checkpoint 3 — evidencia y reversibilidad
- [ ] Una merma sobre el umbral no se puede registrar sin foto, por ninguna de las dos puertas
- [ ] Un gerente puede deshacer una merma errónea y los números vuelven a su sitio

## Fase 4 — Layout, lenguaje y tokens

- [ ] **13. Una sola columna; retirar el glosario** — M — deps: 9, 11
  - [ ] `lg:grid-cols-2` → columna única ~640px
  - [ ] Borrar el `<h3>` del form y el `CardDescription` duplicado (3 títulos → 1)
  - [ ] Definiciones de motivo dentro de sus `SelectItem`; tarjeta de glosario eliminada
  - [ ] Quitar "Volver al Inventario"
  - [ ] El layout acomoda la foto (T11) y el recibo (T9) sin reflow

- [ ] **14. Vocabulario de cocina compartido por ambas puertas** — M — deps: 13
  - [ ] Nuevo `lib/inventory/waste-reasons.ts`: mapa enum→etiqueta, mapa clave-cocina→enum (movido desde `merma-from-workflow.ts:39`) y el predicado "es consumo, no merma"
  - [ ] `merma-from-workflow.ts` importa en vez de redeclarar `REASON_MAP`
  - [ ] Ningún enum visible; los 7 valores cubiertos (agregando `STAFF`/`COURTESY`) para que no vuelva a desincronizarse
  - [ ] `QUALITY` → "Error de cocina", `DAMAGED` → "Se cayó / se rompió"
  - [ ] `STAFF`/`COURTESY` separados como *consumo*; suprimen "Pérdida Estimada"
  - [ ] Unidades como "kg"/"L"/"piezas"; copy en `messages/es.json`
  - [ ] Verificar: una merma por workflow y otra por form muestran la misma etiqueta en el historial

- [ ] **15. Tokens de warning y dark mode** — S — deps: 13
  - [ ] `waste-form.tsx:468` → `bg-warning/10 border-warning/25 text-warning-text`
  - [ ] 4 iconos amber crudos (`page.tsx:37`, `waste-client.tsx:46`, `waste-form.tsx:258`, diálogo) → `text-warning-text`
  - [ ] ≤1 `AlertTriangle`; icono de página alineado con el `Trash2` del dashboard
  - [ ] `aria-hidden` en iconos decorativos

- [ ] **21. Decir quién ve el dato, y devolverle el número al gerente** — M — deps: 9, 14
  *(numerada al final para no renumerar tareas ya en curso; pertenece a la Fase 4)*
  - [ ] Una línea junto al envío: la ve la dirección del grupo, medida **contra la meta de la sucursal**, no como ranking de personas. Copy en `messages/es.json`
  - [ ] ⚠️ Descartado por falso: *"no sirve para evaluar a nadie"* — `food-cost-service.ts:163-168` ya compara sucursales del grupo
  - [ ] La tira de la T9 muestra además "Merma de la semana: X% · meta Y%", desde `foodCostTargetPercent` / `mermaVarianceThresholdPct`
  - [ ] `waste-reasons.ts` (T14) agrega el corte **evitable vs. estructural**: caducidad → compras/pronóstico, `QUALITY` → capacitación, `SPILLAGE` → ruido
  - [ ] `inventory/reports` y `dashboard/reports` agrupan por ese corte (diagnosticar causa, no rankear sucursales)
  - [ ] `STAFF`/`COURTESY` fuera del número evaluativo en todos lados *(ya rutean a `USAGE`; solo se hace visible)*
  - [ ] Visibilidad por rol: ADMIN/dueño todas las sucursales (ya existe) · GERENTE/SUPERVISOR la suya con las mismas metas vía `enforceBranchScope` · EMPLEADO solo sus registros, nunca el agregado de costos
  - [ ] Verificar: GERENTE y ADMIN ven el mismo % y meta para la misma sucursal · EMPLEADO no alcanza agregados (403) · la línea del formulario es cierta contra lo que los tableros realmente exponen

### ✅ Checkpoint 4 — coherencia
- [ ] Claro y oscuro legibles; nada en pantalla nombra un enum; ambas puertas hablan igual
- [ ] Quien registra una merma puede decir quién la verá y cómo se juzgará — y acierta

## Fase 5 — Pulido

- [ ] **16. Formato, a11y y áreas táctiles** — M — deps: 13, 14, 15
  - [ ] `Intl.NumberFormat('es-MX')` para moneda · `'es-MX'` para fechas
  - [ ] Jerarquía de encabezados válida (sin salto h1→h3)
  - [ ] Targets ≥44px; `w-full` en `SelectTrigger` *(hoy `w-fit` los encoge y reflowea)*
  - [ ] `Notas` sin `resize-none`
  - [ ] Estado sin sucursal usa el `EmptyState` compartido
  - [ ] Verificar: axe sin críticos

- [ ] **17. Deep-link y adopción de `lot-selector`** — M — deps: 13
  - [ ] "Registrar merma" en cada renglón de expiraciones → `?item={id}`
  - [ ] Al llegar por ese link, producto y lote FIFO preseleccionados
  - [ ] Usar `lot-selector.tsx` (FIFO, con badge de caducidad) o registrar por qué no encajó
  - [ ] Búsqueda en el select de producto con Popover + Input (sin dependencia nueva)

## Fase 6 — Pestaña "Por vencer" (la inversión aditiva)

- [ ] **18. Datos de lotes por vencer** — S — deps: Checkpoint 4
  - [ ] Reusar `/api/inventory/expirations` (extendiéndolo si hace falta), no una query paralela
  - [ ] Por lote: item, lote, caducidad, cantidad restante, costo unitario, pérdida estimada
  - [ ] Scopeado por tenant y sucursal; excluye lotes ya dados de baja; orden FIFO

- [ ] **19. UI del checklist + shell de pestañas** — M — deps: 18
  - [ ] Pestañas `Por vencer (N)` y `Registro`; `Por vencer` es la de aterrizaje
  - [ ] Renglón: producto, lote, "vence hoy"/"venció ayer", cantidad, pérdida, stepper pre-cargado al restante
  - [ ] Stepper acepta decimales y topa en el restante del lote
  - [ ] Total corriente "N seleccionados · $X" sobre el botón
  - [ ] Motivo `EXPIRED` por defecto **solo aquí**, donde es cierto (la T14 lo quita del form en blanco)
  - [ ] Estado vacío con `EmptyState`; navegable por teclado; targets ≥44px

- [ ] **20. Envío en lote** — M — deps: 19, 11
  - [ ] Un endpoint escribe N mermas **en una transacción**; no hay éxito parcial
  - [ ] Reusa la validación de la T5; nada de una segunda copia de las reglas
  - [ ] El umbral de foto aplica por renglón; el UI bloquea diciendo cuáles la necesitan
  - [ ] Diálogo de confirmación con la voz del actual (el artefacto mejor calificado de la crítica)
  - [ ] Las filas así escritas son indistinguibles aguas abajo de las del form
  - [ ] Verificar: lote de 3 descuenta los 3 exactos; fallo inducido en el 2º revierte los 3

### ✅ Checkpoint 5 — completo
- [ ] `pnpm run build` + `pnpm run lint` limpios · `pnpm test:e2e` verde contra un build
- [ ] Cierre de turno: aterrizar en `Por vencer`, marcar 3 lotes, un solo envío
- [ ] Re-correr `/impeccable`; cualquier regresión cuenta como defecto

## Pendiente de decisión de producto

Ninguna. Las cinco preguntas abiertas están resueltas y planeadas.

**Punto a vigilar después de la Fase 4:** la T21 es una apuesta. Decirle al gerente que dirección
compara sucursales puede suprimir el reporte en vez de generar confianza si la mitad recíproca
—números propios y atribución de causa— llega débil o tarde. Enviar la T21 **completa**, nunca
la línea de copy sola, y revisar el volumen de mermas reportadas por sucursal en las semanas
siguientes. Una caída sostenida es la señal para reconsiderar.
