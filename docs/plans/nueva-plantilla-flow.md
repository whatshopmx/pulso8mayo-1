# Plan: Flujo de "Nueva Plantilla" — De lienzo vacío a selector de plantillas

## Problema

Cuando un usuario da clic en "Nueva Plantilla" en el Template Manager, se crea un template vacío y se redirige inmediatamente al editor con 0 pasos, mostrando un canvas que dice "Selecciona un componente de la izquierda para comenzar." Esto contradice el thesis de producto "compliance as a byproduct" — la primera experiencia no conecta al usuario con el valor del producto.

Paralelamente, la librería `templates/` ya tiene **15+ plantillas** listas para usar (NOM-251, NOM-035, onboarding, inventario, etc.) pero están a un tab de distancia ("Catálogo Pulso").

## Cambios propuestos

### 1. Nuevo diálogo "Empezar desde una plantilla"

Cuando el usuario da clic en "Nueva Plantilla", en vez de redirigir al editor vacío, se muestra un **modal/diálogo** con opciones:

```
┌─────────────────────────────────────────────────┐
│  Nueva Plantilla                                 │
│                                                  │
│  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Empezar desde │  │ Recomendados para ti     │  │
│  │ cero          │  │                           │  │
│  │               │  │ 🌡️ Control de Temperaturas│  │
│  │ Lienzo vacío  │  │ 🧼 Control de Higiene    │  │
│  │ para diseñar  │  │ 📋 Recepción de Mercancía│  │
│  │ desde cero    │  │ 🔍 Inspección de Alimentos│  │
│  │               │  │                           │  │
│  │ [Crear vacío] │  │ [Usar] [Usar] [Usar] ... │  │
│  └──────────────┘  └──────────────────────────┘  │
│                                                  │
│  ─── Todas las categorías ─────────────────────  │
│                                                  │
│  ▼ Compliance (4)               [Ver todo ▸]     │
│  ▼ Control de Calidad (4)       [Ver todo ▸]     │
│  ▼ Recursos Humanos (1)         [Ver todo ▸]     │
│  ...                                             │
└─────────────────────────────────────────────────┘
```

**Comportamiento:**
- "[Crear vacío]" → flujo actual (crea POST, redirige a editor vacío)
- "[Usar]" en una plantilla → clona la plantilla via POST, redirige al editor con pasos precargados
- Las secciones "Recomendados" priorizan templates con `complianceConfig.criticalForCompliance === true`
- Las categorías se pueden expandir/colapsar

### 2. Canvas empty state mejorado

Cuando el canvas está vacío y el usuario está en modo "desde cero", cambiar el mensaje actual:

**Antes:**
> "Selecciona un componente de la izquierda para comenzar."

**Después:**
> "Tu flujo está vacío. Usa una **plantilla pre-hecha** desde el menú o agrega pasos desde la caja de herramientas."

Con un enlace/botón "Usar plantilla →" que abre el mismo diálogo del punto 1.

### 3. Mover `onboardingTemplate` inline a la librería

El objeto `onboardingTemplate` en `template-manager.tsx:187-214` es una versión simplificada (3 pasos) del onboarding de empleado. En lugar de tenerlo hardcodeado:

- Agregarlo como un template de catálogo bajo `templates/recursos_humanos/onboarding-rapido-v1.json`
- Registrarlo en `templates/index.ts` como `'onboarding-rapido-v1'`
- El botón "Onboarding Rápido" en el Template Manager simplemente clona este template en vez de tener la data inline

## Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `templates/recursos_humanos/onboarding-rapido-v1.json` | **CREAR** — los 3 pasos del inline object como JSON formal |
| `templates/index.ts` | **EDITAR** — importar y registrar `onboarding-rapido-v1` |
| `app/dashboard/builder/templates/template-manager.tsx` | **EDITAR** — reemplazar "Nueva Plantilla" flow con diálogo, reemplazar inline object con clon de catálogo |
| `components/builder/canvas.tsx` | **EDITAR** — mejorar empty state con link al diálogo |
| `app/dashboard/builder/editor/[id]/editor-client.tsx` | **EDITAR** — opcional: detectar pasos vacíos al cargar y ofrecer el diálogo |

## No tocar

- API routes (`/api/workflows/templates`, `/api/templates/:id`)
- DB schema
- Template execution engine
- Preview mode
- Toolbox, PropertyEditor, WorkflowSettingsModal, WorkflowPreviewModal
- Otros templates existentes (no se modifican, solo se referencian)

## Dependencias

- El POST de `/api/workflows/templates` ya acepta `steps` en el payload → funciona para clonar
- El `templateLibrary` ya está disponible en el frontend
- Los templates JSON ya tienen todos los campos normalizados por `normalizeTemplate()`

## Orden de implementación

1. Crear `templates/recursos_humanos/onboarding-rapido-v1.json` con los 3 pasos del inline object
2. Registrar en `templates/index.ts`
3. Implementar el diálogo "Empezar desde plantilla" en `template-manager.tsx`
4. Reemplazar el inline `onboardingTemplate` con clon desde catálogo
5. Mejorar canvas empty state
6. Verificar que el flujo completo funciona: Nueva Plantilla → diálogo → seleccionar → editor con pasos
