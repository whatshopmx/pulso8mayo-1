# Captura manual visible y consolidación del CSV

Base: `07055084df845584047e449f24d4bb68b42dd086`, árbol limpio al comenzar.
Hijo `INV-01.b4.manual.ui` de INV-01.b, I/M, V1/V3; depende de INV-01.a,
manual y la UI CSV canónica. La fila 11.11 y su aceptación M11 incorporan
este hijo; se conservan estados históricos y 24 aceptaciones.

Scope de código (cinco archivos): página de reportes, componente
`manual-sales-entry.tsx`, harness Vite, spec de feedback y suite de navegador
Next existente. La actualización de plan/mapa/matriz/checklist/evidencia es
un incremento documental separado. Ningún cambio de schema, migración o API.

La pantalla enviaba 8025 al escribir $80.25, mientras la API espera pesos y
convierte por sí misma a centavos. Además, `|| undefined` perdía cero,
el día era siempre un timestamp del momento, se limpiaban campos al guardar
y se anunciaba deconsolidación incluso al repetir. Los avisos toast no
tenían superficie montada. El CSV local duplicaba parseo/fuzzy matching,
forzaba cantidad cero a uno y enviaba el archivo con identidad manual.

El formulario nuevo envía pesos sin multiplicar ni redondear; vacío es NULL,
0 permanece explícito. Captura día civil editable y total por receta/día;
permite cero de anulación. Conserva valores al guardar para repetir/corregir;
muestra nuevas/corregidas/sin cambios, cobertura y errores visibles con
reintento. Bloquea controles/envíos repetidos, limita espera a 30 s y no
confirma una respuesta de la sucursal anterior. No promete movimientos por
un resultado repetido. Labels y teclado usan controles existentes.

El CSV duplicado se sustituye por un enlace visible al importador existente
`/dashboard/inventory/sales-entry`, con su preview, mapeo y fuente POS.
No se elimina ningún endpoint ni formato de archivo. Para quien cargaba un
CSV en reportes: pulsa «Importar CSV de ventas», elige archivo/día, revisa
columnas y confirma allí solo para ventas nuevas. Para ventas ya registradas
en reportes, corrige su total manual para ese día; no reimportes el mismo
contenido con otro origen. La tarjeta lo indica. No hay backfill ni
conversión/adopción de hechos anteriores: la política completa de propiedad
de consumo entre fuentes sigue en INV-02.

RED de navegador controlado: el caso de $80.25 recibió **8025**, exit 1,
20.0 s de caso. Dos intentos previos eran del arnés (JSX virtual sin
transformar y cache compartida entre dos servidores Vite); se corrigieron
sin cambiar producto para acomodarlos. Los dos modos usan caches separadas;
el mock de Link solo sustituye navegación Next en el harness aislado.

GREEN inicial: cuatro escenarios manuales, **4/4, exit 0, 53.8 s**. Regresión
completa posterior con CSV: **13/13, exit 0, 1.4 min**. Se añadieron después
los casos de precisión/fecha vacía y respuesta tardía al cambiar sucursal;
pendiente registrar su ejecución final. Estas respuestas HTTP son sintéticas:
no acreditan escrituras desde un Next real.

Regresión de rutas/ingestión: **51/51, exit 0, 15.89 s**. Lint de los cinco
archivos pasó antes de los dos casos finales. La primera revisión visual
móvil detectó falta de separación entre ayuda y botón dentro del fieldset;
se añade separación con el token existente y aserción geométrica (mínimo
12 px). Captura local: `.tmp/manual-sales-mobile.png`, solo datos sintéticos.

En Next real se usa un SUPERVISOR con lectura y sin inventory:manage. Ese
rol impide escrituras independientemente de la fecha/cantidad que envíe una
UI rota, evitando confirmar revisiones append-only para probar errores.
El caso recorre pesos, cero, NULL, 403, logout 401, login y nuevo 403, error
visible, móvil y teclado. Se verifican ventas sin cambios y cero identidades
canónicas; fixtures y sesiones se eliminan al terminar. No simula API/auth/DB.

Límites: el caso Next acredita denegaciones y recuperación de sesión, no un
guardado exitoso ni devolución de stock desde Next. Ese writer ya tiene
[HTTP/SQL real por separado](../INV-01.b4.manual/README.md). El recorrido
conjunto Next→runtime independiente→stock, las dependencias y la aceptación
de INV-01.d siguen pendientes. No se acepta este hijo, padres ni fila 11.11.
Resultados finales de Next, navegador, tipos y build en curso.

Primer intento Next completo: **3/4 casos, exit 1, 362.85 s**; las tres
regresiones pasaron y el caso manual agotó `page.goto` (180 s). El log del
servidor registró panic Rust de Turbopack en `aggregation_update.rs`
(`inner_of_uppers_lost_follower`), antes de cargar la página. No se rebajó
ninguna aserción; cierre del servidor y limpieza de empresas/sesiones
comprobados. Se confirmó `next dev --help` de la versión instalada y se
cambió únicamente el bundler del arnés a `dev --webpack`. No se modifica
`next.config.ts` ni el bundler del producto. Reintento autorizado fuera del
sandbox por la restricción conocida de `taskkill`.

Primer Webpack: **exit 1, 189.74 s, cuatro casos sin ejecutar**. El config
temporal heredaba `@/*` relativo al directorio `.tmp`, y Webpack no resolvía
`@/lib/auth` (probe 500). Se explicita `@/* → ../*` solo en ese config
generado y se hace fallar el arnés ante un probe 5xx, sin esperar 180 s a
un error de compilación confirmado. El cierre HTTP reutilizaba una conexión
keep-alive y obtuvo ECONNRESET: se sustituye por un probe TCP nuevo que exige
ECONNREFUSED; timeout u otro error siguen fallando. En el intento fallido
también se verificó la limpieza de fixtures y sesiones.

Navegador controlado ampliado: **15/15, exit 0, 1.7 min**, seis manuales y
nueve de CSV. Precisión/fecha vacía y respuesta tardía entre sucursales
comprobadas; captura móvil revisada otra vez con separación entre ayuda y
botón y sin desbordamiento. Lint final de cinco archivos: exit 0 sin avisos.

La comprobación de Next descubrió después un bloqueo real de identidad del
pool entre bundles, corregido en un incremento separado de
[COGS/driver](../INV-01.b4.coverage.cogs/runtime-driver.md). Esa corrección
sí añade Neon a `serverExternalPackages`; no cambia el bundler del producto.
El arnés final ejecuta por defecto un build actual de **Next de producción**;
`REPORT_BROWSER_DEV=1` mantiene el modo Webpack aislado para diagnosticar.
Se espera hidratación real antes de pulsar la pestaña COGS y el cierre se
comprueba con socket TCP nuevo y espera acotada hasta ECONNREFUSED.

Los 51 unitarios del recorrido y 11 de trazabilidad pasan por separado
(62 pruebas sin solapamiento). TypeScript global y lint de seis archivos,
incluida la configuración del driver: exit 0. Build nuevo en curso.
La compatibilidad CSV anterior ya alcanzó el caso completo con ceros;
la primera corrida falló en el arranque del harness antes de mostrar la UI,
y el reintento pasó el caso (32.4 s) pero se interrumpió antes de cerrar la
suite, por lo que no cuenta como GREEN global. Se precarga zod para evitar
recargas del optimizador durante edición. Se repetirá la suite completa con
el CSS del build final.

Build final **exit 0**: compilación en **2.7 min**, TypeScript completo,
**455/455 páginas** (generación 6.0 s) y optimización final. Conserva los
avisos previos `fetchConnectionCache` deprecado y `DYNAMIC_SERVER_USAGE` en
documentos laborales por `headers` (ruta dinámica). La corrida final Next
usa ese build y el código sin instrumentación temporal.

Continuación sobre HEAD `07b2a69bd6ee48c6159cd8c41a3b8c8445220408`:
navegador controlado final **16/16, exit 0, 1.9 min**, incluye compatibilidad
del CSV anterior y ceros. Next real **3/4, exit 1, 126.36 s**: manual, menú
y COGS pasaron; ejecutivo agotó 30 s intentando editar fechas mientras la
lectura inicial mantenía los campos deshabilitados. Se añade espera explícita
de la respuesta HTTP inicial (90 s, exige 200) antes de editar fechas.
Un reintento se invalidó al arrancar un build concurrente que reemplazó
`.next`: probe 500/MODULE_NOT_FOUND, cuatro casos sin ejecutar. Build
interrumpido; cierre y limpieza de fixtures comprobados. Se reconstruye
antes de repetir navegador en secuencia. Ningún fallo cuenta como GREEN.

Corrida final en secuencia, mismo código que commit `8be0ecd`: **4/4 Next
de producción + Chromium + Better Auth + Neon aislado, exit 0, 94.26 s**
(88.09 s de casos). Pasan ejecutivo, menú, COGS y captura manual, incluido
logout/login, permisos, teclado y móvil. El teardown verifica empresas y
sesiones eliminadas y socket del servidor cerrado. La respuesta inicial se
verifica antes de editar fechas; no se altera el producto para ese ajuste.

Gates finales: build **exit 0**, compilación 3.7 min, TypeScript global,
455/455 páginas (11.9 s) y optimización. Se conservan los avisos de
`fetchConnectionCache` y ruta laboral dinámica ya descritos. Lint de cinco
archivos UI/harness pasó; el archivo Next volvió a pasar lint tras el ajuste.
63 regresiones unitarias y 7 HTTP manual/bulk reales pasan en esta
continuación; no se suman a la cifra de navegador como si fueran V3.
La revisión visual final del móvil controlado confirma separación y ausencia
de desbordamiento. No se repite build por cambios solo documentales.

Implementación guardada en `8be0ecd`; bulk en `5c4a849`. La aceptación
integrada y el guardado exitoso Next→runtime independiente→stock siguen
pendientes, junto con las dependencias declaradas. No se acepta el hijo ni
la fila 11.11 por estas pruebas separadas.
