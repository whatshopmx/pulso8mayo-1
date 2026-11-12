# P0-03 — Mapa fila → tarea → evidencia

Estado: aceptado, verificación D. Fecha: 2026-11-11.
HEAD: `ba88018d2cbd7d879549cfe6476d39e4addfd5d2` más el diff documentado en P0-01 y los archivos de esta continuación. Entorno local, sin escrituras operativas.

El [mapa](../../../mapa-implementacion-faltantes.json) materializa las 239 filas y 62 hijos de los padres del plan. Cada fila declara sus tareas ejecutables y una aceptación explícita. Las aceptaciones de módulo dependen de todas las tareas de sus filas, además de las dependencias heredadas y el lote de seguridad. Se distinguen los 17 módulos, los canales de módulo 18, ocho perfiles de módulo 19 y configuración/carga de módulo 20; no se omiten estas últimas por el nombre histórico M01-M17. Los siete casos 05.C1–C7 tienen hijos propios.

Los hijos heredan criterios y verificaciones del padre y añaden el alcance en su título. Antes de abrirlos deben fijar sus archivos/casos concretos y subdividirse si exceden cinco archivos o una sesión. Los formatos externos aún no identificados no están aceptados. Este mapa no promete ausencia de nuevas brechas al ejecutar los recorridos.

Validador: `pnpm.cmd exec tsx scripts/validate-faltantes.ts`. Rechaza filas vacías/huérfanas/duplicadas, referencias inválidas, padres usados como ejecutables, dependencias omitidas, ciclos (incluido padre → hijos), diferencias CSV/mapa y cierres sin evidencia con HEAD, entorno, comprobaciones y comandos exitosos. Una fila aceptada exige sus tareas aceptadas. Las rutas de evidencia futura no se fabrican: los pendientes tienen evidencia vacía.

Pruebas: `pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads tests/unit/faltantes-traceability.test.ts tests/unit/migration-manifest.test.ts`, exit 0: 20 casos (11 de trazabilidad y 9 de manifiesto). Incluyen corrupción de CSV, huérfanas, ciclos, cierre fraudulento y baseline con hashes alterados o sin ancla.

La validación es documental; no evalúa semánticamente un archivo de evidencia ni sustituye V1/V2/V3 o un proveedor real. Checkpoints y puertas se revisan en sus fichas, no mediante el conteo de casillas.
