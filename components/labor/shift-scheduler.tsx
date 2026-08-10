"use client"

import * as React from "react"
import { addDays, format, startOfWeek, isSameDay } from "date-fns"
import { es } from "date-fns/locale"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, Plus, Calendar as CalendarIcon, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"

interface Shift {
    id: string
    userId: string
    branchId: string
    role: string
    startTime: string // ISO
    endTime: string // ISO
    status: "DRAFT" | "PUBLISHED"
}

interface User {
    id: string
    name: string
    image?: string
    role: string
}

export function ShiftScheduler() {
    const [currentDate, setCurrentDate] = React.useState(new Date())
    const [shifts, setShifts] = React.useState<Shift[]>([])
    const [users, setUsers] = React.useState<User[]>([])
    const [loading, setLoading] = React.useState(true)
    const [openDialog, setOpenDialog] = React.useState(false)

    // New Shift State
    const [selectedDay, setSelectedDay] = React.useState<Date | null>(null)
    const [selectedUser, setSelectedUser] = React.useState<string>("")
    const [shiftStart, setShiftStart] = React.useState("09:00")
    const [shiftEnd, setShiftEnd] = React.useState("17:00")
    const [shiftRole, setShiftRole] = React.useState("COCINERO")

    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 })
    const weekDays = Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i))

    React.useEffect(() => {
        loadData()
    }, [currentDate])

    const loadData = async () => {
        setLoading(true)
        try {
            // Fetch users from API
            // Note: In real app, we verify which branch we are viewing.
            // For now, let's list all company users.
            const usersRes = await fetch("/api/users");
            if (usersRes.ok) {
                const response = await usersRes.json();
                // UserService returns { data: [...], meta: {...} }, wrapped in ApiHandler
                const data = response.data?.data || [];
                // Map API user to component User interface
                setUsers(data.map((u: any) => ({
                    id: u.id,
                    name: u.name,
                    image: u.image,
                    role: u.role
                })));
            }

            // Fetch shifts for this week
            // We need a branchId. Let's assume we pick the first one from context or similar.
            // For this UI, we might need a Branch Selector dropdown if not already in URL.
            // Let's hardcode fetching for *all* branches or pass a known ID if possible.
            // Since GET /api/shifts requires branchId, we need one.
            // Let's fetch branches first? Or just allow fetching by company if updated API.
            // Updated API: GET /api/shifts?branchId=...

            // Temporary: Fetch first branch from /api/branches to us its ID
            const branchesRes = await fetch("/api/branches");
            if (branchesRes.ok) {
                const branchResponse = await branchesRes.json();
                const branches = branchResponse.data || [];
                if (branches.length > 0) {
                    const branchId = branches[0].id;
                    const shiftsRes = await fetch(`/api/shifts?branchId=${branchId}&start=${weekStart.toISOString()}&end=${addDays(weekStart, 7).toISOString()}`);
                    if (shiftsRes.ok) {
                        const shiftsResponse = await shiftsRes.json();
                        setShifts(shiftsResponse.data || []);
                    }
                }
            }

        } catch (e) {
            console.error(e)
            toast.error("Error cargando datos")
        } finally {
            setLoading(false)
        }
    }

    const handleAddShift = (user: User, day: Date) => {
        setSelectedUser(user.id)
        setSelectedDay(day)
        setOpenDialog(true)
    }

    const saveShift = async () => {
        if (!selectedDay || !selectedUser) return;

        // Construct ISO dates
        const start = new Date(selectedDay)
        const [sh, sm] = shiftStart.split(":").map(Number)
        start.setHours(sh, sm)

        const end = new Date(selectedDay)
        const [eh, em] = shiftEnd.split(":").map(Number)
        end.setHours(eh, em)

        const newShiftStub = {
            id: Math.random().toString(),
            userId: selectedUser,
            branchId: "current-branch",
            role: shiftRole,
            startTime: start.toISOString(),
            endTime: end.toISOString(),
            status: "DRAFT" as const
        }

        // Optimistic update
        setShifts([...shifts, newShiftStub])
        toast.success("Turno añadido (Draft)")
        setOpenDialog(false)

        // TODO: Call POST /api/shifts
    }

    const getShiftsForCell = (userId: string, day: Date) => {
        return shifts.filter(s => s.userId === userId && isSameDay(new Date(s.startTime), day))
    }

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between bg-card p-4 rounded-lg border shadow-sm">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCurrentDate(d => addDays(d, -7))}>
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <div className="px-3 text-sm font-medium min-w-50 text-center flex items-center justify-center gap-2">
                            <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                            {format(weekStart, "d MMM", { locale: es })} - {format(addDays(weekStart, 6), "d MMM, yyyy", { locale: es })}
                        </div>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCurrentDate(d => addDays(d, 7))}>
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline">Copiar Semana Anterior</Button>
                    <Button>Publicar Cambios</Button>
                </div>
            </div>

            <div className="border rounded-xl overflow-hidden bg-card shadow-sm">
                <div className="grid grid-cols-[200px_repeat(7,1fr)] bg-muted/30 divide-x divide-muted">
                    <div className="p-4 font-medium text-sm text-muted-foreground flex items-center">
                        <User className="mr-2 h-4 w-4" /> Empleado
                    </div>
                    {weekDays.map(day => (
                        <div key={day.toString()} className={cn(
                            "p-3 text-center border-b-2 border-transparent transition-colors",
                            isSameDay(day, new Date()) ? "bg-primary/5 border-primary" : ""
                        )}>
                            <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">{format(day, "EEE", { locale: es })}</div>
                            <div className={cn("text-lg font-bold", isSameDay(day, new Date()) ? "text-primary" : "")}>{format(day, "d")}</div>
                        </div>
                    ))}
                </div>

                <div className="divide-y divide-muted">
                    {users.map(user => (
                        <div key={user.id} className="grid grid-cols-[200px_repeat(7,1fr)] divide-x divide-muted group transition-colors hover:bg-muted/5">
                            <div className="p-3 pl-4 flex items-center gap-3 bg-card/50 sticky left-0 z-10">
                                <Avatar className="h-9 w-9 border">
                                    <AvatarImage src={user.image} />
                                    <AvatarFallback>{user.name?.charAt(0)}</AvatarFallback>
                                </Avatar>
                                <div className="overflow-hidden min-w-0">
                                    <div className="text-sm font-medium truncate leading-none mb-1">{user.name}</div>
                                    <Badge variant="outline" className="text-xs px-1.5 h-5">{user.role}</Badge>
                                </div>
                            </div>

                            {weekDays.map(day => {
                                const cellShifts = getShiftsForCell(user.id, day);
                                return (
                                    <div key={day.toString()} className="min-h-17.5 p-1.5 relative group/cell">
                                        <div className="absolute inset-0 group-hover/cell:bg-muted/20 transition-all pointer-events-none" />

                                        {cellShifts.map(shift => (
                                            <div key={shift.id} className="relative z-10 mb-1 bg-primary/5 border border-primary/20 p-1.5 rounded text-xs hover:bg-primary/10 cursor-pointer transition-colors">
                                                <div className="font-semibold">{format(new Date(shift.startTime), "HH:mm")} - {format(new Date(shift.endTime), "HH:mm")}</div>
                                                <div className="text-muted-foreground truncate opacity-80">{shift.role}</div>
                                            </div>
                                        ))}

                                        <div className={cn(
                                            "absolute inset-0 flex items-center justify-center opacity-0 group-hover/cell:opacity-100 transition-opacity z-0 pointer-events-none",
                                            cellShifts.length > 0 ? "items-end pb-1" : ""
                                        )}>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-6 w-6 rounded-full p-0 bg-background border shadow-sm pointer-events-auto hover:bg-primary hover:text-primary-foreground"
                                                onClick={() => handleAddShift(user, day)}
                                            >
                                                <Plus className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    ))}
                    {users.length === 0 && !loading && (
                        <div className="p-8 text-center text-muted-foreground">
                            No hay empleados registrados en esta sucursal.
                        </div>
                    )}
                </div>
            </div>

            <Dialog open={openDialog} onOpenChange={setOpenDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Asignar Turno</DialogTitle>
                        <DialogDescription>
                            {selectedDay && format(selectedDay, "EEEE d 'de' MMMM", { locale: es })}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Entrada</Label>
                                <Input type="time" value={shiftStart} onChange={e => setShiftStart(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <Label>Salida</Label>
                                <Input type="time" value={shiftEnd} onChange={e => setShiftEnd(e.target.value)} />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Rol (Puesto)</Label>
                            <Select value={shiftRole} onValueChange={setShiftRole}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="GERENTE">Gerente</SelectItem>
                                    <SelectItem value="COCINERO">Cocinero</SelectItem>
                                    <SelectItem value="MESERO">Mesero</SelectItem>
                                    <SelectItem value="CAJERO">Cajero</SelectItem>
                                    <SelectItem value="REPARTIDOR">Repartidor</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpenDialog(false)}>Cancelar</Button>
                        <Button onClick={saveShift}>Guardar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
