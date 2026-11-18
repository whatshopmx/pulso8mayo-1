# V3 navegador del productor directo POS (`/dashboard/sales/upload`)

Continuación 2026-11-18 sobre HEAD `1c44f8d` más el árbol local. Cierra el hueco que `legacy-producer.md` dejó explícito: la ruta de carga ya escribía la key canónica y estaba probada por HTTP, pero ningún recorrido de navegador había ejercido la pantalla real. Sin aceptación de `INV-01.b4.storage` ni de sus padres.

## Qué se ejecutó

`tests/integration/pos-next-browser.test.ts` — un tercer caso, dentro del mismo arnés que ya usaba el cierre por smart link: Next de producción, Better Auth real, Neon aislado (`TEST_DATABASE_URL`) y R2 real, con Chromium headless y sin mocks de red.

1. Inicia sesión real (`POST /api/auth/sign-in/email`) y abre `/dashboard/sales/upload`.
2. Comprueba el título y que la sucursal de la empresa sintética venga seleccionada.
3. Fija la fecha operativa y adjunta el CSV de resumen de formas de pago por el `<input type="file">` real.
4. Pulsa «Subir Reporte y Procesar» y espera la respuesta de `POST /api/sales/cuts/upload`: **200**, `rows` con dos canales.
5. Comprueba que la pantalla **navega a una ruta existente** (`/dashboard/sales`) y que el encabezado «Ventas y Cortes de Caja» se pinta.
6. Lee la base: dos filas `UPLOAD` para la sucursal y el día capturado, canales `SALON` + `DELIVERY`, suma 1.000.000 ¢.
7. Verifica el contrato de storage: la key persistida cumple `companies/{companyId}/branches/{branchId}/pos/{día}/\d+_reporte_caja\.csv`, no es una URL, ambas filas comparten clave y los bytes en el bucket coinciden con el archivo subido.
8. Abre el corte recién creado con `GET /api/sales/cuts/[id]/pos-file`: 200, la clave firmada es la misma y la URL prefirmada entrega los bytes exactos. Éste es el cierre del círculo: lo que la pantalla escribe, la ruta autorizada lo puede leer.
9. Exige cero `pageerror` y cero respuestas `/api/**` con estado ≥ 400 durante todo el recorrido.
10. Limpia: cortes y sesiones por empresa sintética, y borrado verificado de los objetos de R2.

La captura del estado final queda en `.tmp/pos-direct-upload-browser.png` (no versionada).

## Verificación

| Comando | Resultado |
|---|---|
| `NODE_OPTIONS=--max-old-space-size=4096 node ./node_modules/typescript/bin/tsc --noEmit --incremental false` | exit 0 |
| `node ./node_modules/eslint/bin/eslint.js app/dashboard/sales/upload/client.tsx next.config.ts` | exit 0 |
| `PULSO_POS_BROWSER_TEST=1 NODE_OPTIONS=--max-old-space-size=6144 pnpm.cmd run build` | exit 0; «Compiled successfully in 2.3min», 455/455 páginas |
| `RUN_POS_NEXT_BROWSER=1 PULSO_POS_BROWSER_TEST=1 NODE_OPTIONS=--use-system-ca pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/pos-next-browser.test.ts` | **3/3**, 76,9 s, exit 0 |
| `NODE_OPTIONS=--use-system-ca pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads tests/unit/sales/sales-cut-upload-pos.test.ts tests/unit/sales/pos-file-read.test.ts lib/storage/__tests__/pos-upload.test.ts` | 39/39, exit 0 |
| Listado de R2 con el fixture (`_reporte_caja.csv` en `/pos/2026-11-16/`) tras la corrida | 0 objetos |

El arnés registra `POS runtime: {"bypassRls":true}`: la base aislada se usa con el rol dueño, no con `pulso_app`. Ver «Límites».

### Corridas intermedias (transparencia)

- **Intento 1:** 1/3. Los casos segundo y tercero murieron con **429** en `/api/auth/sign-in/email`: Better Auth limita el inicio de sesión por IP y el archivo abre varias sesiones seguidas. Se añadió un ayudante `signIn` que espera a que expire la ventana; no se relajó ninguna validación del producto.
- **Intento 2:** 2/3. El caso nuevo ya había subido y persistido el corte cuando falló `uploadedKeys is not defined`, un error del propio código de prueba (`uploadedKeys` pertenece al otro archivo de integración). Se sustituyó por `directKey`. El objeto de R2 que quedó huérfano se localizó y borró con un script puntual (`.tmp/clean-orphan-pos.ts`): 1 objeto, y el listado posterior da 0.
- **Intento 3:** 3/3, exit 0.

## Defectos encontrados

1. **Ruta de destino inexistente (corregido).** `app/dashboard/sales/upload/client.tsx` hacía `router.push("/dashboard/sales/cuts")` en los dos caminos (archivo y manual). Esa ruta no existe y no tiene redirección: un corte cargado con éxito terminaba en el 404 de Next. Ahora navega a `/dashboard/sales`, cuya pestaña «Registro de Cortes» es el registro real. El caso de navegador lo comprueba con `waitForURL` y el encabezado de la página.
2. **Los avisos de la aplicación no tienen superficie (no corregido).** `hooks/use-toast.ts` reenvía a `sonner`, pero ningún layout monta `<Toaster />`: no aparece en `app/layout.tsx`, ni en `app/dashboard/layout.tsx`, ni en el resto del árbol revisado. Consecuencia: los `toast(...)` de éxito y de error de esta pantalla —y de las demás que usan el mismo hook— no se pintan. Por eso este recorrido **no** afirma nada sobre el toast: acredita el efecto persistido y la navegación. Corregirlo es un cambio global, fuera de este incremento; queda registrado como brecha abierta.

## Límites

- **Sin runtime NOBYPASSRLS.** El recorrido usa el rol dueño del branch de `TEST_DATABASE_URL`. Acredita la frontera de aplicación (sesión → empresa → sucursal → día) y el contrato de storage, no RLS ni privilegios de `pulso_app`.
- **Sin concurrencia.** Una sola carga; no se prueban dos subidas simultáneas del mismo día/turno ni la carrera que puede dejar un objeto en R2 antes de detectar el duplicado.
- **Una sucursal, un rol.** El caso usa `ADMIN` con una única sucursal en la empresa sintética. La matriz de roles y de sucursales ajenas ya está cubierta por HTTP en `pos-storage-r2-db.test.ts` (403/400/404) y por las unitarias de la ruta.
- **Destino verificado, pestaña no.** El caso comprueba que se aterriza en `/dashboard/sales` y que el encabezado existe; no automatiza el clic en la pestaña «Registro de Cortes» ni la búsqueda de la fila en la tabla.
- **El build de este recorrido no es el build de `.next`.** Para no competir con el `next dev` del desarrollador, el arnés corre contra `.tmp/next-pos-browser` mediante el nuevo interruptor `PULSO_POS_BROWSER_TEST=1` (mismo patrón que `PULSO_REPORT_BROWSER_TEST`). Es un build de producción completo (455/455), pero no renueva la acreditación del árbol por sí mismo.
- No se aplican migraciones ni se despliega. Se mantienen **24 registros aceptados**; `INV-01.b4.storage`, `INV-01.b4`, `INV-01.b` y la fila 11.11 siguen abiertos: falta runtime NOBYPASSRLS, concurrencia y las dependencias (`b4b`, cobertura financiera y checkpoint).
