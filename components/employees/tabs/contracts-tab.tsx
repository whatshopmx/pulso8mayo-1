"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { FileText, TrendingUp, Plus, Edit } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { ContractDialog } from "@/components/employees/contract-dialog";

interface ContractsTabProps {
  contracts: any[];
  salaryHistory: any[];
  canEdit?: boolean;
  employeeId?: string;
  companyId?: string;
  branchId?: string;
  onContractCreated?: () => void;
  onContractUpdated?: () => void;
}

const contractTypeLabels: Record<string, string> = {
  DETERMINATE: "Duración Determinada",
  INDETERMINATE: "Tiempo Indeterminado",
  PROBATION: "Periodo de Prueba",
  TRAINING: "Capacitación Inicial",
  SEASONAL: "Por Temporada",
  PART_TIME: "Media Jornada",
};

const contractTypeColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  DETERMINATE: "default",
  INDETERMINATE: "default",
  PROBATION: "secondary",
  TRAINING: "secondary",
  SEASONAL: "outline",
  PART_TIME: "outline",
};

const workRegimeLabels: Record<string, string> = {
  DAILY: "Jornada Diurna",
  MIXED: "Jornada Mixta",
  NIGHT: "Jornada Nocturna",
  SPLIT_SHIFT: "Turno Quebrado",
  ON_CALL: "Por Disponibilidad / Guardia",
};

const statusLabels: Record<string, string> = {
  ACTIVE: "Vigente",
  EXPIRED: "Vencido",
  TERMINATED: "Rescindido",
  RENEWED: "Renovado",
};

const statusColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ACTIVE: "default",
  EXPIRED: "outline",
  TERMINATED: "destructive",
  RENEWED: "secondary",
};

const salaryChangeTypeLabels: Record<string, string> = {
  INITIAL: "Sueldo Inicial",
  ADJUSTMENT: "Ajuste Salarial",
  PROMOTION: "Promoción / Ascenso",
  DEMOTION: "Reajuste",
  COLA: "Ajuste Inflacionario",
  MERIT: "Desempeño / Mérito",
  OTHER: "Otro",
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(amount);
}

export function ContractsTab({
  contracts,
  salaryHistory,
  canEdit = false,
  employeeId,
  companyId,
  branchId,
  onContractCreated,
  onContractUpdated
}: ContractsTabProps) {
  const [contractDialogOpen, setContractDialogOpen] = useState(false);
  const [selectedContract, setSelectedContract] = useState<any>(null);

  const activeContract = contracts.find((c) => c.status === "ACTIVE");
  const latestSalaryChange = salaryHistory?.[0];

  const handleCreateContract = () => {
    setSelectedContract(null);
    setContractDialogOpen(true);
  };

  const handleEditContract = (contract: any) => {
    setSelectedContract(contract);
    setContractDialogOpen(true);
  };

  const handleContractSuccess = () => {
    setContractDialogOpen(false);
    setSelectedContract(null);
    if (onContractCreated) onContractCreated();
    if (onContractUpdated) onContractUpdated();
  };
  
  // Calcular salario actual: priorizar contrato activo, luego último registro de salario
  let dailySalary = 0;
  let weeklySalary = 0;
  let monthlySalary = 0;
  let salarySourceLabel = "Sin salario registrado";

  if (activeContract) {
    dailySalary = activeContract.baseSalary ?? 0;
    weeklySalary = activeContract.weeklySalary ?? (dailySalary * 7);
    monthlySalary = activeContract.monthlySalary ?? (dailySalary * 30);
    salarySourceLabel = "Basado en el contrato activo";
  } else if (latestSalaryChange) {
    dailySalary = latestSalaryChange.newSalary ?? 0;
    weeklySalary = dailySalary * 7;
    monthlySalary = dailySalary * 30;
    salarySourceLabel = "Basado en el último cambio salarial registrado";
  }

  return (
    <div className="space-y-6">
      {/* Header with Create Button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Contratos y Convenios</h2>
          <p className="text-muted-foreground">
            Gestión de contratos laborales, vigencia e historial de percepciones
          </p>
        </div>
        {canEdit && employeeId && companyId && (
          <Button onClick={handleCreateContract}>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo Contrato
          </Button>
        )}
      </div>

      {/* Active Contract */}
      {activeContract && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Contrato Vigente
                </CardTitle>
                <CardDescription>
                  Contrato #{activeContract.contractNumber}
                </CardDescription>
              </div>
              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleEditContract(activeContract)}
                >
                  <Edit className="mr-2 h-4 w-4" />
                  Editar Contrato
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Tipo de Contrato</Label>
                <Badge
                  variant={contractTypeColors[activeContract.contractType] || "outline"}
                >
                  {contractTypeLabels[activeContract.contractType] || activeContract.contractType}
                </Badge>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Estatus</Label>
                <Badge variant={statusColors[activeContract.status] || "outline"}>
                  {statusLabels[activeContract.status] || activeContract.status}
                </Badge>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Jornada Laboral</Label>
                <div className="text-sm font-medium">
                  {workRegimeLabels[activeContract.workRegime] || activeContract.workRegime}
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Fecha de Inicio</Label>
                <div className="text-sm font-medium">
                  {activeContract.startDate
                    ? format(new Date(activeContract.startDate), "d 'de' MMM, yyyy", { locale: es })
                    : "N/A"}
                </div>
              </div>
              {activeContract.endDate && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Fecha de Término</Label>
                  <div className="text-sm font-medium">
                    {format(new Date(activeContract.endDate), "d 'de' MMM, yyyy", { locale: es })}
                  </div>
                </div>
              )}
              {activeContract.probationPeriodDays && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Periodo de Prueba</Label>
                  <div className="text-sm font-medium">
                    {activeContract.probationPeriodDays} días
                  </div>
                </div>
              )}
            </div>

            {/* Benefits */}
            <Separator className="my-4" />
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Prestaciones Contractuales</Label>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                <div className="text-sm">
                  <span className="text-muted-foreground">Seguro de Salud:</span>
                  <Badge
                    variant={activeContract.hasHealthInsurance ? "default" : "outline"}
                    className="ml-2"
                  >
                    {activeContract.hasHealthInsurance ? "Sí" : "No"}
                  </Badge>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Seguro de Vida:</span>
                  <Badge
                    variant={activeContract.hasLifeInsurance ? "default" : "outline"}
                    className="ml-2"
                  >
                    {activeContract.hasLifeInsurance ? "Sí" : "No"}
                  </Badge>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Fondo de Ahorro:</span>
                  <Badge
                    variant={activeContract.hasSavingsFund ? "default" : "outline"}
                    className="ml-2"
                  >
                    {activeContract.hasSavingsFund ? "Sí" : "No"}
                  </Badge>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Vales de Despensa:</span>
                  <Badge
                    variant={activeContract.hasFoodVouchers ? "default" : "outline"}
                    className="ml-2"
                  >
                    {activeContract.hasFoodVouchers ? "Sí" : "No"}
                  </Badge>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Bono de Transporte:</span>
                  <Badge
                    variant={activeContract.hasTransportationBonus ? "default" : "outline"}
                    className="ml-2"
                  >
                    {activeContract.hasTransportationBonus ? "Sí" : "No"}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Work Schedule */}
            {(activeContract.workStartTime || activeContract.workEndTime) && (
              <>
                <Separator className="my-4" />
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Horario de Trabajo</Label>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="text-sm">
                      <span className="text-muted-foreground">Hora de Entrada:</span>
                      <span className="ml-2 font-medium">
                        {activeContract.workStartTime || "N/A"}
                      </span>
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">Hora de Salida:</span>
                      <span className="ml-2 font-medium">
                        {activeContract.workEndTime || "N/A"}
                      </span>
                    </div>
                    {activeContract.breakDurationMinutes && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">Descanso:</span>
                        <span className="ml-2 font-medium">
                          {activeContract.breakDurationMinutes} minutos
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Compensation */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Percepciones y Salario
              </CardTitle>
              <CardDescription>Desglose salarial actual e historial de ajustes.</CardDescription>
            </div>
            {canEdit && (
              <Badge variant="outline">Ajuste salarial pendiente</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="p-4 border rounded-lg">
              <Label className="text-xs text-muted-foreground">Salario Diario</Label>
              <div className="text-2xl font-bold mt-1">
                {formatCurrency(dailySalary / 100)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">por día</div>
            </div>
            <div className="p-4 border rounded-lg">
              <Label className="text-xs text-muted-foreground">Salario Semanal</Label>
              <div className="text-2xl font-bold mt-1">
                {formatCurrency(weeklySalary / 100)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">por semana</div>
            </div>
            <div className="p-4 border rounded-lg">
              <Label className="text-xs text-muted-foreground">Salario Mensual</Label>
              <div className="text-2xl font-bold mt-1">
                {formatCurrency(monthlySalary / 100)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">por mes</div>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">{salarySourceLabel}</p>

          {/* Salary History */}
          {salaryHistory && salaryHistory.length > 0 && (
            <>
              <Separator className="my-4" />
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Historial Salarial</Label>
                <div className="space-y-2">
                  {salaryHistory.map((change: any, index: number) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">
                            {salaryChangeTypeLabels[change.changeType] || change.changeType}
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            {change.reason || "Sin motivo registrado"}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {change.effectiveDate
                            ? format(new Date(change.effectiveDate), "d 'de' MMM, yyyy", {
                                locale: es,
                              })
                            : "N/A"}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-medium">
                          {formatCurrency(change.newSalary / 100)}
                        </div>
                        {change.percentageChange && (
                          <div
                            className={`text-xs ${
                              change.percentageChange > 0
                                ? "text-green-600"
                                : "text-red-600"
                            }`}
                          >
                            {change.percentageChange > 0 ? "+" : ""}
                            {change.percentageChange}%
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Contract History */}
      {contracts && contracts.length > 1 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Historial de Contratos</CardTitle>
                <CardDescription>Histórico de contratos registrados para este colaborador.</CardDescription>
              </div>
              {canEdit && <Badge variant="outline">Alta de contrato pendiente</Badge>}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {contracts
                .filter((c: any) => c.status !== "ACTIVE")
                .map((contract: any, index: number) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          Contrato #{contract.contractNumber}
                        </span>
                        <Badge
                          variant={contractTypeColors[contract.contractType] || "outline"}
                        >
                          {contractTypeLabels[contract.contractType] || contract.contractType}
                        </Badge>
                        <Badge variant={statusColors[contract.status] || "outline"}>
                          {statusLabels[contract.status] || contract.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {contract.startDate
                          ? format(new Date(contract.startDate), "d 'de' MMM, yyyy", { locale: es })
                          : "N/A"}
                        {contract.endDate
                          ? ` - ${format(new Date(contract.endDate), "d 'de' MMM, yyyy", {
                              locale: es,
                            })}`
                          : " - Presente"}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="font-medium">
                          {formatCurrency((contract.baseSalary || 0) / 100)}/día
                        </div>
                      </div>
                      {canEdit && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEditContract(contract)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Contract Dialog */}
      {employeeId && companyId && (
        <ContractDialog
          open={contractDialogOpen}
          onOpenChange={setContractDialogOpen}
          onSuccess={handleContractSuccess}
          contract={selectedContract}
          employeeId={employeeId}
          companyId={companyId}
          branchId={branchId}
        />
      )}
    </div>
  );
}
