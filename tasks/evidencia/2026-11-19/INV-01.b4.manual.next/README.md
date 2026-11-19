# Captura manual Next con login runtime independiente

Base `2553e33`, sin cambios de producto al abrir el arnés. Hijo
`INV-01.b4.manual.next`, A/M, V2/V3; depende de INV-01.a, b3, b4b,
runtime.config y manual.ui. Scope del arnés: helper de base desechable,
helper de servidor Next y `sales-runtime-next-browser.test.ts` (tres archivos).
El arreglo de varianza descubierto afecta dos archivos del hijo manual.ui,
en incremento separado. Sin aceptación ni despliegue.

## Aislamiento y cierre

Se comprueba que `.env.test` use otro endpoint que `.env`. Desde la base
de mantenimiento `postgres` se crea una copia con nombre UUID del origen
aislado mediante `CREATE DATABASE ... TEMPLATE ...`; no se copia main.
La copia conserva schema, datos del branch aislado, RLS, triggers y permisos
del branch de pruebas. No es una reconstrucción de migraciones desde cero.
El preflight y los reintentos acotados de 55006 nunca terminan conexiones
del origen. [Contrato PostgreSQL 18](https://www.postgresql.org/docs/18/sql-createdatabase.html).

Un rol nuevo UUID, contraseña solo en memoria, NOSUPERUSER/NOBYPASSRLS y
sin CREATEROLE/CREATEDB recibe solo los bloques GRANT de
0137/0138/0139/0141 dentro de la copia. No se cambia `pulso_app`. Next
recibe URI dueña para auth/otros dominios y URI independiente para el writer.
Cada servidor tiene puerto y secreto Better Auth propios; no hay mocks de
Next, API, sesión, SQL, resultados del writer o eventos de navegador.

Los hechos append-only se confirman únicamente dentro de esta base
desechable. Tras cerrar navegador y servidor, se verifica nombre generado,
endpoint aislado y propiedad antes de eliminar solo esa base con FORCE;
se elimina el rol sin membresías elevadas y se consulta su ausencia. El
socket del servidor debe rechazar conexiones. El manifiesto local conserva
identificadores/estado de recuperación, nunca URIs o contraseñas.

Los casos comparten una sola copia: schema/RLS/triggers, arranque/cierre y
recorrido manual. Solo el último escribe datos. Espera de origen hasta 90 s,
sin terminar sus clientes; si no se libera, la suite falla. No se interpreta
un manifiesto o archivo de lock como prueba de proceso vivo o limpieza.

## Resultados y diagnóstico conservados

- Sonda inicial: primer intento 55006, sin copia creada. Reintento: copia
  de **197 tablas**, eliminación y ausencia verificadas, exit 0.
- Primer arnés: origen ocupado, timeout 30 s, exit 1, sin terminar clientes.
  Después **1/1, exit 0, 8.06 s**, verifica nueve tablas RLS y ambos triggers
  inmutables, además de retirar base/rol.
- Arranque Next: 1/2, exit 1, 42.84 s; Next arrancó y devolvió 401 anónimo,
  pero el cierre dentro del sandbox agotó el timeout. Inspección fuera del
  sandbox autorizada: PID 20256 ya había terminado; socket 56495 cerrado.
  Repetición autorizada fuera del sandbox: **2/2, exit 0, 61.17 s**, con
  eliminación de base y rol. No se considera GREEN la corrida anterior.
- Primer recorrido completo: **0/3, exit 1, 158.30 s**. Dos conflictos del
  origen (55006, aunque pg_stat_activity reportaba cero clientes); el caso
  manual sí creó su copia y confirmó dos respuestas 200/cambios de stock,
  pero desapareció el formulario al refrescar la varianza. Copia/rol
  eliminados. No equivale a seis guardados ni a aceptación.
- Repetición diagnóstica: **2/3, exit 1, 157.91 s**. El diagnóstico también
  intentaba leer el formulario desmontado y agotó 30 s; se captura ahora URL,
  errores, screenshot y body sin depender de ese formulario.

## Arreglo de producto descubierto

`ReportsService.VarianceReportRow` devuelve actualQty/varianceQty/percent
NULL cuando faltan conteos. La pantalla duplicaba ese contrato como números
obligatorios y ejecutaba `actualQty.toFixed`, desmontando la captura después
de guardar. Regresión controlada reproduce exactamente **TypeError: Cannot
read properties of null (reading 'toFixed')**, caso fallido de 35.9 s.

La pantalla usa ahora el tipo real del servicio, excluye faltantes del
gráfico y muestra guiones y «Falta conteo» con su explicación. No sustituye
NULL por cero ni presenta conformidad. Cero medido conserva 0.00.
GREEN inicial **1/1, exit 0, 52.6 s**, 25.1 s de caso; se amplía luego la
regresión para comparar NULL con cero y comprobar ausencia de errores.
Suite completa controlada, nuevo build y repetición Next final en curso.

El recorrido final debe rechazar dueño configurado como runtime con 503 y
estado idéntico; luego guardar 10→12→8, repetir sin efectos, completar
$80.25→8025 centavos sin movimientos y anular cero→saldo 20. Exige feedback
visible después de cada respuesta, cinco revisiones para seis solicitudes,
sin errores de página y móvil sin overflow. SQL se lee desde otra conexión.
No se rebajan esas aserciones para aceptar solo respuestas 200.

Pendientes: GREEN final del recorrido, dependencias, CSV/cierre con Next y
aceptación integrada de INV-01.d. Auth y los lectores siguen con conexión
dueña; este arnés no afirma que toda la aplicación use el rol mínimo.

La primera suite ampliada controlada (17 casos) corrió en paralelo con el
build y agotó tiempos antes de montar el formulario y en el `beforeAll`
del servidor Vite. Se interrumpió: exit 1, dos fallos y quince sin ejecutar.
No alcanzó las aserciones nuevas de NULL/cero y no cuenta como regresión
aprobada. Se ejecutará en secuencia tras el build, conservando sus límites
de tiempo y sin cambiar producto para acomodar el arranque del arnés.

Build posterior al arreglo NULL: **exit 0**, compilación 5.9 min,
TypeScript global, 455/455 páginas (7.0 s) y optimización. Mantiene los avisos
de base de fetchConnectionCache y documentos laborales dinámicos. Suite
controlada secuencial: **17/17, exit 0, 1.2 min**, incluida la comparación
NULL/cero. Arreglo guardado en `3fb7c37`.

Siguiente Next: **2/3, exit 1, 138.78 s** (134.47 s de casos). Pasan todos
los guardados, corrección, repetición, ingreso, anulación, oráculos SQL y
feedback. El caso manual falla en su última comprobación: el contenido con
tabla ensancha el viewport móvil. Screenshot real revisado (810 px de
documento para viewport de 390). Base, rol y servidores se retiraron.

Regresión controlada móvil reproduce el mismo overflow: **exit 1**, 20.6 s
de caso. Se corrige en los mismos dos archivos de manual.ui: columna móvil
`minmax(0,1fr)` y `min-w-0` en ambos hijos; la tabla conserva scroll interno,
nombre accesible y foco de teclado. GREEN focal: **1/1, exit 0, 38.1 s**
(21.8 s de caso); screenshot controlado de 390 px revisado. Se refuerza la
aserción de teclado para exigir cambio de scroll tras flecha, no solo posición
positiva. Build/regresión y Next finales de este ajuste en curso.

El caso final incluye además insuficiencia real de stock: después de anular,
intentar 21 con saldo 20 debe devolver 409/INSUFFICIENT_STOCK, mostrar error y
conservar exactamente las filas/saldo previos. Repetir cero después del error
debe recuperar feedback con skipped=1, sin movimientos ni otra revisión.
Son dos solicitudes adicionales a las seis capturas principales.

Comandos reproducibles (en secuencia, con el cierre de Next autorizado fuera
del sandbox en Windows):

```powershell
$env:NODE_OPTIONS='--use-system-ca --max-old-space-size=4096'
pnpm.cmd run build
pnpm.cmd exec playwright test --config tests/playwright-sales-entry.config.ts
$env:RUN_SALES_RUNTIME_NEXT_BROWSER='1'
pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/sales-runtime-next-browser.test.ts --maxWorkers=1 --pool=threads
pnpm.cmd exec eslint app/dashboard/inventory/reports/page.tsx tests/e2e/sales-entry-feedback.spec.ts tests/integration/helpers/sales-runtime-database.ts tests/integration/helpers/sales-runtime-next-server.ts tests/integration/sales-runtime-next-browser.test.ts
pnpm.cmd exec tsx scripts/validate-faltantes.ts
```

## GREEN final y límites vigentes

**3/3, suite exit 0, 207.38 s** (200.76 s de casos), sobre el producto
con arreglo NULL `3fb7c37` y móvil `d4a09cf`; arnés guardado en
`fd4e07b2eb2874c8276fdc66b96f430a48bc0677`. Incluye copia/privilegios mínimos,
arranque/cierre y el recorrido real del formulario. No se filtran casos ni
se sustituyen API, auth, SQL o respuestas del writer.

La activación equivocada respondió 503 sin cambios. El login runtime real
confirmó seis capturas principales con saldos 10/8/12/12/12/20 desde saldo
inicial 20; cinco revisiones aplicadas y proyección monetaria 8025 centavos
sin nuevos movimientos al completar ingreso. Insuficiencia de 21 devolvió
409 con alerta visible y estado SQL idéntico; repetir cero recuperó el
feedback como skipped=1, sin otra revisión. El reporte real con conteos
ausentes conservó guiones y «Falta conteo», sin «Conforme». Fecha del reporte
y captura se editan después de hidratar; screenshot móvil real revisado,
documento de 390 px y scroll de tabla por teclado comprobados.

El teardown terminó con puerto cerrado y consultas que comprueban ausencia
de base y rol. El manifiesto local quedó databaseCreated=false,
roleCreated=false, closed=true; es corroboración, no la única prueba.
El origen y main no recibieron ventas, migraciones, alteraciones de rol
compartido ni terminación de sesiones.

Gates finales del ajuste móvil: build **exit 0**, compilación **4.4 min**,
TypeScript global, **455/455 páginas** (7.6 s) y optimización. Conserva los
avisos de base descritos antes. Regresión controlada final **17/17, exit 0,
1.4 min**, con NULL/cero, viewport y teclado. Lint de los cinco archivos
UI/arnés: exit 0 sin avisos. Validador: 239 filas, 105 hijos, 24 aceptaciones,
cero errores. Las once pruebas documentales pasan; los gates se ejecutan
en secuencia, sin repetir el build por cambios solo documentales.

Se acredita el recorrido manual Next→writer runtime→stock en la copia
desechable, no su despliegue en main, la conexión runtime de auth/lectores,
el CSV/cierre completos, carreras o aceptación del módulo. Dependencias
de b4b/manual.ui y la aceptación integrada siguen pendientes. No se acepta
este hijo, sus padres o fila 11.11 por el GREEN aislado.
