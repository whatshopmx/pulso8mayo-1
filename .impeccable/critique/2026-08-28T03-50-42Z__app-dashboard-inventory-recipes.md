---
target: app/dashboard/inventory/recipes
total_score: 39
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
timestamp: 2026-08-28T03-50-42Z
slug: app-dashboard-inventory-recipes
---
### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|:-----:|-----------|
| 1 | Visibility of System Status | 4 | Resumen en vivo de Food Cost %, KPIs de salud de margen y subtotales en tiempo real por ingrediente. |
| 2 | Match System / Real World | 4 | Vocabulario gastronómico exacto (BOM, escandallos, margen bruto, tiempo de retención y sub-recetas). |
| 3 | User Control and Freedom | 4 | Búsqueda y filtrado instantáneo por platillo/granel/alerta, constructor ágil de ingredientes y simulación. |
| 4 | Consistency and Standards | 4 | Total conformidad con DESIGN.md: tokens semánticos, diseño flat sin sombras difusas, piso mínimo 12px. |
| 5 | Error Prevention | 4 | Alerta preventiva si hay insumos sin costo base registrado y botones de incremento rápido (+1..+10). |
| 6 | Recognition Rather Than Recall | 4 | Subtotal de costo por fila de ingrediente visible de inmediato sin tener que calcular mentalmente. |
| 7 | Flexibility and Efficiency | 4 | Modales ágiles con atajos de porciones, filtrado rápido de recetas y simulador de inflación de insumos. |
| 8 | Aesthetic and Minimalist Design | 4 | Tarjetas limpias, jerarquía tipográfica Geist, números tabulares font-mono alineados a la derecha. |
| 9 | Error Recovery | 4 | Manejo de errores con mensajes toast específicos y validaciones antes del envío. |
| 10 | Help and Documentation | 3 | Textos contextuales claros explicando la ventana de retención en línea y el impacto en Food Cost. |
| **Total** | | **39/40** | **Excellent (97.5%)** |

---

### Design Specificity Verdict
**LLM assessment**: La pantalla de Recetas y Costeo (`/dashboard/inventory/recipes`) se convirtió en una herramienta de ingeniería de menú y costeo de nivel profesional para chefs ejecutivos y directores de alimentos y bebidas. El cálculo en vivo del costo por línea permite identificar de inmediato qué insumo encarece la receta, y el simulador de inflación ayuda a anticipar fluctuaciones de mercado.

**Deterministic scan**: `0 antipatterns`.
