---
target: landing page del sistema
total_score: 22
max_score: 32
na_heuristics: 7,9
p0_count: 0
p1_count: 1
timestamp: 2026-11-18T18-40-45Z
slug: app-marketing-page-tsx
---
Método: dos evaluaciones independientes (A: /root/design_review · B: /root/detector_evidence).

Revisión provisional basada en código y detector. La inspección visual de escritorio y móvil quedó bloqueada por el entorno del navegador.

## Veredicto

La landing tiene identidad propia de Pulso, pero explica demasiado antes de resolver la decisión comercial. El ejemplo que conecta una desviación de temperatura con evidencia, mantenimiento, autorización y presupuesto es su argumento más convincente y debería conducir la página.

## Evaluación heurística: 22/32

| # | Heurística | Puntuación | Observación |
|---|---|---|---|
| 1 | Visibilidad del estado | 3/4 | Ejemplos con estados y datos demostrativos identificados. |
| 2 | Lenguaje del usuario | 3/4 | Contexto restaurantero concreto; jerga añade esfuerzo. |
| 3 | Control y libertad | 3/4 | Navegación por secciones y FAQ nativa. |
| 4 | Consistencia | 3/4 | Componentes compartidos; una orden tiene importes contradictorios. |
| 5 | Prevención de errores | 2/4 | Los enlaces por plan no transmiten la selección. |
| 6 | Reconocimiento | 3/4 | Ejemplos claros; recorrido demasiado extenso. |
| 7 | Eficiencia | n/a | Superficie de persuasión. |
| 8 | Diseño minimalista | 2/4 | Catorce secciones principales diluyen el argumento. |
| 9 | Recuperación de errores | n/a | Sin formulario ni flujo de error en esta portada; auth fuera del alcance. |
| 10 | Ayuda | 3/4 | FAQ útil; siguiente paso comercial poco definido. |

## Lo que funciona

- Los ejemplos de sucursales, temperaturas, compras y presupuestos muestran un producto específico para HORECA.
- Las limitaciones de WhatsApp y ERP están declaradas y los ejemplos se identifican como demostrativos.
- Buenas bases en el código: skip link, estructura semántica, FAQ nativa y etiquetas del menú.

## Prioridades

1. **[P1] Siguiente paso comercial ambiguo.** La landing habla de propuesta e implementación acompañada, pero dirige a Crear cuenta. Definir una ruta principal y explicar qué sucede después: registro autónomo, diagnóstico o propuesta. Evidencia: app/(marketing)/page.tsx:204,251,540,575,618. Comando: $impeccable clarify.
2. **[P2] Catálogo demasiado extenso.** Operación, finanzas, workflows, compras, personal e inteligencia reiteran la conexión entre módulos. Llevar el caso incidencia → acción → costo después del hero; agrupar las capacidades secundarias en tres resultados y acercar implementación/condiciones a conversión. Evidencia: app/(marketing)/page.tsx:268-526. Comando: $impeccable distill.
3. **[P2] Orden contradictoria.** OC-2026-0412 aparece por $1,160 en el hero y $24,860 en compras. Unificar el ejemplo o dar identificadores diferentes. Evidencia: components/marketing/panels.tsx:157,426. Comando: $impeccable harden.
4. **[P2] Selección de plan no transmitida en el enlace.** Empezar con Foundation/Growth/Executive conduce siempre a /sign-up sin indicar el plan. Conservar la selección o usar CTA neutral. Evidencia: app/(marketing)/page.tsx:217. Comando: $impeccable clarify.
5. **[P2] Jerga innecesaria.** Cockpit, unit economics, SLA y detalles de producción interrumpen la voz operativa. Encabezar con margen, comparación de sucursales y próximos pagos; explicar términos especializados cuando hagan falta. Evidencia: app/(marketing)/page.tsx:382,469; components/marketing/panels.tsx:218. Comando: $impeccable clarify.

## Carga cognitiva y recorrido emocional

El hero ofrece dos acciones manejables y hay tres planes. La navegación tiene seis opciones de sección más acceso/registro. Hay carga adicional por longitud, repetición y jerga; la jerarquía visual real no pudo comprobarse. El caso de incidencia aporta el pico de comprensión; el catálogo posterior reduce el ritmo y el cierre mantiene incertidumbre comercial. La secuencia de cinco pasos es información consecutiva, no cinco decisiones rivales.

## Personas

- Jordan, primera visita: no sabe qué ocurre al registrarse dado el lenguaje de propuesta/diagnóstico.
- Riley, comparación cuidadosa: detecta la orden con totales diferentes y los enlaces iguales de planes.
- Casey, móvil: recorrido largo por apilado previsto en código; menú de 40×40 px frente a guía de 44 px. Comportamiento real no probado.
- Mariana, dueña de 3–15 sucursales: necesita conocer esfuerzo de implementación y cómo obtiene propuesta. Las limitaciones POS/ERP están aclaradas; el plan Executive de hasta 50 sucursales recibe el mismo peso estructural.

## Observaciones menores

Menú móvil de 40×40 px en components/marketing/site-header.tsx:77. Mantener visibles las etiquetas de datos demostrativos. No se observaron en navegador fallos de contraste, foco, overflow ni codificación y no se afirman.

## Detector

0 hallazgos y 0 avisos; exit 0. Alcance: app/(marketing)/page.tsx, app/(marketing)/layout.tsx y components/marketing (faq, logo, panels, section, site-footer, site-header). Sin falsos positivos. Cero hallazgos estáticos no establece calidad visual ni corrección de interacciones. La revisión de diseño identifica problemas narrativos/comerciales que este detector no cubre.

## Preguntas para decidir la intervención

1. ¿La ruta comercial principal será registro autónomo, diagnóstico guiado o solicitud de propuesta?
2. ¿La siguiente intervención se limita a claridad comercial, incluye condensar el recorrido o aborda las cinco prioridades?
