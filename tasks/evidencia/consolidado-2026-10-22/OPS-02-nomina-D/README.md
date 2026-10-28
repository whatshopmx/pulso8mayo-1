# OPS-02.nomina.D — recordatorio de aguinaldo por empresa

Base `c02c6e6`; 2026-10-28. Cuatro archivos de código/pruebas y dos de documentación. No aplica migraciones, no cambia roles y no envía mensajes reales: las pruebas cubren las decisiones del recordatorio (enumeración, destinatarios, estado, mensaje y dedupe), no el envío por WhatsApp/email ni una ejecución real del job.

## Defecto reproducido y corrección

| Defecto del cron anterior | Corrección implementada | Prueba que lo fija |
|---|---|---|
| Leía `payroll_runs` de todas las empresas en una sola consulta (`inArray(companyId, ids)`). Con el lote RLS de nómina y el rol runtime sin bypass esa lectura devuelve cero filas y el recordatorio se apaga en silencio. | `leerEstadoAguinaldo` abre una transacción por empresa con `withCompanyContext`; el cron itera empresa por empresa y no comparte contexto entre lecturas. | `sin contexto el rol runtime no ve corridas; con contexto ve sólo la propia` y `dos conexiones runtime con pool max=1 conservan el aislamiento`. |
| Elegía destinatarios con el literal `["OWNER","ADMIN"]`. `OWNER` existe en `roleEnum` y en `PERMISSIONS`, pero **no** en `UserRole` ni en `ROUTE_PERMISSIONS`: el `actionUrl` de ese aviso queda bloqueado. | `ROLES_RECORDATORIO = ["SUPER_ADMIN","ADMIN"]`: roles reconocidos por el RBAC de rutas y con `reports:manage`. Las empresas cuyo único rol de dirección es `OWNER` se devuelven en `sinDestinatario` para que la brecha sea visible. | `no depende de OWNER…`, `cada destinatario existe en UserRole…` y `los destinatarios excluyen OWNER…`. |
| Trataba una corrida `COMPLETED` como "ya dispersada" y el toast de la pantalla decía "Aguinaldo disperso y timbrado". | Tres estados: `SIN_CORRIDA`, `EN_PROCESO` y `TIMBRADO`. El aviso de `TIMBRADO` pide confirmar la dispersión real y dice que el sistema no puede verificar el pago desde el CFDI. El toast pasa a "Aguinaldo timbrado · pago sin confirmar". | `COMPLETED es timbrado completo, no pago`, `timbrado: separa explícitamente el CFDI de la entrega del dinero` y `COMPLETED_WITH_ERRORS no se confunde con timbrado completo`. |

`COMPLETED_WITH_ERRORS`, `PROCESSING`, `DRAFT` y `ERROR` se clasifican como `EN_PROCESO`: el timbrado no terminó para todos los recibos. La clasificación es una función pura (`clasificarEstadoAguinaldo`) para probar cada transición sin base de datos.

## Implementación

- `lib/services/aguinaldo-reminder-service.ts` (nuevo): enumeración de empresas con dirección activa, separación `conDestinatario`/`sinDestinatario`, destinatarios por empresa, lectura de estado por empresa con contexto, clasificación pura y mensajes.
- `lib/inngest/functions/cron-aguinaldo-reminder.ts`: pasos por empresa (`estado-<companyId>`, `avisar-<companyId>`), dedupe por empresa/año/estado con título exacto y resultado del job con `empresas`, `sinDestinatario` y `notificadas`.
- `components/labor/aguinaldo-card.tsx`: el toast de éxito deja de afirmar dispersión.
- Pruebas: `tests/unit/payroll/aguinaldo-reminder-service.test.ts` y `tests/integration/aguinaldo-reminder-runtime-db.test.ts`.

El dedupe conserva el título histórico del caso "sin corrida", de modo que una empresa ya avisada este año no recibe un duplicado tras el despliegue. Un cambio de estado (`SIN_CORRIDA` → `TIMBRADO`) genera un aviso distinto, como máximo uno por estado y año.

## Pruebas

| Ejecución | Resultado | Registro |
|---|---|---|
| Unitarias del contrato (clasificación, mensajes, dedupe, roles) | 15/15, exit 0 | [unit.log](unit.log) |
| Runtime con `pulso_app`, políticas privadas de contrato, dos empresas y pool max=1 | 5/5, exit 0 | [runtime.log](runtime.log) |
| TypeScript (`tsc --noEmit`), heap 6144 MB | exit 0 | [tsc.log](tsc.log), [tsc-exit.log](tsc-exit.log) |
| ESLint de los cinco archivos tocados | exit 0, sin errores | [lint.log](lint.log), [lint-exit.log](lint-exit.log) |
| Build de producción con TypeScript, heap 6144 MB | exit 0, `✓ Compiled successfully` y 430 páginas generadas | [build.log](build.log) |
| Suite unitaria completa (`pnpm test:unit`) | 180 archivos, 2277 pruebas pasadas, 1 omitida, 1 pendiente, 0 fallos | [unit-full.log](unit-full.log) |

El runtime copia `payroll_runs` y `users` a un esquema privado con `LIKE public.* INCLUDING ALL`, añade la columna `aguinaldo_snapshot` que la base aislada todavía no tiene (0122 pendiente, OPS-01) y crea la política `company_id = current_setting('app.current_company_id', true)::uuid`. Comprueba que el rol no tiene `SUPERUSER` ni `BYPASSRLS`, que sin contexto no ve corridas, que dos empresas con el mismo año no se mezclan, que la conexión reutilizada no hereda contexto y que dos conexiones simultáneas conservan el aislamiento.

No se ejecuta el handler de Inngest: el cron es una capa fina sobre el servicio y las pruebas cubren las decisiones (enumeración, destinatarios, estado, mensaje y dedupe). El envío real de WhatsApp/email no se ejerce.

## Límites y revisión

- `OWNER` sigue existiendo en el enum de la DB y en la matriz de permisos, pero no en `UserRole`/`ROUTE_PERMISSIONS`. Unificar los dos modelos de rol es una tarea transversal (afecta navegación, guards y dashboards por rol); este lote sólo evita depender de él. Una empresa cuyo único rol de dirección sea `OWNER` queda en `sinDestinatario` y no recibe aviso.
- El sistema no tiene confirmación de pago de nómina (NOM-05): `TIMBRADO` no se marca como pagado y el recordatorio no lo declara. La bitácora de dispersión en efectivo cubre sólo el excedente `EFFECTIVE`; su veracidad funcional sigue en AGU-04.
- Las políticas usadas son privadas de contrato. El lote definitivo de políticas y grants sigue en OPS-02.nomina.E; la aceptación HTTP/job con políticas reales sigue en OPS-02.nomina.F / AGU-03C.3. Sin activación operativa ni despliegue (OPS-03).
- No se modifica el esquema, no se generan migraciones y no se alteran roles. `users` todavía no tiene RLS en este lote, por lo que la enumeración no necesita contexto.

Revisión del diff: el `companyId` viene del job autorizado; la transacción de lectura es breve y no envuelve al PAC ni a proveedores; no se persiste contexto de sesión; no se introducen transacciones anidadas; el dedupe usa parámetros, no SQL concatenado.
