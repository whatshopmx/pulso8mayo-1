---
target: dashboard/labor/overtime
total_score: 16
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
timestamp: 2026-09-17T13-45-42Z
slug: app-dashboard-labor-overtime-page-tsx
---
### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 1 | Pantalla vacía al entrar (sin auto-fetch en montaje); las 4 tarjetas KPI desaparecen provocando salto de layout; botón de actualizar sin feedback granular. |
| 2 | Match System / Real World | 2 | Cita los artículos 68 y 69 de la LFT pero no proyecta el costo monetario en MXN ni advierte sobre el tope de 9h semanales; nombres de empleados cortados a primer nombre en gráficas. |
| 3 | User Control and Freedom | 2 | Sin presets quincenales (fundamentales para la nómina mexicana); sin enlaces ni navegación hacia el módulo de Solicitudes de Horas Extras (`/requests`). |
| 4 | Consistency and Standards | 1 | Dos botones idénticos en rojo primario sólido saturando la vista; selectores nativos `<input type="date">` desfasados; colores Recharts por defecto (`#8884d8`, `#82ca9d`); fuente de 10px violando la regla Label-Floor (mínimo 12px). |
| 5 | Error Prevention | 1 | No valida rango de fechas (permite fin < inicio o fechas futuras); no previene ni alerta si un empleado acumula horas ilegales bajo la Ley Federal del Trabajo. |
| 6 | Recognition Rather Than Recall | 2 | El usuario debe calcular mentalmente el costo o recargo financiero de las horas dobles y triples; no hay sumatorias ni agrupaciones por sucursal o puesto. |
| 7 | Flexibility and Efficiency | 1 | Sin exportación a CSV/Excel para el sistema contable; sin buscador de colaboradores ni ordenamiento por columnas en la tabla; sin acciones por lote. |
| 8 | Aesthetic and Minimalist Design | 1 | "Sopa de badges" saturando cada celda de la tabla; columna "Total Overtime" en badge rojo destructivo incluso cuando el valor es 0h 0m; cajas de gráficas vacías al inicio. |
| 9 | Error Recovery | 2 | Toasts genéricos ("Error al cargar el reporte de overtime") sin diagnóstico contextual ni botón de reintento en el componente. |
| 10 | Help and Documentation | 3 | Tarjeta inferior con explicaciones claras de los Artículos 68 y 69 de la LFT, aunque presentada como texto estático desconectado de la operativa. |
| **Total** | | **16/40** | **Poor (40%)** |

### Design Specificity Verdict

**LLM Assessment**: La pantalla de Horas Extras exhibe síntomas claros de plantilla genérica de dashboard que no ha sido aterrizada a la realidad operativa de la industria HORECA en México. En lugar de funcionar como una herramienta de control financiero y blindaje laboral (donde cada hora extra representa un sobrecosto del 100% o 200% y un riesgo de demanda ante la Junta/Centro de Conciliación), parece un demo técnico desconectado: gráficas con colores stock de Recharts (`#8884d8` y `#82ca9d`), inputs nativos de fecha sin estilo, dos botones rojos idénticos y una tabla que envuelve absolutamente cada número en un badge. La vista está aislada de su contraparte operativa natural (`/requests`), impidiendo que el supervisor resuelva solicitudes o apruebe horas desde este panel.

**Deterministic Scan**: `detect.mjs` completó el análisis de sintaxis estática sobre el directorio y componentes sin violaciones de regex directas (0 findings). Las deficiencias críticas son de arquitectura visual, estado inicial, jerarquía de controles y apego a los tokens de `DESIGN.md`.

**Visual Overlays**: Inspección visual completada mediante automatización de navegador en resoluciones desktop y modos claro/oscuro. Se constató el inicio con datos en blanco, salto abrupto al cargar, badge de overtime en rojo permanente incluso con 0 horas, y selector de fecha nativo desfasado visualmente en modo oscuro.

### Overall Impression

El módulo cuenta con una sólida base de cálculo legal (separando horas diurnas al 2x, nocturnas al 3x y festivos al 3x), pero la interfaz actual genera frustración al usuario: entra y ve una pantalla vacía, compiten dos botones rojos para la misma tarea, la tabla sufre de saturación visual por exceso de badges, y no existe conexión con las solicitudes de aprobación ni exportación para nómina. Con una reestructuración de controles y un diseño de datos más limpio, este módulo puede transformarse en una herramienta indispensable de control laboral para la cadena.

### What's Working

1. **Taxonomía legal LFT precisa**: La categorización técnica entre horas diurnas (2x), nocturnas (3x), festivas (3x) y semanales (2x) es matemáticamente sólida y responde al marco regulatorio mexicano.
2. **Concepto de ranking Top 10**: Identificar rápidamente a los colaboradores con mayor acumulación de horas extra es la pregunta clave que se hace todo director de operaciones.
3. **Métricas clave consolidadas**: Una vez cargado, el desglose de Horas Regulares vs. Overtime y promedio por empleado ofrece una radiografía concisa del periodo.

### Priority Issues

- **[P0] Estado Inicial Vacío, Falta de Auto-fetch y Salto de Layout**:
  - **Why it matters**: Al cargar la página, `summary` es nulo y no hay `useEffect` de carga automática. El usuario se encuentra con un panel desolado (KPIs desaparecidos, gráficas en blanco y tabla vacía), asumiendo que el sistema falló.
  - **Fix**: Implementar carga automática al montar el componente, colocar skeletons en tarjetas KPI, gráficas y tabla, y precargar la quincena actual por defecto.
  - **Suggested command**: `$impeccable harden`

- **[P1] Duplicación de Filtros y Sobresaturación de Operational Red**:
  - **Why it matters**: Existen dos botones primarios rojos idénticos en la pantalla ("Actualizar" en el header y "Aplicar Filtros" en la tarjeta), mientras la barra superior del dashboard ya tiene selectores globales. Viola la regla de `DESIGN.md` de limitar el Operational Red al 10-15% de la interfaz.
  - **Fix**: Eliminar la tarjeta de filtros redundante. Unificar en una barra de herramientas ligera con selectores quincenales ("Esta quincena", "Quincena anterior") y un único botón secundario/outline de sincronización.
  - **Suggested command**: `$impeccable distill`

- **[P1] "Sopa de Badges" y Alarma Falsa en Tabla (Overtime en Rojo con 0 Horas)**:
  - **Why it matters**: Cada celda numérica está dentro de un `<Badge>`, destruyendo la legibilidad y la alineación tabular. Peor aún: `variant={totalOvertimeMinutes > 0 ? "destructive" : "default"}` hace que con 0 horas se pinte en rojo primario sólido, alarmando al gerente sin motivo.
  - **Fix**: Utilizar celdas numéricas limpias con fuente Mono alineadas a la derecha (`tabular-nums font-mono text-right`). Destacar en color o badge de atención únicamente a colaboradores que excedan el límite legal de 9 horas semanales (LFT Art. 68).
  - **Suggested command**: `$impeccable layout`

- **[P1] Ruptura del Sistema de Diseño en Gráficas (Paleta Stock y Violación Label-Floor)**:
  - **Why it matters**: El uso de `#8884d8` y `#82ca9d` contraviene los tokens de color del sistema. Las etiquetas de ejes a 10px (`fontSize: 10`) violan la regla estricta de `DESIGN.md` que prohíbe fuentes menores a 12px, haciéndolas ilegibles en tablets operativas.
  - **Fix**: Aplicar tokens CSS del sistema para barras y sectores circulares, elevar el tamaño de etiquetas a 12px y adaptar tooltips/grid al tema oscuro.
  - **Suggested command**: `$impeccable polish`

- **[P2] Flujo de Trabajo Incompleto: Sin Enlace a Solicitudes ni Exportación de Nómina**:
  - **Why it matters**: La pantalla funciona como un callejón sin salida. Existe el módulo `/dashboard/labor/overtime/requests`, pero no hay forma de navegar hacia él ni de aprobar horas extra desde aquí. Tampoco se puede descargar un CSV para el cálculo de nómina quincenal.
  - **Fix**: Incorporar navegación por pestañas (Pestaña "Reporte y Análisis" y Pestaña "Solicitudes Pendientes") y botón de descarga/exportación contable.
  - **Suggested command**: `$impeccable shape`

### Persona Red Flags

- **Alex (Director de Operaciones / Dueño de Grupo Restaurantero - 15 sucursales)**:
  - *Red flag*: Al abrir la pantalla ve un espacio en blanco. Al hacer clic en actualizar, no puede ver el impacto en dinero ($ MXN) de esas horas extras para calcular el costo laboral de la semana, ni puede filtrar por sucursales específicas de forma sincronizada con el selector global.
- **Roberto (Gerente de Turno / Chef Ejecutivo en Cocina)**:
  - *Red flag*: En su tablet durante el cierre de cocina, ve todos los badges de tiempo extra en rojo brillante, confundiéndolo sobre quién realmente se excedió de su jornada legal. No puede aprobar desde aquí la media hora extra que se quedó el lavaloza para el cierre.
- **Sam (Auditor de Cumplimiento RH y Accesibilidad)**:
  - *Red flag*: Los campos de fecha nativos no tienen etiquetas accesibles para lectores de pantalla en ciertos navegadores, el texto a 10px en los ejes no cumple con pautas de legibilidad para usuarios con baja visión, y las gráficas carecen de resúmenes textuales accesibles.

### Minor Observations

- La gráfica de pastel muestra porcentajes pero no el número total de horas por categoría directamente en la leyenda.
- El nombre del empleado en el ranking Top 10 se trunca con `userName.split(" ")[0]`, lo que causa colisión y confusión si hay varios colaboradores con el mismo nombre de pila (ej. "Juan", "Juan").
- El card inferior informativo cita la ley pero no explica cómo se calcula el recargo monetario en base al salario diario integrado o cuota por hora del trabajador.

### Questions to Consider

- ¿Debería la métrica de Total Overtime mostrar también el costo proyectado en pesos ($ MXN) además de las horas acumuladas?
- ¿Conviene unificar en una misma vista la aprobación de solicitudes pendientes (`/requests`) y el análisis histórico mediante pestañas?
- ¿Cómo alertar visualmente cuando un trabajador alcance o supere las 9 horas extras semanales para evitar multas laborales de la STPS?
