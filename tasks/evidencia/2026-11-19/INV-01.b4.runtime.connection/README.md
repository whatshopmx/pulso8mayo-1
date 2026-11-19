# Writer: conexión autenticada independiente con privilegios mínimos

Base `04003b2`, árbol limpio. Continuación de `INV-01.b4b` y
`INV-01.b4.manual`: un archivo de prueba,
`tests/integration/sales-ingest-runtime-connection-db.test.ts`. No cambia
producto, schema, credenciales de entorno, rol compartido ni migraciones.
No acepta los hijos, padres o fila 11.11.

El nuevo arnés crea dos empresas, tres sucursales y sus catálogos/lotes
sintéticos en la base aislada, comprobando antes que el host no sea el de
`.env`. Estos catálogos se confirman para que pueda leerlos una conexión
distinta. Los hechos append-only y movimientos del writer viven únicamente
en transacciones SERIALIZABLE que se revierten, incluso si falla el caso.
Se comprueba su ausencia por IDs de fixture antes de retirar los catálogos.

Se autentica otro pool WebSocket con un rol SQL efímero generado por UUID,
contraseña aleatoria solo en memoria y `max: 1`. No usa SET ROLE, mocks ni
el pool dueño para ejecutar el writer. `current_user=session_user=rol`
demuestra login independiente; se exigen NOSUPERUSER, NOBYPASSRLS,
NOCREATEROLE y cero membresías. El rol tampoco tiene CREATEDB. Se comprueba
que las cinco tablas principales tienen RLS y dueño distinto.

Solo se ejecutan los bloques GRANT finales de las migraciones
0137/0138/0139/0141, sustituyendo el destinatario por el rol efímero.
No se instala su DDL ni se toca `pulso_app`. Se verifican lectura de nombre
por columna y ausencia de SELECT general/DML de receta, DELETE de lotes y
ventas y UPDATE de movimientos. La creación SQL de roles con privilegios
explícitos sigue la [documentación oficial de Neon](https://github.com/neondatabase/website/blob/main/content/docs/manage/roles.md).

Casos finales fijados:

- Manual y POS, cada uno por separado: stock 20→10→8→12 para venta
  10→12→8. Repetir conserva movimientos y revisiones exactamente. Completar
  8025 centavos conserva movimientos; cero explícito devuelve stock a 20.
  Cinco revisiones para seis solicitudes por origen. Después del rollback,
  el dueño vuelve a leer saldo 20 y ninguna identidad ni movimiento del caso.
- Sin contexto no lee recetas; con empresa/sucursal ve solo receta propia y
  lote propio, excluyendo sucursal hermana y empresa ajena. Ingestión con
  sucursal ajena rechazada. Tras rollback, ambos GUC quedan vacíos en el pool
  runtime y el login conserva su identidad sin elevación.
- Cuatro DML prohibidos devuelven SQLSTATE 42501 mediante savepoints reales:
  UPDATE recetas, DELETE lotes, DELETE ventas y UPDATE movimientos. Stock
  intacto; receta de otra empresa rechazada por la ingestión.

Resultados:

- Caracterización inicial con login existente `pulso_app`: **3/3, exit 0**,
  40.60 s. No acredita privilegios mínimos por la deriva conocida del rol.
- Primer rol efímero: **3 casos aprobados, suite exit 1**, 38.29 s. El
  teardown `DROP OWNED` exige membresía que el rol dueño no tenía. Catálogos
  y hechos del fixture se limpiaron; quedó el rol con sus grants. No se
  atribuye GREEN global a este intento.
- Corrección: revocar explícitamente permisos de tabla y columnas de los
  diez objetos y esquema, comprobar que el rol no posee objetos y eliminarlo;
  no conceder membresía ni alterar atributos del rol compartido. Se limpió
  el rol exacto del intento fallido y se comprobó su ausencia (script local
  de recuperación exit 0). El primer arranque de tsx falló con
  `uv_os_get_passwd/ENOMEM`; reintento fuera del sandbox autorizado.
- Final ampliado: **4/4, suite exit 0, 45.30 s** (41.72 s de casos).
  Rol efímero eliminado y ausencia comprobada, junto con catálogos, hechos
  y movimientos. ESLint del archivo final: **exit 0, sin avisos**.

```powershell
$env:NODE_OPTIONS='--use-system-ca --max-old-space-size=4096'
pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/sales-ingest-runtime-connection-db.test.ts --maxWorkers=1 --pool=threads
pnpm.cmd exec eslint tests/integration/sales-ingest-runtime-connection-db.test.ts
```

Build de producto reutilizado del incremento anterior: exit 0 con TypeScript
global y 455/455 páginas. Aquí solo cambia una prueba excluida de tsconfig;
no se repite build sin cambio de producto. El arnés no realiza HTTP, auth de
aplicación o navegador. Tampoco prueba commits ni carreras entre conexiones:
el writer se revierte y la conexión independiente solo tiene los grants de
este dominio. No equivale a configurar Next con esa conexión, aplicar las
migraciones del entorno o aceptar el recorrido Next→runtime→stock.
