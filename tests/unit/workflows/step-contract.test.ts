import { describe, it, expect } from "vitest";
import {
  validarContratoDePaso,
  WorkflowStepContractError,
  type StepContractValidationParams,
} from "@/lib/workflows/step-contract-policy";
import type { StepUpdateContext } from "@/lib/services/workflow-execution-service";

function ctxSession(role: any = "EMPLEADO"): StepUpdateContext {
  return {
    kind: "session",
    actor: {
      userId: "user-123",
      role,
      companyId: "company-1",
      branchId: "branch-1",
    },
    performedBy: "user-123",
  };
}

function ctxLink(): StepUpdateContext {
  return {
    kind: "link",
    performedBy: "smart_link:xyz12345",
  };
}

function baseParams(
  stepDef: any,
  data: any,
  ctx: StepUpdateContext = ctxSession("EMPLEADO")
): StepContractValidationParams {
  return {
    stepDef,
    data,
    instance: {
      id: "inst-1",
      status: "IN_PROGRESS",
      workflowTemplateId: "tpl-1",
    },
    savedStep: {
      status: "PENDING",
      definition: stepDef,
      value: null,
    },
    ctx,
  };
}

describe("C24 — validarContratoDePaso (contrato de paso en servidor)", () => {
  describe("Definición de paso", () => {
    it("rechaza si stepDef no existe (STEP_NOT_FOUND)", () => {
      const params = baseParams(null, { status: "COMPLETED", value: "test" });
      expect(() => validarContratoDePaso(params)).toThrow(WorkflowStepContractError);
      try {
        validarContratoDePaso(params);
      } catch (err: any) {
        expect(err.code).toBe("STEP_NOT_FOUND");
        expect(err.statusCode).toBe(404);
      }
    });
  });

  describe("Instancia terminal", () => {
    it("rechaza modificaciones si la ejecución ya está COMPLETED (409)", () => {
      const params = baseParams({ id: "s1", type: "TEXT" }, { status: "COMPLETED", value: "hola" });
      params.instance.status = "COMPLETED";

      expect(() => validarContratoDePaso(params)).toThrow(WorkflowStepContractError);
      try {
        validarContratoDePaso(params);
      } catch (err: any) {
        expect(err.code).toBe("WORKFLOW_TERMINAL");
        expect(err.statusCode).toBe(409);
      }
    });

    it("rechaza modificaciones si la ejecución está CANCELLED (409)", () => {
      const params = baseParams({ id: "s1", type: "TEXT" }, { status: "COMPLETED", value: "hola" });
      params.instance.status = "CANCELLED";

      expect(() => validarContratoDePaso(params)).toThrow(WorkflowStepContractError);
      try {
        validarContratoDePaso(params);
      } catch (err: any) {
        expect(err.code).toBe("WORKFLOW_TERMINAL");
        expect(err.statusCode).toBe(409);
      }
    });
  });

  describe("Transiciones de estado", () => {
    it("un paso COMPLETED no puede volver a IN_PROGRESS ni SKIPPED", () => {
      const params = baseParams(
        { id: "s1", type: "TEXT" },
        { status: "IN_PROGRESS", value: "borrador" }
      );
      params.savedStep = { status: "COMPLETED", value: "previo" };

      expect(() => validarContratoDePaso(params)).toThrow(WorkflowStepContractError);
      try {
        validarContratoDePaso(params);
      } catch (err: any) {
        expect(err.code).toBe("STEP_ALREADY_COMPLETED");
        expect(err.statusCode).toBe(409);
      }
    });

    it("permite guardar borrador IN_PROGRESS en paso PENDING sin validar obligatoriedad", () => {
      const params = baseParams(
        { id: "s1", type: "TEXT", required: true },
        { status: "IN_PROGRESS", value: "" }
      );
      const res = validarContratoDePaso(params);
      expect(res.category).toBe("TEXT");
      expect(res.isRequired).toBe(true);
    });

    it("un paso opcional puede ser SKIPPED por cualquier usuario (EMPLEADO o link)", () => {
      const paramsSession = baseParams(
        { id: "s1", type: "TEXT", required: false },
        { status: "SKIPPED" },
        ctxSession("EMPLEADO")
      );
      expect(() => validarContratoDePaso(paramsSession)).not.toThrow();

      const paramsLink = baseParams(
        { id: "s1", type: "TEXT", required: false },
        { status: "SKIPPED" },
        ctxLink()
      );
      expect(() => validarContratoDePaso(paramsLink)).not.toThrow();
    });

    it("un paso obligatorio NO puede ser SKIPPED por EMPLEADO (403)", () => {
      const params = baseParams(
        { id: "s1", type: "TEXT", required: true },
        { status: "SKIPPED" },
        ctxSession("EMPLEADO")
      );
      expect(() => validarContratoDePaso(params)).toThrow(WorkflowStepContractError);
      try {
        validarContratoDePaso(params);
      } catch (err: any) {
        expect(err.code).toBe("UNAUTHORIZED_SKIP");
        expect(err.statusCode).toBe(403);
      }
    });

    it("un paso obligatorio NO puede ser SKIPPED por link público (403)", () => {
      const params = baseParams(
        { id: "s1", type: "TEXT", required: true },
        { status: "SKIPPED" },
        ctxLink()
      );
      expect(() => validarContratoDePaso(params)).toThrow(WorkflowStepContractError);
      try {
        validarContratoDePaso(params);
      } catch (err: any) {
        expect(err.code).toBe("UNAUTHORIZED_SKIP");
        expect(err.statusCode).toBe(403);
      }
    });

    it("un paso obligatorio puede ser SKIPPED por SUPERVISOR si incluye motivo en comment", () => {
      const paramsSinMotivo = baseParams(
        { id: "s1", type: "TEXT", required: true },
        { status: "SKIPPED", comment: "" },
        ctxSession("SUPERVISOR")
      );
      expect(() => validarContratoDePaso(paramsSinMotivo)).toThrow(WorkflowStepContractError);
      try {
        validarContratoDePaso(paramsSinMotivo);
      } catch (err: any) {
        expect(err.code).toBe("SKIP_JUSTIFICATION_REQUIRED");
        expect(err.statusCode).toBe(400);
      }

      const paramsConMotivo = baseParams(
        { id: "s1", type: "TEXT", required: true },
        { status: "SKIPPED", comment: "Termómetro descompuesto, validado visualmente." },
        ctxSession("SUPERVISOR")
      );
      expect(() => validarContratoDePaso(paramsConMotivo)).not.toThrow();
    });
  });

  describe("Validación de evidencia obligatoria", () => {
    it("paso de tipo PHOTO rechaza si no hay URL en evidenceUrl ni en value (400)", () => {
      const params = baseParams(
        { id: "s-foto", type: "PHOTO", required: true },
        { status: "COMPLETED", value: "", evidenceUrl: null }
      );
      expect(() => validarContratoDePaso(params)).toThrow(WorkflowStepContractError);
      try {
        validarContratoDePaso(params);
      } catch (err: any) {
        expect(err.code).toBe("EVIDENCE_REQUIRED");
        expect(err.statusCode).toBe(400);
      }
    });

    it("paso con evidenceRequired: true rechaza si falta evidenceUrl (400)", () => {
      const params = baseParams(
        { id: "s-temp", type: "NUMBER", required: true, evidenceRequired: true },
        { status: "COMPLETED", value: 4, evidenceUrl: "" }
      );
      expect(() => validarContratoDePaso(params)).toThrow(WorkflowStepContractError);
      try {
        validarContratoDePaso(params);
      } catch (err: any) {
        expect(err.code).toBe("EVIDENCE_REQUIRED");
        expect(err.statusCode).toBe(400);
      }
    });

    it("paso con evidenceRequired: true pasa si tiene evidenceUrl", () => {
      const params = baseParams(
        { id: "s-temp", type: "NUMBER", required: true, evidenceRequired: true },
        { status: "COMPLETED", value: 4, evidenceUrl: "https://r2.storage/evidence.jpg" }
      );
      expect(() => validarContratoDePaso(params)).not.toThrow();
    });
  });

  describe("Validación por categoría de paso y límites", () => {
    it("TEXT obligatorio rechaza vacío y espacios en blanco", () => {
      const paramsVacio = baseParams(
        { id: "s1", type: "TEXT", required: true },
        { status: "COMPLETED", value: "" }
      );
      expect(() => validarContratoDePaso(paramsVacio)).toThrow(WorkflowStepContractError);

      const paramsEspacios = baseParams(
        { id: "s1", type: "TEXT", required: true },
        { status: "COMPLETED", value: "    " }
      );
      expect(() => validarContratoDePaso(paramsEspacios)).toThrow(WorkflowStepContractError);
    });

    it("TEXT valida min y max longitud", () => {
      const stepDef = { id: "s1", type: "TEXT", validation: { min: 5, max: 10 } };

      const paramsCorto = baseParams(stepDef, { status: "COMPLETED", value: "hola" });
      expect(() => validarContratoDePaso(paramsCorto)).toThrow(WorkflowStepContractError);

      const paramsLargo = baseParams(stepDef, { status: "COMPLETED", value: "hola mundo que tal" });
      expect(() => validarContratoDePaso(paramsLargo)).toThrow(WorkflowStepContractError);

      const paramsCorrecto = baseParams(stepDef, { status: "COMPLETED", value: "1234567" });
      expect(() => validarContratoDePaso(paramsCorrecto)).not.toThrow();
    });

    it("NUMBER obligatorio rechaza vacío, null o no numérico", () => {
      const stepDef = { id: "s-num", type: "NUMBER", required: true };

      expect(() => validarContratoDePaso(baseParams(stepDef, { status: "COMPLETED", value: null }))).toThrow();
      expect(() => validarContratoDePaso(baseParams(stepDef, { status: "COMPLETED", value: "abc" }))).toThrow();
      expect(() => validarContratoDePaso(baseParams(stepDef, { status: "COMPLETED", value: "" }))).toThrow();
    });

    it("NUMBER valida rango min y max", () => {
      const stepDef = {
        id: "s-temp",
        type: "NUMBER",
        validation: { min: 2, max: 8, customMessage: "La temperatura debe estar entre 2 y 8 °C" },
      };

      const paramsMenor = baseParams(stepDef, { status: "COMPLETED", value: 1.5 });
      expect(() => validarContratoDePaso(paramsMenor)).toThrow("La temperatura debe estar entre 2 y 8 °C");

      const paramsMayor = baseParams(stepDef, { status: "COMPLETED", value: 10 });
      expect(() => validarContratoDePaso(paramsMayor)).toThrow("La temperatura debe estar entre 2 y 8 °C");

      const paramsValido = baseParams(stepDef, { status: "COMPLETED", value: 4.5 });
      expect(() => validarContratoDePaso(paramsValido)).not.toThrow();
    });

    it("SELECT valida que la opción pertenezca a la lista autorizada", () => {
      const stepDef = {
        id: "s-sel",
        type: "SELECT",
        options: ["Turno Matutino", "Turno Vespertino", "Turno Nocturno"],
      };

      const paramsInvalido = baseParams(stepDef, { status: "COMPLETED", value: "Turno Madrugada" });
      expect(() => validarContratoDePaso(paramsInvalido)).toThrow(WorkflowStepContractError);

      const paramsValido = baseParams(stepDef, { status: "COMPLETED", value: "Turno Matutino" });
      expect(() => validarContratoDePaso(paramsValido)).not.toThrow();
    });

    it("YESNO valida booleanos o representaciones válidas", () => {
      const stepDef = { id: "s-yn", type: "YESNO", required: true };

      expect(() => validarContratoDePaso(baseParams(stepDef, { status: "COMPLETED", value: "tal vez" }))).toThrow();
      expect(() => validarContratoDePaso(baseParams(stepDef, { status: "COMPLETED", value: "yes" }))).not.toThrow();
      expect(() => validarContratoDePaso(baseParams(stepDef, { status: "COMPLETED", value: false }))).not.toThrow();
    });

    it("CHECKBOX obligatorio rechaza false o arreglo vacío", () => {
      const stepDef = { id: "s-chk", type: "CHECKBOX", required: true };

      expect(() => validarContratoDePaso(baseParams(stepDef, { status: "COMPLETED", value: false }))).toThrow();
      expect(() => validarContratoDePaso(baseParams(stepDef, { status: "COMPLETED", value: [] }))).toThrow();
      expect(() => validarContratoDePaso(baseParams(stepDef, { status: "COMPLETED", value: true }))).not.toThrow();
      expect(() => validarContratoDePaso(baseParams(stepDef, { status: "COMPLETED", value: ["item1"] }))).not.toThrow();
    });

    it("TIME valida formato HH:MM y límites minTime / maxTime", () => {
      const stepDef = {
        id: "s-time",
        type: "TIME",
        validation: { minTime: "08:00", maxTime: "18:00" },
      };

      expect(() => validarContratoDePaso(baseParams(stepDef, { status: "COMPLETED", value: "hora-invalida" }))).toThrow();
      expect(() => validarContratoDePaso(baseParams(stepDef, { status: "COMPLETED", value: "07:30" }))).toThrow();
      expect(() => validarContratoDePaso(baseParams(stepDef, { status: "COMPLETED", value: "19:00" }))).toThrow();
      expect(() => validarContratoDePaso(baseParams(stepDef, { status: "COMPLETED", value: "12:00" }))).not.toThrow();
    });

    it("DATE valida fechas correctas", () => {
      const stepDef = { id: "s-date", type: "DATE", required: true };

      expect(() => validarContratoDePaso(baseParams(stepDef, { status: "COMPLETED", value: "no-es-fecha" }))).toThrow();
      expect(() => validarContratoDePaso(baseParams(stepDef, { status: "COMPLETED", value: "2026-10-15" }))).not.toThrow();
    });

    it("INFO no requiere valor para completarse", () => {
      const stepDef = { id: "s-info", type: "INFO", required: true };
      expect(() => validarContratoDePaso(baseParams(stepDef, { status: "COMPLETED" }))).not.toThrow();
    });
  });
});
