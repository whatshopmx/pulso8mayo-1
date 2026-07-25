import { inngest } from "@/lib/inngest/client";
import { db } from "@/lib/db";
import { reportTemplates, reportExecutionHistory } from "@/lib/db/schema";
import { eq, and, lte } from "drizzle-orm";
import { sendEmail, buildEmailHtml } from "@/lib/services/email-service";
import { WhatsAppService } from "@/lib/services/whatsapp-service";

interface ScheduleConfig {
  frequency?: string;
  time?: string;
  dayOfWeek?: string;
  dayOfMonth?: string;
  format?: string;
  timezone?: string;
}

function calculateNextRunDate(schedule: ScheduleConfig, fromDate: Date): Date | null {
  if (!schedule) return null;
  const next = new Date(fromDate);
  const frequency = schedule.frequency || "DAILY";
  switch (frequency) {
    case "DAILY": next.setDate(next.getDate() + 1); break;
    case "WEEKLY": next.setDate(next.getDate() + 7); break;
    case "MONTHLY": next.setMonth(next.getMonth() + 1); break;
    default: return null;
  }
  if (schedule.time) {
    const [hours, minutes] = schedule.time.split(":").map(Number);
    next.setHours(hours || 7, minutes || 0, 0, 0);
  }
  return next;
}

function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

function getFrequencyLabel(freq: string): string {
  const labels: Record<string, string> = {
    DAILY: "diario",
    WEEKLY: "semanal",
    MONTHLY: "mensual",
  };
  return labels[freq] || freq.toLowerCase();
}

export const cronScheduledReports = inngest.createFunction(
  {
    id: "cron-scheduled-reports",
    triggers: [{ cron: "0 6 * * *" }],
    retries: 2,
  },
  async ({ step }) => {
    return await step.run("process-scheduled-reports", async () => {
      const now = new Date();
      let processed = 0;
      let failed = 0;
      const errors: string[] = [];

      const dueReports = await db
        .select()
        .from(reportTemplates)
        .where(
          and(
            eq(reportTemplates.reportType, "SCHEDULED"),
            lte(reportTemplates.nextRunAt, now)
          )
        )
        .limit(50);

      for (const report of dueReports) {
        try {
          const startTime = Date.now();
          const schedule = (report.schedule || {}) as ScheduleConfig;
          const format = schedule.format || "PDF";

          await db
            .update(reportTemplates)
            .set({ lastRunStatus: "RUNNING" })
            .where(eq(reportTemplates.id, report.id));

          const dateFrom = report.lastRunAt
            ? new Date(report.lastRunAt.getTime() - 24 * 60 * 60 * 1000)
            : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          const dateTo = now;

          const baseUrl = getBaseUrl();
          const generateRes = await fetch(`${baseUrl}/api/reports/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              reportId: report.dataSource,
              format: format.toLowerCase(),
              dateFrom: dateFrom.toISOString().split("T")[0],
              dateTo: dateTo.toISOString().split("T")[0],
              branchId: report.branchId || null,
            }),
          });

          if (!generateRes.ok) {
            throw new Error(
              `Report generation failed (${generateRes.status}) for ${report.dataSource}`
            );
          }

          const arrayBuffer = await generateRes.arrayBuffer();
          const fileBuffer = Buffer.from(arrayBuffer);
          const contentType =
            generateRes.headers.get("Content-Type") ||
            (format === "EXCEL"
              ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              : "application/pdf");
          const fileSize = fileBuffer.length;

          let fileUrl: string | null = null;
          let fileKey: string | null = null;
          try {
            const {
              uploadToR2,
              generateFileKey,
              isR2Configured,
            } = await import("@/lib/storage/r2-client");
            if (isR2Configured()) {
              const ext = format === "EXCEL" ? "xlsx" : "pdf";
              const fileName = `${report.dataSource}-${now.toISOString().split("T")[0]}.${ext}`;
              fileKey = generateFileKey(
                report.companyId,
                "SYSTEM_CRON",
                "scheduled-reports",
                fileName
              );
              fileUrl = await uploadToR2(fileBuffer, fileKey, contentType);
            }
          } catch (r2Err) {
            console.warn(
              "[CRON_REPORT] R2 upload failed (non-fatal):",
              r2Err
            );
          }

          const deliveryMethod = report.deliveryMethod || "EMAIL";
          const deliveryEmails = (report.deliveryEmails || []) as string[];

          if (
            (deliveryMethod === "EMAIL" || deliveryMethod === "BOTH") &&
            deliveryEmails.length > 0
          ) {
            try {
              const fileName = `reporte-${report.dataSource}-${now.toISOString().split("T")[0]}.${format === "EXCEL" ? "xlsx" : "pdf"}`;
              await sendEmail({
                to: deliveryEmails,
                subject: `📊 Reporte Programado: ${report.name}`,
                html: buildEmailHtml({
                  title: `Reporte: ${report.name}`,
                  content: `
                    <p>Se ha generado el reporte programado <strong>${report.name}</strong>.</p>
                    <p><strong>Fecha de generación:</strong> ${now.toLocaleDateString("es-MX")}</p>
                    <p><strong>Tipo:</strong> ${report.dataSource}</p>
                    <p><strong>Formato:</strong> ${format}</p>
                    <p><strong>Frecuencia:</strong> ${getFrequencyLabel(schedule.frequency || "DAILY")}</p>
                    ${fileUrl ? `<p>También puedes descargarlo desde tu <a href="${baseUrl}/dashboard/reports">dashboard de reportes</a>.</p>` : ""}
                  `,
                  footerText:
                    "Este es un reporte automático generado por Pulso HORECA.",
                }),
                attachments: [
                  {
                    filename: fileName,
                    content: fileBuffer,
                  },
                ],
              });
            } catch (emailErr) {
              console.warn(
                "[CRON_REPORT] Email send failed (non-fatal):",
                emailErr
              );
            }
          }

          if (deliveryMethod === "BOTH") {
            try {
              await WhatsAppService.sendMessage(
                deliveryEmails[0],
                `📊 *Reporte Generado: ${report.name}*\n\nTu reporte ${getFrequencyLabel(schedule.frequency || "DAILY")} ya está listo.\n\nRevisa tu correo o el dashboard para descargarlo.`
              );
            } catch (waErr) {
              console.warn(
                "[CRON_REPORT] WhatsApp notification failed (non-fatal):",
                waErr
              );
            }
          }

          const duration = Date.now() - startTime;
          await db.insert(reportExecutionHistory).values({
            templateId: report.id,
            companyId: report.companyId,
            reportType: "SCHEDULED",
            dataSource: report.dataSource,
            executedBy: "SYSTEM_CRON",
            executedAt: now,
            filters: report.filters,
            fields: report.fields,
            status: "SUCCESS",
            fileSize,
            fileUrl,
            fileKey,
            durationMs: duration,
          });

          const nextRun = calculateNextRunDate(schedule, now);
          await db
            .update(reportTemplates)
            .set({
              lastRunAt: now,
              lastRunStatus: "SUCCESS",
              nextRunAt: nextRun,
              updatedAt: now,
            })
            .where(eq(reportTemplates.id, report.id));

          processed++;
        } catch (err) {
          failed++;
          const errorMsg =
            err instanceof Error ? err.message : "Unknown error";
          errors.push(`Report ${report.name || report.dataSource}: ${errorMsg}`);

          await db
            .update(reportTemplates)
            .set({
              lastRunAt: now,
              lastRunStatus: "FAILED",
              updatedAt: now,
            })
            .where(eq(reportTemplates.id, report.id));

          await db.insert(reportExecutionHistory).values({
            templateId: report.id,
            companyId: report.companyId,
            reportType: "SCHEDULED",
            dataSource: report.dataSource,
            executedBy: "SYSTEM_CRON",
            executedAt: now,
            filters: report.filters,
            fields: report.fields,
            status: "FAILED",
            errorMessage: errorMsg,
          });
        }
      }

      return {
        success: true,
        processed,
        failed,
        errors,
        timestamp: now.toISOString(),
      };
    });
  }
);
