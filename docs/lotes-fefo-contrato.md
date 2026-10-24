# Contrato operativo de lotes y FEFO

Fecha: 2026-10-24. FEFO-02: contrato aceptado por el usuario en esta sesión (respuesta: «Aceptar las reglas propuestas»). Autoriza los incrementos dependientes del plan; no autoriza saneamiento histórico, migraciones ni despliegues en producción.

## Identidad y compatibilidad

Cada fila actual de `inventory_batches` sigue siendo una existencia local de un producto en una sucursal, con ID interno único. `lotNumber` conserva el código capturado; no identifica globalmente un lote ni permite fusionar recepciones. Una nueva entrega conserva su recepción, proveedor y origen aunque repita código. La transferencia genera existencia local en destino y conserva vínculo a cada existencia de origen. `origin`, `parentBatchIds` y los documentos existentes se reutilizan antes de crear relaciones nuevas.

No dividir ahora la tabla en identidad y saldo: separar ambos conceptos en el contrato y guardar los vínculos necesarios en los incrementos de recepción/transferencia. No imponer unicidad al código del proveedor. No tocar saldos, fechas o movimientos históricos para acomodarlos al modelo.

## Decisiones aceptadas

| Tema | Regla propuesta |
|---|---|
| Reloj | Autorizar con reloj del servidor; preview orienta y confirmación revalida. |
| Fecha civil nueva | Capturar explícitamente fecha local y zona IANA de la sucursal (`branches.timezone`). Disponible durante esa fecha; vencido al comenzar el día siguiente local. Conservar fecha/semántica/zona originales además del instante límite calculado. No usar el huso del navegador. |
| Instante nuevo | Exigir offset o Z; respetar exactamente el instante capturado. En el instante límite ya está vencido. |
| Fecha histórica | Un timestamp existente sin semántica explícita conserva su interpretación actual como instante; no inferir por medianoche que era fecha civil ni extender vigencia silenciosamente. Corregir semántica sólo con evidencia y auditoría. |
| Sin fecha | Si el producto exige caducidad, bloquear disponibilidad/consumo hasta capturar dato o excepción específica autorizada. Si explícitamente no caduca, permitir fecha nula y FIFO. Política desconocida: exigir fecha para salida física, hasta revisión. No inferir perecibilidad sólo de categoría textual o almacenamiento. |
| Selección | FEFO: límite ascendente; fechas nulas permitidas al final; desempate `receivedAt`, `createdAt`, `id`. FIFO: misma antigüedad y desempate, conservando filtro de caducidad. Lote explícito pasa todas las guardas. |
| Cantidades/costo | Unidad base, cantidades a cuatro decimales; cálculos exactos y costo en centavos. Conversión única en frontera; una transacción posee saldo + movimiento + auditoría. |
| Faltante físico | Rechazar operación completa si falta stock elegible; no descontar parcialmente sin confirmación específica de una operación parcial. Nunca saldo físico negativo. |
| Ventas teóricas | Guardar requerido/asignado/faltante por evento idempotente; asignar sólo stock elegible y guardar diferencia separada. No nuevos DUMMY-NEG ni negativizar el último lote. Conciliación posterior con referencias, sin reescribir la venta original. |
| Reserva | RESERVED no participa en consumo genérico. Sin modelo explícito de reserva parcial, no crear reservas parciales simuladas mediante estado global. Sólo liberar reserva íntegra por operación auditada; no consumirla ni cancelarla implícitamente al ajustar. |
| Cuarentena | Bloquea consumo. Motivo obligatorio al bloquear/liberar. Liberación por GERENTE o superior dentro de su alcance; no elimina validación de fecha y saldo. SUPERVISOR puede inmovilizar, no liberar. |
| Vencidos | Ni selección manual ni cambio de estado autorizan consumo vencido. Merma sí puede retirar stock vencido o en cuarentena con saldo suficiente y motivo; no hace falta liberarlo antes. |
| Estado agotado | DEPLETED se deriva de saldo cero; no usar PATCH para convertir saldo positivo en agotado, ni para crear saldo al reactivar uno agotado. Estados no sustituyen movimientos de cantidad. |
| Excepción | GERENTE o superior, motivo, responsable y alcance específico; nunca exceptúa empresa/producto/sucursal ni autoriza consumir vencidos o sobreconsumir. Fecha faltante requiere evidencia operativa antes de liberar. No añadir bypass general. |
| Devolución/reversión | Movimiento compensatorio enlazado al original, con idempotencia, cantidades y actor. No borrar ni editar movimientos originales. Si la condición física/caducidad no permite disponibilidad, reingreso en cuarentena. Periodo cerrado requiere reapertura autorizada y auditada antes de compensación. |
| Transferencia parcial | Permitir varias recepciones por asignación enviada; acumulado recibido + merma no excede enviado. El descuento sucede una vez al enviar. Cerrar faltante con merma en tránsito y motivo; reintentos no repiten efectos. Conservar lote, caducidad, costo y origen por asignación. |
| Producción | Servicio inmediato registra consumo/producción; no inventa stock terminado. Preparación almacenable exige producto y unidad de salida, vida útil validada y genealogía de todos los ingredientes. Caducidad de salida se determina por política validada y no puede ampliar arbitrariamente la vigencia impuesta por ingredientes. Configuración incompleta se rechaza. |

## Alcance y roles

Empresa siempre desde la sesión; incluso SUPER_ADMIN queda acotado a su empresa activa. ADMIN/OWNER/SUPER_ADMIN pueden operar sus sucursales; GERENTE/SUPERVISOR, sólo su sucursal asignada. EMPLEADO sólo consulta su sucursal; READONLY conserva consulta de empresa sin escritura. Rol ausente/desconocido o rol local sin sucursal: denegar. Las lecturas del lote, su trazabilidad y toda escritura usan el mismo alcance; un ID ajeno no revela datos.

Cambios manuales de estado requieren permiso `inventory:update`, motivo y auditoría durable en la misma transacción. No alterar la matriz global de roles. SUPERVISOR puede inmovilizar un AVAILABLE en cuarentena; liberar cuarentena/reserva o editar políticas requiere `inventory:manage`. La API no ofrece editar fechas en este incremento; la corrección futura debe exigir esa autoridad y evidencia. Cambiar política no reescribe lotes anteriores.

## Ejemplos que deben convertirse en pruebas

| Caso | Resultado esperado |
|---|---|
| Fecha civil 24/oct, 24/oct 23:59:59 en zona de sucursal | Aún vigente; vence al iniciar 25/oct local. |
| Instante límite `2026-10-24T12:00:00Z`, reloj igual al límite | Rechazado por vencimiento. |
| Timestamp histórico a medianoche, sin semántica | Se respeta el instante; no se convierte automáticamente a fin del día. |
| Perecedero sin fecha / producto explícitamente no perecedero sin fecha | Primero bloqueado; segundo elegible según FIFO. |
| Dos lotes: recepción nueva vence antes que antigua | FEFO toma primero la nueva; FIFO respeta recepción si ambos siguen vigentes. |
| Solicitar 1.2500; lotes elegibles 0.4000 + 0.8500 | Dos asignaciones cuya suma exacta es 1.2500. |
| Solicitar físicamente 2.0000 y disponer 1.2500 | Rechazo sin descuentos. Venta teórica equivalente: asignado 1.2500, diferencia 0.7500. |
| AVAILABLE vencido con cron detenido / RESERVED / QUARANTINED | Los tres rechazados para consumo genérico. |
| Liberar cuarentena vencida / agotar lote con saldo positivo por PATCH | Rechazado; usar merma con movimiento si corresponde. |
| EMPLEADO intenta PATCH; GERENTE consulta lote de otra sucursal | Escritura denegada / lote no encontrado sin revelar datos ajenos. |
| Transferencia 1.2500, recepciones 0.4000 y 0.8500; repetir segunda | Total recibido 1.2500; ningún efecto adicional en reintento. |
| Revertir merma / revertir consumo a lote ahora vencido | Compensación referenciada; el segundo reingresa inmovilizado, sin disponibilidad automática. |

## Aceptación y límites

El usuario aceptó la propuesta completa presentada: incluye fecha histórica como instante, política desconocida sin fecha, reservas íntegras, restricciones de liberación y venta teórica con faltante separado. La auditoría FEFO-01 encontró 8 lotes sin movimientos y 15 diferencias en el demo: el contrato no resuelve ni autoriza corregir ese historial. FEFO-04/05 pueden implementar estas reglas una vez cumplidas sus dependencias técnicas.
