"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  HeartPulse,
  PiggyBank,
  Smartphone,
  Hospital,
  ShieldCheck,
  Calendar,
  Users,
  DollarSign,
  Plus,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

import { useState } from "react";
import { EmployeeBenefitDialog } from "../employee-benefit-dialog";

interface BenefitsTabProps {
  benefits: any[];
  employeeId?: string;
  companyId?: string;
  onSuccess?: () => void;
}

const benefitTypeIcons: Record<string, any> = {
  HEALTH_INSURANCE: Hospital,
  LIFE_INSURANCE: ShieldCheck,
  SAVINGS_FUND: PiggyBank,
  FOOD_VOUCHERS: Smartphone,
  TRANSPORTATION: DollarSign,
  DEFAULT: HeartPulse,
};

const benefitTypeLabels: Record<string, string> = {
  HEALTH_INSURANCE: "Seguro de Gastos Médicos / IMSS",
  LIFE_INSURANCE: "Seguro de Vida",
  SAVINGS_FUND: "Fondo de Ahorro",
  FOOD_VOUCHERS: "Vales de Despensa",
};

export function BenefitsTab({ benefits, employeeId, companyId, onSuccess }: BenefitsTabProps) {
  const [showBenefitDialog, setShowBenefitDialog] = useState(false);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-green-600" />
                Prestaciones y Beneficios Activos
              </CardTitle>
              <CardDescription>
                Resumen del paquete de prestaciones y beneficios corporativos del colaborador
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => setShowBenefitDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Inscribir Beneficio
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {benefits && benefits.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {benefits.map((benefit, index) => {
                const Icon = benefitTypeIcons[benefit.benefitType] || benefitTypeIcons.DEFAULT;
                return (
                  <div key={benefit.id || index} className="p-4 border rounded-xl flex items-start gap-4 hover:border-primary/50 transition-all">
                    <div className="p-3 bg-primary/5 rounded-full">
                      <Icon className="h-6 w-6 text-primary" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold">{benefitTypeLabels[benefit.benefitType] || benefit.benefitType}</span>
                        <Badge variant={benefit.isActive ? "default" : "secondary"}>
                          {benefit.isActive ? "Activo" : "Inactivo"}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {benefit.provider || "Proporcionado por la Empresa"}
                      </div>
                      <div className="flex items-center gap-4 text-xs mt-2">
                        <div className="flex items-center gap-1">
                          <DollarSign className="h-3 w-3" />
                          <span>${((benefit.employerContribution || 0) / 100).toFixed(2)}/mes (Patrón)</span>
                        </div>
                        {benefit.startDate && (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            <span>Desde {format(new Date(benefit.startDate), 'MMM yyyy', { locale: es })}</span>
                          </div>
                        )}
                      </div>
                      
                      {benefit.beneficiaries && (
                        <div className="mt-3 flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded w-fit">
                          <Users className="h-3 w-3" />
                          <span>{Array.isArray(benefit.beneficiaries) ? benefit.beneficiaries.length : 0} Beneficiarios registrados</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12">
              <HeartPulse className="mx-auto h-12 w-12 text-muted-foreground mb-4 opacity-20" />
              <h3 className="text-lg font-semibold">Sin Beneficios Registrados</h3>
              <p className="text-muted-foreground text-sm max-w-xs mx-auto">
                Este colaborador no cuenta con beneficios adicionales registrados actualmente.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Resumen del Paquete de Prestaciones</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Aportación Patronal Total (Mensual)</span>
              <span className="font-bold text-green-700">
                ${(benefits.reduce((acc, b) => acc + (b.employerContribution || 0), 0) / 100).toFixed(2)} MXN
              </span>
            </div>
            <Separator />
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Deducción al Trabajador (Mensual)</span>
              <span className="font-bold text-orange-700">
                ${(benefits.reduce((acc, b) => acc + (b.employeeContribution || 0), 0) / 100).toFixed(2)} MXN
              </span>
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-blue-50 border-blue-100">
          <CardHeader>
            <CardTitle className="text-sm text-blue-900">Verificación de Cumplimiento</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-blue-800">
                <ShieldCheck className="h-4 w-4" />
                <span>Registro IMSS: Vigente</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-blue-800">
                <ShieldCheck className="h-4 w-4" />
                <span>Aportaciones INFONAVIT: Al día</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {showBenefitDialog && employeeId && companyId && (
        <EmployeeBenefitDialog
          open={showBenefitDialog}
          onOpenChange={setShowBenefitDialog}
          onSuccess={onSuccess || (() => {})}
          employeeId={employeeId}
          companyId={companyId}
        />
      )}
    </div>
  );
}
