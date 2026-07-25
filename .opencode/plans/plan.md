# Implementation Plan: Integración Template Conteo Inventario

## Overview

Integrar completamente `templates/inventory/conteo-inventario-v1.json` con los componentes de stock count (`app/dashboard/inventory/stock-count/`) y `InventoryService` (`lib/services/inventory-service.ts`). Actualmente el template está registrado y el flujo principal funciona, pero la verificación AI del paso fotográfico (`foto-estanteria-ai`) nunca se ejecuta por un bug en la ruta de acceso a `aiVerification`, hay lógica duplicada de generación de pasos, y metadata del template (aiConfig, complianceConfig, completionActions) no se aprovecha.

## Architecture Decisions

- **Fix runtime path `config.aiVerification` → `aiVerification`**: El tipo `WorkflowStep` define `aiVerification` como propiedad de primer nivel, no dentro de `config`. El runtime (workflow-execution-service.ts) revisa `config.aiVerification`, que nunca está poblado. Se corrige revisando top-level con fallback a config.
- **Extraer generación de pasos compartida**: En lugar de tener `StockCountService.createStockCountInstance` y `WorkflowExecutionService.createExecution` con lógica duplicada, se extrae un método `generateStockCountSteps()` que ambas rutas usan.
- **Preservar `{value, label}` en confirm-count**: No se cambia `normalizeOptions` global (rompería otros templates). Se maneja específicamente en el contexto del stock count preservando el valor del template original.
- **Template metadata**: Se pasa `aiConfig`, `complianceConfig`, `completionActions` como metadata del template en la instancia de workflow.

## Task List

### Phase 1: AI Verification Fixes

- [ ] Task 1: Corregir ruta de acceso a aiVerification en runtime
- [ ] Task 2: Normalizar threshold → confidenceThreshold en ingestión del template

### Checkpoint: AI Verification
- [ ] Verificar que `aiVerification` en paso `foto-estanteria-ai` es detectado por `updateStep()`
- [ ] Build pasa sin errores

### Phase 2: Unificación

- [ ] Task 3: Consolidar generación de pasos de stock count en un solo método compartido

### Checkpoint: Unificación
- [ ] Ambas rutas de entrada (stock-count page y general workflow API) generan los mismos pasos
- [ ] El paso `foto-estanteria-ai` está incluido en ambas
- [ ] Build pasa sin errores

### Phase 3: Polish

- [ ] Task 4: Preservar valores estables (yes/no) en confirm-count
- [ ] Task 5: Almacenar metadata del template (aiConfig, complianceConfig, completionActions) en la instancia

### Checkpoint: Complete
- [ ] Todos los acceptance criteria cumplidos
- [ ] Build: `pnpm run build`
- [ ] Lint: `pnpm run lint`

## Task Details

### Task 1: Fix aiVerification lookup path

**Description:** En `WorkflowExecutionService.updateStep()` (línea 225), se revisa `currentStepDef?.config?.aiVerification?.enabled` pero el template normalizado coloca `aiVerification` al primer nivel del step. Corregir para que revise ambos niveles.

**Acceptance criteria:**
- [ ] `updateStep()` detecta correctamente `aiVerification.enabled` cuando está al primer nivel del step definition
- [ ] Backward compatibility: sigue funcionando si `aiVerification` está dentro de `config`
- [ ] Al completar el paso `foto-estanteria-ai`, se ejecuta `AIService.verifyPhoto()`

**Files:**
- `lib/services/workflow-execution-service.ts` (líneas 225, 245)

**Estimated scope:** Small (1 file)

---

### Task 2: Normalize threshold → confidenceThreshold

**Description:** El template usa `threshold` pero el tipo `AIVerification` espera `confidenceThreshold`. Agregar mapeo en `normalizeTemplate` de `templates/index.ts`.

**Acceptance criteria:**
- [ ] `aiVerification.confidenceThreshold` se puebla correctamente desde el `threshold` del JSON
- [ ] No se pierde el valor original

**Files:**
- `templates/index.ts` (en `normalizeTemplate`)

**Estimated scope:** XS (1 file)

---

### Task 3: Consolidate stock count step generation

**Description:** Actualmente hay dos implementaciones separadas que generan pasos para stock count:
1. `StockCountService.createStockCountInstance()` — incluye `foto-estanteria-ai` del template
2. `WorkflowExecutionService.createExecution()` — NO incluye foto (steps hardcodeados)

Extraer un método `StockCountService.generateStockCountSteps()` compartido que use el template normalizado y sea llamado por ambas rutas.

**Acceptance criteria:**
- [ ] `StockCountService.createStockCountInstance()` usa el nuevo método compartido
- [ ] `WorkflowExecutionService.createExecution()` usa el nuevo método compartido (en lugar del bloque hardcodeado)
- [ ] El paso `foto-estanteria-ai` con su `aiVerification` se incluye en ambas rutas
- [ ] Los pasos dinámicos `count-{id}` se generan igual que antes
- [ ] No hay regresión en el flujo existente

**Files:**
- `lib/services/stock-count-service.ts`
- `lib/services/workflow-execution-service.ts`

**Estimated scope:** Medium (2-3 files)

---

### Task 4: Preserve stable values in confirm-count

**Description:** `normalizeOptions` aplana `[{value: "yes", label: "Sí, confirmar..."}]` a `["Sí, confirmar..."]`, perdiendo el value estable. La verificación de confirmación depende de substring matching frágil. Se preserva la estructura `{value, label}` para el paso confirm-count.

**Acceptance criteria:**
- [ ] El paso `confirm-count` preserva sus `{value, label}` como estructura
- [ ] `completeStockCount()` y `checkProgress()` verifican contra `value === "yes"` en lugar de substring
- [ ] Las opciones en UI se muestran con el label correcto

**Files:**
- `lib/services/stock-count-service.ts`
- `lib/services/workflow-execution-service.ts`
- `lib/workflow-type-map.ts` (opcional)

**Estimated scope:** Small (2-3 files)

---

### Task 5: Store template metadata on instance

**Description:** El template define `aiConfig`, `complianceConfig`, y `completionActions` que no se persisten en la instancia. Almacenarlos como parte del `data` de la instancia.

**Acceptance criteria:**
- [ ] `template.aiConfig` se almacena en `instance.data.aiConfig`
- [ ] `template.complianceConfig` se almacena en `instance.data.complianceConfig`
- [ ] `template.completionActions` se almacena en `instance.data.completionActions`

**Files:**
- `lib/services/stock-count-service.ts`

**Estimated scope:** Small (1 file)

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Task 3: Cambiar `createExecution` afecta otros flujos | High | Cambio específico a stock count (`STOCK_COUNT_TEMPLATE_NAME`) |
| Task 4: Options format change rompe renderizado | Medium | Verificar que el executor maneje `{value, label}` además de `string[]` |
| Task 1: Backward compatibility | Low | Fallback explícito: top-level, luego config |

## Open Questions

- [ ] ¿El `WorkflowStepper` y `WorkflowExecutor` manejan `options` como `[{value, label}]` además de `string[]`? (Verificar en Task 4)
- [ ] ¿Hay tests E2E que cubran el flujo de stock count?
