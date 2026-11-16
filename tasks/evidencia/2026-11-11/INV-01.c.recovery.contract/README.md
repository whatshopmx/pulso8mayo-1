# INV-01.c.recovery.contract — Preparación del expediente de revisión

Continuación 2026-11-13. HEAD inicial `a816208911305b36034388f47aa9db9b979e6979` más diff previo compartido. Scope de dos archivos: `lib/services/sale-recovery-review.ts` y `lib/services/__tests__/sale-recovery-review.test.ts`. No modifica el writer, rutas, sesión, roles, storage, schema ni datos. Es preparación de dominio sin efectos; no es una reparación ejecutable ni un expediente persistido.

## Contrato implementado

`prepareSaleRecoveryReview` valida DTOs que el futuro servicio deberá cargar desde persistencia acotada por empresa y sucursal. Exige identidad normalizada, venta legada exacta, cantidad decimal canónica sin redondeo, centavos enteros o NULL explícito, fecha civil real, updatedAt y head observado explícitamente nulo. El snapshot histórico debe tener empresa/receta concordantes y huella válida; se reutiliza `saleSnapshotDemand` para calcular la demanda exacta.

Esta primera preparación solo admite consumo declarado NOT_APPLIED, sin movimientos observados, acompañado obligatoriamente por evidencia de NO_PRIOR_CONSUMPTION. La lista vacía de movimientos no se toma como prueba. Consumo APPLIED o UNKNOWN y head existente permanecen bloqueados: no se usan como una adopción o reparación implícita.

Se requieren registros de evidencia de SALE, RECIPE_VERSION y NO_PRIOR_CONSUMPTION con IDs distintos, empresa/sucursal/venta propias, clave privada de storage de la empresa, hash de contenido, autor de verificación, fechas coherentes y deletedAt nulo. La función verifica estructura y coherencia de estos registros; **no descarga archivos, no comprueba que el objeto exista y no convierte un hash recibido en prueba verificada**. Por eso no recibe un flag de cliente que pueda habilitar la reparación y no se conecta a una ruta de aplicación.

La propuesta se clona y genera hashes versionados de estado y expediente. El hash de estado incluye updatedAt, identidad, cantidad/ingreso y versión de snapshot. El del expediente también liga motivo, solicitante, clave idempotente y registros de evidencia. Se ordenan las claves recursivamente y la lista de evidencias por ID: reordenar JSONB no cambia la huella; NULL y cero siguen distintos. Mutar el input no cambia la propuesta preparada.

`assertRecoveryReviewMatches` vuelve a validar propuesta y registros actuales; una mutación del preparado, cambio de venta/evidencia/motivo, digest distinto, aprobación rechazada, ámbito ajeno o aprobación anterior a la evidencia falla. La revisión requiere un usuario diferente del solicitante, rol ADMIN/OWNER/SUPER_ADMIN y capacidad inventory:manage del catálogo existente. Este chequeo puro **no acredita que esa persona tenga dicho rol en DB ni autoriza una operación**: el siguiente servicio deberá obtener sesión, capacidades, evidencia y decisión desde registros propios, sin aceptar estos DTOs como verdad desde HTTP.

## Verificación

Primero falló la importación del módulo inexistente. Después de implementar el contrato, `pnpm.cmd exec vitest run --configLoader bundle lib/services/__tests__/sale-recovery-review.test.ts lib/services/__tests__/sale-consumption-snapshot.test.ts lib/services/__tests__/sale-consumption-contract.test.ts --maxWorkers=1 --pool=threads` pasó **54/54 en tres archivos**, exit 0; nueve casos nuevos con variantes de abuso y cambios de estado.

Casos: copia independiente/demanda exacta, rechazo de bandera o consumo ambiguo, head y precisión/rango, scopes discordantes, prueba ausente/duplicada/ajena/retirada/sin clave o hash válidos, snapshot manipulado, estabilidad JSONB y NULL, autoaprobación/rol insuficiente y aprobación obsoleta. Resultados finales de tipos/lint/build y trazabilidad en `results.json`.

## Siguiente incremento y límites

Faltan el modelo persistido de expediente/decisiones y su aislamiento; el lector que recupere y verifique contenido de storage; la obtención de estado/rol de servidor; y el writer transaccional de recuperación, auditado e idempotente, que revalide bajo lock antes de aplicar. Evidencia existente tiene adjuntos durables, pero no un sujeto de recuperación aprobado con estos campos: no se declaró cubierto por usar GENERAL ni metadata de IA.

El camino para consumo histórico ya aplicado necesita su reconciliación específica y no está habilitado por esta preparación. Siguen pendientes los casos de fallo, doble aprobación/aplicación, carreras con correcciones y aceptación integrada. No se acepta INV-01.c.recovery, INV-01.c, INV-01.b ni 11.11 con este módulo. No se ejecuta reparación real ni se aplican migraciones a main.

Cierre: 54/54 pruebas, TypeScript global, lint focal y build de producción con heap de 4 GB, todos exit 0. El build volvió a comprobar tipos después de añadir el rechazo de demanda preparada alterada. Log íntegro en `build.txt`; resultados y hashes en `results.json`. HEAD al cierre `3a5d60c010cd292d532706d1c368c2ab56b279f4` por cambios concurrentes; se conserva el diff compartido. Ninguna aceptación operativa nueva.


Contrato v2 y precisión nativa (2026-11-14): [recovery.provenance](../INV-01.c.recovery.provenance/README.md) reemplaza la forma anterior incompleta, conserva microsegundos y exige atestación exacta. Los resultados/hashes de este directorio describen el contrato original, no validan la fuente v2 actual. No se reescriben propuestas históricas ni se inventan datos faltantes.
