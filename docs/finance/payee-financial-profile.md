# Ficha financiera de contraparte

Ruta: `/dashboard/finance/payees/[id]`. Se abre desde el nombre o Abrir ficha del catálogo; las contrapartes dadas de baja conservan acceso al historial.

## Comportamiento

- Pendientes agrupa las obligaciones por contraparte. Los saldos documentados, vencidos, estimados y gastos por aprobar se distinguen; los abonos confirmados reducen el saldo cuando está habilitado el módulo contable.
- Movimientos muestra gastos y sus estados. Documentos incluye las facturas cargadas en Compras de los proveedores vinculados, incluidas pagadas/canceladas. El metadata del buzón SAT mantiene su flujo existente y no se convierte por esta pantalla en una obligación nueva.
- El historial se pagina de 50 en 50 y se filtra por sucursal y fechas. Las fechas no alteran el saldo vigente. El detalle de pendientes se acota a 1000 partidas; los agregados cubren todo el alcance.
- Datos y cuentas muestra contacto, proveedores vinculados y cuentas identificadas por sus últimos cuatro dígitos. Registrar un gasto conserva la contraparte y la sucursal seleccionadas.

## Una obligación por servicio

Asociar factura exige la misma empresa, contraparte, sucursal e importe. Las coincidencias se eligen explícitamente. No se admiten facturas de mercancía con OC/recepción ni documentos de periodos cerrados, con pagos/corridas previas o pólizas que requieran revisión.

El gasto de servicio conserva la aprobación, clasificación y fuente de pago; la factura es su respaldo. La factura asociada no se vuelve a ofrecer como otra obligación en CxP, flujo de efectivo o tesorería. Tampoco se contabiliza de nuevo como compra. Pagar completamente el gasto refleja la factura pagada sin generar otra aplicación. Los abonos parciales conservan la factura pendiente. Las facturas de mercancía mantienen su circuito de Compras.

Todas las operaciones se limitan por empresa y sucursal de sesión. La asociación usa locks de documentos y contabilización, y auditoría en la misma transacción. No se modifican firmas, umbrales ni verificación de cuentas bancarias. No requiere migración ni reasigna documentos existentes automáticamente.

## Verificación

- `pnpm test:unit tests/unit/finance/payee-finance-db.test.ts tests/unit/finance/payee-finance-route.test.ts tests/unit/finance/payee-obligations.test.ts tests/unit/finance/treasury-authorization.test.ts`
- `pnpm exec playwright test --config tests/playwright-payee.config.ts`

Las pruebas de SQL usan PostgreSQL embebido temporal. Las pruebas de navegador usan los componentes y estilos reales con identidades y HTTP sintéticos; no escriben en la empresa real.
