# Reparación histórica pendiente de implementación

Actualización 2026-11-13: se implementó [INV-01.c.recovery.contract](../INV-01.c.recovery.contract/README.md), preparación pura de propuesta y coherencia de revisión. No persiste expedientes, verifica objetos ni aplica stock; el resto del recorrido descrito aquí permanece pendiente.

El writer devuelve PENDING_RECOVERY cuando una venta previa no tiene una revisión y consumo demostrables. La suite de carreras confirma que los reintentos no la adoptan ni consumen de nuevo. Este documento delimita el próximo hijo; no habilita una reparación ni acredita su aceptación.

La revisión de recuperación deberá identificar empresa, sucursal, fuente, producto, día y venta legada exactos. Requiere procedencia verificable del documento/corte original, cantidad y cobertura monetaria (ingreso ausente permanece desconocido), versión histórica de receta/unidades y evidencia de qué consumo se aplicó o de que no se aplicó. La ausencia de movimientos encontrados por una consulta no demuestra por sí sola consumo cero.

Si existe consumo previo, sus movimientos, lotes, unidades y devoluciones deben reconstruir una asignación comprobable. Si no existe consumo y eso se demuestra, la operación deberá aplicar una sola vez la demanda histórica probada, conservar la venta y enlazar el evento de recuperación. Si el estado es ambiguo, debe permanecer bloqueado y enumerar la evidencia faltante. La receta mutable actual no sustituye la definición histórica.

El hijo deberá fijar un contrato persistido de evidencia y aprobación del servidor, actor/capacidad, motivo, estado previo esperado y clave idempotente. Bajo la misma transacción serializable verificará alcance, head y proyección, registrará el hecho auditado y sus movimientos/revisión sin borrar ni reescribir hechos anteriores. No basta un booleano del cliente declarando que la evidencia existe.

Antes de aceptación: doble envío de la recuperación, fallo después del movimiento, dos recuperaciones concurrentes, conflicto con una corrección ordinaria y pruebas de otra empresa/sucursal deben conservar stock, venta y auditoría coherentes. Se abrirán dependencias de evidencia/auditoría específicas si el modelo actual no representa ese sujeto; no se dará por existente el recorrido de aprobación. INV-01.c seguirá abierto hasta comprobar estos casos y acreditar sus dependencias.
