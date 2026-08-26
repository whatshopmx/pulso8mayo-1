# TODO: Cierre de brechas QSR (egresos + producción/FEFO)

Plan completo: `tasks/plan-cierre-brechas-qsr.md`
Auditoría origen: artifact "Brechas de Egresos y FEFO" (26 ago 2026) — 7 cubiertas, 13 parciales, 3 ausentes.

## Decisiones pendientes (bloquean el arranque)

- [ ] **Vía de venta por platillo**: ¿CSV programado (ya existe con UI), POS, o captura al cierre? — bloquea la *verificación* de la Fase 1
- [ ] **OK para reparar el journal** contra la base compartida (Task 0)
- [ ] **¿El descuento automático por venta se queda?** Define la fuente del consumo real en Task 1 — ver Open Question 3 del plan

## Phase 0: Desbloqueo de migraciones

- [ ] Task 0: Reparar el journal — 13 migraciones sin fila en `drizzle.__drizzle_migrations` (S)

**Checkpoint:** `pnpm db:migrate` es no-op limpio. Sin esto ninguna migración del plan aplica.

## Phase 1: La verdad del consumo

- [ ] Task 1: Consumo real desde el conteo físico, no desde los movimientos (M)
- [ ] Task 2: Restar la merma registrada y excluir transferencias (S)
- [ ] Task 3: Semáforos del §9.2 + borrar `CostingService.getVarianceReport` (M)
- [ ] Task 4: Brecha food cost real vs teórico en el reporte de control (M)

**Checkpoint:** varianza verificable a mano; una merma registrada la baja en vez de subirla. **Revisión humana antes de seguir.**

## Phase 2: Trazabilidad y recall

- [ ] Task 5: Migración del lote de producción (`parent_batch_ids`, `origin`) (S)
- [ ] Task 6: Emitir el lote hijo al registrar producción — cierra el TODO de `production-service.ts:181` (M)
- [ ] Task 7: Consulta de recall por lote (servicio + API + pantalla) (M)

**Checkpoint:** recorrido proveedor → lote → sub-receta → sucursal → producto verificado a mano.

## Phase 3: Amarre documental

- [ ] Task 8: OS dentro de la conciliación 3 vías (`invoices.service_order_id`) (M)
- [ ] Task 9: `purchase_order_quotes` + validación de `minQuotes` en OC (M)

**Checkpoint:** ninguna factura de servicio concilia sin conformidad; ninguna OC sobre umbral se aprueba sin cotizaciones.

## Phase 4: Taxonomías y política operativa

- [ ] Task 10: Motivos de merma `RETENTION_EXPIRED` y `COLD_CHAIN_FAILURE` (S)
- [ ] Task 11: `abcClass` aditivo, conservando `isHighValue` derivado (S)
- [ ] Task 12: Topes de caja chica (por vale y mensual) (S)
- [ ] Task 13: Tiempo de retención y campos de ficha técnica en `recipes` (S)

**Checkpoint:** build + lint verdes; recorrido manual de merma, catálogo, caja chica y recetas.

## Phase 5: Módulos nuevos

- [ ] Task 14: Tabla `supplier_contracts` (S)
- [ ] Task 15: Servicio + API de contratos, conciliación >10%, alerta de renovación 90 días (M)
- [ ] Task 16: UI de contratos y conciliación de domiciliados (M)
- [ ] Task 17: Tabla `payment_runs` + renglones de facturas/gastos/nómina (M)
- [ ] Task 18: UI de tesorería — programa semanal de egresos y KPI de cumplimiento (M)
- [ ] Task 19: Campos de plan en `production_orders` (estación, turno, hora límite, lote FEFO) (S)
- [ ] Task 20: Servicio de prep list generada desde el forecast (M) — depende de Task 13
- [ ] Task 21: Tabla `shift_pars` y comparativo contra lo producido (M)
- [ ] Task 22: Provisiones de nómina (aguinaldo, prima, PTU) reflejadas en el P&L (M)

## Checkpoint: Complete

- [ ] `pnpm run build && pnpm run lint` verdes
- [ ] Suite e2e con el dev server de Inngest arriba
- [ ] Recorrido manual end-to-end contra los dos manuales

## Notas de paralelización

- Fases 1, 2, 3 y 4 son independientes entre sí **una vez hecha Task 0**.
- Dentro de cada fase el orden es estricto (dependencias reales, no de conveniencia).
- Task 20 depende de Task 13; Task 7 depende de Task 6; Task 6 depende de Task 5.
- Las migraciones NO se paralelizan: una a la vez para no reventar el journal otra vez.
