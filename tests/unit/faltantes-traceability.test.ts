import { describe, expect, it } from "vitest";
import { parseCsv, parsePlan, validateTraceability, type TraceabilityMap } from "@/scripts/validate-faltantes";

const planText = `#### P0-01 — Base

**Tipo/tamaño:** R / S. **Depende de:** —. **Verificación:** D.
#### VAL-01 — Aceptación

**Tipo/tamaño:** A / P. **Depende de:** P0-01. **Verificación:** V2,V3.`;

function fixture() {
  return {
    historical: [{ ID: "01.01", Modulo: "Empresa", Requisito: "Empresa", Estado: "Parcial" }],
    current: [{ ID: "01.01", Modulo: "Empresa", Requisito: "Empresa", Estado_anterior: "Parcial", Estado_nuevo: "Parcial", Delta: "Sin cambio", Tareas: "VAL-01.empresa", Limite: "Sin aceptación", Evidencia_revision: "docs/revision.md" }],
    plan: parsePlan(planText),
    map: {
      tasks: [{ id: "VAL-01.empresa", title: "Aceptar empresa", parent: "VAL-01", dependsOn: ["P0-01"], checks: ["V2", "V3"], size: "M", type: "A" }],
      rows: [{ id: "01.01", tasks: ["VAL-01.empresa"], acceptance: "VAL-01.empresa" }],
      execution: {},
    } as TraceabilityMap,
    checked: [] as string[], exists: () => true, expectedRows: 1,
  };
}

describe("trazabilidad de faltantes", () => {
  it("lee CSV con comas, comillas dobles, CRLF y saltos dentro de un campo", () => {
    expect(parseCsv('\uFEFF"ID","Texto"\r\n"01.01","A, ""B""\nC"\r\n')).toEqual([{ ID: "01.01", Texto: 'A, "B"\nC' }]);
  });
  it("rechaza CSV incompleto o con columnas inconsistentes", () => {
    expect(() => parseCsv('ID,Texto\n1,"abierto')).toThrow();
    expect(() => parseCsv('ID,Texto\n1')).toThrow();
  });
  it("acepta una fila pendiente con hijo explícito, sin exigir evidencia futura", () => {
    expect(validateTraceability(fixture())).toEqual([]);
  });
  it("rechaza matriz vacía, duplicada o con identidad histórica alterada", () => {
    const input = fixture(); input.current = [];
    expect(validateTraceability(input).join()).toMatch(/filas|faltante/i);
    const duplicate = fixture(); duplicate.current.push(duplicate.current[0]);
    expect(validateTraceability(duplicate).join()).toMatch(/duplicad/i);
    const changed = fixture(); changed.current[0].Requisito = "Otro requisito";
    expect(validateTraceability(changed).join()).toMatch(/históric/i);
  });
  it("detecta fila huérfana, referencia inexistente y padre usado como ejecutable", () => {
    const orphan = fixture(); orphan.map.rows = [];
    expect(validateTraceability(orphan).join()).toMatch(/huérfana/i);
    const missing = fixture(); missing.map.rows[0].tasks = ["NO-EXISTE"];
    expect(validateTraceability(missing).join()).toMatch(/inexistente/i);
    const parent = fixture(); parent.map.rows[0].acceptance = "VAL-01";
    expect(validateTraceability(parent).join()).toMatch(/padre/i);
  });
  it("detecta dependencias inexistentes y ciclos entre hijos", () => {
    const missing = fixture(); missing.map.tasks[0].dependsOn = ["NO-EXISTE"];
    expect(validateTraceability(missing).join()).toMatch(/dependencia inexistente/i);
    const cycle = fixture(); cycle.map.tasks[0].dependsOn = ["VAL-01.empresa"];
    expect(validateTraceability(cycle).join()).toMatch(/ciclo/i);
    const parentCycle = fixture();
    parentCycle.plan[0].dependsOn = ["VAL-01"];
    parentCycle.plan[1].dependsOn = [];
    expect(validateTraceability(parentCycle).join()).toMatch(/ciclo/i);
  });
  it("no permite omitir dependencias heredadas ni asignadas a las filas del módulo", () => {
    const missing = fixture(); missing.map.tasks[0].dependsOn = [];
    expect(validateTraceability(missing).join()).toMatch(/heredada/i);
    const row = fixture(); row.map.rows[0].tasks.push("P0-01"); row.map.tasks[0].dependsOn = [];
    expect(validateTraceability(row).join()).toMatch(/dependencia.*P0-01/i);
  });
  it("rechaza casilla marcada y aceptación sin evidencia, comprobaciones o dependencias", () => {
    const checked = fixture(); checked.checked = ["P0-01"];
    expect(validateTraceability(checked).join()).toMatch(/evidencia/i);
    const closed = fixture(); closed.map.execution = { "VAL-01.empresa": { state: "aceptado", evidence: [] } };
    expect(validateTraceability(closed).join()).toMatch(/evidencia|dependencia/i);
  });
  it("rechaza evidencia rota o sin HEAD, entorno, comprobaciones y exit", () => {
    const input = fixture(); input.map.execution = { "P0-01": { state: "aceptado", evidence: [{ file: "missing.md" } as never] } };
    input.exists = () => false;
    expect(validateTraceability(input).join()).toMatch(/evidencia/i);
  });
  it("rechaza una fila aceptada cuando su recorrido todavía está pendiente", () => {
    const input = fixture(); input.current[0].Estado_nuevo = "Aceptado";
    expect(validateTraceability(input).join()).toMatch(/aceptada.*pendiente/i);
  });
  it("acepta el cierre documental con evidencia completa y rechaza exit fallido", () => {
    const input = fixture(); input.checked = ["P0-01"];
    input.map.execution = { "P0-01": { state: "aceptado", evidence: [{ file: "base.md", head: "a".repeat(40), environment: "local sin base", checks: ["D"], commands: [{ command: "git status --short", exit: 0 }] }] } };
    expect(validateTraceability(input)).toEqual([]);
    input.map.execution["P0-01"].evidence[0].commands[0].exit = 1;
    expect(validateTraceability(input).join()).toMatch(/evidencia/i);
  });
});
