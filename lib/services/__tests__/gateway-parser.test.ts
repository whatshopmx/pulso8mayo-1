import { describe, it, expect } from "vitest";
import {
  parseGatewayReport,
  parseMoneyCents,
  parseTransactionDate,
} from "../gateway-report-parser";
import { ApiError } from "@/lib/api/error";

describe("GatewayReportParser (Importador de Reportes Clip, Mercado Pago, Bancos)", () => {
  describe("parseMoneyCents", () => {
    it("convierte cadenas con símbolos de moneda y comas a centavos enteros", () => {
      expect(parseMoneyCents("$1,250.50")).toBe(125050);
      expect(parseMoneyCents("450.00")).toBe(45000);
      expect(parseMoneyCents("0.50")).toBe(50);
      expect(parseMoneyCents(123.45)).toBe(12345);
      expect(parseMoneyCents("")).toBeNull();
      expect(parseMoneyCents(null)).toBeNull();
    });
  });

  describe("parseTransactionDate", () => {
    it("parsea formatos DD/MM/YYYY HH:mm:ss y cadenas ISO", () => {
      const d1 = parseTransactionDate("15/09/2026 14:30:00");
      expect(d1.getUTCFullYear()).toBe(2026);
      expect(d1.getUTCMonth()).toBe(8); // Septiembre es 8 (0-indexed)
      expect(d1.getUTCDate()).toBe(15);
      expect(d1.getUTCHours()).toBe(14);
      expect(d1.getUTCMinutes()).toBe(30);

      const d2 = parseTransactionDate("2026-09-15T10:15:00.000Z");
      expect(d2.getUTCFullYear()).toBe(2026);
      expect(d2.getUTCDate()).toBe(15);
    });
  });

  describe("parseGatewayReport", () => {
    it("parsea exitosamente un reporte CSV típico de Clip con segregación de comisión e IVA", async () => {
      const clipCsv = `Reporte de Transacciones Clip - Sucursal Roma
Fecha de transacción,ID de transacción,Autorización,Tarjeta,Monto,Comisión Clip,IVA Comisión,Monto Neto
15/09/2026 13:45:00,clp_001,098712,4321,500.00,18.00,2.88,479.12
15/09/2026 15:10:22,clp_002,098713,9876,1000.00,36.00,5.76,958.24
Total,,,,1500.00,54.00,8.64,1437.36`;

      const buffer = Buffer.from(clipCsv, "utf8");
      const result = await parseGatewayReport(buffer, "reporte_clip_septiembre.csv");

      expect(result.acquirer).toBe("CLIP");
      expect(result.totalTransactions).toBe(2); // La fila de "Total" sin fecha/auth válida se ignora o suma correctamente
      expect(result.totalGrossCents).toBe(150000); // $1,500.00
      expect(result.totalFeeCents).toBe(5400); // $54.00
      expect(result.totalFeeVatCents).toBe(864); // $8.64
      expect(result.totalNetCents).toBe(143736); // $1,437.36

      const tx1 = result.transactions[0];
      expect(tx1.externalId).toBe("clp_001");
      expect(tx1.authorizationCode).toBe("098712");
      expect(tx1.cardLast4).toBe("4321");
      expect(tx1.grossAmountCents).toBe(50000);
      expect(tx1.feeAmountCents).toBe(1800);
      expect(tx1.feeVatCents).toBe(288);
      expect(tx1.netAmountCents).toBe(47912);
    });

    it("parsea exitosamente un reporte CSV de Mercado Pago con nombres de columna en inglés", async () => {
      const mpCsv = `date_created,operation_id,authorization_code,last_four_digits,payment_method_id,transaction_amount,mercadopago_fee,taxes_amount,net_received_amount
2026-09-15T18:00:00.000Z,908123456,778899,1122,visa,850.00,29.75,4.76,815.49
2026-09-15T19:20:00.000Z,908123457,778900,3344,mastercard,650.00,22.75,3.64,623.61`;

      const buffer = Buffer.from(mpCsv, "utf8");
      const result = await parseGatewayReport(buffer, "mp_settlement_20260915.csv");

      expect(result.acquirer).toBe("MERCADO_PAGO");
      expect(result.totalTransactions).toBe(2);
      expect(result.totalGrossCents).toBe(150000);
      expect(result.transactions[0].cardBrand).toBe("VISA");
      expect(result.transactions[1].cardBrand).toBe("MASTERCARD");
      expect(result.transactions[0].authorizationCode).toBe("778899");
    });

    it("calcula automáticamente el 16% de IVA sobre la comisión si el archivo no trae columna de IVA", async () => {
      const bancoCsv = `Fecha,Folio,Autorizacion,Tarjeta,Importe,Comision
15/09/2026,B-101,123456,9988,2000.00,50.00`;

      const buffer = Buffer.from(bancoCsv, "utf8");
      const result = await parseGatewayReport(buffer, "banco_ventas.csv", "BBVA");

      expect(result.acquirer).toBe("BBVA");
      expect(result.totalTransactions).toBe(1);
      const tx = result.transactions[0];
      expect(tx.grossAmountCents).toBe(200000);
      expect(tx.feeAmountCents).toBe(5000); // $50.00
      expect(tx.feeVatCents).toBe(800); // 16% de $50 = $8.00 (800 centavos)
      expect(tx.netAmountCents).toBe(194200); // 200000 - 5000 - 800 = 194200 ($1,942.00)
    });

    it("lanza ApiError si el archivo está vacío o no tiene encabezados válidos", async () => {
      const invalidCsv = `columna_a,columna_b,columna_c
foo,bar,baz`;

      const buffer = Buffer.from(invalidCsv, "utf8");
      await expect(
        parseGatewayReport(buffer, "invalido.csv")
      ).rejects.toThrow(ApiError);
    });
  });
});
