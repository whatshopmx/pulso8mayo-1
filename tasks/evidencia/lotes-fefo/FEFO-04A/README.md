# FEFO-04A — Motor preparatorio de elegibilidad y asignación

Fecha: 2026-10-26. Incremento separado antes de implementar: cinco archivos (motor, pruebas, plan, checklist y esta evidencia). Depende del contrato FEFO-02; su integración FEFO-04B sigue condicionada al cierre de FEFO-03. No se declara completado FEFO-04 ni Checkpoint 1.

## Resultado

`lib/services/batch-allocation-policy.ts` implementa `allocateEligibleBatches`, una función pura que recibe candidatos, alcance, reloj y política. No importa `db`, no consulta servicios y no modifica saldos, estados, fechas ni movimientos.

- Exige empresa/sucursal/producto y reloj válido; excluye candidatos incompatibles, estados distintos de AVAILABLE y saldo no positivo o inválido.
- Un vencimiento igual o anterior al instante dado bloquea asignación, independientemente del cron. El timestamp histórico conserva su instante.
- Fecha nula se bloquea con política desconocida/requerida; sólo NONE explícito la permite. El motor no interpreta categorías ni deduce políticas de `typicalShelfLifeDays`.
- FEFO ordena vencimiento (nulo al final), antigüedad e ID; FIFO conserva las mismas guardas y ordena antigüedad/ID. Sin `receivedAt` se usa `createdAt`; sin ambas, la antigüedad desconocida queda al final. Se usa creación como segundo desempate y comparación determinista de ID.
- La selección explícita pasa todas las guardas; un ID ausente o no elegible no se sustituye por otro lote.
- Aritmética en enteros escalados a cuatro decimales, dentro del rango `numeric(12,4)`. No redondea cantidades con más precisión de negocio; tolera sólo ruido binario de entradas number, como `0.1 + 0.2`. Costo en centavos, incluido cero o null, se conserva.
- Devuelve requerido/asignado/faltante por separado y rechaza candidatos con ID repetido para evitar sobreasignación por duplicación de filas. No modifica el array ni objetos recibidos.

## Verificación

1. **RED:** `pnpm run test:unit tests/unit/inventory/batch-allocation-policy.test.ts --maxWorkers=1` falló por módulo todavía inexistente, antes de implementar el motor.
2. **GREEN inicial:** mismo comando, 27/27 pruebas aprobadas.
3. **Verificación final:** mismo comando tras añadir límites numéricos, antigüedad ausente, selección explícita y conservación generativa: **32/32 pruebas aprobadas**, código 0. Incluye 300 ejemplos de `fast-check` con semilla fija 20261026: suma asignada más faltante igual a requerido, ningún lote sobreasignado y resultado independiente del orden de entrada.
4. `pnpm exec eslint lib/services/batch-allocation-policy.ts tests/unit/inventory/batch-allocation-policy.test.ts`: código 0, sin salida.
5. `pnpm exec tsc --noEmit --skipLibCheck --target ES2017 --module esnext --moduleResolution bundler lib/services/batch-allocation-policy.ts`: código 0, sin salida. Es comprobación del módulo aislado; no equivale al build de Next completo.
6. Revisión separada de corrección/seguridad/arquitectura por otro agente, conforme a `code-review-and-quality`: sin hallazgos. Confirmó que autenticación, políticas autorizadas y revalidación bajo bloqueo siguen siendo responsabilidad de integración.

## Límites y siguiente incremento

Al inicio de esta continuación el sistema tenía 408 MiB libres de 7,418 MiB. No se repitieron build ni suite general con esa presión de memoria; sus ejecuciones previas siguen sin cierre, según evidencia de FEFO-03B. Las pruebas nuevas y herramientas enfocadas sí finalizaron. No se aplicaron migraciones ni operaciones sobre inventario real.

El motor todavía sólo es consumido por sus pruebas. El allocator operativo anterior conserva su comportamiento: **esto no corrige todavía el consumo real de vencidos ni los faltantes teóricos**. No se modificaron sus importadores para adelantar una activación sin dependencias verificadas.

FEFO-04B deberá cargar alcance/política desde fuentes autorizadas, comprobar consistencia de empresa en producto y sucursal y aplicar reglas con filas bloqueadas. No aceptar política NONE ni reloj como autoridad enviada por cliente. La planificación no mantiene locks ni permite descontar a partir de un preview antiguo; toda confirmación se revalida en servidor. La semántica de fecha civil y su zona se resolverá al capturar/persistir el instante límite, sin reinterpretar timestamps históricos. FEFO-04C alineará la consulta/selector. FEFO-05A deberá rechazar físicamente el faltante y hacer saldo/movimiento/idempotencia atómicos; FEFO-05C lo persistirá para ventas teóricas.
