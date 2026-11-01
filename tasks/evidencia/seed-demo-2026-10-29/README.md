# Reconstrucción del demo en Neon — 2026-10-29

El usuario autorizó borrar la base sin clientes y reconstruir el demo completo.
Se usó la conexión de `.env` a `neondb`, rol `neondb_owner`, endpoint
`ep-dawn-scene-ayy93r15-pooler.c-5.us-east-2.aws.neon.tech`.
No se cambiaron credenciales de infraestructura ni la configuración del despliegue.

## Diagnóstico previo

- Existían 9 empresas (el demo y 8 empresas de verificación), 15 usuarios y 11 sucursales.
- Faltaban `payroll_runs.aguinaldo_snapshot` y `payroll_payslips.aguinaldo_snapshot`.
- Estaban pendientes `0122_aguinaldo_snapshot` y `0123_rls_nomina`.
- El diagnóstico `scripts/migration-manifest.ts` esperaba un snapshot JSON de
  la última migración manual que no existe. Se hizo un diagnóstico separado
  contra el esquema TypeScript y los catálogos de Postgres.
- Los 9 hashes históricos de las primeras migraciones no coinciden con los
  archivos actuales. No se reescribió el historial ni se reaplicaron esas migraciones.

## Operación ejecutada

1. Se comprobó el endpoint, nombre de base, rol dueño y clave de cifrado antes de escribir.
2. Se aplicaron las dos migraciones pendientes con el migrador de Drizzle.
3. Se vaciaron las 183 tablas declaradas de la aplicación. Se conservaron el
   esquema, el historial de migraciones y las políticas RLS. El permiso para
   eliminar empresas de pruebas se acotó al ejecutor de esta operación;
   el guard del seed normal no se deshabilitó.
4. Se ejecutaron las 20 fases de `seed-full.ts` y el seed de contraseñas.
   La carga terminó correctamente en 235.1 segundos.
5. Se comprobó el backfill de invitaciones: 0 sucursales pendientes.
6. Se detectaron 1,232 pasos con evidencia sin espejo canónico: la fase 19
   sólo había reflejado su muestra de 80. Se ejecutó el backfill de los
   faltantes con `syncStepEvidence`, sin volver a insertar los existentes.

## Primera verificación posterior a la carga

| Registro | Cantidad |
| --- | ---: |
| Empresas | 1 |
| Sucursales | 3 |
| Usuarios / credenciales válidas | 8 / 8 |
| Perfiles de RH | 7 |
| Insumos / lotes | 30 / 78 |
| Recetas | 7 |
| Plantillas de workflow | 30 |
| Ejecuciones / pasos | 622 / 6,939 |
| Turnos / sesiones de asistencia | 104 / 104 |
| Órdenes de compra / recepciones | 4 / 2 |
| Cortes de venta | 93 |
| Corridas de nómina | 2 |
| Recibos de aguinaldo calculables | 6 |
| Movimientos bancarios / gateway | 12 / 14 |
| Mediciones KPI / excepciones | 21 / 18 |

Sin empresas ajenas, invitaciones faltantes, definiciones de pasos faltantes,
mermas de workflow pendientes de recuperar evidencia, timbrados ficticios,
inconsistencias de asistencia, aprobaciones cruzadas o cortes descuadrados.
Las cuatro políticas RLS nuevas de nómina están presentes.

No se enviaron timbrados, mensajes ni pagos. El aguinaldo de Luisa conserva
el bloqueo real de conciliación de acumulados de subsidio en la preview;
no se fabricó su recibo. La bandera de cifrado PII de empleados está desactivada
en el entorno, por lo que no se ejecutó ese backfill opcional ni se cambió la bandera.

## Acceso publicado

Se verificó por HTTP el login de `carlos@pulso.mx` en el despliegue publicado:
respuesta 200, sesión de la empresa demo, dashboard 200 con su contenido
y sin el mensaje de excepción del servidor. No es una auditoría visual de navegador.

URL: https://pulso-horeca.netlify.app/sign-in

## Estado final

Comprobación final: **2026-10-29 15:28:45 UTC**.

- Backfill terminado: 1,232 pasos y 1,232 adjuntos adicionales.
- Evidencia canónica total: **1,312 registros**; **0 pasos pendientes de reflejar**.
- Los controles de coherencia siguen en cero y las 8 contraseñas demo validan.
- Se mantienen 1 empresa, 3 sucursales, 8 usuarios, 622 ejecuciones de workflows,
  93 cortes, 2 corridas de nómina y las 4 políticas RLS de nómina.
- La base sigue atendiendo la aplicación: los conteos de actividad pueden cambiar
  entre lecturas (la lectura final registra 5 órdenes de compra).

Resultados sanitizados: [verificacion-final.json](verificacion-final.json) y
[acceso-publicado.json](acceso-publicado.json). No contienen contraseñas,
hashes, URLs de conexión completas ni cookies de sesión.
