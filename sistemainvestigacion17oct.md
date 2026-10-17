Mapa completo de módulos de Pulso par
1. Organización y configuración del grupo
   - Empresa: datos generales de la compañía, configuración fiscal/operativa y parámetros globales.
   - Sucursales: altas, bajas, ubicación, horarios, responsables y configuración individual de las 8 unidades.
   - Usuarios: acceso de empleados, gerentes, supervisores, administración y dirección.
   - Roles y permisos: define quién puede ver, capturar, aprobar, modificar o pagar.
   - Operating Config: políticas particulares del grupo: tolerancias, targets, límites, autorizaciones, etc.
   - Audit Trail: quién cambió qué, cuándo y por qué.
   Pulso ya tiene multi-tenancy, companies, branches, roles/permisos y configuración operacional; lo que debe reforzarse es el audit trail unificado y seguridad a nivel DB.    
2. Centro de Control del Grupo
   - Group Dashboard: situación de las sucursalesdel grupo 
   - Store Health: score operativo/financiero de cada unidad.
   - Critical Issues: problemas que requieren atención inmediata.
   - Open Actions: pendientes, responsables y fechas límite.
   - Daily Brief: resumen diario para director/owner.
   - Comparador de sucursales: best/worst store, tendencias y desviaciones.
   La auditoría ya encontró P&L, cross-branch, morning brief y executive/twin parcialmente cableados; el principal problema actual es hacer confiables Exceptions y Cash.    
3. Workflows y ejecución operativa
   - Workflow Builder: crear procesos operativos.
   - Rutinas recurrentes: apertura, cierre, limpieza, temperaturas, recepción, etc.
   - Assignments: asignar responsabilidades.
   - Schedules: decidir cuándo debe ejecutarse cada proceso.
   - Task Execution: ejecución diaria.
   - Completion Events: registrar que algo realmente terminó.
   - Workflow Effects: convertir la ejecución en movimientos reales de inventario, recepción, producción, etc.
   Éste es uno de los activos más maduros de Pulso: templates, instances, assignments, schedules y completion→business effects están productivamente cableados. 
4. Evidencia y verificación
   - Fotos
   - Documentos
   - Tickets
   - Temperaturas
   - Texto/checklists
   - AI Verification
   - Human Review
   - Historial de evidencia
   El cierre de Pulso debe convertir esto en una primitive Evidence común para que pueda usarse no sólo en workflows, sino también en gastos, facturas, pagos, incidencias y aprobaciones. Hoy la evidencia está todavía muy ligada al workflow.    
5. Excepciones, incidentes y acciones correctivas
   - Exception Engine: cualquier cosa fuera de rango.
   - Incidents: problemas operativos.
   - Severity: normal/watch/action/critical o equivalente.
   - Owner: quién debe resolver.
   - SLA: cuándo debe quedar resuelto.
   - Escalation: subirlo a supervisor/director.
   - Remediation: acción correctiva.
   - Verification: comprobar que realmente se resolvió.
   - Closure / Reopen: cerrar o volver a abrir.
   Debe servir exactamente igual para:
temperatura incorrecta
merma alta
factura con diferencia
gasto fuera de presupuesto
falta de empleado
equipo averiado
pago sin conciliar

   Incidents y remediation ya existen; lo que falta es una Exception canónica con lifecycle.    
6. Operación diaria de sucursal
   - Apertura
   - Cierre
   - Cambio de turno
   - Rutinas de cocina
   - Rutinas de salón/counter
   - Limpieza
   - Sanitización
   - Disponibilidad de producto
   - Verificación de equipo
   - Delivery online/offline
   - Checklist gerente
   - Shift handoff
   Aquí Pulso funciona como el “manual vivo” de cada sucursal: qué debe pasar, cuándo, quién lo ejecuta y qué evidencia demuestra que ocurrió.
7. Food Safety, calidad y cumplimiento
   - Temperaturas: cámaras, congeladores, recepción, producto.
   - Cadena de frío
   - FIFO/FEFO
   - Aceite
   - Sanitización
   - Limpieza
   - Plagas
   - Auditorías
   - NOM / compliance
   - Planes correctivos
   - Historial de cumplimiento
   Food safety por temperatura y compliance ya aparecen implementados parcialmente en Pulso.    
8. Equipos y mantenimiento
   - Equipment Catalog: freidoras, refrigeradores, congeladores, A/C, etc.
   - Equipo por sucursal
   - Preventive Maintenance
   - Corrective Maintenance
   - Maintenance History
   - Warranties
   - Downtime
   - Maintenance Cost
   - Alerts
   - Tickets / órdenes
   - Vendor de mantenimiento
   El sistema debe permitir eventualmente responder:
¿qué equipos fallan más?
¿cuánto nos cuestan?
¿qué mantenimiento está vencido?
¿conviene reparar o reemplazar?

   Mantenimiento existe parcialmente; el gap principal señalado es que los schedules de mantenimiento aún no tienen writer productivo completo.   
9. People / Workforce
   - Employee Master: expediente del empleado.
   - Contratos
   - Sucursal/puesto
   - Shift Templates
   - Schedule Builder
   - Clock-in / Clock-out
   - Attendance
   - Breaks
   - Overtime
   - Faltas
   - Vacaciones/permisos
   - Shift Approvals
   - Propinas
   - Performance Reviews
   - Training / certifications
   - Incidencias laborales
   Gran parte está ya productiva: empleados, schedules, attendance, time entries, breaks, propinas y performance. El gap importante es conectar correctamente overtime/ausencias con nómina.    
10. Nómina
    - Pre-nómina
    - Horas programadas vs trabajadas
    - Horas extra
    - Faltas
    - Vacaciones
    - Bonos
    - Deducciones
    - Aprobación del gerente
    - Payroll Run
    - Payslips
    - CFDI Nómina
    - Timbrado
    - Costo laboral por sucursal
    - Pago vía tesorería
   No necesitas construir un sistema fiscal desde cero: Pulso ya genera/timbra CFDI. El gap es que la pre-nómina actual no consume correctamente la asistencia real.   
11. Catálogo, recetas y food cost
    - Ingredientes / SKUs
    - Unidades de medida
    - Recipes / BOM
    - Subrecipes
    - Recipe Versions
    - Portion Standards
    - Yield
    - Recipe Cost
    - Simulación de costo
    - Menu Item → Recipe
    - Theoretical Consumption
    - Actual Food Cost
    - Theoretical Food Cost
    - Variance
   Recipes, versionado y costeo ya están fuertes. El encadenamiento venta→receta→consumo teórico necesita cerrarse E2E.    
12. Producción de alimentos
    - Prep List
    - Production Orders
    - Production Run
    - Ingredientes consumidos
    - Cantidad producida
    - Yield
    - Waste
    - Hold Time
    - Batch/lot traceability
    - Producción sugerida
    - Producción real
    - Desviación
   Aquí el trabajo no es agregar features sino consolidar: hoy existe un modelo productivo production_orders/results/ingredients y otro modelo nuevo sin uso.    
13. Inventarios
    - Stock por sucursal
    - Lotes
    - Caducidades
    - FEFO
    - Inventory Movements
    - Stock Counts
    - Adjustments
    - Waste / Merma
    - Transfers entre sucursales
    - PAR / min-max
    - High-value items
    - Average Cost / Last Cost
    - Inventory Snapshots
    - Variance
    - Suggested Orders
   Ésta es otra de las áreas fuertes: lotes, FEFO, movimientos, conteos, merma, PAR y costing ya están productivos.    14. Compras y proveedores
    - Supplier Master
    - Productos por proveedor
    - RFC
    - Términos de pago
    - Cuentas bancarias verificadas
    - Price History
    - Purchase Requisition
    - Approval
    - Purchase Order
    - Purchase Delegation
    - Suggested Purchase
    - Supplier Scorecard
    - Supplier Claims
   Suppliers, POs y recepción están entre las partes más completas de Pulso.    
15. Recepción de mercancía
    - PO esperado
    - Cantidad recibida
    - Precio
    - Temperatura
    - Lote
    - Caducidad
    - Evidencia
    - Discrepancias
    - Aceptación/rechazo
    - Claims
    - Inventory Entry
   Este módulo es la unión entre:
COMPRAS
   ↓
RECEPCIÓN
   ↓
INVENTARIO
   ↓
FACTURA

   Goods receipt y temperatura de recepción ya están cableados.    
16. Administración y cuentas por pagar
    - Vendor Invoices
    - CFDI XML/PDF
    - SAT Inbox
    - Invoice Lines
    - PO Match
    - Receiving Match
    - 3-Way Match
    - Price Variance
    - Quantity Variance
    - Invoice Exception
    - Accounts Payable Aging
    - Due Dates
    - Approval Chain
    - Expense Management
    - Expense Evidence
    - Petty Cash
    - Recurring Expenses
    - Cost Centers
   CFDI, 3-way match, gastos y caja chica ya existen. El trabajo de cierre es unificar approvals, relacionar centros de costo y reconectar CxP con pagos.    
17. Finanzas, tesorería y control económico
    - Accounts Payable
    - Payees
    - Payment Requests
    - Payment Runs
    - Payment Approvals
    - Bank Layout / dispersión
    - Settlement
    - Recurring Contracts
    - Budgets
    - Financial Periods
    - Cash Flow
    - Company Bank Accounts
    - Bank Transactions
    - Bank Reconciliation
    - Revenue Reconciliation
    - Channel Commissions
    - Store P&L
    - Labor Cost
    - Food Cost
    - Prime Cost
    - Contribution
    - Unit Economics
   Aquí está el principal cierre pendiente. Payment runs, settlement, budgets, P&L y cash-flow ya existen; no existen todavía las cuentas bancarias propias, movimientos bancarios ni conciliación banco↔pago.    0
Y además hay una capa transversal: ventas y canales
No construiría un POS dentro de Pulso.
Pulso debe recibir y reconciliar la información del POS/canales:
POS
Uber Eats
Rappi
DiDi
otros canales
       ↓
    PULSO

Y manejar:
Ventas por sucursal
Ticket
Mix
Cortes
Comisiones
Settlements
Depósitos
Diferencias

La auditoría ya encontró conciliación parcial del lado de ingresos mediante gateway_transactions, terminales, TPV batches, settlements de agregadores y comisiones.    
Entonces la arquitectura completa queda así
                         PULSO  OS
                              │
 ┌────────────────────────────┼─────────────────────────────┐
 │                            │                             │
 │                       CONTROL TOWER                     │
 │                            │                             │
 │            KPIs · Exceptions · Actions · Brief          │
 │                                                          │
 ├── 01 Organización & Configuración                       │
 ├── 02 Usuarios / Roles / Seguridad                       │
 ├── 03 Workflows & Tasks                                  │
 ├── 04 Evidence & Verification                            │
 ├── 05 Exceptions / Incidents / SLA                       │
 ├── 06 Store Operations                                   │
 ├── 07 Food Safety & Compliance                           │
 ├── 08 Equipment & Maintenance                            │
 ├── 09 Workforce                                          │
 ├── 10 Payroll                                            │
 ├── 11 Recipes & Food Cost                                │
 ├── 12 Production                                         │
 ├── 13 Inventory                                          │
 ├── 14 Procurement & Suppliers                            │
 ├── 15 Receiving                                          │
 ├── 16 Administration / CFDI / AP / Expenses              │
 └── 17 Finance / Treasury / Banking / P&L                 │
                                                             
        POS / Delivery / Banks / SAT / WhatsApp
                         │
                    INTEGRATIONS

Y eso se refleja en cinco grandes departamentos reales del grupo:
DIRECCIÓN
    ↓
OPERACIONES
    ↓
PEOPLE
    ↓
ADMINISTRACIÓN / FINANZAS
    ↓
SUPPLY CHAIN

y luego el grupo resturantero de 3 a 15 sucursales 
Qué ve cada persona
Owner/Director: ventas, P&L, cash, CxP, contribution, food/labor cost, sucursales problemáticas y excepciones críticas.
Director de Operaciones: ejecución, food safety, inventarios, producción, merma, mantenimiento, incidentes y desempeño de sucursales.
Supervisor: excepciones, auditorías, acciones pendientes, sucursales que debe visitar y SLAs.
Gerente de sucursal: turno, empleados, producción, inventario, recepción, gastos, mantenimiento y pendientes.
Administración/Finanzas: facturas, CFDI, CxP, gastos, presupuestos, pagos, tesorería, conciliación y P&L.
Compras: necesidades, requisiciones, POs, proveedores, precios, recepción y claims.
RH/Nómina: empleados, horarios, asistencia, overtime, incidencias, pre-nómina y nómina.
Colaborador: solamente sus tareas, instrucciones y evidencias.