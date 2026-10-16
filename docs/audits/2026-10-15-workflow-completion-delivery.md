# C28 — Entrega durable de finalización

Fecha: 15-10-2026 (verificación final y cierre el mismo día). Seguimiento: `tasks/todo-conexion-frontend-backend.md`. C28 cerrada: los tres criterios de aceptación están verificados y los límites que quedan se declaran abajo, como prevé C28.6. Con esta entrega se cierra la puerta de la Fase 4.

## Cambio

Se continuaron los cambios existentes de C28, divididos antes de editar en esquema/transición, publicación, resultado de extractores, recuperación, pantalla y evidencia.

- La transición de `checkProgress` inserta la intención en `workflow_completion_outbox` usando la misma transacción. Un error del insert se propaga y revierte el cierre; no se oculta como supuesto duplicado.
- La migración aditiva 0096, su journal y snapshot están aplicados y confirmados en Neon (ver Verificación). La columna `completion_effects_status` es nullable: las ejecuciones anteriores conservan estado desconocido.
- El cron registrado publica hasta 25 filas pendientes por corrida. Cada envío bloquea su fila hasta guardar el resultado. Cinco errores de publicación dejan fallo recuperable; un fallo de persistencia posterior al envío conserva la intención, y el reenvío usa el mismo id de evento.
- `delivered` en el outbox solo acredita aceptación del evento. El estado visible del procesamiento es `pending`, `processing`, `completed`, `failed` o NULL. El consumidor guarda por separado los extractores que terminaron, usa concurrencia por instancia y bloqueo asesor en BD, y omite los exitosos en entregas posteriores.
- La recuperación exige `workflows:update` y el alcance vigente de empresa, sucursal y responsable. Abre una generación nueva con intentos a cero, conserva los éxitos y solo guarda intención. Un doble clic no abre dos generaciones y una corrida obsoleta no cambia el resultado de la generación nueva.
- La página real permanece abierta al completar el último paso; muestra procesamiento separado de pasos completos, consulta cada cinco segundos y ofrece recuperación con carga y error visibles. READONLY no recibe la acción. Las ejecuciones sin seguimiento no se presentan como éxito.

## Verificación

- Pruebas enfocadas de outbox, entrega y regresión de C27: 15/15 aprobadas.
- Entrega, acción de recuperación y regresión de alcance C04: 43/43 aprobadas. Se usan los helpers reales de permiso/alcance con sesiones y consultas controladas; se cubren otra empresa, otra sucursal, actor sin sucursal, otro responsable, READONLY, UUID inválido e instancia inexistente.
- V3 controlada: caída antes de publicar, caída entre envío y confirmación, publicadores concurrentes, cinco errores de proveedor, duplicación concurrente del consumidor, recuperación parcial, doble recuperación, generación obsoleta y ejecución histórica sin outbox. El adaptador aplica filtros SQL traducidos con Drizzle, exclusión transaccional y rollback; **no equivale a Postgres ni a un servidor Inngest real**.
- V2: **6/6 recorridos aprobados** con página y executor reales, Vite/Chromium y API/acción simuladas. Primera corrida: 5 aprobados y una expectativa incorrecta del título; tras corregir el título y controlar cuándo termina el procesamiento, la reejecución del sexto caso aprobó. Se comprobó consola sin `pageerror` en ese caso. Comandos: `pnpm.cmd exec playwright test --config tests/playwright-shifts.config.ts workflow-completion.spec.ts` y reejecución `--grep 'pasos completos'`.
- Lint enfocado: 0 errores, 39 warnings en la primera pasada (incluye avisos previos y avisos de tipos de los adaptadores de prueba). No acredita lint global.
- Lint final de los servicios/consumidores nuevos y sus pruebas: **0 errores, 10 warnings** de `no-explicit-any` en adaptadores y fixtures. El código nuevo de publicación, consumidor y acción no generó warnings. `git diff --check` aprobó.
- **Puerta de compilación cerrada:** `tsconfig.json` excluye `.worktrees/**` y `.tmp/**` (C28.8a). `pnpm exec tsc --noEmit` termina con código 0 y `pnpm run build` termina con código 0.
- **Lint global:** 0 errores, 2483 warnings (preexistentes o `no-explicit-any` en adaptadores de prueba). `git diff --check` limpio.
- **Suite completa:** `pnpm run test:unit` → 1351 aprobadas, 1 omitida, 1 TODO (1353), 104 archivos. Regresión enfocada 68/68 en nueve archivos (C27, outbox, publicador, consumidor, recuperación, alcance C04, contrato C24, cierre de conteo y veredicto).
- **Migración 0096 aplicada y confirmada en Neon:** `drizzle.__drizzle_migrations` registra `created_at = 1792022400000` (el `when` de 0096) y ninguna entrada del journal queda posterior. Comprobado en `information_schema`/`pg_indexes`: existen la tabla `workflow_completion_outbox`, la columna nullable `workflow_instances.completion_effects_status` (text, nullable) y los dos índices declarados. No se usó `db:push`.
- **V3 contra Postgres real (`scripts/verify-workflow-completion-delivery.ts`): 11 comprobaciones aprobadas**, fixtures con UUID propios y limpieza en `finally`. Cubre rollback real (una caída antes del commit no deja ni resultados ni intención), cierre concurrente (un `completed`, un `alreadyCompleted`), extractor duplicado sin duplicar `stock_counts`, fallo terminal visible con `completionEffectsStatus = pending`, y recuperación que conserva los extractores exitosos. No publica eventos ni envía mensajes externos.

## Límites declarados (no impiden cerrar C28; C28.6)

1. **Acciones síncronas anteriores:** `WorkflowActionRunner` y los smart links ejecutan efectos con conexiones propias; sólo el camino de conteo comparte la transacción (`completeStockCount(instanceId, userId, tx)`). Sus errores siguen siendo de mejor esfuerzo y el rollback del outbox no revierte efectos ya confirmados por esos servicios. La columna `completionEffectsStatus` y la UI describen el procesamiento de extractores, no certifican esas acciones.
2. **Escritura parcial de recepción:** el marcador por extractor se confirma después de sus escrituras de dominio. `processReceiving` no encierra reporte, lotes y movimientos en una sola transacción; una caída parcial puede omitir trabajo pendiente y el reintento lo saltaría. Las claves únicas de conteo/merma/producción y el bloqueo por instancia limitan carreras, no reparan esa ventana.
3. **Runtime de Inngest:** la entrega se verificó contra Postgres real y con adaptadores de transacción, pero no se levantó un servidor Inngest contra Neon ni se enviaron eventos reales. El `onFailure` persistente depende de recuperar la conectividad de BD.

## Fuentes de implementación

El uso de pasos estables, reintentos y handler terminal se contrastó con la [documentación oficial de manejo de errores de Inngest](https://www.inngest.com/docs/durable-execution/guides-and-advanced/error-handling) y [onFailure de SDK v4](https://www.inngest.com/docs/reference/typescript/v4/functions/handling-failures). La memoización de pasos no convierte las escrituras externas en exactamente una vez; por eso se conservan explícitos los límites anteriores.
