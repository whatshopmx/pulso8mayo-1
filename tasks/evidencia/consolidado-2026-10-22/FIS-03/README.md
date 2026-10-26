# FIS-03 — Mínimo del finiquito por fecha y zona

Base: `bf2c386`, con FIS-02 e IMSS ya presentes como cambios locales al retomar. Trabajo del 23-oct-2026. Alcance dividido antes de implementar en FIS-03A (cálculo), FIS-03B (pantalla) y FIS-03C (transporte salarial encontrado durante la integración).

## Contrato implementado

- La resolución recibe **fecha civil AAAA-MM-DD y zona GENERAL/ZLFN explícitas**. No usa el reloj, no deduce frontera a partir del estado y rechaza fechas inválidas, zona ausente y años sin catálogo publicado. El catálogo geográfico es puro y compartido por servidor/cliente: la tabla laboral global existente solo representa GENERAL. No hay migración ni modificación del seed global en FIS-03.
- Valores en centavos, con fecha de inicio/fin y URL oficial. Cobertura acotada a 2025 y 2026; 2027 permanece bloqueado. La regla devuelta identifica también la fecha de cálculo y zona elegidas.
- `calculateSeveranceForDate` resuelve antes de llamar al cálculo puro. El cálculo puro exige mínimo y salario positivos/finitos, trabaja en centavos y comprueba antigüedad/importes. Se eliminó el default 278.80 y su extrapolación. La prima usa un factor legal independiente **2 × mínimo** y 12 días por año, con redondeo final al centavo.
- La pantalla usa la misma resolución/tope, muestra mínimo/fecha/zona/fuente y se identifica como simulación. Un dato inválido oculta el resultado anterior y comunica el bloqueo; el padre recibe null y deshabilita el guardado. Cambiar empleado o sucursal exige seleccionar de nuevo la zona. Cambiar fecha/motivo invalida el cálculo previo.
- Las fechas civiles de cálculo, aniversario y presentación se manejan de forma consistente para evitar un día adicional de antigüedad o una fecha visible del día anterior en México.
- Se conserva la base efectiva y la declaración del salario de registro cuando hay gap. El adaptador consume la respuesta real de empleados (`userName`, `contractBaseSalary`, `effectiveSalaryCents`). No convierte un salario ausente en cero.

Fuentes reabiertas el 23-oct: [CONASAMI 2025](https://sidof.segob.gob.mx/notas/docFuente/5745678), [CONASAMI 2026](https://sidof.segob.gob.mx/notas/docFuente/5775534), [LFT, arts. 162-II y 486](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFT.pdf). El art. 486 contempla también trabajo en varias áreas; ese caso requiere revisión individual y no se infiere en este selector de una zona. Oráculos independientes conservados de [FIS-01](../FIS-01/README.md).

## Brechas reproducidas y corregidas

1. Reproducción inicial de FIS-03A: 26 pruebas, **20 failed / 6 passed**, exit 1. El cálculo aceptaba mínimo/salario ausentes, cero, negativos y no finitos; el lookup no resolvía fecha/zona y faltaba la orquestación. Primer GREEN: **34/34** incluyendo la regresión batch3.
2. Navegador antes de la conexión: faltaba el aviso de zona y el selector. El primer intento completo de verificación posterior agotó el tiempo en la preparación de estilos; se conserva en `browser-setup-timeout.*`. El harness reutiliza CSS del build local si existe y compila la hoja global en checkouts sin build.
3. Navegador con la nueva lógica: esperaba **15121.92**, obtuvo **15142.63**. El aniversario seguía a medianoche, frente al corte a mediodía, y `ceil` agregaba un día. Evidencia anterior a corregirlo: `browser-before-date-fix.*`. Se unificó la hora de la fecha civil y se añadió aserción sobre las fechas visibles.
4. FIS-03C: una prueba nueva de `EmployeeService.listEmployees` reprodujo el error de Drizzle: `contractBaseSalary` referenciaba `employee_contracts`, tabla ajena al FROM. Se quitaron esas dos columnas de la primera consulta; la consulta existente de contratos activos por usuario/empresa sigue incorporando ambos salarios después, sin multiplicar filas ni mezclar tenants. El test ejecuta las consultas con PGlite y comprueba formal, efectivo, contrato ausente, contrato inactivo y contrato ajeno a la empresa.

## Oráculos monetarios

SD real 1000, antigüedad 2 años, sin prima IA:

| Fecha / zona | Mínimo diario | Base topada | Prima (base × 12 × 2) | Total con 90 días |
|---|---:|---:|---:|---:|
| 2025 / GENERAL | 278.80 | 557.60 | 13382.40 | 103382.40 |
| 2026 / GENERAL | 315.04 | 630.08 | 15121.92 | 105121.92 |
| 2025 / ZLFN | 419.88 | 839.76 | 20154.24 | 110154.24 |
| 2026 / ZLFN | 440.87 | 881.74 | 21161.76 | 111161.76 |

Caso formal SD 600 / 2026 GENERAL / 2 años: prima **14400**, total **68400**. Declarar registro 315.04 y conservar efectivo 600 no cambia esos importes, y sí declara el gap. La pantalla conserva sus otros conceptos existentes; estos totales del calculador puro no sustituyen el desglose de vacaciones/aguinaldo de la simulación.

## Resultados

Los JSON de los runners guardan comando, inicio, fin y exit; `lint-employee.json` registra el resultado observado de su ejecución dirigida. Cierre local de FIS-03A/B/C, con cambios sin commit y sin despliegue:

| Control final | Resultado / evidencia |
|---|---|
| Unitarias focalizadas | 4 archivos, **52/52**, exit 0; `focused.*`. Incluye consultas reales a Postgres embebido |
| Suite completa | 161 archivos, **1926 passed / 1 skipped / 1 todo**, exit 0; `unit.*`. No se añadieron omisiones |
| Navegador | **3/3**, exit 0; `browser.*`. Pantalla y componentes reales con API/sesión simuladas; fechas, cambio de zona/vigencia, bloqueo, gap, teclado y anchos 1440/320 |
| Capturas | `screen-1440.png` / `screen-320.png`; inspección inicial y confirmación después de corregir las fechas visibles, sin desbordamiento horizontal en el recorrido |
| Lint afectado | Exit 0; `lint.*` (8 advertencias existentes) y `lint-employee.json` (20 advertencias existentes fuera de la proyección corregida). **0 errores** |
| TypeScript final | Validación completa dentro de `pnpm run build`, exit 0; `build.log`. La ejecución independiente anterior `types.*` también terminó con exit 0, pero precede al último ajuste de transporte salarial |
| Build final | `pnpm run build`, **exit 0**; `build.*`. Reintento autorizado con red, TLS activo y heap 6144 MB, sin cambios a `.env`/configuración del producto |
| Diff | `git diff --check` sobre archivos afectados, exit 0; solo avisos de conversión de finales de línea, sin errores de whitespace |

La primera suite completa anterior a C se conserva en `unit-before-source-fix.*`: 160 archivos / 1925 passed, exit 0. El intento restringido de build falló al conectar con Google Fonts; metadata y resumen en `build-restricted-failed.*`. Se reintentó mediante aprobación de red, sin sustituir las fuentes ni omitir validaciones.

El build final conserva avisos ajenos a este frente: `fetchConnectionCache` deprecado y un mensaje de la ruta de documentos al detectar `headers()` durante el intento de render estático; Next termina la generación y el proceso devuelve exit 0. No se presenta ese log como una consola sin avisos ni como aceptación del módulo de documentos.

## Alcance de la evidencia y pendientes

El navegador monta **la página y los componentes reales**, con navegación/sesión de Next sustituidas y todas las solicitudes API interceptadas. La función salarial del componente se obtiene del AST de su implementación real para ejecutar solo esa función, sin cargar sus dependencias DB en el navegador de pruebas. PGlite ejecuta el SQL real; solo se sustituye el cifrado de perfiles en esa prueba de transporte salarial. Esto acredita lógica y recorrido de pantalla aislado, no una sesión HTTP real con RLS/roles ni despliegue.

No hay escrituras en bases compartidas, timbres, notificaciones ni cambios de migraciones. Los cambios anteriores de IMSS se conservan. En `employee-service.ts` la edición de este frente se limita a la proyección del listado; no altera la baja/fechas de IMSS.

La persistencia/autorización de una simulación como importe exigible pertenece a REF-04/05. El endpoint de baja conserva su contrato actual: el bloqueo del formulario no reemplaza una validación fiscal de servidor para un cliente que invoque directamente la API. Tampoco se declara resuelta aquí la unidad histórica del salario (NOM-01), el tratamiento completo de causas/indemnizaciones o la prima IA opcional. La pantalla muestra su carácter informativo.

Siguiente tarea fiscal: **AGU-02**, retención Art. 174 sobre importe gravado y subsidio aplicable; después AGU-03 y DIA-01/02 según el checklist. El frente bancario de `tasks/plan.md` mantiene su tracker separado y sus verificaciones BAN/OPS.
