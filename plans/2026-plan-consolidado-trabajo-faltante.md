# Plan de implementación del trabajo faltante — Pulso

Revisión: 2026-10-22. Estado: implementación iniciada; línea base, seguimiento, fixtures fiscales y primer incremento de días manuales. Resultados y pendientes en el [checklist operativo](../tasks/todo-consolidado-faltante.md). Reemplaza la secuencia del consolidado 2026-10-21.

## Objetivo y punto de partida

Corregir los defectos fiscales y de días detectados, cerrar las integraciones pendientes y demostrar los recorridos del sistema sin reimplementar funciones existentes. La investigación anterior registró HEAD c14f95c y una ejecución local de 155 archivos: 1850 passed, 1 skipped y 1 todo. Es evidencia histórica, no una prueba ejecutada al redactar este plan.

Aguinaldo Tasks 10–14 tiene commits 2229604, a0b6366, bb9b116, a37867a, 5f36965 y c14f95c. Dos bases, salario efectivo, ISR y conteo automático existen; las tareas nuevas corrigen su conducta y aceptación. Excepciones tiene flag global reversible y sync. Banca tiene importación/matching. P&L tiene snapshots, cuyo contrato de reintento/versionado debe verificarse. Los cambios IMSS del árbol de trabajo pertenecen a su plan vigente.

Este documento y su checklist son los archivos específicos de este frente; no sustituyen tasks/plan.md o tasks/todo.md de otros trabajos. Los planes de origen conservan sus decisiones salvo las rectificaciones explícitas de esta revisión.

## Decisiones y límites

- Montos en centavos enteros y redondeo explícito. Ley/UMA/mínimo/tarifas por fecha, fuente y ámbito aplicable; sin copiar 2025 a 2026 ni extrapolar a años desconocidos. Adaptar unidades externas al borde.
- Conservar el esquema de ley existente si permite representar las vigencias; agregar migraciones solo para necesidades comprobadas. Seed correctivo idempotente, sin modificar recibos ya emitidos. Cambiar datos canónicos requiere invalidar la caché o acreditar su renovación.
- Un dato fiscal desconocido bloquea la ejecución exigible con causa visible; puede permitir una simulación identificada. No fabricar un mínimo/UMA ni interpretar null como exención cero automáticamente.
- Art. 174 RLISR es retención opcional con procedimiento mensual; el ajuste anual es otra función y no se declara implementado por exportar una tarifa anual. ISR ordinario depende de periodicidad y NOM-01.
- Días: calendario/vigencia y ausencias aprobadas son la base de la propuesta. Un turno aislado no prueba ausencia el resto del año. Confirmar fuentes de vacaciones, descansos/incapacidades y política aplicable; fuente, cobertura y fecha de corte visibles. MANUAL 0 y MANUAL positivo prevalecen.
- Diferenciar cálculo, aprobación, timbrado, obligación, pago y conciliación. Una sugerencia, archivo generado o bitácora automática no confirma pago.
- Todo dato/consulta/API/job tiene companyId, alcance de sucursal y permiso verificado. Probar 401/403 y acceso cruzado; usar transacciones/idempotencia en efectos económicos y auditoría durable.
- Ley vigente, política e iniciativa se muestran por separado. Prima IA o licencias previsivas no aumentan importes legales exigibles automáticamente. Consumidor explícito por dato; no borrar tablas por una observación de falta de uso.
- Migraciones sin DROP, mediante pnpm db:generate y revisión SQL, sin db:push. Números se asignan contra el journal actual al implementar; coordinar 0121/IMSS y no mezclar cambios locales ajenos en commits.
- RLS en lotes bajo pulso_app, sin bypass y con contexto transaccional. Nuevas tablas requieren el mismo inventario de rollout antes de liberar su dominio.
- Reinvestigar cada tarea antes de editar: corregir solo brechas reproducidas. S=1–2 archivos; M=3–5 incluidos tests. Padres con sufijo de dominio/familia/recorrido se subdividen en S/M antes de implementar; cada hijo hereda criterios y evidencia, y el padre cierra cuando todos sus hijos aplicables cierran.

## Fuentes y trazabilidad

Valores de 2026 contrastados con [CONASAMI/DOF](https://sidof.segob.gob.mx/notas/docFuente/5775534) e [INEGI UMA 2026](https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2026/uma/uma2026.pdf). Exención y procedimiento: [RLISR art. 151](https://wwwmat.sat.gob.mx/articulo/06527/articulo-151) y [RLISR art. 174](https://wwwmatnp.sat.gob.mx/articulo/46306/articulo-174). Revalidar tarifas/subsidio y demás fuentes al implementar FIS-01; no usar comentarios como evidencia legal.

Especificaciones de origen: [aguinaldo](../tasks/plan-aguinaldo.md), [legal](2026-correcciones-legales-config-laboral.md), [huérfanos](2026-integracion-servicios-huerfanos.md), [cierre](../tasks/cierre-sistema-2026-10-17/cierresistemapulsoplan.md), [IMSS](../tasks/plan-imss.md). Matriz de aceptación: [217 filas](../audits/2026-10-17-sistema/requisitos.csv).

Rectificaciones: H02 del informe original corresponde a nómina; H03 a excepciones; H07 a producto terminado. Temperatura de recepción es REC-TEMP y no sustituye PROD-01/02. Se reincorpora la cadena INV-01/02→PROD-01/02→INV-03/04.

## Verificación común y checkpoints

| Código | Ejecución y alcance |
|---|---|
| V1 | Unitarias focalizadas: pnpm run test:unit <archivos> (sin separador `--`: con pnpm 11 se reenvía literalmente a Vitest); fixtures de resultados independientes para cálculos. Antes del cierre de fase: pnpm run test:unit, pnpm exec tsc --noEmit --incremental false, lint de archivos afectados y pnpm run build, con exit final registrado. |
| V2 | pnpm run test:integration -- <archivos>, configurado solo contra Postgres aislado identificado. Probar rollback, concurrencia, dos empresas, rol runtime y reintentos cuando aplique. Un mock no reemplaza el criterio DB. |
| V3 | pnpm test:e2e o prueba dirigida de API/navegador con servidor/cuentas identificados; acceso directo, 401/403, estados vacíos/error, teclado y responsive si se modifica UI. Proveedor fiscal en sandbox/simulado y notificaciones en canal de prueba. |

Checkpoint cada 2–3 tareas relacionadas: ejecutar la prueba del recorrido y registrar regresiones. Puerta de cada fase: V1 completo y V2/V3 aplicables; no repetir suite/build por cada edición Markdown o por cambios sin nueva incertidumbre. Los counts de pruebas no son una meta fija de aceptación.

Evidencia por tarea: ID, HEAD/commit, fecha, entorno sin secretos, comando, exit/resultado, fixtures y criterio cubierto. Al implementar, guardar logs en tasks/evidencia/consolidado-2026-10-22/<ID>/; este plan no crea resultados ficticios. Si un criterio necesita conteo físico/archivo bancario/entorno, se registra el dato externo y continúan las tareas independientes.

## Orden de ejecución

```text
BASE-01 → TRACK-01
FIS-01 → FIS-02 → FIS-03 → NOM-01
FIS-02 → LEG-01; BASE-01 → LEG-02; LEG-01/02 → LEG-03
AGU-01 + AGU-02 → AGU-03
DIA-01 → DIA-02 → AGU-04 (con AGU-03)
OPS-01 → OPS-02.<dominio> → OPS-03.<lote estable>
NOM-01 → NOM-02.<familia> → NOM-03 → NOM-04 → NOM-05
INV-01 → INV-02 → PROD-01 → PROD-02 → INV-03 → INV-04
REC-03A → conteo/decisión → REC-03B → INV-03 (lotes afectados)
EXC-02 → EXC-03A/B → EXC-04.<dominio>
BAN-01/04 + INV-01 → BAN-05/06 → FIN-01
FIN-02A + INV-04 + NOM-05 + BAN-05/06 → FIN-02B
LEG-03 → REF-01/02/03/04 → REF-05/06
Ramas aplicables + P2 + IMSS → VAL-01 → VAL-02
```

Las ramas independientes pueden avanzar sin esperar cierre global; una dependencia por fila prevalece. Migraciones y cambios en archivos compartidos son secuenciales. No editar simultáneamente payroll-service, employee-service, schema/journal u operating-config en tareas distintas. No se promete fecha global: estimar tras BASE-01 y el primer checkpoint; primero completar la entrega fiscal/aguinaldo, después dependencias de nómina/inventario/finanzas.

## Tareas
### Fase 0 — Línea base y seguimiento

#### BASE-01 — Fijar HEAD, cambios locales, entorno aislado y matriz hallazgo→tarea→evidencia. Mantener separados implementación, aceptación local y despliegue.

**Dependencias:** Ninguna. **Tamaño:** M.

**Aceptación:** Inventario de avances de aguinaldo/excepciones/banca/P&L; registrar pruebas previas sin presentarlas como una nueva ejecución; identificar cambios IMSS sin incluirlos en un commit de este frente.

**Entradas previstas:** git y trackers; evidencia en tasks/evidencia/consolidado-2026-10-22/.

**Verificación:** git status/log; revisar correspondencia entre commits y estado.

#### TRACK-01 — Actualizar los trackers de origen solo donde haya evidencia y fusionar Done When duplicado de banca.

**Dependencias:** BASE-01. **Tamaño:** S.

**Aceptación:** No volver a implementar Tasks 10–14; H02=nómina, H03=excepciones, H07=producto terminado; BAN-01–04 no se cierran solo por pruebas con mock.

**Entradas previstas:** tasks/todo.md; tracker de cierre; todo-aguinaldo.md si precisa anotación.

**Verificación:** Comparación documental de IDs, enlaces y evidencia; ningún cierre por inferencia.

### Fase 1 — Correcciones fiscales y aguinaldo (P1, primera entrega)

#### FIS-01 — Definir fixtures fiscales por fecha y geografía con fuente oficial y resultado esperado independiente.

**Dependencias:** BASE-01. **Tamaño:** M.

**Aceptación:** Cubrir mínimo 2025/2026, UMA enero/febrero 2026, tarifas/subsidio aplicables; desconocido o futuro no hereda silenciosamente un valor; validar fuentes laborales originales antes de conservar sus vigencias.

**Entradas previstas:** seed-labor-law-rules.ts; labor-rules-resolver.test.ts; isr-annual-withholding.test.ts; fixture documental.

**Verificación:** V1; tablas numéricas con fuente/fecha y límites de vigencia.

#### FIS-02 — Corregir y granularizar los datos de ley con el esquema existente; revisar el selector y la caché.

**Dependencias:** FIS-01. **Tamaño:** M.

**Aceptación:** 2026 mínimo general 315.04; UMA enero 113.14 y desde febrero 117.31; tramos sin huecos/solapamientos, semilla repetida no duplica y DB vacía no autoriza un timbrado con valores fiscales inventados; preservar recibos históricos.

**Entradas previstas:** scripts/seed-labor-law-rules.ts; labor-rules-resolver.ts; pruebas y migración de datos revisada si hace falta.

Desglosado antes de implementar en FIS-02A (catálogo/seed), FIS-02B (resolución/caché) y FIS-02C (bloqueo de aguinaldo), con pruebas y estado en el checklist. [Evidencia de ejecución local](../tasks/evidencia/consolidado-2026-10-22/FIS-02/README.md); el rollout del catálogo público es OPS-03.

**Verificación:** V1+V2; ejecutar seed dos veces en aislado, probar cambio de vigencia y refresco de caché.

#### FIS-03 — Resolver el mínimo del finiquito por fecha efectiva y zona antes del cálculo puro.

**Dependencias:** FIS-02. **Tamaño:** M.

**Aceptación:** Quitar default 278.80; mantener el factor legal de tope separado del monto mínimo; salario/fecha/zona faltantes generan bloqueo explícito en cálculo exigible y no un dato inventado.

**Entradas previstas:** ai-severance-calculator.ts; capa de orquestación; settlement-calculator.tsx; pruebas.

Implementación desglosada en FIS-03A (resolución/cálculo puro), FIS-03B (pantalla) y FIS-03C (transporte salarial del listado, cuyo SQL inválido se reprodujo al integrar). Catálogo geográfico compartido con fuente y vigencias acotadas; la tabla global existente solo representa GENERAL. [Evidencia, resultados y límites](../tasks/evidencia/consolidado-2026-10-22/FIS-03/README.md). La autorización/persistencia del importe exigible sigue en REF-04/05.

**Verificación:** V1; dos fechas publicadas y dos zonas; regresión del caso formal y gap efectivo.

#### AGU-01 — Preservar el override manual de cero en ambas bases y en la ejecución.

**Dependencias:** FIS-01. **Tamaño:** S.

**Aceptación:** MANUAL 0 produce bruto 0 y no vuelve al calendario; valores positivos conservan semántica; preview y ejecución usan el mismo valor validado.

**Entradas previstas:** aguinaldo-payroll-service.ts; prueba de preview/run con DB y timbrador simulados.

**Verificación:** V1; 0, positivo, sin override y entradas inválidas.

#### AGU-02 — Corregir el cálculo puro de retención Art. 174 usando el importe gravado y subsidio aplicable.

**Dependencias:** FIS-02. **Tamaño:** M.

**Aceptación:** Totalmente exento con salario ordinario alto retiene 0; parcialmente exento cuadra con cálculo independiente; art. 174 mensual queda distinguido del ajuste anual y no usa tarifas de otro año sin advertencia/bloqueo.

**Entradas previstas:** isr-annual-withholding.ts; isr-annual-withholding.test.ts; fixture FIS-01.

**Verificación:** V1; aguinaldo 2250/SD 600 totalmente exento en dic-2026; caso parcial, cero y límites de tarifa/subsidio.

#### AGU-03 — Conectar la retención corregida a preview, recibo extraordinario y persistencia.

**Dependencias:** AGU-01, AGU-02. **Tamaño:** M.

**Aceptación:** Bruto=exento+gravado y neto=bruto−deducciones en UI/CFDI/payslip; caso exento sin deducción ficticia; ante reintento/fallo parcial se recupera el empleado sin duplicar timbre ni bitácora.

**Entradas previstas:** aguinaldo-payroll-service.ts; API/UI aguinaldo existente; pruebas del payload.

**Verificación:** V1+V2; preview→ejecutar→payslip con proveedor simulado/sandbox; caso de fallo y reintento.

#### DIA-01 — Fijar el contrato de días computables, cobertura, período y zona antes de cambiar la consulta.

**Dependencias:** BASE-01. **Tamaño:** S.

**Aceptación:** Usar vigencia laboral y calendario como base; aplicar solo ausencias excluyentes confirmadas; turnos parciales son evidencia, no prueba de que los demás días no cuentan; fuente/fecha de corte y override explícitos.

**Entradas previstas:** dias-laborados-service.ts; fixtures y contrato documentado; pruebas de política.

**Verificación:** V1; anual con un turno, descansos, festivo, vacaciones, incapacidad/permiso y alta a mitad de año; validar tratamiento con fuentes aplicables.

#### DIA-02 — Implementar la propuesta auditable de días desde las fuentes reales y reflejarla en preview.

**Dependencias:** DIA-01, AGU-01. **Tamaño:** M.

**Aceptación:** Cruzar vacaciones y permisos sin duplicar, excluir faltas solo con estado aprobado, acotar vigencia y año; sin cobertura completa conservar propuesta conservadora con aviso; MANUAL 0 y positivo prevalecen y se envían como overrides, no como campos precargados confundidos con MANUAL.

**Entradas previstas:** dias-laborados-service.ts; aguinaldo-payroll-service.ts; UI de preview; pruebas.

**Verificación:** V1+V2; consultas reales en aislado, dos empresas, turnos nocturnos/solapamientos y preview→run.

Implementación desglosada en DIA-02A (adaptador de fuentes reales y clasificación explícita), DIA-02B (preview/snapshot y bloqueo por revisión) y DIA-02C (UI de overrides y cobertura). [Evidencia y límites](../tasks/evidencia/consolidado-2026-10-22/DIA-02/README.md). DIA-02D conserva la aceptación V2 con Postgres aislado, dos empresas reales y preview→run; la tarea no se declara cerrada.

#### AGU-04 — Revalidar las funciones de bases/gap existentes y la veracidad de la bitácora de dispersión.

**Dependencias:** AGU-03, DIA-02. **Tamaño:** M.

**Aceptación:** Ambas bases visibles y formales sin regresión; solo registrar pago confirmado como pagado, con actor/motivo/fecha y autorización; ejecutar o reintentar el run no inventa ni duplica entrega de efectivo.

**Entradas previstas:** servicio/API de aguinaldo; bitácora 0120 existente; pruebas y UI si existe una brecha reproducida.

**Verificación:** V1+V2+V3; caso FORMAL/MIXED con gap y reintento; bitácora no equivale a conciliación bancaria.

### Fase 2 — Parámetros laborales y seguridad del entorno

#### LEG-01 — Entregar lectura de ley por vigencia y overrides realmente consumidos desde operating-config.

**Dependencias:** FIS-02. **Tamaño:** M.

**Aceptación:** Ley de solo lectura con fuente; override más laxo rechazado server-side y cambio auditado; lectura posterior y cálculo usan el override, con componentes separados si la página ya es grande.

**Entradas previstas:** operating-config/page.tsx; tenant-config-service.ts; resolver/política/API existentes; pruebas.

**Verificación:** V1+V3; guardar→recargar→calcular y rechazo sin permiso/cross-tenant.

#### LEG-02 — Dar captura y lectura por sucursal a electronic_registry_readiness existente.

**Dependencias:** BASE-01. **Tamaño:** M.

**Aceptación:** OFF/WIRING/READY visible con fuente/fecha y auditoría; acceso por empresa/sucursal; null no activa obligaciones futuras ni exige datos no aplicables.

**Entradas previstas:** schema labor-law-ref existente; ruta de compliance propuesta; formulario y pruebas.

**Verificación:** V1+V2+V3; guardar/leer y dos tenants. No borrar la tabla automáticamente.

#### LEG-03 — Cerrar regresiones de validadores y corregir el conteo/documentación de reformas.

**Dependencias:** LEG-01, LEG-02. **Tamaño:** S.

**Aceptación:** Probar límites diarios/semanales y fecha efectiva real; separar ley/política/iniciativa en resultados y UI; conteo obtenido de ejecución, sin meta artificial de ~8 o 75 pruebas.

**Entradas previstas:** labor-validation y conflict-detector solo si falla un caso; pruebas; reformas-laborales-2026.md.

**Verificación:** V1; límites y sus vecinos para Art. 66/68; PUERTA de fase.

#### OPS-01 — Preparar manifiesto de migraciones pendientes del entorno objetivo y reversión verificable.

**Dependencias:** BASE-01. **Tamaño:** S.

**Aceptación:** Comparar journal/esquema/rol sin exponer secretos; incluir dependencias nuevas y 0102/0119/0120 si faltan, no una lista fija; respaldar/restaurar en aislado y ordenar migraciones sin renumerar 0121 de IMSS.

**Entradas previstas:** configuración/journal y runbook de despliegue; scripts de diagnóstico de solo lectura.

**Verificación:** V2; comparar esquema esperado/real y ensayo de recuperación. Aplicación operativa es acción separada.

#### OPS-02.<dominio> — Extender RLS empezando por nómina/tesorería, luego inventario y los demás dominios liberados.

**Dependencias:** OPS-01 y esquema estable del dominio. **Tamaño:** M por lote.

**Aceptación:** Rol pulso_app sin bypass; aislamiento de tablas padre/hijas y rechazo sin contexto; API/jobs/reportes operan con pool reutilizado sin fuga, con reversión por lote.

**Entradas previstas:** migración del lote; tenant-context.ts; consultas y pruebas del dominio.

**Verificación:** V2; dos empresas, pool max=1, HTTP/job y consulta sin contexto. Subdividir antes de superar cinco archivos.

#### OPS-03 — Aplicar únicamente el lote revisado al entorno identificado y comprobarlo.

**Dependencias:** OPS-01 y puertas locales del lote. **Tamaño:** S por lote.

**Aceptación:** Registrar migración/fecha/entorno y rol; sanity checks y prueba del recorrido; reversión ensayada sin DROP ni restaurar datos operativos a ciegas.

**Entradas previstas:** runbook/evidencia de despliegue y comandos del proyecto.

**Verificación:** V2+V3; no acredita despliegue la sola existencia del SQL ni una prueba aislada.

### Fase 3 — Nómina ordinaria conectada

#### NOM-01 — Fijar unidad salarial, vigencias y conceptos de nómina ordinaria.

**Dependencias:** FIS-03, FIS-01. **Tamaño:** M.

**Aceptación:** Equivalencia diaria/hora/período y redondeo explícitos; contratos ambiguos reportados; asistencia, ISR y exportación usan el mismo contrato y versión de reglas.

**Entradas previstas:** employeeContracts; normalización salarial; calculador puro y pruebas.

**Verificación:** V1; periodicidades equivalentes, cambio salarial intraperíodo y dato histórico ambiguo.

#### NOM-02.<familia> — Calcular pre-nómina desde asistencia/incidencias aprobadas e integrar ISR ordinario según periodicidad.

**Dependencias:** NOM-01, AGU-02. **Tamaño:** M por familia.

**Aceptación:** Familias separadas: base/faltas/permisos, vacaciones/festivos/overtime, bonos/deducciones/ISR; origen y autorización por concepto; cero legítimo distinto de pendiente/sin datos, centavos reconciliados.

**Entradas previstas:** payroll-service.ts; calculador/conceptos; fuentes de incidencias y pruebas.

**Verificación:** V1+V2; período con falta+festivo+vacaciones+overtime y deducción; no extrapolar tarifa mensual a quincena sin regla validada.

#### NOM-03 — Aprobar y persistir snapshot reproducible de pre-nómina.

**Dependencias:** NOM-02 de todas las familias. **Tamaño:** M.

**Aceptación:** Guardar entradas/versiones/importes/aprobador; cambios posteriores invalidan o crean versión y exigen nueva aprobación; autorización y concurrencia impiden usar un borrador obsoleto.

**Entradas previstas:** snapshot/esquema si falta; servicio de aprobación; API/UI y pruebas por subtarea.

**Verificación:** V1+V2+V3; editar asistencia después de aprobar, dos aprobadores y rechazo cross-tenant.

#### NOM-04 — Hacer que exportación y timbrado consuman el mismo snapshot aprobado.

**Dependencias:** NOM-03 y OPS-02.nomina. **Tamaño:** M.

**Aceptación:** Export/CFDI/payslip suman exactamente el snapshot; timbrado idempotente y estado recuperable por empleado; no recalcular usando datos vivos tras aprobar.

**Entradas previstas:** payroll-service.ts; fiscal-service.ts; export existente; pruebas.

**Verificación:** V1+V2; falla del proveedor/reintento y diferencias de centavos.

#### NOM-05 — Crear obligación neta de nómina una vez y conciliar su liquidación.

**Dependencias:** NOM-04 y OPS-02.tesoreria. **Tamaño:** M.

**Aceptación:** Referencia estable snapshot/versión; reintento no duplica deuda/pago; cancelación/sustitución deja trazabilidad y no se anuncia pagada por generar archivo.

**Entradas previstas:** servicio de obligaciones/corridas existente; API de nómina y pruebas.

**Verificación:** V2+V3; aprobado→timbrado→tesorería→confirmación→conciliación y reversa.

### Fase 4 — Inventario, producción y recepción restaurados

#### REC-03A — Revalidar dry-run por lote y preparar ajustes explícitos en copia aislada.

**Dependencias:** OPS-01 y recepción atómica existente. **Tamaño:** M.

**Aceptación:** No asumir que siguen siendo cuatro lotes; clasificar evidencia suficiente/ambigua; ajuste idempotente sin reescribir ledger ni dividir saldos.

**Entradas previstas:** diagnóstico REC-03 existente; servicio de ajustes; pruebas.

**Verificación:** V2; antes/después y repetición en copia; ambiguos requieren conteo físico.

#### REC-03B — Aplicar ajustes operativos únicamente con evidencia real y lote revisable.

**Dependencias:** REC-03A y conteo/decisión sobre lotes. **Tamaño:** S.

**Aceptación:** Conteo identifica actor/fecha/unidad/lote; aprobación y respaldo del entorno; reporte final de saldo/ledger sin correcciones supuestas.

**Entradas previstas:** servicio de conteos/ajustes; runbook y evidencia.

**Verificación:** V2+V3; bloqueo explícito del lote ambiguo no bloquea tareas independientes.

#### REC-TEMP — Exigir temperatura de recepción según almacenamiento y excepción autorizada.

**Dependencias:** BASE-01. **Tamaño:** M.

**Aceptación:** Ausencia de lectura no es conforme; fuera de rango conserva cuarentena/incidente; excepción registra responsable, motivo y evidencia.

**Entradas previstas:** receiving-service.ts; política y captura existentes; pruebas.

**Verificación:** V1+V3; refrigerado/congelado/ambiente, lectura ausente y excepción. Esta tarea no se llama H07.

#### REC-VAL — Conservar valor total al convertir unidad y costo recibido.

**Dependencias:** BASE-01. **Tamaño:** S.

**Aceptación:** Guardar cantidad/unidad originales; conversión y centavos coherentes; 2 cajas×10 kg, costo total $2000 →20 kg a $100/kg, sin ambigüedad de precio por caja.

**Entradas previstas:** receiving-service.ts; pruebas de conversión.

**Verificación:** V1+V2; fracciones, unidad incompatible, redondeo y replay.

#### INV-01 — Hacer transaccional la corrección/reintento de ventas y su consumo.

**Dependencias:** BASE-01 y seguridad de ventas existente. **Tamaño:** M.

**Aceptación:** Corrección compensa consumo anterior con movimientos trazables; atomicidad venta/ledger; repetición/concurrencia no duplica stock consumido.

**Entradas previstas:** theoretical-consumption-service.ts; API/ingesta de ventas; pruebas.

**Verificación:** V1+V2; venta→corrección→reintento→fallo intermedio, saldo exacto.

#### INV-02 — Fijar propietario y versión del consumo entre producción y venta.

**Dependencias:** INV-01. **Tamaño:** M.

**Aceptación:** Por receta/política consume producción o venta; nunca ambos por el mismo insumo; cambios posteriores no reinterpretan recetas ni efectos históricos.

**Entradas previstas:** recetas/política; consumo/producción y pruebas.

**Verificación:** V1+V2; producir/vender lote y cambiar receta después; contrato antes de tocar ambos flujos.

#### PROD-01 — Crear lote terminado con genealogía, cantidad y costo al cerrar producción.

**Dependencias:** INV-02. **Tamaño:** M.

**Aceptación:** Insumos y salida se confirman juntos; costo/unidad y subrecetas reconciliados; doble cierre y faltante no producen stock parcial/duplicado.

**Entradas previstas:** production-service.ts; recipe-production.ts; lote/movimientos y pruebas.

**Verificación:** V1+V2; fracciones, faltante, subreceta y dos cierres simultáneos.

#### PROD-02 — Conectar entradas de workflow/prep/hold-time al mismo modelo de producción.

**Dependencias:** PROD-01. **Tamaño:** M.

**Aceptación:** Una sola salida inventariable; vencimiento no equivale a descarte sin confirmación/política; reintento de cron no repite merma.

**Entradas previstas:** prep-list-service.ts; production-from-workflow.ts; hold-time-service.ts; pruebas.

**Verificación:** V1+V2+V3; producir→vencer→descartar→reintentar y comparar pantalla/ledger.

#### INV-03 — Operar conteo físico con revisión y ajuste idempotente.

**Dependencias:** PROD-02, REC-03B para lotes afectados. **Tamaño:** M.

**Aceptación:** Diferencia separada de ajuste autorizado; unidad/lote/actor explícitos; dos períodos/reintentos conservan el historial.

**Entradas previstas:** stock-count-service.ts; extractor/ajustes; reportes y pruebas.

**Verificación:** V2+V3; conteo→revisión→ajuste→reporte con actores distintos.

#### INV-04 — Congelar costo/varianza por período y procedencia.

**Dependencias:** INV-03. **Tamaño:** M.

**Aceptación:** Movimientos/snapshot reproducibles con versión de receta y costo; cambio de costos actuales no cambia cierre; varianza separa sin datos de cero medido.

**Entradas previstas:** food-cost-service.ts; inventory-snapshot-service.ts; reportes y pruebas.

**Verificación:** V1+V2; cerrar→cambiar costos→consultar histórico con igual total/detalle.

### Fase 5 — Excepciones, banca y finanzas

#### EXC-02 — Comparar legacy/canónico y habilitar gradualmente la lectura existente.

**Dependencias:** BASE-01, OPS-01. **Tamaño:** M.

**Aceptación:** Reusar flag global y decidir configuración por empresa si necesaria; comparación por sucursal/dominio con diferencias explicadas; rollback de lectura sin borrar lifecycle ni duplicar sync.

**Entradas previstas:** group-exceptions-service.ts; exceptions-sync.ts; configuración y pruebas.

**Verificación:** V1+V2+V3; incidente/factura→sync→pantalla y rollback.

#### EXC-03A — Completar lifecycle concurrente y verificación segregada.

**Dependencias:** EXC-02. **Tamaño:** M.

**Aceptación:** Resolvedor distinto del verificador; actualización obsoleta rechazada; reapertura conserva motivo/evidencia/historia.

**Entradas previstas:** exception-service.ts; lifecycle/auditoría; rutas y pruebas.

**Verificación:** V1+V2; dos acciones simultáneas y ciclo detección→cierre→reapertura.

#### EXC-03B — Escalar por SLA con job recuperable.

**Dependencias:** EXC-03A. **Tamaño:** S.

**Aceptación:** Reloj/tenant explícitos; una escalada por nivel/reintento; notificación y auditoría vinculadas al evento.

**Entradas previstas:** exception-sla.ts; job existente; pruebas.

**Verificación:** V1+V2; reloj controlado y caída/reintento, sin mensajes reales a personas.

#### EXC-04.<dominio> — Integrar merma, presupuesto, ausencia y banco con los adaptadores existentes.

**Dependencias:** EXC-03B; merma:INV-04; ausencia:NOM-02; banco:BAN-04/06. **Tamaño:** M por fuente.

**Aceptación:** Umbral/owner/SLA/enlace por fuente; sincronización idempotente y cierre coherente; banco consume señales de conciliación existentes.

**Entradas previstas:** adaptador del dominio; servicio origen; pruebas.

**Verificación:** V1+V2; caso dentro/fuera de rango, repetición y resolución por cada dominio.

#### BAN-01/04 — Acreditar cuentas, importación, matching de egresos y reversas ya implementados.

**Dependencias:** BASE-01, OPS-02.tesoreria. **Tamaño:** M por recorrido.

**Aceptación:** Empresa/cuenta/alcance correctos; duplicado/ambigüedad/parcial-múltiple soportados o bloqueados explícitamente; confirmación/reversa atómicas con evidencia durable.

**Entradas previstas:** bank-statement-service.ts; cuentas/corridas existentes; pruebas DB/API.

**Verificación:** V1+V2+V3; BAN-01–04 cada una con evidencia; mock por sí solo no cierra.

#### BAN-05/06 — Relacionar venta esperada, payout y depósito sin equipararlos.

**Dependencias:** BAN-01/04, INV-01. **Tamaño:** M por canal.

**Aceptación:** Bruto−comisión±ajustes=neto por canal/sucursal/período, vinculado a aggregatorSales/corte; diferencia pendiente visible; matching humano y reversa no duplican ingreso ni ocultan liquidaciones agrupadas.

**Entradas previstas:** aggregator-settlement/commission/gateway; banco y pruebas por subtarea.

**Verificación:** V1+V2+V3; payout con ajuste/devolución, depósito ambiguo/agrupado y reimportación.

#### FIN-01 — Separar saldo de cuenta, movimientos conciliados y proyección en la UI existente.

**Dependencias:** BAN-01/04, BAN-05/06. **Tamaño:** M.

**Aceptación:** Ancla/importado/conciliado/proyectado identificados con fecha/cobertura; cuenta sin ancla no se inventa en cero; resumen y detalle cuadran en centavos.

**Entradas previstas:** cash-flow/servicio de saldos; UI existente; pruebas.

**Verificación:** V1+V3; cuenta anclada/sin ancla, operación pendiente y reversa.

#### FIN-02A — Definir contrato de cierre, reintento y reapertura del snapshot P&L existente.

**Dependencias:** BASE-01. **Tamaño:** S.

**Aceptación:** Cerrar repetidamente no recalcula un histórico cerrado; reapertura autorizada crea versión trazable o política equivalente explícita; agregar entradas insuficientes/estimadas al estado de aceptación.

**Entradas previstas:** pnl-snapshot-service.ts; financial-period-service.ts; pruebas de contrato.

**Verificación:** V1; cerrar→reintentar→cambiar datos vivos→reabrir/revisar.

#### FIN-02B — Implementar y conectar lectura histórica del P&L con el contrato aprobado.

**Dependencias:** FIN-02A, INV-04, NOM-05, BAN-05/06. **Tamaño:** M.

**Aceptación:** Eliminar reemplazo accidental por UPSERT al reintentar cierre; cierre/snapshots consistentes ante fallo/concurrencia; versiones y procedencia consultables por sucursal/grupo.

**Entradas previstas:** snapshots/períodos; API/reporte; migración aditiva si necesaria; pruebas.

**Verificación:** V2+V3; cierre→cambio posterior→histórico idéntico y revisión autorizada identificable.

### Fase 6 — Servicios huérfanos por recorridos completos (P2)

#### REF-01 — Integrar Ley Silla: persistencia, API y pantalla con su consumidor.

**Dependencias:** LEG-03. **Tamaño:** M.

**Aceptación:** Reusar plantilla/cálculo puro; evaluación recuperable por puesto/sucursal con fuente/estado; auditoría y 401/403/cross-tenant comprobados.

**Entradas previstas:** schema reforms propuesto; servicio Ley Silla; ruta/UI y pruebas, subdivididas si excede cinco archivos.

**Verificación:** V1+V2+V3; evaluar→guardar→recargar en dos empresas.

#### REF-02 — Integrar eventos fuera de jornada y selección real de descanso como política.

**Dependencias:** LEG-03. **Tamaño:** M.

**Aceptación:** Política de empresa explícita sin presentarla como ley; actualización persistida y fechas válidas; actor/autorización, vencimiento y consumidor UI reales.

**Entradas previstas:** off-hours-event-service.ts; persistencia/ruta/panel propuestos; pruebas.

**Verificación:** V1+V2+V3; alta→selección→consulta y política no habilitada.

#### REF-03 — Integrar solicitudes de salud mental con las fuentes de permisos existentes.

**Dependencias:** LEG-03. **Tamaño:** M.

**Aceptación:** Reusar leaveRequests si representa el caso sin tabla duplicada; política/iniciativa declarada; saldo concurrente aprobado, privacidad y retorno visibles según rol.

**Entradas previstas:** mental-health-leave-service.ts; permisos/RH existentes; pruebas.

**Verificación:** V1+V2+V3; solicitud→aprobación→saldo y dos solicitudes concurrentes.

#### REF-04 — Persistir simulación de finiquito separando conceptos legales y prima IA opcional.

**Dependencias:** FIS-03, FIS-01. **Tamaño:** M.

**Aceptación:** Prima pendiente no aumenta automáticamente importe exigible; input/resultado/fecha/fuente/actor auditables; autorización RH/admin y consulta histórica.

**Entradas previstas:** ai-severance-calculator.ts; servicio de historial; ruta/UI propuestos; pruebas.

**Verificación:** V1+V2+V3; política desactivada/activada y formales/efectivo.

#### REF-05 — Conectar el finiquito autorizado al flujo real de baja.

**Dependencias:** REF-04 y ruta real de baja confirmada. **Tamaño:** M.

**Aceptación:** Localizar caller real antes de editar lifecycle; importe/snapshot autorizado y evento de transparencia enlazados; repetir baja no duplica cálculo/obligación ni suma una iniciativa como ley.

**Entradas previstas:** EmployeeService/ruta real; historial/transparencia; pruebas.

**Verificación:** V2+V3; baja real→historial→importe autorizado, permisos y reintento.

#### REF-06 — Recordar pendientes/vencimientos desde Inngest y actualizar documentación.

**Dependencias:** REF-02, REF-03. **Tamaño:** S.

**Aceptación:** Política y plazos configurados explícitos; dedupe por evento/destinatario/ventana/tenant; registros observables y conteo real de pruebas.

**Entradas previstas:** cron existente; NotificationDispatcher; tests; reformas-laborales-2026.md.

**Verificación:** V1+V2; reloj controlado y canal simulado, sin enviar mensajes reales.

### Fase 7 — Cobertura original y validación

#### IMSS-LINK — Enlazar el frente IMSS existente sin duplicar ni reiniciar sus tareas.

**Dependencias:** BASE-01; dependencias salariales FIS/NOM según contrato. **Tamaño:** S.

**Aceptación:** Conservar estado y decisiones de tasks/plan-imss.md y todo-imss.md; migración 0121 y cambios locales coordinados; pendientes identificados para matriz/alcance de liberación.

**Entradas previstas:** tasks/plan-imss.md; tasks/todo-imss.md; matriz de dependencias.

**Verificación:** Revisión documental; esta tarea no autoriza ejecutar migraciones ni sustituye el plan IMSS.

#### P2.<ID> — Completar OPE-01/02/03, COM-01, APR-01, PER-01, AUT-01, CTL-01 e INT-01 conservando criterios originales.

**Dependencias:** Según plan original y fuentes ya verificadas. **Tamaño:** S/M por subtarea.

**Aceptación:** Una tarea por rutina/documento/perfil/job/fuente; usar recorrido y aceptación del plan original, sin declarar completo por template/seed; generar subtareas antes de editar si hay más de cinco archivos.

**Entradas previstas:** cierresistemapulsoplan.md Fase 7; servicios y pruebas indicados por cada ID.

**Verificación:** V1/V2/V3 según recorrido; checkpoint cada 2–3 subtareas; no se difiere silenciosamente una fila de requisitos.

#### VAL-01.<modulo> — Resolver las 217 filas del inventario de aceptación con la evidencia actual.

**Dependencias:** Puertas de ramas aplicables y OPS-03 del entorno. **Tamaño:** M por módulo.

**Aceptación:** Cada fila tiene tarea/estado/prueba/entorno/fecha; 17 módulos y ocho perfiles; alcance P2 e IMSS incluido o explícitamente diferido en liberación limitada, sin declarar completo el sistema.

**Entradas previstas:** audits/2026-10-17-sistema/requisitos.csv; pruebas de aceptación y evidencia.

**Verificación:** V3; revisar matriz sin sustituir ejecución por existencia de código.

#### VAL-02 — Pilotear día completo y recuperación antes de liberar.

**Dependencias:** VAL-01 completo para el alcance. **Tamaño:** M por recorrido.

**Aceptación:** Jornada→compra→recepción→producción→venta→conteo→nómina→conciliación→cierre; 3/8/15 sucursales con presupuesto de latencia fijado antes; restauración y recuperación de jobs sin doble efecto.

**Entradas previstas:** E2E/fixtures aislados; runbook y reporte del piloto.

**Verificación:** V1+V2+V3; unit, tsc, lint pertinente, build y E2E; reporte de riesgos residuales.

## Cobertura de P2 conservada del plan original

Cada fila se ejecuta con sus criterios de la Fase 7 del plan de cierre, que se incorporan por referencia. Se registran hijos S/M por unidad indicada; no basta marcar el padre P2.

| ID | Subtareas mínimas | Dependencia principal y prueba |
|---|---|---|
| OPE-01 | UI/schedule; generación idempotente; cierre/proxima ocurrencia | Acceso de equipos ya existente; AUT-01 para despliegue. Equipo→job→orden→cierre. |
| OPE-02 | Intervalos de downtime; atribución/reporte de costo | OPE-01, COM-01. Dos fallas/reparaciones del mismo equipo. |
| OPE-03 | Aceite, cocina, salón, gerente, handoff | EXC-03, evidencia durable. Caso conforme y fuera de rango por rutina. |
| COM-01 | Compra→obligación; servicio→obligación | Recepción atómica, EXC-03, BAN-04. Normal y discrepancia, sin duplicar deuda. |
| APR-01 | Factura, gasto, OC, OS, nómina, pago | NOM-03, COM-01, BAN-04. Autoridad y cambio de monto invalidan aprobación. |
| PER-01 | Ocho perfiles, uno por hijo | Accesos de dominio y APR-01. Matriz allow/deny en API y UI. |
| AUT-01 | Outbox/extractores, SLA, hold-time, mantenimiento, snapshots | Función económica estable. Caída/reintento/tenant y fallo terminal observables. |
| CTL-01 | Dashboard, comparación, brief persistido | Fuentes EXC-04, FIN-01/02, AUT-01. KPI→detalle y falta de datos explícita. |
| INT-01 | POS, terminal, agregador por formato disponible | INV-01/02, BAN-06. Archivo→mix/corte→payout→banco. |

No crear un POS propio ni prometer APIs directas de delivery por existir su catálogo. Mantener importaciones verificables; una API/control de disponibilidad solo entra con acceso técnico y alcance concreto.

## Migración desde el checklist anterior

| IDs anteriores | Tratamiento nuevo |
|---|---|
| T0.1, A.1, A.2 | Implementación existente; BASE/TRACK verifican evidencia y AGU-04 prueba aceptación. No volver a crear contratos, bases o bitácora. |
| A.3 | AGU-02/03 para extraordinaria; NOM-01/02/04 para ordinaria. |
| A.4 | AGU-01 y DIA-01/02. |
| B.1 | FIS-01/02/03. |
| B.2/B.3/B.4 | LEG-01/02/03. |
| C.1–C.7 | REF-01–06 en recorridos por servicio, reutilizando permisos y almacenamiento existentes cuando encajen. |
| D.1/D.5 | OPS-01/02/03; diferencia real por entorno y RLS por lote. |
| D.2/D.6 | REC-03A/B y REC-TEMP/VAL. |
| D.3/D.4 | EXC-02, EXC-03A/B, EXC-04.<dominio>. |
| D.7 | NOM-01–05. |
| D.8 | BAN-01/04, BAN-05/06, FIN-01, FIN-02A/B. |
| D.9/E | P2 por ID, IMSS-LINK, VAL-01/02. |
| Fase omitida | INV-01/02, PROD-01/02, INV-03/04 quedan explícitas y condicionan FIN-02 y merma. |

## Puertas finales y riesgos

- Entrega 1: FIS-01/02/03, AGU-01/02/03/04 y DIA-01/02 con V1 y recorridos aplicables verdes; cero manual, exención y datos parciales probados. Las funciones previas mantienen sus commits y se anotan las correcciones posteriores.
- Entrega 2: reglas/readiness con consumidores reales, nómina aprobada→snapshot→timbrado→tesorería; INV/PROD y conteos conservan cantidad/valor y costo histórico.
- Entrega 3: aislamiento probado bajo runtime del entorno, excepciones por dominio, pago e ingreso de canal conciliados y P&L histórico reproducible.
- Cierre completo: matriz/piloto, P2 e IMSS aplicables acreditados; sin P0 abierto. Una liberación limitada enumera filas pendientes, responsables y alcance acordado; nunca se presenta como cierre de las 217 filas.
- Datos históricos insuficientes → conteo/decisión operativa, sin reparación masiva supuesta. Cambio fiscal → caso esperado y fuente oficial antes de cambiar resultados. Snapshot mutable → contrato/versiones antes de nuevos cierres. Proveedor caído → estado recuperable e idempotencia, sin declarar éxito por generar payload.
- Este pedido autoriza redactar el plan. No ejecuta seeds, migraciones, ajustes, timbrados, pagos, mensajes ni despliegues. Las acciones futuras siguen la autorización vigente de la sesión y las decisiones específicas de cada frente.

## Registro de preparación

2026-10-22: revisión del consolidado, planes de origen, resolver laboral y tracker IMSS; consultas CodeGraph y fuentes oficiales enlazadas. No se ejecutaron tests/build nuevos para esta edición documental. El checklist queda pendiente de implementación y las evidencias futuras se anexan al trabajar cada tarea.
