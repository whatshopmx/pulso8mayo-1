# Pulso HORECA — Modelo de Consultoría + Software

> **Documento de modelo de negocio para lanzamiento**
>
> **Premisa:** Lanzar Pulso HORECA como un servicio de consultoría operativa profesionalizante, donde el software es la herramienta que habilita, estandariza y escala la consultoría. No vender "software" — vender "operación profesional para tu restaurante."
>
> **Mercado objetivo:** Grupos restauranteros mexicanos con 3 a 15 sucursales.
> **Fecha:** Julio 2026

---

## Índice

1. [Por qué Consultoría + Software (no solo SaaS)](#1-por-qué-consultoría--software)
2. [El Problema Real del Cliente](#2-el-problema-real-del-cliente)
3. [Modelo de Servicio: Los 3 Pilares](#3-modelo-de-servicio-los-3-pilares)
4. [Estructura de Pricing](#4-estructura-de-pricing)
5. [Go-to-Market](#5-go-to-market)
6. [Ciclo de Vida del Cliente](#6-ciclo-de-vida-del-cliente)
7. [El Flywheel: Cómo el Software Escala la Consultoría](#7-el-flywheel)
8. [Proyecciones Financieras](#8-proyecciones-financieras)
9. [Plan de Implementación (6 meses)](#9-plan-de-implementación-6-meses)
10. [Riesgos y Mitigaciones](#10-riesgos-y-mitigaciones)

---

## 1. Por Qué Consultoría + Software

### El dueño de restaurante NO compra software

Un dueño de grupo restaurantero con 5 sucursales no se despierta pensando *"necesito un sistema de gestión operativa."* Se despierta pensando:

- *"Mi gerente de la sucursal sur me está robando y no tengo cómo comprobarlo."*
- *"Tengo una auditoría de COFEPRIS en 3 semanas y cero evidencia."*
- *"La merma de esta semana fue del 22% y no sé por qué."*
- *"Mis cocineros no siguen las recetas y el sabor es inconsistente."*

**Ninguno de esos problemas se resuelve comprando una licencia de software.** Se resuelven con alguien que llegue, diagnostique, implemente procesos, entrene al personal y deje un sistema corriendo.

### La analogía del dentista

Vender Pulso como SaaS puro es como vender instrumental odontológico a personas con dolor de muela. El cliente no quiere el taladro — quiere que le quiten el dolor. **La consultoría es el dentista. Pulso es el instrumental que hace al dentista 10x más efectivo.**

### SaaS puro vs Consultoría + Software en HORECA MX

| Variable | SaaS Puro | Consultoría + Software |
|----------|-----------|----------------------|
| **Ticket promedio** | $2,000-$8,000 MXN/mes | $25,000-$80,000 MXN/mes |
| **Ciclo de venta** | 2-6 meses (intentando que entiendan el valor) | 2-4 semanas (el valor es obvio: "te profesionalizo") |
| **Adopción real** | 20-40% (abandonan si no hay quien empuje) | 80-95% (el consultor asegura adopción) |
| **Churn** | 5-10% mensual | < 2% mensual (cambiarse es cambiar procesos, no software) |
| **Competencia** | Comparan con Excel, Trello, Jira | Comparan con... nadie. No hay consultora HORECA con software propio. |
| **Escalabilidad** | Alta (producto) | Media (requiere consultores) — PERO el software la acelera |
| **Margen bruto** | 70-85% | 40-60% (consultoría) + 85% (licencia) = blend 50-70% |

### El insight de Porter aplicado aquí

El análisis de las 5 Fuerzas de Porter reveló que **el verdadero competidor de Pulso es Excel + WhatsApp.** La consultoría es lo que hace que "contratar a alguien que te resuelva" sea la alternativa a Excel, no "comprar otro software que vas a abandonar en 3 meses."

---

## 2. El Problema Real del Cliente

### Perfil del cliente: Grupo Restaurantero Típico (5 sucursales)

```
┌─────────────────────────────────────────────────────────┐
│                   PERFIL DEL CLIENTE                      │
├─────────────────────────────────────────────────────────┤
│ Dueño:        Hombre/Mujer, 40-55 años, emprendedor       │
│               Abrió su primer restaurante hace 10-15 años │
│               Creció por inercia, no por sistema           │
│                                                           │
│ Carga mental: Ya no puede estar en todas las sucursales   │
│               Sabe que hay fugas pero no las mide          │
│               Le da miedo una multa de COFEPRIS            │
│               Quiere crecer pero no sabe cómo controlar    │
│                                                           │
│ Equipo:       1 director de operaciones (sobrecargado)     │
│               1 contador externo                           │
│               5 gerentes de sucursal (confianza variable)  │
│               80-150 empleados de piso                     │
│                                                           │
│ Tecnología:   Excel para inventarios                       │
│               Grupos de WhatsApp para coordinación         │
│               Punto de venta (POS) por sucursal            │
│               "Mi sobrino me hace la página web"           │
│                                                           │
│ Dolor #1:     "No sé qué está pasando cuando no estoy."    │
│ Dolor #2:     "Mis números no cuadran entre sucursales."   │
│ Dolor #3:     "Si me auditan, no tengo nada documentado."  │
└─────────────────────────────────────────────────────────┘
```

### Lo que realmente necesitan (y no saben pedir)

| Necesidad Real | Cómo se manifiesta | Cómo lo resuelve Consultoría + Pulso |
|----------------|-------------------|--------------------------------------|
| **Estandarización** | "Cada sucursal hace las cosas diferente" | Manual operativo digital + workflows estandarizados en Pulso |
| **Trazabilidad** | "No sé quién hizo qué ni cuándo" | WhatsApp → evidencia con foto/timestamp → historial por sucursal |
| **Control de merma** | "El inventario no cuadra" | Inventario digital + recetas estandarizadas + theoretical vs actual |
| **Blindaje regulatorio** | "Me van a multar" | NOM-251 checklists automáticos + evidencia almacenada + reportes pre-auditoría |
| **Delegación real** | "No puedo soltar sin que se caiga todo" | Dashboard con KPIs por sucursal → dueño monitorea sin microgestionar |
| **Paz mental** | "Vivo con estrés constante" | Todo documentado, medido, notificado. El sistema avisa antes de que truene. |

---

## 3. Modelo de Servicio: Los 3 Pilares

```
┌─────────────────────────────────────────────────────────────────┐
│             PULSO HORECA — SERVICIO DE CONSULTORÍA               │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │    PILAR 1       │  │    PILAR 2       │  │    PILAR 3       │  │
│  │  DIAGNÓSTICO     │  │  IMPLEMENTACIÓN  │  │  ACOMPAÑAMIENTO  │  │
│  │  + ESTRATEGIA    │  │  OPERATIVA       │  │  CONTINUO        │  │
│  │                  │  │                  │  │                  │  │
│  │ Auditoría de     │  │ Estandarización  │  │ Dashboard        │  │
│  │ operación actual │  │ de procesos      │  │ mensual con KPIs │  │
│  │                  │  │                  │  │                  │  │
│  │ Mapeo de fugas   │  │ Workflows        │  │ Soporte vía      │  │
│  │ y riesgos        │  │ personalizados   │  │ WhatsApp + email │  │
│  │                  │  │                  │  │                  │  │
│  │ Plan de acción   │  │ Capacitación del │  │ Reportes de      │  │
│  │ trimestral       │  │ equipo completo  │  │ compliance       │  │
│  │                  │  │                  │  │                  │  │
│  │ 2-3 semanas      │  │ 6-8 semanas      │  │ Mensual          │  │
│  │                  │  │                  │  │ (12 meses mín.)  │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│                                                                  │
│              TODO CORRE SOBRE PULSO (EL SOFTWARE)                │
└─────────────────────────────────────────────────────────────────┘
```

### Pilar 1: Diagnóstico + Estrategia Operativa (Semanas 1-3)

**Objetivo:** Entender la operación actual, encontrar las fugas, priorizar intervenciones.

**Entregables:**
- Auditoría presencial de todas las sucursales (1-2 días por sucursal)
- Matriz de madurez operativa (evaluación de 12 dimensiones)
- Mapa de fugas: merma, horas extra injustificadas, incumplimiento NOM, rotación
- Plan de acción trimestral priorizado (qué corregir, en qué orden, con qué urgencia)
- Propuesta de valor cuantificada: *"Estimamos que estas intervenciones te ahorrarán $X/mes"*

**La ventaja de Pulso aquí:** El diagnóstico no se hace en Excel. El consultor usa Pulso desde el día 1 para documentar hallazgos con fotos, scoring, y ya va dejando sembrada la estructura de sucursales, empleados y áreas. Cuando empieza la implementación, el tenant ya está poblado.

### Pilar 2: Implementación Operativa (Semanas 4-12)

**Objetivo:** Estandarizar procesos, digitalizar workflows, capacitar al equipo.

**Entregables:**

| Semana | Acción | Rol del Consultor | Rol de Pulso |
|--------|--------|-------------------|--------------|
| 4-5 | **Manual operativo digital**: documentar procesos core (apertura, cierre, recepción de mercancía, limpieza NOM-251, corte de caja) | Facilita sesiones con líderes de sucursal | Los procesos se convierten en workflows ejecutables |
| 6-7 | **Workflows en Pulso**: convertir cada proceso en un workflow con pasos, responsables, evidencia requerida, tiempos | Configura templates, adapta a la realidad del restaurante | Ejecución automatizada, asignación, recordatorios |
| 8 | **Capacitación gerentes**: enseñar a usar el dashboard web, interpretar KPIs, gestionar incidentes | Talleres presenciales + manuales | Dashboard, alertas, reportes |
| 9 | **Capacitación empleados de piso**: enseñar a recibir y ejecutar tareas vía WhatsApp | Demos en vivo en el restaurante | WhatsApp como interfaz principal (no necesitan aprender nada nuevo) |
| 10-11 | **Inventario inicial + recetas**: conteo físico, carga de productos, estandarización de recetas | Facilita el conteo + define recetas con chef | Módulo de inventario y recetas de Pulso |
| 12 | **Go-live + primera revisión**: el restaurante opera con Pulso. Consultor monitorea de cerca. | Soporte intensivo primera semana | Pulso corriendo en producción |

### Pilar 3: Acompañamiento Continuo (Mensual, mínimo 12 meses)

**Objetivo:** Asegurar que los procesos se sostienen, evolucionar la operación, y blindar compliance.

**Cada mes el cliente recibe:**

| Entregable Mensual | Descripción |
|-------------------|-------------|
| **Reporte ejecutivo KPI** | 1 paginador: compliance rate, merma %, horas extra, incidentes, ejecución de workflows. Comparativa vs mes anterior y vs meta. |
| **Sesión de revisión** | 1 hora (remota) con dueño + director de operaciones. Revisar números, identificar desviaciones, acordar acciones. |
| **Auditoría sorpresa** | 1 sucursal/mes (rotativa). El consultor aparece sin avisar, audita con checklist Pulso, documenta con fotos, genera reporte. |
| **Actualización de workflows** | Ajustar procesos según cambios en menú, personal, regulaciones. |
| **Reporte pre-auditoría NOM** | Trimestral. Documentación lista para presentar a COFEPRIS si auditara mañana. |

---

## 4. Estructura de Pricing

### No es SaaS con setup fee. Es consultoría con componente tecnológico.

```
┌─────────────────────────────────────────────────────────────────┐
│                     ESTRUCTURA DE PRICING                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌───────────────────────────────────────────────────────┐     │
│   │            IMPLEMENTACIÓN (PAGO ÚNICO)                 │     │
│   │                                                        │     │
│   │  Diagnóstico + Implementación 12 semanas                │     │
│   │                                                        │     │
│   │  $60,000 - $120,000 MXN                                 │     │
│   │  (varía por # de sucursales y complejidad)              │     │
│   │                                                        │     │
│   │  Incluye:                                              │     │
│   │  • Auditoría de todas las sucursales                   │     │
│   │  • Manual operativo digital                            │     │
│   │  • Workflows personalizados                            │     │
│   │  • Capacitación de todo el equipo                      │     │
│   │  • Carga inicial de inventario                         │     │
│   │  • Licencia Pulso incluida durante implementación      │     │
│   └───────────────────────────────────────────────────────┘     │
│                                                                  │
│   ┌───────────────────────────────────────────────────────┐     │
│   │          ACOMPAÑAMIENTO (MENSUAL RECURRENTE)            │     │
│   │                                                        │     │
│   │  $8,000 - $15,000 MXN / mes                            │     │
│   │  (varía por # de sucursales)                            │     │
│   │                                                        │     │
│   │  Incluye:                                              │     │
│   │  • Reporte ejecutivo mensual                           │     │
│   │  • Sesión de revisión (1 hr)                           │     │
│   │  • Auditoría sorpresa (1 sucursal/mes)                 │     │
│   │  • Ajuste de workflows                                 │     │
│   │  • Licencia Pulso (todas las sucursales)               │     │
│   │  • Soporte técnico ilimitado                            │     │
│   │  • Actualizaciones de software                         │     │
│   └───────────────────────────────────────────────────────┘     │
│                                                                  │
│   PREGUNTA CLAVE: ¿Cuánto pierde HOY en merma, ineficiencia      │
│   y riesgo regulatorio? El servicio se paga solo si ahorra       │
│   más de lo que cuesta.                                          │
└─────────────────────────────────────────────────────────────────┘
```

### Comparativa de pricing según tamaño

| Tipo de Cliente | Sucursales | Implementación | Mensualidad | Inversión Anual Total |
|-----------------|------------|----------------|-------------|----------------------|
| **Pequeño** | 3 | $60,000 | $8,000 | $156,000 |
| **Mediano** | 5-7 | $85,000 | $12,000 | $229,000 |
| **Grande** | 10-15 | $120,000 | $15,000 | $300,000 |

### ¿Por qué este precio tiene sentido para el cliente?

| Concepto | Costo Anual Estimado (sin Pulso) |
|----------|----------------------------------|
| Merma de inventario (15-20% en restaurante típico) | $300,000 - $2,000,000+ |
| Multa COFEPRIS NOM-251 (una sola) | $50,000 - $500,000 |
| Rotación de personal (cuesta 30-50% del salario anual reemplazar) | $50,000 - $300,000+ |
| Tiempo del dueño resolviendo crisis operativas | Incalculable |

**Pulso se paga solo con capturar una fracción de esas pérdidas.**

---

## 5. Go-to-Market

### Segmentación de Canal

```
┌─────────────────────────────────────────────────────────────────┐
│                  ESTRATEGIA DE ENTRADA AL MERCADO                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  MES 1-2: CLIENTES CERO (GRATIS O COSTO)                         │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 2-3 grupos restauranteros conocidos                         │    │
│  │                                                             │    │
│  │ Objetivo: NO ingresos. Objetivo:                            │
│  │ • Case studies reales con números                            │
│  │ • Afinar metodología de consultoría                          │
│  │ • Testimonios en video                                       │
│  │ • Datos reales de before/after (merma, compliance, etc.)    │
│  │                                                             │    │
│  │ Condición: Solo pagan si ven resultados medibles.           │    │
│  │ Se firma acuerdo de testimonio + case study.                │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  MES 3-6: EARLY ADOPTERS (PRECIO DE LANZAMIENTO)                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Conseguir 5-8 clientes pagando                             │    │
│  │                                                             │    │
│  │ Canales:                                                    │    │
│  │ • Referencias de clientes cero                              │    │
│  │ • Cámara de la Industria Restaurantera (CANIRAC)           │    │
│  │ • Asociaciones de hoteles y restaurantes locales           │    │
│  │ • Eventos de la industria (Expo Restaurantes, ABASTUR)     │    │
│  │ • LinkedIn + cold outreach a dueños de grupos              │    │
│  │                                                             │    │
│  │ Oferta de lanzamiento: 20% descuento primer año.           │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  MES 7-12: CRECIMIENTO                                           │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 10-15 clientes activos                                     │    │
│  │                                                             │    │
│  │ • Contenido: blog/guías de compliance HORECA               │    │
│  │ • Webinars: "Cómo prepararte para una auditoría COFEPRIS"  │    │
│  │ • Partnerships: con despachos contables HORECA,            │    │
│  │   proveedores de insumos, consultores de RH                │    │
│  │ • Referidos sistemáticos: "Trae a otro restaurantero       │    │
│  │   y recibe un mes gratis"                                  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### El discurso de venta (lo que NO es)

| ❌ NO decir | ✅ SÍ decir |
|------------|------------|
| "Tenemos un software de gestión operativa para restaurantes" | "Profesionalizamos la operación de grupos restauranteros. Te damos control total de tus sucursales sin que tengas que estar presente." |
| "Módulos de compliance, workflows, inventario..." | "¿Cuánto crees que pierdes al mes en merma? ¿Estás listo para una auditoría de COFEPRIS mañana?" |
| "Cuesta $X al mes" | "Un grupo como el tuyo suele ahorrar $Y al mes en merma y eficiencia. Nuestro servicio cuesta menos de lo que recuperas." |
| "Agenda una demo" | "Voy a tu restaurante, te hago un diagnóstico gratuito de 2 horas y te digo exactamente cuánto estás perdiendo. Sin compromiso." |

---

## 6. Ciclo de Vida del Cliente

```
┌─────────────────────────────────────────────────────────────────────┐
│                   CICLO DE VIDA DEL CLIENTE                          │
│                                                                      │
│                                                                      │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐       │
│  │ ATRACCIÓN│───►│ CONVERSIÓN│───►│ ONBOARDING│───►│ EXPANSIÓN│       │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘       │
│                                                                      │
│  • Contenido     • Diagnóstico    • Pilar 1      • Resultados mes 1  │
│    en LinkedIn     gratuito         Diagnóstico   • Sesión KPI       │
│  • Referencias   • Mostrar en     • Pilar 2      • "¿Viste lo que    │
│  • Eventos         persona las      Implem.        ahorraste?"      │
│    industria       fugas         • Pilar 3      • Referidos          │
│  • CANIRAC       • Propuesta       Acompaña-    • Upsell a más       │
│                    cuantificada     miento         módulos o          │
│                  • ROI claro                      sucursales         │
│                                                                      │
│  ─────────────────────────────────────────────────────────────────  │
│  Ciclo total: 14 días desde primer contacto hasta firma de contrato  │
│  (vs 2-6 meses en SaaS puro)                                        │
│                                                                      │
│  LTV promedio: 24-36 meses de mensualidad = $192,000 - $540,000      │
│  CAC: $15,000 - $30,000 (eventos, contenido, referido commission)    │
│  LTV/CAC: 8:1 a 18:1                                                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. El Flywheel

### Cómo la Consultoría + Software se Refuerzan Mutuamente

```
                      ┌──────────────────────┐
                      │                      │
                      │    CLIENTE NUEVO     │
                      │                      │
                      └──────────┬───────────┘
                                 │
                                 ▼
              ┌──────────────────────────────────────┐
              │                                      │
              │   El CONSULTOR diagnostica,          │
              │   implementa procesos,               │
              │   capacita al equipo                 │
              │                                      │
              │   ↓                                  │
              │                                      │
              │   Pulso captura TODOS los datos      │
              │   reales de la operación             │
              │                                      │
              └──────────────────┬───────────────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          │                      │                      │
          ▼                      ▼                      ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│                 │  │                 │  │                 │
│  MEJOR SOFTWARE │  │  MÁS DATA PARA  │  │  CASE STUDIES   │
│                 │  │  LA CONSULTORÍA │  │  REALES         │
│  Los bugs y     │  │                 │  │                 │
│  fricciones se  │  │ Benchmarks,     │  │ "Grupo X redujo │
│  descubren en   │  │ patrones de     │  │ merma 40% en    │
│  campo real →   │  │ fraude, best    │  │ 3 meses" con    │
│  → se arreglan  │  │ practices       │  │ datos reales    │
│  más rápido     │  │ detectadas en   │  │ de Pulso        │
│                 │  │ cliente A →     │  │                 │
│                 │  │ aplicadas en    │  │                 │
│                 │  │ cliente B       │  │                 │
│                 │  │                 │  │                 │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              │
                              ▼
              ┌──────────────────────────────────────┐
              │                                      │
              │  MÁS CLIENTES (referidos,             │
              │  contenido, reputación)               │
              │                                      │
              │  ↑                                   │
              │                                      │
              │  Ciclo se retroalimenta.              │
              │  Cada nuevo cliente hace mejor        │
              │  el software Y mejor la consultoría   │
              │                                      │
              └──────────────────────────────────────┘
```

### Por qué este flywheel NO funciona en SaaS puro

- En SaaS puro, si un cliente abandona, no aprendes por qué. Solo ves el churn en un dashboard.
- Con consultoría, el consultor está físicamente en el restaurante viendo qué funciona y qué no.
- El consultor es el sensor humano que el SaaS puro nunca tendrá.
- Ese conocimiento se codifica en el software y en la metodología, haciendo cada implementación más rápida que la anterior.

---

## 8. Proyecciones Financieras

### Escenario conservador — Año 1

| Trimestre | Clientes | Ingreso Implementación | Ingreso MRR | Ingreso Total | Costos | EBITDA |
|-----------|----------|------------------------|-------------|---------------|--------|--------|
| Q1 | 3 (clientes cero) | $0 | $0 | $0 | $180,000 (salario consultor 1) | -$180,000 |
| Q2 | 8 (5 nuevos) | $340,000 | $96,000 | $436,000 | $250,000 (2 consultores + infra) | $186,000 |
| Q3 | 14 (6 nuevos) | $420,000 | $168,000 | $588,000 | $320,000 (3 consultores) | $268,000 |
| Q4 | 20 (6 nuevos) | $420,000 | $240,000 | $660,000 | $380,000 (3 consultores + admin) | $280,000 |
| **Año 1** | **20** | **$1,180,000** | **$504,000** | **$1,684,000** | **$1,130,000** | **$554,000** |

### Supuestos

- Cada consultor maneja 7-8 clientes simultáneos
- Tiempo de implementación: 12 semanas por cliente
- Consultor senior: $35,000-$50,000 MXN/mes (sueldo bruto)
- Infraestructura software: $15,000 MXN/mes (Neon, Wasender, Upstash, etc.)
- Clientes cero: 3 sin costo, generan case studies

### Punto de equilibrio

Con 5 clientes pagando mensualidad + 2 implementaciones activas = flujo de caja positivo mensual (~mes 5).

---

## 9. Plan de Implementación (6 Meses)

### MES 1: Preparación

| # | Acción | Quién |
|---|--------|-------|
| 1.1 | Definir metodología de diagnóstico (checklist, scoring, dimensiones) | Founder + Consultor 1 |
| 1.2 | Crear materiales de venta: one-pager, pitch deck, propuesta tipo | Founder |
| 1.3 | Preparar Pulso para el modelo: tenant onboarding wizard, templates base | Tech |
| 1.4 | Identificar y contactar 3 clientes cero | Founder |
| 1.5 | Definir marca de la consultoría: ¿"Pulso Consultoría"? ¿Nombre separado? | Founder |
| 1.6 | Perfil de LinkedIn, página web simple (landing de consultoría) | Founder |

### MES 2-3: Clientes Cero + Iteración

| # | Acción | Quién |
|---|--------|-------|
| 2.1 | Auditoría y diagnóstico de 3 clientes cero | Consultor 1 |
| 2.2 | Implementación de Pulso en 3 clientes cero | Consultor 1 + Tech |
| 2.3 | Documentar TODO: qué funcionó, qué no, cuánto tiempo tomó cada paso | Consultor 1 |
| 2.4 | Iterar metodología con aprendizajes reales | Founder + Consultor 1 |
| 2.5 | Grabar testimonios, recolectar métricas before/after | Consultor 1 |
| 2.6 | Crear 3 case studies con datos reales | Founder |

### MES 4-6: Primeros Clientes Pagando

| # | Acción | Quién |
|---|--------|-------|
| 3.1 | Lanzar perfil de LinkedIn con contenido: case studies, guías de compliance | Founder |
| 3.2 | Asistir a 2 eventos de industria (CANIRAC, Expo Restaurantes) | Founder + Consultor |
| 3.3 | Contactar 50 grupos restauranteros (email + LinkedIn + teléfono) | Founder |
| 3.4 | Ofrecer diagnóstico gratuito de 2 horas como lead magnet | Consultor |
| 3.5 | Cerrar 5 clientes pagando | Founder |
| 3.6 | Contratar Consultor 2 cuando se alcancen 8 clientes | Founder |
| 3.7 | Iniciar partnerships con 2-3 despachos contables HORECA | Founder |

---

## 10. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| **No encontrar consultores HORECA** | Media | Alto | Reclutar gerentes de restaurante con talento analítico, no consultores tradicionales. Entrenarlos en Pulso, no en consultoría teórica. |
| **Clientes cero no logran resultados** | Baja | Crítico | Elegir clientes con dueños comprometidos. Si después de 3 meses no hay mejora medible, pivotear metodología ANTES de cobrar. |
| **Venta compleja: dueño no delega decisiones** | Alta | Medio | El diagnóstico gratuito es la herramienta de venta. El dueño no compra hasta que ve con sus ojos las fugas. No se vende por teléfono. |
| **Dependencia del founder como consultor principal** | Alta | Alto | Desde mes 1, documentar metodología como si fuera franquiciable. Contratar consultor 1 en mes 2. Founder debe soltar implementación antes del cliente 10. |
| **WasenderAPI limita o encarece WhatsApp** | Baja | Alto | Abstraer capa WhatsApp (ya planeado en strategy frameworks doc). Tener Meta Cloud API como plan B. |
| **Competencia copia el modelo** | Media | Medio | La ventaja no es la idea — es la combinación de: software propio + metodología probada + datos reales de 50+ sucursales. Eso toma 18-24 meses replicar. Para entonces Pulso ya debe tener 50+ clientes. |
| **Clientes no renuevan después del año** | Media | Alto | El lock-in no es contractual — es operativo. Si un restaurante ya corre con Pulso, cambiarse implica re-entrenar 100 empleados y rehacer todos los procesos. Además: los resultados de compliance + reducción de merma hablan solos. |
| **El consultor se vuelve cuello de botella** | Media | Medio | Pulso está diseñado para que el software automatice lo repetitivo. El consultor solo interviene en: diagnóstico, capacitación, revisión mensual. El día a día corre solo. |

---

## Veredicto

### ¿Es viable? **SÍ, y probablemente es la única forma de que funcione en este mercado.**

El dueño de un grupo restaurantero mexicano de 3-15 sucursales:
1. **No compra software** — compra soluciones a problemas que le duelen
2. **No tiene tiempo de implementar** — necesita alguien que lo haga por él
3. **No sabe qué es "buena operación"** — necesita un estándar externo que le diga qué corregir
4. **Sí paga por resultados** — especialmente si el ROI es visible en semanas, no meses

La consultoría + Pulso ataca los 4 puntos simultáneamente. El software sin consultoría no se vende. La consultoría sin software no escala.

### La decisión real no es "¿consultoría o SaaS?" sino "¿consultoría primero, SaaS después?"

```
Fase 1 (Año 1-2): Consultoría + Software
├── Validar modelo con clientes reales
├── Construir reputación y case studies
├── Perfeccionar metodología
└── El software mejora con datos reales de campo

Fase 2 (Año 3-4): Consultoría + SaaS híbrido
├── Clientes pueden elegir "solo software" (más barato, self-service)
├── O "software + consultoría" (premium, full service)
├── El software ya es lo suficientemente maduro para self-onboarding
└── La consultoría atiende solo clientes enterprise (10+ sucursales)

Fase 3 (Año 5+): Plataforma + Partners
├── Pulso es la plataforma estándar de operación HORECA en México
├── Consultores certificados Pulso (terceros) implementan
├── Pulso cobra licencia + revenue share con consultores partners
└── Marketplace de templates, integraciones, add-ons
```

---

*Documento de estrategia de negocio para Pulso HORECA.*
*Complementa a `docs/strategy-frameworks-analysis.md`.*
