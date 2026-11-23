# POS Storage / Smartlink Next / Smartlink UI — aceptación aislada V1/V2/V3

2026-11-22. Base `d05eae09d67ed0b190b6785da168a8fb8b564fd0` + árbol local.

**Registros aceptados en entorno aislado:**
- **INV-01.b4.storage** (V1, V2, V3) — dependencias `INV-01.a`, `INV-01.b4.smartlink` aceptadas.
- **INV-01.b4.smartlink.next** (V2) — dependencias `INV-01.a`, `INV-01.b3`, `INV-01.b4b`, `INV-01.b4.runtime.config`, `INV-01.b4.smartlink`, `INV-01.b4.storage` aceptadas.
- **INV-01.b4.smartlink.ui** (V1, V3) — dependencias `INV-01.a`, `INV-01.b3`, `INV-01.b4b`, `INV-01.b4.smartlink`, `INV-01.b4.smartlink.next`, `INV-01.b4.storage` aceptadas.

Mapa: **37 registros aceptados**. No se aceptan `INV-01.b4`, `INV-01.b`, `INV-01.d` ni la fila `11.11` (siguen pendientes `INV-01.b4.coverage` y `INV-01.c`).

## Evidencia ejecutada

| Capa | Comando | Resultado |
| --- | --- | --- |
| V1 unitarias selección/frontera | `node node_modules/vitest/vitest.mjs run --configLoader bundle tests/unit/sales/pos-runtime-connection.test.ts tests/unit/inventory/sales-entry-smart-link.test.ts tests/unit/sales/pos-file-read.test.ts tests/unit/inventory/sales-runtime-connection.test.ts --maxWorkers=1 --pool=threads` | **47/47**, 4 archivos, `exit 0`, 31.59 s |
| V1 lint | `node node_modules/eslint/bin/eslint.js lib/db/pos-file-runtime.ts lib/services/pos-cut-file-service.ts tests/unit/sales/pos-runtime-connection.test.ts tests/integration/pos-cut-file-runtime-db.test.ts tests/integration/helpers/sales-runtime-database.ts tests/integration/helpers/sales-runtime-next-server.ts tests/integration/sales-runtime-next-browser.test.ts` | `exit 0`, sin advertencias |
| V1 build producción | `next build --webpack` (`BUILD_ID: 3uHsQamaXwpx8-UdKZkBZ`, `2026-11-22 16:46:39 -06:00`) | `exit 0` |
| V2 SQL selección runtime | `node .tmp/pos-runtime-db-verify.cjs` (`RUN_POS_STORAGE_RUNTIME=1`) | **6/6**, `exit 0`, 172.70 s (`2026-11-22T22:29:15.002Z`) |
| V2/V3 Next + Chromium + R2 + `POS_FILES_RUNTIME_DATABASE_URL` | `node .tmp/pos-storage-next-verify.cjs` (`RUN_SALES_RUNTIME_NEXT_BROWSER=1`, `RUN_SALES_RUNTIME_POS=1`, `RUN_POS_FILES_RUNTIME_NEXT=1`, `RUN_SALES_FRESH_BASELINE=0`) | **4/4**, `exit 0`, 316.89 s (`2026-11-22T22:59:52.509Z`) |

Detalles estructurados de la corrida Next: [next-results.json](next-results.json). Historial de evidencia parcial previa: [evidence-history.json](evidence-history.json).

### Casos acreditados en la corrida Next (`BUILD_ID: 3uHsQamaXwpx8-UdKZkBZ`)

1. `Next HTTP + R2 + real writer runtime: POS ingestion and evidence` (92.11 s): stepper principal con `POS_FILES_RUNTIME_DATABASE_URL` y `SALES_RUNTIME_DATABASE_URL` apuntando al rol LOGIN mínimo (candidata `0155_pos_storage_rls.sql` + 0137/0138/0139/0141 instaladas solo en la copia desechable). Subida multipart a R2 real, lectura firmada `GET /api/sales/cuts/:id/pos-file`, identidad compartida con bulk, correcciones 10→12→8, ingreso `80.25` → 8025 sin mover stock, insuficiencia con advertencia/evidencia, JSON solo enlace, cancelación a 0, guardado de paso sin reingestión, cierre de sesión (401 sin efectos) y borrado verificado de los 6 objetos del prefijo privado.
2. `Next HTTP + R2 + real writer runtime: POS alternate executor` (97.26 s): mismo recorrido completo con `POS_FILES_RUNTIME_DATABASE_URL` activo desde `WorkflowExecutor` (`/dashboard/workflows/execute/:id`), incluyendo capturas escritorio/móvil y limpieza R2.
3. `Next + Chromium + real session: POS library installation and editor persistence` (26.21 s): clonación desde Catálogo Pulso, edición con `Ctrl+S`, recarga y verificación SQL de `config.posUpload` sin generar ventas ni movimientos.
4. `Next + real POS file runtime: rejects owner configuration without reading or linking cuts` (20.24 s): servidor Next configurado con `POS_FILES_RUNTIME_DATABASE_URL` apuntando a la URI dueña rechaza con `503` seguro tanto `GET /api/sales/cuts/:id/pos-file` como `POST /api/workflows/smart-links/upload-pos` (con key canónica `{ts}_not-uploaded.csv`), sin fallback al dueño ni mutación de `daily_sales_cuts` o inventario.

En un primer intento de esa corrida (3/4), el cuarto caso devolvió `400` en `POST /api/workflows/smart-links/upload-pos` porque el fixture enviaba `not-uploaded.csv` sin prefijo `{ts}_`; se corrigió la key del test a `1_not-uploaded.csv` (sin cambios de código de aplicación) y la repetición completa cerró **4/4** (`exit 0`).

### Limpieza y aislamiento

- Base desechable `inv_sales_next_8f41f0dbd79d4390b0a9a33eafd574a6` y rol `inv_sales_role_161b62ea0fcd4affa006144bd01d7e0d` eliminados y verificados (`databaseCreated: false`, `roleCreated: false`, `closed: true`).
- Cero objetos remanentes en R2 bajo los prefijos sintéticos; todos los servidores Next efímeros cerrados.
- Se conservan las evidencias previas de V1/V2/V3 HTTP y navegador del productor directo ([2026-11-17 README](../../2026-11-17/INV-01.b4.storage/README.md), [legacy-producer](../../2026-11-17/INV-01.b4.storage/legacy-producer.md), [next-browser-v3](../../2026-11-17/INV-01.b4.storage/next-browser-v3.md)), las unitarias/Playwright de ambos ejecutores ([2026-11-21 smartlink.ui](../../2026-11-21/INV-01.b4.smartlink.ui/alternate-executor.md)) y el SQL de selección ([runtime-selection.md](runtime-selection.md)).

## Límites explícitos

- No se aplicó ninguna migración a la base operativa ni a `main`; la candidata `0155_pos_storage_rls.sql` queda pendiente de `OPS-03`.
- No hay backfill de claves legacy `sales-cuts` ni activación de secretos operativos (`POS_FILES_RUNTIME_DATABASE_URL`).
- Auth, lookup previo y el alta directa `/api/sales/cuts/upload` conservan sus propias fronteras (`SEC-05`); la concurrencia de dos subidas directas simultáneas del mismo corte queda fuera de este alcance.
- Copias históricas de plantillas de cierre que perdieron `config.posUpload` antes del fix de plantilla requieren caracterización/tratamiento propio.
- La ausencia global de `<Toaster />` en layouts sigue registrada como brecha transversal abierta.
- No se aceptan `INV-01.b4`, `INV-01.b`, `INV-01.d` ni la fila `11.11`.
