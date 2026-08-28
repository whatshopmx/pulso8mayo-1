---
target: app/dashboard/finance/treasury
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-08-28T01-14-37Z
slug: app-dashboard-finance-treasury
---
# Impeccable Design Critique: Tesorería (Dashboard Finance)

#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Fechas de vencimiento tienen badges de urgencia, pero descargas de layouts y estados de corrida no ofrecen feedback de progreso. |
| 2 | Match System / Real World | 3 | Excelente terminología financiera mexicana (SPEI, CFDI 3-way match, dispersión), pero discrepancias en enums (`SERVICIO_BASICO` sin mapear). |
| 3 | User Control and Freedom | 2 | Modales tienen cancelación, pero las corridas de pago y contratos no son editables tras su creación; botones de pie de tarjeta no responden. |
| 4 | Consistency and Standards | 1 | Fragmentación severa de estados (`COMPLETED`/`CANCELLED` vs `EXECUTED`/`REJECTED`), mezclas de dos librerías de toast (`sonner` y `use-toast`), y select HTML nativo. |
| 5 | Error Prevention | 2 | Modal de contratos recurrentes asigna un `supplierId` nulo en ceros (`00000000-...`); falta confirmación para cancelaciones de corridas. |
| 6 | Recognition Rather Than Recall | 2 | Tarjetas KPI sintetizan montos globales, pero la tabla principal no permite inspeccionar facturas asociadas ni enlaza al detalle. |
| 7 | Flexibility and Efficiency | 2 | Filtros rápidos y descarga directa de layout SPEI; carece de atajos de teclado, acciones en lote y selector de layout bancario (Banorte/BBVA). |
| 8 | Aesthetic and Minimalist Design | 3 | Estructura limpia de tarjetas planas sin sombras; saturación de fórmulas de color ad-hoc y select nativo sin estilizar. |
| 9 | Error Recovery | 2 | Errores genéricos de red ("Error de conexión") sin detalle ni sugerencias de recuperación guiada. |
| 10 | Help and Documentation | 2 | Textos descriptivos en modales sobre 3-way matching, pero nula explicación sobre formatos bancarios requeridos o ventanas de corte SPEI. |
| **Total** | | **21/40** | **Aceptable (52.5%)** |

#### Design Specificity Verdict

**LLM assessment**: La interfaz de Tesorería demuestra un entendimiento conceptual sobresaliente del negocio HORECA mexicano y sus retos operativos (conciliación de facturas 3-way match, gastos fijos de local/CFE, dispersión masiva SPEI). Sin embargo, a nivel de interacción y arquitectura de frontend, sufre de desconexiones estructurales graves: las tablas funcionan como silos visuales que no enlazan a las vistas de detalle (`/runs/[id]`), los modales de captura inyectan datos simulados (UUID ceros) y los enums de estado están desalineados entre la vista general y la vista de detalle.

**Deterministic scan**: El escaneo estático `detect.mjs` no reportó antipatrones estructurales críticos directos (cero infracciones de layout CSS bloqueantes), confirmando que las tarjetas respetan la filosofía flat-by-default y tonal layering de `DESIGN.md`. Sin embargo, el análisis profundo de código reveló deuda técnica de coherencia (inyección de librerías de toast duplicadas, colores Tailwind en crudo como `bg-green-600` y `text-emerald-700`, y tags de estado sin mapeo).

#### Overall Impression
Un módulo con un cimiento conceptual y estético muy prometedor para la tesorería de cadenas restauranteras, pero que actualmente opera de forma fragmentada, con enlaces rotos a detalles de corrida, estados desconectados y contratos con proveedores simulados. Conectar los flujos de navegación, unificar la máquina de estados y limpiar los tokens de diseño transformará esta pantalla en el centro de comando financiero que promete ser.

#### What's Working
1. **KPIs Ejecutivos de Alto Impacto**: La barra superior con Egresos Programados, Gastos Fijos y Pendientes de Autorización responde de inmediato las preguntas críticas del dueño del grupo restaurantero.
2. **Cálculo de Urgencia en Vencimientos**: El helper `getDueDateUrgency` ("Vencido", "Vence hoy", "En 3d") aporta semáforos temporales claros para priorizar pagos de nómina y proveedores.
3. **Dispersión Directa de Layout SPEI**: La acción integrada para exportar archivos de transferencia bancaria directamente desde la fila de corrida simplifica el flujo operativo de tesorería.

#### Priority Issues

- **[P0] Aislamiento de Navegación y Acciones Huérfanas**
  - **Why it matters**: Las filas de la tabla "Próximas Corridas de Pago" no tienen enlaces ni interactividad para navegar a `/dashboard/finance/treasury/runs/[id]`. Los administradores no pueden ver qué facturas componen una corrida ni aprobarla desde la vista principal. Además, los botones "Ver calendario completo" y "Administrar contratos" son botones muertos sin handler.
  - **Fix**: Enlazar las filas y títulos de corrida hacia su ruta de detalle (`/dashboard/finance/treasury/runs/${run.id}`) y dirigir los botones de pie de tarjeta hacia `/dashboard/finance/cash-flow` y la gestión de contrapartes.
  - **Suggested command**: `$impeccable layout`

- **[P1] Desalineación de Máquina de Estados y Mapeo de Enums**
  - **Why it matters**: La vista general filtra y muestra `PENDING`, `APPROVED`, `EXECUTED`, pero el detalle de corrida transiciona a `PENDING_APPROVAL`, `PROCESSING`, `COMPLETED`, `CANCELLED`. Además, el modal de contratos guarda `SERVICIO_BASICO`, el cual no existe en `CONTRACT_TYPE_MAP` y se renderiza como código crudo.
  - **Fix**: Unificar el enum de estados en todo el ciclo de vida (`DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `PROCESSING`, `PAID`, `CANCELLED`) y sincronizar `CONTRACT_TYPE_MAP` con los valores del select de contratos.
  - **Suggested command**: `$impeccable harden`

- **[P1] Proveedores Simulados y Falta de Selección de Sucursal**
  - **Why it matters**: Al crear un contrato recurrente, se asigna `supplierId: "00000000-0000-0000-0000-000000000000"` de forma silenciosa. Además, el modal de corrida de pago no permite asignar una sucursal específica, rompiendo la segregación multi-sucursal clave para grupos de 3 a 15 restaurantes.
  - **Fix**: Integrar selectores reales de sucursal (`useBranch`) y selector/búsqueda de proveedores o contrapartes registrados en los modales de captura.
  - **Suggested command**: `$impeccable clarify`

- **[P2] Fragmentación de UI Tokens y Dualidad de Toasts**
  - **Why it matters**: Se mezclan toasts de `sonner` con toasts de `@/hooks/use-toast`, se usan selects HTML nativos en el toolbar y se aplican colores hexadecimales/Tailwind directos (`bg-green-600`, `bg-emerald-500/15`) en lugar de variables semánticas del sistema.
  - **Fix**: Estandarizar la notificación en una sola librería, usar el componente `Select` de Radix/shadcn y reemplazar colores fijos con tokens de `DESIGN.md`.
  - **Suggested command**: `$impeccable polish`

#### Persona Red Flags

- **Alex (CFO / Dueño de Grupo Restaurantero)**:
  - No puede entrar a revisar los folios fiscales que componen una corrida de pago desde la lista principal; la tabla es meramente informativa y no transaccional.
  - No puede seleccionar formato bancario específico (Banorte o BBVA) en la exportación, únicamente CSV genérico.
  - No tiene visibilidad de a qué sucursal pertenece cada contrato recurrente en la tabla de gastos fijos.

- **Jordan (Gerente de Sucursal / Primerizo)**:
  - Al registrar el contrato de luz/CFE, ve que en la tabla aparece la etiqueta cruda `SERVICIO_BASICO` sin formato amigable.
  - Hace clic en "Ver calendario completo" y "Administrar contratos" esperando abrir una vista detallada, pero la interfaz no reacciona ni da retroalimentación.

- **Riley (Auditor / Auditoría y Cumplimiento NOM/Fiscal)**:
  - Detecta que los contratos recurrentes se guardan con identificador de proveedor en ceros (`00000000-...`), impidiendo la trazabilidad de obligaciones contractuales por RFC.
  - La acción destructiva "Cancelar Corrida" en la vista de detalle se ejecuta de inmediato sin modal de confirmación ni motivo de cancelación.

#### Minor Observations
- El icono `<Wallet className="h-7 w-7 text-primary" />` en el `h1` tiene un peso visual ligeramente excesivo frente al texto.
- El input de búsqueda tiene placeholder extenso que puede truncarse en pantallas medianas ("Buscar por concepto, proveedor o sucursal...").
- Falta soporte para paginación o scroll virtual si la lista de contratos o corridas supera los 10 registros.

#### Questions to Consider
- ¿Debería la tabla de Corridas de Pago permitir selección múltiple para autorizar dispersiones en bloque durante el cierre de quincena?
- ¿Cómo debería integrarse la selección de banco emisor (Banorte / BBVA / Santander) al generar los layouts bancarios?
- ¿Deberían los contratos recurrentes generar automáticamente corridas de pago borrador 5 días antes de su vencimiento?
