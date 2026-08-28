 ---
target: app/dashboard/audit
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-28T14-58-21Z
slug: app-dashboard-audit
---
#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Indicadores de carga y conteo de paginación claros; falta indicador visual de filtros activos en la cabecera. |
| 2 | Match System / Real World | 2 | Colisión conceptual: parece un log de servidor (IPs, JSON técnico) en vez de una bitácora de trazabilidad operativa HORECA; métrica "Evidencias" mapeada internamente a `INCIDENT`. |
| 3 | User Control and Freedom | 3 | Buen control con botón "Limpiar filtros", exportación CSV y modal detallado; faltan filtros rápidos predefinidos (Hoy, Turno actual, Críticos). |
| 4 | Consistency and Standards | 2 | Badges usan paleta arcoíris no estandarizada (`bg-purple-100`, `bg-pink-100`, `bg-yellow-100`) en lugar de tokens OKLCH; inputs de fecha nativos difieren visualmente de los selects tipo popover. |
| 5 | Error Prevention | 3 | Comboboxes con búsqueda evitan IDs inválidos; falta validación cruzada para evitar que "Fecha desde" sea posterior a "Fecha hasta". |
| 6 | Recognition Rather Than Recall | 3 | Selects con buscador facilitan encontrar usuarios y sucursales; falta un listado de chips para identificar y remover filtros activos de un vistazo. |
| 7 | Flexibility and Efficiency | 2 | Sin atajos de teclado ni presets de fecha ("Últimas 24h", "Esta semana", "Incidentes"); auditorías frecuentes requieren múltiples clics manuales. |
| 8 | Aesthetic and Minimalist Design | 2 | Altura total excesiva (~1912px); tarjeta estática inferior de "Información de Auditoría" ocupa demasiado espacio operativo; exceso de colores saturados en badges. |
| 9 | Error Recovery | 3 | Buen estado vacío informativo con ícono y texto cuando la búsqueda no arroja registros; alertas toast descriptivas ante errores de red. |
| 10 | Help and Documentation | 3 | Explicación detallada de retención y payload JSON disponible con botón de copiado rápido; la tarjeta de documentación debería ser un popover o drawer discreto. |
| **Total** | | **26/40** | **Aceptable (65%)** |

#### Design Specificity Verdict

**LLM assessment**: La pantalla actual funciona como un visor genérico de logs de auditoría de sistema (estilo CloudTrail o consola DevOps), pero carece de identidad y especificidad para la operación HORECA. En el contexto de Pulso (cadenas de restaurantes y hoteles), los supervisores y directores de calidad buscan trazabilidad operativa: turnos (apertura/cierre), checklist de temperaturas NOM-251, incidencias sanitarias y acciones críticas de usuarios (elevación de roles, eliminación de sucursales). Presentar direcciones IP con la misma jerarquía que sucursales o roles distrae de la supervisión de campo.

**Deterministic scan**: El detector estático analizó el componente y subdirectorios de `app/dashboard/audit` reportando 0 violaciones de reglas duras (`[]`).

**Visual inspection**: En la inspección en vivo en el navegador, la interfaz muestra una tipografía Geist consistente y tonal layering plano. Sin embargo, se detectaron 3 problemas visuales notables: (1) Las métricas superiores muestran "Usuarios: 0" y "Evidencias: 9" (calculado a partir de incidentes, lo cual genera discrepancia terminológica); (2) La tarjeta de filtros y la tabla presentan una altura combinada que empuja una enorme tarjeta de documentación al fondo; (3) Los badges de recursos usan 7 variantes de color arbitrarias (`blue`, `purple`, `orange`, `green`, `yellow`, `pink`, `red`) que introducen ruido visual innecesario.

#### Overall Impression
Una interfaz funcional y robusta para consultar eventos del sistema, con excelente soporte de filtrado reactivo y modal de detalle estructurado con exportación JSON. Su principal oportunidad radica en evolucionar de un log técnico de base de datos a un centro de **Trazabilidad y Control Operativo HORECA**, puliendo la consistencia de tokens de color, simplificando la huella vertical y agregando presets operativos de búsqueda rápida.

#### What's Working
1. **Filtrado reactivo con búsqueda instantánea**: La integración con debounce en el campo de búsqueda filtra registros al vuelo con retroalimentación inmediata en la paginación y tabla.
2. **Modal de inspección con visor y copiado JSON**: La vista detallada separa eficazmente la información amigable para humanos de los datos técnicos para soporte, con botón de copiado en 1 clic.
3. **Selectores con búsqueda interna (Comboboxes)**: Los componentes `SearchableSelect` permiten filtrar eficazmente listas largas de usuarios y sucursales sin desbordar el viewport.

#### Priority Issues

- **[P1] Consistencia de tokens y saturación cromática en Badges**:
  - *Why it matters*: Los badges de `resourceType` emplean clases Tailwind crudas (`bg-purple-100 text-purple-800`, `bg-pink-100`, `bg-yellow-100`, etc.) fuera de la paleta semántica OKLCH de Pulso. Esto rompe la regla de usar color funcional (Red operacional al 10-15%, Success, Warning, Muted) y genera fatiga visual.
  - *Fix*: Mapear los tipos de recursos a tokens semánticos discretos (ej. `secondary`/`outline` neutro para recursos estándar, `warning`/`destructive` solo para incidentes y eliminaciones).
  - *Suggested command*: `$impeccable colorize app/dashboard/audit`

- **[P1] Desconexión terminológica en métricas ("Evidencias" vs "Incidentes")**:
  - *Why it matters*: La tarjeta de estadísticas "Evidencias" cuenta registros con `resourceType === "INCIDENT"`. En auditorías HORECA, una evidencia fotográfica o documental de NOM-251 es distinta a una incidencia sanitaria o de seguridad. Además, "Usuarios: 0" aparece como métrica vacía cuando hay logs de usuarios en el sistema.
  - *Fix*: Renombrar métricas a conceptos operativos precisos ("Eventos Totales", "Flujos y Checklists", "Incidencias Críticas", "Acciones de Usuarios") y asegurar que el filtro cuente correctamente.
  - *Suggested command*: `$impeccable clarify app/dashboard/audit`

- **[P2] Reducción de carga cognitiva y optimización de huella vertical**:
  - *Why it matters*: La página mide más de 1900px de alto. La tarjeta inferior "Información de Auditoría" (800px de contenido estático y política de retención) compite con la tabla de datos principal.
  - *Fix*: Convertir la información estática y políticas de retención en un botón/modal de ayuda contextual ("?", Tooltip o Drawer) en el header, permitiendo que la tabla sea el protagonista absoluto de la vista.
  - *Suggested command*: `$impeccable distill app/dashboard/audit`

- **[P2] Presets de filtrado temporal y chips de filtros activos**:
  - *Why it matters*: Para un director de operaciones que audita incidentes del día o del turno anterior, ingresar fechas manualmente en inputs nativos HTML es lento e ineficiente.
  - *Fix*: Añadir botones de rango rápido ("Hoy", "Últimas 24h", "Esta semana", "Solo incidentes") y mostrar chips removibles con los filtros activos.
  - *Suggested command*: `$impeccable layout app/dashboard/audit`

- **[P3] Homogeneización de controles de fecha**:
  - *Why it matters*: Los campos `<Input type="date" />` nativos se ven planos y heterogéneos frente a los popovers estilizados de los menús desplegables.
  - *Fix*: Implementar un DateRangePicker integrado con el diseño de Radix UI / shadcn del proyecto.
  - *Suggested command*: `$impeccable polish app/dashboard/audit`

#### Persona Red Flags

**Alex (Director de Operaciones / Multi-sucursal)**:
- Para auditar qué sucursal tuvo incidentes hoy en el servicio de comida, Alex debe abrir manualmente los filtros de fecha, seleccionar la fecha en el picker nativo, luego ir al tipo de recurso y seleccionar "Evidencia". La falta de un preset "Incidentes de hoy" o selector de severidad le toma más de 5 pasos cuando debería ser un solo clic.

**Jordan (Gerente de Turno / Primera vez)**:
- Se confunde al ver la tarjeta superior "Evidencias: 9" pero en la tabla las filas dicen `INCIDENT_DETECTED` en rojo. Además, la columna "IP" (`192.168.1.45`) le resulta irrelevante para resolver una discrepancia de inventario o checklist de cocina.

**Sam (Auditor NOM-251 / A11y & Contrastes)**:
- Los badges de fondo amarillo (`bg-yellow-100 text-yellow-800`) y rosa (`bg-pink-100 text-pink-800`) presentan riesgos de contraste en pantallas de tabletas con brillo reducido en áreas de cocina o almacén. Los inputs de fecha nativos carecen de etiquetas descriptivas asociadas mediante `aria-labelledby` o IDs explícitos.

#### Minor Observations
- La columna de IP ocupa un espacio horizontal valioso en pantallas medianas; podría reubicarse dentro del modal de detalles o condensarse en una vista secundaria.
- El botón "Exportar" en la cabecera no indica claramente el formato ("Exportar CSV") ni muestra estado de carga durante exportaciones de gran volumen.
- Los iconos en las 4 tarjetas de métricas repiten `FileText` dos veces; podrían tener iconos más representativos (`Activity`, `AlertCircle`, `Users`, `Layers`).

#### Questions to Consider
- "¿Debería esta vista llamarse 'Bitácora de Trazabilidad' para distinguirse claramente de las 'Auditorías de Calidad NOM-251 e Inventario'?"
- "¿Es necesario mostrar la columna de IP en la tabla principal o es suficiente mantenerla dentro del modal de detalles técnicos?"
- "¿Qué atajos de filtrado rápido resolverían el 80% de las consultas diarias de los directores de sucursal?"
