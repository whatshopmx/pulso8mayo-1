/**
 * DIA-02A — adaptador de fuentes reales para los días computables de aguinaldo.
 *
 * El contrato puro vive en `aguinaldo-days-policy.ts` (DIA-01): calendario de
 * vigencia menos la unión de ausencias aprobadas con tratamiento NO_COMPUTABLE
 * explícito. Este módulo NO cuenta "días con checada": los turnos son evidencia
 * de actividad, nunca denominador de cobertura. Reglas respetadas:
 *
 *   • Vacaciones y permisos se cruzan sin duplicar: los días ya cubiertos por
 *     una vacación aprobada se restan de los permisos antes de clasificarlos,
 *     de modo que un permiso con nombre ambiguo sobre un día de vacaciones no
 *     inventa una revisión pendiente.
 *   • Sólo permisos APPROVED/COMPLETED producen ausencias; PENDING no es falta.
 *   • El catálogo (`name` + `isPaid`) no basta por sí solo para justificar el
 *     tratamiento jurídico: lo desconocido se entrega REVISAR (DIA-01).
 *   • Fechas civiles de solicitudes se leen como civiles (`to_char` sobre el
 *     timestamp sin zona); los turnos son instantes y se convierten a día local
 *     con la zona IANA de la sucursal. No se aplica la misma conversión a ambas
 *     semánticas.
 */
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  branches,
  leaveRequests,
  leaveTypes,
  shiftSessions,
  users,
  vacationRequests,
} from "@/lib/db/schema";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { hoyCivilAguinaldo } from "./aguinaldo-payment";
import type { AusenciaAguinaldo } from "./aguinaldo-days-policy";

/** Zona usada sólo cuando la sucursal no declara una válida; siempre se avisa. */
export const ZONA_DIAS_POR_DEFECTO = "America/Mexico_City";

export type TratamientoAusencia = "COMPUTABLE" | "NO_COMPUTABLE" | "REVISAR";

export interface ClasificacionAusencia {
  tratamiento: TratamientoAusencia;
  /** Justificación escrita que la UI/preview puede mostrar (DIA-01). */
  base: string;
}

/** Normaliza el nombre libre del catálogo: mayúsculas, sin acentos ni puntuación. */
export function normalizarNombreTipo(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Clasificación explícita de un tipo de permiso para el cómputo del aguinaldo.
 *
 * Orden deliberado: primero los tratamientos protegidos (aunque `isPaid` esté
 * mal capturado), después vacaciones, después enfermedad general (PROFEDET),
 * después "sin goce" por dato de pago y al final REVISAR. Un nombre libre que
 * no encaja en ninguna categoría NO se copia a ciegas desde `isPaid`.
 */
export function clasificarAusencia(tipo: {
  name?: string | null;
  isPaid?: boolean | null;
}): ClasificacionAusencia {
  const nombre = normalizarNombreTipo(tipo.name ?? "");
  if (!nombre) {
    return {
      tratamiento: "REVISAR",
      base: "Tipo de permiso sin nombre: el adaptador no puede justificar su tratamiento (DIA-01).",
    };
  }
  if (/MATERNIDAD|MATERNITY/.test(nombre)) {
    return {
      tratamiento: "COMPUTABLE",
      base: "Maternidad protegida (LFT art. 170; PROFEDET la incluye en el cómputo).",
    };
  }
  if (/PATERNIDAD|PATERNITY/.test(nombre)) {
    return {
      tratamiento: "COMPUTABLE",
      base: "Paternidad protegida (LFT art. 132; PROFEDET la incluye en el cómputo).",
    };
  }
  if (/RIESGO|WORK_RISK|ACCIDENTE_DE_TRABAJO/.test(nombre)) {
    return {
      tratamiento: "COMPUTABLE",
      base: "Riesgo de trabajo protegido (LFT art. 487; PROFEDET lo incluye en el cómputo).",
    };
  }
  if (/VACACION|VACATION/.test(nombre)) {
    return {
      tratamiento: "COMPUTABLE",
      base: "Vacaciones aprobadas (LFT arts. 76/78): no requieren checada para contar.",
    };
  }
  if (/ENFERMEDAD_GENERAL|SICK|INCAPACIDAD_ENFERMEDAD/.test(nombre)) {
    return {
      tratamiento: "NO_COMPUTABLE",
      base: "Enfermedad general (PROFEDET): no computa salvo mejor condición contractual; regístrala con override manual.",
    };
  }
  if (tipo.isPaid === false) {
    return {
      tratamiento: "NO_COMPUTABLE",
      base: "Permiso sin goce (isPaid = false): PROFEDET no lo computa para el aguinaldo.",
    };
  }
  return {
    tratamiento: "REVISAR",
    base: "El nombre/isPaid del catálogo no basta para justificar el tratamiento jurídico; requiere revisión u override manual (DIA-01).",
  };
}

/** Fecha civil `YYYY-MM-DD` válida o RangeError. */
export function fechaCivilDias(value: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(`${value}T12:00:00Z`))
    || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new RangeError("Fecha civil inválida en las fuentes de días.");
  }
  return value;
}

/** Zona IANA válida o null (para no reventar la preview completa por una sucursal). */
export function zonaValida(zona: string | null | undefined): string | null {
  if (!zona) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zona }).format(0);
    return zona;
  } catch {
    return null;
  }
}

/** Día civil local de un instante en una zona IANA explícita. */
export function diaCivilEnZona(instant: Date, zona: string): string {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const valor = (tipo: "year" | "month" | "day") =>
    partes.find((parte) => parte.type === tipo)?.value ?? "";
  return `${valor("year")}-${valor("month")}-${valor("day")}`;
}

/**
 * Corte explícito: nunca posterior al cierre del año causado. Proyectar el
 * resto del año es visible (`contieneProyeccion` en el contrato), jamás se
 * convierte en falta.
 */
export function resolverFechaCorte(anioFiscal: number, hoy: string): string {
  fechaCivilDias(hoy);
  const fin = `${anioFiscal}-12-31`;
  return hoy > fin ? fin : hoy;
}

function diasEntre(desde: string, hasta: string): string[] {
  const dias: string[] = [];
  for (let t = Date.parse(`${desde}T12:00:00Z`); t <= Date.parse(`${hasta}T12:00:00Z`); t += 86_400_000) {
    dias.push(new Date(t).toISOString().slice(0, 10));
  }
  return dias;
}

/**
 * Parte un rango civil en los segmentos que NO están cubiertos por otro
 * conjunto (vacaciones). Puro y testeable; evita clasificar dos veces el mismo
 * día cuando una vacación también aparece como permiso.
 */
export function segmentosSinCubrir(
  desde: string,
  hasta: string,
  cubierto: ReadonlySet<string>
): Array<{ desde: string; hasta: string }> {
  fechaCivilDias(desde);
  fechaCivilDias(hasta);
  if (desde > hasta) throw new RangeError("Rango de ausencia inválido.");
  const segmentos: Array<{ desde: string; hasta: string }> = [];
  let inicio: string | null = null;
  let anterior: string | null = null;
  for (const dia of diasEntre(desde, hasta)) {
    if (cubierto.has(dia)) {
      if (inicio && anterior) segmentos.push({ desde: inicio, hasta: anterior });
      inicio = null;
      anterior = null;
      continue;
    }
    inicio ??= dia;
    anterior = dia;
  }
  if (inicio && anterior) segmentos.push({ desde: inicio, hasta: anterior });
  return segmentos;
}

export interface FuenteDiasEmpleado {
  /** Zona IANA con la que se resolvieron los turnos de este empleado. */
  zona: string;
  /** Días civiles locales con turno COMPLETED (evidencia, no cobertura). */
  diasConTurno: string[];
  ausencias: AusenciaAguinaldo[];
}

export interface FuentesDiasAguinaldo {
  anioFiscal: number;
  fechaCorte: string;
  porUsuario: Record<string, FuenteDiasEmpleado>;
  /** Avisos de cobertura (PARCIAL nunca se presenta como verdad completa). */
  advertencias: string[];
  coberturaFuentes: "PARCIAL";
}

export interface CargarFuentesDiasInput {
  companyId: string;
  anioFiscal: number;
  fechaCorte?: string;
  /** Plantilla ya resuelta por la preview: empresa + sucursal + antigüedad. */
  empleados: Array<{ userId: string; branchId: string | null }>;
  /** Hoy civil explícito (la preview pasa su fecha; pruebas fijan el reloj). */
  hoy?: string;
}

/**
 * Lee las fuentes reales de la empresa y entrega por empleado las entradas del
 * contrato DIA-01. Una consulta por fuente, dentro del contexto de empresa.
 */
export async function cargarFuentesDiasAguinaldo(
  input: CargarFuentesDiasInput
): Promise<FuentesDiasAguinaldo> {
  if (!Number.isInteger(input.anioFiscal) || input.anioFiscal < 1970 || input.anioFiscal > 2200) {
    throw new RangeError(`anioFiscal inválido: ${input.anioFiscal}`);
  }
  const anio = input.anioFiscal;
  const hoy = input.hoy ?? hoyCivilAguinaldo();
  const fechaCorte = fechaCivilDias(input.fechaCorte ?? resolverFechaCorte(anio, hoy));

  const inicioAnio = `${anio}-01-01`;
  const finAnio = `${anio}-12-31`;
  // Ventana de instantes con holgura de un día: un turno nocturno del 31-dic
  // puede empezar el 1-ene UTC. El contrato recorta después a días civiles.
  const desdeInstante = new Date(`${inicioAnio}T00:00:00Z`);
  desdeInstante.setUTCDate(desdeInstante.getUTCDate() - 1);
  const hastaInstante = new Date(`${finAnio}T23:59:59Z`);
  hastaInstante.setUTCDate(hastaInstante.getUTCDate() + 1);

  const { zonas, turnos, permisos, vacaciones } = await withCompanyContext(
    { companyId: input.companyId },
    async (tx) => {
      const sucursales = await tx
        .select({ id: branches.id, timezone: branches.timezone })
        .from(branches)
        .where(eq(branches.companyId, input.companyId));

      const turnosRaw = await tx
        .select({ userId: shiftSessions.userId, iniciado: shiftSessions.startedAt })
        .from(shiftSessions)
        .innerJoin(users, eq(users.id, shiftSessions.userId))
        .where(and(
          eq(users.companyId, input.companyId),
          eq(shiftSessions.status, "COMPLETED"),
          gte(shiftSessions.startedAt, desdeInstante),
          lte(shiftSessions.startedAt, hastaInstante),
        ));

      const permisosRaw = await tx
        .select({
          id: leaveRequests.id,
          userId: leaveRequests.userId,
          desde: sql<string>`to_char(${leaveRequests.startDate}, 'YYYY-MM-DD')`,
          hasta: sql<string>`to_char(${leaveRequests.endDate}, 'YYYY-MM-DD')`,
          nombre: leaveTypes.name,
          pagado: leaveTypes.isPaid,
        })
        .from(leaveRequests)
        .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
        .where(and(
          eq(leaveRequests.companyId, input.companyId),
          eq(leaveTypes.companyId, input.companyId),
          inArray(leaveRequests.status, ["APPROVED", "COMPLETED"] as const),
          lte(leaveRequests.startDate, hastaInstante),
          gte(leaveRequests.endDate, desdeInstante),
        ))
        .orderBy(leaveRequests.startDate, leaveRequests.id);

      const vacacionesRaw = await tx
        .select({
          id: vacationRequests.id,
          userId: vacationRequests.userId,
          desde: sql<string>`to_char(${vacationRequests.startDate}, 'YYYY-MM-DD')`,
          hasta: sql<string>`to_char(${vacationRequests.endDate}, 'YYYY-MM-DD')`,
        })
        .from(vacationRequests)
        .where(and(
          eq(vacationRequests.companyId, input.companyId),
          inArray(vacationRequests.status, ["APPROVED", "COMPLETED"] as const),
          lte(vacationRequests.startDate, hastaInstante),
          gte(vacationRequests.endDate, desdeInstante),
        ))
        .orderBy(vacationRequests.startDate, vacationRequests.id);

      const zonas = new Map<string, string | null>();
      for (const sucursal of sucursales) zonas.set(sucursal.id, zonaValida(sucursal.timezone));
      return { zonas, turnos: turnosRaw, permisos: permisosRaw, vacaciones: vacacionesRaw };
    }
  );

  const advertencias: string[] = [];
  const porUsuario: Record<string, FuenteDiasEmpleado> = {};
  const sinZona: string[] = [];

  for (const empleado of input.empleados) {
    const zonaDeclarada = empleado.branchId ? zonas.get(empleado.branchId) ?? null : null;
    const zona = zonaDeclarada ?? ZONA_DIAS_POR_DEFECTO;
    if (!zonaDeclarada) sinZona.push(empleado.userId);
    porUsuario[empleado.userId] = { zona, diasConTurno: [], ausencias: [] };
  }
  if (sinZona.length > 0) {
    advertencias.push(
      `${sinZona.length} empleado(s) sin zona IANA válida en su sucursal: se usó ${ZONA_DIAS_POR_DEFECTO} para asignar el día local de sus turnos.`
    );
  }

  for (const turno of turnos) {
    const fuente = porUsuario[turno.userId];
    if (!fuente) continue; // empleado fuera de la plantilla consultada
    const dia = diaCivilEnZona(turno.iniciado, fuente.zona);
    if (dia >= inicioAnio && dia <= finAnio) fuente.diasConTurno.push(dia);
  }

  // 1) Vacaciones aprobadas: COMPUTABLE y protegen el día de cualquier permiso
  //    que lo repita con un nombre ambiguo.
  const vacacionesPorUsuario = new Map<string, Array<{ id: string; desde: string; hasta: string }>>();
  const cubiertoPorVacaciones = new Map<string, Set<string>>();
  for (const vacacion of vacaciones) {
    const fuente = porUsuario[vacacion.userId];
    if (!fuente) continue;
    const desde = fechaCivilDias(vacacion.desde);
    const hasta = fechaCivilDias(vacacion.hasta);
    const cubierto = cubiertoPorVacaciones.get(vacacion.userId) ?? new Set<string>();
    for (const dia of diasEntre(desde, hasta)) cubierto.add(dia);
    cubiertoPorVacaciones.set(vacacion.userId, cubierto);
    const lista = vacacionesPorUsuario.get(vacacion.userId) ?? [];
    lista.push({ id: vacacion.id, desde, hasta });
    vacacionesPorUsuario.set(vacacion.userId, lista);
  }
  for (const [userId, lista] of vacacionesPorUsuario) {
    const fuente = porUsuario[userId];
    for (const vacacion of lista) {
      fuente.ausencias.push({
        id: `vacacion:${vacacion.id}`,
        desde: vacacion.desde,
        hasta: vacacion.hasta,
        aprobada: true,
        tratamiento: "COMPUTABLE",
      });
    }
  }

  // 2) Permisos aprobados, ya descontados los días cubiertos por vacaciones.
  for (const permiso of permisos) {
    const fuente = porUsuario[permiso.userId];
    if (!fuente) continue;
    const clasificacion = clasificarAusencia({ name: permiso.nombre, isPaid: permiso.pagado });
    const cubierto = cubiertoPorVacaciones.get(permiso.userId);
    const segmentos = cubierto && cubierto.size > 0
      ? segmentosSinCubrir(fechaCivilDias(permiso.desde), fechaCivilDias(permiso.hasta), cubierto)
      : [{ desde: fechaCivilDias(permiso.desde), hasta: fechaCivilDias(permiso.hasta) }];
    for (const [indice, segmento] of segmentos.entries()) {
      fuente.ausencias.push({
        id: `permiso:${permiso.id}:${indice}`,
        desde: segmento.desde,
        hasta: segmento.hasta,
        aprobada: true,
        tratamiento: clasificacion.tratamiento,
      });
    }
  }

  // Determinismo para la evidencia: días y ausencias ordenados.
  for (const fuente of Object.values(porUsuario)) {
    fuente.diasConTurno = [...new Set(fuente.diasConTurno)].sort();
    fuente.ausencias.sort((a, b) => a.desde.localeCompare(b.desde) || a.id.localeCompare(b.id));
  }

  advertencias.push(
    "Cobertura PARCIAL: los turnos COMPLETED acreditan actividad, no prueban ausencia en los días sin checada; faltas y permisos sólo cuentan con estado aprobado."
  );

  return {
    anioFiscal: anio,
    fechaCorte,
    porUsuario,
    advertencias,
    coberturaFuentes: "PARCIAL",
  };
}
