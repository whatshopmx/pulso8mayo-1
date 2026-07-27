---
target: todo el modulo de inventario @app/dashboard/inventory
total_score: 23
p0_count: 1
p1_count: 3
timestamp: 2026-07-27T17-48-42Z
slug: app-dashboard-inventory
---
# Critique: módulo de inventario (`app/dashboard/inventory` + `components/inventory`)

Method: dual-agent (A: ses_05b59138dffeSqUq7201Cixsbn · B: ses_05b588df6ffe0r9GbjUzpUgQNL)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Toasts/badges/stepper bien; alerts requiere "Actualizar" manual; spinners sin progreso |
| 2 | Match System / Real World | 3 | Vocabulario HORECA fuerte (merma, lote, FIFO, CFDI); mezcla EN/ES ("Modo Escaneo: ON/OFF", "Batch / Lote", "Staff") |
| 3 | User Control and Freedom | 2 | Merma se postea sin confirmación; conteo genera ajustes automáticos sin preview; cero undo |
| 4 | Consistency and Standards | 2 | `<select>` nativo en stock-count vs Radix en el resto; suppliers/locations sin PageHeader; "N/A"/"—"/"-" mezclados |
| 5 | Error Prevention | 2 | Cuarentena por temperatura y discrepancia OC excelentes; heurística de "frío" por string-matching de nombre frágil; merma sin límite duro |
| 6 | Recognition Rather Than Recall | 2 | 8 rutas huérfanas sin entrada en sidebar ni hub (suggested-orders, intelligence, production, periods, audit, claims, movements, expirations) |
| 7 | Flexibility and Efficiency | 1 | Tabla de productos sin paginación/sort/bulk/atajos; único bulk en página huérfana |
| 8 | Aesthetic and Minimalist Design | 3 | Home denso; QuickAlerts duplica tabs "Bajo Stock"/"Por Vencer"; icon-chips gastan el rojo operacional |
| 9 | Error Recovery | 2 | Retry embebido en select de proveedores (bien); errores API crudos en toasts; drawer "No se pudo cargar" sin retry |
| 10 | Help and Documentation | 1 | Card "Tipos de Merma" loable; cero onboarding/tooltips en KPIs ("Tasa de Match 3-Way" exige conocer el concepto) |
| **Total** | | **23/40** | **Acceptable — significant improvements needed** |

## Anti-Patterns Verdict

**LLM assessment**: Por encima del slop típico — lógica de dominio real (cuarentena por temperatura, conciliación 3-vías, FIFO por lotes), sin gradient text, sin glassmorphism, cards planas con borde 1px. Pero un usuario fluido en Linear/Stripe pausaría en: (1) card grid idéntico icono+heading+texto ×8 con `hover:scale-[1.02] transition-all` en `app/dashboard/inventory/page.tsx:171-276` — patrón baneado + movimiento decorativo; (2) mezcla spinner/skeleton: skeletons en home/alerts/receiving/audit pero spinner de página en purchase-orders, claims, locations, costing, production, recipes, reports, suggested-orders, product-detail-drawer; (3) modal-as-first-thought: wizard de recepción en Dialog scrolleable (`receiving-workflow.tsx:350`) y alta de producto con 12 campos en modal (`page.tsx:452-692`); (4) eyebrow en `invoices/page.tsx:978`; (5) empty states desiguales, el peor `return <div>Producto no encontrado</div>` (`[id]/page.tsx:46`).

**Deterministic scan**: `app/dashboard/inventory` → 0 findings (exit 0). `components/inventory` → 7 findings, todos `design-system-color` (advisory) en un solo archivo: `menu-engineering-matrix.tsx:32-35` — hex raw de Tailwind (`#16a34a`, `#2563eb`, `#d97706`, `#dc2626` + tints) que duplican los roles semánticos success/info/warning/destructive ya definidos en el sidecar. No es falso positivo. Checks mecánicos suplementarios: 0 side-stripes, 0 gradient text, 0 gradientes, 0 rounded ≥2xl; sombras solo 3 (print reset, hover permitido, tooltip de chart); 49 `animate-spin` vs 27 Skeletons (spinners concentrados en estados inline de botones + 9 cargas de página/sección); 1 eyebrow; hex hardcodeados solo en menu-engineering-matrix (+ grises neutros de recharts).

**Visual overlays**: no disponibles — sin tooling de browser automation en esta sesión; superficie autenticada (dev server responde 307 → /sign-in). Fallback: scan CLI + revisión de fuente.

## Overall Impression

El módulo está funcionalmente completo y mecánicamente limpio — el detector confirma que los bans decorativos se respetan. El problema no es cosmético, es estructural: 20+ destinos sin una IA que los gobierne, acciones irreversibles sin confirmación, y un lenguaje de carga inconsistente que delata el ensamblado por capas. La mayor oportunidad: convertir el home de "directorio de 8 cards" en un punto de partida orientado a la acción diaria (alertas → acción en un tap).

## What's Working

1. **Paso de control de calidad en recepción** (`receiving-workflow.tsx:564-661`): temperatura con validación visual + alerta de cuarentena con consecuencia escrita, chip "Ord: X (Rec: Y)" con highlight amber en discrepancia. Color que comunica estado — el uso correcto del vocabulario semántico.
2. **Feedback económico inmediato en merma** (`waste-form.tsx:83-85, 416-425`): auto-costo desde el lote + "Pérdida Estimada" en vivo. Enseña mientras se usa.
3. **Empty states honestos en KPIs** (`dashboard-kpis.tsx:70-81, 93-104`): "—" con altura reservada en vez de ceros falsos; sin CLS, sin mentiras. Suma el retry embebido en el select de proveedores.

## Priority Issues

1. **[P0] Rutas huérfanas: 8 páginas sin acceso por navegación.** `suggested-orders`, `intelligence`, `production`, `periods`, `audit`, `claims`, `movements`, `expirations` no están en `app-sidebar.tsx:99-152` (solo 13 ítems) ni en el hub. `suggested-orders` (reorden PAR + bulk-create de POs) es quizá la acción más valiosa del módulo y es invisible. *Fix:* consolidar IA en 4–5 grupos (Operar / Comprar / Analizar / Configurar) en sidebar + hub; eliminar o integrar el resto. *Comando:* `$impeccable distill app/dashboard/inventory`
2. **[P1] Acciones de alto riesgo sin confirmación ni recibo.** Merma se postea directo (`waste-form.tsx:449`); conteo auto-genera ajustes ya aplicados (`stock-count/page.tsx:163-166`, `results/page.tsx:93-94`). Un mis-tap con prisa = write-off irreversible. *Fix:* dialog de resumen pre-post ("Se darán de baja 12 KG de X, pérdida $340") + toast con link al registro; convertir results en paso de aprobación de ajustes. *Comando:* `$impeccable harden app/dashboard/inventory`
3. **[P1] Idioma de carga inconsistente (49 spinners vs 27 skeletons).** Skeletons en las rutas principales, spinner de página en 9 cargas (purchase-orders ×2, claims, locations, costing, production, recipes, reports, suggested-orders, product-detail-drawer). Es el tell más visible de "ensamblado por capas". *Fix:* extender `components/shared/skeletons.tsx` y reemplazar los `Loader2 animate-spin` de nivel página/sección (los inline de botón son legítimos). *Comando:* `$impeccable polish app/dashboard/inventory`
4. **[P1] Flujos centrales atrapados en modales.** Wizard de recepción en `Dialog max-w-4xl max-h-[90vh] overflow-y-auto` (`receiving-workflow.tsx:343,350`); alta de producto: 12 campos en grids de 3 columnas dentro de modal (`page.tsx:461-690`). En tablet (persona gerente) el scroll interno + teclado + targets `h-9` es hostil. *Fix:* recepción como página dedicada full-screen (modal solo para entrada rápida); alta de producto como página o drawer con secciones progresivas. *Comando:* `$impeccable adapt app/dashboard/inventory`
5. **[P2] Tabla de productos sin capacidades de poder.** Sin paginación (render completo, `page.tsx:402-443`), sin sort, sin selección múltiple, única acción "Ver"; drawer sin acciones (ni "Crear PO" ni "Ajustar"). Con 2,000 SKUs de 15 sucursales se degrada. *Fix:* paginación server-side, sort por columna, bulk-edit, acciones en el drawer. *Comando:* `$impeccable polish app/dashboard/inventory`

## Persona Red Flags

**Alex (power user):** Sin atajos de teclado documentados (solo Enter de barcode); tabla sin bulk ni sort; búsqueda solo client-side; el único flujo bulk vive en la página huérfana suggested-orders; QuickAlerts le hace procesar la misma info dos veces.

**Sam (accesibilidad):** Series del AreaChart distinguibles solo por color (`dashboard-charts.tsx:140-150`); spinners sin `aria-live` ni texto alternativo en 11 lugares; tooltip de menu-engineering con `bg-white` hardcodeado rompe dark mode (`menu-engineering-matrix.tsx:47`); `<details>` del hub no anuncia cuántas operaciones oculta.

**Gerente de sucursal (tablet, prisa, español):** Jerga en cards del hub ("soporta Conteo sin Stock Esperado", "conciliación de 3 vías", "archivos CFDI"); mezcla EN/ES ("Modo Escaneo: ON/OFF", "Batch / Lote", "Staff"); wizard en modal con inputs `h-9` y targets táctiles pequeños; merma sin confirmación = riesgo real bajo prisa; nombres inconsistentes para lo mismo ("Auditorías / Conteo" vs "Conteo de Inventario" vs "Alertas de Stock" vs "Alertas de Inventario").

## Minor Observations

- `alerts/page.tsx:220` — `<div />` vacío en CardHeader como hack de layout.
- Formato de moneda inline duplicado en 6+ archivos — falta util compartida.
- Tab "Inactivos" = stock 0 y no low-stock — semántica confusa vs "Sin stock".
- `dashboard-charts.tsx:44` — `date.slice(5)` frágil a locale; colores de series por índice.
- `audit/page.tsx:112` — `JSON.stringify(...).slice(0,100)` crudo en celdas.
- `executive-dashboard.tsx:86` — `roleView` selector cosmético client-side; cualquier usuario puede ponerse vista "OWNER".
- `img` con eslint-disable en vez de `next/image` (`page.tsx:408`, `[id]/page.tsx:74`).
- `claims/page.tsx:36-40` — badges pastel hardcodeados (bg-yellow-100 etc.) fuera del sistema semántico; se degradan en dark mode.
- `menu-engineering-matrix.tsx:32-35` — 8 hex raw duplicando roles semánticos (únicos findings del detector).
- `waste/page.tsx:22` redirige a `/login` (404; la ruta real es `/sign-in`) mientras `stock-count/page.tsx:67` usa `/auth/login` — inconsistencia de rutas de auth, y una de ellas está rota.

## Questions to Consider

1. Si mañana borraras las 8 rutas huérfanas, ¿alguien lo notaría? ¿Qué dice eso sobre cuál es el loop central real del módulo — y por qué `suggested-orders` está entre las invisibles?
2. ¿Por qué "recepción" (tarea diaria del gerente) es un modal y "merma" (también diaria) una página? Si el gerente solo tiene 90 segundos, ¿qué única acción debería dominar el home?
3. El KPI "Alertas Críticas: 7" grita en rojo… y no es clickeable ni tiene continuidad en el drawer. ¿Qué debería pasar en UN tap desde ese número?
4. ¿Qué tendría que cambiar para que `stock-count/[id]/results` fuera el paso de confirmación (revisar varianzas → aprobar ajustes) en vez de un reporte post-facto?
5. Si el rojo operacional solo puede ocupar 10-15% de la pantalla, ¿por qué se gasta en 8 icon-chips decorativos del hub en vez del único número que requiere acción urgente?
