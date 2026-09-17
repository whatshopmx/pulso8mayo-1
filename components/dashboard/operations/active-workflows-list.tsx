"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Clock } from "lucide-react";
import { useEffect, useState } from "react";

interface ActiveFlow {
  id: string;
  title: string;
  assigneeName: string;
  status: string;
  timeElapsed: string;
  dueIn: string;
}

interface ActiveWorkflowsListProps {
  branchId?: string;
}

export function ActiveWorkflowsList({ branchId }: ActiveWorkflowsListProps = {}) {
  const [activeFlows, setActiveFlows] = useState<ActiveFlow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (branchId && branchId !== "all") {
      params.set("branchId", branchId);
    }
    const query = params.toString();
    fetch(query ? `/api/reports/stats?${query}` : "/api/reports/stats")
      .then(res => res.json())
      .then(data => {
        setActiveFlows(data.activeWorkflows || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [branchId]);

  if (loading) {
    return <div className="flex items-center justify-center h-[300px] text-muted-foreground">Cargando...</div>;
  }

  if (activeFlows.length === 0) {
    return <div className="flex items-center justify-center h-[300px] text-muted-foreground">No hay workflows activos</div>;
  }

  return (
    <ScrollArea className="h-[300px]">
      <div className="space-y-4">
        {activeFlows.map((flow) => (
          <div key={flow.id} className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0">
            <div className="flex items-center gap-4">
              <Avatar className="h-9 w-9">
                <AvatarFallback>{flow.assigneeName?.charAt(0) || '?'}</AvatarFallback>
              </Avatar>
              <div className="space-y-1">
                <p className="text-sm font-medium leading-none">{flow.title}</p>
                <p className="text-xs text-muted-foreground">{flow.assigneeName}</p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              {flow.status === 'OVERDUE' ? (
                <Badge variant="destructive" className="text-xs">Vencido</Badge>
              ) : (
                <div className="flex items-center text-xs text-muted-foreground">
                  <Clock className="mr-1 h-3 w-3" />
                  {flow.dueIn ? `En ${flow.dueIn}` : flow.timeElapsed}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
