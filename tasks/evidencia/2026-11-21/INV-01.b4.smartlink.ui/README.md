# Captura POS desde el paso de cierre

Base `009e351`, árbol limpio al comenzar. Primer incremento probado `0105111`: componente
compartido, WorkflowStepper, harness, spec y configuración de navegador.
V1/V3 controladas previstas, sin sustituir Next/R2/runtime reales. La ruta
probada por smartlink.next sigue exigiendo sesión/capacidad; no se habilita
ingestión mediante token público. Sin despliegue/aceptación.

Problema: la plantilla declara smart_link/target upload-pos, pero el stepper
solo presenta tipos genéricos y no envía archivos a esa ruta. El executor
alternativo y la persistencia de la configuración se abordarán después;
este hijo no se acepta hasta completar sus recorridos/dependencias.

Criterios y límites del primer incremento en el plan. Se hereda el mundo
visual de Pulso: Operate, controles existentes, sin sombras ni cambios de
identidad. Se distingue evidencia de ingestión.

## Primer incremento

`config.posUpload: true` o `smartLinkTarget` legacy exacto activan un control
compartido. El target nunca se usa como URL dinámica: la carga siempre va a
upload-pos. Sucursal del objeto de ejecución, fecha civil editable inicializada
en cliente tras hidratación (sin fecha UTC de SSR), CSV entrecomillado y mapping
incluido SKU estable. Envío multipart con guardia de solicitud en curso y
controles bloqueados. Editar archivo/día/mapping invalida resultado y key.
El stepper no avanza ni retrocede con archivo pendiente; sin durabilidad no
obtiene referencia confirmada. Preview permite recorrer sin escrituras.

Guardar evidencia y completar el paso son acciones separadas. El resultado
expone durabilidad, cortes vinculados, nuevas/corregidas/sin cambios, cobertura,
advertencia y filas omitidas. Puede completar un paso con evidencia durable
y advertencia de ventas (contrato de la ruta), sin presentarlo como éxito
de todas las ventas. HTTP 401/403/red mantienen archivo y mapping para corregir
y reintentar; sesión abre sign-in en otra pestaña. Persistencia del paso lleva
key en evidenceUrl y fecha/nombre/resumen/advertencia en value, sin duplicar
ingestión al pulsar Siguiente.

RED: la prueba vio título y textarea genérico, sin input Archivo del POS;
exit 1 (1/1), contexto de Playwright confirma la UI cargada. GREEN inicial
1/1; ampliada 10/10; regresión final **27/27** (10 POS + 17 manual/CSV),
exit 0, 2.1 min. Incluye envío retenido, invalidación, key/value al avanzar,
401/403/red y reintento, errores de fila, cobertura, no durabilidad, target
legacy, preview, falta de sucursal, móvil sin overflow y navegación con Tab.
Son respuestas sintéticas explícitas; no sustituyen Next/R2/runtime.

Unitarias de contratos/acceso/conteo y trazabilidad: **61/61**, cuatro archivos,
exit 0. Lint de cinco archivos exit 0; componente/harness/spec/config sin
advertencias. Stepper: 24 advertencias preexistentes; comparación JSON contra
HEAD `009e351`: 24 antes/24 después, cero errores y cero mensajes añadidos.
El registro documental omitía las dependencias heredadas de INV-01.b; el
validador lo rechazó y se corrigió a/b3/b4b explícitos. Después: 239 filas,
86 bases, 108 hijos, 24 aceptaciones, 0 errores.

[Revisión visual independiente](design-review.md): **ship**, cinco secciones
del contrato, sin hallazgos materiales. Capturas escritorio/móvil del fixture
sintético inspeccionadas en un lote; estados error/pending/foco por código.
No se reescribe DESIGN.md ni sidecar por esta extensión local.

Build inicial exit 1 solo por descarga de Geist/Geist Mono. Repetición
autorizada fuera del sandbox, con `--use-system-ca` y heap 4096 MB: **exit 0**,
compilación 2.5 min, revisión global TypeScript y 455/455 páginas en 3.8 s.
Warnings ya conocidos: fetchConnectionCache deprecado y ruta de documentos
laborales dinámica por headers, conservada como dinámica; no se omiten gates.

DevTools en contexto aislado confirmó el árbol accesible del preview: archivo
y guardado deshabilitados, fecha civil y Siguiente disponible; consola sin
errores/advertencias. Solo inspección de localhost, sin mutaciones ni acceso
a credenciales. Página cerrada y servidor efímero autorretirado, exit 0.

```powershell
pnpm.cmd exec playwright test --config tests/playwright-sales-entry.config.ts
pnpm.cmd exec eslint components/workflow/pos-upload-step.tsx components/execution/workflow-stepper.tsx tests/support/sales-entry-browser-server.ts tests/e2e/pos-workflow-feedback.spec.ts tests/playwright-sales-entry.config.ts
pnpm.cmd exec vitest run --configLoader bundle tests/unit/faltantes-traceability.test.ts tests/unit/workflows/step-contract.test.ts tests/unit/workflows/step-access.test.ts tests/unit/workflows/stock-count-step.test.ts --maxWorkers=1 --pool=threads
$env:NODE_OPTIONS='--use-system-ca --max-old-space-size=4096'
pnpm.cmd run build
pnpm.cmd exec tsx scripts/validate-faltantes.ts
```

Incremento posterior de dos archivos en curso: fixture de workflow sintético
(dos pasos; el último queda pendiente para no disparar efectos externos) y
helper POS existente. Sustituye seis multipart HTTP directos por selección
real del archivo, mapping, fecha y botón en Next de producción. Conserva los
oráculos de writer/R2 y añade feedback visible y persistencia del paso sin
otra ingestión.

Primera corrida integrada sobre el build nuevo: 4/5, exit 1, 428.50 s;
caso POS 149.847 s. Los cuatro casos previos pasan. POS recorrió seis cargas,
interoperabilidad con bulk, stock/ingreso/cero, bytes/key/lectura de R2 y
Siguiente hasta el segundo paso; la key quedó persistida con actor/estado
correctos. El oráculo final intentaba JSON.parse(String(value)), pero el
servicio normaliza el valor a objeto JSONB. Se corrigió la aserción al objeto
y al resumen que guarda el cliente (no a campos adicionales del resultado
HTTP). No se modifica producto ni se repite build por esa corrección de test.
Repetición focal POS: **1/1, cuatro omitidas por filtro, exit 0**, 218.77 s
(214.14 s en pruebas), código `6edbb31`. Las cuatro regresiones verdes de la
corrida anterior corresponden al mismo build; no se presenta como una nueva
corrida conjunta 5/5. Solo cambiaron pruebas después del build `0105111`.

Se comprueban las seis cargas por UI (alta, renombre/repetición, reducción,
ingreso, insuficiencia y cero), además de la corrección a 12 por bulk bajo
la misma identidad. Resultado visible y errores por fila, saldos/revisiones,
bytes/key/lectura firmada y seis objetos conservados hasta la limpieza.
Siguiente persiste objeto JSONB con día/nombre/resumen, key y actor del paso;
el workflow queda IN_PROGRESS en revisión final y ventas/movimientos/revisiones
siguen iguales. Logout rechaza lectura/subida y no crea objetos nuevos.
Sin pageerror. Pantalla Next real 390×844 sin overflow; capturas del segundo
y último lote visual inspeccionadas:
`.tmp/pos-workflow-next-mobile.png` y `.tmp/pos-workflow-next-desktop.png`.
El veredicto visual independiente original corresponde al fixture controlado;
las capturas Next son verificación adicional del mismo componente y alcance.

Retiro verificado: listado R2 vacío del prefijo sintético, base y rol ausentes
por SQL, proceso salido y puerto cerrado. Manifest adicional con
`databaseCreated:false`, `roleCreated:false`, `closed:true`. Se conserva RLS e
inmutabilidad en la copia; no hay escrituras de hechos ni cierre de clientes
en el origen. Lint de ambos helpers exit 0.

```powershell
$env:NODE_OPTIONS='--use-system-ca --max-old-space-size=4096'
$env:RUN_SALES_RUNTIME_NEXT_BROWSER='1'
$env:RUN_SALES_RUNTIME_POS='1'
pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/sales-runtime-next-browser.test.ts --maxWorkers=1 --pool=threads -t 'POS ingestion and evidence'
pnpm.cmd exec eslint tests/integration/helpers/pos-runtime-scenario.ts tests/integration/helpers/pos-workflow-fixture.ts
```

El stepper principal lo usan Mis tareas, listado de workflows y lanzador
(`/dashboard/workflows/[id]/execute`). Pendientes: segundo executor de la ruta
alternativa y configuración instalada del template; el hijo sigue en curso.
La carga conserva autenticación de sesión; un token público solo no autoriza
ventas. Auth/enlace/storage siguen usando dueño; dependencias/aceptación y
despliegue permanecen abiertos.
