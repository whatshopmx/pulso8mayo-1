# Proyecto nuevo de Pulso

Fecha: 2026-11-11. Solicitado expresamente por el propietario durante P0-04 al identificar que la conexión anterior correspondía a otra cuenta de Neon.

- Proyecto: [`pulso29-20261111`](https://console.neon.tech/app/projects/soft-cloud-50478212), ID `soft-cloud-50478212`, organización conectada `org-super-hat-62641049`, PostgreSQL 18, AWS us-east-2. Compute 0.25 CU; se conserva el suspend timeout permitido por la cuenta. El intento de configurarlo a 300 segundos fue rechazado (HTTP 412) y no creó otro proyecto.
- Rama principal: `main`, `br-steep-frog-bet3a8l6`.
- Rama aislada: `test-faltantes-20261111`, `br-round-voice-belheola`, creada después del baseline desde main, sin datos de negocio. No se modifica la antigua base de pruebas.
- `.env`: DATABASE_URL pooled y MIGRATION_DATABASE_URL directa. `.env.test`: TEST_DATABASE_URL de la rama aislada. Se verificaron valores escritos y destinos distintos. El resto de las claves se conserva.
- Respaldos locales ignorados por Git: `.env.before-neon-pulso29-20261111` y `.env.test.before-neon-pulso29-20261111`. `.env.neon-pulso29` también está ignorado y contiene las conexiones nuevas. No se registran contraseñas en esta evidencia.

## Inicialización aditiva

El historial existente **no empieza desde una base vacía**: 0000 ya altera enums/tablas previos, y 0002 incluye eliminación de tablas heredadas. No se reprodujo ese historial, no se ejecutó db:push, no se alteraron SQL/snapshots/journal existentes ni se copiaron datos de otra cuenta.

Se generó el esquema actual con:

```powershell
pnpm.cmd db:generate --dialect postgresql --schema ./lib/db/schema.ts --out ./.tmp/pulso29-neon-bootstrap --name pulso29_initial
```

Se añadieron las políticas legacy 0103–0106/0123 y las funciones, triggers, FORCE RLS y privilegios explícitos que existen en los SQL y no quedan representados por el esquema declarativo. No se duplicaron tablas, constraints, índices ni políticas declarativas. El [SQL exacto](initial-schema.sql) y su [manifiesto con hashes](baseline.json) son la evidencia del baseline. La ejecución exigió esquema público vacío y aplicó 959 bloques más las guardas/bitácora en una única transacción mediante Neon `run_sql_transaction`.

Resultado independiente: **195 tablas, 22 políticas, 20 triggers; cero empresas, sucursales y usuarios** al instalar. No se ejecutaron seeds, se activó contabilidad ni se desplegó la aplicación. El esquema incluye el borrador local FC-12 porque forma parte del workspace; eso no acepta FC-12 ni demuestra aplicación en la cuenta anterior.

La conexión pooled de la aplicación también se consultó mediante el mismo WebSocket Pool con TLS verificado: [comprobación](connection-check.json), exit 0, cero empresas/usuarios/sucursales. Las credenciales permanecen en los archivos de entorno ignorados.

## Historial futuro

`drizzle.pulso_schema_baselines` conserva el baseline real, el hash del SQL, los hashes de fuentes, HEAD y corte `0136_fc12_settlements`. `drizzle.__drizzle_migrations` tiene una entrada de baseline con su hash propio y el timestamp de ese corte, para que el migrador no intente ejecutar el historial brownfield sobre la instalación nueva.

La guarda de esquema vacío y la bitácora ejecutadas en esa misma transacción se conservan en [baseline-ledger.sql](baseline-ledger.sql), con la posición explícita donde se aplicó el SQL del esquema.

El diagnóstico distingue **BASELINED** de **APPLIED**: las 136 fuentes históricas se cotejan con el manifiesto y no se presentan como ejecutadas individualmente. Una fuente ausente/alterada o un ancla de hash/corte inválida exige revisión; el baseline tampoco oculta migraciones posteriores. No borrar/reconstruir el journal ni cambiar timestamps para resolver un error.

Antes de la próxima migración, renovar el diff y revisar SQL; usar `pnpm.cmd db:generate` y `pnpm.cmd db:migrate` con la conexión directa nueva. No volver a inicializar este esquema ni repetir `initial-schema.sql` sobre una base con datos.

## TLS local y límites

Node 22.17 de esta máquina no confiaba por defecto en la cadena de certificados de la red. Las pruebas HTTP/WebSocket funcionaron usando certificados del sistema, manteniendo la verificación TLS. Para los comandos locales de Node/pnpm en esta máquina:

```powershell
$env:NODE_OPTIONS = ($env:NODE_OPTIONS + ' --use-system-ca').Trim()
pnpm.cmd run dev
```

No se desactivó TLS ni se cambió la configuración global de Node. El rol de migración/aplicación conserva el patrón previo de propietario; el rol NOBYPASSRLS probado vive en la rama aislada. El cambio general del runtime y la cobertura de seguridad por dominio siguen en SEC-05; esta instalación no acredita aislamiento universal ni piloto con usuarios reales.

Para volver a la conexión anterior se pueden restaurar los archivos ignorados de respaldo y reiniciar los procesos locales. No elimina el proyecto nuevo ni revierte datos; no se ejecutó esa restauración.

Fuentes de procedimiento: [Neon y Drizzle](https://neon.com/docs/guides/drizzle), documentación del paquete instalado y comandos locales del repositorio.
