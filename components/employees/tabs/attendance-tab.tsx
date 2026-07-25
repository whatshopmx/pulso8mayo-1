"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Clock, MapPin, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface AttendanceTabProps {
  attendanceRecords: any[];
  vacationBalance?: number;
}

const attendanceStatusLabels: Record<string, string> = {
  ON_TIME: "Puntual",
  LATE: "Retardo",
  EARLY_DEPARTURE: "Salida Anticipada",
  ABSENT: "Falta",
};

const attendanceStatusColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ON_TIME: "default",
  LATE: "destructive",
  EARLY_DEPARTURE: "secondary",
  ABSENT: "destructive",
};

export function AttendanceTab({ attendanceRecords, vacationBalance }: AttendanceTabProps) {
  // Mock data for now - can be fetched from API later
  const currentWeekHours = 32.5;
  const monthToDateHours = 128;
  const overtimeHours = 4.5;
  const absencesThisMonth = 0;
  const tardinessThisMonth = 2;

  return (
    <div className="space-y-6">
      {/* Attendance Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Resumen de Asistencia</CardTitle>
          <CardDescription>
            Vista general del registro de asistencia y jornada laboral
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <div className="p-4 border rounded-lg text-center">
              <Label className="text-xs text-muted-foreground">Semana Actual</Label>
              <div className="text-2xl font-bold mt-1">{currentWeekHours}h</div>
              <div className="text-xs text-muted-foreground">horas trabajadas</div>
            </div>
            <div className="p-4 border rounded-lg text-center">
              <Label className="text-xs text-muted-foreground">Acumulado Mes</Label>
              <div className="text-2xl font-bold mt-1">{monthToDateHours}h</div>
              <div className="text-xs text-muted-foreground">horas totales</div>
            </div>
            <div className="p-4 border rounded-lg text-center">
              <Label className="text-xs text-muted-foreground">Horas Extra</Label>
              <div className="text-2xl font-bold mt-1">{overtimeHours}h</div>
              <div className="text-xs text-muted-foreground">este mes</div>
            </div>
            <div className="p-4 border rounded-lg text-center">
              <Label className="text-xs text-muted-foreground">Faltas</Label>
              <div className="text-2xl font-bold mt-1">{absencesThisMonth}</div>
              <div className="text-xs text-muted-foreground">este mes</div>
            </div>
            <div className="p-4 border rounded-lg text-center">
              <Label className="text-xs text-muted-foreground">Retardos</Label>
              <div className="text-2xl font-bold mt-1">{tardinessThisMonth}</div>
              <div className="text-xs text-muted-foreground">este mes</div>
            </div>
          </div>

          {vacationBalance !== undefined && (
            <>
              <Separator className="my-4" />
              <div className="p-4 border rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm font-semibold">Saldo de Vacaciones</Label>
                    <div className="text-3xl font-bold mt-1">{vacationBalance} días</div>
                    <div className="text-xs text-muted-foreground">disponibles</div>
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>Registro Reciente</CardTitle>
          <CardDescription>
            Últimos 10 registros de checada de entrada y salida
          </CardDescription>
        </CardHeader>
        <CardContent>
          {attendanceRecords && attendanceRecords.length > 0 ? (
            <div className="space-y-2">
              {attendanceRecords.slice(0, 10).map((record: any, index: number) => (
                <div
                  key={record.id || index}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <Clock className="h-5 w-5 text-primary" />
                    <div>
                      <div className="font-medium text-sm">
                        {record.clockIn
                          ? format(new Date(record.clockIn), "d 'de' MMM, yyyy", { locale: es })
                          : "N/A"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {record.clockIn
                          ? format(new Date(record.clockIn), "h:mm a", { locale: es })
                          : ""}
                        {record.clockOut &&
                          ` - ${format(new Date(record.clockOut), "h:mm a", { locale: es })}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {record.gpsLocation && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        <span className="hidden md:inline">{record.gpsLocation}</span>
                      </div>
                    )}
                    {record.status && (
                      <Badge
                        variant={attendanceStatusColors[record.status] || "outline"}
                      >
                        {attendanceStatusLabels[record.status] || record.status}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <Clock className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Sin Registros de Asistencia</h3>
              <p className="text-muted-foreground text-sm">
                Las checadas de entrada y salida aparecerán aquí conforme el colaborador las registre.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Schedule Calendar Placeholder */}
      <Card>
        <CardHeader>
          <CardTitle>Calendario de Turnos</CardTitle>
          <CardDescription>
            Próximos turnos programados y cuadrante laboral
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <Clock className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-sm">
              Módulo de cuadrante de turnos en sincronización activa.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Muestra la comparación entre turnos programados y checadas reales con alertas de tolerancia.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
