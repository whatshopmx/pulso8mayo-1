# P1 — Aislamiento de referencias POS

Corrección del hallazgo de `docs/2026-11-17-investigacion-estado-faltantes.md`.
El primer incremento quedó en `9ca357c`; el segundo añade la validación al vincular.
Las verificaciones corresponden al árbol compartido con cambios locales ajenos;
no constituyen una certificación de un checkout aislado.

## Contrato y política legacy

- El resolvedor exige contexto del servidor: empresa de la sesión, sucursal y fecha del corte leído. Solo firma una key canónica `companies/{companyId}/branches/{branchId}/pos/{businessDate}/{timestamp}_{nombre}` que coincida exactamente con ese contexto.
- La ruta JSON de `upload-pos` aplica el mismo contrato después de autorizar empresa/sucursal y antes de actualizar cualquier corte. Una referencia inválida recibe 400, sin escritura ni ingesta.
- La lectura de una referencia fuera de ámbito o no canónica recibe 404, sin invocar el firmador ni devolver la referencia.
- URLs externas, paths históricos, esquemas arbitrarios y `local://` no prueban pertenencia y quedan indisponibles en esta lectura privada. Para recuperarlos hay que volver a subir el archivo mediante multipart. El fallback local sigue declarando `durable: false`; no representa un objeto descargable de R2.
- Esto implementa la validación mínima de jerarquía propuesta en la investigación. No acredita existencia del objeto al vincular ni introduce un registro de identificadores de subida emitidos por el servidor.

## Regresiones y evidencia

Las pruebas de lectura usan la ruta y el resolvedor reales, con DB, autorización y el firmador de R2 simulados. Ya no sustituyen el resolvedor por un mock que ocultaba la brecha.

| Verificación | Resultado |
|---|---|
| Lectura antes de corregir | 12 fallos: devolvía 200 para referencias inválidas; otros 7 casos pasaban |
| Lectura y storage tras el primer incremento | 29/29, 2 archivos |
| Vinculación JSON antes de corregir | 11 fallos: guardaba referencias inválidas; otros 4 casos pasaban |
| `pnpm.cmd test:unit tests/unit/inventory/sales-entry-smart-link.test.ts tests/unit/sales/pos-file-read.test.ts lib/storage/__tests__/pos-upload.test.ts --maxWorkers=1 --pool=threads` | 44/44, 3 archivos, exit 0 |
| ESLint de los seis archivos de implementación/pruebas, en dos invocaciones | exit 0, sin diagnósticos |
| `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc --noEmit --incremental false` | exit 0, sin diagnósticos |
| `NODE_OPTIONS=--use-system-ca --max-old-space-size=4096 pnpm.cmd run build --webpack` | Compilación (7,2 min), tipos, 455/455 páginas, optimización, trazas y tabla final de rutas completadas; advertencias y anomalía de salida del shell descritas abajo |
| `git diff --check` acotado a los archivos cambiados | exit 0, avisos LF/CRLF |

Casos de abuso: otra empresa, otra sucursal, otro día, otro espacio de objetos, segmentos adicionales, traversal literal/codificado, query string, salto de línea y referencias legacy. Se conserva la firma válida con TTL de 600 segundos y la ingesta multipart existente.

## Gates globales y límites

- La suite unitaria general se inició y se interrumpió tras observar 4 fallos en `tests/unit/finance/payment-scheduling.test.ts` (52 casos de ese archivo). Ese archivo no importa el módulo POS modificado. No se afirma suite global verde ni se clasifican aquí los fallos como preexistentes.
- `pnpm.cmd run build` con Turbopack se interrumpió tras una compilación prolongada, sin resultado final. La primera comprobación de tipos concurrente también se interrumpió. No acreditan build ni tipos correctos.
- La segunda comprobación de tipos con el heap predeterminado terminó por `JavaScript heap out of memory` cerca de 2 GB. La corrida posterior con 4096 MiB pasó, como registra la tabla.
- Una comprobación alternativa con `pnpm.cmd run build --webpack` emitió errores TLS `UNABLE_TO_VERIFY_LEAF_SIGNATURE` y fue interrumpida. La corrida con certificados del sistema (`NODE_OPTIONS=--use-system-ca --max-old-space-size=4096`) y acceso de red autorizado completó las fases y la tabla de rutas. El log está en `.tmp/pos-isolation-webpack-system-ca-build.log` (no versionado).
- El shell informó exit 1 para ese build. Se reprodujo un falso negativo con `node -e "process.stderr.write('stderr-only check\\n')"` redirigido con `> archivo 2>&1`: Node no establece un código de error, pero el shell devuelve 1 y genera `NativeCommandError`. La misma conversión aparece al principio del log del build. La salida completa acredita las fases terminadas; no se capturó por separado el código nativo de Next y no se presenta como un exit 0 verificado. No se repitió una compilación sin cambios solo para el wrapper.
- Advertencias del build: deprecación de `fetchConnectionCache` y mensaje de render estático de `/dashboard/labor/documents` por uso de `headers` (`DYNAMIC_SERVER_USAGE`). El proceso continuó y generó las 455 páginas. No se modificó esa ruta.
- No se ejecutaron nuevas pruebas con Neon/R2 reales, navegador ni runtime NOBYPASSRLS. Las verificaciones históricas del README no certifican estos cambios.
- No se aplicaron migraciones, no se modificaron cambios locales ajenos y no se desplegó.

Esta corrección no acepta `INV-01.b4.storage`, sus padres ni el recorrido integrado de ventas. Permanecen sus gates de navegador, RLS y dependencias documentadas.
