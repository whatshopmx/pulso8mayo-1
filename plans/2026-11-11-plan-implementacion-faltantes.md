# Plan de implementación de faltantes — revisión basada en investigación

Fecha: 2026-11-11. Revisión 2 del plan de la misma fecha.

Fuente principal: [investigación del sistema](../docs/2026-11-11-investigacion-plan-faltantes.md). Alcance de referencia: las 239 filas de [la matriz histórica](../docs/matriz-cumplimiento-sistema-2026-10-17.csv) y H01–H10. Ejecución: [checklist de faltantes](../tasks/todo-implementacion-faltantes.md).

## 1. Resultado esperado y límites

Cerrar brechas con recorridos verificables: venta corregida → consumo correcto; producción → stock terminado; asistencia aprobada → nómina explicable → obligación/pago; corte → liquidación → depósito; documento → evidencia/aprobación/excepción; período → P&L histórico.

Este plan sustituye la secuencia y las dependencias de la versión anterior. Conserva IDs mediante equivalencias. No declara las 239 filas cubiertas hasta completar P0-03 ni convierte código localizado en aceptación. La revisión verificó 157 unitarias en 7 archivos, no el sistema completo ni producción.

Base de investigación: HEAD `ba88018d2cbd7d879549cfe6476d39e4addfd5d2` más cambios locales. P0-01 debe renovarla al iniciar: hay trabajo concurrente y el diff no está congelado.

## 2. Qué se reutiliza y qué cambia

| Evidencia existente | Tratamiento del plan |
|---|---|
| Evidencia durable y API común | Ampliar sujetos y recorridos; conservar almacenamiento y controles existentes. |
| Excepciones canónicas, lifecycle y reglas SLA con unitarias | Aceptar persistencia, sync, concurrencia y job; conectar acciones UI. |
| Recepción con conversión de costo y temperatura obligatoria | Aceptar V2/V3 por fila; no reimplementar. |
| Banca, cuentas, matching de salidas y depósitos | Validar recorridos y completar identidad/corrección de hechos; conservar contratos. |
| Comisiones y P&L con procedencia/cobertura | Separar importe reportado de conciliación; no confundir etiquetas con evidencia bancaria. |
| FiscalAPI integrado | Reutilizar proveedor y validar sandbox/configuración; no iniciar otra integración. |
| Producción transaccional con FEFO, ingredientes, costo y hold time | Añadir stock terminado y consumo correcto; conservar estas garantías. |
| Ceros silenciosos de nómina y carga patronal fija | Calcular con entradas/versiones y bloquear resultados incompletos. |
| Migraciones RLS contables posteriores a 0123 | Inventariar también estas políticas y privilegios; no asumir despliegue. |

## 3. Contrato de ejecución

- Tipos: **I** implementación o ampliación; **A** aceptación de base existente, con corrección solo si falla; **R** rastreo/decisión con evidencia.
- Tamaños: **S** 1–2 archivos, **M** 3–5 incluyendo pruebas/migración. **P** es un padre de coordinación: subdividir por documento, dominio, canal, perfil o módulo antes de programar. No es un ticket M disfrazado.
- Los archivos de cada fase son puntos de entrada orientativos. Cada ticket elige archivos concretos y se subdivide si rebasa 5 o una sesión enfocada. Consultar CodeGraph antes de decisiones estructurales.
- Toda escritura verifica sesión/capacidad, empresa y alcance de sucursal; jobs declaran contexto. Dinero en centavos enteros, cantidades con unidad y precisión explícitas.
- Toda fórmula fiscal/laboral exige fuente oficial, vigencia y oráculo independiente antes de implementarse. Este documento no fija tasas legales.
- Migraciones aditivas mediante `pnpm.cmd db:generate`, revisión SQL y número del journal vigente; nunca `db:push`, DROP ni cambios improvisados de migraciones ya aplicadas.
- Una reversa de datos no equivale a rollback de despliegue. Preferir bandera compatible, reversa compensatoria o corrección auditada; preservar hechos.
- Estados: pendiente → en curso → código implementado → V1 → V2 → V3 → aceptado. Registrar no aplicable con causa; no saltar a aceptado por tener tests o archivos.
- Evidencia por hijo ejecutable: `tasks/evidencia/2026-11-11/<ID>/`, con HEAD/diff, entorno sin secretos, comandos, exit, casos, resultado y límites. Un padre cierra solo con todos sus hijos y filas acreditados.
- Datos sintéticos prueban contratos técnicos. Un recorrido operativo real o sandbox identificado se acredita por separado. Un pendiente externo bloquea solo su aceptación dependiente.

### Verificación por ticket

| Código | Comprobación exigida |
|---|---|
| D | Integridad documental: IDs/enlaces/dependencias, filas y correspondencia con evidencia. No requiere build si solo cambia documentación. |
| V1 | Pruebas focalizadas con caso feliz, vacío y error; `pnpm.cmd exec tsc --noEmit`; lint de archivos afectados. Cálculos con oráculos independientes. |
| V2 | Postgres aislado, dos empresas/dos sucursales, runtime NOBYPASSRLS, rollback, idempotencia y carreras cuando apliquen. Confirmar aislamiento antes de ejecutar. |
| V3 | API/navegador, capacidades y alcance; probar errores visibles y recuperación. Nunca sustituir banco/PAC/canal por un mock para afirmar aceptación externa. |

Comando unitario de referencia en este Windows: `pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads <archivos>`. Integración: `pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts <archivos>`. Navegador: `pnpm.cmd exec playwright test <spec>`. Seleccionar archivos reales al abrir el ticket.

Checkpoint después de cada 2–3 tickets ejecutables: pruebas del recorrido afectado y tipos/lint; build `pnpm.cmd run build` al cerrar hito de código y antes de commit; V2/V3 aplicables antes de aceptación. Registrar fallos preexistentes con evidencia, sin ocultarlos. La revisión del checkpoint no requiere una nueva autorización para continuar trabajo ya encargado.

## 4. Orden de trabajo

Las secciones siguientes son frentes temáticos, no una secuencia rígida de fases. **Mandan las dependencias de cada ticket**. Se comprobaron IDs únicos, referencias internas y ausencia de ciclos.

1. Preparar P0-01/02/03/04, SEC-00 y P0-05. Resolver cualquier huérfana de la matriz antes de cerrar P0.
2. Iniciar AUD-02 y el frente INV-01.a/b/c/d → INV-02. Son la primera entrega de integridad: corregir/repetir/anular no corrompe stock.
3. Preparar SEC-05.tesoreria → BAN-01 → BAN-04. Desarrollar nómina desde NOM-01 y producción desde PROD-00 según disponibilidad.
4. Completar ingresos/depósitos/comisiones con FC-12 coordinado; conectar nómina con tesorería y cerrar snapshots.
5. Aceptar excepciones/evidencia y ampliar operación; ejecutar rastreos antes de afirmar ausencia de implementación.
6. Completar centros de costo/cierre financiero/canales y las validaciones por dominio. Seguridad se incorpora en cada frente; la fase 8 completa cobertura y perfiles.
7. Aplicar lotes estables mediante OPS-03 dentro de cada hito cuando corresponda; piloto y cierre de matriz al final.

Migraciones, journal, `payroll-service.ts`, `pnl-service.ts`, `operating-config` y archivos de conciliación/contabilidad compartidos se editan secuencialmente. No iniciar trabajo paralelo sobre ellos. Este plan no inicia agentes ni modifica el estado de otros frentes.

## 5. Tickets y criterios de aceptación

Todos los tickets parten pendientes. Las pruebas previas son evidencia de base, no cierre automático. Dependencias y verificación de cada ticket son obligatorias además del contrato de la sección 3.

### 0. Base, trazabilidad y aislamiento

Entradas de código/documentación: `docs/matriz-cumplimiento-sistema-2026-10-17.csv`, `drizzle/meta/_journal.json`, `tests/integration/setup.ts`. Elegir solo el subconjunto del ticket; descubrir el archivo exacto cuando sea una ubicación orientativa.

#### P0-01 — Fijar la base de ejecución

**Tipo/tamaño:** R / S. **Depende de:** —. **Verificación:** D.

**Entrega y aceptación:** Registrar HEAD, diff y archivos nuevos; identificar cambios de otras sesiones sin commit automático; comprobar aislamiento de .env.test sin registrar secretos.

#### P0-02 — Actualizar la matriz de 239 filas

**Tipo/tamaño:** R / S. **Depende de:** P0-01. **Verificación:** D.

**Entrega y aceptación:** Crear docs/matriz-cumplimiento-sistema-2026-11-11.csv con estado anterior/nuevo, delta, evidencia y límite; 239 IDs únicos; banca 17.12–17.14 deja de figurar ausente si se acredita su implementación, sin darla por aceptada.

#### P0-03 — Construir el mapa fila → tarea → evidencia

**Tipo/tamaño:** R / M. **Depende de:** P0-02. **Verificación:** D.

**Entrega y aceptación:** Cada ID de la matriz tiene tarea ejecutable o aceptación explícita; detectar huérfanas, referencias inexistentes y cierres sin evidencia mediante un validador reproducible.

#### P0-04 — Inventariar migraciones por entorno

**Tipo/tamaño:** R / M. **Depende de:** P0-01. **Verificación:** D,V2.

**Entrega y aceptación:** Manifiesto por tabla/política/privilegio/rol y migración aplicada o pendiente; incluir 0101, 0103–0108, 0123 y contabilidad posterior hasta el journal vigente; no inferir aplicación por archivo local.

#### SEC-00 — Comprobar el arnés de aislamiento

**Tipo/tamaño:** A / M. **Depende de:** P0-04. **Verificación:** V2.

**Entrega y aceptación:** Rol de prueba NOBYPASSRLS y dos empresas/dos sucursales; distinguir acceso de propietario y runtime; una prueba de escritura/lectura ajena falla sin alterar datos ajenos.

#### P0-05 — Coordinar los frentes bancario y contable

**Tipo/tamaño:** R / S. **Depende de:** P0-03. **Verificación:** D.

**Entrega y aceptación:** Registrar responsables/estado de FC-12 y circuito bancario, contratos compartidos y evidencias reutilizables; ninguna tarea duplica trabajo ni supone que un cambio local está desplegado.

**Puerta del frente:** todos los hijos requeridos aceptados, evidencia enlazada y filas afectadas actualizadas. Si un rastreo descubre trabajo ya completo, ejecutar aceptación y documentarlo; si descubre una brecha nueva, abrir hijo sin maquillar estados.

### 1. Corrección y recuperación del consumo de ventas

Entradas de código/documentación: `lib/services/sales-ingest-service.ts`, `lib/services/theoretical-consumption-service.ts`, `pruebas focalizadas de consumo`. Elegir solo el subconjunto del ticket; descubrir el archivo exacto cuando sea una ubicación orientativa.

#### INV-01.a — Definir identidad y revisión de venta consumida

**Tipo/tamaño:** I / P. **Depende de:** P0-03, SEC-00. **Verificación:** V1,V2.

**Entrega y aceptación:** Contrato por empresa/sucursal/fuente/producto/fecha y revisión; cantidad previa y consumo aplicado son reconstruibles; caracterizar datos existentes antes del backfill.

Descomposición de ejecución (2026-11-11), materializada en el mapa P0-03:

- **INV-01.a1**, I/M, V1: contrato puro y caracterización. `sale-consumption-contract.ts`, su prueba unitaria y ficha de contrato/datos. Hereda P0-03 y SEC-00. Identidad separada de receta, día civil, cantidades exactas y revisión previa explícita; sin backfill supuesto.
- **INV-01.a2**, I/M, V1,V2: persistencia append-only, cadena y aislamiento. Depende de INV-01.a1 además de las dependencias heredadas. Archivos de implementación: `lib/db/schema.ts`, migración generada 0137, journal, snapshot y `sale-consumption-identity-db.test.ts`. Evidencia y actualización documental son un incremento separado. Probar dos empresas/sucursales, grants runtime, antes reconstruible, inmutabilidad y rollback. No sustituye la aplicación de stock de INV-01.b.

El padre cierra con ambos hijos acreditados. La instalación en main se registra separadamente: aceptar V2 en la rama aislada no afirma despliegue operativo.

#### INV-01.b — Aplicar venta y diferencial de consumo atómicamente

**Tipo/tamaño:** I / P. **Depende de:** INV-01.a. **Verificación:** V1,V2.

**Entrega y aceptación:** 10→12 descuenta 2; 12→8 devuelve 4 según la asignación original; repetir no mueve stock; cambio de receta revierte/aplica con procedencia; insuficiencia deja toda la revisión sin aplicar.

Descomposición de ejecución para respetar el límite de archivos, materializada en el mapa:

- **INV-01.b1**, I/M, V1: planificador exacto del diferencial y su prueba (`sale-consumption-delta.ts`, `sale-consumption-delta.test.ts`). Depende de INV-01.a. Devolución limitada a asignación original, sin mutar el head; receta cambiada exige revertir/aplicar.
- **INV-01.b2a**, I/M, V1,V2: políticas de lectura por empresa y privilegios mínimos del catálogo usado por el snapshot. Depende de INV-01.a; preparación exigida por b2 tras comprobar catálogo real sin RLS/permisos. Scope previsto: schema raíz, SQL/migración generada, journal, snapshot y prueba SQL de permisos/aislamiento (cinco archivos). Tablas recipes, recipe_items, inventory_items, unit_conversions; lectura de columnas necesarias, sin DML; sin contexto no lee, empresa ajena no lee, dos sucursales propias comparten catálogo. Verificar compatibilidad de conexiones actuales antes de FORCE RLS. No sustituye seguridad de escrituras de SEC-05.inventario/recetas.
- **INV-01.b2**, I/M, V1,V2: snapshot de servidor, demanda racional y lectura acotada (`sale-consumption-snapshot.ts`, `sale-consumption-reader.ts`, sus pruebas unitaria e integración). Depende de INV-01.a e INV-01.b2a. Subrecetas, unidades/rendimiento, huella estable al roundtrip JSONB y datos congelados. V2 exige lector con rol runtime y alcance entre empresas; la prueba dueña de caracterización no lo sustituye. Los permisos/migración que se descubran se abren como hijo específico y dependencia, sin bajar esta puerta. Runtime de aplicación de stock corresponde además a b3 y SEC-05.inventario.
- **INV-01.b3a**, I/M, V1,V2: persistir ingreso nullable por revisión, RLS y privilegios mínimos de aplicación sobre inventory_batches, inventory_movements y sales_entries. Depende de INV-01.a y b2a. Archivos: schema raíz, SQL 0139 generado, journal, snapshot y `sale-consumption-application-schema-db.test.ts` (cinco). NULL identifica histórico sin evidencia monetaria; no backfill ni default cero. Runtime puede actualizar saldo de lotes propios, insertar movimientos propios y proyectar ventas propias; sin crear/borrar lotes, reescribir movimientos ni borrar ventas. Probar dos empresas/tres sucursales, denegaciones reales y rollback. Mantener compatibilidad dueña sin atribuir cierre de SEC-05.
- **INV-01.b3**, I/M, V1,V2: writer transaccional (`sale-consumption-service.ts` y pruebas focales de aplicación). Depende de INV-01.a, b1, b2 y b3a. Reservas/devoluciones y procedencia reales, venta agregada e ingreso y revisión en la misma transacción; insuficiencia revierte todo; reintento no mueve stock. Histórico sin consumo/ingreso demostrado o proyección discordante requiere recuperación explícita, nunca adopción silenciosa.
- **INV-01.b4a**, I/M, V1: normalización y agrupación exacta de importación. Depende de INV-01.a y b3. Archivos: `sale-consumption-contract.ts`, `sales-ingest-pure.ts`, `sales-ingest-plan.ts`, `sales-ingest-revisions.test.ts`. Cero para anular; fecha civil real; precisión/rango sin redondeo silencioso; clave de producto separada de receta; agrupar cantidades exactas; un grupo inválido no se aplica parcialmente. Ingreso ausente permanece null, no se inventa cero.
- **INV-01.b4b.rls**, I/M, V1,V2: preparación de catálogo para resolver nombre de receta bajo runtime; depende de INV-01.a y b2a. Scope: SQL custom generado 0141, journal, snapshot y prueba SQL compartida con b4b. Solo GRANT SELECT(name), manteniendo RLS, sin DML ni SELECT general. Prueba sin contexto, UUID/nombre ajenos, nombres ambiguos y escritura denegada. No aplicar a main ni acreditar despliegue.
- **INV-01.b4b**, I/M, V1,V2: conectar ingestión al writer y conservar importaciones de cantidad sin importe con ingreso no reportado. Depende de INV-01.a, b3, b4a y b4b.rls. Scope: servicio de ingestión, writer, sus pruebas unitarias/integración (cuatro archivos). Resolver receta bajo el mismo contexto runtime; no convertir NULL en cero canónico ni adoptar consumo previo no demostrado. La proyección legada conserva subtotal conocido y el resultado entrega cobertura por receta/día; propagar cobertura a API/UI y consumidores financieros sigue pendiente antes de aceptación visible. **Aceptado V1/V2 aisladas 2026-11-22:** dependencias aceptadas, 109 unitarias, cuatro ingestiones nativas con login/commits, lint y build final correctos; [criterios y límites](../tasks/evidencia/2026-11-22/INV-01.b4b/accepted.md). No cierra padres ni fila 11.11.
- **INV-01.b4**, I/M, V1,V2: conectar captura manual y fronteras bulk/smart-link al writer único, con errores y pruebas de alcance. Depende de INV-01.a, b3 y b4b. Archivos concretos se fijan al abrir cada frontera, subdividiendo si excede cinco. No mantener segundo camino de venta/consumo separados. La aceptación visible API/UI sigue en INV-01.d.
  - **INV-01.b4.manual**, I/M, V1,V2; depende de INV-01.a, b3 y b4b: ruta manual, servicio de ingestión y sus pruebas HTTP/SQL (cuatro archivos). Total por receta/día bajo fuente `manual:recipe`; precisión exacta, cero de anulación, ingreso ausente NULL. Savepoint de lote completo y rollback incluso si el llamador captura el error. Sesión/capacidad/alcance antes de escribir; catálogo propio en runtime. Sin adopción de ventas históricas.
  - **INV-01.b4.manual.ui**, I/M, V1,V3; depende de INV-01.a, b4.manual y b4.ui: página de reportes, componente manual, harness/spec de feedback y suite Next existente (cinco archivos de código). Pesos sin conversión duplicada, NULL distinto de cero, día civil editable, feedback visible, envío único y contexto de sucursal. Consolidar el CSV duplicado con enlace al importador y guía para no reimportar ventas ya registradas. Navegador controlado acredita contrato de UI; Next con rol sin manage acredita denegaciones/sesión sin crear hechos append-only. Guardado/corrección/anulación exitosos desde Next con runtime independiente siguen siendo puerta de aceptación integrada, junto con dependencias. Plan/mapa/matriz/checklist/evidencia se actualizan en incremento documental separado.
  - **INV-01.b4.bulk**, I/M, V1,V2; depende de INV-01.a, b3 y b4b: ruta bulk y prueba HTTP (dos archivos). Rol ausente no eleva a ADMIN; conserva columna productKey y fuente `pos:import`. Resultados distinguen inserted/updated/skipped y cobertura incompleta cuando el parser descarta grupos. Aislamiento de persistencia reutiliza b4b; recorrido HTTP real pendiente en INV-01.d.
  - **INV-01.b4.smartlink**, I/M, V1,V2; depende de INV-01.a, b3 y b4b: ruta upload-pos y prueba HTTP (dos archivos). Permiso y sucursal/empresa de sesión antes de ingerir o enlazar; cortes filtrados por empresa/sucursal/día civil. Mapeo explícito prevalece; misma fuente `pos:import` que bulk y cobertura/errores completos. JSON solo enlaza evidencia, no inventa ventas. Conserva advertencia si el archivo no genera ventas; almacenamiento durable y aceptación real del cierre siguen fuera de este incremento.
  - **INV-01.b4.ui**, I/M, V1,V3; depende de INV-01.a y b4.bulk: cliente de importación, harness de navegador, spec y config Playwright (cuatro archivos). Distinguir nuevas/corregidas/sin cambios sin afirmar otro descuento de stock por repetición; ingreso incompleto/desconocido visible; errores de API 400 y grupos inválidos conservados; mapeo de SKU estable y encabezados CSV con comillas; controles bloqueados durante envío; invalidar resultado al cambiar entradas. Escritorio/móvil y teclado con respuestas HTTP sintéticas no sustituyen aceptación integrada de INV-01.d.

Aceptación Next sobre copia 2026-11-22: **manual.next y ui.next aceptados V2/V3**, 4/4 seleccionados, exit 0, 217.51 s. Copia del origen aislado con RLS/triggers conservados, writer LOGIN mínimo, oráculos después de commit y base/rol/servidores retirados. Sin cambios de aplicación desde el build aprobado; sin intervenir origen ni desplegar. **33 registros aceptados**; POS/storage/cobertura/recovery y padres/fila 11.11 siguen pendientes. [Evidencia](../tasks/evidencia/2026-11-22/INV-01.b4.next-copy/README.md).

**Checkpoint manual/CSV 2026-11-22:** runtime.config/manual/bulk aceptados V1/V2 y ui/manual.ui V1/V3, en orden de dependencias. 28 focales, 17 controladas, 4/4 Next seleccionados, lint y build con tipos/455 páginas exit 0; guardia SSR del primer archivo corregida y comprobada. [Criterios y límites](../tasks/evidencia/2026-11-22/INV-01.b4.manual-csv-next/accepted.md). 31 registros aceptados; manual.next/ui.next conservan pendiente la copia de base existente, sin aceptar padres ni fila.

[Registro y límites](../tasks/evidencia/2026-11-11/INV-01.b/README.md). El padre no se acepta hasta acreditar todos los hijos; ninguna fila se acepta por el planificador o el snapshot aislados.

Continuación V2 2026-11-19 de b4b/manual (un archivo de prueba): `sales-ingest-runtime-connection-db.test.ts` ejecuta ambos orígenes con login PostgreSQL independiente, rol efímero NOBYPASSRLS y grants mínimos declarados de 0137/0138/0139/0141. Catálogos sintéticos confirmados/eliminados; writer en rollback SERIALIZABLE, sin SET ROLE, cambios del rol compartido o migraciones aplicadas. Verifica corrección/repetición/ingreso/cero, aislamiento y cuatro DML denegados, más limpieza de rol/grants/datos. **4/4, exit 0**. [Evidencia y límites](../tasks/evidencia/2026-11-19/INV-01.b4.runtime.connection/README.md). No sustituye el recorrido Next ni la configuración runtime de la aplicación o acepta dependencias.

**INV-01.b4.runtime.config**, I/M, V1/V2; depende de INV-01.a, b3 y b4b, requerido por b4 y la fila 11.11. Scope: módulo `sales-runtime.ts`, servicio de ingestión, prueba unitaria de selección y prueba real de login independiente (cuatro archivos). Activación explícita `SALES_RUNTIME_DATABASE_URL` para el writer, endpoint/base comunes y login distinto; ausente conserva transición, configuración inválida nunca usa dueño. Verificar rol sin bypass, superuser, CREATEROLE/CREATEDB, membresías o propiedad, y RLS en nueve tablas antes del callback; pool por intento/cierre y serializable/reintentos conservados. Integración con rol efímero/grants mínimos en rollback, sin alterar secretos ni permisos compartidos. Incremento bulk separado (ruta, unitaria y HTTP existente) preserva 503 controlado y prueba rechazo de URI dueña con sesión real, sin consumo. [Runbook](../docs/sales-writer-runtime.md) y [evidencia](../tasks/evidencia/2026-11-19/INV-01.b4.runtime.config/README.md). Guardado exitoso Next y despliegue siguen en aceptación integrada.

**INV-01.b4.manual.next**, A/M, V2/V3; depende de INV-01.a, b3, b4b, runtime.config y manual.ui. Tres archivos: base desechable, servidor Next y suite de navegador. Copiar solo la base aislada conservando RLS/triggers, runtime efímero con grants declarados, Next de producción y Better Auth reales. Rechazar dueño configurado como runtime sin efectos y recorrer desde formulario 10→12→8, repetir, completar ingreso y cero; oráculos SQL independientes, feedback visible y sin errores, limpieza de servidor/base/rol verificada. No desactivar inmutabilidad ni confirmar hechos en el origen para limpiar fixtures. El defecto de varianza NULL descubierto se corrige en dos archivos de manual.ui con RED/GREEN, sin inventar conteos/cero. [Evidencia](../tasks/evidencia/2026-11-19/INV-01.b4.manual.next/README.md). Requerido por b4 y fila 11.11; sin aceptación por el arnés inicial.

**INV-01.b4.ui.next**, A/M, V2/V3; depende de INV-01.a, b3, b4b, runtime.config y b4.ui. Scope de dos archivos: helper de escenario CSV y suite Next/runtime existente; reutiliza base desechable/servidor sin cambiar sus contratos. Tenant independiente del caso manual, login real, CSV con encabezados/recetas entrecomillados, SKU distinto de receta y nombres de archivo cambiantes. Comprobar alta, 10→12→8, repetición, ingreso NULL→8025 sin mover stock, errores de grupos sin aplicar subtotales, grupos válidos independientes, cierre/reapertura de sesión y cero que devuelve saldo; feedback, móvil/teclado y limpieza. Sin mocks de API/auth/SQL ni hechos en el origen. Si el recorrido descubre errores de producto, fijar un incremento separado de hasta cinco archivos con RED/GREEN. [Evidencia](../tasks/evidencia/2026-11-19/INV-01.b4.ui.next/README.md). Requerido por b4 y fila 11.11; no acepta cierre POS, dependencias o despliegue.

**INV-01.b4.smartlink.next**, A/M, V2; depende de INV-01.a, b3, b4b, runtime.config, smartlink y storage. Dos archivos: helper POS y suite Next/runtime existente; reutiliza catálogo sintético, base/rol desechables y servidor sin cambiar contratos. HTTP Next real con sesión, R2 y writer independiente: SKU compartido con bulk, 10→12→8, repetición/renombre, ingreso sin stock, insuficiencia con evidencia/advertencia y cero; JSON enlaza sin ingerir. Verificar bytes/key/lectura autorizada y eliminar solo objetos del prefijo sintético, base/rol/proceso. Flag adicional opt-in para R2. No acredita pantalla de cierre ni RLS del almacenamiento (auth/enlace siguen con dueño). Fijar incremento de producto separado si falla. [Evidencia](../tasks/evidencia/2026-11-21/INV-01.b4.smartlink.next/README.md). Requerido por b4/fila 11.11, sin aceptación del padre.

**INV-01.b4.smartlink.ui**, I/M, V1/V3; depende de INV-01.a, b3, b4b, b4.smartlink, smartlink.next y storage. Primer incremento de cinco archivos: componente POS compartido, WorkflowStepper, harness de ventas, spec y config de navegador. Reconocer config.posUpload o target legacy exacto; sucursal de ejecución fija, día civil explícito, mapping CSV/SKU y envío multipart único. Mostrar durabilidad, enlace, altas/correcciones/repeticiones, cobertura y errores sin confundir evidencia con ventas. Invalidar respuesta/evidencia al editar, impedir avanzar mientras haya archivo pendiente, sesión/permiso/red recuperables y móvil/teclado. Preview sin escrituras. Sin ampliar auth a tokens: la ruta conserva sesión/capacidad/tenant. RED/GREEN de UI controlada, tipos/lint/build; Next real y segundo executor se fijan como incremento posterior antes de aceptación. [Evidencia](../tasks/evidencia/2026-11-21/INV-01.b4.smartlink.ui/README.md). Requerido por b4/fila 11.11; sin aceptación integrada por pruebas sintéticas.

Incremento Next de smartlink.ui (dos archivos, después de `0105111`): helper de fixture workflow/step y helper POS existente. Mantener las cinco pruebas de la suite, sustituyendo sus seis cargas POS HTTP directas por input/mapping/botón del stepper real; bulk conserva su llamada para probar identidad compartida. Confirmar hidratación por fecha de cliente, resultados/errores/cobertura visibles, stock/revisiones/R2 ya existentes, y Siguiente persiste key/resumen sin ingerir otra vez. No completar último paso ni disparar acciones externas. Copia/base/rol/objetos sintéticos retirados, sin mocks ni build redundante al cambiar solo pruebas. Evidencia en el mismo hijo; segundo executor/configuración instalada siguen abiertos.

Continuación del segundo ejecutor (base `7a2c5e6`): `WorkflowExecutor`, harness, spec y configuración de navegador (cuatro archivos). Compartir captura POS, restaurar JSONB/key, impedir navegación/omisión con archivo pendiente y mostrar fallo recuperable del PATCH sin reingestión. Incremento de plantilla (dos archivos): JSON del cierre y prueba de normalización/serialización; `config.posUpload` explícito, sin prometer email automático. Incremento Next (dos archivos): helper POS y suite existente con caso alternativo real, conservando stock/R2/limpieza y sin completar el workflow sintético. Estos incrementos pertenecen al hijo ya abierto; configuración de copias históricas y recorrido instalado desde librería requieren evidencia propia. [Evidencia del segundo ejecutor](../tasks/evidencia/2026-11-21/INV-01.b4.smartlink.ui/alternate-executor.md).

Verificación instalada de esa continuación (dos archivos de pruebas): helper `pos-template-runtime-scenario.ts` y suite Next existente. Clonar el cierre desde Catálogo Pulso con sesión real, guardar edición desde el editor, recargar y demostrar por SQL que solo el paso POS conserva el flag y que no se generaron ventas/movimientos. No lanzar acciones del cierre; copia/rol/servidor retirados por el arnés. Es aceptación técnica de instalación/edición, no reparación de copias históricas ni despliegue.

Correcciones descubiertas en esa aceptación: Ctrl+S enviaba el título anterior aun con el input actualizado; hacer que teclado/autosave usen id/título/pasos vigentes en `editor-client.tsx`, con el caso real existente como regresión. La captura Next móvil mostró botones fuera de la tarjeta: comprobar 358 px y límites de tarjeta en la spec del executor, permitir envolver el grupo de acciones. Ambos incrementos requieren build final y repetición real sobre el nuevo artefacto; no usar el build previo como prueba de las correcciones.

Verificación de esa continuación (2026-11-22): build final con tipos/455 páginas exit 0; 2/2 casos reales del executor alternativo e instalación/edición, con SQL/R2 y retiro de recursos comprobados. El arnés carga dependencias de aplicación después de crear el clon y fija/restaura DATABASE_URL del host al clon. Control de provisión opt-in en `sales-runtime-provisioning.test.ts`; sin nuevas migraciones. Resultado técnico V1/V3 del hijo, sin aceptación de dependencias/padres ni despliegue. Las copias históricas que perdieron el flag siguen requiriendo caracterización y tratamiento explícitos.

Checkpoint POS 2026-11-22: **smartlink aceptado V1/V2; 34 registros**. 3/3 Next/Chromium/Better Auth/Neon/R2 actuales sobre copia y 56 unitarias POS; dos executors/instalación y limpieza verificados. 4/4 servicios de archivo SQL con LOGIN independiente sin SET ROLE, candidata 0155 en base nueva y commit/aislamiento/limpieza; storage conserva pendiente seleccionar ese runtime en las rutas y repetir Next. Sin cambios de aplicación, migración operativa ni despliegue. [Evidencia](../tasks/evidencia/2026-11-22/INV-01.b4.pos-current/README.md). La continuación de storage se limita primero a selector de conexión/servicio y sus pruebas; Next queda en un incremento de aceptación posterior.

Checkpoint POS/Storage 2026-11-22: **storage, smartlink.next y smartlink.ui aceptados V1/V2/V3 en entorno aislado; 37 registros aceptados**. `lib/db/pos-file-runtime.ts` conecta `POS_FILES_RUNTIME_DATABASE_URL` a `readPosCutFileRecord`/`linkPosCutFileRecord` sin fallback al dueño; **47/47** unitarias, **6/6** SQL de selección runtime, build final (`BUILD_ID: 3uHsQamaXwpx8-UdKZkBZ`) y **4/4** Next/Chromium/Better Auth/Neon/R2 reales sobre copia con ambos runtimes en LOGIN mínimo y rechazo 503 de URI dueña sin efectos. Limpieza DB/rol/R2/servidores verificada; sin migración en operativo/main, backfill legacy, aceptación de padres (`INV-01.b4`/`INV-01.b`/`INV-01.d`) ni fila `11.11`. [Aceptación y límites](../tasks/evidencia/2026-11-22/INV-01.b4.storage/accepted.md).

Hijos adicionales de consolidación (2026-11-16), sin aceptación: **INV-01.b4.storage** (I/M, V1/V2/V3; depende de INV-01.a y b4.smartlink), almacenamiento privado durable y acceso autorizado del POS; **INV-01.b4.coverage** (I/P, V1/V2/V3; depende de INV-01.a, b4b y sus tres hijos), propagación de ingreso no reportado a lectores financieros. El padre b no cierra sin ellos.

Descomposición de cobertura (2026-11-16), sin nuevas aceptaciones. El coordinador coverage es padre independiente; INV-01.b4 depende de su cierre en el mapa para que INV-01.b no se acepte sin cobertura. La fila 11.11 y su aceptación dependen de los tres hijos ejecutables.
- **INV-01.b4.coverage.cogs** (I/M; depende de INV-01.a y b4b; V1/V2/V3). Cinco archivos de código: `sale-revenue-coverage.ts`, `inventory-reports-service.ts`, ruta `inventory/reports/cogs`, cliente `operational-reports-client.tsx` y `cogs-revenue-coverage.test.ts`. Leer heads vigentes antes de filtrar receta; distinguir vacío, parcial y completo; subtotal reportado separado del total nullable y porcentaje sin denominador; conservar cero explícito. Ejecutar consulta y catálogos bajo contexto transaccional de empresa/sucursal, rechazar sucursal ajena y mostrar el faltante en pantalla sin semáforo verde. Casos: remapeo, varias fuentes, revisiones, proyección incoherente y empresa/sucursal/día ajenos. PGlite y HTTP/navegador sintéticos no sustituyen V2 runtime ni sesión real. Continuación runtime en dos incrementos de tres archivos: consulta/lector/prueba real y migración custom 0154/snapshot/journal. Referencias SQL correlacionadas conservan calificación en el SELECT de Drizzle, líneas usan selección explícita y costos tienen SELECT por columna bajo RLS. Tres casos Neon con SET LOCAL ROLE y rollback; sin migración persistente. Continuación de cuatro archivos: ruta COGS, focal existente, prueba de fronteras y prueba HTTP/sesión. Conserva 401/403, valida UUID/fechas/orden y oculta diagnósticos inesperados. Dos recorridos HTTP loopback con Better Auth real y fixtures rollback; almacén de Next y frontera DB suministrados por el arnés, sin servidor Next completo ni navegador. Ver [sesión/HTTP](../tasks/evidencia/2026-11-16/INV-01.b4.coverage.cogs/session-http.md). Continuación de un archivo de prueba: Next dev y Chromium completos, Better Auth y DB reales sin mocks, fixtures confirmados/eliminados en base aislada; 1/1 recorrido parcial/vacío, fronteras de empresa y cierre de sesión. Conexión dueña, sin migración persistente ni nueva aceptación. Ver [Next/navegador](../tasks/evidencia/2026-11-16/INV-01.b4.coverage.cogs/next-browser.md). Ver [evidencia runtime](../tasks/evidencia/2026-11-16/INV-01.b4.coverage.cogs/runtime.md).
- **INV-01.b4.coverage.executive** (I/M; depende de coverage.cogs; V1/V2/V3). Fijar archivos al abrir: entradas `executive-report-service.ts` y `executive-dashboard.tsx`; propagar cobertura por sucursal y consolidado, sin porcentajes calculados contra subtotales.
- **INV-01.b4.coverage.menu** (I/M; depende de coverage.cogs; V1/V2/V3). Fijar archivos al abrir: ruta `inventory/menu-engineering` y `menu-engineering-matrix.tsx`; ingreso/rentabilidad por receta con cobertura explícita, sin clasificar como rentabilidad medida una cifra incompleta.

Continuación 2026-11-18: **INV-01.b4.coverage.menu.rls** (I/M; depende de INV-01.b2a y INV-01.b4b.rls; V2) prepara el SELECT de `recipes.calculated_cost` sin lectura general ni DML. Archivos: SQL 0156 custom generado, journal, snapshot y `menu-revenue-coverage-db.test.ts` (cuatro). DDL/fixtures solo en rollback aislado; comprobar dos empresas, tres sucursales y denegaciones reales. El lector menú depende de este hijo y usa contexto transaccional y alcance de sucursal. Incremento de ruta/prueba unitaria separado del incremento SQL; [evidencia](../tasks/evidencia/2026-11-18/INV-01.b4.coverage.menu/README.md). Sin aceptación ni aplicación operativa.

Continuación ejecutiva 2026-11-18: servicio y `executive-revenue-coverage-db.test.ts` (dos archivos) comparten una transacción de empresa/sucursal para todos los KPIs y seleccionan solo columnas usadas. Preparación separada en **INV-01.b4.coverage.executive.catalog.rls** (I/M, V2; depende de INV-01.b2a y coverage.cogs): SQL 0157 custom, journal, snapshot y prueba (cuatro), SELECT mínimo de `inventory_items.min_level/active`; y **INV-01.b4.coverage.executive.sources.rls** (I/M, V2; depende de SEC-00 y catalog.rls): schema raíz, SQL 0158 generado, journal, snapshot y la prueba (cinco). Esta última habilita RLS SELECT de merma y plantillas/conteos; permite solo datos de conteos de inventario de sucursales propias, catálogo de plantillas propias/globales y campos mínimos de merma. Sin FORCE ni DML runtime: los escritores dueños mantienen compatibilidad; antes de OPS-03 inventariar cualquier consumidor runtime previo y aceptar sus escrituras mediante SEC-05. Se prueban ausencia de contexto, dos empresas/tres sucursales, workflow ajeno al inventario oculto, costos/merma/conteo con oráculos, cero/null de revisión vigente, rollback y privilegios. El lector ejecutivo depende de ambos hijos; no se acepta por pruebas aisladas ni se aplican estos SQL de forma persistente.

Continuación de navegador de ejecutivo/menú, cinco archivos: ambos componentes, `BranchScopeControl`, arnés `cogs-next-browser.test.ts` y `next.config.ts`. Nombres accesibles, controles bloqueados en carga, catálogo de sucursales estable al filtrar, período aplicado separado del borrador, errores que retiran datos previos y recuperación, header móvil sin overflow. `PULSO_REPORT_BROWSER_TEST=1` aísla salida y tsconfig bajo `.tmp`; Next conserva su bloqueo nativo y no se elimina el de otra instancia. Fixtures sintéticos confirmados/eliminados en base aislada; la conexión dueña de Next no acredita la conexión runtime independiente. [Evidencia y límites](../tasks/evidencia/2026-11-18/INV-01.b4.coverage.executive/next-browser.md). Sin nuevas aceptaciones.

Checkpoint Cobertura / `INV-01.b` 2026-11-22: **COGS, menú, ejecutivo, sus 3 RLS, `INV-01.b4.coverage`, `INV-01.b4` y padre `INV-01.b` aceptados en entorno aislado; 46 registros aceptados**. **50/50** unitarias, ESLint limpio, **16/16** SQL runtime (`0154`/`0156`/`0157`/`0158` en rollback bajo `pulso_app`) + HTTP Better Auth y **4/4** navegador Next producción (`BUILD_ID: 3uHsQamaXwpx8-UdKZkBZ`) con limpieza verificada. Sin despliegue operativo; `INV-01.c`, `INV-01.d` y la fila `11.11` permanecen abiertos. [Aceptación y límites](../tasks/evidencia/2026-11-22/INV-01.b4.coverage/accepted.md).

Checkpoint `INV-01.c` servicios y concurrencia 2026-11-22: **`races` y 13 hijos de servicios de recuperación (`contract` → `apply`, incluido R2 privado real en `objects`) aceptados en entorno aislado; 60 registros aceptados**. **97/97** unitarias (14 archivos), **13/13** suites SQL Neon (`pulso_app` NOBYPASSRLS, 65 casos), **1/1** R2 privado real (`sale-recovery-objects-r2-db.test.ts`), **4/4** Playwright controlado y ESLint limpio. Siguen abiertos `INV-01.c.recovery.ui-routes`, `INV-01.c.recovery`, `INV-01.c`, `INV-01.d` y la fila `11.11`. [Aceptación y límites](../tasks/evidencia/2026-11-22/INV-01.c.recovery-services/accepted.md).

Checkpoint `INV-01.c` cierre completo 2026-11-22: **`INV-01.c.recovery.ui-routes`, `INV-01.c.recovery` y padre `INV-01.c` aceptados en entorno aislado; 63 registros aceptados**. Recorrido integrado real (`sale-recovery-next-browser.test.ts`) **1/1** (`exit 0`, 66.22 s) sobre Next producción (`BUILD_ID: 3uHsQamaXwpx8-UdKZkBZ`), Chromium, Better Auth, Neon desechable baseline `0158` y R2 privado real con segregación de funciones, `AUD-02`, oráculos SQL, reintento idempotente, `sign-out` `401` y limpieza verificada. Destraba `INV-01.d` e `INV-02.*`; fila `11.11` sigue abierta hasta aceptar `INV-01.d`. [Aceptación y límites](../tasks/evidencia/2026-11-22/INV-01.c.recovery.ui-routes/accepted.md).

#### INV-01.c — Recuperar fallos y carreras

**Tipo/tamaño:** I / P. **Depende de:** INV-01.b. **Verificación:** V2.

**Entrega y aceptación:** Fallo entre venta y consumo revierte ambos; dos revisiones concurrentes no duplican movimientos; una venta antigua sin consumo se detecta y repara solo con evidencia suficiente.

Descomposición de aceptación al continuar 2026-11-13:
- **INV-01.c.races**, A/M, V2; depende de INV-01.b. Un archivo `tests/integration/sale-consumption-concurrency-db.test.ts`: dos conexiones runtime NOBYPASSRLS, snapshots simultáneos, commits y reintentos del writer real. Alta idéntica, correcciones con expectedRevision, productos con proyección compartida, días con lote compartido y doble intento de adopción histórica sin prueba. Fixtures confirmadas append-only identificadas por runId en rama aislada, con manifiesto de hechos conservados. Complementa rollback por fallo de b3/b4; no implementa reparación histórica.
- **INV-01.c.recovery**, I/M, V2; depende de INV-01.b, INV-01.c.races y todos los hijos de recuperación materializados en el mapa, incluidos decision.service, apply y ui-routes. Estado consolidado 2026-11-16: contrato, objetos, modelos, sujetos, atestaciones, fuentes, receta histórica, propuesta, decisión y aplicación auditada implementados; aceptación de dependencias, sesión/R2/HTTP/navegador y carreras con commits independientes pendientes. La repetición V2 de servicios no acredita almacenamiento real ni cierre operativo. Fijar archivos/casos del siguiente incremento y subdividir si excede cinco. [Contrato de evidencia y revisión](../tasks/evidencia/2026-11-11/INV-01.c.races/recovery-contract.md). No aceptar INV-01.c ni INV-01.b por las pruebas de bloqueo.
- **INV-01.c.recovery.contract**, I/M, V1; hijo directo de INV-01.c para mantener el mapa de ejecutables, depende de INV-01.b e INV-01.c.races. Archivos: `sale-recovery-review.ts` y su test. Preparar propuesta sin efectos con identidad/estado/receta congelados, tres finalidades de evidencia durable, hashes estables y revisión independiente ligada al estado. Rechazar consumo previo/ambiguo, head existente, prueba retirada y aprobación obsoleta. Este contrato solo cubre la preparación para venta legada sin consumo demostrado como no aplicado; persistencia, lector de pruebas verificadas, aprobación registrada y aplicación de stock siguen en recovery, que depende de este hijo. Los DTOs válidos no acreditan existencia del objeto ni autorización de ejecución.

- **INV-01.c.recovery.objects**, I/M, V1,V2; hijo de INV-01.c, depende de recovery.contract y requerido por recovery. Scope: `lib/services/sale-recovery-evidence.ts`, `lib/storage/r2-client.ts` y dos pruebas `sale-recovery-evidence.test.ts`/`sale-recovery-storage.test.ts` (cuatro archivos). Descargar claves privadas de empresa sin URLs ni fallback, comprobar SHA-256 de bytes, límite de 20 MiB por objeto y timeout de 15 segundos. Rechazar lote vacío/duplicado, claves ajenas, objetos ausentes/alterados y errores de proveedor. V1 con SDK simulado; V2 con objetos privados reales pendiente. No acredita veracidad documental, origen DB, sesión, aprobación ni reparación; persistencia y aplicación siguen pendientes.

- **INV-01.c.recovery.persistence**, I/M, V1,V2; hijo de INV-01.c, depende de INV-01.b, recovery.contract y recovery.objects; requerido por recovery. Scope de cinco archivos: schema raíz, migración SQL 0143 generada, snapshot, journal y prueba SQL de integración. Expediente inmutable con identidad/venta/JSON y hashes, idempotencia por empresa; decisión única ligada por FK a scope, hashes y solicitante, sin autoaprobación. RLS con mínimo SELECT/INSERT runtime, sin UPDATE/DELETE y triggers append-only incluso para dueño ordinario. Validar dos empresas/tres sucursales, referencias laterales, duplicados, alteración, rechazo y timeline. Migración y fixtures solo dentro de rollback aislado; no aplicar a main. No acredita rol real de aprobador ni descarga verificada, no expone rutas ni aplica stock; siguiente servicio debe obtener sesión/rol/evidencia desde servidor.

- **INV-01.c.recovery.subject.schema**, I/M, V1,V2; hijo de INV-01.c, depende de INV-01.b, SEC-00 y recovery.contract; requerido por recovery. Scope de cinco archivos: schema/evidence.ts, SQL 0144, snapshot, journal y prueba SQL. Añadir SALE_RECOVERY al enum canónico conservando ocho sujetos legacy. DDL aditivo e idempotente, sin grants, políticas ni DML de ventas/stock. Verificar etiqueta/schema y conversión/registro real bajo runtime en rama aislada. La adición de enum debe hacer commit antes de usar el valor en PostgreSQL; autorizar únicamente este ALTER TYPE aislado tras comprobar host distinto de .env, sin ejecutar migraciones previas pendientes ni escribir journal Drizzle ficticio. Fixtures posteriores con rollback. Segundo incremento pendiente: facade/guardia por venta, empresa y sucursal con fallo antes de storage; luego autoridad de sesión, atestaciones, registro de expediente y aplicación. No habilitar carga/reparación ni aceptar EVI-02.a (INVOICE/PAYMENT/EXCEPTION) con este catálogo.

- **INV-01.c.recovery.subject.access**, I/M, V1,V2; hijo de INV-01.c, depende de INV-01.b, SEC-00 y recovery.subject.schema; requerido por recovery. Cinco archivos: servicio específico sale-recovery-attachments.ts, ruta recovery-evidence/route.ts, test unitario de servicio, test SQL y test de ruta. Fachada del dominio que obtiene requireAuth del servidor y exige inventory:manage; gerente solo en su sucursal, empresa desde sesión y vínculo real de venta/sucursal antes de storage. POST multipart con bytes acotados y R2 obligatorio, GET de URL privada con TTL, DELETE lógico; no URL de cliente ni GENERAL. No ampliar store genérico legacy para eludir guardias. Rechazar rol ausente, campos de autoridad, otra empresa/sucursal/entidad y adjunto retirado antes de R2; probar actor/clave, rollback de SQL, fallo storage, persistencia independiente del módulo y contratos HTTP. R2 simulado en V1/V2 SQL no acredita objetos reales ni HTTP integrado. Sin cambios de auth, roles, grants, migraciones o stock. La carga no verifica propósito, veracidad ni autoriza reparación; atestaciones, expediente/decisión y writer siguen pendientes.

- **INV-01.c.recovery.attestation.schema**, I/M, V1,V2; hijo de INV-01.c, depende de INV-01.b, SEC-00 y recovery.subject.schema/access; requerido por recovery. Cinco archivos: schema raíz, SQL 0145, snapshot, journal y prueba SQL. Atestación append-only ligada a evidencia SALE_RECOVERY viva de la misma venta/empresa/sucursal, key exacta, updatedAt observado sin pérdida de microsegundos, hash/tamaño de bytes y finalidad (SALE/RECIPE_VERSION/NO_PRIOR_CONSUMPTION), referencia/motivo y verificador/rol/fecha; clave idempotente por empresa. RLS forzada y actor ligado al contexto; mínimos SELECT/INSERT, sin UPDATE/DELETE/TRUNCATE. Verificador con FK a usuario; rol declarado restringido, pero la autoridad real y veracidad se obtendrán/validarán en el servicio, no se dan por probadas por el DTO o DB. DDL y fixtures solo dentro de rollback aislado, sin aplicación a main. Bloquear adjunto retirado/lateral/GENERAL/estado cambiado, falta de actor, duplicados y reescritura. Siguiente incremento: servicio con sesión administrativa, lectura acotada y SHA-256 real de R2, idempotencia y rutas; después expediente/aprobación/aplicación y snapshot histórico demostrado. La finalidad no convierte una consulta vacía en prueba de consumo cero.

- **INV-01.c.recovery.attestation.service**, I/M, V1,V2; hijo de INV-01.c; depende de INV-01.b, SEC-00, recovery.attestation.schema y recovery.subject.access; requerido por recovery. Cinco archivos: sale-recovery-attestations.ts, ruta recovery-attestations/route.ts y pruebas unitarias de servicio/ruta y SQL. Preview administrativo con digest y URL privada; POST exige venta y hash esperados, finalidad, referencia/motivo y clave idempotente. Sesión ADMIN/OWNER/SUPER_ADMIN + inventory:manage, empresa/actor/rol desde servidor, sujeto vivo propio antes de R2. Leer bytes con límites existentes 20 MiB/15 s, calcular SHA-256 y contrastar hash esperado; INSERT SELECT nativo conserva microsegundos y datos fuente, no guarda un hash de cliente sin comprobarlo. Idempotencia repite hecho original o devuelve conflicto ante cambios de autor, cuerpo, objeto o estado. No aceptar flags de verificación, rol, snapshot o empresa del cuerpo. GET/POST HTTP acotados, URLs privadas sin caché. SQL real con auth/R2 simulados no acredita V2 integrada completa; registrar límites. Certifica lectura de bytes y revisión documental por actor, no verdad semántica, receta histórica ni consumo cero; expediente/aprobación/aplicación y auditoría crítica siguen pendientes.

- **INV-01.c.recovery.historical**, I/M, V1,V2; hijo de INV-01.c; depende de INV-01.b, SEC-00 y recovery.attestation.service; requerido por recovery. Cuatro archivos: codec sale-recovery-historical-recipe.ts, servicio sale-recovery-historical.ts, prueba unitaria y SQL. Cargar atestación RECIPE_VERSION viva de venta/empresa/sucursal desde DB, comprobar versión nativa y key, descargar bytes acotados y comparar hash/tamaño. JSON histórico explícito con sujeto, día declarado, procedencia y ventana inclusiva de vigencia; reconstruir árbol/subrecetas/unidades/conversiones con buildSaleRecipeSnapshot usando solo documento, sin reader mutable ni snapshot del cliente. Rechazar definiciones laterales, duplicadas, incompletas, sobrantes, cíclicas, alteradas o sin vigencia. Autoridad administrativa de sesión antes de DB/R2. Sin migración/DML/stock. Día/vigencia son declaración documental revisada, requieren concordar con fuente SALE en expediente posterior; no interpretar sale_date como día operativo ni declarar verdad histórica automática. SQL/RLS real con auth/R2 simulados, aceptación integrada pendiente.

- **INV-01.c.recovery.provenance**, I/M, V1,V2; hijo de INV-01.c; depende de INV-01.b, recovery.contract, recovery.attestation.service y recovery.historical; requerido por recovery. Tres archivos: sale-recovery-review.ts, su test y SQL sale-recovery-review-precision-db.test.ts. Corregir pérdida de microsegundos en huella y timeline, fechas canónicas UTC de seis dígitos y rechazo de precisión superior a PostgreSQL. Contrato schemaVersion 2 exige attestationId, evidenceUpdatedAt nativo, byteLength, fuente/motivo y rol capturados del servidor, key exacta por venta/evidencia. La versión/atestación entran en las huellas. Rechazar duplicados, cronología obsoleta y DTO anterior incompleto sin migrarlo por inferencia. JSONB/fechas nativas reales aislados para prueba de roundtrip, sin DDL/DML persistente. No convierte DTO en autoridad: lector de fuentes, registro transaccional y aplicación siguen pendientes. No aplicar migración ni reescribir propuestas históricas.

- **INV-01.c.recovery.sources**, I/M, V1,V2; hijo de INV-01.c; depende de INV-01.b, SEC-00, recovery.attestation.service y recovery.provenance; requerido por recovery. Cinco archivos: codec sale-recovery-source-documents.ts, lector sale-recovery-sources.ts, dos unitarias y SQL sale-recovery-sources-db.test.ts. Leer documentos JSON versionados SALE/NO_PRIOR_CONSUMPTION desde atestación viva y bytes privados contrastados con hash/tamaño, límite 2 MiB/15 s, sesión administrativa y alcance antes de storage. Declaración exacta de sujeto/receta/fuente/producto/día/cantidad e ingreso nullable; fundamento documental obligatorio de no aplicación con sistema/referencia/explicación. No deducir consumo cero de una consulta vacía ni convertir ingreso desconocido en cero. Contrastar receta/cantidad legadas y devolver metadatos nativos con seis decimales UTC. Sin DML ni ruta pública; SQL runtime real con auth/R2 simulados y rollback aislado. La verdad documental, contraste conjunto de las tres fuentes, expediente/decisión/aplicación y aceptación integrada permanecen pendientes.

- **INV-01.c.recovery.proposal.service**, I/M, V1,V2; hijo de INV-01.c; depende de INV-01.b, SEC-00, recovery.persistence, recovery.sources, recovery.historical y recovery.provenance; requerido por recovery. Cuatro archivos: sale-recovery-proposals.ts, extracción interna transaccional en sale-recovery-sources.ts, unitaria del servicio y SQL sale-recovery-proposals-db.test.ts. Solo refs de tres atestaciones/motivo/clave desde cliente; sesión administrativa, identidad/empresa/actor, fuentes/receta histórica y estado desde servidor. Una transacción serializable con locks compartidos conserva versiones nativas y registra propuesta inmutable; contrastar identidad/día/receta/cantidad/cobertura, bloquear revisiones y movimientos existentes o ambiguos, no inferir consumo cero por consulta vacía. Idempotencia devuelve hecho original solo si coinciden hashes y actor/estado; cambio de atestación o microsegundo exige otro expediente. Probar aislamiento, contradicciones, repetición y fallo posterior al INSERT con rollback. Sin API, DDL persistente ni stock; decisión independiente, aplicación auditada, carreras de aplicación y V2 real integrados permanecen pendientes.

Hijo adicional **INV-01.c.recovery.ui-routes** (I/M, V1/V2/V3): depende de INV-01.b, SEC-00, proposal.service, decision.service y apply. Código local: ruta recovery-proposals, recovery-dialog, cliente sales-entry y sus pruebas unitarias/DB. Subdividir la aceptación de navegador/HTTP/storage si excede cinco archivos. El test DB actual usa dobles de sesión/R2 y savepoints; no acredita concurrencia de commits ni V3 real. El cierre agregado recovery requiere también decisión, aplicación y este hijo explícitamente.

#### INV-01.d — Aceptar corrección y anulación por API/UI

**Tipo/tamaño:** A / M. **Depende de:** INV-01.c. **Verificación:** V3.

**Entrega y aceptación:** Importar, repetir, corregir y anular muestran saldos y errores explicables; usuario sin alcance y otra empresa no pueden modificar ni ver el recorrido.

#### INV-02 — Definir quién consume cada receta

**Tipo/tamaño:** I / P. **Depende de:** INV-01.c. **Verificación:** V1,V2.

**Entrega y aceptación:** Cada versión declara consumo de insumos por venta o consumo del producto elaborado; fijar regla por vigencia y evitar cambiar el significado de movimientos históricos.

Preparación 2026-11-22: contrato puro en `recipe-consumption-policy.ts`, con vigencias por día civil y modos excluyentes. [Evidencia y siguientes incrementos](../tasks/evidencia/2026-11-22/INV-02/README.md). Sin aceptación: siguen pendientes publicación/persistencia append-only, FK/RLS, lector de versión publicada, congelación en snapshot y writer de venta. La compensación de una revisión previa conserva su demanda/asignaciones originales. No habilitar consumo de elaborado hasta PROD-01; la definición histórica no cambia por una nueva vigencia.

Descomposición de ejecución para mantener incrementos de hasta cinco archivos; todos heredan INV-01.c:

- **INV-02.contract**, I/S, V1: `recipe-consumption-policy.ts` y su unitaria. Modo excluyente, versión única, día civil, rechazo de vigencias/identidades ambiguas y ausencia de cobertura explícita.
- **INV-02.schema**, I/M, V1,V2; depende además de contract: schema raíz, SQL 0159 generado, journal, snapshot y SQL focal (cinco archivos). FK compuestas propias, versión/inicio únicos, procedencia, FORCE RLS, grants mínimos y hechos inmutables. Código y SQL PGlite comprobados; V2 independiente y aplicación externa pendientes.
- **INV-02.publish.rls**, I/M, V1,V2; depende además de schema: schema raíz, SQL 0160, journal, snapshot y prueba SQL (cinco archivos). Lectura mínima de versiones por empresa, fichas inmutables, INSERT acotado de bitácora y prueba de reintento sin exponer JSON. RLS runtime sin FORCE en tablas compartidas, conservando escritores dueños y sin atribuir aceptación de conexiones dueñas. SQL PGlite comprobado; LOGIN/Postgres independiente y aplicación pendientes.
- **INV-02.publish**, I/M, V1,V2; depende además de schema, publish.rls y AUD-02: publicación auditada, control de retroactividad/carreras, validación de versión/artículo/unidad propios; sin aceptar JSON del cliente como snapshot. Definir caracterización de históricos antes de proponer modo legado. Código en `recipe-consumption-publication.ts`, AuditService/parser compartido y dos pruebas (cinco archivos); savepoint completo, contexto restaurado, prueba de auditoría para reintentos y máximo tres intentos transaccionales. [Evidencia](../tasks/evidencia/2026-11-22/INV-02/publication.md). La prueba local no acredita carrera publicación↔venta hasta conectar apply.
- **INV-02.snapshot**, I/M, V1,V2; depende además de publish: leer versión publicada en la transacción de venta y congelar política/vigencia/demanda; una subreceta elaborada detiene expansión. No combinar ID de versión con ficha mutable distinta. Código implementado: **106/106** de regresión local y casos nativos de versión/día/raíz/subreceta, enlazado al writer bajo activación. [Evidencia y límites](../tasks/evidencia/2026-11-22/INV-02/snapshot.md). Sin aceptación dependiente; histórico/recovery y aplicación operativa pendientes.
- **INV-02.apply**, I/M, V1,V2; depende además de snapshot: writer canónico, compensaciones con snapshot/asignaciones previas y fail-closed del modo elaborado mientras falte su recorrido de stock. Código implementado bajo activación del servidor, sin fallback de receta publicada a mutable; publicador protege también ventas del padre. **183/183** regresiones locales, ocho casos nativos de políticas y build con tipos/455 páginas correctos. [Evidencia y pendientes](../tasks/evidencia/2026-11-22/INV-02/apply.md); sin aceptación dependiente ni activación externa. La activación y venta efectiva del terminado se acreditan en PROD-01.b; no introducir una dependencia inversa de INV-02 hacia PROD-01 que cierre un ciclo con PROD-00.

Registro local de schema: [migración y límites](../tasks/evidencia/2026-11-22/INV-02/schema.md). El padre no cierra por tener contrato o SQL local; exige sus seis hijos y dependencias aceptados.

**Puerta del frente:** todos los hijos requeridos aceptados, evidencia enlazada y filas afectadas actualizadas. Si un rastreo descubre trabajo ya completo, ejecutar aceptación y documentarlo; si descubre una brecha nueva, abrir hijo sin maquillar estados.

### 2. Nómina calculada y explicable

Entradas de código/documentación: `lib/services/payroll-service.ts`, `lib/services/fiscal-service.ts`, `lib/services/labor-cost-service.ts`, `pruebas de nómina`, `schema/migración solo si necesaria`. Elegir solo el subconjunto del ticket; descubrir el archivo exacto cuando sea una ubicación orientativa.

#### NOM-01 — Fijar unidad salarial y vigencias

**Tipo/tamaño:** I / M. **Depende de:** P0-03, SEC-00. **Verificación:** V1,V2.

**Entrega y aceptación:** Sueldo diario/período, moneda, vigencias y calendario explícitos; cambios no recalculan períodos aprobados; datos incompletos producen causa visible.

#### NOM-02.a — Calcular base desde asistencia aprobada

**Tipo/tamaño:** I / M. **Depende de:** NOM-01. **Verificación:** V1,V2.

**Entrega y aceptación:** Período con asistencia, falta y festivo tiene desglose verificable; distinguir asistencia pendiente y aprobada; fechas se interpretan en la zona operativa definida.

#### NOM-02.b — Incorporar horas extra aprobadas

**Tipo/tamaño:** I / M. **Depende de:** NOM-02.a. **Verificación:** V1,V2.

**Entrega y aceptación:** Horas elegibles generan importe por regla vigente y autorización; período sin horas extra da cero justificado; rechazos y duplicados no aumentan pago.

#### NOM-02.c1 — Incorporar vacaciones y permisos

**Tipo/tamaño:** I / M. **Depende de:** NOM-02.a. **Verificación:** V1,V2.

**Entrega y aceptación:** Saldos, fechas, autorización y concepto salarial quedan enlazados; ausencia de dato no se convierte en vacaciones pagadas ni falta automática.

#### NOM-02.c2 — Incorporar bonos e incidencias

**Tipo/tamaño:** I / M. **Depende de:** NOM-02.a. **Verificación:** V1,V2.

**Entrega y aceptación:** Conceptos aprobados con importe y tratamiento explícitos entran una sola vez; cambios posteriores invalidan el borrador afectado.

#### NOM-02.d1 — Calcular ISR ordinario

**Tipo/tamaño:** I / M. **Depende de:** NOM-02.a. **Verificación:** V1,V2.

**Entrega y aceptación:** Tablas/versiones y fecha de vigencia con fuente oficial registrada; casos de frontera contrastados con un oráculo independiente; falta de configuración impide aprobar.

#### NOM-02.d2 — Calcular deducción obrera de seguridad social

**Tipo/tamaño:** I / M. **Depende de:** NOM-02.a. **Verificación:** V1,V2.

**Entrega y aceptación:** Bases, días y reglas vigentes explican cada deducción; conceptos y límites parametrizados con fuentes oficiales; sin base no se simula deducción cero.

#### NOM-02.d3 — Aplicar préstamos y descuentos autorizados

**Tipo/tamaño:** I / M. **Depende de:** NOM-02.a. **Verificación:** V1,V2.

**Entrega y aceptación:** Cuota autorizada conserva saldo e historial; repetir período no cobra dos veces; cancelación o ajuste deja trazabilidad y reglas de límite.

#### NOM-02.e — Sustituir la carga patronal fija del 35%

**Tipo/tamaño:** I / M. **Depende de:** NOM-01, NOM-02.d2. **Verificación:** V1,V2.

**Entrega y aceptación:** Cálculo patronal tiene bases, vigencias y conceptos; un estimado conserva etiqueta y no acredita costo medido; nómina y costo laboral usan el mismo resultado.

#### NOM-06 — Bloquear resultados incompletos

**Tipo/tamaño:** I / M. **Depende de:** NOM-02.b, NOM-02.c1, NOM-02.c2, NOM-02.d1, NOM-02.d2, NOM-02.d3, NOM-02.e. **Verificación:** V1,V3.

**Entrega y aceptación:** Cada cero tiene causa válida; la ausencia de datos bloquea aprobación/timbrado con mensaje recuperable; no usar ausencia de un literal de código como prueba de cálculo correcto.

#### NOM-03 — Aprobar un snapshot inmutable

**Tipo/tamaño:** I / M. **Depende de:** NOM-06. **Verificación:** V2,V3.

**Entrega y aceptación:** Aprobación congela entradas/reglas/importes y actor; modificar una entrada invalida el borrador; carrera entre editar y aprobar no publica una versión obsoleta.

#### NOM-04.a — Unificar recibos y exportación

**Tipo/tamaño:** I / M. **Depende de:** NOM-03. **Verificación:** V1,V3.

**Entrega y aceptación:** Recibo y exportación toman el mismo snapshot/versionado; sumas y neto coinciden; reexportar no recalcula asistencia.

#### NOM-04.b — Aceptar timbrado con FiscalAPI existente

**Tipo/tamaño:** A / M. **Depende de:** NOM-04.a. **Verificación:** V1,V2,V3.

**Entrega y aceptación:** Mismo snapshot alimenta CFDI; sandbox cubre éxito, rechazo y reintento idempotente; guardar UUID/estado y dejar explícito si no se pudo validar el proveedor.

#### NOM-05 — Enlazar obligación neta con tesorería

**Tipo/tamaño:** I / M. **Depende de:** NOM-04.a, BAN-04. **Verificación:** V2,V3.

**Entrega y aceptación:** Una obligación por empleado/período aprobado; pago parcial, repetición y conciliación conservan neto/saldo; CFDI y pago mantienen estados independientes.

**Puerta del frente:** todos los hijos requeridos aceptados, evidencia enlazada y filas afectadas actualizadas. Si un rastreo descubre trabajo ya completo, ejecutar aceptación y documentarlo; si descubre una brecha nueva, abrir hijo sin maquillar estados.

### 3. Banca, comisiones y coordinación con FC-12

Entradas de código/documentación: `lib/services/bank-statement-service.ts`, `lib/services/commission-service.ts`, `lib/services/accounting/settlement-adapter.ts`, `components/finance`, `pruebas bancarias/contables`. Elegir solo el subconjunto del ticket; descubrir el archivo exacto cuando sea una ubicación orientativa.

#### SEC-05.tesoreria — Aceptar RLS y privilegios de tesorería

**Tipo/tamaño:** A / M. **Depende de:** SEC-00, P0-05. **Verificación:** V2,V3.

**Entrega y aceptación:** Inventariar tablas bancarias y pagos; probar HTTP/job con rol runtime, dos empresas y alcances; ampliar solo políticas/privilegios faltantes.

#### BAN-01 — Aceptar cuentas e importación bancaria

**Tipo/tamaño:** A / M. **Depende de:** SEC-05.tesoreria. **Verificación:** V2,V3.

**Entrega y aceptación:** Cuenta de empresa correcta, datos bancarios protegidos y archivo real anonimizado o sandbox identificado; reimportación no duplica; errores por línea son visibles.

#### BAN-04 — Aceptar matching de egresos

**Tipo/tamaño:** A / M. **Depende de:** BAN-01. **Verificación:** V2,V3.

**Entrega y aceptación:** Confirmar, repetir y deshacer cruce sin hecho contable conserva obligación/pago/movimiento; carreras dan resultado único; confirmación manual y conciliación bancaria se distinguen.

#### BAN-05 — Completar identidad de ingresos esperados

**Tipo/tamaño:** I / M. **Depende de:** BAN-01, INV-01.c. **Verificación:** V1,V2.

**Entrega y aceptación:** Corte/terminal/agregador conservan fuente, fecha, bruto, comisión, neto esperado y cuenta destino; no equiparar venta, liquidación y depósito; ambigüedad permanece pendiente.

#### BAN-06.a — Aceptar conciliación de depósitos existente

**Tipo/tamaño:** A / M. **Depende de:** BAN-05, P0-05. **Verificación:** V2,V3.

**Entrega y aceptación:** Sugerir no confirma; confirmación valida destino/neto/empresa y es idempotente; depósito agrupado no soportado queda pendiente explícito, sin inventar un vínculo.

#### BAN-06.b — Resolver corrección auditada de un depósito contabilizado

**Tipo/tamaño:** I / M. **Depende de:** BAN-06.a, AUD-02. **Verificación:** V2,V3.

**Entrega y aceptación:** Reutilizar el contrato de reversa de FC-12 si ya existe; en otro caso agregar corrección con actor/motivo/versiones; nunca borrar el hecho contable ni liberar saldo dos veces.

#### FIN-06.a — Separar importe reportado y conciliado

**Tipo/tamaño:** I / M. **Depende de:** BAN-06.a. **Verificación:** V1,V2.

**Entrega y aceptación:** Declarar procedencia del importe y estado de conciliación por separado; pendiente/discrepante/confirmado y comisión documentada cero tienen etiquetas coherentes en API y P&L.

#### FIN-06.b — Aceptar comisiones e ingresos por canal

**Tipo/tamaño:** A / M. **Depende de:** FIN-06.a, BAN-06.b. **Verificación:** V2,V3.

**Entrega y aceptación:** Tarifa estimada, comisión reportada y comisión conciliada se distinguen; neto/bruto/IVA/diferencia cuadran según fuente; un dato faltante no se presenta como costo firme.

#### FIN-01 — Distinguir saldo conciliado de caja proyectada

**Tipo/tamaño:** I / M. **Depende de:** BAN-04, BAN-06.a. **Verificación:** V1,V3.

**Entrega y aceptación:** UI declara fecha, cuenta y fuente del saldo; si no existe ancla bancaria no calcula un saldo absoluto aparente; proyección permanece identificada como estimación.

**Puerta del frente:** todos los hijos requeridos aceptados, evidencia enlazada y filas afectadas actualizadas. Si un rastreo descubre trabajo ya completo, ejecutar aceptación y documentarlo; si descubre una brecha nueva, abrir hijo sin maquillar estados.

### 4. Evidencia, excepciones y aprobaciones

Entradas de código/documentación: `lib/services/evidence-store.ts`, `lib/services/exception-service.ts`, `lib/services/audit-service.ts`, `app/dashboard/exceptions/page.tsx`, `APIs y pruebas del recorrido`. Elegir solo el subconjunto del ticket; descubrir el archivo exacto cuando sea una ubicación orientativa.

#### AUD-02 — Hacer obligatoria la auditoría crítica

**Tipo/tamaño:** I / M. **Depende de:** SEC-00, P0-03. **Verificación:** V1,V2.

**Entrega y aceptación:** Inventario de acciones críticas; motivo obligatorio según acción y auditoría en la misma transacción; fallo al auditar revierte mutación; conservar usos no críticos explícitos.

#### EVI-02.a — Añadir sujetos de evidencia

**Tipo/tamaño:** I / M. **Depende de:** SEC-00. **Verificación:** V1,V2.

**Entrega y aceptación:** INVOICE/PAYMENT/EXCEPTION se validan contra entidad, empresa y sucursal; adjunto a entidad ajena se rechaza; no perder contratos de evidencia actuales.

#### EVI-02.b — Conectar evidencia al recorrido visible

**Tipo/tamaño:** I / M. **Depende de:** EVI-02.a. **Verificación:** V2,V3.

**Entrega y aceptación:** Alta/lectura/baja lógica desde cada documento conserva autor/procedencia; dos empresas no acceden al archivo ni metadatos ajenos; reinicio conserva acceso autorizado.

#### EXC-01 — Aceptar persistencia canónica de excepciones

**Tipo/tamaño:** A / M. **Depende de:** SEC-00, EXC-01.rls. **Verificación:** V2.

**Entrega y aceptación:** Migración aplicable a base aislada; unicidad, RLS y rollback acreditados; ninguna prueba depende solo de mocks.

Trabajo previo **EXC-01.rls** (I/M, V2; depende de SEC-00): aportar migración aditiva revisada del aislamiento de exceptions y comprobarla en Postgres aislado bajo rol runtime. El beforeAll que instala una política a mano no sustituye ese artefacto. Sin aplicación a main; OPS-03 conserva despliegue por entorno.

#### EXC-02 — Aceptar sync legacy → canónico

**Tipo/tamaño:** A / M. **Depende de:** EXC-01. **Verificación:** V2,V3.

**Entrega y aceptación:** Repetir sync no duplica; comparar conteos/identidades y bandera reversible; salida del feed legacy declara el estado canónico cuando exista.

#### EXC-03.a — Probar lifecycle concurrente

**Tipo/tamaño:** A / M. **Depende de:** EXC-02, AUD-02. **Verificación:** V2.

**Entrega y aceptación:** Dos acciones simultáneas no pisan estado; verificador distinto de resolvedor; transición inválida no deja cambio ni auditoría parcial.

#### EXC-03.b — Probar job recuperable de SLA

**Tipo/tamaño:** A / M. **Depende de:** EXC-03.a. **Verificación:** V1,V2.

**Entrega y aceptación:** Reloj controlado y caída/reintento no duplican escalamiento; respetar empresa y estado terminal; reutilizar reglas unitarias ya existentes.

#### EXC-05 — Conectar acciones canónicas en la UI

**Tipo/tamaño:** I / M. **Depende de:** EXC-02, EXC-03.a. **Verificación:** V3.

**Entrega y aceptación:** Asignar/iniciar/resolver/verificar/cerrar/reabrir llaman APIs autorizadas; UI refleja capacidades y conflicto concurrente; el feed no acredita una acción inexistente.

#### EXC-04.merma — Completar excepción de merma

**Tipo/tamaño:** I / M. **Depende de:** EXC-03.b, INV-04. **Verificación:** V1,V2.

**Entrega y aceptación:** Umbral/versionado/owner y cierre con evidencia; evento repetido no crea otra excepción para el mismo hecho.

#### EXC-04.presupuesto — Completar excepción de presupuesto

**Tipo/tamaño:** I / M. **Depende de:** EXC-03.b. **Verificación:** V1,V2.

**Entrega y aceptación:** Gasto fuera de presupuesto conserva regla y responsable; autorización y cierre auditados; repetición no duplica.

#### EXC-04.ausencia — Completar excepción de ausencia

**Tipo/tamaño:** I / M. **Depende de:** EXC-03.b, NOM-02.a. **Verificación:** V1,V2.

**Entrega y aceptación:** Falta aprobada se distingue de asistencia pendiente; detección y regularización conservan responsable e historial.

#### EXC-04.banco — Completar excepción bancaria

**Tipo/tamaño:** I / M. **Depende de:** EXC-03.b, BAN-04, BAN-06.a. **Verificación:** V2,V3.

**Entrega y aceptación:** Pago/depósito pendiente o discrepante conserva fuente y antigüedad; conciliación resuelve con trazabilidad sin ocultar una diferencia.

#### APR-01 — Alinear aprobación de documentos

**Tipo/tamaño:** I / P. **Depende de:** AUD-02, NOM-03, BAN-04. **Verificación:** V1,V2,V3.

**Entrega y aceptación:** OC/OS/gasto/pago/nómina declaran versión aprobada y autoridad; cambio material invalida aprobación; mantener especializaciones existentes.

**Puerta del frente:** todos los hijos requeridos aceptados, evidencia enlazada y filas afectadas actualizadas. Si un rastreo descubre trabajo ya completo, ejecutar aceptación y documentarlo; si descubre una brecha nueva, abrir hijo sin maquillar estados.

### 5. Producción, conteos y costos de inventario

Entradas de código/documentación: `lib/services/production-service.ts`, `lib/services/theoretical-consumption-service.ts`, `lib/db/schema`, `APIs de inventario`, `pruebas de producción/conteos`. Elegir solo el subconjunto del ticket; descubrir el archivo exacto cuando sea una ubicación orientativa.

#### PROD-00 — Rastrear modelos y consumidores de producción

**Tipo/tamaño:** R / S. **Depende de:** INV-02. **Verificación:** D.

**Entrega y aceptación:** Mapa production_orders/results/plans/batches y consumidores reales; decidir modelo fuente y compatibilidad sin eliminar históricos por inferencia.

#### PROD-01.a — Crear lote de producto terminado

**Tipo/tamaño:** I / M. **Depende de:** PROD-00. **Verificación:** V1,V2.

**Entrega y aceptación:** Cierre crea cantidad/unidad/costo/caducidad y vínculo al resultado; consumo de ingredientes y alta terminada comparten transacción; sin insumos no hay stock ficticio.

#### PROD-01.b — Consumir elaborado sin descontar dos veces

**Tipo/tamaño:** I / M. **Depende de:** PROD-01.a. **Verificación:** V2.

**Entrega y aceptación:** Vender subreceta consume su lote terminado según INV-02; genealogía llega a ingredientes; dos cierres/reintentos no duplican lotes ni movimientos.

#### PROD-02 — Unificar planificación y ejecución visible

**Tipo/tamaño:** I / M. **Depende de:** PROD-01.b. **Verificación:** V2,V3.

**Entrega y aceptación:** Prep list, orden, resultado y hold time usan el modelo acordado; UI muestra saldo/caducidad/procedencia; legado se conserva con migración controlada si hace falta.

#### REC-03A — Revalidar lotes con anomalía histórica

**Tipo/tamaño:** R / M. **Depende de:** P0-04, SEC-00. **Verificación:** V2.

**Entrega y aceptación:** Dry-run por lote en copia aislada clasifica evidencia suficiente/ambigua; no asumir cuatro lotes ni fabricar saldos.

#### REC-03B — Aceptar protocolo de corrección histórica

**Tipo/tamaño:** A / M. **Depende de:** REC-03A, AUD-02. **Verificación:** V2,V3.

**Entrega y aceptación:** Conteo, unidad, actor, motivo y aprobación separada; repetición no duplica ajuste; lotes ambiguos permanecen retenidos; aplicar datos operativos solo al lote respaldado.

#### INV-03 — Completar conteo → revisión → ajuste

**Tipo/tamaño:** I / M. **Depende de:** PROD-02, AUD-02. **Verificación:** V2,V3.

**Entrega y aceptación:** Actores distintos, versión revisada y ajuste único; conteo obsoleto no pisa saldo nuevo; lotes heredados afectados siguen protocolo REC-03B.

#### INV-04 — Congelar costo y varianza del período

**Tipo/tamaño:** I / M. **Depende de:** INV-03. **Verificación:** V1,V2.

**Entrega y aceptación:** Snapshot tiene fuentes, unidades, versión y reglas de cierre/reapertura; lectura histórica no recalcula contra costo actual.

#### INV-05 — Aceptar PAR/min-max y snapshots

**Tipo/tamaño:** A / M. **Depende de:** INV-03. **Verificación:** V2,V3.

**Entrega y aceptación:** Capturar parámetros por sucursal, leerlos y demostrar efecto en reporte; faltantes, cambios y alcance tienen resultados visibles.

**Puerta del frente:** todos los hijos requeridos aceptados, evidencia enlazada y filas afectadas actualizadas. Si un rastreo descubre trabajo ya completo, ejecutar aceptación y documentarlo; si descubre una brecha nueva, abrir hijo sin maquillar estados.

### 6. Operación, mantenimiento, delivery y cumplimiento

Entradas de código/documentación: `lib/services/equipment-service.ts`, `lib/inngest/functions`, `templates`, `APIs/UI del módulo descubierto`, `pruebas focalizadas`. Elegir solo el subconjunto del ticket; descubrir el archivo exacto cuando sea una ubicación orientativa.

#### OPE-00 — Rastrear writers y recorridos operativos

**Tipo/tamaño:** R / S. **Depende de:** P0-03. **Verificación:** D.

**Entrega y aceptación:** Localizar escritura de recurrencias, generadores, delivery y planes correctivos con CodeGraph; clasificar implementado/parcial/no localizado y fijar archivos concretos antes de programar.

#### OPE-01.a — Completar configuración de recurrencias

**Tipo/tamaño:** I / M. **Depende de:** OPE-00, SEC-00. **Verificación:** V1,V3.

**Entrega y aceptación:** API/UI autorizadas escriben frecuencia, zona, responsable y vigencia; fechas inválidas y sucursal ajena se rechazan; reutilizar writer si se localiza.

#### OPE-01.b — Generar órdenes de forma durable

**Tipo/tamaño:** I / M. **Depende de:** OPE-01.a. **Verificación:** V1,V2.

**Entrega y aceptación:** Clave por programación/ocurrencia evita duplicados; caída y reintento no pierden ni repiten orden; cierre y siguiente ocurrencia siguen una regla explícita.

#### OPE-02 — Completar historial de mantenimiento

**Tipo/tamaño:** I / M. **Depende de:** OPE-01.b. **Verificación:** V1,V3.

**Entrega y aceptación:** Downtime/costo/reincidencia y recomendación reparar/reemplazar son explicables por equipo; sin historial no se inventa recomendación.

#### OPE-03.aceite — Completar medición de aceite

**Tipo/tamaño:** I / M. **Depende de:** OPE-00. **Verificación:** V1,V3.

**Entrega y aceptación:** Lectura/unidad/límite vigente y recambio con responsable; fuera de rango genera acción; historial conserva mediciones y evidencia.

#### OPE-03.cocina — Aceptar rutina de cocina

**Tipo/tamaño:** A / M. **Depende de:** OPE-00. **Verificación:** V3.

**Entrega y aceptación:** Estación/responsable/ejecución/verificación y evidencia reales; plantilla sola no acredita cumplimiento.

#### OPE-03.salon — Aceptar rutina de salón/counter

**Tipo/tamaño:** A / M. **Depende de:** OPE-00. **Verificación:** V3.

**Entrega y aceptación:** Asignación y ejecución con pendientes verificables; rechazo y evidencia ausente se muestran sin cierre falso.

#### OPE-03.gerente — Aceptar checklist del gerente

**Tipo/tamaño:** A / M. **Depende de:** OPE-00. **Verificación:** V3.

**Entrega y aceptación:** Checklist ejecutado enlaza evidencia y acciones; gerente no acredita otra sucursal; ejecución incompleta permanece pendiente.

#### OPE-03.handoff — Completar entrega de turno

**Tipo/tamaño:** I / M. **Depende de:** OPE-00. **Verificación:** V2,V3.

**Entrega y aceptación:** Pendientes conservan origen y responsable; receptor acepta explícitamente; reintento no pierde ni duplica pendientes.

#### OPE-04 — Capturar disponibilidad delivery

**Tipo/tamaño:** I / M. **Depende de:** OPE-00. **Verificación:** V1,V3.

**Entrega y aceptación:** Primera entrega manual registra canal/online-offline/motivo/actor/hora y alerta por umbral; no afirmar control remoto de plataforma sin integración verificada.

#### CMP-01 — Cerrar planes correctivos con historial

**Tipo/tamaño:** I / M. **Depende de:** OPE-00, EXC-03.a, EVI-02.b. **Verificación:** V2,V3.

**Entrega y aceptación:** Acción, evidencia y verificador habilitan cierre; reapertura conserva historia; excepción y plan no se cierran mutuamente sin verificar criterios.

**Puerta del frente:** todos los hijos requeridos aceptados, evidencia enlazada y filas afectadas actualizadas. Si un rastreo descubre trabajo ya completo, ejecutar aceptación y documentarlo; si descubre una brecha nueva, abrir hijo sin maquillar estados.

### 7. Finanzas históricas, centros de costo y canales

Entradas de código/documentación: `lib/services/pnl-service.ts`, `lib/services/treasury-service.ts`, `lib/services/sales-ingest-service.ts`, `APIs/UI de finanzas`, `pruebas del módulo`. Elegir solo el subconjunto del ticket; descubrir el archivo exacto cuando sea una ubicación orientativa.

#### FIN-02.a — Fijar contrato de cierre financiero

**Tipo/tamaño:** I / M. **Depende de:** P0-03, AUD-02. **Verificación:** V1,V2.

**Entrega y aceptación:** Estados borrador/cerrado/reabierto con versión y motivo; cerrar dos veces no duplica; definir datos faltantes que bloquean o declaran provisionalidad.

#### FIN-03.a — Completar imputación a centro de costo

**Tipo/tamaño:** I / M. **Depende de:** FIN-02.a. **Verificación:** V1,V2.

**Entrega y aceptación:** Cada fuente conserva centro explícito o categoría sin imputar; validar empresa/vigencia; no inferir centro por nombre o cuenta bancaria.

#### FIN-03.b — Reportar P&L por centro de costo

**Tipo/tamaño:** I / M. **Depende de:** FIN-03.a. **Verificación:** V1,V3.

**Entrega y aceptación:** Centros más sin imputar cuadran con sucursal; conservar cobertura/procedencia/comisiones/caja chica; no prorratear sin regla declarada.

#### FIN-04 — Completar solicitud de pago trazable

**Tipo/tamaño:** I / M. **Depende de:** BAN-04, APR-01. **Verificación:** V2,V3.

**Entrega y aceptación:** Reutilizar solicitud/corrida si cubre el contrato; solicitud tiene obligación, aprobación, saldo y estado independiente de ejecución; repetición no duplica deuda.

#### FIN-05 — Aceptar presupuestos y períodos

**Tipo/tamaño:** A / M. **Depende de:** FIN-02.a. **Verificación:** V2,V3.

**Entrega y aceptación:** Alta, consumo, cierre y reapertura por empresa/período se demuestran; gasto rechazado no consume presupuesto; cambios conservan versiones.

#### FIN-02.b — Leer P&L congelado

**Tipo/tamaño:** I / M. **Depende de:** FIN-02.a, FIN-03.b, INV-04, NOM-05, FIN-06.b. **Verificación:** V2,V3.

**Entrega y aceptación:** Período cerrado mantiene valores/fuentes pese a cambios operativos; reapertura crea versión auditable; costo laboral usa resultado consistente con snapshot aprobado.

#### FIN-07 — Definir indicadores económicos

**Tipo/tamaño:** I / P. **Depende de:** FIN-02.b. **Verificación:** V1,V3.

**Entrega y aceptación:** Food cost/prime cost/contribution/unit economics declaran fórmula/base/unidad/procedencia; oráculos independientes y datos ausentes verifican resultado y límites.

#### INT-01 — Versionar mapeo de canal a receta/SKU

**Tipo/tamaño:** I / M. **Depende de:** INV-02. **Verificación:** V1,V2.

**Entrega y aceptación:** Identidad por fuente/canal/producto y vigencia; SKU ambiguo queda pendiente; una nueva versión no remapea consumos históricos.

#### INT-02 — Completar importación por fuente disponible

**Tipo/tamaño:** I / P. **Depende de:** INT-01, INV-01.d. **Verificación:** V1,V2,V3.

**Entrega y aceptación:** Por formato disponible: importar/repetir/corregir/anular con errores por fila; conservar archivo/fuente; API del proveedor solo entra si está disponible y autorizada.

#### INT-03 — Aceptar corte → mix → settlement → depósito

**Tipo/tamaño:** A / M. **Depende de:** INT-02, FIN-06.b. **Verificación:** V2,V3.

**Entrega y aceptación:** Cada etapa conserva su propia identidad/fecha/importe; repetir no duplica ingreso ni consumo; diferencias y depósitos ambiguos quedan gestionables.

**Puerta del frente:** todos los hijos requeridos aceptados, evidencia enlazada y filas afectadas actualizadas. Si un rastreo descubre trabajo ya completo, ejecutar aceptación y documentarlo; si descubre una brecha nueva, abrir hijo sin maquillar estados.

### 8. Seguridad restante, aceptación y despliegue

Entradas de código/documentación: `lib/db/schema`, `lib/rbac`, `lib/branch-scope.ts`, `tests/integration`, `tests/e2e y evidencia por fila`. Elegir solo el subconjunto del ticket; descubrir el archivo exacto cuando sea una ubicación orientativa.

#### SEC-05.nomina — Aceptar aislamiento de nómina

**Tipo/tamaño:** A / M. **Depende de:** SEC-00, NOM-03. **Verificación:** V2,V3.

**Entrega y aceptación:** HTTP y jobs con rol runtime no leen/escriben nómina ajena; validar políticas heredadas de 0123 y permisos; ampliar solo brechas demostradas.

#### SEC-05.inventario — Completar aislamiento de inventario

**Tipo/tamaño:** I / M. **Depende de:** SEC-00, INV-01.c. **Verificación:** V2,V3.

**Entrega y aceptación:** Items/lotes/movimientos con empresa/sucursal y rol runtime; denegación de lecturas y escrituras laterales; conservar recorridos FEFO.

#### SEC-05.resto — Completar aislamiento por dominio

**Tipo/tamaño:** I / P. **Depende de:** SEC-00, SEC-05.tesoreria, SEC-05.nomina, SEC-05.inventario. **Verificación:** V2,V3.

**Entrega y aceptación:** Matriz organización/compras/mantenimiento/proyecciones; subdividir por dominio y tablas antes de ejecutar; cada lote prueba runtime y jobs, no solo dueño.

#### PER-01 — Demostrar ocho perfiles

**Tipo/tamaño:** A / P. **Depende de:** SEC-05.resto. **Verificación:** V2,V3.

**Entrega y aceptación:** Director/operaciones/supervisor/gerente/finanzas/compras/RH/colaborador completan acciones permitidas y reciben denegaciones; probar alcance y menú/API coherentes sin asumir ocho roles nuevos.

#### VAL-01.M01-M17 — Aceptar cada módulo y sus filas

**Tipo/tamaño:** A / P. **Depende de:** P0-03. **Verificación:** V2,V3.

**Entrega y aceptación:** Instanciar una ficha por módulo con IDs de filas, tareas terminadas, casos normal/vacío/error y alcance; una fila fallida baja de estado y abre tarea explícita.

#### VAL-01.transversal — Aceptar recorridos transversales

**Tipo/tamaño:** A / P. **Depende de:** INT-03, PER-01, CMP-01, EXC-04.merma, EXC-04.presupuesto, EXC-04.ausencia, EXC-04.banco. **Verificación:** V2,V3.

**Entrega y aceptación:** Ventas/canales, ocho perfiles y los siete casos transversales identificados en la matriz tienen recorrido y evidencia individual; no sustituirlos por conteos de archivos.

#### OPS-03 — Aplicar lotes revisados al entorno identificado

**Tipo/tamaño:** A / P. **Depende de:** P0-04. **Verificación:** V2,V3.

**Entrega y aceptación:** Instanciar por lote estable, solo después de aceptación y revisión SQL; respaldo/compatibilidad/verificación posterior; no borrar datos ni marcar despliegue por tener SQL local.

#### VAL-02 — Ejecutar piloto, carga y restauración

**Tipo/tamaño:** A / P. **Depende de:** VAL-01.M01-M17, VAL-01.transversal. **Verificación:** V2,V3.

**Entrega y aceptación:** Probar 3/8/15 sucursales con objetivos medidos de latencia/errores fijados antes de correr; restauración verificada; datos sintéticos identificados y aceptación operativa real separada.

#### VAL-03 — Cerrar trazabilidad de las 239 filas

**Tipo/tamaño:** A / S. **Depende de:** VAL-02. **Verificación:** D.

**Entrega y aceptación:** Todas las filas tienen evidencia válida o pendiente explícito; pendientes externos no cuentan como completos; registrar entorno y lotes realmente desplegados.

**Puerta del frente:** todos los hijos requeridos aceptados, evidencia enlazada y filas afectadas actualizadas. Si un rastreo descubre trabajo ya completo, ejecutar aceptación y documentarlo; si descubre una brecha nueva, abrir hijo sin maquillar estados.

## 6. Equivalencias con el plan anterior

Los IDs padre siguientes siguen siendo referencias válidas para trazabilidad, pero no se ejecutan como tickets adicionales.

| Referencia anterior | Destino actual |
|---|---|
| INV-01 | INV-01.a, INV-01.b, INV-01.c, INV-01.d |
| NOM-02.c | NOM-02.c1, NOM-02.c2 |
| NOM-02.d | NOM-02.d1, NOM-02.d2, NOM-02.d3 |
| NOM-04 | NOM-04.a, NOM-04.b |
| BAN-01/04 | BAN-01 y BAN-04; BAN-04 es el hito de aceptación de egresos |
| BAN-06 | BAN-06.a, BAN-06.b |
| FIN-06 | FIN-06.a, FIN-06.b |
| FIN-03 | FIN-03.a, FIN-03.b |
| EVI-02 | EVI-02.a, EVI-02.b |
| PROD-01 | PROD-01.a, PROD-01.b; precedidos por PROD-00 |
| OPE-01 | OPE-01.a, OPE-01.b; precedidos por OPE-00 |
| OPS-02.tesoreria | SEC-05.tesoreria; depende de SEC-00, no de BAN-04 |
| OPS-02.nomina / inventario | SEC-05.nomina / SEC-05.inventario |
| OPS-02.* | Sustituir por el dominio explícito y su preparación SEC-00; no conservar comodines en dependencias |
| REC-03A / REC-03B | Definidos en este plan; REC-03B solo condiciona aplicación a lotes históricos afectados |
| VAL-01.M01–M17 | Padre VAL-01.M01-M17; instanciar hijos según módulos e IDs reales de la matriz |

`SEC-05.resto` depende explícitamente de los tres dominios nombrados, nunca de sí mismo. BAN-01 depende de la preparación/aceptación RLS y BAN-04 depende de BAN-01: se elimina el ciclo tesorería ↔ banca.

La validación por módulo requiere P0-03 **y todas las tareas asignadas a sus filas**. El mapa generado en P0-03 materializa esas dependencias por hijo; el padre VAL-01.M01-M17 no permite saltarlas. OPS-03 también requiere la aceptación de cada lote concreto, además de P0-04.

## 7. Decisiones, supuestos y límites externos

| Tema | Supuesto de trabajo / tarea que lo resuelve | Qué queda pendiente si falta |
|---|---|---|
| FiscalAPI | Se conserva proveedor integrado; revisar configuración sin exponer secretos en NOM-04.b. | Solo aceptación externa de timbrado; no bloquea cálculo/snapshot/exportación. |
| Banco/formato | Reutilizar parser y fuentes disponibles; identificar archivo real anonimizado o sandbox en BAN-01. | Aceptación bancaria externa; no fabricar evidencia con CSV generado. |
| Canales | Primero formatos disponibles con identidad estable; API de proveedor es ampliación posterior según acceso. | Aceptación de cada fuente no disponible; no afirmar integración remota. |
| Delivery | Primera entrega manual con historial/alertas. Integración que cambie estado en plataforma requiere contrato posterior. | Automatización remota fuera de esta primera entrega. |
| Perfiles | Probar ocho perfiles mediante capacidades existentes; no crear ocho roles por defecto. | PER-01 documenta cualquier restricción que requiera decisión de producto. |
| Colaborador | Mantener mínimo privilegio y comprobar tareas/instrucciones/evidencia; no ampliar acceso por inferencia. | Restricciones específicas se registran en P0-03/PER-01 antes de cambiar permisos. |
| Comisiones | Procedencia del importe y conciliación son dimensiones distintas. | FIN-06.a resuelve representación y compatibilidad, sin rebautizar históricos sin respaldo. |
| Datos/piloto | Usar sintéticos identificados para pruebas; validar existencia de entorno/cliente al programar piloto. | Aceptación operativa real permanece pendiente; no se presupone que existan 8 sucursales reales. |
| FC-12 en curso | Referenciar [plan contable](../tasks/finanzas-contabilidad/plan.md) y [circuito bancario](../tasks/plan.md). | P0-05 resuelve integración y propiedad del cambio; no duplicar ni marcar trabajo ajeno como propio. |

## 8. Estimación y puntos de control

No se ratifica la cifra anterior de 175–217 días-persona: la investigación no estimó todo el sistema y varios frentes ya tienen código. Tampoco se promete un calendario total a partir de 86 entradas que incluyen padres por subdividir.

- **Primer hito de planificación:** P0 y mapa de 239 filas. Al cerrarlo, estimar cada hijo en horas de implementación, prueba y aceptación; separar esperas externas.
- **Primer hito funcional:** INV-01 completo, con rollback/reintento/corrección/anulación probados.
- **Segundo hito funcional:** una nómina explicable desde asistencia hasta snapshot/recibo, con carga patronal y deducciones trazables; declarar timbrado externo aparte.
- **Tercer hito funcional:** egreso e ingreso conciliados, comisiones con procedencia y corrección contable aceptada.
- **Hitos siguientes:** stock terminado, excepciones/operación, cierre financiero y perfiles por módulo.
- Reestimar después de P0, de la primera entrega funcional y de cada rastreo. S/M delimitan el trabajo; no son estimaciones de duración garantizadas.

## 9. Entregables y cierre

1. Este plan revisado y su checklist sincronizado, sin alterar los planes activos de banca/contabilidad.
2. Matriz nueva con delta y mapa de las 239 filas, generados durante P0; no se inventan como parte de esta redacción.
3. Manifiesto de migraciones por entorno y evidencia por hijo ejecutado.
4. Resultados de V1/V2/V3, correcciones y pendientes externos explícitos.
5. Puerta final: todas las filas aceptadas o pendientes identificados; no presentar cierre total mientras existan pendientes exigibles.

Esta entrega es planificación. No ejecuta migraciones, no implementa servicios, no marca aceptación y no despliega.
