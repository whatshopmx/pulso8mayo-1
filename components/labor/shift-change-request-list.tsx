"use client"

import * as React from "react"
import { format, parseISO, isAfter, isBefore } from "date-fns"
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
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
    ArrowLeftRight,
    Clock,
    Calendar,
    User,
    CheckCircle,
    XCircle,
    AlertCircle,
    Plus,
    Filter,
    Eye,
    Trash2
} from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface ShiftChangeRequest {
    id: string
    companyId: string
    branchId: string
    requestedBy: string
    requestedShiftId: string
    targetShiftId?: string
    counterpartyId: string
    counterpartyShiftId?: string
    reason: string
    notes?: string
    status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"
    approvedBy?: string
    approvedAt?: string
    rejectedBy?: string
    rejectedAt?: string
    rejectionReason?: string
    counterpartyAccepted?: boolean
    counterpartyResponseAt?: string
    createdAt: string
    updatedAt: string
    requestedShift?: any
    counterpartyShift?: any
    requestedByUser?: any
    counterparty?: any
}

interface Employee {
    id: string
    name: string
    role: string
    image?: string
}

interface Shift {
    id: string
    userId: string
    shiftDate: string
    startTime: string
    endTime: string
    role: string
    status: string
}

interface ShiftChangeRequestListProps {
    employees?: Employee[]
    focusId?: string
}

export function ShiftChangeRequestList({ employees: propEmployees, focusId }: ShiftChangeRequestListProps) {
    const [requests, setRequests] = React.useState<ShiftChangeRequest[]>([])
    const [employees, setEmployees] = React.useState<Employee[]>([])
    const [loading, setLoading] = React.useState(true)
    const [openDialog, setOpenDialog] = React.useState(false)
    const [selectedRequest, setSelectedRequest] = React.useState<ShiftChangeRequest | null>(null)
    const [viewDialogOpen, setViewDialogOpen] = React.useState(false)
    const [respondDialogOpen, setRespondDialogOpen] = React.useState(false)
    const [selectedRequestForResponse, setSelectedRequestForResponse] = React.useState<ShiftChangeRequest | null>(null)
    const focusApplied = React.useRef(false)

    // Filters
    const [statusFilter, setStatusFilter] = React.useState<string>("all")

    // Form state for new request
    const [selectedShift, setSelectedShift] = React.useState<string>("")
    const [selectedCounterparty, setSelectedCounterparty] = React.useState<string>("")
    const [selectedCounterpartyShift, setSelectedCounterpartyShift] = React.useState<string>("")
    const [reason, setReason] = React.useState("")
    const [notes, setNotes] = React.useState("")

    // My shifts for dropdown
    const [myShifts, setMyShifts] = React.useState<Shift[]>([])

    React.useEffect(() => {
        loadData()
    }, [])

    const loadData = async () => {
        setLoading(true)
        try {
            // Load employees
            if (!propEmployees) {
                const usersRes = await fetch("/api/users")
                if (usersRes.ok) {
                    const response = await usersRes.json()
                    const data = response.data?.data || []
                    setEmployees(data.map((u: any) => ({
                        id: u.id,
                        name: u.name,
                        role: u.role,
                        image: u.image
                    })))
                }
            } else {
                setEmployees(propEmployees)
            }

            // Load my shifts
            await loadMyShifts()

            // Load requests
            await loadRequests()
        } catch (error) {
            console.error("Error loading data:", error)
            toast.error("Error cargando datos")
        } finally {
            setLoading(false)
        }
    }

    const loadMyShifts = async () => {
        try {
            const branchesRes = await fetch("/api/branches")
            if (branchesRes.ok) {
                const branchResponse = await branchesRes.json()
                const branches = branchResponse.data || []
                if (branches.length > 0) {
                    const branchId = branches[0].id
                    const shiftsRes = await fetch(`/api/shifts?branchId=${branchId}&start=${format(new Date(), "yyyy-MM-dd")}&end=${format(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), "yyyy-MM-dd")}`)
                    if (shiftsRes.ok) {
                        const shiftsResponse = await shiftsRes.json()
                        const shifts = shiftsResponse.data?.shifts || []
                        // Filter only my published shifts
                        setMyShifts(shifts.filter((s: any) => s.status === "PUBLISHED"))
                    }
                }
            }
        } catch (error) {
            console.error("Error loading shifts:", error)
        }
    }

    const loadRequests = async () => {
        try {
            const response = await fetch("/api/shift-change-requests")
            if (response.ok) {
                const result = await response.json()
                const data = result.data || []
                setRequests(data)
                // Auto-enfocar la solicitud indicada por focusId (deep link)
                if (focusId && !focusApplied.current) {
                    focusApplied.current = true
                    const target = data.find((r: ShiftChangeRequest) => r.id === focusId)
                    if (target) {
                        if (target.status === "PENDING" && !target.counterpartyAccepted) {
                            setSelectedRequestForResponse(target)
                            setRespondDialogOpen(true)
                        } else {
                            setSelectedRequest(target)
                            setViewDialogOpen(true)
                        }
                    }
                }
            }
        } catch (error) {
            console.error("Error loading requests:", error)
        }
    }

    const handleCreateRequest = async () => {
        if (!selectedShift) {
            toast.error("Selecciona un turno")
            return
        }

        if (!selectedCounterparty) {
            toast.error("Selecciona un empleado")
            return
        }

        if (reason.length < 10) {
            toast.error("La razón debe tener al menos 10 caracteres")
            return
        }

        try {
            const response = await fetch("/api/shift-change-requests", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    requestedShiftId: selectedShift,
                    counterpartyId: selectedCounterparty,
                    counterpartyShiftId: (selectedCounterpartyShift && selectedCounterpartyShift !== "none") ? selectedCounterpartyShift : undefined,
                    reason,
                    notes: notes || undefined,
                }),
            })

            if (response.ok) {
                toast.success("Solicitud creada exitosamente")
                setOpenDialog(false)
                resetForm()
                loadRequests()
            } else {
                const error = await response.json()
                toast.error(error.message || "Error creando solicitud")
            }
        } catch (error) {
            console.error("Error creating request:", error)
            toast.error("Error creando solicitud")
        }
    }

    const handleRespondToRequest = async (accepted: boolean, responseNotes?: string) => {
        if (!selectedRequestForResponse) return

        try {
            const response = await fetch("/api/shift-change-requests", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: selectedRequestForResponse.id,
                    action: "respond",
                    accepted,
                    notes: responseNotes,
                }),
            })

            if (response.ok) {
                toast.success(accepted ? "Solicitud aceptada" : "Solicitud rechazada")
                setRespondDialogOpen(false)
                loadRequests()
            } else {
                const error = await response.json()
                toast.error(error.message || "Error respondiendo solicitud")
            }
        } catch (error) {
            console.error("Error responding to request:", error)
            toast.error("Error respondiendo solicitud")
        }
    }

    const handleCancelRequest = async (id: string) => {
        try {
            const response = await fetch(`/api/shift-change-requests?id=${id}`, {
                method: "DELETE",
            })

            if (response.ok) {
                toast.success("Solicitud cancelada")
                loadRequests()
            } else {
                toast.error("Error cancelando solicitud")
            }
        } catch (error) {
            console.error("Error cancelling request:", error)
            toast.error("Error cancelando solicitud")
        }
    }

    const handleManagerDecision = async (approved: boolean, rejectionReason?: string) => {
        if (!selectedRequestForResponse) return

        try {
            const response = await fetch("/api/shift-change-requests", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: selectedRequestForResponse.id,
                    action: "manager_decision",
                    approved,
                    rejectionReason,
                }),
            })

            if (response.ok) {
                toast.success(approved ? "Solicitud aprobada" : "Solicitud rechazada")
                setRespondDialogOpen(false)
                loadRequests()
            } else {
                const error = await response.json()
                toast.error(error.message || "Error procesando solicitud")
            }
        } catch (error) {
            console.error("Error making decision:", error)
            toast.error("Error procesando solicitud")
        }
    }

    const resetForm = () => {
        setSelectedShift("")
        setSelectedCounterparty("")
        setSelectedCounterpartyShift("")
        setReason("")
        setNotes("")
    }

    const getStatusBadge = (status: string) => {
        const badges = {
            PENDING: <Badge variant="secondary">Pendiente</Badge>,
            APPROVED: <Badge variant="default" className="bg-green-600">Aprobado</Badge>,
            REJECTED: <Badge variant="destructive">Rechazado</Badge>,
            CANCELLED: <Badge variant="outline">Cancelado</Badge>,
        }
        return badges[status as keyof typeof badges]
    }

    const getStatusIcon = (status: string) => {
        const icons = {
            PENDING: <Clock className="h-4 w-4" />,
            APPROVED: <CheckCircle className="h-4 w-4 text-green-600" />,
            REJECTED: <XCircle className="h-4 w-4 text-red-600" />,
            CANCELLED: <AlertCircle className="h-4 w-4 text-muted-foreground" />,
        }
        return icons[status as keyof typeof icons]
    }

    const filteredRequests = requests.filter(request => {
        if (statusFilter === "all") return true
        return request.status === statusFilter
    })

    const pendingResponses = requests.filter(r =>
        r.counterpartyId && r.status === "PENDING" && !r.counterpartyAccepted
    )

    const pendingApprovals = requests.filter(r =>
        r.counterpartyAccepted === true && r.status === "PENDING"
    )

    if (loading) {
        return (
            <div className="flex justify-center py-12">
                <div className="animate-spin text-primary">Cargando...</div>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold">Solicitudes de Cambio de Turno</h2>
                    <p className="text-muted-foreground">
                        Gestiona intercambios de turnos entre empleados
                    </p>
                </div>
                <Button onClick={() => setOpenDialog(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Nueva Solicitud
                </Button>
            </div>

            {/* Stats */}
            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-4">
                            <Clock className="h-8 w-8 text-muted-foreground" />
                            <div>
                                <div className="text-2xl font-bold">{pendingResponses.length}</div>
                                <p className="text-sm text-muted-foreground">Esperando respuesta</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-4">
                            <AlertCircle className="h-8 w-8 text-muted-foreground" />
                            <div>
                                <div className="text-2xl font-bold">{pendingApprovals.length}</div>
                                <p className="text-sm text-muted-foreground">Por aprobar</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-4">
                            <ArrowLeftRight className="h-8 w-8 text-muted-foreground" />
                            <div>
                                <div className="text-2xl font-bold">{requests.length}</div>
                                <p className="text-sm text-muted-foreground">Total solicitudes</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Requests List */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <CardTitle>Solicitudes</CardTitle>
                        <div className="flex items-center gap-2">
                            <Filter className="h-4 w-4 text-muted-foreground" />
                            <Select value={statusFilter} onValueChange={setStatusFilter}>
                                <SelectTrigger className="w-45">
                                    <SelectValue placeholder="Filtrar por estado" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todos</SelectItem>
                                    <SelectItem value="PENDING">Pendientes</SelectItem>
                                    <SelectItem value="APPROVED">Aprobados</SelectItem>
                                    <SelectItem value="REJECTED">Rechazados</SelectItem>
                                    <SelectItem value="CANCELLED">Cancelados</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {filteredRequests.length === 0 ? (
                        <div className="text-center text-muted-foreground py-8">
                            <ArrowLeftRight className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>No hay solicitudes de cambio de turno</p>
                        </div>
                    ) : (
                        <ScrollArea className="h-125">
                            <div className="space-y-3">
                                {filteredRequests.map(request => (
                                    <div
                                        key={request.id}
                                        className="p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="flex items-start gap-3 flex-1">
                                                <div className="mt-1">
                                                    {getStatusIcon(request.status)}
                                                </div>
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        {getStatusBadge(request.status)}
                                                        <span className="text-sm text-muted-foreground">
                                                            {format(parseISO(request.createdAt), "d 'de' MMMM, yyyy", { locale: es })}
                                                        </span>
                                                    </div>
                                                    <div className="space-y-1 text-sm">
                                                        <div className="flex items-center gap-2">
                                                            <User className="h-3 w-3 text-muted-foreground" />
                                                            <span>
                                                                <strong>{request.requestedByUser?.name || "Usuario"}</strong> solicita cambio con <strong>{request.counterparty?.name || "Empleado"}</strong>
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <Calendar className="h-3 w-3 text-muted-foreground" />
                                                            <span>
                                                                Turno: {request.requestedShift?.shiftDate} {request.requestedShift?.startTime} - {request.requestedShift?.endTime}
                                                            </span>
                                                        </div>
                                                        <div className="text-muted-foreground italic">
                                                            "{request.reason}"
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => {
                                                        setSelectedRequest(request)
                                                        setViewDialogOpen(true)
                                                    }}
                                                >
                                                    <Eye className="h-3 w-3" />
                                                </Button>
                                                {request.status === "PENDING" && request.counterpartyId && (
                                                    <>
                                                        {!request.counterpartyAccepted && request.counterpartyId === request.counterpartyId && (
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => {
                                                                    setSelectedRequestForResponse(request)
                                                                    setRespondDialogOpen(true)
                                                                }}
                                                            >
                                                                Responder
                                                            </Button>
                                                        )}
                                                        {request.counterpartyAccepted === true && (
                                                            <Button
                                                                variant="default"
                                                                size="sm"
                                                                onClick={() => {
                                                                    setSelectedRequestForResponse(request)
                                                                    setRespondDialogOpen(true)
                                                                }}
                                                            >
                                                                Aprobar
                                                            </Button>
                                                        )}
                                                    </>
                                                )}
                                                {request.status === "PENDING" && request.requestedBy && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleCancelRequest(request.id)}
                                                    >
                                                        <Trash2 className="h-3 w-3" />
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    )}
                </CardContent>
            </Card>

            {/* Create Request Dialog */}
            <Dialog open={openDialog} onOpenChange={setOpenDialog}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Nueva Solicitud de Cambio de Turno</DialogTitle>
                        <DialogDescription>
                            Solicita un intercambio de turno con otro empleado
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Tu Turno (a intercambiar)</Label>
                            <Select value={selectedShift} onValueChange={setSelectedShift}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecciona tu turno" />
                                </SelectTrigger>
                                <SelectContent>
                                    {myShifts.map(shift => (
                                        <SelectItem key={shift.id} value={shift.id}>
                                            {shift.shiftDate} {shift.startTime} - {shift.endTime} ({shift.role})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Empleado (con quien intercambiar)</Label>
                            <Select value={selectedCounterparty} onValueChange={setSelectedCounterparty}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecciona empleado" />
                                </SelectTrigger>
                                <SelectContent>
                                    {employees.map(emp => (
                                        <SelectItem key={emp.id} value={emp.id}>
                                            {emp.name} - {emp.role}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Turno del Empleado (opcional)</Label>
                            <Select value={selectedCounterpartyShift} onValueChange={setSelectedCounterpartyShift}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecciona turno (opcional)" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">Sin turno específico</SelectItem>
                                    {/* Here you would load counterparty shifts */}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Razón *</Label>
                            <Textarea
                                placeholder="Explica por qué necesitas el cambio de turno"
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                rows={3}
                            />
                            <p className="text-xs text-muted-foreground">
                                Mínimo 10 caracteres. Actual: {reason.length}
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label>Notas adicionales (opcional)</Label>
                            <Textarea
                                placeholder="Información adicional"
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                rows={2}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpenDialog(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={handleCreateRequest}>
                            Crear Solicitud
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* View Request Dialog */}
            <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Detalles de la Solicitud</DialogTitle>
                    </DialogHeader>
                    {selectedRequest && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label className="text-sm text-muted-foreground">Solicitante</Label>
                                    <p className="font-medium">{selectedRequest.requestedByUser?.name}</p>
                                </div>
                                <div>
                                    <Label className="text-sm text-muted-foreground">Contraparte</Label>
                                    <p className="font-medium">{selectedRequest.counterparty?.name}</p>
                                </div>
                            </div>
                            <div>
                                <Label className="text-sm text-muted-foreground">Razón</Label>
                                <p>{selectedRequest.reason}</p>
                            </div>
                            {selectedRequest.notes && (
                                <div>
                                    <Label className="text-sm text-muted-foreground">Notas</Label>
                                    <p>{selectedRequest.notes}</p>
                                </div>
                            )}
                            <div>
                                <Label className="text-sm text-muted-foreground">Estado</Label>
                                <div className="mt-1">{getStatusBadge(selectedRequest.status)}</div>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Respond Dialog */}
            <Dialog open={respondDialogOpen} onOpenChange={setRespondDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {selectedRequestForResponse?.counterpartyAccepted === true
                                ? "Aprobar/Rechazar Solicitud"
                                : "Responder a Solicitud"}
                        </DialogTitle>
                        <DialogDescription>
                            {selectedRequestForResponse?.counterpartyAccepted === true
                                ? "Como supervisor, decide sobre esta solicitud"
                                : "Acepta o rechaza la solicitud de cambio"}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="flex gap-2 sm:flex-row sm:justify-between">
                        <Button
                            variant="outline"
                            onClick={() => {
                                handleRespondToRequest(false)
                            }}
                        >
                            <XCircle className="h-4 w-4 mr-2" />
                            Rechazar
                        </Button>
                        <Button
                            onClick={() => {
                                if (selectedRequestForResponse?.counterpartyAccepted === true) {
                                    handleManagerDecision(true)
                                } else {
                                    handleRespondToRequest(true)
                                }
                            }}
                        >
                            <CheckCircle className="h-4 w-4 mr-2" />
                            Aceptar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
