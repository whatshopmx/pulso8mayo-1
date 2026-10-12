"use client";

import { useState, type FormEvent } from "react";
import { format, startOfWeek, endOfWeek } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useShiftTemplates } from "@/hooks/use-shift-templates";
import { sinMarcadores } from "@/lib/labor/shift-rules";
import type { SchedulerCatalog } from "@/app/actions/shifts";
import type { ApplyTemplateResult, BulkShiftOperation, TemplatePreview } from "@/lib/types/shifts";

const selectClass = "w-full min-h-9 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const weekDays = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export function ShiftTemplatePlanner({ branches, employees, roles, onViewShifts, mode = "templates" }: Pick<SchedulerCatalog, "branches" | "employees" | "roles"> & { onViewShifts: () => void; mode?: "templates" | "bulk" }) {
  const isBulk = mode === "bulk";
  const { templates, isLoading, error: loadError, reloadTemplates, applyTemplate, previewTemplate, isApplying } = useShiftTemplates(undefined, !isBulk);
  const [templateIndex, setTemplateIndex] = useState("");
  const [branchId, setBranchId] = useState("");
  const [role, setRole] = useState("");
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [startTime, setStartTime] = useState("07:00");
  const [endTime, setEndTime] = useState("15:00");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startDate, setStartDate] = useState(() => format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState(() => format(endOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd"));
  const [preview, setPreview] = useState<{ operation: BulkShiftOperation; rows: TemplatePreview[] } | null>(null);
  const [result, setResult] = useState<ApplyTemplateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const busy = isPreviewing || isApplying;
  const template = templateIndex === "" ? null : templates[Number(templateIndex)];
  const ready = (isBulk ? !!startTime && !!endTime && daysOfWeek.length > 0 : !!template) && !!branchId && !!role && employeeIds.length > 0 && !!startDate && !!endDate;
  const nameOf = (id: string) => employees.find((employee) => employee.id === id)?.name ?? id;
  const branchOf = (id: string) => branches.find((branch) => branch.id === id)?.name ?? id;

  async function showPreview(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy || (!isBulk && !template)) return;
    setError(null); setResult(null); setPreview(null); setIsPreviewing(true);
    const operation: BulkShiftOperation = {
      branchId, role, employeeIds, startDate, endDate, pattern: "custom",
      daysOfWeek: isBulk ? daysOfWeek : template!.daysOfWeek,
      shiftType: "CUSTOM", customStartTime: isBulk ? startTime : template!.startTime, customEndTime: isBulk ? endTime : template!.endTime,
    };
    try { setPreview({ operation, rows: await previewTemplate(operation) }); }
    catch (err) { setError(err instanceof Error ? sinMarcadores(err.message) : "No pudimos preparar la vista previa. Inténtalo de nuevo."); }
    finally { setIsPreviewing(false); }
  }

  async function confirm() {
    if (!preview || busy) return;
    setError(null);
    try { setResult(await applyTemplate(preview.operation)); }
    catch { setError("No pudimos confirmar el resultado. Revisa la Vista Semanal antes de volver a aplicar los turnos."); }
    finally { setPreview(null); }
  }

  if (!isBulk && isLoading) return <p role="status">Cargando plantillas…</p>;
  if (!isBulk && loadError) return <div role="alert" className="space-y-3"><p>{loadError}</p><Button variant="outline" onClick={() => reloadTemplates()}>Reintentar plantillas</Button></div>;
  if (!branches.length || !roles.length || (!isBulk && !templates.length)) return <p role="status">Para asignar turnos necesitas sucursales y roles disponibles{!isBulk && ", además de plantillas"}. Completa el catálogo y recarga.</p>;

  return (
    <Card>
      <CardHeader><CardTitle>{isBulk ? "Asignación Masiva" : "Plantillas de Turnos"}</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">{isBulk ? "Define el horario, los días y el personal del lote." : "Selecciona un horario recurrente y su destino."} Se guardan los turnos válidos y se informa cada rechazo. Hasta 31 días y 500 turnos por aplicación.</p>
        <form onSubmit={showPreview} onChange={() => { setPreview(null); setResult(null); setError(null); }}>
          <fieldset disabled={busy} className="space-y-4">
            <legend className="sr-only">Destino de los turnos</legend>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {!isBulk && <div className="space-y-2"><Label htmlFor="shift-template">Plantilla</Label>
                <select id="shift-template" className={selectClass} required value={templateIndex} onChange={(event) => setTemplateIndex(event.target.value)}>
                  <option value="">Selecciona una plantilla</option>
                  {templates.map((item, index) => <option key={item.name} value={index}>{item.name} ({item.startTime}–{item.endTime})</option>)}
                </select>
              </div>}
              <div className="space-y-2"><Label htmlFor="template-branch">Sucursal</Label>
                <select id="template-branch" className={selectClass} required value={branchId} onChange={(event) => setBranchId(event.target.value)}>
                  <option value="">Selecciona una sucursal</option>
                  {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </select>
              </div>
              <div className="space-y-2"><Label htmlFor="template-role">Rol del turno</Label>
                <select id="template-role" className={selectClass} required value={role} onChange={(event) => setRole(event.target.value)}>
                  <option value="">Selecciona un rol</option>
                  {roles.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
              <div className="space-y-2"><Label htmlFor="template-from">Desde</Label><Input id="template-from" type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="template-to">Hasta</Label><Input id="template-to" type="date" required min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} /></div>
              {isBulk && <>
                <div className="space-y-2"><Label htmlFor="bulk-start-time">Hora de inicio</Label><Input id="bulk-start-time" type="time" required value={startTime} onChange={(event) => setStartTime(event.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor="bulk-end-time">Hora de fin</Label><Input id="bulk-end-time" type="time" required value={endTime} onChange={(event) => setEndTime(event.target.value)} /></div>
              </>}
            </div>
            {isBulk && <fieldset className="rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">Días de la semana</legend>
              <div className="flex flex-wrap gap-3">{weekDays.map((day, index) => <label key={day} className="flex min-h-11 cursor-pointer items-center gap-2">
                <input type="checkbox" checked={daysOfWeek.includes(index)} onChange={(event) => setDaysOfWeek((current) => event.target.checked ? [...current, index] : current.filter((value) => value !== index))} />{day}
              </label>)}</div>
              <p className="text-sm text-muted-foreground">Si la hora de fin es anterior a la de inicio, el turno termina al día siguiente.</p>
            </fieldset>}
            <fieldset className="rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">Empleados ({employeeIds.length} seleccionados)</legend>
              <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                {employees.map((employee) => <label key={employee.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-muted">
                  <input type="checkbox" checked={employeeIds.includes(employee.id)} onChange={(event) => setEmployeeIds((current) => event.target.checked ? [...current, employee.id] : current.filter((id) => id !== employee.id))} />
                  <span className="text-sm">{employee.name}</span>
                </label>)}
              </div>
            </fieldset>
            <Button type="submit" variant="outline" disabled={!ready || busy}>{isPreviewing ? "Preparando vista previa…" : "Vista previa"}</Button>
          </fieldset>
        </form>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {preview && <section aria-label="Vista previa de turnos" className="space-y-4">
          <p role="status" className="text-sm">{preview.rows.filter((row) => row.canApply).length} turnos disponibles; {preview.rows.filter((row) => !row.canApply).length} rechazados en la vista previa. Al confirmar se comprueba de nuevo.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Turnos a crear y conflictos por empleado y fecha</caption>
              <thead className="bg-muted"><tr>{["Fecha", "Empleado", "Sucursal / rol", "Horario", "Resultado"].map((heading) => <th scope="col" key={heading} className="p-3 font-medium">{heading}</th>)}</tr></thead>
              <tbody>{preview.rows.map((row) => <tr key={`${row.employeeId}:${row.date}`} className="border-b">
                <td className="whitespace-nowrap p-3">{row.date}</td><td className="p-3">{nameOf(row.employeeId)}</td>
                <td className="p-3">{branchOf(row.branchId)} / {row.role}</td><td className="whitespace-nowrap p-3">{row.startTime}–{row.endTime}</td>
                <td className="min-w-48 p-3">{row.canApply ? "Disponible" : sinMarcadores(row.error ?? "Rechazado")}{row.warnings.map((warning) => <p key={warning} className="text-muted-foreground">{warning}</p>)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <Button disabled={busy || !preview.rows.some((row) => row.canApply)} onClick={confirm}>{isApplying ? "Aplicando…" : "Confirmar aplicación"}</Button>
        </section>}
        {result && <section aria-label="Resultado de aplicación" className="space-y-3">
          <p role="status">{result.created.length} turnos creados; {result.failed.length} rechazados.</p>
          <ul className="space-y-2 text-sm">
            {result.created.map((shift) => <li key={shift.id}>{shift.shiftDate} · {nameOf(shift.userId)} · {branchOf(shift.branchId)} / {shift.role} · {shift.startTime}–{shift.endTime}: Creado</li>)}
            {result.failed.map((row) => <li key={`${row.employeeId}:${row.date}`}>{row.date} · {nameOf(row.employeeId)}: Rechazado — {sinMarcadores(row.error)}</li>)}
          </ul>
          <Button variant="outline" onClick={onViewShifts}>Ver turnos en Vista Semanal</Button>
        </section>}
      </CardContent>
    </Card>
  );
}
