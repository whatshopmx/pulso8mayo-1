# DIA-02 — Propuesta auditable de días conectada al preview

2026-10-28. Implementa el contrato DIA-01 ([docs/aguinaldo-dias-contrato.md](../../../../docs/aguinaldo-dias-contrato.md)) sobre las fuentes reales y lo refleja en la preview de aguinaldo. Sustituye el conteo legacy «turnos ∪ permisos pagados» (Task 14), que usaba una checada como denominador y no distinguía vacaciones, faltas ni clasificación pendiente.

## Implementación

- `lib/services/aguinaldo-days-adapter.ts` (nuevo): adaptador de fuentes reales dentro de `withCompanyContext`.
  - **Clasificación explícita** (`clasificarAusencia`): maternidad, paternidad, riesgo de trabajo y vacaciones son COMPUTABLE aunque `isPaid` esté mal capturado; enfermedad general es NO_COMPUTABLE con base PROFEDET y salida por override; permiso sin goce (`isPaid = false`) es NO_COMPUTABLE; cualquier nombre libre que no se pueda justificar entrega REVISAR. `name`/`isPaid` no se copian a ciegas.
  - **Cruce sin duplicar**: las vacaciones aprobadas se aplican primero y los permisos se parten con `segmentosSinCubrir`; un permiso ambiguo sobre un día de vacaciones no inventa revisión ni resta dos veces.
  - **Semántica correcta de fechas**: solicitudes y vacaciones se leen como fechas civiles (`to_char` sobre el timestamp sin zona); los turnos son instantes y se convierten al día local con la zona IANA de la sucursal (`diaCivilEnZona`), con holgura de un día para turnos nocturnos de fin de año.
  - **Cobertura honesta**: devuelve `coberturaFuentes: "PARCIAL"` y advertencias; una sucursal sin zona válida usa el default explícito y se avisa. Los turnos acreditan actividad, nunca ausencia.
- `lib/services/aguinaldo-payroll-service.ts`:
  - El preview y la ejecución usan `cargarFuentesDiasAguinaldo` + `proponerDiasAguinaldo`; `fuenteDias` pasa a `MANUAL | PROPUESTA_AUDITABLE | CALENDARIO`.
  - Cada fila expone `propuestaDias` (periodo, corte, zona, calendario, no computables, propuestos, turnos, pendientes, conflictos, proyección y fechas excluidas) y el preview agrega `advertenciasDias`. Un dato corrupto de antigüedad bloquea sólo a esa fila, no a la preview completa.
  - Una clasificación pendiente o un conflicto **bloquea la fila sin override** («Días por revisar»); el override manual —incluido cero— la confirma y conserva la propuesta visible.
- `lib/services/aguinaldo-snapshot.ts`: el snapshot autorizado conserva `propuestaDias` junto con fecha/importes (procedencia reproducible sin recalcular con datos vivos).
- `components/labor/aguinaldo-card.tsx`: la preview **ya no precarga todos los días como ajuste manual**; sólo envía `diasLaboradosPorUsuario` de las filas tocadas. Muestra procedencia, corte/zona, no computables, badges de revisión/proyección/sin checadas y el panel de cobertura. El bloqueo por revisión se libera con el ajuste manual explícito.
- `lib/services/dias-laborados-service.ts` y su prueba se retiran: dos definiciones de días computables competían entre sí. Los helpers puros del contrato quedan en `aguinaldo-days-policy.ts` / adaptador.

## Verificación (local, sin DB operativa ni despliegue)

| Comando | Resultado |
|---|---|
| `pnpm.cmd run test:unit tests/unit/aguinaldo-days-adapter.test.ts` | 14/14, exit 0 |
| `pnpm.cmd run test:unit lib/__tests__/aguinaldo-payroll-service.test.ts lib/__tests__/aguinaldo-snapshot-execution.test.ts lib/__tests__/aguinaldo-snapshot.test.ts tests/unit/aguinaldo-days-adapter.test.ts` | 70/70, 4 archivos, exit 0 |
| `npx.cmd tsc --noEmit` | exit 0 |
| `npx.cmd eslint` | exit 0, 0 errores (warnings preexistentes en el repo) |
| `pnpm.cmd run build` (heap 8192 MB en el proceso) | exit 0, [log](build.log) |
| `npx.cmd playwright test --config tests/playwright-aguinaldo.config.ts` | 5/5 (2 nuevas DIA-02), exit 0 |
| `pnpm.cmd run test:unit` (global) | 179 archivos, 2243 passed, 1 skipped, 1 todo, **19 fallos FEFO preexistentes** |

Los 19 fallos globales viven en `tests/unit/inventory/production-fefo-db.test.ts`, archivo **sin seguimiento en git** (`??`, trabajo local previo) y ya registrados en el tracker; no tocan aguinaldo ni este incremento.

Capturas: [preview con propuesta](browser-preview.png) · [revisión pendiente y cero manual](browser-revision.png).

Oráculos cubiertos: clasificación protegida/pagada/sin goce/pendiente; turno nocturno asignado al día local (CDMX vs UTC); corte que no rebasa el cierre del año; cruce vacaciones+permiso sin doble descuento; dos empresas en la consulta simulada; propuesta por calendario (365) y menos ausencias (363); bloqueo por pendiente y confirmación con cero; preview→POST sin overrides precargados y con `0` explícito.

## Límites

- No se ejecutó contra la base operativa ni con dos empresas reales: la consulta se ejerció con fuentes simuladas (el contrato de política ya tenía sus 12 oráculos puros). La aceptación V2 con Postgres aislado y dos empresas queda para AGU-04, que también conserva la verificación integral de bases/gap y bitácora.
- No se emitió CFDI ni se enviaron mensajes; no hay despliegue ni migración. La migración 0122 y el runtime RLS siguen en OPS-01/OPS-02.
- La enfermedad general se clasifica NO_COMPUTABLE según PROFEDET; una mejor condición contractual exige el override manual visible, no se infiere del catálogo.
- DIA-02 no cierra AGU-03C.3 (runtime RLS) ni NOM-01–05.
