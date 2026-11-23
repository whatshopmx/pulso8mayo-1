# POS — repetición Next actual y aceptación de la frontera smartlink

2026-11-22. Base `d05eae09d67ed0b190b6785da168a8fb8b564fd0` + árbol compartido. **INV-01.b4.smartlink aceptado V1/V2**, con a/b3/b4b aceptadas. Se acredita su frontera de ingestión/vínculo; no se aceptan storage, smartlink.next/ui, b4/b/d ni fila 11.11 por estos resultados. Mapa: 34 registros aceptados.

Tres casos POS completos sobre copia del origen aislado, Next producción BUILD_ID `bBmXOvXw0G4OayubgEgi3`, Chromium, Better Auth, Neon y R2 reales. Sin mocks de API/auth/SQL/R2. **3/3 seleccionados, exit 0, 287.76 s**; cuatro manual/CSV/infraestructura fuera de selección, no contabilizados como éxitos. [Reporte con nombres, duración, limpieza y hashes](results.json). Los [4/4 manual/CSV de la otra corrida](../INV-01.b4.next-copy/README.md) completan los siete casos del archivo en dos ejecuciones distintas; no se presenta una sola corrida de siete.

| Criterio smartlink | Prueba |
| --- | --- |
| Sesión/capacidad y empresa/sucursal antes de escribir | Unitarias de frontera/lectura/productor directo; rol ausente/EMPLEADO, gerente ajeno, tenant discrepante y referencias de empresa/sucursal/día ajenos rechazados. Next real termina sesión y rechaza lectura/escritura con estado SQL y objetos sin cambios. Las negativas HTTP/R2 previas conservan su [evidencia](../../2026-11-17/INV-01.b4.storage/README.md). |
| Día civil y cortes acotados | Unitarias verifican filtro empresa/sucursal/día y día imposible. Next enlaza exactamente un corte sintético de ese scope y comprueba su key. |
| Mapping explícito, SKU y fuente común | UI selecciona mapping/fecha y fuente pos:import. POS 10→bulk 12→POS 8 conserva identidad; renombrar archivo produce otra key de evidencia sin nuevo consumo ni revisión. |
| Ingreso y errores | NULL incompleto; completar 80.25→8025 no cambia movimientos. Insuficiencia 21 conserva stock/hechos, persiste evidencia con advertencia visible. Grupos descartados conservan errores/cobertura false en unidad. |
| JSON sólo enlaza | Relaciona la primera key, sin sales ni cambios de stock/revisiones/identidad. Cero posterior devuelve los dos saldos a 20. |
| Guardado de paso sin reingestión | Ambos executors suben por input/mapping/botón reales; Siguiente persiste key/valor/completedBy, mantiene instancia en progreso y no vuelve a ingerir. No completa último paso ni dispara acciones externas. |

Los otros dos casos verifican executor alternativo e instalación desde catálogo: flag posUpload persistido, clonación, edición Ctrl+S y recarga conservan configuración. Cuatro renders frescos (dos executors, escritorio/móvil) revisados, controles/resultados dentro de tarjeta, sin desbordamiento ni errores de página; capturas junto a este archivo.

**56/56 unitarias POS**, cinco archivos, en dos comandos: 46 en frontera/lectura/productor/plantilla (6.70 s) y diez de almacenamiento (dentro de 21 junto a once de trazabilidad, 0.861 s). No sumar esas once como pruebas POS ni duplicar la regresión previa. Comandos:

```powershell
pnpm.cmd exec vitest run --configLoader bundle tests/unit/inventory/sales-entry-smart-link.test.ts tests/unit/sales/pos-file-read.test.ts tests/unit/sales/sales-cut-upload-pos.test.ts tests/unit/workflows/pos-template.test.ts --maxWorkers=1 --pool=threads
pnpm.cmd exec vitest run --configLoader bundle lib/storage/__tests__/pos-upload.test.ts tests/unit/faltantes-traceability.test.ts --maxWorkers=1 --pool=threads
node .tmp/manual-csv-next-verify.cjs pos
```

El wrapper exige tres nombres aprobados y report.success. Flags RUN_SALES_RUNTIME_NEXT_BROWSER=1/RUN_SALES_RUNTIME_POS=1/RUN_SALES_FRESH_BASELINE=0. Copia/rol y procesos retirados/verificados; en cada tenant se comprueban seis objetos y se borran sólo los de su prefijo privado, con listado final vacío. No se termina ninguna sesión ni se escriben hechos del origen. Se reutiliza build aprobado con tipos/455 páginas, sin cambios de aplicación desde ese gate; nuevas pruebas excluidas de TypeScript de producción. [Historial de evidencia parcial](evidence-history.json).

Checkpoint final: validador **239 filas/86 bases/114 hijos/34 aceptados/0 errores**, exit 0; **11/11** trazabilidad, exit 0, 0.456 s (repetición de las once ya contadas, no once nuevas); git diff --check exit 0. ESLint de la prueba nueva SQL: exit 0 sin avisos. Revisión del test sobre corrección, legibilidad, límites, seguridad y coste: datos exclusivamente sintéticos en base nueva, opt-in explícito, pool con cierre antes de retirar DB/rol, prueba sin contexto con SQL amplio y oráculo independiente tras commit. Sin hallazgos pendientes dentro de ese alcance; el límite de selección runtime de producción sigue abierto.

**Límite que permanece:** login mínimo sólo en el writer de consumo; auth/lookup y vínculo/lectura POS de Next usan dueño. [4/4 SQL nuevos](../INV-01.b4.storage/runtime-login.md) prueban los servicios con client explícito independiente, no la selección de conexión en las rutas. Storage y, por dependencia, smartlink.next/ui siguen sin aceptar. La siguiente pieza debe conectar explícitamente ese runtime y repetir Next bajo esa configuración, sin ampliar permisos de auth/listados/importes para conseguirlo. No hay migración ni despliegue operativo.
