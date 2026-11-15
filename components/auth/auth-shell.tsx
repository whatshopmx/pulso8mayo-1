import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AuthShell({ title, description, children }: {
  title: string; description: string; children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/30 px-4 py-8">
      <Link href="/" className="text-xl font-semibold text-primary focus-visible:outline-2 focus-visible:outline-offset-4">Pulso</Link>
      <Card className="w-full max-w-md shadow-none">
        <CardHeader><CardTitle><h1 className="text-xl leading-tight text-balance">{title}</h1></CardTitle><CardDescription>{description}</CardDescription></CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </main>
  );
}
