# AGU-01 — Override manual explícito

Fecha: 2026-10-22. Base: `c14f95c7d85a452ce569fc7ec4e88b8890f40964`. Entorno: Vitest/UTC, DB y proveedor fiscal simulados; no hay timbres reales ni escrituras operativas.

Antes del cambio, el servicio convertía `diasLaborados: 0` en `undefined` en ambas bases. El cálculo terminaba casualmente en cero porque no recibía antigüedad; eso no preservaba el contrato explícito. `NaN` también se convertía a ausencia de dato; `null` y texto se ignoraban y elegían los días automáticos. La regresión capturó cinco fallos: dos por el cero perdido y tres por entradas inválidas aceptadas. `red.log` registra la ejecución inicial (exit 1).

Cambio: validar todos los overrides antes de cargar fuentes/crear el run, con el rango entero 0..366 del calculador existente; transmitir los días resueltos directamente en ambas bases. Preview y ejecución comparten la validación. El valor positivo, la propuesta automática y el calendario conservan su comportamiento.

Pruebas: cero en REGISTERED/EFFECTIVE, importes cero en payload y payslip simulado, sin bitácora de excedente de cero; positivo 30 días en preview→run; ausencia de override con/sin automático; rechazo de `NaN`, infinito, negativo, fracción, 367, null y texto antes de efectos. No sustituye V2 ni acredita recuperación/idempotencia de AGU-03 o veracidad de pagos de AGU-04.

Verificación final y revisión: [CHECKPOINT-01](../CHECKPOINT-01/README.md). Para pruebas focalizadas en este pnpm usar `pnpm run test:unit <archivos>`: el separador `--` del plan se reenvía literalmente a Vitest y ejecutó la suite completa en el primer intento.
