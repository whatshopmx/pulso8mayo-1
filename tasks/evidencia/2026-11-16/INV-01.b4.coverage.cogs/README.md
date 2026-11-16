# INV-01.b4.coverage.cogs — ingreso completo en COGS

Estado: **V1 comprobada; sin aceptación**. Base observada `51b90d4b31a14096a3b6fa37e1f18e774e23d55f` más árbol compartido. El HEAD cambió durante la exploración; no se creó commit ni se tocaron migraciones, secretos o configuración de conexión. Se conservaron los cambios locales de otros frentes.

## Alcance y contrato

Cinco archivos de código/pruebas: `lib/services/sale-revenue-coverage.ts`, `lib/services/inventory-reports-service.ts`, `app/api/inventory/reports/cogs/route.ts`, `app/dashboard/inventory/reports/operational/operational-reports-client.tsx` y `lib/services/__tests__/cogs-revenue-coverage.test.ts`.

- La proyección `sales_entries.total_revenue` conserva un subtotal. La consulta correlacionada elige el último head por identidad antes de filtrar receta, exige todas las fuentes con ingreso y compara importe/cantidad con la proyección. No usa revisiones antiguas remapeadas ni cabezas de otra empresa/sucursal/día.
- `reportedRevenueCents` conserva el subtotal; `revenueCents` es nullable cuando falta cobertura. `revenueCoverage` distingue NO_DATA, PARTIAL y COMPLETE, con conteos por entrada proyectada receta/día (no por ticket POS ni identidad).
- El porcentaje es nullable cuando falta ingreso o el denominador es cero. La pantalla muestra “—”, informa subtotal y faltantes y no pinta de verde un porcentaje ausente.
- COGS consulta ventas y catálogos desde una transacción con contexto de empresa/sucursal. La ruta pasa la empresa autenticada; el servicio verifica la pertenencia de la sucursal y la ruta responde 403 sin reporte si es ajena. Los catálogos se filtran explícitamente por empresa.
- Las ventas legadas sin heads quedan conservadoramente incompletas, aunque tengan un importe positivo. La proyección vaciada de una receta remapeada sin head vigente también queda incompleta: no se inventa procedencia para resolver esa ausencia. Costo/expansión de recetas conserva el método existente; este cambio no acredita valoración histórica de COGS.

## Pruebas ejecutadas

- Rojo de regresión: la prueba inicial con stub funcional reprodujo **dos fallos**: subtotal parcial publicado como total/0% y vacío convertido en 0/0%. Un intento anterior falló por falta del stub `db.select`; no se cuenta como reproducción funcional.
- Focal inicial con ruta: `pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads lib/services/__tests__/cogs-revenue-coverage.test.ts`: **11/11, exit 0**. Cinco casos ejecutan la expresión SQL real en PGlite con tablas mínimas; seis prueban contrato de servicio/ruta con dependencias simuladas. No equivalen a Postgres runtime con RLS.
- Focal final, tras añadir el oráculo 3 porciones × medio insumo × $2 = $3, dividido entre $12 de ingreso = 25%: mismo comando junto con `tests/unit/faltantes-traceability.test.ts`: **23/23, dos archivos, exit 0** (12 COGS + 11 trazabilidad). Repetición tras corregir tipos de los spies: 23/23, exit 0. No sumar ambas corridas.
- Regresión previa a la última adición de la ruta: mismo comando con `sale-consumption-contract.test.ts`, `sale-consumption-delta.test.ts` y `sale-consumption-snapshot.test.ts`: **75/75, cuatro archivos, exit 0** (10 focales de esa revisión + 65 regresiones). No sumar los 75 y los 23 como pruebas distintas.
- Navegador: `node .tmp/cogs-browser-check.mjs`: **cuatro escenarios pasan**, ingreso parcial, vacío, cero explícito y completo positivo; Chromium 1440/320 px, cero errores de página y sin desbordamiento horizontal a 320 px. Módulo React real, estilos compilados desde `app/globals.css`, API simulada, sin sesión ni DB reales. Copia reproducible del arnés: [browser-check.mjs](browser-check.mjs), ejecutar desde la raíz con `node tasks/evidencia/2026-11-16/INV-01.b4.coverage.cogs/browser-check.mjs`. [Escritorio](partial-desktop.png), [móvil](partial-mobile.png).
- Lint focal final de los cinco archivos: **exit 0**, cero errores y advertencias.
- `git diff --check`: **exit 0**; advertencias de conversión LF/CRLF en archivos compartidos.
- `pnpm.cmd exec tsx scripts/validate-faltantes.ts`: **exit 0**, 239 filas, 86 tareas base, 99 adicionales y las mismas 24 aceptaciones. Un intento anterior terminó con `uv_os_get_passwd returned ENOMEM`; el reintento pasó. La revisión del coordinador se ajustó al contrato del validador: coverage es padre independiente y b4 depende de su cierre; no hay padres usados como ejecutables ni ciclos.
- Validación documental final: el lanzador `tsx` volvió a fallar en `os.userInfo` con ENOMEM. El **mismo script**, ejecutado con `node --experimental-strip-types scripts/validate-faltantes.ts`, terminó **exit 0**, 239 filas, 99 adicionales, 24 aceptaciones y cero errores. No se modificó el validador ni se omitieron comprobaciones; Node emitió sus advertencias experimentales de strip-types/módulo.

Los intentos iniciales del arnés fallaron por extensión CSS virtual y tiempo de arranque; al iniciar build desapareció `.next/static/chunks`. El arnés final compila CSS desde fuente y pasó. No se interpreta ese diagnóstico como fallo de producto.

## Límites y continuación

V2 real con dos empresas/sucursales, rol NOBYPASSRLS y privilegios reales está pendiente. PGlite no acredita RLS desplegada, privilegios mínimos ni rendimiento sobre volumen operativo. V3 con autenticación/sesión real también está pendiente; el HTTP de la prueba sustituye autenticación y el navegador simula API. No se acepta INV-01.b4.coverage ni INV-01.b por estos resultados. Los lectores ejecutivo y menú tienen hijos pendientes en el plan/mapa. No se aplicaron migraciones ni hubo despliegue.

Tipos: `NODE_OPTIONS='--max-old-space-size=4096 --use-system-ca' pnpm.cmd exec tsc --noEmit`: **exit 0** en la revisión final. La pasada completa previa sin caché encontró dos errores TS2339 en los casts `never` de spies de esta prueba; se sustituyeron por una interfaz de prueba explícita y se volvió a verificar. El comando de build con las mismas opciones `pnpm.cmd run build` llegó a “Creating an optimized production build” y se interrumpió por presión de memoria del entorno, sin resultado de compilación. [Registro del build interrumpido](build-interrupted.log). No se declara build exitoso ni se atribuye un fallo de código a ese intento. Los tipos/build anteriores a cambios posteriores se interrumpieron y no se cuentan como verificación final.
