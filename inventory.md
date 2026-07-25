# PRD — Sistema de Gestión de Inventario y Compras (sin integración directa a POS)  
**Target:** Grupos QSR (3–15 sucursales) en Monterrey, MX (pizza, burgers, sushi)  
**Versión:** v1 (MVP + roadmap)  
**Objetivo comercial:** Reducir fugas y variación de costos mediante control de compras/recepción, disciplina de inventarios y costeo de recetas; sin depender de POS.

---

## 1) Resumen del producto
Sistema back-office para **compras, recepción, inventarios físicos/cíclicos, transferencias, mermas y costeo de recetas** con enfoque multi-sucursal.  
No busca “decrementar inventario por venta en tiempo real”; en su lugar, habilita el control con el método financiero-operativo:

**Inventario Inicial + Compras – Inventario Final = Consumo (Costo real)**  
y, opcionalmente, una capa ligera de ventas (CSV/OCR/captura) para aproximar teórico.

---

## 2) Problema a resolver (Jobs-to-be-done)
1) **Pagos incorrectos a proveedores:** cobran más caro, facturan cantidades distintas, entregas incompletas.  
2) **Fugas en almacén/cocina:** ajustes sin evidencia, mermas no registradas, transferencias “fantasma”.  
3) **Falta de estandarización:** recetas y rendimientos inconsistentes por sucursal.  
4) **Ceguera ante inflación de insumos:** no se detectan aumentos rápido → margen se erosiona.

---

## 3) Objetivos (Outcomes medibles)
- Reducir discrepancias en recepción (cantidad/precio) en **30–60%** en 90 días.
- Reducir ajustes manuales sin justificación en **>50%**.
- Disminuir variaciones de inventario (conteo vs libro) por sucursal en **10–25%**.
- Tener costeo actualizado de menú (por últimas compras) en **<24h** tras nuevo CFDI/factura.
- Centralizar historial de precios y generar alertas de aumentos **en el día**.

---

## 4) No-objetivos (lo que se EXCLUYE)
**Excluido del MVP / producto base (por definición “sin POS”):**
- Integración API bidireccional en tiempo real con POS (ventas por ticket, modifiers, voids).
- Descuento automático perpetuo por cada ítem vendido.
- Planeación avanzada de demanda (forecast ML), programación de producción compleja.
- Nómina, RRHH, scheduling de personal.
- Facturación al cliente final (emisión CFDI de venta).
- MRP industrial; control de manufactura avanzado.

**Puede existir como add-on futuro:** conectores POS, predicción avanzada, BI warehouse, etc.

---

## 5) Alcance (qué SÍ incluye)
### Alcance MVP (recomendado para vender e implementar rápido)
1) Catálogo (insumos/UOM/proveedores)  
2) Compras (requisiciones/PO/aprobaciones)  
3) Recepción contra PO + discrepancias + evidencia  
4) Facturas + **CFDI XML/PDF** + validación básica + historial de precios  
5) Inventarios: movimientos + transferencias + conteos cíclicos  
6) Mermas + consumo interno  
7) Recetas/BOM + rendimientos + costeo de menú  
8) Reportes multi-sucursal + auditoría

### Alcance “Plus” (post-MVP)
- OCR de corte Z (foto → ventas) y/o parser de reportes
- Módulo de comisariato/CEDIS (producción por lotes + rutas)
- 3-way match más robusto (PO–recepción–factura con tolerancias)
- Exportación contable avanzada (polizas por centro de costo)

---

## 6) Usuarios y permisos (Personas)
- **Dueño/Director:** ve KPIs, alertas de precio, variaciones por sucursal.
- **Compras corporativo:** crea POs, consolida demanda, gestiona proveedores.
- **Gerente de sucursal:** solicita, recibe, autoriza conteos, registra mermas.
- **Almacenista/Receiver:** recepción, evidencia, etiquetas, devoluciones.
- **Auditor interno/Finanzas:** revisa discrepancias, ajustes, valuación, reportes.
- **Administrador sistema:** catálogos, UOM, permisos, configuración.

Permisos por rol con: crear/editar PO, aprobar, recibir, ajustar inventario, editar costos, ver márgenes.

---

## 7) Mapa de módulos (incluye/excluye)
| Módulo | Incluido MVP | Propósito | Dependencias |
|---|---:|---|---|
| Multi-sucursal + roles + bitácora | Sí | Base operativa y auditoría | Ninguna |
| Catálogo de insumos + UOM/Conversiones | Sí | Datos maestros confiables | Ninguna |
| Proveedores + listas de precio | Sí | Control de costos por proveedor | Catálogo |
| Compras (Requisición → PO → Aprobación) | Sí | Control de gasto y orden | Proveedores |
| Recepción contra PO + discrepancias | Sí | Evitar pagar de más | Compras |
| Evidencia (fotos, firma, documentos) | Sí | Soporte a reclamos | Recepción |
| Facturas + CFDI XML/PDF (captura/validación) | Sí | Control fiscal-operativo, precios | Proveedores |
| Devoluciones / notas de crédito (tracking) | Sí (básico) | Cerrar discrepancias | Recepción/CFDI |
| Inventario (ledger) | Sí | Control de existencias | Recepción/Transfer |
| Transferencias sucursal–sucursal | Sí | Logística interna controlada | Inventario |
| Conteos cíclicos y cierres | Sí | Disciplina y variaciones | Inventario |
| Mermas/consumo interno | Sí | Visibilidad de fugas | Inventario |
| Recetas/BOM + rendimientos | Sí | Estandarizar y costear | Catálogo |
| Costeo de menú + simulador margen | Sí | Decisiones de precio | Recetas + precios |
| Carga ventas “ligera” (CSV/manual) | Opcional MVP | Aproximar teórico vs real | Recetas |
| OCR corte Z | No (Plus) | Automatizar carga ventas | Ventas ligera |
| Integración contable (export CSV) | Sí (básico) | Cierre financiero | Facturas/Compras |
| Integración POS API | No | Fuera de estrategia | — |

---

## 8) Requerimientos funcionales por módulo (MVP)

### 8.1 Multi-sucursal, roles y auditoría
**FR-1:** Crear organización → marcas → sucursales → áreas de almacén (seco/cámara/congelador/línea).  
**FR-2:** Roles con permisos granulares (ver/editar/aprobar).  
**FR-3:** Bitácora completa (quién, qué, cuándo) para PO, recepción, ajustes, conteos, recetas, costos.  
**FR-4:** Soporte multi-moneda opcional (MXN base) y multi-IVA (campos para reporteo).

### 8.2 Catálogo de insumos + UOM
**FR-10:** Alta de insumos con: categoría, unidad base, conversiones (caja→pieza→gramo), foto opcional.  
**FR-11:** Múltiples presentaciones por proveedor (ej. “Mozzarella 10kg”, “Mozzarella 2kg”).  
**FR-12:** Configurar por sucursal: par mínimo/máximo (opcional MVP), frecuencia de conteo, área default.

### 8.3 Proveedores + precios
**FR-20:** Alta de proveedor: contactos, días de entrega, mínimos, términos.  
**FR-21:** Historial de “último precio pagado” por insumo/proveedor/sucursal.  
**FR-22:** Alertas: aumento > X% vs promedio 30/60/90 días.

### 8.4 Compras: requisiciones, PO y aprobaciones
**FR-30:** Requisición por sucursal (lista de insumos + cantidades + fecha requerida).  
**FR-31:** Generación de PO desde requisiciones o manual.  
**FR-32:** Flujo de aprobación por monto/categoría/sucursal.  
**FR-33:** Estados: Borrador → En aprobación → Aprobada → Enviada → Parcialmente recibida → Cerrada/Cancelada.  
**FR-34:** Envío de PO por correo/WhatsApp share (PDF).

### 8.5 Recepción contra PO + discrepancias + evidencia
**FR-40:** Recepción móvil/tablet: seleccionar PO, capturar recibido, faltantes, sustituciones.  
**FR-41:** Discrepancias por: cantidad, precio, producto distinto, calidad.  
**FR-42:** Evidencia: foto de entrega, foto de factura, firma receptor y opcional proveedor.  
**FR-43:** Generar “reclamo a proveedor” (documento con diferencias).  
**FR-44:** Entrada automática al inventario por cantidades recibidas (por área default o seleccionable).

### 8.6 Facturas + CFDI XML/PDF (México)
**FR-50:** Cargar CFDI XML y PDF (drag&drop o correo dedicado).  
**FR-51:** Parsear XML: emisor, receptor, UUID, fecha, conceptos, cantidades, precios, impuestos.  
**FR-52:** Validación básica: estructura, UUID único, RFC emisor/receptor, estatus (si se implementa consulta) *opcional según complejidad*.  
**FR-53:** Match factura ↔ recepción/PO:  
- Por proveedor + fecha + conceptos (con tolerancias configurables)  
- Identificar diferencias de precio/cantidad vs recibido  
**FR-54:** Registrar notas de crédito (manual o carga CFDI si aplica) para cerrar discrepancias.

> Nota PRD: el sistema **no emite CFDI**; solo captura/valida/conciliación operativa.

### 8.7 Inventario (ledger) + transferencias
**FR-60:** Kardex por insumo/sucursal/área con tipos de movimiento: recepción, transferencia envío, transferencia recepción, merma, consumo interno, ajuste, conteo.  
**FR-61:** Transferencia flujo: Crear → Aprobar (opcional) → Enviar (sale de origen) → En tránsito → Recibir (entra a destino).  
**FR-62:** Bloqueos: no permitir recibir > enviado sin autorización; bitácora.

### 8.8 Conteos cíclicos y cierre
**FR-70:** Plantillas de conteo por área (orden recomendado).  
**FR-71:** Conteo ciego (no mostrar “sistema” al contador) configurable.  
**FR-72:** Reconteo si variación > umbral.  
**FR-73:** Cierre de inventario semanal/mensual con reporte de variaciones por insumo y por sucursal.  
**FR-74:** Ajustes generados por conteo quedan auditados y requieren motivo.

### 8.9 Mermas y consumo interno
**FR-80:** Registrar merma: insumo, cantidad, motivo (caducidad, error preparación, daño, devolución cliente, etc.), evidencia opcional.  
**FR-81:** Consumo interno/staff meal: salida controlada con motivo y responsable.  
**FR-82:** Reporte de mermas por sucursal/categoría/turno (si capturan hora).

### 8.10 Recetas/BOM + rendimientos + costeo de menú
**FR-90:** Receta: lista de insumos con cantidades en unidad base + merma esperada/yield.  
**FR-91:** Sub-recetas (salsa, arroz, masa) y rendimiento por batch.  
**FR-92:** Costeo automático con: último precio pagado / promedio móvil (config).  
**FR-93:** “Simulador”: si insumo sube X%, impacto en costo del platillo y food cost vs precio de venta (precio manual).  
**FR-94:** Versionado de recetas (histórico) y aprobación corporativa.

---

## 9) “Ventas sin POS” (módulo opcional MVP)
**Objetivo:** acercarse a “teórico vs real” sin integración.

### Métodos soportados
- **CSV/Excel upload** (plantilla definida por cliente): ventas por SKU de menú o por categoría (p.ej. pizzas 12”, 14”, burgers, rolls).  
- **Captura manual**: pantalla de “corte diario” por sucursal.  
- **(Plus)** OCR foto de corte Z.

### Requerimientos
**FR-100:** Importador con mapeo a “items de menú” internos.  
**FR-101:** Reporte: consumo teórico estimado (recetas × ventas) vs consumo real (inventario).  
**FR-102:** Advertencias por calidad de datos (días sin ventas cargadas).

---

## 10) Reportes (MVP)
### Operación/Compras
- Compras por proveedor/sucursal/periodo
- Discrepancias recepción: top proveedores, top insumos, $ impacto
- Historial de precio + alertas por aumentos
- Backorders/pendientes por PO

### Inventario/Auditoría
- Valuación de inventario por sucursal y área
- Variaciones por conteo (top 20) y tendencia
- Transferencias: en tránsito, diferencias origen vs destino
- Mermas: por motivo/categoría/sucursal

### Costeo/Margen
- Costo actual por platillo (según últimas compras)
- Impacto por incremento de insumo
- Food cost estimado (si capturan ventas) por sucursal

Exportables: CSV/Excel/PDF; programación por correo.

---

## 11) Requerimientos no funcionales (NFR)
- **Mobile-first** para recepción y conteos (Android/iPad web app).  
- **Offline tolerante** (cache y sync) deseable para conteos/recepción.  
- **Seguridad:** 2FA opcional, cifrado en tránsito, control por rol, logs inmutables.  
- **Rendimiento:** reportes <5s para 15 sucursales / 5k movimientos diarios (referencia).  
- **Disponibilidad:** 99.5% mensual (MVP).  
- **Trazabilidad:** ninguna edición crítica sin registro.

---

## 12) Flujos clave (end-to-end)

### Flujo A: Compra → Recepción → Factura (CFDI) → Cierre de discrepancias
1) Sucursal crea requisición → compras crea PO → aprobación → envío a proveedor  
2) Receiver recibe contra PO (captura faltantes/sustituciones + evidencia)  
3) Se actualiza inventario (entrada)  
4) Se carga CFDI XML/PDF → sistema concilia vs PO/recepción  
5) Si hay diferencias → se genera reclamo / nota de crédito esperada

### Flujo B: Conteo cíclico → variación → acciones
1) Auditor asigna conteo por área → conteo ciego → reconteo si aplica  
2) Sistema calcula variación y genera ajuste auditado  
3) Reporte compara variaciones por sucursal → acciones (capacitaciones, controles)

### Flujo C: Transferencia
1) Origen crea transferencia → envía → queda “en tránsito”  
2) Destino recibe (puede reportar diferencias)  
3) Kardex completo + firma/evidencia

---

## 13) Datos (modelo conceptual mínimo)
- Organization, Brand, Location, StorageArea  
- User, Role, Permission  
- Item, UOM, Conversion, ItemVendorPack  
- Vendor, PriceHistory  
- Requisition, PurchaseOrder, POItem, Approval  
- Receipt, ReceiptItem, Discrepancy, EvidenceAttachment  
- Invoice (CFDI), InvoiceLine, CreditNote  
- InventoryLedgerEntry, CountSession, CountLine, Adjustment  
- Transfer, TransferLine  
- WasteEntry  
- Recipe, RecipeLine, SubRecipe, Yield  
- (Opcional) DailySales, MenuItem

---

## 14) Métricas de éxito (telemetría)
- % POs recibidas con discrepancia
- $ recuperado por notas de crédito/reclamos
- # ajustes manuales / sucursal / semana
- Variación absoluta de inventario (MXN) por cierre
- Tiempo promedio de recepción (min) y de cierre de conteo
- Adopción: % días con recepciones registradas vs entregas reales

---

## 15) Riesgos y mitigaciones
- **Datos maestros malos (UOM/Conversiones):** incluir asistente de configuración + validaciones + “bloqueo de edición” con aprobaciones.  
- **Resistencia operativa (conteos/recepción):** UX móvil simple + evidencias + KPIs por gerente.  
- **Proveedores con CFDI inconsistente:** tolerancias + reglas por proveedor + carga manual fallback.  
- **Sin POS, “teórico” limitado:** vender explícitamente el enfoque de control por compras/recepción/conteos + ventas ligera opcional.

---

## 16) Roadmap sugerido
**MVP (12–16 semanas):** módulos 1–8 + reportes base + export contable simple.  
**Plus (8–12 semanas):** ventas ligera robusta + OCR + comisariato básico + 3-way match avanzado.  
**Futuro:** conectores POS, BI, forecasting, automatización de pagos.

---

Si quieres, lo convierto a un PRD “listo para desarrollo” con: **user stories + criterios de aceptación + pantallas (wireframe checklist) + prioridades MoSCoW**, pero necesito 3 decisiones:  
1) ¿Habrá **comisariato/CEDIS** desde el inicio? (sí/no)  
2) ¿Los clientes usan **CFDI** de todos los proveedores siempre, o también tickets/remisiones sin XML?  
3) ¿Quieres que el MVP sea **web responsive** o **app móvil** (con offline real) desde el día 1?