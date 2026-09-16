# Propuesta de rediseño: Equipos y mantenimiento

Fecha: 16 de septiembre de 2026. Estado: propuesta para revisión, sin implementación.

## Objetivo y alcance

Diseñar la gestión completa de equipos para un grupo restaurantero de 3 a 15 sucursales en el área metropolitana de Monterrey. Los tres objetivos confirmados son organizar inventario y responsables, prevenir y atender fallas, y controlar gastos, proveedores y reemplazos. El uso será compartido entre dueño/dirección y gerentes; la coordinación de mantenimiento es una responsabilidad asignable, no un puesto obligatorio.

La revisión cubre las ocho páginas de `app/dashboard/equipment`, los componentes de `components/equipment`, formularios, rutas de equipos y sus principales conexiones con servicios de cumplimiento, órdenes de servicio, esquemas y servicios de negocio. Se revisó el código y las guías `PRODUCT.md` y `DESIGN.md`. No se ejecutó el módulo en navegador ni se verificaron datos de producción: los hallazgos funcionales son de revisión estática, y la composición propuesta requiere validación visual posterior. CodeGraph no estuvo disponible en esta sesión.

## Diagnóstico del módulo actual

Existe una base aprovechable: catálogo de modelos, equipos por sucursal, garantías, historial y programación de mantenimiento, proveedores, servicios periódicos, alertas en el modelo y órdenes de servicio con cotizaciones, autorizaciones, evidencias, conformidad y factura asociada.

| Hallazgo en código | Consecuencia para el usuario | Tratamiento propuesto |
|---|---|---|
| La portada abre con inventario, cinco métricas y distribución por tipo. | Hay que buscar qué equipo requiere una decisión. | Abrir con una agenda semanal y pendientes que afectan la operación. |
| Inventario, estadísticas y mantenimiento requieren `tenant.branchId`; el contexto global puede representar “Todas” con `null`. | La vista de grupo no está resuelta de manera consistente. | Un mismo alcance de empresa/sucursal en consultas, encabezado, filtros y contadores. |
| El inventario envía filtros `status` y `type`, pero su GET no los pasa al servicio. | Los controles pueden aparentar filtrar sin cambiar los resultados. | Aplicar filtros reales y conservarlos en la URL. |
| `EquipmentAlerts` asigna `[]` y simula reconocimiento/resolución. | “Todo está en orden” no demuestra ausencia de problemas. | Conectar alertas reales; distinguir sin pendientes, sin datos y error. |
| El formulario usado para editar siempre hace POST a `/api/equipment`. | La edición intenta crear otro registro. | Separar alta y actualización; preservar identidad e historial. |
| El POST de mantenimiento crea un registro programado y actualiza `lastMaintenanceDate` con el momento actual. | Programar puede parecer equivalente a haber realizado el trabajo. | Actualizar última ejecución únicamente al completar el trabajo válido. |
| El calendario consulta próximos 60 días aunque se cambie el mes. | El mes visible no determina el intervalo consultado. | Consultar fechas de inicio/fin visibles, además de una cola independiente de vencidos. |
| En el detalle, Registrar mantenimiento y Agregar garantía no tienen acción conectada; Historial de cambios es un estado pendiente. | El expediente ofrece recorridos incompletos. | Completar esas acciones y construir una bitácora verificable. |
| Servicios aparecen dentro de la portada y en una ruta independiente con capacidades distintas. | Dos lugares para un mismo concepto. | Una única superficie de servicios periódicos con enlaces desde agenda y equipo. |
| Las órdenes ya admiten `equipmentId`, pero están anidadas bajo cumplimiento. | Un correctivo de refrigerador queda conceptualmente escondido. | Darles acceso directo dentro de Equipos y mantenimiento. |
| El cierre de OS revisado propaga historial de cumplimiento, pero no muestra una propagación equivalente al historial de equipos. | Un trabajo puede quedar cerrado en un lugar y pendiente en otro. | Sincronizar OS, ejecución e historial con una referencia única y protección contra duplicados. |
| Hay consultas/mutaciones de equipos por ID y consultas por `branchId` sin predicado explícito de empresa en los servicios revisados. | El alcance visible necesita respaldo consistente en servidor. | Verificar pertenencia a empresa y sucursal autorizada antes de leer o modificar; pruebas de aislamiento. |

Otros ajustes: traducir códigos de estado/frecuencia; reemplazar “Back of House” por nombres operativos; corregir conversión de precios que usa `parseInt` y pierde decimales; diferenciar cero de importe desconocido; evitar interpretar “equipo crítico” como “equipo averiado”.

## Concepto: la semana operativa de los equipos

La portada responde: qué afecta el servicio hoy, qué visita está programada, quién debe actuar y qué gasto necesita decisión. Desde cada pendiente se llega al mismo expediente y a la misma orden.

Se mantiene la identidad de Pulso: Geist, fondos claros con capas tonales, rojo operativo escaso y componentes compartidos. El cambio fuerte está en jerarquía, composición, navegación y recorridos. No se propone cambiar la marca global.

La composición elegida para esta propuesta es una agenda semanal de visitas y fallas, con pendientes prioritarios y decisiones por rol. Permite comparar sucursales sin convertir la portada en un catálogo. Riesgo: una semana con muchas visitas puede saturarse; se resuelve con filas agrupadas, filtros y una vista de lista equivalente. Esta dirección puede revisarse antes de construir el prototipo.

## Personas y responsabilidades

| Persona | Qué ve primero | Qué puede resolver |
|---|---|---|
| Dueño / dirección | Grupo completo, interrupciones, autorizaciones y gasto del periodo. | Priorizar, aprobar según matriz, comparar y decidir reemplazos. |
| Gerente | Su sucursal, pendientes del turno y visitas próximas. | Reportar falla, ubicar equipo, coordinar acceso, confirmar funcionamiento y aportar evidencia. |
| Responsable de mantenimiento | Pendientes y visitas de las sucursales que tenga autorizadas. | Asignar proveedor, programar, documentar diagnóstico y dar seguimiento. |
| Técnico / proveedor, etapa posterior | Solo los trabajos expresamente asignados. | Consultar alcance, aportar diagnóstico/evidencia e informar terminación. |

Las personas pueden asumir más de una función. La interfaz adapta alcance y acciones usando permisos existentes; no crea automáticamente nuevos roles. Preservar la separación entre solicitante y autorizador que ya contempla la OS. Si una empresa pequeña no tiene un segundo autorizador, tratarlo como configuración pendiente: no eludir esa regla.

## Arquitectura de información

Nombre visible: **Equipos y mantenimiento**.

| Entrada | Contenido | Acción principal |
|---|---|---|
| Hoy | Pendientes urgentes, semana operativa, resumen por sucursal y decisiones. | Reportar falla. |
| Equipos | Inventario agrupable por sucursal/área, expediente, responsables y garantías. | Agregar equipo. |
| Mantenimiento | Órdenes, agenda y planes preventivos como vistas del mismo trabajo. | Programar trabajo. |
| Costos | Comprometido, facturado, pagado, historial por equipo y revisión de reemplazos. | Revisar gasto o propuesta. |
| Más → Proveedores | Especialidad, cobertura, documentos y trabajos relacionados. | Asignar o registrar proveedor. |
| Más → Servicios periódicos | Fumigación, limpieza especializada y servicios de instalaciones, sin forzar un equipo ficticio. | Programar servicio. |
| Más → Catálogo y ajustes | Modelos, tareas sugeridas, responsables, reglas y configuración. | Estandarizar registros. |

Catálogo significa modelo reutilizable; equipo significa unidad física con sucursal, identificación e historial. La navegación diaria debe hacer evidente esa diferencia.

“Todas las sucursales” reutiliza el selector global y solo incluye las autorizadas. Evitar un segundo selector independiente que contradiga el encabezado. Al entrar desde una sucursal, conservar ese contexto; al cambiarlo, actualizar todas las regiones de la pantalla.

## Pantallas propuestas

### Hoy: panorama y agenda

Primera pantalla: título y alcance; acción Reportar falla; banda compacta de pendientes; agenda semanal; decisiones; resumen comparativo de sucursales. Los contadores funcionan como filtros y muestran su periodo. No usar una fila de cinco tarjetas gigantes como apertura.

Esquema de baja fidelidad. Todos los nombres y cifras siguientes son ejemplos ficticios:

```text
Equipos y mantenimiento       Todas las sucursales ▾    [Reportar falla]
Hoy     Equipos     Mantenimiento     Costos     Más ▾

Requiere atención
2 equipos detenidos · 3 trabajos vencidos · 2 gastos por autorizar

Esta semana                                  Decisiones pendientes
              Lun 14  Mar 15  Mié 16  Jue 17  Vie 18
San Pedro                     Frío           Cotización de refrigeración
Centro        Campana                        Responsable · monto · plazo
Cumbres                                A/A   [Revisar solicitud]

[Ver como lista] [Filtrar por especialidad]   Equipos sin responsable

Sucursal        Situación           Próxima visita     Responsable
San Pedro       1 equipo detenido   Hoy, 16:00         Ana
Centro          Sin fallas abiertas Mañana, 09:00      Luis
Cumbres         1 revisión vencida  Vie, 08:00         Marta
```

Una celda de visita abre un panel con equipo, motivo, proveedor, ventana y siguiente acción. Abrir expediente lleva a una URL propia. La agenda tiene vista de lista para móviles, teclado y semanas saturadas; no depende de arrastrar tarjetas. Con 15 sucursales se filtra/agrupa y mantiene visible el nombre de fila.

### Inventario y expediente

Listado con columnas esenciales: equipo, sucursal/área, condición operativa, responsable, próximo trabajo. Identificador y modelo son información secundaria. Filtros rápidos: detenidos, sin responsable, preventivo vencido, garantía próxima a vencer. Búsqueda por nombre, código, serie y modelo; paginación y ordenamiento en servidor.

Ficha del equipo:

- Encabezado con nombre/foto, código, sucursal, área y condición. Acción Reportar falla o Ver trabajo abierto según contexto.
- Resumen con responsable, garantía aplicable, próxima visita y costo acumulado del periodo seleccionado.
- Secciones: Actividad, Plan de mantenimiento, Documentos y garantías, Costos y datos del equipo.
- Bitácora cronológica con fallas, diagnósticos, visitas, evidencias y cambios de responsable/ubicación.
- QR para abrir el expediente con permisos; nunca exponer costos o documentos mediante un enlace público permanente.
- Dar de baja en menú secundario, con motivo y conservación del historial.

Separar tres conceptos: condición física (operando, detenido, en mantenimiento), importancia para la operación (crítico/no crítico inicialmente) y estado del trabajo (por autorizar, programado, en ejecución). Un refrigerador crítico que funciona no lleva una alarma roja permanente.

### Alta y movimientos

Alta rápida: sucursal, nombre o modelo de catálogo, tipo, área y responsable. Código sugerido editable, único según regla de empresa. Compra, garantía y documentos pueden completarse después. Marcar explícitamente información pendiente.

Desde catálogo, precargar marca/modelo y un plan sugerido que se revisa antes de aplicar. Permitir crear varias unidades con series distintas mediante importación con vista previa y detección de duplicados.

Traslado entre sucursales: origen, destino, fecha, motivo y recepción. Mantener ID e historial; registrar el destino como ubicación actual y conservar la sucursal histórica de cada gasto. No resolverlo creando otro equipo.

### Reporte de falla

Recorrido corto desde QR, expediente o Hoy: confirmar equipo → describir problema/foto → indicar si puede operar → registrar reporte. Si no se conoce el equipo, permitir un reporte por área para que el gerente lo identifique después.

Mostrar folio, responsable y siguiente paso confirmado. Si ya existe trabajo abierto, ofrecer agregar evidencia al mismo. El reporte inicial no exige cotización ni factura. Estas se añaden cuando corresponde al flujo de autorización.

Prioridad inicial propuesta: interrupción de servicio o situación de seguridad reportada primero, luego vencidos en equipos críticos, próximos compromisos y trabajo rutinario. La prioridad debe tener motivo visible y ajuste humano con registro; no inferir diagnósticos técnicos mediante una foto.

### Mantenimiento y órdenes

Unificar agenda, lista de órdenes y planes. Vistas guardadas: Por atender, Por autorizar, Programados, En ejecución, Por confirmar y Cerrados. “Vencido” es una condición calculada de fecha y trabajo abierto, no una etapa que borre el estado real. “Esperando refacción” es un bloqueo con motivo y próxima revisión.

Preservar el flujo de OS existente: borrador → por autorizar → autorizada → programada → en ejecución → pendiente de conformidad → cerrada, con rechazo/cancelación según reglas. El reporte de falla puede existir antes de una OS. No crear otro motor de autorizaciones.

Programación: proveedor, contacto, sucursal, ventana de visita, duración y responsable de acceso. Advertir si coincide con una ventana de servicio definida por la sucursal. Permitir agrupar visitas del mismo proveedor sin mezclar aprobaciones, evidencias o costos de sucursales diferentes.

Cierre: trabajo realizado, refacciones, evidencia, resultado y confirmación del gerente. Separar “terminó el trabajo” de “el equipo volvió a operar”. Registrar hora real de restitución para medir paro; firmar conformidad no debe inventarla. Rechazar conformidad permite corrección dentro del flujo, sin duplicar la orden.

Planes: modelo/equipo, tarea, periodicidad, próxima fecha y proveedor opcional. Definir si la siguiente fecha depende del calendario fijo o de la ejecución real. Para equipos detenidos/dados de baja, pausar o revisar los planes, conservando trazabilidad. La generación periódica debe ser idempotente.

### Proveedores y servicios periódicos

Directorio operativo por especialidad y sucursales atendidas. Mostrar contacto, disponibilidad declarada, documentación y trabajos abiertos. Reutilizar proveedores y su relación con proveedores fiscales existentes; no duplicar RFC/contactos en cada trabajo. Las calificaciones manuales actuales no equivalen a desempeño medido.

Servicios periódicos comparten agenda y órdenes, pero conservan su configuración y evidencia específica. Mostrar fecha de ejecución y documento disponible por separado: servicio realizado no implica expediente completo. No asignar automáticamente frecuencias legales ni afirmar cumplimiento por haber cerrado una orden.

### Costos y reemplazos

Resumen por sucursal, categoría, proveedor y equipo. Mostrar importe autorizado/comprometido, facturado y pagado por separado: son etapas relacionadas, no montos para sumar entre sí. Preservar fuente, moneda MXN, periodo y criterio de impuestos. Vincular factura desde el módulo existente.

Ficha económica: compra registrada, correctivos, preventivos, garantías utilizadas y paros documentados. Tabla de revisión: equipo, antigüedad conocida, fallas repetidas, gasto del periodo y cotización de reemplazo si existe.

Propuesta de reemplazo con motivo, costo cotizado, historial y decisión pendiente. Umbrales configurables; ninguna regla universal de “reemplazar al X%”. No calcular retorno, depreciación fiscal, ahorro energético ni pérdida de venta sin datos y criterios específicos. Mostrar “Sin información” cuando corresponda.

## Adaptación a Monterrey y al tamaño del grupo

Priorizar como hipótesis operativa refrigeración, congelación, climatización y extracción, validándolo con el inventario y fallas reales. Nuevo León publica recomendaciones por altas temperaturas, y CENAPRED recomienda mantenimiento del aire acondicionado durante olas de calor. La campaña estacional propuesta es una decisión de diseño, no una frecuencia técnica universal: [Gobierno de Nuevo León](https://www.nl.gob.mx/es/recomendaciones-calor), [CENAPRED](https://www.gob.mx/cenapred/articulos/uso-del-aire-acondicionado-durante-olas-de-calor).

Usar español mexicano, MXN y zona `America/Monterrey` para la operación objetivo, conservando configuración por sucursal. Separar fechas de calendario de marcas de tiempo para evitar desplazamientos de día. Cobertura de proveedores por municipio/zona y ventanas de visita editables; no prometer tiempos de traslado calculados sin integración.

Para 3 sucursales: gerente puede coordinar visitas y dirección autorizar; evitar exigir estructura corporativa adicional. Para 15: asignación central, agrupación por zona y seguimiento por responsable. Misma interfaz y datos, con mayor capacidad de agrupación.

WhatsApp, como extensión posterior: enlace al trabajo, confirmación de visita y carga de evidencia mediante una sesión/enlace limitado. Los estados de envío, entrega y respuesta deben ser distintos. Reutilizar la infraestructura de mensajería existente y verificar el proveedor activo; no asumir que este flujo específico ya está conectado.

## Lenguaje visual, interacción y estados

- Jerarquía: pendiente y siguiente acción primero; identificadores, fechas y datos de compra después. Fondos planos, divisores finos, superficies tonales y rojo acotado conforme a DESIGN.md.
- Texto principal 14–16 px; formularios móviles 16 px; etiquetas nunca menores a 12 px. Objetivos táctiles de 44 px en acciones de campo.
- Escritorio: agenda y panel contextual. Tableta: menos columnas y panel superpuesto. Móvil: lista por día, sucursal fija según alcance y acción Reportar falla accesible.
- Estado siempre con texto/icono además del color. Enlaces y botones reales para abrir filas, foco visible, nombres accesibles, retorno de foco al cerrar panel y reducción de movimiento.
- Estados diferenciados: primer uso, sin coincidencias, sin pendientes con consulta exitosa, error con reintento, sin permiso, datos parciales y actualización en conflicto.
- Ante mala conexión, conservar texto del reporte y mostrar archivos pendientes. No afirmar que se envió hasta recibir confirmación. Operación offline completa queda fuera de la primera entrega.
- Mostrar “Actualizado…” y permitir refrescar; después de una mutación actualizar expediente, lista, agenda y contadores del alcance afectado.

## Base de datos e integración necesarias

Reutilizar `equipmentCatalog`, `branchEquipments`, garantías, historial, schedules, proveedores, servicios, alertas y `serviceOrders`. El vínculo opcional de OS a equipo ya existe: revisar integridad y pertenencia, no agregar otra columna equivalente.

Ampliaciones propuestas, aún no implementadas: asignaciones de responsables con vigencia, reportes de falla con vínculo a OS, eventos de condición/paro, traslados, ventanas de visita y propuestas de reemplazo. Elegir tablas/eventos con referencias antes de añadir nuevos JSON aislados. El QR identifica el equipo; la autorización se resuelve al abrirlo.

Definir una referencia única entre ejecución de mantenimiento y OS para evitar duplicar costos e historial. Al cerrar, sincronizar ejecución, condición y próxima fecha mediante transacción o mecanismo durable con reintento e idempotencia. Preservar documentos originales y fechas históricas en la migración.

Revisar las rutas afectadas por alcance: `/api/equipment`, `/stats`, `/maintenance`, `/maintenance/upcoming`, `/[id]`, garantías y mantenimiento individual. Autorizar también equipos, proveedores, sucursales y órdenes vinculados. Los filtros deben tener el mismo significado en API e interfaz.

## Secuencia de implementación

| Fase | Entrega concreta | Condición de aceptación |
|---|---|---|
| 0. Base confiable | Edición real, filtros, permisos/alcance, fechas correctas, vacíos honestos y botones conectados. | Editar no crea otro equipo; programar no marca ejecución; “Todas” funciona y respeta permisos. |
| 1. Inventario y responsables | Navegación común, lista multissucursal, expediente, alta progresiva, asignación y garantías. | Localizar equipo y responsable; distinguir modelo/unidad; mantener identidad al editar. |
| 2. Trabajo diario | Hoy, agenda, reportes, órdenes enlazadas, preventivos, proveedor y cierre. | Recorrer falla → atención → conformidad → historial sin recaptura ni duplicados. |
| 3. Control económico | Costos por fuente/periodo, factura vinculada, cotizaciones y propuestas de reemplazo. | Explicar cada monto y comparar sucursales sin sumar dos veces el mismo gasto. |
| 4. Despliegue al grupo | Importación, QR, traslados, campañas por zona y WhatsApp específico. | Piloto con dueño y gerentes; expansión manteniendo permisos y trazabilidad. |

Los tres objetivos forman parte del resultado completo. Las fases ordenan dependencias; no dejan costos o inventario como sugerencias opcionales. El MVP operativo llega hasta la fase 3; la fase 4 facilita adopción y escala. No se estima calendario sin dimensionar datos, integraciones y disponibilidad del equipo.

Mapeo de rutas: `/dashboard/equipment` pasa a Hoy; nuevo `/equipment/inventory` conserva inventario; `/equipment/[id]` conserva expedientes; `/equipment/maintenance` concentra trabajo; `/equipment/costs` agrega control económico. Dar acceso directo a órdenes y mantener redirecciones desde `/equipment/compliance/service-orders` y sus detalles, preservando identificadores y filtros. Catalog, providers y compliance conservan datos/rutas compatibles durante la transición.

## Validación y definición de terminado

Preparar datos sintéticos para 3 y 15 sucursales, nombres largos, equipos sin responsable, fallas simultáneas, documentos pendientes y ausencia de importes. Dimensionar volumen de equipos con el usuario antes de pruebas de carga.

Pruebas funcionales que sí importan: aislamiento de empresa/sucursal, edición sin duplicados, centavos exactos, filtros reales, intervalo visible de agenda, vencimiento derivado, generación preventiva sin repetidos, aprobación por rol, cierre idempotente y conciliación de gasto. Comprobar teclado, móvil y alcance global en navegador.

Metas de usabilidad propuestas, aún no medidas: el dueño identifica sucursal afectada y decisión pendiente en 30 segundos; gerente registra una falla simple en menos de un minuto; la coordinación programa una visita sin volver a escribir equipo/sucursal; cada monto enlaza a su fuente.

Medición posterior: porcentaje de equipos con responsable, críticos con plan vigente, preventivos a tiempo, tiempo hasta primera atención, horas de paro registradas, fallas repetidas y gasto por equipo. Definir denominadores, periodos y cobertura; no mostrar disponibilidad porcentual sin eventos de paro suficientes ni ranking por sucursal basado solo en conteos absolutos.

Próximo entregable de diseño: prototipo de Hoy, inventario, expediente, reporte de falla, orden/cierre y costos, con un mismo caso ficticio recorrido por dueño y gerente. Validar ese recorrido antes de extenderlo a las ocho pantallas existentes. Este documento no cambia código ni autoriza despliegue.

## Archivos principales de referencia

- `app/dashboard/equipment/page.tsx` y las siete páginas descendientes.
- `components/equipment/equipment-form.tsx`, `equipment-alerts.tsx`, `equipment-stats.tsx`, `maintenance-calendar.tsx` y los formularios/listados del mismo directorio.
- `app/api/equipment/route.ts`, `stats/route.ts`, `maintenance/route.ts`, `maintenance/upcoming/route.ts` y `[id]/route.ts`.
- `lib/services/equipment-service.ts`, `lib/services/service-order-service.ts`.
- `lib/db/schema/equipment.ts`, `lib/db/schema/service-orders.ts`.
- `lib/tenant-context.ts`, `components/app-sidebar.tsx`, `PRODUCT.md`, `DESIGN.md`.
