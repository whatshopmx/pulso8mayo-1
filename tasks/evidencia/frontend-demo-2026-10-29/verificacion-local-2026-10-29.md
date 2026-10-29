# Verificación local del plan de auditoría frontend

Fecha: 29 de octubre de 2026, 22:40–23:10 UTC (16:40–17:10 America/Mexico_City).
Entorno: `http://localhost:3000` (dev server), base demo de Neon. Sin despliegue, sin resiembra.

## Puerta global

| Comando | Resultado |
|---|---|
| `pnpm run lint` | exit 0 · 0 errores · 2440 warnings preexistentes |
| `npx tsc --noEmit` | exit 0 · limpio |
| `NODE_OPTIONS=--max-old-space-size=4096 pnpm run build` | exit 0 · compilado y 38 rutas generadas |

Nota: el primer `pnpm run build` sin `NODE_OPTIONS` murió con `JavaScript heap out of memory` durante la fase de TypeScript (heap por defecto ~2 GB, 2.6 GB libres en la máquina). El mismo chequeo con `tsc --noEmit` y el build con 4 GB pasan; no es un defecto de código.

## Tests unitarios de las áreas tocadas

```
npx vitest run --configLoader bundle \
  tests/unit/workflows/execution-access.test.ts \
  tests/unit/business-date.test.ts \
  tests/unit/workflow-evidence-access.test.ts \
  tests/unit/evidence-confidence.test.ts \
  tests/unit/labor/session-scope.test.ts \
  tests/unit/seed-safety.test.ts
```

Resultado: 6 archivos, **57/57 tests** en verde.

## Recorrido por rol

### Carlos (SUPER_ADMIN)

- `/dashboard/schedules`: 7 programaciones en Polanco, KPIs **7 / 7 / 0 / 0** en español; lista con 7 tarjetas.
- Red: `GET /api/workflows/schedules/stats?branchId=…-0002` → **200** y `GET /api/workflows/schedules?branchId=…-0002` → **200**. Sin 400 ni reintentos.
- Cambio de sucursal a Roma: header "Sucursal: Roma", selector "Roma", KPIs **1 / 1 / 0 / 0** y lista con "Reporte de Incidentes - Roma".
- Red tras el cambio: ambas peticiones con `branchId=…-0003` → 200.
- **SCH-04:** el selector de tipo de asignación incluye "Manual" (verificado en sesión previa con `assignmentType=MANUAL` → 200).

### Juan (GERENTE)

- `/dashboard`: header "Sucursal: Condesa" con nota "Tu usuario está asignado a esta sucursal".
- Bitácora: acciones **"Iniciar"** presentes en ejecuciones pendientes (flujo GERENTE conservado).
- `/dashboard/workflows/8d7aff21-…/execute`: stepper "Asistencia Diaria", paso 1 de 6 → **200**. No se envió ningún paso.

### Diana (READONLY)

- `/dashboard`: sidebar sin "Flujos de Trabajo"; bitácora con **"Solo lectura"** en todas las acciones, sin "Iniciar".
- KPIs live: "Aperturas a Tiempo **0 % · 0/1 tiendas**" y matriz "Abrió tarde (14:00 hrs)" — coherentes entre sí (antes: 100 % contra matriz tardía).
- "Personal en Piso": **"Sin dotación"** con "0 colaboradores activos".
- `GET /dashboard/workflows` → **403** con página "403 · Acceso denegado" y salida a su panel. La red confirma el status 403 (antes: redirect silencioso).

## SEED-01 — resiembra autorizada y medición final

Con autorización explícita se ejecutó `npx tsx scripts/seed-full.ts --reset` (20 fases + contraseñas) sobre la base demo: **240.8 s**, exit 0. Log completo en `seed-reseed-2026-10-29.log`.

Estado medido después de la resiembra (solo lectura):

| Métrica | Valor |
|---|---:|
| Instancias de workflow | 617 |
| Pasos | 6,862 |
| Pasos con `evidence_url` | 1,298 |
| Registros canónicos `WORKFLOW_STEP` | 1,300 |
| Pasos con espejo canónico | 1,298 |
| Pasos con evidencia sin espejo | **0** |
| Instancias con `due_date > now()` | **0** |

La fase 19 del seed solo refleja 80 pasos; el resto se completó con el mismo `syncStepEvidence` (idempotente) y, para los faltantes restantes, una inserción por lotes equivalente a `EvidenceStore.store` (misma tabla, `entity_type = WORKFLOW_STEP`, contexto de empresa). No quedaron pasos sin espejo.

### Smoke HTTP posterior a la resiembra

| Endpoint / página | Resultado |
|---|---|
| `POST /api/auth/sign-in/email` (carlos) | 200 |
| `/dashboard` | 200 |
| `/api/workflows/schedules/stats?branchId=…-0002` | 200 · 7/7/0/0 |
| `/api/workflows/schedules?branchId=…-0002` | 200 · lista con datos |
| `/api/workflows/evidence?branchId=…-0002` | 200 · total 303, `uniqueBranches: 1` |
| `…&verified=true` | 200 · total 123, `needsReview: 0` |
| `/dashboard/labor` | 200 · "Sin dotación configurada" |
| `/dashboard/employees` | 200 · "Directorio de Empleados", filtros en español |
| `/dashboard/evidence` | 200 · "Evidencias", sucursal Polanco |
| `/dashboard/schedules` | 200 |

Los adjuntos del seed nuevo apuntan a `/demo-evidence/…` (assets locales), no a hosts legacy.

## Límites de esta verificación

- No se ejecutó timbrado, dispersión ni borrado de negocio. La resiembra se ejecutó con autorización explícita y recreó el demo completo.
- No se desplegó a producción; el sitio publicado sigue en `HEAD 3b27ac4`.
- La pestaña de Chrome quedó bloqueada al abrir `/dashboard/labor` tras la sesión larga; la misma petición con la cookie de sesión respondió **200 en 4.4 s**, así que fue un problema del renderer del navegador, no de la página. Los smoke tests posteriores a la resiembra se hicieron por HTTP.
- Los avisos de hydration de Radix en el encabezado global son preexistentes y ajenos a los 16 hallazgos.
