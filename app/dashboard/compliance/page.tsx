import { PageContainer } from "@/components/shared";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { BranchService } from "@/lib/services/branch-service";
import { CompliancePageClient } from "./compliance-page-client";

/**
 * Compliance page — Server Component (AD-2 floor).
 *
 * Branches are fetched server-side from `BranchService.listBranches` (the
 * same call the layout makes) so the page doesn't re-fetch `/api/branches`
 * client-side via useEffect. The interactive Tabs/branch-aware UI lives in
 * the client child, which reads branch scope from `useBranch()` (the header
 * BranchScopeControl; AD-1).
 */
export default async function CompliancePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const companyId = session?.user?.companyId;

  if (!companyId) {
    // No tenant context yet (rare; layout normally redirects). Render shell.
    return (
      <PageContainer>
        <CompliancePageClient branches={[]} />
      </PageContainer>
    );
  }

  const branches = await BranchService.listBranches(companyId);
  const branchList = branches.map((b) => ({ id: b.id, name: b.name }));

  return (
    <PageContainer>
      <CompliancePageClient branches={branchList} companyId={companyId} />
    </PageContainer>
  );
}