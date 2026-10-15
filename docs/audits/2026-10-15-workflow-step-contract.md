# Auditoría de Conexión: C24 — Validación del Contrato del Paso en Servidor (H08)

**Fecha:** 15 de octubre de 2026  
**Tarea:** C24 — Validar el contrato del paso en servidor  
**Fase:** Fase 4 — Calidad y Cumplimiento  
**Hallazgos atendidos:** H08 (Verificación de contrato de paso en servidor antes de persistencia en base de datos)  

---

## 1. Contexto y Problema

Antes de esta implementación, la integridad de las ejecuciones de checklists operativos y de calidad (NOM-251 / NOM-035) descansaba casi en su totalidad en validaciones de formulario del lado del cliente (`isStepCompleteable` en el navegador).

En el backend, la ruta `PATCH /api/workflows/executions/[id]/steps/[stepId]` y el método `WorkflowExecutionService.updateStep`:
1. **Persistían sin validar restricciones de campo:** Si un cliente enviaba un valor nulo para un paso obligatorio, omitía la fotografía requerida por la norma, o enviaba temperaturas fuera de rango físico/operativo (ej. 50°C en una cámara de refrigeración que exige entre 2°C y 8°C), el servidor escribía directamente en `workflow_instance_steps`.
2. **Permitían omisiones no autorizadas:** Cualquier usuario con acceso (incluyendo operadores de línea `EMPLEADO` o enlaces anónimos de Smart Links) podía enviar `{ status: "SKIPPED" }` en pasos críticos obligatorios sin dejar motivo operativo ni autorización de supervisión.
3. **No protegían flujos terminales ni pasos completados:** Si una ejecución ya estaba cerrada (`COMPLETED` o `CANCELLED`), o un paso ya había sido certificado, era posible sobrescribir los valores y volver a colocarlos en borrador o saltados.

---

## 2. Contrato de la Política Operativa

Se implementó el módulo puro `lib/workflows/step-contract-policy.ts` con la siguiente matriz de reglas:

### A. Transición de Estado y Autorización de Omisión
- **Instancia Terminal:** Si `instance.status` es `COMPLETED` o `CANCELLED`, se bloquea cualquier modificación con código `WORKFLOW_TERMINAL` (HTTP 409).
- **Paso ya completado:** Un paso en `COMPLETED` no puede revertirse a `IN_PROGRESS`, `PENDING` o `SKIPPED` (`STEP_ALREADY_COMPLETED`, HTTP 409).
- **Omisión (`SKIPPED`) de Pasos Obligatorios:**
  - Si el paso es obligatorio (`required: true`), sólo roles de supervisión (`SUPER_ADMIN`, `OWNER`, `ADMIN`, `SUPERVISOR`) pueden omitirlo.
  - Intentos por parte de enlaces externos (`kind === "link"`) o empleados de línea (`EMPLEADO`) se rechazan con `UNAUTHORIZED_SKIP` (HTTP 403).
  - Toda omisión de un paso obligatorio exige una justificación textual explicativa (`comment.trim().length > 0`), de lo contrario se rechaza con `SKIP_JUSTIFICATION_REQUIRED` (HTTP 400).
  - Los pasos opcionales pueden omitirse libremente sin requerir justificación especial.

### B. Evidencia Obligatoria
- Si la categoría del paso es `PHOTO` o `VIDEO`, o si la definición declara `evidenceRequired: true` (a nivel raíz, en `config` o en `metadata`), el paso no puede completarse sin adjuntar una URL o arreglo de URLs de evidencia válido (`EVIDENCE_REQUIRED`, HTTP 400).

### C. Validación por Tipo de Paso
- **TEXT:** Si es obligatorio, no admite cadenas vacías o espacios en blanco (`REQUIRED_VALUE_MISSING`). Valida límites `minLength`, `maxLength` y expresiones regulares `pattern` (`VALUE_OUT_OF_BOUNDS`).
- **NUMBER:** Valida que el valor sea numérico convertible y finito (`INVALID_VALUE_TYPE`). Si se definen `min` o `max`, rechaza valores fuera de rango con mensaje explícito (`VALUE_OUT_OF_BOUNDS`).
- **SELECT:** Valida que la opción seleccionada pertenezca a la lista de opciones configuradas en la plantilla (`INVALID_OPTION`).
- **YESNO:** Valida booleanos o vocabulario estandarizado (`true`, `false`, `SI`, `NO`, `1`, `0`).
- **CHECKBOX:** Valida confirmación booleana o selección no vacía si es obligatorio.
- **DATE / TIME / TIMER:** Valida formato ISO / timestamp para fechas, formato `HH:MM` para horas con límites `minTime`/`maxTime`, y números positivos para temporizadores.
- **STOCK_COUNT:** La integridad de cuadrícula multi-renglón se delega a `normalizeStockCount` (reglas C20/C21).

---

## 3. Implementación

1. **Módulo de Política Puro:** `lib/workflows/step-contract-policy.ts`
   - Define la clase de error `WorkflowStepContractError` extendiendo `ApiError` con códigos estructurados legibles en frontend.
   - Funciones exportadas: `validarContratoDePaso`, `validarTransicionEstado`, `validarEvidenciaPaso`, `validarValorPorTipo`.
2. **Capa de Servicio:** `lib/services/workflow-execution-service.ts`
   - En `WorkflowExecutionService.updateStep`, antes de cualquier consulta de actualización a Postgres, evaluación de incidentes o llamada a IA, invoca `validarContratoDePaso`.
   - Re-exporta `WorkflowStepContractError` para su consumo en controladores y rutas.
3. **Ruta HTTP API:** `app/api/workflows/executions/[id]/steps/[stepId]/route.ts`
   - Captura `WorkflowStepContractError` y `z.ZodError`, respondiendo `{ error: err.message, code: err.code }` con los códigos HTTP 400, 403 o 409 correspondientes.
4. **Componente de Interfaz:** `components/workflow/workflow-executor.tsx`
   - Parsea el cuerpo de error JSON (`response.json()`) para mostrar en el Toast el mensaje contextual y exacto generado por el servidor.
   - Corrige el cálculo de `isStepCompleteable` para soportar valores numéricos directos (ej. 0 o decimales).
   - Incorpora botón "Omitir paso" y diálogo modal accesible (`Dialog`) que solicita motivo operativo y advierte que los pasos obligatorios requieren rol supervisor.

---

## 4. Evidencias de Verificación

### V1. Pruebas Unitarias Aisladas (Vitest)
- `tests/unit/workflows/step-contract.test.ts`: **22 pruebas unitarias puras** que evalúan todas las ramas de validación (TEXT, NUMBER, SELECT, YESNO, evidencia obligatoria, roles autorizados para omisión, transiciones de estado y flujos cerrados).
- `tests/unit/workflows/step-contract-service.test.ts`: **10 pruebas unitarias** que comprueban que `WorkflowExecutionService.updateStep` y la ruta HTTP `PATCH` interceptan las violaciones de contrato antes de tocar la base de datos y retornan 400, 403 y 409 según corresponda.
- **Resultado:** 12 suites de workflows ejecutadas, **119 pruebas pasando** (100% de éxito).

```bash
pnpm exec vitest run tests/unit/workflows/
# Output:
# Test Files  12 passed (12)
# Tests       119 passed (119)
```

### V2. Pruebas de Navegador E2E (Playwright)
- `tests/e2e/workflow-step-contract.spec.ts`: **3 pruebas de integración en navegador real** con servidor Vite aislado:
  1. *Rechazo en toast:* Envío de temperatura fuera de rango (15.5°C en límite de 8°C) muestra en toast: `"El valor numérico no puede ser mayor que 8."`.
  2. *Omisión con justificación:* Apertura de diálogo modal para paso obligatorio, captura de justificación `"Termómetro en calibración técnica anual NOM-251"`, envío de `{ status: "SKIPPED", comment: "..." }` a la API y confirmación con toast de éxito.
  3. *Rechazo 403:* Operador sin permisos intentando omitir paso obligatorio recibe y visualiza toast con `"Solo un supervisor o administrador puede omitir un paso obligatorio."`.
- **Resultado:** 3 pruebas de navegador pasando en 33.6s.

```bash
pnpm exec playwright test -c tests/playwright-shifts.config.ts workflow-step-contract.spec.ts
# Output:
# Running 3 tests using 1 worker
# ok 1 muestra en toast el mensaje de rechazo cuando el servidor devuelve 400 por valor fuera de rango (12.9s)
# ok 2 permite omitir paso con justificación y envía status SKIPPED a la API (1.5s)
# ok 3 muestra rechazo 403 si un operador no autorizado intenta omitir paso obligatorio (1.2s)
# 3 passed (33.6s)
```

### V3. Verificación contra Base de Datos Real (Neon Postgres)
- `scripts/verify-workflow-step-contract.ts`: Script que crea una empresa, sucursal, plantilla NOM-251, usuarios (EMPLEADO y SUPERVISOR) e instancia de ejecución real en Neon:
  1. Comprueba que el servidor rechaza falta de evidencia obligatoria (`EVIDENCE_REQUIRED` 400) manteniendo intacto el estado en Postgres (`PENDING`).
  2. Comprueba que el servidor rechaza valores fuera de rango (`VALUE_OUT_OF_BOUNDS` 400) sin alterar Postgres.
  3. Comprueba que un EMPLEADO no puede omitir pasos obligatorios (`UNAUTHORIZED_SKIP` 403).
  4. Comprueba que un SUPERVISOR sin justificación es rechazado (`SKIP_JUSTIFICATION_REQUIRED` 400).
  5. Comprueba que un SUPERVISOR con justificación asienta exitosamente el estado `SKIPPED` y su comentario en Postgres.
  6. Comprueba que una vez completados todos los pasos e instancia en `COMPLETED`, cualquier edición posterior se rechaza con `WORKFLOW_TERMINAL` (409).
  7. Ejecuta limpieza preventiva y final con eliminación en cascada sin dejar registros huérfanos.

```bash
node --use-system-ca --import tsx scripts/verify-workflow-step-contract.ts
# Output:
# C24 — Verificación de contrato de paso en servidor contra Neon Postgres
#   ✓ Empresa, sucursal, usuarios, plantilla e instancia creados en Neon
#   ✓ Servidor rechazó falta de evidencia requerida (EVIDENCE_REQUIRED 400) sin alterar Postgres
#   ✓ Servidor rechazó valor fuera de rango numérico (VALUE_OUT_OF_BOUNDS 400) sin alterar Postgres
#   ✓ Servidor impidió a EMPLEADO omitir paso obligatorio (UNAUTHORIZED_SKIP 403)
#   ✓ Servidor impidió omisión de supervisor sin justificación (SKIP_JUSTIFICATION_REQUIRED 400)
#   ✓ SUPERVISOR omitió paso obligatorio con justificación, asentado exitosamente en Postgres
#   ✓ Todos los pasos completados; instancia cerrada en Postgres (status = COMPLETED)
#   ✓ Flujo cerrado bloquea cualquier edición posterior en Postgres (WORKFLOW_TERMINAL 409)
# Todas las comprobaciones de contrato de paso contra Neon pasaron exitosamente.
# Limpiando datos de prueba en Neon...
# Limpieza completada.
```

### V4. Verificación de Tipos y Calidad de Código
- `pnpm exec tsc --noEmit`: 0 errores en todo el proyecto.
- `pnpm run lint`: 0 errores reportados por ESLint.
