# Todo List: Historial de Workflows — Remediación y Rediseño Operativo

Plan: `tasks/plan.md` · Crítica: `.impeccable/critique/2026-08-18T15-27-06Z__app-dashboard-workflows-history.md` (Score: 39/40)

Archivos principales:
- `app/dashboard/workflows/history/page.tsx`
- `components/workflow/workflow-history-table.tsx`
- `app/api/workflows/history/route.ts`
- `components/workflow/review-status-badge.tsx`

---

## Fase 1: API, Paginación y Contrato de Datos (Backend)

- [x] **Task 1: Paginación en servidor, conteo total y ordenamiento en `/api/workflows/history`**
  - **Descripción**: La ruta actual se actualizó para recibir `page` (default 1), `limit` (default 20), ejecutando la consulta de conteo total filtrado (`COUNT`) y la consulta paginada (`LIMIT/OFFSET`), retornando `{ data, pagination: { page, limit, total, totalPages } }` con optimización de consulta por lotes para pasos e incidencias.
  - **Acceptance criteria**:
    - [x] `GET /api/workflows/history?page=1&limit=20` devuelve datos paginados con metadatos.
    - [x] `pagination.total` respeta todos los filtros activos.
    - [x] La consulta de pasos e incidencias se ejecuta en 1 sola consulta por lote de IDs.
  - **Verificación**:
    - [x] `npx tsc --noEmit` limpio.
  - **Dependencias**: Ninguna
  - **Archivos**: `app/api/workflows/history/route.ts`
  - **Alcance**: S

- [x] **Task 2: Presets operacionales y delimitación de fechas local en API**
  - **Descripción**: Se añadió soporte para presets (`today`, `this_week`, `with_incidents`, `pending_review`, `failed_or_blocked`) usando el huso horario local de la operación (`America/Mexico_City`).
  - **Acceptance criteria**:
    - [x] `preset=today` filtra en la ventana de fecha local actual.
    - [x] `preset=with_incidents` filtra instancias con incidencias vinculadas.
    - [x] `preset=pending_review` filtra instancias `COMPLETED` sin veredicto.
  - **Verificación**:
    - [x] Pruebas de API y compilación limpias.
  - **Dependencias**: Task 1
  - **Archivos**: `app/api/workflows/history/route.ts`
  - **Alcance**: S

### Checkpoint 1: Backend & Contrato — ✅ cerrado
- [x] La API devuelve datos estructurados con metadatos de paginación y presets.
- [x] Cero errores de TypeScript.

---

## Fase 2: Estandarización de Tokens y Badges (Visual Base)

- [x] **Task 3: Reemplazo de clases de color ad-hoc por tokens OKLCH y Badges semánticos**
  - **Descripción**: En `workflow-history-table.tsx`, se migraron todos los badges para usar variantes semánticas estándar del sistema (`variant="success"`, `variant="secondary"`, `variant="outline"`, `variant="destructive"`), eliminando clases crudas de Tailwind.
  - **Acceptance criteria**:
    - [x] Flujos completados usan `<Badge variant="success">`.
    - [x] Flujos en progreso usan `<Badge variant="secondary">` tokenizado.
    - [x] No existen clases `bg-green-500` ni `bg-blue-100` en el componente.
  - **Verificación**:
    - [x] Detector Impeccable limpio con 0 antipatrones.
  - **Dependencias**: Ninguna
  - **Archivos**: `components/workflow/workflow-history-table.tsx`
  - **Alcance**: XS

- [x] **Task 4: Tarjetas de estadísticas superiores y barra de progreso sin falsos positivos de alarma**
  - **Descripción**: En `page.tsx`, las 4 tarjetas de resumen usan tokens semánticos (`text-success`, `text-info`, `text-warning-text`, `text-foreground`). La barra de progreso usa `bg-success` al 100% y `bg-foreground/70` en curso.
  - **Acceptance criteria**:
    - [x] Tarjetas de resumen en `page.tsx` usan tokens del sistema de diseño.
    - [x] Barra de progreso adaptada sin simular falsas alarmas rojas al completar.
  - **Verificación**:
    - [x] Verificación de contraste y detector limpio.
  - **Dependencias**: Task 3
  - **Archivos**: `app/dashboard/workflows/history/page.tsx`, `components/workflow/workflow-history-table.tsx`
  - **Alcance**: XS

### Checkpoint 2: Sistema de Tokens — ✅ cerrado
- [x] Cumplimiento estricto de la regla de 10-15% de Rojo Operacional.
- [x] Colores OKLCH semánticos integrados.

---

## Fase 3: Rediseño de la Barra de Filtros y Exportación Real

- [x] **Task 5: Barra de filtros con chips rápidos operacionales, búsqueda con debounce y popover avanzado**
  - **Descripción**: Se reemplazó el grid plano por una barra limpia con buscador debounced (300ms), fila de chips de acceso rápido ("Todos", "Hoy", "Esta semana", "Con incidencias", "Por revisar", "Bloqueados/Fallidos") y Popover de filtros secundarios con badge indicador de filtros activos.
  - **Acceptance criteria**:
    - [x] Búsqueda debounced (300ms).
    - [x] Chips rápidos de 1-clic funcionales.
    - [x] Popover accesible para filtros secundarios con contador y botón de limpiar.
  - **Verificación**:
    - [x] Prueba de filtrado y cambio de chips sin bloqueos.
  - **Dependencias**: Tasks 1, 2
  - **Archivos**: `components/workflow/workflow-history-table.tsx`
  - **Alcance**: M

- [x] **Task 6: Exportador CSV real para auditorías e informes de workflows**
  - **Descripción**: Se implementó una función de exportación a CSV con cabeceras en español, codificación UTF-8 con BOM y sanitización de caracteres, descargando el archivo `historial-workflows-[fecha].csv`.
  - **Acceptance criteria**:
    - [x] Clic en "Exportar" genera y descarga archivo CSV real.
    - [x] Columnas sanitizadas con feedback de toast.
  - **Verificación**:
    - [x] Generación de blob y descarga verificada.
  - **Dependencias**: Task 5
  - **Archivos**: `components/workflow/workflow-history-table.tsx`
  - **Alcance**: S

### Checkpoint 3: Carga Cognitiva y Acciones — ✅ cerrado
- [x] Cumple con la regla de ≤4 opciones en la decisión principal.
- [x] Exportación real a CSV funcional.

---

## Fase 4: Tabla Flat-by-Default, Navegación Directa a `/execute`, Paginación y Responsive

- [x] **Task 7: Estructura de tabla Flat-by-Default, navegación directa a `/execute` y barra de paginación completa**
  - **Descripción**: Se eliminaron bordes anidados redundantes. Se actualizaron todos los enlaces y botones de acción ("Ver", "Iniciar", nombre de plantilla) para navegar SIEMPRE a `/dashboard/workflows/${workflow.id}/execute`. Se integró la barra de paginación con selector de filas por página (10/20/50) y botones Anterior/Siguiente.
  - **Acceptance criteria**:
    - [x] Todos los flujos navegan directamente a `/dashboard/workflows/[id]/execute`.
    - [x] Tabla limpia Flat-by-Default con divisores horizontales.
    - [x] Barra de paginación interactiva.
  - **Verificación**:
    - [x] Clics en la tabla dirigen a `/execute` y paginación opera fluidamente.
  - **Dependencias**: Tasks 1, 3, 5
  - **Archivos**: `components/workflow/workflow-history-table.tsx`
  - **Alcance**: M

- [x] **Task 8: Adaptación responsiva para tablets de cocina y móviles (<768px)**
  - **Descripción**: En pantallas móviles y tablets (<768px), la tabla colapsa en tarjetas operacionales táctiles con botón de acción de ancho completo a `/execute`.
  - **Acceptance criteria**:
    - [x] Vista de tabla en escritorio y vista de tarjetas en móviles/tablets.
    - [x] Botones y áreas táctiles de al menos 44x44px en móvil.
  - **Verificación**:
    - [x] Verificación de layout responsivo sin desbordamientos.
  - **Dependencias**: Task 7
  - **Archivos**: `components/workflow/workflow-history-table.tsx`
  - **Alcance**: S

### Checkpoint 4: Tabla y Navegabilidad — ✅ cerrado
- [x] Toda la navegación conduce a `/execute`.
- [x] Adaptabilidad móvil y de escritorio verificada.

---

## Fase 5: Estados de Carga, Error y Sincronización en URL

- [x] **Task 9: Skeletons de carga (sin layout shifts) y estado de error con reintento**
  - **Descripción**: Se sustituyó el spinner aislado por filas de `Skeleton` durante el fetch y una tarjeta de error con botón "Reintentar".
  - **Acceptance criteria**:
    - [x] 5 filas de esqueleto durante carga.
    - [x] Vista de error con botón de reintento.
  - **Verificación**:
    - [x] Cero saltos de layout durante carga.
  - **Dependencias**: Task 7
  - **Archivos**: `components/workflow/workflow-history-table.tsx`
  - **Alcance**: S

- [x] **Task 10: Sincronización bidireccional con URL (`searchParams`) y validación final**
  - **Descripción**: Los parámetros de búsqueda, página, límite, preset y filtros secundarios se sincronizan en la URL (`searchParams`) mediante `router.replace` con `scroll: false`.
  - **Acceptance criteria**:
    - [x] URL actualizada automáticamente al cambiar filtros o paginación.
    - [x] Preservación de estado al recargar o compartir enlace.
    - [x] Cumplimiento de la regla Label-Floor de `DESIGN.md` (`text-xs` como mínimo).
  - **Verificación**:
    - [x] `npx tsc --noEmit` limpio (0 errores).
    - [x] Impeccable critique score: **39/40 (97.5%)**.
  - **Dependencias**: Tasks 1-9
  - **Archivos**: `components/workflow/workflow-history-table.tsx`, `app/dashboard/workflows/history/page.tsx`
  - **Alcance**: S

### Checkpoint 5: Flujo Completo y Cierre — ✅ cerrado
- [x] 100% de tareas completadas.
- [x] Score Impeccable elevado a 39/40.
