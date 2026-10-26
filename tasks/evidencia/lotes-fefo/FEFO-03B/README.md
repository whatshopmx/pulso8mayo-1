# FEFO-03B — Estados con motivo y auditoría

## Cierre del 2026-10-26: build completo aprobado

FEFO-03B-2b, FEFO-03 y Checkpoint 1 quedan cerrados. El build sobre la base de código de `ff5c9af` terminó con **código 0**, incluida verificación de TypeScript y generación de **430/430 páginas**. Compilación: 2.3 minutos. Sólo había cambios de planificación y una prueba de integración nueva excluida del build; no se modificó código de aplicación durante esta ejecución.

Comando PowerShell: `$env:NODE_OPTIONS='--max-old-space-size=3072'; pnpm.cmd run build`. El intento restringido volvió a fallar por descarga de Geist/Geist Mono; el reintento con acceso de red autorizado y el mismo límite de 3 GB sí completó todas las etapas. Se ejecutó sin suites ni otros builds propios simultáneos. No se deshabilitó TypeScript ni se alteró configuración del producto para aprobarlo.

El build emitió el aviso de deprecación de `fetchConnectionCache` y un mensaje `DYNAMIC_SERVER_USAGE` de `/dashboard/labor/documents`, que quedó como ruta dinámica; no provocaron fallo. No se corrigieron como parte de FEFO. La suite general interrumpida anteriormente no se presenta como aprobada: el cierre de este checkpoint se apoya en las 75 pruebas enfocadas, 8 escenarios de navegador, lint enfocado y ahora el build completo. Los registros siguientes conservan los intentos históricos y sus limitaciones.

## Continuación del 2026-10-26: navegador resuelto

El árbol de Git estaba limpio al comenzar esta continuación; los cambios descritos anteriormente ya pertenecen al checkpoint `642c6ba`. Se corrigió una causa concreta de la pantalla vacía: `page.route('**/api/**')` sustituía no sólo endpoints sino también imports Vite como `/lib/api/client-error.ts`. El servidor devolvía para ese módulo la respuesta de denegación de la fixture y la página no terminaba de montar. Ahora el matcher comprueba `url.pathname.startsWith('/api/')`, manteniendo sesión y HTTP de aplicación aislados.

Verificaciones de esta continuación:

- `pnpm exec playwright test --config tests/playwright-fefo.config.ts`: **8/8 aprobados**, código 0, 1.1 minutos. Motivo vacío/espacios, motivo recortado, confirmación por teclado, retorno del foco, rechazo con conservación del motivo, cancelación, roles SUPERVISOR/EMPLEADO/READONLY/GERENTE y diálogo a 320/768/1024/1440 px. Se ejecuta la página real; HTTP y sesión son fixtures. No demuestra escritura en la base real.
- `pnpm run test:unit tests/unit/inventory/batch-access.test.ts tests/unit/inventory/batch-diagnostic.test.ts tests/unit/inventory/transfer-scope.test.ts tests/unit/inventory/production-scope.test.ts`: **75/75 aprobadas**, 4 archivos, código 0; Drizzle/PGlite aislado.
- `pnpm exec eslint tests/e2e/fefo-status.spec.ts tests/support/fefo-browser-server.ts tests/playwright-fefo.config.ts app/api/inventory/batches/route.ts lib/services/audit-service.ts app/dashboard/inventory/lotes/page.tsx tests/unit/inventory/batch-access.test.ts`: **aprobado**, código 0, sin salida.
- `git diff --check`: aprobado; Git avisa de normalización LF/CRLF.
- `pnpm run build`: **compilación aprobada en 3.8 min; build completo no aprobado**. Se interrumpió durante TypeScript ante presión de memoria. Lecturas con `node:os`: 7,418 MiB totales, primero 139 MiB y luego 61 MiB libres. No se incrementó el heap ni se omitió TypeScript; no se terminaron procesos ajenos.
- `pnpm run test:unit --maxWorkers=1`: ejecución iniciada y después interrumpida para liberar memoria al build; no hubo resumen final ni se declara aprobada. Los 75 casos enfocados sí finalizaron con código 0. El resultado histórico de la suite completa se conserva abajo con su fecha/contexto.

El cierre de FEFO-03B-2 y Checkpoint 1 sigue condicionado a un build completo aprobado. Los resultados siguientes conservan el registro histórico de los intentos anteriores; sus timeouts de navegador quedan resueltos por esta ejecución.

Continuación: 2026-10-25/26. Se encontraron cambios locales ya implementados en API, auditoría, pantalla y pruebas de API. Se conservaron y verificaron; no se atribuyen como implementación nueva de esta continuación. Se agregaron pruebas reproducibles de navegador. FEFO-03B permanece abierto por verificación de navegador y build pendiente.

## Comportamiento revisado

`PATCH /api/inventory/batches` exige sesión, empresa, alcance por sucursal y `inventory:update`. Acepta motivo recortado de 1 a 1000 caracteres. Bloquea la fila, comprueba las transiciones y registra el cambio con actor de sesión y motivo en `inventory_audit_log` dentro de la misma transacción. La falla de auditoría revierte el estado. Repetir el estado actual no duplica la auditoría.

SUPERVISOR puede inmovilizar AVAILABLE en QUARANTINED; reservar o liberar requiere `inventory:manage`. Liberación exige saldo positivo y fecha vigente. PATCH no deriva EXPIRED/DEPLETED ni modifica cantidades. Los lotes ajenos devuelven 404. La pantalla captura motivo, conserva el texto ante error y oculta acciones sin permiso.

## Resultados obtenidos

- `pnpm run test:unit tests/unit/inventory/batch-access.test.ts tests/unit/inventory/batch-diagnostic.test.ts tests/unit/inventory/transfer-scope.test.ts tests/unit/inventory/production-scope.test.ts`: **75/75**, 4 archivos, código 0. Ruta real con Drizzle/PGlite aislado; no usa DATABASE_URL. Incluye dos empresas, sucursales, roles, transiciones, motivo, saldo fraccionario y rollback ante fallo real de inserción de auditoría.
- `pnpm run test:unit`: **172 archivos aprobados; 2,129 pruebas pasadas, 1 skipped, 1 todo**, código 0. No se añadieron exclusiones. Suite al momento de ejecutar; el workspace contiene otros cambios locales.
- `pnpm exec eslint app/api/inventory/batches/route.ts lib/services/audit-service.ts app/dashboard/inventory/lotes/page.tsx tests/unit/inventory/batch-access.test.ts`: código 0, sin advertencias.
- `pnpm exec eslint tests/support/fefo-browser-server.ts tests/playwright-fefo.config.ts tests/e2e/fefo-status.spec.ts`: código 0 después de los ajustes finales de diagnóstico/configuración.
- `pnpm run lint`: código 0, **0 errores, 2,454 advertencias**. No se corrigieron advertencias ajenas a FEFO.
- DevTools, página real montada en fixture Vite local (sesión/HTTP sustituidos): diálogo pide motivo, botón deshabilitado inicialmente; confirmar cambia a Cuarentena y devuelve foco al menú del lote. No demuestra escritura real de inventario; esa frontera se prueba por separado con PGlite. Consola: un 404 de recurso, sin error de ejecución de React observado.

## Verificación sin cerrar

`pnpm exec playwright test --config tests/playwright-fefo.config.ts` ejecuta la página real con fixtures HTTP y sesión, sin inventario real. Los 8 casos preparados cubren motivo obligatorio/recortado, confirmación por teclado/foco, rechazo conservando texto, roles y diálogo a 320/768/1024/1440 px. **No están aprobados**: la ejecución encontró página vacía y timeouts antes de montar el encabezado/menú. Se intentó estabilizar dependencias y reutilizar CSS compilado; el intento posterior aislado se interrumpió sin resultado aprobado. No atribuir estos fallos sólo a memoria hasta reproducir con recursos suficientes.

Durante las verificaciones también se observó `uv_os_get_passwd returned ENOMEM (not enough memory)` al arrancar tsx. Se detuvieron las sesiones propias de verificación; no se terminaron procesos ajenos por nombre global.

Se intentó también el escenario enfocado fuera del sandbox, con autorización, para distinguir restricciones del entorno: se interrumpió sin resultado aprobado. No se resolvió la causa del montaje vacío.

`pnpm run build`: el intento restringido falló al descargar Geist/Geist Mono. Reintento autorizado con red: **código 134**, `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`. No hay build aprobado. No se aumentó indiscriminadamente la memoria de Node tras observar también falta de memoria del sistema.

Próximo paso: resolver el montaje de la fixture de navegador con un único runner y verificar sus 8 escenarios; repetir lint enfocado tras ajustes y build con recursos suficientes. Después cerrar FEFO-03/Checkpoint 1 y comenzar FEFO-04. La carrera del test PGlite no prueba concurrencia entre conexiones independientes; esa demostración corresponde a FEFO-05A.

No se aplicaron migraciones, correcciones históricas, escrituras de inventario real ni despliegues. No se creó commit: el workspace contiene cambios previos mezclados, incluidos cambios de auditoría compartidos con otros trabajos.
