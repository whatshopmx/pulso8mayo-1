import { redirect } from "next/navigation";

interface PageProps {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * Servicios Normativos moved to Compliance (/dashboard/compliance/services).
 * This page redirects for backwards compatibility, preserving query params.
 */
export default async function EquipmentComplianceRedirectPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      search.set(key, value);
    } else if (Array.isArray(value)) {
      value.forEach((v) => search.append(key, v));
    }
  }

  const query = search.toString();
  redirect(`/dashboard/compliance/services${query ? `?${query}` : ""}`);
}