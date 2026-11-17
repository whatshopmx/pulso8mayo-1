# Guía de Usuario Final (Roles: EMPLEADO, SUPERVISOR)

Bienvenido a **Pulso HORECA**. Esta plataforma está diseñada para facilitar tu operación en la sucursal del restaurante, desde asentar transferencias hasta reportar tus horarios y vacaciones de manera automática.

## 1. Navegación Principal

Cuando inicies sesión en Pulso, verás en la barra lateral (Sidebar) los menús acordes a tus permisos:
- **Operación**: Dónde encontrarás "Mis Tareas", "Incidentes" y "Ejecución Rápida". Aquí resolverás los Workflows y checklists diarios.
- **Personal**: Aquí revisarás el Constructor de Horarios, podrás verificar tu Asistencia, solicitar Vacaciones y revisar tus métricas de Horas Extras.
- **Perfil**: Configuración general y tu panel para activar Notificaciones WhatsApp (Opt-in).

## 2. Workflows Diarios (Checklists)

La operación diaria en un restaurante requiere procesos estrictos de apertura, preparación de alimentos, y limpieza y cierre (NOM-251). Para esto, dirígete a **Mis Tareas** en el menú de Operación.
1. Selecciona la tarea o rutina a ejecutar, por ejemplo: `Checklist Apertura V1`.
2. Llena de forma secuencial cada bloque validando las temperaturas de refrigeradores, la higiene de mesas y pasillos.
3. Puedes tomar fotos o evidencias documentales antes de marcar el paso como completo. Todo lo que adjuntes es respaldado.

## 3. Asistencia y Geolocalización

Pulso facilita que marques tu hora de entrada desde tu celular. Para esto:
1. Navega a `Personal` > `Geolocalización` (o al acceso rápido en tu Dashboard general).
2. Debes conceder permisos de ubicación en tu navegador para que Pulso verifique si estás dentro del perímetro autorizado de tu sucursal.
3. Se generará un marcador temporal verde que te habilitará presionar `Clock In`.

## 4. Alertas de Inventario

Como operador de sucursal, es probable que se agoten ciertos insumos. Dirígete a **Inventario > Alertas de Stock** para reportar manualmente insumos extintos o observar qué envíos automáticos generó el sistema debido a escaseces repentinas.

## 5. Integración con WhatsApp

Para comunicarte con la plataforma a través de tu servicio de mensajería favorito y que Pulso avise si te asignaron una tarea:
1. Ve a **Perfil > Notificaciones**.
2. Dale a "Activar Notificaciones de WhatsApp". 
3. Envía el mensaje con la palabra reservada que indique la plataforma para enrolar tu número registrado.

## 6. Facturas de compras y gastos operativos (Finanzas)

Un mismo proveedor puede venderte insumos y cobrarte servicios. En Pulso eso se decide **por documento**, no por proveedor: la harina es una compra de inventario y la luz o el mantenimiento son gastos operativos.

### 6.1 Cargar un CFDI al registrar un gasto

1. Entra a **Finanzas > Gastos > Nuevo gasto** (o a la ficha de la contraparte y elige **Nuevo Gasto Operativo**).
2. Elige **Cargar CFDI** y sube el XML.
3. Revisa la vista previa: emisor, receptor, UUID, fecha, moneda, subtotal, impuestos y total.
4. Completa categoría, sucursal, centro de costo (opcional) y vencimiento, y confirma.

El gasto queda **por aprobar**: cargar la factura no lo autoriza ni lo paga. Al confirmar se guarda una sola vez la factura y su gasto; si el XML ya estaba registrado, la plataforma te ofrece abrir ese gasto en vez de crear otro.

### 6.2 Documentar un gasto que ya registraste

1. Abre **Finanzas > Gastos** o la pestaña **Movimientos** de la contraparte.
2. Busca el gasto que dice «sin comprobante» y usa **Asociar factura**.
3. Puedes elegir una **factura existente** compatible o **cargar el XML**.
4. Si el importe, la sucursal, la moneda, la contraparte o el estado no coinciden, la plataforma lo dice antes de confirmar y no cambia el gasto.

### 6.3 Consultar compras, gastos y pendientes

En la ficha de la contraparte, la pestaña **Documentos** permite filtrar por **Todos / Compra de inventario / Gasto operativo / Por clasificar**. Cada fila indica qué es el documento y te lleva a su origen: el gasto, la compra de inventario o la revisión de la factura.

- **Compra de inventario**: sigue el circuito de orden de compra y recepción.
- **Gasto operativo**: se administra desde Finanzas; su XML se descarga desde el gasto.
- **Por clasificar**: documento histórico sin evidencia suficiente. Se conserva visible y no se le asigna destino por suposición.

### 6.4 Qué hacer si la carga se rechaza

- **Inventario** solo acepta compras de inventario. Si cargas ahí una factura de servicio, te remitirá a Finanzas.
- Un CFDI con **retenciones, IEPS, descuentos, complementos, moneda distinta de MXN o receptor que no es tu empresa** no se puede capturar todavía en el circuito de gastos; regístralo con tu contador y no lo fuerces.
- Un **periodo cerrado** bloquea altas, asociaciones y pagos de ese mes: pide la reapertura correspondiente.
- La **contraparte debe estar activa y tener el mismo RFC del emisor** del XML.
