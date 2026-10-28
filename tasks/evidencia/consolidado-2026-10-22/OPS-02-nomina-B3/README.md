# OPS-02.nomina.B.3 — nómina ordinaria y acceso a recibos

Base `8dd8ad8`; ejecución iniciada 2026-10-27 y cierre documental 2026-10-28. Cuatro archivos de código/pruebas. Completa el contexto de los consumidores incluidos en B; OPS-02.nomina conserva C/D/E/F pendientes.

## Cambio

- Creación/cierre de corridas ordinarias, recibos de éxito/error e historial usan `withCompanyContext`; las escrituras transmiten el actor y el cierre filtra también por empresa. El PAC queda fuera de esas transacciones.
- `getPayrollPayslips(companyId, runId)` valida el padre y consulta los hijos dentro de la misma transacción, enlazando empresa de corrida y empleado. Corrida ajena/inexistente: 404; propia vacía: arreglo vacío.
- GET `/api/payroll/[id]/payslips` conserva URL y DTO de éxito. Exige `reports:read` con clasificación FINANCIAL y auditoría READ, toma empresa del contexto de permisos y rechaza IDs inválidos con 400. Actualiza el único caller localizado del servicio.

## Verificación

RED previo: el recorrido SQL ordinario falló con RLS 42501 al insertar la corrida. El endpoint anterior falló cinco de siete casos del contrato API. GREEN:

| Comprobación | Resultado | Registro |
|---|---|---|
| Integración conjunta recuperación + runtime | 32/32, exit 0; incluye tres casos B.3 | [integration.log](integration.log) |
| Contrato API | 7/7, exit 0 | [api.log](api.log) |
| Suite unitaria global | 2230 passed, 19 failed, 1 skipped, 1 todo; 178 archivos aprobados y 1 fallido, exit 1 | [unit-full.log](unit-full.log) |
| ESLint de los cuatro archivos | exit 0, sin errores; dos advertencias previas en payroll-service (import sin uso y any existente) | [lint.log](lint.log) |
| Build con TypeScript, heap 6144 MB | exit 0, 430 páginas generadas | [build.log](build.log) |

Los 19 fallos globales siguen limitados al archivo preexistente y no versionado `tests/unit/inventory/production-fefo-db.test.ts`. No se modifica ni se excluye de la ejecución.

El build conserva los mensajes de deprecación de `fetchConnectionCache` y de uso dinámico de `headers` en documentos laborales; termina correctamente. El aumento de heap sólo se aplica al proceso, sin modificar la configuración del proyecto.

La integración usa login `pulso_app` preaprovisionado sin superuser/bypass ni pertenencia al propietario, esquema privado y políticas de contrato de las cuatro tablas. Usa fuentes SQL reales del esquema de prueba, dos empresas y pools max=1; verifica recibos TIMBRADO/ERROR, cierre COMPLETED/COMPLETED_WITH_ERRORS, historial aislado, 404 cruzado y ausencia de filas sin contexto. La ruta API se ejecuta con permisos y servicio simulados; la prueba SQL ejecuta el servicio real.

## Límites

No se aplican migraciones a bases compartidas, no se alteran roles y no se emiten CFDI ni mensajes reales. Las políticas privadas no son la migración definitiva de E; la aceptación HTTP/job completa con políticas finales sigue en F / AGU-03C.3.

Se conserva el cálculo y el comportamiento fiscal ordinario actual: NOM-01–05 siguen abiertos, incluidos ISR, unidad salarial, snapshot, incertidumbre/reintentos y conexión económica con tesorería. El fixture de asistencia satisface el preflight existente; no acredita cálculo por asistencia. Una excepción del proveedor conserva el estado de error existente; esta adaptación no corrige la interpretación ordinaria de rechazos fiscales.

Revisión local del diff: empresa obtenida de permisos, consultas parametrizadas, sin fallback de acceso sin contexto, sin transacción retenida durante el PAC y sin cambios de importes/DTO.
