import { inngest } from "@/lib/inngest/client";
import { runDocumentExpirationCheck } from "@/lib/cron/document-expiration-check";

export const cronDocumentExpirationCheck = inngest.createFunction(
  {
    id: "cron-document-expiration-check",
    triggers: [{ cron: "0 6 * * *" }],
    retries: 2,
  },
  async ({ step }) => {
    return await step.run("run-document-expiration-check", () => runDocumentExpirationCheck());
  }
);
