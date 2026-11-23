# Manual y CSV — aceptación Next sobre copia existente

2026-11-22. Base `d05eae09d67ed0b190b6785da168a8fb8b564fd0` + árbol compartido. **INV-01.b4.manual.next e INV-01.b4.ui.next aceptados V2/V3 en copia aislada.** Todas sus dependencias están aceptadas: a, b3, b4b, runtime.config y manual.ui/ui. La puerta de copia pendiente en el checkpoint anterior queda acreditada por esta corrida, sin reinterpretar fresh-baseline como copia.

Se ejecutó el modo predeterminado de createSalesRuntimeDatabase: CREATE DATABASE con TEMPLATE del origen TEST_DATABASE_URL, en endpoint comprobado distinto de .env. Esta vez la copia entró dentro del límite de espera; no se modificaron el origen, TimescaleDB, sesiones, roles compartidos ni migraciones. Se conserva el límite/reintento de 55006 sin terminar clientes del origen. El fallo previo no se oculta ni se atribuye a código de producto.

Next producción, Chromium, Better Auth y PostgreSQL reales, sin mocks de API/auth/SQL. Writer con login nuevo NOBYPASSRLS/NOSUPERUSER, sin membresías/propiedad y grants mínimos declarados. Auth y lookup siguen usando dueño; no se acredita runtime de esos lectores, migración de datos ni despliegue. Reutiliza BUILD_ID `bBmXOvXw0G4OayubgEgi3`, build completo exit 0 con tipos y 455 páginas: desde ese gate no cambió código de aplicación.

**4/4 seleccionados, exit 0, 217.51 s** (214.05 s de casos). Tres POS/R2 omitidos por selección explícita; no se cuentan como éxitos ni se declara toda la suite completada. [Reporte reducido con nombres, duración, hashes y limpieza](results.json).

| Puerta | Evidencia actual |
| --- | --- |
| Copia, RLS y permisos | Más de 190 tablas; nueve tablas de venta con RLS; triggers inmutables de identidad/revisión conservados; ausencia de SELECT general/UPDATE de receta, DELETE de lotes/ventas y UPDATE de movimientos, SELECT(name) mínimo. |
| Arranque y cierre | Next separado con secretos owner/runtime propios; get-session anónimo 401. Cada servidor termina y su puerto rechaza conexiones. |
| Manual.next | Runtime dueño configurado devuelve 503 seguro sin cambios. Formulario real 10→12→8, repetición sin cambios, ingreso 80.25→8025 sin movimientos adicionales, cero que devuelve stock 20; cinco revisiones. Insuficiencia 21 devuelve 409 sin efectos y reintento recupera feedback. Conteo ausente conserva guiones/Falta conteo, sin Conforme. |
| Ui.next | Archivo CSV con receta/encabezado entrecomillados y SKU distinto de receta; renombrar no cambia identidad. 10→12→8, repetición, NULL→8025 sin stock adicional, 401/reapertura, grupos inválidos sin aplicar subtotal y válido independiente, anulación a cero devuelve ambos lotes a 20. Oráculos SQL desde otra conexión después del commit. |
| Hidratación | Scripts Next retenidos: selector disabled=true y reactProps=false; al liberar scripts se habilita y el primer archivo aparece seleccionado. Se conserva todo el recorrido de importación posterior. |
| V3 | Feedback visible en cada respuesta; móvil 390 px sin desbordamiento de página, tablas desplazables por teclado, cero errores de página. Tres renders frescos revisados: SSR/escritorio, manual móvil y CSV móvil, junto a esta evidencia. |
| Limpieza | afterAll consulta ausencia de base/rol después de retirarlos; manifest closed=true/databaseCreated=false/roleCreated=false. No se borran hechos inmutables del origen para limpiar. |

Comando reproducible: `node .tmp/manual-csv-next-verify.cjs source`. Wrapper con opt-ins RUN_SALES_RUNTIME_NEXT_BROWSER=1, RUN_SALES_RUNTIME_POS=0 y RUN_SALES_FRESH_BASELINE=0; exige los cuatro nombres aprobados y report.success, no admite reporte vacío/casos seleccionados omitidos. Ejecución autorizada fuera del sandbox para taskkill de sus propios procesos Windows.

Gates locales del mismo artefacto: [28 focales, 17 controladas, lint y build](../INV-01.b4.manual-csv-next/README.md). El [historial de registros parciales](evidence-history.json) conserva la evidencia anterior; el mapa usa esta revisión consolidada V2/V3. **33 registros aceptados; INV-01.b/b4/d y fila 11.11 siguen pendientes**, junto con POS/storage/cobertura/recovery y los demás frentes del plan.

Checkpoint documental posterior: validador 239 filas/86 bases/114 hijos/33 aceptados/0 errores, exit 0. Once pruebas de trazabilidad pasan dentro de la corrida de 21 con diez de almacenamiento POS (0.861 s); las diez POS no se atribuyen al alcance Next manual/CSV.
