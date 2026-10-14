# C19 — Pago a proveedores

Fecha: 14 de octubre de 2026. Plan: [C19](../../tasks/plan-conexion-frontend-backend.md#c19). Seguimiento: [tareas](../../tasks/todo-conexion-frontend-backend.md).

## Alcance y comportamiento

Se continuó la implementación parcial de C19 que estaba en el árbol de trabajo. `supplierPayment` conserva su clasificación **descriptiva**: seleccionar una modalidad no concede permisos ni cambia cuentas. Quién programa y aprueba por modalidad, y el reparto corporativo/sucursal, siguen pendientes de negocio. El pago conserva la máquina de estados de tesorería de C18.

Los cortes del plan se completan sobre ese recorrido:

- **C19.1:** catálogo y contrato describen lo que hace la corrida; la modalidad no determina el método bancario del proveedor.
- **C19.2–C19.3:** se rechazan facturas `PAID`/`CANCELLED` y obligaciones ya retenidas. El alta bloquea corrida y documento con `FOR UPDATE`, repite `DRAFT`, verifica estado, empresa, contraparte y monto, y escribe partida y total en una transacción. Nómina también bloquea su documento; impuestos y reposiciones usan un bloqueo transaccional por empresa/tipo/referencia.
- **Empresa y contraparte:** factura, proveedor y cuenta verificada se consultan por la empresa del servidor. El mismo filtro se aplica al gasto, su contraparte y su cuenta verificada. La ruta real ignora una empresa introducida en el cuerpo; se usa la del contexto autorizado. Un rechazo no cambia el total ni deja una partida.
- **C19.4:** los listados de facturas, gastos y nómina excluyen referencias de corridas no canceladas de la propia empresa. Las canceladas liberan documentos pendientes; una corrida ajena no los bloquea. Cada visita al modal o a una pestaña refresca disponibles y depura selecciones obsoletas.
- **Lote parcial:** se retiran sólo los éxitos, los fallidos conservan selección y motivo, y un aviso muestra la cuenta exacta. Reintentar manda sólo los pendientes; cero éxitos no produce un aviso de éxito.
- **C19.5:** recorrido del servicio contra Neon con dos empresas, concurrencia y archivo de dispersión, sin envíos bancarios.

## Casos especiales

Una corrida `PROCESSING` o `COMPLETED` no admite cancelación: el rechazo pide revisar la corrida y no promete cancelarla. Cancelar una corrida previa a dispersión conserva su historial y libera sus documentos pendientes.

La reposición de caja chica es recurrente: una reposición `COMPLETED` libera el fondo para posteriores reposiciones. Un fondo retenido en una corrida abierta no admite otra reposición simultánea. Una factura, gasto o nómina completados siguen reteniendo su documento.

No se modifican ni reparan duplicados históricos, no se crea un motor de pagos parciales y no se cambia el filtro de roles de C18. El bloqueo cubre las altas que pasan por este servicio; no sustituye una restricción de unicidad frente a escrituras SQL externas.

## Verificación

| Comprobación | Resultado |
| --- | --- |
| `pnpm run test:unit tests/unit/finance/payment-scheduling.test.ts` | **39/39**, contra política, servicio y ruta reales con ejecutor DB simulado. Incluye rollback, doble alta de factura/nómina/impuestos, caja chica recurrente, documento ajeno, proveedor/cuenta ajenos, contraparte/cuenta de gasto ajenas y empresa del contexto HTTP. Los tres casos de gastos se verificaron en la suite de finanzas tras reproducir dos fallos. |
| `pnpm run test:unit tests/unit/finance/` | **56/56**, incluidos los 17 casos de autorización de C18. |
| `pnpm exec playwright test --config tests/playwright-shifts.config.ts payment-scheduling` | **8/8**, pantalla real: alta individual y reapertura, lote parcial y cero éxitos para facturas/gastos/nómina, y actualización al volver a cada pestaña. Captura inspeccionada; sin errores de consola/runtime. |
| `pnpm exec node --use-system-ca --import tsx scripts/verify-payment-scheduling.ts` | **21/21 contra Neon**, repetido después de acotar proveedor y cuenta. Dos empresas sembradas y eliminadas; concurrencia real con una partida y un total; factura cancelada liberada; factura pagada rechazada; layout de una transferencia; confirmación simulada reflejada en factura. |
| `pnpm run test:unit --maxWorkers=2` | **87 archivos; 1157 aprobadas, 1 omitida y 1 TODO preexistentes**, salida 0; repetida tras corregir el alcance de la contraparte y cuenta del gasto. |
| `pnpm exec playwright test --config tests/playwright-shifts.config.ts` | **68/68**, salida 0, una sola ejecución de navegador durante la repetición. |
| `pnpm exec tsc --noEmit` | Sin diagnósticos, salida 0 en la ejecución final separada. |
| Lint y build | Validación final en curso; no se acreditan los intentos interrumpidos. |

La implementación recibida no tenía las pruebas que su plan declaraba ejecutadas. La reproducción inicial dio 15 fallos: consultas de Drizzle mal invocadas, estado de factura mal proyectado y listados sin exclusión. Se corrigieron y se añadieron pruebas de comportamiento. Los casos de proveedor/cuenta ajenos y los lotes parciales también fallaron antes de corregirse. La revisión final reprodujo dos fallos adicionales: un gasto propio aceptaba una contraparte ajena o una cuenta verificada ajena. Ambas consultas ahora filtran por empresa y el rechazo conserva el total y las partidas.

## Límites y ejecución del entorno

- El navegador sirve componentes reales mediante Vite e intercepta la API; no ejecuta Next, autenticación ni Postgres. El montaje de tesorería no carga los estilos del layout: verifica interacción y mensajes, no diseño responsive. Las tres pruebas de POST usan la ruta real, pero simulan la autorización y el ejecutor de DB. No hay un recorrido de navegador con sesión real contra Neon.
- La concurrencia unitaria emula cerrojos de PostgreSQL por recurso; el script confirma además la carrera de dos altas de factura contra la base real. Nómina e impuestos se comprobaron con el adaptador, no con procesos independientes en Neon.
- Los nuevos rechazos por contraparte y cuenta de gasto ajenas se verificaron contra el servicio y SQL reales con ejecutor simulado; el script contra Neon recorre facturas y no acredita estos casos de gastos.
- El script usa cuenta bancaria cifrada y datos sintéticos, no publica el contenido del layout, y limpia sólo las empresas que creó. Su `finally` cubre también fallos de siembra; una interrupción o fallo de conectividad durante la limpieza puede dejar filas de prueba.
- El primer intento contra Neon falló al validar certificados. La repetición usa el almacén de certificados del sistema y conserva TLS activo.
- Ejecutar build, suite y TypeScript juntos produjo `Fatal process out of memory: Zone`. Esos intentos no son verificaciones aprobadas; la repetición limita trabajadores y separa comandos. Un lint enfocado también falló al cargar `ajv` durante ese intento.
- El primer recorrido completo de navegador tuvo un fallo al recargar una opción de configuración y luego fue interrumpido. El caso pasó en aislamiento y también durante la repetición de la suite, sin cambios a esa pantalla ni a su prueba.
- Los cambios locales de conteos de inventario y ejecución de workflows estaban presentes antes de C19 y se conservaron. No forman parte de este bloque.

Los bloqueos siguen las garantías de [PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html), y la atomicidad usa las [transacciones de Drizzle](https://orm.drizzle.team/docs/transactions).

## Continuidad

C20 es el siguiente bloque: autonomía del gerente. La Fase 3 sigue abierta; C20–C23 no se acreditan con estas pruebas.
