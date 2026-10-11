"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertTriangle,
  Calendar,
  Users,
  Copy,
  FileSpreadsheet,
  RefreshCw,
  Building2,
} from "lucide-react";
import { WeeklyMatrixView } from "./WeeklyMatrixView";
import { useShiftValidation, useSchedulerCatalog } from "@/hooks";

/**
 * Planificador de turnos.
 *
 * Las sucursales, los empleados y los roles salen de `useSchedulerCatalog`,
 * que pregunta al servidor por los de la empresa de la sesión. Antes eran tres
 * arrays fijos en este archivo —`MOCK_BRANCHES`, `MOCK_EMPLOYEES`,
 * `MOCK_ROLES`— que se pintaban como conteos reales y terminaban en una
 * escritura contra la base (H03).
 *
 * Tres estados que la pantalla distingue a propósito:
 *
 * - **Cargando**: no hay nada que contar todavía; se dice.
 * - **Error**: no se puede escribir. Las listas vacías dirían "no tienes
 *   personal", y el operador guardaría un turno con el primer id en blanco.
 * - **Sin alcance**: tu rol está acotado a sucursal y no tienes ninguna
 *   asignada. Es un dato pendiente de tu cuenta, no un empresa vacía.
 *
 * La exportación vive en la matriz para compartir semana y filtros. Las
 * pestañas de plantillas/asignación masiva siguen pendientes (C11 y C12).
 */
export function ShiftSchedulerContainer() {
  const [activeTab, setActiveTab] = useState("weekly");
  const { conflictSummary } = useShiftValidation();
  const {
    branches,
    employees,
    roles,
    sinAlcance,
    isLoading: isCatalogLoading,
    isError: isCatalogError,
    error: catalogError,
    refetch,
  } = useSchedulerCatalog();

  const puedePlanificar =
    !isCatalogLoading && !isCatalogError && !sinAlcance && employees.length > 0;

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Gestión de Turnos</h1>
          <p className="text-muted-foreground">
            Administra los horarios de tus empleados de manera eficiente
          </p>
        </div>
        <div className="flex items-center gap-2">
          {conflictSummary.hasConflicts && (
            <Alert variant="destructive" className="py-2 px-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {conflictSummary.errorCount} conflicto(s) detectado(s)
              </AlertDescription>
            </Alert>
          )}
        </div>
      </div>

      {/* Estado del catálogo: carga, error y falta de alcance */}
      {isCatalogError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex-1">
            No pudimos cargar las sucursales ni el personal, así que no se puede
            planificar. {catalogError?.message}
          </AlertDescription>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
        </Alert>
      )}

      {!isCatalogError && sinAlcance && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Tu usuario está acotado a una sucursal y no tiene ninguna asignada.
            Pide que te asignen una antes de planificar turnos.
          </AlertDescription>
        </Alert>
      )}

      {!isCatalogError && !sinAlcance && !isCatalogLoading && employees.length === 0 && (
        <Alert>
          <Building2 className="h-4 w-4" />
          <AlertDescription>
            Todavía no hay personal dado de alta en esta empresa. Los turnos se
            crean cuando existan empleados: sin ellos no hay a quién asignar un
            horario.
          </AlertDescription>
        </Alert>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Turnos</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {/* `--` era un número inventado. El total llega con la semana que
                carga la matriz, en C10. */}
            <div className="text-2xl font-bold">—</div>
            <p className="text-xs text-muted-foreground">Esta semana</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Empleados</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isCatalogLoading ? "—" : employees.length}
            </div>
            <p className="text-xs text-muted-foreground">
              {isCatalogLoading ? "Cargando" : "En tu alcance"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sucursales</CardTitle>
            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isCatalogLoading ? "—" : branches.length}
            </div>
            <p className="text-xs text-muted-foreground">
              {isCatalogLoading ? "Cargando" : "Visibles"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Conflictos</CardTitle>
            <Copy className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${conflictSummary.errorCount > 0 ? "text-red-500" : ""}`}>
              {isCatalogLoading ? "—" : conflictSummary.errorCount}
            </div>
            <p className="text-xs text-muted-foreground">Requieren atención</p>
          </CardContent>
        </Card>
      </div>

      {/* Main content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="weekly">Vista Semanal</TabsTrigger>
          <TabsTrigger value="templates" disabled>
            Plantillas
          </TabsTrigger>
          <TabsTrigger value="bulk" disabled>
            Asignación Masiva
          </TabsTrigger>
        </TabsList>

        <TabsContent value="weekly" className="mt-6">
          {puedePlanificar ? (
            <WeeklyMatrixView branches={branches} roles={roles} employees={employees} />
          ) : (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                {isCatalogLoading
                  ? "Cargando tu catálogo de turnos…"
                  : isCatalogError
                    ? "Sin catálogo no hay planificación. Usa Reintentar cuando se haya resuelto."
                    : sinAlcance
                      ? "Sin sucursal asignada no hay nada que planificar."
                      : "Sin personal no hay turnos que crear."}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="templates" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Plantillas de Turnos</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                Plantillas predefinidas para turnos recurrentes.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bulk" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Asignación Masiva</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                Crea múltiples turnos para varios empleados a la vez.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
