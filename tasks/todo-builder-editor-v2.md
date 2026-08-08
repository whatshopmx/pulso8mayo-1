# Editor de Flujos — corrección de crítica v2 — Task List

> Plan completo en `tasks/plan-builder-editor-v2.md`. Fuente: `.impeccable/plans/builder-editor-critique-fix-plan-v2.md`.
> Verificación base de cada tarea (Definition of Done del repo): `npx tsc --noEmit` limpio, `pnpm run build` limpio, `node .claude/skills/impeccable/scripts/detect.mjs components/builder` en 0. No se repite en cada tarea salvo que añada algo.
> Marca `[x]` solo al verificar, no al escribir el código.

---

## Fase 0 — Limpieza previa (bloquea todo lo demás)

- [ ] **T0 — Borrar el builder muerto y los restos.**
  Existen dos implementaciones paralelas del builder en `components/builder/`. Sin borrar la muerta, cada corrección corre el riesgo de aterrizar en el archivo equivocado (y ahí viven todas las violaciones de `shadow-` del subárbol).
  **Aceptación:**
  - `builder-canvas.tsx`, `builder-header.tsx`, `builder-properties.tsx`, `builder-toolkit.tsx` eliminados; `rg "builder-(canvas|header|properties|toolkit)"` sin resultados fuera de git history.
  - `canvas.tsx:9-20` sin imports muertos (`Card`, `CardHeader`, `CardTitle`, `cn`, `GripVertical`, `STEP_TYPE_DISPLAY`).
  - `WorkflowPreviewModalProps` declarado una sola vez en `workflow-preview-modal.tsx`.
  **Verificación:** `npx tsc --noEmit` · el editor carga y el lienzo sigue funcionando (arrastrar un paso).
  **Deps:** None. **Files:** 4 borrados, `canvas.tsx`, `workflow-preview-modal.tsx`. *Size S.*

---

## Fase 1 — Backend: persistencia real y autorización [P0]

- [ ] **T1 — Migración `0038`: columnas que faltan.**
  `workflow_schedules`: `assigned_shifts` (jsonb, default `[]`), `assigned_roles` (jsonb, default `[]`), `days_of_week` (jsonb, default `[]`). `workflow_templates`: `cumplimiento_normativo` (jsonb, default `[]`). Backfill en el mismo `up`: `days_of_week` desde `day_of_week`, `assigned_roles` desde `assigned_role`. Las escalares **se conservan** (AD-7). `requiereIA` no recibe columna (AD-4).
  **Aceptación:**
  - `pnpm db:generate` genera SOLO `ADD COLUMN` + `UPDATE` de backfill; cero `DROP`.
  - Una fila existente con `day_of_week = 1` queda con `days_of_week = ["monday"]`.
  - `drizzle/meta/_journal.json` con la entrada `0038` y el SQL renombrado a `0038_builder-settings-arrays.sql` (convención del repo).
  **Verificación:** `pnpm db:generate` · `pnpm db:migrate` en rama de Neon · `npx tsc --noEmit`.
  **Deps:** T0. **Files:** `lib/db/schema.ts`, `drizzle/0038_builder-settings-arrays.sql`, `drizzle/meta/_journal.json`. *Size S.*

- [ ] **T2 — GET/POST persisten arrays completos.** *(la tarea que hoy hace que algo no funcione)*
  Hoy el POST escribe `data.days[0]` (`route.ts:221`) y `data.assignedRoles[0]` (`:228`), ignora `assignedShifts`, y el GET devuelve `[]`/`false` fijos (`:84-86`, `:143-147`). Escribir los arrays nuevos (además de las escalares por AD-7) y leerlos de vuelta. `requiereIA` pasa a `aiConfig != null` calculado.
  **Aceptación:**
  - POST con `days: [lun, mié, vie]`, `assignedRoles: [GERENTE, EMPLEADO]`, `assignedShifts: [morning, afternoon, night]`, `cumplimientoNormativo: [NOM-251]` → GET devuelve los cuatro arrays idénticos, mismo orden.
  - `day_of_week` y `assigned_role` siguen recibiendo el primer elemento (no romper el motor de ejecución).
  - Cero literales `[]`/`false` inventados en la respuesta del GET.
  **Verificación:** e2e de T6 · inspección directa de la fila en Neon tras un guardado.
  **Deps:** T1. **Files:** `app/api/templates/[id]/settings/route.ts`, `lib/services/workflow-schedule-service.ts`. *Size M.*

- [ ] **T3 — Gate por jerarquía y por campo en el POST + redirección del editor + fuera los `console.log`.**
  Hoy el POST solo verifica sesión + `branchId` (`:179-181`): cualquier usuario autenticado reescribe el `complianceConfig` de un playbook corporativo. **`requirePermissionApi('workflows','update')` no sirve aquí**: `PERMISSIONS` da `update` a `GERENTE` (`:107`), `SUPERVISOR` (`:113`) y `EMPLEADO` (`:124` — es con lo que ejecuta pasos). Se usa `ROLES_HIERARCHY` (AD-3, AD-9).
  **Aceptación:**
  - Campos privilegiados (`complianceConfig`, `version`, `aiConfig`, `cumplimientoNormativo`, `activo`) → 403 por debajo de `ADMIN` (90), con mensaje accionable en español que nombra el campo.
  - `GERENTE` sobre plantilla con `scope === 'company'` → 403 aunque solo mande campos de programación.
  - `SUPERVISOR`/`EMPLEADO`/`READONLY` → 403 en cualquier POST.
  - `page.tsx` redirige a `/dashboard/builder` (el listado, no 404) por debajo de `GERENTE` (80).
  - `console.log` de `:69` y `:197` eliminados (volcaban la configuración completa a los logs).
  **Verificación:** e2e de T6 (caso 403 con GERENTE y con EMPLEADO) · `rg "console\.log" "app/api/templates"` vacío.
  **Deps:** T2. **Files:** `app/api/templates/[id]/settings/route.ts`, `app/dashboard/builder/editor/[id]/page.tsx`, `lib/permissions.ts` (solo si hace falta exportar el helper de jerarquía). *Size S.*

- [ ] **T4 — Tabla de frecuencias normativas + validación D1.**
  Nuevo `lib/compliance/frequency-requirements.ts` con el mapa `complianceType → requiredFrequency mínima` y un comparador de frecuencias (`DAILY < WEEKLY < MONTHLY < ANNUAL < ON_DEMAND`). Programar **por encima** del requisito nunca es error.
  **Aceptación:**
  - Cada entrada de la tabla es `{ min, enforce: false, source, reviewedAt: null }` — `enforce` es **por norma** (AD-2), no global.
  - NOM-251 + programación mensual con `enforce: false` → 200 con `{ warnings: ["NOM-251 exige verificación diaria. Este flujo está programado mensual. Valor operativo, no asesoría legal."] }`.
  - Lo mismo con `enforce: true` en esa norma → 422 y **no escribe nada**.
  - NOM-251 + programación diaria o más frecuente → 200 sin warnings.
  - `complianceType: NONE` o laborales (`LFT`/`LSSN`/`INFONAVIT`/`FONACOT`) → sin validación.
  - `COMPLIANCE_FREQ_ENFORCE` existe solo como interruptor de emergencia global (apaga todos los `enforce`), documentado en `.env.example`.
  **Verificación:** test unitario del comparador (los 5 casos de arriba) · `npx tsc --noEmit`.
  **Deps:** T2. **Files:** `lib/compliance/frequency-requirements.ts` (new), `app/api/templates/[id]/settings/route.ts`, `.env.example`. *Size M.*

- [ ] **T5 — Concurrencia optimista en `PATCH /api/templates/[id]`.**
  Hoy dos pestañas se pisan en silencio. Aceptar `expectedUpdatedAt` opcional y comparar contra la fila.
  **Aceptación:**
  - `expectedUpdatedAt` que no coincide → 409 con el `updatedAt` actual en el cuerpo, sin escribir.
  - Petición sin `expectedUpdatedAt` → se comporta como hoy (retro-compatible con el resto de llamadores).
  - La respuesta OK devuelve el `updatedAt` nuevo para que el cliente lo encadene.
  **Verificación:** e2e: dos PATCH con el mismo `expectedUpdatedAt` → el segundo es 409.
  **Deps:** T0. **Files:** `app/api/templates/[id]/route.ts`. *Size S.*

- [ ] **T6 — E2E: round-trip de configuración y 403 de GERENTE.**
  Es el criterio de cierre de la Fase 1 escrito como test, no como esperanza.
  **Aceptación:**
  - Test que guarda Lun/Mié/Vie + 3 turnos + 2 roles + 1 norma desde la UI, recarga y recupera **exactamente** lo mismo.
  - Test que un `GERENTE` mandando `complianceConfig` recibe 403.
  - Ambos corren en el runner existente (Playwright + `tests/auth.setup.ts` + `tests/support/db.ts`).
  **Verificación:** `pnpm test:e2e tests/builder-settings-persistencia.spec.ts`.
  **Deps:** T2, T3. **Files:** `tests/builder-settings-persistencia.spec.ts` (new), `tests/support/db.ts` (si hace falta un fixture de rol). *Size M.*

### Checkpoint 1 (T0–T6)
- [ ] `npx tsc --noEmit` limpio · `pnpm run build` limpio
- [ ] `pnpm db:generate` produce SOLO `ADD COLUMN` (cero `DROP`)
- [ ] Guardar Lun/Mié/Vie + 3 turnos + 2 roles y releer devuelve exactamente lo mismo
- [ ] GERENTE mandando `complianceConfig` → 403 con mensaje accionable
- [ ] `rg "console\.log" "app/api/templates"` vacío
- [ ] Revisar con humano antes de seguir a Fase 4

---

## Fase 2 — Borrador vs. publicado [P0 · paralelizable con Fase 1]

- [ ] **T7 — El autosave escribe un borrador local, no la plantilla viva.**
  `editor-client.tsx:62-71` hace `PATCH` cada 3 s sobre una plantilla de N sucursales. Pasa a `localStorage` (`pulso:builder-draft:${userId}:${templateId}`, con `updatedAt`), **cero red**. Al abrir, si el borrador es más nuevo que `template.updatedAt`, ofrecer retomar o descartar. El toast de error (`:111-113`) deja de dispararse en autosave.
  **Aceptación:**
  - Con la red caída, editar 2 minutos → cero peticiones en la pestaña Network y cero toasts.
  - Recargar con borrador más nuevo → diálogo *"Tienes cambios sin publicar de hace X. ¿Retomar o descartar?"*.
  - Fallo de red al publicar → banner persistente *"Sin conexión — tus cambios están guardados localmente"*, no un toast por intento.
  - Clave por `userId` (AD-5): en un dispositivo compartido de sucursal, el borrador de un usuario **no** aparece en la sesión del siguiente.
  - Purga al publicar + TTL de 7 días + tope de ~5 borradores (cuota de `localStorage` vs. JSON de pasos).
  **Verificación:** manual con DevTools offline · e2e opcional con `context.setOffline(true)`.
  **Deps:** T0. **Files:** `app/dashboard/builder/editor/[id]/editor-client.tsx`, `lib/hooks/use-workflow-draft.ts` (new). *Size M.*

- [ ] **T8 — `Guardar` → `Publicar cambios`, con confirmación por alcance real.**
  El diálogo de salida (`:206-224`) hoy no revierte nada y el estado del header dice "Guardado" sin serlo.
  **Aceptación:**
  - Botón `Publicar cambios` + `AlertDialog` cuyo cuerpo se calcula del alcance real: playbook corporativo → *"Publicar cambiará el checklist de N sucursales a partir de la próxima ejecución"* con el N verdadero; plantilla local → confirmación ligera.
  - Header con tres estados reales: `Borrador local · sin publicar` / `Publicando…` / `Publicado hace 2 min` (relativo vivo). Desaparece el "Guardado" ambiguo.
  - El diálogo de salida descarta el borrador de verdad, o se llama `Descartar borrador y salir`.
  - El publish manda `expectedUpdatedAt` (T5) y maneja el 409 con un mensaje que ofrece recargar.
  **Verificación:** manual sobre un playbook publicado a ≥2 sucursales (el conteo debe coincidir con `PlaybookService.listPublished`).
  **Deps:** T5, T7. **Files:** `editor-client.tsx`, `app/dashboard/builder/editor/[id]/page.tsx` (bajar scope + conteo de sucursales como prop). *Size M.*

- [ ] **T9 — `version` se incrementa en el servidor al publicar.**
  Hoy el usuario teclea la versión a mano en `workflow-settings-modal.tsx:473`.
  **Aceptación:**
  - Publicar incrementa `version` en el servidor; el cliente no la manda.
  - El `<Input type="number">` de versión se vuelve texto de solo lectura con la versión actual.
  - `POST /settings` ignora (o rechaza, coherente con T3) un `version` entrante.
  **Verificación:** publicar dos veces → `version` sube de 1 a 3 nunca; sube exactamente 1 por publicación.
  **Deps:** T8. **Files:** `app/api/templates/[id]/route.ts`, `components/builder/workflow-settings-modal.tsx`. *Size S.*

### Checkpoint 2 (T7–T9)
- [ ] Con la red caída, editar 2 minutos: cero toasts, cero peticiones
- [ ] Recargar recupera el borrador y ofrece retomar/descartar
- [ ] Publicar un playbook corporativo exige confirmación que nombra el número de sucursales
- [ ] Dos pestañas publicando la misma plantilla → la segunda recibe 409, no pisa

---

## Fase 3 — Bugs de ejecución [P0/P1]

- [ ] **T10 — `<SelectItem value="">` revienta en runtime.** *(hazlo hoy)*
  `property-editor.tsx:393` — Radix lanza al montar un `SelectItem` con `value=""`. **Está en la ruta de la función estrella (verificación IA).** Mismo patrón en `components/inventory/receiving-form.tsx:152`.
  **Aceptación:** centinela `__none__` mapeado a `undefined` en `onValueChange` (`:385`) y de vuelta en `value` (`:384`); ambos archivos corregidos; seleccionar el paso de verificación IA no lanza en consola.
  **Verificación:** manual — abrir un paso IA y un formulario de recepción; consola limpia.
  **Deps:** T0. **Files:** `components/builder/property-editor.tsx`, `components/inventory/receiving-form.tsx`. *Size XS.*

- [ ] **T11 — Toolbox recortado y scrollbar permanente.** *(hazlo hoy)*
  `toolbox.tsx:30` no tiene `overflow-y-auto` ni `shrink-0` dentro de `flex flex-1 overflow-hidden`: en 1366×768 se pierden Ubicación GPS, Temporizador, Video y Audio. `editor-client.tsx:253` usa `h-[calc(100vh-4rem)]` ignorando el `p-4 pt-0` del layout.
  **Aceptación:** toolbox `w-64 shrink-0 border-r flex flex-col` con hijo `flex-1 overflow-y-auto p-4`; editor a `h-full min-h-0` + `min-h-0` en la fila flex de `:255`; a 1366×768 las 14 herramientas son alcanzables y no hay scrollbar de página.
  **Verificación:** manual a 1366×768 y 1920×1080.
  **Deps:** T0. **Files:** `components/builder/toolbox.tsx`, `editor-client.tsx`. *Size XS.*

- [ ] **T12 — Atajos de teclado y selección que sobrevive al undo.**
  `editor-client.tsx:74-92` no revisa `e.target`: Ctrl+Z dentro de un input deshace pasos en vez de texto. `builder-context.tsx:162,174` limpia `selectedStepId` en undo/redo y el panel desaparece a media edición.
  **Aceptación:** early-return para `input`/`textarea`/`[contenteditable]` excepto Ctrl+S; undo/redo conservan la selección si el paso sigue existiendo (si no, seleccionan `null`).
  **Verificación:** manual — escribir en el título de un paso, Ctrl+Z deshace letras; deshacer un movimiento de paso mantiene el panel abierto.
  **Deps:** T0. **Files:** `editor-client.tsx`, `components/builder/builder-context.tsx`. *Size S.*

- [ ] **T13 — Coalescer el historial de texto.**
  `builder-context.tsx:207-210` empuja historial en cada `onChange`: 40 caracteres vacían los 50 slots.
  **Aceptación:** mutaciones de texto coalescidas (~500 ms de inactividad o flag `transient`); escribir una frase de 40 caracteres consume 1 slot, no 40; deshacer después de escribir devuelve el estado previo a la frase completa.
  **Verificación:** manual con el contador de historial · comprobar que `canUndo` sigue apuntando al paso anterior real.
  **Deps:** T0. **Files:** `components/builder/builder-context.tsx`. *Size S.*

- [ ] **T14 — `NaN` silencioso en los campos numéricos.**
  `parseFloat`/`parseInt` sobre input vacío escriben `NaN`, que se serializa a `null` y **desactiva en silencio la validación que el usuario creyó configurar**. 11 sitios.
  **Aceptación:** helper `parseNumberOrUndefined` en `lib/utils.ts` (o `lib/workflow-type-map.ts`, donde encaje); los 11 sitios migrados — `property-editor.tsx:185,194,263,367,734`, `workflow-settings-modal.tsx:473,546`, `escalation-section.tsx:119`, `remediation-section.tsx:91,100,139`; vaciar un campo deja `undefined`, nunca `NaN`.
  **Verificación:** `rg "parseFloat|parseInt" components/builder` sin resultados crudos · manual: vaciar el mínimo de un campo numérico y guardar → la regla desaparece explícitamente, no en silencio.
  **Deps:** T0. **Files:** `lib/utils.ts`, `property-editor.tsx`, `workflow-settings-modal.tsx`, `escalation-section.tsx`, `remediation-section.tsx`. *Size M.*

- [ ] **T15 — `removeStep` deja referencias colgadas.**
  `builder-context.tsx:212-216` borra el paso pero deja `branches[].targetStepId` y `conditionalLogic.fieldId` apuntando a UUIDs muertos. El `AlertDialog` de `property-editor.tsx:59-62` afirma que solo afecta a ese paso.
  **Aceptación:** al borrar, se detectan las referencias entrantes y el diálogo las nombra (*"3 ramas de otros 2 pasos apuntan aquí"*); tras confirmar, ninguna referencia queda apuntando a un id inexistente.
  **Verificación:** manual — crear A con rama a B, borrar B, confirmar que el diálogo lo avisa y que A queda sin destino colgado.
  **Deps:** T0. **Files:** `components/builder/builder-context.tsx`, `components/builder/property-editor.tsx`. *Size M.*

- [ ] **T16 — Condiciones de rama por id estable de opción.** *(riesgo de datos — ver plan)*
  `property-editor.tsx:477` incrusta el string de la opción (`valor == '${opt}'`) y `:570` indexa las opciones por `idx`: renombrar una opción rompe todas sus ramas en silencio y un apóstrofo rompe la condición.
  **Aceptación:** las opciones llevan id estable y las condiciones lo referencian; renombrar una opción conserva sus ramas; una opción con apóstrofo no rompe la condición; una plantilla legacy con condiciones por string se resuelve por texto una vez y se reescribe a id (retro-compatible).
  **Verificación:** e2e o manual con una plantilla legacy guardada antes del cambio · script de backfill si hay plantillas en producción con ramas.
  **Deps:** T0. **Files:** `components/builder/property-editor.tsx`, `components/builder/builder-context.tsx`, `lib/workflow-type-map.ts`. *Size M.*

- [ ] **T17 — Arreglos de la vista previa.**
  `workflow-preview-modal.tsx:459` usa `flex-2` (no existe en Tailwind); `:341` el progreso nunca llega a 100%; `:404` botón vacío de 6×6 px.
  **Aceptación:** clase de Tailwind válida; completar todos los pasos muestra 100%; el botón vacío se elimina o recibe contenido + `aria-label`.
  **Verificación:** manual — recorrer la vista previa hasta el final.
  **Deps:** T0. **Files:** `components/builder/workflow-preview-modal.tsx`. *Size S.*

### Checkpoint 3 (T10–T17)
- [ ] Seleccionar el paso de verificación IA no revienta (consola limpia)
- [ ] A 1366×768 las 14 herramientas del toolbox son alcanzables
- [ ] Ctrl+Z dentro de un input deshace texto, no pasos
- [ ] Vaciar un campo numérico deja el valor sin definir, nunca `NaN`
- [ ] Borrar un paso referenciado avisa de las ramas afectadas

---

## Fase 4 — Reestructurar el modal de Configuración [P1]

> Requiere Checkpoint 1: sin persistencia real, esta fase es maquillaje sobre campos muertos.

- [ ] **T18 — Una sola fuente de defaults + estado de error en la carga.** *(antes de partir el archivo)*
  `loadSettings()` (`:229-233`) y el efecto de `initialSettings` (`:236-272`) escriben el mismo estado sin coordinarse y sus defaults **no coinciden**: `selectedDays` tiene tres valores iniciales distintos (`:209`, `:262`, `:298`) y `shiftTimes` dos horarios distintos. Y `catch { console.error }` (`:320-322`) deja un formulario con defaults que parecen guardados — publicarlo **sobrescribe la configuración real**.
  **Aceptación:**
  - Una constante compartida de defaults; `initialSettings` manda en el primer render y el fetch es refresco explícito. `selectedDays` y `shiftTimes` tienen un único valor inicial.
  - Fallo de carga → mensaje + botón Reintentar (patrón de `playbook-scope-section.tsx:160-166`) y `Guardar` **deshabilitado** hasta carga confirmada.
  - `enabled` presente en la interfaz `initialSettings` (`:32-48`): si el fetch falla, ya no dice "activado" por defecto.
  **Verificación:** manual con el endpoint forzado a 500 → no hay forma de guardar encima de la config real.
  **Deps:** T2. **Files:** `components/builder/workflow-settings-modal.tsx`. *Size M.*

- [ ] **T19 — Extraer las secciones a `components/builder/settings/`.**
  941 líneas en un archivo. `compliance-tab.tsx`, `schedule-tab.tsx`, `actions-tab.tsx`, `scope-tab.tsx`, `advanced-tab.tsx`; el archivo actual queda como shell + estado.
  **Aceptación:** cinco componentes nuevos con props tipadas (sin `any` nuevo); `workflow-settings-modal.tsx` por debajo de ~300 líneas; comportamiento idéntico al de antes (refactor puro, cero cambios funcionales en este commit).
  **Verificación:** `npx tsc --noEmit` · e2e de T6 sigue verde.
  **Deps:** T18. **Files:** `components/builder/settings/*.tsx` (5 new), `workflow-settings-modal.tsx`. *Size L → partir en T19a (compliance+schedule) y T19b (actions+scope+advanced) si se pasa de 5 archivos por commit.*

- [ ] **T20 — `Tabs` + footer fijo (D2).**
  **Aceptación:**
  - Pestañas en orden Cumplimiento → Programación → Acciones → Alcance → Avanzado; Cumplimiento abre primero; la configuración de IA baja a Avanzado.
  - `DialogFooter` `sticky bottom-0 bg-background border-t`, **fuera** del `overflow-y-auto`.
  - Visibilidad por rol (D3): ADMIN+ ve todo; GERENTE solo Programación y Acciones y solo si la plantilla no es playbook corporativo. El rol baja como prop desde `page.tsx` (Server Component).
  **Verificación:** manual con sesión ADMIN y sesión GERENTE · el footer es visible sin scroll en las cinco pestañas a 1366×768.
  **Deps:** T19, T3 (mismo criterio de rol que el servidor). **Files:** `workflow-settings-modal.tsx`, `editor-client.tsx`, `page.tsx`. *Size M.*

- [ ] **T21 — Un solo guardado + rotular los dos alcances.**
  `PlaybookScopeSection` guarda por su cuenta (`:236`) mientras el modal guarda aparte: dos botones. Y el schedule se guarda con `branchId = user.branchId` (`settings/route.ts:184`) — un ADMIN define el alcance para 12 sucursales y dos pulgadas más abajo programa un horario **que solo aplica a la suya**, sin una palabra que lo distinga.
  **Aceptación:**
  - `PlaybookScopeSection` sin botón propio; expone su estado hacia arriba; `handleSave` guarda ambos endpoints en secuencia con un solo estado de carga.
  - Fallo parcial (settings OK, scope falla) → el modal no se cierra y el error nombra qué parte falló.
  - El bloque de Programación lleva el rótulo *"Programación de esta sucursal"* frente al alcance corporativo del playbook.
  **Verificación:** manual — guardar con el endpoint de scope forzado a 500 y comprobar el mensaje; guardado feliz escribe ambos.
  **Deps:** T20. **Files:** `workflow-settings-modal.tsx`, `components/builder/playbook-scope-section.tsx`, `components/builder/settings/scope-tab.tsx`. *Size M.*

- [ ] **T22 — Cancelar, naming y densidad.**
  **Aceptación:**
  - Cancelar (`:922`) hace dirty-check contra un snapshot inicial y confirma antes de descartar ~40 campos.
  - `activo` → **"Plantilla activa"** (`workflowTemplates.active`) y `enabled` → **"Ejecución automática programada"** (`schedule.isActive`), cada uno con su línea de consecuencia. No son duplicados.
  - `grid-cols-4` de `:470` → `grid-cols-2`; íconos en las 9 cabeceras o en ninguna (hoy 3 de 9).
  **Verificación:** manual a 672 px de ancho de diálogo — ninguna columna por debajo de ~300 px.
  **Deps:** T20. **Files:** `workflow-settings-modal.tsx`, `components/builder/settings/*.tsx`. *Size S.*

- [ ] **T23 — Los disparadores no se pueden configurar.**
  `addTrigger` (`:401-405`) crea `conditions: {}` y no hay UI para editarlas: agregas "Temperatura Crítica" sin umbral ni sensor.
  **Aceptación:** o se implementa el editor de condiciones (campo + operador + valor, persistido en `conditions`), o el disparador se marca visiblemente como *"sin condiciones — se dispara siempre"*. Decidir una y que la UI no mienta.
  **Verificación:** manual — crear un disparador y comprobar que lo que dice la tarjeta coincide con lo que se guarda en `event_triggers`.
  **Deps:** T20. **Files:** `components/builder/settings/actions-tab.tsx`, `app/api/templates/[id]/settings/route.ts` (si se persiste el shape nuevo). *Size M.*

- [ ] **T24 — Agrupar las listas largas.**
  Como ya se hace bien en `:616-629`.
  **Aceptación:** `SelectGroup`/`SelectLabel` en Tipo de Cumplimiento (12), Sección Regulatoria (13), operadores condicionales (7) y acciones de paso (18, `property-editor.tsx:874`).
  **Verificación:** manual — ninguna lista de más de ~8 entradas sin agrupar.
  **Deps:** T20. **Files:** `components/builder/settings/compliance-tab.tsx`, `property-editor.tsx`. *Size S.*

---

## Fase 5 — El Resumen se vuelve la confirmación real [P1]

- [ ] **T25 — Contenido del Resumen.**
  Hoy (`:900-918`) cubre el ~20% de lo configurado y lo hace en inglés: `los ${selectedDays.join(', ')}` imprime *"los monday, tuesday"* (`:904`) y `at` sigue sin traducir (`:913`).
  **Aceptación:**
  - Días mapeados por `DAYS_OF_WEEK` (`:96-104`); `at` → `a las`. Cero inglés en el bloque.
  - Incluye norma y sección, si es auditable/crítico, cuántas acciones al completar, cuántos disparadores y **el alcance** (*"Playbook corporativo · 12 sucursales"* vs *"Plantilla local"*).
  - Muestra la comparación D1: *"NOM-251 exige diario · programado diario ✓"* (y en rojo cuando no cumple).
  **Verificación:** manual con una plantilla NOM-251 programada mensual y otra diaria.
  **Deps:** T4 (la comparación), T20. **Files:** `components/builder/settings/*.tsx` o `workflow-settings-modal.tsx`. *Size M.*

- [ ] **T26 — El Resumen al footer fijo.**
  Es el bloque que tranquiliza antes de comprometerse; hoy hay que hacer scroll por nueve secciones para verlo.
  **Aceptación:** el Resumen vive en el footer fijo junto al botón, visible desde cualquier pestaña, sin empujar el contenido ni tapar controles a 768 px de alto.
  **Verificación:** manual a 1366×768 en las cinco pestañas.
  **Deps:** T25. **Files:** `workflow-settings-modal.tsx`. *Size S.*

### Checkpoint 4 (T18–T26)
- [ ] Un solo botón de guardado; `PlaybookScopeSection` ya no guarda por su cuenta
- [ ] Fallo de carga → mensaje + reintento con `Guardar` deshabilitado
- [ ] El Resumen está en español, visible sin scroll, y nombra alcance y norma
- [ ] e2e de T6 sigue verde tras el refactor

---

## Fase 6 — Idioma y densidad [P2]

- [ ] **T27 — `STEP_TYPE_DISPLAY_ES`.**
  `lib/workflow-type-map.ts:96-125` es 100% inglés y es la etiqueta principal de cada tarjeta. Y `builder-context.tsx:198` genera *"Nuevo paso de OPSLocationField"* — un nombre de clase interno dentro de una frase en español.
  **Aceptación:** `STEP_TYPE_DISPLAY_ES` espejo de `toolbox.tsx:9-24`, usado en `sortable-step.tsx:62` y `property-editor.tsx:50,396,512,633`; los pasos nuevos se llaman `Nuevo ${STEP_TYPE_DISPLAY_ES[type]}` (de paso, tres pasos nuevos dejan de verse idénticos en el desplegable de destinos de rama).
  **Verificación:** `rg "STEP_TYPE_DISPLAY\b" components/builder` solo donde deba quedar · manual: crear 3 pasos y abrir el selector de destino.
  **Deps:** T0. **Files:** `lib/workflow-type-map.ts`, `builder-context.tsx`, `sortable-step.tsx`, `property-editor.tsx`. *Size S.*

- [ ] **T28 — `ROLES` compartido + el badge deja de gritar.**
  `escalation-section.tsx:16` renderiza enums crudos (`EMPLEADO`, `OWNER`) mientras `workflow-settings-modal.tsx:106-112` mapea los mismos a español. Y el badge `text-xs uppercase tracking-wider` de `sortable-step.tsx:61` pesa más que el título del paso — es el patrón "eyebrow" prohibido en DESIGN.md, repetido una vez por fila.
  **Aceptación:** una sola constante `ROLES` compartida; el badge baja a metadato secundario (el título del paso es el elemento dominante de la fila).
  **Verificación:** `node .claude/skills/impeccable/scripts/detect.mjs components/builder` en 0 · manual.
  **Deps:** T27. **Files:** `lib/permissions.ts` o `lib/workflow-type-map.ts`, `escalation-section.tsx`, `workflow-settings-modal.tsx`, `sortable-step.tsx`. *Size S.*

- [ ] **T29 — Accordion en `property-editor.tsx`.**
  10 secciones expandidas a la vez en 320 px de ancho.
  **Aceptación:** accordion abierto solo en "Básico" y en las secciones que ya tienen datos (`step.branches?.length`, `logicRules?.length`, `actions?.length`, `conditionalLogic`); el estado de apertura sobrevive al cambio de paso seleccionado.
  **Verificación:** manual con un paso vacío y con un paso con ramas + lógica.
  **Deps:** T27. **Files:** `components/builder/property-editor.tsx`. *Size M.*

- [ ] **T30 — Toolbox con categorías y filtro.**
  14 botones planos sin búsqueda.
  **Aceptación:** grupos Entrada · Evidencia · Ubicación y tiempo · Control, más filtro por texto que reduce en vivo; con el toolbox filtrado, arrastrar sigue funcionando.
  **Verificación:** manual a 1366×768 (junto con T11).
  **Deps:** T11. **Files:** `components/builder/toolbox.tsx`. *Size M.*

- [ ] **T31 — Normalización de esquema fuera del componente de ruta.**
  `page.tsx:37-85` reconcilia cuatro generaciones de esquema en tiempo de render, con fallback `'Untitled Step'` en inglés.
  **Aceptación:** la reconciliación vive en una función pura en `lib/workflow-type-map.ts` (o `lib/workflows/normalize-template.ts`), con test unitario de las cuatro formas legacy; `page.tsx` queda en carga + render; fallback en español.
  **Verificación:** test unitario con una plantilla de cada generación · abrir una plantilla legacy real.
  **Deps:** T8 (ambos tocan `page.tsx`). **Files:** `lib/workflows/normalize-template.ts` (new), `page.tsx`. *Size M.*

---

## Fase 7 — Accesibilidad [P1]

> Medido: 74 de 80 `<Label>` sin `htmlFor`; 98 controles sin `id` ni `aria-label`; un solo `aria-label` en todo el subárbol.

- [ ] **T32 — Seleccionar un paso con teclado.**
  `sortable-step.tsx:37` es un `<Card onClick>` sin `tabIndex`, `role` ni `onKeyDown`: **la puerta de entrada a toda la edición es solo-ratón**. El asa de arrastre (`:47`) es focusable pero `opacity-0`: se tabula a un control invisible. Y el lienzo (`canvas.tsx:36`) solo deselecciona con clic.
  **Aceptación:** el paso es `<button>` o tiene `role="button" tabIndex={0} onKeyDown` (Enter/Espacio); el asa aparece con `focus-within:opacity-100`; Escape deselecciona en el lienzo.
  **Verificación:** recorrer selección → edición → configuración solo con teclado.
  **Deps:** T28. **Files:** `sortable-step.tsx`, `canvas.tsx`. *Size S.*

- [ ] **T33 — Nombres accesibles en botones solo-ícono y pills.**
  **Aceptación:** `aria-label` en los 7 botones sin nombre — `editor-client.tsx:130`, `property-editor.tsx:53,582`, `logic-rule-card.tsx:35`, `workflow-settings-modal.tsx:869`, `workflow-preview-modal.tsx:184,404`; patrón `type="button"` + `aria-pressed` de `playbook-scope-section.tsx:174` aplicado a `workflow-settings-modal.tsx:493,506,761,793,817` y `escalation-section.tsx:147`.
  **Verificación:** recorrido con lector de pantalla o axe DevTools: cero controles sin nombre en el subárbol.
  **Deps:** T20 (los pills se movieron a las pestañas). **Files:** los 6 archivos listados. *Size M.*

- [ ] **T34 — `htmlFor`/`id` en `property-editor.tsx` (40 controles).**
  **Aceptación:** cada `<Label>` apunta a su control por `htmlFor`/`id` (o el control lleva `aria-label` cuando no hay label visible); ids únicos por paso (prefijo con `step.id`).
  **Verificación:** axe sin violaciones de `label` en el panel de propiedades.
  **Deps:** T29. **Files:** `components/builder/property-editor.tsx`. *Size M.*

- [ ] **T35 — `htmlFor`/`id` en el modal de configuración (26 controles) + título del flujo.**
  Incluye el input de título (`editor-client.tsx:140`), que hoy solo tiene placeholder.
  **Aceptación:** pares `htmlFor`/`id` en las cinco pestañas; el título del flujo tiene label accesible.
  **Verificación:** axe sin violaciones de `label` en el modal.
  **Deps:** T19. **Files:** `components/builder/settings/*.tsx`, `editor-client.tsx`. *Size M.*

- [ ] **T36 — Colapsables, severidad y Radix decorativo.**
  **Aceptación:**
  - `aria-expanded`/`aria-controls` en los tres colapsables (`logic-rule-card.tsx:27`, `remediation-section.tsx:75`, `escalation-section.tsx:75`) y su `expanded` inicial unificado (hoy dos abiertos, uno cerrado).
  - `logic-rule-card.tsx:79-82`: la severidad deja de ser emoji (un lector anuncia "círculo rojo" para CRÍTICO) → ícono Lucide + token semántico.
  - `workflow-preview-modal.tsx:305,325`: el `Checkbox` y el `Separator` de Radix usados como íconos decorativos salen de la cabecera del paso.
  **Verificación:** lector de pantalla sobre una regla CRÍTICA y sobre la cabecera de un paso en vista previa.
  **Deps:** T33. **Files:** `logic-rule-card.tsx`, `remediation-section.tsx`, `escalation-section.tsx`, `workflow-preview-modal.tsx`. *Size M.*

---

## Fase 8 — Sistema de diseño [P2]

- [ ] **T37 — El mapa de íconos de 49 entradas.**
  `workflow-preview-modal.tsx:283-331` usa **7 tonos** de paleta cruda de Tailwind (orange/blue/purple/green/red/indigo/pink). `detect.mjs` no lo ve porque solo dispara con hex literales. Es la anti-referencia "generic SaaS" y consume el presupuesto de color que DESIGN.md reserva a Rojo Operacional (10-15%).
  **Aceptación:** un ícono por familia de paso; el color se usa **solo por estado** (pendiente/completado/error), no por tipo; el Rojo Operacional se mantiene dentro de su presupuesto.
  **Verificación:** `detect.mjs components/builder` en 0 · revisión visual contra DESIGN.md.
  **Deps:** T17. **Files:** `components/builder/workflow-preview-modal.tsx`. *Size M.*

- [ ] **T38 — Tokens semánticos en lugar de color crudo.**
  **Aceptación:** `workflow-preview-modal.tsx:68,107,113,185` y `workflow-settings-modal.tsx:862` (`text-yellow-500`) usan tokens; `editor-client.tsx:197` — el Rojo Operacional sobre un ícono dentro de un botón ya rojo no produce ningún cambio visible: se elimina el condicional o se le da un efecto real.
  **Verificación:** `detect.mjs components/builder` en 0 · revisión en tema claro y oscuro.
  **Deps:** T37. **Files:** `workflow-preview-modal.tsx`, `workflow-settings-modal.tsx`, `editor-client.tsx`. *Size S.*

- [ ] **T39 — `confirm()` nativo → `AlertDialog`.**
  `template-manager.tsx:148` usa `confirm()` para **borrar plantillas** mientras el editor usa `AlertDialog` para borrar un paso: dos idiomas de confirmación, y el nativo protege la acción más destructiva.
  **Aceptación:** borrar plantilla usa `AlertDialog` con el nombre de la plantilla en el cuerpo; cero `confirm()`/`alert()` en el subárbol.
  **Verificación:** `rg "\bconfirm\(|\balert\(" components/builder components/templates` vacío · manual.
  **Deps:** T0. **Files:** `components/.../template-manager.tsx`. *Size S.*

---

## Checkpoint final (criterio de cierre)

- [ ] `npx tsc --noEmit` limpio · `pnpm run build` limpio · `pnpm lint` sin errores nuevos
- [ ] `node .claude/skills/impeccable/scripts/detect.mjs components/builder` en 0
- [ ] Guardar Lun/Mié/Vie + 3 turnos + 2 roles y releer devuelve exactamente lo mismo
- [ ] Publicar un playbook corporativo exige confirmación que nombra el número de sucursales
- [ ] Editar sin conexión durante 2 minutos: cero toasts, cero peticiones, borrador recuperable
- [ ] Flujo completo (seleccionar paso → editar → configurar → publicar) navegable solo con teclado
- [ ] `pnpm test:e2e` verde
- [ ] `/impeccable critique app/dashboard/builder/editor/[id]` → **30+/40**

## Preguntas abiertas

Q1, Q3, Q4 y Q5 quedaron resueltas como decisiones técnicas (AD-4, AD-9, AD-5, AD-8 en el plan) y ya están incorporadas a T1/T2, T3, T7 y a la Fase 4. Queda una:

- **Q2 — Valores de la tabla de frecuencias.** Confirmar norma por norma con el consultor de cumplimiento. **No bloquea T4**: se implementa con `enforce: false` por norma y warning que declara "valor operativo, no asesoría legal". Cada norma pasa a `enforce: true` con su `source` y `reviewedAt` cuando la confirmen. *Condiciona el momento de activar el bloqueo, no el código.*
