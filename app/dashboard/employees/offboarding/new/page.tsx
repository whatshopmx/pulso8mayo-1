"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/hooks/use-session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, LogOut, Loader2, Calendar, Users, Building2, Save } from "lucide-react";
import Link from "next/link";
import { SettlementCalculator } from "@/components/employees/settlement-calculator";
import { AssetChecklist } from "@/components/employees/asset-checklist";
import { ExitInterviewForm } from "@/components/employees/exit-interview-form";

interface Employee {
  id: string;
  name: string;
  email: string;
  role?: string;
  baseSalary?: number;
  effectiveSalaryCents?: number | null;
  hireDate?: string;
  seniorityDate?: string;
}

interface EmployeeListRow {
  id: string;
  userName: string | null;
  userEmail: string | null;
  userRole?: string;
  contractBaseSalary: number | null;
  effectiveSalaryCents?: number | null;
  hireDate?: string;
}

export default function NewOffboardingPage() {
  const router = useRouter();
  const { session } = useSession();
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [branches, setBranches] = useState<any[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(true);

  const [form, setForm] = useState({
    userId: "",
    branchId: "",
    reason: "",
    resignationDate: new Date().toISOString().split("T")[0],
    lastWorkingDay: new Date().toISOString().split("T")[0],
    notes: "",
    hrNotes: "",
  });

  const [calculationData, setCalculationData] = useState<any>(null);
  const [assetData, setAssetData] = useState<any[]>([]);
  const [exitNotes, setExitNotes] = useState("");

  useEffect(() => {
    const fetchEmployees = async () => {
      try {
        const res = await fetch("/api/employees?isActive=true");
        if (res.ok) {
          const data = await res.json();
          setEmployees((data.data || []).map((employee: EmployeeListRow) => ({
            id: employee.id,
            name: employee.userName || employee.userEmail || "Empleado",
            email: employee.userEmail || "",
            role: employee.userRole,
            baseSalary: employee.contractBaseSalary,
            effectiveSalaryCents: employee.effectiveSalaryCents,
            hireDate: employee.hireDate,
          })));
        }
      } catch (e) {
        console.error("Error fetching employees:", e);
      } finally {
        setLoadingEmployees(false);
      }
    };
    fetchEmployees();

    const fetchBranches = async () => {
      try {
        const res = await fetch("/api/branches?active=true");
        if (res.ok) {
          const data = await res.json();
          setBranches(data.data || []);
        }
      } catch (e) {
        console.error("Error fetching branches:", e);
      } finally {
        setLoadingBranches(false);
      }
    };
    fetchBranches();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.userId) {
      toast.error("Selecciona un empleado");
      return;
    }
    if (!form.reason) {
      toast.error("Selecciona el motivo de la baja");
      return;
    }
    if (!calculationData) {
      toast.error("Resuelve los datos del finiquito antes de guardar la baja");
      return;
    }
    if (!session?.user?.companyId) {
      toast.error("Error de sesión");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/employees/lifecycle?type=offboarding", {
        method: "PUT", // API route uses PUT for offboarding creation or POST? 
        // Wait, looking at lifecycle route, POST is for onboarding, PUT is for offboarding creation
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          companyId: session.user.companyId,
          // Financials from calculator
          accruedVacationDays: Math.round(calculationData?.accruedVacationDays || 0),
          vacationPay: Math.round((calculationData?.vacationPay || 0) * 100),
          seniorityBonus: Math.round((calculationData?.seniorityBonus || 0) * 100),
          severancePay: Math.round((calculationData?.severancePay || 0) * 100),
          finalPayAmount: Math.round((calculationData?.total || 0) * 100),
          deductions: Math.round((calculationData?.deductions || 0) * 100),
          // Other data
          assetsToReturn: assetData,
          exitInterviewNotes: exitNotes,
          exitInterviewCompleted: !!exitNotes,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Error al procesar la baja");
      }

      toast.success("Proceso de baja iniciado correctamente");
      router.push("/dashboard/employees/offboarding");
    } catch (error: any) {
      console.error("Error offboarding:", error);
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const selectedEmployee = employees.find(e => e.id === form.userId);

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-4 lg:p-6 pb-20">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/employees/offboarding">
            <ArrowLeft className="h-4 w-4 mr-1" /> Volver
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <LogOut className="h-6 w-6 text-red-600" />
          Nueva Baja de Empleado
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Inicia el proceso de desincorporación y cálculo de liquidación
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Info Column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Empleado y Sucursal */}
            <Card>
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4" /> Información Básica
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Empleado *</Label>
                  <Select value={form.userId} onValueChange={v => { setCalculationData(null); setForm(f => ({ ...f, userId: v })); }}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona..." />
                    </SelectTrigger>
                    <SelectContent>
                      {loadingEmployees ? (
                        <SelectItem value="_loading" disabled>Cargando...</SelectItem>
                      ) : employees.map(emp => (
                        <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Sucursal *</Label>
                  <Select value={form.branchId} onValueChange={v => { setCalculationData(null); setForm(f => ({ ...f, branchId: v })); }}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona..." />
                    </SelectTrigger>
                    <SelectContent>
                      {loadingBranches ? (
                        <SelectItem value="_loading" disabled>Cargando...</SelectItem>
                      ) : branches.map(b => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <Label>Motivo de la Baja *</Label>
                  <Select value={form.reason} onValueChange={v => { setCalculationData(null); setForm(f => ({ ...f, reason: v })); }}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona el motivo..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="VOLUNTARY_RESIGNATION">Renuncia Voluntaria</SelectItem>
                      <SelectItem value="TERMINATION_WITHOUT_CAUSE">Despido Injustificado (con indemnización)</SelectItem>
                      <SelectItem value="TERMINATION_WITH_CAUSE">Rescisión con Causa (sin indemnización)</SelectItem>
                      <SelectItem value="CONTRACT_EXPIRED">Término de Contrato</SelectItem>
                      <SelectItem value="MUTUAL_AGREEMENT">Mutuo Acuerdo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Fechas */}
            <Card>
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calendar className="h-4 w-4" /> Fechas Clave
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Fecha de Notificación</Label>
                  <Input 
                    type="date" 
                    value={form.resignationDate} 
                    onChange={e => setForm(f => ({ ...f, resignationDate: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Último Día de Trabajo *</Label>
                  <Input 
                    type="date" 
                    value={form.lastWorkingDay} 
                    onChange={e => { setCalculationData(null); setForm(f => ({ ...f, lastWorkingDay: e.target.value })); }}
                    required
                  />
                </div>
              </CardContent>
            </Card>

            {/* Settlement Calculator */}
            {selectedEmployee ? (
              <SettlementCalculator 
                key={`${form.userId}:${form.branchId}`}
                employee={selectedEmployee}
                lastWorkingDay={form.lastWorkingDay}
                reason={form.reason}
                onCalculationChange={setCalculationData}
              />
            ) : (
              <div className="p-12 text-center border-2 border-dashed rounded-xl bg-slate-50 text-muted-foreground">
                Selecciona un empleado para calcular su liquidación
              </div>
            )}

            {/* Exit Interview */}
            <ExitInterviewForm 
              onNotesChange={setExitNotes}
              onConductedByChange={() => {}} 
            />
          </div>

          {/* Sidebar Column */}
          <div className="space-y-6">
            <AssetChecklist 
              onAssetsChange={setAssetData}
            />

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Consejos LFT</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground space-y-2">
                <p>• La <b>Renuncia Voluntaria</b> solo obliga al pago de partes proporcionales (aguinaldo, vacaciones, prima).</p>
                <p>• El <b>Despido Injustificado</b> incluye indemnización constitucional (3 meses de salario).</p>
                <p>• Asegúrate de recabar la firma del finiquito y la carta renuncia ante testigos.</p>
              </CardContent>
            </Card>

            <div className="sticky bottom-6 pt-4">
              <Button type="submit" className="w-full shadow-lg h-12" disabled={loading || !form.userId || !calculationData}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Finalizar y Guardar Baja
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
