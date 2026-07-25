"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { TrainingTab } from "@/components/employees/tabs/training-tab";
import { BenefitsTab } from "@/components/employees/tabs/benefits-tab";
import {
  User,
  Briefcase,
  FileText,
  FolderOpen,
  Calendar,
  Clock,
  FileCheck,
  Award,
  GraduationCap,
  Loader2,
} from "lucide-react";
import { useSession } from "@/hooks/use-session";
import { EmployeeHeader } from "@/components/employees/employee-header";
import { PersonalTab } from "@/components/employees/tabs/personal-tab";
import { ProfessionalTab } from "@/components/employees/tabs/professional-tab";
import { ContractsTab } from "@/components/employees/tabs/contracts-tab";
import { DocumentsTab } from "@/components/employees/tabs/documents-tab";
import { OnboardingTab } from "@/components/employees/tabs/onboarding-tab";
import { AttendanceTab } from "@/components/employees/tabs/attendance-tab";
import { AuditTab } from "@/components/employees/tabs/audit-tab";
import { PersonalDialog } from "@/components/employees/personal-dialog";
import { ProfessionalDialog } from "@/components/employees/professional-dialog";
import { EmployeeDialog } from "@/components/employees/employee-dialog";
import { toast } from "sonner";

// Type definitions based on database schema
interface EmployeeProfile {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  employeeNumber: string | null;
  position: string | null;
  department: string | null;
  employeeStatus: string | null;
  profilePhotoUrl: string | null;
  skills: string[] | null;
  // Additional profile fields from employee_profiles table
  [key: string]: unknown;
}

interface EmployeeContract {
  id: string;
  userId: string;
  companyId: string;
  contractNumber: string;
  contractType: string;
  workRegime: string;
  startDate: string;
  endDate: string | null;
  baseSalary: number;
  monthlySalary: number | null;
  weeklySalary: number | null;
  status: string;
  hasHealthInsurance: boolean | null;
  hasLifeInsurance: boolean | null;
  hasSavingsFund: boolean | null;
  hasFoodVouchers: boolean | null;
  hasTransportationBonus: boolean | null;
  workStartTime: string | null;
  workEndTime: string | null;
  breakDurationMinutes: number | null;
  workDays: number[] | null;
}

interface SalaryHistoryEntry {
  id: string;
  userId: string;
  contractId: string | null;
  previousSalary: number | null;
  newSalary: number;
  percentageChange: number | null;
  changeType: string;
  reason: string | null;
  effectiveDate: string;
}

interface OnboardingStep {
  id: string;
  onboardingId: string;
  stepName: string;
  stepCategory: string;
  description: string | null;
  status: string;
  dueDate: string | null;
  completedDate: string | null;
  notes: string | null;
}

interface OnboardingData {
  id: string;
  userId: string;
  companyId: string;
  status: string;
  startDate: string;
  targetEndDate: string | null;
  completedDate: string | null;
  assignedBuddyId: string | null;
  assignedMentorId: string | null;
  totalSteps: number;
  completedSteps: number;
  progressPercentage: number;
  notes: string | null;
  steps?: OnboardingStep[];
}

interface EmployeeDocument {
  id: string;
  userId: string;
  companyId: string;
  documentType: string;
  documentName: string | null;
  documentUrl: string | null;
  fileKey: string | null;
  status: string;
  expirationDate: string | null;
  createdAt: string;
  uploadedBy: string | null;
}

interface EmployeeBenefit {
  id: string;
  userId: string;
  companyId: string;
  benefitType: string;
  provider: string | null;
  policyNumber: string | null;
  coverageAmount: number | null;
  isActive: boolean;
  startDate: string;
  endDate: string | null;
  employeeContribution: number;
  employerContribution: number;
  beneficiaries: unknown[] | null;
}

interface EmployeeTraining {
  id: string;
  userId: string;
  companyId: string;
  trainingName: string;
  trainingType: string;
  provider: string | null;
  startDate: string;
  endDate: string | null;
  completionDate: string | null;
  expirationDate: string | null;
  status: string;
  certificationNumber: string | null;
  isMandatory: boolean;
}

interface AttendanceRecord {
  id: string;
  userId: string;
  companyId: string;
  clockIn: string;
  clockOut: string | null;
  status: string;
  gpsLocation: string | null;
  notes: string | null;
  createdAt: string;
}

export default function EmployeeProfilePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session, loading: sessionLoading } = useSession();

  const employeeId = params?.id as string;
  const defaultTab = searchParams?.get("tab") || "personal";
  const [activeTab, setActiveTab] = useState(defaultTab);

  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [contracts, setContracts] = useState<EmployeeContract[]>([]);
  const [salaryHistory, setSalaryHistory] = useState<SalaryHistoryEntry[]>([]);
  const [onboarding, setOnboarding] = useState<OnboardingData | null>(null);
  const [onboardingSteps, setOnboardingSteps] = useState<OnboardingStep[]>([]);
  const [documents, setDocuments] = useState<EmployeeDocument[]>([]);
  const [benefits, setBenefits] = useState<EmployeeBenefit[]>([]);
  const [training, setTraining] = useState<EmployeeTraining[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showPersonalDialog, setShowPersonalDialog] = useState(false);
  const [showProfessionalDialog, setShowProfessionalDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);

  const companyId = session?.user?.companyId;
  const userRole = session?.user?.role;
  const canEdit = userRole === "ADMIN" || userRole === "GERENTE";

  const fetchEmployeeData = useCallback(async () => {
    if (!employeeId || sessionLoading) return;
    if (!session?.user) {
      setLoading(false);
      setLoadError("No authenticated session available.");
      return;
    }

    setLoading(true);
    setLoadError(null);
    try {
      // Fetch profile with all related data
      const response = await fetch(
        `/api/employees/${employeeId}?includeContracts=true&includeSalary=true&includeOnboarding=true&includeDocuments=true&includeBenefits=true&includeTraining=true&includeVacation=true&includeAttendance=true`
      );

      if (response.ok) {
        const data = await response.json();
        setProfile(data.data);
        setContracts(data.data.contracts || []);
        setSalaryHistory(data.data.salaryHistory || []);
        setOnboarding(data.data.onboarding || null);
        setOnboardingSteps(data.data.onboarding?.steps || []);
        setDocuments(data.data.documents || []);
        setBenefits(data.data.benefits || []);
        setTraining(data.data.training || []);
        setAttendance(data.data.attendance || []);
      } else {
        const errorData = await response.json().catch(() => null);
        const message =
          errorData?.error ||
          (response.status === 404
            ? "Employee not found"
            : "Unable to load employee data");

        setProfile(null);
        setContracts([]);
        setSalaryHistory([]);
        setOnboarding(null);
        setOnboardingSteps([]);
        setDocuments([]);
        setBenefits([]);
        setTraining([]);
        setAttendance([]);
        setLoadError(message);
        toast.error(message);
      }
    } catch (error) {
      console.error("Error fetching employee:", error);
      setLoadError("Error loading employee data");
      toast.error("Error loading employee data");
    } finally {
      setLoading(false);
    }
  }, [employeeId, session, sessionLoading]);

  useEffect(() => {
    fetchEmployeeData();
  }, [fetchEmployeeData]);

  const handleBack = () => {
    router.push("/dashboard/employees");
  };

  const handleTabChange = (newTab: string) => {
    setActiveTab(newTab);
    const currentUrlParams = new URLSearchParams(searchParams?.toString() || "");
    currentUrlParams.set("tab", newTab);
    router.replace(`/dashboard/employees/${employeeId}?${currentUrlParams.toString()}`, { scroll: false });
  };

  const handleEditSuccess = () => {
    fetchEmployeeData();
  };

  if (loading || sessionLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="animate-spin h-8 w-8 text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Cargando expediente del colaborador...</p>
        </div>
      </div>
    );
  }

  if (loadError && !profile) {
    return (
      <div className="text-center py-12">
        <User className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">No se pudo cargar la información del colaborador</h3>
        <p className="text-muted-foreground mb-4">
          {loadError}
        </p>
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" onClick={handleBack}>Volver al Directorio</Button>
          <Button onClick={fetchEmployeeData}>Reintentar</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <EmployeeHeader
        employee={{
          id: profile.id,
          userName: profile.userName,
          userEmail: profile.userEmail,
          employeeNumber: profile.employeeNumber,
          employeeStatus: profile.employeeStatus,
          profilePhotoUrl: profile.profilePhotoUrl,
          position: profile.position,
          department: profile.department,
        }}
        onBack={handleBack}
        onEdit={() => setShowEditDialog(true)}
        onSelectTab={handleTabChange}
        canEdit={canEdit}
      />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="overflow-x-auto pb-1 no-scrollbar">
          <TabsList className="inline-flex h-10 items-center justify-start rounded-lg bg-muted p-1 text-muted-foreground w-auto min-w-full">
            <TabsTrigger value="personal" className="flex items-center gap-2 whitespace-nowrap px-3.5 py-1.5 text-xs font-medium shrink-0 transition-colors data-[state=active]:font-semibold data-[state=active]:text-foreground">
              <User className="h-4 w-4 shrink-0" />
              <span>Personal</span>
            </TabsTrigger>
            <TabsTrigger value="professional" className="flex items-center gap-2 whitespace-nowrap px-3.5 py-1.5 text-xs font-medium shrink-0 transition-colors data-[state=active]:font-semibold data-[state=active]:text-foreground">
              <Briefcase className="h-4 w-4 shrink-0" />
              <span>Expediente</span>
            </TabsTrigger>
            <TabsTrigger value="contracts" className="flex items-center gap-2 whitespace-nowrap px-3.5 py-1.5 text-xs font-medium shrink-0 transition-colors data-[state=active]:font-semibold data-[state=active]:text-foreground">
              <FileText className="h-4 w-4 shrink-0" />
              <span>Contratos</span>
            </TabsTrigger>
            <TabsTrigger value="documents" className="flex items-center gap-2 whitespace-nowrap px-3.5 py-1.5 text-xs font-medium shrink-0 transition-colors data-[state=active]:font-semibold data-[state=active]:text-foreground">
              <FolderOpen className="h-4 w-4 shrink-0" />
              <span>Documentos</span>
            </TabsTrigger>
            <TabsTrigger value="onboarding" className="flex items-center gap-2 whitespace-nowrap px-3.5 py-1.5 text-xs font-medium shrink-0 transition-colors data-[state=active]:font-semibold data-[state=active]:text-foreground">
              <Calendar className="h-4 w-4 shrink-0" />
              <span>Onboarding</span>
            </TabsTrigger>
            <TabsTrigger value="attendance" className="flex items-center gap-2 whitespace-nowrap px-3.5 py-1.5 text-xs font-medium shrink-0 transition-colors data-[state=active]:font-semibold data-[state=active]:text-foreground">
              <Clock className="h-4 w-4 shrink-0" />
              <span>Asistencia</span>
            </TabsTrigger>
            <TabsTrigger value="benefits" className="flex items-center gap-2 whitespace-nowrap px-3.5 py-1.5 text-xs font-medium shrink-0 transition-colors data-[state=active]:font-semibold data-[state=active]:text-foreground">
              <Award className="h-4 w-4 shrink-0" />
              <span>Prestaciones</span>
            </TabsTrigger>
            <TabsTrigger value="training" className="flex items-center gap-2 whitespace-nowrap px-3.5 py-1.5 text-xs font-medium shrink-0 transition-colors data-[state=active]:font-semibold data-[state=active]:text-foreground">
              <GraduationCap className="h-4 w-4 shrink-0" />
              <span>Capacitación</span>
            </TabsTrigger>
            <TabsTrigger value="audit" className="flex items-center gap-2 whitespace-nowrap px-3.5 py-1.5 text-xs font-medium shrink-0 transition-colors data-[state=active]:font-semibold data-[state=active]:text-foreground">
              <FileCheck className="h-4 w-4 shrink-0" />
              <span>Auditoría</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="personal" className="mt-6">
          <PersonalTab profile={profile} onEdit={() => setShowPersonalDialog(true)} canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="professional" className="mt-6">
          <ProfessionalTab profile={profile} onEdit={() => setShowProfessionalDialog(true)} canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="contracts" className="mt-6">
          <ContractsTab
            contracts={contracts}
            salaryHistory={salaryHistory}
            canEdit={canEdit}
            employeeId={employeeId}
            companyId={companyId}
            branchId={session?.user?.branchId}
            onContractCreated={fetchEmployeeData}
            onContractUpdated={fetchEmployeeData}
          />
        </TabsContent>

        <TabsContent value="documents" className="mt-6">
          <DocumentsTab 
            documents={documents} 
            employeeId={employeeId} 
            companyId={companyId}
            onSuccess={fetchEmployeeData}
            canEdit={canEdit}
            canValidate={canEdit} // For now, admins/gerentes can also validate
          />
        </TabsContent>


        <TabsContent value="onboarding" className="mt-6">
          <OnboardingTab onboarding={onboarding} steps={onboardingSteps} />
        </TabsContent>

        <TabsContent value="attendance" className="mt-6">
          <AttendanceTab attendanceRecords={attendance} />
        </TabsContent>

        <TabsContent value="benefits" className="mt-6">
          <BenefitsTab 
            benefits={benefits} 
            employeeId={employeeId}
            companyId={companyId}
            onSuccess={fetchEmployeeData}
          />
        </TabsContent>

        <TabsContent value="training" className="mt-6">
          <TrainingTab 
            training={training} 
            skills={profile.skills} 
            employeeId={employeeId}
            companyId={companyId}
            onSuccess={fetchEmployeeData}
          />
        </TabsContent>

        <TabsContent value="audit" className="mt-6">
          <AuditTab userId={profile.userId} />
        </TabsContent>
      </Tabs>

      {/* Edit Dialogs */}
      <EmployeeDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        onSuccess={handleEditSuccess}
        companyId={companyId || ""}
        employee={profile}
      />
      <PersonalDialog
        open={showPersonalDialog}
        onOpenChange={setShowPersonalDialog}
        onSuccess={handleEditSuccess}
        employeeId={employeeId}
        profile={profile}
      />
      <ProfessionalDialog
        open={showProfessionalDialog}
        onOpenChange={setShowProfessionalDialog}
        onSuccess={handleEditSuccess}
        employeeId={employeeId}
        profile={profile}
      />
    </div>
  );
}
