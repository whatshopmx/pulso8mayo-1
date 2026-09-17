"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useEffect, useState } from "react";

interface EmployeeData {
  name: string;
  completed: number;
  score: number;
}

interface EmployeeLeaderboardProps {
  branchId?: string;
  period?: string;
}

export function EmployeeLeaderboard({ branchId, period = "7d" }: EmployeeLeaderboardProps = {}) {
  const [employees, setEmployees] = useState<EmployeeData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    const days = period === "7d" ? "7" : period === "90d" ? "90" : "30";
    params.set("days", days);
    if (branchId && branchId !== "all") {
      params.set("branchId", branchId);
    }

    fetch(`/api/reports/stats?${params.toString()}`)
      .then(res => res.json())
      .then(data => {
        setEmployees(data.employeeLeaderboard || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [branchId, period]);

  if (loading) {
    return <div className="flex items-center justify-center h-[300px] text-muted-foreground">Cargando...</div>;
  }

  if (employees.length === 0) {
    return <div className="flex items-center justify-center h-[300px] text-muted-foreground">Sin datos de empleados</div>;
  }

  return (
    <div className="space-y-8">
      {employees.map((employee, index) => (
        <div key={employee.name + index} className="flex items-center">
          <div className="flex items-center w-8 font-bold text-muted-foreground">
            #{index + 1}
          </div>
          <Avatar className="h-9 w-9">
            <AvatarFallback>{employee.name.charAt(0)}</AvatarFallback>
          </Avatar>
          <div className="ml-4 space-y-1">
            <p className="text-sm font-medium leading-none">{employee.name}</p>
          </div>
          <div className="ml-auto flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium">{employee.completed} Flows</p>
              <p className="text-xs text-muted-foreground">{employee.score}% Score Prom.</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
