import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { cfdiNominaTimbrados } from "@/lib/db/schema";
import type { NominaTimbradoInput, NominaTimbradoStatus, RespuestaPac } from "./fiscal-service";

interface EntregaResultado { status: NominaTimbradoStatus; data: RespuestaPac; fecha?: string }
interface Intencion { version: 1; fingerprint: string; attemptId: string; outcome: string }
/** Sólo errores locales anteriores al fetch: permiten un nuevo intento sin riesgo de otro folio. */
export class AguinaldoNoEnviadoError extends Error {}

/** Orden de propiedades independiente del llamador; el actor no cambia la obligación autorizada. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

/** Una intención durable precede al PAC. PENDIENTE no caduca ni autoriza otro envío. */
export async function entregarAguinaldo(input: NominaTimbradoInput, enviar: () => Promise<EntregaResultado>) {
  const solicitud = Object.fromEntries(Object.entries(input).filter(([key]) => key !== "performedBy"));
  const fingerprint = createHash("sha256").update(JSON.stringify(canonical(solicitud))).digest("hex");
  const intencion: Intencion = { version: 1, fingerprint, attemptId: randomUUID(), outcome: "SENDING" };
  const valores = {
    companyId: input.companyId, empleadoRfc: input.empleadoRfc, empleadoNombre: input.empleadoNombre, periodo: input.periodo,
    totalPercepcionesCents: input.totalPercepciones, totalDeduccionesCents: input.totalDeducciones,
    status: "PENDIENTE" as const, uuid: null, selloDigital: null, cadenaOriginal: null,
    rawResponse: { pulsoAguinaldoDelivery: intencion }, timbradoPor: input.performedBy ?? null, updatedAt: new Date(),
  };
  const scope = { companyId: input.companyId, actorId: input.performedBy };
  const [adquirida] = await withCompanyContext(scope, (tx) => tx.insert(cfdiNominaTimbrados).values(valores).onConflictDoUpdate({
    target: [cfdiNominaTimbrados.companyId, cfdiNominaTimbrados.empleadoRfc, cfdiNominaTimbrados.periodo],
    set: valores,
    setWhere: and(eq(cfdiNominaTimbrados.status, "RECHAZADO"),
      sql`${cfdiNominaTimbrados.rawResponse}->'pulsoAguinaldoDelivery'->>'fingerprint' = ${fingerprint}`,
      sql`${cfdiNominaTimbrados.rawResponse}->'pulsoAguinaldoDelivery'->>'outcome' = 'REJECTED'`),
  }).returning());
  if (!adquirida) {
    const [existente] = await withCompanyContext(scope, (tx) => tx.select().from(cfdiNominaTimbrados).where(and(
      eq(cfdiNominaTimbrados.companyId, input.companyId), eq(cfdiNominaTimbrados.empleadoRfc, input.empleadoRfc),
      eq(cfdiNominaTimbrados.periodo, input.periodo),
    )).limit(1));
    const guardada = (existente?.rawResponse as { pulsoAguinaldoDelivery?: Intencion } | null)?.pulsoAguinaldoDelivery;
    if (!existente || guardada?.fingerprint !== fingerprint) {
      throw new RangeError("La huella de la solicitud fiscal no coincide o falta: requiere conciliación del comprobante existente.");
    }
    return existente;
  }
  const guardar = async (resultado: EntregaResultado, outcome: string) => {
    const [fila] = await withCompanyContext(scope, (tx) => tx.update(cfdiNominaTimbrados).set({
      status: resultado.status, uuid: resultado.data.uuid || null, selloDigital: String(resultado.data.sello_digital ?? "") || null,
      cadenaOriginal: String(resultado.data.cadena_original ?? "") || null,
      fechaTimbrado: resultado.fecha ? new Date(resultado.fecha) : null,
      rawResponse: { ...resultado.data, pulsoAguinaldoDelivery: { ...intencion, outcome } }, updatedAt: new Date(),
    }).where(and(eq(cfdiNominaTimbrados.id, adquirida.id), eq(cfdiNominaTimbrados.status, "PENDIENTE"),
      sql`${cfdiNominaTimbrados.rawResponse}->'pulsoAguinaldoDelivery'->>'attemptId' = ${intencion.attemptId}`)).returning());
    if (!fila) throw new Error("La intención fiscal cambió durante el envío; requiere conciliación.");
    return fila;
  };
  let resultado: EntregaResultado;
  try { resultado = await enviar(); }
  catch (error) {
    const noEnviado = error instanceof AguinaldoNoEnviadoError;
    await guardar({ status: noEnviado ? "RECHAZADO" : "PENDIENTE", data: { error: error instanceof Error ? error.message : String(error) } }, noEnviado ? "REJECTED" : "UNCERTAIN");
    throw error;
  }
  return guardar(resultado, resultado.status === "TIMBRADO" ? "CONFIRMED" : resultado.status === "RECHAZADO" ? "REJECTED" : "UNCERTAIN");
}
