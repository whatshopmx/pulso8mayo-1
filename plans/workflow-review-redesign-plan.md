# 📋 Plan de Implementación: Rediseño del Módulo de Revisión de Workflows

**Objetivo:** Elevar el módulo de revisión de workflows (`app/dashboard/workflows/review`) a los estándares del Design System de Pulso HORECA (`DESIGN.md` y `PRODUCT.md`), eliminando la confusión semántica de colores, mejorando la densidad de información ("Command Center") y optimizando el flujo de trabajo para administradores de cadenas HORECA.

---

## 🎯 Cambios Clave y Metas

1. **Corrección Semántica de Colores:**
   - El estado `COMPLETED` ya no usará la variante `default` (Rojo Operativo). Usará verde semántico de éxito.
   - Los botones de acción (**Aprobar** / **Rechazar**) tendrán intenciones cromáticas claras y consistentes en diálogos y tarjetas.
2. **Des-cluttering de Interfaz (Eliminación de "Card Soup"):**
   - Sustituir las tarjetas anidadas por cada paso (`Card` dentro de `Card`) por una lista limpia con divisores tonales (`divide-y divide-border`), reduciendo el ruido visual.
3. **Indicadores de Interacción & Unificación de Galería:**
   - Agregar iconos explícitos de despliegue (`ChevronDown`) con rotación animada en cada paso del checklist.
   - Unificar los clicks de imágenes dentro del detalle de pasos para abrir el modal preexistente (`setSelectedImage`) en lugar de pestañas en blanco.
4. **Filtro Operativo "Fallas AI / Por Revisar":**
   - Agregar una pestaña adicional en las Tabs de pasos para filtrar directamente los pasos que requieran atención manual o fallaron en la verificación AI.
5. **Barra Flotante/Sticky de Acciones Rápida:**
   - Permitir a los supervisores aprobar o rechazar workflows largos sin necesidad de desplazarse hasta el fondo de la página.
6. **Alineación con Tokens de Diseño OKLCH:**
   - Reemplazar colores Tailwind hardcodeados (`bg-green-50`, `border-red-200`) por tokens semánticos compatibles con modo claro y oscuro.

---

## 🗂️ Archivos a Modificar

- `C:\Users\david\pulso29\components\workflow\workflow-review.tsx` (Componente principal)
- `C:\Users\david\pulso29\app\dashboard\workflows\review\[id]\page.tsx` (Página contenedora)

---

## 🚀 Fases de Ejecución

### Fase 1: Corrección de Badges y Botones Semánticos
- [ ] Modificar el Badge de estado en el resumen del workflow y en `StepDetail`:
  - `COMPLETED` -> Variante Verde de Éxito (`bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20`).
  - `REJECTED` / `FAILED` -> Variante Destructiva / Rojo Operativo.
- [ ] Ajustar la variaciones de botones en el footer de revisión y modal:
  - Botón **Aprobar**: Variante primaria/éxito clara.
  - Botón **Rechazar**: Variante `destructive` u `outline` destructiva según contexto.

### Fase 2: Rediseño de Lista de Pasos ("Flat-by-Default")
- [ ] Eliminar `<Card>` wrapper individual en el componente `StepDetail`.
- [ ] Implementar contenedor de lista unificada:
  ```tsx
  <div className="rounded-lg border border-border bg-card divide-y divide-border overflow-hidden">
    {steps.map(...)}
  </div>
  ```
- [ ] Agregar icono `<ChevronDown>` de Lucide React con rotación CSS (`transition-transform duration-200 rotate-180`).

### Fase 3: Unificación del Visor de Evidencias y Modal Lightbox
- [ ] Pasar la función `onSelectImage` desde `WorkflowReview` hacia `StepDetail`.
- [ ] Reemplazar `window.open(url, '_blank')` en el detalle de pasos por `onSelectImage(url)`.
- [ ] Agregar fallback `onError` básico en etiquetas `<img>` de evidencias por si la imagen tarda en cargar de Cloudflare R2.

### Fase 4: Optimización Operativa HORECA (Filtro AI & Sticky Actions)
- [ ] Agregar pestaña en `TabsList`:
  - `Todos`
  - `Fallas / Por Revisar` *(Pasos con AI fail o comentarios)*
  - `Con Evidencia`
  - `AI Verified`
- [ ] Añadir barra de acciones rápida sticky en la parte inferior o cabecera para revisión inmediata.

### Fase 5: Validación y Testing E2E
- [ ] Probar compilación con `pnpm run build` para asegurar TypeScript strictness.
- [ ] Verificar compatibilidad en modo claro y oscuro (`dark:` variants).
- [ ] Ejecutar suites de prueba locales si aplica (`pnpm test:e2e`).

---

## 📊 Criterios de Aceptación
1. 🟢 Ningún estado `COMPLETED` se renderiza en Rojo Operativo.
2. 🟢 Los pasos colapsables muestran claramente un icono indicador de acordeón (`ChevronDown`).
3. 🟢 Las evidencias en cualquier sección abren el modal nativo de vista previa con opción de descarga.
4. 🟢 La pestaña "Fallas / Por Revisar" filtra de forma precisa los pasos con inconsistencias.
5. 🟢 `pnpm run build` compila sin ningún error de TypeScript ni sintaxis.
