---
target: dashboard/labor/leave
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-11-15T17-22-50Z
slug: app-dashboard-labor-leave-page-tsx
---
Method: dual-agent (A: /root/design_review · B: /root/evidence_review)

Crítica de /dashboard/labor/leave. Modo Operate. Evaluación provisional basada en código: la ruta redirigió al inicio de sesión, por lo que no se verificó el diseño renderizado.

La oportunidad principal es convertir esta pantalla en una herramienta para decidir ausencias con contexto operativo. El lenguaje encaja con Pulso; la estructura todavía podría pertenecer a cualquier sistema de RH.

| Heurística | Puntuación /4 | Hallazgo |
|---|---:|---|
| Estado del sistema | 2 | Hay carga y confirmaciones; faltan errores visibles en saldos y calendario. |
| Lenguaje del mundo real | 3 | Español claro; falta contexto de sucursal y turno. |
| Control y libertad | 2 | Cancelación de pendientes y del diálogo; sin reversión de aprobación. |
| Consistencia | 3 | Componentes compartidos y pestañas etiquetadas. |
| Prevención de errores | 2 | Validación de fechas y motivo de rechazo; sin contexto de cobertura. |
| Reconocimiento | 2 | El calendario obliga a recordar identidades y estados. |
| Eficiencia | 1 | Sin búsqueda, filtro por sucursal ni gestión por lotes. |
| Estética y economía | 3 | Estructura contenida en código; apariencia sin verificar. |
| Recuperación de errores | 1 | Fallos que parecen vacíos y ausencia de reintento. |
| Ayuda | 1 | Hay descripciones; faltan próximos pasos cuando no existen saldos. |
| **Total** | **20/40** | **Aceptable, con mejoras importantes pendientes.** |

Fortalezas: cálculo y validación de fechas antes de enviar; regiones de carga anunciadas con role=status; rechazo con motivo obligatorio y explicación de que lo verá el empleado. El calendario móvil está planteado como agenda, una buena intención responsive aún sin verificar en navegador.

Prioridades:

1. **P1 — Un fallo de consulta puede parecer ausencia de datos.** leave-dashboard.tsx:44–58 termina la carga y conserva saldos vacíos sin comprobar response.ok; :103 muestra que no hay saldos configurados. leave-calendar.tsx:38–48 repite el patrón. Esto puede inducir a interpretar una consulta fallida como ausencia de permisos programados. Separar carga, vacío y error, con reintento. Comando: $impeccable harden.
2. **P1 — El calendario no permite interpretar ni explorar las ausencias.** leave-calendar.tsx:62–70 incluye pendientes y aprobadas sin distinguirlas; :154 y :196 muestran sólo nombres; :190–202 oculta personas detrás de un +N más no interactivo. Mostrar estado, identidad suficiente y detalle accesible por día o solicitud. Comando: $impeccable clarify y $impeccable harden.
3. **P2 — Los responsables entran por autoservicio y no descubren pendientes al llegar.** leave-dashboard.tsx:87–115 antepone saldos y selecciona Solicitar permiso para todos. El contador depende de la lista de aprobaciones (:180–204). Consultarlo independientemente y ofrecer entrada según rol. Comando: $impeccable shape.
4. **P2 — Aprobar requiere reunir contexto fuera de la solicitud.** leave-requests-list.tsx:243–303 ofrece botones sin sucursal, turno o ausencias coincidentes; el propio ejemplo de rechazo menciona falta de cobertura (:353). Incorporar el contexto disponible y diseñar el faltante antes de prometer cobertura. Comando: $impeccable shape.
5. **P2 — No tener saldos deja al usuario sin salida.** leave-dashboard.tsx:103 y leave-request-form.tsx:140–143 explican la ausencia de saldos, pero enviar queda deshabilitado (:277) sin indicar responsable o acción. Añadir siguiente paso según rol. Comando: $impeccable onboard.

Carga cognitiva: cuatro pestañas no prueban sobrecarga de opciones; el coste principal es cambiar de contexto y recordar nombres/estados. Los saldos desplazan la cola de trabajo del gerente. Recorrido emocional: entrada clara, frustración en saldos sin configurar, incertidumbre al aprobar y cierre limitado a un toast tras solicitar.

Personas: Alex necesita búsqueda, filtros y una entrada directa a pendientes. Sam encuentra etiquetas y anuncios de carga, pero no puede explorar +N más ni reconocer estados omitidos; teclado, contraste y zoom no verificados. El gerente de restaurante necesita juzgar el impacto sobre sucursal y servicio sin reunir datos en otras pantallas.

Detector: cero hallazgos en seis archivos: la ruta, leave-dashboard, leave-request-form, leave-balance-card, leave-calendar y leave-requests-list. Sin reglas activadas ni falsos positivos. No demuestra accesibilidad o usabilidad completas. El análisis de diseño aporta problemas de flujo que el detector no cubre.

Preguntas: ¿priorizar recuperación y calendario, o flujo del gerente? ¿Corregir primero ambos P1, o abordar los cinco problemas?
