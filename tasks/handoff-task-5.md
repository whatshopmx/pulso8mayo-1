# Handoff: Task 5 — Suite de fechas/zonas horarias (`lib/workflows/today.ts`)

> Documento de continuidad generado el 2026-08-24 tras completar Phase 1.
> Fuente de verdad: `tasks/plan.md` (especificación) y `tasks/todo.md` (estado).

## Estado actual del repo

- Último commit: `5290512` — `test(ci): fundación de pruebas — Vitest + CI + lint verde (plan Tasks 3-4)`
- **Phase 0 completa** (regresiones webhook WhatsApp + tenant-isolation employees).
- **Phase 1 completa**: Vitest 4.1.11 + fast-check instalados, `pnpm test:unit`,
  `.github/workflows/ci.yml`, lint en 0 errores.
- Push pendiente → al hacerlo corre CI por primera vez ("CI verde en un PR real"
  queda abierto hasta entonces). No bloquea Task 5.

## Convenciones establecidas (no romper)

| Tema | Regla |
|---|---|
| Runner | Vitest; script `pnpm test:unit` (= `vitest run --configLoader bundle`) |
| Globs incluidos | `lib/**/*.test.ts` y `tests/unit/**/*.test.ts` — el nuevo spec entra solo, **no tocar config** |
| Zona del proceso | `TZ=UTC` forzado en `vitest.config.ts` (`process.env.TZ` + `test.env`). Los tests usan zonas explícitas (`America/Mexico_City`, etc.), nunca la local |
| Excluidos | `.worktrees/**`, node_modules; los specs Playwright (`*.spec.ts`) nunca entran aquí |
| Baseline lint | 0 errores / ~2111 warnings. Los warnings son deuda aceptada (`no-explicit-any` etc. → ver `eslint.config.mjs`). Un test nuevo **no debe sumar errores** ni warnings evitables |
| Estilo del módulo bajo prueba | `lib/workflows/today.ts` usa comillas simples e indentación de 4 espacios — seguir ese estilo en el spec |
| Smoke existente | `lib/workflows/__tests__/today.smoke.test.ts` (5 tests, ~1 s). El spec de Task 5 va **junto a él** como `today.test.ts` |

Correr un solo archivo durante el desarrollo:

```bash
npx vitest run lib/workflows/__tests__/today.test.ts
```

## Especificación de Task 5 (del plan)

> **Task 5: Fechas y zonas horarias (`lib/workflows/today.ts`)** (M)
> Table-driven: `localMoment`, `startOfLocalDayUtc`, `localDateString`,
> `addCalendarDays`, `localDayRangeUtc` × 3 zonas (Mexico_City, Cancún UTC−5
> fijo, Tijuana DST); captura 23:50 cae en día operativo correcto.
> `isScheduleDueOn`/`parseTimeOfDay`: ONCE/DAILY/WEEKLY/MONTHLY, día 31,
> 29-feb, hora inválida. `deriveItemState`: matriz
> HECHO/EN_CURSO/VENCIDO/PENDIENTE + empate.
> Archivo: `lib/workflows/__tests__/today.test.ts`

Checkpoint de salida: suite unitaria completa <30 s, casos borde documentados
en los propios tests.

## Mapa de la unidad bajo prueba (leído completo, 254 líneas)

Todas las funciones son puras — no hay DB, red ni mocks. Contratos y gotchas
verificados leyendo el código fuente:

### Bloque 1 — descomposición temporal

- **`localMoment(at, tz)` → `LocalMoment`**
  `{year, month(1-12), day, weekday(0=domingo), minutesOfDay}` vía
  `Intl.DateTimeFormat('en-US', { hour12: false })`.
  ⚠️ Gotcha ya manejado en el código: Intl devuelve `"24"` a medianoche;
  hace `hour % 24`. Testear que 00:07 local dé `minutesOfDay === 7`.
  ⚠️ Huso inválido cae a `America/Mexico_City` (`safeTimeZone`) — testeable con `'Mars/Phobos'`.
- **`startOfLocalDayUtc(at, tz)` → Date**
  Medianoche local como instante UTC. Redondea el offset al minuto (los
  segundos de `at` no deben mover la medianoche). Nota del propio código: en
  la hora exacta de cambio DST puede desviarse 1 h (solo afecta frontera).
  Invariante barato: `startOfLocalDayUtc(start + 1h)` === `start` (mismo día),
  y `localDateString(start, tz)` === `localDateString(start + 1h, tz)`.
- **`localDateString(at, tz)` → `YYYY-MM-DD`**
  Motivo de existencia del módulo: `toISOString().slice(0,10)` daba "mañana"
  en UTC−6 después de las 18:00 local. Caso estrella del plan: **captura
  23:50 local** → mismo día operativo (p.ej. `2026-03-10T23:50-06:00` =
  `2026-03-11T05:50Z` → debe dar `2026-03-10`).
- **`addCalendarDays(dateStr, n)` → `YYYY-MM-DD`**
  Aritmética pura anclada a mediodía UTC. Casos: `31-ene +1 → 01-feb`,
  `28-feb-2026 +1 → 01-mar` (**2026 NO es bisiesto**; 29-feb existe en 2028),
  `31-dic +1 → 01-ene-2027`, negativos (`01-mar −1 → 28-feb`).
- **`localDayRangeUtc(at, tz)` → `{ start, end }`**
  `[inicio, fin)`; calcula `end` con truco de +25 h para absorber DST.
  Invariantes: `end > start`; en zona sin DST `end - start === 24 h`
  (Cancún/CDMX); el rango contiene a `at`.

### Bloque 2 — recurrencia

- **`parseTimeOfDay(s)` → minutos | null**
  Regex `^(\d{1,2}):(\d{2})` (sin ancla final). `null` en: vacío/null,
  `"abc"`, `"7:5"` (minutos exigen 2 dígitos), `"24:00"` (>23), `"10:60"`
  (>59). Válidos: `"08:30"→510`, `"0:00"→0`, `"23:59"→1439`.
  📌 Comportamiento a documentar en test: `"08:30:15"` SÍ parsea (la regex
  tolera sufijo) — decidir si se congela así (recomendado: sí, con comentario).
- **`isScheduleDueOn(schedule, day, timeZone)` → boolean**, con
  `RecurrenceConfig = { frequency, dayOfWeek?, daysOfWeek?, dayOfMonth?,
  startDate, endDate?, isActive? }`:
  - `isActive === false` → siempre false (incluso ONCE de hoy).
  - Ventana: `startDate`/`endDate` se comparan por **día local completo**
    (una programación que arranca hoy más tarde sí corre hoy). Fechas
    inválidas (`new Date(NaN)`) se ignoran, no rompen.
  - `DAILY` → true dentro de ventana.
  - `WEEKLY`: si `daysOfWeek` (jsonb) tiene elementos, manda el array
    (nombres ES/EN con y sin acento: `"lunes"`, `"miércoles"`, `"sabado"`;
    también números numéricos o string-numéricos; fuera de 0-6 se filtran).
    Array vacío → fallback al escalar `dayOfWeek ?? 1` (default lunes).
  - `MONTHLY` → `dayOfMonth ?? 1 === day.day`. **Día 31**: en meses de 30
    días simplemente no vence (31≠30) — no hay "último día del mes".
  - `ONCE` → vence sólo el día local del `startDate` (compara Y/M/D, ignora
    hora). `startDate` inválido → false.
  - Frecuencia desconocida (`'WEEKDAYS'`, `''`, …) → default false.

### Bloque 3 — estado de partida

- **`deriveItemState(instanceStatus, dueMinutes, nowMinutes)`**
  Matriz completa (table-driven ideal):
  | status | dueMinutes | nowMinutes | esperado |
  |---|---|---|---|
  | COMPLETED | cualquiera | cualquiera | HECHO |
  | IN_PROGRESS | 600 | 540 | EN_CURSO |
  | IN_PROGRESS | 600 | 661 | VENCIDO |
  | IN_PROGRESS | 600 | 600 | **EN_CURSO (empate NO vence)** |
  | PENDING/null | 600 | 661 | VENCIDO |
  | PENDING/null | null | 661 | PENDIENTE (sin hora nunca vence) |
  | PENDING/null | 600 | 600 | PENDIENTE |
  Operador es `>` estricto: `nowMinutes > dueMinutes`.
- **`STATE_SEVERITY`**: VENCIDO 0 < EN_CURSO 1 < PENDIENTE 2 < HECHO 3
  (un assert de orden basta).
- **`normalizeShifts(unknown)`**: filtra no-strings y strings vacíos/sólo
  espacios, hace trim.

## Las 3 zonas (verificar offsets con datos, no de memoria)

| Zona | Comportamiento |
|---|---|
| `America/Mexico_City` | UTC−6 fijo (DST abolido desde oct-2022) |
| `America/Cancun` | UTC−5 fijo (EST permanente desde 2015) |
| `America/Tijuana` | Sigue DST de EE.UU.: spring-forward **dom 08-mar-2026** 02:00→03:00; fall-back **dom 01-nov-2026** |

Casos DST Tijuana sugeridos (usar instantes UTC explícitos):
- Antes/después del spring-forward (verificado con Intl): `2026-03-08T09:30:00Z`
  es 01:30 local (UTC−8, PST) pero `2026-03-08T10:30:00Z` ya es 03:30 (UTC−7, PDT).
- Fall-back (verificado): `2026-11-01T08:30:00Z` y `2026-11-01T09:30:00Z` son
  AMBAS 01:30 local — la hora se repite; ideal para probar desambiguación.
- `localDayRangeUtc` el día del cambio puede durar 23 h (spring) — el código
  lo contempla; asertar `end >= start + 23h` y no asumir 24 h exactas ese día.
- En fall-back el día dura 25 h — asertar `end - start === 25 h` sólo si el
  cálculo del módulo lo garantiza; si falla, documentar el comportamiento real
  antes de "arreglar" (ver política abajo).

## Política ante bugs encontrados

El módulo está en producción (tablero "Hoy"). Si un test destapa un bug real:
1. Commitear primero el test rojo (o dejarlo marcado `it.skip` con comentario)
   y reportarlo.
2. Fix mínimo en `today.ts` en commit separado con el caso como regresión.
3. No cambiar contratos públicos sin consultarlo.

## Verificación final (checkpoint Task 5)

```bash
pnpm test:unit        # verde, suite completa <30 s
pnpm run lint         # sigue en 0 errores
```

Actualizar `tasks/todo.md` (marcar Task 5) y `tasks/plan.md` (checkbox +
notas breves de hallazgos, p.ej. comportamiento de `"08:30:15"`).

## Después de Task 5

Tasks 6–9 son independientes entre sí y paralelizables (mismo patrón:
spec table-driven sobre lógica pura). La siguiente más parecida a esta es
Task 6 (`lib/labor-validation.ts`). Task 9 introduce fast-check
(property-based) sobre `calculatePropinasDistribution`.
