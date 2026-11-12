# P0-02 — Matriz actualizada

Estado: aceptado, verificación D. Fecha: 2026-11-11.
HEAD: `ba88018d2cbd7d879549cfe6476d39e4addfd5d2` con diff local de [P0-01](../P0-01/baseline.json). Entorno documental local.

[Matriz nueva](../../../../docs/matriz-cumplimiento-sistema-2026-11-11.csv): 239 filas, los mismos IDs/módulos/requisitos que la matriz histórica. Conserva estado anterior, evidencia y pendiente original; añade estado nuevo, delta, evidencia de revisión, tareas y límite explícito. No se altera el CSV del 17 de octubre.

Solo 17.12, 17.13 y 17.14 cambian de estado: de ausencia de implementación a «Implementado en código; aceptación pendiente», apoyadas por los servicios bancarios y la investigación. Las otras 236 conservan su estado histórico, que tampoco equivale a aceptación. V2/V3 bancarias y fuentes externas siguen pendientes.

Comprobación reproducible: `pnpm.cmd exec tsx scripts/validate-faltantes.ts`, exit 0, 239 filas sin IDs duplicados, pérdida histórica ni discrepancias matriz/mapa. El generador se utilizó una vez; el CSV revisado y el mapa son los documentos editables de ejecución, no se regeneran para modificar estados sin revisión.
