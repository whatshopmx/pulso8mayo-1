# Handoff — Conexión entre frontend y backend

**Actualizado:** 2026-10-12 · **Plan:** `tasks/plan-conexion-frontend-backend.md` · **Seguimiento:** `tasks/todo-conexion-frontend-backend.md`

Este documento es para empezar una sesión nueva sin releer veinte archivos. **Las fuentes de verdad siguen siendo el plan y el seguimiento**; esto es el atajo, y su contenido caduca en cuanto avanza el plan.

---

## 1. Dónde está todo y en qué orden leerlo

| Orden | Archivo | Qué aporta |
| --- | --- | --- |
| 1 | `tasks/todo-conexion-frontend-backend.md` | Estado real, una fila por tarea con evidencia y límites. **La fila de C15 es el siguiente paso.** |
| 2 | `tasks/plan-conexion-frontend-backend.md` | Criterios de aceptación, dependencias y verificación de C15–C40 |
| 3 | `docs/audits/2026-10-10-backend-frontend-wiring-audit.md` | Hallazgos H01–H12 que el plan tiene que cerrar |
| 4 | `docs/operating-policy-contracts.md` | Contrato por parámetro, con su consumidor real y su vigencia. Creado en C14.3, y es el punto de partida de C15. |

## 2. Estado al handing-off

**C00–C14 implementadas. C15–C40 pendientes.** Árbol limpio, `main` sin trabajo sin commitear.

```
3274d38 C14.3: cada periodo se calcula con los parámetros vigentes al cierre
b739bb1 Seguimiento: C14 cerrada con evidencia, contrato y decisión de vigencia
1ec2c81 C14.3: el efecto de cada parámetro se prueba y su vigencia queda definida
a3dd639 C14.2: cada cambio de configuración deja rastro de actor y valores
17c1436 C14.1: IVA, carga patronal, ISN y umbral de merma tienen contrato y editor
ad3bd2c Seguimiento: C13 cerrada y puerta de la Fase 2 registrada
f12ec3a C13: la configuración guardada sobrevive al recargar y un fallo de carga no monta defaults
```

Puertas de fase cerradas: Fase 0, Fase 1 y **Fase 2** (12-10-2026).

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

**Línea base actual (12-10-2026):** `test:unit` 973 aprobadas / 1 omitida / 1 TODO · 34/34 en la config aislada · `lint` 0 errores (2386 warnings, todos preexistentes) · `build` y `tsc --noEmit` limpios.

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

## 7. Decisiones ya tomadas (no reabrir sin evidencia nueva)

| Decisión | Fecha | Dónde |
| --- | --- | --- |
| La jornada de 8 h bloquea; la salida es excepción auditada | 10-10 | `a449b16`, `6134b90`, `41232a4` |
| Aplicación de plantillas de turnos por elemento, no todo-o-nada | 11-10 | Evidencia de C11 |
| Los parámetros se aplican con el **valor vigente al cierre** del periodo | 12-10 | `3274d38` |
| Los objetivos de semáforo y umbrales no tienen vigencia a propósito | 12-10 | Evidencia de C14.3 |
| El historial de configuración es de mejor esfuerzo, nunca rompe el guardado | 12-10 | Evidencia de C14.2 |

**Pendientes de decisión** (no bloquean C15 pero condicionan C16–C23): quién revisa un workflow; si la exclusión de `ADMIN` en `policy_overrides` se confirma; horario, urgencias y zona horaria de notificaciones; consumidores externos del executor anterior.

## 8. Siguiente paso — C15

**C15 — Definir el contrato de cada política operativa** (H04 · depende de C13 ✅ · tamaño M).

Crear el catálogo de las **siete dimensiones** y el **límite de caja chica**: valores, comportamiento esperado, alcance, consumidor, permiso, momento de aplicación y excepciones.

Criterios de aceptación:
- [ ] Cada valor tiene un caso dado/cuando/entonces **o queda clasificado como descriptivo**.
- [ ] La UI distingue aplicada, descriptiva y pendiente, sin prometer restricciones inexistentes.
- [ ] Las decisiones de negocio pendientes se identifican por dimensión y **no bloquean** las políticas ya definidas.

**Dónde empezar:** `docs/operating-policy-contracts.md` ya tiene la estructura que C15 debe extender (unidad, rango, semántica de vacío, alcance, permiso, consumidor, aplicación, excepciones) y la regla que hay que respetar: **cada valor se verifica contra el consumidor que lo lee, no contra el nombre del campo.**

**Archivos previstos:** `docs/operating-policy-contracts.md`, `components/company/operating-dimensions-section.tsx`, `lib/services/tenant-config-service.ts`.

**Ojo con el alcance.** C15 es catálogo, no implementación: las siete dimensiones sólo se aplican en C16–C23, una por tarea. Lo que C15 tiene que evitar es prometer en la UI una restricción que ningún consumidor aplica —que es exactamente el defecto que H04 describe. Para cada dimensión conviene responder antes: ¿qué valor lee hoy el código? Si la respuesta es "ninguno", el valor es **descriptivo** y la UI debe decirlo.

**Verificación de C15:** revisión de catálogo contra UI y servicios; no inferir reglas sólo del nombre del campo.

## 9. Después de C15

C16–C23 dependen de C15 y son una política por tarea: compras (C16), producción de alimentos (C17), tesorería (C18), pago a proveedores (C19), autonomía del gerente (C20), dispersión de nómina (C21), tipo de empresa (C22) y caja chica (C23). Cada una aplica el contrato de C15 en **un** recorrido, y todas exigen una decisión de negocio antes de activar su efecto: el plan lo dice con la frase "no activar una política deducida únicamente del nombre de un campo".