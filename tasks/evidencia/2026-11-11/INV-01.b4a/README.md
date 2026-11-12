# INV-01.b4a — Normalización y agrupación exacta de importación

Continuación: 2026-11-12. Estado: código implementado; controles finales registrados en `results.json`. HEAD `ba88018d2cbd7d879549cfe6476d39e4addfd5d2` más diff local compartido. No hay commit automático ni migraciones nuevas. Se conserva el trabajo local contable y los contratos de b3/b3a.

Archivos de implementación: `lib/services/sales-ingest-pure.ts`, `lib/services/sales-ingest-plan.ts`, `lib/services/__tests__/sales-ingest-revisions.test.ts`. El contrato de identidad/cantidad existente se reutiliza sin cambios. Esta fase es pura y no requiere V2/V3; conectar el plan al writer y comprobar el runtime corresponde a b4b.

El CSV valida precisión textual antes de convertir a Number, acepta cero explícito para anulación y rechaza cantidades/importes negativos, notación exponencial, agrupaciones malformadas, fracciones de centavo y valores fuera de rango. Acepta números locales con miles y decimales explícitos (`1.234,50`, `1,234.50`). Los formatos con un único separador y tres decimales se rechazan como ambiguos. Las fechas son días civiles reales, con formato explícito; los timestamps conservan el día escrito sin conversión de huso. No se utiliza el parser permisivo de Date como fallback. Una columna seleccionada inexistente es error; ingreso no reportado se mantiene null.

`productKey` puede mapear una columna distinta de la referencia de receta y conserva mayúsculas como clave opaca. Sin columna explícita se usa la referencia como identidad provisional. Una línea inválida bloquea su producto/día completo; si no se puede determinar el día bloquea ese producto en el archivo. Una fila con SKU pero sin receta/cantidad también invalida su grupo. Los grupos independientes pueden continuar.

`planSalesImport` agrupa por producto/día usando tuplas JSON, valida también filas recibidas directamente, suma cantidades en centésimas enteras y entrega decimal canónico. Conserva todos los números de fila. Rechaza el grupo entero por cantidades/centavos inválidos, overflow agregado o referencias de receta incompatibles para la misma identidad. Si alguna línea no reporta ingreso, el grupo conserva null en vez de inventar cobertura completa. Aún no sustituye el agregado flotante ni el writer legacy del servicio operativo: eso sigue explícitamente en b4b.

## Reproducciones y controles

Primero falló la importación de `sales-ingest-plan`, inexistente. Tras crear el plan, dos casos reprodujeron problemas reales del parser previo: `1.00000000000000001` se aceptaba como 1 y una fecha imposible permitía importar subtotal de otra línea del producto. Después falló un tercer caso: una línea identificada por SKU sin receta/cantidad se descartaba silenciosamente. Las correcciones se hicieron después de observar cada fallo.

Regresión intermedia: 102/102 en seis archivos, exit 0. Regresión final: **103/103 en seis archivos**, exit 0; **18 casos** específicos del parser/plan. Lint de los tres archivos exit 0. TypeScript focal con target ES2017 y dependencias de los tres archivos, sin tsconfig alternativo persistente, exit 0; no sustituye el tsc global. Validador final: **239 filas, 72 hijos, 12 aceptaciones, cero errores**, exit 0.

Tras añadir el último caso, una ejecución paralela terminó por falta de memoria de Node y el primer build salió 1 sin diagnóstico; TypeScript global y suite completa se interrumpieron para liberar recursos. Estos intentos no acreditan gates aprobados. Los resultados globales se registran por separado.

Segundo build: `pnpm.cmd run build` completó compilación de producción (**Compiled successfully in 5.6min**), pero después de más de 14 minutos totales seguía en TypeScript global, sin diagnóstico ni resultado final. Se detuvo ese intento y sus procesos propios para liberar recursos tras la presión de memoria observada. **No se acredita build completo ni tsc global aprobados**; tampoco se modifica tsconfig, se omiten errores ni se cambia el frente contable para forzar el gate.

Durante la limpieza, PowerShell también produjo `System.OutOfMemoryException`. El cierre del árbol del build fue denegado dentro del sandbox; el reintento autorizado fuera del sandbox terminó el proceso propio y sus hijos. No se detuvieron otros frentes ni servicios.

Salida final recuperada al cerrar el build: el worker de TypeScript **agotó el heap de Node cerca de 2089 MB**, `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`, worker exit **134** (wrapper exit 1). Por tanto el resultado final del segundo intento es OOM, no un error de tipos diagnosticado. [Extracto](global-build-failure.txt). Un último reintento del validador tras cambios solo documentales falló igualmente por `uv_os_get_passwd returned ENOMEM`; se conserva la validación anterior exit 0 del mapa, checklist y matriz ya actualizados. No se vuelve a ejecutar build sobre el equipo sin memoria disponible ni se cambia el estado a aceptado.

Límites: b3/b3a conservan aceptación pendiente de checkpoint global; b4a no se marca aceptado mientras su dependencia no esté aceptada. Ninguna escritura de stock, API/UI, base desplegada ni fila funcional 11.11 se acepta con pruebas puras. No se aplican 0137–0140 a main.
