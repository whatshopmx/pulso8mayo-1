# BASE-01 — Línea base

Fecha: 2026-10-22. HEAD inicial: `c14f95c7d85a452ce569fc7ec4e88b8890f40964`, rama `main`.

## Estado conservado

| Hallazgo / avance | Evidencia existente | Tarea que verifica o corrige |
|---|---|---|
| Salario efectivo y ambas bases de aguinaldo | `2229604`, `a0b6366`, `bb9b116`, `a37867a` | AGU-01/03/04, FIS-03 |
| Retención Art. 174 y tarifa 2026 existentes | `5f36965` | FIS-01/02, AGU-02/03 |
| Conteo automático existente | `c14f95c` | DIA-01/02; no reiniciar Task 14 |
| Excepciones: servicio, adaptadores, lifecycle y sync | `6c649e9`, `77dbeab`; flag global reversible descrito en plan | EXC-02/03/04; aceptación DB/UI pendiente |
| Banca: importación/matching y entradas | `527593b`, `a368aba`, `fbad77e`, `7b68ed0` | BAN-01/04 y BAN-05/06; no cerrar por mocks |
| Snapshots P&L existentes | `fcce72b` | FIN-02A/B |
| H02 / H03 / H07 | Matriz del plan de cierre: nómina / excepciones / producto terminado | NOM / EXC / PROD; REC-TEMP independiente |

Histórico declarado por el plan: 155 archivos, 1850 passed, 1 skipped, 1 todo. **No es una ejecución de esta sesión.** Los nuevos resultados se registran por separado.

## Cambios locales ajenos al frente

Al inicio había modificaciones en las cuatro rutas `app/api/imss/{altas,bajas,idse-generate,sua-generate}/route.ts`, las dos páginas IMSS de altas/bajas, `lib/services/employee-service.ts`, `lib/db/schema.ts`, `lib/db/schema/core.ts` y `drizzle/meta/_journal.json`.

Sin seguimiento: migración `0121_imss_movimientos.sql`, snapshot 0121, contratos/parser/reglas IMSS con sus tests, `tests/integration/imss-phase0-db.test.ts` y trackers IMSS. Pertenecen al [frente IMSS](../../../todo-imss.md); no incluirlos en commits de este frente ni renumerar 0121. El plan consolidado y su checklist también estaban sin seguimiento y son las entradas autorizadas de este trabajo.

## Entorno y límites

Windows / PowerShell, Node `v22.17.1`, pnpm declarado `11.2.2`. Unitarias: `vitest.config.ts`, UTC, sin DB. Integración: `vitest.integration.config.ts`, `.env.test` → `TEST_DATABASE_URL`, serializada; no usar `DATABASE_URL` operativo.

La configuración aislada identifica host `ep-solitary-hill-b4bbyj4d.c-6.us-east-2.aws.neon.tech`, base `neondb`. Tanto la URL como la pareja host/base (normalizando el sufijo `-pooler`) difieren de las operativas configuradas en `.env`/`.env.local`. Se verificó configuración, **no conexión ni migraciones**. No se publican credenciales. Cualquier V2 exige validar el esquema/rol de ese entorno antes de escribir.

CodeGraph responde con 1688 archivos; las consultas por los nuevos archivos de aguinaldo no devuelven resultados. Se consultó primero el índice; para estos archivos ausentes se usaron sus rutas conocidas en el plan.

Implementación local, aceptación V1/V2/V3 y despliegue son estados separados. En esta entrega no se aplican seeds ni migraciones a la base operativa.

Comandos de inventario ejecutados con exit 0: `git status --short`, `git branch --show-current`, `git rev-parse HEAD`, `git log -12 --oneline`, logs dirigidos de banca/excepciones/P&L y lectura de configuración aislada sin secretos.

Nueva ejecución de línea base: `pnpm run test:unit`, **155 archivos / 1850 passed / 1 skipped / 1 todo; exit 0**. Log: `unit-baseline.log`. El primer intento en sandbox falló por EPERM en AppData; la ejecución autorizada fuera del sandbox produjo este resultado.
