# Handoff: Tasks 7–9 — Cierre de Phase 2 (capa 01 unitaria)

> Documento de continuidad generado el 2026-08-24 tras completar Tasks 5–6.
> Fuente de verdad: `tasks/plan.md` (especificación) y `tasks/todo.md` (estado).
> Predecesor: `tasks/handoff-task-5.md` (Task 5, ya completada).

## Estado actual del repo

- Último commit: `ec50af5` — `docs(tasks): decisiones LFT aplicadas`
- **Tasks 1–6 completas** (Phase 0 + Phase 1 + 2 de 5 de Phase 2).
- Suite unitaria: **149 tests en 3 archivos**, ~5 s (presupuesto: <30 s).
- Lint: **0 errores** (warnings preexistentes ~2100 son deuda aceptada).
- **Push pendiente** → al hacerlo corre CI por primera vez ("CI verde en un PR
  real" sigue abierto). No bloquea Tasks 7–9.
- ⚠️ Hubo trabajo paralelo en el mismo working tree (feature de No. de factura,
  commits `c273e52`): revisar `git log` antes de asumir estado.

## Convenciones establecidas (no romper)

| Tema | Regla |
|---|---|
| Runner | Vitest; script `pnpm test:unit` (= `vitest run --configLoader bundle`) |
| Globs incluidos | `lib/**/*.test.ts` y `tests/unit/**/*.test.ts` — los specs entran solos, **no tocar config** |
| Zona del proceso | `TZ=UTC` forzado en `vitest.config.ts`. Tests de fecha usan zonas explícitas, nunca la local |
| Estilo del spec | Seguir el estilo del módulo bajo prueba: `today.ts` usa comillas simples + 4 espacios; `labor-validation.ts` usa dobles + 2 espacios. Verificar antes de escribir |
| Descripciones | En español, con casos borde documentados en comentarios dentro del propio test |
| Baseline lint | 0 errores / ~2110 warnings (`no-explicit-any` etc.). Un spec nuevo no suma errores ni warnings evitables |
| Correr un archivo | `npx vitest run lib/<ruta>/__tests__/<archivo>.test.ts` |

### Política ante bugs encontrados (afinada con lo aprendido en Tasks 5–6)

1. Test rojo primero (commit propio que documenta el hallazgo), **o** congelar
   comportamiento con comentario si la corrección requiere decisión de negocio.
2. Fix mínimo en commit separado con el caso como regresión. Sin cambio de
   firmas públicas sin aprobación explícita.
3. Si el bug toca **dinero, cumplimiento legal o semántica ambigua** (como las
   bandas de overtime o `missedBreak`), NO decidir por cuenta propia:
   congelar + presentar recomendación + esperar "sí" del humano. Así se hizo
   con las bandas LFT (decisión 2026-08-24, ver `plan.md`).

### ⚠️ Protocolo git con sesiones paralelas (lección del 2026-08-24)

Hubo carreras de index entre dos agentes en el mismo working tree: un commit
de docs arrastró WIP ajeno staged. Reglas desde ahora:

- Commitear SIEMPRE con pathspec explícito: `git commit -m "..." -- <rutas>`.
- Antes de commitear: `git diff --cached --stat` para ver qué hay en el índice;
  si hay archivos ajenos, `git restore --staged <ajenos>` y avisar.
- Nunca `reset`/`amend` sin verificar `git log` fresco justo antes.
- Solo una sesión ejecuta git a la vez; coordinarse si hay señal de actividad
  concurrente (archivos M inesperados en `git status`).

## Task 7: RBAC/ABAC/masking (M) — siguiente sugerida

> Specs: 6 roles × sucursal propia/ajena/"todas" sin ampliar alcance por
> parámetro; `hasAccess` sobre ROUTE_PERMISSIONS completo; dashboards default
> sin redirects a rutas prohibidas; ABAC OWNED/FRANCHISE × NONE/OWN_BRANCH_ONLY/
> ALL; PII nuevo entra enmascarado (fail-closed).

Archivos objetivo (verificar rutas reales — el plan tenía una equivocada):

| Módulo | Ubicación real | Exports clave | Líneas |
|---|---|---|---|
| branch-scope | `lib/branch-scope.ts` (**raíz de lib/**, no `lib/rbac/`) | `isBranchScopedRole`, `canAccessAllBranches`, `enforceBranchScope`, `getAccessibleBranchIds`, `resolveBranchScope`, `assertBranchAssignment`, `assertBranchOfCompany*` | ~130+ |
| permissions | `lib/rbac/permissions.ts` | `UserRole` (6 roles), `ROUTE_PERMISSIONS`, `hasAccess(userRole, path)`, `getDefaultDashboard`, `getAccessibleRoutes` | 294 |
| abac | `lib/rbac/abac.ts` | `BranchOwnership`, `FranchiseVisibility`, `evaluateAccess`, `buildOwnershipScope` | 315 |
| masking | `lib/rbac/masking.ts` | `maskSensitive<T>`, `maskSensitiveList<T>` | 122 |

Specs a crear: `lib/__tests__/branch-scope.test.ts`,
`lib/rbac/__tests__/permissions.test.ts`, `lib/rbac/__tests__/abac.test.ts`,
`lib/rbac/__tests__/masking.test.ts`.

Notas:
- Para `hasAccess`: barrer `ROUTE_PERMISSIONS` completo table-driven (rol ×
  ruta) en vez de muestrear — es un array finito, el barrido completo cabe.
- `branch-scope.ts` importa tipos de roles; verificar si alguna función es
  async (las `assert*` parecen tocar DB → esas NO son puras: testear sólo la
  parte pura o dejar las DB-bound fuera del alcance de esta capa).
- Fail-closed en masking: entrada nueva/desconocida debe salir enmascarada.

## Task 8: parseMoneyToCents + rate-limiter (M)

> Specs: `" $1,234.50 "`, `"1.234,50"`, `"(150.00)"`, `"1 234,50 MXN"`, `""`,
> `"N/A"`, notación científica → `null` nunca NaN. `normalizeHeader`/
> `matchFieldAlias`/`isTotalLabel` con acentos, mayúsculas, duplicados.
> Rate-limiter: ventana expira, contador reinicia, headers correctos.

| Módulo | Ubicación real | Exports clave | Líneas |
|---|---|---|---|
| POS aliases | `lib/services/pos-column-aliases.ts` | `CanonicalField(s)`, `FIELD_LABELS`, `FIELD_ALIASES`, `PaymentBucket`, `PAYMENT_METHOD_ALIASES`, `TOTAL_LABELS`, `normalizeHeader`, `matchFieldAlias`, `matchPaymentLabel`, `isTotalLabel`, **`parseMoneyToCents` (línea ~435)** | 544 |
| rate-limiter | `lib/rate-limiter.ts` | `checkRateLimit` (async) / `checkRateLimitSync`, `getRateLimitStatus(Sync)`, `resetRateLimit(Sync)`, `createRateLimitHeaders` | 384 |

Specs a crear: `lib/services/__tests__/pos-column-aliases.test.ts`,
`lib/__tests__/rate-limiter.test.ts`.

Notas:
- ⚠️ El rate-limiter tiene variante Sync (fallback en memoria) y async
  (¿Upstash Redis?). La sync es testeable directa; para la async verificar si
  acepta inyección de cliente o si mockear. Fake timers de Vitest
  (`vi.useFakeTimers()`) para probar expiración de ventana sin dormir.
- `parseMoneyToCents` devuelve `number | null`: asertar también el tipo de NaN
  implícito (`Number.isNaN` nunca true cuando no-null).

## Task 9: Propinas con property-based (S) — ⚠️ leer antes de empezar

> Spec del plan: invariante fast-check — suma repartida === total, cualquier
> número de empleados y monto; sin centavos perdidos ni inventados.

Ubicación real: `lib/services/propinas-service.ts` (125 líneas).

**Gotchas descubiertos en el reconocimiento (2026-08-24):**

1. **NO es lógica pura**: `calculatePropinasDistribution` es async y consulta/
   inserta en DB (`propinas`, `propinaAsignaciones`, `users`). fast-check no
   puede barrerla directamente. Opciones: (a) extraer la matemática de
   reparto a función pura (`distributeCents(total, pesos[])`) y property-
   testear esa — recomendada, deja el módulo mejor; (b) mockear `db` y
   testear indirectamente — frágil.
2. **Sospecha fuerte de bug de centavos perdidos**: el reparto hace
   `Math.floor(total / staffCount)` y reporta `distributed = perStaff × n`.
   Con total=100 y 3 empleados reparte 99 — **1 centavo se evapora** y el
   header guarda `distributedCents ≠ totalPoolCents`. La propiedad del plan
   fallaría de inmediato. Aplicar la política de bugs: test rojo → reporte →
   fix mínimo probablemente = reparto con residuo distribuido (1 centavo a los
   primeros `total % n` empleados) o registro explícito del residuo. Al ser
   dinero: presentar recomendación y esperar aprobación antes del fix.

Spec a crear: `lib/services/__tests__/propinas-service.test.ts`.
fast-check ya está instalado (Task 3). Patrón: `fc.assert(fc.property(...))`;
si la función bajo prueba fuera async, usar `fc.assert(fc.asyncProperty(...))`.

## Checkpoint de salida (Phase 2 completa)

```bash
pnpm test:unit        # verde, suite completa <30 s
pnpm run lint         # 0 errores
```

Actualizar `tasks/todo.md` (marcar Task 7/8/9) y `tasks/plan.md`
(checkbox + notas breves de hallazgos por tarea, mismo formato usado en 5 y 6).

## Después de Task 9 (fases restantes, vista rápida)

- **Phase 3 (Tasks 10–11)**: barridos de contrato API con aprobación humana
  previa de la lista de rutas públicas. Empiezan con clasificación exploratoria
  — NO congelar fixture sin tabla aprobada.
- **Phase 4 (12–14)**: IDOR multi-tenant contra base de dev compartida.
- **Phase 5 (15–16)**: Postgres efímero con ramas de Neon (DECIDIDO; Docker
  descartado). Dividir Task 15 si excede una sesión.
- **Phase 6 (17–19)**: Inngest con `@inngest/test`; crons por zona horaria.
- **Phase 7 (20–25)**: E2E nocturno Playwright sobre base efímera.
- **Phase 8 (26–28)**: p95, axe-core, i18n sweep — continuo.

Dependencia dura: Tasks 10+ requieren el push pendiente para tener CI real
contra el cual validar. Hacer push antes de arrancar Phase 3.
