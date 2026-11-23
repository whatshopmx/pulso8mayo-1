# `INV-01.d` — aceptación API/UI de corrección, repetición y anulación de ventas

2026-11-22. Base `43428b1c4ea8bb0543014014301eb05d76b7c675`, build de producción `BUILD_ID: 3uHsQamaXwpx8-UdKZkBZ`.

**Registro aceptado en entorno aislado:** **`INV-01.d`** (V3; dependencia `INV-01.c` aceptada).

## Criterios acreditados (13/13 recorridos reales Next + Chromium + Better Auth + Neon + R2)

1. **Captura manual y CSV (`INV-01.b4.manual.next`, `INV-01.b4.ui.next`, 4/4):** alta, repetición sin movimiento adicional, correcciones `10→12→8`, completado de ingreso `NULL→8025` sin mover stock, anulación `→0` con devolución completa, error visible `409` por insuficiencia sin efectos y recuperación, grupos CSV inválidos con errores por fila sin subtotales parciales, y cierre de sesión `401`. Evidencia: [INV-01.b4.next-copy](../INV-01.b4.next-copy/README.md).
2. **POS del cierre y almacenamiento privado (`INV-01.b4.storage`, `INV-01.b4.smartlink.next`, `INV-01.b4.smartlink.ui`, 4/4):** ambos ejecutores (`WorkflowStepper` y `WorkflowExecutor`) con `POS_FILES_RUNTIME_DATABASE_URL` y `SALES_RUNTIME_DATABASE_URL` en LOGIN mínimo, instalación/edición `Ctrl+S` desde Catálogo Pulso, lectura firmada R2, identidad compartida con bulk y rechazo `503` de configuración dueña sin fallback ni efectos. Evidencia: [INV-01.b4.storage/accepted.md](../INV-01.b4.storage/accepted.md).
3. **Cobertura financiera y alcance de rol/empresa (`INV-01.b4.coverage`, 4/4):** COGS, ingeniería de menú y reporte ejecutivo muestran cobertura parcial/vacía, rechazan consulta de otra empresa, impiden escritura a `SUPERVISOR` (sin `inventory:manage`) y ocultan datos tras `sign-out`. Evidencia: [INV-01.b4.coverage/accepted.md](../INV-01.b4.coverage/accepted.md).
4. **Recuperación histórica con segregación de funciones y `AUD-02` (`INV-01.c.recovery.ui-routes`, 1/1):** carga y atestación real SHA-256 en R2, alta de expediente en UI sin autoaprobación, aprobación y aplicación por revisor independiente con oráculos SQL, reintento idempotente y `sign-out` `401`. Evidencia: [INV-01.c.recovery.ui-routes/accepted.md](../INV-01.c.recovery.ui-routes/accepted.md).

## Límites explícitos

- No se aplicaron migraciones al entorno operativo ni a `main`; sin despliegue operativo.
- La fila `11.11` permanece abierta hasta la aceptación de módulo `VAL-01.M01-M17.M11`.
