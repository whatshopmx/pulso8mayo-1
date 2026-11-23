# Cobertura financiera (COGS, Menú, Ejecutivo) y cierre de `INV-01.b4` / `INV-01.b`

2026-11-22. Base `d05eae09d67ed0b190b6785da168a8fb8b564fd0` + árbol local, build de producción `BUILD_ID: 3uHsQamaXwpx8-UdKZkBZ`.

**Registros aceptados en entorno aislado (37 → 46 aceptados):**
- **INV-01.b4.coverage.cogs** (V1, V2, V3)
- **INV-01.b4.coverage.menu.rls** (V2)
- **INV-01.b4.coverage.menu** (V1, V2, V3)
- **INV-01.b4.coverage.executive.catalog.rls** (V2)
- **INV-01.b4.coverage.executive.sources.rls** (V2)
- **INV-01.b4.coverage.executive** (V1, V2, V3)
- **INV-01.b4.coverage** (padre P; todos sus hijos acreditados)
- **INV-01.b4** (todas sus 14 dependencias acreditadas: `a`, `b3`, `b4b`, `b4b.rls`, `manual`, `bulk`, `smartlink`, `ui`, `coverage`, `runtime.config`, `manual.next`, `ui.next`, `smartlink.next`, `smartlink.ui`)
- **INV-01.b** (padre P; todos sus 20 hijos acreditados)

No se aceptan `INV-01.c`, `INV-01.d` ni la fila `11.11`. Historial de evidencia parcial previa: [evidence-history.json](evidence-history.json).

## Evidencia ejecutada sobre el estado actual

| Capa | Comando | Resultado |
| --- | --- | --- |
| V1 unitarias cobertura | `node node_modules/vitest/vitest.mjs run --configLoader bundle tests/unit/inventory/executive-report-route.test.ts tests/unit/inventory/menu-engineering-coverage.test.ts lib/services/__tests__/executive-report-coverage.test.ts lib/services/__tests__/cogs-revenue-coverage.test.ts lib/services/__tests__/cogs-route-boundaries.test.ts --maxWorkers=1 --pool=threads` | **50/50**, 5 archivos, `exit 0`, 22.75 s |
| V1 lint | `node node_modules/eslint/bin/eslint.js lib/services/sale-revenue-coverage.ts lib/services/inventory-reports-service.ts app/api/inventory/reports/cogs/route.ts app/api/inventory/menu-engineering/route.ts app/api/inventory/reports/executive/route.ts tests/integration/cogs-revenue-coverage-db.test.ts tests/integration/menu-revenue-coverage-db.test.ts tests/integration/executive-revenue-coverage-db.test.ts tests/integration/cogs-session-db.test.ts` | `exit 0`, sin advertencias |
| V1 build producción | `next build --webpack` (`BUILD_ID: 3uHsQamaXwpx8-UdKZkBZ`) | `exit 0` |
| V2 SQL runtime + V3 HTTP Better Auth | `node --use-system-ca --max-old-space-size=4096 node_modules/vitest/vitest.mjs run --configLoader bundle --config vitest.integration.config.ts tests/integration/cogs-revenue-coverage-db.test.ts tests/integration/menu-revenue-coverage-db.test.ts tests/integration/executive-revenue-coverage-db.test.ts tests/integration/cogs-session-db.test.ts --maxWorkers=1 --pool=threads` | **16/16**, 4 archivos, `exit 0`, 134.12 s |
| V3 navegador Next producción | `node .tmp/coverage-next-browser-verify.cjs` (`RUN_COGS_NEXT_BROWSER=1`) | **4/4**, `exit 0`, 82.69 s |

### Detalle de los 16 casos SQL/HTTP y 4 casos Next de producción

- **COGS runtime (`cogs-revenue-coverage-db.test.ts`, 3/3, 20.00 s)**: Neon aislado, `SET LOCAL ROLE pulso_app` (NOBYPASSRLS/NOSUPERUSER), candidata `0154_inv01b_cogs_reader.sql` en rollback, 2 empresas / 3 sucursales, oráculo 3 × 0.5 kg × 200 ¢ = 300 ¢ contra 1200 ¢ → 25%, cobertura parcial/vacía/cero explícito vs `NULL` y denegación sin contexto.
- **Menú runtime (`menu-revenue-coverage-db.test.ts`, 4/4, 21.82 s)**: Neon aislado, `SET LOCAL ROLE pulso_app`, candidata `0156_inv01b_menu_reader.sql` en rollback, 2 empresas / 3 sucursales, gerente acotado a su sucursal, denegación de `SELECT *`/`UPDATE` en savepoints y revisión vigente cero vs `NULL`.
- **Ejecutivo runtime (`executive-revenue-coverage-db.test.ts`, 3/3, 37.64 s)**: Neon aislado, `SET LOCAL ROLE pulso_app`, candidatas `0157_inv01b_executive_reader.sql` y `0158_inv01b_executive_sources.sql` en rollback, 2 empresas / 3 sucursales, oráculos de stock/merma/conteos, workflows ajenos ocultos, falla cerrada sin contexto y revisión vigente cero vs `NULL`.
- **HTTP con Better Auth real (`cogs-session-db.test.ts`, 6/6, 43.54 s)**: 2 casos por cada ruta (`/api/inventory/reports/cogs`, `/api/inventory/reports/executive`, `/api/inventory/menu-engineering`) con anónimo 401, spoofing de tenant 403, sucursal ajena, gerente sin asignación denegado y expiración de sesión.
- **Navegador Next producción (`cogs-next-browser.test.ts`, 4/4, 82.69 s)**: servidor Next producción sobre `BUILD_ID: 3uHsQamaXwpx8-UdKZkBZ`, Chromium, Better Auth y Neon reales; ejecutivo parcial/vacío/400 recuperable/logout (34.85 s), menú parcial/vacío/logout (14.15 s), COGS parcial/vacío/aislamiento/logout (10.23 s) y regresión manual (7.44 s); limpieza de fixtures verificada (`Synthetic report fixtures removed and verified`).

## Límites explícitos

- Las candidatas `0154`, `0156`, `0157` y `0158` se verificaron dentro de transacciones con rollback en Neon aislado; no se aplicaron al entorno operativo ni a `main` (quedan para `OPS-03`).
- Las suites SQL de cobertura usan `SET LOCAL ROLE pulso_app` dentro del fixture transaccional, y las pruebas HTTP/Next de lectores usan conexión dueña sobre Neon aislado; los escritores runtime de merma/workflows pertenecen a `SEC-05`.
- Valoración histórica de costos y rendimiento con volumen operativo quedan fuera de este alcance.
- `INV-01.c` (carreras y recuperación histórica), `INV-01.d` y la fila `11.11` siguen abiertos.
