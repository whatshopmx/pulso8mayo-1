// Task 8 (plan tasks/plan-aguinaldo.md): recordatorio de dispersión de
// aguinaldo — diciembre, días 1 a 19, 08:00.
//
// El Art. 87 LFT obliga a pagar el aguinaldo antes del 19 de diciembre;
// incumplir es multa de 50 a 5,000 UMA (Art. 1002). Este cron alerta a la
// dirección cuando el año todavía NO tiene corrida de aguinaldo, cuando la
// corrida no terminó de timbrarse y cuando está timbrada pero la dispersión
// real no está confirmada.
//
// OPS-02.nomina.D:
//   • Cada empresa se lee en su propia transacción con contexto
//     (`withCompanyContext`). La lectura multiempresa anterior dependía del
//     bypass del dueño y se apagaría con el lote RLS de nómina.
//   • Los destinatarios salen de `ROLES_RECORDATORIO` (roles que el RBAC de
//     rutas reconoce y que pueden ejecutar la nómina). No se depende de
//     `OWNER`, que no existe en `UserRole`.
//   • Una corrida `COMPLETED` es timbrado, no pago: el aviso `TIMBRADO` pide
//     confirmar la dispersión real y no la declara pagada.
//
// Dedupe por empresa + año + estado: un aviso por transición (sin corrida →
// timbrado) y ninguno repetido el mismo año. [AC: no duplica notificaciones el
// mismo día, no duplica en todo diciembre].

import { inngest } from "../client";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { NotificationDispatcher } from "@/lib/services/notification-dispatcher";
import {
  clasificarEstadoAguinaldo,
  construirRecordatorio,
  destinatariosPorEmpresa,
  enumerarEmpresasRecordatorio,
  leerEstadoAguinaldo,
  type EstadoAguinaldoEmpresa,
} from "@/lib/services/aguinaldo-reminder-service";

export const cronAguinaldoReminder = inngest.createFunction(
  {
    id: "cron-aguinaldo-reminder",
    triggers: [{ cron: "0 8 1-19 12 *" }], // 1 al 19 de diciembre, 08:00
    retries: 2,
  },
  async ({ step }) => {
    const hoy = new Date();
    const anio = hoy.getFullYear(); // el aguinaldo del año vence el 19-dic del mismo año

    // 1. Empresas con dirección activa. `sinDestinatario` son empresas cuyo
    //    único rol de dirección no existe en el RBAC de rutas (p. ej. OWNER):
    //    no se notifican, pero quedan en el resultado del job.
    const empresas = await step.run("empresas-recordatorio", () =>
      enumerarEmpresasRecordatorio(),
    );

    if (empresas.conDestinatario.length === 0) {
      return {
        anio,
        empresas: 0,
        sinDestinatario: empresas.sinDestinatario.length,
        notificadas: 0,
      };
    }

    // 2. Destinatarios por empresa (una sola lectura, sin RLS en `users`).
    const destinatarios = await step.run("destinatarios", () =>
      destinatariosPorEmpresa(empresas.conDestinatario),
    );

    // 3. Estado del aguinaldo POR EMPRESA, cada uno con su contexto.
    const estados: EstadoAguinaldoEmpresa[] = [];
    for (const companyId of empresas.conDestinatario) {
      // `step.run` devuelve el objeto serializado (campos opcionales): se
      // reconstruye el contrato explícitamente en vez de castear.
      const leido = await step.run(`estado-${companyId}`, () =>
        leerEstadoAguinaldo(companyId, anio),
      );
      const estadoCorrida = leido.estadoCorrida ?? null;
      estados.push({
        companyId: leido.companyId ?? companyId,
        anioFiscal: leido.anioFiscal ?? anio,
        estado: leido.estado ?? clasificarEstadoAguinaldo(estadoCorrida),
        estadoCorrida,
        timbradoCompleto: leido.timbradoCompleto ?? false,
      });
    }

    // 4. Un aviso por empresa y estado, con dedupe por título exacto.
    let notificadas = 0;
    for (const estado of estados) {
      const recipients = destinatarios[estado.companyId] ?? [];
      if (recipients.length === 0) continue;

      const recordatorio = construirRecordatorio(estado);

      notificadas += await step.run(`avisar-${estado.companyId}`, async () => {
        const yaAvisados = await db
          .select({ id: notifications.id })
          .from(notifications)
          .where(
            and(
              inArray(notifications.userId, recipients),
              eq(notifications.title, recordatorio.titulo),
            ),
          )
          .limit(1);
        if (yaAvisados.length > 0) return 0;

        let delivered = 0;
        for (const userId of recipients) {
          try {
            await NotificationDispatcher.sendNotification({
              userId,
              title: recordatorio.titulo,
              message: recordatorio.mensaje,
              type: recordatorio.tipo,
              eventType: recordatorio.eventType,
              actionUrl: "/dashboard/labor/payroll",
              actionLabel: "Ir a Payroll",
              metadata: {
                companyId: estado.companyId,
                anioFiscal: anio,
                estado: recordatorio.estado,
                estadoCorrida: estado.estadoCorrida,
                dedupe: recordatorio.dedupe,
              },
            });
            delivered++;
          } catch (err) {
            console.warn(
              `[cronAguinaldoReminder] Falló el envío para empresa ${estado.companyId} → ${userId}:`,
              err,
            );
          }
        }
        return delivered;
      });
    }

    return {
      anio,
      empresas: estados.length,
      sinDestinatario: empresas.sinDestinatario.length,
      notificadas,
    };
  },
);
