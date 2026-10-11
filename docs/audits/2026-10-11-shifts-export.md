# C10 — Exportación del planificador de turnos

Fecha: 11 de octubre de 2026. Seguimiento: [C10](../../tasks/plan-conexion-frontend-backend.md#c10).

## Investigación y alcance

El historial y el seguimiento registran C00–C09: línea base, permisos de turnos, plantillas y ejecuciones, consultas de sesiones y descansos, costeo, catálogo real y validación común con excepciones auditadas. Sus límites de verificación siguen registrados; esta entrega no acredita los recorridos anteriores de creación, recarga o revisión de workflows.

C10 ya tenía cambios locales en la matriz, el contenedor y el hook de exportación, junto con pruebas sin registrar. Se continuaron esos cambios. C11–C40 permanecen pendientes; C11 es el siguiente recorrido del planificador.

## Comportamiento implementado

- La matriz descarga CSV de la semana visible con los filtros de sucursal, rol, estado y búsqueda. Los cancelados se excluyen igual que en la matriz.
- El nombre del archivo contiene inicio y fin del periodo. Las columnas incluyen empleado, sucursal, rol, fecha, horario, estado y notas.
- El CSV conserva acentos, comas, comillas y saltos de línea; neutraliza prefijos de fórmulas al abrirlo en una hoja de cálculo.
- Carga, ausencia de turnos y fallo de lectura impiden descargar datos previos. Los errores de lectura y descarga ofrecen reintento.
- `useShifts` identifica cada lectura, ignora respuestas anteriores y sólo expone resultados correspondientes al filtro actual. La limpieza del efecto invalida las lecturas pendientes.
- No se añade otra consulta ni un endpoint de exportación: se reutiliza la lectura autorizada de C01 y el catálogo de C08.

## Evidencia y límites

| Verificación | Resultado |
| --- | --- |
| `pnpm.cmd run test:unit --maxWorkers=2` | 66 archivos; 870 pruebas aprobadas, 1 omitida y 1 TODO. Incluye 9 casos de CSV y las pruebas existentes de alcance y catálogo. |
| `pnpm.cmd exec playwright test --config tests/playwright-shifts.config.ts` | 7/7 aprobadas en Chromium: periodo, filtros, vacío/error de lectura/reintento, fallo de descarga/reintento, segunda empresa y respuestas tardías tanto exitosas como fallidas. |
| `pnpm.cmd run lint` | 0 errores, 2397 warnings en la revisión inicial. |
| ESLint sobre los ocho archivos TypeScript de C10 | 0 errores y 0 warnings. |
| `pnpm.cmd run build` | Aprobado, incluido TypeScript y la generación de 408 páginas. El log conserva el aviso de conexión Neon deprecada y el intento de render estático de `/dashboard/labor/documents`; el proceso termina con código 0. |

La prueba de respuestas fuera de orden falló antes de corregir el hook: se esperaba Pedro y se descargaba el CSV de María. Después de la corrección pasaron los siete casos finales. Para HTTP 500 se espera la respuesta en vez de `requestfinished`: el cliente puede cancelar el cuerpo al rechazarla, sin emitir ese último evento.

El navegador ejecuta el contenedor, la matriz, los filtros y los hooks reales. El servidor aislado sustituye las acciones por respuestas controladas de dos empresas, la validación ajena a la descarga y el editor; prohíbe escrituras. No ejecuta Next, autenticación ni consultas reales de Postgres. El aislamiento del servidor se respalda por separado con las pruebas de C01 y C08 sobre acciones, permisos y SQL de Drizzle; el caso de empresa B en navegador prueba que el archivo utiliza exclusivamente la respuesta suministrada.

Se corrigieron dos problemas del servidor de pruebas: la importación directa del CommonJS de React y el orden del plugin que sustituye el editor. La sustitución ahora ocurre antes de la resolución habitual, sin cargar código de base de datos en el navegador.

Las pruebas de descarga usan exclusivamente respuestas simuladas. No se ejecutaron migraciones, envíos ni pagos. Excel y PDF no se exponen desde este botón y no se declaran verificados por C10.

## Continuidad

El siguiente pendiente es C11: vista previa y aplicación de plantillas con recursos válidos y validación común. Antes de escribir debe quedar definida su atomicidad. C12 depende de esa operación para completar la asignación masiva y su tratamiento de duplicados.
