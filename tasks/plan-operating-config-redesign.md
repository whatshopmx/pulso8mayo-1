# Implementation Plan: Rediseño Integral de Configuración del Modelo Operativo

## Overview
Rediseñar la pantalla de Configuración del Modelo Operativo (`/dashboard/company/operating-config`) para transformarla de un formulario administrativo plano con sobrecarga cognitiva a un centro de comando directivo de primer nivel. El rediseño elimina jerga interna/de especificación (`Fase 11`, `§2`, `loteprod §8.1`), sustituye 7 dropdowns por tarjetas segmentadas con impacto operativo, dota a los semáforos de Food/Labor Cost de indicadores visuales interactivos de rango cromático, formatea montos monetarios con máscaras y añade una barra flotante de guardado con detección de cambios (*dirty state*).

---

## Dependency Graph

```
[Page Skeleton & Presets Engine]
        │
        ├── [7 Structural Dimensions Segmented Cards (Operación / Tesorería / Gobernanza)]
        │       │
        ├── [Financial Thresholds with Currency Format & Clean Copy]
        │       │
        ├── [Cost KPI Targets with Live Visual Spectrum Gauges]
        │       │
        └── [Sticky Action Bar with Dirty State & Revert Control]
                │
                └── [End-to-End Build & Design Detector Audit]
```

---

## Architecture Decisions

1. **Subcomponentes modulares**: Desacoplar `OperatingConfigForm` en secciones enfocadas (`OperatingDimensionsSection`, `FinancialThresholdsSection`, `CostTargetsSection`, `OperatingConfigStickyBar`, `OperatingConfigSkeleton`) para facilitar mantenimiento y pruebas.
2. **Preservación estricta de la API**: Mantener al 100% el contrato JSON con `GET` y `PUT /api/company/operating-config` (conversión de centavos/pesos, validación cruzada de parejas de porcentajes).
3. **Segmented Option Cards**: En lugar de `<Select>`, usar botones/tarjetas segmentadas accesibles con radio semantics (`role="radiogroup"` o Shadcn `ToggleGroup`) para mostrar todas las opciones operativas de un vistazo.
4. **Barras de espectro cromático en tiempo real**: Implementar un componente puramente visual en CSS/SVG para `TargetPair` que ilustre la distribución de zonas verde/amarilla/roja a medida que el usuario ajusta los números.
5. **Detección de cambios (Dirty State)**: Comparar el estado actual del formulario contra `initialConfig` para activar la barra sticky de guardado solo cuando existan diferencias reales, permitiendo "Descartar cambios".

---

## Task Breakdown

### Phase 1: Header, Skeleton Loader & Presets Engine

#### Task 1: Limpieza de Header, Skeleton Loader y Selector de Arquetipos Preconfigurados
- **Description:** Limpiar el título y descripción de la página eliminando `(Fase 11)` y textos de especificación. Implementar un esqueleto de carga elegante (`OperatingConfigSkeleton`) que reemplace el spinner genérico. Crear un selector de 3 arquetipos HORECA (*"Grupo Corporativo Centralizado"*, *"Franquicia con Comisariato"*, *"Operación Independiente Descentralizada"*) que pre-llene las 7 dimensiones con un solo clic.
- **Acceptance criteria:**
  - [ ] El título principal es "Modelo Operativo del Grupo" sin etiquetas de fases ni jerga interna.
  - [ ] Durante `loading === true`, se muestra un layout de esqueleto completo que coincide con la estructura de tarjetas.
  - [ ] El selector de arquetipos permite aplicar preajustes a las 7 dimensiones sin enviar a backend hasta que el usuario decida guardar.
- **Verification:**
  - [ ] Build succeeds: `pnpm run build`
  - [ ] Manual check: Verificar estado de carga y aplicación de presets en navegador.
- **Dependencies:** None
- **Files likely touched:**
  - `app/dashboard/company/operating-config/page.tsx`
  - `components/company/operating-config-skeleton.tsx` [NEW]
  - `components/company/operating-config-presets.tsx` [NEW]
- **Estimated scope:** Small (2-3 files)

---

### Phase 2: Estructura Operativa y Umbrales Financieros

#### Task 2: Rediseño de las 7 Dimensiones en Tarjetas Segmentadas por Dominio
- **Description:** Reemplazar los 7 dropdowns por grupos de tarjetas de selección segmentada organizadas en 3 categorías lógicas: (1) *Operación & Cocina* (Compras, Producción), (2) *Tesorería & Finanzas* (Cuentas, Pagos, Nómina), y (3) *Gobernanza & Estructura* (Autonomía, Tipo de Tenant). Cada opción debe mostrar su nombre claro y un badge de impacto operativo breve (ej. "Aprobación centralizada", "In situ"). Corregir typo "Misas de compra" por "Mesas de compra".
- **Acceptance criteria:**
  - [ ] Los 7 campos usan tarjetas segmentadas con estado activo destacado (borde primary/accent y fondo suave).
  - [ ] Las dimensiones están agrupadas en 3 categorías visuales claras con cabeceras secundarias.
  - [ ] Se elimina la cita `(§2)` del título de la tarjeta.
  - [ ] Soporta navegación completa por teclado (Tab y flechas/espacio).
- **Verification:**
  - [ ] Build succeeds: `pnpm run build`
  - [ ] Manual check: Selección rápida de dimensiones y cambio de estados visuales.
- **Dependencies:** Task 1
- **Files likely touched:**
  - `components/company/operating-dimensions-section.tsx` [NEW]
  - `components/company/operating-config-form.tsx`
- **Estimated scope:** Medium (2 files)

#### Task 3: Rediseño de Umbrales Financieros con Formato de Moneda y Redacción Limpia
- **Description:** Reestructurar la sección de umbrales en una cuadrícula equilibrada de 2 columnas. Formatear visualmente los montos con prefijo `$`, sufijo `MXN` y separadores de miles. Limpiar todos los textos de ayuda eliminando citas de especificación (`loteprod §8.1`) y reformulando el umbral de doble aprobación sin disculpas técnicas ("Gastos a partir de este monto requieren autorización de Dirección General / Dueño"). Eliminar clases hardcodeadas como `text-emerald-600` en favor de tokens semánticos.
- **Acceptance criteria:**
  - [ ] Los inputs monetarios muestran adornos de divisa (`$` y `MXN`) y formateo numérico legible.
  - [ ] No existen referencias a números de sección de especificación en títulos o textos de ayuda.
  - [ ] La cuadrícula de campos está perfectamente balanceada sin elementos huérfanos.
  - [ ] Los iconos usan tokens de diseño estándar.
- **Verification:**
  - [ ] Build succeeds: `pnpm run build`
  - [ ] Manual check: Captura de montos altos ($1,000,000) y verificación de conversión centavos/pesos.
- **Dependencies:** Task 1
- **Files likely touched:**
  - `components/company/financial-thresholds-section.tsx` [NEW]
  - `components/company/operating-config-form.tsx`
- **Estimated scope:** Small (2 files)

---

### Checkpoint 1: Dimensiones y Umbrales
- [ ] La estructura de 7 dimensiones y umbrales financieros renderiza limpiamente sin errores de consola.
- [ ] `pnpm run build` pasa sin advertencias ni errores de tipos.

---

### Phase 3: Semáforos de Costos y Barra de Acciones

#### Task 4: Medidores de Espectro Cromático en Tiempo Real para Objetivos de Costo
- **Description:** Mejorar el componente `TargetPair` agregando una barra de espectro visual (gauge horizontal) debajo de cada par de métricas (Food Cost, Labor Cost, Margen). La barra debe renderizar visualmente las proporciones de las zonas Verde (Óptimo), Amarilla (Precaución) y Roja (Crítico) según los porcentajes ingresados, respetando la lógica invertida del margen (donde mayor es mejor).
- **Acceptance criteria:**
  - [ ] Cada par de KPI muestra una barra de rango interactiva con los tramos verde, amarillo y rojo.
  - [ ] Para Food Cost y Labor Cost: 0% a Objetivo = Verde, Objetivo a Precaución = Amarillo, > Precaución = Rojo.
  - [ ] Para Margen: 100% a Objetivo = Verde, Objetivo a Precaución = Amarillo, < Precaución = Rojo.
  - [ ] Si la combinación de valores es inválida, la barra refleja el estado de error y se resalta el mensaje de alerta.
- **Verification:**
  - [ ] Build succeeds: `pnpm run build`
  - [ ] Manual check: Modificar porcentajes y confirmar que la barra se recalibra dinámicamente.
- **Dependencies:** Task 1
- **Files likely touched:**
  - `components/company/cost-targets-section.tsx` [NEW]
  - `components/company/operating-config-form.tsx`
- **Estimated scope:** Small (2 files)

#### Task 5: Barra de Guardado Sticky con Detección de Cambios (*Dirty State*) y Descartar
- **Description:** Implementar una barra de acción inferior flotante (*sticky bottom bar*) que aparezca suavemente cuando el usuario haya modificado algún valor respecto a la configuración inicial. Incluir botón "Descartar cambios" (que restaura los valores iniciales) y botón "Guardar configuración" con estado de carga claro.
- **Acceptance criteria:**
  - [ ] La barra de guardado se fija en la parte inferior de la ventana cuando hay cambios pendientes (`isDirty`).
  - [ ] El botón "Descartar cambios" restablece el formulario a su estado original sin recargar la página.
  - [ ] El botón de guardar se desactiva si hay errores de validación en los porcentajes o si no hay cambios pendientes.
  - [ ] El guardado exitoso muestra el toast de confirmación y resetea el estado dirty.
- **Verification:**
  - [ ] Build succeeds: `pnpm run build`
  - [ ] Manual check: Probar flujo de edición, descarte y guardado en pantalla completa y responsive.
- **Dependencies:** Tasks 2, 3, 4
- **Files likely touched:**
  - `components/company/operating-config-sticky-bar.tsx` [NEW]
  - `components/company/operating-config-form.tsx`
- **Estimated scope:** Small (2 files)

---

### Phase 4: Auditoría y Verificación de Calidad

#### Task 6: Auditoría de Tokens OKLCH, Accesibilidad y Verificación Final
- **Description:** Ejecutar escaneo del detector de diseño (`detect.mjs`), verificar conformidad de contraste, navegación por teclado completa (`Tab`, `Space`, `Enter`), soporte para modo claro/oscuro con variables OKLCH, y validar la construcción de producción de Next.js.
- **Acceptance criteria:**
  - [ ] `node .agents/skills/impeccable/scripts/detect.mjs --json app/dashboard/company/operating-config components/company/` retorna 0 errores.
  - [ ] `pnpm run build` compila con éxito.
  - [ ] Re-evaluación con `$impeccable critique` muestra incremento de puntaje de salud de diseño (>34/40, banda *Good* o *Excellent*).
- **Verification:**
  - [ ] `node .agents/skills/impeccable/scripts/detect.mjs --json app/dashboard/company/operating-config`
  - [ ] `pnpm run build`
- **Dependencies:** Tasks 1-5
- **Files likely touched:**
  - `app/dashboard/company/operating-config/page.tsx`
  - `components/company/operating-config-form.tsx`
- **Estimated scope:** Small (1-2 files)

---

### Checkpoint 2: Final Review
- [ ] Todos los criterios de aceptación cumplidos.
- [ ] Cero regresiones en la API `/api/company/operating-config`.
- [ ] Código listo para producción.

---

## Risks and Mitigations

| Riesgo | Impacto | Estrategia de Mitigación |
| :--- | :---: | :--- |
| **Pérdida de sincronización entre centavos y pesos** | Alto | Mantener helpers puros de conversión bidireccional (`centsToPesos`, `pesosToCents`) con pruebas unitarias/verificaciones. |
| **Inversión lógica en cálculo de margen** | Medio | Función modular pura que calcule las zonas del espectro visual según la polaridad de la métrica (`isHigherBetter`). |
| **Salto de layout en barra sticky** | Bajo | Utilizar `position: sticky` con compensación de padding inferior (`pb-24`) en el contenedor principal. |

---

## Open Questions
- ¿Deseas que los 3 arquetipos preconfigurados incluyan también sugerencias de umbrales monetarios por defecto (ej. Franquicia con umbral más estricto vs Corporativo), o únicamente las 7 dimensiones estructurales? *(Recomendación: pre-llenar las 7 dimensiones y dejar los montos en sus defaults para que el usuario los ajuste)*.
