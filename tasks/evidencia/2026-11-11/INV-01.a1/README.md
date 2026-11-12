# INV-01.a1 — Contrato y caracterización

Verificación V1. HEAD `ba88018d2cbd7d879549cfe6476d39e4addfd5d2`, diff local descrito por el [padre](../INV-01.a/README.md).

Archivos: `lib/services/sale-consumption-contract.ts`, `lib/services/__tests__/sale-consumption-contract.test.ts` y documentación de contrato/caracterización del padre. Sin conexión al importar el módulo puro ni cambios en el writer legacy.

27 unitarias: identidad normalizada y separada de receta; cinco dimensiones y separadores sin colisión; inputs vacíos/inválidos, fecha civil/bisiesto, precisión/límites de numeric(10,2), secuencia/cantidad previa para 10→12→8→0 y límite integer de revisión. Primero falló la carga por módulo inexistente; después pasaron 26/26. La revisión añadió una reproducción funcional: un head undefined o sin cantidad se convertía en cero. Se exige null explícito para el primer hecho y se rechaza un estado desconocido/incompleto; el caso adicional se registra en el checkpoint.

La caracterización real encontró cero filas en ambos destinos nuevos, no una base histórica aceptada. No se dedujo consumo para registros de otra cuenta ni se ejecutó backfill. Tipos/lint/checkpoint final en [results.json](../INV-01.a/results.json).

Límite: este hijo define datos y validación pura; no escribe venta/stock ni decide por sí solo si un reintento necesita revisión. Esa decisión debe comparar el contenido vigente en INV-01.b.
