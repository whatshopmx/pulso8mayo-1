# Implementation Plan: Sistema Operativo de Red QSR (3 a 15 Sucursales) — Pulso HORECA

## Overview

Transformación de la experiencia de administración y supervisión de Pulso HORECA para **grupos restauranteros de servicio rápido (QSR) de 3 a 15 sucursales**. 

Reemplaza la arquitectura actual fragmentada de 4 dashboards desconectados y herramientas de BI genéricas (`/dashboard`, `/dashboard/executive`, `/dashboard/exceptions`, `/dashboard/analytics/branches`, `/dashboard/analytics`, `/dashboard/analytics/kpi-builder`, `/dashboard/analytics/trends`, `/dashboard/analytics/incidents`) por un **Sistema Operativo Multi-Unidad** articulado en torno a la trinchera diaria de un operador de cadena:
1. **En Vivo (Live Command Center en `/dashboard`):** Semáforo de aperturas a tiempo, dotación de personal por turno, monitoreo de cadena de frío y venta acumulada.
2. **Excepciones & Riesgos (`/dashboard/exceptions`):** Bandeja de triage clasificada por impacto directo (Dinero en caja/TPV, Inocuidad NOM-251, Mermas en horas pico y Personal).
3. **Liga de Sucursales (`/dashboard/branches`):** Benchmarking peer-to-peer, Prime Cost comparativo (Food Cost % + Labor Cost %) y detección de inconsistencias entre tiendas.
4. **Dirección & Unit Economics (`/dashboard/executive`):** Morning Brief diario de IA (7:00 AM), P&L operativo estimado por tienda y proyección de flujo a 14 días.

---

## Architecture Decisions

1. **Unificación de Navegación en "Comando de Red":** Se reestructura `components/app-sidebar.tsx` eliminando la sección redundante de "Analítica" (5 subenlaces huérfanos). Se establecen 4 accesos claros que corresponden al ciclo de supervisión diario del operador QSR.
2. **Depuración del "Síndrome de BI Genérico":** Se retira el constructor de KPIs manuales (`/dashboard/analytics/kpi-builder`) y el dashboard analítico abstracto (`/dashboard/analytics`). Los operadores QSR no formulan KPIs matemáticos; operan con guardrails estándar del sector (Food Cost, Labor Cost, Ticket Promedio, Cumplimiento de Apertura/Cierre, NOM-251).
3. **Triage por Impacto de Negocio (GroupExceptionsService):** Las excepciones se categorizan formalmente en 4 dominios críticos para QSR: `DINERO` (caja, TPVs, fraudes), `INOCUIDAD` (NOM-251, frío, higiene), `ABASTO` (mermas anormales, rotación) y `PERSONAL` (asistencia y turnos clave). Cada ítem expone una acción directa resolutiva (WhatsApp, arqueo, transferencia).
4. **Scorecard QSR y Prime Cost en Benchmarking:** Se enriquece `CrossBranchService` para calcular el Prime Cost combinado por tienda aprovechando los datos de ventas (`daily_sales_cuts`), insumos/recetas (`recipes`, `operating_expenses`) y horas laborales (`shift_logs`), permitiendo rankear qué sucursales operan en el rango objetivo (<60%).
5. **Preservación Total de Datos y Retrocompatibilidad:** Ninguna tabla existente se destruye. Las URLs anteriores como `/dashboard/analytics/branches` se redirigen transparentemente o se mantienen como alias para no romper marcadores ni flujos existentes.

---

## Task List

### Fase 1: Consolidación de Navegación y Rutas

- [ ] **Task 1:** Reestructuración de navegación en `app-sidebar.tsx` y creación de alias/ruta canónica `/dashboard/branches`.

### Checkpoint 1: Navegación Limpia
- [ ] La barra lateral muestra únicamente las 4 secciones operativas de Comando de Red.
- [ ] No existen enlaces rotos; las rutas anteriores redirigen limpiamente.
- [ ] `pnpm run build` compila sin errores.

---

### Fase 2: Centro de Excepciones QSR & Triage de Riesgos

- [ ] **Task 2:** Clasificación por riesgo de negocio en `GroupExceptionsService` (Dinero, Inocuidad NOM, Mermas/Abasto, Personal).
- [ ] **Task 3:** Rediseño UI del Centro de Excepciones (`/dashboard/exceptions`) con selector de impacto y acciones de resolución en 1 clic.

### Checkpoint 2: Triage Operativo Activo
- [ ] Un faltante de arqueo o alerta TPV se lista bajo "Dinero & Caja" con deep link al corte.
- [ ] Una alerta de temperatura NOM-251 se lista bajo "Inocuidad" con acceso al registro del equipo.
- [ ] Cada excepción permite detonar una acción sin perder el contexto.

---

### Fase 3: Live Command Center ("El Pulso de Hoy")

- [ ] **Task 4:** Servicio y endpoint de Pulso en Vivo (Apertura de tiendas, asistencia del turno, alertas rojas de servicio y venta acumulada).
- [ ] **Task 5:** Rediseño del Home (`app/dashboard/page.tsx`) integrando la Matriz en Vivo de Sucursales y alertas prioritarias de rush.

### Checkpoint 3: Comando en Vivo Operativo
- [ ] El director de operaciones visualiza de un vistazo cuáles de las 3 a 15 sucursales abrieron a tiempo y completaron su checklist.
- [ ] Las alertas rojas de servicio (frío, falta de cajero, desabasto) aparecen en la cabecera.
- [ ] Se elimina la sobrecarga de pestañas abstractas en el Home.

---

### Fase 4: Liga de Sucursales & Benchmarking Multi-Unidad

- [ ] **Task 6:** Cálculo de Scorecard QSR y Prime Cost (Food Cost % + Labor Cost %) en `CrossBranchService`.
- [ ] **Task 7:** Rediseño de la pantalla de Benchmarking (`/dashboard/branches`) con ranking de consistencia, comparativa cruzada y ficha 360° por tienda.

### Checkpoint 4: Benchmarking Multi-Unidad Completo
- [ ] Las sucursales se ordenan según el Score QSR integral (Venta, Costos, NOM-251, Cuadre TPV).
- [ ] El motor resalta discrepancias automáticas ("Sucursal A tiene 5% más Food Cost que Sucursal B").
- [ ] El drill-down por tienda muestra la radiografía completa de la unidad.

---

### Fase 5: Dirección & Unit Economics (Executive Suite)

- [ ] **Task 8:** Consolidación de `/dashboard/executive` con foco en Morning Brief diario, P&L operativo por tienda y proyección de flujo a 14 días.

### Checkpoint 5: Vista de Dirección Validada
- [ ] El dueño visualiza el Morning Brief matutino generado por el Executive Twin.
- [ ] El P&L operativo compara ingresos, costo de alimentos, nómina y EBITDA tienda por tienda.
- [ ] La proyección de caja a 14 días muestra la solvencia del grupo frente a pagos programados.

---

### Fase 6: Retiro de Rutas Obsoletas y Pruebas de Integración

- [ ] **Task 9:** Depuración de rutas obsoletas (`/analytics/kpi-builder`, `/analytics/trends`), redirecciones y verificación integral de build y tests.

---

## Risks and Mitigations

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Faltante de datos de ventas en vivo si la sucursal no ha capturado el corte matutino | Medio | Mostrar estado "En turno / Esperando corte de cambio de turno" con badge informativo en lugar de marcarlo como venta en cero. |
| Inconsistencia en recetas al calcular Food Cost teórico en sucursales nuevas | Medio | Clasificar la procedencia del dato como `ESTIMATED` (basado en compras/gastos de insumos) hasta que existan recetas y cortes vinculados. |
| Resistencia del operador a cambios en los enlaces habituales | Bajo | Mantener redirecciones permanentes (`next.config.ts` o páginas delegadas) para que ningún enlace guardado falle. |

---

## Open Questions

1. **Prioridad de la pantalla de inicio:** ¿Prefieres que los administradores lleguen por defecto a "En Vivo" (`/dashboard`) o al "Morning Brief Ejecutivo" (`/dashboard/executive`)? (Recomendación: En Vivo para Directores de Operaciones; Morning Brief para Dueños/Socios).
2. **Umbral de Alerta de Prime Cost:** ¿Establecer la meta de Prime Cost en 60% por defecto (estándar QSR en México) con alerta amarilla a partir del 62% y roja en 65%?
