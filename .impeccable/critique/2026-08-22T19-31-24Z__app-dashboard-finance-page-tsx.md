---
target: app/dashboard/finance
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-08-22T19-31-24Z
slug: app-dashboard-finance-page-tsx
---
# Critique: app/dashboard/finance (portada del módulo Finanzas)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Todos los paneles tienen loading/error/retry, pero PnlBranchTable falla en silencio |
| 2 | Match System / Real World | 4 | Español HORECA auténtico: arqueo, caja chica, timbrado CFDI, notas al pie que anticipan la pregunta del contador |
| 3 | User Control and Freedom | 3 | Retry, filtros reversibles, paginación; nada destructivo en esta superficie |
| 4 | Consistency and Standards | 2 | Colores crudos (amber/red/emerald) y controles custom junto a tokens semánticos y componentes del sistema |
| 5 | Error Prevention | 3 | Regla NO_DATA→"—" bien pensada, pero el total del grupo la viola imprimiendo $0.00 |
| 6 | Recognition Rather Than Recall | 3 | Todo visible y etiquetado; la ayuda depende de `title` (hover-only) |
| 7 | Flexibility and Efficiency | 3 | Búsqueda + filtro "En Rojo" + scope del encabezado; paginación de 5 es innecesaria para ≤15 sucursales |
| 8 | Aesthetic and Minimalist Design | 3 | Flat tonal fiel al sistema; párrafos de ~150–170 chars sin límite de ancho; fila TOTAL con tinte rosa + columnas esmeralda compite |
| 9 | Error Recovery | 3 | MoneyAttentionPanel agrega fallos parciales con mensaje claro; el P&L muestra "Sin suficientes datos" cuando en realidad falló la red |
| 10 | Help and Documentation | 2 | Los botones "?" y las notas de celda usan `title`: invisible en tablet (dispositivo primario) y teclado |
| **Total** | | **29/40** | **Good — base sólida, atender zonas débiles** |

## Design Specificity Verdict

**LLM assessment**: Autoría clara. La página responde cuatro preguntas en orden narrativo (¿cómo vamos? → ¿qué necesita mi firma? → ¿me alcanza? → ¿dónde gano y dónde pierdo?) y habla el idioma operativo real de una cadena HORECA mexicana. Ningún producto genérico podría usarla sin cambios: los pies de P&L explican por qué el número del contador será mayor, y la procedencia de cada cifra (medido/derivado/estimación sectorial) es un rasgo propio del producto. El punto débil de especificidad no es visual sino de jerarquía: en ambientes con poca captura, los dos primeros paneles (los que responden "¿cómo vamos?" y "¿qué necesita mi firma?") colapsan a estados vacíos/de error y el primer viewport queda muerto.

**Deterministic scan**: 21 anti-patrones en runtime + 1 hallazgo CLI (`expenses/page.tsx:575`, fuente de 11px fuera del rampa — viola la Label-Floor Rule de DESIGN.md). Runtime: line-length ×2 (~152 y ~169 chars/line), nested-cards ×14, cramped-padding ×2, layout-transition ×4+ (transiciones de width/height/margin), em-dash-overuse ×14. Coincidencias con la revisión LLM: line-length (párrafos/pies sin `max-w`) y layout-transition (barra de costos con `transition-all` sobre width). Candidatos a falso positivo: nested-cards ×14 (probablemente cuenta contenedores de composición, no cards visuales anidadas) y parte de em-dash-overuse (el "—" como glifo de NO_DATA es notación de datos intencional, aunque también se usa como puntuación en prosa).

**Visual overlays**: Inyección exitosa en http://localhost:3000/dashboard/finance; la consola etiquetada `[impeccable]` reportó los 21 hallazgos. El servidor local de evidencia fue detenido tras la lectura.

## Overall Impression

La portada tiene el mejor instinto de producto del módulo: narra en preguntas, no en features, y trata la incertidumbre de los números con una honestidad rara (marcadores de procedencia, guion en vez de cero). Lo que le falta es terminar el trabajo de robustez: el componente estrella (P&L) es el único que falla en silencio y el único que rompe su propia regla de presentación, y la capa de ayuda descansa en `title`, que no existe en la tablet del dueño. La oportunidad más grande: que el primer viewport siempre tenga una respuesta, aunque sea "aún no hay datos — así se ve cuando los haya".

## What's Working

1. **Narrativa por preguntas.** El orden KPIs → atención → tesorería → P&L replica cómo piensa un dueño; los comentarios de código lo documentan y la UI lo cumple. Es el antídoto exacto contra el SaaS genérico que las anti-references prohíben.
2. **Honestidad de datos.** Marcar †/* por procedencia, mostrar "—" nunca cero, avisar "el margen es aproximado en N de M sucursales" antes de que se lean los números: esto genera confianza real y es difícil de copiar.
3. **Manejo de fallos agregados.** `MoneyAttentionPanel` distingue "fallaron las tres fuentes" de "todo en orden" — negarse a afirmar cumplimiento que nadie verificó es una decisión de diseño excelente.

## Priority Issues

1. **[P1] El total del grupo imprime $0.00 en renglones sin datos.**
   - Por qué importa: contradice la propia regla documentada del componente ("NO_DATA → guion, NUNCA cero; un cero se lee como 'no gastamos nada'"). En la captura viva, Gastos Operativos del TOTAL GRUPO muestra **$0.00** en negritas mientras las tres sucursales muestran "—" — el dueño lee que el grupo no gasta nada en operaciones.
   - Fix: en `pnl-branch-table.tsx`, renderizar el total condicionado a `salesHasData`-style flags por renglón (mostrar "—" cuando ninguna sucursal aportó datos a esa línea).
   - Comando sugerido: `$impeccable harden`

2. **[P1] PnlBranchTable no tiene estado de error: un fallo de red se disfraza de "Sin suficientes datos".**
   - Por qué importa: el catch solo hace `console.error`; la UI muestra el empty state como si fuera falta de captura. El dueño concluye que sus datos no existen cuando en realidad el servicio falló — exactamente la afirmación falsa que MoneyAttentionPanel sí evita.
   - Fix: replicar el patrón `failed` + EmptyState con botón Reintentar de `financial-kpi-cards.tsx`.
   - Comando sugerido: `$impeccable harden`

3. **[P1] Toda la ayuda contextual vive en atributos `title`.**
   - Por qué importa: PRODUCT.md define tablet como dispositivo primario del dueño; los tooltips nativos de `title` no aparecen en táctil ni con navegación por teclado. Los botones "?", los marcadores †/* y las notas de celda son invisibles justo para la audiencia principal.
   - Fix: migrar a un tooltip accesible (Radix, ya está en el stack) con trigger enfocable y contenido anunciado; mantener el texto existente.
   - Comando sugerido: `$impeccable harden` (o `$impeccable polish` si se prefiere agrupar con refinamiento)

4. **[P2] Deriva de tokens: colores crudos y controles custom conviven con el sistema.**
   - Por qué importa: `text-amber-700`, `bg-red-50`, `text-emerald-600`, `bg-emerald-500/5` y un `<input>`/`<button>` hechos a mano en el header del P&L duplican lo que los tokens `warning`/`destructive`/`success` y los componentes del sistema ya resuelven — y el modo oscuro se parchea ad hoc (`dark:` en cada clase).
   - Fix: sustituir por tokens semánticos y componentes UI existentes; el icono del título del P&L (esmeralda) debería seguir la convención `text-primary` de las demás tarjetas o justificarse como excepción documentada.
   - Comando sugerido: `$impeccable polish`

5. **[P2] Párrafos sin límite de ancho y doble uso del guion largo.**
   - Por qué importa: líneas medidas de ~152–169 caracteres (detector coincide) en descripciones y pies; leerlas a lo ancho de una pantalla de escritorio es fatigoso. Además "—" es simultáneamente glifo de dato ausente y puntuación de prosa, lo que diluye su significado de dato.
   - Fix: `max-w-prose`/`max-w-[70ch]` (el propio DESIGN.md dice 70ch) en descripciones y pies; en prosa, preferir coma o punto aparte y reservar "—" para la notación de datos.
   - Comando sugerido: `$impeccable layout` + `$impeccable clarify`

## Persona Red Flags

**Alex (Power User)**: paginación de 5 filas para un grupo que según PRODUCT.md llega a 15 sucursales — 3 páginas donde cabría una sola tabla; el toggle "En Rojo" es un `<button>` crudo sin `aria-pressed` ni estilo de foco propio; la búsqueda aparece solo con >3 sucursales (bien), pero no hay atajos ni ordenamiento por columna en la tabla financiera más importante del producto.

**Sam (Accessibility)**: excelente detalle de `<span className="sr-only">Severidad: …</span>` en las alertas y `aria-label` en los "?"; pero los marcadores †/*/≈ son `aria-hidden` con la explicación atrapada en `title` — un lector de pantalla nunca escucha por qué un número es aproximado; las transiciones de width de las barras de costo no tienen `prefers-reduced-motion` explícito (usa `transition-all`).

**Marta, dueña de 6 sucursales (persona del proyecto, tablet en la cocina)**: abre Finanzas el lunes por la mañana buscando una respuesta y las dos primeras tarjetas del viewport le dicen "Sin ventas registradas" y "Error de conexión" (estado vivo capturado hoy). El pico emocional de la pantalla — "¿cómo vamos?" — está secuestrado por estados nulos. Necesita que el vacío explique qué va a ver cuando haya datos, con la misma tipografía de confianza que tendría el dato.

## Minor Observations

- `transition-all duration-500` en la barra de costos anima width (layout thrash); usar transform scaleX.
- El badge "3 sucursales" dentro de la celda TOTAL GRUPO hereda `text-xs py-0 font-normal` — casi ilegible sobre el tinte rosa.
- Las dos alertas de Tesorería (cruce a negativo / partidas vencidas) usan el mismo icono TrendingDown; un vencido merecería Clock para distinguir naturaleza temporal vs. dirección.
- `CashFlowSummaryCard` muestra "Salidas proyectadas −$13,625.00" en destructivo aunque sea información neutra; reservar destructivo para el cruce a negativo.
- En la tabla P&L, la columna Confianza ocupa tanto ancho horizontal como Venta Neta; en pantallas medianas empuja scroll horizontal — considerar versión compacta (icono solo + tooltip accesible).
- Detector CLI: `expenses/page.tsx:575` usa `text-[11px]`, debajo del piso de 12px (Label-Floor Rule).

## Questions to Consider

- ¿Qué pasaría si el primer bloque siempre respondiera algo — incluso un "todavía no hay ventas esta semana, aquí está tu meta" — en vez de rendirse con un empty state?
- Si la regla sagrada es "un cero se lee como 'no gastamos nada'", ¿por qué el total del grupo — el número más leído de toda la tabla — es el único lugar que no la respeta?
- ¿El P&L necesita paginación alguna vez, si el producto está acotado a 15 sucursales?
