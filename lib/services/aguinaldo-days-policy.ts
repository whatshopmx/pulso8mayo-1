/** DIA-01: contrato puro. Los adaptadores entregan fechas civiles ya resueltas. */
export interface AusenciaAguinaldo {
  id: string;
  desde: string;
  hasta: string;
  aprobada: boolean;
  tratamiento: "COMPUTABLE" | "NO_COMPUTABLE" | "REVISAR";
}

interface DiasAguinaldoInput {
  anioFiscal: number;
  fechaAntiguedad: string;
  fechaBaja?: string;
  fechaCorte: string;
  zona: string;
  manual?: number;
  diasConTurno?: string[];
  ausencias?: AusenciaAguinaldo[];
}

function fechaCivil(value: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(`${value}T12:00:00Z`))
    || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new RangeError("Fecha civil inválida en la propuesta de días.");
  }
  return value;
}

function diasEntre(desde: string, hasta: string): string[] {
  const result: string[] = [];
  for (let time = Date.parse(`${desde}T12:00:00Z`); time <= Date.parse(`${hasta}T12:00:00Z`); time += 86_400_000) {
    result.push(new Date(time).toISOString().slice(0, 10));
  }
  return result;
}

export function proponerDiasAguinaldo(input: DiasAguinaldoInput) {
  if (!Number.isInteger(input.anioFiscal) || input.anioFiscal < 1970 || input.anioFiscal > 2200) throw new RangeError("Año fiscal inválido.");
  if (!input.zona) throw new RangeError("Falta zona de la propuesta de días.");
  new Intl.DateTimeFormat("en", { timeZone: input.zona }).format(0);
  const corte = fechaCivil(input.fechaCorte);
  const antiguedad = fechaCivil(input.fechaAntiguedad);
  const baja = input.fechaBaja === undefined ? undefined : fechaCivil(input.fechaBaja);
  if (baja && baja < antiguedad) throw new RangeError("La baja precede a la antigüedad.");
  if (input.manual !== undefined && (!Number.isInteger(input.manual) || input.manual < 0 || input.manual > 366)) throw new RangeError("Días manuales inválidos.");
  const desde = [antiguedad, `${input.anioFiscal}-01-01`].sort().at(-1)!;
  const hasta = [baja ?? `${input.anioFiscal}-12-31`, `${input.anioFiscal}-12-31`].sort()[0];
  const calendario = diasEntre(desde, hasta);
  const vigencia = new Set(calendario);
  const excluidos = new Set<string>();
  const protegidos = new Set<string>();
  const pendientes: string[] = [];
  const ids = new Set<string>();
  for (const ausencia of input.ausencias ?? []) {
    if (!ausencia.id || ids.has(ausencia.id) || !["COMPUTABLE", "NO_COMPUTABLE", "REVISAR"].includes(ausencia.tratamiento)) throw new RangeError("Identidad o tratamiento de ausencia inválido.");
    ids.add(ausencia.id);
    const inicio = fechaCivil(ausencia.desde); const fin = fechaCivil(ausencia.hasta);
    if (inicio > fin) throw new RangeError("Rango de ausencia inválido.");
    if (!ausencia.aprobada) continue;
    const dias = diasEntre(inicio > desde ? inicio : desde, fin < hasta ? fin : hasta);
    if (!dias.length) continue;
    if (ausencia.tratamiento === "REVISAR") pendientes.push(ausencia.id);
    else for (const dia of dias) (ausencia.tratamiento === "COMPUTABLE" ? protegidos : excluidos).add(dia);
  }
  const conflictos = [...excluidos].filter((dia) => protegidos.has(dia)).sort();
  for (const dia of conflictos) excluidos.delete(dia);
  const turnos = new Set((input.diasConTurno ?? []).map(fechaCivil).filter((dia) => vigencia.has(dia)));
  const diasPropuestos = calendario.length - excluidos.size;
  return { version: 1 as const, anioFiscal: input.anioFiscal, desde, hasta, fechaCorte: corte, zona: input.zona,
    diasCalendario: calendario.length, diasNoComputables: excluidos.size, diasPropuestos,
    diasUsados: input.manual ?? diasPropuestos, fuente: input.manual !== undefined ? "MANUAL" as const : "CALENDARIO_AUSENCIAS" as const,
    diasConTurno: turnos.size, pendientes, conflictos,
    fechasNoComputables: [...excluidos].sort(),
    ausencias: (input.ausencias ?? []).map(({ id, desde, hasta, aprobada, tratamiento }) => ({ id, desde, hasta, aprobada, tratamiento })),
    requiereRevision: input.manual === undefined && (pendientes.length > 0 || conflictos.length > 0),
    contieneProyeccion: calendario.length > 0 && corte < hasta,
    coberturaFuentes: "PARCIAL" as const,
  };
}
