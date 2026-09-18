# Ventas — Critique 2026-09-17 — Task List

Critique score: **29/40 (Good)** → target **≥ 32/40**. Snapshot: `.impeccable/critique/2026-09-17T19-07-08Z__app-dashboard-sales.md`.
Evidencia de browser (capturas con datos reales): `.impeccable/critique/shots/desktop-analytics.png`, `desktop-cuts.png`, `mobile-analytics.png`.
Sin cambios de backend salvo donde se indica (Task 2 opcional B).

---

## Fase 1: P1 — Verdad de los datos (3 tareas)

### Task 1: La gráfica de tendencia no dibuja la serie (P1 #1)

**Description:** "Tendencia de Ventas Diarias" renderiza ejes, fechas y dominio Y (0–80,000) pero **sin área ni línea** (captura de evidencia). Causa probable: `components/sales/sales-dashboard.tsx:70-74` alimenta `dataKey="Venta"` con **strings** (`(pt.totalSalesCents / 100).toFixed(2)`); Recharts calcula el dominio del eje pero el path `type="monotone"` va a NaN. Arriba de la gráfica el KPI afirma $1.6M / 93 cortes, así que los datos existen: es un defecto de render, no de datos.

**Acceptance criteria:**
- [ ] `formattedTrend` pasa **números**: `Venta: pt.totalSalesCents / 100` (sin `toFixed`)
- [ ] El tooltip formatea dinero (ya lo hace: `$${Number(value).toLocaleString("es-MX")}`)
- [ ] El eje Y formatea compacto es-MX vía `tickFormatter` (ej. `$80,000`), sin decimales
- [ ] La tabla `sr-only` espejo mantiene el formato de dinero legible (formatar ahí, no en el dato)
- [ ] Con la misma data sembrada, el área es visible en desktop y mobile

**Verification:**
- [ ] Visual: recargar `/dashboard/sales` y confirmar la serie dibujada (comparar contra la captura `desktop-analytics.png` que muestra el estado roto)
- [ ] Funcional: hover sobre un día muestra el monto con formato MXN correcto

**Dependencies:** None
**Files likely touched:** `components/sales/sales-dashboard.tsx`
**Estimated scope:** XS

---

### Task 2: El semáforo certifica artefactos como "Saludable" (P1 #2)

**Description:** Con datos reales el card muestra Food Cost **0.9%† "Saludable"** (objetivo <28%), Labor Cost **2.3% "Saludable"**, Margen **96.8%**, y el delta del título **"+2851.8% vs. período anterior"** en verde de éxito. La proveniencia está bien resuelta (marca † DERIVED + nota al pie), pero la **capa de veredicto** no tiene estado de suficiencia: 0.9% no es saludable, es "este número no tiene consumo detrás". `financial-kpi-cards.tsx:307-317` pinta cualquier `salesDeltaPercent >= 0` como `text-success` sin importar la magnitud.

**Acceptance criteria (opción A — solo frontend, enviable ya):**
- [ ] Piso de plausibilidad antes del semáforo: si la métrica es `DERIVED`/`ESTIMATED` y el valor cae fuera de un rango operacional plausible (ej. cost < 3% o margen > 95%), el badge dice **"Sin datos de consumo suficientes"** en `statusBadgeClasses("neutral")` — nunca "Saludable"
- [ ] Piso de magnitud del delta: `|salesDeltaPercent| > 200` se muestra apagado (`text-muted-foreground`) con el rótulo "sin comparativa fiable" y el número real en `title`; nunca verde
- [ ] Los mismos pisos aplican a Labor Cost, Margen y al delta de margen (`DeltaBadge`)
- [ ] Los casos genuinamente sanos y plausibles siguen pintando success (no se rompe el caso feliz)

**Acceptance criteria (opción B — preferida, con backend):**
- [ ] `/api/finance/kpis` (servicio de KPIs financieros) expone por métrica `basisCount`/`dataSufficient` (ej. número de registros de consumo/asistencia que respaldan el cálculo)
- [ ] El semáforo consume `dataSufficient === false → "Sin datos suficientes"` (neutral) antes de evaluar OK/WARNING/CRITICAL
- [ ] El delta del título usa el mismo criterio: sin base comparable en el período anterior → "sin comparativa"

**Verification:**
- [ ] Visual: con la data de demo actual (consumo escaso), el card ya no dice "Saludable" en 0.9%/2.3%/96.8%
- [ ] Visual: con un tenant con consumo completo, los badges "Saludable" siguen apareciendo
- [ ] Build: `pnpm run build`

**Dependencies:** None (A) / servicio KPI (B)
**Files likely touched:** `components/sales/financial-kpi-cards.tsx`; opción B: `lib/services/financial-kpi-*.ts`, `app/api/finance/kpis/route.ts`, `lib/services/financial-kpi-types.ts`
**Estimated scope:** M (A) / L (B)

---

### Task 3: Dos períodos por omisión en una sola pantalla (P1 #3)

**Description:** El alcance del header dice "Todo el período"; `FinancialKpiCards` se manda `dateRange=undefined` y el API elige su propia ventana de 31 días ("93 cortes", "Periodo: 2026-08-18 a 2026-09-17"), mientras la tabla de cortes aplica **mes en curso** (~45 filas). El mismo sustantivo —"cortes"— muestra 93 y 45 en la misma URL, reconciliado solo por letra chica. Violación directa de "one platform, one truth".

**Acceptance criteria:**
- [ ] Una sola fuente del rango por omisión: la página usa `cutsScope` (lo que `/api/sales/cuts` aplicó de verdad, ya se captura en A8) y se la pasa **explícita** a `FinancialKpiCards` y `SalesDashboard` cuando la URL no trae fechas
- [ ] Sin loop de fetch: el rango derivado se memoíza; un cambio de sucursal no dispara ciclos
- [ ] La línea "Periodo: …" del KPI y el eco de alcance de la tabla siempre describen **la misma ventana**
- [ ] Al elegir fechas en el header, ambas mitades cambian juntas (comportamiento actual correcto se conserva)

**Verification:**
- [ ] Visual: sin fechas en la URL, KPI y tabla muestran el mismo rango y conteos conciliables (93 cortes ⇒ la tabla lista 93 o el alcance declarado coincide)
- [ ] Visual: con filtro de 7 días, ambas mitades cambian juntas
- [ ] Build: `pnpm run build`

**Dependencies:** None
**Files likely touched:** `app/dashboard/sales/page.tsx`, `components/sales/financial-kpi-cards.tsx`
**Estimated scope:** S

---

### Checkpoint: Fase 1
- [ ] Gráfica de tendencia dibuja la serie con la data sembrada
- [ ] Ningún badge "Saludable" sobre números sin base; ningún delta absurdo en verde
- [ ] Un solo rango por omisión conciliado entre KPI, gráficas y tabla
- [ ] Build limpio

---

## Fase 2: P2 — Tabla, color y flujos (6 tareas)

### Task 4: Tabla de cortes legible sin scroll horizontal (P2 #4)

**Description:** A 1280px la tabla de 12 columnas recorta "Cierre de turno validado automáticament…" a media palabra y "Recibido por" queda fuera del viewport (captura `desktop-cuts.png`). No hay sort, ni búsqueda, ni paginación, ni forma de ordenar por varianza: el banner dice "2 cortes con diferencia" y el usuario escanea 45 filas a mano. Sin `aria-sort`.

**Acceptance criteria:**
- [ ] "Formas de Pago" + "Arqueo efectivo" + "Terminal (TPV)" se agrupan en una celda "Conciliación" (los datos ya apilan verticalmente; el grupo reduce 3 columnas a 1)
- [ ] `validationNotes` con `line-clamp-1` + tooltip Radix con el texto completo (nada se corta a media palabra sin rescate)
- [ ] Encabezados Fecha / Venta Total / Diferencia ordenables (`aria-sort`, indicador visual, estado en memoria del componente)
- [ ] La fecha conserva su ancho (`whitespace-nowrap` ya está) y es la columna ancla del scroll si lo hay
- [ ] A 1280px la tabla completa es legible sin scroll horizontal; a 1024px el scroll (si queda) pierde solo columnas secundarias

**Verification:**
- [ ] Visual: 1280px sin corte de texto; hover en la nota muestra el tooltip completo
- [ ] Funcional: ordenar por Venta Total asc/desc; ordenar por Diferencia pone los faltantes arriba
- [ ] A11y: `aria-sort` presente en los encabezados ordenables
- [ ] Build: `pnpm run build`

**Dependencies:** None
**Files likely touched:** `app/dashboard/sales/page.tsx`
**Estimated scope:** L (la más grande del plan)

---

### Task 5: Colores semánticos solo para veredictos (P2 #5)

**Description:** Live: 45 badges ámbar "Manual" (token warning), turnos "Vespertino" en ámbar, orígenes "WhatsApp" en verde, y "Diferencia: cuadrado" en verde en cada fila. Cuando el ámbar significa "un turno" y el verde significa "una fuente", dejan de significar precaución/ok justo donde el módulo los necesita (los banners de varianza).

**Acceptance criteria:**
- [ ] Badges categóricos (Origen, Turno, Canal) → neutros: `variant="outline"` sin `statusBadgeClasses` semántico, o `bg-muted text-muted-foreground`
- [ ] "Diferencia: cuadrado" → chip apagado "✓ Cuadrado" (`text-muted-foreground`); solo faltante/sobrante llevan color
- [ ] Los veredictos reales conservan su semántica: Validado (success), Observación (warning), faltante (destructive)
- [ ] El banner de arqueo sigue destructivo y el de TPV warning (sin cambios — son veredictos)

**Verification:**
- [ ] Visual: en la tabla, el color solo aparece donde hay un veredicto; los 45 "Manual" son neutros
- [ ] Visual: las filas con faltante destacan sin competir con "papelera" de verdes/ámbar
- [ ] Build: `pnpm run build`

**Dependencies:** None
**Files likely touched:** `app/dashboard/sales/page.tsx`
**Estimated scope:** S

---

### Task 6: Rojo operacional fuera de la decoración (P2 #6)

**Description:** La barra Efectivo vs Tarjeta pinta Efectivo de rojo (`bg-chart-1`) y el desglose por canal pinta una barra **roja al 100%** (`bg-primary`) para el renglón neutro TOTAL; además tres títulos de card llevan icono rojo. El rojo como categoría compite con el rojo como alarma y revienta el presupuesto del 10-15%.

**Acceptance criteria:**
- [ ] Barra E/T → `bg-chart-3` (efectivo) / `bg-chart-4` (tarjeta); letras E/T se conservan si siguen siendo legibles
- [ ] Barras de canal → paleta de charts por canal (Salón/Delivery/Eventos/TOTAL distinguibles); nada usa `bg-primary` como relleno de barra
- [ ] Iconos de títulos de card → `text-muted-foreground` (el rojo queda para CTA primario y alertas)
- [ ] En una captura del tab de analítica, el rojo cubre ≤ 15% (el botón "Registrar Corte" es el único rojo de acción)

**Verification:**
- [ ] Visual: captura antes/después del tab de analítica
- [ ] Modo oscuro: las barras siguen distinguibles (los tokens chart tienen variante dark)
- [ ] Build: `pnpm run build`

**Dependencies:** None
**Files likely touched:** `components/sales/financial-kpi-cards.tsx`, `components/sales/sales-dashboard.tsx`
**Estimated scope:** S

---

### Task 7: Recuperación y carga coordinadas en el tab de analítica (P2 #7)

**Description:** `SalesDashboard` y `FinancialKpiCards` hacen fetch por su cuenta (dos spinners desfasados) y sus estados de fallo dicen "recarga la página" sin acción — mientras la tabla de cortes, dos pestañas abajo, sí tiene Reintentar. Además `title={tpvVarianceNote(tpv)}` (`page.tsx:569`) es hover-only: inalcanzable por teclado/lector, el mismo antipatrón que el módulo erradicó en el botón `?` del h1.

**Acceptance criteria:**
- [ ] Ambos EmptyState de fallo llevan botón "Reintentar" que re-intenta **solo su componente** (mismo patrón que la tabla)
- [ ] El texto de fallo deja de pedir recargar la página
- [ ] `title` de la celda TPV → tooltip Radix (patrón ya usado en el mismo archivo) o botón `?` accesible
- [ ] Opcional: un esqueleto coordinado para el tab (un solo estado de carga visible mientras ambas fetches corren)

**Verification:**
- [ ] Funcional: con la API caída (o 500 forzado), el tab muestra fallo con Reintentar funcional en ambos cards
- [ ] A11y: navegar por teclado hasta la celda TPV con varianza muestra el foco y la nota accesible
- [ ] Build: `pnpm run build`

**Dependencies:** None
**Files likely touched:** `components/sales/sales-dashboard.tsx`, `components/sales/financial-kpi-cards.tsx`, `app/dashboard/sales/page.tsx`
**Estimated scope:** S

---

### Task 8: Promesa de drag-and-drop (P2 #8)

**Description:** El dropzone dice "Selecciona o arrastra el reporte del POS" (`sales-cut-upload.tsx:337`, `upload/client.tsx:252`) pero no hay ningún handler de drag: arrastrar un archivo no hace nada, en silencio. Es la mentira más visible del flujo central de ingesta.

**Acceptance criteria:**
- [ ] `onDragOver`/`onDrop` implementados (state visual `border-primary` al arrastrar; el drop llena el mismo `file` state que el input)
- [ ] El feedback del nombre de archivo ya presente se conserva; drop de archivo inválido muestra rechazo con mensaje claro
- [ ] Si se prefiere no implementar drag: el copy cambia a "Selecciona el reporte del POS" en ambas superficies (decisión documentada aquí)

**Verification:**
- [ ] Funcional: arrastrar un .xlsx real sobre el dropzone lo selecciona y el upload completa
- [ ] Funcional: arrastrar un .txt/PDF muestra rechazo con mensaje claro
- [ ] Build: `pnpm run build`

**Dependencies:** None
**Files likely touched:** `components/sales/sales-cut-upload.tsx`, `app/dashboard/sales/upload/client.tsx`
**Estimated scope:** S

---

### Task 9: Una sola ingesta — resolver `/dashboard/sales/upload` huérfana (P2 #9)

**Description:** `/dashboard/sales/upload` (variante de página completa, mejor escala tipográfica) no está enlazada desde ningún lado (solo la menciona `HANDOFF-FASES-4-10.md`) y **carece** de los campos de conciliación TPV que sí tiene el diálogo — dos flujos para el mismo trabajo con capacidades distintas. Además usa `shadow-sm` + `group-hover:scale-105` contra flat-by-default.

**Acceptance criteria (decisión documentada, una de dos):**
- [ ] **Opción A (borrar):** se elimina `app/dashboard/sales/upload/` sin referencias rotas (verificar sidebar, smart links y tests)
- [ ] **Opción B (adoptar):** se enlaza desde el header del módulo (junto a "Plantillas POS"), se portan los campos TPV/comisión, y se unifica el copy con el diálogo
- [ ] En cualquiera de las dos: cero `shadow-*` en la superficie; hover con `bg` tonal, no scale

**Verification:**
- [ ] `rg "dashboard/sales/upload" app components lib tests` → solo referencias intencionales
- [ ] Build: `pnpm run build`; si se borra, correr también los specs de ventas (`tests/ventas-rbac.spec.ts`, `cortes-*`)

**Dependencies:** Task 8 (el drag cae en la superficie que sobreviva)
**Files likely touched:** `app/dashboard/sales/upload/**` (delete o edit), `app/dashboard/sales/page.tsx` (link si B)
**Estimated scope:** S (A) / M (B)

---

### Checkpoint: Fase 2
- [ ] Tabla completa legible a 1280px; notas nunca cortadas sin rescate
- [ ] Color solo en veredictos; rojo ≤ 15% del tab de analítica
- [ ] Reintentar en ambos cards de analítica; drag real o copy honesto
- [ ] Una sola superficie de ingesta (borrada o enlazada)
- [ ] Build limpio

---

## Fase 3: P3 — Pulido (2 tareas agrupadas, 9 hallazgos)

### Task 10: P3 quick-wins de tokens y copy (P3 #10, #12, #13, #14, #15)

**Acceptance criteria:**
- [ ] `text-[11px]` → `text-xs` en `components/sales/tpv-batch-entry-modal.tsx:461` (único hallazgo del detector; verificación: `node .agents/skills/impeccable/scripts/detect.mjs app/dashboard/sales components/sales` → 0)
- [ ] Un solo sistema de toast en el módulo: `tpv-batch-entry-modal.tsx:28` migra de `sonner` a `useToast` (o decisión inversa documentada para todo el módulo)
- [ ] Estado "sin terminales" del modal TPV enlaza de verdad a la config (Link a la ruta de Terminales TPV)
- [ ] Empty state de agregadores re-escrito sin jerga: nombra la ruta real de captura con link, o explica el Smart Link en una línea
- [ ] Breadcrumb "Sales" → "Cortes de Ventas": label map en `components/shared/breadcrumb-dynamic.tsx` (mismo tratamiento que los demás segmentos con nombre propio)

**Verification:** build limpio; detector 0 hallazgos; navegar por `/dashboard/sales` → `/dashboard/sales/mapping` y ver breadcrumb correcto.

**Files likely touched:** `components/sales/tpv-batch-entry-modal.tsx`, `app/dashboard/sales/page.tsx`, `components/shared/breadcrumb-dynamic.tsx`
**Scope:** S

---

### Task 11: P3 de datos y a11y fina (P3 #11, #16, #17, #18)

**Acceptance criteria:**
- [ ] `receivedAt` muestra fecha corta + hora (ej. "16 sep, 23:41") — `page.tsx:630-635`
- [ ] El botón `?` del h1 sale del `<h1>` (sigue en el header, mismo patrón, mismo aria-label); el heading queda limpio para SRs
- [ ] Fila "Margen tras food y labor" en mobile: label+`?` arriba, delta+valor+badge abajo sin flotar (captura `mobile-analytics.png` como antes)
- [ ] Hidratación: reproducir el mismatch (1 de 2 cargas), aislar la causa (sospechoso: `new Date().toLocaleDateString("en-CA", …)` en el form de ingesta bajo SSR) y corregir (default calculado en `useEffect`/estado inicial estable); verificar 3 cargas limpias de consola

**Verification:** consola sin errores de hidratación en 3 cargas seguidas; mobile 390px sin solapes en el card KPI.

**Files likely touched:** `app/dashboard/sales/page.tsx`, `components/sales/financial-kpi-cards.tsx`, `components/sales/sales-cut-upload.tsx`
**Scope:** M

---

### Checkpoint: Fase 3
- [ ] Detector: 0 hallazgos en `app/dashboard/sales` + `components/sales`
- [ ] Un solo sistema de toast en el módulo
- [ ] Breadcrumb en español consistente con el sidebar

---

## Verificación final

- [ ] `pnpm run build` limpio
- [ ] `pnpm run lint` limpio
- [ ] Specs de ventas: `npx playwright test tests/ventas-rbac.spec.ts tests/corte-arqueo.spec.ts tests/cortes-cota.spec.ts tests/corte-duplicado.spec.ts`
- [ ] Los 18 hallazgos del critique resueltos o diferidos con razón escrita aquí: (…)
- [ ] Re-corrida: `$impeccable critique app/dashboard/sales` → **≥ 32/40**

---

## Orden sugerido

1. **Task 1** (XS, desbloquea la mitad visual del módulo) → **Task 3** (S, coherencia) → **Task 2A** (M, sin backend)
2. **Task 5 + 6** (S, color discipline en paralelo) → **Task 4** (L, tabla)
3. **Task 7, 8, 9** (S c/u) → **Task 10, 11** (pulido)
4. Task 2B (backend `dataSufficient`) se puede agendar con el siguiente pase de KPIs financieros — 2A ya quita la mentira de pantalla.



