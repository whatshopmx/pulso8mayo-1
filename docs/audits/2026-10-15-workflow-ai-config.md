# Auditoría de Conexión: C25 — Transmisión y Configuración de IA en Ejecución con Cloudflare Workers AI (H07)

**Fecha:** 15 de octubre de 2026  
**Tarea:** C25 — Transmitir configuración de IA a la ejecución  
**Fase:** Fase 4 — Calidad y Cumplimiento  
**Hallazgos atendidos:** H07 (Configuración de IA en plantillas/instancias ignorada en tiempo de ejecución, falta de proveedor alternativo y límites de reintentos)  

---

## 1. Contexto y Problema

Antes de esta implementación:
1. **Configuración de IA ignorada en ejecución:** Aunque las plantillas y el modal de configuración permitían definir `aiConfig` (`provider`, `fallbackProvider`, `maxRetries`), en tiempo de ejecución tanto `WorkflowExecutionService.updateStep` como `VerificationEngine.evaluate` invocaban a `AIService` sin pasarle dicha configuración.
2. **Proveedor fantasma (`gemini`) y fallback asimétrico:** La UI del modal y plantillas como `ley-silla-inspection-v1.json` declaraban `"provider": "gemini"`, pero no existía adaptador para Gemini; en `AIService`, cualquier proveedor distinto a `moondream` caía silenciosamente en un bloque `else` que llamaba a OpenAI. No existía semántica de fallback configurable ni control acotado de reintentos en fallos transitorios.
3. **Costos operativos elevados en visión:** Depender exclusivamente de OpenAI GPT-4o para inspección visual de alta frecuencia (control de temperaturas, higiene personal, uniformes, orden en cocinas) representaba costos significativos.

### Investigación de Cloudflare Workers AI
Se investigó la plataforma Cloudflare Workers AI (`https://developers.cloudflare.com/workers-ai/platform/pricing/`):
- **Capa gratuita:** 10,000 Neurons diarias sin costo.
- **Modelo de visión en el borde:** `@cf/meta/llama-3.2-11b-vision-instruct` a $0.049 por millón de tokens de entrada y $0.676 por millón de tokens de salida (~3x a 50x más económico que modelos propietarios).
- **Compatibilidad API:** Endpoint compatible con OpenAI (`https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1`) con streaming, inferencia de baja latencia en los bordes de Cloudflare y reutilización del `CLOUDFLARE_ACCOUNT_ID` / `R2_ACCOUNT_ID` ya existente en la infraestructura de Pulso HORECA.

---

## 2. Arquitectura de la Solución

### A. Política Pura de Configuración de IA (`lib/workflows/ai-config-policy.ts`)
- **Proveedores Soportados:** `moondream`, `openai`, `cloudflare`.
- **Precedencia Jerárquica Autoritativa:**
  $$\text{Paso (stepDef)} > \text{Instancia (instance.data.aiConfig)} > \text{Plantilla (template.aiConfig)} > \text{Defaults del Sistema}$$
- **Defaults Inteligentes:**
  - Primario predeterminado: `moondream` (modelo especializado liviano para tareas visuales HORECA).
  - Respaldo predeterminado: `cloudflare` (`@cf/meta/llama-3.2-11b-vision-instruct` para redundancia de alta velocidad y bajo costo).
  - Si el primario es `cloudflare`, el respaldo por omisión es `openai`.
- **Acotamiento de Reintentos:** `maxRetries` estrictamente acotado entre 0 y 5 (predeterminado: 2).
- **Semántica de Respaldo:** Admite `"none"` o `null` para deshabilitar explícitamente el fallback (`useFallback: false`).
- **Sanitización de Credenciales:** `sanitizeAIConfig` elimina cualquier llave o token de servidor (`apiKey`, `apiToken`, `OPENAI_API_KEY`, `CLOUDFLARE_API_TOKEN`, etc.) antes de transmitir datos al cliente o persistirlos en logs.

### B. Adaptador de Cloudflare Workers AI (`lib/ai/providers/cloudflare.ts`)
- Implementa `CloudflareWorkersAIProvider` utilizando el SDK de OpenAI configurado con la URL base de Cloudflare y token de portador.
- Transforma solicitudes de imágenes (URLs públicas de R2 o Base64) a formato multimodal de mensajes, analizando conformidad (`isCompliant`), nivel de confianza y descripción técnica.

### C. Capa de Servicio con Fallback Simétrico (`lib/services/ai-service.ts`)
- Soporta Moondream, Cloudflare y OpenAI con fallback transparente bidireccional.
- Reintentos con backoff corto en el primario; si se agotan, conmuta automáticamente al proveedor de respaldo registrando `usedFallback: true`, `primaryProvider` y el error del primario.
- Los fallos normales de verificación no arrojan errores no controlados para no multiplicar los reintentos durables de Inngest.
- Errores de configuración inválida arrojan `InvalidAIConfigError` inmediatamente sin consumir cuotas de API.

### D. Transmisión en Ejecución de Workflows (`lib/services/workflow-execution-service.ts`)
- En `WorkflowExecutionService.updateStep`, resuelve la configuración efectiva del paso mediante `resolveStepAiConfig({ stepDef: currentStepDef, instance, template })`.
- Transmite `effectiveAiConfig` tanto a la Ruta 1 (`VerificationEngine.evaluate`) como a la Ruta 2 (`AIService.verifyPhoto`).

### E. Interfaz del Builder y Gate de Seguridad (`components/builder/workflow-settings-modal.tsx`)
- Desplegable de Proveedor Principal: Moondream, Cloudflare Workers AI, OpenAI.
- Desplegable de Proveedor de Respaldo: Sin respaldo (`none`), Cloudflare Workers AI, OpenAI, Moondream.
- Insensibilidad a minúsculas y mapeo de `'none'` a `null`.
- **Gate de Privilegios:** Controles deshabilitados (`disabled={!canEditPrivileged}`) y badge de solo lectura cuando el usuario no cuenta con rol de Administrador.

---

## 3. Pruebas y Verificación en Tres Niveles

### Nivel 1: Pruebas Unitarias Aisladas (V1)
- `tests/unit/workflows/ai-config-policy.test.ts`: **13 pruebas aprobadas** (100% éxito):
  - Defaults del sistema.
  - Proveedores soportados (`moondream`, `cloudflare`, `openai`).
  - Fallback a `none` / `null`.
  - Rechazo explícito de proveedores desconocidos (`gemini`, `anthropic`).
  - Límites de reintentos `[0, 5]`.
  - Jerarquía Paso > Instancia > Plantilla > Defaults.
  - Eliminación estricta de credenciales en `sanitizeAIConfig`.
- `tests/unit/workflows/ai-config-service.test.ts`: **7 pruebas aprobadas** (100% éxito):
  - Invocación exitosa al primario con conteo exacto de llamadas.
  - Invocación directa a Cloudflare Workers AI como primario.
  - Fallback a Cloudflare al fallar Moondream por timeout/503.
  - Respeto a `fallbackProvider: 'none'` sin llamadas adicionales.
  - Rechazo con `InvalidAIConfigError`.
  - Ausencia de filtración de claves en metadatos de respuesta.
  - Propagación en `VerificationEngine.evaluate`.
- **Suite completa de workflows:** 14 archivos, 139 pruebas aprobadas sin regresiones.

### Nivel 2: Integración en Navegador / Playwright E2E (V2)
- `tests/e2e/workflow-ai-config.spec.ts`: **2 pruebas aprobadas** en Chromium aislado (`tests/playwright-shifts.config.ts`):
  1. Configuración de Cloudflare Workers AI como primario, OpenAI como respaldo, maxRetries en 3, persistencia en API y notificación Toast de éxito.
  2. Bloqueo estricto de controles con insignia "Solo Administradores" cuando `canEditPrivileged = false`.

### Nivel 3: Base de Datos Real Neon Postgres (V3)
- `scripts/verify-workflow-ai-config.ts`: **5 comprobaciones superadas con éxito** contra base de datos viva:
  1. Persistencia y lectura de `aiConfig` (`provider: "cloudflare"`, `fallbackProvider: "openai"`) en `workflow_templates`.
  2. Resolución jerárquica con datos reales de Neon Postgres.
  3. Ejecución de paso en `WorkflowExecutionService.updateStep` con simulación de fallo en primario y éxito en fallback, asentando `COMPLETED` en Postgres.
  4. Inspección forense de columnas JSON de `workflow_instance_steps` confirmando cero filtración de credenciales.
  5. Rechazo estricto de configuraciones inválidas antes de cualquier escritura.
  6. Limpieza integral sin dejar registros huérfanos.

---

## 4. Archivos Modificados y Creados

| Archivo | Estado | Descripción |
|---------|--------|-------------|
| `lib/workflows/ai-config-policy.ts` | **Nuevo** | Política pura de configuración, validación, jerarquía y saneamiento de credenciales de IA |
| `lib/ai/providers/cloudflare.ts` | **Nuevo** | Adaptador de Cloudflare Workers AI (Llama 3.2 Vision) compatible con OpenAI |
| `lib/services/ai-service.ts` | Modificado | Fallback simétrico (Moondream <-> Cloudflare <-> OpenAI), reintentos acotados y hooks para mocking |
| `lib/services/verification-engine.ts` | Modificado | Acepta y propaga `aiConfig` hacia `AIService.performVerification` |
| `lib/services/workflow-execution-service.ts` | Modificado | Resuelve la configuración efectiva y la transmite a las dos rutas de evaluación |
| `app/api/templates/[id]/settings/route.ts` | Modificado | Valida esquema de `aiConfig` con enum soportado y reintentos en `scheduleSchema` |
| `app/api/ai/verify/route.ts` | Modificado | Acepta `provider: 'cloudflare'`, `fallbackProvider` y `maxRetries` |
| `components/builder/workflow-settings-modal.tsx` | Modificado | Opciones de Cloudflare, respaldo "Sin respaldo", y bloqueo por privilegios |
| `templates/compliance/ley-silla-inspection-v1.json` | Modificado | Corrección de `"provider": "gemini"` a `"provider": "cloudflare"` |
| `tests/unit/workflows/ai-config-policy.test.ts` | **Nuevo** | 13 pruebas unitarias de validación y jerarquía |
| `tests/unit/workflows/ai-config-service.test.ts` | **Nuevo** | 7 pruebas unitarias de AIService y VerificationEngine |
| `tests/e2e/workflow-ai-config.spec.ts` | **Nuevo** | 2 pruebas Playwright E2E de configuración en Builder y gate de roles |
| `tests/support/shifts-browser-server.ts` | Modificado | Agregada ruta `/workflow-settings` para pruebas E2E aisladas |
| `tests/playwright-shifts.config.ts` | Modificado | Incorporado `workflow-ai-config.spec.ts` a la suite de tests aislados |
| `scripts/verify-workflow-ai-config.ts` | **Nuevo** | Script de verificación real contra Neon Postgres |
