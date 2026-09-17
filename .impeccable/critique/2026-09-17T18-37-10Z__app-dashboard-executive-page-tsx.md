---
target: dashboard/executive
total_score: 39
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
timestamp: 2026-09-17T18-37-10Z
slug: app-dashboard-executive-page-tsx
---
### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Vistas en cliente (0 ms) con subrayado activo y URL sincronizada; liquidez con proyección preliminar real y línea y=0. Residual: el refresh del Twin en servidor no tiene feedback en cliente. |
| 2 | Match System / Real World | 4 | Calendario gastronómico mexicano completo (Nómina 15/30, IMSS día 17, abasto viernes, rentas 1-5), piso de Prime Margin 40%, MXN/es-MX, WhatsApp en lenguaje de Dirección. |
| 3 | User Control and Freedom | 4 | Acciones inline (Autorizar / Diferir / WhatsApp) **persistidas en `executive_decisions`** con hidratación al montar, Deshacer que revierte de verdad y reversión optimista si la API falla. |
| 4 | Consistency and Standards | 4 | Piso de 12px cumplido (detector: 0 hallazgos); 100% de la UI en runtime consume tokens OKLCH (`success`/`warning`/`destructive`/`chart-*`); el chart muerto con paleta hex fue eliminado. |
| 5 | Error Prevention | 4 | Deshacer cubre el autorizar de 1 clic; botones deshabilitados durante persistencia; `maxLength` 500; `ifOverflow="extendDomain"` para barras negativas; radios por signo. |
| 6 | Recognition Rather Than Recall | 4 | 4 signos vitales jerarquizados; badges contextuales por pestaña; leyenda-cascada doble como tabla; cada escalón con % de ventas. |
| 7 | Flexibility and Efficiency | 4 | Atajos de teclado 1/2/3, flechas Radix, deep-links por vista, export "Exportar (PDF)" con hoja de impresión que excluye navegación. |
| 8 | Aesthetic and Minimalist Design | 4 | Cascada deductiva real; Operational Red confinado a semántica de alerta (~10%); pestañas tonales; plano con capa tonal. |
| 9 | Error Recovery | 4 | Contingencia calculada cuando el Twin no publica serie; toasts específicos con revert optimista; estado vacío legible; Deshacer en la cola. |
| 10 | Help and Documentation | 3 | Captions (regla del 60%, piso 40%, hitos), tooltips con sucursal responsable, `aria-label` y tabla accesible. El modelo causal del Executive Twin (por qué cada score) sigue sin explicarse en línea. |
| **Total** | | **39/40** | **Excellent (97.5%)** |

### Design Specificity Verdict

**LLM Assessment**: La cabina ejecutiva queda en estado de envío. Desde el critique previo se cerraron las tres brechas priorizadas: (1) la rutina de 60 segundos ahora es confiable — cada Autorizar/Diferir escribe en `executive_decisions` vía `/api/executive/decisions` con guard ABAC (`reports:manage` para escribir, `read` para leer), la cola se hidrata desde el servidor y el badge de pendientes decrece con datos reales, no memoria de cliente; (2) la deriva de tokens desapareció — los badges `emerald-500`/`amber-500` consumen `success`/`warning` OKLCH y el único archivo con paleta hex (`ComplianceTrendChart`, código muerto sin imports) fue eliminado del árbol; (3) la eficiencia executiva ganó atajos 1/2/3 y "Exportar (PDF)" con `@media print` que imprime la vista activa sin sidebar ni pestañas. La brecha restante es la única: la cabina dice *qué* (health 88, drift 12, liquidez 22) pero no explica *por qué* el Twin llegó a cada número — el "por qué" causal que un director necesitaría para confiar o cuestionar la lectura en una junta.

### Priority Issues

- **[P2] El modelo causal del Twin no se explica en línea (última brecha de H10)**:
  - **Why it matters**: los signos vitales muestran resultados (health 88, drift 12, liquidez 22) sin el razonamiento que los produce; el director debe confiar ciegamente o salir a otra vista. En una junta, la primera pregunta siempre es "¿de dónde sale el 88?".
  - **Fix**: tooltip o expandible "¿Por qué este número?" que muestre las 2-3 causas principales que alimentan cada score (ya existen en `engineSnapshots.insights`, hoy sin consumir en la cabecera).
  - **Suggested command**: `$impeccable clarify`

### Minor Observations

- El copiloto mantiene el historial de consultas sólo en memoria; "consultas recientes" permitiría repetir simulaciones frecuentes.
- `openWhatsApp` usa `window.open` sin devolver el foco a la página tras el gesto (lectores de pantalla quedan en la pestaña nueva).
- Housekeeping del repo: `exec-cockpit.html` en la raíz es un artefacto de depuración anterior; moverlo a `docs/` o eliminarlo.
- Las resoluciones "diferidas" no reabren solas tras 24 h; requeriría un job de Inngest que revive casos diferidos cuyo plazo expiró.

### Questions to Consider

- ¿El "¿por qué este número?" del Twin se muestra como tooltip del signo vital o como panel expandible debajo de la cabecera?
- ¿Los casos diferidos deben revivir automáticamente a las 24 h (cron) o requieren revisión manual?
