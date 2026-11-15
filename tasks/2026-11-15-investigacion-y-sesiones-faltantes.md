# Faltantes: estado investigado y reparto entre sesiones

Fecha: 2026-11-15. Documento complementario al [checklist](todo-implementacion-faltantes.md) y al [plan con criterios por ID](../plans/2026-11-11-plan-implementacion-faltantes.md). No sustituye sus dependencias ni marca tareas aceptadas.

## 1. Resultado de la investigación

La lista mezcla trabajo aceptado, código implementado sin aceptación integrada, aceptación de funciones existentes y ampliaciones todavía pendientes. Repartir todas las casillas vacías como programación nueva duplicaría avances, especialmente en ventas y contabilidad.

Base consultada: HEAD `35c5dcf3d05a4b991d60e7d8c1f10f22b433e12c` más cambios locales, incluidos archivos sin seguimiento de recuperación de ventas. Es una fotografía del árbol de trabajo, no una revisión congelada ni una certificación de producción. Se consultaron CodeGraph, servicios concretos, planes y evidencia registrada; no se ejecutaron pruebas funcionales ni consultas a bases operativas en esta investigación.

Verificación documental ejecutada en esta sesión:

```powershell
pnpm.cmd exec tsx scripts/validate-faltantes.ts
```

Resultado: exit 0, **239 filas, 86 tareas del plan, 90 hijos adicionales, 15 tareas aceptadas, cero errores**. En `execution` hay además **18 registros con código implementado y 3 en curso**. Los 15 aceptados incluyen padres y preparación: no son 15 funcionalidades completas ni permiten calcular un porcentaje del producto.

| Frente | Qué existe / qué se comprobó | Qué queda y cómo tratarlo |
|---|---|---|
| Preparación | P0-01–05 y SEC-00 aceptados en el mapa. Matriz, mapa, validador y evidencia de aislamiento existentes. | Renovar HEAD/diff y manifiesto de entornos al iniciar cada sesión. No repetir toda la preparación. |
| Identidad y consumo de ventas | INV-01.a/a1/a2, b1/b2a/b2/b3a/b3/b4a aceptados. Writer transaccional, revisiones, delta exacto, snapshot, permisos y normalización con evidencia. | Conservar esta arquitectura. Cerrar integración y aceptación de b4b/manual/bulk/smart-link/UI, c/d e INV-02. |
| Captura/importación de ventas | Adaptador, rutas y UI implementados; evidencia SQL focal y navegador con HTTP sintético. | Sesión/API/DB reales, almacenamiento durable del POS del cierre y propagación de cobertura a lectores financieros siguen pendientes según evidencia. No rehacer importador. |
| Recuperación histórica | Contrato, evidencia privada, persistencia, sujetos, atestaciones, receta histórica, fuentes y registro de propuesta implementados. `sale-recovery-review.ts` valida coherencia; `sale-recovery-proposals.ts` registra el expediente. | Falta decisión administrativa independiente, aplicación auditada/idempotente, carreras, rutas/UI y aceptación con sesión/R2 reales. Validar coherencia no ejecuta la reparación. |
| Nómina | Cálculo, festivos, propinas y FiscalAPI existentes. Se confirmó en `payroll-service.ts` que siguen `overtimePayCents: 0`, `totalDeduccionesCents: 0` y multiplicadores `0.35`. | Brecha real del cálculo. Desarrollar NOM-01/02/06; después aprobación, recibos y aceptación del proveedor. Reutilizar avances contables de snapshots y neto. |
| Banca/contabilidad | Matching de egresos/depósitos, comisiones y adaptadores existentes. El checklist contable registra FC-15–20 técnicamente completados, además de FC-01–14. | Contrastar cada criterio BAN/FIN/NOM con esa evidencia. FC-21 conserva revisión del responsable contable pendiente. No recrear libro mayor, cierre o snapshots existentes. |
| Producción/inventario | Registro transaccional con FEFO, consumos, ingredientes y costo; modelo de producción y UI existentes. | PROD-00 debe rastrear consumidores antes de ampliar stock terminado y evitar doble consumo. INV-03/04/05 vienen después de producción según el plan. La ausencia global de otras implementaciones no quedó demostrada. |
| Evidencia/auditoría/excepciones | Evidencia durable común, reglas canónicas de excepción y SLA. Hay una ampliación específica SALE_RECOVERY. | AUD-02, sujetos generales EVI-02 y acciones visibles EXC-05; aceptación SQL/job/concurrencia de EXC-01/02/03. SALE_RECOVERY no acredita factura/pago/excepción. |
| Operación/mantenimiento/delivery | Servicios, APIs, pantallas y plantillas existentes. | Abrir OPE-00 para rastrear writers antes de afirmar ausencia. Luego recurrencias, generación durable, historial, aceite, entrega de turno y disponibilidad. |
| Seguridad y validación | Arnés y políticas por algunos dominios; mapa con hijos de seguridad, perfiles y módulos. | RLS HTTP/jobs con runtime por dominio, ocho perfiles, aceptación de módulos, despliegue por lote, carga/restauración y piloto. La base preparada no acredita estos recorridos. |

## 2. Desfases que conviene resolver primero

1. **El checklist tiene historial contradictorio.** Las casillas superiores aceptan b3a/b3/b4a; filas inferiores todavía los describen con gates pendientes. El mapa y CHECKPOINT-INV-B3 tienen el cierre posterior. Conservar historial fechado y añadir estado vigente, evitando que un agente repita esos hijos.
2. **Contabilidad avanzó más que el checklist general.** Leer las secciones FC-15–21 del [checklist contable](finanzas-contabilidad/todo.md), no solo sus encabezados históricos. FC-15 tiene neto/reparto inmutable y hechos de reconocimiento/pago; FC-16 tiene cierre/versiones y P&L congelado; FC-17–19 reportes/flujo/exportación; FC-20 activación por empresa. Eso aporta base a NOM-05 y FIN-01/02, pero no acepta automáticamente sus criterios operativos.
3. **Los entornos divergen.** La documentación contable distingue `.env`, rama aislada y demo Netlify. En esta fotografía el journal local llega a **0150**. Las notas de 0137–0142 pendientes o aplicadas se refieren a entornos/fechas concretos; hay que renovar manifiesto antes de migrar. Nunca inferir despliegue desde el journal.
4. **La suite global no está acreditada sobre este árbol completo.** La evidencia final de proposals informa 47 unitarias, 25 SQL distintas, tipos/lint/build correctos, pero una suite general anterior falló por timeout del seed. FC-21 registra cinco archivos de integración heredados fallando por bootstraps desactualizados. Son pendientes de reproducción y diagnóstico, no autorización para omitir pruebas o ampliar timeouts sin causa.
5. **El mapa tiene más descomposición que las reglas del checklist.** Ya incluye hijos de SEC-05.resto e INT-02 por fuente mientras esas reglas siguen sin marcar. Verificar que cada hijo esté delimitado antes de actualizar esa documentación; no crear duplicados.

Fuentes principales: [evidencia final de propuestas](evidencia/2026-11-11/INV-01.c.recovery.proposal.service/README.md), [checkpoint del writer](evidencia/2026-11-11/CHECKPOINT-INV-B3/README.md), [UI de ventas](evidencia/2026-11-11/INV-01.b4.ui/README.md), [mapa ejecutable](mapa-implementacion-faltantes.json), [investigación anterior](../docs/2026-11-11-investigacion-plan-faltantes.md). Los conteos de pruebas de esos documentos son evidencia histórica, no ejecuciones nuevas de esta investigación.

## 3. Organización entre agentes

Usar **un agente responsable por frente**, con varias sesiones cortas para ese mismo frente. Una fila de las tablas siguientes es una sesión prevista; si supera cinco archivos o reúne entregas independientes, subdividir antes de escribir. Los IDs A1, B1, etc. son etiquetas de sesión de este documento, no nuevos IDs de aceptación del mapa.

La primera sesión **S0** integra y prepara el reparto. Después, empezar con **tres sesiones de implementación simultáneas como máximo: A, B y C**. D y E entran cuando quede capacidad. El límite es una recomendación operativa para esta máquina y los recursos compartidos, no una restricción del producto.

| Responsable | Propiedad funcional | Recursos que debe coordinar |
|---|---|---|
| S — Integración | Baseline, contratos entre frentes, revisión, manifiesto y aceptación consolidada. | Checklist general, mapa, matriz, journal/snapshots de migración, builds globales. |
| A — Ventas/stock | INV-01, recuperación histórica, INV-02; después producción y canales. | `sale-consumption-*`, `sale-recovery-*`, `sales-ingest-*`, rutas y UI de ventas. |
| B — Nómina | NOM-01/02/06/03/04, costo laboral. | `payroll-service.ts`, `labor-cost-service.ts`, FiscalAPI. Coordinar con D para NOM-05. |
| C — Auditoría/evidencia/excepciones | AUD, EVI, EXC y APR. | Auditoría común, catálogo de evidencia, excepciones y sus jobs/UI. Coordinar con A en SALE_RECOVERY. |
| D — Finanzas/banca | BAN, FIN y aceptación/reutilización FC. | Tesorería, conciliación, P&L, períodos y `accounting/*`. |
| E — Operación | OPE, mantenimiento, delivery y CMP. | Equipment, plantillas y funciones Inngest de su recorrido. |
| S + responsable del dominio | SEC, PER, VAL y OPS. | Revisar cada dominio después de su entrega; consolidar al final. |

Reglas prácticas:

- Sesiones paralelas de código en **worktrees/ramas separados**, partiendo de una base consolidada identificada. Antes hay que preservar e identificar los archivos locales existentes: un worktree nuevo desde HEAD no incluye cambios sin commit ni archivos untracked. S0 prepara esa base sin mezclar o apropiarse de cambios ajenos.
- Una sola sesión escribe cada archivo compartido. Los workers entregan cambios y resultados de su dominio; S consolida checklist/mapa/matriz en serie. Cada worker sí puede guardar evidencia en su directorio de ID.
- Esquema raíz, `drizzle/meta/_journal.json` y snapshots requieren turno exclusivo de migraciones. Trabajar primero el contrato y pruebas; al necesitar schema, reservar el turno, tomar el journal vigente y generar/revisar la migración. No reservar números ahora ni generar migraciones divergentes en paralelo.
- `payroll-service.ts` es de B; adaptadores contables y tesorería son de D. D no modifica el cálculo mientras B trabaja allí. Acuerdan contrato de snapshot/importe antes de integrarlo.
- `pnl-service.ts`, conciliación, `operating-config`, evidencia común y permisos también requieren propietario único por turno.
- PostgreSQL y storage de prueba aislados por sesión, con manifiesto. No compartir fixtures mutables de la misma sucursal. Los ensayos de commits/carreras requieren limpieza/retención explícitas, no prometer rollback total si hubo commits.
- Pruebas focales pueden correr en paralelo si sus recursos están aislados. Suite general, lint global y build corren en serie en el checkout de integración para evitar presión de memoria y diagnósticos sobre archivos a medio escribir.
- No ejecutar `db:push`, activar banderas, migrar main, desplegar ni modificar operaciones reales como consecuencia de abrir una sesión de implementación. OPS-03 trata la aplicación por lote/entorno con su autorización y evidencia correspondientes.

## 4. Sesiones iniciales: cerrar lo avanzado y construir fundamentos

| Sesión | Alcance / IDs | Dependencia y entrada | Entrega comprobable |
|---|---|---|---|
| **S0** | Renovar base y repartir propiedad; contraste documental de P0 | Árbol actual y planes bancario/contable | HEAD+diff/archivos nuevos preservados, estado vigente vs historial, manifiesto por entorno, turnos de archivos y pruebas. Validador sin errores. No acepta funcionalidad. |
| **A1** | Aceptación integrada de b4b.rls, b4b y b4.manual/bulk/smartlink/ui | Hijos a/b3/b4a aceptados; leer sus evidencias | Probar HTTP/sesión/runtime/DB: importar, repetir, corregir, anular y rollback; alcance ajeno denegado. Desglosar storage POS y cobertura financiera si requieren más cambios. Aceptar solo IDs cuyos criterios completos pasen. |
| **A2** | Decisión independiente de recuperación; hijo propuesto bajo INV-01.c.recovery | Contrato/proposals existentes; aceptación formal condicionada a INV-01.b | Servicio que carga propuesta del servidor, exige otro actor autorizado y persiste decisión ligada a hashes/estado. Denegar autoaprobación, evidencia retirada y estado obsoleto. Reutilizar persistencia/guardas. Registrar nuevo hijo antes de ejecutar. |
| **A3** | Aplicación auditada de recuperación; hijo propuesto | A2, writer y AUD-02; aceptación condicionada a dependencias originales | Revalidar fuentes/estado y aplicar una sola vez con revisión, stock y auditoría atómicos. Reintento, fallo intermedio y carreras con corrección ordinaria probados con commits runtime. No adopción silenciosa del histórico. |
| **A4** | UI/rutas reales recovery, cierre de c.races/recovery/c e INV-01.d | A1–A3 y evidencia real de sesión/storage | Recorrido completo autorizado y errores recuperables; adjuntos reales, decisión y aplicación. Cerrar padres solo con todos los hijos aceptados. |
| **A5** | INV-02: regla de consumo por receta/vigencia | INV-01.c | Venta consume insumos o elaborado de forma explícita y versionada; cambiar configuración no reinterpreta históricos. |
| **B1** | NOM-01 | P0-03 y SEC-00 | Unidad salarial/calendario/vigencias y procedencia explícitos; entradas ausentes bloquean. Inventariar compatibilidad con snapshots contables existentes. |
| **B2** | NOM-02.a | B1 | Caso independiente asistencia aprobada/falta/festivo, zona operativa y rechazo de asistencia pendiente; V1/V2. |
| **B3** | NOM-02.b | B2 | Horas extra autorizadas, duplicadas/rechazadas y cero justificado; importe y fuente comprobados. |
| **C1** | AUD-02 | P0-03 y SEC-00 | Elegir un recorrido crítico por hijo si excede alcance: motivo obligatorio y auditoría en la misma transacción; fallo de auditoría revierte la acción. Acordar API con A y D. |
| **C2** | EVI-02.a | SEC-00; coordinar catálogo con A | Añadir sujetos faltantes de factura/pago/excepción con acceso por entidad y pruebas runtime. Conservar SALE_RECOVERY y su acceso específico. |
| **C3** | EVI-02.b | C2 | Una entidad visible por sesión: cargar, consultar y retirar evidencia con permiso/alcance, persistencia y errores reales. Repetir por dominio restante. |
| **D1** | SEC-05.tesoreria → BAN-01 → BAN-04, una sesión por ID | SEC-00/P0-05 y anteriores de la cadena | Aceptar base existente con HTTP/runtime y banco/formato real anonimizado o sandbox identificado. Corregir solo fallos demostrados; no recrear matching. |
| **E1** | OPE-00 | P0-03 | Inventario de writers/jobs/rutas/UI por recorrido, qué existe y qué falta, con archivos concretos y casos. Vía de entrada para futuras sesiones E. |

A1–A5 son una secuencia del mismo frente, no cinco agentes simultáneos. A2/A3 pueden desarrollar brechas conocidas con estados pendientes, como ya ocurrió con recovery; no marcar aceptación mientras INV-01.b u otras dependencias permanezcan abiertas.

## 5. Sesiones siguientes por frente

Cada ID de esta tabla es una sesión independiente por defecto; la flecha expresa orden. Dependencias cruzadas se resuelven con integración aceptada, no con que otra sesión haya empezado.

| Frente | Secuencia de sesiones | Condición de entrada / criterio de salida |
|---|---|---|
| Nómina: conceptos | NOM-02.c1, c2, d1, d2, d3; después e | Cada uno depende de NOM-02.a; e además de NOM-01/d2. Un concepto por sesión con casos/oráculo y fuentes vigentes. Un único integrador de `payroll-service.ts`. |
| Nómina: aprobación | NOM-06 → NOM-03 → NOM-04.a → NOM-04.b | NOM-06 espera todos los conceptos del plan. Snapshot de cálculo aprobado distingue su función del snapshot contable de recibos ya timbrados. Recibo/CFDI/exportación usan la misma versión. FiscalAPI se acepta aparte en sandbox. |
| Nómina: pago | NOM-05 | NOM-04.a y BAN-04. B+D contrastan el neto, snapshots y hechos de FC-15; implementar únicamente el hueco entre aprobación calculada y obligación/pago. No crear otro pasivo por el mismo recibo. |
| Excepciones | EXC-01 → EXC-02 → EXC-03.a → EXC-03.b | EXC-01 requiere SEC-00; EXC-03.a también AUD-02. Aceptar persistencia/sync, carreras y recuperación del job existente. |
| Excepciones: UI/casos | EXC-05; EXC-04.presupuesto/ausencia/merma/banco | UI tras EXC-02/03.a; casos tras EXC-03.b. Ausencia espera NOM-02.a; merma INV-04; banco BAN-04/BAN-06.a. Una excepción por sesión. |
| Aprobaciones | APR-01.compra/factura/gasto/pago/nomina | AUD-02, NOM-03 y BAN-04 según mapa actual. Un documento por sesión, segregación y concurrencia. No saltar dependencias heredadas sin revisión del plan/mapa. |
| Producción | PROD-00 → PROD-01.a → PROD-01.b → PROD-02 | PROD-00 espera INV-02. Rastrear relación receta/elaborado/SKU, luego lote terminado y venta sin doble descuento, conservando FEFO/costo/transacción. |
| Lotes históricos | REC-03A → REC-03B | REC-03A depende de P0-04/SEC-00; REC-03B también de AUD-02. Protocolo de corrección con evidencia; no mezclar con reescritura automática de históricos. |
| Conteos y costos | INV-03 → INV-04; INV-05 después de INV-03 | INV-03 espera PROD-02/AUD-02. Revisión y ajuste trazables; costos/varianza congelados; PAR y snapshots aceptados con runtime/UI. |
| Depósitos | BAN-05 → BAN-06.a → BAN-06.b | BAN-05 espera BAN-01 e INV-01.c. BAN-06.a también P0-05; b también AUD-02. Reutilizar FC-12 y definir corrección compensatoria de hecho contabilizado. |
| Comisiones y caja | FIN-06.a → FIN-06.b; FIN-01 | FIN-06.a espera BAN-06.a; b también BAN-06.b. FIN-01 espera BAN-04/BAN-06.a. Importe reportado, conciliación y proyección conservan significados distintos; contrastar FC-18. |
| Cierre/centros | FIN-02.a → FIN-03.a → FIN-03.b; FIN-05 | FIN-02.a depende de P0-03/AUD-02. Contrastar FC-16 y modelos actuales; FIN-05 espera FIN-02.a. Centros, periodos e imputación prueban totales sin repartir importes arbitrariamente. |
| Pagos/histórico | FIN-04; FIN-02.b | FIN-04 espera BAN-04/APR-01. FIN-02.b espera FIN-02.a/03.b, INV-04, NOM-05 y FIN-06.b. Aceptar snapshot histórico completo, no solo el mecanismo de cierre ya existente. |
| Indicadores | FIN-07.ticket/prime-cost/contribucion/unit-economics | FIN-02.b. Un indicador por sesión: fórmula, unidad, base, cobertura y oráculo. |
| Canales | INT-01 → INT-02.pos/uber/rappi/didi/otros → INT-03 | INT-01 espera INV-02; cada INT-02 también INV-01.d. Solo fuentes disponibles; INT-03 espera INT-02 y FIN-06.b. Repetición/corrección no duplica ingresos ni consumo. |
| Mantenimiento | OPE-01.a → OPE-01.b → OPE-02 | OPE-00 y SEC-00 para a. Configuración visible → generación durable/idempotente → historial. Integrar con patrones Inngest del repo. |
| Rutinas/operación | OPE-03.aceite/cocina/salon/gerente/handoff; OPE-04 | OPE-00. Una rutina por sesión; cocina/salón/gerente son aceptación de base. Delivery empieza manual con historial; no presume integración remota. |
| Cumplimiento | CMP-01 | OPE-00, EXC-03.a y EVI-02.b. Cerrar plan correctivo con historial y evidencia por acción. |
| Seguridad | SEC-05.inventario; SEC-05.nomina; hijos SEC-05.resto | Inventario espera INV-01.c; nómina NOM-03; resto espera los tres dominios principales según mapa. Un dominio/tablas por sesión, HTTP/jobs y NOBYPASSRLS. Seguridad se prueba también durante cada implementación. |
| Perfiles/módulos | PER-01 por perfil; VAL-01.M01-M17 por módulo | Respetar todas las dependencias materializadas por fila; no basta P0-03. Probar permitidos y denegados, normal/vacío/error. |
| Cierre operativo | VAL-01.transversal por caso; OPS-03 por lote; VAL-02 por carga/restauración/piloto; VAL-03 | OPS-03 acompaña lotes aceptados y autorizados, no necesita esperar todo el producto. Piloto y cierre final esperan sus dependencias; pendientes externos explícitos. |

## 6. Prompt reutilizable para cada sesión

Copiar este bloque y añadir una de las asignaciones de abajo. Sirve tanto para otro agente como para una nueva conversación con el mismo agente.

```text
Trabaja en C:\Users\david\pulso29 siguiendo AGENTS.md.
Lee tasks/2026-11-15-investigacion-y-sesiones-faltantes.md,
tasks/todo-implementacion-faltantes.md, el criterio de mis IDs en
plans/2026-11-11-plan-implementacion-faltantes.md y sus entradas del mapa.
Consulta CodeGraph para estructura y lee la evidencia vigente antes de programar.

Sesión: [etiqueta]. IDs: [IDs]. Objetivo: [entrega].
Base acordada: [commit/worktree]. Propietario: [responsable].
Archivos permitidos: [lista concreta, fijarla tras inspección antes de editar].
Dependencias ya aceptadas: [IDs + evidencia]. Pendientes: [IDs].

Contrasta lo existente y reutilízalo. Ejecuta un solo hijo verificable por vez;
divide si supera cinco archivos, contando pruebas y metadatos de migración.
No edites archivos de otros frentes. Coordina schema/journal/snapshots y contratos
compartidos con la sesión de integración antes de escribir en ellos.
No apliques migraciones a entornos operativos ni despliegues desde esta asignación.

Prueba caso normal, vacío y error, permisos/empresa/sucursal e idempotencia;
V2/V3 según el plan, con entorno aislado identificado. Ejecuta tipos/lint focales.
Entrega evidencia por ID con HEAD/diff, comandos/exit, casos y límites, además de
los cambios necesarios de mapa/checklist/matriz para que integración los consolide.
No marques aceptado por tener código o mocks. Conserva dependencias pendientes.
Al terminar deja el siguiente paso preciso y no abras otro frente.
```

Asignaciones iniciales que se añaden al prompt:

- **S0:** «Solo prepara la base y el reparto. Reconcilia el estado vigente del checklist con el mapa, CHECKPOINT-INV-B3 y FC-15–21; registra pendientes globales y manifiesto de entornos. Preserva cambios concurrentes. No implementes lógica ni ejecutes migraciones. Devuelve la base reproducible y archivos asignados a A1/B1/C1.»
- **A1:** «Cierra el recorrido integrado de captura/importación existente bajo INV-01.b4. Empieza por inventariar qué pruebas son reales y cuáles usan HTTP/auth/storage sintéticos. Implementa solo brechas demostradas y subdivide por frontera. No rehagas writer/parser ni empieces todavía una nueva reparación histórica.»
- **B1:** «Implementa NOM-01: contrato salarial/vigencias/calendario y entradas faltantes. Lee también FC-15 y lib/treasury/payroll-snapshot.ts para conservar compatibilidad. Todavía no implementes todos los impuestos ni cambies tesorería. Verifica que cambios salariales posteriores no alteren un período congelado.»
- **C1:** «Implementa AUD-02 empezando por inventariar callers críticos y elegir el primer hijo acotado. Asegura motivo y auditoría obligatoria en la misma transacción. Publica el contrato que A3 y D necesitarán, preservando los usos no críticos existentes.»
- **D1, al quedar capacidad:** «Contrasta SEC-05.tesoreria/BAN-01/BAN-04 con el circuito bancario y FC-12–20. Acepta un ID por vez con permisos/runtime/API reales. Separa pendientes del banco y del responsable contable; no recrees adaptadores ni cierres existentes.»
- **E1, al quedar capacidad:** «Ejecuta solo OPE-00: rastrea writers/jobs/UI de recurrencias, mantenimiento, aceite, rutinas, entrega de turno y delivery. Entrega hallazgos y archivos/casos para una sesión por recorrido. No declares ausente lo que solo no estaba listado.»

## 7. Entrega entre sesiones y aceptación

Cada sesión deja: ID, base/diff, archivos propios, qué reutilizó, qué cambió, comando y exit de cada prueba, entorno/rol, evidencia, pendientes y próximo hijo. No registrar credenciales ni contenidos privados. Si el entorno falta, conservar ese nivel de aceptación pendiente y avanzar solo trabajo independiente.

S revisa cada 2–3 hijos integrados: conflictos/contratos, pruebas del recorrido, tipos/lint y trazabilidad. Al cerrar hito ejecuta build; V2/V3 antes de aceptación. Reproduce el timeout del seed y los cinco bootstraps contables fallidos por separado; no modificar sus umbrales ni excluirlos para obtener verde.

Solo S consolida las casillas/matriz/mapa tras revisar evidencia, respetando el contrato de aceptación original. El validador demuestra integridad documental, no corrección fiscal, cobertura operativa o despliegue. Las fuentes fiscales/laborales oficiales y vigencias se investigan en las sesiones NOM correspondientes; esta planificación no fija fórmulas legales.

Esta investigación únicamente añade este documento. No cambia servicios, migraciones, banderas ni estados funcionales del checklist. El primer paso recomendado es **S0**, seguido de **A1 + B1 + C1** en sesiones separadas.
