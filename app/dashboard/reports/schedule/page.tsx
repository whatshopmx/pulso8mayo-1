"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar, ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { PageHeader, PageContainer } from "@/components/shared";

const REPORT_TYPES = [
  { id: "workflow-summary", name: "Resumen de Workflows", category: "WORKFLOWS" },
  { id: "workflow-detailed", name: "Reporte Detallado de Workflows", category: "WORKFLOWS" },
  { id: "evidence-report", name: "Reporte de Evidencias", category: "EVIDENCE" },
  { id: "compliance-nom251", name: "Cumplimiento NOM-251", category: "COMPLIANCE" },
  { id: "inventory-status", name: "Estado de Inventario", category: "INVENTORY" },
  { id: "labor-attendance", name: "Asistencia y Horas", category: "LABOR" },
  { id: "performance-kpis", name: "KPIs de Rendimiento", category: "ANALYTICS" },
  { id: "incidents-report", name: "Reporte de Incidentes", category: "INCIDENTS" },
];

const FREQUENCIES = [
  { value: "DAILY", label: "Diaria" },
  { value: "WEEKLY", label: "Semanal" },
  { value: "MONTHLY", label: "Mensual" },
];

const DAYS_OF_WEEK = [
  { value: "0", label: "Domingo" },
  { value: "1", label: "Lunes" },
  { value: "2", label: "Martes" },
  { value: "3", label: "Miércoles" },
  { value: "4", label: "Jueves" },
  { value: "5", label: "Viernes" },
  { value: "6", label: "Sábado" },
];

const FORMATS = [
  { value: "PDF", label: "PDF" },
  { value: "EXCEL", label: "Excel" },
];

const DELIVERY_METHODS = [
  { value: "EMAIL", label: "Correo electrónico" },
  { value: "DOWNLOAD", label: "Solo descarga" },
  { value: "BOTH", label: "Correo y descarga" },
];

export default function ScheduleReportPage() {
  const router = useRouter();
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    name: "",
    description: "",
    dataSource: "",
    branchId: "all",
    frequency: "DAILY",
    dayOfWeek: "1",
    dayOfMonth: "1",
    time: "08:00",
    format: "PDF",
    deliveryMethod: "EMAIL",
    deliveryEmails: "",
  });

  useEffect(() => {
    fetch("/api/branches")
      .then((res) => res.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : data.branches || [];
        setBranches(list.map((b: { id: string; name: string }) => ({ id: b.id, name: b.name })));
      })
      .catch(() => {});
  }, []);

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.name || !form.dataSource) {
      toast.error("Completa los campos obligatorios");
      return;
    }

    setSubmitting(true);

    try {
      const schedule: Record<string, string | undefined> = {
        frequency: form.frequency,
        time: form.time,
        format: form.format,
      };

      if (form.frequency === "WEEKLY") {
        schedule.dayOfWeek = form.dayOfWeek;
      } else if (form.frequency === "MONTHLY") {
        schedule.dayOfMonth = form.dayOfMonth;
      }

      const res = await fetch("/api/reports/scheduled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description || undefined,
          dataSource: form.dataSource,
          fields: { format: form.format },
          schedule,
          deliveryMethod: form.deliveryMethod,
          deliveryEmails: form.deliveryEmails
            ? form.deliveryEmails.split(",").map((e: string) => e.trim())
            : [],
          branchId: form.branchId === "all" ? null : form.branchId,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Error al programar reporte");
      }

      toast.success("Reporte programado exitosamente");
      router.push("/dashboard/reports");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al programar reporte");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Programar Reporte"
        description="Configura un reporte automático con entrega periódica"
        icon={Calendar}
        actions={
          <Button asChild variant="outline">
            <Link href="/dashboard/reports">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Regresar
            </Link>
          </Button>
        }
      />

      <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Información del Reporte</CardTitle>
            <CardDescription>Define qué reporte quieres programar</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">
                Nombre del reporte <span className="text-red-500">*</span>
              </Label>
              <Input
                id="name"
                placeholder="Ej: Reporte semanal de inventario"
                value={form.name}
                onChange={(e) => updateField("name", e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Descripción</Label>
              <Textarea
                id="description"
                placeholder="Descripción opcional del reporte"
                value={form.description}
                onChange={(e) => updateField("description", e.target.value)}
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dataSource">
                Tipo de reporte <span className="text-red-500">*</span>
              </Label>
              <Select
                value={form.dataSource}
                onValueChange={(v) => updateField("dataSource", v)}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un tipo de reporte" />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_TYPES.map((rt) => (
                    <SelectItem key={rt.id} value={rt.id}>
                      {rt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="branchId">Sucursal</Label>
              <Select
                value={form.branchId}
                onValueChange={(v) => updateField("branchId", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todas las sucursales" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las sucursales</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Programación</CardTitle>
            <CardDescription>Define la frecuencia de generación</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="frequency">Frecuencia</Label>
                <Select
                  value={form.frequency}
                  onValueChange={(v) => updateField("frequency", v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FREQUENCIES.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="time">Hora de generación</Label>
                <Input
                  id="time"
                  type="time"
                  value={form.time}
                  onChange={(e) => updateField("time", e.target.value)}
                />
              </div>
            </div>

            {form.frequency === "WEEKLY" && (
              <div className="space-y-2">
                <Label htmlFor="dayOfWeek">Día de la semana</Label>
                <Select
                  value={form.dayOfWeek}
                  onValueChange={(v) => updateField("dayOfWeek", v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAYS_OF_WEEK.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {form.frequency === "MONTHLY" && (
              <div className="space-y-2">
                <Label htmlFor="dayOfMonth">Día del mes</Label>
                <Input
                  id="dayOfMonth"
                  type="number"
                  min={1}
                  max={28}
                  value={form.dayOfMonth}
                  onChange={(e) => updateField("dayOfMonth", e.target.value)}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Formato y Entrega</CardTitle>
            <CardDescription>
              Configura el formato del archivo y cómo se entrega
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="format">Formato</Label>
                <Select
                  value={form.format}
                  onValueChange={(v) => updateField("format", v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FORMATS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="deliveryMethod">Método de entrega</Label>
                <Select
                  value={form.deliveryMethod}
                  onValueChange={(v) => updateField("deliveryMethod", v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DELIVERY_METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {(form.deliveryMethod === "EMAIL" ||
              form.deliveryMethod === "BOTH") && (
              <div className="space-y-2">
                <Label htmlFor="deliveryEmails">
                  Correos electrónicos (separados por coma)
                </Label>
                <Input
                  id="deliveryEmails"
                  type="text"
                  placeholder="correo@ejemplo.com, otro@ejemplo.com"
                  value={form.deliveryEmails}
                  onChange={(e) => updateField("deliveryEmails", e.target.value)}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-4 justify-end">
          <Button variant="outline" asChild>
            <Link href="/dashboard/reports">Cancelar</Link>
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Programando...
              </>
            ) : (
              <>
                <Calendar className="h-4 w-4 mr-2" />
                Programar Reporte
              </>
            )}
          </Button>
        </div>
      </form>
    </PageContainer>
  );
}
