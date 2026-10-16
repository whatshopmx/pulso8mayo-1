# C31 — Efecto financiero de la configuración hasta la pantalla

Fecha: 16-10-2026. Seguimiento: `tasks/todo-conexion-frontend-backend.md`. C31 cerrada. Cierra el bloque C29–C31 de la Fase 5.

## Cambio (H05, H06)

C13/C14 dejaron el formulario y la persistencia de los parámetros; C29/C30 unificaron las métricas y separaron dato real, estimado y ausente. Faltaba cerrar el recorrido de pantalla: que la vista quede gobernada por el valor declarado —unidad, procedencia y meta— y no por una constante, que la recarga lo conserve y que un rechazo de autorización no persista nada.

- **V2 nueva** — `tests/e2e/financial-policy-effect.spec.ts` (3), en Chromium aislado, cruzando `/config` (formulario de configuración operativa) y `/liga` (Liga de Sucursales) en el mismo navegador. El servidor de la prueba es un fixture controlado que guarda el `PUT` y deriva de él la meta de prime cost que devuelve a la Liga.
- **Contrato** — `docs/operating-policy-contracts.md` documenta cómo se verifica un parámetro: V1 por consumidor, V2 de pantalla (C31) y el historial de `config_change_logs`. Se actualizó el límite de `getPnLSnapshots`, que sigue sin consumidores tras C29–C31.

## Verificación

- **V2** — `tests/e2e/financial-policy-effect.spec.ts` (3):
  1. Cambiar el objetivo de food cost en configuración (30 → 26) mueve la meta que la Liga declara (58 → 54) y su semáforo; la recarga conserva la meta y la procedencia («Food Cost % · merma»); la pantalla no usa la constante 60.
  2. Un parámetro con estado `null` (carga patronal) se recarga como vacío, no como 0 ni como el default; la unidad y el contrato del vacío («Vacío = sin factor») están junto al campo.
  3. Un `PUT` rechazado con 403 no persiste: el intento no borra lo escrito y la recarga vuelve al valor guardado por el servidor.
- Suite de navegador aislada: **90/90** (incluye las 3 nuevas; `financial-policy-effect.spec.ts` añadida al `testMatch` de `tests/playwright-shifts.config.ts`).
- Suite completa: **1370 aprobadas**, 1 omitida, 1 TODO (1372), 107 archivos.
- `tsc --noEmit` código 0; `lint` global 0 errores (2482 warnings). Sin cambios en `lib/` ni `app/`: el `build` verificado en C30 sigue vigente y no se repitió.
- **V1 referenciada** (no re-ejecutada en este corte): la aritmética del parámetro sobre su consumidor real en `tests/unit/company/financial-config.test.ts` y C14.2; el actor y el valor anterior/nuevo por campo en `tests/unit/company/config-history.test.ts`; la base neta, la carga y los objetivos compartidos en C29/C30.

## Límites declarados

1. **Sin V2 con Next/auth/Postgres.** El servidor de la prueba es un fixture controlado: comprueba que la pantalla queda gobernada por el valor declarado y que el viaje guardar/recargar es estable, no que el cálculo del servidor real use el parámetro. Esa parte vive en V1.
2. **La vigencia por periodo no se ejercita en el navegador.** Que cambiar el IVA hoy no mueva un mes cerrado se respalda en C14.3 (`tests/unit/company/operational-params-vigencia.test.ts` y la comprobación contra la base real), no en esta V2.
3. **`getPnLSnapshots` sigue sin consumidores.** Ninguna vista lee el P&L congelado al cierre; la vigencia por fecha impide reescribir el pasado en los cálculos, pero conectar el snapshot es una tarea propia. Queda declarado en `docs/operating-policy-contracts.md`.
4. **El cockpit ejecutivo conserva umbrales 60/65** sin leer los objetivos del inquilino (límite heredado de C30.3), por lo que la meta gobernada por configuración se verifica en la Liga, no en el ejecutivo.
