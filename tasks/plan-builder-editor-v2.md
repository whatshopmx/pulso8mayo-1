# Implementation Plan: Editor de Flujos — corrección de crítica v2

> Fuente: `.impeccable/plans/builder-editor-critique-fix-plan-v2.md` (crítica 15/40, objetivo 30+/40).
> Task list ejecutable en `tasks/todo-builder-editor-v2.md`.
> Convención de nombres: este repo usa `tasks/plan-<slug>.md` + `tasks/todo-<slug>.md` (no `tasks/plan.md`), y `tasks/todo.md` ya pertenece a otro workstream.

## Overview

El editor del Builder (`app/dashboard/builder/editor/[id]/` + `components/builder/` + `app/api/templates/[id]/`) tiene tres problemas que no son de UI:

1. **Pérdida silenciosa de datos.** Cinco controles del modal de configuración no persisten o persisten truncados (`days[0]`, `assignedRoles[0]`, `assignedShifts` ignorado, `cumplimientoNormativo` y `requiereIA` inventados en el GET). Verificado en `app/api/templates/[id]/settings/route.ts:143-147`, `:221`, `:228`, `:84-86`.
2. **Autorización ausente en el servidor.** `POST /api/templates/[id]/settings` solo comprueba `session` + `branchId` (`:179-181`). No usa `requirePermissionApi`, y aunque lo usara: `PERMISSIONS.GERENTE.workflows` incluye `update` (`lib/permissions.ts:107`), así que el gate tiene que ser **por campo**, no solo por recurso.
3. **Autosave contra plantilla viva.** `editor-client.tsx:62-71` hace `PATCH` cada 3 s sobre una plantilla que puede ser un playbook de N sucursales, sin borrador, sin versión, con toast de error por cada intento fallido y con dos pestañas pisándose en silencio.

Todo lo demás (modal de 941 líneas, accesibilidad, idioma, sistema de diseño) es real pero secundario: **maquillaje sobre campos muertos** hasta que 1 y 2 estén cerrados.

**Filosofía de corte:** el plan fuente está organizado por fase temática (horizontal). Aquí se reordena para que cada tarea deje el sistema compilando y, donde es posible, entregue una capacidad verificable de punta a punta (persistencia real → autorización real → borrador real → UI encima). Los bugs de un commit (3.1, 3.2) se sacan al frente porque hoy hacen que algo *no funcione*, no que se vea mal.

## Architecture Decisions

- **AD-1 — `requiredFrequency` es la fuente de verdad; `frequency` se valida contra ella.** Tabla nueva en `lib/compliance/frequency-requirements.ts`. La validación vive en el servidor (`settings/route.ts`), no solo en el cliente: es una invariante de negocio. *Rationale:* si el sistema conoce la norma y la programación, hacer que coincidan no es trabajo del usuario.
- **AD-2 — La validación de frecuencia arranca en advertencia, y `enforce` es por norma.** Cada entrada de la tabla lleva `{ min, enforce: false, source, reviewedAt }`; `COMPLIANCE_FREQ_ENFORCE` queda solo como interruptor de emergencia global. Sin `enforce`: `200 + { warnings: [] }`. Con `enforce`: `422`. *Rationale:* los valores son un punto de partida operativo, no asesoría legal; bloquear guardados antes de que el consultor los confirme convierte un error nuestro en un error del cliente. Por norma en vez de global para que NOM-251 pueda pasar a bloquear en cuanto lo confirmen, sin esperar a las otras once.
- **AD-3 — El gate va por jerarquía de rol y por campo, nunca por la matriz de permisos.** `PERMISSIONS.workflows` incluye `update` para `GERENTE` (`lib/permissions.ts:107`), `SUPERVISOR` (`:113`) **y `EMPLEADO` (`:124`, el permiso con el que ejecuta pasos)**: `requirePermissionApi('workflows','update')` deja pasar a todos menos `READONLY` y es inservible como gate del editor. Se usa `ROLES_HIERARCHY`: editor a partir de `GERENTE` (80); campos privilegiados (`complianceConfig`, `version`, `aiConfig`, `cumplimientoNormativo`, `activo`) solo a partir de `ADMIN` (90); `GERENTE` bloqueado por completo cuando `template.scope === 'company'`.
- **AD-4 — `requiereIA` se deriva de los pasos y se muestra como badge de solo lectura.** `requiereIA = steps.some(esVerificaciónIA) || aiConfig != null`, calculado en el GET; el switch sale de la UI. Sin columna nueva. *Rationale:* `aiConfig != null` responde "hay proveedor configurado", que no es lo que pregunta un auditor — lo que importa es si el flujo *contiene* verificación por IA. Derivado de los pasos, el campo no puede mentir; como switch o como columna, vuelve a divergir en el primer cambio. `cumplimientoNormativo` sí recibe columna real (`jsonb`) porque no es derivable de nada.
- **AD-5 — El borrador vive en `localStorage`, con clave por usuario, y la publicación en el servidor.** `pulso:builder-draft:${userId}:${templateId}` con `updatedAt`; se purga al publicar, TTL de 7 días, tope de ~5 borradores. El autosave deja de tocar la red por completo. *Rationale:* un `PATCH` cada 3 s sobre el checklist activo de 12 sucursales es un despliegue no anunciado; el borrador local elimina la clase entera de fallo (toasts en bucle, escrituras parciales, pestañas pisándose) sin exigir tabla de borradores. La clave por usuario no es cosmética: en sucursal el dispositivo se comparte y sin `userId` el borrador del gerente le aparece al siguiente turno como si fuera suyo. El tope y el TTL existen porque el JSON de pasos compite con los ~5 MB de cuota.
- **AD-6 — Concurrencia optimista con `expectedUpdatedAt`.** `PATCH /api/templates/[id]` compara contra la fila y devuelve 409. *Rationale:* con AD-5 los conflictos se vuelven raros pero más caros (dos borradores largos); 409 explícito > último-en-escribir-gana.
- **AD-7 — Las columnas escalares viejas se conservan un ciclo.** `day_of_week` y `assigned_role` siguen existiendo y se siguen escribiendo con el primer elemento del array, además de las columnas nuevas. *Rationale:* `WorkflowScheduleService` y el motor de ejecución las leen; migrar lectura y escritura en el mismo commit convierte un bug de UI en una caída del cron.
- **AD-8 — El modal se queda como `Dialog`; solo cambia por dentro.** `Tabs` + footer fijo + un solo guardado. La ruta propia (`/configuracion`) **no se hace**, y se reabre solo con uno de dos disparadores escritos: que aparezca la necesidad de enlazar directo a la configuración (URL compartible) o que las pestañas pasen de cinco. *Rationale:* migrar a ruta arrastra el estado del editor; sin uno de esos dos disparadores, la ruta propia solo mueve estado de sitio.
- **AD-9 — El acceso al editor se decide en `page.tsx` por jerarquía, con redirección al listado.** `ROLES_HIERARCHY[role] >= 80` (GERENTE) entra; `SUPERVISOR`/`EMPLEADO`/`READONLY` → `redirect('/dashboard/builder')`. *Rationale:* no es un 404 ni una expulsión del módulo — necesitan ver qué flujos existen, solo no editarlos.

## Dependency Graph

```
T0 limpieza (borra el builder muerto)
 │
 ├─ Fase 1 — backend                     ├─ Fase 2 — borrador/publicado   (paralelo)
 │   T1 migración 0038 (columnas)         │   T7 borrador local + banner offline
 │    └─ T2 GET/POST arrays reales        │    └─ T8 Publicar + confirmación por alcance
 │        ├─ T3 gate por campo + logs     │        └─ T9 version en servidor
 │        ├─ T4 frequency-requirements    │
 │        └─ T6 e2e round-trip            │
 │   T5 concurrencia optimista ───────────┘  (T5 la consume T8)
 │
 ├─ Fase 3 — bugs (T10…T17, independientes entre sí; T10/T11 primero)
 │
 └─ Fase 4 — modal  (requiere T2: sin persistencia la UI es maquillaje)
     T18 defaults + estado de error
      └─ T19 extracción a components/builder/settings/
          └─ T20 Tabs + footer fijo
              ├─ T21 unificar los dos guardados + rotular los dos alcances
              ├─ T22 cancelar/naming/densidad
              ├─ T23 condiciones de disparadores
              ├─ T24 SelectGroup en listas largas
              └─ Fase 5 — Resumen (T25 contenido → T26 al footer)

Fase 6 (idioma/densidad), Fase 7 (a11y), Fase 8 (design system) — después de Fase 4/5,
salvo T27 (STEP_TYPE_DISPLAY_ES) que no depende de nada y desbloquea T15/T25.
```

## Task List

Detalle completo, criterios de aceptación y verificación por tarea: `tasks/todo-builder-editor-v2.md`.

### Fase 0 — Limpieza (bloquea todo)
- T0 — Borrar el builder muerto, imports muertos y el tipo duplicado.

### Fase 1 — Backend: persistencia real y autorización [P0]
- T1 — Migración `0038`: arrays en `workflow_schedules`, `cumplimiento_normativo` en `workflow_templates`.
- T2 — GET/POST persisten arrays completos (días, roles, turnos, normas).
- T3 — Gate de rol por campo en POST + eliminar `console.log` de configuración.
- T4 — `lib/compliance/frequency-requirements.ts` + validación D1 con `COMPLIANCE_FREQ_ENFORCE`.
- T5 — Concurrencia optimista (`expectedUpdatedAt` → 409) en `PATCH /api/templates/[id]`.
- T6 — E2E de round-trip y de 403 para GERENTE.

### Checkpoint 1 (T0–T6)
- [ ] `npx tsc --noEmit` limpio · `pnpm run build` limpio
- [ ] `pnpm db:generate` produce SOLO `ADD COLUMN` (cero `DROP`)
- [ ] Guardar Lun/Mié/Vie + 3 turnos + 2 roles y releer devuelve **exactamente** lo mismo
- [ ] GERENTE mandando `complianceConfig` recibe 403 con mensaje accionable
- [ ] Ningún `console.log` vuelca configuración a los logs del servidor

### Fase 2 — Borrador vs. publicado [P0, paralelizable con Fase 1]
- T7 — Autosave → borrador local; banner de offline en vez de toast cada 3 s.
- T8 — `Guardar` → `Publicar cambios` con confirmación por alcance real + estado en el header.
- T9 — `version` se incrementa en el servidor al publicar; el input se vuelve solo lectura.

### Checkpoint 2 (T7–T9)
- [ ] Con la red caída, editar 2 minutos → **cero** toasts y **cero** peticiones
- [ ] Recargar recupera el borrador y ofrece retomar/descartar
- [ ] Publicar un playbook corporativo exige confirmación que **nombra el número de sucursales**
- [ ] "Salir sin guardar" descarta el borrador de verdad (o se llama como lo que hace)

### Fase 3 — Bugs de ejecución [P0/P1]
- T10 — `<SelectItem value="">` (crash de la verificación IA) — **sácalo primero**.
- T11 — Toolbox recortado en 1366×768 + alturas del editor.
- T12 — Atajos de teclado dentro de inputs + selección que sobrevive a undo/redo.
- T13 — Coalescer el historial de mutaciones de texto.
- T14 — `parseNumberOrUndefined` en los 11 sitios que escriben `NaN`.
- T15 — `removeStep` deja referencias colgadas en ramas y lógica condicional.
- T16 — Condiciones de rama por id estable de opción.
- T17 — Arreglos de la vista previa (`flex-2`, progreso al 100%, botón vacío).

### Checkpoint 3 (T10–T17)
- [ ] Seleccionar el paso de verificación IA no revienta
- [ ] A 1366×768 las 14 herramientas del toolbox son alcanzables
- [ ] Ctrl+Z dentro de un input deshace texto, no pasos
- [ ] Vaciar un campo numérico deja el valor sin definir, nunca `NaN`/`null` silencioso

### Fase 4 — Reestructurar el modal de Configuración [P1]
- T18 — Una sola fuente de defaults + estado de error en la carga.
- T19 — Extraer secciones a `components/builder/settings/`.
- T20 — `Tabs` + footer fijo + orden Cumplimiento → Programación → Acciones → Alcance → Avanzado.
- T21 — Un solo guardado (integra `PlaybookScopeSection`) + rotular los dos alcances.
- T22 — Cancelar con dirty-check, `activo` vs `enabled` desambiguados, densidad.
- T23 — Editor de condiciones de disparadores (o etiqueta honesta).
- T24 — `SelectGroup`/`SelectLabel` en las cuatro listas largas.

### Fase 5 — El Resumen como confirmación real [P1]
- T25 — Contenido del resumen: español, alcance, norma, comparación D1.
- T26 — Mover el Resumen al footer fijo.

### Checkpoint 4 (T18–T26)
- [ ] Un solo botón de guardado; `PlaybookScopeSection` ya no guarda por su cuenta
- [ ] Fallo de carga → mensaje + reintento, con `Guardar` deshabilitado (no defaults disfrazados de guardados)
- [ ] El Resumen está en español, visible sin scroll, y nombra el alcance y la norma

### Fase 6 — Idioma y densidad [P2]
- T27 — `STEP_TYPE_DISPLAY_ES` + títulos de paso nuevos en español.
- T28 — `ROLES` compartido + el badge de tipo baja a metadato secundario.
- T29 — Accordion en `property-editor.tsx`.
- T30 — Toolbox con categorías y filtro.
- T31 — Normalizar el esquema fuera del componente de ruta.

### Fase 7 — Accesibilidad [P1]
- T32 — Selección de paso y lienzo operables con teclado.
- T33 — `aria-label` en los 7 botones solo-ícono + patrón `aria-pressed` en los pills.
- T34 — `htmlFor`/`id` en `property-editor.tsx` (40 controles).
- T35 — `htmlFor`/`id` en `workflow-settings-modal.tsx` (26 controles) + título del flujo.
- T36 — Colapsables (`aria-expanded`), severidad sin emoji, Radix decorativo fuera.

### Fase 8 — Sistema de diseño [P2]
- T37 — Mapa de íconos de 49 entradas → un ícono por familia, color solo por estado.
- T38 — Tokens semánticos en lugar de paleta cruda.
- T39 — `confirm()` nativo → `AlertDialog`.

### Checkpoint 5 (cierre)
- [ ] `detect.mjs components/builder` en 0
- [ ] Flujo completo (seleccionar paso → editar → configurar → publicar) navegable solo con teclado
- [ ] Crítica re-corrida: **30+/40**

## Si solo hay tiempo para tres cosas

**T10** (crash de la función estrella) · **T11** (cuatro herramientas inalcanzables en la laptop del cliente) · **T2** (los días y roles que se pierden en silencio). Son las tres que hoy hacen que algo *no funcione*, no que se vea mal.

## Paralelización

| Se puede en paralelo | Debe ser secuencial |
|---|---|
| Fase 1 (T1–T6) con Fase 2 (T7–T9) — tocan `settings/route.ts` vs `editor-client.tsx` | T1 → T2 → T3/T4 (misma ruta, mismo handler) |
| T10, T11, T13, T17 entre sí (archivos disjuntos) | T18 → T19 → T20 → T21…T24 (mismo archivo en refactor) |
| Fase 6 con Fase 7 salvo `property-editor.tsx` (T29 vs T34) | T25 → T26 (el footer lo crea T20) |
| Fase 8 completa, al final | T5 antes de T8 (T8 manda `expectedUpdatedAt`) |

Conflictos de archivo a vigilar: `editor-client.tsx` lo tocan T7, T8, T11, T12, T31, T33; `workflow-settings-modal.tsx` lo tocan T18–T26, T35, T38. No paralelizar dentro de esas columnas.

## Risks and Mitigations

| Riesgo | Impacto | Mitigación |
|---|---|---|
| La migración de `dayOfWeek`/`assignedRole` a arrays rompe el cron de ejecución que lee las columnas escalares | **Alto** | AD-7: conservar y seguir escribiendo las escalares un ciclo; migrar lectores en un plan aparte |
| Cambiar las condiciones de rama a id de opción (T16) invalida las ramas de plantillas ya guardadas | **Alto** | Normalizador retro-compatible: si la condición trae string, resolver por texto una vez y reescribir a id; script de backfill + test con plantilla legacy |
| `COMPLIANCE_FREQ_ENFORCE=true` bloquea guardados con valores no confirmados legalmente | Medio | Default `false` (AD-2); activar solo tras el visto bueno del consultor (Q2) |
| Unificar los dos guardados (T21) crea escrituras parciales: settings OK, scope falla | Medio | Secuencia con estado de carga único, rollback visual, y el error nombra qué parte falló; nunca cerrar el modal en fallo parcial |
| El borrador en `localStorage` no cruza dispositivos y el usuario cree que publicó | Medio | Estado explícito en el header ("Borrador local · sin publicar") + confirmación de publicación (T8) |
| El refactor del modal (941 líneas → 6 archivos) arrastra regresiones invisibles sin tests | Medio | T18 antes de extraer (arregla el estado con el archivo aún entero); e2e de T6 corre después de T19/T20 |
| `detect.mjs` da 0 hoy y las Fases 6–8 introducen color crudo | Bajo | Correrlo en cada checkpoint, no solo al cierre |

## Open Questions

**Resueltas (decisión técnica, documentada arriba — revertible si el negocio dice otra cosa):**

- ~~**Q1 — `requiereIA`.**~~ → **AD-4**: derivado de los pasos (`steps.some(esVerificaciónIA) || aiConfig != null`), badge de solo lectura, sin columna. Solo se revierte a columna real si Cumplimiento necesita declarar "requiere IA" para un flujo que no la usa.
- ~~**Q3 — SUPERVISOR en el editor.**~~ → **AD-9**: `redirect('/dashboard/builder')`, el listado, no un 404. Gate por `ROLES_HIERARCHY >= 80`, nunca por `PERMISSIONS.workflows.update` (AD-3).
- ~~**Q4 — Retención de borradores.**~~ → **AD-5**: purga al publicar, TTL 7 días, tope ~5, clave por `userId`.
- ~~**Q5 — Ruta propia de configuración.**~~ → **AD-8**: no se hace; se reabre con URL compartible o >5 pestañas.

**Abierta (necesita a alguien fuera del equipo):**

- **Q2 — Valores de la tabla de frecuencias.** `NOM_251 → DAILY`, `NOM_035 → ANNUAL`, `NOM_030/019/017 → MONTHLY`, laborales → sin mínimo. **No bloquea T4**: se implementa con `enforce: false` por norma (AD-2) y el warning declara que es un valor operativo, no asesoría legal. Cada norma pasa a `enforce: true` con su `source` y `reviewedAt` cuando el consultor de cumplimiento la confirma, una por una.
