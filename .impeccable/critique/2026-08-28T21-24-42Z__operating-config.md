---
timestamp: 2026-08-28T21-24-42Z
slug: operating-config
target: "app/dashboard/company/operating-config"
total_score: 26
max_score: 40
na_heuristics: ""
p0_count: 0
p1_count: 3
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3/4 | Buen feedback en guardado (toast/spinners), pero la carga inicial carece de skeleton y no hay indicador de cambios pendientes (dirty state). |
| 2 | Match System / Real World | 2/4 | Fuga masiva de jerga técnica y referencias de especificación: "(Fase 11)", "(§2)", "(loteprod §8.1)", "Misas de compra", y disculpas de ingeniería "(La doble firma... todavía no existe)". |
| 3 | User Control and Freedom | 2/4 | Sin botón para descartar cambios o restablecer valores por defecto. Si el usuario modifica campos por error, debe recargar la página completa. |
| 4 | Consistency and Standards | 3/4 | Patrones Radix/Shadcn consistentes, pero uso de color verde Tailwind hardcodeado (`text-emerald-600`) rompiendo los tokens OKLCH del sistema. |
| 5 | Error Prevention | 3/4 | Excelente validación cruzada en parejas de KPIs porcentuales, pero los campos monetarios admiten valores crudos sin formateo de moneda ($) ni máscaras visuales. |
| 6 | Recognition Rather Than Recall | 2/4 | 7 dropdowns ocultan las alternativas operativas obligando al usuario a abrir cada uno; los umbrales de costos exigen cálculo mental sin barra visual de rangos (verde/amarillo/rojo). |
| 7 | Flexibility and Efficiency | 3/4 | Navegación por teclado funcional en inputs, pero carece de presets o plantillas rápidas de configuración ("Grupo Corporativo", "Franquicias", "Dark Kitchen"). |
| 8 | Aesthetic and Minimalist Design | 2/4 | Textos de ayuda sobrecargados; cuadrícula desbalanceada (5 inputs en grid de 3 columnas); 18 controles simultáneos sin revelación progresiva. |
| 9 | Error Recovery | 3/4 | Mensajes de error claros y en español al pie de cada par de KPI con `role="alert"`. |
| 10 | Help and Documentation | 3/4 | Cada campo incluye descripción, pero varias redactadas con lenguaje meta-analítico de especificación en lugar de guía operativa práctica. |
| **Total** | | **26/40** | **Acceptable (65%)** |

---

## Design Specificity Verdict

**LLM Assessment**: 
La pantalla aborda una necesidad crítica y única de la industria HORECA en México (definir el modelo de gobernanza entre corporativo y sucursales para 3 a 15 unidades). Sin embargo, su ejecución visual actual es la de un formulario CRUD plano con 18 campos apilados sin jerarquía visual. La experiencia se siente más cercana a un panel de administración de base de datos que al centro de comando de un director de operaciones restaurantero. Además, la presencia de citas de documentos internos (`§2`, `Fase 11`, `loteprod §8.1`) resta sofisticación y profesionalismo al producto.

**Deterministic Scan (`detect.mjs`)**:
El detector CLI reportó 0 infracciones de sintaxis o anti-patrones de Tailwind v4 en los archivos analizados (`page.tsx` y `operating-config-form.tsx`).

**Visual Overlays**:
El servidor de desarrollo no se encontraba en ejecución activa en `localhost:3000`, por lo que la inyección dinámica de overlays en navegador fue omitida, procediendo con la evaluación estática y análisis heurístico contextual.

---

## Overall Impression

El formulario contiene una lógica de negocio y validación sólida (especialmente el manejo de pares objetivo/alerta en KPIs financieros), pero su presentación visual es árida y sufre de sobrecarga cognitiva. Transformar los 7 dropdowns en tarjetas de selección segmentada con resumen de impacto operativo, añadir visualización gráfica de rangos para los semáforos de costos, y limpiar la jerga técnica elevaría esta pantalla a un estándar de software de grado directivo.

---

## What's Working

1. **Validación contextual de KPIs (`TargetPair`)**: La lógica que previene inconsistencias lógicas en los umbrales de advertencia vs. objetivo (tanto en costos donde menor es mejor, como en margen donde mayor es mejor) con mensajes de error accesibles (`aria-describedby`, `role="alert"`).
2. **Explicaciones operativas claras de los umbrales**: Las descripciones explican el porqué de cada límite financiero (ej. "Nadie aprueba lo que registró: siempre firma otra persona").
3. **Manejo robusto de tipos en la integración**: Conversión transparente entre centavos/pesos y soporte explícito para valores nulos ("Sin tope") sin romper la persistencia.

---

## Priority Issues

### [P1] Fuga de jerga interna, números de especificación y notas de ingeniería
- **Por qué importa**: Textos como `"(Fase 11)"` en el `h1`, `"(§2)"` en la tarjeta, `"(loteprod §8.1)"` en el tope de mermas, y la disculpa técnica `"(La doble firma... todavía no existe; hoy esto eleva el rol exigido.)"` hacen que el software parezca un prototipo en desarrollo en lugar de una plataforma operativa consolidada.
- **Solución**: Limpiar todos los títulos y ayudas contextuales eliminando notas internas y jerga de sprints. Reformular la explicación del umbral de doble aprobación enfocándose en lo que el sistema hace hoy ("Gastos a partir de este monto requieren autorización de Dirección General / Dueño").
- **Comando sugerido**: `$impeccable clarify`

### [P1] Sobrecarga cognitiva y falta de escaneabilidad en las 7 Dimensiones
- **Por qué importa**: 7 menús desplegables (`Select`) en una cuadrícula 2D ocultan las alternativas y exigen al usuario abrir cada dropdown para entender la configuración del grupo. No hay retroalimentación visual de cómo interactúan estas dimensiones.
- **Solución**: Reemplazar los dropdowns estándar por grupos de tarjetas de opciones con estado activo claro (pills o segmented radio cards) organizadas en 3 categorías lógicas: *Operación y Alimentos* (Compras, Cocina), *Tesorería y Finanzas* (Cuentas, Pagos, Nómina), y *Gobernanza* (Autonomía, Tipo de Tenant).
- **Comando sugerido**: `$impeccable layout`

### [P1] Ausencia de representación visual en los semáforos de KPIs
- **Por qué importa**: Los objetivos de Food Cost, Labor Cost y Margen son números abstractos en inputs de texto. Un restaurantero necesita ver visualmente la zona segura (verde), de precaución (amarillo) y crítica (rojo) para calibrar sus metas intuitivamente.
- **Solución**: Incorporar una barra visual de rango continuo debajo de cada par de inputs que muestre en tiempo real el espectro cromático según los porcentajes ingresados.
- **Comando sugerido**: `$impeccable delight`

### [P2] Campos monetarios sin formato ni adornos de divisa
- **Por qué importa**: Inputs numéricos crudos para montos de $10,000, $100,000 o $1,000,000 facilitan errores por ceros faltantes o sobrantes. Además, la cuadrícula de 3 columnas deja 2 campos huérfanos en la segunda fila.
- **Solución**: Añadir prefijo `$` y sufijo `MXN` dentro de los inputs, formatear visualmente con separadores de miles, y reestructurar el layout a una cuadrícula de 2 columnas equilibrada con agrupación semántica.
- **Comando sugerido**: `$impeccable polish`

### [P2] Falta de barra de acción persistente y control de cambios
- **Por qué importa**: Al editar dimensiones en la parte superior, el usuario debe scrollear hasta el fondo de 18 campos para guardar. No hay botón de cancelar/descartar ni aviso de cambios no guardados.
- **Solución**: Implementar una barra de acciones inferior flotante/sticky que aparezca solo cuando hay cambios sucios (`isDirty`), con botones "Descartar" y "Guardar Cambios".
- **Comando sugerido**: `$impeccable harden`

---

## Persona Red Flags

- **Alex (Director General / CFO de Cadena)**:
  - *Red Flag*: Los campos de umbrales en montos grandes ($1,000,000) no tienen separadores de miles ni formato de moneda, aumentando el riesgo de error al ingresar límites de autorización corporativa.
  - *Red Flag*: Debe configurar 18 campos individualmente; no existen preajustes de 1-click para tipologías estándar de grupo (ej. "Cadena Centralizada Tradicional" vs. "Grupo Descentralizado").
- **Jordan (Dueño de 3 Sucursales / Primerizo)**:
  - *Red Flag*: Encuentra advertencias técnicas como `(loteprod §8.1)` y disculpas de ingeniería que generan desconfianza sobre la madurez del sistema.
  - *Red Flag*: No comprende el impacto real de cambiar "Modelo de Tesorería" a "Mixto" porque el dropdown no ofrece un resumen visual de consecuencias operativas.
- **Sam (Usuario con Navegación Asistida / Accesibilidad)**:
  - *Red Flag*: La carga de la página usa un spinner simple sin esqueleto (`Skeleton`), provocando salto de foco cuando el formulario finalmente se renderiza.

---

## Minor Observations

- El icono del encabezado de la tarjeta de umbrales usa `text-emerald-600` directo en lugar de variables semánticas o tono neutro.
- La opción de compras dice `"Misas de compra por corporativo"` (posible error tipográfico por "Mesas de compra").
- El estado de carga del botón de guardar dice `"Guardar Configuración Operativa"` pero el spinner reduce la visibilidad del texto durante el guardado.

---

## Questions to Consider

- ¿Podríamos ofrecer 3 arquetipos preconfigurados al inicio (ej. *"Grupo Corporativo Centralizado"*, *"Franquicia con Comisariato"*, *"Operación Independiente Multi-sucursal"*) que rellenen las 7 dimensiones con un solo clic?
- ¿Cómo se vería un indicador visual tipo termómetro/gauge en tiempo real para calibrar los márgenes de Food & Labor Cost?
- ¿Debería la barra de guardado ser fija en la parte inferior para evitar el desplazamiento vertical innecesario?
