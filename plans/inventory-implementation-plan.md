# Plan de Implementación: Inventario + Transferencias

Basado en crítica de diseño (`/impeccable critique`) y análisis del módulo de transferencias.

---

## Resumen

- **Score actual:** 25/40 (Good — banda Acceptable)
- **Pendientes:** 2 P0, 2 P1, 3 P2, 2 P3 (dashboard) + 6 issues nuevos (transferencias)
- **Prioridad acordada:** Confianza en datos → Español claro → Todo

---

## Fase 1: Confianza y Datos Reales (P0)

### 1.1 Eliminar datos mock del DashboardKPI

**Archivos:**
- `components/inventory/dashboard-kpis.tsx`

**Qué hacer:**
- Eliminar `mockValueHistory` (líneas 36-45) — el sparkline solo debe renderizarse cuando existan datos reales de serie temporal
- Reemplazar `94.2%` hardcodeado con un valor calculado desde `dashboardData`
- Reemplazar `2.8%` hardcodeado con un valor calculado desde `dashboardData`
- Si los datos reales no están disponibles, mostrar skeleton en lugar del valor

**API/servicio requerido:**
- Verificar que `useDashboard` devuelva `threeWayMatchRate` y `wasteLossRatio`
- Si no existen, agregarlos al endpoint de dashboard y al servicio

### 1.2 Eliminar animaciones decorativas en alertas

**Archivos:**
- `components/inventory/dashboard-kpis.tsx`

**Qué hacer:**
- Reemplazar `animate-ping` (línea 97-99) con indicador estático (círculo rojo relleno)
- Reemplazar `animate-pulse` (línea 88) con transición breve en cambio de estado (0→>0), no loop perpetuo
- Agregar `@media (prefers-reduced-motion: reduce)` para suprimir cualquier animación restante

### 1.3 Protección de datos en formulario de producto

**Archivos:**
- `app/dashboard/inventory/page.tsx`

**Qué hacer:**
- Agregar estado `isDirty` que compare valores del formulario con el estado inicial vacío
- En `onOpenChange` del Dialog, si `isDirty` es true, mostrar confirmación: "¿Descartar cambios? Los datos ingresados se perderán."
- Solo el botón "Cancelar" del diálogo de confirmación debe resetear sin preguntar

### 1.4 Error silencioso en fetch de proveedores

**Archivos:**
- `app/dashboard/inventory/page.tsx`

**Qué hacer:**
- Reemplazar `.catch(() => {})` (línea 58) con:
  - Toast de error: "Error al cargar proveedores"
  - Estado local `suppliersError` para mostrar mensaje inline en el select
  - Botón de reintento

---

## Fase 2: Consistencia del Sistema de Diseño (P2-P3)

### 2.1 Unificar estilos de badges en tabs

**Archivos:**
- `app/dashboard/inventory/page.tsx`

**Qué hacer:**
- Badge "Bajo Stock" (línea 293) usa `variant="destructive"` — correcto
- Badge "Por Vencer" (línea 306) usa clases inline `border-orange-500 text-orange-600` — migrar a variante `warning` del Badge
- Si no existe variante `warning`, crearla en `components/ui/badge.tsx`

### 2.2 Columna condicional "Stock Actual"

**Archivos:**
- `app/dashboard/inventory/page.tsx`

**Qué hacer:**
- Renderizar siempre la columna Stock Actual
- Sin sucursal seleccionada: mostrar "—" o "N/A"
- Eliminar condicional en header (línea 343) y en body (línea 386-392)
- Simplificar `colSpan` en empty state (línea 350)

### 2.3 Reemplazar `text-[10px]` por tokens del sistema

**Archivos:**
- `app/dashboard/inventory/page.tsx` (líneas 293, 306)
- `app/dashboard/inventory/invoices/page.tsx` (líneas 913, 917)
- `app/dashboard/inventory/reports/page.tsx` (líneas 376, 537)
- `components/inventory/dashboard-kpis.tsx` (líneas 119, 134)
- `components/inventory/product-detail-drawer.tsx` (líneas 175, 183)

**Qué hacer:**
- Reemplazar `text-[10px]` con la clase más cercana del type ramp: `text-xs` (12px) o crear un token `text-2xs` si 10px es intencional
- Actualizar DESIGN.md si se agrega un nuevo escalón al type ramp

### 2.4 Label duplicado en product-photo-upload

**Archivos:**
- `components/inventory/product-photo-upload.tsx`

**Qué hacer:**
- Eliminar definición inline de Label (línea ~109)
- Importar `Label` desde `@/components/ui/label`

---

## Fase 3: Onboarding y Estados Vacíos (P2)

### 3.1 Acciones en empty states

**Archivos:**
- `app/dashboard/inventory/page.tsx`

**Qué hacer:**
- Empty state de productos vacío (línea 358): agregar `action` prop con botón "Agregar Producto" que abra el diálogo
- Empty state por búsqueda sin resultados (línea 352): agregar "Limpiar búsqueda"

### 3.2 QuickAlerts sin CTA

**Archivos:**
- `components/inventory/quick-alerts.tsx`

**Qué hacer:**
- Estados "Sin alertas" (líneas 41-43, 68-70): agregar link a la página completa de alertas

---

## Fase 4: Arquitectura de Información (P1)

### 4.1 Jerarquía en el hub de operaciones

**Archivos:**
- `app/dashboard/inventory/page.tsx`

**Qué hacer:**
- Identificar top-3 operaciones de mayor frecuencia (Recepción, Conteo, Órdenes de Compra)
- Promoverlas visualmente: cards ligeramente más grandes o sección destacada
- Mover operaciones de baja frecuencia (Recetas, Proveedores) a fila secundaria o menú "Más"
- Reducir de 8 a 5-6 cards visibles

---

## Fase 5: Módulo de Transferencias

### 5.1 Adoptar PageHeader + PageContainer

**Archivos:**
- `app/dashboard/inventory/transfers/page.tsx`

**Qué hacer:**
- Reemplazar `<div className="container mx-auto py-6 space-y-6">` por `PageContainer`
- Agregar `PageHeader` con título "Transferencias", icono `ArrowRight`, descripción, branch name
- Agregar botón "Solicitar Transferencia" como action del header

### 5.2 Integrar TransferRequest en la página

**Archivos:**
- `app/dashboard/inventory/transfers/page.tsx`
- `components/inventory/transfer-list.tsx`

**Qué hacer:**
- En `page.tsx`, importar y renderizar `TransferRequest` pasándole `branches={allBranches}`
- Trigger del diálogo desde el botón en PageHeader actions

### 5.3 Filtro por rol (origen vs destino)

**Archivos:**
- `components/inventory/transfer-list.tsx`

**Qué hacer:**
- Agregar state `roleFilter: 'from' | 'to' | 'both'` (default: 'both')
- Agregar tabs o toggle para cambiar el role
- Pasar `role` a la API (`/api/inventory/transfers?role=${roleFilter}`)
- Separar lógica de "Pendientes" (origen) vs "Por Aprobar" (destino) según el role activo

### 5.4 Estado vacío enseñante

**Archivos:**
- `components/inventory/transfer-list.tsx`

**Qué hacer:**
- Reemplazar `Alert` con "No hay transferencias en esta categoría" por `EmptyState` del design system
- Incluir acción "Solicitar primera transferencia" en el empty state

### 5.5 Número de transferencia legible

**Archivos:**
- `lib/services/inventory-service.ts` (línea 263)

**Qué hacer:**
- Reemplazar `TRF-{Date.now()}-{random}` por formato secuencial: `TRF-{año}{mes}-{correlativo}` ej: `TRF-202607-0001`
- Requiere agregar columna `sequentialNumber` o consultar COUNT del mes

### 5.6 Branch Context en transfers

**Archivos:**
- `app/dashboard/inventory/transfers/page.tsx`

**Qué hacer:**
- Usar `useBranch()` en lugar de `(session.user as any).branchId`
- Pasar `selectedBranchId` a `TransferList`

---

## Fase 6: Claridad de Copia

### 6.1 Reemplazar jerga inglesa/técnica

**Archivos:**
- `components/inventory/dashboard-kpis.tsx`
- `components/inventory/quick-alerts.tsx`
- `app/dashboard/inventory/page.tsx`

**Qué hacer:**
| Término actual | Reemplazo sugerido |
|---|---|
| "3-Way Match" | "Conciliación de Facturas" |
| "Efectividad 3-Way Match" | "Facturas Conciliadas" |
| "Conteo Ciego" | "Conteo sin Stock Esperado" |
| "Recepción Física" | "Recepción" |
| "Merma / Consumo" | "Mermas y Consumos" |
| "BOM" | "Fórmulas" |
| "Ratio de Pérdidas por Merma" | "Pérdida por Merma" |

---

## Prioridad de Ejecución

```
Fase 1 (confianza) ─────── → pnpm run build ✓
Fase 2 (consistencia) ──── → pnpm run build ✓
Fase 5 (transferencias) ── → pnpm run build ✓
Fase 3 (onboarding) ────── → pnpm run build ✓
Fase 4 (IA) ────────────── → pnpm run build ✓
Fase 6 (copia) ─────────── → pnpm run build ✓
                            → pnpm run lint ✓
```

Cada fase puede ejecutarse independientemente. Recomiendo orden F1 → F5 → F2 → F3 → F6 → F4, priorizando confianza y transferencias antes de pulido fino.

---

Archivo generado por `/impeccable critique` + análisis manual.
Última actualización: 2026-07-25
