"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Plus, Users, Clock, CheckCircle } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useSession, useRequireRole } from "@/hooks/use-session";
import { toast } from "sonner";

interface Onboarding {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  position: string;
  department: string;
  startDate: Date;
  targetEndDate?: Date;
  progress: number;
  status: string;
  buddyName?: string;
}

export default function OnboardingDashboard() {
  const { loading: authLoading } = useRequireRole(['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR']);
  const { session } = useSession();
  const router = useRouter();

  // Los hooks van SIEMPRE antes de cualquier retorno condicional:
  // si `authLoading` pasa de true a false, un return temprano cambiaría el
  // número de hooks entre renders y React lanzaría "Rendered more hooks".
  const [onboardings, setOnboardings] = useState<Onboarding[]>([]);
  const [loading, setLoading] = useState(true);

  const companyId = session?.user?.companyId;

  const fetchOnboardings = useCallback(async () => {
    if (!companyId) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/employees/lifecycle?companyId=${companyId}&type=ONBOARDING`);
      if (response.ok) {
        const data = await response.json();
        // GET lifecycle returns { data: { onboardings: [...] } } when type=ONBOARDING
        const list =
          data?.data?.onboardings ??
          data?.data ??
          data?.onboardings ??
          (Array.isArray(data) ? data : []);
        setOnboardings(Array.isArray(list) ? list : []);
      } else {
        toast.error("Error fetching onboardings");
      }
    } catch (error) {
      console.error("Error fetching onboardings:", error);
      toast.error("Error fetching onboardings");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    fetchOnboardings();
  }, [fetchOnboardings]);

  if (authLoading) {
    return null;
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "IN_PROGRESS":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
      case "COMPLETED":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      case "OVERDUE":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300";
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

  const safeOnboardings = Array.isArray(onboardings) ? onboardings : [];
  const stats = {
    total: safeOnboardings.length,
    inProgress: safeOnboardings.filter((o) => o.status === "IN_PROGRESS").length,
    completed: safeOnboardings.filter((o) => o.status === "COMPLETED").length,
    overdue: safeOnboardings.filter((o) => o.status === "OVERDUE").length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Onboarding Dashboard</h1>
          <p className="text-muted-foreground">
            Track new employee onboarding progress and completion
          </p>
        </div>
        <Button onClick={() => router.push("/dashboard/employees/onboarding/new")}>
          <Plus className="mr-2 h-4 w-4" />
          New Onboarding
        </Button>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Total Onboardings</CardTitle>
            <CardDescription>All time</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-muted-foreground" />
              <span className="text-2xl font-bold">{stats.total}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">In Progress</CardTitle>
            <CardDescription>Currently onboarding</CardDescription>
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

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Overdue</CardTitle>
            <CardDescription>Needs attention</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-red-600" />
              <span className="text-2xl font-bold">{stats.overdue}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Onboarding List */}
      <Card>
        <CardHeader>
          <CardTitle>Active Onboardings</CardTitle>
          <CardDescription>
            Employees currently in the onboarding process
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-muted-foreground">
              Loading onboardings...
            </div>
          ) : safeOnboardings.length === 0 ? (
            <div className="py-12 text-center">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Onboardings Yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Start onboarding your first employee
              </p>
              <Button onClick={() => router.push("/dashboard/employees/onboarding/new")}>
                <Plus className="mr-2 h-4 w-4" />
                Create Onboarding
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {safeOnboardings.map((onboarding) => (
                <div
                  key={onboarding.id}
                  className="p-4 rounded-lg border hover:bg-accent transition-colors cursor-pointer"
                  onClick={() => router.push(`/dashboard/employees/${onboarding.userId}`)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarFallback>{getInitials(onboarding.userName)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <h4 className="font-medium">{onboarding.userName}</h4>
                        <p className="text-sm text-muted-foreground">{onboarding.userEmail}</p>
                      </div>
                    </div>
                    <Badge className={getStatusColor(onboarding.status)} variant="secondary">
                      {onboarding.status}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Position</p>
                      <p className="font-medium">{onboarding.position || "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Department</p>
                      <p className="font-medium">{onboarding.department || "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Start Date</p>
                      <p className="font-medium">
                        {format(new Date(onboarding.startDate), "MMM d, yyyy", { locale: es })}
                      </p>
                    </div>
                    {onboarding.buddyName && (
                      <div>
                        <p className="text-xs text-muted-foreground">Buddy</p>
                        <p className="font-medium">{onboarding.buddyName}</p>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span>Progress</span>
                      <span>{onboarding.progress}%</span>
                    </div>
                    <Progress value={onboarding.progress} className="h-2" />
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
