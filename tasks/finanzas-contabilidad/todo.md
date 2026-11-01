# Checklist: finanzas y contabilidad integrada

Fecha: 2026-10-31. Estado: FC-01–06 completadas técnicamente, con checkpoint global aprobado en FC-04 y verificación de esquema/servicios en FC-05–06. Siguiente incremento: FC-07. La descarga de cada comprobante privado y la revisión contable del piloto quedan fuera de esta verificación; ver evidencia, verificaciones globales y límites de cada entrega abajo.
Plan y decisiones: [plan.md](plan.md). Las rutas nuevas son propuestas; `<...>` indica un punto a resolver en FC-01, no un archivo existente.

## Reglas de ejecución

- Trabajar por entrega vertical; conservar código y planes bancarios existentes.
- Máximo cinco archivos previstos por tarea. Incluir metadatos de migración en el conteo real y dividir la tarea si lo supera.
- Toda mutación valida empresa, visibilidad de sucursal, permiso y periodo; las pruebas negativas son obligatorias.
- Cada tarea ejecuta las pruebas focalizadas indicadas. Pruebas de integración en base aislada; registrar evidencia, sin usar datos reales como fixtures.
- Checkpoints: tests del área y flujos afectados, `pnpm exec tsc --noEmit`, `pnpm run lint`, `pnpm run build`; E2E en entregas de UI. Distinguir fallos previos de regresiones.
- Revisión funcional del plan y resolución de decisiones de FC-01 antes de implementar adaptadores. No ejecutar migraciones ni activar producción desde esta planificación.

## FC-01: Definir fuentes canónicas y reglas

- [x] Completada con evidencia: [matriz-fuentes.md](matriz-fuentes.md), §§1–6. Decisiones de producto pendientes con responsable/bloqueo en §5; no equivalen a reglas aprobadas para clientes.
- **Tamaño:** M. **Dependencias:** Ninguna.
- **Descripción:** Inventariar fuentes, entidades legales, fechas y estados elegibles; resolver solapamientos y anotar huecos bancarios.
- **Aceptación:**
  - [x] Matriz cubre cada hecho de §4 y sus documentos.
  - [x] cada operación tiene fuente canónica propuesta y condición de elegibilidad; huecos explícitos bloquean su publicación.
  - [x] decisiones pendientes tienen responsable y bloqueo identificado.
- **Verificación:** Revisión contra servicios actuales y recorrido manual venta → cobro y recepción → factura → pago.
- **Archivos previstos:** `tasks/finanzas-contabilidad/plan.md`, `tasks/finanzas-contabilidad/matriz-fuentes.md`.

## FC-02: Construir el mes de referencia

- [x] Fixture y controles completados: [matriz-fuentes.md §7](matriz-fuentes.md#7-fc-02--mes-sintético-y-cálculo-independiente), 9/9 pruebas focalizadas y ESLint de ambos archivos aprobado. Checkpoint revisado: suite completa, TypeScript y lint aprobados; build recuperado con exit 0 durante FC-03a (ver evidencia abajo).
- **Tamaño:** M. **Dependencias:** FC-01.
- **Descripción:** Preparar fixture sintético y resultados esperados calculados independientemente de la implementación.
- **Aceptación:**
  - [x] Dos sucursales y empresa ajena cubren casos de §7.
  - [x] apertura, cargos, abonos y cierre esperado cuadran en centavos.
  - [x] permisos y cortes de fecha tienen ejemplos negativos (contratos esperados; enforcement se prueba en tareas de servicios).
- **Verificación:** Revisión del fixture y cálculo independiente de balances/flujo; `pnpm exec vitest run --configLoader bundle tests/unit/finance/accounting-reference.test.ts --maxWorkers 2`.
- **Archivos previstos:** `tests/fixtures/accounting/month.ts`, `tests/unit/finance/accounting-reference.test.ts`, `tasks/finanzas-contabilidad/matriz-fuentes.md`.

**Checkpoint tras FC-02:** revisar aceptación y evidencia de las tareas acumuladas; ejecutar verificaciones aplicables y actualizar decisiones/riesgos del plan antes de ampliar el alcance.

Ejecución 2026-10-30: focalizada 9/9; ESLint de fixture/test exit 0. Checkpoint recuperado al continuar: suite completa **190 archivos, 2360 pruebas aprobadas, 1 skipped, 1 todo, exit 0**; TypeScript **exit 0**; lint global **exit 0, 2438 warnings, 0 errores**. Build inicial exit 1 al descargar Geist/Geist Mono; se repitió con red autorizada y compiló, aún pendiente su resultado final al registrar este estado. Logs locales: `.tmp/fc02-{tsc,lint,build,unit}.log` y `.tmp/fc02-build-retry.log`. El intento inicial con separador `--` se interrumpió por filtro incorrecto; los resultados aprobados corresponden a comandos corregidos. FC-02 solo añade fixture/tests y documentación: no aplica migraciones ni modifica runtime. Se permite avanzar con el límite de build explícito, sin presentarlo como aprobado.

## FC-03: Consultar el origen de una cifra

- [x] Completada con evidencia en FC-03a/b/c.
- **División de ejecución (mantener máximo cinco archivos por incremento):** FC-03a entrega consulta/API de ventas, gastos operativos y caja chica, con total completo y aislamiento; FC-03b ampliará inventario/merma, FC-03c labor/comisiones y puente de utilidad. No marcar FC-03 completa con cobertura parcial. Cada ampliación debe reproducir la fórmula actual, sin fabricar documentos para estimaciones.
- **Tamaño:** M. **Dependencias:** FC-01, FC-02.
- **Descripción:** Crear consulta paginada de detalle del P&L usando la base y alcance del cálculo actual.
- **Aceptación:**
  - [x] Filtros de periodo/sucursal coinciden con el P&L.
  - [x] suma completa del detalle reproduce el renglón y conserva cobertura/estimación.
  - [x] documentos de otro ámbito no son accesibles.
- **Verificación:** Pruebas de contrato, total paginado y denegación entre empresas/sucursales.
- **Archivos previstos:** `lib/services/pnl-detail-service.ts`, `app/api/finance/pnl/detail/route.ts`, `tests/unit/finance/pnl-detail.test.ts`, `tests/integration/accounting/pnl-detail.test.ts`.

### FC-03a — detalle de ventas, gastos y caja chica (2026-10-30)

- [x] API `GET /api/finance/pnl/detail`: requiere `reports:read`, clasificación FINANCIAL, empresa de sesión y alcance de sucursal. Respuesta privada `no-store`; no publica evidencia, beneficiarios ni datos bancarios.
- [x] Consulta paginada con total completo y página en una sola sentencia/snapshot; conserva el total después de la última página. Mismas fechas, estados, cobertura y centavos que los tres renglones actuales del P&L.
- [x] Integración con Postgres aislado: **8/8 aprobadas**. Compara `getPnlDetail` con `getPnLByBranch`, suma páginas sin repetir documentos y prueba extremos de mes, prioridad de fechas de gasto, pendientes/rechazados, reposición excluida, cero medido frente a ausencia y denegación por empresa/sucursal. Referencias inconsistentes heredadas no exponen centros de costo ajenos.
- [x] Área financiera: **10 archivos, 148 pruebas aprobadas**, incluidas **13 de contrato/HTTP** para este detalle. ESLint de los cuatro archivos de código/tests: **exit 0**. Se reprodujo y corrigió la aceptación del año `0000` (válido en JavaScript, inválido en Postgres).
- **Entorno de integración:** `TEST_DATABASE_URL` con rechazo explícito si coincide con `.env`/`.env.local`; esquema aleatorio, copias de estructura sin datos, fixtures sintéticos y limpieza al finalizar. No hay fallback de `search_path` a public. Solo se simulan food/labor/comisiones/tasa, ajenos a FC-03a; las consultas y los tres renglones comparados usan Postgres real. No acredita RLS ni autenticación de sesión real; permisos HTTP se prueban en la capa unitaria.
- **Comandos:** `pnpm.cmd exec vitest run --configLoader bundle tests/unit/finance --maxWorkers 1`; `pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/accounting/pnl-detail.test.ts --maxWorkers 2`. Node 22.17 requiere `NODE_OPTIONS=--use-system-ca` para la conexión TLS del equipo; `NODE_USE_SYSTEM_CA` no resolvió el certificado.
- **Verificación global:** los primeros intentos concurrentes agotaron memoria de Node; build inicial también falló descargando Geist/Geist Mono. Recuperación en serie con `NODE_OPTIONS=--max-old-space-size=6144`: **TypeScript exit 0**, **lint global exit 0, 2438 warnings y 0 errores** (mismo conteo documentado en FC-02), **suite global exit 0: 191 archivos, 2373 aprobadas, 1 skipped, 1 todo**. **Build de producción exit 0**, con `NODE_OPTIONS=--max-old-space-size=8192 --use-system-ca` y red autorizada; recupera también la verificación pendiente de FC-02. Evidencia local: `.tmp/fc03a-{unit,unit-retry,tsc,tsc-retry,lint,build,build-retry,finance,tsc-serial,lint-serial,unit-serial}.log`.
- **Límite:** FC-03 sigue abierta. Próximo incremento FC-03b: inventario/merma con valoración y proxies actuales; después FC-03c: labor/comisiones y utilidad. FC-04 aún no tiene interfaz de detalle. Sin migraciones ni activación contable.

### FC-03b — detalle de consumo, merma y aproximaciones (2026-10-30)

- [x] La misma API acepta `foodCost` y `waste`, después de validar sesión/empresa, fechas y alcance. Reutiliza artículos, movimientos, método de sucursal y método de empresa; no añade catálogos ni migraciones.
- [x] Reproduce la selección actual: USAGE/WASTE prevalecen sobre RECEIVING; sin salidas, compras como proxy DERIVED; sin movimientos, estimación sectorial calculada por el P&L existente o NO_DATA. Una estimación se devuelve en `calculation`, separada de `items`; no se inventa un documento ni un movimiento. La suma explicada es documentos más cálculo, cuando exista.
- [x] Método promedio/último con los mismos fallbacks y costos **actuales**, explícitos en `valuation`. Conserva la cobertura actual del P&L (máximo de días distintos de USAGE/WASTE, no unión de ambos), el cero medido cuando solo hay merma y el aviso cuantificado de salidas sin costo. No acredita valoración histórica congelada, que corresponde a FC-14.
- [x] Redondea el total del periodo y reparte sus centavos por acumulados en un orden estable. Así dos consumos de 0.5 centavos suman 1, no 2, también al paginar. Cantidad y costo unitario acompañan al movimiento; `rounding` declara el reparto. Comprueba centavos seguros y rechaza una discrepancia de representación numérica.
- [x] Referencias de artículos a otra empresa bloquean la lectura con 409, sin exponer sus nombres/importes. Si aparecen movimientos entre la lectura vacía y el cálculo sectorial, exige repetir la consulta; no devuelve un total medido sin documentos.
- [x] Periodo de detalle acotado a **366 días** (incluye año bisiesto). Evita rangos de muchos años al recurrir al cálculo del P&L, que itera días. Pruebas de frontera para 366/367 días; no modifica los filtros de la ruta original del P&L.
- **Pruebas:** **16/16** de integración sobre Postgres aislado, con food cost real (ya no simulado), y **150/150** del área financiera en 10 archivos, incluidas **15** de frontera/HTTP. Casos: suma de páginas, redondeo fraccional, consumo frente a compra, merma separada, métodos de empresa/sucursal, cambio de costo actual, fallback, costos ausentes, fechas, ausencia, estimación y aislamiento. TypeScript **exit 0**; ESLint de los cuatro archivos modificados de código/tests **exit 0**. El test inicial de estimación seleccionaba por error la sucursal ajena; se corrigió el fixture, manteniendo la denegación 404 del servicio.
- **Verificación global final:** **suite exit 0: 191 archivos, 2375 pruebas aprobadas, 1 skipped y 1 todo**. **Lint global exit 0: 0 errores, 2438 advertencias**, mismo conteo de FC-03a; lint focalizado de los cuatro archivos de código/tests sin advertencias. **Build final exit 0**, incluido el chequeo de tipos de Next.js sobre el código final. El primer intento compiló y se detuvo durante tipos para incorporar el límite de periodo; el segundo aprobó. Las verificaciones globales se ejecutaron en serie para limitar consumo de memoria.
- **Evidencia local:** `.tmp/fc03b-finance.log`, `.tmp/fc03b-integration.log`, `.tmp/fc03b-tsc.log`, `.tmp/fc03b-build.log`, `.tmp/fc03b-build-final.log`, `.tmp/fc03b-unit-full.log`, `.tmp/fc03b-lint-full.log`. Comandos equivalentes a FC-03a, con `NODE_OPTIONS=--use-system-ca` para integración y `--max-old-space-size=8192 --use-system-ca` para build.
- **Límite:** FC-03 continúa pendiente de labor, comisiones y utilidad (FC-03c); FC-04 sigue pendiente. No se modificó la fórmula ni el servicio del P&L existente para hacer cuadrar el detalle.

### FC-03c — nómina, comisiones y puente de utilidad (2026-10-30)

- [x] Revisado y completado el trabajo parcial encontrado en el árbol local. La API de detalle admite `labor`, `commissions` y `operatingProfit`, conservando las validaciones financieras, empresa, sucursal y periodo de FC-03a/b.
- [x] Nómina explica sueldo base y horas extra/prima festiva; contratos sin asistencia conservan DERIVED, asistencia MEASURED y fallback sectorial SECTOR_DEFAULT. La provisión de aguinaldo es informativa y no se suma. No expone nombres, contratos ni recibos individuales.
- [x] Comisiones explica cada canal con base valuada, tarifa/IVA cuando únicos, porción medida y venta sin tarifa. Cambio de vigencias deja tarifa `null`; no fabrica documentos ni presenta la venta sin tarifa como comisión cero medida.
- [x] Utilidad explica venta base menos consumo, merma, nómina, gastos, comisiones y caja chica, con signos explícitos, base neta/bruta y calidad del insumo más débil. Conserva utilidad negativa y ausencia de ventas.
- [x] Desglose y renglón deben coincidir en centavos; nómina/comisiones también en procedencia y cobertura. Se reprodujeron dos fallos con igual total pero procedencia/cobertura distintas; ambos ahora devuelven 409 solicitando repetir la consulta. No constituye un snapshot transaccional de todos los servicios.
- **Verificación focalizada:** contrato/HTTP **27/27**; integración final **22/22, exit 0**, Postgres aislado con consultas reales de inventario, nómina y comisiones. Configuración de IVA, provisión y regla de aguinaldo fijadas en el fixture; no se verifica su resolución de configuración ni RLS/sesión real. Incluye historial salarial, asistencia pendiente/fuera de periodo, vigencias de comisión, empresa ajena y sucursal oculta para los ocho renglones.
- **TypeScript:** `pnpm exec tsc --noEmit`, **exit 0**. **ESLint focalizado:** cuatro archivos de código/tests, **exit 0**. Revisión de corrección, alcance, datos privados y consultas realizada con la habilidad `code-review-and-quality`.
- **Checkpoint global aprobado:** suite **exit 0: 191 archivos, 2387 aprobadas, 1 skipped y 1 todo**. Lint global **exit 0: 0 errores, 2438 advertencias**, mismo conteo documentado en FC-03b. **Build de producción exit 0**, con compilación, tipos y generación de páginas. El intento restringido falló al descargar Geist/Geist Mono; el reintento con red autorizada aprobó. Evidencia local: `.tmp/fc03c-{unit-full,integration-final,tsc,lint-focused,lint-final,build-final,build-network}.log`; integración repetida con captura explícita de `$LASTEXITCODE` porque el wrapper inicial reportó exit 1 pese al resumen 22/22. Se interrumpieron los primeros intentos de lint/build para terminar las verificaciones en serie por presión de recursos.
- **Límite y siguiente paso:** FC-03 entrega consulta/API operativa, no un libro mayor. FC-04 continúa pendiente: interfaz de detalle y navegación autorizada desde Resultados. Sin migraciones ni activación contable. Los cambios locales ajenos a esta entrega se conservan.

## FC-04: Mostrar documentos desde Resultados

- [x] Completada con evidencia técnica y recorrido con sesiones reales de cuentas demo (2026-10-31).
- **Tamaño:** M. **Dependencias:** FC-03.
- **Descripción:** Añadir detalle accesible desde cada renglón, con enlace a operación y evidencia permitida.
- **Aceptación:**
  - [x] Detalle expone fuente, fecha y cobertura.
  - [x] estados vacío/error/paginación conservan filtros.
  - [x] navegación por teclado y roles autorizados funcionan; recorrido real con administrador y gerente, denegación sin sesión y entre sucursales.
- **Verificación:** Verificación en navegador y pnpm run test:e2e -- tests/e2e/accounting.spec.ts.
- **Archivos del incremento (cinco):** `components/finance/pnl-branch-table.tsx`, `components/finance/pnl-source-detail.tsx`, `tests/e2e/accounting.spec.ts`, `tests/support/accounting-browser-server.ts` y este checklist.

### FC-04 — entrega local y evidencia (2026-10-31)

- **Interacción:** las cifras de Resultados abren un detalle inline con fuente, periodo, cobertura y total completo, independiente de la página de movimientos. Distingue movimientos documentados de cálculos/estimaciones; incluye selección de merma y caja chica, referencias de origen, paginación, reintento y devolución del foco al cerrar. Conserva filtros y cancela consultas obsoletas para evitar resultados de otro periodo o selección. NO_DATA y denegación 403 muestran estados honestos sin conservar datos previos.
- **Navegación y privacidad:** gastos enlaza al registro con `?focus=`; las demás fuentes llevan a sus pantallas de origen con referencias visibles. No se inventan rutas individuales ni se muestran comprobantes privados. El detalle reutiliza permisos de la API existente; esta entrega no cambia servicios, fórmulas, permisos ni esquema contable.
- **Continuidad visual documentada:** extensión local del modo Operate de [PRODUCT.md](../../PRODUCT.md) y [DESIGN.md](../../DESIGN.md), con Geist, rojo escaso y superficies planas. El detalle permanece inline, sin modal. La columna fija opera desde escritorio mediano para no cubrir controles móviles; encabezado, acciones y pie se adaptan a 320 px, conservando el desplazamiento horizontal de la tabla. No se introducen tokens ni se modifica el sistema global o su sidecar; el pase de documentación Impeccable queda acotado a este registro local.
- **E2E y navegador:** `tests/e2e/accounting.spec.ts`, **6/6, exit 0**. Componentes reales con HTTP y sesión sustituidos por harness sintético: foco, teclado, paginación, reintento, NO_DATA, 403 sin datos previos y cambio de periodo. Revisión de cajas/controles a **320/768/1024/1440 px**, interacción táctil con desplazamiento horizontal y consola sin errores ni advertencias en el escenario final. Evidencia: `.tmp/fc04-e2e-accepted.log`, `.tmp/fc04-desktop-confirmed.png` y `.tmp/fc04-mobile-confirmed.png`.
- **Pruebas del área:** **162/162, exit 0**, en `.tmp/fc04-finance.log`. TypeScript previo **exit 0**, `.tmp/fc04-tsc-verified.log`; lint focalizado previo **exit 0**. Revisión independiente de acabado Impeccable con disposición **SHIP**: cuatro hallazgos resueltos (resumen afectado por CSS antiguo del harness, columna fija móvil, pie y encabezado estrechos), sin hallazgos materiales pendientes.
- **Checkpoint final aprobado:** TypeScript global **exit 0**, lint global **exit 0: 0 errores, 2438 advertencias** (mismo conteo previo), suite global final **exit 0: 191 archivos, 2387 aprobadas, 1 skipped y 1 todo** tras la corrección de calendario y **build de producción exit 0**, con compilación, tipos y generación de páginas. Logs: `.tmp/fc04-tsc-checkpoint.log`, `.tmp/fc04-lint-full.log`, `.tmp/fc04-unit-accepted.log` y `.tmp/fc04-build-final.log`.
- **Reparación separada del checkpoint (tres archivos: seed, prueba y checklist):** el primer barrido global aprobó 190 archivos/2386 pruebas y falló en `seed-11-control-orders`, sin cambios previos en ese archivo. El 31 de octubre, restar un mes desde el día 31 desbordaba septiembre hacia octubre y duplicaba `branch_budgets_branch_cc_month_unique`. Se calcula ahora desde el primer día UTC, coherente con la clave mensual existente. La prueba fija Date al 31 de octubre, conserva temporizadores reales y comprueba meses septiembre/octubre en ambas ejecuciones. Reproducción roja y prueba corregida **exit 0**, `.tmp/fc04-seed-date-{red,green}.log`. No se ejecutó el seed contra una base operativa; solo PGlite aislado. Suite final repetida en `.tmp/fc04-unit-accepted.log`, todavía pendiente al registrar esta nota.
- **Recorrido real posterior al build:** aplicación de producción local, sin sustituir HTTP ni sesión. Las cuentas demo de administrador y gerente iniciaron sesión por la pantalla real; administrador consultó tres sucursales y gerente solo la asignada. Ambos abrieron detalle con teclado, recuperaron foco al cerrar y navegaron desde el movimiento hasta el gasto resaltado con `?focus=`. Gerente al pedir otra sucursal: **403**; lectura de detalle sin sesión: **401**. Verificación **exit 0**, script/evidencia local `.tmp/fc04-live.cjs`, `.tmp/fc04-live.log` y `.tmp/fc04-live-results.json`. No se sembraron datos ni se modificaron operaciones financieras en la base configurada; los inicios de sesión crean sus sesiones normales.
- **Límite de cobertura:** se verificó la navegación autorizada al gasto, no la descarga/apertura de cada comprobante privado ni un cierre contable con contador. Las demás fuentes conservan enlaces a sus pantallas de origen y referencias visibles, sin inventar un visor de documentos. Esta entrega cierra FC-04; **FC-05 es el siguiente incremento**. Sin migraciones, activación contable ni cambios a planes ajenos.

**Checkpoint tras FC-04:** revisar aceptación y evidencia de las tareas acumuladas; ejecutar verificaciones aplicables y actualizar decisiones/riesgos del plan antes de ampliar el alcance.

## FC-05: Completar vínculos contables sobre catálogos existentes

- [x] Completada con evidencia (2026-10-31); entregada en FC-05a/b/c.
- **División de ejecución (2026-10-31, cumplida):** contrato/pruebas y documentación; FC-05a añade claves `(companyId,id)` a los dos catálogos existentes (dos esquemas + SQL/snapshot/journal = cinco archivos); FC-05b añade cuentas y vínculos al esquema modular (dos archivos + SQL/snapshot/journal = cinco); FC-05c incorpora guardas SQL y servicio, con pruebas ya preparadas. Los ajustes de pruebas/documentación se registran como incremento de verificación separado si exceden cinco archivos. Generar SQL no lo aplica a la base operativa.
- **Justificación de estructuras nuevas:** `cost_centers.accountingLine` y las partidas QSR siguen siendo la clasificación operativa; `company_bank_accounts` conserva datos cifrados y propósito RECEPCION/DISPERSION/MIXTO. Solo faltan cuentas con tipo/naturaleza/jerarquía/vigencia y referencias a esos registros para el futuro libro mayor. Los vínculos no copiarán números, CLABE, saldos ni nombres bancarios. No se asignarán cuentas automáticamente ni se crearán pólizas en FC-05.
- **Tamaño:** M. **Dependencias:** FC-01.
- **Descripción:** Inventariar y reutilizar `cost_centers.accountingLine`, partidas QSR y `company_bank_accounts` RECEPCION/DISPERSION/MIXTO. Incorporar únicamente estructuras y vínculos que falten para el registro contable; conservar catálogos y clasificación operativa existentes.
- **Aceptación:**
  - [x] Código único por empresa y jerarquía sin ciclos.
  - [x] referencias y cuenta bancaria pertenecen al mismo ámbito.
  - [x] migración aditiva probada en base aislada.
- **Verificación:** Pruebas de restricciones y aislamiento; inspección SQL generado con pnpm db:generate.
- **Archivos previstos:** `lib/db/schema/accounting.ts`, `lib/db/schema.ts`, `lib/services/accounting/account-service.ts`, `drizzle/<migración-generada>.sql`, `tests/integration/accounting/accounts.test.ts`.

### FC-05a — claves de ámbito en catálogos existentes (2026-10-31)

- [x] `cost_centers` y `company_bank_accounts` añaden `UNIQUE (company_id, id)` en sus esquemas Drizzle (`unique`, no índice parcial) para habilitar las futuras claves foráneas compuestas. No se renombran columnas ni se duplican catálogos.
- [x] Migración aditiva `drizzle/0124_fc05_tenant_keys.sql`: dos `ADD CONSTRAINT ... UNIQUE`; segura sobre datos existentes porque `(company_id, id)` ya es único por la PK de `id`.
- [x] Metadatos: `drizzle/meta/0124_snapshot.json` y entrada 124 en `_journal.json`. Archivos del incremento: dos esquemas + SQL + snapshot + journal.

### FC-05b — cuentas contables y vínculos (2026-10-31)

- [x] `lib/db/schema/accounting.ts` con `accounting_accounts` (empresa, código, nombre, tipo, naturaleza, padre, postable, activo, vigencia, actor de alta/edición) y `accounting_source_links` (vínculo actual a `cost_centers` **o** a `company_bank_accounts`, nunca ambos). Exportado por `lib/db/schema/index.ts`.
- [x] Restricciones declarativas: PK `id`, `UNIQUE (company_id, id)`, `UNIQUE (company_id, code)`, FK compuestas a empresa/padre/cuenta/centro de costo/cuenta bancaria, CHECK de formato de código, nombre recortado 1–160, tipo y naturaleza válidos, vigencia `valid_to >= valid_from`, padre distinto de sí mismo, y `(cost_center_id IS NOT NULL) <> (bank_account_id IS NOT NULL)`.
- [x] RLS `ENABLE` con política de empresa vía `app.current_company_id` en ambas tablas. Migración aditiva `drizzle/0125_fc05_accounts.sql` + snapshot entradas 125. Sin relleno de datos, sin mapeos por defecto.
- [x] Los vínculos no copian número, CLABE, saldo ni nombre bancario; `company_bank_accounts` conserva esos datos y su propósito RECEPCION/DISPERSION/MIXTO, y `cost_centers.accountingLine` sigue siendo la clasificación operativa.

### FC-05c — guardas SQL, servicio y pruebas (2026-10-31)

- [x] `drizzle/0126_fc05_account_guards.sql`: `FORCE RLS` en ambas tablas; `accounting_accounts_guard` (inmutabilidad de `id/company_id/code/kind/normal_balance`, ciclo por CTE recursiva, padre no postable y del mismo tipo, cuenta con hijos no postable, `pg_advisory_xact_lock` por empresa y rechazo `0A000` fuera de READ COMMITTED); `accounting_source_links_guard` (cuenta destino activa y postable, banco propio activo en MXN sobre cuenta ASSET, centro de costo activo de la misma empresa). Privilégios mínimos para el rol de runtime existente (`pulso_app`) si está presente: SELECT/INSERT/UPDATE y SELECT por columna de `users`/`cost_centers`/`company_bank_accounts`; sin DELETE ni roles elevados.
- [x] `lib/services/accounting/account-service.ts`: único punto de escritura/lectura (`createAccount`, `updateAccount`, `linkSource`, `listAccounts`, `listSourceLinks`). Exige `settings:update`, empresa de sesión, actor activo de la misma empresa con el rol declarado; Zod estricto (código normalizado, fecha ISO real rechazando `0000`); paginación acotada; errores de Postgres mapeados a 400/403/404/409; sin endpoint público en FC-05.
- [x] `linkSource` es upsert por vínculo actual (`(company_id, cost_center_id)` o `(company_id, bank_account_id)`), de modo que reasignar reemplaza sin acumular historial de mapeos, que corresponde a FC-08.
- **Pruebas:** `tests/integration/accounting/accounts.test.ts`, **12/12 aprobadas, exit 0** (69.7 s) sobre Postgres aislado (esquema aleatorio, rol runtime `NOBYPASSRLS`, migraciones 0124–0126 aplicadas en ese esquema). Cubre: roles sin permiso, actor ajeno/inactivo, empresa inválida, cinco tipos de cuenta, código/fecha inválidos, alta concurrente con un solo ganador, paginación estable y aislamiento de lectura/edición entre empresas, ciclos y reparentado en lote, bloqueo por `pg_advisory_xact_lock` (espera observada en `pg_locks`) y rechazo de `REPEATABLE READ`, reemplazo de vínculo de centro de costo preservando `accounting_line`, vínculos a banco RECEPCION/DISPERSION/MIXTO sin exponer campos sensibles, denegación de orígenes/cuentas ajenos, vínculo incompleto, banco inactivo o en USD y cuenta no ASSET, RLS fail-closed sin contexto y cross-tenant, y recorrido completo del servicio actuando con el rol de runtime usando solo privilegios provisionados por la migración.
- **Verificación:** `pnpm exec tsc --noEmit` **exit 0** (`.tmp/fc05-tsc.log`); ESLint focalizado de esquemas, servicio y prueba **exit 0** (`.tmp/fc05-lint.log`); `pnpm exec drizzle-kit generate` responde **"No schema changes, nothing to migrate"** tras los snapshots 0124–0126, sin archivos nuevos (`.tmp/fc05-generate.log`).
- **Límite:** no se aplicó ninguna migración a la base operativa ni se activó contabilidad; no hay pólizas, mapeos automáticos, API ni UI. La prueba replica la estructura de `public` en un esquema aislado, así que exige que la base de pruebas ya tenga el esquema base migrado. Las guardas dependen de READ COMMITTED (decisión explícita, documentada en el SQL).

## FC-06: Registrar una póliza balanceada

- [x] Completada con evidencia de integración en base aislada; límites de acceso/UI y cierre concurrente explícitos abajo.
- **Tamaño:** M. **Dependencias:** FC-02, FC-05.
- **Descripción:** Crear esquema y servicio transaccional de borrador/publicación y validación de importes.
- **Aceptación:**
  - [x] Publicación atómica rechaza descuadre/cuenta inválida.
  - [x] centavos y totales no desbordan ni aceptan lados negativos.
  - [x] póliza publicada no admite edición/borrado.
- **Verificación:** Pruebas de publicación, rollback y persistencia bajo fallo.
- **Archivos previstos:** `lib/db/schema/accounting.ts`, `drizzle/<migración-generada>.sql`, `lib/services/accounting/journal-service.ts`, `lib/services/accounting/amounts.ts`, `tests/integration/accounting/journal.test.ts`.

### FC-06 — continuación y revisión del trabajo local (2026-10-31)

- **Inventario encontrado:** esquema de pólizas/renglones, migraciones 0127–0128 y snapshots, servicio y helpers de importes sin prueba de integración ni cierre de tarea. Se conservó el trabajo local de FC-05 y los cambios ajenos. División por incrementos: esquema/metadatos heredados; importes y prueba unitaria (dos archivos); guardas, servicio y prueba de integración (tres archivos); registro de evidencia en plan/checklist (dos archivos).
- **Importes:** conversión decimal exacta mediante BigInt intermedio y centavos seguros como `number`; rechaza negativos, fracciones adicionales, NaN, infinito y desbordamientos, sin redondeo silencioso. Prueba de regresión falló antes de la corrección; **3/3 pruebas unitarias aprobadas**.
- **Persistencia:** crear, reemplazar, eliminar borrador y publicar en transacciones con versión optimista; fuente única por empresa/hecho/versión y folio por empresa. PostgreSQL vuelve a validar balance, cuentas vigentes, mínimo de renglones y total seguro. Pólizas publicadas y sus renglones son inmutables, incluyendo el intento de trasladar un renglón publicado a otro borrador.
- **Concurrencia:** mutaciones comparten el lock de empresa de las cuentas (505); renglones bloquean también su cabecera. Rechazo explícito de aislamiento distinto de READ COMMITTED; la lectura de detalle bloquea la cabecera en SHARE para mantener coherencia con sus renglones. La prueba observa el lock pendiente en `pg_locks`, confirma una edición y comprueba que publicar valida el nuevo descuadre.
- **Ámbito y periodo:** actor activo con rol real de la empresa, RLS fail-closed, sucursal activa de la misma empresa desde INSERT, y bloqueo de mutaciones en periodos ya cerrados (también al intentar mover un borrador fuera del periodo). Servicio interno restringido a alcance COMPANY y permisos reports:read/manage; FC-07 deberá incorporar consulta por sucursal y capacidades separadas. No hay API pública ni UI contable en este incremento.
- **Regresiones reproducidas:** primera integración ejecutada contra las guardas previas: **8 aprobadas y 3 fallidas**, por traslado de renglón publicado, sucursal inválida en alta y periodo cerrado. Corregidas en 0128, aún no aplicada a la base operativa. Integración focalizada posterior: **13/13 aprobadas, exit 0**, con rol NOBYPASSRLS y esquema aleatorio; incluye rollback de reemplazo fallido, doble edición/publicación, clave de origen duplicada, importes, SQL directo y privilegios runtime.
- **Verificación:** integración completa del área contable **47/47, tres archivos, exit 0** (`.tmp/fc06-accounting-final.log`); TypeScript **exit 0** (`.tmp/fc06-tsc.log`); ESLint focalizado **exit 0**, sin advertencias (`.tmp/fc06-lint-final.log`); lint global **exit 0, cero errores y 2438 advertencias**, mismo conteo registrado antes de FC-05 (`.tmp/fc06-lint-full.log`); Drizzle generate **exit 0**, "No schema changes, nothing to migrate" (`.tmp/fc06-generate.log`). Suite global: **2389 aprobadas, una fallida, una skipped y una todo; exit 1** (`.tmp/fc06-unit-full.log`). Único fallo: `tests/unit/payroll/nomina-rls-batch.test.ts:34` exige que 0123 sea la última migración, incompatible con las 0124–0128 que ya estaban en el árbol al iniciar esta continuación. No se modificó ese test ni se eliminó historia de migración para hacerlo pasar. Build inicial **exit 1** al descargar Geist/Geist Mono (`.tmp/fc06-build.log`); reintento con red autorizado **exit 0**, con compilación, tipos y generación de páginas (`.tmp/fc06-build-network.log`). Revisión de corrección, aislamiento, concurrencia y alcance realizada con la habilidad `code-review-and-quality`. No se declara checkpoint global aprobado por la aserción del journal en la suite de nómina.
- **Límites:** no se aplican migraciones a la base operativa ni se activa contabilidad. El bloqueo contra un periodo ya cerrado no acredita la carrera cierre/publicación; el cierre financiero existente todavía no usa el protocolo del libro mayor, que corresponde a FC-16. Reversas, permisos específicos y recorrido con gerente/contador corresponden a FC-07; apertura y adaptadores siguen pendientes.

## FC-07: Revisar y publicar ajustes

- [x] Completada con evidencia (2026-11-01); build final aprobado y límites anotados abajo.
- **Tamaño:** M. **Dependencias:** FC-06.
- **Descripción:** Exponer API y pantalla de pólizas con capacidades separadas y corrección mediante reversa.
- **Aceptación:**
  - [x] Listado/detalle respetan ámbito y paginación.
  - [x] publicar/revertir exige permiso y motivo con historial.
  - [x] reversa y reemplazo referencian la póliza y preservan la original.
- **Verificación:** Pruebas de autorización y reversa; recorrido UI con contador y gerente.
- **Archivos previstos:** `app/api/finance/accounting/journals/route.ts`, `app/api/finance/accounting/journals/[id]/route.ts`, `app/dashboard/finance/control-interno/polizas/page.tsx`, `tests/integration/accounting/journal-access.test.ts`, `tests/e2e/accounting.spec.ts`.

### FC-07 — ejecución por incrementos (2026-11-01)

- **División real:** a) esquema, migración 0129 generada y ampliada con guardas, snapshot/journal (cuatro archivos); b) recurso RBAC y contrato de recursos/perfiles (dos); c) servicio y dos pruebas de integración (tres); d) helper HTTP, tres rutas y prueba HTTP (cinco); e) tipos/formatos del cliente, editor, consulta, página y acceso desde Control Interno (cinco); f) prueba E2E, arnés y configuración de navegador, prueba de importes y compatibilidad de registro de migraciones (cinco); g) cierre documental en plan, checklist y [fc07-review.md](fc07-review.md). Se conserva el resto del árbol local.
- **Permisos:** recurso `accounting` con read/create/update/delete/publish/reverse explícitos, sin `manage` implícito. ADMIN captura/edita; OWNER y SUPER_ADMIN publican/revierten; GERENTE, SUPERVISOR y READONLY consultan su sucursal activa. No se inventa un rol CONTADOR. El servicio vuelve a resolver rol, empresa, actividad y sucursal en DB; la página solo usa las capacidades devueltas por la API para ofrecer acciones.
- **Persistencia:** 0129 añade motivo de publicación y enlace de reemplazo, claves compuestas por empresa y unicidad de reversa/reemplazo por original. Las guardas exigen motivo en nuevas publicaciones, original publicado de la misma sucursal, fecha no anterior y reversa con el multiconjunto exacto de cuentas/centros/importes invertidos. Reversa y reemplazo conservan la misma fecha elegida. No rellena motivos históricos ni edita originales publicados.
- **Corrección:** reversa publicada y reemplazo opcional como borrador dentro de una transacción. Si falla el reemplazo, no persiste la reversa. Doble reversa concurrente tiene un solo ganador; cierre ya existente y cuentas no vigentes siguen bloqueando. Historial conserva motivos, actores, fechas y navegación entre pólizas relacionadas.
- **HTTP:** listado/detalle paginados, alta y edición de borrador, publicación y reversa con sesión/RBAC/FINANCIAL, validación estricta y `private, no-store`, también en errores. No acepta empresa, actor ni procedencia automática del cliente. Escritura requiere JSON y rechaza origen distinto. El catálogo de cuentas para captura respeta el servicio existente.
- **Interfaz:** `/dashboard/finance/control-interno/polizas`, acceso desde Cierre y control. Editor de cuentas/cargos/abonos con centavos exactos, estados de carga/vacío/error/reintento, confirmación inline con motivo y versión, filtros/paginación y cambio de sucursal sin conservar detalle anterior. Móvil muestra el concepto y acción sin desplazamiento lateral; los cargos y abonos habituales permanecen visibles juntos. Retorno de foco verificado al cerrar detalle y cancelar captura/edición.
- **Evidencia UI:** **15/15 E2E aprobadas, exit 0**, nueve de pólizas y seis previas del P&L (`.tmp/fc07-e2e-complete.log`), mediante `pnpm exec playwright test --config playwright.accounting.config.ts`. Arnés sintético de HTTP/sesión, componentes y CSS reales; no son sesiones productivas ni un piloto. Capturas `.tmp/fc07-{desktop,mobile,editor-desktop,editor-mobile}.png`; revisión fresca Impeccable **SHIP, sin hallazgos abiertos**. La única observación menor (retorno de foco al cancelar editor) quedó corregida y recibió segunda disposición SHIP. La comprobación con el layout real evita duplicar el landmark principal del dashboard; prueba focalizada **2/2** (`.tmp/fc07-layout-verified.log`). Se reprodujo y corrigió la etiqueta de cuenta que seguía el índice del renglón al eliminar uno anterior con catálogo parcial: ahora se resuelve por ID, con regresión E2E incluida. No se cambian PRODUCT.md, DESIGN.md ni el sidecar global; contrato local documentado en [fc07-review.md](fc07-review.md).
- **Recuperaciones:** pruebas HTTP/importes **11/11**, RBAC **21/21** y compatibilidad de migración **7/7**, aprobadas. La prueba de nómina exigía que 0123 fuera la última entrada e impedía cualquier migración posterior: ahora exige índice 123, presencia única y ubicación posterior a 122, manteniendo intactas las pruebas de políticas RLS. Un fallo transitorio al importar Kysely se recuperó sin cambiar dependencias (**9/9** de visibilidad de sucursal). El primer chequeo TypeScript final agotó heap con otras verificaciones concurrentes; se verifica nuevamente en serie. Los fixtures negativos se ajustaron para que el motivo y la fecha correctos permitan alcanzar las guardas específicas de descuadre, desbordamiento y cuenta inválida.
- **Checkpoint aprobado:** suite global **2405 aprobadas, una skipped y una todo preexistentes; 193 archivos, exit 0** (`.tmp/fc07-unit-verified.log`); integración contable **53/53, cuatro archivos, exit 0** (`.tmp/fc07-integration-verified.log`), con comprobación SQL focalizada final **4/4** (`.tmp/fc07-sql-boundary-final.log`; las otras 15 se excluyen por filtro de nombres, no se deshabilitan pruebas); lint global **exit 0, cero errores y 2438 advertencias**, mismo conteo anterior (`.tmp/fc07-lint-global.log`). Drizzle generate **exit 0**, sin cambios de esquema pendientes (`.tmp/fc07-schema-verified.log`). **TypeScript en serie exit 0**, con heap de 8192 MB (`.tmp/fc07-tsc-serial.log`).
- **Build final exit 0** al repetirlo en exclusiva: compilación (`2.4 min`), `Running TypeScript` y generación de **436 páginas**. Incluye `/dashboard/finance/control-interno/polizas` y las tres rutas `/api/finance/accounting/*`, así que el chequeo de tipos cubre también la corrección posterior de etiqueta de cuenta (10:31), hecha después del `tsc` de las 10:10. El intento previo (`.tmp/fc07-build.log`) no fue un fallo de código: Turbopack abortó leyendo `svix/dist/models/endpointTransformationIn.js` con `os error 1450` (recursos insuficientes del sistema) y 0.4 GB de memoria física libre, con otras verificaciones y navegadores abiertos. Evidencia: `.tmp/fc07-build-retry.log` y `.tmp/fc07-build-retry-exit.log`. Para repetirlo: `$env:NODE_OPTIONS="--max-old-space-size=8192 --use-system-ca"; pnpm run build`, sin procesos concurrentes.
- **Habilitación y límites:** API deshabilitada por defecto; `ACCOUNTING_REVIEW_ENABLED=1` solo en el entorno revisado tras aplicar las migraciones correspondientes. No se modifica `.env`, no se migra la base operativa ni se activa contabilidad. Activación gradual por empresa, apertura, reglas y adaptadores siguen pendientes; la carrera cierre/publicación corresponde a FC-16. Deshabilitar la bandera detiene esta interfaz/API sin borrar pólizas ni retirar columnas; conservar evidencia y corregir con reversas, no con borrado de datos.

**Checkpoint tras FC-07:** revisar aceptación y evidencia de las tareas acumuladas; ejecutar verificaciones aplicables y actualizar decisiones/riesgos del plan antes de ampliar el alcance.

## FC-08: Capturar apertura y reglas vigentes

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-05, FC-06.
- **Descripción:** Permitir apertura balanceada y mapeos versionados con fecha efectiva y vista previa.
- **Aceptación:**
  - [ ] Apertura identifica fecha y documentos sin solapar histórico.
  - [ ] regla seleccionada queda congelada en póliza.
  - [ ] falta de cuenta/regla bloquea publicación con motivo visible.
- **Verificación:** Fixture de cambio de regla y apertura; verificación UI y pruebas de fecha efectiva.
- **Archivos previstos:** `lib/services/accounting/mapping-service.ts`, `lib/services/accounting/opening-service.ts`, `app/api/finance/accounting/settings/route.ts`, `app/dashboard/finance/settings/accounting/page.tsx`, `tests/integration/accounting/opening-mapping.test.ts`.

## FC-09: Contabilizar un gasto y su pago

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-06, FC-08.
- **Descripción:** Entregar el primer circuito completo desde gasto reconocido hasta pagos parciales confirmados.
- **Aceptación:**
  - [ ] Gasto crea obligación una sola vez.
  - [ ] pagos parciales reducen saldo y no repiten gasto.
  - [ ] pago rechazado/no confirmado no genera salida definitiva.
- **Verificación:** Mes de referencia reducido y pruebas de reintento/pago parcial; confirmar documentos vinculados.
- **Archivos previstos:** `lib/services/expense-service.ts`, `lib/services/treasury-service.ts`, `lib/services/accounting/expense-adapter.ts`, `tests/integration/accounting/expense-payment.test.ts`.

## FC-10: Recuperar contabilizaciones pendientes

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-09.
- **Descripción:** Persistir hechos en transacción con origen y procesarlos con trabajador durable; añadir diagnóstico básico.
- **Aceptación:**
  - [ ] Caída después de guardar origen no pierde hecho.
  - [ ] concurrencia/reintentos producen una póliza por clave y versión.
  - [ ] pendientes muestran edad/error y reproceso respeta cierre.
- **Verificación:** Inyectar caída y reinicio, dos trabajadores y fallo de red; comprobar recuperación e idempotencia en base.
- **Archivos previstos:** `lib/services/accounting/event-service.ts`, `lib/inngest/functions/accounting-post.ts`, `app/api/inngest/route.ts`, `app/api/finance/accounting/pending/route.ts`, `tests/integration/accounting/recovery.test.ts`.

**Checkpoint tras FC-10:** revisar aceptación y evidencia de las tareas acumuladas; ejecutar verificaciones aplicables y actualizar decisiones/riesgos del plan antes de ampliar el alcance.

## FC-11: Contabilizar ventas desde fuente canónica

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-01, FC-08, FC-10.
- **Descripción:** Integrar ventas, devoluciones y su separación entre efectivo y cuentas por liquidar.
- **Aceptación:**
  - [ ] Corte y tickets superpuestos no duplican ingreso.
  - [ ] impuestos/propinas/descuentos documentados se separan según matriz.
  - [ ] devolución/corrección genera reversa o hecho vinculado según política.
- **Verificación:** Casos de tickets/corte repetidos, devolución y cambio de fecha de negocio.
- **Archivos previstos:** `lib/services/accounting/sales-adapter.ts`, `<servicio-canónico-de-ventas-definido-en-FC-01>`, `tests/integration/accounting/sales.test.ts`.

## FC-12: Vincular liquidaciones y conciliación

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-10, FC-11 y dependencia bancaria verificada.
- **Descripción:** Registrar liquidaciones con neto/comisión y enlazar conciliaciones confirmadas existentes.
- **Aceptación:**
  - [ ] Depósito liquida cuenta por cobrar sin crear otra venta.
  - [ ] comisión medida sustituye comparación estimada sin sumarla dos veces.
  - [ ] conciliación/reimportación no vuelve a contabilizar dinero.
- **Verificación:** Fixture de venta de fin de mes liquidada al siguiente; reimportación y conciliación duplicada.
- **Archivos previstos:** `lib/services/accounting/settlement-adapter.ts`, `lib/services/bank-statement-service.ts`, `<servicio-de-liquidaciones-verificado-en-FC-01>`, `tests/integration/accounting/settlements.test.ts`.

**Checkpoint tras FC-12:** revisar aceptación y evidencia de las tareas acumuladas; ejecutar verificaciones aplicables y actualizar decisiones/riesgos del plan antes de ampliar el alcance.

## FC-13: Contabilizar recepción y factura vinculada

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-08, FC-10.
- **Descripción:** Integrar adquisición de inventario con obligación y regularización posterior de factura.
- **Aceptación:**
  - [ ] Recepción y factura reconocen una sola adquisición.
  - [ ] diferencias/devoluciones tienen regla y referencia.
  - [ ] pago consume obligación existente sin repetir inventario/costo.
- **Verificación:** Pruebas recepción antes/después de factura, diferencias y pago parcial.
- **Archivos previstos:** `lib/services/accounting/purchase-adapter.ts`, `lib/services/inventory-service.ts`, `<servicio-de-facturas-verificado-en-FC-01>`, `tests/integration/accounting/purchases.test.ts`.

## FC-14: Valorar consumos y mermas

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-13.
- **Descripción:** Congelar valoración por movimiento e integrar costo de venta/merma/transferencia.
- **Aceptación:**
  - [ ] Cambiar costo actual no altera póliza histórica.
  - [ ] merma no se suma además al consumo normal.
  - [ ] transferir entre sucursales propias conserva valor y no crea venta.
- **Verificación:** Pruebas de valoración histórica, redondeo y conservación entre sucursales.
- **Archivos previstos:** `lib/services/accounting/inventory-adapter.ts`, `lib/services/food-cost-service.ts`, `lib/services/inventory-service.ts`, `tests/integration/accounting/inventory.test.ts`.

## FC-15: Integrar nómina y caja chica

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-09, FC-10.
- **Descripción:** Añadir adaptadores de nómina confirmada y caja chica con reconocimiento separado de liquidación.
- **Aceptación:**
  - [ ] Pago de nómina no repite costo reconocido.
  - [ ] reposición de caja mueve efectivo sin crear gasto.
  - [ ] operaciones con el mismo comprobante no se duplican en gastos/caja chica.
- **Verificación:** Casos de nómina estimada frente a confirmada, comprobante repetido y reposición.
- **Archivos previstos:** `lib/services/accounting/payroll-adapter.ts`, `lib/services/accounting/petty-cash-adapter.ts`, `<servicio-canónico-de-nómina-definido-en-FC-01>`, `tests/integration/accounting/payroll-petty-cash.test.ts`.

**Checkpoint tras FC-15:** revisar aceptación y evidencia de las tareas acumuladas; ejecutar verificaciones aplicables y actualizar decisiones/riesgos del plan antes de ampliar el alcance.

## FC-16: Cerrar el periodo con consistencia

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-10–15.
- **Descripción:** Extender cierre financiero y snapshots con protocolo compartido de bloqueo y versiones contables.
- **Aceptación:**
  - [ ] Publicación y cierre concurrentes no generan corte inconsistente.
  - [ ] pendientes bloqueantes impiden cierre definitivo y muestran motivo.
  - [ ] reapertura exige permiso/motivo y conserva exportaciones/versiones anteriores.
- **Verificación:** Pruebas de carrera cierre/publicación, fallo de snapshot y reapertura con/sin permiso.
- **Archivos previstos:** `lib/services/financial-period-service.ts`, `lib/services/pnl-snapshot-service.ts`, `lib/services/accounting/close-service.ts`, `lib/services/accounting/journal-service.ts`, `tests/integration/accounting/close.test.ts`.

**Checkpoint tras FC-16:** revisar aceptación y evidencia de las tareas acumuladas; ejecutar verificaciones aplicables y actualizar decisiones/riesgos del plan antes de ampliar el alcance.

## FC-17: Consultar balanza y estados contables

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-16.
- **Descripción:** Crear consultas de balanza, resultados y balance con drill-down al mayor.
- **Aceptación:**
  - [ ] Apertura más movimientos explica saldos a fecha.
  - [ ] balance incluye resultado y arrastre de ejercicios sin ajuste oculto.
  - [ ] reporte por sucursal declara partidas corporativas no asignadas.
- **Verificación:** Comparar consultas con resultados independientes del mes y cambio de ejercicio.
- **Archivos previstos:** `lib/services/accounting/report-service.ts`, `app/api/finance/accounting/reports/route.ts`, `components/finance/accounting-statements.tsx`, `app/dashboard/finance/results/accounting/page.tsx`, `tests/integration/accounting/reports.test.ts`.

## FC-18: Explicar flujo realizado y diferencias con P&L

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-12, FC-15, FC-17.
- **Descripción:** Añadir flujo realizado y puente hacia P&L operativo manteniendo proyección existente.
- **Aceptación:**
  - [ ] Flujo clasifica operación/inversión/financiamiento y excluye transferencias propias.
  - [ ] variación de efectivo coincide con apertura/cierre.
  - [ ] diferencias operativas se explican por fuente, fecha o estimación.
- **Verificación:** Comparación con fixture y recorrido UI de diferencia por liquidación del mes siguiente.
- **Archivos previstos:** `lib/services/accounting/cash-flow-service.ts`, `lib/services/accounting/pnl-bridge-service.ts`, `app/api/finance/accounting/cash-flow/route.ts`, `components/finance/accounting-cash-flow.tsx`, `tests/integration/accounting/cash-flow.test.ts`.

## FC-19: Exportar expediente del cierre

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-16–18.
- **Descripción:** Generar PDF/CSV con periodo, versión, pólizas, estados y pendientes.
- **Aceptación:**
  - [ ] Exportación reproduce totales del cierre y respeta permisos.
  - [ ] periodo, versión y cobertura aparecen en cada reporte.
  - [ ] CSV neutraliza fórmulas y archivos no filtran datos de otros ámbitos.
- **Verificación:** Comparar totales descargados, reexportar cierre antiguo y probar roles/fórmulas maliciosas.
- **Archivos previstos:** `lib/services/accounting/export-service.ts`, `app/api/finance/accounting/export/route.ts`, `components/finance/accounting-export.tsx`, `tests/integration/accounting/export.test.ts`, `tests/e2e/accounting.spec.ts`.

**Checkpoint tras FC-19:** revisar aceptación y evidencia de las tareas acumuladas; ejecutar verificaciones aplicables y actualizar decisiones/riesgos del plan antes de ampliar el alcance.

## FC-20: Activar piloto recuperable por empresa

- [ ] Completada con evidencia.
- **Tamaño:** M. **Dependencias:** FC-04, FC-19.
- **Descripción:** Configurar activación gradual, importar apertura con vista previa y documentar operación/retroceso.
- **Aceptación:**
  - [ ] Histórico no solapa apertura ni se publica sin revisión.
  - [ ] desactivar detiene nuevos eventos sin borrar evidencia.
  - [ ] backlog, fallos y diferencias pueden medirse por empresa.
- **Verificación:** Simular activación, caída, recuperación y desactivación en base aislada; revisión de checklist con responsable contable.
- **Archivos previstos:** `lib/services/accounting/activation-service.ts`, `scripts/accounting-opening-preview.ts`, `tests/integration/accounting/pilot.test.ts`, `docs/accounting-operations.md`, `tasks/finanzas-contabilidad/pilot-review.md`.

## FC-21: Validar el primer cierre del piloto

- [ ] Completada con evidencia.
- **Tamaño:** S. **Dependencias:** FC-20.
- **Descripción:** Revisar cierre de empresa piloto y evidencia técnica antes de ampliar activación.
- **Aceptación:**
  - [ ] Responsable contable valida apertura, reglas y diferencias.
  - [ ] pruebas de recuperación, aislamiento y cierre quedan registradas.
  - [ ] límites conocidos y decisión de ampliación quedan documentados.
- **Verificación:** Ejecutar comandos de §7 y revisión UI con roles; cotejar bancos/fuentes con libro mayor sin asumir que un build demuestra exactitud contable.
- **Archivos previstos:** `tasks/finanzas-contabilidad/pilot-review.md`, `docs/accounting-operations.md`.

**Checkpoint tras FC-21:** revisar aceptación y evidencia de las tareas acumuladas; ejecutar verificaciones aplicables y actualizar decisiones/riesgos del plan antes de ampliar el alcance.
