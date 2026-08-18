# Implementation Plan: Panel de Flujo de Efectivo — remediación de la crítica

Fuente: `.impeccable/critique/2026-08-16T02-10-32Z__app-dashboard-finance-cash-flow-page-tsx.md` (16/40, 2 P0, 2 P1).

## Overview

La pantalla `/dashboard/finance/cash-flow` le dice a una dueña que puede no alcanzarle para la
nómina, usando números que el servicio inventa. Tres defectos se componen: el saldo inicial es la
constante `INITIAL_BALANCE = 2000000` idéntica para toda la base de inquilinos, las entradas son un
promedio histórico plano (con un fallback muerto que deja a un inquilino nuevo en $0/día y pantalla
roja), y la nómina se cuenta doble en cualquier día 15/30 que comparta fecha con otro gasto. Encima,
el selector de sucursal del encabezado se envía a la API y la API lo tira: la dueña ve las cifras del
grupo entero etiquetadas como "Polanco" y actúa sobre ellas.

El plan repara la aritmética primero, después el alcance, después la verdad del saldo inicial, y solo
entonces toca la capa visual. El orden no es negociable: pintar mejor un número falso lo hace más
creíble.

**Verificado directamente en el código antes de planear** (no se tomó la crítica al pie de la letra):
`route.ts:23-27` sólo lee `days`; `cash-flow-service.ts:81` es la constante; `:349-373` la referencia
compartida que duplica la nómina; `Number(daysCount || 1)` que vuelve inalcanzable el fallback
`1500000`; `metrics.minBalance < 50000` = $500 MXN; `floor(i/7)+1` que emite 5 semanas en un grid de
4; `weeklyChartData` calculado y nunca usado; cero `Link` en ambos archivos.

## Architecture Decisions

1. **El saldo inicial se captura, no se adivina.** No existe tabla bancaria ni libro mayor en el
   esquema, así que ningún cálculo puede producir el saldo real. Se crea `cash_flow_assumptions`
   (`companyId` + `branchId` nullable, `openingBalanceCents`, `asOfDate`, `updatedBy`, `updatedAt`)
   con migración escrita a mano, y se edita en línea desde la tarjeta. Sin registro, la tarjeta no
   muestra una cifra: muestra el estado vacío que pide el dato. Un panel de alerta temprana sin
   saldo no alerta, y es mejor que lo diga.
2. **`branchId` viaja por la ruta, nunca por el body, y pasa por `enforceBranchScope`.** Las cinco
   consultas del servicio (`operatingExpenses`, `purchaseOrders`, `invoices`, `dailySalesCuts`,
   `employeeContracts`→`users`) tienen columna de sucursal. `invoices.branch_id` es **nullable**:
   al filtrar por sucursal esas facturas desaparecerían en silencio, así que se excluyen del cálculo
   y su conteo se declara en la línea de supuestos ("N facturas sin sucursal asignada, no incluidas").
3. **Estado de la pantalla en la URL, no en `useState`.** Horizonte (7/30/60), sucursal y colapsos
   pasan a `searchParams`. Resuelve al mismo tiempo el horizonte fijo, el deep-link para mandarle
   "mira la semana 3" al contador, y los colapsos que se reinician en cada cambio de sucursal.
4. **La pantalla escribe, con RBAC.** Decisión tomada: "Reprogramar" y "Marcar pagado" se ejecutan
   desde aquí. Los endpoints se construyen en el dominio de gastos (`/api/expenses/[id]/pay`,
   `/api/expenses/[id]/reschedule`), no en el de cash-flow — esta pantalla es un consumidor más.
   `expense-service.ts` ya tiene `create/approve/reject`; se le suman `markPaid` y `reschedule` con
   el mismo patrón de auditoría.
5. **Un solo dueño del rojo: la tarjeta de vencidos.** Todo lo demás baja a ámbar con palabra
   literal ("Semana pesada") o a foreground con signo negativo. Además el rojo aprende a rangear:
   la tarjeta 3 es roja solo a ≤7 días, ámbar hasta 14, neutra más allá.
6. **`--warning-text` en vez de `--warning` para texto.** El repo ya resolvió esto en
   `globals.css:90-94` y nueve archivos lo adoptaron, incluida la tarjeta hermana
   `cash-flow-summary-card.tsx:166`. Este archivo se quedó atrás.
7. **La pantalla no tiene spec e2e.** `tests/` no contiene ninguna para cash-flow, así que los
   invariantes aritméticos de la Fase 0 no tienen dónde vivir. Task 0 la crea antes de tocar el
   servicio: arranca en rojo y las Tasks 1-5 la ponen en verde.
8. **Fuera de alcance en este plan:** compartir por WhatsApp. Queda anotado como seguimiento.

## Task List

### Fase 0: La aritmética (sólo servicio, sin riesgo de UI)
- [ ] Task 0: Crear `tests/cash-flow.spec.ts` con los invariantes
- [ ] Task 1: Nómina contada dos veces
- [ ] Task 2: Entradas con estacionalidad y sin historial declarado
- [ ] Task 3: Semana 5 fantasma y la mediana que contamina
- [ ] Task 4: Frontera de fecha en zona horaria de la sucursal
- [ ] Task 5: `procurementCommitments` fuera de la ventana

### Checkpoint: Aritmética
- [ ] `pnpm run build` limpio
- [ ] Invariante: `Σ days[].projectedOutflowCents == Σ outflowItems[].amountCents` dentro de la ventana
- [ ] Invariante: el total semanal de una semana == suma de los días que la componen
- [ ] Un inquilino sin `dailySalesCuts` no produce una pantalla roja

### Fase 1: Alcance por sucursal (P0)
- [ ] Task 6: Hilar `branchId` de la ruta al servicio
- [ ] Task 7: Horizonte y estado de pantalla en la URL

### Checkpoint: Alcance
- [ ] Cambiar de sucursal cambia las cifras
- [ ] Un GERENTE no puede pedir otra sucursal (`enforceBranchScope`)
- [ ] La píldora de alcance dice siempre para qué sucursal son los números

### Fase 2: Saldo inicial verdadero (P0)
- [ ] Task 8: Tabla y migración de supuestos de flujo
- [ ] Task 9: Captura en línea, línea de supuestos y "cómo se calcula"

### Checkpoint: Saldo inicial
- [ ] Ningún número de la pantalla depende ya de una constante
- [ ] Sin saldo capturado la pantalla lo pide, no proyecta
- [ ] Las cuatro estimaciones (saldo, fecha de OC +14d, quincena 15/30, entradas históricas) están declaradas en pantalla

### Fase 3: Accionabilidad (P1)
- [ ] Task 10: Higiene de datos del render
- [ ] Task 11: Cada hallazgo enlaza a su registro origen
- [ ] Task 12: Endpoints de pago y reprogramación de gastos
- [ ] Task 13: Acciones en línea con RBAC

### Checkpoint: Accionabilidad
- [ ] Toda fila de vencidos y de próximos 7 días navega a su registro
- [ ] `supplierName` visible donde existe
- [ ] Un inquilino con vencidos y sin días de proyección ve sus vencidos
- [ ] Marcar pagado desde aquí cambia el estado y queda en auditoría

### Fase 4: Color, contraste y jerarquía (P1)
- [ ] Task 14: Contraste (dos fallas AA verificadas)
- [ ] Task 15: Presupuesto de rojo y jerarquía de severidad
- [ ] Task 16: Jerarquía visual y agrupación

### Checkpoint: Visual
- [ ] Cero usos de `text-warning` como texto; cero `text-success` en `text-xs`
- [ ] En un mes malo, el rojo cabe en el 10–15% que fija DESIGN.md
- [ ] Las badges OC y Factura se distinguen en modo oscuro

### Fase 5: Copy, accesibilidad y limpieza (P2)
- [ ] Task 17: Copy factualmente correcto
- [ ] Task 18: Accesibilidad
- [ ] Task 19: Limpieza

### Checkpoint: Completo
- [ ] `pnpm run build` y `pnpm run lint` limpios
- [ ] `pnpm exec playwright test tests/cash-flow.spec.ts` en verde
- [ ] Repasar la crítica punto por punto; lo no atendido queda anotado con razón

## Risks and Mitigations

| Riesgo | Impacto | Mitigación |
|---|---|---|
| La migración de `cash_flow_assumptions` se commitea pero no se aplica a la DB apuntada | Alto | Correr `scripts/check-migration-drift.ts` antes y después. Es el patrón que ya mordió en este repo. |
| Filtrar por sucursal deja fuera facturas con `branch_id` NULL sin que nadie lo note | Alto | Excluirlas explícitamente y declarar el conteo en pantalla (decisión 2). Nunca en silencio. |
| Los e2e corren en serie contra la DB de desarrollo real y se pisan entre sí | Medio | Etiquetar los datos `[E2E]` y limpiarlos vía `tests/support/db.ts`, como el resto de las specs. |
| `Marcar pagado` sin conciliación bancaria repite el problema que `payables` decidió no tener | Medio | Escribir solo el estado del gasto, dejar la conciliación fuera, y decir en pantalla qué hace y qué no. |
| Task 16 (jerarquía) se convierte en un rediseño abierto | Medio | Se limita a: una respuesta primaria, `tabular-nums`, piso de `text-sm` en datos, ≤4 bloques de primer nivel. Nada más. |
| `pnpm run build` falla sin red al bajar Geist de Google Fonts | Bajo | Fallback documentado: `npx tsc --noEmit` (es lo que se hizo en el plan de IMSS). |

## Open Questions

1. **Facturas sin sucursal.** El plan las excluye del cálculo por sucursal y declara el conteo.
   Si la respuesta correcta es prorratearlas o asignarlas a una sucursal por defecto, cambia Task 6.
2. **La `asOfDate` del saldo capturado.** Si la dueña capturó el saldo hace 9 días, ¿la proyección
   arranca de esa fecha, o se rechaza el dato por viejo y se le vuelve a pedir? Task 9 asume:
   se usa, con la antigüedad visible; a más de 7 días se pide actualizar.
3. **El H1.** "Panel de Alerta Temprana de Tesorería" aterriza en la anti-referencia que prohíbe
   PRODUCT.md, cuatro líneas arriba del comentario que rechaza "runway" por ser vocabulario ajeno.
   Task 17 propone "¿Me alcanza para este mes?" — es una decisión de voz, no de código.
4. **Doña Marisol y el iPad.** El 85% del texto de datos es `text-xs`. Subir el piso a `text-sm`
   cambia la densidad de la pantalla completa. Task 16 lo asume; si prefieres conservar densidad,
   la alternativa es subir solo las cifras y dejar las etiquetas.
