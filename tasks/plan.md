# Implementation Plan: Historial de Workflows — Remediación y Rediseño Operativo

Fuente: `.impeccable/critique/2026-08-18T15-18-51Z__app-dashboard-workflows-history.md` (23/40, 3 P1, 2 P2).

## Overview

La pantalla `/dashboard/workflows/history` es la bitácora central donde dueños y gerentes de cadenas HORECA (3 a 15 sucursales) auditan la ejecución de turnos, listas de verificación NOM-251/NOM-035 y auditorías operativas.

La crítica identificó que la pantalla opera actualmente como un CRUD genérico con alta carga cognitiva:
1. **Sobrecarga de filtros**: 7 campos planos en un grid de 4 columnas que mezcla controles de filtrado con un botón de exportación ficticio.
2. **Sin paginación real**: API limitada a `limit(100)` a ciegas sin paginación ni conteo total, aislando el historial anterior en grupos multi-sucursal.
3. **Inconsistencia de diseño y tokens**: Clases Tailwind crudas (`bg-green-500`, `text-green-600`, `bg-blue-100 text-blue-800`) que rompen el modo oscuro y evaden los tokens OKLCH del sistema Pulso.
4. **Elevación y capas tonales**: Bordes anidados redundantes (`Card > rounded-md border > Table`) que violan el principio *Flat-by-Default*.
5. **Navegación de flujos**: Al hacer clic en un workflow o en el botón "Ver", debe abrir directamente la vista de ejecución `/dashboard/workflows/[id]/execute` para inspeccionar/ejecutar el detalle del flujo completo en lugar de redirigir a la vista de revisión aislada.
6. **Rigidez responsiva**: Tabla de 8 columnas apretadas que se desbordan en tablets de cocina y móviles.

Este plan estructura la remediación en 5 fases secuenciales.

---

## Architecture Decisions

1. **Paginación en servidor con contrato de metadatos estandarizado:**
   - La API `/api/workflows/history` devolverá `{ data: WorkflowHistoryItem[], pagination: { page: number, limit: number, total: number, totalPages: number } }`.
   - Se aplicará paginación mediante `limit` y `offset` calculados a partir de los parámetros `page` y `pageSize`, manteniendo el ordenamiento por `createdAt DESC` o columna solicitada.

2. **Filtros rápidos operacionales (Chips) + Filtros avanzados en Popover:**
   - En lugar de 7 inputs visibles compitiendo por atención (violación de la regla de ≤4 opciones de memoria de trabajo), la barra principal tendrá:
     - Input de búsqueda unificado con debounce (300ms).
     - Chips de acceso rápido: "Todos", "Hoy", "Esta Semana", "Con Incidencias", "Por Revisar".
     - Botón "Filtros avanzados" que abre en popover los selectores secundarios (Sucursal, Plantilla, Asignado, Rango de fechas).
     - Botón de exportación reubicado en la barra de herramientas superior con descarga real de CSV.

3. **Navegación directa a `/execute` al hacer clic en un flujo:**
   - Al hacer clic en la fila o en el botón de acción principal ("Ver" / "Ejecutar"), la navegación conduce siempre a `/dashboard/workflows/${workflow.id}/execute`, permitiendo revisar el paso a paso, evidencias y estado de ejecución real directamente en el ejecutor del workflow.

4. **Adhesión estricta al Sistema de Diseño OKLCH (DESIGN.md):**
   - Cero clases de color ad-hoc de Tailwind (`green-500`, `blue-100`, `orange-600`).
   - Uso exclusivo de tokens semánticos: `text-success`, `text-warning-text`, `text-destructive`, `text-info` y variantes de componentes `Badge` (`variant="success"`, `variant="outline"`, `variant="secondary"`, `variant="destructive"`).
   - Barra de progreso: color neutral o `bg-success` para flujos completados al 100%, evitando que el rojo primario (`bg-primary`) simule un error.

5. **Eliminación de bordes anidados (Flat-by-Default):**
   - Retirar el contenedor `div.rounded-md.border` dentro de `CardContent`.
   - La tabla usará divisores horizontales sutiles en `--border`, fondos alternados o hover states limpios (`hover:bg-accent/40`), sin cajas dentro de cajas.

6. **Sincronización de estado en URL:**
   - Los parámetros de página, búsqueda, filtros y presets vivirán en `searchParams` (`?page=1&status=COMPLETED&preset=today`), permitiendo compartir enlaces y mantener estado al recargar.

---

## Task List

### Fase 1: API, Paginación y Contrato de Datos (Backend)
- [ ] **Task 1: Paginación en servidor, conteo total y ordenamiento en `/api/workflows/history`**
- [ ] **Task 2: Soporte de presets operacionales y búsqueda optimizada en API**

### Checkpoint 1: Backend & Contrato
- [ ] API responde con estructura `{ data, pagination }` y filtra correctamente por página, tamaño, búsqueda y sucursal.
- [ ] Verificación con tests o scripts de API.

---

### Fase 2: Estandarización de Tokens y Badges (Visual Base)
- [ ] **Task 3: Reemplazo de colores Tailwind crudos por tokens OKLCH y Badges semánticos**
- [ ] **Task 4: Tarjetas de estadísticas superiores y barra de progreso sin falsos positivos de alarma**

### Checkpoint 2: Sistema de Tokens
- [ ] Cero clases `bg-green-500`, `text-green-600`, `bg-blue-100`, `text-orange-600` en la ruta de historial.
- [ ] Modos claro y oscuro completamente armónicos.

---

### Fase 3: Rediseño de la Barra de Filtros y Exportación Real
- [ ] **Task 5: Barra de filtros con chips rápidos operacionales, búsqueda con debounce y popover avanzado**
- [ ] **Task 6: Exportador CSV real para auditorías e informes de workflows**

### Checkpoint 3: Carga Cognitiva y Acciones
- [ ] Búsqueda no satura la API en cada tecla (debounce 300ms).
- [ ] Los chips operacionales ("Hoy", "Con Incidencias", etc.) filtran con 1 clic.
- [ ] El botón Exportar genera y descarga un archivo `.csv` real con los filtros aplicados.

---

### Fase 4: Tabla Flat-by-Default, Navegación Directa a `/execute`, Paginación y Responsive
- [ ] **Task 7: Estructura de tabla Flat-by-Default, navegación directa a `/execute` y barra de paginación completa**
- [ ] **Task 8: Adaptación responsiva para tablets de cocina y móviles (<768px)**

### Checkpoint 4: Tabla y Navegabilidad
- [ ] Clic en cualquier workflow o en su botón "Ver" navega a `/dashboard/workflows/[id]/execute`.
- [ ] Paginación fluida entre páginas sin recarga completa.
- [ ] Vista compacta / adaptativa en anchos de pantalla reducidos.
- [ ] Cero bordes anidados redundantes.

---

### Fase 5: Estados de Carga, Error y Sincronización en URL
- [ ] **Task 9: Skeletons de carga (sin layout shifts) y estado de error con reintento**
- [ ] **Task 10: Sincronización bidireccional de filtros y paginación con la URL (`searchParams`)**

### Checkpoint 5: Flujo Completo y Cierre
- [ ] Navegación hacia atrás y adelante en navegador preserva el estado exacto de la tabla.
- [ ] Re-ejecutar `$impeccable critique` para confirmar la subida de score del objetivo.
