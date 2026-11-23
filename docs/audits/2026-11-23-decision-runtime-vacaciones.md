# Vacaciones — conexión runtime por dominio

Fecha: 2026-11-23. Estado: implementado y verificado en entorno aislado; adopción operativa pendiente. Seguimiento: `NOM-02.c1.http.rls`, `NOM-02.c1.http.runtime` y `NOM-02.c1.http` en el checklist de faltantes.

## Decisión

Las solicitudes de vacaciones usan una conexión dedicada cuando el servidor configura `VACATIONS_RUNTIME_DATABASE_URL`. El selector comprueba identidad LOGIN, ausencia de bypass/superusuario/administración/membresías/propiedad, RLS habilitado, políticas y trigger esperados y privilegios de columnas. Una configuración explícita inválida devuelve 503 y nunca selecciona la conexión dueña.

La empresa y el actor se establecen con `set_config(..., true)` en la misma transacción que lee o modifica la solicitud. La base valida además la empresa, sucursal y rol actuales del actor, evitando que una sesión desfasada amplíe el alcance.

El rol dedicado solo lee/inserta solicitudes y modifica columnas de transición. No recibe lectura ni escritura sobre `users` o `branches`. Una función booleana `SECURITY DEFINER`, con referencias de esquema explícitas, `search_path` fijo y ejecución pública revocada, verifica el sujeto y el actor sin entregar filas personales al rol. Estas precauciones siguen la [documentación de funciones de PostgreSQL](https://www.postgresql.org/docs/current/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY).

Better Auth, catálogos y notificaciones conservan sus conexiones existentes. El listado obtiene primero solicitudes accesibles mediante runtime y después hidrata exclusivamente sus identidades dentro de la empresa. Las decisiones notifican después de confirmar la transacción.

## Alternativas y consecuencias

- **Reutilizar `pulso_app` para HTTP:** descartado. Ese rol tiene un contrato de lectura de nómina por empresa/sucursal sin actor individual. Se conserva una política de lectura para ese propósito y el selector HTTP rechaza expresamente esa identidad.
- **Dar lectura de catálogos al nuevo rol:** descartado. Los permisos heredados del arnés de ventas hicieron fallar correctamente la primera prueba nativa. El arnés permite ahora una base fresca sin concesiones de ventas; su comportamiento anterior se conserva por defecto.
- **Activar RLS de `users`/`branches` globalmente en este ticket:** descartado por su impacto en autenticación y otros dominios. Las referencias se validan mediante la función estrecha y los catálogos de servidor mantienen sus filtros de empresa.
- **Forzar inmediatamente RLS al propietario:** se difiere hasta adoptar todos los callers y el lote operativo. La candidata habilita RLS y el selector excluye propietarios y bypass. Esto protege al rol dedicado, sin acreditar aislamiento de la conexión legacy. Las excepciones de propietario y la composición de políticas están descritas en [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

Sin la variable nueva se conserva la conexión anterior, ahora dentro de una transacción con contexto. Esa compatibilidad no cuenta como adopción runtime. Quitar la variable puede revertir la selección de conexión; una URI inválida no activa esa reversión automáticamente.

Las capacidades SQL deben revisarse junto con `lib/permissions.ts` cuando cambien los roles. El trigger protege transiciones y procedencia; no implementa el saldo histórico ni un snapshot aprobado de nómina. La entrega de notificaciones sigue siendo best effort.

## Verificación y límites

La [evidencia del incremento](../../tasks/evidencia/2026-11-23/NOM-02.c1.http-runtime/README.md) identifica comandos, casos, build, aislamiento y limpieza. La carrera nativa usa dos PIDs distintos y una barrera posterior a la lectura real de `PENDING`; solamente el orden de ejecución se controla en el arnés. Auth y dispatcher siguen simulados en esa capa.

La adopción requiere desplegar primero el código compatible, aprovisionar el rol dedicado, revisar/aplicar `0163` en el entorno identificado y configurar la URI del servidor. Después corresponde repetir aceptación con sesión y navegador reales. Este registro no aplica migraciones operativas ni cierra `SEC-05.nomina`, NOM-02.c1 o las filas de negocio.
