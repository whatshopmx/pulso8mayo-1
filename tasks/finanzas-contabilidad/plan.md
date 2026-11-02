# Plan: trazabilidad y contabilidad integrada de Pulso

Fecha: 2026-11-02. Estado: FC-01–09 completadas técnicamente y verificadas en su alcance; migraciones 0124–0132 aplicadas por solicitud del propietario a la base configurada en `.env`, con ensayo revertido y aplicación transaccional verificada. FC-07 añade revisión/corrección de pólizas y FC-08 apertura y reglas versionadas, deshabilitadas salvo `ACCOUNTING_REVIEW_ENABLED=1`. FC-09 separa reconocimiento del gasto y pagos parciales confirmados, y enlaza la cuenta bancaria elegida en tesorería con su vínculo contable; integración aislada 35/35 y checkpoint global aprobado. La contabilización operativa permanece deshabilitada salvo `ACCOUNTING_POSTING_ENABLED=1`, sin activarse en esta ejecución. Siguiente incremento FC-10: hechos persistidos, trabajador durable y recuperación/diagnóstico. Contrato sintético validado para desarrollo; revisión contable del piloto pendiente según la matriz. El requisito de esquema 0132 queda cumplido en la base configurada; no se desplegó la aplicación ni se activó el piloto.
Checklist de ejecución: [todo.md](todo.md).

Aplicación autorizada 2026-11-02: 0132 requería las ocho migraciones contables anteriores pendientes. Se ejecutó únicamente 0124–0132, usando los SQL y hashes del repositorio; sin migrador global ni reparación del historial antiguo divergente. Verificación posterior independiente: las nueve registradas como APPLIED, ninguna columna/índice del snapshot 0132 ausente, datos anteriores conservados y tablas contables nuevas vacías. El propietario de conexión mantiene BYPASSRLS y no existe `pulso_app`: aplicar las políticas no acredita el aislamiento de un login runtime. Evidencia: [migration-2026-11-02.json](migration-2026-11-02.json). Las notas de no migración de los incrementos previos describen su estado histórico y quedan sustituidas por esta aplicación en cuanto al esquema operativo.

Revisión de continuidad 2026-11-02: el borrador de FC-09 se completa por incrementos. FC-09b añade identidad estable para abonos parciales y bloquea nuevos pagos sobre PAID heredados sin aplicaciones suficientes. FC-09c conecta aprobación y obligación en una transacción, prueba aprobación/pago/liquidación desde los servicios operativos y evita confirmar una partida cuya aplicación quedó rechazada; liquidación decide bajo cerrojos sobre el estado actual. FC-09d conserva el pasivo reconocido al cambiar reglas; FC-09e corrige privilegios SQL y alinea RLS/snapshot. FC-09f acredita alta, aprobación, layout y liquidación de tesorería con identidad bancaria congelada y vínculo compatible con PAYMENT_SOURCE, además de recuperación interna sin duplicados. Queda técnicamente completada FC-09, con integración 35/35, suite general 2405, tipos, lint y build aprobados. FC-10–15 cubren recuperación durable y fuentes restantes; FC-16–19 cierre/reportes; FC-20–21 activación y validación del piloto. Las verificaciones sintéticas no equivalen a una migración o auditoría de producción.

Matriz y evidencia de FC-01: [matriz-fuentes.md](matriz-fuentes.md). Confirmado por el propietario: cada `companyId` corresponde a una razón social; todavía no existen clientes. Contrato de desarrollo sintético validado en esta sesión: cortes como fuente de ingresos, gastos aprobados con fecha explícita, pagos separados y plantilla revisable por empresa. La apertura real y la revisión del primer piloto se resolverán cuando exista esa empresa.

Checkpoint histórico de FC-09c: integración **26/26**, suite general **2405**, TypeScript y lint aprobados; build inicialmente pendiente por recursos insuficientes de Windows (os error 1450). **Verificación recuperada en FC-09d:** integración **27/27**, suite general **2405**, TypeScript, lint y build **exit 0**. FC-09 continúa abierta por los pendientes funcionales anteriores. Evidencia en `todo.md`, FC-09c/d.

Continuidad FC-09d (2026-11-02): se reproduce y corrige el pago contra un pasivo distinto al de la obligación original cuando cambian las reglas. La publicación exige coincidencia de cuenta y centro de costo con el abono original; una discrepancia deja el pago confirmado pendiente de contabilidad con motivo explícito. Prueba de recuperación y checkpoint global aprobados en el checklist. FC-09 sigue abierta por integración bancaria real y privilegios/RLS de runtime con alineación del snapshot; no se inicia FC-10 ni se activa producción.

Continuidad FC-09e (2026-11-02): las pruebas con un rol SQL aislado NOBYPASSRLS reproducen permisos insuficientes para el adaptador de pagos. Se corrigen privilegios de lectura/liquidación en 0131 y se limita la lectura de partidas de tesorería a sus columnas necesarias. Esquema Drizzle y snapshot declaran ahora la política RLS ya existente en SQL; el generador confirma que no faltan cambios de esquema. Reconocimiento/pagos manuales, confirmación/rechazo de aplicaciones de tesorería y aislamiento real de pagos pasan con el rol runtime. Integración 30/30, suite general 2405 aprobadas, TypeScript y lint sin errores; build de producción exit 0 con red autorizada. Resultados y salvedad del wrapper PowerShell en el checklist. Sigue pendiente el alta/layout de tesorería y vínculo al banco real para cerrar FC-09. Sin migración ni activación en producción.

Continuidad FC-09f (2026-11-02): migración aditiva 0132 y FK por empresa conservan `source_bank_account_id` sin inferir identidades del número. Una guarda congela identidad/empresa/moneda/número de origen; el layout detecta bancos inactivos, fuera de MXN o con número modificado. El adaptador exige vínculo del banco seleccionado compatible con PAYMENT_SOURCE bajo el cerrojo de configuración existente. Una discrepancia mantiene el pago confirmado pendiente de contabilidad. Se conserva la selección manual de propósitos RECEPCION/DISPERSION/MIXTO. Recorrido real de servicios sobre datos sintéticos cifrados, integración **35/35**, suite general **2405**, TypeScript, lint y build de producción **exit 0**. Detalles, límites y evidencia en `todo.md`. Se cierra técnicamente FC-09; sigue FC-10. Fuentes heredadas autorizadas sin ID no se asocian ni reenvían automáticamente; requieren revisión/corrección auditada posterior. No se acredita provisionamiento de permisos SQL de toda la tesorería heredada ni recuperación durable. Sin migración, activación ni despliegue operativo.

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
| `lib/services/cost-center-service.ts`, `cost_centers.accounting_line` | Reutilizar centros/partidas QSR y su clasificación contable; completar vínculos al registro contable sin crear otra clasificación de gastos paralela |
| `company_bank_accounts` en `lib/db/schema/treasury.ts` | Reutilizar cuentas propias, propósito RECEPCION/DISPERSION/MIXTO, anclas y saldo calculado; una cuenta MIXTO recibe y efectúa pagos |
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

- Completar las cuentas del registro contable por empresa (código, naturaleza, padre, vigencia y estado) a partir del inventario existente. Reutilizar centros/partidas QSR con `accountingLine` y cuentas bancarias propias con propósito RECEPCION/DISPERSION/MIXTO; vincularlos sin duplicar catálogos operativos, clasificación de gastos ni datos sensibles. FC-05 debe justificar cada estructura nueva por una capacidad ausente (partida doble, activo/pasivo/capital, integridad y saldos), no por renombrar lo que ya existe.
- Reglas versionadas por hecho y vigencia. Guardar la versión aplicada en cada póliza.
- Pólizas y renglones: empresa, fecha contable, fecha de negocio, fuente, sucursal/centro de costo, cargos, abonos, actor, motivo y referencias.
- Eventos pendientes persistidos y estado de procesamiento: identificador de origen, versión, intento, error y póliza resultante.
- Versiones del cierre: saldos, snapshots, reglas y relación con el cierre financiero existente.

Una póliza contabilizada es inmutable. Corregir mediante reversa y nueva póliza vinculadas. Borradores pueden editarse con control de versión. La API valida sesión y alcance; las claves/consultas también evitan relacionar cuentas, documentos o sucursales de otra empresa.

Publicación atómica: cabecera y renglones se confirman juntos, con cargos iguales a abonos, importes no negativos por lado y cuentas vigentes. El balance se valida en la frontera de publicación con protección transaccional en base de datos; no solo en el formulario. Política explícita de redondeo y protección contra desbordamiento en sumas.

Idempotencia única en base de datos por empresa + tipo/id de fuente + tipo de hecho + versión. Dos trabajadores concurrentes no crean dos pólizas. Una corrección crea nueva versión; nunca modifica silenciosamente la ya contabilizada.

### Reglas de reconocimiento y apertura (FC-08)

- Una regla es una fila inmutable por versión, no un registro editable: revisar significa insertar una fila nueva con `supersedesId`, `version` = anterior + 1 y `effectiveFrom` posterior; sin `effectiveTo`. Se resuelve la versión más reciente con `effectiveFrom <= fecha` del hecho. La base rechaza editar o borrar reglas y entradas, saltar versiones, retroceder la fecha efectiva o cambiar el hecho entre versiones.
- La póliza congela `ruleId`/`ruleVersion`; la versión siempre se resuelve en servidor, nunca del cliente. Al publicar un hecho sin regla se resuelve y congela la última vigente. Falta de regla, versión retirada, regla vacía o cuenta requerida inactiva/no postable/fuera de vigencia bloquea con el motivo explícito visible en la vista previa y en el conflicto de publicación.
- La apertura es única por empresa (`UNIQUE (company_id)`), inmutable, ligada a una póliza `source_type='OPENING'` con hecho nulo y `source_id` = id de apertura. Exige al menos un documento de respaldo (constraint trigger diferido) y no puede solaparse con pólizas publicadas en o antes de su fecha; ninguna póliza puede fecharse en o antes de la apertura.
- Configurar reglas o apertura exige `settings:update` y alcance COMPANY; publicar la apertura exige además `accounting:publish`. Un usuario con alcance de sucursal no ve ni publica ninguna de las dos. No se siembran reglas ni cuentas: cada empresa configura las suyas y la falta se reporta como bloqueo, no se rellena por omisión.

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
pnpm exec vitest run --configLoader bundle tests/unit/finance --maxWorkers 2
pnpm exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/accounting --maxWorkers 2
pnpm exec playwright test tests/e2e/accounting.spec.ts
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
