# INV-01.b1 — Planificador exacto del diferencial

Aceptado **V1**, separado del padre al descomponer INV-01.b. Scope: `lib/services/sale-consumption-delta.ts` y `lib/services/__tests__/sale-consumption-delta.test.ts`. Depende de INV-01.a aceptado. Sin escrituras ni aceptación funcional de la fila 11.11.

La implementación, casos, comandos y resultados originales están en [INV-01.b](../INV-01.b/README.md) y [results.json](../INV-01.b/results.json): 20 pruebas nuevas, 150 secuencias generadas, 47 focales con contrato, suite 2488 aprobadas, tipos/lint/build exit 0. HEAD `ba88018d2cbd7d879549cfe6476d39e4addfd5d2` más diff local; entorno local. Revalidación al abrir el siguiente incremento: 64 pruebas focales entre contrato, diferencial y snapshot, exit 0.

Se verifica planificación exacta, procedencia de devoluciones y conservación matemática de saldo; disponibilidad y transacción reales son responsabilidad de b3. No se acepta b ni se declara modificación de stock operativo.
