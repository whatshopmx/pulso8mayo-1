# Rediseño de Cumplimiento — Task List

Source plan: `plans/compliance-redesign-plan.md` → implementación: `tasks/compliance/plan.md`.
Critique baseline: **18/40**. Meta: **≥28/40**.

Open questions (responder antes de T16/T21/T22 — ver `plan.md`):
- Q1: ¿Existe ya `BranchScopeControl` del Dashboard Consistency Pass? (bloquea dirección de T21)
- Q2: ¿Redirects inmediatos o banner transitorio? (afecta T16)
- Q3: `PayrollExport` prop fix: call site o componente (afecta T22)

**Reglas globales de verificación:** `pnpm run build` limpio antes de cada commit. No tocar lógica de datos en Fases 0–2 salvo el bug del toast WA (T4). Fase 3 no empieza hasta cerrar el Checkpoint: Trust.

---

## Fase 0 — Trust breakers

- [ ] **T1** Limpiar página IMSS: eliminar UI muerta y arreglar link IDSE. *Files: `app/dashboard/compliance/imss/page.tsx`. Size S.*
  - **Acceptance:**
    - [ ] Cero botones permanentemente `disabled` (los 6 actuales eliminados o conectados)
    - [ ] Tabs stub Altas/Bajas (que solo enlazan) eliminados o reemplazados por navegación real
    - [ ] Tab "Configuración" ("próxima versión") eliminado
    - [ ] "Generar IDSE" apunta al generador SUA/IDSE real, no a `/altas` (bug copy-paste corregido)
  - **Verify:** `pnpm run build`; recorrido manual de la página — todo control visible hace algo.
  - **Deps:** None.

- [ ] **T2** Eliminar stats falsos de SAT. *Files: `app/dashboard/compliance/sat/page.tsx`. Size XS.*
  - **Acceptance:**
    - [ ] `validRFCs = certData.generated` eliminado → "Sin datos" + CTA a conectar fuente
    - [ ] `monthlyWithholding: 0` hardcodeado eliminado
    - [ ] Ningún número renderiza sin query detrás (regla D2)
  - **Verify:** `pnpm run build`; inspección visual — cards sin fuente muestran "Sin datos".
  - **Deps:** None.

- [ ] **T3** Eliminar Info tab de la página principal. *Files: `app/dashboard/compliance/page.tsx`. Size XS.* **⏸ BLOQUEADA TEMPORALMENTE (2026-07-28): el workstream paralelo Dashboard Consistency Pass está migrando esta página a Server Component + `useBranch()` (commit `cab090d`, working tree activo). Re-aplicar sobre `app/dashboard/compliance/compliance-page-client.tsx` cuando su trabajo aterrice. Contenido de ayuda ya rescatado en `components/compliance/nom-help-content.tsx`.*
  - **Acceptance:**
    - [ ] Tab "info" y su `TabsContent` eliminados (cards vanity "100% Cumple", "Oficial", "PDF", "Beneficios Operativos")
    - [ ] Grid de TabsList ajustado (`grid-cols-3 lg:grid-cols-7` → columnas correctas)
    - [ ] El contenido de ayuda NOM-251/035 NO se pierde: queda disponible para reuso contextual en Fase 3 (mover a un componente o dejar const en el archivo, decisión del implementador)
  - **Verify:** `pnpm run build`; la página ya no muestra el tab Info.
  - **Deps:** None.

- [ ] **T4** Bug toast WA + limpieza decorativa en corporate grid. *Files: `components/compliance/corporate-compliance-grid.tsx`. Size S.*
  - **Acceptance:**
    - [ ] `sendWhatsAppReminder` verifica `response.ok`: éxito → `toast.success`, fallo → `toast.error` con mensaje de la API
    - [ ] Blob decorativo `bg-primary/5` eliminado
    - [ ] Sparkles `animate-pulse` eliminados
    - [ ] Eyebrows uppercase de las 4 KPI cards eliminados
  - **Verify:** `pnpm run build`; prueba manual con API caída (o mock) → toast de error visible.
  - **Deps:** None.

- [ ] **T5** Explicar el WA reminder deshabilitado ≥95%. *Files: `components/compliance/compliance-dashboard.tsx`. Size XS.*
  - **Acceptance:**
    - [ ] Botón deshabilitado ≥95% muestra tooltip "Cumplimiento óptimo — no requiere recordatorio" (o la regla oculta se elimina y el botón siempre habilita — decisión del implementador, documentar en el PR)
  - **Verify:** inspección visual en estado ≥95%; tooltip presente y en español.
  - **Deps:** None.

- [ ] **T6** Validación de fechas en reportes NOM. *Files: `components/compliance/nom251-report.tsx`, `components/compliance/nom035-report.tsx`. Size S.*
  - **Acceptance:**
    - [ ] `fin >= inicio` validado con mensaje inline en español
    - [ ] Fechas futuras bloqueadas con mensaje inline
    - [ ] Generación de PDF/Excel deshabilitada mientras la validación falle
    - [ ] Date inputs con `htmlFor`/`id` asociados (adelanta a11y de Fase 5)
  - **Verify:** `pnpm run build`; manual: fin < inicio y fecha futura muestran error inline sin reload.
  - **Deps:** None.

- [ ] **T2b** Limpiar página SAT: eliminar UI muerta (mismo patrón que T1). *Files: `app/dashboard/compliance/sat/page.tsx`. Size S. — **Agregada durante implementación: hallada en T2, requerida por el Checkpoint: Trust (3 botones disabled sin ruta de activación).***
  - **Acceptance:**
    - [ ] Cero botones permanentemente `disabled` ("Resumen Fiscal Anual", "Reporte ISR Mensual", "Annual Tax Summary" — ninguno tiene feature detrás)
    - [ ] Tabs stub Validación/Constancias (que solo enlazan) eliminados o reemplazados por navegación real
    - [ ] Tab "Configuración" ("próxima versión") eliminado
    - [ ] Strings EN del tab Reportes eliminados con el tab
  - **Verify:** `pnpm run build`; recorrido manual — todo control visible hace algo.
  - **Deps:** T2.

### ⛔ Checkpoint: Trust
- [ ] Cero botones permanentemente deshabilitados sin ruta de activación
- [ ] Cero números sin fuente de datos
- [ ] Envío WA reporta resultado real de la API
- [ ] `pnpm run build` limpio
- [ ] **Gate:** Fase 3 bloqueada hasta cerrar este checkpoint

---

## Fase 1 — Color semántico

- [ ] **T7** Agregar variant `success` a Badge. *Files: `components/ui/badge.tsx`. Size XS.*
  - **Acceptance:**
    - [ ] Variant `success: "bg-success text-success-foreground"` agregado (tokens ya existen en `globals.css` light+dark — verificado)
    - [ ] Hover state consistente con los demás variants (`[a&]:hover:bg-success/90`)
  - **Verify:** `pnpm run build`; render manual `<Badge variant="success">` en light y dark.
  - **Deps:** None.

- [ ] **T8** Crear `<RateBadge />` — dueño único de umbrales. *Files: `components/compliance/rate-badge.tsx` (nuevo). Size S.*
  - **Acceptance:**
    - [ ] API: `<RateBadge rate={number} showLabel? />`
    - [ ] Umbrales en un solo lugar: ≥90 → `success`/"Excelente", ≥70 → `warning`/"Bueno", <70 → `destructive`/"Crítico"
    - [ ] Maneja `null`/`undefined` → "Sin datos" (regla D2)
    - [ ] Usa los variants de Badge de T7, no clases hardcodeadas
  - **Verify:** `pnpm run build`; render de 95/85/50/null → cuatro estados correctos.
  - **Deps:** T7.

- [ ] **T9** Adoptar `<RateBadge />` en los archivos con umbrales duplicados. *Files: `compliance-dashboard.tsx`, `corporate-compliance-grid.tsx`, `nom251-report.tsx` (verificar `nom035-report.tsx` con grep — la verificación de 2026-07-28 no encontró `>= 90` ahí). Size S.*
  - **Acceptance:**
    - [ ] Las 3 implementaciones de umbrales reemplazadas por `<RateBadge />`
    - [ ] Badge `default` (rojo) ya no representa "Excelente" en ningún archivo
    - [ ] `grep -rln ">= 90" components/compliance/` → solo `rate-badge.tsx`
  - **Verify:** grep de verificación + `pnpm run build`; inspección visual de badges ≥90 (verde), ≥70 (ámbar), <70 (rojo).
  - **Deps:** T8.

- [ ] **T10** Sweep de utilidades hardcodeadas + polish visual. *Files: los ~6 archivos de `components/compliance/` y `app/dashboard/compliance/` con las 161 utilidades + `psychosocial-dashboard.tsx`. Size M.*
  - **Acceptance:**
    - [ ] `grep -rhoE "(text|bg|border)-(green|yellow|red|orange)-[0-9]{3}" app/dashboard/compliance components/compliance | wc -l` ≈ 0 (baseline: 161)
    - [ ] `psychosocial-dashboard` switches MU Y_ALTO/ALTO/MEDIO/BAJO migrados a tokens semánticos (mapa explícito: MUY_ALTO/ALTO→destructive, MEDIO→warning, BAJO→success — o componente `RiskBadge` si emerge un patrón; NO introducir RateBadge aquí, son escalas distintas)
    - [ ] Area chart: `stopOpacity` 1.0 → 0.2 (flat-by-default)
    - [ ] PDF header azul `[59,130,246]` → rojo de marca o neutral de paleta
    - [ ] `font-extrabold` → `font-bold` (rampa ≤700)
    - [ ] `text-[10px]` ×2 → `text-xs`; tooltip `borderRadius: 8px` → token `rounded` (3 advisories del detector resueltos)
    - [ ] Progress con color inline → variante de componente
  - **Verify:** grep ≈ 0; `pnpm run build`; revisión visual — rojo Operacional solo en acciones de marca (≤10-15% de pantalla).
  - **Deps:** T9 (el sweep sin RateBadge se revierte).

### ⛔ Checkpoint: Color
- [ ] Los 3 greps de verificación en meta
- [ ] `pnpm run build` limpio
- [ ] Dark mode verificado (tokens `success` difieren light/dark)

---

## Fase 2 — Un idioma

- [ ] **T11** Sweep ES-MX en componentes del dashboard. *Files: `compliance-dashboard.tsx`, `corporate-compliance-grid.tsx`. Size S.*
  - **Acceptance:**
    - [ ] "Total Workflows" → "Flujos Completados"; "Last 30/90 days" → "Últimos 30/90 días"; "Completed in period", "critical", "Next 30 days", "No compliance data available" → ES-MX
    - [ ] "Need IMSS registration/deregistration" (si renderiza en estos componentes) → ES
    - [ ] Chart `toLocaleDateString("en-US")` → `"es-MX"`
    - [ ] Dropdown de período 100% en un idioma
  - **Verify:** grep de strings EN conocidos = 0; inspección visual del dropdown y chart.
  - **Deps:** None (paralelizable con Fase 1 si hay capacidad, pero no mezclar commits).

- [ ] **T12** Headers de PDF en español. *Files: generadores PDF en `compliance-dashboard.tsx` y `nom251-report.tsx`. Size S.*
  - **Acceptance:**
    - [ ] Headers de tabla: `Alerta/Severidad/Estado/Flujo/Fecha` (ES)
    - [ ] "No active alerts" → ES
    - [ ] Ningún string EN en el PDF generado (excepción: nombres propios SUA/IDSE/IMSS/COFEPRIS)
  - **Verify:** generar PDF de cada reporte y revisar texto extraído (`pdftotext` o inspección visual).
  - **Deps:** T6 (validación ya en su lugar), T10 recomendado (color del header ya corregido).

- [ ] **T13** Empty states con acción + error visible de `/api/branches`. *Files: `app/dashboard/compliance/page.tsx`, componentes con empty states. Size S.*
  - **Acceptance:**
    - [ ] Todo empty state tiene acción siguiente (ej. "Sin datos de cumplimiento — verifica que haya flujos completados en el período" + link)
    - [ ] Fallo de `/api/branches` muestra toast/inline visible, no solo `console.error`
    - [ ] "Generate SUA/IDSE File" y strings EN restantes de `imss/page.tsx` → ES
  - **Verify:** manual: desconectar API → error visible; visitar cada empty state → CTA presente.
  - **Deps:** T1 (página IMSS ya limpia).

### ⛔ Checkpoint: Idioma
- [ ] Cero strings EN en UI y PDFs (excepción nombres propios)
- [ ] `pnpm run build` limpio

---

## Fase 3 — IA: tres destinos

- [ ] **T14** Crear `/dashboard/compliance/reportes` y mover los tabs de reportes. *Files: `app/dashboard/compliance/reportes/page.tsx` (nuevo), `app/dashboard/compliance/page.tsx`. Size M.*
  - **Acceptance:**
    - [ ] Nueva página con NOM-251, NOM-035, export nómina
    - [ ] Selectores sucursal/período viven en esta página como parámetros del documento (junto al botón generar — D1)
    - [ ] `page.tsx` principal queda como Semáforo puro (dashboard + corporate grid), sin tabs de reportes
    - [ ] Usa `PageHeader` consistente
  - **Verify:** `pnpm run build`; flujo completo: seleccionar sucursal/período → preview → PDF.
  - **Deps:** Checkpoint: Trust cerrado.

- [ ] **T15** Crear `registros/imss` y mudar generadores SUA/IDSE. *Files: `app/dashboard/compliance/registros/imss/page.tsx` (nuevo), `components/compliance/imss/sua-generator.tsx`, `components/compliance/imss/idse-generator.tsx`, `app/dashboard/compliance/imss/*`. Size M.*
  - **Acceptance:**
    - [ ] `SUAGenerator`/`IDSEGenerator` movidos y funcionando en `registros/imss` (D5: IMSS una sola casa)
    - [ ] Contenido de `imss/altas`, `imss/bajas`, `imss/reports`, `imss/sua` absorbido o rehogado bajo `registros/imss`
    - [ ] Tab IMSS de la página principal eliminado
    - [ ] Rutas viejas `/compliance/imss*` responden (redirect o stub — T16 las finaliza)
  - **Verify:** `pnpm run build`; generar archivo SUA e IDSE end-to-end desde la nueva ruta.
  - **Deps:** T14.

- [ ] **T16** Rehogar rutas huérfanas restantes + redirects permanentes. *Files: `app/dashboard/compliance/registros/{sat,laboral}/page.tsx` (nuevos), páginas viejas con `redirect()`. Size M.*
  - **Acceptance:**
    - [ ] `registros/sat` absorbe `sat/certificates` + `sat/validation`
    - [ ] `registros/laboral` absorbe `overtime`, `breaks`, `schedules`, `payroll`
    - [ ] `redirect()` permanente en TODAS las páginas viejas (resolver Q2 primero: redirect inmediato vs banner transitorio)
    - [ ] `grep` de verificación: cada ruta tiene link entrante fuera de su propio directorio
  - **Verify:** greps de huérfanas = 0; visitar 3 URLs viejas → redirect a la nueva ubicación.
  - **Deps:** T15. **Bloqueado por Q2.**

- [ ] **T17** Sidebar: Cumplimiento → 3 destinos. *Files: `components/app-sidebar.tsx` (~línea 226). Size S.*
  - **Acceptance:**
    - [ ] Sub-items: Semáforo (`/dashboard/compliance`), Reportes (`/reportes`), Registros (`/registros`) + existentes (Auditoría, Constructor, Verificaciones AI)
    - [ ] Sub-item corporativo estable: si 1 sucursal → se oculta del sidebar, no cambian posiciones de tabs (adelanta T22)
    - [ ] Toda página alcanzable en ≤2 clicks desde el sidebar
  - **Verify:** `pnpm run build`; recorrido manual del sidebar con tenant multi-sucursal y mono-sucursal.
  - **Deps:** T14, T16 (las rutas deben existir).

- [ ] **T18** Expediente de Auditoría (D4). *Files: `app/dashboard/compliance/registros/expediente/page.tsx`, consumiendo lógica de `app/dashboard/compliance/expediente/page.tsx`. Size M.*
  - **Acceptance:**
    - [ ] Vista de audit-readiness: documentos vigentes / por vencer (30 días) / vencidos
    - [ ] Acción imprimir/descargar por documento
    - [ ] Responde la pregunta: "si COFEPRIS llega hoy a las 6pm, ¿qué le presento?"
    - [ ] Ayuda NOM-251/035 contextual ("?" dentro de cada tab de reporte), reusando el contenido rescatado en T3
    - [ ] Ruta vieja `/compliance/expediente` con redirect
  - **Verify:** `pnpm run build`; documento por vencer aparece en la banda correcta; descarga funciona.
  - **Deps:** T3 (contenido de ayuda), T16.

- [ ] **T19** Page chrome consistente. *Files: `app/dashboard/compliance/registros/**/*.tsx` (heredados de `imss/`, `sat/`). Size XS.*
  - **Acceptance:**
    - [ ] Todas las páginas de compliance usan `PageHeader`; cero `<h1 class="text-3xl">` custom
  - **Verify:** `grep -rn "text-3xl" app/dashboard/compliance/` = 0; `pnpm run build`.
  - **Deps:** T15, T16.

### ⛔ Checkpoint: IA
- [ ] Toda página alcanzable en ≤2 clicks desde sidebar
- [ ] Cero rutas huérfanas (grep)
- [ ] Redirects de rutas viejas verificados
- [ ] `pnpm run build` limpio

---

## Fase 4 — Flatten + contexto único

- [ ] **T20** Aplanar tabs anidados del dashboard. *Files: `components/compliance/compliance-dashboard.tsx`. Size M.*
  - **Acceptance:**
    - [ ] Sub-vistas (Evaluaciones/Tendencias/Vencimientos/Alertas/Por Sucursal) → segmented control o secciones apiladas
    - [ ] Máximo 2 capas de navegación en pantalla en toda la superficie de compliance
    - [ ] Cero tabs dentro de tabs
  - **Verify:** `pnpm run build`; conteo visual de capas de tabs en cada página ≤2.
  - **Deps:** T14 (los tabs de reportes ya salieron de la página principal).

- [ ] **T21** Contexto de filtro único. *Files: `app/dashboard/compliance/page.tsx`, posiblemente `app/dashboard/layout.tsx`. Size M.*
  - **Acceptance:**
    - [ ] Semáforo: período+sucursal propios y visibles, afectan todo lo visible
    - [ ] Reportes: parámetros junto al botón generar (ya de T14 — verificar)
    - [ ] Selector del header que no aplica a todos los tabs: eliminado o adoptando `BranchScopeControl` del Dashboard Consistency Pass (resolver Q1 primero)
    - [ ] Ningún selector visible que no afecte al contenido visible
  - **Verify:** cambiar cada selector → contenido visible cambia; `pnpm run build`.
  - **Deps:** T14, T20. **Bloqueado por Q1** (coordinación con `tasks/plan.md`).

- [ ] **T22** Tab corporativa estable + fix prop `PayrollExport`. *Files: `app/dashboard/compliance/page.tsx`, `components/compliance/payroll-export.tsx`. Size S.*
  - **Acceptance:**
    - [ ] Corporate grid no se monta/desmonta por `branches.length` (posiciones estables entre tenants)
    - [ ] `PayrollExport` ya no recibe `branchId` como `companyId` — fix en call site o prop renombrado (resolver Q3 revisando el contrato de la API)
  - **Verify:** `pnpm run build`; export de nómina genera con la compañía correcta (verificar en el archivo generado).
  - **Deps:** T17 (sidebar ya maneja el caso mono-sucursal). **Bloqueado por Q3.**

- [ ] **T23** Skeletons en lugar de spinners. *Files: `app/dashboard/compliance/**/loading.tsx` o fallbacks en componentes. Size S.*
  - **Acceptance:**
    - [ ] Cero spinners centrados en la superficie de compliance
    - [ ] Skeletons de cards/tablas que reflejan la forma del contenido
    - [ ] `role="status"` en regiones de carga (adelanta a11y)
  - **Verify:** throttling de red en DevTools → skeletons visibles en cada página; `pnpm run build`.
  - **Deps:** T14–T19 (estructura de rutas final).

### ⛔ Checkpoint: Layout
- [ ] Máximo 2 capas de navegación
- [ ] Ningún selector visible que no afecte al contenido visible
- [ ] `pnpm run build` limpio

---

## Fase 5 — Verificación

- [ ] **T24** Polish a11y. *Files: superficie completa `app/dashboard/compliance/`. Size S.*
  - **Acceptance:**
    - [ ] `htmlFor`/`id` en todos los date inputs (T6 parcialmente adelantó)
    - [ ] `role="status"` en regiones de carga (T23 parcialmente adelantó)
    - [ ] Focus visibles en todos los controles interactivos
    - [ ] Navegación completa por teclado en Semáforo, Reportes, Registros
  - **Verify:** recorrido con Tab por las 3 páginas principales; axe/DevTools sin violaciones críticas nuevas.
  - **Deps:** T20–T23.

- [ ] **T25** Re-critique y cierre. *Files: `.impeccable/critique/` (nuevo snapshot). Size S.*
  - **Acceptance:**
    - [ ] `$impeccable critique app/dashboard/compliance/` ejecutado
    - [ ] Score ≥28/40 (banda "Good")
    - [ ] Heurística 4 (Consistencia) ≥3, Heurística 6 (Reconocimiento) ≥3
    - [ ] Verificaciones continuas del plan fuente §4 en verde (greps + build)
    - [ ] Gaps restantes documentados como follow-ups (no silenciados)
  - **Verify:** snapshot del critique commiteado; comparación contra baseline 18/40.
  - **Deps:** T24.

### ⛔ Checkpoint: Complete
- [ ] Todas las acceptance criteria cerradas
- [ ] Re-critique ≥28/40
- [ ] Review con humano antes de cerrar la iniciativa

---

## Oportunidades de paralelización

| Paralelo seguro | Secuencial obligatorio | Requiere coordinación |
|---|---|---|
| T1, T2, T3, T5 entre sí (archivos distintos) | T7 → T8 → T9 → T10 (cadena de color) | T21 con Dashboard Consistency Pass (Q1) |
| T4, T6 entre sí | T14 → T15 → T16 → T17 → T18 (cadena de rutas) | T16 con decisión de redirects (Q2) |
| T11 con Fase 1 (commits separados) | Checkpoint: Trust → Fase 3 | T22 con contrato API (Q3) |
