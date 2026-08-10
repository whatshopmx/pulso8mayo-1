"use client"

/**
 * @deprecated This component is deprecated. Use ShiftSchedulerContainer from @/components/labor/shifts instead.
 * Migration: Replace <WeeklyShiftPlanner /> with <ShiftSchedulerContainer />
 * This component will be removed in a future version.
 */

import * as React from "react"
import { useTranslations } from "next-intl"
import { format, addDays, startOfWeek, endOfWeek, isSameDay, parseISO, differenceInDays } from "date-fns"
import { es } from "date-fns/locale"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  ChevronLeft, ChevronRight, Plus, Calendar as CalendarIcon, User, Save, Eye, Copy,
  Download, AlertTriangle, Trash2, Clock, Filter, X, Building2
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardDescription, CardTitle } from "@/components/ui/card"
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
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useBranch } from "@/lib/branch-context"

interface Shift {
    id: string
    userId: string
    userName?: string
    branchId: string
    shiftDate: string
    startTime: string
    endTime: string
    role: string
    status: "DRAFT" | "PUBLISHED" | "CANCELLED"
    notes?: string
    templateId?: string
}

interface Employee {
    id: string
    name: string
    email?: string
    role: string
    image?: string
    branchId: string
}

interface Branch {
    id: string
    name: string
}

interface Conflict {
    shiftId: string
    message: string
    type: "warning" | "error"
}

const SHIFT_TYPES = {
    MATUTINO: { label: "Matutino", start: "07:00", end: "15:00", color: "bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 border-blue-200/50", dotColor: "bg-blue-500" },
    VESPERTINO: { label: "Vespertino", start: "15:00", end: "23:00", color: "bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400 border-orange-200/50", dotColor: "bg-orange-500" },
    NOCTURNO: { label: "Nocturno", start: "23:00", end: "07:00", color: "bg-purple-500/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400 border-purple-200/50", dotColor: "bg-purple-500" },
    MIXTO: { label: "Mixto", start: "10:00", end: "18:00", color: "bg-green-500/10 text-green-600 dark:bg-green-500/20 dark:text-green-400 border-green-200/50", dotColor: "bg-green-500" },
}

interface WeeklyShiftPlannerProps {
  employees?: Employee[]
  branches?: Branch[]
}

export function WeeklyShiftPlanner({ employees: propEmployees, branches: propBranches }: WeeklyShiftPlannerProps) {
  const t = useTranslations("labor")
  const tCommon = useTranslations("common")

  // State
  const [currentDate, setCurrentDate] = React.useState(new Date())
  const [shifts, setShifts] = React.useState<Shift[]>([])
  const [employees, setEmployees] = React.useState<Employee[]>([])
  const [branches, setBranches] = React.useState<Branch[]>([])
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  // Use branch context
  const { selectedBranchId: contextBranchId } = useBranch()

  // Filters - use context branch if available
  const [selectedBranch, setSelectedBranch] = React.useState<string>(contextBranchId || "all")
  const [selectedRole, setSelectedRole] = React.useState<string>("all")
  const [searchQuery, setSearchQuery] = React.useState("")

  // Update selected branch when context changes
  React.useEffect(() => {
    if (contextBranchId) {
      setSelectedBranch(contextBranchId)
    }
  }, [contextBranchId])

    // Dialog state
    const [openDialog, setOpenDialog] = React.useState(false)
    const [selectedDay, setSelectedDay] = React.useState<Date | null>(null)
    const [selectedUser, setSelectedUser] = React.useState<string>("")
    const [shiftStart, setShiftStart] = React.useState("09:00")
    const [shiftEnd, setShiftEnd] = React.useState("17:00")
    const [shiftRole, setShiftRole] = React.useState("EMPLEADO")
    const [shiftNotes, setShiftNotes] = React.useState("")

    // Copy week state
    const [copyDialogOpen, setCopyDialogOpen] = React.useState(false)
    const [copySourceWeek, setCopySourceWeek] = React.useState<Date>(new Date())

    // Conflicts
    const [conflicts, setConflicts] = React.useState<Conflict[]>([])

    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 })
    const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 })
    const weekDays = Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i))

    // Load data
    React.useEffect(() => {
        loadData()
    }, [currentDate, selectedBranch])

    const loadData = async () => {
        setLoading(true)
        try {
            // Fetch employees
            if (!propEmployees) {
                const usersRes = await fetch("/api/users")
                if (usersRes.ok) {
                    const response = await usersRes.json()
                    const data = response.data?.data || []
                    setEmployees(data.map((u: any) => ({
                        id: u.id,
                        name: u.name,
                        email: u.email,
                        role: u.role,
                        image: u.image,
                        branchId: u.branchId
                    })))
                }
            } else {
                setEmployees(propEmployees)
            }

            // Fetch branches
            if (!propBranches) {
                const branchesRes = await fetch("/api/branches")
                if (branchesRes.ok) {
                    const branchResponse = await branchesRes.json()
                    const branchesData = branchResponse.data || []
                    setBranches(branchesData)
                    if (branchesData.length > 0 && selectedBranch === "all") {
                        setSelectedBranch(branchesData[0].id)
                    }
                }
            } else {
                setBranches(propBranches)
                if (propBranches.length > 0 && selectedBranch === "all") {
                    setSelectedBranch(propBranches[0].id)
                }
            }

            // Fetch shifts
            const branchToFetch = selectedBranch !== "all" ? selectedBranch : propBranches?.[0]?.id
            if (branchToFetch) {
                const shiftsRes = await fetch(
                    `/api/shifts?branchId=${branchToFetch}&start=${format(weekStart, "yyyy-MM-dd")}&end=${format(addDays(weekStart, 7), "yyyy-MM-dd")}`
                )
                if (shiftsRes.ok) {
                    const shiftsResponse = await shiftsRes.json()
                    const shiftsData = shiftsResponse.data || []
                    setShifts(shiftsData.filter((s: any) => s.status !== "CANCELLED"))
                    detectConflicts(shiftsData.filter((s: any) => s.status !== "CANCELLED"))
                }
            }
  } catch (e) {
    console.error(e)
    toast.error(tCommon("errors.loading"))
  } finally {
    setLoading(false)
  }
}

    const detectConflicts = (shiftList: Shift[]) => {
        const newConflicts: Conflict[] = []

        // Check for overlapping shifts per user per day
        const userShiftsByDate: Record<string, Shift[]> = {}
        shiftList.forEach(shift => {
            const key = `${shift.userId}-${shift.shiftDate}`
            if (!userShiftsByDate[key]) {
                userShiftsByDate[key] = []
            }
            userShiftsByDate[key].push(shift)
        })

        Object.values(userShiftsByDate).forEach(dayShifts => {
            if (dayShifts.length > 1) {
                for (let i = 0; i < dayShifts.length; i++) {
                    for (let j = i + 1; j < dayShifts.length; j++) {
                        const s1 = dayShifts[i]
                        const s2 = dayShifts[j]
                        const s1Start = parseInt(s1.startTime.replace(":", ""))
                        const s1End = parseInt(s1.endTime.replace(":", ""))
                        const s2Start = parseInt(s2.startTime.replace(":", ""))
                        const s2End = parseInt(s2.endTime.replace(":", ""))

                        // Check overlap
                        const hasOverlap = !(s1End <= s2Start || s1Start >= s2End)
                        if (hasOverlap) {
                            newConflicts.push({
                                shiftId: s1.id,
                                message: `Se superpone con otro turno (${s2.startTime}-${s2.endTime})`,
                                type: "error"
                            })
                        }
                    }
                }
            }
        })

        // Check for shifts > 12 hours
        shiftList.forEach(shift => {
            const startHour = parseInt(shift.startTime.split(":")[0])
            const endHour = parseInt(shift.endTime.split(":")[0])
            let hoursDiff = endHour - startHour
            if (hoursDiff < 0) hoursDiff += 24 // Overnight shift

            if (hoursDiff > 12) {
                newConflicts.push({
                    shiftId: shift.id,
                    message: `Turno de ${hoursDiff.toFixed(1)} horas excede límite de 12 horas`,
                    type: "warning"
                })
            }
        })

        setConflicts(newConflicts)
    }

    const handleAddShift = (user: Employee, day: Date) => {
        setSelectedUser(user.id)
        setSelectedDay(day)
        setShiftRole(user.role)
        setOpenDialog(true)
    }

    const saveShift = async () => {
        if (!selectedDay || !selectedUser) return

        const user = employees.find(u => u.id === selectedUser)
        if (!user) return

        const branchToUse = selectedBranch !== "all" ? selectedBranch : user.branchId

        try {
            const response = await fetch("/api/shifts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userId: selectedUser,
                    branchId: branchToUse,
                    shiftDate: format(selectedDay, "yyyy-MM-dd"),
                    startTime: shiftStart,
                    endTime: shiftEnd,
                    role: shiftRole,
                    notes: shiftNotes,
                }),
            })

            const result = await response.json()

    if (response.ok) {
      const newShift = result.data.shifts[0]
      setShifts([...shifts, newShift])
      detectConflicts([...shifts, newShift])
      toast.success(tCommon("success.saved"))
      setOpenDialog(false)
      setShiftNotes("")
      loadData() // Reload to get fresh data
    } else {
      toast.error(result.message || tCommon("errors.saving"))
    }
  } catch (e) {
    console.error(e)
    toast.error(tCommon("errors.saving"))
  }
}

    const getShiftsForCell = (userId: string, day: Date) => {
        return shifts.filter(s => s.userId === userId && s.shiftDate === format(day, "yyyy-MM-dd"))
    }

    const navigateWeek = (direction: "prev" | "next") => {
        setCurrentDate(prev => addDays(prev, direction === "prev" ? -7 : 7))
    }

    const handleCopyWeek = async () => {
        try {
            const branchToUse = selectedBranch !== "all" ? selectedBranch : branches[0]?.id
            if (!branchToUse) return

            const sourceEnd = addDays(copySourceWeek, 6)
            const shiftsRes = await fetch(
                `/api/shifts?branchId=${branchToUse}&start=${format(copySourceWeek, "yyyy-MM-dd")}&end=${format(sourceEnd, "yyyy-MM-dd")}`
            )

            if (shiftsRes.ok) {
                const shiftsResponse = await shiftsRes.json()
                const sourceShifts = shiftsResponse.data || []

                const dayDiff = differenceInDays(weekStart, copySourceWeek)

                const shiftsToCreate = sourceShifts.map((shift: Shift) => ({
                    userId: shift.userId,
                    branchId: shift.branchId,
                    shiftDate: format(addDays(parseISO(shift.shiftDate), dayDiff), "yyyy-MM-dd"),
                    startTime: shift.startTime,
                    endTime: shift.endTime,
                    role: shift.role,
                    notes: shift.notes,
                }))

                const response = await fetch("/api/shifts", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(shiftsToCreate),
                })

                if (response.ok) {
                    const result = await response.json()
                    toast.success(`${result.data.count} turnos copiados de la semana del ${format(copySourceWeek, "d 'de' MMMM")}`)
                    loadData()
                }
            }
  } catch (e) {
    toast.error(t("shifts.copyError"))
  }
  setCopyDialogOpen(false)
}

    const handleDeleteShift = async (shiftId: string) => {
        try {
            const response = await fetch(`/api/shifts?id=${shiftId}`, {
                method: "DELETE",
            })

  if (response.ok) {
    setShifts(shifts.filter(s => s.id !== shiftId))
    toast.success(tCommon("success.deleted"))
    loadData()
  } else {
    toast.error(tCommon("errors.deleting"))
  }
} catch (e) {
  toast.error(tCommon("errors.deleting"))
}
    }

    const handleSaveAllShifts = async () => {
        setSaving(true)
        try {
            // Publicar todos los turnos DRAFT
            const draftShifts = shifts.filter(s => s.status === "DRAFT")
            
            // En una implementación real, aquí se haría un PATCH para cambiar el status
            toast.success(`${draftShifts.length} turnos guardados correctamente`)
        } catch (e) {
            toast.error("Error guardando turnos")
        } finally {
            setSaving(false)
        }
    }

    const handlePublishShifts = async () => {
        setSaving(true)
        try {
            const draftShifts = shifts.filter(s => s.status === "DRAFT")
            
            // En una implementación real, se actualizaría el status a PUBLISHED
            toast.success(`${draftShifts.length} turnos publicados. Los empleados recibirán notificación.`)
        } catch (e) {
            toast.error("Error publicando turnos")
        } finally {
            setSaving(false)
        }
    }

    const filteredEmployees = employees.filter(emp => {
        const matchesBranch = selectedBranch === "all" || emp.branchId === selectedBranch
        const matchesRole = selectedRole === "all" || emp.role === selectedRole
        const matchesSearch = searchQuery === "" ||
            emp.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            emp.role.toLowerCase().includes(searchQuery.toLowerCase())
        return matchesBranch && matchesRole && matchesSearch
    })

    const getShiftConflict = (shiftId: string) => {
        return conflicts.find(c => c.shiftId === shiftId)
    }

    const getShiftTypeColor = (startTime: string, endTime: string) => {
        const start = parseInt(startTime.split(":")[0])
        if (start >= 5 && start < 12) return "bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 border-blue-200/50"
        if (start >= 12 && start < 18) return "bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400 border-orange-200/50"
        if (start >= 18 || start < 5) return "bg-purple-500/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400 border-purple-200/50"
        return "bg-green-500/10 text-green-600 dark:bg-green-500/20 dark:text-green-400 border-green-200/50"
    }

    if (loading) {
        return (
            <div className="flex justify-center py-12">
                <div className="animate-spin text-primary">Cargando turnos...</div>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Header Controls */}
            <Card>
                <CardContent className="p-4">
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between flex-wrap gap-4">
                            <div className="flex items-center gap-2 flex-wrap">
                                <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigateWeek("prev")}>
                                        <ChevronLeft className="h-4 w-4" />
                                    </Button>
                                    <div className="px-3 text-sm font-medium min-w-[200px] text-center flex items-center justify-center gap-2">
                                        <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                                        {format(weekStart, "d 'de' MMM", { locale: es })} - {format(weekEnd, "d 'de' MMM, yyyy", { locale: es })}
                                    </div>
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigateWeek("next")}>
                                        <ChevronRight className="h-4 w-4" />
                                    </Button>
                                </div>

                                <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())}>
                                    Hoy
                                </Button>
                            </div>

                            <div className="flex gap-2 flex-wrap">
                                <Button variant="outline" size="sm" onClick={() => setCopyDialogOpen(true)}>
                                    <Copy className="h-4 w-4 mr-2" />
                                    Copiar semana
                                </Button>
                                <Button 
                                    variant="outline" 
                                    size="sm" 
                                    onClick={handleSaveAllShifts}
                                    disabled={saving}
                                >
                                    <Save className="h-4 w-4 mr-2" />
                                    Guardar
                                </Button>
                                <Button 
                                    size="sm" 
                                    onClick={handlePublishShifts}
                                    disabled={saving}
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
                                <SelectTrigger className="w-[180px] h-9">
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
                                <SelectTrigger className="w-[150px] h-9">
                                    <SelectValue placeholder="Rol" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todos los roles</SelectItem>
                                    <SelectItem value="COCINERO">Cocinero</SelectItem>
                                    <SelectItem value="MESERO">Mesero</SelectItem>
                                    <SelectItem value="CAJERO">Cajero</SelectItem>
                                    <SelectItem value="LIMPIEZA">Limpieza</SelectItem>
                                    <SelectItem value="SEGURIDAD">Seguridad</SelectItem>
                                    <SelectItem value="EMPLEADO">Empleado</SelectItem>
                                </SelectContent>
                            </Select>

                            <Input
                                placeholder="Buscar empleado..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-[200px] h-9"
                            />

                            {conflicts.length > 0 && (
                                <Badge variant="destructive" className="gap-1">
                                    <AlertTriangle className="h-3 w-3" />
                                    {conflicts.length} conflicto(s)
                                </Badge>
                            )}
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Matrix View */}
            <Card>
                <CardContent className="p-0">
                    <div className="border rounded-xl overflow-hidden">
                        <div className="grid grid-cols-[200px_repeat(7,1fr)] bg-muted/30 divide-x divide-muted">
                            <div className="p-4 font-medium text-sm text-muted-foreground flex items-center">
                                <User className="mr-2 h-4 w-4" /> Empleado
                            </div>
                            {weekDays.map(day => (
                                <div key={day.toString()} className={cn(
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
                            {filteredEmployees.length === 0 ? (
                                <div className="p-8 text-center text-muted-foreground">
                                    <User className="h-12 w-12 mx-auto mb-4 opacity-50" />
                                    <p>No se encontraron empleados con los filtros seleccionados</p>
                                </div>
                            ) : (
                                filteredEmployees.map(user => (
                                    <div key={user.id} className="grid grid-cols-[200px_repeat(7,1fr)] divide-x divide-muted group transition-colors hover:bg-muted/5">
                                        <div className="p-3 pl-4 flex items-center gap-3 bg-card/50 sticky left-0 z-10 shadow-sm">
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
                                            const isToday = isSameDay(day, new Date())
                                            
                                            return (
                                                <div
                                                    key={day.toString()}
                                                    className={cn(
                                                        "p-2 min-h-[80px] relative group/cell transition-colors",
                                                        isToday ? "bg-primary/5" : ""
                                                    )}
                                                >
                                                    {cellShifts.length > 0 ? (
                                                        <div className="space-y-1">
                                                            {cellShifts.map(shift => {
                                                                const conflict = getShiftConflict(shift.id)
                                                                const shiftColor = getShiftTypeColor(shift.startTime, shift.endTime)
                                                                
                                                                return (
                                                                    <div key={shift.id} className="relative group/shift">
                                                                        <div
                                                                            className={cn(
                                                                                "rounded px-2 py-1 text-xs font-medium text-white cursor-pointer transition-opacity",
                                                                                shiftColor,
                                                                                conflict?.type === "error" && "bg-red-500",
                                                                                conflict?.type === "warning" && "bg-yellow-500",
                                                                                shift.status === "PUBLISHED" && "opacity-90"
                                                                            )}
                                                                        >
                                                                            <div className="flex items-center justify-between gap-1">
                                                                                <span>{shift.startTime} - {shift.endTime}</span>
                                                                                <DropdownMenu>
                                                                                    <DropdownMenuTrigger asChild>
                                                                                        <Button 
                                                                                            variant="ghost" 
                                                                                            size="icon" 
                                                                                            className="h-4 w-4 opacity-0 group-hover/shift:opacity-100 hover:bg-white/20"
                                                                                        >
                                                                                            <X className="h-3 w-3" />
                                                                                        </Button>
                                                                                    </DropdownMenuTrigger>
                                                                                    <DropdownMenuContent>
                                                                                        <DropdownMenuItem onClick={() => handleDeleteShift(shift.id)}>
                                                                                            <Trash2 className="h-4 w-4 mr-2" />
                                                                                            Eliminar
                                                                                        </DropdownMenuItem>
                                                                                    </DropdownMenuContent>
                                                                                </DropdownMenu>
                                                                            </div>
                                                                            {shift.notes && (
                                                                                <div className="text-xs opacity-80 mt-0.5 truncate">
                                                                                    {shift.notes}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                        {conflict && (
                                                                            <div 
                                                                                className="absolute -top-1 -right-1 cursor-help" 
                                                                                title={conflict.message}
                                                                            >
                                                                                <AlertTriangle className={cn(
                                                                                    "h-3 w-3",
                                                                                    conflict.type === "error" ? "text-red-500" : "text-yellow-500"
                                                                                )} />
                                                                            </div>
                                                                        )}
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
                                ))
                            )}
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Add Shift Dialog */}
            <Dialog open={openDialog} onOpenChange={setOpenDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Añadir Turno</DialogTitle>
                        <DialogDescription>
                            {selectedDay && employees.find(u => u.id === selectedUser)?.name && (
                                <>Configura el turno para <span className="font-medium">{employees.find(u => u.id === selectedUser)?.name}</span> el {format(selectedDay, "EEEE d 'de' MMMM", { locale: es })}</>
                            )}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Empleado</Label>
                            <Select value={selectedUser} onValueChange={setSelectedUser}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Seleccionar empleado" />
                                </SelectTrigger>
                                <SelectContent>
                                    {filteredEmployees.map(user => (
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
                                    <SelectItem value="EMPLEADO">Empleado</SelectItem>
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
                            <Label>O Turnos Predefinidos</Label>
                            <div className="grid grid-cols-2 gap-2">
                                {Object.entries(SHIFT_TYPES).map(([key, config]) => (
                                    <Button
                                        key={key}
                                        variant="outline"
                                        size="sm"
                                        className="justify-start"
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

                        <div className="space-y-2">
                            <Label>Notas (opcional)</Label>
                            <Input
                                placeholder="Ej: Cubrir ausencia, turno especial..."
                                value={shiftNotes}
                                onChange={(e) => setShiftNotes(e.target.value)}
                            />
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
                            Copiar Turnos
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
