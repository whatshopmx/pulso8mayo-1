"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface AuditLogEntry {
  id: string;
  expenseId: string;
  branchName: string;
  category: string;
  amountCents: number;
  action: "CREATED" | "APPROVED" | "REJECTED" | "PAID" | "EDITED";
  actorName: string | null;
  actorRole: string | null;
  notes: string | null;
  timestamp: string;
}

interface AuditLogTableProps {
  entries: AuditLogEntry[];
  loading: boolean;
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  CREATED: { label: "Creó", color: "bg-blue-100 text-blue-700" },
  APPROVED: { label: "Aprobó", color: "bg-emerald-100 text-emerald-700" },
  REJECTED: { label: "Rechazó", color: "bg-red-100 text-red-700" },
  PAID: { label: "Pagó", color: "bg-violet-100 text-violet-700" },
  EDITED: { label: "Editó", color: "bg-amber-100 text-amber-700" },
};

function formatMXN(cents: number) {
  return (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

export function AuditLogTable({ entries, loading }: AuditLogTableProps) {
  if (loading) {
    return (
      <div className="py-8 text-center text-xs text-muted-foreground">
        Cargando bitácora de autorizaciones...
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="py-10 text-center text-xs text-muted-foreground">
        No hay entradas en la bitácora para el período seleccionado.
      </div>
    );
  }

  return (
    <div className="border rounded-md overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/50 border-b">
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Fecha</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Sucursal</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Categoría</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Usuario</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Acción</th>
            <th className="text-right px-3 py-2 font-medium text-muted-foreground">Monto</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Notas</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const actionInfo = ACTION_LABELS[entry.action] || { label: entry.action, color: "bg-gray-100 text-gray-700" };
            return (
              <tr key={entry.id} className="border-b hover:bg-muted/40 transition">
                <td className="px-3 py-2 whitespace-nowrap">
                  {new Date(entry.timestamp).toLocaleDateString("es-MX", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td className="px-3 py-2 font-medium">{entry.branchName}</td>
                <td className="px-3 py-2">{entry.category}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-col">
                    <span>{entry.actorName || "—"}</span>
                    {entry.actorRole && (
                      <span className="text-[10px] text-muted-foreground">{entry.actorRole}</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${actionInfo.color}`}>
                    {actionInfo.label}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-bold">
                  {formatMXN(entry.amountCents)}
                </td>
                <td className="px-3 py-2 max-w-[200px] truncate text-muted-foreground">
                  {entry.notes || "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
