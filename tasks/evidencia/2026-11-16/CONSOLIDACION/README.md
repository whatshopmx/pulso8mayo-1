# Consolidación de faltantes — 2026-11-16

Base: `189376a50f9f20c20a41200e7e66a51ca74d40c0` más el árbol local existente. Se conservan cambios de ventas/recovery, nómina y excepciones; no se crea commit ni se mezclan utilidades temporales/configuración ajena.

Durante la comprobación final aparecieron cambios concurrentes de facturas: `drizzle/0151_invoice_destination.sql`, snapshot/journal, schema raíz, pruebas de destino/payee y documentos de ese frente. Se preservan como trabajo ajeno a esta consolidación; no se generó ni aplicó esa migración desde esta sesión. Los checks globales describen el árbol compartido observado, no una revisión congelada de facturas.

## Estado revisado

Se mantienen las 21 aceptaciones históricas registradas. Esta consolidación no acepta funcionalidades adicionales ni aplica migraciones. Las casillas vacías distinguen implementación de aceptación integrada.

**Límite global final:** el build con Webpack compila los módulos después de la extracción salarial, pero falla al validar tipos de rutas/páginas preexistentes. La comprobación completa posterior reproduce **7 errores en 6 archivos sin cambios de esta sesión**. No se declara build ni TypeScript global final en verde; el primer TypeScript exitoso fue anterior a la regeneración de estos validadores de producción.

| ID | Resultado de revisión | Pendiente para aceptar |
|---|---|---|
| NOM-02.c1 | Código local: vacaciones/permisos, prima y exportación; V1 y repetición V2 pasan. | Revisar procedencia/vigencia fiscal, saldos históricos por período y manejo de errores de consulta antes de aceptar; los ceros de fallback no distinguen dato ausente de fallo de consulta. |
| EXC-01 | Código local con executor transaccional en lifecycle; alta humana predeterminada corregida para compartir transacción con auditoría. Prueba de fallo reproducida antes del fix y 28 regresiones focales pasan. | Migración RLS reproducible (EXC-01.rls) y V2 sobre esa migración. El test añade RLS desde beforeAll y no demuestra una migración desplegable. |
| INV-01.c.recovery.ui-routes | Rutas GET/POST de propuestas y diálogo para consultar, decidir/aplicar un expediente existente; unitarias pasan. | INV-01.b aceptado, HTTP/sesión/R2/navegador reales y creación de expediente desde el recorrido visible. La prueba DB sustituye autenticación/storage y usa savepoints en una conexión. |
| INV-01.c.recovery.apply | Servicio A3 ya implementado; unitarias y repetición V2 de servicios pasan. | Dependencias originales y carreras con conexiones/commits independientes. El caso nuevo comprueba reintento secuencial y fue renombrado. |
| INV-01.b4* | Se preservan implementaciones y evidencia histórica focal. | Almacenamiento POS privado durable (b4.storage), cobertura de lectores financieros (b4.coverage), manifestar/aplicar migraciones por entorno en OPS-03 y aceptación HTTP/UI en INV-01.d. |

El cierre agregado de recovery pasa a depender explícitamente de decision.service, apply y ui-routes. Los nuevos IDs se enlazan a las filas y sus aceptaciones; no se baja el criterio del plan para desbloquear padres.

## Verificación de esta consolidación

- `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc --noEmit --incremental false`: **exit 0 en la comprobación previa**. Resuelve el fallo de heap de 2 GB. Tras regenerar validadores de producción con Webpack, la comprobación final termina **exit 1**, con los siete errores de base enumerados abajo.
- Unitarias focales con `pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads` sobre `payroll-nom01-contract`, `payroll-nom02a-attendance`, `payroll-nom02b-overtime`, `payroll-nom02c1-vacations`, `sale-recovery-proposals-route`, `sale-recovery-apply`, `exception-service` y `faltantes-traceability`: **110/110, 8 archivos, exit 0**.
- Regresión tras corregir EXC-01: `pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads lib/services/__tests__/exception-raise-atomic.test.ts lib/services/__tests__/exception-service.test.ts lib/services/__tests__/exception-adapters.test.ts lib/services/__tests__/group-exceptions-canonical.test.ts`: **28/28, 4 archivos, exit 0**. Hay solapamiento con las 110 anteriores; no sumar ambos conteos como casos distintos.
- Integración: `pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/payroll-db.test.ts tests/integration/sale-recovery-e2e-db.test.ts`: dos intentos iniciales **exit 1**, fallos TLS en `beforeAll`, **17 casos omitidos**. Diagnóstico con consulta `SELECT 1` sobre la misma rama aislada: `unable to verify the first certificate`. Repetición con `NODE_OPTIONS=--use-system-ca`: **17/17, 2 archivos, exit 0**, 171.91 segundos. Se conservan los fallos iniciales como diagnóstico resuelto; no se desactivó validación TLS ni se cambiaron credenciales. Las pruebas DB de recovery siguen usando sesión/R2 simulados y una transacción compartida.
- `pnpm.cmd exec eslint lib/services/exception-service.ts lib/services/__tests__/exception-raise-atomic.test.ts tests/integration/sale-recovery-e2e-db.test.ts`: **exit 0**, cero errores y tres advertencias de `any` en el código local de lifecycle ya existente.
- Lint ampliado a los once archivos consolidados de rutas/UI, servicios de nómina/excepciones y sus pruebas: **exit 0**, cero errores, 22 advertencias de `any` en `payroll-service.ts` (19) y `exception-service.ts` (3). No se modifican tipos ajenos para silenciar avisos.
- `pnpm.cmd exec tsx scripts/validate-faltantes.ts`: **exit 0**, 239 filas, 86 tareas base, 96 entradas adicionales, 21 aceptadas, cero errores. Los cuatro IDs adicionales se registran sin aceptación.
- Build predeterminado con Turbopack: **exit 1** por descarga de Geist/Geist Mono. Reintento con acceso ampliado: mismo resultado; una petición de Node con certificados del sistema a Google Fonts devuelve HTTP 200. La compilación alternativa con Webpack se registra por separado y no sustituye el diagnóstico del comando predeterminado.

### Bloqueo de compilación adicional y corrección acotada

El primer `pnpm.cmd exec next build --webpack`, con heap de 4 GB y certificados del sistema, avanzó más allá de las fuentes pero falló (**exit 1**) por esta cadena de imports de cliente: `settlement-calculator.tsx` → `employee-service.ts` → `employee-cipher.ts` → `column-cipher.ts` → `node:crypto`.

Se movieron `resolveEffectiveSalary` y su tipo a `lib/services/employee-salary.ts`, sin cambiar su fórmula ni su contrato. `employee-service.ts` conserva la exportación anterior para los consumidores de servidor y la calculadora importa directamente el módulo puro. El harness de navegador deja de extraer la función por AST: ahora carga el mismo módulo que producción, de modo que no oculta dependencias de servidor.

- Lint de `employee-salary.ts`, `employee-service.ts` y `settlement-calculator.tsx`: **exit 0**, sin errores; 22 advertencias previas en el servicio/componente existentes. Lint de los dos archivos del harness/spec: **exit 0**, sin errores ni advertencias.
- `pnpm.cmd exec playwright test --config tests/playwright-severance.config.ts`, con `SEVERANCE_SCREENSHOT_DIR=tasks/evidencia/2026-11-16/CONSOLIDACION/severance`: **3/3, exit 0**, 1.2 minutos. Comprueba comportamiento de la calculadora, datos faltantes, teclado y anchos de 1440/320 px; sesión y API simuladas, sin escritura a backend. No acepta otros módulos por esta prueba.
- Capturas de esta ejecución: [escritorio](severance/screen-1440.png) y [móvil](severance/screen-320.png). El directorio de captura opcional evita sobrescribir la evidencia histórica.
- Recompilación con `NODE_OPTIONS='--max-old-space-size=4096 --use-system-ca' pnpm.cmd exec next build --webpack`: módulos **compilados correctamente en 18.0 minutos**; comando **exit 1** en la validación de tipos por `getSavedSearches`. El diagnóstico completo con `tsc --noEmit --incremental false` devuelve los siete errores siguientes; los seis archivos fuente no tienen diff de esta consolidación. No se modifican `.next/types`, exclusiones ni opciones de verificación para obtener un resultado artificial.

| Archivo de base | Bloqueo de tipos generado por Next |
|---|---|
| `app/api/employees/search/route.ts` | Export adicional `getSavedSearches`, no permitido como export de ruta. |
| `app/api/inventory/products/route.ts` | Export adicional `MAX_HIGH_VALUE_SKUS`, no permitido como export de ruta. |
| `app/api/inventory/waste/route.ts` | Export adicional `WASTE_ERROR_CODES`, no permitido como export de ruta. |
| `app/dashboard/labor/shift-changes/[id]/page.tsx` | `params.id` síncrono; el contrato generado exige `params` como Promise. |
| `app/dashboard/profile/page.tsx` | Prop adicional `userPromise` incompatible con PageProps (dos errores). |
| `app/external/report/[token]/page.tsx` | `params.token` síncrono; el contrato generado exige `params` como Promise. |

Estos bloqueos requieren su propio incremento de compatibilidad de rutas/páginas antes de certificar el build global. El import de `node:crypto` del finiquito sí quedó corregido y la recompilación superó esa etapa. El build predeterminado con Turbopack conserva además el límite de descarga de fuentes de este entorno.

Los resultados SQL anteriores de EXC-01 se conservan como evidencia histórica. EXC-01 no se vuelve a ejecutar: su beforeAll modifica RLS de forma persistente y antes necesita una migración revisada. Las consultas de diagnóstico e integración apuntaron a la rama aislada; no se ejecutaron migraciones operativas ni se cambió `.env`.

Resultados estructurados: [results.json](results.json). No sumar suites solapadas ni interpretar los 21 registros aceptados como porcentaje del producto.

Repetición de V2 en PowerShell, restaurando la configuración del proceso al terminar:

```powershell
$taskPreviousNodeOptions = $env:NODE_OPTIONS
try {
  $env:NODE_OPTIONS = '--use-system-ca'
  pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/payroll-db.test.ts tests/integration/sale-recovery-e2e-db.test.ts
  $taskIntegrationExit = $LASTEXITCODE
} finally {
  $env:NODE_OPTIONS = $taskPreviousNodeOptions
}
exit $taskIntegrationExit
```

## Orden de cierre pendiente

1. Revisar los límites de datos/fuentes de NOM-02.c1 y completar HTTP/sesión/R2/navegador y carreras independientes de recovery. La conectividad y repetición V2 ya quedaron resueltas usando certificados del sistema.
2. Implementar/revisar migración EXC-01.rls y comprobar alta + auditoría atómicas en Postgres antes de aceptar EXC-01; la regresión unitaria del executor predeterminado ya está corregida.
3. Ejecutar b4.storage y b4.coverage; comprobar HTTP/sesión/runtime, rollback y acceso ajeno. El mock de R2 no acredita almacenamiento durable.
4. Aceptar hijos de INV-01.b y después recovery/carreras/API/UI; cerrar padres únicamente con dependencias aceptadas y evidencia completa.
5. Corregir por incrementos los seis archivos de compatibilidad Next indicados arriba y volver a ejecutar los checks globales. No aceptar checkpoints de build por las pruebas focales de esta consolidación.
