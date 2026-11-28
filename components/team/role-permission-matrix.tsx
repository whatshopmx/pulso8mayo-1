"use client";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Check, X } from "lucide-react";
import { hasPermission, type Role } from "@/lib/permissions";
import { hasAccess, type UserRole } from "@/lib/rbac/permissions";

const MATRIX_ROLES: { role: Role; label: string }[] = [
    { role: "SUPER_ADMIN", label: "Super Admin" },
    { role: "ADMIN", label: "Admin" },
    { role: "GERENTE", label: "Gerente" },
    { role: "SUPERVISOR", label: "Supervisor" },
    { role: "EMPLEADO", label: "Empleado" },
    { role: "READONLY", label: "Solo Lectura" },
];

export const PERMISSION_ROWS: {
    name: string;
    check: (role: Role) => boolean;
}[] = [
    {
        name: "Comando de Red y Excepciones",
        check: (role) => hasAccess(role as UserRole, "/dashboard/exceptions"),
    },
    {
        name: "Dirección Ejecutiva y P&L",
        check: (role) => hasPermission(role, "executive", "read"),
    },
    {
        name: "Nómina y Cumplimiento Laboral",
        check: (role) => hasPermission(role, "payroll", "read"),
    },
    {
        name: "Ejecutar Flujos y Mis Tareas",
        check: (role) => hasAccess(role as UserRole, "/dashboard/workflows"),
    },
    {
        name: "Constructor y Plantillas de Flujos",
        check: (role) => hasAccess(role as UserRole, "/dashboard/builder"),
    },
    {
        name: "Inventario y Equipos",
        check: (role) => hasAccess(role as UserRole, "/dashboard/inventory"),
    },
    {
        name: "Cortes de Ventas y Caja Chica",
        check: (role) => hasAccess(role as UserRole, "/dashboard/sales"),
    },
    {
        name: "Finanzas Corporativas y Presupuestos",
        check: (role) => hasAccess(role as UserRole, "/dashboard/finance"),
    },
    {
        name: "Autoservicio (Vacaciones, Turnos, Permisos)",
        check: (role) => hasAccess(role as UserRole, "/dashboard/labor/vacations"),
    },
    {
        name: "Gestionar Equipo y Usuarios",
        check: (role) => hasAccess(role as UserRole, "/dashboard/team"),
    },
    {
        name: "Configuración de Empresa y Sucursales",
        check: (role) => hasAccess(role as UserRole, "/dashboard/company"),
    },
    {
        name: "Cambiar Plan y Suscripción",
        check: (role) => hasPermission(role, "billing", "manage"),
    },
];

export function RolePermissionMatrix() {
    return (
        <div className="rounded-md border overflow-x-auto">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="min-w-[260px]">Permiso / Módulo</TableHead>
                        {MATRIX_ROLES.map(({ role, label }) => (
                            <TableHead key={role} className="text-center whitespace-nowrap">
                                {label}
                            </TableHead>
                        ))}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {PERMISSION_ROWS.map((row) => (
                        <TableRow key={row.name}>
                            <TableCell className="font-medium">{row.name}</TableCell>
                            {MATRIX_ROLES.map(({ role }) => {
                                const allowed = row.check(role);
                                return (
                                    <TableCell key={role} className="text-center">
                                        {allowed ? (
                                            <Check
                                                className="mx-auto h-4 w-4 text-emerald-600"
                                                aria-label="Permitido"
                                            />
                                        ) : (
                                            <X
                                                className="mx-auto h-4 w-4 text-muted-foreground"
                                                aria-label="No permitido"
                                            />
                                        )}
                                    </TableCell>
                                );
                            })}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
