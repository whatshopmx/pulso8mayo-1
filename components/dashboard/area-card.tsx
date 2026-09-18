import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { AlertOctagon, AlertTriangle, ArrowRight, CheckCircle2, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ExceptionSeverity, GroupException } from "@/lib/services/group-exceptions-service";

/**
 * La severidad no puede ser solo color: `fatal` y `critical` compartían el
 * mismo className byte a byte, así que la severidad más grave del sistema era
 * visual y semánticamente idéntica a la segunda. Cada nivel lleva glifo propio
 * (o distinta intensidad cuando el glifo se repite) y la palabra para lectores
 * de pantalla.
 */
const SEVERITY_META: Record<
  ExceptionSeverity,
  { label: string; icon: LucideIcon; className: string }
> = {
  fatal: {
    label: "Fatal",
    icon: AlertOctagon,
    className: "bg-destructive text-destructive-foreground border-destructive",
  },
  critical: {
    label: "Crítico",
    icon: AlertOctagon,
    className: "bg-destructive/15 text-destructive border-destructive/30",
  },
  high: {
    label: "Alto",
    icon: AlertTriangle,
    className: "bg-warning/15 text-warning-text border-warning/30",
  },
  warning: {
    label: "Aviso",
    icon: Info,
    className: "bg-info/10 text-info border-info/20",
  },
  info: {
    label: "Info",
    icon: Info,
    className: "bg-muted text-muted-foreground border-muted-foreground/20",
  },
};

interface AreaCardProps {
  /** Usado solo para construir el link "Ver todas" en /dashboard/exceptions?domain=. */
  domain: string;
  title: string;
  icon: LucideIcon;
  /** Ruta al panel de detalle del área (ej. /dashboard/inventory). */
  href: string;
  /** Métrica cross-sucursal cuando existe una fuente confiable; si no hay, se omite en vez de inventar un número. */
  metric?: { label: string; value: string } | null;
  exceptions: GroupException[];
  totalExceptionCount: number;
}

const PREVIEW_COUNT = 3;

export function AreaCard({
  domain,
  title,
  icon: Icon,
  href,
  metric,
  exceptions,
  totalExceptionCount,
}: AreaCardProps) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Icon className="w-4 h-4 text-muted-foreground" />
            {title}
          </CardTitle>
          {totalExceptionCount > 0 && (
            <Badge variant="secondary" className="bg-warning text-warning-foreground font-bold px-2 py-0.5 rounded-full text-xs">
              {totalExceptionCount}
            </Badge>
          )}
        </div>
        {metric && (
          <p className="text-2xl font-bold text-foreground pt-1">
            {metric.value}
            <span className="text-xs font-normal text-muted-foreground ml-2">{metric.label}</span>
          </p>
        )}
      </CardHeader>

      <CardContent className="flex-1 flex flex-col gap-2 pt-0">
        {exceptions.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <CheckCircle2 className="w-4 h-4 text-success" />
            Sin excepciones abiertas
          </div>
        ) : (
          exceptions.slice(0, PREVIEW_COUNT).map((item) => {
            const severity = SEVERITY_META[item.severity];
            const SeverityIcon = severity.icon;
            return (
              <Link
                key={`${item.sourceTable}-${item.id}`}
                href={item.deepLinkUrl}
                className="flex items-start gap-2 text-sm hover:bg-muted/40 rounded-md px-2 py-1.5 -mx-1 transition-colors min-h-[36px]"
              >
                <Badge
                  variant="outline"
                  title={`Severidad: ${severity.label}`}
                  className={`shrink-0 mt-0.5 text-xs px-1.5 py-0 inline-flex items-center gap-1 ${severity.className}`}
                >
                  <SeverityIcon className="h-3 w-3" aria-hidden="true" />
                  <span className="sr-only">Severidad {severity.label}:</span>
                </Badge>
                {item.branchName && (
                  <span
                    title={item.branchName}
                    className="shrink-0 mt-0.5 max-w-[7rem] truncate rounded bg-muted/60 px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
                  >
                    {item.branchName}
                  </span>
                )}
                <span className="line-clamp-2 min-w-0 flex-1 text-foreground">{item.title}</span>
              </Link>
            );
          })
        )}

        <div className="mt-auto pt-2 flex items-center justify-between text-xs border-t border-border/40">
          <Link href={href} className="text-muted-foreground hover:text-foreground font-medium py-2 px-1 inline-flex items-center min-h-[36px]">
            Ir a {title}
          </Link>
          {totalExceptionCount > PREVIEW_COUNT && (
            <Link
              href={`/dashboard/exceptions?domain=${domain}`}
              className="text-primary hover:underline font-medium inline-flex items-center gap-1 py-2 px-1 min-h-[36px]"
            >
              Ver {totalExceptionCount}
              <ArrowRight className="w-3 h-3" />
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
