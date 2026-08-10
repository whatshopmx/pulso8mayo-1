"use client"

// Componente principal para el Constructor de Horarios (Unified Shift Scheduler)

import * as React from "react"
import { format, addDays, startOfWeek, endOfWeek, isSameDay, parseISO, differenceInDays } from "date-fns"
import { es } from "date-fns/locale"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { 
    ChevronLeft, ChevronRight, Plus, Calendar as CalendarIcon, User, Save, Eye, Repeat,
    Copy, Download, AlertTriangle, CheckCircle2, Clock, Filter, Trash2,
    FileSpreadsheet, FileText, Tag, MoreHorizontal
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardDescription, CardTitle } from "@/components/ui/card"
import { ScheduleCalendar } from "@/components/labor/schedule-calendar"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Checkbox } from "@/components/ui/checkbox"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { BulkShiftAssignment, type ShiftAssignment } from "@/components/labor/shift-assignment-bulk"
import { LaborComplianceView } from "@/components/labor/labor-compliance-view"

interface Shift {
    id: string
    userId: string
    userName: string
    branchId: string
    branchName: string
    role: string
    startTime: string
    endTime: string
    status: "DRAFT" | "PUBLISHED"
    date: string
    notes?: string
    templateId?: string
    hasBreak?: boolean
    breakDuration?: number // in minutes
    isOvertime?: boolean
}

interface ApiUser {
    id: string
    name: string
    image?: string
    role: string
    branchId: string
}

interface User {
    id: string
    name: string
    image?: string
    role: string
    branchId: string
    branchName?: string
    email?: string
}

interface Branch {
    id: string
    name: string
    address?: string
}

interface ShiftTemplate {
    id: string
    name: string
    shifts: {
        role: string
        startTime: string
        endTime: string
    }[]
}

interface VacationRequest {
    id: string
    userId: string
    userName: string
    startDate: string
    endDate: string
    status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "COMPLETED"
}

interface ApiBranch {
    id: string
    name: string
    address?: string
}

type ViewMode = "matrix" | "calendar" | "list" | "compliance"

// Shift type configurations
const SHIFT_TYPES = {
    MATUTINO: { label: "Matutino", start: "07:00", end: "15:00", color: "bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 border-blue-200/50", dotColor: "bg-blue-500" },
    VESPERTINO: { label: "Vespertino", start: "15:00", end: "23:00", color: "bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400 border-orange-200/50", dotColor: "bg-orange-500" },
    NOCTURNO: { label: "Nocturno", start: "23:00", end: "07:00", color: "bg-purple-500/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400 border-purple-200/50", dotColor: "bg-purple-500" },
    MIXTO: { label: "Mixto", start: "10:00", end: "18:00", color: "bg-green-500/10 text-green-600 dark:bg-green-500/20 dark:text-green-400 border-green-200/50", dotColor: "bg-green-500" },
}

// Predefined templates
const DEFAULT_TEMPLATES: ShiftTemplate[] = [
    {
        id: "restaurante-completo",
        name: "Restaurante Completo",
        shifts: [
            { role: "COCINERO", startTime: "07:00", endTime: "15:00" },
            { role: "COCINERO", startTime: "15:00", endTime: "23:00" },
            { role: "MESERO", startTime: "07:00", endTime: "15:00" },
            { role: "MESERO", startTime: "15:00", endTime: "23:00" },
            { role: "CAJERO", startTime: "10:00", endTime: "18:00" },
            { role: "LIMPIEZA", startTime: "06:00", endTime: "14:00" },
        ]
    },
    {
        id: "turno-manana",
        name: "Turno Mañana",
        shifts: [
            { role: "COCINERO", startTime: "07:00", endTime: "15:00" },
            { role: "MESERO", startTime: "07:00", endTime: "15:00" },
            { role: "CAJERO", startTime: "08:00", endTime: "16:00" },
        ]
    },
    {
        id: "turno-tarde",
        name: "Turno Tarde",
        shifts: [
            { role: "COCINERO", startTime: "15:00", endTime: "23:00" },
            { role: "MESERO", startTime: "15:00", endTime: "23:00" },
            { role: "CAJERO", startTime: "14:00", endTime: "22:00" },
        ]
    },
    {
        id: "fin-semana",
        name: "Fin de Semana",
        shifts: [
            { role: "COCINERO", startTime: "08:00", endTime: "20:00" },
            { role: "MESERO", startTime: "08:00", endTime: "20:00" },
            { role: "CAJERO", startTime: "10:00", endTime: "22:00" },
            { role: "SEGURIDAD", startTime: "18:00", endTime: "02:00" },
        ]
    }
]

export function UnifiedShiftScheduler() {
    // State
    const [currentDate, setCurrentDate] = React.useState(new Date())
    const [shifts, setShifts] = React.useState<Shift[]>([])
    const [users, setUsers] = React.useState<User[]>([])
    const [branches, setBranches] = React.useState<Branch[]>([])
    const [vacations, setVacations] = React.useState<VacationRequest[]>([])
    const [loading, setLoading] = React.useState(true)
    const [viewMode, setViewMode] = React.useState<ViewMode>("matrix")
    const [openDialog, setOpenDialog] = React.useState(false)
    const [bulkMode, setBulkMode] = React.useState(false)
    const [templates, setTemplates] = React.useState<ShiftTemplate[]>([])
    
    // Filters
    const [selectedBranch, setSelectedBranch] = React.useState<string>("all")
    const [selectedRole, setSelectedRole] = React.useState<string>("all")
    const [searchQuery, setSearchQuery] = React.useState("")
    
    // Dialog state
    const [selectedDay, setSelectedDay] = React.useState<Date | null>(null)
    const [selectedUser, setSelectedUser] = React.useState<string>("")
    const [shiftStart, setShiftStart] = React.useState("09:00")
    const [shiftEnd, setShiftEnd] = React.useState("17:00")
    const [shiftRole, setShiftRole] = React.useState("COCINERO")
    const [shiftNotes, setShiftNotes] = React.useState("")
    
    // Copy week state
    const [copyDialogOpen, setCopyDialogOpen] = React.useState(false)
    const [copySourceWeek, setCopySourceWeek] = React.useState<Date>(new Date())
    
    // Export state
    const [exportDialogOpen, setExportDialogOpen] = React.useState(false)
    const [exportFormat, setExportFormat] = React.useState<"pdf" | "excel" | "csv">("excel")
    
    // Template state
    const [templateDialogOpen, setTemplateDialogOpen] = React.useState(false)
    const [selectedTemplate, setSelectedTemplate] = React.useState<string>("")
    
    // Conflicts
    const [conflicts, setConflicts] = React.useState<{shiftId: string, message: string, type: "warning" | "error"}[]>([])

    // Settings
    const [settingsOpen, setSettingsOpen] = React.useState(false)
    const [weeklyHours, setWeeklyHours] = React.useState(40)
    const [workDays, setWorkDays] = React.useState(5)
    const [toleranceMinutes, setToleranceMinutes] = React.useState(15)

    // Track original shifts
    const [originalShifts, setOriginalShifts] = React.useState<Shift[]>([])

    const isDirty = React.useMemo(() => {
        if (shifts.length !== originalShifts.length) return true
        return shifts.some(s => {
            const os = originalShifts.find(o => o.id === s.id)
            if (!os) return true
            return os.role !== s.role || 
                   os.startTime !== s.startTime || 
                   os.endTime !== s.endTime || 
                   os.status !== s.status || 
                   os.notes !== s.notes
        })
    }, [shifts, originalShifts])

    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 })
    const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 })
    const weekDays = Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i))

    // Load data
    React.useEffect(() => {
        loadData()
        loadTemplates()
    }, [currentDate, selectedBranch])

    // Load settings when branch changes
    React.useEffect(() => {
        loadSettings()
    }, [selectedBranch])

    const loadSettings = () => {
        const saved = localStorage.getItem(`shift-settings-${selectedBranch}`)
        if (saved) {
            const settings = JSON.parse(saved)
            setWeeklyHours(settings.weeklyHours || 40)
            setWorkDays(settings.workDays || 5)
            setToleranceMinutes(settings.toleranceMinutes || 15)
        }
    }

    const loadData = async () => {
        setLoading(true)
        try {
            // Fetch users
            const usersRes = await fetch("/api/users")
            if (usersRes.ok) {
                const response = await usersRes.json() as { data?: { data?: ApiUser[] } }
                const data = response.data?.data || []
                setUsers(data.map((u: ApiUser) => ({
                    id: u.id,
                    name: u.name,
                    image: u.image,
                    role: u.role,
                    branchId: u.branchId
                })))
            }

            // Fetch branches
            const branchesRes = await fetch("/api/branches")
            if (branchesRes.ok) {
                const branchResponse = await branchesRes.json() as { data?: ApiBranch[] }
                const branchesData = branchResponse.data || []
                setBranches(branchesData)
                if (branchesData.length > 0 && selectedBranch === "all") {
                    setSelectedBranch(branchesData[0].id)
                }
            }

            // Fetch shifts
            if (selectedBranch !== "all") {
                const shiftsRes = await fetch(
                    `/api/shifts?branchId=${selectedBranch}&start=${weekStart.toISOString()}&end=${addDays(weekStart, 7).toISOString()}`
                )
                if (shiftsRes.ok) {
                    const shiftsResponse = await shiftsRes.json() as { data?: Shift[] }
                    const shiftsData = shiftsResponse.data || []
                    setShifts(shiftsData)
                    setOriginalShifts(shiftsData)
                    detectConflicts(shiftsData)
                }
            }

            // Fetch vacations
            const vacationsRes = await fetch(
                `/api/vacations?branchId=${selectedBranch !== "all" ? selectedBranch : ""}&status=APPROVED&startDate=${weekStart.toISOString()}&endDate=${addDays(weekStart, 14).toISOString()}`
            )
            if (vacationsRes.ok) {
                const vacationsResponse = await vacationsRes.json() as { data?: VacationRequest[] }
                setVacations(vacationsResponse.data || [])
            }
        } catch (e) {
            console.error(e)
            toast.error("Error cargando datos")
        } finally {
            setLoading(false)
        }
    }

    const loadTemplates = () => {
        // Load from localStorage or use defaults
        const saved = localStorage.getItem("shift-templates")
        if (saved) {
            setTemplates(JSON.parse(saved))
        } else {
            setTemplates(DEFAULT_TEMPLATES)
        }
    }

    const detectConflicts = (shiftList: Shift[]) => {
        const newConflicts: {shiftId: string, message: string, type: "warning" | "error"}[] = []
        
        // Check for overlapping shifts and calculate hours
        const userShiftesByDate: Record<string, Shift[]> = {}
        const userWeeklyHours: Record<string, number> = {}

        shiftList.forEach(shift => {
            const key = `${shift.userId}-${format(parseISO(shift.startTime), "yyyy-MM-dd")}`
            if (!userShiftesByDate[key]) {
                userShiftesByDate[key] = []
            }
            userShiftesByDate[key].push(shift)

            // Weekly hours calc
            const start = parseISO(shift.startTime)
            const end = parseISO(shift.endTime)
            let hoursDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60)
            
            // Fallback in case of bad data that wasn't fixed
            if (hoursDiff < 0) {
                hoursDiff += 24
            }
            
            if (!userWeeklyHours[shift.userId]) userWeeklyHours[shift.userId] = 0
            userWeeklyHours[shift.userId] += hoursDiff

            // Break Tracking: Shifts over 8 hours should ideally have a 30 min break
            if (hoursDiff >= 8 && (!shift.hasBreak || shift.breakDuration === 0)) {
                 newConflicts.push({
                    shiftId: shift.id,
                    message: `Turno de ${hoursDiff.toFixed(1)} hrs requiere descanso programado.`,
                    type: "warning"
                })
            }
            
            // LFT: Limits 12 hours max
            if (hoursDiff > 12) {
                newConflicts.push({
                    shiftId: shift.id,
                    message: `Turno de ${hoursDiff.toFixed(1)} horas excede límite de 12 horas.`,
                    type: "warning"
                })
            }
        })

        // Evaluate overlapping shifts
        Object.values(userShiftesByDate).forEach(dayShifts => {
            if (dayShifts.length > 1) {
                for (let i = 0; i < dayShifts.length; i++) {
                    for (let j = i + 1; j < dayShifts.length; j++) {
                        const s1 = dayShifts[i]
                        const s2 = dayShifts[j]
                        const s1End = parseISO(s1.endTime)
                        const s2Start = parseISO(s2.startTime)
                        
                        if (s2Start < s1End) {
                            newConflicts.push({
                                shiftId: s1.id,
                                message: `Turno se superpone con otro turno (${format(s2Start, "HH:mm")})`,
                                type: "error"
                            })
                        }
                    }
                }
            }
        })

        // Check overtime (e.g. > 48 hours per week based on settings)
        Object.entries(userWeeklyHours).forEach(([userId, hours]) => {
            if (hours > 48) {
                // Find all shifts for this user to tag them or just push a general warning to their last shift
                const userShifts = shiftList.filter(s => s.userId === userId)
                if (userShifts.length > 0) {
                    const lastShift = userShifts[userShifts.length - 1]
                    newConflicts.push({
                        shiftId: lastShift.id,
                        message: `Empleado excede límite semanal de horas (48hrs). Total: ${hours.toFixed(1)}hrs`,
                        type: "warning"
                    })
                }
            }
        })

        setConflicts(newConflicts)
    }

    const handleAddShift = (user: User, day: Date) => {
        setSelectedUser(user.id)
        setSelectedDay(day)
        setOpenDialog(true)
    }

    const saveShift = async () => {
        if (!selectedDay || !selectedUser) return

        const user = users.find(u => u.id === selectedUser)
        if (!user) return

        // Construct ISO dates
        const start = new Date(selectedDay)
        const [sh, sm] = shiftStart.split(":").map(Number)
        start.setHours(sh, sm, 0, 0)

        const end = new Date(selectedDay)
        const [eh, em] = shiftEnd.split(":").map(Number)
        end.setHours(eh, em, 0, 0)
        
        if (end < start) {
            end.setDate(end.getDate() + 1)
        }

        const newShift: Shift = {
            id: Math.random().toString(36).substr(2, 9),
            userId: selectedUser,
            userName: user.name,
            branchId: user.branchId,
            branchName: user.branchName || "Default",
            role: shiftRole,
            startTime: start.toISOString(),
            endTime: end.toISOString(),
            status: "DRAFT",
            date: start.toISOString(),
            notes: shiftNotes,
            hasBreak: true,
            breakDuration: 30
        }

        setShifts([...shifts, newShift])
        detectConflicts([...shifts, newShift])
        toast.success("Turno añadido")
        setOpenDialog(false)
        
        // Reset form
        setShiftNotes("")
    }

    const getShiftsForCell = (userId: string, day: Date) => {
        return shifts.filter(s => s.userId === userId && isSameDay(new Date(s.startTime), day))
    }

    const navigateWeek = (direction: "prev" | "next") => {
        setCurrentDate(prev => addDays(prev, direction === "prev" ? -7 : 7))
    }

    const handleBulkAssignmentsChange = (newAssignments: ShiftAssignment[]) => {
        const convertedShifts = newAssignments.map(a => {
            const [sh, sm] = a.startTime.split(":").map(Number)
            const [eh, em] = a.endTime.split(":").map(Number)
            const baseDate = new Date(a.date)
            
            const startDate = new Date(baseDate)
            startDate.setHours(sh, sm, 0, 0)
            
            const endDate = new Date(baseDate)
            endDate.setHours(eh, em, 0, 0)
            
            if (endDate < startDate) {
                endDate.setDate(endDate.getDate() + 1)
            }
            
            return {
                id: a.id,
                userId: a.employeeId,
                userName: a.employeeName,
                branchId: a.branchId || selectedBranch !== "all" ? selectedBranch : "default",
                branchName: a.branchName || "Default",
                role: a.role || "EMPLEADO",
                startTime: startDate.toISOString(),
                endTime: endDate.toISOString(),
                status: a.status as "DRAFT" | "PUBLISHED",
                date: a.date,
                hasBreak: true,
                breakDuration: 30
            }
        })
        setShifts(convertedShifts)
    }

    const handleCopyWeek = async () => {
        try {
            // Fetch shifts from source week
            const sourceEnd = addDays(copySourceWeek, 7)
            const shiftsRes = await fetch(
                `/api/shifts?branchId=${selectedBranch}&start=${copySourceWeek.toISOString()}&end=${sourceEnd.toISOString()}`
            )
            
            if (shiftsRes.ok) {
                const shiftsResponse = await shiftsRes.json()
                const sourceShifts = shiftsResponse.data || []
                
                // Calculate day difference
                const dayDiff = differenceInDays(weekStart, copySourceWeek)
                
                // Create new shifts with adjusted dates
                const newShifts = sourceShifts.map((shift: Shift) => ({
                    ...shift,
                    id: Math.random().toString(36).substr(2, 9),
                    startTime: addDays(parseISO(shift.startTime), dayDiff).toISOString(),
                    endTime: addDays(parseISO(shift.endTime), dayDiff).toISOString(),
                    status: "DRAFT" as const,
                    hasBreak: true,
                    breakDuration: 30
                }))
                
                setShifts([...shifts, ...newShifts])
                toast.success(`${newShifts.length} turnos copiados de la semana del ${format(copySourceWeek, "d 'de' MMMM")}`)
            }
        } catch (e) {
            toast.error("Error copiando turnos")
        }
        setCopyDialogOpen(false)
    }

    const handleApplyTemplate = () => {
        const template = templates.find(t => t.id === selectedTemplate)
        if (!template || !selectedDay) return

        const newShifts: Shift[] = []
        template.shifts.forEach((shiftConfig, index) => {
            const user = users.find(u => u.role === shiftConfig.role)
            if (user) {
                const start = new Date(selectedDay)
                const [sh, sm] = shiftConfig.startTime.split(":").map(Number)
                start.setHours(sh, sm, 0, 0)

                const end = new Date(selectedDay)
                const [eh, em] = shiftConfig.endTime.split(":").map(Number)
                end.setHours(eh, em, 0, 0)
                
                if (end < start) {
                    end.setDate(end.getDate() + 1)
                }

                newShifts.push({
                    id: Math.random().toString(36).substr(2, 9),
                    userId: user.id,
                    userName: user.name,
                    branchId: user.branchId,
                    branchName: user.branchName || "Default",
                    role: shiftConfig.role,
                    startTime: start.toISOString(),
                    endTime: end.toISOString(),
                    status: "DRAFT",
                    date: selectedDay.toISOString(),
                    hasBreak: true,
                    breakDuration: 30
                })
            }
        })

        setShifts([...shifts, ...newShifts])
        toast.success(`Plantilla "${template.name}" aplicada con ${newShifts.length} turnos`)
        setTemplateDialogOpen(false)
    }

    const handleExport = async () => {
        try {
            if (exportFormat === "excel" || exportFormat === "csv") {
                // Create CSV content
                const headers = ["Empleado", "Rol", "Fecha", "Inicio", "Fin", "Estado", "Notas"]
                const rows = shifts.map(s => [
                    s.userName,
                    s.role,
                    format(parseISO(s.startTime), "dd/MM/yyyy"),
                    format(parseISO(s.startTime), "HH:mm"),
                    format(parseISO(s.endTime), "HH:mm"),
                    s.status,
                    s.notes || ""
                ])
                
                const csvContent = [headers, ...rows].map(row => row.join(",")).join("\n")
                const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
                const link = document.createElement("a")
                link.href = URL.createObjectURL(blob)
                link.download = `horarios-${format(weekStart, "yyyy-MM-dd")}.csv`
                link.click()
                
                toast.success("Horario exportado correctamente")
            } else if (exportFormat === "pdf") {
                // For PDF, we'll use browser print
                window.print()
                toast.success("Generando PDF...")
            }
        } catch (e) {
            toast.error("Error exportando")
        }
        setExportDialogOpen(false)
    }

    const handleDeleteShift = (shiftId: string) => {
        setShifts(shifts.filter(s => s.id !== shiftId))
        toast.success("Turno eliminado")
    }

    const handleSave = async () => {
        if (selectedBranch === "all") {
            toast.error("Selecciona una sucursal específica para guardar los horarios")
            return
        }

        try {
            // Separate new and existing shifts
            const newShifts = shifts.filter(s => !originalShifts.find(os => os.id === s.id))
            const existingShifts = shifts.filter(s => originalShifts.find(os => os.id === s.id))

            // Convert to API format
            const formatShiftForAPI = (shift: Shift) => ({
                userId: shift.userId,
                branchId: shift.branchId,
                shiftDate: format(parseISO(shift.startTime), "yyyy-MM-dd"),
                startTime: format(parseISO(shift.startTime), "HH:mm"),
                endTime: format(parseISO(shift.endTime), "HH:mm"),
                role: shift.role,
                notes: shift.notes,
                templateId: shift.templateId,
            })

            // Create new shifts
            if (newShifts.length > 0) {
                const createData = newShifts.map(formatShiftForAPI)
                const createRes = await fetch("/api/shifts", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(createData.length === 1 ? createData[0] : createData)
                })
                if (!createRes.ok) {
                    const error = await createRes.json()
                    throw new Error(error.message || "Error creando turnos")
                }
            }

            // Update existing shifts
            if (existingShifts.length > 0) {
                const updateData = existingShifts.map(s => ({
                    id: s.id,
                    role: s.role,
                    notes: s.notes,
                    startTime: format(parseISO(s.startTime), "HH:mm"),
                    endTime: format(parseISO(s.endTime), "HH:mm"),
                }))
                const updateRes = await fetch("/api/shifts", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ shifts: updateData })
                })
                if (!updateRes.ok) {
                    const error = await updateRes.json()
                    throw new Error(error.message || "Error actualizando turnos")
                }
            }

        // Refresh data
        await loadData()
        toast.success("Horarios guardados correctamente")
    } catch (error) {
        console.error("Save error:", error)
        toast.error(error instanceof Error ? error.message : "Error guardando horarios")
    }
    }

    const handlePublish = async () => {
        if (selectedBranch === "all") {
            toast.error("Selecciona una sucursal específica para publicar los horarios")
            return
        }

        try {
            const draftShifts = shifts.filter(s => s.status === "DRAFT")
            if (draftShifts.length === 0) {
                toast.info("No hay turnos en borrador para publicar")
                return
            }

            const updateData = draftShifts.map(s => ({
                id: s.id,
                status: "PUBLISHED" as const
            }))

            const res = await fetch("/api/shifts", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ shifts: updateData })
            })

            if (!res.ok) {
                const error = await res.json()
                throw new Error(error.message || "Error publicando turnos")
            }

            // Refresh data
            await loadData()
            toast.success(`${draftShifts.length} turnos publicados`)
        } catch (error) {
            console.error("Publish error:", error)
            toast.error(error instanceof Error ? error.message : "Error publicando horarios")
        }
    }

    const handleSaveSettings = () => {
        const settings = {
            weeklyHours,
            workDays,
            toleranceMinutes
        }
        localStorage.setItem(`shift-settings-${selectedBranch}`, JSON.stringify(settings))
        toast.success("Configuración guardada")
        setSettingsOpen(false)
    }

    const filteredUsers = users.filter(user => {
        const matchesBranch = selectedBranch === "all" || user.branchId === selectedBranch
        const matchesRole = selectedRole === "all" || user.role === selectedRole
        const matchesSearch = searchQuery === "" || 
            user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            user.role.toLowerCase().includes(searchQuery.toLowerCase())
        return matchesBranch && matchesRole && matchesSearch
    })

    const getShiftTypeColor = (startTime: string, endTime: string) => {
        const start = parseInt(startTime.split(":")[0])
        const end = parseInt(endTime.split(":")[0])
        
        if (start >= 5 && start < 12) return "bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 border-blue-200/50"
        if (start >= 12 && start < 18) return "bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400 border-orange-200/50"
        if (start >= 18 || start < 5) return "bg-purple-500/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400 border-purple-200/50"
        return "bg-green-500/10 text-green-600 dark:bg-green-500/20 dark:text-green-400 border-green-200/50"
    }

    const getShiftConflict = (shiftId: string) => {
        return conflicts.find(c => c.shiftId === shiftId)
    }

    if (loading) {
        return (
            <div className="flex justify-center py-12">
                <div className="animate-spin text-primary">Cargando...</div>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Header Controls */}
            <div className="flex flex-col gap-4 bg-card p-4 rounded-lg border shadow-sm">
                <div className="flex items-center justify-between flex-wrap gap-4">
                    {/* Left: Week Navigation & View Segmented Switcher */}
                    <div className="flex items-center gap-4 flex-wrap">
                        {/* Week Navigation */}
                        <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigateWeek("prev")}>
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <div className="px-3 text-sm font-medium min-w-50 text-center flex items-center justify-center gap-2">
                                <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                                {format(weekStart, "d 'de' MMM", { locale: es })} - {format(weekEnd, "d 'de' MMM, yyyy", { locale: es })}
                            </div>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigateWeek("next")}>
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>

                        {/* View Segmented Control */}
                        <div className="flex items-center gap-1 bg-muted rounded-md p-0.5 border">
                            <Button
                                variant={viewMode === "matrix" ? "secondary" : "ghost"}
                                size="sm"
                                className={cn(
                                    "h-7 px-3 text-xs rounded-sm transition-all",
                                    viewMode === "matrix" ? "bg-background shadow-xs text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                                )}
                                onClick={() => setViewMode("matrix")}
                            >
                                Matriz
                            </Button>
                            <Button
                                variant={viewMode === "calendar" ? "secondary" : "ghost"}
                                size="sm"
                                className={cn(
                                    "h-7 px-3 text-xs rounded-sm transition-all",
                                    viewMode === "calendar" ? "bg-background shadow-xs text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                                )}
                                onClick={() => setViewMode("calendar")}
                            >
                                Calendario
                            </Button>
                            <Button
                                variant={viewMode === "list" ? "secondary" : "ghost"}
                                size="sm"
                                className={cn(
                                    "h-7 px-3 text-xs rounded-sm transition-all",
                                    viewMode === "list" ? "bg-background shadow-xs text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                                )}
                                onClick={() => setViewMode("list")}
                            >
                                Lista
                            </Button>
                            <Button
                                variant={viewMode === "compliance" ? "secondary" : "ghost"}
                                size="sm"
                                className={cn(
                                    "h-7 px-3 text-xs rounded-sm transition-all",
                                    viewMode === "compliance" ? "bg-background shadow-xs text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                                )}
                                onClick={() => setViewMode("compliance")}
                            >
                                Cumplimiento
                            </Button>
                        </div>
                    </div>

                    {/* Right: Actions (Primary Action Pair & Utilities Dropdown) */}
                    <div className="flex items-center gap-2 flex-wrap">
                        {/* Utilities Dropdown Menu */}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" className="h-8">
                                    <MoreHorizontal className="h-4 w-4 mr-2" />
                                    Acciones
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuLabel>Operaciones</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => setTemplateDialogOpen(true)}>
                                    <Tag className="h-4 w-4 mr-2" />
                                    Plantilla
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setCopyDialogOpen(true)}>
                                    <Copy className="h-4 w-4 mr-2" />
                                    Copiar Semana
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setExportDialogOpen(true)}>
                                    <Download className="h-4 w-4 mr-2" />
                                    Exportar
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                                    <Tag className="h-4 w-4 mr-2" />
                                    Configuración
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setBulkMode(!bulkMode)}>
                                    <Repeat className="h-4 w-4 mr-2" />
                                    {bulkMode ? "Modo Normal" : "Asignación Masiva"}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>

                        {/* Save Button */}
                        <Button
                            variant={isDirty ? "default" : "outline"}
                            size="sm"
                            className="h-8"
                            onClick={handleSave}
                            disabled={selectedBranch === "all"}
                        >
                            <Save className="h-4 w-4 mr-2" />
                            Guardar
                        </Button>

                        {/* Publish Button */}
                        <Button
                            variant="destructive"
                            size="sm"
                            className="h-8"
                            onClick={handlePublish}
                            disabled={selectedBranch === "all"}
                        >
                            <Eye className="h-4 w-4 mr-2" />
                            Publicar
                        </Button>
                    </div>
                </div>

                {/* Filters */}
                <div className="flex items-center gap-4 flex-wrap pt-2 border-t">
                    <div className="flex items-center gap-2">
                        <Filter className="h-4 w-4 text-muted-foreground" />
                        <Label className="text-sm">Filtros:</Label>
                    </div>
                    
                    <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                        <SelectTrigger className="w-45 h-8">
                            <SelectValue placeholder="Sucursal" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todas las sucursales</SelectItem>
                            {branches.map(branch => (
                                <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Select value={selectedRole} onValueChange={setSelectedRole}>
                        <SelectTrigger className="w-37.5 h-8">
                            <SelectValue placeholder="Rol" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todos los roles</SelectItem>
                            <SelectItem value="COCINERO">Cocinero</SelectItem>
                            <SelectItem value="MESERO">Mesero</SelectItem>
                            <SelectItem value="CAJERO">Cajero</SelectItem>
                            <SelectItem value="LIMPIEZA">Limpieza</SelectItem>
                            <SelectItem value="SEGURIDAD">Seguridad</SelectItem>
                        </SelectContent>
                    </Select>

                    <Input
                        placeholder="Buscar empleado..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-50 h-8"
                    />

                    {conflicts.length > 0 && (
                        <Badge variant="destructive" className="gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            {conflicts.length} conflicto(s)
                        </Badge>
                    )}
                </div>
            </div>

            {/* Bulk Assignment Mode */}
            {bulkMode && (
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-semibold">Asignación Masiva de Turnos</h3>
                                <p className="text-sm text-muted-foreground">
                                    Asigna turnos a múltiples empleados con patrones de repetición
                                </p>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => setBulkMode(false)}>
                                ✕
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <BulkShiftAssignment
                            employees={filteredUsers.map(u => ({
                                id: u.id,
                                name: u.name,
                                email: u.email || `${u.name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
                                role: u.role,
                                image: u.image,
                                branchId: u.branchId
                            }))}
                            selectedDate={currentDate}
                            assignments={[]}
                            vacations={vacations}
                            onAssignmentsChange={handleBulkAssignmentsChange}
                        />
                    </CardContent>
                </Card>
            )}

            {/* Matrix View */}
            {!bulkMode && viewMode === "matrix" && (
                <Card>
                    <CardContent className="p-0">
                        <div className="border rounded-xl overflow-hidden" role="grid" aria-label="Matriz de Horarios Semanal">
                            <div className="grid grid-cols-[200px_repeat(7,1fr)] bg-muted/30 divide-x divide-muted" role="row">
                                <div className="p-4 font-medium text-sm text-muted-foreground flex items-center" role="columnheader">
                                    <User className="mr-2 h-4 w-4" /> Empleado
                                </div>
                                {weekDays.map(day => (
                                    <div key={day.toString()} role="columnheader" aria-label={format(day, "EEEE d 'de' MMMM", { locale: es })} className={cn(
                                        "p-3 text-center border-b-2 border-transparent transition-colors",
                                        isSameDay(day, new Date()) ? "bg-primary/5 border-primary" : ""
                                    )}>
                                        <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                                            {format(day, "EEE", { locale: es })}
                                        </div>
                                        <div className={cn(
                                            "text-lg font-bold",
                                            isSameDay(day, new Date()) ? "text-primary" : ""
                                        )}>
                                            {format(day, "d")}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="divide-y divide-muted">
                                {filteredUsers.map(user => (
                                    <div key={user.id} className="grid grid-cols-[200px_repeat(7,1fr)] divide-x divide-muted group transition-colors hover:bg-muted/5" role="row">
                                        <div className="p-3 pl-4 flex items-center gap-3 bg-card/50 sticky left-0 z-10" role="rowheader">
                                            <Avatar className="h-9 w-9 border">
                                                <AvatarImage src={user.image} />
                                                <AvatarFallback>{user.name?.charAt(0)}</AvatarFallback>
                                            </Avatar>
                                            <div className="min-w-0">
                                                <div className="font-medium text-sm truncate">{user.name}</div>
                                                <div className="text-xs text-muted-foreground">{user.role}</div>
                                            </div>
                                        </div>
                                        {weekDays.map(day => {
                                            const cellShifts = getShiftsForCell(user.id, day)
                                            return (
                                                <div
                                                    key={day.toString()}
                                                    role="gridcell"
                                                    aria-label={`Turnos de ${user.name} el ${format(day, "EEEE d 'de' MMMM", { locale: es })}`}
                                                    className={cn(
                                                        "p-2 min-h-20 relative group/cell transition-colors",
                                                        isSameDay(day, new Date()) ? "bg-primary/5" : ""
                                                    )}
                                                >
                                                    {cellShifts.length > 0 ? (
                                                        <div className="space-y-1">
                                                            {cellShifts.map(shift => {
                                                                const conflict = getShiftConflict(shift.id)
                                                                return (
                                                                    <div key={shift.id} className="relative">
                                                                        <Badge
                                                                            variant={shift.status === "PUBLISHED" ? "default" : "secondary"}
                                                                            className={cn(
                                                                                "text-xs w-full justify-start cursor-pointer hover:opacity-80 pr-6",
                                                                                conflict?.type === "error" && "bg-red-500 hover:bg-red-600",
                                                                                conflict?.type === "warning" && "bg-yellow-500 hover:bg-yellow-600"
                                                                            )}
                                                                        >
                                                                            {format(parseISO(shift.startTime), "HH:mm")} - {format(parseISO(shift.endTime), "HH:mm")}
                                                                        </Badge>
                                                                        {conflict && (
                                                                            <div className="absolute -top-1 -right-1" title={conflict.message}>
                                                                                <AlertTriangle className="h-3 w-3 text-red-500" />
                                                                            </div>
                                                                        )}
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            className="absolute top-0 right-0 h-6 w-6 opacity-0 group-hover/cell:opacity-100 focus:opacity-100 flex items-center justify-center p-1 rounded-full text-destructive hover:bg-destructive/10 transition-opacity"
                                                                            onClick={() => handleDeleteShift(shift.id)}
                                                                            aria-label="Eliminar turno"
                                                                        >
                                                                            <Trash2 className="h-3.5 w-3.5" />
                                                                        </Button>
                                                                    </div>
                                                                )
                                                            })}
                                                        </div>
                                                    ) : (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="opacity-0 group-hover/cell:opacity-100 transition-opacity w-full h-auto p-2 text-xs"
                                                            onClick={() => handleAddShift(user, day)}
                                                        >
                                                            <Plus className="h-3 w-3 mr-1" />
                                                            Añadir
                                                        </Button>
                                                    )}
                                                </div>
                                            )
                                        })}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Calendar View */}
            {!bulkMode && viewMode === "calendar" && (
                <ScheduleCalendar
                    viewMode="week"
                    shifts={shifts.map(s => ({
                        id: s.id,
                        userId: s.userId,
                        userName: s.userName,
                        branchId: s.branchId,
                        shiftType: "MIXTO", // Can be inferred if needed
                        startTime: format(parseISO(s.startTime), "HH:mm"),
                        endTime: format(parseISO(s.endTime), "HH:mm"),
                        status: s.status,
                        date: s.startTime
                    }))}
                    vacations={vacations}
                />
            )}

            {/* List View */}
            {!bulkMode && viewMode === "list" && (
                <Card>
                    <CardHeader>
                        <CardTitle>Lista de Turnos</CardTitle>
                        <CardDescription>
                            {shifts.length} turnos programados del {format(weekStart, "d 'de' MMMM")} al {format(weekEnd, "d 'de' MMMM, yyyy")}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ScrollArea className="h-125">
                            <div className="space-y-2">
                                {shifts.length === 0 ? (
                                    <div className="text-center py-12 text-muted-foreground">
                                        <CalendarIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
                                        <p>No hay turnos programados para esta semana</p>
                                    </div>
                                ) : (
                                    shifts
                                        .sort((a, b) => parseISO(a.startTime).getTime() - parseISO(b.startTime).getTime())
                                        .map(shift => {
                                            const conflict = getShiftConflict(shift.id)
                                            return (
                                                <div
                                                    key={shift.id}
                                                    className={cn(
                                                        "flex items-center justify-between p-3 rounded-lg border",
                                                        conflict?.type === "error" && "border-red-500 bg-red-50",
                                                        conflict?.type === "warning" && "border-yellow-500 bg-yellow-50"
                                                    )}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <Avatar className="h-10 w-10">
                                                            <AvatarFallback>{shift.userName.charAt(0)}</AvatarFallback>
                                                        </Avatar>
                                                        <div>
                                                            <div className="font-medium">{shift.userName}</div>
                                                            <div className="text-sm text-muted-foreground flex items-center gap-2">
                                                                <Badge variant="outline" className="text-xs">
                                                                    {shift.role}
                                                                </Badge>
                                                                <span className="flex items-center gap-1">
                                                                    <CalendarIcon className="h-3 w-3" />
                                                                    {format(parseISO(shift.startTime), "EEE d 'de' MMMM", { locale: es })}
                                                                </span>
                                                                <span className="flex items-center gap-1">
                                                                    <Clock className="h-3 w-3" />
                                                                    {format(parseISO(shift.startTime), "HH:mm")} - {format(parseISO(shift.endTime), "HH:mm")}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <Badge variant={shift.status === "PUBLISHED" ? "default" : "secondary"}>
                                                            {shift.status === "PUBLISHED" ? "Publicado" : "Borrador"}
                                                        </Badge>
                                                        {conflict && (
                                                            <Badge variant="destructive" className="text-xs gap-1">
                                                                <AlertTriangle className="h-3 w-3" />
                                                                {conflict.type === "error" ? "Conflicto" : "Advertencia"}
                                                            </Badge>
                                                        )}
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => handleDeleteShift(shift.id)}
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            )
                                        })
                                )}
                            </div>
                        </ScrollArea>
                    </CardContent>
                </Card>
            )}

            {/* Compliance View */}
            {!bulkMode && viewMode === "compliance" && (
                selectedBranch === "all" ? (
                    <Card>
                        <CardContent className="py-12 text-center">
                            <AlertTriangle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                            <p className="text-muted-foreground">Selecciona una sucursal específica para ver el reporte de cumplimiento</p>
                        </CardContent>
                    </Card>
                ) : (
                    <LaborComplianceView 
                        branchId={selectedBranch}
                        currentDate={currentDate}
                    />
                )
            )}

            {/* Add Shift Dialog */}
            <Dialog open={openDialog} onOpenChange={setOpenDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Añadir Turno</DialogTitle>
                        <DialogDescription>
                            Configura el turno para {users.find(u => u.id === selectedUser)?.name}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Fecha</Label>
                            <div className="text-sm font-medium">
                                {selectedDay ? format(selectedDay, "EEEE d 'de' MMMM", { locale: es }) : ""}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Empleado</Label>
                            <Select value={selectedUser} onValueChange={setSelectedUser}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Seleccionar empleado" />
                                </SelectTrigger>
                                <SelectContent>
                                    {filteredUsers.map(user => (
                                        <SelectItem key={user.id} value={user.id}>{user.name} - {user.role}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Rol del Turno</Label>
                            <Select value={shiftRole} onValueChange={setShiftRole}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="COCINERO">Cocinero</SelectItem>
                                    <SelectItem value="MESERO">Mesero</SelectItem>
                                    <SelectItem value="CAJERO">Cajero</SelectItem>
                                    <SelectItem value="LIMPIEZA">Limpieza</SelectItem>
                                    <SelectItem value="SEGURIDAD">Seguridad</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Hora de Inicio</Label>
                                <Input
                                    type="time"
                                    value={shiftStart}
                                    onChange={(e) => setShiftStart(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Hora de Fin</Label>
                                <Input
                                    type="time"
                                    value={shiftEnd}
                                    onChange={(e) => setShiftEnd(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Notas (opcional)</Label>
                            <Input
                                placeholder="Ej: Cubrir ausencia, turno especial..."
                                value={shiftNotes}
                                onChange={(e) => setShiftNotes(e.target.value)}
                            />
                        </div>

                        {/* Quick shift type buttons */}
                        <div className="space-y-2">
                            <Label>O Turnos Predefinidos</Label>
                            <div className="grid grid-cols-2 gap-2">
                                {Object.entries(SHIFT_TYPES).map(([key, config]) => (
                                    <Button
                                        key={key}
                                        variant="outline"
                                        size="sm"
                                        className={cn("justify-start", config.color)}
                                        onClick={() => {
                                            setShiftStart(config.start)
                                            setShiftEnd(config.end)
                                        }}
                                    >
                                        <div className={cn("w-2 h-2 rounded-full mr-2", config.dotColor)} />
                                        {config.label}
                                    </Button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpenDialog(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={saveShift}>
                            Guardar Turno
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Copy Week Dialog */}
            <Dialog open={copyDialogOpen} onOpenChange={setCopyDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Copiar Turnos de Otra Semana</DialogTitle>
                        <DialogDescription>
                            Selecciona la semana de origen para copiar los turnos
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Semana de Origen</Label>
                            <Input
                                type="week"
                                value={format(copySourceWeek, "yyyy-MM-dd")}
                                onChange={(e) => {
                                    const date = new Date(e.target.value)
                                    if (!isNaN(date.getTime())) {
                                        setCopySourceWeek(startOfWeek(date, { weekStartsOn: 1 }))
                                    }
                                }}
                            />
                        </div>

                        <div className="p-3 bg-muted rounded-lg">
                            <p className="text-sm font-medium">Destino:</p>
                            <p className="text-sm text-muted-foreground">
                                {format(weekStart, "d 'de' MMMM")} - {format(weekEnd, "d 'de' MMMM, yyyy")}
                            </p>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCopyDialogOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={handleCopyWeek}>
                            <Copy className="h-4 w-4 mr-2" />
                            Copiar Turnos
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Template Dialog */}
            <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Aplicar Plantilla de Turnos</DialogTitle>
                        <DialogDescription>
                            Selecciona una plantilla predefinida para aplicar rápidamente
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Fecha de Aplicación</Label>
                            <Input
                                type="date"
                                value={format(selectedDay || new Date(), "yyyy-MM-dd")}
                                onChange={(e) => setSelectedDay(new Date(e.target.value))}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Plantilla</Label>
                            <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Seleccionar plantilla" />
                                </SelectTrigger>
                                <SelectContent>
                                    {templates.map(template => (
                                        <SelectItem key={template.id} value={template.id}>
                                            {template.name} ({template.shifts.length} turnos)
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {selectedTemplate && (
                            <div className="space-y-2">
                                <Label className="text-sm">Turnos Incluidos:</Label>
                                <ScrollArea className="h-50">
                                    <div className="space-y-2">
                                        {templates.find(t => t.id === selectedTemplate)?.shifts.map((shift, i) => (
                                            <div key={i} className="flex items-center justify-between text-sm p-2 bg-muted rounded">
                                                <span className="font-medium">{shift.role}</span>
                                                <span className="text-muted-foreground">
                                                    {shift.startTime} - {shift.endTime}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </ScrollArea>
                            </div>
                        )}
                    </div>

                    <DialogFooter className="flex items-center justify-between">
                        <Button 
                            variant="outline" 
                            onClick={() => {
                                const newTemplate = {
                                    id: `template-${Date.now()}`,
                                    name: `Plantilla Semana ${format(weekStart, "dd/MM")}`,
                                    shifts: shifts.map(s => ({
                                        role: s.role,
                                        startTime: format(parseISO(s.startTime), "HH:mm"),
                                        endTime: format(parseISO(s.endTime), "HH:mm")
                                    }))
                                }
                                const updatedTemplates = [...templates, newTemplate]
                                setTemplates(updatedTemplates)
                                localStorage.setItem("shift-templates", JSON.stringify(updatedTemplates))
                                toast.success("Semana actual guardada como plantilla")
                                setSelectedTemplate(newTemplate.id)
                            }}
                        >
                            <Save className="h-4 w-4 mr-2" />
                            Guardar actual
                        </Button>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => setTemplateDialogOpen(false)}>
                                Cancelar
                            </Button>
                            <Button onClick={handleApplyTemplate} disabled={!selectedTemplate}>
                                <Tag className="h-4 w-4 mr-2" />
                                Aplicar
                            </Button>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Export Dialog */}
            <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Exportar Horarios</DialogTitle>
                        <DialogDescription>
                            Selecciona el formato de exportación
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="grid grid-cols-3 gap-4">
                            <Button
                                variant={exportFormat === "excel" ? "default" : "outline"}
                                className="h-24 flex flex-col gap-2"
                                onClick={() => setExportFormat("excel")}
                            >
                                <FileSpreadsheet className="h-8 w-8" />
                                <span>Excel (.xlsx)</span>
                            </Button>
                            <Button
                                variant={exportFormat === "csv" ? "default" : "outline"}
                                className="h-24 flex flex-col gap-2"
                                onClick={() => setExportFormat("csv")}
                            >
                                <FileText className="h-8 w-8" />
                                <span>CSV</span>
                            </Button>
                            <Button
                                variant={exportFormat === "pdf" ? "default" : "outline"}
                                className="h-24 flex flex-col gap-2"
                                onClick={() => setExportFormat("pdf")}
                            >
                                <FileText className="h-8 w-8" />
                                <span>PDF</span>
                            </Button>
                        </div>

                        <div className="p-3 bg-muted rounded-lg">
                            <p className="text-sm font-medium">Resumen:</p>
                            <p className="text-sm text-muted-foreground">
                                {shifts.length} turnos del {format(weekStart, "d 'de' MMMM")} al {format(weekEnd, "d 'de' MMMM")}
                            </p>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setExportDialogOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={handleExport}>
                            <Download className="h-4 w-4 mr-2" />
                            Exportar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Settings Dialog */}
            <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Configuración de Horarios</DialogTitle>
                        <DialogDescription>
                            Configura los parámetros estándar para la planificación de turnos
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Horas semanales estándar</Label>
                            <Input
                                type="number"
                                value={weeklyHours}
                                onChange={(e) => setWeeklyHours(Number(e.target.value))}
                                min="1"
                                max="168"
                            />
                            <p className="text-sm text-muted-foreground">
                                Horas laborales por semana según la legislación (ej. 40 horas)
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label>Días laborables por semana</Label>
                            <Input
                                type="number"
                                value={workDays}
                                onChange={(e) => setWorkDays(Number(e.target.value))}
                                min="1"
                                max="7"
                            />
                            <p className="text-sm text-muted-foreground">
                                Número de días trabajados por semana (ej. 5 días de lunes a viernes)
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label>Tolerancia para llegada tardía (minutos)</Label>
                            <Input
                                type="number"
                                value={toleranceMinutes}
                                onChange={(e) => setToleranceMinutes(Number(e.target.value))}
                                min="0"
                                max="60"
                            />
                            <p className="text-sm text-muted-foreground">
                                Minutos de tolerancia antes de marcar como llegada tardía
                            </p>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setSettingsOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={handleSaveSettings}>
                            Guardar Configuración
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
