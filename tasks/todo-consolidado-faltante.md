# TODO — Implementación del trabajo faltante

Revisión 2026-10-22. Spec y criterios por ID: [plan consolidado](../plans/2026-plan-consolidado-trabajo-faltante.md). Este checklist sustituye la secuencia del 2026-10-21. Estado: implementación iniciada; ver registro al final. Casillas sin marcar no niegan los avances existentes descritos en la spec.

Reglas: centavos enteros; vigencias/fuentes; companyId y permisos en servidor; migraciones sin DROP; sugerencia/archivo/bitácora no son confirmación de pago. Separar evidencia local de despliegue. S=1–2 archivos; M=3–5 incluidos tests; padres por dominio/familia se subdividen antes de implementar.

## Avances conservados

Aguinaldo Tasks 10–14 implementadas con commits 2229604, a0b6366, bb9b116, a37867a, 5f36965 y c14f95c; las tareas nuevas corrigen defectos y verifican aceptación. Ya hay flag/sync de excepciones, matching bancario y snapshots P&L. No reimplementarlos. IMSS sigue en [su tracker](todo-imss.md).

## Fase 0 — Línea base y seguimiento

- [x] **BASE-01** (M) — Fijar HEAD, cambios locales, entorno aislado y matriz hallazgo→tarea→evidencia. Mantener separados implementación, aceptación local y despliegue.
  - Depende: Ninguna. Verificar: git status/log; revisar correspondencia entre commits y estado.
- [x] **TRACK-01** (S) — Actualizar los trackers de origen solo donde haya evidencia y fusionar Done When duplicado de banca.
  - Depende: BASE-01. Verificar: Comparación documental de IDs, enlaces y evidencia; ningún cierre por inferencia.

- [x] **Puerta 0** — Cada 2–3 tareas: recorrido afectado; al cerrar fase: V1 completo y V2/V3 aplicables según la spec, con evidencia y exit final. Cierre local documental; [checkpoint V1](evidencia/consolidado-2026-10-22/CHECKPOINT-01/README.md). Sin escrituras DB ni despliegue.

## Fase 1 — Correcciones fiscales y aguinaldo (P1, primera entrega)

- [x] **FIS-01** (M) — Definir fixtures fiscales por fecha y geografía con fuente oficial y resultado esperado independiente.
  - Depende: BASE-01. Verificar: V1; tablas numéricas con fuente/fecha y límites de vigencia.
- [x] **FIS-02** (M) — Corregir y granularizar los datos de ley con el esquema existente; revisar el selector y la caché.
  - Depende: FIS-01. Verificar: V1+V2; ejecutar seed dos veces en aislado, probar cambio de vigencia y refresco de caché.
  - [x] **FIS-02A** (M, 4 archivos de código/test) — Catálogo por vigencia y seed transaccional por inicio único; repetición, rollback y no solapamientos en Postgres aislado.
  - [x] **FIS-02B** (M, hasta 4 archivos de código/test) — Selector tipado, detección de ambigüedad y lectura fiscal fresca sin fallback; comprobar corrección después del seed y caché general.
  - [x] **FIS-02C** (M, hasta 3 archivos de código/test) — Preview/run de aguinaldo con bloqueo visible ante dato fiscal desconocido antes de crear efectos; DB vacía y falla de lectura.
  - Implementados y verificados localmente; [evidencia FIS-02](evidencia/consolidado-2026-10-22/FIS-02/README.md). Build final exit 0, confirmado el 23-oct; despliegue en OPS-03.
- [x] **FIS-03** (M) — Resolver el mínimo del finiquito por fecha efectiva y zona antes del cálculo puro.
  - Depende: FIS-02. Verificar: V1; dos fechas publicadas y dos zonas; regresión del caso formal y gap efectivo.
  - [x] **FIS-03A** (M, hasta 5 archivos de código/test) — Resolución explícita por fecha civil/zona con fuente y vigencias publicadas; cálculo puro sin default; topes y regresión formal/gap.
  - [x] **FIS-03B** (M, hasta 5 archivos de código/test) — Conectar resolución y tope a pantalla, mostrar bloqueo y evitar guardar montos inválidos; recorrido de navegador con datos simulados.
  - [x] **FIS-03C** (M, hasta 3 archivos de código/test) — Corregir transporte del salario real desde el listado de empleados: proyección SQL sin tabla ajena al FROM, contrato de respuesta y prueba en Postgres embebido sin datos compartidos.
  - Cierre local: focalizadas 52/52; unit 161 archivos/1926 passed; navegador 3/3; lint sin errores y build con TypeScript exit 0. [Evidencia y límites](evidencia/consolidado-2026-10-22/FIS-03/README.md). Sin despliegue; autorización/persistencia exigible en REF-04/05.
- [x] **AGU-01** (S) — Preservar el override manual de cero en ambas bases y en la ejecución.
  - Depende: FIS-01. Verificar: V1; 0, positivo, sin override y entradas inválidas.
- [x] **AGU-02** (M) — Corregir el cálculo puro de retención Art. 174 usando el importe gravado y subsidio aplicable. Cerrado con AGU-02A/B/C; la conciliación del subsidio causado con timbres reales es requisito de AGU-03, no reabre 02.
  - Depende: FIS-02. Verificar: V1; aguinaldo 2250/SD 600 totalmente exento en dic-2026; caso parcial, cero y límites de tarifa/subsidio.
  - [x] **AGU-02A** (M, 3 archivos de código/test) — Contrato gravado explícito, tarifa exacta por año y oráculos de exención/subsidio/redondeo del cálculo puro.
  - [x] **AGU-02B** (S, 2 archivos de código/test) — Adaptar el consumidor existente al contrato gravado y comprobar deducción CFDI/payslip con proveedor simulado; no sustituye la aceptación completa de AGU-03.
  - [x] **AGU-02C** (S/M, requiere criterio fiscal sustentado) — Validar el subsidio cuando ordinario y ordinario+hipotético caen a lados distintos del tope; agregar oráculo independiente antes de habilitar ese caso. El cálculo actual se bloquea explícitamente para no extrapolar la pérdida mensual del subsidio; no se considera cerrado AGU-02 por ese bloqueo.
    - [x] **AGU-02C.1** (M, 3 archivos de código/test) — Separar tasa Art. 174 antes de subsidio, elegibilidad por ordinario+gravado real del mes y crédito mensual único; devolver retención del aguinaldo y ajuste del ISR ordinario por separado, con oráculos de límites y enero/febrero.
    - [x] **AGU-02C.2** (S, 2 archivos de código/test) — Consumidor: preservar resultados sin regularización y rechazar timbrar automáticamente un ajuste mensual que aún no tiene acumulados/snapshot/CFDI en AGU-03. Este bloqueo es de integración, no indeterminación del cálculo puro.
  - Criterio fiscal sustentado con fuentes reconsultadas el 23-oct-2026 e interpretación de la composición registrada por escrito ([evidencia AGU-02C](evidencia/consolidado-2026-10-22/AGU-02C/README.md)); el requisito recae ahora en AGU-03 (conciliación de acumulados), no en el cálculo puro. La regularización del ajuste mensual sigue sin timbrarse.
  - A/B verificados localmente: focalizadas 70/70; unit 161 archivos/1956 passed; tsc/lint/build exit 0. [Evidencia](evidencia/consolidado-2026-10-22/AGU-02/README.md). Padre cerrado por AGU-02C; sin despliegue.
- [ ] **AGU-03** (M) — Conectar la retención corregida a preview, recibo extraordinario y persistencia.
  - Depende: AGU-01, AGU-02. Verificar: V1+V2; preview→ejecutar→payslip con proveedor simulado/sandbox; caso de fallo y reintento.
  - [x] **AGU-03A** (M, hasta 5 archivos de código/test) — Contrato único de fecha civil de pago, retención, deducciones y neto en preview/API/UI; validar año y cálculo antes de crear efectos. No confundir año causado con año de pago.
    - [x] **AGU-03A.1** (M, 4 archivos) — Contrato puro de pago y preflight en servicio: fecha civil explícita, tarifa/UMA de esa fecha, retención/deducciones/neto y bloqueo previo a crear la corrida; pruebas de año causado distinto, fechas inválidas y subsidio pendiente.
    - [x] **AGU-03A.2** (M, hasta 5 archivos) — API/UI consumen la misma fecha y cálculo; edición de días conserva cero, muestra ISR/neto/bloqueo y evita ejecutar una preview obsoleta; pruebas de API y navegador aislado.
  - [x] **AGU-03B** (M, hasta 5 archivos por incremento) — Definir y persistir el snapshot por empleado y la recuperación de corrida parcial: conservar fecha/importes autorizados, reutilizar timbre confirmado y evitar duplicar payslip/bitácora. Cierre local de implementación; aceptación V2 completa en AGU-03C.
    - [x] **AGU-03B.1** (S, 2 archivos) — Contrato versionado y validación del snapshot de autorización y de cada empleado; identidades únicas, centavos e invariantes sin recalcular con datos vivos.
    - [x] **AGU-03B.2** (M, esquema/migración/metadata y prueba DB) — Persistencia aditiva de cabecera y snapshot por recibo; unicidad parcial para recibos nuevos, sin modificar históricos ni ejecutar migraciones compartidas.
    - [x] **AGU-03B.3** (M, hasta 5 archivos) — Crear corrida y recibos pendientes atómicamente antes del proveedor; consumir snapshots persistidos y actualizar el mismo recibo ante éxito/error, conservando importes.
    - [x] **AGU-03B.4** (M, hasta 5 archivos por incremento) — Recuperación explícita de corridas parciales, exclusión concurrente, reutilización de timbre confirmado y tratamiento de respuesta incierta; API/UI y bitácora sin duplicados, subdividido en A/B/C.
      - [x] **AGU-03B.4A** (M, hasta 4 archivos) — Protocolo fiscal durable por empresa/RFC/período: huella de solicitud, adquisición atómica, reutilización confirmada y bloqueo de envío incierto/duplicado sin cambiar serie.
      - [x] **AGU-03B.4B** (M, hasta 5 archivos) — Ejecución y recuperación comparten snapshots; finalizar recibo/bitácora bajo exclusión transaccional breve, sin transacción abierta ante PAC; dos actores y caída/reintento.
      - [x] **AGU-03B.4C** (M, hasta 5 archivos) — Acción API y control de recuperación en historial; permisos, empresa y datos originales del run, errores visibles y navegador aislado.
      - 4A/B/C completos localmente: protocolo 4/4, fiscal HTTP simulado 8/8, recorrido SQL 11/11, API 18/18; suite 168 archivos/2059 passed; TypeScript/lint/build exit 0; navegador final 3/3 (320/768/1440). [Evidencia y límites](evidencia/consolidado-2026-10-22/AGU-03B-4/README.md). Sin emisión real ni despliegue; RLS/pool/PG independiente y aceptación V2 completa siguen en AGU-03C.
    - B.1/B.2/B.3 completos localmente: focalizadas 51/51; suite 166 archivos/2034 passed, lint y build con TypeScript exit 0; migración 0122 sólo en PGlite. [Evidencia y límites](evidencia/consolidado-2026-10-22/AGU-03B/README.md). La recuperación se completó después en B.4; la aceptación V2 completa sigue en AGU-03C.
  - [ ] **AGU-03C** (M, hasta 5 archivos por incremento) — Aceptación V2 con DB aislada y proveedor simulado/sandbox: fallo antes/después del timbre, caída tras persistencia, reintento, dos actores y dos empresas; verificar bruto=exento+gravado y neto=bruto−deducciones en todas las salidas.
    - [x] **AGU-03C.1** (M, 1 archivo de pruebas + evidencia) — Recuperación desde snapshot en Postgres independiente, dos conexiones con pool max=1 y HTTP fiscal simulado: envío en curso, respuesta incierta, fallo local anterior al envío, caída tras timbre/recibo/bitácora, dos empresas e invariantes. 9/9; [evidencia y límites](evidencia/consolidado-2026-10-22/AGU-03C-1/README.md). No acredita RLS ni el recorrido inicial completo.
    - [ ] **AGU-03C.2** (M, hasta 5 archivos) — Preview→autorización atómica→ejecución→recibo en Postgres independiente con fuentes aisladas; fallo al guardar autorización, carreras de dos autorizadores y comparación de importes/fecha en todas las salidas. Mantener la protección de subsidio/acumulados.
    - [ ] **AGU-03C.3** (M, hasta 5 archivos por incremento; depende de OPS-02.nomina) — Acreditar rol runtime sin bypass/RLS y contexto HTTP/job con pool max=1, dos empresas y rechazo sin contexto. No sustituirlo por filtros de aplicación ni por tablas clonadas sin políticas.
  - Handoff de AGU-02C: conciliar crédito/subsidio causado/ISR ya retenidos del mes real y sus claves CFDI antes de levantar la protección del consumidor; `totalRetencionAdicionalCents` del cálculo puro no autoriza descontar ni timbrar un ajuste mensual sin esos acumulados.
- [ ] **DIA-01** (S) — Fijar el contrato de días computables, cobertura, período y zona antes de cambiar la consulta.
  - Depende: BASE-01. Verificar: V1; anual con un turno, descansos, festivo, vacaciones, incapacidad/permiso y alta a mitad de año; validar tratamiento con fuentes aplicables.
- [ ] **DIA-02** (M) — Implementar la propuesta auditable de días desde las fuentes reales y reflejarla en preview.
  - Depende: DIA-01, AGU-01. Verificar: V1+V2; consultas reales en aislado, dos empresas, turnos nocturnos/solapamientos y preview→run.
- [ ] **AGU-04** (M) — Revalidar las funciones de bases/gap existentes y la veracidad de la bitácora de dispersión.
  - Depende: AGU-03, DIA-02. Verificar: V1+V2+V3; caso FORMAL/MIXED con gap y reintento; bitácora no equivale a conciliación bancaria.

- [ ] **Puerta 1** — Cada 2–3 tareas: recorrido afectado; al cerrar fase: V1 completo y V2/V3 aplicables según la spec, con evidencia y exit final.

## Fase 2 — Parámetros laborales y seguridad del entorno

- [ ] **LEG-01** (M) — Entregar lectura de ley por vigencia y overrides realmente consumidos desde operating-config.
  - Depende: FIS-02. Verificar: V1+V3; guardar→recargar→calcular y rechazo sin permiso/cross-tenant.
- [ ] **LEG-02** (M) — Dar captura y lectura por sucursal a electronic_registry_readiness existente.
  - Depende: BASE-01. Verificar: V1+V2+V3; guardar/leer y dos tenants. No borrar la tabla automáticamente.
- [ ] **LEG-03** (S) — Cerrar regresiones de validadores y corregir el conteo/documentación de reformas.
  - Depende: LEG-01, LEG-02. Verificar: V1; límites y sus vecinos para Art. 66/68; PUERTA de fase.
- [ ] **OPS-01** (S) — Preparar manifiesto de migraciones pendientes del entorno objetivo y reversión verificable.
  - Depende: BASE-01. Verificar: V2; comparar esquema esperado/real y ensayo de recuperación. Aplicación operativa es acción separada.
- [ ] **OPS-02.<dominio>** (M por lote) — Extender RLS empezando por nómina/tesorería, luego inventario y los demás dominios liberados.
  - Depende: OPS-01 y esquema estable del dominio. Verificar: V2; dos empresas, pool max=1, HTTP/job y consulta sin contexto. Subdividir antes de superar cinco archivos.
- [ ] **OPS-03** (S por lote) — Aplicar únicamente el lote revisado al entorno identificado y comprobarlo.
  - Depende: OPS-01 y puertas locales del lote. Verificar: V2+V3; no acredita despliegue la sola existencia del SQL ni una prueba aislada.

- [ ] **Puerta 2** — Cada 2–3 tareas: recorrido afectado; al cerrar fase: V1 completo y V2/V3 aplicables según la spec, con evidencia y exit final.

## Fase 3 — Nómina ordinaria conectada

- [ ] **NOM-01** (M) — Fijar unidad salarial, vigencias y conceptos de nómina ordinaria.
  - Depende: FIS-03, FIS-01. Verificar: V1; periodicidades equivalentes, cambio salarial intraperíodo y dato histórico ambiguo.
- [ ] **NOM-02.<familia>** (M por familia) — Calcular pre-nómina desde asistencia/incidencias aprobadas e integrar ISR ordinario según periodicidad.
  - Depende: NOM-01, AGU-02. Verificar: V1+V2; período con falta+festivo+vacaciones+overtime y deducción; no extrapolar tarifa mensual a quincena sin regla validada.
- [ ] **NOM-03** (M) — Aprobar y persistir snapshot reproducible de pre-nómina.
  - Depende: NOM-02 de todas las familias. Verificar: V1+V2+V3; editar asistencia después de aprobar, dos aprobadores y rechazo cross-tenant.
- [ ] **NOM-04** (M) — Hacer que exportación y timbrado consuman el mismo snapshot aprobado.
  - Depende: NOM-03 y OPS-02.nomina. Verificar: V1+V2; falla del proveedor/reintento y diferencias de centavos.
- [ ] **NOM-05** (M) — Crear obligación neta de nómina una vez y conciliar su liquidación.
  - Depende: NOM-04 y OPS-02.tesoreria. Verificar: V2+V3; aprobado→timbrado→tesorería→confirmación→conciliación y reversa.

- [ ] **Puerta 3** — Cada 2–3 tareas: recorrido afectado; al cerrar fase: V1 completo y V2/V3 aplicables según la spec, con evidencia y exit final.

## Fase 4 — Inventario, producción y recepción restaurados

- [ ] **REC-03A** (M) — Revalidar dry-run por lote y preparar ajustes explícitos en copia aislada.
  - Depende: OPS-01 y recepción atómica existente. Verificar: V2; antes/después y repetición en copia; ambiguos requieren conteo físico.
- [ ] **REC-03B** (S) — Aplicar ajustes operativos únicamente con evidencia real y lote revisable.
  - Depende: REC-03A y conteo/decisión sobre lotes. Verificar: V2+V3; bloqueo explícito del lote ambiguo no bloquea tareas independientes.
- [ ] **REC-TEMP** (M) — Exigir temperatura de recepción según almacenamiento y excepción autorizada.
  - Depende: BASE-01. Verificar: V1+V3; refrigerado/congelado/ambiente, lectura ausente y excepción. Esta tarea no se llama H07.
- [ ] **REC-VAL** (S) — Conservar valor total al convertir unidad y costo recibido.
  - Depende: BASE-01. Verificar: V1+V2; fracciones, unidad incompatible, redondeo y replay.
- [ ] **INV-01** (M) — Hacer transaccional la corrección/reintento de ventas y su consumo.
  - Depende: BASE-01 y seguridad de ventas existente. Verificar: V1+V2; venta→corrección→reintento→fallo intermedio, saldo exacto.
- [ ] **INV-02** (M) — Fijar propietario y versión del consumo entre producción y venta.
  - Depende: INV-01. Verificar: V1+V2; producir/vender lote y cambiar receta después; contrato antes de tocar ambos flujos.
- [ ] **PROD-01** (M) — Crear lote terminado con genealogía, cantidad y costo al cerrar producción.
  - Depende: INV-02. Verificar: V1+V2; fracciones, faltante, subreceta y dos cierres simultáneos.
- [ ] **PROD-02** (M) — Conectar entradas de workflow/prep/hold-time al mismo modelo de producción.
  - Depende: PROD-01. Verificar: V1+V2+V3; producir→vencer→descartar→reintentar y comparar pantalla/ledger.
- [ ] **INV-03** (M) — Operar conteo físico con revisión y ajuste idempotente.
  - Depende: PROD-02, REC-03B para lotes afectados. Verificar: V2+V3; conteo→revisión→ajuste→reporte con actores distintos.
- [ ] **INV-04** (M) — Congelar costo/varianza por período y procedencia.
  - Depende: INV-03. Verificar: V1+V2; cerrar→cambiar costos→consultar histórico con igual total/detalle.

- [ ] **Puerta 4** — Cada 2–3 tareas: recorrido afectado; al cerrar fase: V1 completo y V2/V3 aplicables según la spec, con evidencia y exit final.

## Fase 5 — Excepciones, banca y finanzas

- [ ] **EXC-02** (M) — Comparar legacy/canónico y habilitar gradualmente la lectura existente.
  - Depende: BASE-01, OPS-01. Verificar: V1+V2+V3; incidente/factura→sync→pantalla y rollback.
- [ ] **EXC-03A** (M) — Completar lifecycle concurrente y verificación segregada.
  - Depende: EXC-02. Verificar: V1+V2; dos acciones simultáneas y ciclo detección→cierre→reapertura.
- [ ] **EXC-03B** (S) — Escalar por SLA con job recuperable.
  - Depende: EXC-03A. Verificar: V1+V2; reloj controlado y caída/reintento, sin mensajes reales a personas.
- [ ] **EXC-04.<dominio>** (M por fuente) — Integrar merma, presupuesto, ausencia y banco con los adaptadores existentes.
  - Depende: EXC-03B; merma:INV-04; ausencia:NOM-02; banco:BAN-04/06. Verificar: V1+V2; caso dentro/fuera de rango, repetición y resolución por cada dominio.
- [ ] **BAN-01/04** (M por recorrido) — Acreditar cuentas, importación, matching de egresos y reversas ya implementados.
  - Depende: BASE-01, OPS-02.tesoreria. Verificar: V1+V2+V3; BAN-01–04 cada una con evidencia; mock por sí solo no cierra.
- [ ] **BAN-05/06** (M por canal) — Relacionar venta esperada, payout y depósito sin equipararlos.
  - Depende: BAN-01/04, INV-01. Verificar: V1+V2+V3; payout con ajuste/devolución, depósito ambiguo/agrupado y reimportación.
- [ ] **FIN-01** (M) — Separar saldo de cuenta, movimientos conciliados y proyección en la UI existente.
  - Depende: BAN-01/04, BAN-05/06. Verificar: V1+V3; cuenta anclada/sin ancla, operación pendiente y reversa.
- [ ] **FIN-02A** (S) — Definir contrato de cierre, reintento y reapertura del snapshot P&L existente.
  - Depende: BASE-01. Verificar: V1; cerrar→reintentar→cambiar datos vivos→reabrir/revisar.
- [ ] **FIN-02B** (M) — Implementar y conectar lectura histórica del P&L con el contrato aprobado.
  - Depende: FIN-02A, INV-04, NOM-05, BAN-05/06. Verificar: V2+V3; cierre→cambio posterior→histórico idéntico y revisión autorizada identificable.

- [ ] **Puerta 5** — Cada 2–3 tareas: recorrido afectado; al cerrar fase: V1 completo y V2/V3 aplicables según la spec, con evidencia y exit final.

## Fase 6 — Servicios huérfanos por recorridos completos (P2)

- [ ] **REF-01** (M) — Integrar Ley Silla: persistencia, API y pantalla con su consumidor.
  - Depende: LEG-03. Verificar: V1+V2+V3; evaluar→guardar→recargar en dos empresas.
- [ ] **REF-02** (M) — Integrar eventos fuera de jornada y selección real de descanso como política.
  - Depende: LEG-03. Verificar: V1+V2+V3; alta→selección→consulta y política no habilitada.
- [ ] **REF-03** (M) — Integrar solicitudes de salud mental con las fuentes de permisos existentes.
  - Depende: LEG-03. Verificar: V1+V2+V3; solicitud→aprobación→saldo y dos solicitudes concurrentes.
- [ ] **REF-04** (M) — Persistir simulación de finiquito separando conceptos legales y prima IA opcional.
  - Depende: FIS-03, FIS-01. Verificar: V1+V2+V3; política desactivada/activada y formales/efectivo.
- [ ] **REF-05** (M) — Conectar el finiquito autorizado al flujo real de baja.
  - Depende: REF-04 y ruta real de baja confirmada. Verificar: V2+V3; baja real→historial→importe autorizado, permisos y reintento.
- [ ] **REF-06** (S) — Recordar pendientes/vencimientos desde Inngest y actualizar documentación.
  - Depende: REF-02, REF-03. Verificar: V1+V2; reloj controlado y canal simulado, sin enviar mensajes reales.

- [ ] **Puerta 6** — Cada 2–3 tareas: recorrido afectado; al cerrar fase: V1 completo y V2/V3 aplicables según la spec, con evidencia y exit final.

## Fase 7 — Cobertura original y validación

- [ ] **IMSS-LINK** (S) — Enlazar el frente IMSS existente sin duplicar ni reiniciar sus tareas.
  - Depende: BASE-01; dependencias salariales FIS/NOM según contrato. Verificar: Revisión documental; esta tarea no autoriza ejecutar migraciones ni sustituye el plan IMSS.
- [ ] **P2.<ID>** (S/M por subtarea) — Completar OPE-01/02/03, COM-01, APR-01, PER-01, AUT-01, CTL-01 e INT-01 conservando criterios originales.
  - Depende: Según plan original y fuentes ya verificadas. Verificar: V1/V2/V3 según recorrido; checkpoint cada 2–3 subtareas; no se difiere silenciosamente una fila de requisitos.
- [ ] **VAL-01.<modulo>** (M por módulo) — Resolver las 217 filas del inventario de aceptación con la evidencia actual.
  - Depende: Puertas de ramas aplicables y OPS-03 del entorno. Verificar: V3; revisar matriz sin sustituir ejecución por existencia de código.
- [ ] **VAL-02** (M por recorrido) — Pilotear día completo y recuperación antes de liberar.
  - Depende: VAL-01 completo para el alcance. Verificar: V1+V2+V3; unit, tsc, lint pertinente, build y E2E; reporte de riesgos residuales.

- [ ] **Puerta 7** — Cada 2–3 tareas: recorrido afectado; al cerrar fase: V1 completo y V2/V3 aplicables según la spec, con evidencia y exit final.

## Desglose obligatorio de P2 y rollout

- [ ] OPS-02: nómina, tesorería, inventario central, excepciones/otros dominios liberados; hijos identificados por tablas/queries/rol y prueba DB.
- [ ] NOM-02: base/faltas/permisos; vacaciones/festivos/overtime; bonos/deducciones/ISR.
- [ ] EXC-04: presupuesto, ausencia, merma, banco; cumplir dependencias de cada fuente.
- [ ] OPE-01 — Schedule→orden→cierre; UI/job separados cuando corresponda.
- [ ] OPE-02 — Downtime y costo comparativo con historia reproducible.
- [ ] OPE-03 — Aceite, cocina, salón, gerente y handoff: un hijo por rutina.
- [ ] COM-01 — Compra y servicio: un hijo por recorrido hasta obligación.
- [ ] APR-01 — Factura/gasto/OC/OS/nómina/pago: un hijo por documento.
- [ ] PER-01 — Ocho perfiles: allow/deny API/UI por perfil.
- [ ] AUT-01 — Extractores/outbox, SLA, hold-time, mantenimiento y snapshots por job.
- [ ] CTL-01 — Dashboard/comparación/brief con fuentes y cobertura.
- [ ] INT-01 — Archivo POS/terminal/agregador hasta banco, por fuente soportada.

## Puerta final

- [ ] Correcciones de mínimo/UMA/retención/cero manual/cobertura comprobadas con casos independientes.
- [ ] Nómina ordinaria aprobada alimenta un mismo snapshot en timbrado y tesorería.
- [ ] Ventas/producción/conteos conservan stock, genealogía y costo histórico.
- [ ] Excepciones y banca funcionan con dos empresas, reintentos, concurrencia y reversas.
- [ ] P&L cerrado no cambia por actualizar datos vivos; revisión autorizada trazable.
- [ ] Migraciones/rol y recorridos acreditados en entorno identificado; respaldo/restauración probados.
- [ ] 217 filas resueltas, o liberación limitada explícitamente acordada con filas pendientes; IMSS/P2 incluidos en el alcance declarado.
- [ ] Unitarias, TypeScript, lint pertinente, build y E2E aplicables terminados con resultados registrados; sin P0 abierto.

## Registro de ejecución

| ID | Estado | Commit/fecha | Entorno | Comando y resultado | Evidencia/pendiente |
|---|---|---|---|---|---|
| Preparación | Plan redactado | 2026-10-22 | Revisión documental | No ejecución nueva de tests/build | Evidencia previa: unit 155 archivos, 1850 passed, 1 skipped, 1 todo; no acredita despliegue |
| BASE-01 | Completo | HEAD base c14f95c / 2026-10-22 | Windows, configuración DB aislada identificada sin conexión | git status/log; baseline 1850 passed, exit 0 | [Línea base](evidencia/consolidado-2026-10-22/BASE-01/README.md); IMSS conservado |
| TRACK-01 | Completo | 2026-10-22 | Documental | IDs/enlaces revisados; Done When bancario unificado | Trackers de banca/cierre actualizados; sin cierres de BAN por inferencia |
| FIS-01 | Fixtures completos | 7e8f583 / 2026-10-22 | Vitest/UTC sin DB | 17 pruebas nuevas; focalizadas conjuntas 28/28, exit 0 | [Fuentes y cálculos](evidencia/consolidado-2026-10-22/FIS-01/README.md); bloqueo fiscal productivo pendiente FIS-02/AGU-02 |
| AGU-01 | Implementado y verificado V1 | bfa00a0 / 2026-10-22 | DB/timbrador simulados | RED: 5 fallos; GREEN: 11/11; suite final 1878 passed; tsc/lint/build exit 0 | [Regresión](evidencia/consolidado-2026-10-22/AGU-01/README.md); [checkpoint](evidencia/consolidado-2026-10-22/CHECKPOINT-01/README.md); build con heap 8192 MB solo en el proceso |
| FIS-02A/B/C | Completo local | Base bf2c386 / cierre confirmado 2026-10-23 | Vitest UTC + Postgres aislado (pg_temp), operador identificado | Unit 159 archivos/1899 passed; focalizadas 67/67; DB 5/5; seed maestro 2 recorridos; tsc/lint/build exit 0 | [Evidencia](evidencia/consolidado-2026-10-22/FIS-02/README.md); catálogo operativo sin modificar, liberar solo tras corregir datos del entorno objetivo |
| FIS-03A/B/C | Completo local | Base bf2c386 / 2026-10-23, cambios locales sin commit | Vitest UTC + PGlite + Chromium/API simulada | Focalizadas 52/52; unit 161 archivos/1926 passed; navegador 3/3; lint sin errores; build con TypeScript exit 0 | [Evidencia y límites](evidencia/consolidado-2026-10-22/FIS-03/README.md); no despliegue ni autorización de importes legales (REF-04/05); siguiente AGU-02 |
| AGU-02A/B | Completo local | Base bf2c386 / 2026-10-23, commit conjunto FIS+AGU | Vitest UTC + DB/proveedor simulados | RED puro 22 fallos y consumidor 5; focalizadas 70/70; unit 161 archivos/1956 passed; tsc/lint/build exit 0 | [Evidencia](evidencia/consolidado-2026-10-22/AGU-02/README.md); base gravada y año exacto corregidos; AGU-03 desglosado, sin despliegue |
| AGU-02C | Completo local | Base bf2c386 / 2026-10-23, commit conjunto FIS+AGU | Vitest UTC + DB/proveedor simulados | RED puro 17 fallos y consumidor 2; focalizadas 85/85; conjunto final: focalizadas AGU 48/48, suite 163 archivos/2004 passed exit 0, lint 0 errores, build TypeScript exit 0 | [Evidencia y criterio](evidencia/consolidado-2026-10-22/AGU-02C/README.md); oráculos independientes; bloqueo de acumulados adelantado al preflight de AGU-03A; sin despliegue |
| AGU-03A | Completo local | Base bf2c386 / 2026-10-23, commit conjunto FIS+AGU | Vitest UTC + API/Chromium simulados | RED servicio 6 fallos; contrato 16/16; servicio 20/20; API 11/11; navegador 2/2; focalizadas AGU 48/48; suite 163 archivos/2004 passed exit 0; lint 0 errores; build TypeScript exit 0 | [Evidencia](evidencia/consolidado-2026-10-22/AGU-03A/README.md); snapshot persistente y corrida parcial pendientes en AGU-03B; sin despliegue |
| AGU-03B.1/B.2/B.3 | Completo local | Base bf2c386 / 2026-10-23, cambios locales conservados | Vitest UTC + PGlite, proveedor/fuentes simulados | Focalizadas 51/51; suite 166 archivos/2034 passed, exit 0; tsc/lint exit 0; build con TypeScript exit 0 tras reintento autorizado por falla de conexión a fuentes en sandbox | [Evidencia y límites](evidencia/consolidado-2026-10-22/AGU-03B/README.md); migración 0122 generada sin DROP, sólo aplicada en PGlite; B.4 y AGU-03C pendientes; sin despliegue |
| AGU-03B.4A/B/C | Completo local; AGU-03B cerrado como implementación | Base bf2c386 / 2026-10-23, cambios locales conservados | PGlite + fiscal real/HTTP simulado + API/Chromium | Protocolo 4/4; fiscal 8/8; SQL 11/11; API 18/18; suite 168 archivos/2059 passed; tsc/lint/build exit 0; navegador final 3/3 | [Evidencia y límites](evidencia/consolidado-2026-10-22/AGU-03B-4/README.md); intención durable, respuestas inciertas detenidas y recuperación desde snapshot; AGU-03C conserva aceptación V2 completa; sin migración nueva ni despliegue |
| AGU-03C.1 | Aceptación local de recuperación; padre abierto | Base 534c5a8 / 2026-10-26 | Postgres aislado, esquema privado, dos conexiones Neon/pool max=1, PAC HTTP simulado | Integración 9/9, exit 0; lint exit 0; controles globales detallados en evidencia | [Evidencia y límites](evidencia/consolidado-2026-10-22/AGU-03C-1/README.md); C.2 recorrido inicial y C.3 runtime/RLS pendientes; sin despliegue |

Al implementar: crear hijos antes de tareas que excedan cinco archivos, conservar ID del padre y cerrar solo con criterios completos. Un bloqueo por conteo físico/entorno/archivo real no detiene las ramas independientes.
