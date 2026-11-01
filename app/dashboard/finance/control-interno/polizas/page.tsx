"use client";

import { AccountingJournals } from "@/components/finance/accounting-journals";
import { useBranch } from "@/lib/branch-context";

export default function AccountingJournalsPage() {
  const {selectedBranchId,branches}=useBranch();
  return <AccountingJournals key={selectedBranchId??"ALL"} branchId={selectedBranchId} branches={branches}/>;
}
