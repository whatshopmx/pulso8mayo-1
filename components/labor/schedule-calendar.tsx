"use client"

import * as React from "react"
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, isToday } from "date-fns"
import { es } from "date-fns/locale"
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

interface Shift {
    id: string
    userId: string
    userName: string
    branchId: string
    shiftType: "MATUTINO" | "VESPERTINO" | "NOCTURNO" | "MIXTO"
    startTime: string
    endTime: string
    status: "DRAFT" | "PUBLISHED"
    date: string
}

interface VacationRequest {
    id: string
    userId: string
    userName: string
    startDate: string
    endDate: string
    status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "COMPLETED"
}

interface ScheduleCalendarProps {
    viewMode: "week" | "month"
    shifts: Shift[]
    vacations?: VacationRequest[]
    onShiftClick?: (shift: Shift) => void
    onDateClick?: (date: Date) => void
    loading?: boolean
}

export function ScheduleCalendar({
    viewMode,
    shifts,
    vacations = [],
    onShiftClick,
    onDateClick,
    loading = false
}: ScheduleCalendarProps) {
    const [currentDate, setCurrentDate] = React.useState(new Date())

    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 })
    const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 })
    const monthStart = startOfWeek(currentDate, { weekStartsOn: 1 })
    const monthEnd = endOfWeek(endOfWeek(currentDate, { weekStartsOn: 1 }), { weekStartsOn: 1 })

    const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd })
    const monthDays = eachDayOfInterval({ start: monthStart, end: monthEnd })

    const navigateWeek = (direction: "prev" | "next") => {
        setCurrentDate(prev => {
            const newDate = new Date(prev)
            if (direction === "prev") {
                newDate.setDate(newDate.getDate() - 7)
            } else {
                newDate.setDate(newDate.getDate() + 7)
            }
            return newDate
        })
    }

    const getShiftsForDate = (date: Date) => {
        return shifts.filter(shift => isSameDay(new Date(shift.date), date))
    }

    const getVacationsForDate = (date: Date) => {
        if (!vacations) return []
        return vacations.filter(vacation => {
            const start = new Date(vacation.startDate)
            const end = new Date(vacation.endDate)
            const isWithinRange = date >= start && date <= end
            return isWithinRange && vacation.status === "APPROVED"
        })
    }

    const isEmployeeOnVacation = (userId: string, date: Date) => {
        if (!vacations) return false
        const vacation = vacations.find(v => 
            v.userId === userId && 
            v.status === "APPROVED" &&
            date >= new Date(v.startDate) && 
            date <= new Date(v.endDate)
        )
        return !!vacation
    }

    const getShiftTypeColor = (type: Shift["shiftType"]) => {
        switch (type) {
            case "MATUTINO":
                return "bg-blue-100 text-blue-800 border-blue-300"
            case "VESPERTINO":
                return "bg-orange-100 text-orange-800 border-orange-300"
            case "NOCTURNO":
                return "bg-purple-100 text-purple-800 border-purple-300"
            case "MIXTO":
                return "bg-green-100 text-green-800 border-green-300"
            default:
                return "bg-gray-100 text-gray-800 border-gray-300"
        }
    }

    const renderWeekHeader = () => (
        <div className="grid grid-cols-8 gap-px bg-muted border rounded-t-lg overflow-hidden">
            <div className="p-3 bg-muted/80 text-sm font-medium text-muted-foreground">
                Empleado
            </div>
            {weekDays.map(day => (
                <div
                    key={day.toString()}
                    className={cn(
                        "p-3 text-center text-sm font-medium",
                        isToday(day) ? "bg-primary text-primary-foreground" : "bg-muted/80"
                    )}
                >
                    <div className="text-xs uppercase">{format(day, "EEE", { locale: es })}</div>
                    <div className="text-lg font-bold">{format(day, "d")}</div>
                </div>
            ))}
        </div>
    )

    const renderMonthHeader = () => (
        <div className="grid grid-cols-7 gap-px bg-muted border rounded-t-lg overflow-hidden">
            {monthDays.slice(0, 7).map(day => (
                <div
                    key={day.toString()}
                    className={cn(
                        "p-3 text-center text-sm font-medium",
                        isToday(day) ? "bg-primary text-primary-foreground" : "bg-muted/80"
                    )}
                >
                    <div className="text-xs uppercase">{format(day, "EEE", { locale: es })}</div>
                    <div className="text-lg font-bold">{format(day, "d")}</div>
                </div>
            ))}
        </div>
    )

    const renderWeekView = () => {
        // Group shifts by user
        const userShifts = shifts.reduce((acc, shift) => {
            if (!acc[shift.userId]) {
                acc[shift.userId] = []
            }
            acc[shift.userId].push(shift)
            return acc
        }, {} as Record<string, Shift[]>)

        return (
            <div className="border-x border-b rounded-b-lg overflow-hidden">
                {Object.entries(userShifts).map(([userId, userShifts]) => {
                    const userName = userShifts[0]?.userName || "Usuario"
                    return (
                        <div key={userId} className="grid grid-cols-8 gap-px border-t">
                            <div className="p-4 bg-card sticky left-0 z-10">
                                <div className="font-medium">{userName}</div>
                                <Badge variant="outline" className="mt-1">
                                    {userShifts.length} turnos
                                </Badge>
                            </div>
                            {weekDays.map(day => {
                                const dayShifts = getShiftsForDate(day)
                                const onVacation = isEmployeeOnVacation(userId, day)
                                const dayVacations = getVacationsForDate(day)
                                
                                return (
                                    <div
                                        key={day.toString()}
                                        className={cn(
                                            "min-h-25 p-2 bg-card/50 hover:bg-muted/30 transition-colors",
                                            isToday(day) && "bg-primary/5",
                                            onVacation && "bg-blue-50"
                                        )}
                                        onClick={() => onDateClick?.(day)}
                                    >
                                        {onVacation ? (
                                            <div className="space-y-1">
                                                <Badge 
                                                    variant="outline" 
                                                    className="w-full bg-blue-100 text-blue-800 border-blue-300 text-xs"
                                                >
                                                    🏖️ Vacaciones
                                                </Badge>
                                                {dayShifts.map(shift => (
                                                    <div
                                                        key={shift.id}
                                                        className={cn(
                                                            "p-2 rounded border text-xs opacity-50",
                                                            getShiftTypeColor(shift.shiftType)
                                                        )}
                                                    >
                                                        <div className="font-semibold">
                                                            {shift.startTime} - {shift.endTime}
                                                        </div>
                                                        <div className="text-xs opacity-80">
                                                            {shift.shiftType}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <>
                                                {dayShifts.map(shift => (
                                                    <div
                                                        key={shift.id}
                                                        className={cn(
                                                            "mb-1 p-2 rounded border text-xs cursor-pointer hover:shadow-md transition-shadow",
                                                            getShiftTypeColor(shift.shiftType)
                                                        )}
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            onShiftClick?.(shift)
                                                        }}
                                                    >
                                                        <div className="font-semibold">
                                                            {shift.startTime} - {shift.endTime}
                                                        </div>
                                                        <div className="text-xs opacity-80">
                                                            {shift.shiftType}
                                                        </div>
                                                        {shift.status === "DRAFT" && (
                                                            <Badge variant="secondary" className="mt-1 text-xs">
                                                                Borrador
                                                            </Badge>
                                                        )}
                                                    </div>
                                                ))}
                                            </>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )
                })}
            </div>
        )
    }

    const renderMonthView = () => {
        const weeks: Date[][] = []
        let currentWeek: Date[] = []

        monthDays.forEach(day => {
            currentWeek.push(day)
            if (currentWeek.length === 7) {
                weeks.push(currentWeek)
                currentWeek = []
            }
        })

        if (currentWeek.length > 0) {
            weeks.push(currentWeek)
        }

        return (
            <div className="border-x border-b rounded-b-lg overflow-hidden">
                {weeks.map((week, weekIndex) => (
                    <div key={weekIndex} className="grid grid-cols-7 gap-px border-t min-h-30">
                        {week.map(day => {
                            const dayShifts = getShiftsForDate(day)
                            const isCurrentMonth = day.getMonth() === currentDate.getMonth()
                            return (
                                <div
                                    key={day.toString()}
                                    className={cn(
                                        "p-2 bg-card/50 hover:bg-muted/30 transition-colors min-h-25",
                                        !isCurrentMonth && "bg-muted/20 text-muted-foreground",
                                        isToday(day) && "bg-primary/5"
                                    )}
                                    onClick={() => onDateClick?.(day)}
                                >
                                    <div className={cn(
                                        "text-sm font-medium mb-1",
                                        isToday(day) && "text-primary"
                                    )}>
                                        {format(day, "d")}
                                    </div>
                                    {dayShifts.slice(0, 3).map(shift => (
                                        <div
                                            key={shift.id}
                                            className={cn(
                                                "mb-1 p-1.5 rounded border text-xs cursor-pointer hover:shadow-sm transition-shadow",
                                                getShiftTypeColor(shift.shiftType)
                                            )}
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                onShiftClick?.(shift)
                                            }}
                                        >
                                            <div className="font-semibold truncate">
                                                {shift.startTime}
                                            </div>
                                            <div className="truncate opacity-80">
                                                {shift.shiftType}
                                            </div>
                                        </div>
                                    ))}
                                    {dayShifts.length > 3 && (
                                        <div className="text-xs text-muted-foreground">
                                            +{dayShifts.length - 3} más
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                ))}
            </div>
        )
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-muted-foreground">Cargando calendario...</div>
            </div>
        )
    }

    return (
        <Card>
            <CardContent className="p-0">
                <div className="p-4 border-b">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() => navigateWeek("prev")}
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() => navigateWeek("next")}
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                onClick={() => setCurrentDate(new Date())}
                            >
                                <CalendarIcon className="h-4 w-4 mr-2" />
                                Hoy
                            </Button>
                        </div>
                        <div className="text-lg font-semibold">
                            {viewMode === "week"
                                ? `${format(weekStart, "d MMM", { locale: es })} - ${format(weekEnd, "d MMM yyyy", { locale: es })}`
                                : format(currentDate, "MMMM yyyy", { locale: es })
                            }
                        </div>
                        <div className="w-32" /> {/* Spacer for alignment */}
                    </div>
                </div>

                {viewMode === "week" ? (
                    <>
                        {renderWeekHeader()}
                        {renderWeekView()}
                    </>
                ) : (
                    <>
                        {renderMonthHeader()}
                        {renderMonthView()}
                    </>
                )}
            </CardContent>
        </Card>
    )
}
