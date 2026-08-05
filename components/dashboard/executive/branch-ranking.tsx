import { CrossBranchService } from "@/lib/services/cross-branch-service";
import { BranchRankingClient } from "./branch-ranking-client";

export async function BranchRanking({ companyId }: { companyId: string }) {
  const compliance = await CrossBranchService.getAllBranchesCompliance(companyId);
  return <BranchRankingClient compliance={compliance} />;
}
