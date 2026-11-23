# `INV-02` — políticas de consumo por versión/vigencia y cierre del frente

2026-11-22. Base `43428b1c4ea8bb0543014014301eb05d76b7c675`, build de producción `BUILD_ID: 3uHsQamaXwpx8-UdKZkBZ`.

**Registros aceptados en entorno aislado (64 → 71 aceptados junto con `INV-01.d`):**
- **`INV-02.contract`** (V1)
- **`INV-02.schema`** (V1, V2)
- **`INV-02.publish.rls`** (V1, V2)
- **`INV-02.publish`** (V1, V2)
- **`INV-02.snapshot`** (V1, V2)
- **`INV-02.apply`** (V1, V2)
- **`INV-02`** (padre P — todos sus 6 hijos acreditados; dependencia `INV-01.c` aceptada)

## Evidencia ejecutada sobre HEAD `43428b1`

| Capa | Comando | Resultado |
| --- | --- | --- |
| V1 unitarias y PGlite (`0159`/`0160`, 6 archivos) | `node node_modules/vitest/vitest.mjs run --configLoader bundle lib/services/__tests__/recipe-consumption-policy.test.ts lib/services/__tests__/recipe-consumption-publication-retry.test.ts lib/services/__tests__/published-sale-snapshot.test.ts tests/unit/inventory/recipe-consumption-policy-db.test.ts tests/unit/inventory/recipe-policy-publication-access-db.test.ts tests/unit/inventory/recipe-policy-publication-service-db.test.ts --maxWorkers=1 --pool=threads` | **99/99**, 6 archivos, `exit 0`, 48.45 s |
| V2 PostgreSQL nativo con LOGIN independiente, `0159`/`0160` y 2 carreras reales | `$env:RUN_RECIPE_POLICY_RUNTIME='1'; node --use-system-ca --max-old-space-size=4096 node_modules/vitest/vitest.mjs run --configLoader bundle --config vitest.integration.config.ts tests/integration/recipe-policy-runtime-db.test.ts --maxWorkers=1 --pool=threads` | **8/8**, `exit 0`, 126.15 s |

Limpieza verificada: base desechable `inv_sales_next_937310ec5dd5415593f6b5910352fb16` y rol `inv_sales_role_0e41848accd646c1a4413b914b85a350` retirados (`databaseCreated: false`, `roleCreated: false`, `closed: true`).

## Límites explícitos

- Las migraciones `0159_inv02_consumption_policy.sql` y `0160_inv02_policy_publication_access.sql` no se aplicaron al entorno operativo ni a `main` (quedan para `OPS-03`).
- `SALES_RECIPE_POLICY_MODE=PUBLISHED` no se activa externamente; el modo de consumo de producto elaborado permanece bloqueado (`fail-closed`) hasta `PROD-01.b`.
- La fila `11.11` permanece abierta hasta la aceptación de módulo `VAL-01.M01-M17.M11`.
