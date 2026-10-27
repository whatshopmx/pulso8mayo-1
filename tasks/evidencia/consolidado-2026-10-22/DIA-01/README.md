# DIA-01 — Contrato de días computables

2026-10-26. Contrato, fuente y oráculos en [docs/aguinaldo-dias-contrato.md](../../../../docs/aguinaldo-dias-contrato.md). No modifica todavía la consulta ni los consumidores: DIA-02 sigue pendiente.

## Implementación y verificación

- `lib/services/aguinaldo-days-policy.ts`: función pura de calendario/vigencia menos unión de ausencias aprobadas con tratamiento explícito. Conserva IDs/rangos/tratamientos, fechas descontadas, conflictos, corte/zona y cobertura parcial. No interpreta la ausencia de un turno como falta.
- `tests/unit/aguinaldo-days-policy.test.ts`: **12/12, exit 0**, `pnpm.cmd run test:unit tests/unit/aguinaldo-days-policy.test.ts`. RED inicial por módulo ausente; GREEN 11/11; se agregó y verificó un caso independiente de clasificación pendiente sin override, resultado final 12/12 (641 ms).
- Verifica año completo con un turno, calendario de descansos/festivos, vacaciones/licencia protegida, alta a mitad de año, rangos solapados, pendientes, conflictos y override manual cero/positivo. Fechas imposibles, zona desconocida y manual negativo/fraccionario se rechazan. Incluye baja efectiva y conteo civil bisiesto.
- ESLint de ambos archivos: **exit 0**, sin errores ni advertencias.
- Fuentes oficiales LFT/PROFEDET reconsultadas y enlazadas en el contrato. Se distinguen sus reglas de las decisiones del adaptador y de la política de empresa; isPaid o un nombre libre no se presentan como clasificación jurídica suficiente.

## Límites

No cambia la fórmula monetaria ni la propuesta actual de la pantalla. El conteo de días civiles bisiestos no modifica DIAS_PRORRATEO del motor monetario. No escribe DB, no emite CFDI ni mensajes y no implica rollout. DIA-02 debe normalizar fechas/estados/fuentes reales, resolver la clasificación pendiente y demostrar dos empresas, zona, turnos nocturnos, solapamientos y preview→run. AGU-04 conserva la aceptación integral de bases y bitácora.

La suite global de OPS-01 se descubrió antes de crear este contrato: 2211 passed/19 fallos FEFO, y no sustituye estas 12 pruebas focalizadas. Los resultados de build del checkpoint se registran en OPS-01; no se declara una puerta de fase cerrada.
