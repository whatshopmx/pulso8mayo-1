# Frontera POS con Next y writer runtime

Base `ff8cbed`, árbol limpio antes de registrar. Código probado `d184a88`.
Hijo A/M V2, scope de dos
archivos: `helpers/pos-runtime-scenario.ts` y suite Next/runtime existente.
Reutiliza helpers CSV/base/servidor. Dependencias y criterios en el plan.

Implementado: HTTP real a upload-pos, R2 y PostgreSQL, sin mocks. Se comprueba fuente
compartida con bulk, corrección/repetición/ingreso/cero y error de stock que
conserva evidencia con advertencia. JSON solo enlaza. Limpieza de objetos
limitada al prefijo de empresa/sucursal/día sintéticos; base/rol desechables.
Flag adicional `RUN_SALES_RUNTIME_POS=1` junto al opt-in existente.

No acredita UI de cierre: no se encontró llamada al endpoint desde clientes
actuales al buscar su URL literal. Los recorridos previos invocan esta frontera
por HTTP. Tampoco acredita runtime del almacenamiento: auth/enlace de cortes
siguen con dueño, solo el writer usa el login mínimo. Sin migración/despliegue
ni aceptación.

Primera corrida básica: 4/5, exit 1, 400.40 s (385.29 s en pruebas).
Los cuatro casos anteriores pasan. El nuevo caso obtuvo 200 al subir e ingerir,
leyó bytes idénticos desde R2, comprobó la key en el corte y recibió 200 al
consultar su lectura autorizada. Falló la aserción propia `file.key`: el
contrato entrega `fileKey`. Se corrigió la prueba, sin tocar producto. Su
finally borró y verificó los objetos del prefijo y afterAll retiró base/rol.

El caso ampliado comprueba 10 por POS → 12 por bulk → 8 por POS bajo una sola
identidad, repetición con otro nombre sin descuento nuevo, ingreso 8025 sin
movimientos extra, 21 rechazado sin hechos y con evidencia/advertencia,
enlace JSON sin ingestión, cero que devuelve los dos saldos a 20 y logout
que impide leer/escribir sin crear objetos. Se verifican seis archivos del
prefijo sintético antes de retirarlos. No hay mocks de red/auth/SQL/R2.

Inspección del cliente: `components/workflow/workflow-executor.tsx:291`
sube archivos por `uploadFiles`/`usePhotoUpload` y envía la evidencia al PATCH
de pasos. La página pública monta `components/execution/workflow-stepper.tsx`,
cuyos handlers actuales son de foto/video/audio mediante la carga genérica.
No se modifica ese comportamiento en esta prueba HTTP; conectar y probar
el archivo POS en el workflow queda como incremento de UI separado.

```powershell
$env:NODE_OPTIONS='--use-system-ca --max-old-space-size=4096'
$env:RUN_SALES_RUNTIME_NEXT_BROWSER='1'
$env:RUN_SALES_RUNTIME_POS='1'
pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/sales-runtime-next-browser.test.ts --maxWorkers=1 --pool=threads
pnpm.cmd exec eslint tests/integration/helpers/pos-runtime-scenario.ts tests/integration/sales-runtime-next-browser.test.ts
pnpm.cmd exec tsx scripts/validate-faltantes.ts
pnpm.cmd exec vitest run --configLoader bundle tests/unit/faltantes-traceability.test.ts --maxWorkers=1 --pool=threads
```

Lint exit 0, trazabilidad 11/11 y validador 239 filas/86 bases/107 hijos/
24 aceptaciones/0 errores. Build anterior verificado reutilizado: solo se
añaden pruebas excluidas de tsconfig y documentos. Sin cambios de aplicación.

Corrida final ampliada: **5/5, exit 0**, 374.86 s (367.75 s en pruebas).
Incluye POS, catálogo/permisos, servidor, manual y CSV. Limpieza R2 acreditada
por listado real vacío del prefijo tras borrar todos sus objetos; base/rol
retirados y ausencia consultada por SQL, servidor salido y puerto cerrado.
Manifest adicional `databaseCreated:false`, `roleCreated:false`, `closed:true`.
No se escribe en el origen para limpiar hechos inmutables ni se terminan sus
clientes. Ejecución autorizada fuera del sandbox para retirar Next propios.
Revisión de corrección, legibilidad, arquitectura, seguridad y costo sin
hallazgos pendientes dentro del alcance de prueba. No se acepta el hijo ni
el padre por estas pruebas: dependencias y cierre real del workflow pendientes.
