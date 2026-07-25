"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { FileText, Calendar, Clock, DollarSign, Eye, Download } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface ContractCardProps {
  contract: {
    id: string;
    contractNumber: string;
    contractType: string;
    status: string;
    workRegime: string;
    startDate: string;
    endDate?: string;
    baseSalary: number;
    weeklySalary?: number;
    monthlySalary?: number;
    probationPeriodDays?: number;
    hasHealthInsurance?: boolean;
    hasLifeInsurance?: boolean;
    hasSavingsFund?: boolean;
    hasFoodVouchers?: boolean;
    hasTransportationBonus?: boolean;
    workStartTime?: string;
    workEndTime?: string;
    breakDurationMinutes?: number;
    workDays?: string[];
  };
  onView?: () => void;
  onDownload?: () => void;
}

const contractTypeLabels: Record<string, string> = {
  DETERMINATE: "Determinate Duration",
  INDETERMINATE: "Indeterminate Duration",
  PROBATION: "Probation Period",
  TRAINING: "Training",
  SEASONAL: "Seasonal",
  PART_TIME: "Part Time",
};

const contractTypeColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  DETERMINATE: "default",
  INDETERMINATE: "default",
  PROBATION: "secondary",
  TRAINING: "secondary",
  SEASONAL: "outline",
  PART_TIME: "outline",
};

const statusLabels: Record<string, string> = {
  ACTIVE: "Active",
  EXPIRED: "Expired",
  TERMINATED: "Terminated",
  RENEWED: "Renewed",
};

const statusColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ACTIVE: "default",
  EXPIRED: "outline",
  TERMINATED: "destructive",
  RENEWED: "secondary",
};

const workRegimeLabels: Record<string, string> = {
  DAILY: "Daily",
  MIXED: "Mixed",
  NIGHT: "Night",
  SPLIT_SHIFT: "Split Shift",
  ON_CALL: "On Call",
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(amount / 100);
}

export function ContractCard({ contract, onView, onDownload }: ContractCardProps) {
  const isActive = contract.status === "ACTIVE";
  
  return (
    <Card className={isActive ? "border-primary/50" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">
              Contract #{contract.contractNumber}
            </CardTitle>
          </div>
          <div className="flex gap-2">
            <Badge variant={contractTypeColors[contract.contractType] || "outline"}>
              {contractTypeLabels[contract.contractType] || contract.contractType}
            </Badge>
            <Badge variant={statusColors[contract.status] || "outline"}>
              {statusLabels[contract.status] || contract.status}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Dates */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Start Date</p>
              <p className="text-sm font-medium">
                {contract.startDate
                  ? format(new Date(contract.startDate), "MMM d, yyyy", { locale: es })
                  : "N/A"}
              </p>
            </div>
          </div>
          
          {contract.endDate && (
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">End Date</p>
                <p className="text-sm font-medium">
                  {format(new Date(contract.endDate), "MMM d, yyyy", { locale: es })}
                </p>
              </div>
            </div>
          )}
          
          {contract.probationPeriodDays && (
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Probation</p>
                <p className="text-sm font-medium">{contract.probationPeriodDays} days</p>
              </div>
            </div>
          )}
        </div>

        <Separator />

        {/* Salary */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Daily Salary</p>
            <p className="text-lg font-bold text-primary">
              {formatCurrency(contract.baseSalary)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Weekly</p>
            <p className="text-sm font-medium">
              {formatCurrency(contract.weeklySalary || contract.baseSalary * 7)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Monthly</p>
            <p className="text-sm font-medium">
              {formatCurrency(contract.monthlySalary || contract.baseSalary * 30)}
            </p>
          </div>
        </div>

        <Separator />

        {/* Work Schedule */}
        {(contract.workStartTime || contract.workEndTime) && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Work Schedule</p>
            <div className="flex items-center gap-4 text-sm">
              {contract.workStartTime && (
                <span>
                  <span className="text-muted-foreground">From:</span> {contract.workStartTime}
                </span>
              )}
              {contract.workEndTime && (
                <span>
                  <span className="text-muted-foreground">To:</span> {contract.workEndTime}
                </span>
              )}
              {contract.breakDurationMinutes && (
                <span>
                  <span className="text-muted-foreground">Break:</span> {contract.breakDurationMinutes} min
                </span>
              )}
            </div>
            {contract.workDays && contract.workDays.length > 0 && (
              <div className="flex gap-1 mt-2">
                {contract.workDays.map((day) => (
                  <span
                    key={day}
                    className="text-xs px-1.5 py-0.5 bg-muted rounded"
                  >
                    {day.slice(0, 3)}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Benefits */}
        <div className="flex flex-wrap gap-2">
          {contract.hasHealthInsurance && (
            <Badge variant="outline" className="text-xs">Health Insurance</Badge>
          )}
          {contract.hasLifeInsurance && (
            <Badge variant="outline" className="text-xs">Life Insurance</Badge>
          )}
          {contract.hasSavingsFund && (
            <Badge variant="outline" className="text-xs">Savings Fund</Badge>
          )}
          {contract.hasFoodVouchers && (
            <Badge variant="outline" className="text-xs">Food Vouchers</Badge>
          )}
          {contract.hasTransportationBonus && (
            <Badge variant="outline" className="text-xs">Transport Bonus</Badge>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={onView}>
            <Eye className="mr-2 h-4 w-4" />
            View
          </Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={onDownload}>
            <Download className="mr-2 h-4 w-4" />
            Download
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
