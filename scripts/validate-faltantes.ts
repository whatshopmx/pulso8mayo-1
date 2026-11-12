/** P0-03: comprobación documental, sin conexión a servicios ni base de datos. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type Row = Record<string, string>;
type Task = { id: string; title: string; type: string; size: string; dependsOn: string[]; checks: string[]; parent?: string };
type Evidence = { file: string; head: string; environment: string; commands: { command: string; exit: number }[]; checks: string[] };
type Execution = { state: string; evidence: Evidence[] };
export type TraceabilityMap = {
  tasks: Task[];
  rows: { id: string; tasks: string[]; acceptance: string }[];
  execution: Record<string, Execution>;
};

export function parseCsv(text: string): Row[] {
  const records: string[][] = [];
  let row: string[] = [], field = "", quoted = false, closed = false;
  const input = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === "," || char === "\n") {
      row.push(field); field = ""; closed = false;
      if (char === "\n") { records.push(row); row = []; }
    } else if (char === '"' && field === "" && !closed) quoted = true;
    else if (closed || char === '"') throw new Error("CSV: comillas inválidas");
    else field += char;
  }
  if (quoted) throw new Error("CSV: comillas sin cerrar");
  if (field || row.length || closed) records.push([...row, field]);
  const headers = records.shift();
  if (!headers || new Set(headers).size !== headers.length) throw new Error("CSV: cabecera ausente o duplicada");
  return records.map(values => {
    if (values.length !== headers.length) throw new Error("CSV: número de columnas inconsistente");
    return Object.fromEntries(headers.map((header, i) => [header, values[i]]));
  });
}

export function parsePlan(text: string): Task[] {
  return [...text.matchAll(/^#### (\S+) — (.+)\r?\n\r?\n\*\*Tipo\/tamaño:\*\* (\w) \/ (\w)\. \*\*Depende de:\*\* (.+?)\. \*\*Verificación:\*\* (.+?)\./gm)]
    .map(([, id, title, type, size, dependencies, checks]) => ({
      id, title, type, size, dependsOn: dependencies === "—" ? [] : dependencies.split(", "), checks: checks.split(","),
    }));
}

export function validateTraceability(input: {
  historical: Row[]; current: Row[]; plan: Task[]; map: TraceabilityMap;
  checked: string[]; exists: (path: string) => boolean; expectedRows?: number;
}): string[] {
  const { historical, current, plan, map, checked, exists, expectedRows = 239 } = input;
  const errors: string[] = [];
  const unique = <T>(items: T[], key: (item: T) => string, label: string) => {
    const seen = new Map<string, T>();
    for (const item of items) {
      const id = key(item);
      if (!id || seen.has(id)) errors.push(`${label}: ID vacío/duplicado ${id}`);
      seen.set(id, item);
    }
    return seen;
  };
  const oldRows = unique(historical, row => row.ID, "Histórica");
  const newRows = unique(current, row => row.ID, "Matriz");
  const mappings = unique(map.rows, row => row.id, "Mapa");
  const tasks = unique([...plan, ...map.tasks], task => task.id, "Tarea");
  for (const [label, items] of [["histórica", historical], ["matriz", current], ["mapa", map.rows]] as const) {
    if (items.length !== expectedRows) errors.push(`${label}: se esperaban ${expectedRows} filas, hay ${items.length}`);
  }
  const accepted = (id: string) => map.execution[id]?.state === "aceptado";
  const executable = (id: string, context: string) => {
    const task = tasks.get(id);
    if (!task) errors.push(`${context}: tarea inexistente ${id}`);
    else if (task.size === "P") errors.push(`${context}: padre ${id} usado como ejecutable`);
    return task;
  };
  for (const row of historical) {
    const updated = newRows.get(row.ID), mapping = mappings.get(row.ID);
    if (!updated) errors.push(`Fila histórica faltante ${row.ID}`);
    else {
      if (["Modulo", "Requisito"].some(key => row[key] !== updated[key]) || row.Estado !== updated.Estado_anterior) errors.push(`Identidad histórica alterada ${row.ID}`);
      for (const key of ["Estado_nuevo", "Delta", "Limite", "Evidencia_revision"]) {
        if (!updated[key]?.trim()) errors.push(`${row.ID}: campo vacío ${key}`);
      }
      for (const file of (updated.Evidencia_revision || "").split(";").map(item => item.trim()).filter(Boolean)) {
        if (!exists(file)) errors.push(`${row.ID}: evidencia de revisión inexistente ${file}`);
      }
    }
    if (!mapping?.tasks.length) { errors.push(`Fila huérfana ${row.ID}`); continue; }
    const acceptance = executable(mapping.acceptance, row.ID);
    if (!mapping.tasks.includes(mapping.acceptance)) errors.push(`${row.ID}: aceptación fuera de sus tareas`);
    if (acceptance?.type !== "A") errors.push(`${row.ID}: falta tarea de aceptación explícita`);
    for (const id of mapping.tasks) {
      executable(id, row.ID);
      if (id !== mapping.acceptance && !acceptance?.dependsOn.includes(id)) errors.push(`${mapping.acceptance}: falta dependencia de fila ${row.ID}: ${id}`);
    }
    if (updated && updated.Tareas !== mapping.tasks.join(";")) errors.push(`${row.ID}: tareas de matriz/mapa no coinciden`);
    if (updated?.Estado_nuevo.toLowerCase() === "aceptado" && mapping.tasks.some(id => !accepted(id))) errors.push(`Fila aceptada ${row.ID} con tarea pendiente`);
  }
  for (const id of [...newRows.keys(), ...mappings.keys()]) if (!oldRows.has(id)) errors.push(`Fila inexistente en histórica ${id}`);
  for (const task of tasks.values()) {
    for (const dependency of task.dependsOn) if (!tasks.has(dependency)) errors.push(`${task.id}: dependencia inexistente ${dependency}`);
    if (task.parent) {
      const parent = tasks.get(task.parent);
      if (!parent || parent.size !== "P") errors.push(`${task.id}: padre inválido ${task.parent}`);
      for (const dependency of parent?.dependsOn || []) if (!task.dependsOn.includes(dependency)) errors.push(`${task.id}: falta dependencia heredada ${dependency}`);
      if (!task.title || task.size === "P" || !task.checks.length) errors.push(`${task.id}: hijo no ejecutable`);
    }
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) { errors.push(`Ciclo de dependencias en ${id}`); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of tasks.get(id)?.dependsOn || []) visit(dependency);
    // Un padre también depende del cierre de todos sus hijos; ignorarlos oculta ciclos.
    for (const child of tasks.values()) if (child.parent === id) visit(child.id);
    visiting.delete(id); visited.add(id);
  };
  for (const id of tasks.keys()) visit(id);
  for (const id of new Set([...checked, ...Object.keys(map.execution)])) {
    const task = tasks.get(id), execution = map.execution[id];
    if (!task) errors.push(`Registro de ejecución inexistente ${id}`);
    if (execution && !["pendiente", "en curso", "código implementado", "V1", "V2", "V3", "aceptado"].includes(execution.state)) errors.push(`${id}: estado de ejecución inválido`);
    if (checked.includes(id) && !accepted(id)) errors.push(`${id}: casilla marcada sin aceptación/evidencia`);
    if (!execution || execution.state !== "aceptado") continue;
    if (!execution.evidence.length) errors.push(`${id}: aceptación sin evidencia`);
    for (const evidence of execution.evidence) {
      if (!exists(evidence.file) || !/^[a-f0-9]{40}$/.test(evidence.head || "") || !evidence.environment || !evidence.commands?.length
        || evidence.commands.some(command => !command.command || command.exit !== 0)
        || task?.checks.some(check => !evidence.checks?.includes(check))) errors.push(`${id}: evidencia incompleta o inexistente`);
    }
    for (const dependency of task?.dependsOn || []) if (!accepted(dependency)) errors.push(`${id}: dependencia sin aceptar ${dependency}`);
    if (task?.size === "P") {
      const children = [...tasks.values()].filter(child => child.parent === id);
      if (!children.length || children.some(child => !accepted(child.id))) errors.push(`${id}: padre sin hijos aceptados`);
    }
  }
  return [...new Set(errors)];
}

function main() {
  const read = (file: string) => readFileSync(file, "utf8");
  const plan = parsePlan(read("plans/2026-11-11-plan-implementacion-faltantes.md"));
  if (plan.length !== 86) throw new Error(`Se esperaban 86 tickets del plan, hay ${plan.length}; revisar parser/plan.`);
  const map: TraceabilityMap = JSON.parse(read("tasks/mapa-implementacion-faltantes.json"));
  const checked = [...read("tasks/todo-implementacion-faltantes.md").matchAll(/^- \[x\] \*\*([^*]+)\*\*/gim)].map(match => match[1]).filter(id => !id.startsWith("Checkpoint") && !id.startsWith("Puerta"));
  const errors = validateTraceability({
    historical: parseCsv(read("docs/matriz-cumplimiento-sistema-2026-10-17.csv")),
    current: parseCsv(read("docs/matriz-cumplimiento-sistema-2026-11-11.csv")),
    plan, map, checked, exists: path => existsSync(path),
  });
  if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
  else console.log(JSON.stringify({ rows: map.rows.length, planTasks: plan.length, children: map.tasks.length, acceptedTasks: Object.values(map.execution).filter(item => item.state === "aceptado").length, errors: 0, scope: "Integridad documental; no acredita aceptación operativa ni despliegue." }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve("scripts/validate-faltantes.ts")) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : "No se pudo validar la trazabilidad"); process.exitCode = 1; }
}
