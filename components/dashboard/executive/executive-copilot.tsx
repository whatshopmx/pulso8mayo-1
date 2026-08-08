import { TierService } from "@/lib/services/tier-service";
import { ExecutiveCopilotClient } from "./executive-copilot-client";

/**
 * Wrapper de servidor del copiloto ejecutivo (T14b).
 *
 * Resuelve el gate del tier aquí para que el cliente pinte el CTA de upgrade en
 * el primer render, sin un fetch extra a `GET /api/executive/reason`.
 */
export async function ExecutiveCopilot({ companyId }: { companyId: string }) {
  const gate = await TierService.getFeatureGate(companyId, "ai_copilot");
  return <ExecutiveCopilotClient gate={gate} />;
}
