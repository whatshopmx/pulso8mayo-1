# CHECKPOINT-01 — Inicio del consolidado

Fecha: 2026-10-22. Base de cambios: `c14f95c7d85a452ce569fc7ec4e88b8890f40964`. Alcance: BASE-01, TRACK-01, FIS-01 (oráculos), AGU-01. No se cierra la Fase 1.

Commits de implementación: `7e8f583` (fixtures FIS-01), `bfa00a0` (servicio/regresión AGU-01). Verificaciones ejecutadas sobre el árbol de trabajo con ambos incrementos y los cambios IMSS preexistentes, antes de guardar estos commits. La documentación y evidencia se guardan después en un commit separado.

## Evidencia disponible

| Control | Comando | Resultado / log |
|---|---|---|
| Baseline | `pnpm run test:unit` | 155 archivos; 1850 passed, 1 skipped, 1 todo; exit 0; `../BASE-01/unit-baseline.log` |
| Focalizadas finales | `pnpm run test:unit lib/__tests__/aguinaldo-payroll-service.test.ts lib/__tests__/fiscal-fixtures.test.ts` | 2 archivos, 28 passed; exit 0; `focused.log` |
| TypeScript | `pnpm exec tsc --noEmit --incremental false` | Exit 0; `types.log` y `types.json` |
| Lint | `pnpm exec eslint lib/services/aguinaldo-payroll-service.ts lib/__tests__/aguinaldo-payroll-service.test.ts lib/__tests__/fiscal-fixtures.test.ts tests/fixtures/fiscal-2026.ts` | Sin errores ni warnings; exit 0; `lint.log` |
| Unitarias completas finales | `pnpm run test:unit --maxWorkers=2` | 157 archivos; 1878 passed, 1 skipped, 1 todo; exit 0; `unit.log` y `unit.json` |
| Build | `pnpm run build` con heap 8192 MB solo en el proceso | Exit 0; `build.log` y `build.json` |

Los `.json` guardan comando, inicio/fin UTC y exit real. El helper temporal solo orquesta los comandos de la tabla; no forma parte del producto.

Los logs de PowerShell se normalizaron a UTF-8 y se quitaron espacios al final de línea; se conservan mensajes, resultados y exits de cada intento.

Intentos conservados: `unit-workers-failed.log` (worker de Vitest terminó inesperadamente); `unit-before-test-review.log` (1877 passed y una aserción del caso positivo anticipaba la retención de AGU-02; se limitó a validar el importe, dejando la corrección de ISR en su tarea); `build-heap-2048-failed.log` (compilación exitosa, worker TypeScript agotó heap de ~2 GB, exit 134). No ocultar esos intentos ni presentarlos como éxitos.

## Revisión de calidad

Se revisaron corrección, claridad, arquitectura, seguridad y costo. Se conserva el contrato numérico existente 0..366; validación antes de efectos, sin nuevas dependencias ni consultas. Los mocks se limitan a DB, config, fuentes externas y proveedor; el cálculo y resolución de salario reales se ejercitan. El spy del calculador protege específicamente el valor cero frente al sentinel `undefined`, porque el bruto terminaba casualmente en cero aun perdiéndose ese contrato. Las demás aserciones verifican resultados/persistencia/payload. No se detectaron bloqueantes propios del incremento.

Los cambios locales de IMSS se conservaron. No se ejecutaron seeds, migraciones, llamadas a timbrador real ni notificaciones a personas. V2 y V3 no se acreditan con estas pruebas.

## Siguiente incremento

FIS-02: dividir semilla por vigencia monetaria sin solapamientos, seed correctivo idempotente con esquema actual y prueba DB aislada de repetición/caché; bloquear datos fiscales desconocidos en ejecución exigible y preservar recibos históricos. Luego FIS-03 y AGU-02/03 según sus dependencias. AGU-02 todavía debe corregir la retención sobre el gravado y rechazar años de tarifa no soportados; DIA-01/02 debe corregir la cobertura de días. Ninguna de esas tareas se considera resuelta por este checkpoint.

Brechas ya localizadas para reinvestigar en FIS-02: el seed agrupa 2020–abr-2026 con un solo mínimo y deja UMA nula; su fila may–dic-2026 contiene mínimo 2025 y UMA anterior a febrero. El upsert busca por inicio **y fin**: introducir nuevos intervalos sin acotar la fila previa dejaría solapamientos, por lo que no basta con agregar filas. El resolver cachea 300 segundos y busca la fila completa por `effectiveFrom`; comprobar unicidad/vigencias y renovación tras la corrección. Esta observación no acredita implementación ni ejecución del seed.
