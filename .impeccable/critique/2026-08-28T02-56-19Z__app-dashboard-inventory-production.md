---
target: app/dashboard/inventory/production
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-28T02-56-19Z
slug: app-dashboard-inventory-production
---
### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Buenos skeletons y badges; falta indicador de frescura/última actualización en el auto-refresco de 30s de Hold Time. |
| 2 | Match System / Real World | 3 | Fuerte alineación al léxico de cocina (FEFO, merma, tandas); "Hold Time / En línea" mezcla terminología. |
| 3 | User Control and Freedom | 2 | No permite cancelar ni editar órdenes desde la pestaña de Órdenes; sin deshacer para completados accidentales. |
| 4 | Consistency and Standards | 2 | Desconexión entre vista de tabla (Prep List) y rejilla de tarjetas (Órdenes/Hold Time); variantes de badges discordantes. |
| 5 | Error Prevention | 3 | Vista previa FEFO previene faltantes; falta validación por pasos rápidos (+1, +5, +10) para entradas en cocina. |
| 6 | Recognition Rather Than Recall | 2 | Pestaña de Órdenes oculta desglose de insumos; la tabla de prep list requiere scroll horizontal para ver estatus. |
| 7 | Flexibility and Efficiency | 1 | Sin filtros rápidos por estación (Parrilla/Fría), sin atajos de teclado ni acciones en lote para cocineros. |
| 8 | Aesthetic and Minimalist Design | 2 | Cabecera saturada con pestañas, selector y modales dobles; microtipografías fuera de escala (`text-[10px]`, `text-[11px]`). |
| 9 | Error Recovery | 3 | Notificaciones toast descriptivas; los diálogos no retienen estado con recuperación guiada al fallar la red. |
| 10 | Help and Documentation | 2 | Descripciones breves en modales; nula explicación operativa sobre el impacto de faltantes FEFO en auditoría. |
| **Total** | | **23/40** | **Acceptable (57.5%)** |

---

### Design Specificity Verdict

**LLM assessment**: La interfaz posee una lógica de dominio excepcionalmente rica (asignación FEFO por lotes, control de mermas por tiempo de retención en línea y modificadores climáticos de Monterrey), pero su estructura visual sufre de una arquitectura fragmentada: convive una vista de hoja de producción tabular con tarjetas genéricas tipo CRUD para órdenes y sugerencias, y botones modales redundantes en la cabecera ("Registrar Producción" vs "Nueva Orden" vs checkbox de línea de prep). Se percibe como un conjunto de módulos técnicos independientes más que como una estación de comando táctil integrada para el ritmo de una cocina.

**Deterministic scan**: Se detectaron 4 infracciones de tipo de letra fuera de la rampa de diseño (`text-[11px]` en `production-client.tsx:349, 356, 360` y `text-[10px]` en `prep-list-board.tsx:314`). Estas microtipografías violan la regla de piso mínimo (*The Label-Floor Rule*: mínimo 12px / `text-xs`) y resultan ilegibles a distancia de brazo en una tablet de cocina.

---

### Overall Impression
La funcionalidad operativa es sobresaliente (FEFO en tiempo real, alertas de merma por vencimiento y factores de demanda climática), pero la experiencia del usuario está obstaculizada por flujos de captura duplicados, tablas que se desbordan horizontalmente en tablets y falta de filtros por estación para el personal de línea.

---

### What's Working
1. **Asignación FEFO transparente con cálculo de faltante**: La vista previa antes de confirmar producción desglosa exactamente qué lote se consumirá y advierte si habrá merma auditada por faltante.
2. **Tablero de tiempo de retención (Hold Time)**: El reloj relativo ("Venció hace X min") y el cálculo de pérdida estimada en MXN le dan valor económico inmediato al control de calidad de la línea.
3. **Hoja de producción estructurada por turnos y responsables**: Refleja fielmente la dinámica real de apertura/cierre en restaurantes.

---

### Priority Issues

#### [P1] Flujos de producción fragmentados y puntos de entrada ambiguos
- **Por qué importa**: En una cocina activa, tener un botón "Registrar Producción" en cabecera, un botón "Nueva Orden", una pestaña "Órdenes" pasiva y checkboxes en "Prep List" confunde al personal sobre dónde reportar el trabajo.
- **Solución**: Consolidar la "Prep List Diaria" como eje central de ejecución, convertir "Registrar Producción" en un botón secundario para "Producción extraordinaria / Fuera de lista", y permitir transformar órdenes planificadas en líneas de prep con un clic.
- **Comando sugerido**: `$impeccable distill`

#### [P1] Desbordamiento horizontal en tablets y terminales de cocina
- **Por qué importa**: La tabla de Prep List fuerza un ancho mínimo de `52rem` (`min-w-[52rem]`). En tablets de 10" o móviles usados por jefes de cocina, las columnas críticas de hora límite, estatus y edición quedan ocultas tras un scroll incómodo con manos ocupadas.
- **Solución**: Diseñar una vista de tarjeta compacta/acordeón para pantallas menores a 1024px agrupada por estación, dejando la tabla expandida solo para monitores de escritorio.
- **Comando sugerido**: `$impeccable adapt`

#### [P2] Infracciones a la rampa tipográfica y piso de etiquetas (Label Floor)
- **Por qué importa**: El uso de `text-[10px]` y `text-[11px]` en metadatos de lotes y badges climáticos hace que la información sea ilegible bajo la iluminación y distancia de una estación de cocción.
- **Solución**: Estandarizar todo el micro-texto a `text-xs` (12px) usando `font-mono` y variaciones de peso/color según `DESIGN.md`.
- **Comando sugerido**: `$impeccable typeset`

#### [P2] Factor Clima / Evento MTY puramente decorativo
- **Por qué importa**: El selector de clima (Ola de calor, Clásico Regio) despliega un aviso explicativo pero no modifica dinámicamente las cantidades sugeridas ni recalcula la prep list en pantalla, generando frustración.
- **Solución**: Integrar el modificador seleccionado con un multiplicador reactivo sobre las cantidades sugeridas o proveer un botón directo "Aplicar ajuste (+30%) a la hoja".
- **Comando sugerido**: `$impeccable clarify`

#### [P2] Ausencia de filtros por estación de trabajo y atajos rápidos
- **Por qué importa**: En cocinas con 20+ preparaciones, el cocinero de "Parrilla" tiene que desplazarse por toda la lista para encontrar sus tareas.
- **Solución**: Agregar botones de filtro rápido por estación (Pills: Todas, Parrilla, Cocina Fría, Barra) y botones de cantidad rápida (+1, +5, +10) en los modales de captura.
- **Comando sugerido**: `$impeccable layout`

---

### Persona Red Flags

- **Alex (Jefe de Cocina / Power User)**: La pestaña "Órdenes" es de solo lectura visual; no puede editar cantidades, cancelar tandas ni convertir sugerencias en órdenes masivas sin abrir modales individuales de 6 campos cada uno.
- **Jordan (Cocinero de Línea / Primerizo)**: Confusión inmediata al completar una línea: el checkbox no solo tacha la tarea sino que abre un modal con cálculo FEFO que puede reportar faltantes y mermas sin previa inducción clara.
- **Casey (Operador de Tablet en Cocina / Móvil)**: La tabla de 9 columnas desborda la pantalla táctil; el botón de edición de 16px (ícono de lápiz) es un blanco táctil demasiado pequeño para dedos húmedos o con guantes.

---

### Minor Observations
- En la pestaña "Órdenes", el estado `COMPLETED` usa badge `outline` en lugar de `success`, mientras que en Prep List usa verde `success`.
- El auto-refresco de 30 segundos en "En línea" carece de un indicador visual sutil (ej. "Actualizado hace un momento" o pulso discreto).
- El diálogo de "Registrar Producción" duplica el campo de unidad cuando la receta seleccionada ya tiene unidad fija asignada.

---

### Questions to Consider
- ¿Debería la Prep List Diaria generarse automáticamente cada mañana a partir de las sugerencias de venta y eventos climáticos de Monterrey en lugar de requerir captura manual línea por línea?
- ¿Podemos reemplazar el scroll horizontal de la tabla en tablets por una vista de lista con tarjetas de estación optimizadas para toques grandes?
- ¿Tiene sentido mantener la pestaña "Órdenes" separada de "Prep List Diaria", o deberían fusionarse en un único flujo de planificación y ejecución?
