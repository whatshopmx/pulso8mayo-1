"use client"

import * as React from "react"
import { format, parseISO, isWithinInterval, isSameDay } from "date-fns"
import { es } from "date-fns/locale"
import { Calendar, Clock, User, Plus, CheckCircle, XCircle, AlertCircle, Trash2, Filter } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

export interface VacationRequest {
    id: string
    userId: string
    userName: string
    userEmail: string
    companyId: string
    branchId?: string
    branchName?: string
    startDate: string
    endDate: string
    totalDays: number
    status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "COMPLETED"
    reason?: string
    managerComments?: string
    rejectionReason?: string
    requestedAt: string
    approvedAt?: string
    approvedBy?: string
}

interface VacationManagerProps {
    companyId: string
    branchId?: string
    userId?: string
    canApprove?: boolean
}

export function VacationManager({
    companyId,
    branchId,
    userId,
    canApprove = false
}: VacationManagerProps) {
    const [vacations, setVacations] = React.useState<VacationRequest[]>([])
    const [loading, setLoading] = React.useState(true)
    const [dialogOpen, setDialogOpen] = React.useState(false)
    const [selectedVacation, setSelectedVacation] = React.useState<VacationRequest | null>(null)
    const [statusFilter, setStatusFilter] = React.useState<string>("all")
    const [approveDialogOpen, setApproveDialogOpen] = React.useState(false)
    const [vacationToApprove, setVacationToApprove] = React.useState<VacationRequest | null>(null)
    const [managerComments, setManagerComments] = React.useState("")
    const [rejectionReason, setRejectionReason] = React.useState("")
    const [isProcessing, setIsProcessing] = React.useState(false)
    const [loadError, setLoadError] = React.useState<string | null>(null)
    const [actionError, setActionError] = React.useState<string | null>(null)

    // Form state
    const [startDate, setStartDate] = React.useState("")
    const [endDate, setEndDate] = React.useState("")
    const [reason, setReason] = React.useState("")
    const [selectedUserId, setSelectedUserId] = React.useState<string>("")

    // Fetch vacations
    const fetchVacations = async () => {
        setLoading(true)
        setLoadError(null)
        try {
            const params = new URLSearchParams()
            params.set("companyId", companyId)
            if (branchId) params.set("branchId", branchId)
            if (userId && !canApprove) params.set("userId", userId)
            if (statusFilter !== "all") params.set("status", statusFilter)

            const response = await fetch(`/api/vacations?${params.toString()}`)
            const result = await response.json()
            if (!response.ok) throw new Error(result.error || "Error cargando vacaciones")
            setVacations(result.data || [])
        } catch (error) {
            setVacations([])
            setLoadError(error instanceof Error ? error.message : "Error cargando vacaciones")
        } finally {
            setLoading(false)
        }
    }

    React.useEffect(() => {
        fetchVacations()
    }, [statusFilter, branchId, companyId, userId, canApprove])

    const handleOpenDialog = (vacation?: VacationRequest) => {
        setActionError(null)
        if (vacation) {
            setSelectedVacation(vacation)
        } else {
            setSelectedVacation(null)
            setStartDate("")
            setEndDate("")
            setReason("")
            setSelectedUserId(userId || "")
        }
        setDialogOpen(true)
    }

    const handleRequestVacation = async () => {
        if (!startDate || !endDate || !selectedUserId) {
            setActionError("Completa todos los campos requeridos")
            return
        }

        setIsProcessing(true)
        setActionError(null)
        try {
            const response = await fetch("/api/vacations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userId: selectedUserId,
                    companyId,
                    branchId,
                    startDate,
                    endDate,
                    reason
                })
            })

            const result = await response.json()

            if (response.ok) {
                toast.success("Solicitud de vacaciones creada exitosamente")
                setDialogOpen(false)
                fetchVacations()
            } else {
                setActionError(result.error || "Error creando la solicitud")
            }
        } catch (error) {
            console.error("Error requesting vacation:", error)
            setActionError("Error creando la solicitud")
        } finally {
            setIsProcessing(false)
        }
    }

    const handleApprove = async (action: "APPROVED" | "REJECTED") => {
        if (!vacationToApprove) return

        setIsProcessing(true)
        setActionError(null)
        try {
            const response = await fetch("/api/vacations/approve", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: vacationToApprove.id,
                    action,
                    managerComments: action === "APPROVED" ? managerComments : undefined,
                    rejectionReason: action === "REJECTED" ? rejectionReason : undefined
                })
            })

            const result = await response.json()

            if (response.ok) {
                toast.success(`Solicitud ${action === "APPROVED" ? "aprobada" : "rechazada"} exitosamente`)
                setApproveDialogOpen(false)
                setVacationToApprove(null)
                setManagerComments("")
                setRejectionReason("")
                fetchVacations()
            } else {
                setActionError(result.error || "Error procesando la solicitud")
            }
        } catch (error) {
            console.error("Error processing vacation:", error)
            setActionError("Error procesando la solicitud")
        } finally {
            setIsProcessing(false)
        }
    }

    const handleCancelVacation = async (id: string) => {
        if (!confirm("¿Estás seguro de cancelar esta solicitud de vacaciones?")) return

        setIsProcessing(true)
        setActionError(null)
        try {
            const response = await fetch(`/api/vacations?id=${id}`, {
                method: "DELETE"
            })

            const result = await response.json()

            if (response.ok) {
                toast.success("Solicitud cancelada exitosamente")
                fetchVacations()
            } else {
                setActionError(result.error || "Error cancelando la solicitud")
            }
        } catch (error) {
            console.error("Error cancelling vacation:", error)
            setActionError("Error cancelando la solicitud")
        } finally {
            setIsProcessing(false)
        }
    }

    const getStatusColor = (status: VacationRequest["status"]) => {
        switch (status) {
            case "PENDING": return "bg-yellow-100 text-yellow-800 border-yellow-300"
            case "APPROVED": return "bg-green-100 text-green-800 border-green-300"
            case "REJECTED": return "bg-red-100 text-red-800 border-red-300"
            case "CANCELLED": return "bg-gray-100 text-gray-800 border-gray-300"
            case "COMPLETED": return "bg-blue-100 text-blue-800 border-blue-300"
            default: return "bg-gray-100 text-gray-800 border-gray-300"
        }
    }

    const getStatusLabel = (status: VacationRequest["status"]) => {
        const labels = {
            PENDING: "Pendiente",
            APPROVED: "Aprobada",
            REJECTED: "Rechazada",
            CANCELLED: "Cancelada",
            COMPLETED: "Completada"
        }
        return labels[status]
    }

    const getVacationsForDay = (date: Date) => {
        return vacations.filter(v => {
            const start = parseISO(v.startDate)
            const end = parseISO(v.endDate)
            return isWithinInterval(date, { start, end }) && v.status === "APPROVED"
        })
    }

    const pendingCount = vacations.filter(v => v.status === "PENDING").length

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Vacaciones</h2>
                    <p className="text-muted-foreground">
                        Gestiona las solicitudes de vacaciones de tu equipo
                    </p>
                </div>
                <Button onClick={() => handleOpenDialog()}>
                    <Plus className="h-4 w-4 mr-2" />
                    Solicitar Vacaciones
                </Button>
            </div>

            {loadError && (
                <div role="alert" className="space-y-2 text-destructive">
                    <p>{loadError}</p>
                    <Button variant="outline" onClick={fetchVacations} disabled={loading}>Reintentar</Button>
                </div>
            )}
            {actionError && !dialogOpen && !approveDialogOpen && <p role="alert" className="text-destructive">{actionError}</p>}

            {/* Stats */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Vacaciones</CardTitle>
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{vacations.length}</div>
                        <p className="text-xs text-muted-foreground">
                            {vacations.filter(v => v.status === "APPROVED").length} aprobadas
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Pendientes</CardTitle>
                        <AlertCircle className="h-4 w-4 text-yellow-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-yellow-600">{pendingCount}</div>
                        <p className="text-xs text-muted-foreground">
                            Requieren aprobación
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Aprobadas</CardTitle>
                        <CheckCircle className="h-4 w-4 text-green-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">
                            {vacations.filter(v => v.status === "APPROVED").length}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Vacaciones activas
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Días Totales</CardTitle>
                        <Clock className="h-4 w-4 text-blue-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {vacations.reduce((sum, v) => sum + v.totalDays, 0)}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Días solicitados
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Filter */}
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-muted-foreground" />
                    <Label>Estado:</Label>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="w-[180px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todos</SelectItem>
                            <SelectItem value="PENDING">Pendientes</SelectItem>
                            <SelectItem value="APPROVED">Aprobadas</SelectItem>
                            <SelectItem value="REJECTED">Rechazadas</SelectItem>
                            <SelectItem value="CANCELLED">Canceladas</SelectItem>
                            <SelectItem value="COMPLETED">Completadas</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Table */}
            <Card>
                <CardHeader>
                    <CardTitle>Solicitudes de Vacaciones</CardTitle>
                    <CardDescription>
                        Lista completa de solicitudes de vacaciones
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="text-center py-8 text-muted-foreground">
                            Cargando vacaciones...
                        </div>
                    ) : vacations.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            No hay solicitudes de vacaciones
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Empleado</TableHead>
                                    <TableHead>Período</TableHead>
                                    <TableHead className="text-center">Días</TableHead>
                                    <TableHead>Estado</TableHead>
                                    <TableHead>Solicitado</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {vacations.map((vacation) => (
                                    <TableRow key={vacation.id}>
                                        <TableCell>
                                            <div>
                                                <div className="font-medium">{vacation.userName}</div>
                                                {vacation.branchName && (
                                                    <div className="text-xs text-muted-foreground">
                                                        {vacation.branchName}
                                                    </div>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="text-sm">
                                                <div>{format(parseISO(vacation.startDate), "d MMM yyyy", { locale: es })}</div>
                                                <div className="text-muted-foreground">
                                                    al {format(parseISO(vacation.endDate), "d MMM yyyy", { locale: es })}
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <Badge variant="outline">{vacation.totalDays}</Badge>
                                        </TableCell>
                                        <TableCell>
                                            <Badge className={cn("border", getStatusColor(vacation.status))}>
                                                {getStatusLabel(vacation.status)}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {format(parseISO(vacation.requestedAt), "d MMM yyyy", { locale: es })}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-2">
                                                {canApprove && vacation.status === "PENDING" && (
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => {
                                                            setActionError(null)
                                                            setVacationToApprove(vacation)
                                                            setApproveDialogOpen(true)
                                                        }}
                                                    >
                                                        <CheckCircle className="h-3 w-3 mr-1" />
                                                        Aprobar
                                                    </Button>
                                                )}
                                                {["PENDING", "APPROVED"].includes(vacation.status) && (canApprove || vacation.userId === userId) && (
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        aria-label="Cancelar solicitud"
                                                        onClick={() => handleCancelVacation(vacation.id)}
                                                    >
                                                        <Trash2 className="h-3 w-3" />
                                                    </Button>
                                                )}
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => handleOpenDialog(vacation)}
                                                >
                                                    Ver
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* Request/Edit Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {selectedVacation ? "Detalle de Vacaciones" : "Solicitar Vacaciones"}
                        </DialogTitle>
                        <DialogDescription>
                            {selectedVacation
                                ? "Información detallada de la solicitud"
                                : "Completa el formulario para solicitar vacaciones"}
                        </DialogDescription>
                    </DialogHeader>

                    {selectedVacation ? (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>Empleado</Label>
                                    <div className="font-medium">{selectedVacation.userName}</div>
                                </div>
                                <div>
                                    <Label>Estado</Label>
                                    <Badge className={cn("border", getStatusColor(selectedVacation.status))}>
                                        {getStatusLabel(selectedVacation.status)}
                                    </Badge>
                                </div>
                            </div>
                            <Separator />
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>Fecha de Inicio</Label>
                                    <div className="font-medium">
                                        {format(parseISO(selectedVacation.startDate), "d MMMM yyyy", { locale: es })}
                                    </div>
                                </div>
                                <div>
                                    <Label>Fecha de Fin</Label>
                                    <div className="font-medium">
                                        {format(parseISO(selectedVacation.endDate), "d MMMM yyyy", { locale: es })}
                                    </div>
                                </div>
                            </div>
                            <div>
                                <Label>Total Días</Label>
                                <div className="font-medium">{selectedVacation.totalDays} días</div>
                            </div>
                            {selectedVacation.reason && (
                                <div>
                                    <Label>Motivo</Label>
                                    <p className="text-sm text-muted-foreground">{selectedVacation.reason}</p>
                                </div>
                            )}
                            {selectedVacation.managerComments && (
                                <div>
                                    <Label>Comentarios del Manager</Label>
                                    <p className="text-sm text-muted-foreground">{selectedVacation.managerComments}</p>
                                </div>
                            )}
                            {selectedVacation.rejectionReason && (
                                <div>
                                    <Label>Motivo de Rechazo</Label>
                                    <p className="text-sm text-red-600">{selectedVacation.rejectionReason}</p>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {!userId && (
                                <div className="space-y-2">
                                    <Label htmlFor="employee">Empleado</Label>
                                    <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Seleccionar empleado" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {/* This should be populated from API */}
                                            <SelectItem value={userId || "self"}>Yo mismo</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="start-date">Fecha de Inicio *</Label>
                                    <Input
                                        id="start-date"
                                        type="date"
                                        value={startDate}
                                        onChange={(e) => setStartDate(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="end-date">Fecha de Fin *</Label>
                                    <Input
                                        id="end-date"
                                        type="date"
                                        value={endDate}
                                        onChange={(e) => setEndDate(e.target.value)}
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="reason">Motivo (Opcional)</Label>
                                <Textarea
                                    id="reason"
                                    placeholder="Motivo de las vacaciones..."
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    rows={3}
                                />
                            </div>
                        </div>
                    )}

                    {actionError && <p role="alert" className="text-destructive">{actionError}</p>}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>
                            Cerrar
                        </Button>
                        {!selectedVacation && (
                            <Button onClick={handleRequestVacation} disabled={isProcessing}>
                                {isProcessing ? "Procesando..." : "Solicitar"}
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Approve/Reject Dialog */}
            <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Aprobar/Rechazar Vacaciones</DialogTitle>
                        <DialogDescription>
                            Revisa y decide sobre la solicitud de vacaciones
                        </DialogDescription>
                    </DialogHeader>

                    {vacationToApprove && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>Empleado</Label>
                                    <div className="font-medium">{vacationToApprove.userName}</div>
                                </div>
                                <div>
                                    <Label>Período</Label>
                                    <div className="text-sm">
                                        {format(parseISO(vacationToApprove.startDate), "d MMM")} -{" "}
                                        {format(parseISO(vacationToApprove.endDate), "d MMM yyyy", { locale: es })}
                                    </div>
                                </div>
                            </div>
                            <div>
                                <Label>Total Días</Label>
                                <div className="font-medium">{vacationToApprove.totalDays} días</div>
                            </div>
                            {vacationToApprove.reason && (
                                <div>
                                    <Label>Motivo</Label>
                                    <p className="text-sm text-muted-foreground">{vacationToApprove.reason}</p>
                                </div>
                            )}

                            <Separator />

                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="approve-comments">Comentarios (Aprobación)</Label>
                                    <Textarea
                                        id="approve-comments"
                                        placeholder="Comentarios adicionales..."
                                        value={managerComments}
                                        onChange={(e) => setManagerComments(e.target.value)}
                                        rows={2}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="reject-reason">Motivo de Rechazo</Label>
                                    <Textarea
                                        id="reject-reason"
                                        placeholder="Explica el motivo del rechazo..."
                                        value={rejectionReason}
                                        onChange={(e) => setRejectionReason(e.target.value)}
                                        rows={2}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {actionError && <p role="alert" className="text-destructive">{actionError}</p>}
                    <DialogFooter className="gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setApproveDialogOpen(false)}
                            disabled={isProcessing}
                        >
                            Cancelar
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => handleApprove("REJECTED")}
                            disabled={isProcessing || !rejectionReason.trim()}
                        >
                            <XCircle className="h-4 w-4 mr-2" />
                            Rechazar
                        </Button>
                        <Button
                            onClick={() => handleApprove("APPROVED")}
                            disabled={isProcessing}
                        >
                            <CheckCircle className="h-4 w-4 mr-2" />
                            Aprobar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
