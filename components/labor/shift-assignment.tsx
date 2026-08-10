"use client"

import * as React from "react"
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors, closestCenter } from "@dnd-kit/core"
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical, User, Clock, Calendar } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { format as formatDate } from "date-fns"
import { es } from "date-fns/locale"

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
    shiftType: "MATUTINO" | "VESPERTINO" | "NOCTURNO" | "MIXTO"
    date: string
    startTime: string
    endTime: string
    status: "DRAFT" | "PUBLISHED"
    notes?: string
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
        dotColor: "bg-blue-500"
    },
    VESPERTINO: {
        label: "Vespertino",
        defaultStart: "15:00",
        defaultEnd: "23:00",
        color: "bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400 border-orange-200/50",
        dotColor: "bg-orange-500"
    },
    NOCTURNO: {
        label: "Nocturno",
        defaultStart: "23:00",
        defaultEnd: "07:00",
        color: "bg-purple-500/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400 border-purple-200/50",
        dotColor: "bg-purple-500"
    },
    MIXTO: {
        label: "Mixto",
        defaultStart: "10:00",
        defaultEnd: "19:00",
        color: "bg-green-500/10 text-green-600 dark:bg-green-500/20 dark:text-green-400 border-green-200/50",
        dotColor: "bg-green-500"
    }
}

interface SortableEmployeeProps {
    employee: Employee
    onAssign: (employee: Employee) => void
    onVacation?: boolean
}

function SortableEmployee({ employee, onAssign, onVacation = false }: SortableEmployeeProps) {
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
        id: employee.id
    })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition
    }

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                "flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors cursor-move",
                onVacation && "opacity-50 bg-blue-50 border-blue-200"
            )}
        >
            <div {...attributes} {...listeners} className={cn("cursor-grab active:cursor-grabbing", onVacation && "pointer-events-none")}>
                <GripVertical className="h-4 w-4 text-muted-foreground" />
            </div>
            <Avatar className="h-10 w-10">
                <AvatarImage src={employee.image} />
                <AvatarFallback>{employee.name.charAt(0)}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{employee.name}</div>
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                    <span>{employee.role}</span>
                    {onVacation && (
                        <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-300 text-xs">
                            🏖️ Vacaciones
                        </Badge>
                    )}
                </div>
            </div>
            <Button 
                size="sm" 
                onClick={() => onAssign(employee)}
                disabled={onVacation}
            >
                {onVacation ? "No Disponible" : "Asignar"}
            </Button>
        </div>
    )
}

interface ShiftAssignmentProps {
    assignment: ShiftAssignment
    onUpdate?: (assignment: ShiftAssignment) => void
    onDelete?: (id: string) => void
}

function ShiftAssignmentCard({ assignment, onUpdate, onDelete }: ShiftAssignmentProps) {
    const shiftConfig = SHIFT_TYPES[assignment.shiftType]

    return (
        <div className={cn(
            "p-3 rounded-lg border mb-2 bg-card",
            assignment.shiftType === "MATUTINO" && "border-blue-200 bg-blue-50/10 dark:border-blue-800/30 dark:bg-blue-950/10",
            assignment.shiftType === "VESPERTINO" && "border-orange-200 bg-orange-50/10 dark:border-orange-800/30 dark:bg-orange-950/10",
            assignment.shiftType === "NOCTURNO" && "border-purple-200 bg-purple-50/10 dark:border-purple-800/30 dark:bg-purple-950/10",
            assignment.shiftType === "MIXTO" && "border-green-200 bg-green-50/10 dark:border-green-800/30 dark:bg-green-950/10"
        )}>
            <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                        <AvatarFallback>{assignment.employeeName.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div>
                        <div className="font-medium">{assignment.employeeName}</div>
                        <div className="text-sm text-muted-foreground flex items-center gap-2">
                            <Clock className="h-3 w-3" />
                            {assignment.startTime} - {assignment.endTime}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Badge variant={assignment.status === "PUBLISHED" ? "default" : "secondary"}>
                        {assignment.status === "PUBLISHED" ? "Publicado" : "Borrador"}
                    </Badge>
                    {onDelete && (
                        <Button variant="ghost" size="sm" onClick={() => onDelete(assignment.id)}>
                            ×
                        </Button>
                    )}
                </div>
            </div>
            {assignment.notes && (
                <div className="mt-2 text-sm text-muted-foreground">
                    {assignment.notes}
                </div>
            )}
        </div>
    )
}

interface ShiftAssignmentBuilderProps {
    employees: Employee[]
    selectedDate: Date
    assignments: ShiftAssignment[]
    vacations?: VacationRequest[]
    onAssignmentsChange?: (assignments: ShiftAssignment[]) => void
}

export function ShiftAssignmentBuilder({
    employees,
    selectedDate,
    assignments,
    vacations = [],
    onAssignmentsChange
}: ShiftAssignmentBuilderProps) {
    const [activeId, setActiveId] = React.useState<string | null>(null)
    const [selectedShiftType, setSelectedShiftType] = React.useState<keyof typeof SHIFT_TYPES>("MATUTINO")
    const [customStart, setCustomStart] = React.useState("")
    const [customEnd, setCustomEnd] = React.useState("")

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        })
    )

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

    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id as string)
    }

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event
        setActiveId(null)

        if (over && active.id !== over.id) {
            const oldIndex = assignments.findIndex(a => a.employeeId === active.id)
            const newIndex = assignments.findIndex(a => a.employeeId === over.id)
            const newAssignments = arrayMove(assignments, oldIndex, newIndex)
            onAssignmentsChange?.(newAssignments)
        }
    }

    const handleAssignEmployee = (employee: Employee) => {
        // Check if employee is on vacation
        if (isEmployeeOnVacation(employee.id)) {
            toast.error(`${employee.name} está de vacaciones en esta fecha`)
            return
        }

        const config = SHIFT_TYPES[selectedShiftType]
        const newAssignment: ShiftAssignment = {
            id: Math.random().toString(36).substr(2, 9),
            employeeId: employee.id,
            employeeName: employee.name,
            employeeImage: employee.image,
            shiftType: selectedShiftType as ShiftAssignment["shiftType"],
            date: selectedDate.toISOString(),
            startTime: customStart || config.defaultStart,
            endTime: customEnd || config.defaultEnd,
            status: "DRAFT"
        }

        const newAssignments = [...assignments, newAssignment]
        onAssignmentsChange?.(newAssignments)
        toast.success(`${employee.name} asignado al turno ${config.label}`)
    }

    const handleDeleteAssignment = (id: string) => {
        const newAssignments = assignments.filter(a => a.id !== id)
        onAssignmentsChange?.(newAssignments)
        toast.success("Turno eliminado")
    }

    const handleUpdateAssignment = (updated: ShiftAssignment) => {
        const newAssignments = assignments.map(a =>
            a.id === updated.id ? updated : a
        )
        onAssignmentsChange?.(newAssignments)
    }

    return (
        <div className="grid gap-6 md:grid-cols-2">
            {/* Employee List */}
            <Card>
                <CardContent className="pt-6">
                    <div className="mb-4">
                        <h3 className="text-lg font-semibold mb-2">Empleados Disponibles</h3>
                        <p className="text-sm text-muted-foreground">
                            Arrastra o asigna empleados a los turnos
                        </p>
                    </div>
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                    >
                        <SortableContext
                            items={employees.map(e => e.id)}
                            strategy={verticalListSortingStrategy}
                        >
                            <div className="space-y-2">
                                {employees.map(employee => (
                                    <SortableEmployee
                                        key={employee.id}
                                        employee={employee}
                                        onAssign={handleAssignEmployee}
                                        onVacation={isEmployeeOnVacation(employee.id)}
                                    />
                                ))}
                            </div>
                        </SortableContext>
                        <DragOverlay>
                            {activeId ? (
                                <div className="opacity-50">
                                    Arrastrando empleado...
                                </div>
                            ) : null}
                        </DragOverlay>
                    </DndContext>
                </CardContent>
            </Card>

            {/* Assignment Configuration */}
            <Card>
                <CardContent className="pt-6">
                    <div className="mb-4">
                        <h3 className="text-lg font-semibold mb-2">Configurar Turno</h3>
                        <p className="text-sm text-muted-foreground">
                            Selecciona el tipo de turno y configura horarios
                        </p>
                    </div>

                    <div className="space-y-4">
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

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Hora de Inicio</Label>
                                <Input
                                    type="time"
                                    value={customStart}
                                    onChange={(e) => setCustomStart(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Hora de Fin</Label>
                                <Input
                                    type="time"
                                    value={customEnd}
                                    onChange={(e) => setCustomEnd(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="pt-4 border-t">
                            <h4 className="text-sm font-medium mb-3">Asignaciones para {formatDate(selectedDate, "EEEE d 'de' MMMM", { locale: es })}</h4>
                            <div className="space-y-2 max-h-100 overflow-y-auto">
                                {assignments.length === 0 ? (
                                    <div className="text-sm text-muted-foreground text-center py-4">
                                        No hay turnos asignados para esta fecha
                                    </div>
                                ) : (
                                    assignments.map(assignment => (
                                        <ShiftAssignmentCard
                                            key={assignment.id}
                                            assignment={assignment}
                                            onUpdate={handleUpdateAssignment}
                                            onDelete={handleDeleteAssignment}
                                        />
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

function format(date: Date, format: string, options?: any) {
    // Simple format helper if date-fns not available
    return date.toLocaleDateString('es-ES', { 
        weekday: 'long', 
        day: 'numeric', 
        month: 'long' 
    })
}
