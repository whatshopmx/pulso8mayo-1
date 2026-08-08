# Plan v2: Editor de Flujos — corrección de crítica

**Target:** `app/dashboard/builder/editor/[id]/` + `components/builder/` + `app/api/templates/[id]/`
**Crítica:** 15/40 (Poor) — 2026-08-07 · anterior: 20/40 (2026-07-22)
**Objetivo:** 30+/40
**Estado:** 📋 Propuesto

---

## 0. Contexto: por qué bajó de 20 a 15

El plan v1 (`builder-critique-fix-plan.md`, cerrado 2026-07-22) resolvió color, localización parcial y a11y de la vista previa. Su **Fase 6 introdujo el P0 actual**: autosave con debounce contra `PATCH /api/templates/[id]`, sin estado de borrador. Se agregó la máquina sin decidir la política. Este plan cierra esa decisión primero.

---

## 1. Las tres decisiones (resueltas)

### D1 — La frecuencia normativa manda sobre la programada

**Pregunta:** si el sistema conoce la frecuencia que exige la norma y la frecuencia programada, ¿por qué el usuario es responsable de que coincidan?

**Decisión:** no lo es. `complianceConfig.requiredFrequency` pasa a ser **la fuente de verdad**; `frequency` (programación) se valida contra ella.

- Al elegir un `complianceType`, la `requiredFrequency` de esa norma se precarga y la programación se ajusta al default compatible.
- Si el usuario programa por debajo del requisito, se bloquea el guardado con mensaje explícito: *"NOM-251 exige verificación diaria. Este flujo está programado mensual."*
- Programar **por encima** del requisito se permite sin fricción (cumplir de más nunca es error).
- La validación vive en `app/api/templates/[id]/settings/route.ts`, no solo en el cliente — es una invariante de negocio, no una cortesía de UI.
- La regla aparece en el Resumen antes de guardar, no solo al fallar.

**Tabla mínima de requisitos** (nueva, en `lib/compliance/frequency-requirements.ts`):

| complianceType | requiredFrequency mínima |
|---|---|
| `NOM_251` | `DAILY` |
| `NOM_035` | `ANNUAL` |
| `NOM_030`, `NOM_019`, `NOM_017` | `MONTHLY` |
| `LFT`, `LSSN`, `INFONAVIT`, `FONACOT` | `ON_DEMAND` (sin mínimo) |
| `NONE` | sin validación |

> Los valores son un punto de partida operativo, no asesoría legal. Confirmar con el consultor de cumplimiento antes de bloquear guardados en producción; hasta entonces, la validación advierte en vez de bloquear (bandera `COMPLIANCE_FREQ_ENFORCE`).

---

### D2 — No debería ser un modal. Pestañas ahora, ruta propia después

**Pregunta:** ¿nueve secciones y ~40 controles con dos botones de guardado son un diálogo?

**Decisión:** no. Pero migrar a ruta propia arrastra el estado del editor, así que se hace en dos tiempos.

**Ahora (Fase 4):** el `Dialog` se conserva como contenedor, pero por dentro se reestructura con `Tabs`, footer fijo y **un solo guardado**:

| Pestaña | Contenido | Quién la ve |
|---|---|---|
| **Cumplimiento** | complianceType, regulationSection, requiredFrequency, auditable, evidenceRequired, criticalForCompliance, pills NOM | ADMIN+ |
| **Programación** | frequency, días, turnos + horas, autoAssign, roles | GERENTE+ |
| **Acciones** | completionActions, disparadores de eventos | GERENTE+ |
| **Alcance** | `PlaybookScopeSection` | ADMIN+ |
| **Avanzado** | versión, duración, etiquetas, aiConfig | ADMIN+, colapsado |

Cumplimiento abre primero. La configuración de IA sale de la posición 3 y baja a Avanzado.

- `DialogFooter` fijo (`sticky bottom-0 bg-background border-t`), fuera del `overflow-y-auto`.
- **Un solo botón de guardar.** `PlaybookScopeSection` deja de guardar por su cuenta y se integra al `handleSave` del modal (ver Fase 4.3).
- Cancelar hace dirty-check contra un snapshot inicial y confirma antes de descartar.

**Después (fuera de este plan):** `app/dashboard/builder/editor/[id]/configuracion/page.tsx` como segmento paralelo, con las mismas pestañas. Se evalúa cuando las pestañas estén estables.

---

### D3 — Es la herramienta del dueño. El gerente ve un subconjunto

**Pregunta:** ¿qué debería ver un gerente comparado con un dueño?

**Decisión:** el editor es del **OWNER/ADMIN**. El gerente solo ajusta la ejecución local, nunca el contenido normativo.

`session.user.role` ya existe (`app/dashboard/layout.tsx:53`: `SUPER_ADMIN | ADMIN | GERENTE | SUPERVISOR | EMPLEADO | READONLY`). `page.tsx` es Server Component, así que baja el rol como prop hasta `WorkflowSettingsModal`.

| Rol | Puede |
|---|---|
| SUPER_ADMIN, ADMIN | Todo: pasos, cumplimiento, alcance, avanzado |
| GERENTE | Solo Programación y Acciones, **solo si la plantilla no es playbook corporativo**. Sin editar pasos. |
| SUPERVISOR, EMPLEADO, READONLY | Sin acceso al editor (redirección) |

**Y el mismo gate va en el servidor.** Hoy `POST /api/templates/[id]/settings` (`route.ts:173-194`) solo verifica que exista sesión y `branchId` — cualquier usuario autenticado puede reescribir el `complianceConfig` de un playbook corporativo. Eso se cierra en la Fase 1.

**Corolario que salió del código:** el schedule se guarda con `branchId = user.branchId` (`route.ts:184`). Es decir, un ADMIN edita el alcance de un playbook para 12 sucursales en `PlaybookScopeSection`, y dos pulgadas más abajo programa un horario **que solo aplica a su propia sucursal**. Dos modelos de alcance en un mismo modal, sin una sola palabra que lo distinga. Se resuelve en la Fase 4.3.

---

## 2. El hallazgo que reordena todo: pérdida silenciosa de datos

Verificado en `app/api/templates/[id]/settings/route.ts`. **Cinco controles del modal no persisten**, o persisten truncados, sin ningún aviso al usuario:

| Control (UI) | Qué pasa realmente | Evidencia |
|---|---|---|
| **Turnos Asignados** (`:807-844`) | `assignedShifts` se acepta en el schema pero **nunca se escribe**; GET devuelve `[]` fijo cuando existe schedule | `route.ts:19`, `:224-236`, `:147` |
| **Días de la Semana** (`:759-772`) | Se guarda **solo el primer día** — `dayOfWeek` es un entero. Eliges Lun/Mié/Vie, guardas, quedan Lunes | `route.ts:221`, `:143-145` |
| **Roles Asignados** (`:791-804`) | Se guarda **solo el primer rol** — `assignedRole` es escalar | `route.ts:228`, `:146` |
| **Estándares NOM** (`:492-498`) | `cumplimientoNormativo` nunca se escribe; GET devuelve `[]` con el comentario *"Stored separately if needed"* | `route.ts:86` |
| **Requiere IA** (`:484-485`) | `requiereIA` no tiene columna; GET devuelve `false` siempre | `route.ts:84` |

Esto no es un problema de diseño visual. Es **un producto de cumplimiento perdiendo la configuración de cumplimiento en silencio**. Cualquier trabajo de UI sobre estos controles antes de arreglar la persistencia es maquillaje sobre un campo muerto — por eso la Fase 1 va antes que la Fase 4.

Adicional: `console.log('[API] Saving schedule settings...', data)` (`route.ts:197`) vuelca la configuración completa a los logs del servidor.

---

## Fase 0 — Limpieza previa (bloquea todo lo demás)

**Motivo:** `components/builder/` tiene **dos implementaciones paralelas del builder**. Sin borrar la muerta, cada corrección corre el riesgo de aterrizar en el archivo equivocado.

- [ ] Borrar `builder-canvas.tsx`, `builder-header.tsx`, `builder-properties.tsx`, `builder-toolkit.tsx` — cero referencias en todo el repo (verificado). Ahí viven todas las violaciones de `shadow-` del subárbol.
- [ ] Limpiar imports muertos en `canvas.tsx:9-20` (`Card`, `CardHeader`, `CardTitle`, `cn`, `GripVertical`, `STEP_TYPE_DISPLAY`).
- [ ] Eliminar la declaración duplicada de `WorkflowPreviewModalProps` (`workflow-preview-modal.tsx:24-36`).

**Aceptación:** `npx tsc --noEmit` limpio; `detect.mjs components/builder` sigue en 0.

---

## Fase 1 — Backend: persistencia real y autorización [P0]

**Archivos:** `app/api/templates/[id]/settings/route.ts`, `app/api/templates/[id]/route.ts`, migración Drizzle.

- [ ] **1.1** Migración: `workflow_schedules.assigned_shifts` (jsonb), `assigned_roles` (jsonb), `days_of_week` (jsonb). Migrar `dayOfWeek`/`assignedRole` escalares al array en el mismo `up`; conservar las columnas viejas un ciclo para rollback.
- [ ] **1.2** Migración: `workflow_templates.cumplimiento_normativo` (jsonb, default `[]`) y `requiere_ia` (boolean, default false). O derivar `requiereIA` de `aiConfig != null` y **quitar el switch de la UI** — decidir una y documentarla; hoy el switch miente.
- [ ] **1.3** GET (`:138-153`): dejar de devolver `[]`/`false` fijos; leer las columnas nuevas.
- [ ] **1.4** POST (`:224-236`): escribir arrays completos. Eliminar `data.days[0]` y `data.assignedRoles[0]`.
- [ ] **1.5** Validación de rol en POST, después de la sesión (`:179`): solo `ADMIN`/`SUPER_ADMIN` pueden modificar `complianceConfig`, `version`, `aiConfig` y `cumplimientoNormativo`. `GERENTE` solo campos de programación, y únicamente si la plantilla no es playbook corporativo → 403 con mensaje accionable.
- [ ] **1.6** Validación D1 con la tabla de `lib/compliance/frequency-requirements.ts`. Con `COMPLIANCE_FREQ_ENFORCE=false` responde 200 + `{ warnings: [...] }`; con `true`, 422.
- [ ] **1.7** Quitar el `console.log` de `:197` (y el de `:69`).
- [ ] **1.8** Concurrencia optimista en `PATCH /api/templates/[id]`: aceptar `expectedUpdatedAt`, comparar contra la fila, devolver 409 si difiere. Hoy dos pestañas se pisan en silencio.

**Aceptación:** test de integración que guarda Lun/Mié/Vie + 3 turnos + 2 roles, relee vía GET y recupera exactamente lo mismo. Test que un GERENTE recibe 403 al mandar `complianceConfig`.

---

## Fase 2 — Borrador vs. publicado [P0]

**Archivos:** `editor-client.tsx`, `app/api/templates/[id]/route.ts`.

Hoy el autosave escribe cada 3 s sobre una plantilla viva de N sucursales, sin borrador ni versión, y el diálogo "Salir sin guardar" no revierte nada (`editor-client.tsx:216-221`).

- [ ] **2.1** El autosave (`:62-71`) escribe **solo un borrador local** (`localStorage`, clave `pulso:builder-draft:${id}`, con `updatedAt`). Cero red.
- [ ] **2.2** Al abrir, si hay borrador más nuevo que `template.updatedAt`, ofrecer *"Tienes cambios sin publicar de hace X. ¿Retomar o descartar?"*.
- [ ] **2.3** `Guardar` → **`Publicar cambios`**. Confirmación con `AlertDialog` (ya importado en `:18-27`) cuyo cuerpo se calcula del alcance real: *"Esta plantilla es un playbook del grupo. Publicar cambiará el checklist de 12 sucursales a partir de la próxima ejecución."* Para plantilla local, confirmación ligera.
- [ ] **2.4** Estado en el header (`:146-148`), tres valores reales: `Borrador local · sin publicar` / `Publicando…` / `Publicado hace 2 min` (timestamp relativo vivo). Se elimina el "Guardado" ambiguo.
- [ ] **2.5** `version` se incrementa **en el servidor al publicar**. El `<Input type="number">` de `workflow-settings-modal.tsx:473` se vuelve texto de solo lectura.
- [ ] **2.6** El diálogo de salida (`:206-224`) descarta el borrador de verdad, o se renombra a `Descartar borrador y salir`.
- [ ] **2.7** El toast de error (`:111-113`) deja de dispararse en autosave. Fallo de red → banner persistente *"Sin conexión — tus cambios están guardados localmente"*, no un toast cada 3 segundos.

**Aceptación:** con la red caída, editar 2 minutos produce **cero** toasts y cero peticiones. Recargar recupera el borrador. Publicar exige confirmación con el conteo de sucursales.

---

## Fase 3 — Bugs de ejecución [P0/P1]

- [ ] **3.1** `property-editor.tsx:393` — `<SelectItem value="">` revienta en runtime (Radix). Centinela `__none__`, mapeado a `undefined` en `onValueChange` (`:385`) y de vuelta en `value` (`:384`). **Está en la ruta de la función estrella (verificación IA).** Mismo patrón en `components/inventory/receiving-form.tsx:152`.
- [ ] **3.2** `toolbox.tsx:30` — sin `overflow-y-auto` ni `shrink-0` dentro de `flex flex-1 overflow-hidden`. En 1366×768 se recortan **Ubicación GPS, Temporizador, Video y Audio**. → `w-64 shrink-0 border-r flex flex-col` + hijo `flex-1 overflow-y-auto p-4`.
- [ ] **3.3** `editor-client.tsx:253` — `h-[calc(100vh-4rem)]` ignora el `p-4 pt-0` del layout → scrollbar permanente. Cambiar a `h-full min-h-0` y añadir `min-h-0` a la fila flex de `:255`.
- [ ] **3.4** `editor-client.tsx:74-92` — el listener de teclado no revisa `e.target`: Ctrl+Z dentro de un input ejecuta el undo del builder en vez del del texto. Early-return para `input`/`textarea`/`[contenteditable]`, excepto Ctrl+S.
- [ ] **3.5** `builder-context.tsx:207-210` — `updateStep` empuja historial en cada `onChange`; 40 caracteres vacían los 50 slots. Coalescer mutaciones de texto (~500 ms o flag `transient`).
- [ ] **3.6** `builder-context.tsx:162,174` — quitar `setSelectedStepId(null)` de undo/redo: el panel desaparece a media edición.
- [ ] **3.7** `parseFloat`/`parseInt` sobre input vacío escriben `NaN` → se serializa a `null` y **desactiva en silencio la validación que el usuario creyó configurar**. 11 sitios: `property-editor.tsx:185,194,263,367,734`; `workflow-settings-modal.tsx:473,546`; `escalation-section.tsx:119`; `remediation-section.tsx:91,100,139`. Helper `parseNumberOrUndefined`.
- [ ] **3.8** `builder-context.tsx:212-216` — `removeStep` deja `branches[].targetStepId` y `conditionalLogic.fieldId` apuntando a UUIDs muertos. Validar al borrar y avisar en el `AlertDialog` (`property-editor.tsx:59-62`), cuyo texto hoy afirma que solo afecta a ese paso.
- [ ] **3.9** `property-editor.tsx:477` — las condiciones de rama incrustan el string de la opción (`valor == '${opt}'`) y las opciones se indexan por `idx` (`:570`). Renombrar una opción rompe todas sus ramas en silencio; un apóstrofo rompe la condición. Referenciar por id estable de opción.
- [ ] **3.10** `workflow-preview-modal.tsx:459` — `flex-2` no es clase de Tailwind. `:341` — el progreso nunca llega a 100%. `:404` — botón vacío de 6×6 px.

---

## Fase 4 — Reestructurar el modal de Configuración [P1]

**Archivo:** `components/builder/workflow-settings-modal.tsx` (941 líneas → dividir).

- [ ] **4.1** Extraer cada sección a su propio componente en `components/builder/settings/` (`compliance-tab.tsx`, `schedule-tab.tsx`, `actions-tab.tsx`, `scope-tab.tsx`, `advanced-tab.tsx`). El archivo actual queda como shell + estado.
- [ ] **4.2** Implementar D2: `Tabs`, footer fijo, orden Cumplimiento → Programación → Acciones → Alcance → Avanzado.
- [ ] **4.3** **Unificar los dos guardados.** `PlaybookScopeSection` deja de tener su botón propio (`:236`) y expone su estado hacia arriba; el `handleSave` del modal guarda ambos endpoints en secuencia con un solo estado de carga. Y **etiquetar los dos alcances**: el bloque de Programación lleva un rótulo explícito *"Programación de esta sucursal"* frente al alcance corporativo del playbook (ver corolario de D3).
- [ ] **4.4** Arreglar la carrera de carga: `loadSettings()` (`:229-233`) y el efecto de `initialSettings` (`:236-272`) escriben el mismo estado sin coordinarse, y sus defaults **no coinciden** — `selectedDays` tiene tres valores iniciales distintos (`:209` lun-vie, `:262` `[]`, `:298` lun-vie) y `shiftTimes` dos horarios distintos para vespertino/nocturno (`:216-221` vs `:265-269`). Una sola fuente: `initialSettings` para el primer render, fetch como refresco explícito, defaults en **una** constante compartida.
- [ ] **4.5** Estado de error en la carga. Hoy `catch { console.error }` (`:320-322`) deja un formulario poblado con defaults que parecen guardados — y publicarlo **sobrescribe la configuración real**. Reusar el patrón de `playbook-scope-section.tsx:160-166`: mensaje + reintento, y `Guardar` deshabilitado hasta carga confirmada.
- [ ] **4.6** Cancelar (`:922`) hace dirty-check y confirma antes de descartar ~40 campos.
- [ ] **4.7** Desambiguar `enabled` vs `activo`. **No son duplicados** — `activo` → `workflowTemplates.active` (la plantilla existe/no existe); `enabled` → `schedule.isActive` (se ejecuta automáticamente o no). Renombrar a **"Plantilla activa"** y **"Ejecución automática programada"**, cada uno con su línea de consecuencia. Además `enabled` falta en la interfaz `initialSettings` (`:32-48`): si el fetch falla siempre dice activado.
- [ ] **4.8** Los disparadores no se pueden configurar: `addTrigger` (`:401-405`) crea `conditions: {}` y no hay UI para editarlas. Agregas "Temperatura Crítica" sin umbral ni sensor. O se implementa el editor de condiciones, o se marca el disparador como *"sin condiciones — se dispara siempre"*.
- [ ] **4.9** Agrupar las listas largas con `SelectGroup`/`SelectLabel`, como ya se hace bien en `:616-629`: Tipo de Cumplimiento (12), Sección Regulatoria (13), operadores condicionales (7), acciones de paso (18, `property-editor.tsx:874`).
- [ ] **4.10** `grid-cols-4` de `:470` → `grid-cols-2` (a 672px daba ~150 px por columna). Íconos en las 9 cabeceras o en ninguna (hoy 3 de 9).

---

## Fase 5 — El Resumen se vuelve la confirmación real [P1]

**Archivo:** `workflow-settings-modal.tsx:900-918`.

Hoy cubre frecuencia, días, roles y turnos — el ~20% de lo configurado — y lo hace en inglés.

- [ ] **5.1** `:904` — `los ${selectedDays.join(', ')}` imprime **"los monday, tuesday"**. Mapear por `DAYS_OF_WEEK`, definido en el mismo archivo (`:96-104`).
- [ ] **5.2** `:913` — `<strong>{shiftLabel}</strong> at <strong>{time}</strong>` → `a las`.
- [ ] **5.3** Incluir lo que falta: norma y sección, si es auditable/crítico, cuántas acciones al completar, cuántos disparadores y **el alcance** (*"Playbook corporativo · 12 sucursales"* vs *"Plantilla local"*).
- [ ] **5.4** Mostrar la comparación de D1 en el Resumen: *"NOM-251 exige diario · programado diario ✓"*.
- [ ] **5.5** Mover el Resumen al footer fijo, junto al botón. Es el bloque que tranquiliza antes de comprometerse; hoy hay que hacer scroll por nueve secciones para verlo.

---

## Fase 6 — Idioma y densidad [P2]

- [ ] **6.1** `lib/workflow-type-map.ts:96-125` — `STEP_TYPE_DISPLAY` es 100% inglés y es la etiqueta principal de cada tarjeta. Añadir `STEP_TYPE_DISPLAY_ES` espejo de `toolbox.tsx:9-24` y usarlo en `sortable-step.tsx:62`, `property-editor.tsx:50,396,512,633`.
- [ ] **6.2** `builder-context.tsx:198` — `Nuevo paso de OPSLocationField` (nombre de clase interno dentro de una frase en español) → `Nuevo ${STEP_TYPE_DISPLAY_ES[type]}`. Corrige de paso el fallo de memoria de trabajo: los destinos de rama se eligen por título, y hoy tres pasos nuevos se ven idénticos en el desplegable.
- [ ] **6.3** `sortable-step.tsx:61` — el badge `text-xs uppercase tracking-wider` es el elemento más fuerte de cada fila y pesa más que el título del paso. Es el patrón "eyebrow" prohibido en DESIGN.md, repetido una vez por fila. Bajarlo a metadato secundario.
- [ ] **6.4** `property-editor.tsx` — 10 secciones expandidas a la vez en 320px. Accordion, abierto solo en "Básico" y en las secciones que ya tienen datos (`step.branches?.length`, `logicRules?.length`, `actions?.length`, `conditionalLogic`).
- [ ] **6.5** `toolbox.tsx` — 14 botones planos sin búsqueda ni categorías. Agrupar (Entrada · Evidencia · Ubicación y tiempo · Control) y añadir filtro.
- [ ] **6.6** `escalation-section.tsx:16` renderiza enums crudos (`EMPLEADO`, `OWNER`) mientras `workflow-settings-modal.tsx:106-112` mapea los mismos a español. Compartir `ROLES`.
- [ ] **6.7** `page.tsx:37-85` — 48 líneas reconciliando cuatro generaciones de esquema en tiempo de render, con fallback `'Untitled Step'` en inglés. Normalizar en una capa de migración fuera del componente de ruta.

---

## Fase 7 — Accesibilidad [P1]

Medido: **74 de 80 `<Label>` sin `htmlFor`; 98 controles sin `id` ni `aria-label`; un solo `aria-label` en todo el subárbol.**

- [ ] **7.1** `sortable-step.tsx:37` — `<Card onClick>` sin `tabIndex`, `role` ni `onKeyDown`. **Seleccionar un paso es la puerta de entrada a toda la edición y es solo-ratón.** Convertir a `<button>` o añadir `role="button" tabIndex={0} onKeyDown`.
- [ ] **7.2** `sortable-step.tsx:47` — el asa de arrastre es focusable pero `opacity-0`: se tabula a un control invisible. Añadir `focus-within:opacity-100`.
- [ ] **7.3** `aria-label` en los 7 botones solo-ícono sin nombre accesible: `editor-client.tsx:130`; `property-editor.tsx:53,582`; `logic-rule-card.tsx:35`; `workflow-settings-modal.tsx:869`; `workflow-preview-modal.tsx:184,404`.
- [ ] **7.4** Pares `htmlFor`/`id` (o `aria-label`) en `property-editor.tsx` (40 controles) y `workflow-settings-modal.tsx` (26). Incluye el input de título del flujo (`editor-client.tsx:140`), que solo tiene placeholder.
- [ ] **7.5** Copiar el patrón `type="button"` + `aria-pressed` de `playbook-scope-section.tsx:174` a todos los pills: `workflow-settings-modal.tsx:493,506,761,793,817`; `escalation-section.tsx:147`.
- [ ] **7.6** `aria-expanded`/`aria-controls` en los tres colapsables (`logic-rule-card.tsx:27`, `remediation-section.tsx:75`, `escalation-section.tsx:75`), y unificar su `expanded` inicial (hoy dos abiertos, uno cerrado).
- [ ] **7.7** `logic-rule-card.tsx:79-82` — severidad como emoji: un lector de pantalla anuncia "círculo rojo" para CRÍTICO. Íconos Lucide + token semántico (mismo cambio que ya hizo el plan v1 en la vista previa).
- [ ] **7.8** `workflow-preview-modal.tsx:305,325` — un `Checkbox` y un `Separator` de Radix usados como íconos decorativos, inyectando controles interactivos sin etiqueta en la cabecera del paso.
- [ ] **7.9** Escape para deseleccionar en el lienzo (`canvas.tsx:36` es solo-clic).

---

## Fase 8 — Sistema de diseño [P2]

- [ ] **8.1** `workflow-preview-modal.tsx:283-331` — mapa de íconos de 49 entradas con **7 tonos** de paleta cruda de Tailwind (orange/blue/purple/green/red/indigo/pink). `detect.mjs` no lo ve porque solo dispara con hex literales. Es exactamente la anti-referencia "generic SaaS" y consume el presupuesto de color que DESIGN.md reserva a Rojo Operacional (10-15%). → un ícono por familia, color solo por estado.
- [ ] **8.2** `workflow-preview-modal.tsx:68,107,113,185` y `workflow-settings-modal.tsx:862` (`text-yellow-500`) → tokens semánticos.
- [ ] **8.3** `editor-client.tsx:197` — Rojo Operacional sobre un ícono dentro de un botón ya rojo; el condicional no produce ningún cambio visible.
- [ ] **8.4** `template-manager.tsx:148` usa `confirm()` nativo para borrar plantillas mientras el editor usa `AlertDialog` para borrar un paso: dos idiomas de confirmación, y el nativo protege la acción **más** destructiva.

---

## Orden de ejecución

```
Fase 0  →  limpieza          (bloquea: evita corregir el archivo muerto)
Fase 1  →  backend           (bloquea Fase 4: sin persistencia, la UI es maquillaje)
Fase 2  →  borrador/publicar (P0 independiente, se puede paralelizar con Fase 1)
Fase 3  →  bugs              (3.1 y 3.2 son de un commit cada uno; sácalos ya)
Fase 4  →  reestructura modal
Fase 5  →  resumen
Fase 6  →  idioma y densidad
Fase 7  →  accesibilidad
Fase 8  →  sistema de diseño
```

**Si solo hay tiempo para tres cosas:** 3.1 (crash de la función estrella), 3.2 (cuatro herramientas inalcanzables en la laptop del cliente) y Fase 1.4 (los días y roles que se pierden en silencio). Son las tres que hoy hacen que algo *no funcione*, no que se vea mal.

---

## Comandos sugeridos

| Fase | Comando |
|---|---|
| 1, 2, 3 | `/impeccable harden app/dashboard/builder/editor/[id]` |
| 4, 5 | `/impeccable shape components/builder/workflow-settings-modal.tsx` |
| 5, 6 | `/impeccable clarify components/builder` |
| 7 | `/impeccable audit app/dashboard/builder/editor/[id]` |
| 8 | `/impeccable polish components/builder` |
| Verificación | `/impeccable critique app/dashboard/builder/editor/[id]` |

---

## Criterio de cierre

- `detect.mjs` en 0 sobre `components/builder` (ya lo está; no debe regresar).
- Guardar Lun/Mié/Vie + 3 turnos + 2 roles y releer devuelve exactamente lo mismo.
- Publicar un playbook corporativo exige confirmación que nombra el número de sucursales.
- Editar sin conexión durante 2 minutos: cero toasts, cero peticiones, borrador recuperable.
- Flujo completo (seleccionar paso → editar → configurar → publicar) navegable solo con teclado.
- Crítica re-corrida: **30+/40**.
