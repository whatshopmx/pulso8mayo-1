# POS — selección explícita de conexión para lectura/vínculo

Base `d05eae09d67ed0b190b6785da168a8fb8b564fd0` + árbol compartido. Continuación de storage en cuatro archivos de código/prueba: `lib/db/pos-file-runtime.ts`, `lib/services/pos-cut-file-service.ts`, `tests/unit/sales/pos-runtime-connection.test.ts` y `tests/integration/pos-cut-file-runtime-db.test.ts`. **En curso; no acepta storage ni dependientes. Se mantienen 34 registros aceptados.** La aceptación Next posterior será otro incremento.

`POS_FILES_RUNTIME_DATABASE_URL` selecciona exclusivamente lectura y vínculo de archivos POS. Ausente conserva la transición existente; presente pero vacío, inválido, dueño o de otra base/endpoint/puerto devuelve 503 seguro sin fallback. Auth, lookup previo, escritor de consumo y productor directo conservan sus propias fronteras. No se configuran secretos operativos ni se amplían permisos de esos dominios.

Antes de consultar cortes: login/session_user coincidentes, no superuser/bypass/CREATEROLE/CREATEDB/membresías, sin propiedad de cortes/sucursales, RLS activa, columnas mínimas de 0155 disponibles y sin permisos generales ni adicionales sobre cortes. Después fija contexto local de empresa/sucursal/actor y ejecuta la operación en la misma transacción. Pool por operación, cerrado en finally incluso al fallar la guardia o callback. Los errores de conexión/guardia no exponen URI; el error del callback conserva su identidad para el manejo de API. El client opcional existente mantiene la frontera de las pruebas SQL previas.

Se reutilizan las transacciones interactivas del driver WebSocket y la política de vida de pool del proyecto. [Driver Neon](https://neon.com/docs/serverless/serverless-driver). No hay nueva migración: utiliza la candidata 0155 ya preparada, aplicada sólo a la base desechable de la prueba.

Resultados iniciales:

- RED unitario: módulo ausente, exit 1, sin casos ejecutados. Implementación posterior: **47/47 unitarias**, cuatro archivos, exit 0, 7.83 s (selector POS, frontera/lectura y selector writer anterior).
- Primer ESLint de los cuatro archivos: exit 0 sin avisos.
- Primera SQL ampliada: **5/6**, exit 1, 35.36 s. Pasó selección/configuración real, commit y cierre. El caso de recuperación final falló porque el REVOKE SELECT de tabla del arnés retiró también los SELECT por columna; la guardia rechazó correctamente la capacidad incompleta. [Semántica de REVOKE](https://www.postgresql.org/docs/current/sql-revoke.html).
- Ajuste exclusivo del arnés: restaurar el bloque mínimo real de 0155 después de cada permiso temporal y exigir lectura positiva antes/después de cada negativa. Así cada rechazo prueba una configuración defectuosa distinta y no hereda un rol roto. El oráculo de cierre mantiene arrendada la conexión explícita del test para que el conteo esperado no dependa de su timeout idle.
- Repetición SQL finalizada: **6/6**, `exit 0`, 172.70 s (`2026-11-22T22:29:15.002Z`, `.tmp/pos-cut-file-runtime-db-result.json`). ESLint de los cuatro archivos de selección y de los tres archivos de arnés Next (`sales-runtime-database.ts`, `sales-runtime-next-server.ts`, `sales-runtime-next-browser.test.ts`): `exit 0` sin avisos. Unitarias de selección/frontera POS: **47/47**, 4 archivos, `exit 0`, 31.59 s. Build de producción finalizado (`BUILD_ID: 3uHsQamaXwpx8-UdKZkBZ`) y corrida Next con `POS_FILES_RUNTIME_DATABASE_URL` aprobada **4/4** (`exit 0`, 316.89 s); ver [accepted.md](accepted.md).

La suite conserva los cuatro casos previos con client explícito y añade dos por el camino configurado sin client: read/link, oráculo dueño tras commit, cierre de pools; rechazo de URI dueña, SELECT general, UPDATE(total_sales) extra y RLS desactivada, siempre sin efectos y sin fallback, con recuperación positiva. Los DDL/grants temporales sólo afectan su DB/LOGIN aleatorios; no roles compartidos ni origen. Limpieza del pool/base/rol sigue en afterAll.

Comandos:

```powershell
pnpm.cmd exec vitest run --configLoader bundle tests/unit/sales/pos-runtime-connection.test.ts tests/unit/inventory/sales-entry-smart-link.test.ts tests/unit/sales/pos-file-read.test.ts tests/unit/inventory/sales-runtime-connection.test.ts --maxWorkers=1 --pool=threads
node .tmp/pos-runtime-db-verify.cjs
pnpm.cmd exec eslint lib/db/pos-file-runtime.ts lib/services/pos-cut-file-service.ts tests/unit/sales/pos-runtime-connection.test.ts tests/integration/pos-cut-file-runtime-db.test.ts
```

No se acepta almacenamiento por una prueba de selector/SQL. Faltan Next configurado con este login, bytes/lectura R2 y sesión reales sobre la misma frontera, negativas sin efectos y limpieza, además de sus criterios de productor directo y dependencias. El plan completo y fila 11.11 permanecen abiertos.
