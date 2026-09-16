# Task Breakdown: Sistema Operativo de Red QSR (3 a 15 Sucursales) — Pulso HORECA

---

## Task 1: Reestructuración de navegación en app-sidebar y ruta canónica de sucursales

**Description:**
Reestructurar la barra lateral en `components/app-sidebar.tsx` para el grupo de restaurantes. Consolidar el menú bajo la sección "Comando de Red" con 4 enlaces estratégicos: En Vivo (`/dashboard`), Excepciones & Riesgos (`/dashboard/exceptions`), Liga de Sucursales (`/dashboard/branches`) y Dirección & P&L (`/dashboard/executive`). Retirar del menú los 5 subenlaces huérfanos de Analítica (`/analytics`, `/kpi-builder`, `/trends`, `/incidents`). Crear la ruta canónica `/dashboard/branches` que delega o absorbe `/dashboard/analytics/branches` con retrocompatibilidad.

**Acceptance criteria:**
- [x] La sección "Comando de Red" en el sidebar contiene exactamente los 4 accesos: En Vivo, Excepciones, Liga de Sucursales y Dirección.
- [x] Se eliminan los accesos directos a `/dashboard/analytics`, `/kpi-builder`, `/trends` e `/incidents` de la barra lateral.
- [x] La ruta `/dashboard/branches` renderiza la vista de desempeño de sucursales y la ruta `/dashboard/analytics/branches` redirige transparentemente hacia `/dashboard/branches`.
- [x] Las rutas de detalle `/dashboard/branches/[id]` funcionan de forma consistente con su navegación hacia atrás.

**Verification:**
- [x] Build exitoso: `pnpm run build`
- [x] Tests pasan: `pnpm test:unit`
- [x] Manual check: Verificar en navegador que la barra lateral muestra los 4 accesos limpios y que hacer clic en "Liga de Sucursales" abre `/dashboard/branches`.

**Dependencies:** None

**Files likely touched:**
- `components/app-sidebar.tsx`
- `app/dashboard/branches/page.tsx`
- `app/dashboard/branches/[id]/page.tsx`
- `app/dashboard/analytics/branches/page.tsx`

**Estimated scope:** Medium (3-4 files)

---

## Checkpoint 1: Navegación y Rutas Limpias
- [x] El menú lateral refleja la nueva arquitectura de 4 pilares QSR.
- [x] La compilación `pnpm run build` no arroja errores de tipado ni rutas rotas.

---

## Task 2: Clasificación por impacto de negocio QSR en GroupExceptionsService

**Description:**
Evolucionar `lib/services/group-exceptions-service.ts` para clasificar las anomalías detectadas en 4 categorías de riesgo operacional de restaurante:
1. `DINERO` (arqueos con descuadre, cancelaciones post-cobro, terminales fantasma, gastos no autorizados).
2. `INOCUIDAD` (temperaturas de refrigeración/congelación fuera de norma NOM-251, checklists sanitarios omitidos).
3. `ABASTO` (mermas anormales al cierre, insumos críticos bajo punto de reorden en horario de rush).
4. `PERSONAL` (retardos o ausentismo en puestos operativos clave).
Incluir metadatos de acción resolutiva (enlace de WhatsApp al gerente, deep link de arqueo, solicitud de transferencia de insumos).

**Acceptance criteria:**
- [x] El servicio expone un agrupador o campo `qsrCategory` con los valores: `DINERO`, `INOCUIDAD`, `ABASTO`, `PERSONAL`.
- [x] Cada excepción incluye metadatos de acción rápida: tipo de acción (`WHATSAPP_CALL`, `AUDIT_DRAWER`, `TRANSFER_STOCK`, `WORK_ORDER`) y URL de resolución directa.
- [x] Las pruebas unitarias validan que las excepciones se categorizan correctamente según su procedencia (M13 Ventas, M17 Control Interno, NOM-251, M12 Inventario).

**Verification:**
- [x] Tests pasan: `pnpm test:unit lib/services/__tests__/group-exceptions-service.test.ts`
- [x] Build exitoso: `pnpm run build`

**Dependencies:** Task 1

**Files likely touched:**
- `lib/services/group-exceptions-service.ts`
- `lib/services/__tests__/group-exceptions-service.test.ts`

**Estimated scope:** Medium (2-3 files)

---

## Task 3: Rediseño UI del Centro de Excepciones & Riesgos con Triage Operativo

**Description:**
Rediseñar `app/dashboard/exceptions/page.tsx` para abandonar la lista plana genérica y convertirla en una bandeja de triage por impacto. Incorporar pestañas superiores de categorías QSR con contadores (Dinero & Caja, Inocuidad & Frío, Mermas & Stock, Personal). Añadir en cada tarjeta el impacto financiero/operativo estimado y botones de acción directa en 1 clic (ej. "Auditar Corte POS vs TPV", "Ver Cámara Fría", "Contactar Gerente").

**Acceptance criteria:**
- [x] La pantalla presenta pestañas con contadores en vivo para las 4 categorías QSR: Dinero, Inocuidad, Abasto y Personal.
- [x] Las tarjetas destacan el dinero en riesgo o el peligro normativo (ej. "Riesgo de merma de $42,000 en carne", "Descuadre de -$840 MXN").
- [x] Cada tarjeta incluye un botón de acción primaria resolutiva con deep link directo.
- [x] Cuenta con selector de sucursal individual o "Todas las sucursales" respetando el contexto del grupo.

**Verification:**
- [x] Build exitoso: `pnpm run build`
- [x] Manual check: Abrir `/dashboard/exceptions`, alternar entre pestañas de riesgo y verificar que las acciones abren el expediente correspondiente.

**Dependencies:** Task 2

**Files likely touched:**
- `app/dashboard/exceptions/page.tsx`

**Estimated scope:** Medium (3-4 files)

---

## Checkpoint 2: Centro de Excepciones QSR en Funcionamiento
- [x] Las alertas de toda la cadena se priorizan por impacto económico y sanitario.
- [x] El operador puede resolver o delegar incidentes sin navegar por menús secundarios.

---

## Task 4: Servicio y Endpoint de Pulso en Vivo (Live Command)

**Description:**
Crear el servicio `lib/services/live-command-service.ts` y su endpoint correspondiente `/api/group/live-pulse` que consolida el estado operativo del día en curso para las 3 a 15 sucursales:
- Estado de apertura (abierto a tiempo antes de la hora límite del turno vs. retrasado vs. sin abrir).
- Cobertura de personal (empleados con check-in en turno actual vs. plantilla requerida).
- Monitoreo de temperaturas críticas (últimas lecturas de cámaras frías vs. umbrales NOM-251).
- Venta acumulada del día (a partir de `dailySalesCuts` y ventas POS del día vs. meta diaria por sucursal).
- Alertas rojas activas que amenazan el rush actual.

**Acceptance criteria:**
- [x] El endpoint `/api/group/live-pulse` devuelve el consolidado de las sucursales con tiempo de respuesta < 200ms.
- [x] Calcula el semáforo de apertura de cada sucursal comparando la hora de ejecución del checklist de apertura con la hora configurada.
- [x] Reporta la lista de alertas rojas en curso que requieren atención inmediata en el turno.

**Verification:**
- [x] Tests unitarios: `pnpm test:unit lib/services/__tests__/live-command-service.test.ts`
- [x] Build exitoso: `pnpm run build`

**Dependencies:** Task 1

**Files likely touched:**
- `lib/services/live-command-service.ts`
- `app/api/group/live-pulse/route.ts`
- `lib/services/__tests__/live-command-service.test.ts`

**Estimated scope:** Medium (3 files)

---

## Task 5: Rediseño del Home Operativo como Live Command Center

**Description:**
Transformar `app/dashboard/page.tsx` para que funcione como el centro de control en tiempo real de la cadena de restaurantes ("El Pulso de Hoy"). Reemplazar la colección de pestañas y gráficos genéricos por:
1. Barra de pulso del turno (Tiendas abiertas a tiempo, % asistencia de turno, venta acumulada hoy).
2. Banner de Alertas Rojas en Rush (problemas que afectan el servicio de este momento).
3. Matriz en Vivo de Sucursales (tabla/parrilla interactiva con semáforos por tienda en Apertura, Personal, Frío y Venta).
4. Acceso directo a la resolución de incidencias en trinchera.

**Acceptance criteria:**
- [x] El Home carga con Server Components y Suspense mostrando de inmediato la matriz de sucursales.
- [x] Permite filtrar la matriz por sucursal o ver la red completa de un solo vistazo.
- [x] Si una sucursal tiene un congelador fuera de rango o un retraso en apertura, se resalta en rojo con enlace directo al detalle.
- [x] Se elimina la sobrecarga de pestañas abstractas de BI de la pantalla principal.

**Verification:**
- [x] Typecheck exitoso: `pnpm exec tsc --noEmit`
- [x] Tests pasan: `pnpm test:unit lib/services/__tests__/live-command-service.test.ts`
- [x] Manual check: Componentes creados y cableados en `/dashboard`.

**Dependencies:** Task 4

**Files likely touched:**
- `app/dashboard/page.tsx`
- `components/dashboard/live/live-command-matrix.tsx`
- `components/dashboard/live/live-pulse-banner.tsx`
- `components/dashboard/live/live-rush-alerts.tsx`
- `components/dashboard/live/live-command-section.tsx`

**Estimated scope:** Large (4-5 files)

---

## Checkpoint 3: Live Command Center Operativo
- [x] El Home de Pulso responde en tiempo real a las preguntas operativas del día: quién abrió, quién faltó, cuánto se ha vendido y qué alertas amenazan el turno.

---

## Task 6: Motor de Prime Cost y Scorecard QSR en CrossBranchService

**Description:**
Extender `lib/services/cross-branch-service.ts` para calcular métricas especializadas en cadenas QSR:
- **Prime Cost Combinado:** (Costo de Alimentos / Venta Bruta) + (Costo de Mano de Obra / Venta Bruta). Meta objetivo: <60%.
- **Score QSR Ponderado:** Venta vs Meta (30%) + Prime Cost (30%) + Cumplimiento NOM-251 (20%) + Cuadre de Caja/TPV (20%).
- **Detección de Inconsistencias de Red:** Identificar desviaciones automáticas significativas entre sucursales que operan con el mismo menú (ej. "Sucursal Roma presenta un Food Cost 6.2% mayor que Condesa").

**Acceptance criteria:**
- [ ] `getBranchRanking` y `getBenchmarking` devuelven `primeCostPercent`, `foodCostPercent` y `laborCostPercent` para cada sucursal del grupo.
- [ ] El algoritmo de detección de anomalías genera hallazgos narrativos basados en diferencias de más de 3 puntos porcentuales entre unidades hermanas.
- [ ] Maneja casos donde faltan datos de inventario o nómina clasificando la procedencia como `ESTIMATED` sin romper el cálculo.

**Verification:**
- [ ] Tests pasan: `pnpm test lib/services/__tests__/cross-branch-qsr.test.ts`
- [ ] Build exitoso: `pnpm run build`

**Dependencies:** Task 1

**Files likely touched:**
- `lib/services/cross-branch-service.ts`
- `lib/services/__tests__/cross-branch-qsr.test.ts`

**Estimated scope:** Medium (2-3 files)

---

## Task 7: Rediseño de la Liga de Sucursales y Benchmarking de Red

**Description:**
Rediseñar `app/dashboard/branches/page.tsx` como la "Liga de Sucursales" para grupos de 3 a 15 unidades:
1. Podio de honor con Top 3 sucursales del mes según el Scorecard QSR integral.
2. Tabla comparativa de consistencia multi-unidad mostrando: Venta Promedio, Food Cost %, Labor Cost %, Prime Cost %, NOM-251 y Cuadre TPV.
3. Panel de Hallazgos de Inteligencia de Red (Executive Twin) explicando causas de varianza entre tiendas.
4. Ficha 360° en `app/dashboard/branches/[id]/page.tsx` con la radiografía completa de la sucursal (organigrama de turno, equipos de refrigeración, bitácora de mermas y auditorías fotográficas).

**Acceptance criteria:**
- [ ] Muestra el ranking visual de las 3 a 15 sucursales ordenadas por su puntaje integral QSR.
- [ ] La tabla destaca con colores semafóricos los Prime Costs saludables (<60% verde, 60-65% amarillo, >65% rojo).
- [ ] Al hacer clic en cualquier sucursal, se accede a la ficha detallada 360° conservando el selector de período.
- [ ] Incluye exportación a CSV con codificación BOM para Excel en español.

**Verification:**
- [ ] Build exitoso: `pnpm run build`
- [ ] Manual check: Abrir `/dashboard/branches`, comparar sucursales y entrar a la ficha de una sucursal específica.

**Dependencies:** Task 6

**Files likely touched:**
- `app/dashboard/branches/page.tsx`
- `app/dashboard/branches/[id]/page.tsx`
- `components/analytics/branch-ranking-table.tsx`
- `components/analytics/branch-qsr-scorecard.tsx`

**Estimated scope:** Large (4-5 files)

---

## Checkpoint 4: Benchmarking y Liga QSR Funcionando
- [ ] Las sucursales se comparan de forma justa con métricas estandarizadas de la industria.
- [ ] Los socios y supervisores pueden auditar exactamente qué tienda está fugando margen en alimentos o personal.

---

## Task 8: Consolidación de Dirección & Unit Economics (Executive Suite)

**Description:**
Refinar `app/dashboard/executive/page.tsx` para concentrar la visión del dueño y socios de la marca:
- Mantener en la cabecera el **Morning Brief diario (7:00 AM)** con el estado de salud sobre 100 y las 3 prioridades del día.
- Destacar el bloque de métricas consolidadas: Venta acumulada del mes, Prime Cost consolidado de la marca y Caja disponible.
- Integrar la tabla de P&L Operativo Comparativo (`PnlBranchTable`) con EBITDA por sucursal.
- Mantener la Proyección de Flujo a 14 días (`CashFlowProjection`) vinculada a compromisos con proveedores y nóminas.

**Acceptance criteria:**
- [ ] La pantalla de Dirección carga limpiamente sin duplicar la lista de excepciones ni rankings redundantes que ya viven en `/dashboard/branches`.
- [ ] Presenta el Morning Brief matutino generado por el motor de inteligencia.
- [ ] El P&L operativo y el flujo de caja muestran la rentabilidad neta por tienda.

**Verification:**
- [ ] Build exitoso: `pnpm run build`
- [ ] Manual check: Verificar que `/dashboard/executive` ofrece la vista panorámica de negocio para el dueño sin ruido operativo.

**Dependencies:** Task 1, Task 6

**Files likely touched:**
- `app/dashboard/executive/page.tsx`
- `components/dashboard/executive/kpi-hero-cards.tsx`

**Estimated scope:** Medium (2-3 files)

---

## Task 9: Retiro seguro de rutas de analítica obsoletas y verificación integral

**Description:**
Completar la transición de la suite analítica:
- Configurar redirecciones permanentes o mensajes de delegación en las rutas que se retiran del flujo principal (`/dashboard/analytics/kpi-builder`, `/dashboard/analytics/trends`, `/dashboard/analytics/incidents`, `/dashboard/analytics`).
- Asegurar que no queden enlaces rotos en componentes secundarios ni en notificaciones.
- Ejecutar la suite completa de pruebas unitarias y de integración del proyecto.
- Comprobar que el build de producción (`pnpm run build`) compila con cero errores.

**Acceptance criteria:**
- [ ] Si un usuario accede a `/dashboard/analytics`, es redirigido a `/dashboard/branches` o `/dashboard`.
- [ ] Si accede a `/dashboard/analytics/incidents`, es redirigido a `/dashboard/exceptions`.
- [ ] Todos los tests del proyecto pasan limpiamente: `pnpm test`.
- [ ] `pnpm run build` y `pnpm run lint` finalizan con éxito.

**Verification:**
- [ ] `pnpm test`
- [ ] `pnpm run build`
- [ ] `pnpm run lint`

**Dependencies:** Tasks 1 a 8

**Files likely touched:**
- `next.config.ts` (o `next.config.js`)
- `app/dashboard/analytics/page.tsx`
- `app/dashboard/analytics/kpi-builder/page.tsx`
- `app/dashboard/analytics/trends/page.tsx`
- `app/dashboard/analytics/incidents/page.tsx`

**Estimated scope:** Medium (3-5 files)

---

## Checkpoint Final: Sistema Operativo QSR Completo y Verificado
- [ ] El sistema Pulso queda transformado en un verdadero Sistema Operativo Multi-Unidad para grupos QSR de 3 a 15 sucursales.
- [ ] Desapareció la confusión entre 4 dashboards distintos.
- [ ] Todas las pruebas automatizadas y compilación pasan al 100%.
