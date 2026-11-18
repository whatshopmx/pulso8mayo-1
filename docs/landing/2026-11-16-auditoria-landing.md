# Auditoría técnica — Landing comercial Pulso HoReCa

**Fecha:** 2026-11-16
**Fase:** 0 — Auditoría y preparación
**Estado:** entregado (auditoría estática de repositorio + configuración; sin verificación en navegador)
**Alcance:** sitio público actual, rutas del producto, capacidades reales del backend, activos reutilizables y restricciones técnicas para el rediseño descrito en el plan (fases 0–7).

---

## 1. Resumen ejecutivo

1. **El producto real es mucho más grande que el sitio público.** Hay 180 páginas (`page.tsx`), 407 endpoints (`route.ts`), ~348 archivos en `lib/services`, 206 tablas y 31 plantillas de workflow JSON. El landing actual tiene 174 líneas y seis tarjetas genéricas.
2. **La narrativa del plan (operaciones + finanzas + workflows) está respaldada por código real**, no por maquetas: gastos con autorización y pago, presupuestos con comprometido y tope de emergencia, órdenes de compra con matriz de aprobación, cuentas por pagar, tesorería, caja chica, conciliación bancaria, P&L por sucursal, CFDI vía FiscalAPI y cockpit ejecutivo.
3. **El control financiero ya existe y es profundo**, pero el sitio actual no lo menciona. Es la mayor oportunidad de posicionamiento: hoy el landing vende "operación y NOM", no "operación conectada a finanzas".
4. **Faltan por completo tres piezas del plan comercial:** captación de leads (no hay tabla, endpoint ni formulario), analítica de marketing (ningún proveedor instalado) y precios publicables (los tres tiers están en `$0` y `BillingService.subscribe` es mock).
5. **No existe demo pública ni página secundaria alguna.** Las únicas rutas públicas son autenticación y enlaces tokenizados. Existe un tenant sintético de 3 sucursales (Condesa / Polanco / Roma) creado por seeds, pero vive en la misma base de datos que el entorno de trabajo.
6. **Restricciones técnicas concretas detectadas:** el correo está deshabilitado por un desajuste de variable (`RESEND_KEY` vs `RESEND_API_KEY`); WhatsApp está en transición de tres proveedores y sin token de envío en `.env`; no hay `robots.txt`, `sitemap` ni imagen Open Graph; el logotipo solo existe como PNG de icono.

**Conclusión:** el rediseño es viable sin migración tecnológica y sin tocar el dashboard. Los bloqueos no son de ingeniería sino de **decisiones de producto y activos**: precios, demo, logo y destino de leads.

---

## 2. Método

Inspección estática del repositorio (rama `main`, commit `189376a`):

- `package.json`, `next.config.ts`, `netlify.toml`, `proxy.ts`, `app/layout.tsx`, `app/globals.css`.
- Inventario completo de rutas: `app/**/page.tsx` y `app/api/**/route.ts`.
- Lectura de servicios clave: `expense-service`, `budget-service`, `purchase-order-service`, `approval-matrix-service`, `accounts-payable-service`, `cash-flow-service`, `pnl-service`, `treasury-service`, `ComplianceReportService`, `tier-service`, `billing-service`.
- Inventario de componentes (`components/ui`, `components/shared`), hooks, plantillas y activos (`public/`, `.impeccable/critique/shots/`).
- Revisión de documentación existente (`PRODUCT.md`, `DESIGN.md`, `PROJECT_CONTEXT.md`, `docs/WHATSAPP_INTEGRATION_STATUS.md`) y verificación de que lo documentado corresponde al código.

No se ejecutó build, pruebas ni navegador en esta fase. Las afirmaciones "verificado" significan **verificado en código**, no probado en ejecución.

---

## 3. Stack y hosting verificados

| Componente | Versión / configuración real | Nota para el rediseño |
|---|---|---|
| Framework | Next.js **16.1.6**, App Router, Turbopack | Sin migración necesaria |
| React | **19.2.3** | Server Components disponibles |
| Lenguaje | TypeScript, `strict: false` | Los tests quedan fuera del build |
| Estilos | Tailwind CSS **v4** + CSS variables OKLCH en `app/globals.css` | Los tokens ya existen |
| UI | Radix UI + componentes shadcn locales (`components/ui`, 38 archivos) | Reutilizables; no hay librería externa que adoptar |
| Iconos | `lucide-react` + `@tabler/icons-react` | El logo actual es un icono `Zap`, no un activo de marca |
| Datos | Drizzle ORM 0.45 + Neon Postgres | 206 tablas |
| Auth | better-auth 1.4, sesión por cookie | `/` redirige a `/dashboard` si hay sesión |
| Jobs | Inngest 4.1 (`lib/inngest/functions`, 39 archivos) + QStash/Redis | Base del "tiempo real" y recordatorios |
| Email | Resend (SDK instalado) | **Deshabilitado por nombre de variable** (ver §9.2) |
| WhatsApp | WHAPI en código (`gate.whapi.cloud`); conviven restos de Wasender y WAHA | No prometer registro de gastos por WhatsApp |
| IA | Moondream configurado; OpenAI y Cloudflare como fallback | Verificación de evidencia real, no simulada |
| Facturación fiscal | FiscalAPI v4 (test/producción por `FISCALAPI_ENV`) | Capacidad real, en modo prueba |
| Gráficas | Recharts 2.15.4 | Ya usado en dashboards |
| i18n | `next-intl` 4.9, solo `messages/es.json` | El landing actual tiene texto hardcodeado en español |
| Hosting | Netlify (`publish = .next`, Node 22, heap 4 GB) | Sin pipeline de imágenes configurado |
| Monitoreo | `@sentry/nextjs` 8 | Sin analytics de producto/marketing |

---

## 4. Inventario de rutas

### 4.1 Rutas públicas (10)

| Ruta | Protección | Función |
|---|---|---|
| `/` | Pública; redirige a `/dashboard` con sesión | Landing actual |
| `/sign-in` | Pública | Inicio de sesión |
| `/sign-up` | Pública | Registro |
| `/forgot-password` | Pública | Recuperación |
| `/reset-password` | Pública | Nueva contraseña |
| `/onboarding` | Requiere sesión (proxy) | Alta de empresa |
| `/join/[token]` | Pública por token | Invitación de empleado |
| `/workflow/public/[token]` | Pública por token | Ejecución de workflow vía smart link |
| `/communication/public/[token]` | Pública por token | Comunicación firmada |
| `/external/report/[token]` | Pública por token | Reporte externo |

Ninguna ruta de marketing (`/precios`, `/demo`, `/plataforma`, `/blog`, etc.) existe hoy.

### 4.2 Rutas privadas — 170 páginas agrupadas

| Grupo | Páginas aprox. | Ejemplos representativos |
|---|---:|---|
| Comando y operación | 14 | `/dashboard`, `/dashboard/operations`, `exceptions`, `incidents`, `branches`, `execute`, `my-tasks` |
| Workflows | 10 | `workflows`, `builder`, `builder/templates`, `history`, `review/[id]`, `evidence` |
| Inventario | 24 | `products`, `receiving`, `stock-count`, `waste`, `transfers`, `production`, `purchase-orders`, `suppliers`, `invoices`, `menu-engineering`, `costing`, `recipes`, `lotes`, `expirations` |
| Finanzas | 24 | `expenses`, `payables`, `cash-flow`, `results`, `control-interno`, `petty-cash`, `treasury`, `bank-reconciliation`, `approvals`, `payees`, `commissions`, `labor-cost`, `fiscal` |
| Presupuestos | 1 | `/dashboard/budgets` |
| Personal | 20 | `labor`, `employees`, `attendance`, `shifts`, `shift-changes`, `schedule-builder`, `overtime`, `leave`, `vacations`, `propinas`, `payroll`, `performance` |
| Cumplimiento | 20 | `compliance`, `audit`, `civil-protection`, `imss/*`, `sat/*`, `expediente`, `nom-035` |
| Equipos | 7 | `equipment`, `catalog`, `maintenance`, `compliance`, `providers` |
| Reportes y BI | 9 | `executive`, `reports`, `reports/custom`, `reports/schedule`, `reports/control`, `analytics/*` |
| Organización / plataforma | 8 | `company/branches`, `operating-config`, `playbooks`, `subscription`, `team`, `whatsapp`, `communications` |
| Prototipos internos | 2 | `prototipo`, `prototipo/cola` |

### 4.3 Endpoints — 407 handlers agrupados

| Dominio | Handlers aprox. |
|---|---:|
| Auth y cuenta | 6 |
| Analytics | 24 |
| Finanzas y contabilidad | 60+ |
| Inventario y compras | 50+ |
| Empleados, turnos, nómina | 60+ |
| Workflows y ejecuciones | 25+ |
| Excepciones e incidentes | 20 |
| Cumplimiento (IMSS/SAT/NOM) | 20+ |
| WhatsApp y comunicaciones | 15+ |
| Reportes y documentos | 15 |
| Resto (equipos, sucursales, suscripción, IA) | 50+ |

### 4.4 Redirecciones permanentes ya configuradas (`next.config.ts`)

`/dashboard/analytics` → `/dashboard/branches` · `analytics/branches` → `branches` · `analytics/incidents` → `exceptions` · `analytics/trends` → `branches` · `analytics/kpi-builder` → `branches`.

**Implicación:** "Business Intelligence" existe, pero no como hub propio: vive dentro de `branches` y `executive`. El landing no debe enlazar `/dashboard/analytics` como módulo.

---

## 5. Matriz de funcionalidades verificadas

Estados: **Verificado** = UI + servicio + persistencia identificados · **Verificado con matiz** = funciona, con alcance menor al que sugiere el nombre · **Parcial** = infraestructura presente, flujo incompleto · **No implementado** = solo aparece como nombre o flag · **Mock** = existe la interfaz, no el efecto real.

| # | Capacidad comercial | Evidencia en código | Estado |
|---|---|---|---|
| 1 | Centro de operaciones multi-sucursal ("Comando de Red") | `app/dashboard/page.tsx`, `components/dashboard/*`, `live-command-service` | Verificado |
| 2 | Excepciones con ciclo de vida (asignar, escalar, resolver, verificar, cerrar) | `app/api/exceptions/[id]/*` (10 rutas), `exception-service`, `exception-lifecycle` | Verificado |
| 3 | Incidentes y acciones de remediación | `app/dashboard/incidents`, `incident-engine`, `remediation-service` | Verificado |
| 4 | Workflows: constructor, ejecución, historial, revisión | `builder`, `workflows`, `execute`, `review`, `workflow-executor` | Verificado |
| 5 | Plantillas de workflow HORECA | **31 JSON** en `templates/**` (el catálogo documentado dice 19: está desactualizado) | Verificado |
| 6 | Verificación de evidencia con IA y confianza | `/api/ai/verify`, `ai-service`, proveedores Moondream/OpenAI/Cloudflare | Verificado |
| 7 | Smart links públicos para ejecutar tareas sin cuenta | `app/workflow/public/[token]`, `smart-link-service` | Verificado |
| 8 | Bóveda de evidencia | `/dashboard/evidence`, `evidence-store`, `scoped-evidence` | Verificado |
| 9 | Inventario: catálogo, lotes/FEFO, vencimientos, mermas | 24 páginas + `fefo-allocator`, `stock-alert-service` | Verificado |
| 10 | Conteo de inventario y auditoría de existencias | `stock-count`, `stock-count-service`, evidencia E2E | Verificado |
| 11 | Costeo, recetas, ingeniería de menú | `costing`, `recipes`, `menu-engineering`, `recipe-service` | Verificado |
| 12 | Órdenes de compra con estados y aprobación | `purchase-order-service` (`DRAFT→PENDING_APPROVAL→APPROVED→SENT→…`), `approval-matrix-service` | Verificado |
| 13 | Recepción de mercancía con temperatura y costo | `receiving`, `receiving-temperature`, `receiving-cost` | Verificado |
| 14 | Proveedores y cuentas bancarias de proveedor | `inventory/suppliers`, `payees`, `payee-bank-account-service` | Verificado |
| 15 | Gastos operativos: alta, evidencia, aprobación, rechazo, pago, reprogramación | `expense-service` (7 operaciones), `/api/expenses/*` (7 rutas) | Verificado |
| 16 | Presupuesto por sucursal/categoría con comprometido | `budget-service`: `getCommitted`, `checkBudgetAvailability`, `validateEmergencyCap` | Verificado |
| 17 | Consumo de presupuesto visible en gastos | `/api/expenses/budget-consumption`, `BudgetConsumptionBar` | Verificado |
| 18 | Matriz de aprobación configurable por montos | `approval-matrix-service`, `/dashboard/finance/control-interno` | Verificado |
| 19 | Cuentas por pagar y antigüedad de saldos | `/finance/payables`, `accounts-payable-service`, `payable-balances` | Verificado |
| 20 | Tesorería: corridas de pago y autorización | `/finance/treasury`, `treasury-service`, `payment-run-settlement` | Verificado |
| 21 | Caja chica y arqueo | `/finance/petty-cash`, `petty-cash-service` | Verificado |
| 22 | Flujo de efectivo proyectado y conciliación bancaria | `cash-flow-service`, `bank-statement-service`, `/finance/bank-reconciliation` | Verificado |
| 23 | P&L por sucursal con procedencia de datos | `/finance/results`, `pnl-service`, `pnl-derived-detail-service` | Verificado |
| 24 | Contabilidad: pólizas, journals, exportación | `/finance/control-interno/polizas`, `/api/finance/accounting/*` (12 rutas) | Verificado |
| 25 | Costo laboral por sucursal | `/finance/labor-cost`, `labor-cost-service` | Verificado |
| 26 | Comisiones por canal | `/finance/commissions`, `commission-service` | Verificado |
| 27 | CFDI: validación SAT, timbrado de nómina, buzón | `fiscal-service` (FiscalAPI v4), `/compliance/sat/*` | Verificado (modo prueba por defecto) |
| 28 | Corte de ventas / ingesta POS | `/sales`, `sales-upload`, `gateway-report-service`, `sales-ingestion-service` | Verificado |
| 29 | Personal: directorio, asistencia, turnos, cambios, breaks, vacaciones, permisos, horas extra | 20 páginas + servicios de turnos y nómina | Verificado |
| 30 | Nómina y finiquitos (LFT) | `payroll-service`, `severance-minimum-wage`, `aguinaldo-*` | Verificado |
| 31 | Distribución de propinas | `/labor/propinas`, `propinas-distribution` | Verificado |
| 32 | Cumplimiento NOM-251 / NOM-035 con PDF | `ComplianceReportService` (jsPDF), `nom-035/action-plan` | Verificado |
| 33 | IMSS: altas, bajas, SUA, configuraciones | `/compliance/imss/*` (5 rutas) | Verificado |
| 34 | Expediente de empleado | `/compliance/expediente`, `/api/expediente` | Verificado |
| 35 | Reportes programados por cron | `cron-scheduled-reports`, `reportTemplates`, `reportExecutionHistory` | Verificado |
| 36 | Cockpit ejecutivo: unit economics, prime cost, liquidez 14 días | `/dashboard/executive` (`?view=cockpit\|economics\|liquidity`), `executive-twin-engine` | Verificado |
| 37 | Benchmarking entre sucursales | `cross-branch-service.getBenchmarking` | Verificado |
| 38 | Briefing matutino y recomendaciones | `morning-brief-service`, `insight-generator-service` | Verificado |
| 39 | WhatsApp: check-in/out, breaks, tareas, ejecución de workflows, evidencia fotográfica | `message-router` (CLOCK_IN/OUT, BREAK, STATUS, TASKS, WORKFLOW, HELP), `evidence-processor` | Verificado con matiz |
| 40 | WhatsApp: **registrar gastos o comprobantes** | No existe comando ni handler; solo evidencia de tareas | **No implementado** |
| 41 | Multi-tenant y 6 roles con RBAC | `proxy.ts`, `lib/rbac/permissions.ts`, `abac` | Verificado |
| 42 | Suscripción por tiers (Foundation/Growth/Executive) | `subscription_tiers`, `TierService`, `/api/company/subscription` | Verificado con matiz (precio $0) |
| 43 | Cobro real / checkout / portal de cliente | `billing-service`: `subscribe` y portal marcados **Mock** | **Mock** |
| 44 | Integración con ERP / sistemas contables externos | Solo existe el feature-slug `erp_integrations`; no hay conector | **No implementado** |
| 45 | API pública para clientes (API keys) | No hay emisión/validación de API keys; solo cookies de sesión | **No implementado** |
| 46 | Simulador de expansión | `expansionReadiness` es un **índice** dentro del gemelo ejecutivo, no un simulador | Verificado con matiz |
| 47 | Captación de leads / formulario de demo | Sin tabla, endpoint ni componente | **No implementado** |
| 48 | Analítica de marketing / eventos de conversión | Sin GA4, PostHog, Plausible ni equivalente | **No implementado** |
| 49 | Demo pública navegable | No existe ruta pública; solo seeds internos | **No implementado** |
| 50 | Páginas comerciales secundarias | Todas ausentes | **No implementado** |
| 51 | SEO técnico (sitemap, robots, OG) | Sin `app/sitemap.ts`, `app/robots.ts`, `opengraph-image` | **No implementado** |
| 52 | Analítica de producto en dashboard | `analytics-service` + 24 endpoints (interno, no marketing) | Verificado |

La versión máquina-legible está en `docs/landing/matriz-funcionalidades-2026-11-16.csv`.

---

## 6. Capacidades que el landing NO debe anunciar todavía

Estas aparecen en discusiones de producto o en el catálogo de features, pero no tienen implementación:

1. **Registrar gastos o comprobantes por WhatsApp.** Hoy WhatsApp ejecuta tareas, registra asistencia y recibe evidencia. El gasto se captura en el dashboard.
2. **Integración con ERP o contabilidad externa.** Hay exportación y pólizas internas; no hay conector bidireccional.
3. **API pública.** No hay llaves de API ni autenticación de terceros.
4. **Simulador de expansión.** Existe un índice de preparación, no escenarios "what-if".
5. **Cobro en línea / autoservicio de planes.** El cambio de tier es interno; no hay pasarela.
6. **Precios concretos.** Todos los tiers están en `monthlyPriceCents: 0`.
7. **"Tiempo real" literal en inventario.** El stock se deriva de conteos, movimientos y consumo; no hay telemetría continua.
8. **Cumplimiento certificado.** Se generan reportes y expedientes auditables; no hay certificación emitida por Pulso. Evitar "certifica", usar "documenta" / "deja evidencia".

---

## 7. Brechas del sitio actual frente al brief

| Sección del plan | ¿Existe hoy? | Observación |
|---|---|---|
| Hero con posicionamiento operaciones↔finanzas | Parcial | Hero actual: "Opera, cumple y crece con inteligencia". No menciona finanzas ni costos |
| Problema | No | Solo una fila de tres pasos de ejemplo |
| Tres pilares | No | Seis tarjetas sin jerarquía |
| Operations Control Center | No | Solo una tarjeta de "Workflows" |
| Financial Control Center | No | Ausente por completo |
| Workflows (recorrido incidencia→gasto) | Parcial | Tres pasos de un incidente, sin conexión al gasto |
| Compras y proveedores | No | Ausente |
| Workforce | Parcial | Una tarjeta de "Gestión de Personal" |
| Business Intelligence | Parcial | Una tarjeta de "Analítica y KPIs" |
| WhatsApp | Sí | Sección propia, pero sin límites de alcance |
| Soluciones por industria | No | — |
| Implementación | No | — |
| Precios | No | Y no hay datos para publicarlos |
| FAQ | No | — |
| CTA final | Parcial | CTA de registro, no de demostración |
| Formulario de demo | No | — |
| Demo interactiva | No | — |
| Calculadora | No | — |
| Páginas secundarias | No | — |
| SEO / analítica | No | Sin metadata propia, sitemap, robots ni eventos |

**Lo que sí funciona y debe conservarse:** navegación a `/sign-in` y `/sign-up`, redirección de usuarios autenticados a `/dashboard`, layout raíz con tema claro/oscuro, `manifest.json`, iconos PWA y el copy en español.

---

## 8. Activos reutilizables

### 8.1 Sistema de diseño ya existente

- **Tokens OKLCH completos** en `app/globals.css` (claro y oscuro), alineados con `DESIGN.md`: Operational Red `oklch(0.52 0.17 25)`, neutros cálidos, semánticos, `chart-1..5`, radios.
- **38 primitivas** en `components/ui`: `button`, `card`, `badge`, `input`, `select`, `tabs`, `dialog`, `sheet`, `table`, `tooltip`, `skeleton`, `empty-state`, `metric-card`, `progress`, etc.
- **Layouts reutilizables:** `components/shared/page-container.tsx`, `page-header.tsx`, `page-shell.tsx`, `section-error-boundary.tsx`.
- **Gráficas:** `components/charts/*`, `components/sales/financial-kpi-cards.tsx`, `components/finance/pnl-branch-table.tsx`.
- **Reglas de marca vigentes:** rojo operativo ≤10–15 % de la superficie, superficies planas sin sombras, familia tipográfica única Geist, prohibición de gradientes de texto y de eyebrows repetidos.

### 8.2 Activos gráficos disponibles

| Activo | Ubicación | Uso |
|---|---|---|
| Iconos PWA 192/512/maskable | `public/icon-*.png`, `apple-touch-icon.png` | Favicon e instalación; **no son logotipo** |
| Evidencia demo (8 PNG) | `public/demo-evidence/` | Útil para mostrar capturas de evidencia en el landing |
| Capturas reales del producto | `.impeccable/critique/shots/**` (dashboard, finanzas, inventario, personal, móvil, oscuro) | Materia prima para mockups, previa revisión de datos visibles |
| Capturas del prototipo | `.impeccable/critique/shots/remix-*` | Referencia de dirección visual |
| Logotipo vectorial | **No existe** | Bloqueo para navbar/footer definitivos |
| Imagen Open Graph | **No existe** | Crear en Fase 7 |

**Advertencia:** las capturas del dashboard contienen datos del tenant sembrado. Antes de publicarlas hay que sustituir nombres, montos y sucursales por un juego sintético o recortar/desenfocar.

---

## 9. Riesgos y restricciones técnicas

### 9.1 El proxy no bloquea `/api`, pero sí limita el rate

`proxy.ts` solo autentica `/dashboard`, `/api` y `/onboarding`. Para `/api` **verifica sesión pero no rechaza** anónimos: aplica rate limit por `userId` o IP. Cada handler decide su propia autenticación.

**Consecuencia:** un `POST /api/leads` público es viable sin tocar el proxy, pero debe traer validación, honeypot/tiempo mínimo, rate limit propio y protección CSRF según el destino. No asumir que el proxy protege el formulario.

### 9.2 El correo está deshabilitado en este entorno

`lib/services/email-service.ts` y `notification-service.ts` leen `RESEND_API_KEY`; `.env` define **`RESEND_KEY`**. Solo `invite-manager` usa el nombre correcto.

**Consecuencia:** confirmación por correo de un lead, notificaciones y recordatorios no salen hasta alinear la variable. Es un arreglo de configuración, no de código, pero bloquea la aceptación de Fase 3 ("confirmación real del envío") si se promete correo.

### 9.3 WhatsApp: tres proveedores conviviendo

- Código activo: **WHAPI** (`lib/whatsapp/whapi-client.ts`, webhook declara `supports: ['whapi']`).
- `.env`: `WAHA_*`, `WHAPI_WEBHOOK_TOKEN`, **sin `WHAPI_API_TOKEN`**.
- `AGENTS.md` y `docs/WHATSAPP_INTEGRATION_STATUS.md` todavía describen **Wasender**.

**Consecuencia:** el envío falla con `WhapiNotConfiguredError`. Para el landing basta no prometer más de lo implementado; para una demo en vivo de WhatsApp hay que configurar token y webhook.

### 9.4 Dos modelos de plan incompatibles

| Modelo | Dónde | Tiers | Precio |
|---|---|---|---|
| Comercial/ejecutivo | `lib/services/tier-service.ts`, tabla `subscription_tiers` | Foundation / Growth / Executive | `monthlyPriceCents: 0` |
| Facturación legacy | `lib/services/billing-service.ts`, `companies.plan` | FREE / BASIC / PRO / ENTERPRISE | 2900 / 7900 (centavos), checkout mock |

**Consecuencia:** no se puede publicar una tabla de precios sin decisión de negocio. Publicar "$29" o "$79" sería inventar. El plan pide "Essential y Growth", que **no coinciden con ninguno de los dos modelos**.

### 9.5 No hay medición del embudo

Sin proveedor de analítica. Los criterios de aceptación piden "los eventos de conversión se registran". Hay que instalar uno (recomendación: Plausible o GA4 con consentimiento) y definir eventos (`view_pricing`, `submit_demo`, `start_calculator`, `complete_calculator`).

### 9.6 El sistema de diseño es de producto, no de persuasión

`DESIGN.md` prohíbe sombras, gradientes de texto y eyebrows repetidos; está calibrado para un dashboard operativo. Un landing requiere más rango expresivo (escala tipográfica mayor, imágenes, movimiento).

**Recomendación:** crear una **capa de landing** que herede tokens y reglas de color pero amplíe escala y composición, sin modificar los tokens globales (así el dashboard no se altera). Documentar la excepción en `DESIGN.md` en Fase 1.

### 9.7 Rendimiento y build

- Netlify compila con 4 GB de heap; el build ya es pesado (~1 650 archivos TS).
- `next/image` sin configuración de dominios; las imágenes nuevas deben ser locales o habilitar `remotePatterns`.
- Evitar video de fondo, shaders o librerías de animación pesadas en la primera pantalla: el landing comparte `layout.tsx` con el dashboard, que ya carga `next-intl`, React Query, tema y Sentry.

### 9.8 Separación de `layout.tsx`

`app/layout.tsx` envuelve **todo** el sitio con `NextIntlClientProvider`, `ThemeProvider` y `QueryProvider`. Un landing público hereda ese costo. Opciones:

- Mantenerlo (simple, consistente) y vigilar el JS enviado al cliente.
- Mover los providers al layout de `(app)`/`dashboard` y dejar el landing en un grupo propio (más limpio, requiere refactor y pruebas).

Decisión recomendada: **mantener** en Fase 1–2 y medir; refactorizar solo si Lighthouse lo exige.

### 9.9 La demo no está aislada

El tenant sintético vive en la misma base de datos. Cualquier demo interactiva que escriba datos puede contaminar el entorno y, si se expone, revelar estructura interna.

**Recomendación:** demo pública **estática** con datos congelados (JSON/TS tipado) y componentes del sistema real. Sin sesión, sin escrituras, sin acceso a la base. La alternativa (tenant `READONLY` real) queda para ventas asistidas.

### 9.10 Conservar accesos y rutas

- `/` debe seguir redirigiendo a `/dashboard` con sesión.
- `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password` no deben cambiar de contrato.
- Las páginas de auth **no tienen enlace de regreso al inicio**; conviene añadirlo, sin alterar el flujo.
- Cualquier movimiento de rutas existentes requiere redirect 301.

---

## 10. Respuestas a las preguntas de producto (§16)

| # | Pregunta | Respuesta verificada | Confianza |
|---|---|---|---|
| 1 | ¿El control financiero permite registrar gastos reales o solo está diseñado? | **Registra gastos reales**: alta con evidencia, presupuesto, aprobación por matriz, pago, reprogramación y rechazo. Persistencia en `operating_expenses` y asientos contables. | Alta |
| 2 | ¿Existe un módulo de presupuestos? | **Sí**: `/dashboard/budgets` + `budget-service`, con comprometido, disponibilidad y tope de emergencia. | Alta |
| 3 | ¿Las compras tienen órdenes y autorizaciones funcionales? | **Sí**: órdenes con máquina de estados y `approval_requests` generadas por matriz de montos. | Alta |
| 4 | ¿Cuentas por pagar son módulo existente o capacidad nueva? | **Existentes**: `/finance/payables`, antigüedad de saldos, cuentas bancarias de proveedor y corridas de pago. | Alta |
| 5 | ¿WhatsApp permite registrar gastos y comprobantes o solo ejecutar tareas? | **Solo tareas, asistencia, breaks y evidencia.** No hay captura de gastos. | Alta |
| 6 | ¿Existe integración con sistemas contables? | **No como conector.** Hay pólizas, journals, exportación y CFDI vía FiscalAPI. `erp_integrations` es solo un flag comercial sin código. | Alta |
| 7 | ¿Qué se comercializa en Essential y Growth? | **No definido en el producto.** Los tiers reales son Foundation (≤5 sucursales), Growth (≤15), Executive (≤50). "Essential" no existe. | Alta |
| 8 | ¿Qué datos pueden mostrarse en una demo pública? | Nada del tenant real. Solo datos sintéticos congelados. Existe el set Condesa/Polanco/Roma y evidencias demo en `public/demo-evidence/`. | Media-alta |

---

## 11. Decisiones necesarias antes de avanzar

### Bloqueantes

1. **Precios.** ¿Se publica "Solicita propuesta" con los tiers reales (Foundation / Growth / Executive y límites de sucursales) o el negocio entrega cifras? Publicar cifras sin decisión viola la regla de no inventar.
2. **Demo.** ¿Estática (recomendada) o tenant real de solo lectura? La estática se puede construir en Fase 4 sin riesgos; la real exige aislar datos y sesión.
3. **Logotipo.** ¿Existe un SVG/wordmark oficial? Si no, propongo wordmark tipográfico con Geist + icono PWA, marcado internamente como provisional.
4. **Destino de leads.** Recomendación: tabla `marketing_leads` (migración Drizzle) + aviso de privacidad + notificación por Resend. Alternativa: servicio externo (HubSpot/Sheets) sin tocar la base.
5. **Analítica.** Recomendación: Plausible (sin cookies, menos fricción legal en México) o GA4 con banner de consentimiento.

### No bloqueantes (puedo asumir y corregir después)

- El landing nuevo vive en `/` conservando el redirect por sesión.
- Las páginas secundarias cuelgan de rutas nuevas (`/plataforma`, `/operaciones`, `/finanzas`, etc.) sin mover rutas existentes.
- La calculadora es una estimación declarada como tal, con metodología visible y sin prometer ahorros.
- Se reutilizan tokens y componentes; la capa de landing se documenta como extensión.
- Todo el copy se entrega en español de México, con "tú" y sin anglicismos innecesarios.

---

## 12. Plan de fases ajustado a la realidad

| Fase | Trabajo real | Depende de |
|---|---|---|
| 0 | Este documento + CSV de matriz | — |
| 1 | Capa de landing sobre tokens existentes, navbar/footer, tipografía ampliada, primitivas de sección | Decisión de logo (provisional OK) |
| 2 | Landing completo: hero, problema, pilares, operaciones, finanzas, workflows, compras, personal, BI, WhatsApp, industrias, implementación, precios, FAQ, CTA | Decisión de precios (puede ser "solicita propuesta") |
| 3 | Formulario de demo, validación, persistencia, confirmación, eventos | Decisiones de leads, analítica y correo (§9.2) |
| 4 | Demo estática navegable con datos sintéticos congelados | Decisión de demo |
| 5 | Calculadora de visibilidad operativa con metodología explícita | Nada (solo copy y matemática transparente) |
| 6 | Páginas secundarias enlazadas desde el landing | Fase 2 |
| 7 | Metadata por página, sitemap, robots, OG, imágenes optimizadas, Lighthouse, accesibilidad, cross-browser | Todo lo anterior |

**Nota sobre el orden:** la Fase 5 (calculadora) puede adelantarse a la 4 si se quiere una pieza de conversión antes de la demo. Ambas son independientes del backend.

---

## 13. Guardarraíles de copy por sección

| Sección | Se puede afirmar | No afirmar |
|---|---|---|
| Operations | Excepciones con ciclo de vida, incidentes, evidencia, sucursales | "Tiempo real" absoluto; "IA que resuelve sola" |
| Financial | Gastos con autorización, presupuesto comprometido, CxP, tesorería, P&L, CFDI | "Contabilidad completa certificada"; "conecta tu ERP" |
| Workflows | 31 plantillas, verificación de evidencia, smart links, escalamiento | "Automatiza cualquier proceso sin configuración" |
| Compras | OC con aprobación por monto, recepción con temperatura | "Negociación automática con proveedores" |
| Workforce | Asistencia con geolocalización, turnos, horas extra, nómina LFT | "Cumplimiento laboral garantizado" |
| BI | Cockpit ejecutivo, benchmarking, briefings | "Predice tu quiebra"; "simulador de expansión" |
| WhatsApp | Tareas, asistencia, evidencia | "Registra gastos por WhatsApp" |
| Precios | Tiers reales y límites de sucursales, o "solicita propuesta" | Cifras no aprobadas, "desde $X" inventado |
| Demo | "Datos demostrativos" visible | Cifras presentadas como resultados de clientes |
| Cumplimiento | "Documenta y deja evidencia para NOM-251/035" | "Certifica", "garantiza auditoría aprobada" |

---

## 14. Cómo se verificará cada criterio de aceptación

| Criterio | Verificación propuesta |
|---|---|
| Enlaces internos y rutas | Script de rastreo sobre el build + Playwright; cerrar con 0 enlaces rotos |
| Menú móvil y responsive | Playwright a 390/768/1440; comprobar `scrollWidth <= clientWidth` |
| Formulario y confirmación | E2E: envío válido, errores por campo, persistencia y mensaje real |
| Eventos de conversión | Inspección de red/consola del proveedor en el E2E |
| Aviso de privacidad | Revisión de contenido + enlace accesible desde el formulario |
| Accesibilidad | `axe-core` en Playwright + navegación solo con teclado + foco visible |
| Rendimiento | Lighthouse móvil sobre build de producción; presupuesto a definir en Fase 1 |
| SEO | `sitemap.xml`, `robots.txt`, metadata por página, OG validado |
| Demo | E2E del recorrido incidencia→gasto + comprobación de que no hay llamadas de escritura |
| Consola | Playwright recolectando `console.error` y `pageerror` en cada ruta pública |

---

## 15. Anexo — Evidencia consultada

```
app/page.tsx                                  landing actual (174 líneas)
app/layout.tsx                                providers globales, Geist, metadata
app/globals.css                               tokens OKLCH claro/oscuro
app/dashboard/                               170 páginas
app/api/                                     407 handlers
lib/services/                                ~348 archivos
lib/db/schema.ts + lib/db/schema/            206 tablas
templates/**                                 31 plantillas JSON
proxy.ts                                     auth, rate limit, RBAC
next.config.ts                               redirects de analytics
netlify.toml                                 build Netlify, Node 22
lib/services/billing-service.ts              planes legacy + mock
lib/services/tier-service.ts                 Foundation/Growth/Executive
lib/db/schema/subscription.ts                tiers con precio 0
lib/services/expense-service.ts              gasto real de punta a punta
lib/services/budget-service.ts               comprometido y tope de emergencia
lib/services/purchase-order-service.ts       OC + aprobación
lib/whatsapp/message-router.ts               comandos soportados
lib/whatsapp/command-parser.ts               sin comandos de gasto
lib/services/email-service.ts                RESEND_API_KEY
.env                                         RESEND_KEY (desajuste)
public/                                      iconos PWA, evidencia demo
.impeccable/critique/shots/                  capturas del producto
```

---

**Siguiente paso:** validar las cinco decisiones bloqueantes (§11) y arrancar Fase 1 (capa de landing + navbar/footer) sin tocar el dashboard ni las rutas de acceso.
