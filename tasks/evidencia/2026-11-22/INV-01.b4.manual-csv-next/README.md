# Captura manual/CSV — continuación sobre el build vigente

Actualización posterior: [4/4 sobre copia existente y aceptación de manual.next/ui.next](../INV-01.b4.next-copy/README.md). Se conservan aquí resultados y límites de la corrida anterior sobre fresh-baseline.

Base `d05eae09d67ed0b190b6785da168a8fb8b564fd0` + árbol compartido. **Validación terminada: 4/4 seleccionados, exit 0**. [Revisión y aceptación delimitada de cinco hijos](accepted.md). Los hijos de aceptación Next conservan pendiente la puerta de copia de base existente; no se cierran padres ni fila 11.11.

Se reutiliza el arnés real de Next/Chromium/Better Auth/PostgreSQL. `RUN_SALES_FRESH_BASELINE=1` selecciona explícitamente template0 + snapshot 0158 y SQL custom del writer, con login UUID mínimo, en el endpoint aislado. El modo por defecto sigue copiando el origen; esta variante no acredita la actualización de una base existente. Los cuatro casos seleccionados cubren permisos/DDL, arranque/cierre, captura manual y CSV. Los tres casos POS/R2 del mismo archivo quedan fuera de esta corrida y no se cuentan como éxitos.

La revisión de criterios mantiene separada la puerta de copia de base existente de b4.manual.next: el éxito de la variante fresh-baseline no acredita ese requisito ni una migración operativa. No se sustituye la prueba de copia por la reconstrucción del snapshot para aceptar ese hijo. Los resultados funcionales sí pueden respaldar los criterios de manual/bulk/UI dentro de su alcance, una vez terminada la corrida.

## Resultados y defecto encontrado

Primera corrida sobre el build 10116 (BUILD_ID `ZRQwzXGgi_I_-8_OWNYkx`): **3/4 seleccionados**, exit 1, 144.32 s. Pasaron permisos mínimos/inmutabilidad, arranque/cierre y el recorrido manual completo: runtime dueño rechazado con 503 sin fallback; 10→12→8, repetición, ingreso $80.25→8025 sin otro movimiento, cero, insuficiencia 409 sin efectos, recuperación de feedback, móvil y teclado. CSV falló antes del POST, al no aparecer el nombre del primer archivo seleccionado. Ningún padre se acepta por estos tres éxitos.

Se conservan el log y reporte de ese fallo en `.tmp/manual-csv-next-first-failure*`. Un diagnóstico focal posterior sin escalación terminó con AbortError en el arnés; no cuenta como GREEN. PID 10052 y puerto 58547 se comprobaron ausentes al terminar, al igual que base/rol. La ejecución autorizada fuera del sandbox permite el taskkill limitado a los Next creados por la prueba; no interviene otros procesos ni el origen.

Una reproducción con los scripts de Next retenidos confirmó la ventana de interacción del HTML servidor: **`disabled=false`, `reactProps=false`**. El caso reforzado exige selector deshabilitado en ese estado y luego lo habilita al liberar los scripts para recorrer toda la importación. RED real: aserción toBeDisabled recibe enabled; exit 1, 48.31 s, con limpieza correcta. No se aumentó el timeout de selección ni se eliminó ninguna aserción monetaria, de identidad, stock, errores o sesión.

La corrección afecta únicamente a SalesEntryClient: snapshot servidor false y cliente true mediante useSyncExternalStore, fieldset deshabilitado/aria-busy hasta conectar los manejadores y estado visible «Preparando carga de ventas…». Las funciones de snapshot/subscripción tienen identidad estable. [Contrato SSR/hidratación de React](https://react.dev/reference/react/useSyncExternalStore#adding-support-for-server-rendering). Se mantienen los tokens, composición y comportamientos existentes; no se cambian parsers, endpoints, permisos ni consumo.

## Verificación posterior al cambio

- RED unitario SSR: HTML sin disabled en fieldset. GREEN posterior: el HTML se entrega deshabilitado, aria-busy y role=status. Un caso reforzado aprobado, exit 0, 8.31 s.
- **28/28 focales**, cinco archivos, exit 0, 24.48 s. Incluye SSR, selector de conexión, fronteras manual/bulk y servicio de ingestión. El caso reforzado SSR posterior se solapa con esos 28; no se suman como 29.
- **17/17 navegador controlado**, exit 0, 2.4 min: componente/CSS reales, respuestas explícitas del arnés sin DB/auth. Cubre NULL/cero, pesos, feedback/error/reintento, cambio de sucursal, errores extensos, vinculación de respuesta, teclado y móvil. No sustituye la prueba Next integrada.
- ESLint del componente y dos pruebas: exit 0, sin avisos.
- Build nuevo posterior al componente: sesión **29721 terminada con exit 0**, `NODE_OPTIONS='--use-system-ca --max-old-space-size=4096' pnpm.cmd run build --webpack`. Compilación 7.4 min, TypeScript global correcto, 455/455 páginas en 17.6 s y optimización/traces completados. BUILD_ID `bBmXOvXw0G4OayubgEgi3`. Conserva los avisos conocidos de fetchConnectionCache y documentos laborales dinámicos por headers. Los anteriores builds no se atribuyen a este último cambio.
- Repetición de los cuatro casos reales sobre ese nuevo build: **sesión 40116 terminada con exit 0**, 227.73 s. Cuatro seleccionados aprobados y tres POS/R2 omitidos explícitamente fuera de alcance. El wrapper comprobó los cuatro nombres y report.success. Base y rol retirados/verificados; todos los servidores propios cerrados, sin listener. SSR observado: **disabled=true, reactProps=false**; al liberar scripts se habilita el selector y pasa todo el recorrido CSV. [Reporte reducido con hashes](results.json).
- Revisión visual de los tres renders frescos: estado SSR visible sin colisiones; manual y CSV a 390 px sin desbordamiento de página, controles y feedback legibles, tablas con desplazamiento acotado y teclado comprobado. Capturas junto a este archivo. Sin error de página en ambos recorridos.

Comandos reproducibles, en secuencia:

```powershell
pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads tests/unit/inventory/sales-entry-readiness.test.ts tests/unit/inventory/sales-runtime-connection.test.ts tests/unit/inventory/sales-entry-access.test.ts tests/unit/inventory/sales-entry-bulk.test.ts lib/services/__tests__/sales-ingest-service.test.ts
pnpm.cmd exec playwright test --config tests/playwright-sales-entry.config.ts tests/e2e/sales-entry-feedback.spec.ts
$env:NODE_OPTIONS='--use-system-ca --max-old-space-size=4096'
pnpm.cmd run build --webpack
$env:RUN_SALES_RUNTIME_NEXT_BROWSER='1'
$env:RUN_SALES_RUNTIME_POS='0'
$env:RUN_SALES_FRESH_BASELINE='1'
pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/sales-runtime-next-browser.test.ts --maxWorkers=1 --pool=threads -t 'disposable sales database|production Next starts|manual sales|CSV SKU' --reporter=default --reporter=json --outputFile=.tmp/manual-csv-next-verify-report.json
```

La ejecución de Next y su cierre en Windows necesitan la autorización de sandbox ya concedida para el wrapper `node .tmp/manual-csv-next-verify.cjs`. Los manifiestos sólo guardan identificadores/estado, no URI/contraseñas. No se activa producción ni se aplican migraciones operativas.
