# Cobertura ejecutiva y menú con sesión real por HTTP

Continuación 2026-11-18 sobre HEAD `7ad1ef6f9817a8f034fc1ef325bceb86ac15d750` más diff local. Se amplía el arnés existente `tests/integration/cogs-session-db.test.ts` (un archivo), reutilizando el servidor loopback, cuentas sintéticas, login Better Auth y rollback. Sin nueva aceptación.

`NODE_OPTIONS='--use-system-ca --max-old-space-size=4096' pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/cogs-session-db.test.ts --maxWorkers=1 --pool=threads`: **6/6, exit 0**, 50.31 s (dos COGS previas, dos ejecutivo y dos menú). `pnpm.cmd exec eslint tests/integration/cogs-session-db.test.ts`: exit 0.

Para ambos lectores: anónimo 401; inicio de sesión por endpoint real y cookie firmada; subtotal de 1200 con ingreso firme/porcentaje ausentes cuando la venta histórica no tiene revisión canónica; consolidación ADMIN; sucursal ajena rechazada (400 ejecutivo con helper compartido, 403 menú); intento de cambiar empresa mediante `x-pulso-tenant-id` rechazado con 403 por el resolvedor; UUID inválido 400; cookie inválida 401. Un GERENTE que pide sucursal ajena conserva la asignada y no puede consolidar; sin asignación recibe 403.

La prueba inicial tuvo 5/6: una expectativa confundía el rechazo de la sucursal con el rechazo del encabezado de suplantación; se corrigió a 403 para este último. No se cambió el resolvedor de sesión/empresa.

Postgres real de `.env.test` con comprobación de host distinto al operativo. Datos, cuentas y sesiones dentro de rollback; se verifica ausencia de empresas, usuarios y sesiones tras terminar. No se usan cuentas operativas ni se exponen credenciales. Better Auth emite advertencia de base URL no configurada en el arnés; login/getSession y lecturas se verifican igualmente.

Límites: HTTP real y Better Auth/servicios/SQL reales con conexión dueña; el arnés suministra el almacén de headers/cookies de Next y redirige la frontera DB al fixture. No es un servidor Next completo ni navegador, y no acredita conexión autenticada independiente de runtime. La [V2 con RLS](runtime.md) es evidencia separada; ninguna de las dos pruebas acredita por sí sola el recorrido conjunto sesión→runtime→navegador. Migraciones candidatas sin despliegue y dependencias sin aceptar.
