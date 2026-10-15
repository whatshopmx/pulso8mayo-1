# Auditoría de Conexión: C26 — Conservar confianza mínima en el veredicto IA (H07)

**Fecha:** 15 de octubre de 2026  
**Tarea:** C26 — Conservar confianza mínima en el veredicto IA  
**Fase:** Fase 4 — Workflows y verificación  
**Hallazgos atendidos:** H07 (Confianza susceptible de sobrescritura, autoaprobación indebida en calidad/seguridad, falta de regla de decisión explícita)  
**Dependencias:** C25 (Transmisión de configuración de IA y fallback)  

---

## 1. Contexto y Problema

En la auditoría de conexión [docs/audits/2026-10-10-backend-frontend-wiring-audit.md](2026-10-10-backend-frontend-wiring-audit.md), el hallazgo **H07** documentó:
> *"En VerificationEngine se rechaza inicialmente una confianza inferior al mínimo, pero las ramas de calidad y seguridad vuelven a asignar success. Después, autoApprove puede eliminar la revisión manual. La regla de confianza no se conserva como condición obligatoria. El resultado debe combinar todas las condiciones requeridas y devolver qué regla produjo aprobación, rechazo o revisión."*

Concretamente:
1. **Sobrescritura incondicional de `success`:** En `VerificationEngine.evaluate`, la comprobación `if (aiResult.confidence < rule.minConfidence)` marcaba inicialmente `success = false`, pero posteriormente las ramas de `ANALISIS_CALIDAD` (`success = score >= 6`) y `ANALISIS_SEGURIDAD` (`success = parsed.is_safe`) reasignaban `success` a `true` sin volver a verificar si la confianza calculada alcanzaba `minConfidence`.
2. **Autoaprobación indebida de riesgos y calidades dudosas:** Si una inspección de calidad obtenía un score apenas aprobatorio de 6/10, la confianza calculada era `score / 10 = 0.60`. Al reasignar `success = true`, el bloque `if (rule.autoApprove && success)` desactivaba la revisión manual (`requiresManualReview = false`), autoaprobando insumos o procesos con un 40% de incertidumbre. Similarmente, una condición segura (`is_safe: true`) con nivel de riesgo moderado (`risk_level: "medium"` -> confianza 0.75) eliminaba la supervisión humana a pesar de que la regla exigía 0.85 de confianza mínima.
3. **Falta de regla de decisión estructurada:** No existía un código de veredicto que indicara inequívocamente a los operadores si el paso se aprobó automáticamente, si requería visto bueno humano ordinario o si fue retenido por déficit de confianza.
4. **Fallas abiertas por omisión de umbral:** Si `minConfidence` venía ausente en la regla, `confidence < undefined` evaluaba a `false` en JavaScript, evadiendo completamente el filtro.

---

## 2. Arquitectura de la Solución

### A. Política Pura de Veredicto (`lib/workflows/verification-verdict-policy.ts`)
Se implementó un módulo autoritativo puro con las siguientes responsabilidades:
- **Compuerta Obligatoria de Confianza (Gate Inviolable):**
  $$\text{meetsConfidence} = (\text{confidence} \ge \text{minConfidence})$$
  Si los criterios de dominio se cumplen pero $\text{confidence} < \text{minConfidence}$:
  - `success = false` (rechazo autoritativo obligatorio).
  - `decisionRule = 'CONFIDENCE_BELOW_MINIMUM'`.
  - `requiresManualReview = true` (la supervisión humana es obligatoria; `autoApprove` queda inhabilitado).
  - `reason` concatena la advertencia de auditoría: `[Confianza X.XX inferior al mínimo requerido Y.YY]`.
- **Determinismo en Casos Frontera:**
  - $\text{confidence} = \text{minConfidence}$ (ej. 0.85 === 0.85) cumple deterministamente la compuerta.
  - Normalización con redondeo a 4 decimales para eliminar distorsiones por aritmética de punto flotante de IEEE 754.
  - Defaults estables: `DEFAULT_MIN_CONFIDENCE = 0.85` aplicado ante valores ausentes, nulos o `NaN`. Clamping estricto en el rango `[0.0, 1.0]`.
  - Soporte de compatibilidad para alias `expectedConfidence` si `minConfidence` no fue proporcionado.
- **Autoaprobación Condicionada:**
  - `requiresManualReview = false` y `decisionRule = 'AUTO_APPROVED'` se conceden **únicamente** si el dominio aprobó Y la confianza superó el umbral Y `rule.autoApprove === true`.
  - Si el dominio aprobó y la confianza es suficiente pero `autoApprove !== true`, el sistema establece `requiresManualReview = true` y `decisionRule = 'MANUAL_REVIEW_REQUIRED'`.

### B. Enriquecimiento de Contratos (`lib/types/ai-verification.ts`)
- **Códigos Canónicos de Veredicto (`VerificationVerdictCode`):**
  - `AUTO_APPROVED`: Criterios cumplidos, confianza suficiente y autoaprobación concedida.
  - `MANUAL_REVIEW_REQUIRED`: Cumple criterios y confianza, pero la plantilla requiere visto bueno de supervisor.
  - `CONFIDENCE_BELOW_MINIMUM`: Criterios favorables, pero la confianza no alcanza el mínimo requerido. Autoaprobación bloqueada y revisión humana obligatoria.
  - `QUALITY_CRITERIA_FAILED`: Score de calidad inferior a 6/10 o presencia de defectos críticos.
  - `SAFETY_HAZARD_DETECTED`: Detección de condiciones inseguras o peligros en el entorno laboral.
  - `MISSING_REQUIRED_OBJECTS`: Objetos obligatorios ausentes en detección visual.
  - `FORBIDDEN_OBJECTS_DETECTED`: Presencia de artículos prohibidos (joyería, teléfonos, etc.).
  - `AI_CRITERIA_FAILED`: Desaprobación genérica del motor de IA.
  - `INVALID_AI_RESPONSE`: Falla en respuesta de adaptador o error irrecuperable.
- **Campos en `VerificationResult`:**
  - `decisionRule: VerificationVerdictCode`
  - `minConfidence: number`
  - Conservación íntegra de `provider`, `confidence`, `reason`, `metadata`, `requiresManualReview` y `timestamp`.

### C. Integración en el Motor de Ejecución (`lib/services/verification-engine.ts`)
- `VerificationEngine.evaluate` delega el cálculo del veredicto a `evaluateVerificationVerdict`, garantizando simetría total entre el runtime y la política pura.
- Resuelve alias `expectedObjects` / `requiredElements` y `verificationType` / `type` antes de invocar a `AIService.performVerification`.

---

## 3. Pruebas y Evidencia de Verificación

### Nivel 1: Pruebas Unitarias Aisladas (V1)
Archivo: `tests/unit/workflows/verification-verdict.test.ts`  
**22 pruebas ejecutadas y aprobadas (100% éxito en 54ms):**
1. *Calidad favorable (score 6/10 -> confianza 0.60) no autoaprueba cuando minConfidence es 0.85:* `success: false`, `decisionRule: 'CONFIDENCE_BELOW_MINIMUM'`, `requiresManualReview: true`.
2. *Calidad intermedia (score 8/10 -> confianza 0.80) no autoaprueba cuando minConfidence es 0.85:* `success: false`, `requiresManualReview: true`.
3. *Calidad sobresaliente (score 9.5/10 -> confianza 0.95 >= 0.85) autoaprueba si autoApprove es true:* `success: true`, `decisionRule: 'AUTO_APPROVED'`, `requiresManualReview: false`.
4. *Calidad sobresaliente exige revisión si autoApprove es false:* `success: true`, `decisionRule: 'MANUAL_REVIEW_REQUIRED'`.
5. *Seguridad favorable (is_safe: true) con riesgo medio (confianza 0.75) no autoaprueba si minConfidence es 0.85:* `success: false`, `decisionRule: 'CONFIDENCE_BELOW_MINIMUM'`.
6. *Seguridad favorable con riesgo alto (confianza 0.50) no autoaprueba si minConfidence es 0.85:* `success: false`, `decisionRule: 'CONFIDENCE_BELOW_MINIMUM'`.
7. *Seguridad favorable con riesgo bajo (confianza 0.90 >= 0.85) autoaprueba:* `success: true`, `decisionRule: 'AUTO_APPROVED'`.
8. *Preservación íntegra de metadatos, proveedor y motivo explicativo.*
9. *Rechazo por falta de objetos requeridos detalla elementos faltantes (`MISSING_REQUIRED_OBJECTS`).*
10. *Rechazo por objetos prohibidos detalla elementos encontrados (`FORBIDDEN_OBJECTS_DETECTED`).*
11. *Rechazo de calidad por score reprobatorio (< 6) indica fallo de calidad (`QUALITY_CRITERIA_FAILED`).*
12. *Rechazo de seguridad por condición insegura indica riesgos detectados (`SAFETY_HAZARD_DETECTED`).*
13. *Frontera exacta: confianza exactamente igual a minConfidence (0.85 === 0.85) CUMPLE.*
14. *Frontera inferior: confianza marginalmente menor (0.8499 < 0.85) RECHAZA.*
15. *Frontera superior: confianza marginalmente mayor (0.8501 >= 0.85) CUMPLE.*
16. *Default determinista de minConfidence en 0.85 ante omisiones.*
17. *Respeto al alias expectedConfidence.*
18. *Normalización y clamping de valores fuera de rango [0, 1].*
19. *requireManualReviewIfFailed: false respetado en fallos de dominio pero no en déficit de confianza.*
20. *Integración de VerificationEngine.evaluate con la compuerta autoritativa.*
21. *Parser tryParseJSON ante respuestas con llaves embebidas.*
22. *Parser tryParseJSON ante texto plano o malformado.*

**Suite completa de workflows:** 15 archivos, 161 pruebas aprobadas sin regresiones.

### Nivel 3: Base de Datos Real Neon Postgres (V3)
Script: `scripts/verify-workflow-verdict.ts`  
**5 comprobaciones superadas con éxito contra base viva de Neon Postgres:**
1. **Comprobación 1 (Calidad con baja confianza):** Paso con `ANALISIS_CALIDAD` y score 6/10 (confianza 0.60 < 0.85) persistió en `workflow_instance_steps` con `aiAnalysis.passed = false`, `decisionRule = 'CONFIDENCE_BELOW_MINIMUM'` y `requiresManualReview = true` en Neon, impidiendo la autoaprobación indebida.
2. **Comprobación 2 (Seguridad con riesgo medio):** Paso con `ANALISIS_SEGURIDAD`, `is_safe = true` y riesgo medio (confianza 0.75 < 0.85) persistió con `aiAnalysis.passed = false` y `requiresManualReview = true`.
3. **Comprobación 3 (Calidad sobresaliente autoaprobada):** Paso con `ANALISIS_CALIDAD`, score 9.5/10 (confianza 0.95 >= 0.85) y `autoApprove = true` persistió con `aiAnalysis.passed = true`, `decisionRule = 'AUTO_APPROVED'` y `requiresManualReview = false`.
4. **Comprobación 4 (Trazabilidad y proveedor):** Conservación fiel del proveedor `'cloudflare'`, metadatos estructurados y confianza registrada en columnas JSON de Postgres.
5. **Comprobación 5 (Determinismo en frontera):** Evaluación determinista del punto frontera exacto `0.85 === 0.85`.
6. **Limpieza integral:** Todos los registros de prueba (`companies`, `branches`, `users`, `workflow_templates`, `workflow_instances`, `workflow_instance_steps`) fueron purgados sin dejar residuos en Neon.

---

## 4. Archivos Modificados y Creados

| Archivo | Estado | Descripción |
| --- | --- | --- |
| `lib/types/ai-verification.ts` | Modificado | Incorpora `VerificationVerdictCode`, compatibilidad de alias en `VerificationRule` y campos `decisionRule` y `minConfidence` en `VerificationResult`. |
| `lib/workflows/verification-verdict-policy.ts` | Creado | Política autoritativa pura con compuerta de confianza obligatoria, normalizaciones deterministas y catálogo de veredictos. |
| `lib/services/verification-engine.ts` | Modificado | Delegación de evaluación de reglas a `evaluateVerificationVerdict`. |
| `lib/services/ai-service.ts` | Modificado | Asignación de `decisionRule: 'INVALID_AI_RESPONSE'` y `minConfidence` en captura de excepciones del servicio. |
| `tests/unit/workflows/verification-verdict.test.ts` | Creado | 22 casos de prueba unitaria pura cubriendo calidad, seguridad, autoaprobación y casos frontera. |
| `scripts/verify-workflow-verdict.ts` | Creado | Script de comprobación de ciclo de vida completo y persistencia contra Neon Postgres viva. |
| `docs/audits/2026-10-15-workflow-verdict-confidence.md` | Creado | Documentación de evidencia de auditoría para C26. |

---

## 5. Estado de Criterios de Aceptación (C26)

- [x] **Calidad o seguridad favorables no autoaprueban cuando no se cumple la confianza requerida.** (Verificado en V1 y V3 contra Neon Postgres).
- [x] **Cada resultado conserva motivo, proveedor, confianza y necesidad de revisión.** (Verificado en V1 y V3 contra Neon Postgres).
- [x] **Los casos frontera de confianza y autoApprove tienen resultado determinista.** (Verificado en V1 y V3 contra Neon Postgres).

**Punto de control C24–C26:** Completado y verificado. Siguiente tarea: **C27 — Hacer única la transición de finalización**.
