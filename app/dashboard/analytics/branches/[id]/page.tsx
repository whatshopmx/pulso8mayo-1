import { redirect } from "next/navigation";

export default async function AnalyticsBranchDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dashboard/branches/${id}`);
}
