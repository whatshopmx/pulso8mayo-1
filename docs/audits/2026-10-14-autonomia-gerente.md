# C20 — Autonomía del gerente (`managerAutonomy`)

Fecha: 14 de octubre de 2026. Plan: [C20](../../tasks/plan-conexion-frontend-backend.md#c20). Seguimiento: [tareas](../../tasks/todo-conexion-frontend-backend.md).

## Alcance y comportamiento

Se implementó y verificó de extremo a extremo la política de autonomía del gerente (`managerAutonomy` en `tenant_operating_config`), conectándola con la resolución y autorización de gastos ordinarios en el servidor. La dimensión pasa en el catálogo oficial (`lib/company/operating-policy-catalog.ts`) de estado **`pendiente`** a **`aplicada`** con consumidor registrado `rolExigidoPorMonto` (`lib/expenses/approval-policy.ts`) utilizado por `ExpenseService` (`lib/services/expense-service.ts`).

Los subcomponentes del plan se completan de la siguiente manera:

- **C20.1 — Política pura y pruebas de matriz:**
  - `rolExigidoPorMonto` en `lib/expenses/approval-policy.ts` se extiende para recibir opcionalmente `managerAutonomy?: ManagerAutonomyLevel | string | null`.
  - La escalera de roles combina los tres niveles de autonomía con los límites monetarios preexistentes sin duplicar ni contradecir reglas:
    1. **Escalada a `OWNER`:** Si el monto alcanza o supera `doubleApprovalThresholdCents` (cuando está configurado), exige `OWNER` de forma mandatoria y prioritaria en **todos** los niveles de autonomía (incluido `ALTA`).
    2. **`BAJA`:** El gerente de sucursal carece de autoridad de aprobación o rechazo sobre gastos ordinarios (retorna `ADMIN`). Toda decisión sobre gasto ordinario se centraliza en corporativo.
    3. **`ALTA`:** El gerente de sucursal está facultado para resolver gastos ordinarios de su sucursal hasta el umbral del dueño, sin escalada intermedia a `ADMIN`.
    4. **`MEDIA` (default y fallback para valores no reconocidos):** Conserva la escalera monetaria histórica (`< managerAuthLimitCents` resuelve `GERENTE`; `>= managerAuthLimitCents` escala a `ADMIN`).
  - **Segregación de funciones (A16):** `denyExpenseResolution` prohíbe de forma absoluta que quien registre un gasto lo apruebe o rechace (`SELF`), cualquiera que sea el nivel de autonomía configurado (salvo ejecutivos `OWNER` / `SUPER_ADMIN`).
  - Suite unitaria dedicada `tests/unit/finance/manager-autonomy.test.ts` con 26 pruebas de matriz cubriendo niveles, montos límite, bordes, fallbacks nulos y segregación de funciones.

- **C20.2 — Conexión al servicio y actualización de catálogo/UI:**
  - `resolverRolExigido` y `listExpenses` en `lib/services/expense-service.ts` pasan `managerAutonomy: config.managerAutonomy` a `rolExigidoPorMonto`.
  - En `lib/company/operating-policy-catalog.ts`, `managerAutonomy` se reclasifica como `aplicada`, registrando su consumidor, caso dado/cuando/entonces por nivel, y retirando `decisionPendiente`.
  - En `components/company/operating-dimensions-section.tsx`, las etiquetas y descripciones de las opciones comunican con fidelidad la regla del servidor:
    - `ALTA`: *"El gerente aprueba gastos ordinarios de su sucursal hasta el umbral del dueño."*
    - `MEDIA`: *"El gerente aprueba gastos menores al límite de autorización; montos mayores escalan a administración."*
    - `BAJA`: *"Toda aprobación de gastos se centraliza en administración; el gerente no autoriza gastos."*
  - `tests/unit/company/operating-policy-catalog.test.ts` actualizado (6 aplicadas, 6 descriptivas, 1 pendiente).

- **C20.3 — Verificación en navegador aislado (Playwright):**
  - Actualización de `tests/e2e/operating-config.spec.ts`: el distintivo de `managerAutonomy` ahora se comprueba como `"Se aplica hoy"` con la leyenda de servicio activo. (31/31 pasando).
  - Nueva suite aislada `tests/e2e/manager-autonomy.spec.ts` con 4 pruebas comprobando:
    1. Distintivo "Se aplica hoy" en la sección de dimensiones operativas.
    2. Descripciones precisas de las tres opciones.
    3. Persistencia en `PUT /api/company/operating-config` al cambiar a ALTA o BAJA y recargar.
    4. Evaluación de la escalera de autorización en el cliente reflejando la misma lógica que el servidor.

- **C20.4 — Verificación contra Postgres real (Neon):**
  - Script `scripts/verify-manager-autonomy.ts` con 17 comprobaciones contra Neon con dos empresas simultáneas, usuarios con roles `GERENTE`, `ADMIN` y `OWNER`, y eliminación limpia en `finally`.
  - Comprueba:
    1. En Empresa A (`BAJA`): gasto de $500 MXN (< $1,000 MXN) bloquea aprobación de `GERENTE` con 403 (`requiere aprobación de ADMIN (tu rol: GERENTE)`), bloquea rechazo de `GERENTE` con 403 (`requiere resolución de ADMIN (tu rol: GERENTE)`), permite aprobación de `ADMIN` y rechaza re-aprobación con 400.
    2. En Empresa B (`ALTA`): gasto ordinario de $5,000 MXN (> $1,000 MXN) es aprobado por `GERENTE`.
    3. En Empresa B (`ALTA`): gasto de $15,000 MXN (>= $10,000 MXN umbral de dueño) escala obligatoriamente a `OWNER`, bloqueando a `GERENTE` (403) y a `ADMIN` (403), y permitiendo aprobación a `OWNER`.
    4. Segregación de funciones: `GERENTE` intentando auto-aprobarse en ALTA recibe 403 (`Segregación de funciones: quien registra un gasto no puede aprobarlo`), mientras un colega gerente de la misma sucursal lo aprueba exitosamente.
    5. Aislamiento multi-tenant: intento de aprobar un gasto con contexto de otra empresa da 404 (NotFound). Aislamiento de sucursal: intento con alcance ajeno da 403.
    6. Cambio dinámico en caliente: alternar Empresa A entre BAJA -> MEDIA -> BAJA mediante `upsertTenantOperatingConfig` surte efecto de inmediato sobre gastos nuevos sin estado residual.
    7. Limpieza total de empresas y filas de prueba confirmada.

## Casos especiales y decisiones de diseño

1. **Prevalencia de reglas explícitas:** Las reglas configuradas a mano en `expense_authorization_rules` prevalecen sobre la escalera por omisión de `managerAutonomy`, respetando las asignaciones específicas de la empresa.
2. **Prioridad del umbral de dueño:** Ninguna configuración de autonomía anula `doubleApprovalThresholdCents`. El escalamiento ejecutivo hacia `OWNER` se mantiene como salvaguarda inquebrantable de gobernanza corporativa.
3. **Resistencia de `revalidateTag` fuera de peticiones HTTP:** Se corrigió `upsertTenantOperatingConfig` en `tenant-config-service.ts` para capturar la ausencia de contexto de generación estática (`static generation store missing`), permitiendo que scripts de mantenimiento, funciones Inngest y pruebas contra la base real ejecuten inserciones/actualizaciones sin arrojar invariantes de Next.js.

## Verificación

| Comprobación | Resultado |
| --- | --- |
| `pnpm run test:unit tests/unit/finance/manager-autonomy.test.ts` | **26/26**, pruebas puras de matriz para ALTA, MEDIA, BAJA, bordes numéricos y segregación de funciones. |
| `pnpm run test:unit tests/unit/company/operating-policy-catalog.test.ts` | **24/24**, verificación del catálogo, símbolos declarados y 6 aplicadas / 6 descriptivas / 1 pendiente. |
| `pnpm run test:unit tests/unit/finance/` | **82/82**, suite financiera completa que incluye políticas de autorización, programación y dispersión. |
| `pnpm exec playwright test --config tests/playwright-shifts.config.ts manager-autonomy` | **4/4**, pruebas en Chromium de insignia "Se aplica hoy", textos de opciones, persistencia y evaluación cliente. |
| `pnpm exec playwright test --config tests/playwright-shifts.config.ts operating-config` | **31/31**, suite de configuración operativa en Chromium comprobando todos los controles. |
| `node --use-system-ca --import tsx scripts/verify-manager-autonomy.ts` | **17/17 contra Neon**, dos empresas reales, validación de 403 con roles exactos, auto-aprobación bloqueada, escalada a OWNER, cambio en caliente y limpieza total. |
| `pnpm run test:unit --maxWorkers=2` | **88 archivos; 1183 aprobadas, 1 omitida y 1 TODO preexistentes**, salida 0 limpia. |
| `pnpm exec playwright test --config tests/playwright-shifts.config.ts` | **22/22**, salida 0 limpia en la configuración de pruebas aisladas. |
| `pnpm exec tsc --noEmit` | Sin errores de tipos. |
| `pnpm run lint` | 0 errores (warnings preexistentes sin cambios). |
| `pnpm run build` | Compilación exitosa en producción. |

## Continuidad

C20 queda completada. La siguiente tarea de la Fase 3 es **C21 — Política de dispersión de nómina (`payrollDispersion`)**.
