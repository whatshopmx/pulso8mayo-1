# `INV-01.c` — concurrencia (`races`) y cadena de servicios de recuperación histórica

2026-11-22. Base `d05eae09d67ed0b190b6785da168a8fb8b564fd0` + árbol local, build de producción `BUILD_ID: 3uHsQamaXwpx8-UdKZkBZ`.

**Registros aceptados en entorno aislado (46 → 60 aceptados):**
1. **`INV-01.c.races`** (V2)
2. **`INV-01.c.recovery.contract`** (V1)
3. **`INV-01.c.recovery.objects`** (V1, V2 — incluye verificación real contra R2 privado)
4. **`INV-01.c.recovery.persistence`** (V1, V2)
5. **`INV-01.c.recovery.subject.schema`** (V1, V2)
6. **`INV-01.c.recovery.subject.access`** (V1, V2)
7. **`INV-01.c.recovery.attestation.schema`** (V1, V2)
8. **`INV-01.c.recovery.attestation.service`** (V1, V2)
9. **`INV-01.c.recovery.historical`** (V1, V2)
10. **`INV-01.c.recovery.provenance`** (V1, V2)
11. **`INV-01.c.recovery.sources`** (V1, V2)
12. **`INV-01.c.recovery.proposal.service`** (V1, V2)
13. **`INV-01.c.recovery.decision.service`** (V1, V2)
14. **`INV-01.c.recovery.apply`** (V1, V2)

**Siguen abiertos explícitamente:** `INV-01.c.recovery.ui-routes` (pendiente recorrido Next + Better Auth + R2 real en navegador; Playwright controlado 4/4 con API simulada queda registrado como avance), `INV-01.c.recovery`, `INV-01.c`, `INV-01.d` y la fila `11.11`.

## Evidencia ejecutada sobre el estado actual

| Capa | Comando | Resultado |
| --- | --- | --- |
| V1 unitarias `sale-recovery` (14 archivos) | `node node_modules/vitest/vitest.mjs run --configLoader bundle lib/services/__tests__/sale-recovery-apply.test.ts lib/services/__tests__/sale-recovery-attachments.test.ts lib/services/__tests__/sale-recovery-attestations.test.ts lib/services/__tests__/sale-recovery-decision.test.ts lib/services/__tests__/sale-recovery-evidence.test.ts lib/services/__tests__/sale-recovery-historical.test.ts lib/services/__tests__/sale-recovery-proposals-route.test.ts lib/services/__tests__/sale-recovery-proposals.test.ts lib/services/__tests__/sale-recovery-review.test.ts lib/services/__tests__/sale-recovery-source-documents.test.ts lib/services/__tests__/sale-recovery-sources.test.ts lib/services/__tests__/sale-recovery-storage.test.ts tests/unit/inventory/sale-recovery-attestations-route.test.ts tests/unit/inventory/sale-recovery-evidence-route.test.ts --maxWorkers=1 --pool=threads` | **97/97**, 14 archivos, `exit 0`, 46.69 s |
| V2 concurrencia + servicios SQL Neon (`pulso_app` NOBYPASSRLS) | `node --use-system-ca --max-old-space-size=4096 node_modules/vitest/vitest.mjs run --configLoader bundle --config vitest.integration.config.ts tests/integration/sale-consumption-concurrency-db.test.ts tests/integration/sale-recovery-persistence-db.test.ts tests/integration/sale-recovery-attachments-db.test.ts tests/integration/sale-recovery-attestations-schema-db.test.ts tests/integration/sale-recovery-attestations-db.test.ts tests/integration/sale-recovery-historical-db.test.ts tests/integration/sale-recovery-sources-db.test.ts tests/integration/sale-recovery-proposals-db.test.ts tests/integration/sale-recovery-decision-db.test.ts tests/integration/sale-recovery-apply-db.test.ts tests/integration/sale-recovery-e2e-db.test.ts --maxWorkers=1 --pool=threads` | **11/11 archivos (60/60 casos)**, `exit 0` (concurrencia 5/5, E2E 3/3, apply 6/6, proposals 8/8, decision 5/5, persistence 7/7, historical, sources, attachments, attestations-schema, attestations) |
| V2 precisión microsegundos/JSONB + catálogo enum `0144` | `node --use-system-ca --max-old-space-size=4096 node_modules/vitest/vitest.mjs run --configLoader bundle --config vitest.integration.config.ts tests/integration/sale-recovery-evidence-catalog-db.test.ts tests/integration/sale-recovery-review-precision-db.test.ts --maxWorkers=1 --pool=threads` | **5/5**, 2 archivos, `exit 0`, 8.79 s (se ajustó la aserción de prefijo en `sale-recovery-evidence-catalog-db.test.ts` para convivir con las etiquetas aditivas aceptadas de `EVI-02.a`; ESLint limpio) |
| V2 objetos privados reales en R2 (`INV-01.c.recovery.objects`) | `node --use-system-ca --max-old-space-size=4096 node_modules/vitest/vitest.mjs run --configLoader bundle --config vitest.integration.config.ts tests/integration/sale-recovery-objects-r2-db.test.ts --maxWorkers=1 --pool=threads` | **1/1**, `exit 0`, 4.68 s (descarga real de bytes privados, verificación SHA-256/tamaño, rechazo de hash alterado, ausencia `NoSuchKey` y empresa ajena `INVALID_SCOPE`, más borrado verificado) |
| Avance UI controlada (no acepta `ui-routes`) | `node node_modules/@playwright/test/cli.js test --config tests/playwright-sale-recovery.config.ts` | **4/4** Chromium, `exit 0`, 1.2 min |
| Lint pruebas modificadas/nuevas | `node node_modules/eslint/bin/eslint.js tests/integration/sale-recovery-evidence-catalog-db.test.ts tests/integration/sale-recovery-objects-r2-db.test.ts` | `exit 0`, sin advertencias |

## Límites explícitos

- Las migraciones candidatas (`0143`/`0144`/`0145`) no se aplicaron al entorno operativo ni a `main` (quedan para `OPS-03`).
- Las pruebas SQL de los servicios de recuperación ejecutan con `pulso_app` NOBYPASSRLS en transacciones con rollback sobre Neon aislado y con sesión/R2 simulados en cada servicio; la verificación real de objetos privados en R2 se acredita por separado en `sale-recovery-objects-r2-db.test.ts`.
- `INV-01.c.recovery.ui-routes`, `INV-01.c.recovery`, `INV-01.c`, `INV-01.d` y la fila `11.11` permanecen abiertos hasta acreditar el recorrido integrado con sesión Better Auth, R2 y navegador Next reales.
