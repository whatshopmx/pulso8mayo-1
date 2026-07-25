# Plan de Implementación: Completar Módulo de Inventario y Compras (Brechas del PRD)

## Overview

Este plan detalla los pasos para cerrar la brecha entre la especificación en [inventory.md](file:///c:/Users/david/pulso29/inventory.md) y el código actual. El sistema ya cuenta con la base de productos, proveedores, órdenes de compra, mermas, recetas y varianzas, pero carece de persistencia de facturas (CFDI), conciliación automática de 3 vías (3-way match), control detallado al recibir transferencias, y carga masiva de ventas.

## Decisiones de Arquitectura

- **Base de Datos:** Agregar tablas de Drizzle en [schema.ts](file:///c:/Users/david/pulso29/lib/db/schema.ts) para `invoices`, `invoiceLines`, y `creditNotes`.
- **Servicios:** Integrar el servicio existente `InvoiceMatchingService` con la base de datos y endpoints de API.
- **Interfaz de Usuario:** Modificar componentes de diálogo existentes para capturar cantidades reales e incluir links de compartición.
- **Lógica de Ajustes:** Integrar las mermas de transferencias e ingresos por ventas CSV al ledger de movimientos FIFO.

---

## Lista de Tareas (Task List)

### Fase 1: Persistencia de Facturas (CFDI) y Conciliación de 3 Vías (Prioridad Alta)
*   **Task 1: Esquema de base de datos para Facturas y Notas de Crédito**
    *   Definir tablas `invoices`, `invoiceLines` y `creditNotes` en Drizzle para persistir los CFDI XML parseados.
*   **Task 2: Guardado de Facturas y validación de UUID único**
    *   Modificar el endpoint `/api/inventory/invoices/upload` para persistir la factura y validar duplicidad de UUID.
*   **Task 3: Servicio de Conciliación de 3 Vías (3-Way Match)**
    *   Llamar a `InvoiceMatchingService.perform3WayMatch` al recibir una factura, registrando el estatus de discrepancia y actualizando el historial de costos.
*   **Task 4: Interfaz de Facturas y Dashboard de Match**
    *   Actualizar [invoices/page.tsx](file:///c:/Users/david/pulso29/app/dashboard/inventory/invoices/page.tsx) para listar facturas anteriores, mostrar estatus de coincidencia y ver diferencias contra la PO y la Recepción física.

### Fase 2: Recepción Detallada de Transferencias y Ajustes de UI (Prioridad Media)
*   **Task 5: Recepción interactiva de transferencias**
    *   Actualizar [transfer-list.tsx](file:///c:/Users/david/pulso29/components/inventory/transfer-list.tsx) para que el destinatario capture la cantidad real recibida, notas y fotos en caso de mermas.
    *   Agregar validación en el backend (`receiveTransfer` en [inventory-service.ts](file:///c:/Users/david/pulso29/lib/services/inventory-service.ts)) para bloquear la recepción de cantidades superiores a las enviadas (FR-62) e insertar la merma de transporte en el ledger.
*   **Task 6: Corrección de nombres de productos en Transferencias**
    *   Modificar la consulta del detalle de transferencias en la UI para mostrar el nombre y SKU del insumo en lugar de su UUID.

### Fase 3: Carga Masiva de Ventas y Alertas de Precios (Prioridad Media)
*   **Task 7: Importador CSV/Excel de Ventas Diarias**
    *   Agregar un botón y diálogo de subida de CSV en [reports/page.tsx](file:///c:/Users/david/pulso29/app/dashboard/inventory/reports/page.tsx) para procesar múltiples platillos y realizar la desconsolidación de ingredientes en masa.
*   **Task 8: Alertas de Aumento de Precios de Proveedores**
    *   Agregar lógica en `StockAlertService` para comparar el costo unitario nuevo contra el promedio móvil histórico de 30/60/90 días (FR-22) y mostrar la alerta en la pantalla principal.

### Fase 4: Documentos de Salida y Operación Plus (Prioridad Baja)
*   **Task 9: PDF de Orden de Compra y Compartir por WhatsApp**
    *   Crear ruta API para exportar un PDF limpio de la PO y agregar un botón para compartir el enlace o archivo directamente en WhatsApp.
*   **Task 10: Generador de "Reclamo a Proveedor"**
    *   Generar un formato de reclamo exportable con el desglose de discrepancias (faltantes, piezas dañadas) registradas durante la recepción de mercancía.
*   **Task 11: Conteo Ciego y Consumo de Personal**
    *   Implementar una opción para ocultar el stock del sistema en el conteo físico, y habilitar un flujo de "Consumo de Personal" en el módulo de mermas.

---

## Puntos de Control (Checkpoints)

### Checkpoint 1: Después de Fase 1
- [ ] La aplicación compila correctamente (`pnpm run build`).
- [ ] Las facturas se guardan en la base de datos y se muestra el estatus del 3-way match.
- [ ] Las diferencias de precio/cantidad quedan guardadas para auditoría.

### Checkpoint 2: Después de Fase 2 & 3
- [ ] Se pueden recibir transferencias con cantidad parcial y se registra la merma de transporte.
- [ ] La carga de ventas mediante archivo CSV descuenta correctamente los insumos mediante FIFO.
- [ ] Se disparan alertas si un proveedor sube sus costos más del porcentaje establecido.

---

## Riesgos y Mitigaciones

| Riesgo | Impacto | Mitigación |
| :--- | :---: | :--- |
| Discrepancias en formatos de CSV de venta | Medio | Definir una plantilla clara de descarga con validación de columnas antes de procesar el archivo. |
| Fórmulas de promedio móvil lentas en DB | Bajo | Almacenar costos consolidados o indexar correctamente la tabla `inventory_price_history`. |
| Múltiples mermas al recibir transferencias | Bajo | Registrar automáticamente la merma de tránsito en la sucursal de destino o en una cuenta de pérdida global. |
