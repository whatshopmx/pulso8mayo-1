"use client";

import { useEffect } from "react";
import { TransferList } from "@/components/inventory/transfer-list";
import { TransferRequest } from "@/components/inventory/transfer-request";
import { PageHeader, PageContainer } from "@/components/shared";
import { useBranch } from "@/lib/branch-context";
import { useBranches } from "@/hooks/queries/use-branches";
import { ArrowRight } from "lucide-react";

export default function TransfersPage() {
  const { selectedBranchId, selectedBranch, branches, setBranches } = useBranch();
  const { data: fetchedBranches } = useBranches();

  useEffect(() => {
    if (fetchedBranches && branches.length === 0) {
      setBranches(fetchedBranches);
    }
  }, [fetchedBranches, branches.length, setBranches]);

  return (
    <PageContainer>
      <PageHeader
        title="Transferencias"
        description="Solicita, aprueba y gestiona transferencias de inventario entre sucursales."
        icon={ArrowRight}
        branchName={selectedBranch?.name}
        actions={
          branches.length > 0 && (
            <TransferRequest branches={branches} />
          )
        }
      />
      <TransferList branchId={selectedBranchId || ""} branches={branches} />
    </PageContainer>
  );
}
