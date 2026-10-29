'use client';

import { useState } from 'react';
import { ScheduleList } from '@/components/schedules/schedule-list';
import { ScheduleStats } from '@/components/schedules/schedule-stats';
import { ScheduleForm } from '@/components/schedules/schedule-form';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { Plus, FilterX, Building2 } from 'lucide-react';
import { useBranch } from '@/lib/branch-context';

export default function SchedulesPage() {
    // La sucursal la gobierna el selector global del encabezado: una sola
    // fuente de verdad, para que el header, el selector interno y las
    // peticiones no puedan apuntar a sucursales distintas.
    const { branches, selectedBranchId, selectedBranch, setSelectedBranchId, isBranchScoped, userBranchId } = useBranch();
    const branchId = selectedBranchId;
    const [filters, setFilters] = useState<{
        isActive?: boolean;
        frequency?: string;
        assignmentType?: string;
    }>({});
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [selectedSchedule, setSelectedSchedule] = useState<any>(null);
    const [refreshKey, setRefreshKey] = useState(0);

    const handleEdit = (schedule: any) => {
        setSelectedSchedule(schedule);
        setIsFormOpen(true);
    };

    const handleDelete = (scheduleId: string) => {
        setRefreshKey((prev) => prev + 1);
    };

    const handleToggle = (scheduleId: string, isActive: boolean) => {
        setRefreshKey((prev) => prev + 1);
    };

    const handleCreateNew = () => {
        setSelectedSchedule(null);
        setIsFormOpen(true);
    };

    const handleFormSuccess = () => {
        setIsFormOpen(false);
        setSelectedSchedule(null);
        setRefreshKey((prev) => prev + 1);
    };

    const handleFormCancel = () => {
        setIsFormOpen(false);
        setSelectedSchedule(null);
    };

    const clearFilters = () => {
        setFilters({});
    };

    const hasFilters = Object.values(filters).some(v => v !== undefined);

    if (!branchId) {
        // "Todas" no tiene lectura agregada de schedules: la programación es
        // por sucursal. Se pide elegir en vez de inventar una o dejar la
        // pantalla cargando para siempre.
        return (
            <div className="flex flex-col items-center justify-center gap-4 rounded-lg border bg-card px-6 py-16 text-center">
                <Building2 className="h-8 w-8 text-muted-foreground" />
                <div className="space-y-1">
                    <h2 className="text-lg font-semibold">Selecciona una sucursal</h2>
                    <p className="text-sm text-muted-foreground">
                        La programación de workflows se gestiona por sucursal.
                    </p>
                </div>
                {isBranchScoped && !userBranchId ? (
                    <p className="text-sm text-muted-foreground">
                        Tu usuario no tiene una sucursal asignada. Pídele a un administrador que te asigne una.
                    </p>
                ) : branches.length > 0 ? (
                    <Select onValueChange={(value) => setSelectedBranchId(value)}>
                        <SelectTrigger className="w-[240px]">
                            <SelectValue placeholder="Elegir sucursal" />
                        </SelectTrigger>
                        <SelectContent>
                            {branches.map((branch) => (
                                <SelectItem key={branch.id} value={branch.id}>
                                    {branch.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                ) : (
                    <p className="text-sm text-muted-foreground">
                        No hay sucursales disponibles en tu empresa.
                    </p>
                )}
            </div>
        );
    }

    return (
        <>
            <div className="space-y-6 p-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Programación de Workflows</h1>
                        <p className="text-muted-foreground">
                            Gestiona la ejecución automática de workflows
                        </p>
                    </div>
                    <Button onClick={handleCreateNew}>
                        <Plus className="h-4 w-4 mr-2" />
                        Nuevo Schedule
                    </Button>
                </div>

                {/* Stats */}
                <ScheduleStats branchId={branchId} />

                {/* Filters */}
                <div className="flex flex-wrap gap-4 items-center">
                    {isBranchScoped ? (
                        // Un rol fijado no elige sucursal: el servidor le
                        // impone la suya, así que mostrarle un menú sería
                        // prometer una agencia que no tiene.
                        <span className="flex h-9 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground">
                            <Building2 className="h-4 w-4" aria-hidden="true" />
                            Sucursal: {selectedBranch?.name ?? 'la tuya'}
                        </span>
                    ) : (
                        <Select value={branchId} onValueChange={(value) => setSelectedBranchId(value)}>
                            <SelectTrigger className="w-[200px]">
                                <SelectValue placeholder="Sucursal" />
                            </SelectTrigger>
                            <SelectContent>
                                {branches.map((branch) => (
                                    <SelectItem key={branch.id} value={branch.id}>
                                        {branch.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}

                    <Select
                        value={filters.isActive === undefined ? 'all' : filters.isActive ? 'true' : 'false'}
                        onValueChange={(value) =>
                            setFilters({
                                ...filters,
                                isActive: value === 'all' ? undefined : value === 'true',
                            })
                        }
                    >
                        <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Estado" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todos</SelectItem>
                            <SelectItem value="true">Activos</SelectItem>
                            <SelectItem value="false">Inactivos</SelectItem>
                        </SelectContent>
                    </Select>

                    <Select
                        value={filters.frequency || 'all'}
                        onValueChange={(value) =>
                            setFilters({ ...filters, frequency: value === 'all' ? undefined : value })
                        }
                    >
                        <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Frecuencia" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todas</SelectItem>
                            <SelectItem value="DAILY">Diario</SelectItem>
                            <SelectItem value="WEEKLY">Semanal</SelectItem>
                            <SelectItem value="MONTHLY">Mensual</SelectItem>
                            <SelectItem value="ONCE">Una vez</SelectItem>
                        </SelectContent>
                    </Select>

                    <Select
                        value={filters.assignmentType || 'all'}
                        onValueChange={(value) =>
                            setFilters({ ...filters, assignmentType: value === 'all' ? undefined : value })
                        }
                    >
                        <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Asignación" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todas</SelectItem>
                            <SelectItem value="ROLE">Por rol</SelectItem>
                            <SelectItem value="USER">Por usuario</SelectItem>
                            <SelectItem value="AUTO">Automática</SelectItem>
                        </SelectContent>
                    </Select>

                    {hasFilters && (
                        <Button variant="outline" size="sm" onClick={clearFilters}>
                            <FilterX className="h-4 w-4 mr-2" />
                            Limpiar filtros
                        </Button>
                    )}
                </div>

                {/* Schedule List */}
                <ScheduleList
                    key={refreshKey}
                    branchId={branchId}
                    filters={filters}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onToggle={handleToggle}
                />
            </div>

            {/* Schedule Form Sheet */}
            <Sheet open={isFormOpen} onOpenChange={setIsFormOpen}>
                <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
                    <SheetHeader>
                        <SheetTitle>
                            {selectedSchedule ? 'Editar Schedule' : 'Crear Nuevo Schedule'}
                        </SheetTitle>
                        <SheetDescription>
                            {selectedSchedule
                                ? 'Actualiza la configuración del schedule automático'
                                : 'Configura un nuevo schedule para ejecutar workflows automáticamente'}
                        </SheetDescription>
                    </SheetHeader>
                    <div className="mt-6">
                        <ScheduleForm
                            schedule={selectedSchedule}
                            branchId={branchId}
                            onSuccess={handleFormSuccess}
                            onCancel={handleFormCancel}
                        />
                    </div>
                </SheetContent>
            </Sheet>
        </>
    );
}
