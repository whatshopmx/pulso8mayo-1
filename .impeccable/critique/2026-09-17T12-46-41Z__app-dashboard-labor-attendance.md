---
target: dashboard/labor/attendance
total_score: 18
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 1
timestamp: 2026-09-17T12-46-41Z
slug: app-dashboard-labor-attendance
---
### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Filtros superiores e inferiores desincronizados; dos estados de carga independientes en la misma vista. |
| 2 | Match System / Real World | 2 | Mezcla de términos técnicos en inglés ("Overtime", "Break") con español; falta alineación a la jerga laboral mexicana (LFT, colación, horas extra). |
| 3 | User Control and Freedom | 2 | Sin paginación en la tabla de registros; botón "Exportar PDF" es un stub que solo muestra toast informativo. |
| 4 | Consistency and Standards | 1 | Severa duplicación: dos barras de filtros independientes y dos bloques de 4 tarjetas KPI con métricas repetidas y estilos dispares. |
| 5 | Error Prevention | 2 | Selectores de fecha sin validación de rango (fin < inicio); selectores con valores mockeados que llevan a tablas vacías sin advertencia. |
| 6 | Recognition Rather Than Recall | 2 | La alerta de ausencia muestra un ID técnico hash sin vincular ni resaltar la fila correspondiente en la tabla. |
| 7 | Flexibility and Efficiency | 2 | Sin atajos quincenales (esenciales para nómina en México) ni buscador textual rápido por empleado en la tabla. |
| 8 | Aesthetic and Minimalist Design | 1 | Sobrecarga cognitiva con 8 tarjetas KPI, 4 gráficas y 2 barras de filtros apiladas; uso de gradientes contrarios a la regla Flat-By-Default. |
| 9 | Error Recovery | 2 | Toasts genéricos de error ("Error al cargar reporte") sin diagnóstico ni reintento granular por sección. |
| 10 | Help and Documentation | 2 | Sin tooltips que expliquen cómo se clasifican las horas extra ni la diferencia entre turno activo y completado. |
| **Total** | | **18/40** | **Poor (45%)** |

### Design Specificity Verdict

**LLM Assessment**: La pantalla padece el "síndrome de dos plantillas pegadas". En lugar de ser un centro de mando unificado para dueños y gerentes de grupos restauranteros en México, la vista divide la experiencia en dos componentes disconexos (`AttendanceDashboard` y `AttendanceReport`). El primero ofrece visualizaciones analíticas con gráficas y KPIs; el segundo vuelve a pintar una barra de filtros (con datos de prueba hardcodeados como "Sucursal Centro" y "Juan Pérez"), otro juego de 4 tarjetas KPI redundantes y una tabla sin paginación. Carece de la cadencia operativa propia de la hospitalidad mexicana (turnos matutino/vespertino/cierre, nómina quincenal, cálculo de horas extra conforme a la LFT).

**Deterministic Scan**: `detect.mjs` completó el análisis de sintaxis y reglas de patrones estáticos sin violaciones de formato directo (0 findings). Las fallas principales son arquitectónicas y de experiencia de usuario (duplicación de estado, carga de opciones mock y ruptura de la jerga de dominio).

**Visual Overlays**: No hay overlay de navegador en vivo disponible debido a que la ruta `/dashboard/labor/attendance` requiere autenticación activa de sesión (redirección 307 a `/sign-in`). Se aplicó la evaluación estática y el modelado de interacción de código.

### Overall Impression

El módulo tiene una base funcional valiosa (registro de checadas, horas efectivas y cálculo de tiempo extra), pero la experiencia visual está fracturada por una duplicación innecesaria de componentes. Eliminar la redundancia y consolidar la vista en un solo panel de control elevará instantáneamente la claridad y confianza del usuario.

### What's Working

1. **Desglose de métricas clave**: La separación entre horas trabajadas, tiempo de break y tiempo extraordinario aborda directamente las necesidades de auditoría laboral en restaurantes.
2. **Banner contextual de incidencias**: `AbsenceFocusBanner` detecta incidencias por `sessionId` y ofrece la acción explícita "Limpiar enfoque".
3. **Mapeo de estado en tabla**: El uso de badges semánticos para el estado del turno (Completado, Activo, No se presentó) permite escaneo rápido cuando la tabla tiene datos.

### Priority Issues

- **[P0] Duplicación Arquitectónica y Conflicto de Filtros / KPIs**:
  - **Why it matters**: Al tener dos barras de filtros y dos bloques de métricas que no sincronizan su estado, el usuario recibe información contradictoria y pierde confianza en los números de asistencia y nómina.
  - **Fix**: Consolidar en una sola barra de control superior (Sucursal, Rango de Fecha / Quincena, Búsqueda de Colaborador) y un único bloque unificado de tarjetas KPI.
  - **Suggested command**: `$impeccable distill`

- **[P1] Mockups Hardcodeados y Stubs de Exportación**:
  - **Why it matters**: Opciones quemadas (`branch-1`, `user-1`) y un botón "Exportar PDF" que solo arroja un toast de "próximamente" rompen el estándar de un producto SaaS profesional.
  - **Fix**: Conectar el filtrado de colaboradores a los datos reales de la sucursal seleccionada y habilitar la exportación real o remover el stub.
  - **Suggested command**: `$impeccable harden`

- **[P2] Ausencia de Jerga y Ritmo Operativo Restaurantero Mexicano**:
  - **Why it matters**: El uso de términos en inglés ("Break", "Overtime") y presets genéricos de software ("7d", "30d", "90d") no responde al ciclo real de nómina quincenal ni a los turnos de servicio en México.
  - **Fix**: Incorporar selector de "Esta Quincena" / "Quincena Anterior", y estandarizar la terminología a "Horas Extra (LFT)", "Tiempo de Descanso / Colación".
  - **Suggested command**: `$impeccable clarify`

- **[P3] Ruptura del Sistema de Diseño en Gráficas (Elevation y Colores)**:
  - **Why it matters**: Las gráficas de Recharts utilizan gradientes (`linearGradient`) y clases Tailwind de color desalineadas, contraviniendo el principio *Flat-By-Default* y la paleta OKLCH de `DESIGN.md`.
  - **Fix**: Homogeneizar las gráficas con colores sólidos del sistema de tokens OKLCH y retirar efectos de degradado y sombras.
  - **Suggested command**: `$impeccable polish`

### Persona Red Flags

- **Don Roberto (Director / Dueño de Cadena - 12 sucursales)**:
  - *Red flag*: Al abrir la vista, se topa con dos conjuntos de tarjetas que le dan cifras ligeramente distintas según qué botón apretó. No puede ver un corte por quincena para autorizar el pago de tiempo extraordinario sin calcular días manualmente en un calendario.
- **Valeria (Gerente de Sucursal en turno)**:
  - *Red flag*: Si hay una ausencia marcada en el banner superior, no puede hacer clic para ver directamente la ficha del empleado afectado en la tabla. En el filtro inferior, le aparecen nombres ficticios ("Juan Pérez") en vez del personal de su propia cocina.
- **Sam (Auditor de Accesibilidad)**:
  - *Red flag*: Las gráficas SVG de Recharts no exponen tablas accesibles equivalentes ni atributos ARIA descriptivos, dejando a usuarios de lectores de pantalla sin acceso a las tendencias de asistencia.

### Minor Observations

- El botón de refresco gira (`animate-spin`) en el bloque superior, pero no provee retroalimentación visual al usuario en la tabla inferior.
- El cálculo de porcentaje en "Turnos Completados" muestra `0%` si no hay registros, pero no aclara si es por falta de datos o por inasistencia total.
- La tabla carece de paginación o scroll virtualizado; un periodo de 90 días con 50 empleados colapsaría el rendimiento del DOM.

### Questions to Consider

- ¿Debería la vista de asistencia organizarse por turnos de servicio (Apertura, Intermedio, Cierre) en lugar de una lista cronológica pura?
- ¿Tiene sentido mantener 4 gráficas distintas simultáneas, o sería más efectivo un panel de control con tabs que priorice la tabla de incidencias?
- ¿Cómo debería reflejarse el límite legal de horas extra de la LFT (máximo 3 horas diarias / 9 horas semanales) para alertar sobrecostos o riesgos laborales?
