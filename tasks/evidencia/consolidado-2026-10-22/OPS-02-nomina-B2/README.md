# OPS-02.nomina.B.2 — Contexto en consulta/persistencia fiscal ordinaria

2026-10-27. Base `6d31886`. Se adaptan getTimbrado y las consultas/escrituras del recorrido ordinario de timbrarNomina a transacciones breves con contexto de empresa/actor. La llamada al PAC permanece fuera de esas transacciones.

RED: bajo login runtime y políticas privadas, la persistencia de CFDI ordinario falla con RLS 42501. GREEN inicial: prueba runtime de emisión/consulta/reutilización confirmada aprobada; regresiones de fiscal extraordinaria/protocolo 12/12.

La aceptación adicional usa el mismo entorno aislado y roles de A/B.1, con PAC HTTP simulado. Comprueba mismo RFC/período en dos empresas, reutilización de confirmado aun sin configuración PAC, preservación del folio ganador cuando llega una respuesta tardía, pool/contexto libres al llamar al PAC y rechazo seguido de actualización del mismo registro. Oráculo de entrada: percepciones 900000, deducciones 50000 y neto esperado 850000 centavos; no se calcula ISR ordinario nuevo.

No se modifica el protocolo de reintentos ordinarios, la variación de serie, cálculo, claves ni importes. Su durabilidad e incertidumbre fiscal siguen siendo aceptación de NOM-04; esta tarea no declara resuelto el riesgo de duplicidad ordinaria por agregar contexto. La intención durable de aguinaldo permanece en su recorrido separado ya verificado.

No se emiten CFDI reales ni se alteran políticas/roles/migraciones operativas. B.3 y el rollout E/F permanecen pendientes.

## Resultados de pruebas

- Runtime fiscal ordinario: `pnpm.cmd run test:integration tests/integration/aguinaldo-runtime-recovery-db.test.ts -t B.2`, **4/4, exit 0**, [log](integration.log). Las otras diez pruebas del archivo no forman parte de este filtro; sus aceptaciones previas se conservan en A/B.1.
- Regresiones de fiscal/protocolo: `pnpm.cmd run test:unit lib/__tests__/fiscal-aguinaldo-recovery.test.ts lib/__tests__/aguinaldo-fiscal-delivery.test.ts`, **12/12, exit 0**.
- Lint de servicio fiscal y archivo de integración: **exit 0**, sin errores/advertencias, [log](lint.log).
- Primer build, comando estándar sin override adicional de heap: **exit 134** por agotamiento de memoria del worker Node, [log](build.log). El reintento conserva controles y usa 6144 MB sólo en el proceso, como en los checkpoints anteriores; se registra por separado.
- Reintento con 6144 MB y TypeScript: **exit 0**, [log](build-heap-retry.log). Comando `pnpm.cmd run build` con NODE_OPTIONS sólo en el proceso y acceso de red autorizado para Geist. No se modificó configuración del producto para evitar verificaciones.

Cierre local de B.2. B.3 conserva la adaptación de corridas/recibos y del caller HTTP. La suite general se volverá a registrar en ese checkpoint conjunto; B.2 no declara verde el frente FEFO ni certifica la durabilidad ordinaria pendiente en NOM-04. Los logs se conservan en UTF-8 con espacios finales normalizados.
