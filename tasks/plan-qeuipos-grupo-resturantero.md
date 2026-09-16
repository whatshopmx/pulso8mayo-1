# Plan de implementación: equipos para grupo restaurantero

Fecha: 2026-09-16.
Estado: planificación terminada; implementación, validación visual y aceptación pendientes.

Fuente: [2026-09-16-rediseno-equipos-grupo-restaurantero.md](../plans/2026-09-16-rediseno-equipos-grupo-restaurantero.md).
Checklist y especificación de cada tarea: [todo-qeuipos-grupo-resturantero.md](todo-qeuipos-grupo-resturantero.md).

Los archivos conservan literalmente el nombre solicitado: `plan-qeuipos-grupo-resturantero.md` y `todo-qeuipos-grupo-resturantero.md`. Este plan es independiente de `tasks/plan.md` y `tasks/todo.md`, que ya contienen trabajo en curso.

## Resultado esperado

Entregar **Equipos y mantenimiento** para un grupo de 3 a 15 sucursales: localizar cada unidad y su responsable, atender fallas y preventivos mediante órdenes existentes, y explicar gastos y decisiones de reemplazo desde sus fuentes. Dirección opera sobre el grupo autorizado; gerentes sobre su sucursal. Coordinar mantenimiento es una responsabilidad asignable y no exige un rol nuevo.

El MVP incluye inventario, trabajo diario y control económico: T01–T35. La adopción a escala incluye T36–T45. Costos y reemplazos forman parte del resultado obligatorio. WhatsApp se conecta en la etapa posterior prevista por la propuesta.

La entrega de esta sesión son únicamente estos dos documentos. No se han cambiado aplicación, datos, migraciones ni configuración; no se han ejecutado pruebas funcionales o un despliegue.

## Base revisada y límites

Revisión estática de la propuesta, `PRODUCT.md`, `DESIGN.md`, rutas de equipos, esquemas de equipos/OS, servicios, contexto de tenant y configuración de pruebas. CodeGraph no estuvo expuesto como herramienta en esta sesión; se usaron lecturas directas de los archivos de referencia. No se verificaron datos de producción ni se observó el módulo en navegador.

| Evidencia en el repositorio | Consecuencia para el plan |
|---|---|
| `equipment-form.tsx` envía POST aun con datos iniciales y convierte precio con `parseInt`. | T05 separa edición de alta y conserva centavos/identidad. |
| `GET /api/equipment` requiere sucursal, no pasa los filtros al servicio y acepta el `branchId` del query sin validarlo; `getEquipmentByBranch` filtra sólo por sucursal y nunca por empresa. | No es una carencia de filtros: es una lectura cruzada entre empresas. T02 la cierra; T10 conecta filtros, búsqueda y paginación. |
| El PUT de `[id]` exige `z.string().datetime()` en `purchaseDate`, `nextMaintenanceDate` y `lastMaintenanceDate`, mientras el POST acepta `z.string()` y el formulario emite `YYYY-MM-DD` desde `<Input type="date">`. | T05 unifica el contrato de fechas en ambos verbos: reconectar el formulario al PUT sin eso devolvería 400 al primer cambio de fecha. |
| Servicios por ID y mantenimiento contienen consultas sin predicado completo de empresa/sucursal. | T03–T04 cierran accesos directos e indirectos antes de nuevas funciones. |
| `lib/branch-scope.ts` ya diferencia ALL, BRANCH y NONE. | Reutilizar esa semántica; no tratar todo `null` como permiso global. |
| POST de mantenimiento crea SCHEDULED y actualiza `lastMaintenanceDate`. | T06 elimina esa equivalencia; T22 escribe ejecución real al cierre válido. |
| Próximos mantenimientos usa 60 días por defecto y enriquece registro por registro. | T07 consulta intervalo visible y vencidos independientes sin N+1. |
| OS ya tiene `equipmentId`, estados, cotizaciones, evidencia, conformidad y vínculo con factura. | Reutilizar OS y autorizaciones; no crear una columna o motor equivalente. |
| `signConformity` cierra primero y propaga servicio en un bloque posterior que captura errores; escribe COMPLIANT automáticamente. | T22 hace consistente/idempotente la propagación; T29 separa ejecución de cumplimiento. |
| Vitest cubre lógica pura y Playwright corre con un worker y servidor Inngest local. | Separar tests puros de verificaciones reales de BD y mantener E2E serial. |

Las rutas y módulos nuevos indicados en las tareas son ubicaciones propuestas. Confirmar la integración exacta antes de cada corte; si exige más de cinco archivos de lógica editados a mano, subdividir conservando sus criterios. No asumir que un enlace al módulo de pagos basta para demostrar importes pagados: T31 debe documentar esa fuente.

## Decisiones de arquitectura

1. **Alcance único.** Sesión y `companyId` provienen del servidor; el selector global aporta una intención de sucursal que se valida. Reutilizar `resolveBranchScope` y `assertBranchOfCompany`. Toda ruta nueva comprueba también permisos de acción, incluidas rutas por ID, adjuntos y referencias a proveedores, órdenes y facturas. Un gerente sin sucursal no recibe datos del grupo.
2. **Modelo y unidad separados.** Catálogo es modelo reutilizable; `branchEquipments` es unidad física. Edición, importación y traslado conservan identidad e historia. Se propone código único por empresa; revisar duplicados antes de imponer la restricción y no renombrar datos silenciosamente.
3. **Cambios aditivos por corte.** Reutilizar equipos, garantías, schedules, alertas, proveedores y OS. Extender `lib/db/schema/equipment.ts`, ya integrado al esquema principal, con entidades referenciadas para responsables, bitácora, reportes, condición/paro, visitas, traslados y reemplazos. Cada migración acompaña la función que la necesita, conserva fechas/documentos y se ensaya en BD aislada.
4. **Reportar antes de autorizar.** Falla puede existir sin OS ni cotización. Asociarla a una OS reutiliza el flujo borrador → por autorizar → autorizada → programada → en ejecución → pendiente de conformidad → cerrada, con rechazo/cancelación según reglas existentes. Mantener separación solicitante/autorizador.
5. **Estados independientes.** Criticidad, condición operativa y etapa del trabajo son ejes distintos. Vencido se deriva de fecha y trabajo abierto; espera de refacción es un bloqueo. Conformidad, terminación del trabajo y restitución real tienen eventos separados.
6. **Cierre consistente.** Referencia única OS–ejecución, transacción y restricciones de unicidad como primera opción, verificando soporte del adaptador. Si hace falta ejecución durable, documentar outbox/estado pendiente, reintentos y recuperación antes de usarla. Nunca ocultar un fallo de propagación con un éxito definitivo.
7. **Recurrencia explícita.** Distinguir calendario fijo y próxima fecha desde ejecución real. Clave única por plan/ocurrencia tanto en BD como en el flujo durable. Evitar cron duplicado y revisar planes de equipos detenidos/dados de baja.
8. **Costos trazables.** Enteros en centavos; cero no equivale a desconocido. Autorizado/comprometido, facturado y pagado son etapas y no se suman entre sí. Conservar criterio de impuestos, moneda, periodo, fuente y sucursal histórica. Conciliar facturas, pagos parciales y cancelaciones con las fuentes existentes.
9. **Interfaz coherente.** Reutilizar componentes y tokens de Pulso; Geist, capas tonales, sin sombras y rojo operativo escaso. Agenda semanal con lista equivalente para móvil/teclado; ninguna acción depende solo de drag-and-drop.
10. **Fechas y actualización.** `America/Monterrey` como propuesta inicial para las sucursales objetivo, conservando configuración por sucursal. Separar fechas de calendario de instantes. Claves de consulta incluyen empresa, alcance, periodo y filtros; tras mutaciones invalidar lista, expediente, agenda y contadores afectados sin mezclar respuestas de alcances anteriores.
11. **Mensajería existente.** Verificar el adaptador realmente activo antes de conectar WhatsApp; usar enlaces revocables y limitados al trabajo. Separar envío, entrega y respuesta. Pruebas con transporte simulado; los envíos reales requieren un contexto autorizado.
12. **Cumplimiento documentado.** Servicio ejecutado y expediente completo son hechos distintos. No inferir cumplimiento, frecuencias legales ni diagnósticos técnicos de una orden cerrada o de una foto.

## Rutas objetivo

| Ruta | Resultado |
|---|---|
| `/dashboard/equipment` | Hoy: atención, agenda semanal, decisiones y resumen por sucursal. |
| `/dashboard/equipment/inventory` | Inventario filtrable y alta/importación. |
| `/dashboard/equipment/[id]` | Expediente estable con actividad, planes, documentos y costos. |
| `/dashboard/equipment/maintenance` | Vistas de órdenes, agenda y planes. |
| `/dashboard/equipment/maintenance/orders[/id]` | Acceso directo a las mismas OS existentes. |
| `/dashboard/equipment/costs` | Control económico y revisión de reemplazos. |
| `/dashboard/equipment/providers` | Directorio operativo. |
| `/dashboard/equipment/compliance` | Única superficie de servicios periódicos, conservando compatibilidad. |
| `/dashboard/equipment/catalog` | Modelos y sugerencias de mantenimiento. |
| `/dashboard/equipment/compliance/service-orders[/id]` | Redirección compatible a órdenes, preservando ID y filtros. |

El contenedor se introduce de forma incremental: no habilitar Hoy/Costos como destinos terminados hasta que tengan funcionalidad. La ruta vieja de servicios conserva su URL compatible, pero no otra implementación duplicada en la portada.

## Secuencia y entregas

### Preparación y base confiable — T01 a T08

Corregir alcance, identidad, fechas y datos simulados.

- [ ] T01: Validar contratos y prototipo del recorrido.
- [ ] T02: Consultar inventario con alcance autorizado.
- [ ] T03: Proteger el expediente y sus recursos.
- [ ] T04: Validar referencias de órdenes y servicios.
- [ ] T05: Editar equipos preservando identidad e importes.
- [ ] T06: Separar programación de ejecución.
- [ ] T07: Consultar el intervalo visible de agenda.
- [ ] T08: Conectar alertas persistentes.

### Inventario y responsables — T09 a T15

Navegación, localización, alta progresiva y expediente verificable.

- [ ] T09: Introducir la navegación común.
- [ ] T10: Localizar equipos con filtros reales.
- [ ] T11: Modelar responsabilidades y bitácora.
- [ ] T12: Asignar responsables desde el expediente.
- [ ] T13: Completar el alta progresiva desde catálogo.
- [ ] T14: Completar garantías y documentos.
- [ ] T15: Presentar el expediente y la actividad.

### Trabajo diario — T16 a T30

Falla, OS existente, visita, conformidad, preventivos y Hoy.

- [ ] T16: Modelar reportes y eventos de condición.
- [ ] T17: Registrar una falla desde el equipo.
- [ ] T18: Dar acceso directo a órdenes existentes.
- [ ] T19: Atender reportes con la OS existente.
- [ ] T20: Modelar ventanas de visita y bloqueos.
- [ ] T21: Programar visitas desde mantenimiento.
- [ ] T22: Sincronizar cierre e historial de forma idempotente.
- [ ] T23: Confirmar trabajo y restitución por separado.
- [ ] T24: Definir políticas de planes preventivos.
- [ ] T25: Administrar planes desde equipo y modelo.
- [ ] T26: Generar preventivos sin repetidos.
- [ ] T27: Modelar cobertura operativa de proveedores.
- [ ] T28: Elegir proveedores por especialidad y cobertura.
- [ ] T29: Unificar servicios periódicos en agenda y OS.
- [ ] T30: Entregar Hoy como semana operativa.

### Control económico y aceptación del MVP — T31 a T35

Fuentes conciliadas, costos y reemplazos; cierre del MVP de fases 0–3 de la propuesta.

- [ ] T31: Conciliar costos con fuentes existentes.
- [ ] T32: Mostrar costos y ficha económica.
- [ ] T33: Modelar propuestas de reemplazo.
- [ ] T34: Revisar reemplazos desde Costos.
- [ ] T35: Validar el MVP con datos de grupo.

### Adopción y escala — T36 a T45

Importación, QR, traslados, campañas, WhatsApp, métricas y piloto.

- [ ] T36: Importar unidades con vista previa.
- [ ] T37: Abrir equipos mediante QR autorizado.
- [ ] T38: Modelar traslados con recepción.
- [ ] T39: Trasladar desde el expediente.
- [ ] T40: Coordinar campañas por zona.
- [ ] T41: Preparar acceso limitado a trabajos externos.
- [ ] T42: Completar confirmación y evidencia por WhatsApp.
- [ ] T43: Medir cobertura y resultados operativos.
- [ ] T44: Preparar piloto y guía operativa.
- [ ] T45: Cerrar aceptación del resultado completo.


## Dependencias y cortes verticales

```text
T01 Contratos y prototipo
 └─ T02–T08 Alcance, edición, fechas y alertas
     └─ T09–T15 Inventario, responsables y expediente
         └─ T16–T19 Reporte y vínculo a OS
             ├─ T20–T23 Visita, ejecución y conformidad
             │   └─ T24–T26 Planes y generación
             └─ T27–T29 Proveedores y servicios
                 └─ T30 Hoy
                     └─ T31–T34 Costos y reemplazos
                         └─ T35 Validación MVP
                             ├─ T36 Importación
                             ├─ T37–T39 QR y traslados
                             ├─ T40 Campañas
                             └─ T41–T42 WhatsApp
                                 └─ T43–T45 Métricas, piloto y aceptación
```

Este diagrama resume etapas, no sustituye las dependencias exactas del checklist. Por ejemplo, el modelo de proveedores puede adelantarse una vez resueltas sus dependencias, y las métricas no dependen de WhatsApp.

Las tareas de modelo son preparatorias acotadas. Cada una precede inmediatamente al corte que permite al usuario asignar, reportar, programar, proponer o trasladar. No construir todo el esquema por adelantado ni toda la UI sobre datos simulados.

**Checkpoints:** C01–C15 después de cada tres tareas, con un resultado funcional explícito en el checklist. En cada bloque: pruebas afectadas, lint focalizado, build y revisión del recorrido. T01 registra revisión de diseño; T35 aceptación del MVP; T44–T45 aceptación del piloto. No se requiere inventar aprobaciones manuales para cada arreglo técnico rutinario.

**Trabajo independiente posible en una implementación futura:** tras estabilizar contratos, garantías puede avanzar separada del listado; proveedores puede avanzar respecto a planes; importación y QR pueden avanzar tras el MVP. Migraciones, servicios compartidos, navegación y cierre de OS se integran secuencialmente. No ejecutar tareas en paralelo que modifiquen `equipment-service.ts`, `equipment.ts` o `service-order-service.ts` sin coordinación explícita. Este desglose no ha utilizado subagentes.

## Trazabilidad de requisitos

| Requisito de la propuesta | Tareas |
|---|---|
| Todas las sucursales y aislamiento de empresa/rol | T02–T04 y comprobación transversal en cada API nueva |
| Edición real, identidad y centavos | T05, T13, T31 |
| Programar no equivale a ejecutar; calendario visible | T06–T07, T22–T26 |
| Alertas reales y estados honestos | T08, T30, T35 |
| Navegación, filtros y catálogo/unidad | T09–T10, T13, T18 |
| Responsables con vigencia, garantías, documentos y actividad | T11–T15 |
| Falla con/sin equipo, evidencia y prioridad con motivo | T16–T19 |
| Visita, bloqueos, acceso y agenda/lista | T20–T21, T30 |
| Conformidad, restitución, paro y cierre único | T16, T22–T23 |
| Planes, pausas, calendario fijo/real e idempotencia | T24–T26 |
| Proveedores operativos/fiscales y servicios sin equipo ficticio | T27–T29 |
| Autorizaciones existentes y solicitante distinto del autorizador | T04, T19, T23, T33 |
| Costos por etapa/fuente, factura y reemplazos | T31–T34 |
| Importación, QR y movimientos con identidad estable | T36–T39 |
| Campañas por zona y WhatsApp específico | T40–T42 |
| Métricas con cobertura, guías y piloto | T43–T45 |
| Móvil, teclado, español mexicano, fechas y errores de conexión | T01, T05, T07, T17, T21, T30, T35 y criterios transversales |

## Verificación y definición de terminado

Todos los comandos son para la implementación posterior, desde la raíz del repositorio. Los archivos de prueba nuevos están previstos en sus tareas; hoy no existen necesariamente.

- Lógica pura: `pnpm test:unit <archivo.test.ts>` para importes, alcance, recurrencia, reglas y métricas.
- Integración/E2E: `pnpm test:e2e tests/equipment-<flujo>.spec.ts`, como detalla cada tarea, sobre BD aislada. Incluir carreras reales para unicidad, cierres y ocurrencias; no sustituirlas solo con mocks.
- Configuración local: establecer `PLAYWRIGHT_WEB_SERVER_CMD=pnpm run dev` y `PLAYWRIGHT_TEST_BASE_URL` cuando corresponda. El Playwright actual también inicia Inngest; verificar el entorno antes de ejecutar.
- Checkpoints: lint sobre archivos cambiados, tests afectados y `pnpm run build`. Evitar dev y build simultáneos sobre el mismo `.next`.
- Aceptación MVP: `pnpm test:e2e tests/equipment-mvp.spec.ts`, más regresiones existentes `tests/branch-scope.spec.ts`, `tests/alcance-todas.spec.ts` y `tests/finanzas-ordenes-e2e.spec.ts`; `pnpm run lint` y `pnpm run build`.
- Migraciones: `pnpm db:generate`, revisar SQL y metadatos; `pnpm db:migrate` solo en la BD de ensayo elegida para la implementación. No usar `db:push` como mecanismo de entrega.
- Navegador: 3 y 15 sucursales, nombres largos, ninguna coincidencia, vacío real, error, datos parciales, sesión/permiso inválido y edición concurrente. Verificar foco, teclado, contraste con texto/icono, móvil/tableta y conservación de borrador ante conexión deficiente.
- Usabilidad: medir si dirección identifica sucursal afectada y decisión en 30 segundos; falla simple del gerente en menos de un minuto; visita sin recapturar equipo/sucursal; cada monto llega a su fuente. Son objetivos por validar, no resultados ya medidos.
- Datos: equipo editado no se duplica; vínculos ajenos se rechazan; programar no marca ejecución; cierre repetido produce una historia; costos concilian; traslado conserva fuente/sucursal histórica.
- Final: evidencia con entorno y resultado, guías actualizadas y aceptación del recorrido/piloto registrada. No marcar tareas verificadas con solo compilar.

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Alcance nulo interpretado como grupo sin autorización | Alto | Reutilizar ALL/BRANCH/NONE, validar empresa y cubrir gerente sin sucursal. |
| Módulos compartidos tienen cambios en curso | Alto | Revisar estado antes de cada tarea, integrar cambios sin sobrescribir trabajo ajeno; en esta sesión solo crear los documentos nombrados. |
| Duplicados o fechas históricas inconsistentes | Alto | Informe previo, migración aditiva y conciliación explícita; nunca reconstruir ejecuciones inventadas. |
| Cierre parcial o reintento de OS | Alto | Clave única, transacción soportada o recuperación durable observable y pruebas de fallos intermedios. |
| Fuente de pago/costos incompleta | Alto | T31 define linaje y cobertura; mostrar desconocido hasta contar con evidencia. |
| Servicio cerrado marcado automáticamente como cumplimiento | Alto | Separar estado de ejecución, documentación y evaluación de cumplimiento. |
| Cambios de sucursal reatribuyen gastos históricos | Alto | Conservar sucursal en evento/costo; verificar antes y después del traslado. |
| Agenda saturada o consultas N+1 | Medio | Lista equivalente, agrupación, paginación y consultas agrupadas; volumen real antes de carga. |
| Responsable o segundo autorizador no disponible | Medio | Mostrar configuración/asignación pendiente sin elevar permisos ni autoautorizar. |
| Capacidades WhatsApp diferentes a las asumidas | Medio | Descubrimiento acotado en T41 y transporte de prueba antes de T42. |
| Corte supera una sesión o cinco archivos de lógica | Medio | Subdividir antes de implementar, manteniendo dependencia y aceptación; no esconder alcance adicional como tarea M. |

## Decisiones pendientes con propuesta inicial

Estas preguntas no impiden guardar el plan. Deben resolverse en la tarea indicada antes de ejecutar trabajo que dependa de la respuesta.

| Decisión | Propuesta inicial | Resolver |
|---|---|---|
| Regla de código y series duplicadas | Código único por empresa; series detectadas como posible duplicado, sin asumir unicidad universal. Auditar datos existentes. | T01/T11/T13 |
| Personas que coordinan y autorizan | Usar permisos y matriz actuales; una responsabilidad no crea privilegios. | T01/T12/T19 |
| Política de próxima fecha | Elegible por plan: calendario fijo o ejecución real; no imponer una a históricos ambiguos. | T01/T24 |
| Base económica e impuestos | Documentar fuente y criterio por etapa; MXN y centavos; pago solo con evidencia de liquidación. | T01/T31 |
| Zona y ventanas operativas | America/Monterrey para operación objetivo, configurable por sucursal. | T01/T20 |
| Umbrales de revisión de reemplazo | Sin regla universal; configurables y sujetos a decisión humana. | T33 |
| Volumen de equipos y documentos | Fixtures funcionales de 3/15 sucursales; acordar volumen antes de carga y límites de importación. | T35/T36 |
| Proveedor activo y destinatarios de WhatsApp | Inspeccionar configuración sin exponer secretos; pruebas simuladas hasta definir piloto. | T41/T42 |
| Participantes y fecha de piloto | Dueño/dirección y gerentes designados por el grupo; sin fecha estimada hasta dimensionar disponibilidad. | T44 |

## Fuera de esta entrega

Offline completo, portal general de técnicos, diagnóstico automático por imagen, cálculo de traslado, ROI/depreciación fiscal/ahorro energético sin datos y cumplimiento legal automático. La propuesta menciona recomendaciones climáticas como contexto: este plan no valida ni convierte esas referencias en obligaciones técnicas.

La publicación o despliegue no se ejecuta por guardar este plan. Primero se completa la implementación, evidencia y piloto definidos; la autorización de una entrega real se resuelve cuando exista un resultado concreto revisable.

