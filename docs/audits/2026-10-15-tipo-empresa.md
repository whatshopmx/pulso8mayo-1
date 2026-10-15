# C22 — Política de tipo de empresa (`tenantType`)

Fecha: 15 de octubre de 2026. Plan: [C22](../../tasks/plan-conexion-frontend-backend.md#c22). Seguimiento: [tareas](../../tasks/todo-conexion-frontend-backend.md).

## Alcance y comportamiento

Se implementó y verificó de extremo a extremo la política de tipo de empresa (`tenantType` en `tenant_operating_config`), conectándola con la segmentación de redes, la propiedad capturada de sucursales (`branches.ownership_type` y `branches.franchisee_user_id`), el filtrado por alcance del actor (`branchVisibilityFilter`) y la presentación en la Liga de Sucursales (`app/dashboard/branches/page.tsx`) y el panel ejecutivo.

La dimensión pasa en el catálogo oficial (`lib/company/operating-policy-catalog.ts`) de estado **`pendiente`** a **`aplicada`** con consumidores registrados:
- `segmentaRed` en `lib/company/tenant-network-policy.ts` (módulo puro)
- `CrossBranchService.getBranchQSRRanking` en `lib/services/cross-branch-service.ts`

Los cuatro subcomponentes se completaron de la siguiente manera:

- **C22.1 — Propiedad de la sucursal en contrato, servicio y detalle:**
  - `ownershipType` (`OWNED` | `FRANCHISE`) y `franchiseeUserId` dejan de ser columnas huérfanas en la base de datos.
  - Esquema Zod en `lib/validations/branch.ts` exige `franchiseeUserId` cuando `ownershipType === "FRANCHISE"`.
  - `BranchService` (`lib/services/branch-service.ts`):
    - `exigirResponsableSiEsFranquicia`: rechaza con 400 (`"Elige quién responde por la sucursal: sin franquiciatario no se puede ver."`) si una franquicia carece de responsable.
    - `verificarFranquiciatario`: verifica contra Postgres que el usuario asignado pertenezca a la misma empresa (`company_id`), rechazando asignaciones cruzadas entre tenants con 400 (`"El franquiciatario responsable no pertenece a esta empresa."`).
    - Las sucursales propias (`OWNED`) fuerzan `franchiseeUserId = null` para no dejar datos espurios si una sucursal es reclasificada.
    - `getBranch`, `updateBranch` y `deleteBranch` acotan por `company_id` previniendo accesos entre empresas (retornan 404 estricto).
  - Pantalla de detalle de sucursal (`app/dashboard/company/branches/[id]/page.tsx`): selector de tipo de propiedad y combo de responsable acotado a usuarios activos de la empresa.
  - 16 pruebas unitarias en `tests/unit/company/branch-ownership.test.ts`.

- **C22.2 — Política de redes y agregación en el servidor:**
  - Módulo puro `lib/company/tenant-network-policy.ts`:
    - `segmentaRed` analiza la declaración del grupo (`tenantType`) y las sucursales visibles.
    - En `GRUPO_PROPIO`: el consolidado compara todas las sucursales; si alguna sucursal está marcada como `FRANCHISE`, se mide aparte y la contradicción se declara en `contradicciones` en lugar de ocultarse o maquillar cifras.
    - En `MIXTO_FRANQUICIAS`: la red se segmenta limpiamente en `PROPIA` y `FRANQUICIAS`. Cada una calcula sus promedios, podio top 3 y detección de anomalías dentro de su red.
  - `CrossBranchService.getBranchQSRRanking` (`lib/services/cross-branch-service.ts`):
    - Recibe el `ctx?: AccessContext` del actor. Si se proporciona, filtra las sucursales mediante `branchVisibilityFilter` antes de agregar, reportando `alcance: { completa, visibles, total, motivo }`.
    - La huella del conjunto visible (`huellaDeAlcance`) se incorpora en la clave de `unstable_cache`, evitando que una sesión gerencial sirva su ranking acotado al dueño.
    - Se implementó degradación resiliente ante la falta de contexto de petición (`incrementalCache missing`), permitiendo la ejecución fluida en scripts fuera de Next.js, funciones de Inngest y suites de prueba.
    - Cada anomalía (`NetworkAnomalyFinding`) incluye el campo `red?: TipoRed` para contextualizar la desviación dentro de su segmento.
  - `app/dashboard/executive/page.tsx`: pasa el `AccessContext` de la sesión a `CrossBranchService.getBranchRanking`.
  - Catálogo C15: `tenantType` clasificado como `aplicada`, documentando los casos de `GRUPO_PROPIO` y `MIXTO_FRANQUICIAS`.
  - 20 pruebas unitarias nuevas (`tests/unit/company/tenant-network-policy.test.ts` y `tenant-network-service.test.ts`).

- **C22.3 — Vista de grupo (Liga de Sucursales) en navegador aislado:**
  - `app/dashboard/branches/page.tsx`:
    - Componente `RedesDelGrupo`: renderiza el veredicto del servidor, las tarjetas por red con conteo de sucursales, promedios de Prime Cost, Food Cost y Labor Cost, y alerta destacada ante contradicciones de captura.
    - Tarjeta de aviso de alcance (`aviso-alcance`): informa cuando el actor ve un subconjunto de la red del grupo.
  - `components/analytics/branch-qsr-scorecard.tsx`: muestra la insignia de red (`Red propia` / `Red de franquicias`) junto al título de cada anomalía detectada.
  - Suite de navegador `tests/e2e/group-network.spec.ts` (3 pruebas en Chromium):
    1. Red segmentada: dos redes con sus promedios y hallazgos etiquetados con su red.
    2. Grupo propio con franquicia capturada: contradicción visible nombrada y aviso de alcance parcial.
    3. Red única: consolidado como red única sin contradicciones.

- **C22.4 — Verificación contra Postgres real (Neon):**
  - Script `scripts/verify-tenant-network.ts` con 23 comprobaciones de extremo a extremo contra Neon:
    1. Dos empresas reales creadas con aislamiento.
    2. Creación de usuarios con roles reales (`OWNER`, `GERENTE`).
    3. Rechazo de franquicia sin responsable (400 con mensaje exacto).
    4. Rechazo de franquicia con usuario de otra empresa (400 con mensaje exacto).
    5. Creación de sucursales `OWNED` y `FRANCHISE` en ambas empresas.
    6. Aislamiento de sucursales en `BranchService.getBranch` y `updateBranch` (404 al cruzar empresas).
    7. Configuración de `tenantType` en Neon (`GRUPO_PROPIO` para Empresa A, `MIXTO_FRANQUICIAS` para Empresa B).
    8. Detección de contradicción en Empresa A (`1 sucursal(es) marcadas como franquicia`).
    9. Separación de segmentos propia vs franquicia en Empresa A.
    10. Restricción por alcance del actor (`ctxGerenteA1` ve 1 de 2 sucursales con aviso de alcance).
    11. Aislamiento multi-tenant en `getBranchQSRRanking` (Empresa B no ve datos de Empresa A).
    12. Empresa B en `MIXTO_FRANQUICIAS` sin contradicciones y con veredicto de dos redes.
    13. Cambio en caliente en Neon: actualizar Empresa A a `MIXTO_FRANQUICIAS` retira la contradicción inmediatamente.
    14. Limpieza completa y automática de todas las entidades en `finally`.

## Verificación

| Comprobación | Resultado |
| --- | --- |
| `pnpm exec vitest run tests/unit/company/branch-ownership.test.ts` | **16/16**, validaciones de Zod, rechazos de responsable y acotación por empresa en `BranchService`. |
| `pnpm exec vitest run tests/unit/company/tenant-network-policy.test.ts` | **13/13**, reglas puras de segmentación, contradicciones de captura y veredictos. |
| `pnpm exec vitest run tests/unit/company/tenant-network-service.test.ts` | **7/7**, integración con `CrossBranchService`, huellas de caché y anomalías por red. |
| `pnpm exec playwright test --config tests/playwright-shifts.config.ts tests/e2e/group-network.spec.ts` | **3/3**, pruebas en Chromium de la Liga de Sucursales con redes, promedios, anomalías y avisos de alcance. |
| `pnpm exec playwright test --config tests/playwright-shifts.config.ts` | **75/75**, suite completa de navegador aislado sin regresiones. |
| `node --use-system-ca --import tsx scripts/verify-tenant-network.ts` | **23/23 contra Neon**, dos empresas reales, reglas de franquicia, agregación QSR, alcance de actor, cambio en caliente y limpieza total. |
| `pnpm run test:unit` | **92 archivos; 1226 aprobadas, 1 omitida y 1 TODO**, suite completa en verde. |
| `pnpm exec tsc --noEmit` | Sin errores de tipos. |

## Límites conocidos y decisiones

- **Aislamiento por `ownershipType`:** La pertenencia de cada sucursal sigue mandando para visibilidad y permisos; `tenantType` solo gobierna la forma en que se presentan los rankings y promedios en la Liga de Sucursales y panel ejecutivo.
- **Sin V2 con Next/auth:** Las pruebas de navegador de la Liga de Sucursales interceptan la API con respuestas controladas; la autenticación real y los permisos residen en las capas de servicio y base de datos verificadas contra Neon.

## Continuidad

C22 queda completada. La siguiente tarea de la Fase 3 es **C23 — Resolver el límite de caja chica (`pettyCashLimitCents`)**, con lo cual se cierra la Fase 3.
