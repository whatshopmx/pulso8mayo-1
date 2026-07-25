# Tareas Pendientes: Sistema de Inventario y Compras

## Estado General
Módulos base de productos, proveedores, recetas, conteos y mermas completados. Pendiente implementar facturas persistentes, 3-way match, recepción manual de transferencias y carga masiva de ventas.

---

## Fase 1: Persistencia de Facturas (CFDI) y Conciliación de 3 Vías
- [ ] **Task 1** — DB Schema: Crear tablas `invoices`, `invoiceLines` y `creditNotes` en [schema.ts](file:///c:/Users/david/pulso29/lib/db/schema.ts)
- [ ] **Task 2** — API Upload: Guardar facturas cargadas en la DB y validar UUID único
- [ ] **Task 3** — Matcher Service: Integrar `InvoiceMatchingService` para disparar el match al subir XML
- [ ] **Task 4** — Match UI: Interfaz de Facturas y Dashboard del 3-way match en [invoices/page.tsx](file:///c:/Users/david/pulso29/app/dashboard/inventory/invoices/page.tsx)

### Checkpoint: Fase 1
- [ ] La aplicación compila con `pnpm run build`
- [ ] XML subido se guarda en base de datos con estatus de match vs PO/Recepción
- [ ] Las discrepancias de precio o cantidad se muestran visualmente en el historial

---

## Fase 2: Recepción de Transferencias y Ajustes de UI
- [ ] **Task 5** — Recepción manual de transferencias: Permitir ingresar cantidad real y fotos al recibir en [transfer-list.tsx](file:///c:/Users/david/pulso29/components/inventory/transfer-list.tsx)
- [ ] **Task 6** — Validación en backend: Impedir recibir > enviado sin permiso, e insertar merma de tránsito en el ledger
- [ ] **Task 7** — Corrección de nombres: Reemplazar UUIDs por nombres/SKUs de insumos en el modal de transferencias

### Checkpoint: Fase 2
- [ ] Se pueden reportar diferencias de cantidad al recibir transferencias y se descuentan correctamente
- [ ] La UI muestra los nombres legibles de los productos transferidos

---

## Fase 3: Carga de Ventas y Alertas de Costos
- [ ] **Task 8** — Importación de ventas en CSV/Excel: Agregar subida de archivos en [reports/page.tsx](file:///c:/Users/david/pulso29/app/dashboard/inventory/reports/page.tsx)
- [ ] **Task 9** — FIFO Desconsolidación: Procesar las ventas del CSV para restar ingredientes del inventario automáticamente
- [ ] **Task 10** — Alertas de incremento de precios: Alerta de aumento > X% vs promedio histórico (30/60/90 días)

### Checkpoint: Fase 3
- [ ] Se sube un CSV de ventas y se descuentan las recetas involucradas
- [ ] Las alertas de costos de proveedores se muestran en la pantalla de alertas del dashboard

---

## Fase 4: Documentos y Operación Plus
- [x] **Task 11** — PDF y WhatsApp: Exportación a PDF de POs y link de WhatsApp para compartir
- [x] **Task 12** — Reclamo a Proveedor: Exportar PDF de discrepancias detectadas en recepción física
- [x] **Task 13** — Conteo Ciego: Ajuste para ocultar las existencias del sistema durante un conteo físico
- [x] **Task 14** — Consumo Interno: Registro de salidas de inventario por consumo de staff

---

## Verificación Final
- [ ] `pnpm run build` compila sin errores
- [ ] `pnpm run lint` pasa sin advertencias
- [ ] Flujo end-to-end de compras a facturación verificado

