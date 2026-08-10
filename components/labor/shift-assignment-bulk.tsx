"use client"

import * as React from "react"
import { format, addDays, isSameDay, parseISO } from "date-fns"
import { es } from "date-fns/locale"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Clock, Calendar, Repeat } from "lucide-react"

export interface Employee {
    id: string
    name: string
    email: string
    role: string
    image?: string
    branchId: string
}

export interface ShiftAssignment {
    id: string
    employeeId: string
    employeeName: string
    employeeImage?: string
    shiftType: "MATUTINO" | "VESPERTINO" | "NOCTURNO" | "MIXTO" | "CUSTOM"
    date: string
    startTime: string
    endTime: string
    status: "DRAFT" | "PUBLISHED"
    notes?: string
    role: string
    branchId: string
    branchName: string
}

export interface VacationRequest {
    id: string
    userId: string
    userName: string
    startDate: string
    endDate: string
    status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "COMPLETED"
}

interface ShiftTypeConfig {
    label: string
    defaultStart: string
    defaultEnd: string
    color: string
    dotColor?: string
}

const SHIFT_TYPES: Record<string, ShiftTypeConfig> = {
    MATUTINO: {
        label: "Matutino",
        defaultStart: "07:00",
        defaultEnd: "15:00",
        color: "bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 border-blue-200/50",
        dotColor: "bg-blue-500",
    },
    VESPERTINO: {
        label: "Vespertino",
        defaultStart: "15:00",
        defaultEnd: "23:00",
        color: "bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400 border-orange-200/50",
        dotColor: "bg-orange-500",
    },
    NOCTURNO: {
        label: "Nocturno",
        defaultStart: "23:00",
        defaultEnd: "07:00",
        color: "bg-purple-500/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400 border-purple-200/50",
        dotColor: "bg-purple-500",
    },
    MIXTO: {
        label: "Mixto",
        defaultStart: "10:00",
        defaultEnd: "18:00",
        color: "bg-green-500/10 text-green-600 dark:bg-green-500/20 dark:text-green-400 border-green-200/50",
        dotColor: "bg-green-500",
    },
    CUSTOM: {
        label: "Personalizado",
        defaultStart: "09:00",
        defaultEnd: "17:00",
        color: "bg-gray-500/10 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400 border-gray-200/50",
        dotColor: "bg-gray-500",
    }
}

type RecurrencePattern = "none" | "daily" | "weekly" | "custom"

interface BulkShiftAssignmentProps {
    employees: Employee[]
    selectedDate: Date
    assignments: ShiftAssignment[]
    vacations?: VacationRequest[]
    onAssignmentsChange?: (assignments: ShiftAssignment[]) => void
}

export function BulkShiftAssignment({
    employees,
    selectedDate,
    assignments,
    vacations = [],
    onAssignmentsChange
}: BulkShiftAssignmentProps) {
    const [selectedEmployeeIds, setSelectedEmployeeIds] = React.useState<string[]>([])
    const [selectedShiftType, setSelectedShiftType] = React.useState<keyof typeof SHIFT_TYPES>("MATUTINO")
    const [customStart, setCustomStart] = React.useState("")
    const [customEnd, setCustomEnd] = React.useState("")
    const [recurrencePattern, setRecurrencePattern] = React.useState<RecurrencePattern>("none")
    const [endDate, setEndDate] = React.useState<string>("")
    const [selectedDays, setSelectedDays] = React.useState<string[]>([])

    React.useEffect(() => {
        const config = SHIFT_TYPES[selectedShiftType]
        setCustomStart(config.defaultStart)
        setCustomEnd(config.defaultEnd)
    }, [selectedShiftType])

    // Check if employee is on vacation on the selected date
    const isEmployeeOnVacation = (employeeId: string) => {
        return vacations.some(v => 
            v.userId === employeeId &&
            v.status === "APPROVED" &&
            selectedDate >= new Date(v.startDate) &&
            selectedDate <= new Date(v.endDate)
        )
    }

    const handleToggleEmployee = (employeeId: string) => {
        setSelectedEmployeeIds(prev =>
            prev.includes(employeeId)
                ? prev.filter(id => id !== employeeId)
                : [...prev, employeeId]
        )
    }

    const handleSelectAllEmployees = () => {
        if (selectedEmployeeIds.length === employees.length) {
            setSelectedEmployeeIds([])
        } else {
            setSelectedEmployeeIds(employees.map(e => e.id))
        }
    }

    const handleToggleDay = (dayIndex: number) => {
        const dayStr = dayIndex.toString()
        setSelectedDays(prev =>
            prev.includes(dayStr)
                ? prev.filter(d => d !== dayStr)
                : [...prev, dayStr]
        )
    }

    const getDatesForRecurrence = (): Date[] => {
        const dates: Date[] = []
        const startDate = selectedDate

        if (recurrencePattern === "none") {
            return [startDate]
        }

        if (recurrencePattern === "daily" && endDate) {
            let currentDate = startDate
            const end = new Date(endDate)
            while (currentDate <= end) {
                dates.push(new Date(currentDate))
                currentDate = addDays(currentDate, 1)
            }
            return dates
        }

        if (recurrencePattern === "weekly" && endDate) {
            let currentDate = startDate
            const end = new Date(endDate)
            while (currentDate <= end) {
                dates.push(new Date(currentDate))
                currentDate = addDays(currentDate, 7)
            }
            return dates
        }

        if (recurrencePattern === "custom" && selectedDays.length > 0) {
            // Get next 4 weeks
            for (let week = 0; week < 4; week++) {
                selectedDays.forEach(dayIndex => {
                    const targetDay = addDays(startDate, (week * 7) + parseInt(dayIndex))
                    dates.push(targetDay)
                })
            }
            return dates
        }

        return [startDate]
    }

    const handleAssignShifts = () => {
        if (selectedEmployeeIds.length === 0) {
            toast.error("Selecciona al menos un empleado")
            return
        }

        const dates = getDatesForRecurrence()
        const config = SHIFT_TYPES[selectedShiftType]
        const newAssignments: ShiftAssignment[] = []

        selectedEmployeeIds.forEach(employeeId => {
            const employee = employees.find(e => e.id === employeeId)
            if (!employee) return

            dates.forEach(date => {
                // Check if assignment already exists for this employee and date
                const exists = assignments.some(
                    a => a.employeeId === employeeId &&
                    isSameDay(parseISO(a.date), date)
                )

                if (!exists) {
                    newAssignments.push({
                        id: Math.random().toString(36).substr(2, 9),
                        employeeId: employee.id,
                        employeeName: employee.name,
                        employeeImage: employee.image,
                        shiftType: selectedShiftType as ShiftAssignment["shiftType"],
                        date: date.toISOString(),
                        startTime: customStart || config.defaultStart,
                        endTime: customEnd || config.defaultEnd,
                        status: "DRAFT",
                        role: employee.role,
                        branchId: employee.branchId,
                        branchName: "Default" // Add proper branchName if available
                    })
                }
            })
        })

        if (newAssignments.length === 0) {
            toast.info("Ya existen turnos asignados para esta selección")
            return
        }

        const updatedAssignments = [...assignments, ...newAssignments]
        onAssignmentsChange?.(updatedAssignments)

        toast.success(
            `${newAssignments.length} turno(s) asignado(s) a ${selectedEmployeeIds.length} empleado(s)`
        )

        // Reset selection
        setSelectedEmployeeIds([])
    }

    const weekDays = [
        { index: 0, label: "Lun", full: "Lunes" },
        { index: 1, label: "Mar", full: "Martes" },
        { index: 2, label: "Mié", full: "Miércoles" },
        { index: 3, label: "Jue", full: "Jueves" },
        { index: 4, label: "Vie", full: "Viernes" },
        { index: 5, label: "Sáb", full: "Sábado" },
        { index: 6, label: "Dom", full: "Domingo" },
    ]

    const todayDayIndex = selectedDate.getDay() === 0 ? 6 : selectedDate.getDay() - 1

    return (
        <div className="space-y-6">
            {/* Employee Selection */}
            <Card>
                <CardContent className="pt-6">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h3 className="text-lg font-semibold">Empleados</h3>
                            <p className="text-sm text-muted-foreground">
                                {selectedEmployeeIds.length} de {employees.length} seleccionados
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleSelectAllEmployees}
                        >
                            {selectedEmployeeIds.length === employees.length ? "Deseleccionar todos" : "Seleccionar todos"}
                        </Button>
                    </div>

                    <div className="grid gap-2">
                        {employees.map(employee => {
                            const onVacation = isEmployeeOnVacation(employee.id)
                            return (
                                <div
                                    key={employee.id}
                                    className={cn(
                                        "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                                        onVacation && "opacity-50 bg-blue-50 border-blue-200",
                                        selectedEmployeeIds.includes(employee.id) && !onVacation
                                            ? "bg-primary/10 border-primary"
                                            : "hover:bg-muted/50"
                                    )}
                                    onClick={() => !onVacation && handleToggleEmployee(employee.id)}
                                >
                                    <Checkbox
                                        checked={selectedEmployeeIds.includes(employee.id)}
                                        onCheckedChange={() => handleToggleEmployee(employee.id)}
                                        disabled={onVacation}
                                    />
                                    <div className="flex-1">
                                        <div className="font-medium flex items-center gap-2">
                                            {employee.name}
                                            {onVacation && (
                                                <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-300 text-xs">
                                                    🏖️ Vacaciones
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="text-sm text-muted-foreground">
                                            {employee.role}
                                        </div>
                                    </div>
                                    {!onVacation && <Badge variant="outline">{employee.role}</Badge>}
                                    {onVacation && <Badge variant="secondary">No disponible</Badge>}
                                </div>
                            )
                        })}
                    </div>
                </CardContent>
            </Card>

            {/* Shift Configuration */}
            <Card>
                <CardContent className="pt-6">
                    <h3 className="text-lg font-semibold mb-4">Configuración del Turno</h3>

                    <div className="space-y-4">
                        {/* Shift Type */}
                        <div className="space-y-2">
                            <Label>Tipo de Turno</Label>
                            <Select
                                value={selectedShiftType}
                                onValueChange={(value) => setSelectedShiftType(value as keyof typeof SHIFT_TYPES)}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.entries(SHIFT_TYPES).map(([key, config]) => (
                                        <SelectItem key={key} value={key}>
                                            <div className="flex items-center gap-2">
                                                <div className={cn("w-3 h-3 rounded-full", config.dotColor)} />
                                                {config.label}
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Custom Hours */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label className="flex items-center gap-2">
                                    <Clock className="h-4 w-4" />
                                    Hora de Inicio
                                </Label>
                                <Input
                                    type="time"
                                    value={customStart}
                                    onChange={(e) => setCustomStart(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="flex items-center gap-2">
                                    <Clock className="h-4 w-4" />
                                    Hora de Fin
                                </Label>
                                <Input
                                    type="time"
                                    value={customEnd}
                                    onChange={(e) => setCustomEnd(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* Recurrence Pattern */}
                        <div className="space-y-2">
                            <Label className="flex items-center gap-2">
                                <Repeat className="h-4 w-4" />
                                Patrón de Repetición
                            </Label>
                            <Select
                                value={recurrencePattern}
                                onValueChange={(value) => setRecurrencePattern(value as RecurrencePattern)}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">Solo este día</SelectItem>
                                    <SelectItem value="daily">Diario</SelectItem>
                                    <SelectItem value="weekly">Semanal</SelectItem>
                                    <SelectItem value="custom">Días personalizados</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* End Date for Recurrence */}
                        {recurrencePattern !== "none" && (
                            <div className="space-y-2">
                                <Label className="flex items-center gap-2">
                                    <Calendar className="h-4 w-4" />
                                    Fecha de Fin
                                </Label>
                                <Input
                                    type="date"
                                    value={endDate}
                                    min={format(selectedDate, "yyyy-MM-dd")}
                                    onChange={(e) => setEndDate(e.target.value)}
                                />
                            </div>
                        )}

                        {/* Custom Days Selection */}
                        {recurrencePattern === "custom" && (
                            <div className="space-y-2">
                                <Label>Días de la Semana</Label>
                                <div className="flex gap-2">
                                    {weekDays.map((day) => (
                                        <Button
                                            key={day.index}
                                            type="button"
                                            variant={selectedDays.includes(day.index.toString()) ? "default" : "outline"}
                                            size="sm"
                                            className="w-10 h-10 p-0"
                                            onClick={() => handleToggleDay(day.index)}
                                        >
                                            {day.label}
                                        </Button>
                                    ))}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Día actual: {weekDays[todayDayIndex]?.full}
                                </p>
                            </div>
                        )}

                        {/* Summary */}
                        {recurrencePattern !== "none" && endDate && (
                            <div className="p-3 bg-muted rounded-lg">
                                <p className="text-sm font-medium">Resumen:</p>
                                <p className="text-sm text-muted-foreground">
                                    Se asignarán turnos desde {format(selectedDate, "d 'de' MMMM")} hasta {format(new Date(endDate), "d 'de' MMMM, yyyy")}
                                    {recurrencePattern === "weekly" && " (cada 7 días)"}
                                    {recurrencePattern === "custom" && ` (${selectedDays.length} días por semana)`}
                                </p>
                            </div>
                        )}

                        {/* Assign Button */}
                        <Button
                            className="w-full"
                            onClick={handleAssignShifts}
                            disabled={selectedEmployeeIds.length === 0}
                        >
                            Asignar {selectedEmployeeIds.length > 0 ? `${selectedEmployeeIds.length} empleado(s)` : ""}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Existing Assignments */}
            {assignments.length > 0 && (
                <Card>
                    <CardContent className="pt-6">
                        <h3 className="text-lg font-semibold mb-4">
                            Turnos Asignados ({assignments.length})
                        </h3>
                        <div className="space-y-2 max-h-100 overflow-y-auto">
                            {assignments.map((assignment) => (
                                <div
                                    key={assignment.id}
                                    className={cn(
                                        "p-3 rounded-lg border bg-card",
                                        assignment.shiftType === "MATUTINO" && "border-blue-200 bg-blue-50/10 dark:border-blue-800/30 dark:bg-blue-950/10",
                                        assignment.shiftType === "VESPERTINO" && "border-orange-200 bg-orange-50/10 dark:border-orange-800/30 dark:bg-orange-950/10",
                                        assignment.shiftType === "NOCTURNO" && "border-purple-200 bg-purple-50/10 dark:border-purple-800/30 dark:bg-purple-950/10",
                                        assignment.shiftType === "MIXTO" && "border-green-200 bg-green-50/10 dark:border-green-800/30 dark:bg-green-950/10"
                                    )}
                                >
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="font-medium">{assignment.employeeName}</div>
                                            <div className="text-sm text-muted-foreground flex items-center gap-2">
                                                <Calendar className="h-3 w-3" />
                                                {format(parseISO(assignment.date), "EEEE d 'de' MMMM", { locale: es })}
                                                <Clock className="h-3 w-3 ml-2" />
                                                {assignment.startTime} - {assignment.endTime}
                                            </div>
                                        </div>
                                        <Badge variant={assignment.status === "PUBLISHED" ? "default" : "secondary"}>
                                            {assignment.status === "PUBLISHED" ? "Publicado" : "Borrador"}
                                        </Badge>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
