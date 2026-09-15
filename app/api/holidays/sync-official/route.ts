import { NextRequest } from "next/server";
import { HolidayService } from "@/lib/services/holiday-service";
import { ApiHandler } from "@/lib/api/response";
import { requireTenant } from "@/lib/tenant-context";

export async function POST(req: NextRequest) {
    try {
        const tenant = await requireTenant();
        let year = new Date().getFullYear();

        try {
            const body = await req.json();
            if (body.year) year = Number(body.year);
        } catch {
            // body vacío es aceptable, default a año en curso
        }

        const result = await HolidayService.syncOfficialHolidays(tenant.id, year);
        return ApiHandler.success({
            message: `Festivos oficiales sincronizados correctamente para ${year}`,
            ...result,
        });
    } catch (error) {
        return ApiHandler.error(error);
    }
}
