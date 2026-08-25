"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Plus, LogOut, Clock, CheckCircle, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useSession, useRequireRole } from "@/hooks/use-session";
import { toast } from "sonner";

interface Offboarding {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  position: string;
  department: string;
  reason: string;
  resignationDate: Date;
  lastWorkingDay: Date;
  status: string;
  assetsReturned: boolean;
  exitInterviewCompleted: boolean;
  finalApproval: boolean;
}

export default function OffboardingDashboard() {
  const { loading: authLoading } = useRequireRole(['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR']);
  const { session } = useSession();
  const router = useRouter();

  // Los hooks van SIEMPRE antes de cualquier retorno condicional:
  // si `authLoading` pasa de true a false, un return temprano cambiaría el
  // número de hooks entre renders y React lanzaría "Rendered more hooks".
  const [offboardings, setOffboardings] = useState<Offboarding[]>([]);
  const [loading, setLoading] = useState(true);

  const companyId = session?.user?.companyId;

  const fetchOffboardings = useCallback(async () => {
    if (!companyId) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/employees/lifecycle?companyId=${companyId}&type=OFFBOARDING`);
      if (response.ok) {
        const data = await response.json();
        // GET lifecycle returns { data: { offboardings: [...] } } when type=OFFBOARDING
        const list =
          data?.data?.offboardings ??
          data?.data ??
          data?.offboardings ??
          (Array.isArray(data) ? data : []);
        setOffboardings(Array.isArray(list) ? list : []);
      } else {
        toast.error("Error fetching offboardings");
      }
    } catch (error) {
      console.error("Error fetching offboardings:", error);
      toast.error("Error fetching offboardings");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    fetchOffboardings();
  }, [fetchOffboardings]);

  if (authLoading) {
    return null;
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "IN_PROGRESS":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
      case "COMPLETED":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      case "PENDING_APPROVAL":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
      case "CANCELLED":
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
    }
  };

  const getInitials = (name: string) => {
    const parts = name.split(" ");
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const REASON_LABELS: Record<string, string> = {
    VOLUNTARY_RESIGNATION: "Voluntary Resignation",
    TERMINATION_WITH_CAUSE: "Termination with Cause",
    TERMINATION_WITHOUT_CAUSE: "Termination without Cause",
    CONTRACT_EXPIRED: "Contract Expired",
    RETIREMENT: "Retirement",
    DEATH: "Death",
    MUTUAL_AGREEMENT: "Mutual Agreement",
    OTHER: "Other",
  };

  const safeOffboardings = Array.isArray(offboardings) ? offboardings : [];
  const stats = {
    total: safeOffboardings.length,
    inProgress: safeOffboardings.filter((o) => o.status === "IN_PROGRESS").length,
    completed: safeOffboardings.filter((o) => o.status === "COMPLETED").length,
    pendingApproval: safeOffboardings.filter((o) => o.status === "PENDING_APPROVAL").length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Offboarding Dashboard</h1>
          <p className="text-muted-foreground">
            Manage employee exits, settlements, and compliance
          </p>
        </div>
        <Button onClick={() => router.push("/dashboard/employees/offboarding/new")}>
          <Plus className="mr-2 h-4 w-4" />
          New Offboarding
        </Button>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Total Offboardings</CardTitle>
            <CardDescription>All time</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <LogOut className="h-5 w-5 text-muted-foreground" />
              <span className="text-2xl font-bold">{stats.total}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">In Progress</CardTitle>
            <CardDescription>Currently processing</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-blue-600" />
              <span className="text-2xl font-bold">{stats.inProgress}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Pending Approval</CardTitle>
            <CardDescription>Awaiting final approval</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
              <span className="text-2xl font-bold">{stats.pendingApproval}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <CardDescription>Successfully finished</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <span className="text-2xl font-bold">{stats.completed}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Offboarding List */}
      <Card>
        <CardHeader>
          <CardTitle>Active Offboardings</CardTitle>
          <CardDescription>
            Employees in the offboarding process
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-muted-foreground">
              Loading offboardings...
            </div>
          ) : safeOffboardings.length === 0 ? (
            <div className="py-12 text-center">
              <LogOut className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Offboardings</h3>
              <p className="text-sm text-muted-foreground mb-4">
                No employees are currently in the offboarding process
              </p>
              <Button onClick={() => router.push("/dashboard/employees/offboarding/new")}>
                <Plus className="mr-2 h-4 w-4" />
                Create Offboarding
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {safeOffboardings.map((offboarding) => (
                <div
                  key={offboarding.id}
                  className="p-4 rounded-lg border hover:bg-accent transition-colors cursor-pointer"
                  onClick={() => router.push(`/dashboard/employees/${offboarding.userId}`)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarFallback>{getInitials(offboarding.userName)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <h4 className="font-medium">{offboarding.userName}</h4>
                        <p className="text-sm text-muted-foreground">{offboarding.userEmail}</p>
                      </div>
                    </div>
                    <Badge className={getStatusColor(offboarding.status)} variant="secondary">
                      {offboarding.status}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Reason</p>
                      <p className="font-medium">
                        {REASON_LABELS[offboarding.reason] || offboarding.reason}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Resignation Date</p>
                      <p className="font-medium">
                        {format(new Date(offboarding.resignationDate), "MMM d, yyyy", {
                          locale: es,
                        })}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Last Working Day</p>
                      <p className="font-medium">
                        {format(new Date(offboarding.lastWorkingDay), "MMM d, yyyy", {
                          locale: es,
                        })}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Department</p>
                      <p className="font-medium">{offboarding.department || "—"}</p>
                    </div>
                  </div>

                  {/* Checklist */}
                  <div className="flex gap-4 pt-3 border-t">
                    <div className="flex items-center gap-2 text-sm">
                      {offboarding.assetsReturned ? (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-yellow-600" />
                      )}
                      <span className={offboarding.assetsReturned ? "text-green-600" : ""}>
                        Assets Returned
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {offboarding.exitInterviewCompleted ? (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-yellow-600" />
                      )}
                      <span className={offboarding.exitInterviewCompleted ? "text-green-600" : ""}>
                        Exit Interview
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {offboarding.finalApproval ? (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-yellow-600" />
                      )}
                      <span className={offboarding.finalApproval ? "text-green-600" : ""}>
                        Final Approval
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
