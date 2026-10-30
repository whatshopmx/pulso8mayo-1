# Plan: trazabilidad y contabilidad integrada de Pulso

Fecha: 2026-10-30. Estado: FC-01 inventariado; contrato propuesto para desarrollo y revisión funcional pendiente antes de adaptadores.
Checklist de ejecución: [todo.md](todo.md).
Matriz y evidencia de FC-01: [matriz-fuentes.md](matriz-fuentes.md). Confirmado por el propietario: cada `companyId` corresponde a una razón social; todavía no existen clientes. La apertura real y la revisión del primer piloto se resolverán cuando exista esa empresa; el desarrollo usa escenarios sintéticos.

## 1. Objetivo y resultado esperado

Conectar las operaciones de Pulso con registros contables verificables para que dirección, gerentes y contador puedan explicar el resultado de cada sucursal, revisar diferencias y cerrar el mes con evidencia.

Recorrido objetivo: resultado → movimientos que lo componen → operación y documento → aprobación/pago → póliza y conciliación.

La primera entrega da trazabilidad al P&L existente. Las siguientes incorporan un libro mayor de partida doble, automatización, cierre y estados contables. El P&L operativo y los estados contables tendrán bases explícitas y una conciliación entre ambos.

## 2. Supuestos de alcance

- Web de Pulso; mismos usuarios, sesión, permisos y visibilidad por empresa/sucursal.
- Primera versión en MXN, importes enteros en centavos y cantidades físicas con su precisión propia.
- Una empresa contable representa una entidad legal. Validar esta correspondencia antes de consolidar; sumar sucursales no equivale a consolidar entidades jurídicas.
- Arranque desde una fecha acordada con saldos iniciales revisados. El histórico anterior conserva su consulta operativa; no se convierte automáticamente en pólizas definitivas.
- Las reglas de reconocimiento y cuentas serán configuradas y revisadas por el responsable contable antes del piloto.
- Este alcance no incluye declaraciones fiscales, una certificación de cumplimiento SAT, multimoneda ni consolidación con eliminaciones entre entidades.
- La investigación de LoungeOS es referencia funcional. No presupone compatibilidad fiscal mexicana ni valida su implementación interna.

## 3. Base existente y puntos de integración

Revisado en código; no constituye una auditoría de datos ni de funcionamiento en producción.

| Pieza actual | Uso en este plan |
|---|---|
| `lib/services/pnl-service.ts` | Reutilizar P&L por sucursal, desglose de merma/comisiones y fuentes con cobertura |
| `lib/services/food-cost-service.ts`, `labor-cost-service.ts`, `commission-service.ts` | Integrar fuentes de costos; verificar momento de reconocimiento y posibilidad de congelar valores |
| `lib/services/expense-service.ts` | Reutilizar gasto, aprobación y pago; separar esos eventos contablemente |
| `lib/services/treasury-service.ts` | Reutilizar corridas y liquidaciones; generar efecto contable solo desde el hecho confirmado correspondiente |
| `lib/services/financial-period-service.ts` | Extender cierre/reapertura mensual existente y su integración con snapshots |
| `lib/services/pnl-snapshot-service.ts` | Preservar historial del P&L; añadir vínculo con versión del cierre contable |
| `lib/services/period-service.ts` | Gestiona periodos de inventario; coordinar con cierre financiero sin confundir ambos |
| `components/finance/finance-subnav.tsx` | Mantener espacios Hoy, Gastos, Pagos, Caja y cobros, Resultados y Cierre y control |
| `tasks/plan.md`, `tasks/todo.md`, `plans/2026-cierre-circuito-bancario.md` | Trabajo bancario existente: verificar avance real antes de extender saldos y conciliación |

No se identificó un libro mayor general de partida doble en la exploración previa del índice. Confirmar esa ausencia en FC-01 antes de crear tablas o servicios equivalentes.

Los archivos generales de planificación ya tienen contenido de otro proyecto. Este plan usa `tasks/finanzas-contabilidad/plan.md` y `todo.md` para evitar reemplazarlo.

## 4. Decisiones de diseño propuestas

### Una operación, varios hechos financieros

Cada operación conserva su identidad de origen. Recibir mercancía, reconocer una obligación y pagarla son hechos distintos; no deben registrar el mismo gasto tres veces. La conciliación bancaria vincula evidencia de cobro/pago; no vuelve a registrar ventas ni gastos ya contabilizados.

Matriz inicial a validar en FC-01; ejemplos conceptuales, no reglas fiscales definitivas:

| Hecho | Tratamiento propuesto | Prevención de doble conteo |
|---|---|---|
| Venta reconocida | Cargo a caja o cuenta por cobrar/liquidar; abono a ingreso e impuesto separado cuando esté documentado | Elegir una fuente canónica: tickets o corte, nunca ambos para la misma venta |
| Liquidación de tarjeta/plataforma | Cargo a banco y comisión documentada; abono a cuenta por liquidar | La liquidación no genera otra venta; la comisión estimada no se suma a la medida |
| Recepción de insumos | Cargo a inventario; abono a proveedor o recepción pendiente de facturar según evidencia | La factura posterior regulariza la recepción y diferencias, sin duplicar inventario |
| Consumo de insumos | Cargo a costo de venta; abono a inventario | Compra y consumo no se reconocen ambos como gasto |
| Merma | Cargo a merma; abono a inventario al costo congelado del movimiento | Un mismo movimiento no entra además como consumo normal |
| Gasto reconocido | Cargo al gasto/activo aplicable; abono a obligación o caja según el hecho | Aprobar no demuestra que ya se pagó |
| Pago a proveedor | Cargo a obligación; abono a banco/caja | No crea un segundo gasto |
| Nómina reconocida y pagada | Reconocimiento de costo/obligación separado de su liquidación | Reutilizar nómina calculada y confirmada; no sumar nuevamente la estimación operativa |
| Reposición de caja chica o transferencia propia | Movimiento entre cuentas de activo | No tratarlo como ingreso o gasto |

Impuestos, propinas, descuentos, devoluciones, contracargos, diferencias de recepción y pagos parciales deben tener reglas explícitas. Si faltan datos o reglas, el evento queda pendiente con motivo; no se completan importes por inferencia silenciosa.

### Libro mayor y consistencia

Modelo propuesto en `lib/db/schema/accounting.ts`, exportado por el esquema existente:

- Cuentas por empresa: código, naturaleza, padre, vigencia y estado. Bancos operativos existentes se vinculan a cuentas contables; no se duplican sus datos sensibles.
- Reglas versionadas por hecho y vigencia. Guardar la versión aplicada en cada póliza.
- Pólizas y renglones: empresa, fecha contable, fecha de negocio, fuente, sucursal/centro de costo, cargos, abonos, actor, motivo y referencias.
- Eventos pendientes persistidos y estado de procesamiento: identificador de origen, versión, intento, error y póliza resultante.
- Versiones del cierre: saldos, snapshots, reglas y relación con el cierre financiero existente.

Una póliza contabilizada es inmutable. Corregir mediante reversa y nueva póliza vinculadas. Borradores pueden editarse con control de versión. La API valida sesión y alcance; las claves/consultas también evitan relacionar cuentas, documentos o sucursales de otra empresa.

Publicación atómica: cabecera y renglones se confirman juntos, con cargos iguales a abonos, importes no negativos por lado y cuentas vigentes. El balance se valida en la frontera de publicación con protección transaccional en base de datos; no solo en el formulario. Política explícita de redondeo y protección contra desbordamiento en sumas.

Idempotencia única en base de datos por empresa + tipo/id de fuente + tipo de hecho + versión. Dos trabajadores concurrentes no crean dos pólizas. Una corrección crea nueva versión; nunca modifica silenciosamente la ya contabilizada.

### Automatización confiable

Persistir el hecho pendiente dentro de la misma transacción que cambia la operación de origen cuando sea posible. Un trabajador durable procesa pendientes con reintentos; reutilizar infraestructura Inngest existente tras verificar su patrón. Un barrido de recuperación detecta hechos elegibles no publicados. No depender exclusivamente de una llamada de red después de guardar la venta o el pago.

Reprocesar por periodo es una herramienta de recuperación con vista previa, conteos y errores; no cambia pólizas publicadas ni periodos cerrados. Mostrar última actualización, pendientes y cobertura en la interfaz. Separar generación automática de pólizas de confirmación humana de conciliaciones.

### Cierre e información financiera

Extender el cierre financiero mensual por empresa que ya existe. Serializar cierre y publicación para impedir que entre una póliza durante la congelación. El snapshot contable debe corresponder al mismo corte; un fallo no puede dejar el periodo cerrado a medias. Reapertura con permiso específico, motivo obligatorio y nueva versión de cierre, conservando la anterior.

Balance general a una fecha; resultados y flujo realizado por rango. El resultado del ejercicio y su arrastre al capital deben estar definidos para que la ecuación patrimonial sea explicable entre ejercicios. No usar una cuenta de ajuste automática para ocultar diferencias.

El flujo realizado clasifica movimientos de efectivo en operación, inversión y financiamiento; las transferencias internas se excluyen del total. Mantener por separado el flujo proyectado actual. Un saldo contable no se presenta como saldo bancario confirmado cuando falten extractos/conciliación.

## 5. Fases y entregables

| Fase | Tareas | Entregable visible | Condición para avanzar |
|---|---|---|---|
| 0. Contrato de datos | FC-01–02 | Matriz de fuentes, reglas, permisos y caso de prueba del mes | Fuente canónica y tratamiento de casos especiales definidos |
| 1. Trazabilidad operativa | FC-03–04 | Desde Resultados se puede explicar una cifra con sus documentos | Totales reproducibles; estimaciones identificadas; acceso aislado |
| 2. Primer circuito contable | FC-05–10 | Cuentas, apertura y pólizas de gasto/pago con pendientes visibles | Circuito completo, balanceado, recuperable e idempotente |
| 3. Cobertura operativa | FC-11–15 | Ventas, liquidaciones, inventario, merma, nómina y caja conectados | Mes de prueba sin duplicados y con diferencias explicadas |
| 4. Cierre y reportes | FC-16–19 | Cierre versionado, balanza, resultados, balance y flujo exportables | Cierre consistente y reportes reproducibles contra libro mayor |
| 5. Piloto | FC-20–21 | Una empresa con sucursales representativas y revisión contable | Criterios finales cumplidos antes de ampliar |

MVP operativo: fases 0–1. MVP contable limitado a gasto/pago: fase 2, con cobertura explícita; no se vende como contabilidad completa. Primera entrega contable integral del alcance: fases 3–5.

Cada tarea del checklist es una unidad de trabajo S/M, con hasta cinco archivos previstos. Si el inventario real excede ese tamaño, dividirla antes de programar. Secuencia principal: contrato → trazabilidad → primer circuito → cobertura → cierre/reportes → piloto. FC-12 depende de fuentes bancarias verificadas; FC-17 requiere FC-16 y todos los adaptadores del alcance.

## 6. Experiencia de usuario

- Resultados: abrir renglón → ver movimientos paginados, fuente, cobertura, documentos y discrepancias. El total del desglose debe usar exactamente la misma base/filtros que el total mostrado.
- Gastos/Pagos: mostrar reconocimiento, saldo pendiente, pagos y pólizas relacionadas con estados separados.
- Cierre y control: pendientes contables, pólizas, balanza, checklist de cierre y exportación para contador.
- Configuración: catálogo y reglas contables disponibles según permiso. Reutilizar patrones y tokens de `PRODUCT.md` y `DESIGN.md` al implementar UI.
- Gerente: evidencia y situación de su sucursal. Contador: revisión y ajustes dentro de su ámbito. Publicar ajustes, administrar reglas, cerrar y reabrir serán capacidades separadas sobre el RBAC existente.
- Conservar la distinción entre medido, estimado y sin datos. Una estimación operativa no se convierte automáticamente en una póliza definitiva.

## 7. Verificación y datos de aceptación

Construir un mes sintético con dos sucursales, otra empresa aislada, apertura balanceada, venta en efectivo/tarjeta, liquidación posterior con comisión, recepción y factura vinculadas, consumo, merma, gasto a crédito, pagos parciales, devolución, nómina y transferencia propia. Incluir cambio de fecha de negocio, regla vigente e importación duplicada.

Pruebas exigidas: balance exacto en centavos; conservación de valor; corte temporal; claves duplicadas bajo concurrencia; fallo entre escritura y publicación; recuperación tras reinicio; corrección de fuente ya publicada; bloqueo de periodo cerrado; cierre concurrente con publicación; aislamiento entre empresas y sucursales; consistencia de exportaciones y permisos.

Comandos disponibles en `package.json`, a ejecutar durante implementación según alcance:

```powershell
pnpm run test:unit -- tests/unit/finance
pnpm run test:integration -- tests/integration/accounting
pnpm run test:e2e -- tests/e2e/accounting.spec.ts
pnpm exec tsc --noEmit
pnpm run lint
pnpm run build
```

Los paths `tests/integration/accounting` y `tests/e2e/accounting.spec.ts` son propuestos; crearlos en las tareas correspondientes. Ejecutar pruebas focalizadas por tarea, integración al cambiar persistencia y E2E por flujo entregado. En cada checkpoint registrar resultados, fallos previos distinguibles y evidencia UI con roles autorizados. No hacen falta pruebas de aplicación para este cambio documental.

## 8. Piloto, migración y operación

1. Validar fecha de arranque, saldos iniciales y cobertura de fuentes con responsable contable.
2. Crear migraciones aditivas revisadas y probarlas en base aislada. Usar `pnpm db:generate`; no usar `db:push`. No aplicar migraciones durante esta planificación.
3. Ejecutar importación/apertura con vista previa y total de control; confirmar que no solapa apertura con histórico reprocesado.
4. Activar por empresa, inicialmente en modo de comparación. El P&L operativo sigue siendo consultable y las diferencias se documentan.
5. Revisar el primer cierre con libro mayor, bancos y fuentes operativas; ampliar después de cumplir aceptación.
6. Para retroceder, detener nuevas contabilizaciones y ocultar la función según configuración; conservar pólizas y evidencia. Corregir registros con reversas, sin borrado masivo.

Registrar backlog/antigüedad de pendientes, eventos fallidos, tiempo hasta contabilizar, duplicados evitados, cuentas sin mapeo y diferencias de conciliación. Alertas por empresa; sin documentos sensibles ni cuentas completas en logs. Objetivo inicial propuesto: eventos normales contabilizados en menos de cinco minutos bajo la carga acordada del piloto; medir antes de comprometer SLA.

## 9. Riesgos y decisiones pendientes

| Riesgo | Tratamiento |
|---|---|
| P&L operativo y contable difieren por fechas, estimaciones o clasificación | Puente de conciliación por causa; nunca reemplazar totales silenciosamente |
| Una misma venta llega por corte, ticket y depósito | Fuente canónica y claves de procedencia antes del adaptador |
| Compra/factura/pago duplican costos | Matriz de reconocimiento y referencias entre documentos |
| Costos históricos cambian al recalcular inventario | Persistir valoración y versión aplicadas al contabilizar |
| Reintentos, concurrencia o caída dejan pólizas duplicadas/incompletas | Outbox persistida, unicidad y publicación transaccional |
| El avance bancario documentado difiere del código/datos actuales | Verificar dependencia en FC-01 y registrar huecos sin rehacer lo existente |
| Saldos iniciales incompletos producen estados engañosos | Estado provisional y cobertura; impedir cierre definitivo hasta resolver faltantes |
| Cierre y publicación compiten | Protocolo de bloqueo/transacción compartido y prueba de carrera |

Resolver antes de los adaptadores: reconocimiento por tipo de documento, impuestos/propinas y fuente de ventas (propuestas concretas y responsables en la matriz FC-01). La identidad legal por `companyId` está confirmada. Fecha inicial real y contador revisor se resolverán antes del piloto, junto con cuentas de apertura, permisos de publicación/cierre, volumen representativo y tolerancias de conciliación; no bloquean fixtures ni desarrollo sin activación. Hasta resolverlos, son decisiones propuestas y no reglas aprobadas.

## 10. Criterios finales de aceptación

- Todo renglón del reporte contable se explica desde pólizas y documentos autorizados, con periodo, fuente y cobertura.
- Todas las pólizas publicadas cuadran; reintentos y ejecuciones concurrentes no duplican efectos.
- Compras, consumo, mermas, obligaciones, pagos, depósitos y transferencias no se cuentan dos veces.
- Apertura más movimientos explica los saldos; diferencias bancarias quedan visibles y justificadas.
- El balance incluye resultado del ejercicio y cuadra sin ajustes ocultos; el flujo realizado explica la variación de efectivo.
- Periodos cerrados y sus exportaciones son reproducibles; reapertura deja historial de versiones.
- Mes piloto revisado por responsable contable; pruebas de aislamiento, recuperación y cierre aprobadas.

## Fuentes

- Referencia funcional: [LoungeOS Accounting](https://loungeos.app/features/restaurant-accounting/), revisada en la investigación de esta conversación.
- Flujo declarado por el proveedor: [documentación LoungeOS, sección 10](https://loungeos.app/documentation.html).
- Base interna: archivos y planes indicados en §3, inspeccionados para preparar esta propuesta. Los documentos antiguos describen contexto y no certifican estado desplegado.
