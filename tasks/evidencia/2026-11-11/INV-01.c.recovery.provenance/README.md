# INV-01.c.recovery.provenance — Estado nativo y atestación exacta

Continuación 2026-11-14. Scope de tres archivos: `lib/services/sale-recovery-review.ts`, su prueba unitaria y `tests/integration/sale-recovery-review-precision-db.test.ts`. Además se corrige el gate propio del codec histórico en los dos archivos existentes de [recovery.historical](../INV-01.c.recovery.historical/README.md), sin ampliar el total de cinco archivos de código/pruebas de esta continuación. No hay migración, DML ni cambios de stock, roles o permisos.

## Defecto reproducido

Antes de corregir, dos tests fallaron y nueve pasaron: cambiar la venta de `.123456` a `.123457` no cambiaba la huella de estado; una revisión anterior a creación por un microsegundo tampoco se rechazaba. `new Date(...).toISOString()` y `Date.parse` truncaban la precisión de PostgreSQL. Ver `precision-red.txt`. Este es un defecto del contrato previo, no un conflicto concurrente de Tesorería.

Las fechas del contrato se validan y normalizan ahora a UTC con seis decimales. Date se usa únicamente para convertir el segundo entero/offset, conservando por separado la fracción completa; no convierte el timestamp completo a milisegundos como versión del estado. Se rechaza precisión superior a seis, falta de offset y fechas que saldrían del rango de cuatro dígitos al normalizar. La cronología compara cadenas canónicas de formato y longitud iguales, conservando microsegundos. Offsets equivalentes producen el mismo expediente y huella.

## Contrato de expediente versión 2

El expediente exige `schemaVersion: 2`. La versión de snapshot de receta sigue siendo 1. Cada prueba exige attestationId UUID, evidenceUpdatedAt nativo, byteLength 1..20 MiB, sourceReference, verificationReason y verifiedRole ADMIN/OWNER/SUPER_ADMIN, además de los campos existentes de objeto/verificador/sujeto. La clave debe ser exactamente `companies/{company}/branches/{branch}/sales-recovery/{legacySale}/{evidence}`. No admite evidencia ni atestación duplicadas; exige createdAt <= evidenceUpdatedAt <= verifiedAt, y aprobación no anterior a ninguna revisión, hasta el microsegundo.

proposalHash y stateHash usan dominio de versión 2. El estado incluye ID de atestación, versión observada de adjunto, hash y tamaño. Por tanto una nueva atestación del mismo contenido, una modificación temporal de un microsegundo o un cambio de tamaño requieren revisión nueva. El contrato anterior incompleto se rechaza; no se rellena con IDs, tamaños o procedencia inventados ni se reescriben propuestas persistidas. El modelo 0143 no requiere DDL: su columna JSONB conserva el envelope, pero la validación del servicio debe cargar y validar el contrato completo.

Esto **no acredita por sí solo** que un objeto/atestación exista o que el rol declarado sea una sesión real. Los datos deben salir del servidor y de las filas/bytes verificadas bajo el alcance y transacción de la operación. Tampoco registra propuestas, prueba consumo cero, autoriza stock ni convierte la receta mutable en histórica.

## Evidencia

Regresión inicial: 65/65 unitarias en diez archivos; 14 casos del contrato de revisión. SQL de precisión: 3/3, 5.51 s, SELECT reales de timestamps y JSONB en la rama aislada fija (`soft-cloud-50478212` / `br-round-voice-belheola`, host distinto de `.env`). No usa DDL/DML ni runtime de aplicación para estos SELECT escalares: no es una nueva prueba de RLS/autorización. Comprueba JSONB roundtrip, diferencia nativa de un microsegundo y aprobación inmediatamente anterior frente a igualdad temporal válida. Las suites de histórico/persistencia se registran aparte en `results.json`.

El proceso TypeScript original 37425 terminó exit 2 por TS2322 en el codec histórico: Zod infiere yieldPercent opcional con strictNullChecks=false, mientras SaleRecipeReader exige la propiedad. Se corrigió construyendo explícitamente yieldPercent en el adaptador (sin cast y sin cambiar el catálogo mutable). Caso adicional prueba null como 100% y ausencia del campo rechazada. 21/21 unitarias finales de revisión/histórico; veinte se solapan con la regresión anterior. El nuevo chequeo global corre en el proceso 36567; no se reinicia el anterior. Resultados actuales de ese gate y build en `results.json`, sin atribuir un build previo a estas fuentes.

Siguiente paso: lectura de las fuentes SALE/NO_PRIOR_CONSUMPTION, preparación/registro del expediente desde servidor, decisión administrativa independiente y aplicación auditada/idempotente con revalidación/carreras. V2 integrada con sesión/HTTP/R2 reales, AUD-02 y UI siguen pendientes. No se acepta el padre ni la fila 11.11 con este contrato.


Cierre de comprobaciones: 15/15 SQL de regresión en tres archivos (106.57 s), lint final exit 0 sin advertencias, TypeScript global del proceso 36567 exit 0. El build nuevo está en el proceso 13731; estado terminal en results.json. Trazabilidad: 239 filas, 88 hijos, 15 aceptados, cero errores. Para persistir timestamps desde DB, el servicio futuro debe extraer cadenas nativas en UTC con seis decimales (timestamptz convertido AT TIME ZONE UTC), sin usar objetos Date como token de versión.
