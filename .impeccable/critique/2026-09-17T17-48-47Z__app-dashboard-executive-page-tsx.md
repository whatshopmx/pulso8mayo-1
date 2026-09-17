---
target: dashboard/executive
total_score: 36
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
timestamp: 2026-09-17T17-48-47Z
slug: app-dashboard-executive-page-tsx
---
### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Cambio de vistas en cliente (0 ms) con subrayado activo y URL sincronizada; la vista de liquidez muestra proyección preliminar real con badge "Proyección preliminar" en vez del recuadro punteado inerte; línea y=0 delimita insolvencia. Residual: el refresh del Twin en servidor no tiene feedback en cliente. |
| 2 | Match System / Real World | 4 | Calendario gastronómico mexicano completo (Nómina 15/30, IMSS día 17, abasto viernes, rentas 1-5), piso de Prime Margin 40%, formatos MXN/es-MX, mensaje de WhatsApp redactado en lenguaje de Dirección con enlace de evidencia. |
| 3 | User Control and Freedom | 3 | Acciones inline (Autorizar / Diferir 24 h / WhatsApp al Gerente) con Deshacer; deep-links por vista con popstate. Gap: las resoluciones viven sólo en `useState` — una recarga las pierde y el contador del servidor no decrece. |
| 4 | Consistency and Standards | 3 | Piso de 12px cumplido en todo el árbol (detector: 0 hallazgos); gráficas tokenizadas (`var(--success)`, `var(--destructive)`, `chart-4/6`). Deriva menor: badges `emerald-500`/`amber-500` en PrimeCostStackCard fuera del sistema OKLCH. |
| 5 | Error Prevention | 4 | Deshacer cubre el autorizar de 1 clic; `maxLength` 500, estados deshabilitados durante carga, `ifOverflow="extendDomain"` para barras negativas, radios condicionales por signo. |
| 6 | Recognition Rather Than Recall | 4 | Signos vitales reducidos a 4 métricas jerarquizadas (antes 10 planas); badges contextuales por pestaña; leyenda-cascada doble como tabla de datos; cada escalón con % de ventas. |
| 7 | Flexibility and Efficiency | 3 | Navegación por flechas nativa de Radix, deep-links, escala dinámica de Prime Cost. Falta: atajos 1/2/3 para las vistas y export ejecutivo (PDF/CSV) para juntas de consejo. |
| 8 | Aesthetic and Minimalist Design | 4 | Cascada P&L real conectada (base invisible + escalones flotantes) reemplaza la cuadrícula de 4 tarjetas; pestañas tonales con subrayado de 2px; Operational Red confinado a semántica de alerta (~10%). |
| 9 | Error Recovery | 4 | Proyección de contingencia calculada cuando el Twin no publica serie; errores del copiloto con toast específico; estado vacío legible en gráficas; Deshacer en la cola. |
| 10 | Help and Documentation | 3 | Captions explicativos (regla del 60%, piso 40%, hitos), tooltips con sucursal responsable, `aria-label` en escalones y tabla accesible. El "por qué" causal del Executive Twin no se explica en línea. |
| **Total** | | **36/40** | **Excellent (90%)** |

### Design Specificity Verdict

**LLM Assessment**: La cabina ejecutiva cumple lo prometido en el plan de refinamiento y lo verifica el detector: 0 microtextos, 0 hex hardcodeados en los archivos activos, pestañas en cliente con URL sincronizada sin navegación RSC. La vista de liquidez ya no puede parecer rota: si el Twin no ha publicado serie, `buildPreliminaryProjection` calcula un horizonte de 14 días con supuestos explícitos, lo marca como preliminar y dibuja el umbral de insolvencia con `ReferenceLine y={0}`. La "cascada" es ahora un puente deductivo verdadero (Ventas → −Insumos → =Margen Bruto → −Nómina → =Prime Margin → −OpEx → =EBITDA) con piso de Prime Margin al 40%, resaltado de la mayor fuga de red y acceso directo al drawer `PnlAuditDrawer` desde cualquier escalón, con lista accesible alternativa. La cola de decisiones se despacha sin salir de la cabina (Autorizar/Diferir/WhatsApp con mensaje pre-redactado y evidencia) y admite Deshacer. La brecha principal que queda es de confianza, no de forma: las resoluciones no persisten en el backend, así que la "rutina de 60 segundos" se olvida al recargar; y la deriva menor de tokens (`emerald-500`, `amber-500`) rompe la promesa OKLCH en dos badges.

### Priority Issues

- **[P1] Las resoluciones de la Cola de Decisiones no persisten (confianza en la rutina de 60 segundos)**:
  - **Why it matters**: `ExecutiveDecisionDeck` guarda `resolutions`/`whatsappSent` en `useState`. Al recargar (o abrir la pestaña en otra máquina), las autorizaciones despachadas reaparecen como pendientes y el badge `pendingDecisionsCount` — calculado en el servidor con brief + anomalías — no decrece. El director no puede confiar en que "ya lo despaché".
  - **Fix**: persistir cada resolución vía API (`PATCH /api/executive/decision/[id]` con estado y autor), rehidratar al montar y derivar el contador restante de los casos sin resolución.
  - **Suggested command**: `$impeccable harden`

- **[P2] Deriva de tokens en `PrimeCostStackCard`**:
  - **Why it matters**: el badge de promedio usa `bg-emerald-500/10 text-emerald-600` y las severidades de anomalías `bg-amber-500 text-white`; fuera del sistema OKLCH y con contraste frágil en modo oscuro.
  - **Fix**: `bg-success/10 text-success-text` y `bg-warning text-warning-foreground` (idéntico rol visual, token del sistema).
  - **Suggested command**: `$impeccable polish`

- **[P2] Sin export ejecutivo ni atajos de vista**:
  - **Why it matters**: Alex llega a la junta de consejo y no puede llevar un PDF del estado (signos vitales + cascada + caja a 14 días); alternar vistas exige clic o flechas, no hay atajos 1/2/3.
  - **Fix**: botón "Exportar para Consejo" (print stylesheet o CSV) y `onKeyDown` global para las 3 vistas.
  - **Suggested command**: `$impeccable optimize`

### Persona Red Flags

- **Alex (Dueño / Director General de Grupo Restaurantero - 8 sucursales)**:
  - *Red flag*: Despacha 4 autorizaciones antes del servicio de mediodía, recarga por una llamada del gerente de Roma… y las 4 vuelven a "pendiente". Sin persistencia, la cola miente.
- **Roberto (Socio Operador / Director de Alimentos y Bebidas)**:
  - *Red flag*: La cascada le muestra el puente y la sucursal fugada; para la junta necesita llevar el estado impreso y hoy no hay export. La leyenda-cascada sí le sirve como tabla de lectura rápida.
- **Sam (Auditor de Cumplimiento RH y Accesibilidad)**:
  - *Red flag*: Piso de 12px cumplido, tabla accesible bajo `<details>` y `aria-label` en escalones. En runtime no ve los hex del chart muerto; el riesgo contrastivo queda en los badges `amber-500 text-white`.

### Minor Observations

- `ComplianceTrendChart` es código muerto dentro del árbol executive (sin imports en runtime) y conserva la paleta hex (`#10b981`, `#3b82f6`, …); eliminarlo o tokenizarlo si se reusa.
- El copiloto mantiene el historial de consultas sólo en memoria; sin "consultas recientes" para repetir simulaciones.
- `openWhatsApp` usa `window.open` sin devolver el foco a la página tras el gesto (lectores de pantalla quedan en la pestaña nueva).

### Questions to Consider

- ¿Las resoluciones deben persistir en backend (auditoría formal) o basta `localStorage` por dispositivo con contador derivado?
- ¿El export de consejo es PDF (print CSS) o CSV/Excel para el contador?
- ¿Se elimina `ComplianceTrendChart` o se tokeniza para reuso futuro?
