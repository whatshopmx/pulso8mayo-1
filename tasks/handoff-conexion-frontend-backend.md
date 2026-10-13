# Handoff — Conexión entre frontend y backend

**Actualizado:** 2026-10-13 · **Plan:** `tasks/plan-conexion-frontend-backend.md` · **Seguimiento:** `tasks/todo-conexion-frontend-backend.md`

Este documento es para empezar una sesión nueva sin releer veinte archivos. **Las fuentes de verdad siguen siendo el plan y el seguimiento**; esto es el atajo, y su contenido caduca en cuanto avanza el plan.

---

## 1. Dónde está todo y en qué orden leerlo

| Orden | Archivo | Qué aporta |
| --- | --- | --- |
| 1 | `tasks/todo-conexion-frontend-backend.md` | Estado real, una fila por tarea con evidencia y límites. **La fila de C16 es el siguiente paso.** |
| 2 | `tasks/plan-conexion-frontend-backend.md` | Criterios de aceptación, dependencias y verificación de C16–C40 |
| 3 | `docs/audits/2026-10-10-backend-frontend-wiring-audit.md` | Hallazgos H01–H12 que el plan tiene que cerrar |
| 4 | `lib/company/operating-policy-catalog.ts` | Catálogo de C15: clasificación, consumidor, aplicación y decisión pendiente de las trece entradas. Es la fuente que C16–C23 consumen, y su prueba falla si una política deja de ser lo que dice. |

## 2. Estado al handing-off

**C00–C15 completadas. C16 en curso: C16.1–C16.2.3 hechos, falta C16.3. C17–C40 pendientes.** El trabajo de la sesión está commiteado; quedan sin commitear los archivos de `stock-count` y dos pruebas suyas, que son de otra línea de trabajo (conteos por categoría y lote).

```
bee5b7e C16.2.3: la empresa elige quién solicita y quién emite, y lo ve
7a4114a C16.2.2: solicitar y emitir con control de delegación y pertenencia verificada
2054b8f C16.2.1: los controles de solicitud y emisión se configuran y se resuelven
3b0742d C16.1: la matriz de aprobadores de compras se edita desde Configuración operativa
c153cc7 C15: cada política operativa dice lo que hace hoy, no lo que sugiere
```

Puertas de fase cerradas: Fase 0, Fase 1 y **Fase 2** (12-10-2026). La Fase 3 sigue abierta: C16 cierra el bloque de compras y faltan C17–C23.

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
| C16.2 | **El aislamiento por empresa se comprobó sobre el SQL, no en runtime:** la prueba renderiza cada `where` con `PgDialect` y exige `company_id`. Cubre la consulta, no la ejecución. Nadie ha visto en el navegador que un supervisor reciba un 403 al emitir, ni que una orden de otra empresa devuelva 404. |
| C16.2 | La categoría del artículo es texto libre (`inventory_items.category`), así que las reglas por categoría comparan texto normalizado y un artículo sin categoría no queda cubierto. Si el negocio quiere un catálogo de categorías, es otra tarea. |
| C16.2 | Al aplicar el control se cerraron huecos previos de este recorrido: las transiciones buscaban la orden sólo por id y crear aceptaba sucursal, proveedor, solicitud y artículos del cuerpo sin comprobarlos. Quien mantenga ese recorrido debe seguir pasando `companyId` y el rol del actor: los parámetros son obligatorios, no opcionales, a propósito. |

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

**Línea base actual (13-10-2026):** `test:unit` 1019 aprobadas / 1 omitida / 1 TODO (81 archivos) · 42/42 en la config aislada · `lint` 0 errores (2392 warnings, todos preexistentes) · `build` y `tsc --noEmit` limpios. Los 23 casos nuevos de C15 y los 23 de `stock-count-*` explican el salto desde las 973 de C14.

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
7. **El texto corregido se contrasta contra el código, no contra el nombre.** La vieja promesa de la matriz —«los montos en un hueco usarán la cadena predeterminada»— era falsa: `validateMatrixRules` avisa «quedarán sin cadena y no podrán enviarse» y `purchase-order-service` rechaza con «El monto no está cubierto por la matriz de autorización». La nueva copió esas dos frases, no la intención.

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
| Con varias reglas que cubren, gana la más permisiva que el actor alcance; la diferencia avisa, no bloquea | 13-10 | Evidencia de C16.2 |

**Pendientes de decisión** (condicionan C16–C23, no bloquean el trabajo): quién revisa un workflow; si la exclusión de `ADMIN` en `policy_overrides` se confirma; las ocho decisiones por dimensión que C15 escribió (compras, producción, tesorería, pagos, autonomía, nómina, tipo de grupo y caja chica); horario, urgencias y zona horaria de notificaciones; consumidores externos del executor anterior.

## 8. Siguiente paso — C16.3

**C16 — Aplicar política de estructura de compras** (H04 · depende de C15 ✅), con C16.1, C16.2.1, C16.2.2 y C16.2.3 implementados.

Criterios de aceptación de C16 y lo que falta:
- [ ] **La opción elegida determina las decisiones** —resuelto por decisión: la modalidad es `descriptiva` y las decisiones las determinan los controles explícitos. Anotar la decisión y cerrarlo aquí.
- [x] **Las entradas alternativas no evitan la política** —cerrado en C16.2.2.
- [ ] **Casos para cada valor y excepción; las compras históricas no cambian** —falta confirmarlo sobre órdenes ya enviadas.

**Qué es C16.3, en concreto:**
1. Recorrer **solicitud → envío a aprobación → aprobación por matriz → emisión** con **dos empresas** y comprobar que los controles de una no alcanzan a la otra: misma ruta, mismo id de orden ajeno, misma sucursal ajena.
2. Comprobar que **reconfigurar los controles no altera** órdenes ya emitidas ni solicitudes abiertas: la regla se lee al intentar, no se graba en el documento.
3. Cerrar la pregunta de negocio que sigue abierta: **si una compra de emergencia puede saltarse algún control** (y con qué condición). Está escrita como la única decisión pendiente de `purchasingStructure` en el catálogo y en el contrato.

**Cómo verificarlo:** aquí sí hace falta la base real. Las pruebas unitarias simulan `db` y la comprobación de pertenencia se hizo sobre el SQL; una ejecución con dos empresas es lo que falta. Opciones: un spec de Playwright con `playwright.config.ts` (el que usa la base real y `auth.setup`), o un script de `tsx` con el cliente de Neon que siembre dos empresas y recorra el servicio. Lo segundo es más rápido y no depende de la sesión de navegador.

**Lo que ya está:** `lib/purchasing/delegation-policy.ts` (resolución pura + carga), `purchase-order-service` (guardas y aplicación), `GET`/`PUT /api/purchase-delegation`, la sección de Configuración operativa y la evidencia en [C16](../docs/audits/2026-10-13-estructura-compras.md).

## 9. Después de C16

C17–C23 dependen de C15 y son una política por tarea: producción de alimentos (C17), tesorería (C18), pago a proveedores (C19), autonomía del gerente (C20), dispersión de nómina (C21), tipo de empresa (C22) y caja chica (C23). Cada una aplica el contrato de C15 en **un** recorrido, y todas exigen una decisión de negocio antes de activar su efecto: el plan lo dice con la frase "no activar una política deducida únicamente del nombre de un campo". Ninguna puede resolverse sola: todas piden una decisión registrada por dimensión en el catálogo.