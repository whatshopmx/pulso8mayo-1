# Handover — Plan loteprod-gaps: Task 3 implementada, cómo continuar

> **Documento de entrega** para retomar el plan `tasks/plan-loteprod-gaps.md` en una sesión nueva.
> Fuentes de verdad: `loteprod.md` (manual operativo QSR) · `tasks/plan-loteprod-gaps.md` (plan técnico,
> Tasks 1–10) · `tasks/todo-loteprod-gaps.md` (checklist viva con estado y evidencia por tarea).

---

## 1. Contexto en 30 segundos

`loteprod.md` define producción diaria, FEFO y recetario para grupos QSR (3–15 sucursales).
La investigación contra `app/dashboard/inventory/` confirmó ~75% de cobertura ya implementada;
el plan cierra los gaps restantes en 3 fases:

| Fase | Tareas | Estado |
|---|---|---|
| Pre-requisitos | etiqueta FEFO, transfers con lote, conversiones numéricas | ✅ commits previos |
| Phase 1 — Seguridad/control | T1 temperatura recepción · T2 alertas caducidad · T3 aprobación/tope mermas | ✅ ✅ 🔶 **T3 codificada, falta verificar/commitir** |
| Phase 2 — Producción diaria | T4–T5 hold times · T6 prep list · T7 pars por franja | ⬜ |
| Phase 3 — Gobernanza | T8 versionado fichas · T9 clasificación ABC · T10 auditoría sorpresa | ⬜ |

---

## 2. Estado al cierre (2026-08-26) — Task 3

**Qué se construyó** (3 slices verticales):

1. **Datos + lógica backend**
   - `inventory_waste` += `approval_status` (`AUTO|PENDING_APPROVAL|APPROVED|REJECTED`, default `AUTO`),
     `approved_by`, `approved_at`; índice `inventory_waste_approval_status_idx`.
   - `companies` += `courtesy_waste_monthly_cap_cents` (nullable = sin tope).
   - Migración **manual** `drizzle/0067_waste_approval.sql` + entrada idx 67 en `drizzle/meta/_journal.json`
     (mismo patrón que `0066`; NO correr `db:generate` sobre esto).
   - `lib/inventory/waste-approval.ts`: lógica pura (`initialApprovalStatus`, `evaluateApproval`)
     compartida por API y tests. Falla cerrado con `roleIsAtLeast` de `lib/permissions.ts`.
   - POST `/api/inventory/waste`: STAFF/COURTESY nacen `PENDING_APPROVAL` **sin baja de lote ni movimiento**
     (el descuento se difiere a la aprobación); resto nace AUTO igual que hoy.
   - POST `/api/inventory/waste/[id]/approval` body `{ action: APPROVE | REJECT }`:
     GERENTE+ aprueba acotado a su sucursal; si el acumulado APROBADO del mes (empresa) + esta merma
     excede el tope → exige ADMIN+ (`CAP_EXCEEDED_ELEVATED_REQUIRED`); aprobar descuenta el lote
     con `FOR UPDATE` en transacción + movement `USAGE`; rechazar no toca stock.
   - `merma-from-workflow.ts`: filas STAFF/COURTESY también nacen pendientes.

2. **KPIs solo con AUTO/APPROVED**
   - `lib/inventory/waste-kpi.ts` exporta el fragmento SQL `wasteLossEligible` (criterio único).
   - Aplicado en: GET `/api/inventory/waste` (summary), `/api/inventory/dashboard` (2 sitios),
     `executive-report-service`, `predictive-scoring-service` (2), `knowledge-service`,
     `inventory-reports-service.getWasteReport`.

3. **UI**
   - Historial (`waste-history-client.tsx`): columna "Estado" con badge (AUTO no muestra nada).
   - Detalle (`waste-detail-sheet.tsx`): badge de aprobación + botones Aprobar/Rechazar con confirmación
     para GERENTE+ (`useWasteApprovalAction` nueva en `hooks/queries/use-inventory.ts`).
   - Formulario (`waste-form.tsx`): toast distinto cuando la merma va "a aprobación".
   - Página (`waste/page.tsx`): tarjeta ADMIN+ para configurar el tope mensual (server action
     `saveCourtesyWasteCap`, pesos↔centavos) mostrando el acumulado aprobado del mes.

**Decisión tomada** (cerraba pregunta abierta #1 del plan): el tope es **monto fijo mensual en pesos por
empresa**, no % de ventas — determinístico y no acoplado al ingest de POS.

**Verificación al cierre:**

| Check | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ exit 0 |
| `pnpm test:unit` | ✅ 372 passed / 17 archivos (incluye 12 nuevos de `lib/inventory/__tests__/waste-approval.test.ts`) |
| `pnpm run lint` | ✅ 0 errores (warnings preexistentes) |
| `pnpm run build` | ⬜ **PENDIENTE** |
| `pnpm db:migrate` (0067 en dev) | ⬜ **PENDIENTE** |
| Flujo manual E2E (registrar→aprobar→descuento) | ⬜ **PENDIENTE** |
| Commit | ⬜ **PENDIENTE** — cambios solo en working tree |

---

## 3. Próximos pasos sugeridos (en orden)

### Paso 1 — Cerrar Task 3 (~30 min) ← EMPEZAR AQUÍ

1. `pnpm db:migrate` contra dev (aplica `0067_waste_approval.sql`; es aditiva, sin drops).
2. `pnpm run build` → debe salir exit 0.
3. Verificación manual con dev server (`INNGEST_DEV=1` no requerido aquí):
   - Registrar merma COURTESY → aparece "Por aprobar", inventario intacto, sin movimiento.
   - Aprobar como GERENTE → lote descontado + movement "Cortesía a Cliente"; KPI del dashboard la excluye
     del % de merma pero sí suma al consumo interno.
   - Configurar tope chico como ADMIN → siguiente aprobación de GERENTE devuelve 403 `CAP_EXCEEDED_ELEVATED_REQUIRED`.
   - Rechazar → queda REJECTED, visible en historial, sin efecto en reportes.
4. Actualizar `tasks/todo-loteprod-gaps.md`: marcar Task 3 DONE con evidencia (patrón de Tasks 1–2)
   y cerrar la open question #1 (tope = monto fijo mensual por empresa).
5. **Commit selectivo** — el árbol tiene archivos de OTRO workstream, NO mezclarlos:
   - Sí commitear: `app/api/inventory/waste/**`, `app/dashboard/inventory/waste/*`,
     `components/inventory/waste-form.tsx`, `hooks/queries/{index,use-inventory}.ts`,
     `lib/db/schema.{ts,/core.ts}`, `drizzle/0067_waste_approval.sql`, `drizzle/meta/_journal.json`,
     `lib/inventory/**` (waste-approval, waste-kpi, __tests__), `lib/inventory/waste-labels.ts`,
     los 5 servicios/API con filtro KPI, `tasks/todo-loteprod-gaps.md`.
   - NO tocar: `app/dashboard/budgets/`, `hooks/queries/use-budgets.ts`, `components/app-sidebar.tsx`,
     `tests/tmp-verify/`, `.impeccable/critique/…` (workstream OC/OS presupuestos, ver su handoff).
   - Mensaje sugerido: `feat(inventario): aprobación y tope mensual de mermas STAFF/COURTESY (loteprod §8.1, Task 3)`.

### Paso 2 — Task 4: Hold times, esquema y captura (~Medium)

`recipes.holdTimeMinutes` (nullable int) + `production_results.expires_at` poblado al producir
(`produced_at + holdTimeMinutes`) + valor nuevo `HOLD_TIME` en el enum `inventory_waste_reason`
(migración `ALTER TYPE ... ADD VALUE` — verificar que drizzle la emita fuera de transacción; si no,
partirla). Producir sin hold time sigue funcionando. Archivos: schema, `production-service.ts`,
`production-from-workflow.ts`, formulario de recetas. Test: producir receta holdTime=30 → expires_at correcto.

### Paso 3 — Task 5: Ciclo de vencimiento en línea (~Medium, depende T4)

Nuevo `lib/inngest/functions/cron-hold-times.ts` (horario): detecta `production_results` vigentes con
`expires_at < now()` no descartados → notifica al turno vía **NotificationDispatcher** (nunca Wasender
directo) → confirmación crea `inventoryWaste reason=HOLD_TIME` **idempotente patrón A9**
(índice único parcial sobre `workflowInstanceId` o equivalente propio). Dashboard: "en línea por vencer"
vs "vencidos sin tirar". La varianza del día debe reflejar la merma.

### Paso 4 — Task 6: Prep list por estación (~Large, dividir 6a datos / 6b UI)

`production_orders` += `station`, `shift`, `responsible_user_id`, `deadline_time`, `completed_by/at`.
Vista "Prep List del día" agrupada por estación en `production-client.tsx`, cada línea mostrando el lote
FEFO que consumirá (`allocateFEFO` en modo lectura ya existe — es puro) y completando dispara el flujo
de producción real existente. Respeta convención numeric(12,4).

### Paso 5 — Task 7: Pars por franja horaria (~Large, dividir 7a/7b)

Tabla nueva `recipe_par_slots` (receta×sucursal×slot horario, slots configurables con defaults
11/14/17/20 — cerraba open question #3 propuesta). Sugeridor = par del próximo slot − producción vigente
(no vencida según `expires_at` de T4) integrado al panel de sugerencias existente.

**Checkpoint Phase 2:** flujo E2E forecast → prep list → producir FEFO → hold time vence → merma
HOLD_TIME → varianza del día. Revisión con humano antes de Phase 3 (lo exige el plan).

### Paso 6+ — Phase 3 (gobernanza): T8 versionado de fichas (`recipe_versions` snapshot jsonb),
T9 ABC (`abc_class` A/B/C, clasificador 80/15/5 por consumo 90d, cron mensual, filtros de conteo),
T10 auditoría sorpresa trimestral (cron → workflow por sucursal con muestra aleatoria ABC + evidencia foto).
Open question pendiente antes de T10: tamaño de muestra (N SKUs fijo vs % catálogo).

---

## 4. Convenciones y gotchas (obligatorias en este plan)

1. Migraciones SOLO con `pnpm db:generate` + `pnpm db:migrate` (o archivo manual + journal como la 0067).
   **Jamás `db:push`** — puede dropear tablas.
2. Descuentos/movimientos de stock únicamente vía `allocateFEFO()` dentro de transacción.
3. Cantidades `numeric(12,4)` llegan como **string** en TS: `Number()` al leer, `String()` al escribir.
4. Dinero siempre centavos integer; pesos↔centavos con `Math.round(n*100)` en la frontera UI.
5. Idempotencia de crons/capturas: patrón A9 (índice único parcial sobre `workflowInstanceId`);
   capturas manuales pueden repetirse.
6. Notificaciones vía `NotificationDispatcher` (WhatsApp/email/in-app resuelven preferencias);
   nunca llamar Wasender directo.
7. Roles: usar `roleIsAtLeast()` de `lib/permissions.ts` (falla cerrado). Ojo: `DIRECTOR_OPS` existe en
   la jerarquía de aprobadores (85) — aprueba bajo tope pero sobre tope exige ADMIN+ (90). Ya cubierto
   por tests.
8. El criterio "qué merma suma a KPIs" vive en UN fragmento: `wasteLossEligible` (`lib/inventory/waste-kpi.ts`).
   Cualquier agregado futuro de pérdida debe AND-earlo.
9. `tsc --noEmit` tarda ~4–6 min en este repo: usar timeout ≥600000 ms.

## 5. Decisiones abiertas vivas (del plan)

| # | Pregunta | Dónde se decide |
|---|---|---|
| ~~1~~ | ~~Tope de cortesías~~ | ✅ Resuelta: monto fijo mensual por empresa (Task 3) |
| 2 | ¿Hold times aplican a sub-recetas madre (salsas, marinados)? | Antes de Task 4 — recomendación: sí, mismo campo nullable |
| 3 | ¿Slots de pars fijos o configurables? | Antes de Task 7 — propuesta aceptada implícitamente: configurables con defaults 11/14/17/20 |
| 4 | Muestra de auditoría sorpresa: N SKUs o % catálogo | Antes de Task 10 |
