import { db } from "@/lib/db";
import { holidays } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export interface OfficialHolidayDefinition {
  name: string;
  date: string; // YYYY-MM-DD
  description: string;
  isMandatory: boolean;
  articleLFT: string;
}

/**
 * Calcula el n-ésimo día de la semana para un año y mes determinados.
 * @param year Año (ej. 2026)
 * @param month Mes 1-indexado (1 = enero, 2 = febrero, ...)
 * @param targetDayOfWeek 0 = domingo, 1 = lunes, ..., 6 = sábado
 * @param nth Ocurrencia (1 = primer lunes, 3 = tercer lunes, etc.)
 */
function getNthDayOfWeek(
  year: number,
  month: number,
  targetDayOfWeek: number,
  nth: number
): string {
  let count = 0;
  const daysInMonth = new Date(year, month, 0).getDate();

  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    if (d.getUTCDay() === targetDayOfWeek) {
      count++;
      if (count === nth) {
        const mStr = String(month).padStart(2, "0");
        const dStr = String(day).padStart(2, "0");
        return `${year}-${mStr}-${dStr}`;
      }
    }
  }
  throw new Error(`No se encontró el ${nth}º día (${targetDayOfWeek}) en ${year}-${month}`);
}

function formatDateStr(year: number, month: number, day: number): string {
  const mStr = String(month).padStart(2, "0");
  const dStr = String(day).padStart(2, "0");
  return `${year}-${mStr}-${dStr}`;
}

export class HolidayCatalogService {
  /**
   * Genera los días de descanso obligatorio federales conforme al Artículo 74 de la Ley Federal del Trabajo.
   */
  static getOfficialHolidays(year: number): OfficialHolidayDefinition[] {
    const list: OfficialHolidayDefinition[] = [
      {
        name: "Año Nuevo",
        date: formatDateStr(year, 1, 1),
        description: "Día de Año Nuevo (LFT Art. 74 Fracc. I)",
        isMandatory: true,
        articleLFT: "Art. 74 Fracc. I",
      },
      {
        name: "Día de la Constitución",
        date: getNthDayOfWeek(year, 2, 1, 1), // 1er lunes de febrero
        description: "Conmemoración del 5 de febrero (LFT Art. 74 Fracc. II)",
        isMandatory: true,
        articleLFT: "Art. 74 Fracc. II",
      },
      {
        name: "Natalicio de Benito Juárez",
        date: getNthDayOfWeek(year, 3, 1, 3), // 3er lunes de marzo
        description: "Conmemoración del 21 de marzo (LFT Art. 74 Fracc. III)",
        isMandatory: true,
        articleLFT: "Art. 74 Fracc. III",
      },
      {
        name: "Día del Trabajo",
        date: formatDateStr(year, 5, 1),
        description: "Día Internacional del Trabajo (LFT Art. 74 Fracc. IV)",
        isMandatory: true,
        articleLFT: "Art. 74 Fracc. IV",
      },
      {
        name: "Día de la Independencia",
        date: formatDateStr(year, 9, 16),
        description: "Conmemoración de la Independencia de México (LFT Art. 74 Fracc. V)",
        isMandatory: true,
        articleLFT: "Art. 74 Fracc. V",
      },
      {
        name: "Día de la Revolución",
        date: getNthDayOfWeek(year, 11, 1, 3), // 3er lunes de noviembre
        description: "Conmemoración del 20 de noviembre (LFT Art. 74 Fracc. VI)",
        isMandatory: true,
        articleLFT: "Art. 74 Fracc. VI",
      },
      {
        name: "Navidad",
        date: formatDateStr(year, 12, 25),
        description: "Navidad (LFT Art. 74 Fracc. VIII)",
        isMandatory: true,
        articleLFT: "Art. 74 Fracc. VIII",
      },
    ];

    // Fracción VII: Transmisión del Poder Ejecutivo Federal (1 de octubre cada 6 años desde 2024: 2024, 2030, 2036...)
    if ((year - 2024) % 6 === 0) {
      list.push({
        name: "Transmisión del Poder Ejecutivo Federal",
        date: formatDateStr(year, 10, 1),
        description: "Transmisión del Poder Ejecutivo Federal (LFT Art. 74 Fracc. VII)",
        isMandatory: true,
        articleLFT: "Art. 74 Fracc. VII",
      });
    }

    // Ordenar cronológicamente
    return list.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Precarga o sincroniza los días festivos obligatorios del año para una empresa específica.
   * Evita duplicar registros existentes si la fecha ya está dada de alta.
   */
  static async seedHolidaysForCompany(
    companyId: string,
    year: number = new Date().getFullYear()
  ): Promise<{ inserted: number; existing: number }> {
    if (!companyId) return { inserted: 0, existing: 0 };

    const officialList = this.getOfficialHolidays(year);

    // Obtener festivos existentes de la empresa en el año
    const existing = await db
      .select({ date: holidays.date })
      .from(holidays)
      .where(
        and(
          eq(holidays.companyId, companyId),
          eq(holidays.date, `${year}%`) // o chequeo simple por prefijo de año
        )
      )
      .catch(() => []);

    const existingDates = new Set(existing.map((e) => e.date));

    let inserted = 0;
    for (const h of officialList) {
      if (!existingDates.has(h.date)) {
        await db.insert(holidays).values({
          companyId,
          name: h.name,
          date: h.date,
          description: h.description,
          isMandatory: true,
        });
        inserted++;
      }
    }

    return { inserted, existing: existingDates.size };
  }
}
