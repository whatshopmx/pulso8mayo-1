# OPS-02.nomina.F.1 — consumidores con las políticas publicadas

2026-10-29; base `3b27ac4`. Incremento de tres archivos de pruebas más documentación. F y AGU-03C.3 permanecen abiertos por F.2. No hay cambio de lógica de negocio, credenciales, esquema público ni activación operativa.

## Hallazgo y cambio

Las pruebas de recuperación/autorización/ordinaria/tesorería y lectura del recordatorio instalaban políticas `tenant_scope` recreadas. La aceptación de E ejecutaba el SQL 0123 en otra prueba, sin esos consumidores. Se añadió una regresión que exige las cuatro políticas publicadas: falló contra el montaje anterior, mostrando `tenant_scope` en las cuatro tablas (1 fallo, 23 omitidas por filtro, exit 1).

Ahora ambos montajes aplican el archivo `drizzle/0123_rls_nomina.sql` sin reescribirlo, mediante `helpers/nomina-rls-batch.ts`. El helper exige un namespace privado `nomina_<letra>_<uuid>` y las cuatro copias, usa una transacción con `search_path` privado sin fallback a `public`, revierte ante errores y libera el cliente. El montaje del recordatorio copia también las tres tablas restantes porque el lote tiene políticas con referencias a la corrida padre.

## Validación de esta sesión

| Control | Resultado | Evidencia |
|---|---|---|
| Integración: recuperación runtime, recordatorio runtime y lote 0123 | 3 archivos, 34/34, exit 0 | [runtime.log](runtime.log), [exit](runtime-exit.log) |
| Suite unitaria completa | 181 archivos, 2284 pasadas, 1 omitida, 1 pendiente, exit 0 | [unit-full.log](unit-full.log), [exit](unit-full-exit.log) |
| ESLint de los tres archivos de pruebas modificados/nuevo | exit 0, sin errores | [lint.log](lint.log), [exit](lint-exit.log) |
| TypeScript de la aplicación (`tsc --noEmit --incremental false`), heap 6144 MB | exit 0; `tests/**/*` está excluido por el tsconfig del proyecto | [tsc.log](tsc.log), [exit](tsc-exit.log) |
| Build de producción, con TypeScript integrado, fuera del sandbox | exit 0 | [build-retry.log](build-retry.log), [exit](build-retry-exit.log) |

Comandos: `pnpm run test:integration tests/integration/aguinaldo-runtime-recovery-db.test.ts tests/integration/aguinaldo-reminder-runtime-db.test.ts tests/integration/nomina-rls-batch-db.test.ts`; `pnpm run test:unit`; `pnpm exec eslint tests/integration/helpers/nomina-rls-batch.ts tests/integration/aguinaldo-runtime-recovery-db.test.ts tests/integration/aguinaldo-reminder-runtime-db.test.ts`.

La conexión inicial falló con `unable to verify the first certificate` dentro y fuera del sandbox. `NODE_OPTIONS=--use-system-ca` resolvió la confianza usando el almacén del sistema; TLS permaneció activo. La integración corrió fuera del sandbox contra `.env.test`, con la salvaguarda existente que rechaza coincidencia con `.env`/`.env.local`. Los mensajes `NativeCommandError` al inicio del log corresponden a stderr redirigido por PowerShell; el proceso y Vitest terminaron en exit 0. No se ocultan fallos de pruebas.

El primer build, dentro del sandbox y con heap 6144 MB/certificados del sistema, terminó en exit 1 por no poder descargar Geist/Geist Mono desde Google Fonts ([log](build.log), [exit](build-exit.log)). Se conserva el intento; el reintento fuera del sandbox terminó en exit 0, sin modificar fuentes, configuración ni código de producto. Compilación, TypeScript y generación de páginas completados.

El build generó 430/430 páginas. Conserva avisos de `fetchConnectionCache` deprecado y `DYNAMIC_SERVER_USAGE` al intentar prerenderizar `/dashboard/labor/documents` con `headers`; esa ruta queda dinámica y el build termina en exit 0. No se modificó esa pantalla en este incremento.

Los montajes usan propietario separado y login `pulso_app` sin superuser/bypass; el recorrido principal comprueba además que el runtime no es miembro del propietario. Dos conexiones independientes, cada una con pool max=1. Se prueban autorización atómica, dos autorizadores, dos empresas, reuso de timbre, respuesta incierta, rollback local, bitácora, nómina ordinaria, handler de tesorería con permisos simulados y lectura del recordatorio por empresa. Las conexiones sin contexto no ven filas y se rechaza escritura fiscal sin contexto. El PAC es HTTP simulado, sin emisión real.

## Límites

- El handler de tesorería simula `requirePermissionApi`. Falta autenticación/autorización HTTP completa, incluyendo 401/403, con el runtime real.
- El recordatorio prueba el servicio SQL utilizado por el cron; falta el handler completo del job con canal simulado y sus efectos. Ambos pendientes forman F.2.
- Sólo las cuatro tablas del lote reciben las políticas publicadas. Las fuentes auxiliares son copias privadas con grants; esta prueba no acredita RLS de todos los datos de RH/tesorería.
- El recorrido inicial usa fuentes SQL, pero no sustituye los escenarios de turnos nocturnos/solapados de DIA-02D ni la conciliación de subsidio pendiente de AGU-03.
- No se aplicó 0122/0123 a `public` ni al operativo, no se regeneraron manifiestos y no se desplegó. Los esquemas aleatorios se eliminan en `afterAll`. OPS-03 conserva la activación.
- Durante la sesión aparecieron cambios ajenos del frente seed (scripts y pruebas), además de configuración local; se conservaron y se excluyen de este incremento. La suite global acredita el árbol al ejecutarse, no un commit aislado de esos cambios concurrentes ni sus ediciones posteriores.
