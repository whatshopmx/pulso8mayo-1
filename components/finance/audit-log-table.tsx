"use client";

import { formatCents, statusBadgeClasses } from "@/lib/utils";

export interface AuditLogEntry {
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

// Tonos semánticos del sistema, no paleta cruda: `bg-*-100` sin variante `dark:`
// se convertía en una losa casi blanca sobre el `--card` oscuro.
const ACTION_LABELS: Record<string, { label: string; tone: Parameters<typeof statusBadgeClasses>[0] }> = {
  CREATED: { label: "Creó", tone: "info" },
  APPROVED: { label: "Aprobó", tone: "success" },
  REJECTED: { label: "Rechazó", tone: "destructive" },
  PAID: { label: "Pagó", tone: "info" },
  EDITED: { label: "Editó", tone: "warning" },
};

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
        <caption className="sr-only">
          Bitácora de autorizaciones: fecha, sucursal, categoría, usuario que actuó, acción,
          monto y notas de cada movimiento sobre gastos operativos.
        </caption>
        <thead>
          <tr className="bg-muted/50 border-b">
            <th scope="col" className="text-left px-3 py-2 font-medium text-muted-foreground">Fecha</th>
            <th scope="col" className="text-left px-3 py-2 font-medium text-muted-foreground">Sucursal</th>
            <th scope="col" className="text-left px-3 py-2 font-medium text-muted-foreground">Categoría</th>
            <th scope="col" className="text-left px-3 py-2 font-medium text-muted-foreground">Usuario</th>
            <th scope="col" className="text-left px-3 py-2 font-medium text-muted-foreground">Acción</th>
            <th scope="col" className="text-right px-3 py-2 font-medium text-muted-foreground">Monto</th>
            <th scope="col" className="text-left px-3 py-2 font-medium text-muted-foreground">Notas</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const actionInfo = ACTION_LABELS[entry.action] || { label: entry.action, tone: "neutral" as const };
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
                      <span className="text-xs text-muted-foreground">{entry.actorRole}</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block px-1.5 py-0.5 rounded border text-xs font-medium ${statusBadgeClasses(
                      actionInfo.tone
                    )}`}
                  >
                    {actionInfo.label}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-bold tabular-nums">
                  {formatCents(entry.amountCents)}
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
