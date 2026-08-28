# Task List: Rediseño Integral de Configuración del Modelo Operativo

## Phase 1: Header, Skeleton Loader & Presets Engine
- [x] **Task 1: Limpieza de Header, Skeleton Loader y Selector de Arquetipos Preconfigurados**
  - [x] Limpiar título y subtítulo en `page.tsx` eliminando `(Fase 11)` y jerga interna.
  - [x] Crear `components/company/operating-config-skeleton.tsx` para una carga fluida.
  - [x] Crear `components/company/operating-config-presets.tsx` con 3 arquetipos HORECA.
  - [x] Verificar estado de carga y renderizado de presets.

## Phase 2: Estructura Operativa y Umbrales Financieros
- [x] **Task 2: Rediseño de las 7 Dimensiones en Tarjetas Segmentadas por Dominio**
  - [x] Crear `components/company/operating-dimensions-section.tsx`.
  - [x] Agrupar dimensiones en: *Operación & Cocina*, *Tesorería & Finanzas*, y *Gobernanza*.
  - [x] Convertir los 7 dropdowns en tarjetas segmentadas con badges de impacto operativo.
  - [x] Corregir typo "Misas de compra" por "Mesas de compra".
  - [x] Asegurar navegación completa por teclado y accesibilidad.
- [x] **Task 3: Rediseño de Umbrales Financieros con Formato de Moneda y Redacción Limpia**
  - [x] Crear `components/company/financial-thresholds-section.tsx`.
  - [x] Reestructurar a cuadrícula de 2 columnas balanceada.
  - [x] Formatear inputs con prefijo `$`, sufijo `MXN` y separadores de miles.
  - [x] Limpiar textos de ayuda (remover `loteprod §8.1` y reformular disculpas de doble firma).
  - [x] Reemplazar clases como `text-emerald-600` por tokens OKLCH del sistema.

## Checkpoint 1: Dimensiones y Umbrales
- [x] Compilación limpia con `pnpm run build`.
- [x] Interacción fluida de selección y edición de umbrales.

## Phase 3: Semáforos de Costos y Barra de Acciones
- [x] **Task 4: Medidores de Espectro Cromático en Tiempo Real para Objetivos de Costo**
  - [x] Crear `components/company/cost-targets-section.tsx` con medidor visual de espectro cromático en `TargetPair`.
  - [x] Implementar visualización en tiempo real de zonas verde/amarilla/roja para Food Cost y Labor Cost.
  - [x] Implementar visualización de zonas para Margen Saludable (lógica invertida: mayor es mejor).
  - [x] Reflejar alertas visuales cuando las combinaciones sean inválidas.
- [x] **Task 5: Barra de Guardado Sticky con Detección de Cambios (*Dirty State*) y Descartar**
  - [x] Crear `components/company/operating-config-sticky-bar.tsx`.
  - [x] Implementar comparador de estado inicial vs. actual para calcular `isDirty`.
  - [x] Agregar botón "Descartar cambios" que restaura el estado original.
  - [x] Agregar botón "Guardar configuración" con estados de guardado y feedback por toast.
  - [x] Conectar todo el flujo en `OperatingConfigForm`.

## Phase 4: Auditoría y Verificación de Calidad
- [x] **Task 6: Auditoría de Tokens OKLCH, Accesibilidad y Verificación Final**
  - [x] Ejecutar `node .agents/skills/impeccable/scripts/detect.mjs --json app/dashboard/company/operating-config components/company/`.
  - [x] Ejecutar `pnpm run build` para validar cero errores de tipado.
  - [x] Enforzar la regla `The Label-Floor Rule` (text-xs / 12px) en todos los componentes.

## Checkpoint 2: Final Review
- [x] Todos los criterios de aceptación completados.
- [x] Contrato de API verificado y sin regresiones.
- [x] Archivos listos para producción.
