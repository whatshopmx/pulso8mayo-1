"use client";

import { useState, useEffect } from "react";
import { TransferList } from "@/components/inventory/transfer-list";
import { TransferRequest } from "@/components/inventory/transfer-request";
import { PageHeader, PageContainer } from "@/components/shared";
import { useBranch } from "@/lib/branch-context";
import { useBranches } from "@/hooks/queries/use-branches";
import { ArrowRight } from "lucide-react";

export default function TransfersPage() {
  const { selectedBranchId, selectedBranch, branches, setBranches } = useBranch();
  const { data: fetchedBranches } = useBranches();
  const [isRequestOpen, setIsRequestOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (fetchedBranches && branches.length === 0) {
      setBranches(fetchedBranches);
    }
  }, [fetchedBranches, branches.length, setBranches]);

  const handleTransferCreated = () => {
    setRefreshKey(prev => prev + 1);
    setIsRequestOpen(false);
  };

  return (
    <PageContainer>
      <PageHeader
        title="Transferencias"
        description="Solicita, aprueba y gestiona transferencias de inventario entre sucursales."
        icon={ArrowRight}
        branchName={selectedBranch?.name}
        actions={
          branches.length > 0 && (
            <TransferRequest
              branches={branches}
              fromBranchId={selectedBranchId || undefined}
              open={isRequestOpen}
              onOpenChange={setIsRequestOpen}
              onComplete={handleTransferCreated}
            />
          )
        }
      />
      <TransferList
        branchId={selectedBranchId || ""}
        branches={branches}
        refreshKey={refreshKey}
        onRequestNewTransfer={() => setIsRequestOpen(true)}
      />
    </PageContainer>
  );
}

