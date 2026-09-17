---
target: dashboard/executive
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
timestamp: 2026-09-17T15-00-17Z
slug: app-dashboard-executive-page-tsx
---
### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Pestaña de liquidez muestra un recuadro punteado estático ("Calculando proyección...") en lugar de una gráfica funcional; cambio de vistas mediante `<Link>` provoca destellos de recarga SSR; gráfica de flujo carece de línea cero (`y=0`). |
| 2 | Match System / Real World | 3 | Excelente modelo mental del ecosistema restaurantero mexicano (IMSS Día 17, Nómina 15/30, Prime Cost ≤ 60%, abasto de viernes), pero desconectado de acciones inmediatas como disparar alertas de WhatsApp o resolver arbitrajes. |
| 3 | User Control and Freedom | 2 | La "Cola de Decisiones" obliga a abandonar la cabina mediante enlaces externos (`/dashboard/exceptions`, `/dashboard/branches/[id]`); no existen acciones inline de resolución rápida, aplazamiento o delegación. |
| 4 | Consistency and Standards | 2 | Violación masiva de la regla *Label-Floor* con 25 ocurrencias de tipografía a 10px y 11px; uso de colores fuera del sistema de diseño (sky-500, indigo-500, hex `#10b981`, `#ef4444`); pestaña activa saturando el Operational Red. |
| 5 | Error Prevention | 3 | Alertas automáticas de fuga de margen (>60%) y riesgo de liquidez (>40%), pero sin advertencia o confirmación antes de salir del flujo de decisión de 60 segundos. |
| 6 | Recognition Rather Than Recall | 2 | La barra superior de Signos Vitales aglutina 10 métricas simultáneas sin jerarquía clara; el usuario pierde contexto de los signos vitales al desplazarse en vistas largas. |
| 7 | Flexibility and Efficiency | 2 | Sin atajos de teclado para alternar entre los 3 modos de decisión (1, 2, 3); sin exportación ejecutiva a PDF/Excel consolidado para juntas de consejo o socios; sin filtros de rango rápido. |
| 8 | Aesthetic and Minimalist Design | 2 | La "Cascada de Rentabilidad" no es una cascada sino una cuadrícula plana de 4 tarjetas; bloques de pestañas con fondo rojo primario sólido que dominan excesivamente el campo visual. |
| 9 | Error Recovery | 3 | Manejo de fallos en el copiloto con notificaciones `toast.error`, pero la gráfica de flujo a 14 días queda en estado pasivo/muerto cuando `projectionData` no tiene series. |
| 10 | Help and Documentation | 3 | Textos descriptivos claros sobre la regla del 60% y los hitos del calendario gastronómico mexicano, aunque sin tooltips explicativos sobre el modelo causal del Executive Twin. |
| **Total** | | **22/40** | **Acceptable (55%)** |

### Design Specificity Verdict

**LLM Assessment**: La cabina ejecutiva (`/dashboard/executive`) cuenta con una base conceptual sólida y altamente anclada a la realidad operativa de grupos restauranteros en México (Prime Cost, nómina quincenal, IMSS SIPARE día 17, abasto cárnico). Sin embargo, su ejecución interactiva y visual sufre de desconexión y asperezas notables:
1. El concepto de la "Rutina de 60 Segundos" se rompe porque la cola de decisiones obliga al dueño a abandonar la cabina hacia rutas secundarias (`/dashboard/exceptions` o `/dashboard/branches/[id]`) en lugar de permitirle despachar o delegar inline.
2. La navegación entre las tres vistas estratégicas (`?view=cockpit`, `?view=economics`, `?view=liquidity`) se realiza mediante enlaces `<Link>` completos que disparan 4 consultas paralelas de base de datos en el servidor en cada clic, causando parpadeos de recarga en lugar de transiciones suaves en cliente.
3. Se detecta una ruptura sistemática del sistema de diseño tipográfico con 25 usos de microfuentes a 10px y 11px ilegibles en tablets, junto con colores utilitarios de Tailwind desalineados con los tokens OKLCH de Pulso.

**Deterministic Scan**: `detect.mjs` arrojó **25 hallazgos** de la regla `Font size outside DESIGN.md` (violación de la regla estricta *Label-Floor*, que prohíbe tamaños inferiores a 12px):
- 11 hallazgos en `components/dashboard/executive/cash-runway-card.tsx` (etiquetas de hitos, fechas y escalas)
- 5 hallazgos en `components/dashboard/executive/executive-copilot-card.tsx` (tags de impacto y notas)
- 4 hallazgos en `components/dashboard/executive/pnl-executive-waterfall.tsx` (subtítulos de margen)
- 4 hallazgos en `components/dashboard/executive/prime-cost-stack-card.tsx` (badges y leyendas)
- 1 hallazgo en `components/dashboard/executive/executive-decision-deck.tsx` (badge de prioridad)

**Visual Overlays**: Inspección visual en vivo completada en navegador mediante sesión autenticada con `carlos@pulso.mx`. Se comprobó que en la vista de liquidez la gráfica de flujo a 14 días se queda en un contenedor punteado con texto estático ("Calculando proyección de tesorería del Executive Twin..."), el botón activo de las pestañas en rojo primario domina excesivamente la barra superior, y el drawer lateral de auditoría P&L multi-sucursal abre fluidamente con tabla detallada y exportación a CSV.

### Overall Impression

El Executive Dashboard tiene una de las propuestas de valor más potentes del sistema Pulso (darle al dueño de 3-15 sucursales una vista integrada de rentabilidad, margen y flujo en 60 segundos), pero su ejecución visual actual parece un ensamble de componentes heterogéneos: pestañas que recargan el servidor, microtextos que rompen el sistema tipográfico, una gráfica de cascada que no es cascada, y un gráfico de flujo de caja que se queda colgado en un mensaje de cálculo. Con una refinación orientada a interactividad en cliente, apego a los tokens OKLCH de Pulso y resolución de decisiones inline, esta cabina se convertirá en la herramienta de control más contundente de la plataforma.

### What's Working

1. **Anclaje profundo al modelo mental gastronómico mexicano**: El desglose del Prime Cost (Comida + Mano de obra ≤ 60%) y el calendario operativo con nóminas (15/30), IMSS (17), proveedores semanales y rentas aportan un valor de negocio insustituible que ningún dashboard genérico ofrece.
2. **Drawer de auditoría P&L multi-sucursal impecable**: La integración con `PnlBranchTable` en un `Sheet` lateral permite pasar de la visión macro al detalle granular por tienda sin perder el contexto ni recargar la página.
3. **Copiloto causal con escenarios de simulación pre-calculados**: Las simulaciones de estandarización de porciones, impacto inflacionario en proteínas y preparación para expansión conectan directamente las métricas con decisiones de negocio reales.

### Priority Issues

- **[P0] Gráfica de Flujo a 14 Días en Estado "Calculando..." Permanente y Falta de Baseline Cero**:
  - **Why it matters**: En la pestaña de Oxígeno & Flujo 14D, el usuario se encuentra con un recuadro punteado estático que dice "Calculando proyección de tesorería del Executive Twin...". Si no hay datos proyectados suficientes en el Twin, la pantalla parece congelada. Además, cuando hay datos con valores negativos, las barras se redondean hacia arriba (`radius={[3,3,0,0]}`) y no hay una línea de referencia en `$0` (`<ReferenceLine y={0} />`), lo que hace que los déficits de caja se interpreten de forma confusa.
  - **Fix**: Proveer una curva proyectada simulada por defecto cuando no haya datos históricos suficientes, o un estado vacío accionable con botón para sincronizar cuentas bancarias/POS. Agregar `<ReferenceLine y={0} stroke="hsl(var(--destructive))" strokeDasharray="3 3" />` y redondeo condicional según el signo.
  - **Suggested command**: `$impeccable harden`

- **[P1] Violación Sistémica de la Regla Label-Floor (25 Hallazgos de 10px y 11px)**:
  - **Why it matters**: La regla estricta de `DESIGN.md` establece que 12px (`text-xs`) es el piso absoluto del sistema. En el Executive Dashboard, los subtítulos de las métricas, las fechas de los compromisos, los tags de impacto y los ejes de Recharts usan `text-[10px]`, `text-[11px]` y `fontSize: 11`. En una tablet utilizada por el dueño o director en piso, estas cifras son virtualmente ilegibles.
  - **Fix**: Elevar todos los microtextos al piso de 12px (`text-xs` / `typography.label`), usando variaciones de peso (`font-semibold` / `font-bold`) y color semántico (`text-muted-foreground`, `text-primary`) para jerarquía sin reducir el tamaño de fuente.
  - **Suggested command**: `$impeccable typeset`

- **[P1] Pestañas de Decisión con Recarga Completa SSR y Exceso de Operational Red**:
  - **Why it matters**: Las pestañas (`1. Despacho`, `2. Unit Economics`, `3. Oxígeno`) utilizan `<Link href="...">` estándar hacia el servidor. Cada cambio de pestaña dispara 4 consultas de base de datos (`companies`, `TwinEngine`, `CrossBranchService`, `MorningBriefService`), generando latencia innecesaria y parpadeo visual. Adicionalmente, el botón activo se rellena con rojo operacional primario sólido (`bg-primary text-primary-foreground`), saturando la cabecera e infringiendo el principio de usar el rojo solo en un 10-15% para acciones de alta prioridad.
  - **Fix**: Convertir la alternancia de pestañas en un componente interactivo de cliente (`Tabs` de Radix / shadcn) que mantenga el estado pre-cargado y actualice la URL mediante `shallow routing` / `history.replaceState`. Cambiar el estilo de pestaña activa a un indicador de píldora sutil o subrayado sin bloque rojo masivo.
  - **Suggested command**: `$impeccable layout`

- **[P1] "Cascada de PnL" sin Estructura Visual de Cascada**:
  - **Why it matters**: El componente se denomina `PnlExecutiveWaterfall`, pero visualmente son 4 tarjetas aisladas en una cuadrícula (`grid-cols-1 md:grid-cols-4`). No comunica visualmente el flujo deductivo de los ingresos: cómo el 100% de ventas se va mermando por los insumos (COGS), luego por nómina (Prime Margin) y finalmente por gastos operativos para llegar al EBITDA.
  - **Fix**: Rediseñar el componente como una verdadera cascada visual conectada: barras escalonadas o conectores visuales de resta (`-`, `=`) que guíen el ojo del director a través de la pérdida de margen y enfaticen la fuga principal.
  - **Suggested command**: `$impeccable bolder`

- **[P2] Cola de Decisiones sin Acciones Inline (Ruptura de la "Rutina de 60 Segundos")**:
  - **Why it matters**: El propósito de la cabina es permitir al dueño despachar autorizaciones en 60 segundos. Actualmente, cada tarjeta tiene un botón que redirige a otra página completa (`/dashboard/exceptions` o `/dashboard/branches/[id]`), obligando a salir del flujo y perdiendo la visión holística.
  - **Fix**: Integrar botones de acción rápida inline: "Autorizar", "Rechazar", "Diferir 24h" o "Mandar WhatsApp a Gerente", acompañados de un modal o drawer de confirmación rápida sin salir del Cockpit.
  - **Suggested command**: `$impeccable shape`

### Persona Red Flags

- **Alex (Dueño / Director General de Grupo Restaurantero - 8 sucursales)**:
  - *Red flag*: Quiere revisar sus sucursales en 60 segundos desde su teléfono o laptop antes del servicio de mediodía. Al dar clic en "2. Unit Economics", toda la pantalla parpadea porque recarga el servidor. Al ver una desviación en la sucursal Roma, el botón lo saca del Cockpit y lo manda al detalle de la sucursal, perdiendo el hilo de las demás autorizaciones.
- **Roberto (Socio Operador / Director de Alimentos y Bebidas)**:
  - *Red flag*: En la vista de Unit Economics, busca entender por qué el Prime Cost de la red está desfasado. La tarjeta de cascada PnL solo le muestra 4 números estáticos sin gráficos de puente deductivo, y las barras horizontales de Prime Cost tienen escalas con límite fijo del 80% que pueden recortar anomalías graves de más del 80%.
- **Sam (Auditor de Cumplimiento RH y Accesibilidad)**:
  - *Red flag*: En una tablet con zoom o usuario con baja visión, las 25 etiquetas a 10px y 11px violan los estándares de legibilidad WCAG. La gráfica de barras en la pestaña de liquidez utiliza colores fijos `#10b981` y `#ef4444` sin suficiente contraste para personas con daltonismo deuteranópico/protanópico, y no cuenta con tabla alternativa accesible.

### Minor Observations

- Hay clases de Tailwind con errores de sintaxis en `executive-cockpit-header.tsx`: `py-0.2` (no existe en Tailwind CSS; debería ser `py-0.5` o `py-1`).
- En `prime-cost-stack-card.tsx`, se usan colores utilitarios de Tailwind (`bg-sky-500`, `bg-indigo-500`) en vez de las variables de gráficas OKLCH definidas en `DESIGN.md` (`chart-1`, `chart-2`, etc.).
- En la tarjeta del Copiloto, la textarea tiene un tamaño mínimo de 42px que puede sentirse pequeña para preguntas estratégicas largas, y no incluye un historial de consultas recientes.

### Questions to Consider

- ¿Deberían las 3 vistas cargarse simultáneamente en cliente para que el cambio entre Cockpit, Unit Economics y Flujo sea instantáneo con cero latencia?
- ¿Conviene agregar botones de acción inmediata (p.ej. "Aprobar sobregiro", "Enviar recordatorio por WhatsApp") directamente en la Cola de Decisiones sin salir del panel?
- ¿Debería la cascada P&L transformarse en un gráfico interactivo tipo Waterfall / Sankey que muestre visualmente las fugas de dinero entre sucursales?
