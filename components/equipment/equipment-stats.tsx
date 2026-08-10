"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard, MetricGrid } from "@/components/ui/metric-card";
import { Badge } from "@/components/ui/badge";
import { 
  Wrench, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  TrendingUp
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/hooks/use-tenant";
import { getEquipmentTypeLabel } from "@/lib/equipment-constants";

interface EquipmentStats {
  total: number;
  active: number;
  underMaintenance: number;
  outOfOrder: number;
  critical: number;
  byType: Record<string, number>;
}

export function EquipmentStats() {
  const { toast } = useToast();
  const { tenant } = useTenant();
  const branchId = tenant?.branchId;
  const [stats, setStats] = useState<EquipmentStats>({
    total: 0,
    active: 0,
    underMaintenance: 0,
    outOfOrder: 0,
    critical: 0,
    byType: {},
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      setIsLoading(true);
      const response = await fetch("/api/equipment/stats");
      if (!response.ok) throw new Error("Failed to fetch stats");

      const result = await response.json();
      const data = result.data;

      setStats({
        total: data.total,
        active: data.active,
        underMaintenance: data.underMaintenance,
        outOfOrder: data.outOfOrder,
        critical: data.critical,
        byType: data.byType,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudieron cargar las estadísticas",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const statCards = [
    {
      title: "Total de Equipos",
      value: stats.total,
      icon: <Wrench className="h-4 w-4" />,
      tone: "info" as const,
    },
    {
      title: "Equipos Activos",
      value: stats.active,
      icon: <CheckCircle2 className="h-4 w-4" />,
      tone: "success" as const,
    },
    {
      title: "En Mantenimiento",
      value: stats.underMaintenance,
      icon: <Clock className="h-4 w-4" />,
      tone: "warning" as const,
    },
    {
      title: "Fuera de Servicio",
      value: stats.outOfOrder,
      icon: <AlertTriangle className="h-4 w-4" />,
      tone: "destructive" as const,
    },
    {
      title: "Equipos Críticos",
      value: stats.critical,
      icon: <AlertCircle className="h-4 w-4" />,
      tone: "destructive" as const,
    },
  ];

  const topTypes = Object.entries(stats.byType)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <MetricGrid columns={5}>
        {statCards.map((stat, index) => (
          <MetricCard
            key={index}
            label={stat.title}
            value={stat.value}
            icon={stat.icon}
            tone={stat.tone}
            loading={isLoading}
          />
        ))}
      </MetricGrid>

      {topTypes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Distribución por Tipo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {topTypes.map(([type, count]) => (
                <Badge
                  key={type}
                  variant="secondary"
                  className="text-sm px-3 py-1"
                >
                  {getEquipmentTypeLabel(type)}: {count}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
