import React from "react";
import Link from "next/link";
import { LivePulseSummary } from "@/lib/services/live-command-service";
import { 
  AlertOctagon, 
  ThermometerSnowflake, 
  DollarSign, 
  Users, 
  PackageX, 
  ArrowUpRight,
  Clock
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface LiveRushAlertsProps {
  rushAlerts: LivePulseSummary["rushAlerts"];
}

const CATEGORY_CONFIG = {
  DINERO: {
    label: "Dinero & Caja",
    color: "bg-warning/15 text-warning-text border-warning/30",
    icon: DollarSign,
  },
  INOCUIDAD: {
    label: "Inocuidad & Frío",
    color: "bg-destructive/15 text-destructive border-destructive/30",
    icon: ThermometerSnowflake,
  },
  ABASTO: {
    label: "Abasto & Merma",
    color: "bg-warning/15 text-warning-text border-warning/30",
    icon: PackageX,
  },
  PERSONAL: {
    label: "Personal & Turno",
    color: "bg-info/15 text-info border-info/30",
    icon: Users,
  },
} as const;

export function LiveRushAlerts({ rushAlerts }: LiveRushAlertsProps) {
  if (!rushAlerts || rushAlerts.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 sm:p-5 transition-colors">
      <div className="flex items-center justify-between gap-2 border-b border-destructive/20 pb-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-destructive/15 text-destructive">
            <AlertOctagon className="h-4 w-4 animate-pulse" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-destructive tracking-tight">
              Atención Urgente en Rush ({rushAlerts.length} alerta{rushAlerts.length > 1 ? "s" : ""})
            </h3>
            <p className="text-xs text-muted-foreground">
              Incidencias operativas en curso que amenazan el servicio o la inocuidad en tienda
            </p>
          </div>
        </div>

        <Link
          href="/dashboard/exceptions"
          className="text-xs font-medium text-destructive hover:underline hidden sm:inline-flex items-center gap-1"
        >
          Ir a Mesa de Excepciones <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {rushAlerts.map((alert) => {
          const categoryMeta = CATEGORY_CONFIG[alert.category] || CATEGORY_CONFIG.DINERO;
          const IconComponent = categoryMeta.icon;

          return (
            <div
              key={alert.id}
              className="flex flex-col justify-between rounded-lg border border-border/80 bg-card p-3.5 hover:border-destructive/40 transition-colors"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-bold text-foreground truncate">
                    {alert.branchName}
                  </span>
                  <Badge
                    variant="outline"
                    className={`text-xs px-1.5 py-0 font-medium ${categoryMeta.color}`}
                  >
                    <IconComponent className="h-3 w-3 mr-1" />
                    {categoryMeta.label}
                  </Badge>
                </div>

                <p className="text-xs text-foreground/90 font-medium line-clamp-2">
                  {alert.title}
                </p>
              </div>

              <div className="flex items-center justify-between gap-2 pt-3 mt-2 border-t border-border/50">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {alert.timeAgo}
                </span>

                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs px-2.5 font-medium border-destructive/30 hover:bg-destructive/10 text-destructive"
                >
                  <Link href={alert.actionUrl}>
                    Atender <ArrowUpRight className="h-3 w-3 ml-1" />
                  </Link>
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
