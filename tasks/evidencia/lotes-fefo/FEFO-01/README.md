# FEFO-01 — Diagnóstico y mapa de lotes

Fecha: 2026-10-24. Incrementos FEFO-01A/B. Usuario autorizó usar cualquier sucursal del demo al indicar que no hay clientes actuales. Se eligió Condesa, la sucursal con más lotes. No se corrigieron saldos ni se aplicaron migraciones.

## Herramienta

Desde la raíz del proyecto:

```powershell
pnpm exec tsx scripts/diag-lotes-fefo.ts --company=<uuid> --branch=<uuid> --as-of=2026-10-24T12:00:00Z
```

`--branch` es opcional; omitirlo incluye las sucursales de la empresa indicada. Credenciales: `DATABASE_URL` del proceso, después `.env.local`, después `.env`, sin sobrescribir valores previos. No existe opción de escritura. Opciones desconocidas, duplicadas, identificadores inválidos y fechas sin instante UTC se rechazan antes de conectar.

La consulta usa una transacción `REPEATABLE READ READ ONLY`, timeout de 60 segundos y termina con `ROLLBACK`. El JSON incluye identificadores técnicos, cantidades decimales como texto, estado, origen y fechas; no incluye nombres de personas ni credenciales. Guardar la salida únicamente en el entorno de evidencia autorizado.

El alcance pertenece a la empresa de la **sucursal**; un producto de otra empresa se señala como inconsistencia, para no ocultar registros corruptos. Lotes sin sucursal válida quedan fuera: esta herramienta no demuestra ausencia de huérfanos globales. Un alcance inexistente devuelve cero filas; verificar los identificadores antes de interpretar ese resultado.

## Interpretación y límites

- `negative`: cantidad actual menor que cero; no oculta lotes negativos.
- `missing_expiration`: dato nulo, incluso para productos no perecederos. Es inventario de datos faltantes, no prueba de incumplimiento de una política todavía no definida.
- `expired_available`: saldo positivo y estado AVAILABLE con timestamp anterior al corte UTC. El instante igual al corte no se marca. Esto NO decide elegibilidad operativa ni interpreta etiquetas de fecha civil; FEFO-02 debe cerrar esa semántica.
- `NO_MOVEMENTS`: no hay historial vinculado al lote.
- `MATCHES_LEDGER`: saldo igual a suma de movimientos.
- `MATCHES_INITIAL_PLUS_LEDGER`: coincide usando cantidad inicial como apertura.
- `REVIEW_DELTA`: ninguna base coincide o existe movimiento cuyo producto/sucursal difiere del lote.

Se muestran ambas diferencias, cantidad de entradas RECEIVING, número de movimientos y primera/última fecha. Ninguna coincidencia demuestra historial completo; una apertura puede estar incluida en RECEIVING o existir fuera del kardex. Los movimientos sin batch_id no se atribuyen por inferencia. Las sumas incluyen los movimientos vinculados al ID, incluso inconsistentes, que se cuentan separadamente.

El saldo y el ledger son los **actuales al ejecutar**. `--as-of` sólo fija la comparación de caducidad: no reconstruye inventario histórico ni filtra movimientos por fecha. Las cantidades se calculan en PostgreSQL con numeric, sin conversión a flotantes. La clasificación no propone montos para sanear ni prueba doble incremento por sí sola.

## Mapa de escrituras

CodeGraph se consultó primero (`context`, `explore`, `callers`). No devolvió aristas para la constante de lotes ni para `recordMovement`; se completó el mapa con referencias literales a tablas y operaciones. Las referencias no prueban por sí solas una llamada efectiva en producción.

| Entrada / escritor | Operación sobre lote y kardex | Seguimiento |
|---|---|---|
| `app/actions/inventory-transactions.ts` | `addBatch` usa `createReceivingBatch`; `recordUsage` usa `recordMovement` | Incluir acciones de servidor al unificar permisos/salidas |
| `receiving-service.ts`, `workflow-action-runner.ts` | Recepción vía `createReceivingBatch`: lote nace en cero; movimiento incrementa dentro de transacción | Preservar protección REC-01 |
| `inventory-service.ts` | `createBatch` inserta; `recordMovement` inserta movimiento y modifica saldo; envío explícito/FEFO descuenta y registra; destino crea lote; ajuste puede crear lote | FEFO-05A, 07A/B; revisar todos los caminos, no sólo allocator |
| `theoretical-consumption-service.ts` | FEFO + movimientos en transacción; faltante descuenta último lote o crea DUMMY-NEG | FEFO-05C |
| `production-service.ts`, `recipe-production.ts` | Asignación y descuento de ingredientes; producción actual conserva TODO de lote terminado | FEFO-09A/B |
| `stock-count-service.ts` | Crea lote de ajuste si falta y llama `recordMovement` con transacción | FEFO-05B |
| `app/api/inventory/waste/route.ts` | Actualiza saldo directamente y registra merma/movimiento | FEFO-05B: verificar atomicidad y exceso |
| `app/api/inventory/waste/[id]/approval/route.ts` | Aprobación actualiza saldo en transacción | FEFO-05B: concurrencia/doble aprobación |
| `app/api/inventory/batches/route.ts` PATCH | Cambia estado directamente; recibe notes sin persistir auditoría aquí | FEFO-03 |
| `expiration-alert-service.ts` | Cambia AVAILABLE a EXPIRED | FEFO-04 no puede depender del cron |
| `lib/inngest/functions/cron-stock-check.ts` | Lee saldos cada seis horas y llama `processExpirationCutoffs` | Mismo escritor de estado anterior |
| `scripts/diag-receiving-overcount.ts` | Reporte REC-03 con modo --apply que inserta ADJUSTMENT y actualiza saldo | No invocado; esta herramienta nueva carece de modo apply |
| `scripts/seed-04-inventory.ts`, `seed-13-receiving-matching.ts`, `seed-14-current-operations.ts` | Datos de inicialización/demostración | No ejecutar para diagnosticar ni inferir apertura real |

Rutas relativas de servicios corresponden a `lib/services/`. `production-from-workflow.ts` y `stock-count-from-workflow.ts` integran los servicios respectivos; `merma-from-workflow.ts` consulta lotes/costos y requiere contraste al integrar merma. Las rutas receiving/production y acciones de workflows son entradas indirectas además de los escritores directos.

## Mapa de lectores

| Grupo | Archivos |
|---|---|
| API operativa | `app/api/inventory/{batches,expirations,dashboard,movements,low-stock,receiving,production,products}/route.ts`, `products/[id]/route.ts` |
| API analítica/reportes | `app/api/analytics/inventory/stock-valuation/route.ts`, `app/api/analytics/branch-performance/route.ts`, `app/api/reports/generate/route.ts` |
| Asignación/operación | `fefo-allocator.ts`, `inventory-service.ts`, `production-service.ts`, `recipe-production.ts`, `theoretical-consumption-service.ts`, `stock-count-service.ts`, `stock-count-from-workflow.ts`, `merma-from-workflow.ts` |
| Alertas/cron | `expiration-alert-service.ts`, `stock-alert-service.ts`, `advanced-alert-service.ts`, `lib/cron/inventory-checks.ts`, cron de Inngest anterior |
| Reportes/costos/planificación | `inventory-reports-service.ts`, `inventory-snapshot-service.ts`, `period-service.ts`, `analytics-service.ts`, `financial-kpi-service.ts`, `executive-report-service.ts`, `kpi-calculator.ts`, `knowledge-service.ts`, `suggested-order-service.ts`, `purchase-order-service.ts`, `predictive-scoring-service.ts`, `prep-list-service.ts`, `intelligence/procurement-engine.ts` |
| Cliente vía API | `hooks/queries/use-lots.ts`, `components/inventory/{lot-selector,product-detail-drawer,waste-form}.tsx`, `app/dashboard/inventory/lotes/page.tsx`, cliente de producción |

El GET de batches excluye negativos (`>= 0`) y su trazabilidad/PATCH se filtran por ID sin alcance explícito de empresa/sucursal. El allocator ordena fecha/createdAt y bloquea filas, pero no comprueba vencimiento directamente ni desempata por ID. No se modificaron estos comportamientos en este incremento.

## Verificación

Prueba nueva: `tests/unit/inventory/batch-diagnostic.test.ts`, SQL real sobre PGlite aislado, sin conexión a DATABASE_URL. Casos: negativo fraccionario, fecha nula, vencido AVAILABLE, igualdad en corte, dos empresas/dos sucursales, producto ajeno, historial ausente, saldo igual a ledger, apertura separada, movimiento incompatible y argumentos inválidos. Consulta ejecutada dentro de READ ONLY; conteo posterior conserva los diez lotes del fixture.

Pruebas existentes aprovechables: `receiving-overcount-diagnostic`, `receiving-batch-ownership`, `receiving-atomicity`, `receiving-idempotency`, `transfer-scope`, `production-scope`, `workflows/stock-count-adjustments`; integración `receiving-db-atomicity`, `receiving-rls-db`, `inventory-monitoring-rls-db`, `stock-counts-rls-db`. No sustituyen las pruebas pendientes de caducidad, concurrencia e idempotencia del plan FEFO.

## Línea base del demo

Empresa `a1b2c3d4-e5f6-7890-abcd-ef1234567890`; sucursal Condesa `b1000001-0000-4000-8000-000000000001`. Conexión configurada en el workspace, sin copiar credenciales. Ejecución de solo lectura alrededor de 14:16 UTC; corte **comparativo de caducidad** `2026-10-24T14:20:00Z`, independiente de la hora de lectura.

Comando ejecutado correctamente con Node 22 (alternativa local a tsx):

```powershell
node --experimental-strip-types scripts/diag-lotes-fefo.ts --company=a1b2c3d4-e5f6-7890-abcd-ef1234567890 --branch=b1000001-0000-4000-8000-000000000001 --as-of=2026-10-24T14:20:00Z
```

Resultado: 25 lotes, 0 negativos, 0 fechas nulas, 3 vencidos AVAILABLE con saldo positivo, 0 cruces de empresa/producto y 0 movimientos con producto/sucursal incompatibles. Historial: 8 sin movimientos, 15 REVIEW_DELTA, 2 MATCHES_INITIAL_PLUS_LEDGER, 0 MATCHES_LEDGER. Una segunda consulta SQL de agregación independiente confirmó 25/0/0/3 para lotes/negativos/sin fecha/vencidos disponibles.

| Lote | Inicial | Actual | Suma kardex | Clasificación / observación |
|---|---:|---:|---:|---|
| bca2dc32-b05b-428c-a8f3-1575cbea7121 | 40 | 80 | 40 | Apertura + ledger |
| 238a6afb-e548-40b1-aa62-3f9a2a952dc3 | 15 | 13 | -3 | Revisar |
| 638c87ed-815b-4d7e-ad4e-703e0c820814 | 33 | 17 | 0 | Sin movimientos |
| ad2d7c34-1b4e-42ce-9149-be6bb77dc0b8 | 32 | 18 | 26 | Revisar |
| 27740d1b-01d4-43fc-862b-92e4de467575 | 23 | 10 | -8 | Revisar |
| d06cc9f2-427c-4932-9114-22925c77693e | 24 | 23 | 48 | Revisar |
| 6be8178a-0ef7-4d91-b44b-168cfd597d44 | 35 | 70 | 35 | Apertura + ledger |
| 13864aa8-1998-458e-899a-de5cc15eecc6 | 75 | 64 | 154 | Revisar |
| 2d65b775-6382-45f9-a1c2-38619b091ffb | 67 | 57 | 0 | Sin movimientos |
| 084cfb7b-f083-4e14-928a-674c132351d9 | 6 | 0 | 16 | Revisar |
| 70cfb341-e22d-4697-9396-c5af0b246eb8 | 18 | 18 | 0 | Sin movimientos |
| 4a6e647d-f611-4d29-9320-6633de5b91b7 | 68 | 33 | 59 | Revisar |
| 8c687d20-17a7-4bc0-bc68-3f49f2f4e822 | 20 | 7 | -9 | Revisar |
| b09a3aee-e6e3-4fe3-bdb5-d4a9ca3dbbc4 | 21 | 20 | 0 | Sin movimientos |
| dda21321-a593-4516-ac67-34eb8d326037 | 13 | 11 | 55 | Revisar |
| 08a982b3-e208-4d91-9802-cdb6c9b81e16 | 10 | 10 | 0 | Sin movimientos; vencido disponible |
| 5446b404-c074-4f40-ab43-edfe581de424 | 74 | 53 | 0 | Sin movimientos |
| 634cb006-ca6b-4c33-a12d-2241103d6b5a | 59 | 25 | 0 | Sin movimientos |
| 70de3cb6-c899-4f45-b40b-9ec8c82e5d7b | 40 | 0 | 3 | Revisar |
| a1241a2f-1b34-4d3b-b727-c19dab7755aa | 16 | 6 | -2 | Revisar; vencido disponible |
| c351403f-642a-40da-89b8-116f439214b7 | 18 | 6 | 7 | Revisar |
| b27f756f-2e7b-4b9e-90dc-ed7cc5c42b02 | 17 | 17 | 8 | Revisar |
| eb76a4ad-62fb-4d7e-97b5-06d81c65e94d | 20 | 19 | 0 | Sin movimientos |
| 99e770d1-d083-4a3f-8751-04295bca5a3f | 37 | 34 | 36 | Revisar |
| d653b229-9a11-4079-96f1-c1130ac5392b | 47 | 19 | -5 | Revisar; vencido disponible |

Valores del demo resumidos sin eliminar precisión del cálculo SQL (todos resultaron enteros). Las dos coincidencias con apertura podrían también representar una entrada duplicada: no se declaran sanas ni se corrigen automáticamente. La ausencia de historial de ocho lotes y las discrepancias restantes impiden reconstruir la operación física sólo desde el kardex.

FEFO-01 queda completado como diagnóstico, no como saneamiento. Las decisiones de fecha, reservas, reversión y excepciones siguen pendientes en FEFO-02.

## Comprobaciones del incremento

- Pruebas enfocadas nuevas + diagnóstico REC-03 existente: **7/7 pasan**.
- ESLint de script y prueba nuevos: **pasa**, sin salida.
- Typecheck del script: **pasa** (código 0), `pnpm exec tsc --noEmit --skipLibCheck --target ES2017 --module esnext --moduleResolution bundler --esModuleInterop scripts/diag-lotes-fefo.ts`.
- ESLint completo: **pasa**, 0 errores y 2468 warnings existentes en el árbol de trabajo.
- Primera suite completa: 168 archivos pasan; 10 pruebas de IMSS fallan por `buildIdseFile`/`buildSuaFile` no disponibles, y el hook PGlite nuevo agotó 10 s bajo carga. Hook ampliado a 60 s. Segunda ejecución `pnpm run test:unit --maxWorkers=2`: **170 archivos aprobados, 2078 pruebas pasan, 1 skipped y 1 todo existentes**, duración 374.45 s. El árbol tiene trabajo concurrente ajeno a FEFO: la primera falla de IMSS ya no apareció en esa segunda ejecución. El wrapper PowerShell reportó código 1 al redirigir stderr aunque Vitest imprimió todos los archivos aprobados y ningún test fallido; no se oculta esa diferencia.
- Primer build compiló correctamente en 8.2 minutos. Se interrumpió al entrar a TypeScript junto con el typecheck independiente por presión de recursos; no se considera build completo aprobado.
- Reintento de build: bloqueado por `.next/lock`. Se confirmó otro proceso activo `node_modules/next/dist/bin/next build` (PID 22208), con worker de PostCSS en este workspace; no se detuvo ni se eliminó su lock. Verificación general de tipos/build completa queda pendiente; no atribuirle aprobación por la compilación parcial.
- `tsx` falla antes de cargar el script por `uv_os_get_passwd ENOMEM`; se verificó la ejecución real y el rechazo de --apply usando Node 22 con `--experimental-strip-types`.
