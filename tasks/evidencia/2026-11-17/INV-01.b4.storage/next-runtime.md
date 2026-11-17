# POS — Sesión y almacenamiento en Next de producción

Continuación del acceso UI de `eae5f46`. Se usa el build de producción de la
aplicación, Better Auth, la base aislada de `.env.test` y R2 reales.
`tests/integration/pos-next-browser.test.ts` no simula sesión, API, SQL ni storage.
Requiere opt-in `RUN_POS_NEXT_BROWSER=1` y un build previo.

## Hallazgo al ejecutar el runtime

La primera corrida falló al iniciar sesión: `POST /api/auth/sign-in/email`
devolvía 500. En el proceso Next apareció `TypeError: b.mask is not a function`
antes del error de conexión a Neon. El proceso Vitest sí podía consultar la
misma base usando el módulo `ws` nativo.

Se redujo la causa al bundle: `ws` intentaba usar el addon opcional `bufferutil`,
pero Webpack había sustituido su módulo ausente por una función que exportaba
un objeto vacío (`706085:()=>{}`). El require no lanzaba, por lo que `ws` instalaba
un wrapper que luego llamaba a `bufferUtil.mask`, inexistente.

La corrección añade `serverExternalPackages: ["ws"]` a `next.config.ts`.
Node vuelve a resolver el paquete y sus dependencias opcionales; no se fuerza
`WS_NO_BUFFER_UTIL`, no se modifica la autenticación ni se cambia el driver DB.
La opción está admitida por los tipos de Next 16.1.6 instalados y documentada
en [serverExternalPackages](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages).

El log anterior a la corrección se conserva localmente en
`.tmp/pos-next-before-external-ws.log`; no se versiona por contener detalles del
runtime y datos sintéticos de sesión/consulta.

## Primer incremento — regresión del runtime

| Control | Resultado |
|---|---|
| Antes de corregir, integración real | 1 fallo: login HTTP 500, `mask is not a function` |
| Build Webpack con `ws` externo y certificados del sistema | Código nativo 0, 665 s; compilación, tipos y 455 páginas completadas |
| `RUN_POS_NEXT_BROWSER=1`, integración real posterior | 1/1, exit 0; login 200, multipart 200, `durable: true`, corte vinculado y bytes R2 idénticos |
| ESLint de `next.config.ts` y la prueba | exit 0, sin diagnósticos |
| `git diff --check` | exit 0 |

Comando de integración: `NODE_OPTIONS=--use-system-ca --max-old-space-size=4096 RUN_POS_NEXT_BROWSER=1 pnpm exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/pos-next-browser.test.ts --maxWorkers=1 --pool=threads`.
El build se ejecutó con el CLI instalado de Next y se capturó su código nativo;
logs locales: `.tmp/pos-live-build.log` y `.tmp/pos-live-build-result.json`.
Hubo advertencias de caché de Webpack, deprecación de Neon y render estático de
documentos laborales; no impidieron el build. La prueba verificó limpieza de
empresa/sesiones y borrado del objeto R2. No se repitió la suite global.

## Entorno y limpieza

- Se verifica que el host de `TEST_DATABASE_URL` difiera del de la base operativa y que `DATABASE_URL` del proceso de prueba apunte a la aislada antes de sembrar.
- Empresas, sucursales, usuarios, cuentas y cortes son sintéticos, con UUID nuevos; se limpian al terminar, también si falla la prueba.
- La sesión se obtiene por login real; no se fabrican tokens ni se simulan guardias.
- Solo se elimina una key R2 después de verificar que pertenece al prefijo de la empresa/sucursal/día sintéticos de esta corrida. Se comprueba que no sea descargable después de eliminarla.
- El servidor usa un puerto libre y el teardown termina únicamente el árbol de procesos que inició esta prueba.
- Se desactivan las credenciales de mensajería y Redis para el servidor de prueba; R2 se mantiene real. No se aplican migraciones.

La primera consulta del rol confirmó `bypassRls: true`. Esta capa comprueba el
runtime y las fronteras de aplicación; no acredita NOBYPASSRLS ni acepta
`INV-01.b4.storage`, sus padres o la fila 11.11.
