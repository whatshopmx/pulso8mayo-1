# Top 5 Strategy Frameworks — Aplicación a Pulso HORECA

> **Documento de análisis estratégico y plan de implementación**
>
> **Basado en:** "Top 5 Strategy Frameworks Every Business Strategist Must Know" (2021)
> **Fecha:** Julio 2026
> **Objetivo:** Traducir frameworks académicos de estrategia empresarial en decisiones accionables para Pulso HORECA

---

## Índice

1. [GE-McKinsey Nine-Box Matrix → Portfolio de Módulos](#1-ge-mckinsey-nine-box-matrix)
2. [BCG Growth-Share Matrix → Ciclo de Vida de Features](#2-bcg-growth-share-matrix)
3. [Porter's Five Forces → Análisis Competitivo](#3-porters-five-forces)
4. [Core Competencies → Ventajas Estructurales](#4-core-competencies)
5. [Balanced Scorecard → KPIs Operacionales](#5-balanced-scorecard)
6. [Plan de Implementación Integrado](#6-plan-de-implementacion-integrado)

---

## 1. GE-McKinsey Nine-Box Matrix

### Aplicación: Priorización de Inversión en Módulos

**Contexto Pulso:** Al igual que GE en los 70s, Pulso gestiona un portafolio de ~15 módulos de producto con recursos limitados (equipo de desarrollo, tiempo, presupuesto). No se puede invertir en todo simultáneamente. La matriz 9-box ayuda a decidir dónde poner capital de desarrollo.

### Ejes adaptados a Pulso

| Eje | Original | Adaptación Pulso |
|-----|----------|------------------|
| **Eje Y** | Industry Attractiveness | **Demanda de Mercado HORECA MX**: ¿Qué tanto necesitan las cadenas esta funcionalidad? ¿Es obligatoria por ley? ¿Es un pain point diario? |
| **Eje X** | Competitive Strength | **Fortaleza de Pulso en el módulo**: ¿Qué tan madura está la implementación? ¿Qué ventaja tiene vs competidores? ¿Qué tan diferenciada está? |

### Evaluación de cada módulo

#### Criterios de "Demanda de Mercado" (1-10)
- Obligatoriedad legal (NOMs, IMSS, SAT)
- Frecuencia de uso diario
- Impacto en costo/riesgo del negocio
- Demanda explícita de clientes/prospectos
- Tendencia del sector (creciente, estable, decreciente)

#### Criterios de "Fortaleza Pulso" (1-10)
- Madurez del código implementado
- Diferenciación vs competidores
- Integración con otros módulos
- Satisfacción de usuarios actuales
- Barreras de entrada para competidores

### Matriz de Módulos Pulso

```
                  FORTALEZA PULSO
                  Baja(1-3)     Media(4-6)    Alta(7-10)
              ┌──────────────┬──────────────┬──────────────┐
  Alta(7-10)  │  INVESTIR     │  INVERTIR     │  MANTENER     │
  DEMANDA     │  selectivo     │  aggressively │  y expandir   │
              │               │               │               │
              │ • Analytics   │ • AI          │ • WhatsApp    │
              │   avanzados   │   Verification│   Workflows   │
              │ • Forecast    │ • NOM-035     │ • NOM-251     │
              │ • Incidentes  │   específico  │ • Inventario  │
              │   predictivos │               │ • Laboral     │
              ├──────────────┼──────────────┼──────────────┤
  Media(4-6)  │  EVALUAR      │  INVERTIR     │  MANTENER     │
  DEMANDA     │  caso a caso  │  selective    │  eficiencia   │
              │               │               │               │
              │ • Comunicaciones│ • Recetas/  │ • Reportes    │
              │ • Equipamiento│   Costing     │ • Gestión     │
              │ • Performance │ • Compras/PO  │   Empleados   │
              │               │               │ • Auditoría   │
              ├──────────────┼──────────────┼──────────────┤
  Baja(1-3)   │  DIVESTIR     │  COSECHAR     │  MANTENER     │
  DEMANDA     │  o pausar     │  sin invertir │  mínima       │
              │               │               │   inversión   │
              │ • (ninguno    │ • (ninguno    │ • Perfil      │
              │   actualmente)│   actualmente)│ • Builder     │
              │               │               │   (interno)   │
              └──────────────┴──────────────┴──────────────┘
```

### Decisiones de Portfolio

| Cuadrante | Módulos | Decisión | Acción |
|-----------|---------|----------|--------|
| **Alta Demanda + Alta Fortaleza** | WhatsApp Workflows, NOM-251, Inventario, Laboral | **Mantener y Expandir** | Inversión incremental. Cross-sell entre módulos. Referencias y case studies. |
| **Alta Demanda + Media Fortaleza** | AI Verification, NOM-035 | **Invertir Agresivamente** | Acelerar desarrollo. Contratar o asignar más recursos. Son los futuros Stars. |
| **Alta Demanda + Baja Fortaleza** | Analytics avanzados, Forecast, Incidentes Predictivos | **Invertir Selectivamente** | Probar MVP con 2-3 clientes. No comprometer recursos masivos hasta validar. |
| **Media Demanda + Alta Fortaleza** | Reportes, Gestión Empleados, Auditoría | **Mantener Eficiencia** | Optimizar código existente. Automatizar. Reducir costo de mantenimiento. |
| **Media Demanda + Media Fortaleza** | Recetas/Costing, Compras/PO | **Invertir Selectivamente** | Desarrollar para clientes que lo pidan explícitamente. Paquete premium. |
| **Media Demanda + Baja Fortaleza** | Comunicaciones, Equipamiento, Performance | **Evaluar Caso a Caso** | Decidir por cliente. No roadmap prioritario. |
| **Baja Demanda + Alta Fortaleza** | Perfil, Builder (interno) | **Mantener Mínimo** | Solo bug fixes. Cero features nuevas. |

---

## 2. BCG Growth-Share Matrix

### Aplicación: Ciclo de Vida de Features y Estrategia de Producto

**Contexto Pulso:** La matriz BCG clasifica productos en 4 cuadrantes según su participación de mercado y crecimiento del mercado. Para Pulso, esto informa dónde enfocar esfuerzo de producto, ventas y pricing.

### Clasificación de Módulos Pulso

```
              CRECIMIENTO DEL MERCADO
              Bajo                    Alto
          ┌───────────────────┬───────────────────┐
  Alta    │   ⭐ STARS         │   ❓ QUESTION MARKS │
  SHARE   │                   │                     │
          │ • WhatsApp        │ • AI Verification   │
          │   Workflows       │ • Analytics         │
          │ • NOM-251         │   Predictivos       │
          │   Compliance      │ • Forecast de       │
          │                   │   Demanda           │
          ├───────────────────┼───────────────────┤
  Baja    │   💰 CASH COWS     │   🐕 DOGS           │
  SHARE   │                   │                     │
          │ • Gestión Laboral │ • Builder (interno) │
          │ • Inventario Base │ • Comunicaciones    │
          │ • Reportes        │   Internas           │
          │ • Gestión         │                     │
          │   Empleados       │                     │
          └───────────────────┴───────────────────┘
```

### Estrategia por Cuadrante

#### ⭐ STARS — WhatsApp Workflows, NOM-251
**Invertir para mantener liderazgo.**
- El mercado de WhatsApp-first operations crece rápido en LatAm. Pulso tiene first-mover advantage.
- NOM-251 es obligatorio y Pulso tiene la implementación más madura del mercado.
- **Acción:** Marketing agresivo, case studies, thought leadership en compliance HORECA.

#### 💰 CASH COWS — Laboral, Inventario, Empleados, Reportes
**Ordeñar. Mantener con mínima inversión.**
- Módulos maduros, mercado estable, Pulso es fuerte.
- Generan ingresos recurrentes sin requerir grandes inversiones.
- **Acción:** Optimizar, automatizar soporte, reducir bugs. El cash flow de estos módulos financia los Stars y Question Marks.

#### ❓ QUESTION MARKS — AI Verification, Analytics Predictivos, Forecast
**Invertir o abandonar rápido.**
- Alto potencial pero participación aún baja.
- AI Verification: si despega, se vuelve un Star y luego Cash Cow. Si no, cortar rápido.
- **Acción:** MVP con early adopters. Métricas claras de éxito en 6 meses. Kill switch si no traccionan.

#### 🐕 DOGS — Builder, Comunicaciones
**Mantener con costo mínimo o discontinuar.**
- Builder es herramienta interna que no genera valor directo al cliente.
- Comunicaciones es un feature que plataformas como Slack/WhatsApp ya cubren.
- **Acción:** Congelar desarrollo. Evaluar discontinuación.

### Lección del Case Study Microsoft Zune
> Microsoft discontinuó Zune en 2 años al ver que el mercado de mp3 players iba a desaparecer frente al smartphone.

**Aplicación a Pulso:** Si un módulo no está ganando tracción en 12 meses y el mercado no crece, cortarlo sin piedad. El costo de oportunidad de mantener un Dog es quitarle recursos a un Star. *Saber retirarse es más importante que celebrar éxitos pasados.*

---

## 3. Porter's Five Forces

### Aplicación: Análisis del Mercado HORECA Tech en México

> *"A veces es mejor tener un producto mediocre en un mercado perfecto que un producto perfecto en el mercado equivocado."* — Lección Porter

### Las 5 Fuerzas en el contexto de Pulso

#### 1. Rivalidad entre Competidores — ⚠️ MEDIA-ALTA

| Competidor | Tipo | Fortaleza | Debilidad |
|------------|------|-----------|-----------|
| **Excel + WhatsApp** | Sustituto manual | Gratis, conocido | Sin trazabilidad, sin compliance |
| **Jira/Trello/Asana** | Genérico | Feature-rich, barato | No HORECA, no NOMs, no WhatsApp nativo |
| **SoftRestaurant** | HORECA vertical | Marca conocida en MX | On-premise, legacy, no mobile-first |
| **SAP/Oracle** | Enterprise | Completo | Caro, complejo, no para cadenas 3-15 sucursales |
| **Startups locales** | HORECA tech | Ágiles | Poco capital, sin compliance expertise |

**Implicación para Pulso:** El verdadero competidor es el Excel + WhatsApp, no otras plataformas. La venta debe enfocarse en el costo del *desorden* operativo, no en features vs features.

#### 2. Poder de Negociación de Compradores — ⚠️ MEDIA

- **Cadenas 3-15 sucursales:** Presupuesto limitado. Sensibles a precio. Comparan con "gratis" (Excel).
- **Switching cost bajo para entrar, alto para salir:** Una vez que cargan empleados, inventario y workflows, migrar duele.
- **Decisión del dueño:** El comprador es el dueño/ADMIN, no un procurement department.

**Implicación:** Ofrecer onboarding gratuito/barato, free trial de 14 días, y hacer que cargar datos iniciales sea trivial. El lock-in viene después, cuando ya dependen de Pulso para compliance y operación diaria.

#### 3. Poder de Negociación de Proveedores — 🔴 ALTO (Riesgo)

| Proveedor | Dependencia | Riesgo |
|-----------|-------------|--------|
| **WasenderAPI** (WhatsApp) | Crítica — toda la ejecución de campo | Vendor lock-in. Si falla o sube precios, impacta core feature |
| **Neon** (Postgres) | Crítica — todos los datos | Migrable a otro Postgres. Riesgo bajo. |
| **Upstash** (QStash + Redis) | Alta — cron jobs y rate limiting | Inngest está reemplazando QStash parcialmente |
| **Cloudflare R2** | Media — storage de evidencia | Migrable a S3. Riesgo bajo. |
| **Resend** | Media — email | Fácilmente reemplazable. Riesgo bajo. |
| **OpenAI/Anthropic** (AI Verify) | Creciente — verificación inteligente | Múltiples providers. Riesgo medio. |

**Implicación:** WasenderAPI es la dependencia más riesgosa. Urgente: abstraer la capa de WhatsApp para que cambiar de provider sea una línea de código, no una reescritura. Evaluar Meta Cloud API directa como alternativa.

#### 4. Amenaza de Nuevos Entrantes — 🟡 BAJA-MEDIA

**Barreras de entrada naturales que protegen a Pulso:**
- **Know-how regulatorio:** NOM-251, NOM-035, IMSS, SAT no son triviales. Requieren expertise de meses.
- **Integración multi-módulo:** No es una app de checklists. Es compliance + inventario + laboral + WhatsApp en un mismo data model.
- **Efecto de red:** Mientras más sucursales usan Pulso, más valioso es (datos agregados, benchmarks).
- **Trust de compliance:** Un restaurante no confía sus NOMs a un startup de 3 meses.

**Amenaza real:** Un jugador grande (ej. Clip, OXXO, Rappi) podría entrar al vertical con capital masivo. Pulso debe moverse rápido a capturar mercado antes de que eso pase.

#### 5. Amenaza de Sustitutos — 🔴 ALTA

| Sustituto | Nivel de Amenaza | Por qué |
|-----------|-----------------|--------|
| Excel + Papel | Máxima | Es lo que usan hoy. "Funciona." |
| Solo WhatsApp (grupos) | Alta | Comunicación sin estructura |
| Software de nicho (1 módulo) | Media | Más barato, pero silos de datos |

**Estrategia anti-sustitutos:** No competir en precio. Competir en *costo de no tener Pulso*: multas de NOM ($50k-$500k MXN), merma de inventario (15-30% en restaurantes), rotación de personal, caos operativo.

### Veredicto Porter

El mercado HORECA tech mexicano es **atractivo pero disputado**. La ventaja de Pulso es **diferenciación, no precio**. La estrategia correcta: profundizar el moat regulatorio (más NOMs, más estados, más integraciones gubernamentales) y la capa WhatsApp-first que nadie más tiene bien resuelta.

---

## 4. Core Competencies

### Aplicación: Identificar y Potenciar Ventajas Estructurales

> *"Invertir en tus fortalezas siempre es mejor que corregir debilidades."* — Prahalad & Hamel

### El Test de Bain & Company: ¿Es difícil de copiar o adquirir?

Una core competency debe cumplir 3 condiciones:
1. **Difícil de copiar** para competidores
2. **Difícil de adquirir** (no se compra contratando a alguien)
3. **Valiosa** para el cliente

### Core Competencies de Pulso

#### 🥇 #1: WhatsApp como Interfaz de Ejecución de Campo

| Criterio | Evaluación |
|----------|------------|
| Difícil de copiar | ✅ Sí. No es sólo enviar mensajes — es un workflow engine bidireccional con IA interpretando respuestas, evidencia (fotos), OCR, y lógica de aprobación. |
| Difícil de adquirir | ✅ Sí. Requiere integración profunda con el workflow engine, el modelo de datos multi-tenant y los templates HORECA. No se compra con una API key. |
| Valiosa para el cliente | ✅ Crítico. Los empleados de piso nunca tocan una computadora. WhatsApp es su única interfaz. |

**Plan de acción:** Hacer de WhatsApp el moat más profundo. Añadir voice notes, ubicación GPS en checklists, pagos/reembolsos vía WhatsApp. Cada feature en WhatsApp que un competidor no pueda replicar rápido refuerza la ventaja.

#### 🥈 #2: Data Model Unificado (Compliance + Ops + Laboral + Inventario)

| Criterio | Evaluación |
|----------|------------|
| Difícil de copiar | ✅ Sí. No es un CRUD. Es un modelo relacional donde compliance, inventario, laboral y workflows comparten tenant, sucursal, empleado y período. |
| Difícil de adquirir | ✅ Sí. La complejidad está en las interacciones entre módulos, no en cada tabla individual. |
| Valiosa | ✅ "One platform, one truth" es el principio #4 de diseño de Pulso. |

**Plan de acción:** Profundizar integraciones cross-módulo. Ejemplo: que un incidente de NOM-251 automáticamente genere un workflow de remediación, asigne empleados, ajuste inventario afectado y notifique al ADMIN.

#### 🥉 #3: Expertise Regulatorio HORECA Mexicano

| Criterio | Evaluación |
|----------|------------|
| Difícil de copiar | ✅ Sí. Conocer NOM-251, NOM-035, IMSS, SAT, LFT no es leer leyes — es saber cómo se aplican en una cocina real. |
| Difícil de adquirir | ✅ Parcialmente. Se puede contratar, pero el conocimiento ya está embebido en templates, validaciones, y workflows. |
| Valiosa | ✅ Altísimo. Una multa de NOM puede quebrar un restaurante. |

**Plan de acción:** Convertirse en la autoridad de compliance HORECA en México. Publicar guías, webinars, checklist descargables. Ser la fuente que los restaurantes consultan, no solo la herramienta que usan.

### Capacidades No-Core (Outsourcear o Minimizar)

Siguiendo el framework de Bain: lo que no es core competency debe outsourcearse o minimizarse.

| Capacidad | No-Core | Razón | Acción |
|-----------|---------|-------|--------|
| Email delivery | Sí | Commodity. Resend, SendGrid, etc. | Ya está abstraído. Mantener así. |
| File storage | Sí | Commodity. S3-compatible. | Ya está en R2 con abstracción. Bien. |
| SMS/Voice (futuro) | Sí | Commodity. Twilio, etc. | Abstraer como "canal" igual que WhatsApp/Email. |
| AI model | Parcial | El modelo es commodity. La integración con workflows no. | Mantener abstracción de provider. Core es cómo se usa, no qué LLM. |
| Auth | Sí | Commodity. better-auth está bien. | No construir auth propia. |
| Dashboard UI | No | La experiencia de usuario es diferenciación. | Invertir en UX. Es parte del producto, no commodity. |

### Lección Southwest Airlines
> Southwest identificó que su core competency era la cultura de servicio al cliente y el turnaround rápido de aviones, y todo lo demás lo optimizaron alrededor de eso. No intentaron ser buenos en todo — fueron extraordinarios en lo que era difícil de copiar.

**Aplicación a Pulso:** Pulso no debería intentar ser bueno en TODO lo que hace un restaurante (contabilidad, nómina completa, facturación, CRM, marketing). Debe ser extraordinario en **ejecución operativa + compliance + WhatsApp** y dejar el resto para integraciones.

---

## 5. Balanced Scorecard

### Aplicación: KPIs que Miden la Salud Real de Pulso

> *"Convertir intangibles en tangibles hace la evaluación mucho más fácil."* — Kaplan & Norton

El Balanced Scorecard organiza KPIs en 4 perspectivas, adaptadas aquí para Pulso como plataforma SaaS B2B para HORECA.

### Scorecard de Pulso HORECA

#### 💰 Perspectiva Financiera

| KPI | Definición | Meta Trimestral | Frecuencia | Fuente de Datos |
|-----|-----------|-----------------|------------|-----------------|
| **MRR** | Monthly Recurring Revenue | +15% QoQ | Mensual | Stripe / facturación |
| **ARPU** | Average Revenue Per User (tenant) | $X MXN/mes | Mensual | MRR / # tenants activos |
| **Churn Rate** | % tenants que cancelan | < 3% mensual | Mensual | Cancelled / Total |
| **LTV/CAC** | Lifetime Value / Costo Adquisición | > 3:1 | Trimestral | CRM + Ads spend |
| **Net Revenue Retention** | Expansión + conservación | > 100% | Trimestral | Upgrades - downgrades - churn |
| **Gross Margin** | (Revenue - COGS) / Revenue | > 75% | Trimestral | Revenue - infra costs |

#### 👤 Perspectiva del Cliente

| KPI | Definición | Meta | Frecuencia | Cómo Medir |
|-----|-----------|------|------------|------------|
| **NPS** | Net Promoter Score | > 50 | Trimestral | Encuesta in-app / email |
| **Time-to-Value** | Días hasta que un tenant completa su primer workflow real | < 7 días | Mensual | Analytics DB |
| **Adopción de Módulos** | % tenants usando 3+ módulos | > 60% | Mensual | Usage tracking |
| **CSAT de Soporte** | Satisfacción con tickets resueltos | > 4.5/5 | Semanal | Post-ticket survey |
| **WhatsApp Engagement** | % empleados que ejecutan tareas vía WA semanalmente | > 80% | Semanal | WA delivery logs |
| **Referidos** | Nuevos tenants de referidos | > 20% del pipeline | Mensual | CRM source tracking |

#### ⚙️ Perspectiva de Procesos Internos

| KPI | Definición | Meta | Frecuencia | Cómo Medir |
|-----|-----------|------|------------|------------|
| **Workflow Completion Rate** | % workflows completados a tiempo | > 90% | Semanal | DB de ejecuciones |
| **Compliance Pass Rate** | % sucursales que pasan auditoría NOM sin incidencias | > 85% | Mensual | Módulo compliance |
| **Notification Deliverability** | % notificaciones entregadas (WA, Email, In-App) | > 98% | Diario | Notification logs |
| **AI Verification Accuracy** | % verificaciones AI concordantes con revisión humana | > 90% | Quincenal | AI verify logs + spot checks |
| **Incident Time-to-Resolution** | Horas desde incidente hasta cierre | < 4 horas | Semanal | Incident module |
| **Platform Uptime** | % disponibilidad del servicio | > 99.5% | Continuo | Monitoring (Vercel/Inngest) |
| **API Error Rate** | % requests con 5xx | < 1% | Diario | API logs |

#### 🚀 Perspectiva de Innovación y Aprendizaje

| KPI | Definición | Meta | Frecuencia | Cómo Medir |
|-----|-----------|------|------------|------------|
| **Feature Velocity** | Features shipped / sprint | > 3/sprint | Quincenal | Git releases |
| **Time-to-Deploy** | Minutos desde merge a producción | < 15 min | Continuo | CI/CD pipeline |
| **Test Coverage** | % código cubierto por tests E2E | > 60% rutas críticas | Mensual | Playwright reports |
| **AI Model Improvement** | Mejora en precisión de AI verification QoQ | +2% | Trimestral | AI verify accuracy trend |
| **Nuevas Integraciones** | Integraciones gubernamentales/nuevos partners | +2/trimestre | Trimestral | Roadmap |
| **Tech Debt Index** | # TODOs prioritarios abiertos / total | < 20% | Mensual | TODO scan del repo |

### Mapa Estratégico (Cómo se Conectan las 4 Perspectivas)

```
INNOVACIÓN              PROCESOS               CLIENTE               FINANCIERO
┌──────────────┐      ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│ AI más       │ ───► │ Compliance   │ ───► │ Menos        │ ───► │ Churn bajo   │
│ precisa      │      │ rate mejora  │      │ multas       │      │ + upsell     │
├──────────────┤      ├──────────────┤      ├──────────────┤      ├──────────────┤
│ Features     │ ───► │ Workflows    │ ───► │ Time-to-     │ ───► │ LTV/CAC      │
│ rápidas      │      │ completados  │      │ value bajo   │      │ saludable    │
├──────────────┤      ├──────────────┤      ├──────────────┤      ├──────────────┤
│ WhatsApp     │ ───► │ Engagement   │ ───► │ NPS alto +   │ ───► │ MRR crece    │
│ mejoras      │      │ empleados ▲  │      │ referrals ▲  │      │ 15% QoQ      │
└──────────────┘      └──────────────┘      └──────────────┘      └──────────────┘
```

### Comparación con el Case Study Zoom

Así como Zoom pudo medir su desempeño real durante la pandemia con un Balanced Scorecard, Pulso debe tener visibilidad total de sus 4 perspectivas para pivotear rápido. Si el churn sube, ¿es problema de procesos (workflows fallan), de innovación (competidor lanzó mejor feature), o de pricing?

---

## 6. Plan de Implementación Integrado

> **Los 5 frameworks no son independientes — se refuerzan. Aquí está el plan para aplicarlos en Pulso.**

### Fase 1: Diagnóstico (Semanas 1-2)

**Objetivo:** Tener datos reales para poblar las matrices.

| # | Acción | Framework | Owner | Output |
|---|--------|-----------|-------|--------|
| 1.1 | Medir usage por módulo (DAU, WAU, MAU por tenant) | BCG + GE-McKinsey | Data/Analytics | Reporte de adopción por módulo |
| 1.2 | Encuesta NPS a tenants activos | Balanced Scorecard | CX/Soporte | Baseline NPS |
| 1.3 | Auditar dependencias externas (Wasender, Neon, Upstash, etc.) | Porter 5F | Tech Lead | Risk matrix de proveedores |
| 1.4 | Competitive landscape refresh (qué hay nuevo en el mercado) | Porter 5F | Founder/CEO | Competitive matrix Q2 2026 |
| 1.5 | Listar TODOs por módulo y clasificar severidad | BCG + Core Comp | Tech Lead | TODO heatmap |
| 1.6 | Medir revenue y churn real por cohorte | Balanced Scorecard | Finance/CEO | SaaS metrics dashboard |

### Fase 2: Decisiones Estratégicas (Semana 3)

**Objetivo:** Workshop de estrategia con los findings de Fase 1.

| # | Decisión | Framework | Participantes | Output |
|---|----------|-----------|---------------|--------|
| 2.1 | Definir los 3 módulos STAR que reciben máxima inversión H2 2026 | BCG + GE | CEO + Tech Lead | Roadmap H2 2026 |
| 2.2 | Decidir si algún módulo se congela/discontinúa (DOG) | BCG | CEO + Tech Lead | Kill list (si aplica) |
| 2.3 | Priorizar reducción de dependencia WasenderAPI | Porter 5F | Tech Lead | Plan de abstracción WhatsApp provider |
| 2.4 | Definir las 3 core competencies oficiales de Pulso | Core Comp | Todo el equipo | Documento de Core Competencies |
| 2.5 | Seleccionar 8-12 KPIs del Balanced Scorecard para Dashboard ejecutivo | BSC | CEO + Tech Lead | Executive Dashboard spec |

### Fase 3: Ejecución — Quick Wins (Semanas 4-6)

**Objetivo:** Cambios de alto impacto y bajo esfuerzo inmediato.

| # | Acción | Esfuerzo | Impacto | Framework |
|---|--------|----------|---------|-----------|
| 3.1 | **Abstraer capa WhatsApp** — Crear `WhatsAppProvider` interface con implementación WasenderAPI. Preparar para Meta Cloud API como alternativa. | Medio (3-5 días) | Alto — des-riesga dependencia crítica | Porter 5F |
| 3.2 | **NPS In-App** — Agregar encuesta NPS simple en el dashboard | Bajo (1-2 días) | Alto — datos para BSC | Balanced Scorecard |
| 3.3 | **Instrumentar analytics por módulo** — Eventos de uso por feature para medir adopción real | Medio (2-3 días) | Alto — alimenta BCG y GE | BCG + GE-McKinsey |
| 3.4 | **Landing page de NOM-251** — Una página pública tipo guía descargable para ser autoridad en compliance | Bajo (1-2 días) | Medio — refuerza Core Competency #3 | Core Comp |
| 3.5 | **Auto-tagging de commits por módulo** — Para medir feature velocity por módulo | Bajo (1 día) | Medio — datos BSC | Balanced Scorecard |

### Fase 4: Ejecución — Strategic Bets (Semanas 7-12)

**Objetivo:** Inversiones estructurales que mueven la aguja.

| # | Acción | Esfuerzo | Impacto | Framework |
|---|--------|----------|---------|-----------|
| 4.1 | **WhatsApp Voice Notes + GPS** — Empleados pueden responder workflows con notas de voz y confirmar ubicación | Alto (2-3 semanas) | Muy Alto — profundiza moat WhatsApp | Core Comp #1 |
| 4.2 | **AI Verification 2.0** — Mejorar confianza, reducir falsos positivos, dashboard de revisión humana | Alto (2-3 semanas) | Alto — mueve Question Mark a Star | BCG |
| 4.3 | **Cross-module Workflows** — Incidente NOM → Workflow remediación → Ajuste inventario → Notificación ADMIN | Alto (2-3 semanas) | Muy Alto — profundiza Core Comp #2 | Core Comp #2 |
| 4.4 | **Executive Dashboard** — Implementar el Balanced Scorecard como página real en Pulso | Medio (1-2 semanas) | Alto — visibilidad total para ADMIN | Balanced Scorecard |
| 4.5 | **WhatsApp Provider Abstraction** — Terminar de abstraer y documentar para que cambiar de Wasender sea trivial | Medio (1-2 semanas) | Alto | Porter 5F |

### Fase 5: Sostenibilidad (Trimestral Recurrente)

| # | Ritual | Framework | Output |
|---|--------|-----------|--------|
| 5.1 | **Revisión de Portfolio (trimestral)** — Re-evaluar la matriz GE-McKinsey con datos de adopción reales | GE + BCG | Roadmap update Q+1 |
| 5.2 | **Balanced Scorecard Review (mensual)** — Revisar KPIs, ajustar metas | BSC | KPI dashboard update |
| 5.3 | **Competitive Landscape Refresh (trimestral)** — Actualizar análisis Porter 5F | Porter 5F | Competitive intel doc |
| 5.4 | **Core Competency Audit (semestral)** — ¿Siguen siendo nuestras ventajas difíciles de copiar? | Core Comp | Core comp update |
| 5.5 | **TODO/Deuda Técnica Scan (mensual)** — Actualizar PROJECT_CONTEXT.md con TODOs vivos | BCG + BSC | PROJECT_CONTEXT.md update |

---

## Resumen Ejecutivo

### Los 5 Frameworks en Una Frase para Pulso

| Framework | En una frase para Pulso |
|-----------|------------------------|
| **GE-McKinsey** | No todos los módulos merecen la misma inversión. Invertir strong en WhatsApp + NOM + AI. Mantener laboral e inventario. Evaluar el resto caso a caso. |
| **BCG Matrix** | WhatsApp Workflows y NOM-251 son las Stars que financian el futuro. AI Verification es la apuesta que debe probarse rápido. |
| **Porter's Five Forces** | El verdadero competidor es Excel+WhatsApp. WasenderAPI es la dependencia más riesgosa. El moat regulatorio es la mejor defensa. |
| **Core Competencies** | WhatsApp-first execution + Data model unificado + Expertise regulatorio = lo que NADIE más puede copiar rápido. |
| **Balanced Scorecard** | Si no se mide, no se mejora. 4 perspectivas, 24 KPIs, un executive dashboard. |

### La Decisión Estratégica #1

**Profundizar el moat de WhatsApp + Compliance en lugar de diversificar a más módulos.**

Los frameworks convergen en esto: Pulso no debería ser "la plataforma que hace de todo para restaurantes." Debería ser "la plataforma que hace extraordinariamente bien la ejecución operativa con WhatsApp y el compliance regulatorio." Los demás módulos existen para reforzar ese core, no para competir con SoftRestaurant en features de contabilidad.

---

*Documento generado como herramienta de planeación estratégica para Pulso HORECA.*
*Revisión trimestral recomendada. Próxima actualización: Octubre 2026.*
