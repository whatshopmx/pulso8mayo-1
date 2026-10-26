import { inngest } from "@/lib/inngest/client";
import { runDocumentExpirationCheck } from "@/lib/cron/document-expiration-check";
import { runImssFileRetention } from '@/lib/cron/imss-file-retention';

export const cronDocumentExpirationCheck = inngest.createFunction(
  {
    id: "cron-document-expiration-check",
    triggers: [{ cron: "0 6 * * *" }],
    retries: 2,
  },
  async ({ step }) => {
    const documents = await step.run("run-document-expiration-check", () => runDocumentExpirationCheck());
    const imssRetention = await step.run('purge-expired-imss-files', () => runImssFileRetention());
    return { ...documents, imssRetention };
  }
);
