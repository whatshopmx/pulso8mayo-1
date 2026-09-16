import { FinanceSubnav } from "@/components/finance/finance-subnav";

export default function FinanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-full">
      <FinanceSubnav />
      <div className="flex-1">{children}</div>
    </div>
  );
}
