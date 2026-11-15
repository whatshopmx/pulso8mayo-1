'use client';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { CalendarDays, Clock } from 'lucide-react';

interface LeaveBalanceCardProps {
  balance: {
    id: string;
    leaveTypeName: string;
    leaveTypeDescription: string | null;
    isPaid: boolean;
    year: number;
    totalEntitlement: number;
    used: number;
    pending: number;
    balance: number;
  };
}

export function LeaveBalanceCard({ balance }: LeaveBalanceCardProps) {
  const usagePercentage =
    balance.totalEntitlement > 0
      ? Math.min(100, Math.round((balance.used / balance.totalEntitlement) * 100))
      : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold leading-none">
            {balance.leaveTypeName}
          </h2>
          {balance.isPaid ? (
            <Badge variant="default">Con goce</Badge>
          ) : (
            <Badge variant="secondary">Sin goce</Badge>
          )}
        </div>
        {balance.leaveTypeDescription && (
          <p className="text-sm text-muted-foreground">
            {balance.leaveTypeDescription}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Resumen de saldo */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-2xl font-bold tabular-nums">
              {balance.totalEntitlement}
            </div>
            <div className="text-xs text-muted-foreground">Asignados</div>
          </div>
          <div>
            <div className="text-2xl font-bold tabular-nums text-muted-foreground">
              {balance.used}
            </div>
            <div className="text-xs text-muted-foreground">Usados</div>
          </div>
          <div>
            <div className="text-2xl font-bold tabular-nums text-success-text">
              {balance.balance}
            </div>
            <div className="text-xs text-muted-foreground">Disponibles</div>
          </div>
        </div>

        {/* Barra de uso */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span>Uso</span>
            <span className="font-medium tabular-nums">{usagePercentage}%</span>
          </div>
          <Progress
            value={usagePercentage}
            className="h-2"
            aria-label={`Uso de ${balance.leaveTypeName}: ${usagePercentage}%`}
          />
        </div>

        {/* Detalles */}
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>Por aprobar</span>
            </div>
            <span className="font-medium tabular-nums">
              {balance.pending} {balance.pending === 1 ? 'día' : 'días'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground">
              <CalendarDays className="h-4 w-4" />
              <span>Año</span>
            </div>
            <span className="font-medium tabular-nums">{balance.year}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
