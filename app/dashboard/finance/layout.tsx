import { FinanceSubnav } from "@/components/finance/finance-subnav";

export default function FinanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-full min-w-0 max-w-full">
      <FinanceSubnav />
      <div className="flex-1 min-w-0 max-w-full">{children}</div>
    </div>
  );
}
