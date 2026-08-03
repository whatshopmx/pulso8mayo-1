# Plan: Rediseño de Cumplimiento — Semáforo / Reportes / Registros

> **Origen:** `$impeccable critique app/dashboard/compliance/` (2026-07-28) — **18/40 (Poor)**, 0 P0, 4 P1, 1 P2.
> Snapshot: `.impeccable/critique/2026-07-28T23-06-29Z__app-dashboard-compliance.md`
> Este documento consolida el critique, las decisiones de diseño de las open questions, y el plan de implementación por fases.

---

## 1. Diagnóstico (del critique)

### Heurísticas Nielsen — 18/40

| # | Heurística | Score | Problema clave |
|---|-----------|-------|----------------|
| 1 | Visibilidad de estado | 2 | Spinners sin skeletons; `toast.success` de WhatsApp se dispara sin verificar `response.ok` |
| 2 | Sistema / mundo real | 2 | Mezcla ES/EN; PDF para COFEPRIS con headers en inglés |
| 3 | Control del usuario | 2 | Dos contextos de filtro (selector de sucursal del header vs. el del dashboard); WA reminder deshabilitado ≥95% sin explicación |
| 4 | Consistencia | 1 | Badge `default` = rojo de marca usado para "Excelente" (≥90%); 176 utilidades `green-*/red-*/yellow-*` hardcodeadas; doble superficie IMSS |
| 5 | Prevención de errores | 2 | Inputs de fecha sin validación (fin < inicio, fechas futuras); envíos WA irreversibles sin confirmación |
| 6 | Reconocimiento vs. recuerdo | 1 | **13 sub-páginas huérfanas** sin un solo link entrante |
| 7 | Flexibilidad / eficiencia | 2 | Sin acciones bulk; cada cambio de filtro = reload a spinner |
| 8 | Estética minimalista | 2 | Botones muertos, tabs stub, métricas vanity, blob decorativo + sparkles `animate-pulse` |
| 9 | Recuperación de errores | 2 | Fallo de `/api/branches` muere en `console.error`; empty states sin acción |
| 10 | Ayuda | 2 | Info tab es marketing, no ayuda de tarea |

### Hallazgos prioritarios

- **[P1-1] IA huérfana:** `imss/` (altas, bajas, reports, sua), `sat/` (certificates, validation), `overtime/`, `schedules/`, `expediente/`, `breaks/`, `payroll/` — **cero links entrantes** en todo `components/` y `app/`. El sidebar "Cumplimiento" solo enlaza `/dashboard/compliance`, audit, reports, ai-verifications.
- **[P1-2] UI muerta y datos falsos:** 6 botones permanentemente `disabled` en IMSS; tabs stub que solo enlazan a otra página; tab "Configuración" = "próxima versión"; "Generar IDSE" enlaza a `/altas` (bug copy-paste); SAT muestra `validRFCs = certData.generated` (falso) y `monthlyWithholding: 0` hardcodeado; Info tab con "100% Cumple con normativa vigente" (vanity).
- **[P1-3] Color semántico invertido:** `Badge variant="default"` = `bg-primary` (rojo Operacional) renderiza badges de "Excelente" ≥90%. Causa raíz: Badge tiene `warning` pero **no tiene variant `success`** → 176 utilidades Tailwind hardcodeadas (`text-red-600` ×27, `text-green-600` ×24, `text-orange-600` ×11…) como workaround, ignorando los tokens OKLCH `success`/`warning`/`destructive` de DESIGN.md. La lógica de umbrales ≥90/≥70/<70 está **duplicada en 4 archivos** (`compliance-dashboard`, `corporate-compliance-grid`, `nom251-report`, `psychosocial-dashboard`).
- **[P1-4] Dos idiomas:** "Últimos 7 días" / "Last 30 days" en el mismo dropdown; "Total Workflows", "Need IMSS registration", "No compliance data available"; fechas de chart en `en-US`; headers de tabla del PDF en inglés (`Alert/Severity/Status/Workflow/Date`) con azul crudo `[59,130,246]` fuera de paleta.
- **[P2-5] Tabs anidados + doble filtro:** 3 capas de tabs (7 → 5 → 2); tab "Vista Corporativa" condicional (posiciones inestables entre tenants); selector de sucursal del header inerte en el tab Dashboard; `PayrollExport` recibe `branchId` como `companyId`.

### Detector determinístico (3 advisories, `corporate-compliance-grid.tsx`)

- `borderRadius: 8px` inline en tooltip (línea 319) — fuera de escala `rounded`
- `text-[10px]` badge "Inactiva" (línea 369) — fuera de rampa tipográfica
- `text-[10px]` badge conteo críticas (línea 413) — fuera de rampa

### Lo que funciona (conservar)

1. **Semáforo corporativo:** sucursal → gerente → % → incidencias → botón WA en la misma fila. Hallazgo y acción co-ubicados.
2. **Flujo de reporte NOM-251:** preview → PDF/Excel gateado en preview; tarjeta de huella digital; CSV con BOM para Excel ES.
3. **Base de tokens:** Card/Tabs/Button siguen DESIGN.md; chart de tendencias usa `var(--primary)`.

---

## 2. Decisiones de diseño (open questions resueltas)

### D1 — Tres destinos, no siete tabs

La superficie se reorganiza por **intención del usuario**:

| Destino | Pregunta del usuario | Contenido | Ruta |
|---|---|---|---|
| **Semáforo** | "¿Qué está mal *ahora* y a quién le escribo?" | `ComplianceDashboard` + `CorporateComplianceGrid` | `/dashboard/compliance` |
| **Reportes** | "¿Qué le entrego a COFEPRIS/STPS?" | NOM-251, NOM-035, export nómina. Los selectores sucursal/período viven **aquí** como parámetros del documento | `/dashboard/compliance/reportes` |
| **Registros** | "¿Mis altas/cfdis/horarios están al corriente?" | IMSS (altas, bajas, SUA, IDSE), SAT (certificados, validación), laboral (overtime, breaks, schedules), expediente | `/dashboard/compliance/registros/*` |

**Regla de frontera:** Semáforo = leer + actuar (recordatorios). Reportes = generar + descargar. Si Semáforo empieza a exportar PDFs, la línea se borró.

**Sidebar:** "Cumplimiento" pasa a 3 sub-items (Semáforo, Reportes, Registros) + los existentes (Auditoría, Reportes custom, Verificaciones AI).

### D2 — Regla de verdad numérica

**Ningún número sin query detrás. Si no hay fuente, se muestra "Sin datos" con CTA — jamás un placeholder.**

- ✅ Confiables (conservar): NOM-251 (`/api/reports/nom-251`), semáforo corporativo (`/api/compliance/corporate-status`).
- ⚠️ Corregir: "Cumplimiento General" promedia scorecards **sin ponderar** → ponderar por `totalWorkflows` o mostrar desglose.
- ❌ Eliminar: `validRFCs` falso de SAT, `monthlyWithholding: 0`, "100%" del Info tab.
- Affordance de confianza: "Actualizado hace X min" en cards de stats.

### D3 — Sistema de color semántico en 3 capas

1. **Variant `success`** en `components/ui/badge.tsx` (el token OKLCH ya existe en DESIGN.md; nunca llegó al componente).
2. **Componente de dominio `<RateBadge rate={n} />`** — dueño único de umbrales ≥90/≥70/<70 y etiquetas ("Excelente/Bueno/Crítico"). Mata la duplicación en 4 archivos.
3. **Sweep** de las 176 utilidades hardcodeadas a tokens semánticos.

Sin la capa 2, la capa 3 se revierte en dos sprints.

### D4 — Info tab → "Expediente de Auditoría"

La pregunta real de Don Roberto: **"si COFEPRIS llega hoy a las 6pm, ¿qué le presento?"**

- El slot del Info tab se convierte en la vista de *audit-readiness*: documentos vigentes, vencimientos del mes, qué imprimir.
- Le da hogar a `expediente/` (la huérfana más valiosa).
- La ayuda de NOM-251/035 se vuelve contextual ("?" dentro de cada tab de reporte), no un tab que nadie abre dos veces.

### D5 — IMSS: una sola casa (respuesta 2A)

La página de Registros/IMSS sobrevive; los generadores `SUAGenerator`/`IDSEGenerator` (que funcionan) se **mudan** a ella; el tab IMSS de la página principal se elimina.

---

## 3. Plan de implementación por fases

### Fase 0 — Trust breakers (`$impeccable distill`)

**Objetivo:** nada en pantalla puede mentir o ser un callejón sin salida. ~1 sesión.

| Archivo | Cambio |
|---|---|
| `app/dashboard/compliance/imss/page.tsx` | Eliminar 6 botones `disabled`, tabs stub (Altas/Bajas que solo enlazan), tab "Configuración". Arreglar "Generar IDSE" → apuntar a SUA/IDSE real, no `/altas` |
| `app/dashboard/compliance/sat/page.tsx` | Eliminar stats falsos (`validRFCs = generated`, `monthlyWithholding: 0`). Mostrar "Sin datos" + CTA a conectar fuente |
| `app/dashboard/compliance/page.tsx` | Eliminar Info tab completo (cards vanity "100%"/"Oficial"/"PDF" + "Beneficios Operativos") |
| `components/compliance/corporate-compliance-grid.tsx` | **Bug:** `sendWhatsAppReminder` hace `toast.success` sin verificar `response.ok` → verificar y hacer `toast.error` en fallo. Eliminar blob decorativo `bg-primary/5`, sparkles `animate-pulse`, eyebrows uppercase de las 4 KPI cards |
| `components/compliance/compliance-dashboard.tsx` | WA reminder: explicar el disable ≥95% (tooltip "Cumplimiento óptimo — no requiere recordatorio") o eliminar la regla oculta |
| `components/compliance/nom251-report.tsx` + `nom035-report.tsx` | Validación de fechas: `fin >= inicio`, no futuras; mensaje inline |

**Criterio de aceptación:** cero botones permanentemente deshabilitados sin ruta de activación; cero números sin fuente de datos; envío WA reporta el resultado real de la API.

### Fase 1 — Color semántico (`$impeccable colorize`)

| Archivo | Cambio |
|---|---|
| `components/ui/badge.tsx` | Agregar variant `success`: `bg-success text-success-foreground` (verificar que exista token foreground o usar white) |
| `components/compliance/rate-badge.tsx` | **Crear.** `<RateBadge rate={n} showLabel />` — umbrales ≥90 success/Excelente, ≥70 warning/Bueno, <70 destructive/Crítico en un solo lugar |
| `compliance-dashboard.tsx`, `corporate-compliance-grid.tsx`, `nom251-report.tsx`, `nom035-report.tsx`, `psychosocial-dashboard.tsx` | Reemplazar las 4 implementaciones de umbrales por `<RateBadge />`; sweep de las ~176 utilidades `green-*/yellow-*/red-*/orange-*` a `success`/`warning`/`destructive` |
| `components/compliance/compliance-dashboard.tsx` | Badge `default` (rojo) ya no representa éxito. Area chart: `stopOpacity` 1.0 → 0.2 (flat-by-default). PDF: header azul `[59,130,246]` → rojo de marca o neutral |
| `corporate-compliance-grid.tsx` | `font-extrabold` → `font-bold` (rampa ≤700); `text-[10px]` ×2 → `text-xs`; tooltip `borderRadius: 8px` → token; Progress color inline → variante |

**Criterio:** `grep -c "green-\|red-[0-9]\|yellow-\|orange-" components/compliance app/dashboard/compliance` ≈ 0; rojo Operacional solo en acciones de marca (One Voice Rule, ≤10-15% de pantalla).

### Fase 2 — Un idioma (`$impeccable clarify`)

| Superficie | Cambio |
|---|---|
| `compliance-dashboard.tsx` | "Total Workflows" → "Flujos Completados"; "Last 30/90 days" → "Últimos 30/90 días"; "Completed in period", "critical", "Next 30 days", "No compliance data available" → ES-MX; chart `toLocaleDateString("en-US")` → `"es-MX"` |
| PDF generators (dashboard + nom251) | Headers de tabla en español (`Alerta/Severidad/Estado/Flujo/Fecha`); "No active alerts" → ES |
| `imss/page.tsx` | "Need IMSS registration/deregistration", "Generate SUA/IDSE File" → ES |
| Empty states | Todos con acción siguiente (ej. "No compliance data available" → "Sin datos de cumplimiento — verifica que haya flujos completados en el período" + link) |
| `/api/branches` fetch (page.tsx) | Error visible (toast/inline), no solo `console.error` |

**Criterio:** cero strings en inglés en UI y PDFs generados (excepción: nombres propios SUA/IDSE/IMSS).

### Fase 3 — IA: tres destinos (`$impeccable shape`)

**Estructura de rutas objetivo:**

```
app/dashboard/compliance/
├── page.tsx                    → Semáforo (dashboard + corporate grid, sin tabs de reportes)
├── reportes/page.tsx           → NOM-251, NOM-035, nómina export + selectores sucursal/período
└── registros/
    ├── page.tsx                → Hub de registros (cards de estado por dominio)
    ├── imss/page.tsx           → absorbe imss/* actual + SUA/IDSE generators movidos
    ├── sat/page.tsx            → absorbe sat/* actual
    ├── laboral/page.tsx        → overtime, breaks, schedules
    └── expediente/page.tsx     → Expediente de Auditoría (D4)
```

| Trabajo | Detalle |
|---|---|
| Mover generadores | `SUAGenerator`, `IDSEGenerator` de tab en página principal → `registros/imss` |
| Rehome huérfanas | Mover (o redirigir con `redirect()` permanente) las 13 rutas huérfanas bajo `registros/` |
| Sidebar (`components/app-sidebar.tsx`) | "Cumplimiento" → sub-items: Semáforo, Reportes, Registros (+ Auditoría, Constructor, Verificaciones AI existentes) |
| Expediente de Auditoría | Vista: documentos vigentes / por vencer 30 días / vencidos, acción imprimir/descargar. Consume la lógica de `expediente/` actual |
| Page chrome consistente | Todas las páginas usan `PageHeader` (hoy `imss/` y `sat/` usan `<h1 class="text-3xl">` custom) |

**Criterio:** cada página de compliance alcanzable en ≤2 clicks desde el sidebar; cero rutas huérfanas (`grep` de verificación); redirects 308 de rutas viejas.

### Fase 4 — Flatten + contexto único (`$impeccable layout`)

| Cambio | Detalle |
|---|---|
| Una sola capa de tabs | Sub-vistas del dashboard (Evaluaciones/Tendencias/Vencimientos/Alertas/Por Sucursal) → segmented control o secciones apiladas; eliminar tabs dentro de tabs |
| Contexto de filtro único | Semáforo: período+sucursal propios y visibles. Reportes: parámetros junto al botón generar. Eliminar el selector del header que no aplica a todos los tabs |
| Tab corporativa estable | No montar/desmontar por `branches.length`; si 1 sucursal → ocultar Semáforo corporativo *del sidebar*, no cambiar posiciones de tabs |
| Fix prop | `PayrollExport companyId={selectedBranch}` — recibe branchId como companyId; corregir prop o mapping |
| Skeletons | Reemplazar spinners centrados por skeletons de las cards/tablas (product register: skeleton, no spinner) |

**Criterio:** máximo 2 capas de navegación en pantalla; ningún selector visible que no afecte al contenido visible.

### Fase 5 — Verificación (`$impeccable polish` + re-critique)

1. `$impeccable polish app/dashboard/compliance` — pase final (a11y: `htmlFor`/`id` en date inputs, `role="status"` en loading, focus visibles).
2. Re-run `$impeccable critique app/dashboard/compliance/`.
3. **Meta: 18/40 → ≥28/40** (banda "Good"). Heurística 4 (Consistencia) y 6 (Reconocimiento) deben subir de 1 a ≥3.

---

## 4. Verificación continua

```bash
# Cero utilidades de color hardcodeadas
grep -rhoE "(text|bg|border)-(green|yellow|red|orange)-[0-9]{3}" app/dashboard/compliance components/compliance | wc -l   # meta: 0

# Cero rutas huérfanas (cada ruta debe tener link entrante fuera de su propio dir)
grep -rn "dashboard/compliance/registros" components/ app/ --include="*.tsx" | grep -v "app/dashboard/compliance/"

# Umbrales de semáforo en un solo archivo
grep -rln ">= 90" components/compliance/   # meta: solo rate-badge.tsx

# Build limpio antes de cada commit
pnpm run build
```

## 5. Riesgos y notas

- **Rutas viejas:** pueden existir bookmarks o links en WhatsApp/notificaciones a `/dashboard/compliance/imss/*` — usar `redirect()` permanente en las páginas viejas durante al menos un release.
- **No tocar lógica de datos** en Fases 0-2 salvo el bug del toast WA; el refactor de IA (Fase 3) es de rutas/componentes, no de APIs.
- **`psychosocial-dashboard.tsx`** también duplica la lógica de umbrales — incluirlo en Fase 1 aunque no estaba en el scope original del critique.
- **Orden importa:** no empezar Fase 3 antes de Fase 0 — mover UI muerta a rutas nuevas solo esconde la basura.
