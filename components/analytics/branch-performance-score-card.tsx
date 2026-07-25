"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import Link from "next/link";

interface DimensionScore {
  label: string;
  value: number;
  maxValue: number;
}

interface ScoreCardProps {
  branchId: string;
  branchName: string;
  performanceIndex: number;
  previousIndex?: number;
  dimensions: DimensionScore[];
}

export function BranchPerformanceScoreCard({
  branchId,
  branchName,
  performanceIndex,
  previousIndex,
  dimensions,
}: ScoreCardProps) {
  const trend = previousIndex
    ? ((performanceIndex - previousIndex) / previousIndex) * 100
    : 0;

  const TrendIcon = trend > 0 ? TrendingUp : trend < 0 ? TrendingDown : Minus;
  const trendColor = trend >= 0 ? "text-green-600" : "text-red-600";

  const getStatus = (value: number) => {
    if (value >= 80) return { icon: CheckCircle2, color: "text-green-600", bg: "bg-green-50 border-green-200" };
    if (value >= 60) return { icon: AlertTriangle, color: "text-yellow-600", bg: "bg-yellow-50 border-yellow-200" };
    return { icon: XCircle, color: "text-red-600", bg: "bg-red-50 border-red-200" };
  };

  const status = getStatus(performanceIndex);
  const StatusIcon = status.icon;
  const circumference = 2 * Math.PI * 60;
  const offset = circumference - (performanceIndex / 100) * circumference;

  return (
    <Link href={`/dashboard/analytics/branches/${branchId}`} className="block">
    <Card className="hover:shadow-md transition-shadow cursor-pointer">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="truncate">{branchName}</span>
          <StatusIcon className={`h-5 w-5 ${status.color}`} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-6">
          <div className="relative flex-shrink-0">
            <svg width="140" height="140" className="transform -rotate-90">
              <circle
                cx="70"
                cy="70"
                r="60"
                fill="none"
                stroke="hsl(var(--muted))"
                strokeWidth="10"
              />
              <circle
                cx="70"
                cy="70"
                r="60"
                fill="none"
                stroke={
                  performanceIndex >= 80 ? "#16a34a" : performanceIndex >= 60 ? "#ca8a04" : "#dc2626"
                }
                strokeWidth="10"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold">{performanceIndex.toFixed(1)}</span>
              <span className="text-xs text-muted-foreground">Overall</span>
            </div>
          </div>

          <div className="flex-1 space-y-1">
            {dimensions.map((d) => {
              const pct = d.maxValue > 0 ? (d.value / d.maxValue) * 100 : 0;
              return (
                <div key={d.label}>
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="text-muted-foreground">{d.label}</span>
                    <span className="font-medium">{d.value.toFixed(1)}</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        pct >= 80 ? "bg-green-500" : pct >= 60 ? "bg-yellow-500" : "bg-red-500"
                      }`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {previousIndex && (
          <div className="flex items-center gap-1 mt-4 pt-3 border-t">
            <TrendIcon className={`h-3 w-3 ${trendColor}`} />
            <span className={`text-xs font-medium ${trendColor}`}>
              {trend >= 0 ? "+" : ""}{trend.toFixed(1)}%
            </span>
            <span className="text-xs text-muted-foreground">vs. periodo anterior</span>
          </div>
        )}
      </CardContent>
    </Card>
    </Link>
  );
}
