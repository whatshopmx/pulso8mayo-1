---
target: "app/dashboard/page.tsx (Consejo del Grupo: /dashboard + /dashboard/exceptions)"
total_score: 16
max_score: 32
na_heuristics: 9,10
p0_count: 2
p1_count: 2
timestamp: 2026-09-04T16-18-16Z
slug: app-dashboard-page-tsx
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2/4 | "Detectado hace 7 días" se muestra, pero nada distingue una crítica de 7 días (sin atender) de una de 10 horas — ambas se ven igual salvo el texto de fecha. |
| 2 | Match System / Real World | 2/4 | El mismo incidente es "Fatal" en su detalle y "Crítico" en Excepciones/tarjetas de área. "Fatal" sobre una descripción que dice "daños menores" es un desajuste real. |
| 3 | User Control and Freedom | 3/4 | Filtros simples, sin trampas. Pero no hay forma de reconocer/posponer una excepción desde estas pantallas. |
| 4 | Consistency and Standards | 1/4 | Vocabulario de severidad distinto por página; badge de severidad sin texto en tarjetas de área (solo color) vs con texto en Excepciones; 3 de 5 dominios enlazan a pantalla genérica en vez del registro específico; H1 de `/dashboard` choca de nombre con un ítem del sidebar que apunta a otra URL. |
| 5 | Error Prevention | 3/4 | Sin flujos destructivos en estas pantallas; ErrorState/EmptyState razonables. |
| 6 | Recognition Rather Than Recall | 2/4 | Títulos truncados (`.truncate`) fuerzan un click para saber qué dicen, sin tooltip. Overflow medido hasta 113px en 8 instancias. |
| 7 | Flexibility and Efficiency | 1/4 | Sin reconocer/posponer/asignar en lote; cada visita re-muestra las mismas 9 filas "Stock bajo". |
| 8 | Aesthetic and Minimalist Design | 2/4 | 20 violaciones "card dentro de card" en `/dashboard` (5 en `/exceptions`); grupo Inventario con 12 filas, 9 literalmente "Stock bajo" sin agregación. |
| 9 | Error Recovery | n/a | Sin flujos de error de usuario en estas pantallas de solo lectura. |
| 10 | Help and Documentation | n/a | Superficie operativa pura; no se espera ayuda contextual aquí. |
| **Total** | | **16/32 (50%)** | **Aceptable — límite inferior de la banda** |

## Design Specificity Verdict

**LLM assessment**: El grid de tarjetas de área (icono + título + badge + métrica grande + lista de 3 + dos links de pie) es el patrón genérico de "feed de alertas ops". El contenido es específico de HORECA (reportes STPS, NOM-251, limpieza de campana, fumigación) pero el contenedor no hace nada por ganarse esa especificidad: nada distingue visualmente un incendio de cocina de un SKU con stock bajo más allá de un tinte pastel, no hay noción de espacio físico entre sucursales, y no hay reconocimiento de que este es un dominio de seguridad-vida mezclado con ruido operativo rutinario.

**Deterministic scan**: `detect.mjs --json` sobre los 5 archivos fuente devolvió `[]` — el motor estático es regex sobre texto literal y no evalúa utilidades de Tailwind ni layout calculado, así que `[]` significa "sin patrón textual", no "sin problemas". El escaneo en navegador (DOM renderizado) encontró 38 anti-patrones en `/dashboard` y 14 en `/dashboard/exceptions`: 20+5 "card dentro de card", 8+1 texto truncado con overflow medido (hasta 113px), 2+2 texto por debajo del piso de 12px que DESIGN.md nombra explícitamente ("The Label-Floor Rule"), 1 salto de heading (H1→H3 sin H2) en cada página, y transiciones de layout en primitivos de sidebar/header (preexistentes). Sin falsos positivos reportados.

**Visual overlays**: no quedaron overlays visibles activos — Assessment B cerró su pestaña y detuvo su servidor tras capturar la consola.

## Overall Impression

El trabajo duro y correcto está en el backend: `GroupExceptionsService` unifica 5 tablas heterogéneas en una sola forma con orden severidad→recencia. Pero la capa visual es un feed de alertas genérico con vocabulario HORECA pegado encima, con inconsistencias reales entre las dos pantallas nuevas (severidad, links, nombres) que un dueño ansioso notaría antes que uno. La pantalla que un dueño abre cuando algo puede estar mal hoy alarma antes de calmar, y el único momento de verdadero alivio vive un click más adentro de lo que debería.

## What's Working

1. **El modelo de datos de excepción es un trabajo de diseño genuinamente bueno.** `GroupException` unifica 5 tablas fuente muy distintas en una sola forma con orden severidad-luego-recencia real.
2. **Disciplina de modo oscuro en los componentes nuevos, no así en los preexistentes.** `DashboardTabbedMetrics` (preexistente) se rompe en modo oscuro; `AreaCard` y la lista de Excepciones se sostienen limpias.
3. **El estado vacío honesto de la tarjeta Finanzas.** Reconoce que no hay fuente Nivel A confiable todavía en vez de inventar una métrica.

## Priority Issues

**[P0] Vocabulario e intensidad de severidad inconsistentes entre pantallas**
- Por qué importa: el mismo incidente es "Fatal" en su detalle y "Crítico" en Excepciones/tarjetas de área, "Fatal" sobre "daños menores". Tergiversa el riesgo real ante un dueño escaneando badges.
- Fix: retirar "Fatal" como copy de usuario; auditar cada superficie que renderiza `incidents.severity` sin pasar por `normalizeIncidentSeverity`.
- Comando sugerido: /impeccable clarify

**[P0] Los deep links no llegan al registro específico en 3 de 5 dominios**
- Por qué importa: click en una excepción específica lleva a la pantalla genérica del dominio, no al registro. La tarjeta promete algo específico, el click entrega toda la lista.
- Fix: deep links reales por registro, o cambiar el copy a "N problemas en X".
- Comando sugerido: /impeccable harden

**[P1] Texto en inglés filtrándose en un producto Spanish-only**
- Por qué importa: breadcrumb "Pulso HORECA Demo › Exceptions"; título "Deadline vencido: Remediación Externa: FUMIGATION". CLAUDE.md exige Spanish-only.
- Fix: corregir mapa de rutas→etiqueta del breadcrumb; revisar copy de origen de esos títulos.
- Comando sugerido: /impeccable clarify

**[P1] Contenido y nombres duplicados en /dashboard**
- Por qué importa: H1 "Dashboard Ejecutivo" choca con ítem de sidebar del mismo nombre a otra URL; dos incidentes aparecen dos veces en el mismo scroll (tarjeta de Operación + panel "Incidentes Críticos" legado).
- Fix: renombrar título de /dashboard; quitar o diferenciar el panel legado.
- Comando sugerido: /impeccable polish

**[P2] Deuda estructural: tarjetas anidadas, texto cortado sin respaldo, severidad solo por color**
- Por qué importa: 25 violaciones "card dentro de card", 9 truncados hasta 113px sin tooltip, severidad de tarjeta de área solo por color (WCAG 1.4.1-adyacente), dos etiquetas en 10px violando el piso de 12px del propio DESIGN.md.
- Fix: aplanar anidamiento; agregar tooltip a truncados; agregar texto/ícono de severidad; subir las dos instancias de 10px a 12px.
- Comando sugerido: /impeccable layout

## Persona Red Flags

**Alex (Power User)**: sin reconocer/posponer excepciones; cada visita re-muestra las mismas 9 filas "Stock bajo". "Ver N" se lee como "N más" pero es "N en total".

**Jordan (Primerizo)**: ambigüedad entre el H1 "Dashboard Ejecutivo" y el ítem de sidebar homónimo; "FATAL" sobre "daños menores" sin contexto para descontarlo.

**Sam (Accesibilidad)**: las filas de excepción exponen a lector de pantalla solo "[Sucursal] [Título]" — la severidad codificada por color no se lee en voz alta.

## Minor Observations

- El filtro por área: Assessment A no logró abrirlo en su sesión automatizada, pero se probó manualmente antes en esta conversación y funcionó — posible condición de carrera del portal de Radix bajo automatización, no bug confirmado.
- Badge "47" de notificaciones recortado en viewport móvil de 390px.
- Placeholders de gráfica bajo "Rendimiento de Sucursales"/"Tendencia de Costos" se ven como cajas grises vacías.
- "Promedio del grupo" reutilizado igual para %, moneda y conteo.
- Colisión de nombres: `"warning"` se pinta con color info/azul y `"high"` con color warning/ámbar en area-card.tsx.

## Questions to Consider

1. Si un incendio de cocina y un SKU con stock bajo usan la misma tarjeta, badge y gesto de click — ¿qué optimiza realmente "Centro de Excepciones"?
2. ¿Por qué la tranquilidad de "no hace falta hacer nada más" vive un click más adentro de lo que debería?
3. Con 24 excepciones para una demo de 3 sucursales (12 "Stock bajo") — ¿sigue siendo correcta "una lista larga por dominio" a 15 sucursales, o necesita agregación?
