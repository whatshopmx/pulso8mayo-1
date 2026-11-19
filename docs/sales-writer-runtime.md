# Conexión runtime del writer de ventas

`SALES_RUNTIME_DATABASE_URL` activa una conexión independiente para
`SalesIngestService.ingest` y la resolución autónoma de referencias de receta.
La captura manual, bulk y el CSV del cierre comparten esa ingestión.
Autenticación, comprobaciones HTTP previas y otros dominios conservan su
conexión actual; esta opción no migra toda la aplicación a runtime.

## Contrato de configuración

- Variable ausente: conserva la conexión existente de `DATABASE_URL` durante
  la transición. No acredita runtime independiente en operación.
- Variable presente: debe ser una URI Postgres con usuario y contraseña,
  otra identidad de login y el mismo endpoint, puerto y base que
  `DATABASE_URL`. Se acepta la variante pooler del mismo endpoint.
  Vacío o espacios cuentan como configuración inválida.
- Configuración inválida, fallo de conexión o preflight de rol/RLS rechazado:
  error 503 seguro, sin ejecutar el writer con la conexión dueña.

Antes del callback se verifica `current_user=session_user=login configurado`,
NOSUPERUSER, NOBYPASSRLS, NOCREATEROLE, NOCREATEDB y cero membresías. El rol
no puede ser dueño de tablas usadas y las nueve tablas protegidas deben
existir y tener RLS habilitado. Debe contar con los grants mínimos declarados
en 0137/0138/0139/0141; el código no concede permisos ni instala migraciones.
El preflight no reemplaza su revisión SQL y pruebas de privilegios mínimos.

Cada intento abre una transacción SERIALIZABLE en su propio pool WebSocket,
comprueba la frontera de rol, ejecuta contexto/catálogo/writer y cierra el
pool. Se conservan los errores de negocio y los reintentos acotados existentes
(hasta tres intentos ante 40001/40P01). No se comparten pools con el dueño ni
se mantiene uno global entre bundles, credenciales o recargas de Next.
El cierre del pool no debe sobrescribir el resultado ya confirmado.

El uso de Pool WebSocket para transacciones interactivas y su cierre dentro
de la operación sigue la [documentación oficial del driver Neon](https://github.com/neondatabase/serverless).
Crear el rol SQL y conceder privilegios explícitos sigue la
[documentación de roles de Neon](https://github.com/neondatabase/website/blob/main/content/docs/manage/roles.md).

## Preparación del entorno

1. Revisar las migraciones del entorno y sus políticas/privilegios mediante
   el procedimiento del plan. Esta configuración no las aplica.
2. Provisionar un login de aplicación sin bypass, membresías o propiedad de
   objetos y con los grants de columnas necesarios. Mantener el login dueño
   para migración y los dominios todavía no migrados.
3. Guardar la nueva URI en los secretos del entorno como
   `SALES_RUNTIME_DATABASE_URL`; conservar host/base idénticos a los de
   `DATABASE_URL`. No incluir URI, contraseña o logs de conexión en Git.
4. Verificar en el entorno aislado el guardado, corrección, repetición,
   ingreso desconocido/cero, anulación y rollback por insuficiencia, además
   de sesión/empresa/sucursal y las pantallas consumidoras.

Ante una activación fallida se debe corregir la configuración/permisos. El
writer no hace fallback automático. Retirar deliberadamente la variable
restaura la conexión anterior y deja de acreditar la separación runtime;
es una decisión de despliegue, no una recuperación silenciosa de la API.

Bulk conserva el 503 sin fabricar un resultado de importación. En el cierre
POS, el contrato existente permite guardar evidencia con advertencia si la
ingestión falla; no afirma que esa evidencia haya generado ventas.

## Verificación disponible

`sales-runtime-connection.test.ts` cubre selección, configuración, preflight,
cierre y reintentos. `sales-ingest-runtime-connection-db.test.ts` recorre la
frontera configurada con login PostgreSQL y grants mínimos reales, con writer
en rollback. `sales-entry-session-db.test.ts` prueba sesiones HTTP y el
rechazo de la conexión dueña configurada como runtime. Estos casos no
sustituyen el guardado exitoso Next→runtime→stock ni su aceptación integrada.
No se han configurado secretos de despliegue ni modificado producción.
