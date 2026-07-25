# Plan de Implementación — Critique Compliance

Basado en critique `app/dashboard/compliance` (22/40). Siete fases secuenciales, cada una mapeada a un comando `/impeccable`.

---

## Fase 1: Harden — Bugs y robustez

**Comando**: `/impeccable harden app/dashboard/compliance`

| Prioridad | Archivo | Línea | Problema | Fix |
|-----------|---------|-------|----------|-----|
| P0 | `page.tsx` | 195 | `companyId={selectedBranch ? '' : ''}` siempre vacío | Cambiar a `{selectedBranch}` |
| P3 | `expediente/page.tsx` | 236 | Filas expandibles sin keyboard handler | Agregar `onKeyDown`, `role="button"`, `tabIndex` |
| P3 | `corporate-compliance-grid.tsx` | 118 | Delay incondicional de 800ms | Eliminar `await new Promise(resolve => setTimeout(resolve, 800))` |
| P3 | `imss/page.tsx` | 48 | Typo `bassesData` | Renombrar a `bajasData` |

---

## Fase 2: Colorize — Corregir paleta y tokens

**Comando**: `/impeccable colorize app/dashboard/compliance`

| Archivo | Línea(s) | Problema | Fix |
|---------|----------|----------|-----|
| `page.tsx` | 146 | `text-purple-600` en icono Brain (NOM-035) | Reemplazar con `text-info` o tint de primary |
| `page.tsx` | 306-316 | `bg-purple-50 border-purple-100 text-purple-900` en Info tab | Reemplazar con tokens de DESIGN.md |
| `corporate-compliance-grid.tsx` | 171-174 | Colores HSL para compliance (hsl(142,72%,29%) etc.) | Reemplazar con OKLCH tokens semánticos |
| `corporate-compliance-grid.tsx` | 322 | `rgba(0,0,0,0.1)` no documentado | Usar `--border` o token existente |

---

## Fase 3: Layout — IA, jerarquía y estructura

**Comando**: `/impeccable layout app/dashboard/compliance`

| Problema | Detalle | Acción |
|----------|---------|--------|
| 4-card stat row en 6+ páginas | Misma estructura idéntica en compliance, SAT, IMSS, expediente, overtime, breaks | Variar componente líder por tipo de página (stats vs alerts vs forms) |
| Sombras violan Flat-By-Default | `shadow-md`/`hover:shadow-lg` en corporate-compliance-grid.tsx líneas 215, 236, 255, 276, 303, 343 | Eliminar sombras; usar layering tonal |
| Sin breadcrumbs | Sub-páginas profundas (`compliance/sat/validation`, `compliance/imss/altas`) no indican posición | Agregar `<Breadcrumb>` component |
| 7 tabs + sub-tabs + 14 rutas | Sobrecarga de navegación | Mover SAT, IMSS, Nómina a sidebar; reducir tabs principales a 3-4 |

---

## Fase 4: Clarify — Idioma y copy

**Comando**: `/impeccable clarify app/dashboard/compliance`

| Página | Problema | Acción |
|--------|----------|--------|
| SAT (`sat/page.tsx`) | Tabs en inglés: "Overview", "Settings", "Salary Certificates" | Traducir a español: "Resumen", "Configuración", "Constancias" |
| IMSS (`imss/page.tsx`) | "Active Employees", "Settings", "Compliance Status" | Traducir a español |
| Dashboard (`compliance-dashboard.tsx`) | "Last 7 days", "All Branches", "Overall Compliance" | Traducir a español |
| Info tab | "Evita multas de COFEPRIS (hasta 16,000 UMAS)" — tono punitivo | Reframear como beneficios operativos |
| General | Fechas en `en-US` locale | Cambiar a `es-MX` |

---

## Fase 5: Distill — Simplificar IA y contenido

**Comando**: `/impeccable distill app/dashboard/compliance`

| Elemento | Problema | Acción |
|----------|----------|--------|
| Info tab | Contenido educativo compite con herramientas operativas | Mover a tooltips contextuales o ruta `/docs` separada |
| Info tab | Mismo icono `Shield` que el PageHeader | Eliminar redundancia |
| `page.tsx` | Descripción de 200+ caracteres en párrafo | Acortar a 1-2 líneas (max 70ch) |

---

## Fase 6: Audit — Accesibilidad

**Comando**: `/impeccable audit app/dashboard/compliance`

| Archivo | Problema | Acción |
|---------|----------|--------|
| `expediente/page.tsx` | Filas expandibles sin keyboard | Agregar `onKeyDown` (Enter/Space), `tabIndex={0}`, `role="button"` |
| Varios | `text-xs` (12px) en `text-muted-foreground` — posible fallo de contraste 4.5:1 | Verificar y ajustar |
| Varios | Badges de compliance solo con color (green/amber/red) | Agregar iconos o texto adicional |
| General | Sin `prefers-reduced-motion` | Agregar media query para animaciones |

---

## Fase 7: Polish — Pasada final

**Comando**: `/impeccable polish app/dashboard/compliance`

- Verificar que todas las sombras fueron eliminadas
- Confirmar consistencia de idioma (español en toda la superficie)
- Revisar espaciado y ritmo visual
- Confirmar que el tono general es "confident, sharp, operational"
- Probar flujo completo: seleccionar sucursal → navegar tabs → exportar

---

## Resumen de comandos

```bash
/impeccable harden app/dashboard/compliance
/impeccable colorize app/dashboard/compliance
/impeccable layout app/dashboard/compliance
/impeccable clarify app/dashboard/compliance
/impeccable distill app/dashboard/compliance
/impeccable audit app/dashboard/compliance
/impeccable polish app/dashboard/compliance
```

Ejecutar en orden. Cada fase depende de la anterior. Re-correr `/impeccable critique` al final para validar mejora.
