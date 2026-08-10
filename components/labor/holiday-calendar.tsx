"use client"

import * as React from "react"
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, parseISO, addMonths, subMonths, isToday } from "date-fns"
import { es } from "date-fns/locale"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    ChevronLeft,
    ChevronRight,
    Calendar as CalendarIcon,
    Plus,
    Trash2,
    Flag,
    Info
} from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"

interface Holiday {
    id: string
    companyId: string
    name: string
    date: string
    description?: string
    createdAt: string
    updatedAt: string
}

interface HolidayCalendarProps {
    initialYear?: number
}

export function HolidayCalendar({ initialYear }: HolidayCalendarProps) {
    const [currentDate, setCurrentDate] = React.useState(new Date())
    const [holidays, setHolidays] = React.useState<Holiday[]>([])
    const [loading, setLoading] = React.useState(true)
    const [openDialog, setOpenDialog] = React.useState(false)
    const [selectedHoliday, setSelectedHoliday] = React.useState<Holiday | null>(null)
    const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
    const [holidayToDelete, setHolidayToDelete] = React.useState<string | null>(null)

    // Form state
    const [holidayName, setHolidayName] = React.useState("")
    const [holidayDate, setHolidayDate] = React.useState("")
    const [holidayDescription, setHolidayDescription] = React.useState("")

    const monthStart = startOfMonth(currentDate)
    const monthEnd = endOfMonth(currentDate)
    const monthDays = eachDayOfInterval({ start: monthStart, end: monthEnd })

    const weekDays = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"]

    React.useEffect(() => {
        loadHolidays()
    }, [currentDate])

    const loadHolidays = async () => {
        setLoading(true)
        try {
            const year = format(currentDate, "yyyy")
            const response = await fetch(`/api/holidays?year=${year}`)
            if (response.ok) {
                const result = await response.json()
                setHolidays(result.data || [])
            }
        } catch (error) {
            console.error("Error loading holidays:", error)
            toast.error("Error cargando días festivos")
        } finally {
            setLoading(false)
        }
    }

    const handleOpenDialog = (holiday?: Holiday) => {
        if (holiday) {
            setSelectedHoliday(holiday)
            setHolidayName(holiday.name)
            setHolidayDate(format(parseISO(holiday.date), "yyyy-MM-dd"))
            setHolidayDescription(holiday.description || "")
        } else {
            setSelectedHoliday(null)
            setHolidayName("")
            setHolidayDate(format(currentDate, "yyyy-MM-dd"))
            setHolidayDescription("")
        }
        setOpenDialog(true)
    }

    const handleSaveHoliday = async () => {
        if (!holidayName.trim()) {
            toast.error("El nombre es requerido")
            return
        }

        if (!holidayDate) {
            toast.error("La fecha es requerida")
            return
        }

        try {
            const response = await fetch("/api/holidays", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: holidayName,
                    date: holidayDate,
                    description: holidayDescription || undefined,
                }),
            })

            if (response.ok) {
                toast.success(selectedHoliday ? "Día festivo actualizado" : "Día festivo creado")
                setOpenDialog(false)
                loadHolidays()
            } else {
                const error = await response.json()
                toast.error(error.message || "Error guardando día festivo")
            }
        } catch (error) {
            console.error("Error saving holiday:", error)
            toast.error("Error guardando día festivo")
        }
    }

    const handleDeleteHoliday = async () => {
        if (!holidayToDelete) return

        try {
            const response = await fetch(`/api/holidays?id=${holidayToDelete}`, {
                method: "DELETE",
            })

            if (response.ok) {
                toast.success("Día festivo eliminado")
                setDeleteDialogOpen(false)
                setHolidayToDelete(null)
                loadHolidays()
            } else {
                toast.error("Error eliminando día festivo")
            }
        } catch (error) {
            console.error("Error deleting holiday:", error)
            toast.error("Error eliminando día festivo")
        }
    }

    const getHolidaysForDay = (day: Date) => {
        return holidays.filter(h => isSameDay(parseISO(h.date), day))
    }

    const navigateMonth = (direction: "prev" | "next") => {
        setCurrentDate(prev => direction === "prev" ? subMonths(prev, 1) : addMonths(prev, 1))
    }

    const totalHolidaysThisMonth = holidays.filter(h => {
        const holidayDate = parseISO(h.date)
        return holidayDate.getMonth() === currentDate.getMonth() &&
            holidayDate.getFullYear() === currentDate.getFullYear()
    }).length

    return (
        <div className="space-y-6">
            {/* Header */}
            <Card>
                <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Button variant="ghost" size="icon" onClick={() => navigateMonth("prev")}>
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <div className="flex items-center gap-2 min-w-[200px] justify-center">
                                <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                                <span className="text-lg font-semibold capitalize">
                                    {format(currentDate, "MMMM yyyy", { locale: es })}
                                </span>
                            </div>
                            <Button variant="ghost" size="icon" onClick={() => navigateMonth("next")}>
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>

                        <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())}>
                                Hoy
                            </Button>
                            <Button size="sm" onClick={() => handleOpenDialog()}>
                                <Plus className="h-4 w-4 mr-2" />
                                Agregar Festivo
                            </Button>
                        </div>
                    </div>

                    <div className="flex items-center gap-4 mt-4 pt-4 border-t text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                            <Flag className="h-4 w-4" />
                            <span>{totalHolidaysThisMonth} día(s) festivo(s) este mes</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Info className="h-4 w-4" />
                            <span>{holidays.length} día(s) festivo(s) en {format(currentDate, "yyyy")}</span>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Calendar Grid */}
            <Card>
                <CardContent className="p-0">
                    <div className="grid grid-cols-7 border rounded-lg overflow-hidden">
                        {/* Week day headers */}
                        {weekDays.map(day => (
                            <div
                                key={day}
                                className="p-3 text-center text-sm font-semibold bg-muted/50 border-b"
                            >
                                {day}
                            </div>
                        ))}

                        {/* Calendar days */}
                        {monthDays.map(day => {
                            const dayHolidays = getHolidaysForDay(day)
                            const isCurrentDay = isToday(day)

                            return (
                                <div
                                    key={day.toString()}
                                    className={cn(
                                        "min-h-[100px] p-2 border-b border-r relative group hover:bg-muted/30 transition-colors",
                                        isCurrentDay && "bg-primary/5",
                                        day.getMonth() !== currentDate.getMonth() && "bg-muted/20 text-muted-foreground"
                                    )}
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <span className={cn(
                                            "text-sm font-medium",
                                            isCurrentDay && "bg-primary text-primary-foreground rounded-full w-7 h-7 flex items-center justify-center"
                                        )}>
                                            {format(day, "d")}
                                        </span>

                                        {dayHolidays.length > 0 && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                                onClick={() => handleOpenDialog(dayHolidays[0])}
                                            >
                                                <Plus className="h-3 w-3" />
                                            </Button>
                                        )}
                                    </div>

                                    <div className="space-y-1">
                                        {dayHolidays.map(holiday => (
                                            <div
                                                key={holiday.id}
                                                className="text-xs p-1.5 rounded bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 cursor-pointer hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                                                onClick={() => handleOpenDialog(holiday)}
                                            >
                                                <div className="font-medium truncate">{holiday.name}</div>
                                                {holiday.description && (
                                                    <div className="text-xs text-muted-foreground truncate">
                                                        {holiday.description}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </CardContent>
            </Card>

            {/* Holiday List */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Flag className="h-5 w-5" />
                        Días Festivos de {format(currentDate, "yyyy")}
                    </CardTitle>
                    <CardDescription>
                        Lista completa de días festivos configurados para este año
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="text-center text-muted-foreground py-8">
                            Cargando días festivos...
                        </div>
                    ) : holidays.length === 0 ? (
                        <div className="text-center text-muted-foreground py-8">
                            <CalendarIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>No hay días festivos registrados para este año</p>
                            <Button
                                variant="outline"
                                size="sm"
                                className="mt-4"
                                onClick={() => handleOpenDialog()}
                            >
                                <Plus className="h-4 w-4 mr-2" />
                                Agregar primer día festivo
                            </Button>
                        </div>
                    ) : (
                        <ScrollArea className="h-[300px]">
                            <div className="space-y-2">
                                {holidays
                                    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                                    .map(holiday => (
                                        <div
                                            key={holiday.id}
                                            className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="h-10 w-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                                                    <Flag className="h-5 w-5 text-red-600 dark:text-red-400" />
                                                </div>
                                                <div>
                                                    <div className="font-medium">{holiday.name}</div>
                                                    <div className="text-sm text-muted-foreground">
                                                        {format(parseISO(holiday.date), "EEEE d 'de' MMMM, yyyy", { locale: es })}
                                                    </div>
                                                    {holiday.description && (
                                                        <div className="text-xs text-muted-foreground mt-1">
                                                            {holiday.description}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Badge variant="outline">
                                                    {format(parseISO(holiday.date), "MMM d", { locale: es })}
                                                </Badge>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => {
                                                        setHolidayToDelete(holiday.id)
                                                        setDeleteDialogOpen(true)
                                                    }}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        </ScrollArea>
                    )}
                </CardContent>
            </Card>

            {/* Add/Edit Holiday Dialog */}
            <Dialog open={openDialog} onOpenChange={setOpenDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {selectedHoliday ? "Editar Día Festivo" : "Agregar Día Festivo"}
                        </DialogTitle>
                        <DialogDescription>
                            {selectedHoliday
                                ? "Modifica la información del día festivo"
                                : "Registra un nuevo día festivo para tu empresa"}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">Nombre del Día Festivo</Label>
                            <Input
                                id="name"
                                placeholder="Ej: Día de la Revolución"
                                value={holidayName}
                                onChange={(e) => setHolidayName(e.target.value)}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="date">Fecha</Label>
                            <Input
                                id="date"
                                type="date"
                                value={holidayDate}
                                onChange={(e) => setHolidayDate(e.target.value)}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="description">Descripción (opcional)</Label>
                            <Textarea
                                id="description"
                                placeholder="Descripción adicional del día festivo"
                                value={holidayDescription}
                                onChange={(e) => setHolidayDescription(e.target.value)}
                                rows={3}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpenDialog(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={handleSaveHoliday}>
                            {selectedHoliday ? "Actualizar" : "Guardar"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Eliminar Día Festivo</DialogTitle>
                        <DialogDescription>
                            ¿Estás seguro de que deseas eliminar este día festivo? Esta acción no se puede deshacer.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
                            Cancelar
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleDeleteHoliday}
                        >
                            Eliminar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
