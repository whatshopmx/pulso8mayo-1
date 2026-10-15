# Handoff — Conexión entre frontend y backend

**Actualizado:** 2026-10-15 · **Plan:** `tasks/plan-conexion-frontend-backend.md` · **Seguimiento:** `tasks/todo-conexion-frontend-backend.md`

Este documento es para empezar una sesión nueva sin releer veinte archivos. **Las fuentes de verdad siguen siendo el plan y el seguimiento**; esto es el atajo, y su contenido caduca en cuanto avanza el plan.

---

## 1. Dónde está todo y en qué orden leerlo

| Orden | Archivo | Qué aporta |
| --- | --- | --- |
| 1 | `tasks/todo-conexion-frontend-backend.md` | Estado real, una fila por tarea con evidencia y límites. **La fila de C25 es el siguiente paso.** |
| 2 | `tasks/plan-conexion-frontend-backend.md` | Criterios de aceptación, dependencias y verificación de C24–C40 |
| 3 | `docs/audits/2026-10-10-backend-frontend-wiring-audit.md` | Hallazgos H01–H12 que el plan tiene que cerrar |
| 4 | `lib/company/operating-policy-catalog.ts` | Catálogo de C15: clasificación, consumidor, aplicación y decisión pendiente de las trece entradas. Es la fuente que C16–C23 consumen, y su prueba falla si una política deja de ser lo que dice. |

## 2. Estado al handing-off

**C00–C26 completadas. C27–C40 pendientes.** La última línea implementada y verificada es C26 (compuerta autoritativa de confianza mínima en veredictos de IA, bloqueo de autoaprobación indebida en calidad/seguridad cuando confianza < minConfidence, 22 pruebas unitarias en `verification-verdict.test.ts` y 5 comprobaciones en Neon Postgres viva con `verify-workflow-verdict.ts`). Siguen sin commitear los archivos de `stock-count` y `workflows/[id]/execute`, que son de otra línea de trabajo.

```
C26 compuerta de confianza mínima en veredictos de IA (calidad o seguridad favorables nunca autoaprueban si confianza < minConfidence; códigos estructurados de veredicto; 22 unitarias y 5 comprobaciones Neon viva)
C25 transmisión efectiva de aiConfig jerárquica con Cloudflare Workers AI, Moondream y OpenAI con fallback simétrico (13 unitarias de política, 7 de servicio, 2 Playwright y 5 comprobaciones Neon)
C24 validación autoritativa de contrato de paso en servidor (tipos, límites, evidencia, transiciones terminales 409 y omisión SKIPPED exclusiva de supervisor con justificación obligatoria en HTTP 403/400; 32 unitarias puras, 3 navegador Playwright y 7 comprobaciones Neon)
C23 límite de caja chica tripartito (fondo corporativo vs gasto físico vs aprobación de gastos), validación en servicio de apertura/reposición/retiro, catálogo C15 en aplicada, preservación de fondos existentes (18 unitarias, 75 navegador, 16 comprobaciones Neon)
C22.4 recorrido y reglas en Neon con dos empresas, validación de franquicias, contradicción en grupo propio y alcance del actor (23 comprobaciones)
C22.3 vista de la Liga de Sucursales en Chromium con redes, promedios, anomalías etiquetadas y avisos de alcance (3 pruebas aisladas)
C22.2 tenantType aplicado en CrossBranchService y catálogo C15; huella de alcance en clave de caché
C22.1 propiedad de sucursal en contrato Zod, BranchService y pantalla de detalle
C21 payrollDispersion permanece descriptiva con contrato honesto; timbrado real ejercitado contra el sandbox de FiscalAPI con personas de prueba del SAT (25 comprobaciones Neon + sandbox)
C20.4 recorrido del servicio contra Neon con dos empresas, escalada a OWNER en ALTA, auto-aprobación prohibida y dinamismo en caliente
C20.3 comprobación en navegador aislado de insignia «Se aplica hoy», descripciones precisas, persistencia y evaluación cliente
C20.2 integración autoritativa en expense-service y catálogo actualizado de pendiente a aplicada
C20.1 implementación pura en rolExigidoPorMonto y 26 pruebas de matriz (ALTA, MEDIA, BAJA)
C19.5 recorrido del servicio contra Neon con dos empresas, concurrencia de altas y layout SPEI
C19.4 el modal excluye facturas/gastos/nómina ya retenidos, soporta lote parcial y refresco de pestañas
C19.3 bloqueo transaccional con FOR UPDATE en alta de partidas (sin carrera)
C19.2 una obligación, una sola vez (puedeAgendar en lib/treasury/scheduling-policy.ts)
C19.1 supplierPayment sigue descriptiva con contrato honesto en el catálogo
```

Puertas de fase cerradas: Fase 0, Fase 1, Fase 2 (12-10-2026) y **Fase 3** (15-10-2026). La Fase 4 está en curso con C24 completada y verificada; la siguiente es C25 (transmitir configuración de IA a la ejecución).

## 3. Lo que NO está verificado — no dar por hecho

Este es el apartado que más caro sale perder. Las tareas están marcadas, pero cada una arrastra límites explícitos:

| Tarea | Límite abierto |
| --- | --- |
| C04, C05 | El recorrido ejecutar/revisar de workflows nunca se probó en navegador. C05 además tiene una **decisión de negocio pendiente**: quién revisa un workflow (hoy `requireReviewAccess` aplica la lectura conservadora del esquema: `SUPERVISOR`+) y falta la pantalla que concede la auto-revisión por excepción. |
| C08 | El planificador nunca se probó en navegador: crear, recargar y comprobar persistencia en dos empresas. Es lo único que verificaría que pantalla y servidor cuentan la misma historia. |
| C09 | El botón de excepción de `MAX_DAILY_HOURS` nunca se probó en navegador desde su propia pantalla. |
| C13, C14 | Las pruebas de navegador interceptan `GET`/`PUT` con respuestas simuladas: **no hay V2 con Next, autenticación ni Postgres** para la pantalla de configuración. La autorización queda cubierta por pruebas unitarias sobre la ruta real. |
| C14.2 | El historial de cambios se escribe, pero **no hay pantalla para consultarlo**, y su escritura es de mejor esfuerzo: si falla, no rompe el guardado. |
| C14.3 | `getPnLSnapshots` **no tiene consumidores**. La vigencia por fecha ya impide reescribir el pasado en los cálculos, pero el P&L congelado al cerrar sigue siendo un archivo que ninguna vista lee. Conectarlo es de C29–C31. |
| C15 | La comprobación del catálogo es **textual**: comprueba que cada política aplicada nombre un símbolo declarado y que las descriptivas no aparezcan fuera de las rutas exentas. No pasa el valor por su consumidor —no hay efecto nuevo que pasar, C15 no aplica nada— y no detecta accesos dinámicos. El riesgo que queda: si un servicio deja de leer un umbral, la prueba de «aplicada» sigue verde hasta que alguien actualice el catálogo a mano. |
| C16.1 | Las cuatro pruebas de navegador interceptan `api/approval-matrix`; la matriz se guarda contra respuestas simuladas, sin Postgres. Lo que sí quedó comprobado contra el código real es que la promesa corregida es cierta: `validateMatrixRules` emite «quedarán sin cadena y no podrán enviarse» y `purchase-order-service` rechaza con «El monto no está cubierto por la matriz de autorización». C16.3 tiene que verificar el recorrido con dos empresas. |
| C16.2 | **El recorrido se verificó contra la base real en C16.3**, pero por servicio: llamadas directas a `PurchaseOrderService`, sin capa HTTP ni sesión. Nadie ha visto el 403 al emitir en una pantalla, y el recorrido de compras no tiene V2 con Next y autenticación. |
| C16.2 | `scripts/verify-purchase-delegation.ts` **siembra y borra en la base compartida de Neon.** Los nombres llevan la marca `C16.3 verificación` y la limpieza va en un `finally`, pero una interrupción deja empresas de prueba que el script no alcanza a borrar: hay que limpiarlas a mano. El orden importa —los controles se borran antes que la empresa por la FK— y ya costó un intento. |
| C16.2 | La categoría del artículo es texto libre (`inventory_items.category`), así que las reglas por categoría comparan texto normalizado y un artículo sin categoría no queda cubierto. Si el negocio quiere un catálogo de categorías, es otra tarea. |
| C16.2 | Al aplicar el control se cerraron huecos previos de este recorrido: las transiciones buscaban la orden sólo por id y crear aceptaba sucursal, proveedor, solicitud y artículos del cuerpo sin comprobarlos. Quien mantenga ese recorrido debe seguir pasando `companyId` y el rol del actor: los parámetros son obligatorios, no opcionales, a propósito. |
| C17 | **Sin V2 de la pantalla de producción**: el recorrido en navegador es el de transferencias. La de producción queda en unitarias sobre la ruta y el servicio reales. |
| C17.3 | El navegador intercepta la API: demuestra que el motivo llega a la pantalla y que la pantalla ofrece el lado correcto, no que el 403 lo produzca el servidor en una sesión real. |
| C17.3 | **No hay responsabilidades configurables para transferencias.** Quien tenga `inventory:update` y vea toda la empresa opera en cualquier sucursal de su empresa; para los roles con sucursal asignada, su sucursal tiene que ser el lado de la acción. Provisional, a diferencia de C16.2. |
| C17.4 | `scripts/verify-food-production-scope.ts` **siembra y borra en la base compartida de Neon.** Nombres con la marca `C17.4 verificación` y limpieza en `finally`; una interrupción deja empresas de prueba para borrar a mano. |
| C17.4 | El resto de rutas de producción (hoja diaria, sugerencias, tiempos de retención) no se tocaron: entran por sus propias rutas con consumidores ya acotados. Revisarlas es otro trabajo. |
| C18 | **El V2 no ejecuta autenticación**: el rol lo inyecta la página de prueba y la API responde lo que cada caso enruta. Lo que demuestra es que la pantalla ofrece lo que el servidor autoriza, no que el servidor lo rechace en una sesión real. |
| C18 | `lib/services/__tests__/treasury-disbursement.test.ts` **reimplementa la lógica dentro del test** (doble firma y CLABE) y no toca el servicio: su verde no dice nada. No se corrigió en C18. |
| C18 | El botón de la pantalla depende del rol que `/api/auth/get-session` devuelve. Con sesión desfasada puede aparecer activo y el servidor lo rechaza con 403: el filtro que vale es el del servidor. |
| C18.4 | `tests/layout-dispersion.spec.ts` usa `generateBankDisbursementLayout`, que ahora exige `actorRole`. Se actualizó para pasar `"ADMIN"` y **no se ejecutó** (configuración de Playwright con base real). |
| C24 | La pantalla de ejecución en Playwright (`WorkflowExecutor`) simula la cámara (`navigator.mediaDevices` stub con canvas); la captura real de fotos en hardware físico depende del navegador móvil del operador. |

## 4. Estado de la base de datos

Migraciones aplicadas en esta sesión, todas aditivas y verificadas contra la base real:

| Migración | Qué hace | Estado |
| --- | --- | --- |
| `0092_remarkable_ben_urich` | Tabla `policy_overrides` (excepciones auditadas, de C09) | **Estaba generada en el repo pero nunca aplicada.** Aplicada en esta sesión. Antes, la excepción de jornada de 8 h habría fallado en runtime con *relation does not exist*; las unitarias no lo detectan porque simulan `db`. |
| `0093_slippery_meggan` | Tabla `config_change_logs` (actor y valor anterior/nuevo por campo) | Creada y aplicada |
| `0094_minor_jasper_sitwell` | Índice `(company_id, field_name, performed_at)` para la vigencia | Creado y aplicado |

**Cómo funciona `db:migrate` aquí, y por qué hay que mirarlo antes de correrlo.** Drizzle decide comparando `lastDbMigration.created_at` contra el campo `when` de cada entrada del journal: aplica **todas** las entradas con `when` mayor, sin mirar hashes. En esta base eso es seguro, pero conviene comprobarlo antes de cada corrida:

```bash
node -e "const j=require('./drizzle/meta/_journal.json');
console.log('se aplicarían:', j.entries.filter(e=>e.when>ULTIMO_CREATED_AT).map(e=>e.tag))"
```

Doce entradas del journal tienen hash distinto al registrado en la base (0000–0008, 0040, 0083) pero **sus efectos ya están aplicados** — se verificó tabla por tabla. No son pendientes: su `when` es anterior al último `created_at` registrado.

**Nunca uses `db:push`** en este proyecto: puede borrar tablas (dice `AGENTS.md`) y aquí la base es Neon compartida.

## 5. Cómo se trabaja en este plan

El plan define cuatro verificaciones. Cada tarea declara cuál usa:

| Clave | Qué es | Cómo corre |
| --- | --- | --- |
| **V0** | Línea base y puertas de fase | `pnpm run lint` · `pnpm run build` · `pnpm run test:unit` |
| **V1** | Contrato, integración o regla | `pnpm exec vitest run tests/unit/<área>/` |
| **V2** | Recorrido en navegador | `pnpm exec playwright test --config tests/playwright-shifts.config.ts` (UI aislada, sin Next ni DB) |
| **V3** | Fallos y concurrencia | Pruebas enfocadas con adaptadores simulados |

**Dos configs de Playwright, no confundir:**
- `tests/playwright-shifts.config.ts` → UI aislada. Arranca un servidor Vite de pruebas con módulos reales y stubs para acciones, auth y DB. Es la que se usa para turnos y configuración. **No requiere Next, autenticación ni Postgres.**
- `playwright.config.ts` (el de `pnpm test:e2e`) → specs que sí usan la base real y necesitan `auth.setup`. Más lento y frágil; no se usó en esta sesión.

**Línea base actual (15-10-2026, tras C24):** `test:unit` 1276 aprobadas / 1 omitida / 1 TODO (95 archivos) · `lint` 0 errores (2412 warnings, todos preexistentes) · `build` exitoso y `tsc --noEmit` limpio. Las pruebas añadidas por C24 (32 unitarias) más C22 y C23 explican el incremento desde las 1190 de C21.

**Reglas del plan que se incumplen fácil:**
- Una tarea que pase de cinco archivos **se divide en subtareas antes de implementar**, no después (C14 se dividió en C14.1–C14.3 así).
- Una tarea no se marca porque compile: hace falta evidencia. "No ejecutado" se registra como tal.
- Cada evidencia va en `docs/audits/AAAA-MM-DD-<nombre>.md` y se enlaza desde el seguimiento.

## 6. Errores que cometé en esta sesión — no repetirlos

1. **Caracteres corruptos en comentarios.** Al escribir en español aparecieron varias veces fragmentos CJK (`先用`, `修了`, `mes-navigation`, `Ssostiene`) dentro de comentarios y documentos. Son discretos y sobreviven al build. **Revisar antes de commitear:**
   ```bash
   LC_ALL=C grep -rnP '[\x{4e00}-\x{9fff}]' <archivos modificados>
   ```
2. **`db.insert` mock mal misunderstood.** `db.insert(tabla)` y `.values(filas)` son llamadas distintas: para inspeccionar las filas hay que capturar el argumento de `.values()`, no el de `insert()`. Con `mockImplementation` acumulando en un array quedó claro.
3. **El orden de las filas no es el del cuerpo.** `schema.parse()` devuelve las claves en el orden del *shape* del esquema, no del JSON enviado. Comparar con `toEqual([...])` da falsos fallos: comparar por campo.
4. **Mocks que ignoran filtros SQL.** Un mock de `db.select` que devuelve todo hace pasar una prueba cuya lógica real filtra por fecha. Hay que simular también el filtro.
5. **`toHaveAccessibleDescription` es exacto.** Si el `aria-describedby` une hint y error, la descripción completa no coincide con ninguno de los dos.
6. **Dos líneas de trabajo en el mismo árbol.** La sesión del 13-10 encontró C15 y C16.1 a medias junto con los archivos sin commitear de `stock-count`. Para que cada commit quede verde por sí solo: recortar el spec compartido a los casos de la tarea, `git stash push -u -- <rutas de la otra tarea>`, ejecutar, commitear y restaurar con `git stash pop`. Es lo que separa `c153cc7` (C15) de `3b0742d` (C16.1) sin que ninguno dependa del otro.
7. **Un alias en el servidor de pruebas rompe pantallas que no eran del caso.** Sustituir `@/hooks/queries/use-branches` globalmente dejó sin sucursales a la pantalla de configuración de C16 y sus dos pruebas se colgaron sin explicación. El arreglo: no sustituir el hook real —enrutar `/api/branches` como ya se hacía— y hacer que el contexto de sucursal tenga valor por defecto en vez de fallar. Y cada dependencia nueva que aparezca se declara en `optimizeDeps`, porque Vite optimiza lo que descubre y la recarga que provoca se lleva por delante los tests que estaban corriendo.
8. **Un `useMemo` después de una salida temprana rompe la pantalla en silencio.** Los hooks nuevos tienen que ir antes del `if (isLoading) return <Skeleton/>`: React avisa «Rendered more hooks than during the previous render» y la pantalla queda en blanco. El mensaje sale en consola, no como error de la prueba, así que hay que leer los `pageerror` del V2.
9. **Un comentario puede romper la prueba del catálogo.** `tests/unit/company/operating-policy-catalog.test.ts` falla si una política `descriptiva` aparece nombrada en cualquier archivo de `lib/` o `app/` fuera de la lista blanca. Explicar *por qué* la política no se conecta exige decirlo sin escribir su nombre; la explicación se queda en el catálogo y en la evidencia.
10. **El texto corregido se contrasta contra el código, no contra el nombre.** La vieja promesa de la matriz —«los montos en un hueco usarán la cadena predeterminada»— era falsa: `validateMatrixRules` avisa «quedarán sin cadena y no podrán enviarse» y `purchase-order-service` rechaza con «El monto no está cubierto por la matriz de autorización». La nueva copió esas dos frases, no la intención.

## 7. Decisiones ya tomadas (no reabrir sin evidencia nueva)

| Decisión | Fecha | Dónde |
| --- | --- | --- |
| La jornada de 8 h bloquea; la salida es excepción auditada | 10-10 | `a449b16`, `6134b90`, `41232a4` |
| Aplicación de plantillas de turnos por elemento, no todo-o-nada | 11-10 | Evidencia de C11 |
| Los parámetros se aplican con el **valor vigente al cierre** del periodo | 12-10 | `3274d38` |
| Los objetivos de semáforo y umbrales no tienen vigencia a propósito | 12-10 | Evidencia de C14.3 |
| El historial de configuración es de mejor esfuerzo, nunca rompe el guardado | 12-10 | Evidencia de C14.2 |
| Cada política se clasifica por lo que el código hace hoy; `managerAutonomy` y `tenantType` quedan `pendiente`, no `descriptiva` | 13-10 | Evidencia de C15 |
| Los responsables de comprar se configuran de forma explícita; la modalidad no concede permisos | 13-10 | Evidencia de C16.2 |
| Sin reglas de delegación no hay control adicional (decide el permiso vigente), no una puerta abierta | 13-10 | Evidencia de C16.2 |
| Los montos no forman parte de los controles de solicitud y emisión: son de la matriz y de C20 | 13-10 | Evidencia de C16.2 |
| Sin ninguna regla, una sucursal conserva el comportamiento previo; con reglas pero sin cobertura se rechaza nombrando la sucursal | 13-10 | C16.3 contra la base real |
| Con varias reglas que cubren, gana la más permisiva que el actor alcance; la diferencia avisa, no bloquea | 13-10 | Evidencia de C16.2 |
| `foodProduction` sigue descriptiva: no hay cocinas designadas | 13-10 | Evidencia de C17 |
| El alcance del recorrido de producción y transferencias sí se aplica (empresa, sucursal, receta, artículos, lotes) | 13-10 | Evidencia de C17 |
| La transferencia la ejecuta el lado que muestra la interfaz: destino aprueba o rechaza, origen envía, destino recibe | 13-10 | Evidencia de C17.3 |
| Lote de otra sucursal en producción = se rechaza; lote inexistente = faltante (merma por lote insuficiente) | 13-10 | Evidencia de C17 |
| Sin responsables configurables, `inventory:update` + empresa completa decide en transferencias | 13-10 | Evidencia de C17.3 |
| El filtro de rol de la operación de tesorería vive en el servicio, con `actorRole` obligatorio | 13-10 | Evidencia de C18.2 |
| El filtro se comprueba antes que la máquina de estados: 403 = permisos, 400 = estado | 13-10 | Evidencia de C18.2 |
| El botón que el servidor va a rechazar se desactiva con el motivo, no desaparece | 13-10 | Evidencia de C18.3 |
| Endurecer el filtro no reescribe una corrida ya autorizada ni reabre una cerrada | 13-10 | Evidencia de C18.4 |
| Una obligación se agenda una sola vez y mientras deba pagarse (bloqueo transaccional FOR UPDATE) | 14-10 | Evidencia de C19 |
| La autonomía del gerente (`managerAutonomy`) se aplica en `rolExigidoPorMonto` y `expense-service`: BAJA centraliza en ADMIN, ALTA faculta al gerente hasta el umbral de dueño, MEDIA aplica límite monetario; umbral de dueño y segregación (A16) prioritarios | 14-10 | Evidencia de C20 |
| `payrollDispersion` permanece descriptiva: el producto no ejecuta dispersión bancaria autónoma; la tesorería genera el layout manual | 14-10 | Evidencia de C21 |
| `tenantType` segmenta la Liga de Sucursales en redes (propias vs franquicias) y expone contradicciones; visibilidad por `branchVisibilityFilter` | 15-10 | Evidencia de C22 |
| `pettyCashLimitCents` fija el tope corporativo del fondo fijo de caja chica; salidas limitadas por saldo físico; aprobaciones por matriz de gastos | 15-10 | Evidencia de C23 |
| El contrato del paso valida tipo, valor, rango y evidencia antes de persistir; SKIPPED exige rol SUPERVISOR+ y justificación obligatoria; instancia terminal bloquea modificaciones con WORKFLOW_TERMINAL (409) | 15-10 | Evidencia de C24 (`docs/audits/2026-10-15-workflow-step-contract.md`) |
| Transmisión efectiva de `aiConfig` con Cloudflare Workers AI (`@cf/meta/llama-3.2-11b-vision-instruct`), Moondream y OpenAI; fallback simétrico, reintentos acotados (0–5), sanitización de credenciales y gate de privilegios en Builder | 15-10 | Evidencia de C25 (`docs/audits/2026-10-15-workflow-ai-config.md`) |
| Compuerta autoritativa de confianza mínima: calidad o seguridad favorables nunca autoaprueban si confianza < minConfidence (`CONFIDENCE_BELOW_MINIMUM`, `requiresManualReview: true`); veredictos estructurados y punto frontera exacto determinista (0.85 === 0.85) | 15-10 | Evidencia de C26 (`docs/audits/2026-10-15-workflow-verdict-confidence.md`) |

**Pendientes de decisión** (condicionan C27–C28, no bloquean el trabajo): quién revisa un workflow (lectura conservadora `SUPERVISOR`+ vigente); horario, urgencias y zona horaria de notificaciones; consumidores externos del executor anterior.

## 8. Siguiente paso — C27

**C26 quedó completa y verificada (V1 y V3 contra Neon Postgres viva).** La compuerta de confianza mínima opera de manera estricta y autoritativa en `evaluateVerificationVerdict` (`lib/workflows/verification-verdict-policy.ts`) y `VerificationEngine.evaluate`, asignando códigos canónicos de veredicto e impidiendo que una calidad o seguridad favorable autoapruebe cuando no se cumple la confianza requerida.

C27 continúa la **Fase 4 — Workflows y verificación**.
Objetivo: **Hacer única la transición de finalización** (H10).
- Garantizar que la transición a estado `COMPLETED` en una instancia de workflow sea estrictamente idempotente y atómica, impidiendo que ejecuciones concurrentes o reintentos dupliquen acciones posteriores (disparo de incidentes, notificaciones o deducciones de inventario).
- Criterios:
  1. La transición a `COMPLETED` se ejecuta una sola vez por instancia (`pg_advisory_xact_lock` o condición de estado atómica `status != 'COMPLETED'`).
  2. Solicitudes duplicadas o concurrentes reciben respuesta idempotente sin reinvocar hooks ni acciones de terminación.
  3. Los efectos secundarios de finalización quedan registrados de manera trazable.

## 9. Fase 4 — Workflows y verificación

C24–C28 conforman el bloque de workflows:
- [x] C24: Validar el contrato del paso en servidor.
- [x] C25: Transmitir configuración de IA a la ejecución.
- [x] C26: Conservar confianza mínima en el veredicto IA.
- [ ] C27: Hacer única la transición de finalización.
- [ ] C28: Garantizar entrega de eventos y mostrar efectos pendientes.