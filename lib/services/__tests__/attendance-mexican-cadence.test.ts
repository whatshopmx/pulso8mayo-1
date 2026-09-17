import { describe, it, expect } from "vitest"
import { getServiceShift } from "@/components/labor/attendance-report"

describe("Mexican Restaurant Operational Cadence & Shift Classification", () => {
    it("classifies morning opening shifts (Apertura: 06:00 - 11:59)", () => {
        expect(getServiceShift("2026-09-17T06:00:00Z")).toBe("apertura")
        expect(getServiceShift("2026-09-17T08:30:00Z")).toBe("apertura")
        expect(getServiceShift("2026-09-17T11:59:00Z")).toBe("apertura")
    })

    it("classifies afternoon intermediate shifts (Intermedio: 12:00 - 16:59)", () => {
        expect(getServiceShift("2026-09-17T12:00:00Z")).toBe("intermedio")
        expect(getServiceShift("2026-09-17T14:15:00Z")).toBe("intermedio")
        expect(getServiceShift("2026-09-17T16:59:00Z")).toBe("intermedio")
    })

    it("classifies night / closing shifts (Cierre: 17:00 - 05:59)", () => {
        expect(getServiceShift("2026-09-17T17:00:00Z")).toBe("cierre")
        expect(getServiceShift("2026-09-17T23:30:00Z")).toBe("cierre")
        expect(getServiceShift("2026-09-17T02:00:00Z")).toBe("cierre")
    })

    it("handles null or invalid clockIn gracefully with fallback to apertura", () => {
        expect(getServiceShift(null)).toBe("apertura")
        expect(getServiceShift("invalid-date-string")).toBe("apertura")
    })
})

describe("Mexican Payroll Quincena Cutoffs (LFT Cadence)", () => {
    // Import dynamically or directly from dashboard
    it("calculates 1st quincena correctly (Days 1 to 15)", async () => {
        const { getMexicanPresetDates } = await import("@/components/labor/attendance-dashboard")
        const midFirstQuincena = new Date(2026, 8, 10) // 10 Sept 2026
        const result = getMexicanPresetDates("esta-quincena", undefined, undefined, midFirstQuincena)

        expect(result.startDate).toBe("2026-09-01")
        expect(result.endDate).toBe("2026-09-15")
        expect(result.label).toContain("1ª Quincena")
    })

    it("calculates 2nd quincena correctly (Days 16 to end of month)", async () => {
        const { getMexicanPresetDates } = await import("@/components/labor/attendance-dashboard")
        const midSecondQuincena = new Date(2026, 8, 22) // 22 Sept 2026 (Sept has 30 days)
        const result = getMexicanPresetDates("esta-quincena", undefined, undefined, midSecondQuincena)

        expect(result.startDate).toBe("2026-09-16")
        expect(result.endDate).toBe("2026-09-30")
        expect(result.label).toContain("2ª Quincena")
    })

    it("calculates quincena anterior when in 1st quincena (previous month 16-end)", async () => {
        const { getMexicanPresetDates } = await import("@/components/labor/attendance-dashboard")
        const earlySept = new Date(2026, 8, 5) // 5 Sept 2026 -> previous quincena is August 16-31
        const result = getMexicanPresetDates("quincena-anterior", undefined, undefined, earlySept)

        expect(result.startDate).toBe("2026-08-16")
        expect(result.endDate).toBe("2026-08-31")
        expect(result.label).toContain("2ª Quincena")
    })
})
