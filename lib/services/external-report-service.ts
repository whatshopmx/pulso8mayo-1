import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "pulso-secret-key-12345";
const MAX_EXPIRY_DAYS = 7;
const DEFAULT_EXPIRY_DAYS = 7;

export type ExternalReportType = "NOM-251" | "NOM-035" | "LABOR_LAW";

export interface ExternalReportTokenPayload {
    reportType: ExternalReportType;
    companyId: string;
    branchId: string;
    startDate: string; // ISO
    endDate: string; // ISO
    recipientName: string;
    recipientRole: string;
    type: "EXTERNAL_REPORT";
    iat: number;
    exp: number;
}

export interface GenerateExternalTokenInput {
    reportType: ExternalReportType;
    companyId: string;
    branchId: string;
    startDate: Date;
    endDate: Date;
    recipientName: string;
    recipientRole: string;
    expiresInDays?: number;
}

export interface GeneratedExternalToken {
    token: string;
    url: string;
    expiresAt: Date;
}

export class ExternalReportService {
    /**
     * Genera un token JWT firmado de corta duración (máx. 7 días, per AD-4)
     * para acceso de solo lectura de externos a un reporte.
     * Stateless: no persistence; el token contiene todo el contexto.
     */
    static async generateExternalToken(
        input: GenerateExternalTokenInput
    ): Promise<GeneratedExternalToken> {
        const expiresInDays = Math.min(
            input.expiresInDays ?? DEFAULT_EXPIRY_DAYS,
            MAX_EXPIRY_DAYS
        );

        const now = Math.floor(Date.now() / 1000);
        const exp = now + expiresInDays * 24 * 60 * 60;

        const payload: Omit<ExternalReportTokenPayload, "iat" | "exp"> = {
            reportType: input.reportType,
            companyId: input.companyId,
            branchId: input.branchId,
            startDate: input.startDate.toISOString(),
            endDate: input.endDate.toISOString(),
            recipientName: input.recipientName,
            recipientRole: input.recipientRole,
            type: "EXTERNAL_REPORT",
        };

        const token = jwt.sign({ ...payload, iat: now, exp }, JWT_SECRET, {
            algorithm: "HS256",
        });

        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        const expiresAt = new Date(exp * 1000);

        return {
            token,
            url: `${baseUrl}/external/report/${token}`,
            expiresAt,
        };
    }

    /**
     * Valida un token JWT de reporte externo.
     * Retorna el payload decodificado o null si es inválido/expirado.
     */
    static validateExternalToken(token: string): ExternalReportTokenPayload | null {
        try {
            const decoded = jwt.verify(token, JWT_SECRET, {
                algorithms: ["HS256"],
            }) as jwt.JwtPayload;

            if (decoded.type !== "EXTERNAL_REPORT") {
                return null;
            }

            return {
                reportType: decoded.reportType,
                companyId: decoded.companyId,
                branchId: decoded.branchId,
                startDate: decoded.startDate,
                endDate: decoded.endDate,
                recipientName: decoded.recipientName,
                recipientRole: decoded.recipientRole,
                type: "EXTERNAL_REPORT",
                iat: decoded.iat,
                exp: decoded.exp,
            };
        } catch (error) {
            console.error("[ExternalReportService] Token validation failed:", error);
            return null;
        }
    }
}