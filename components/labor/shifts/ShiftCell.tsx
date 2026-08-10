"use client";

/**
 * ShiftCell Component
 * Displays a single shift in the weekly matrix with hover actions
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Shift, SHIFT_TYPES } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Edit, Trash2, Copy, AlertTriangle } from "lucide-react";

interface ShiftCellProps {
  shift?: Shift;
  isEmpty?: boolean;
  onEdit?: (shift: Shift) => void;
  onDelete?: (shift: Shift) => void;
  onDuplicate?: (shift: Shift) => void;
  className?: string;
}

export function ShiftCell({
  shift,
  isEmpty = false,
  onEdit,
  onDelete,
  onDuplicate,
  className,
}: ShiftCellProps) {
  const [isHovered, setIsHovered] = useState(false);

  if (isEmpty || !shift) {
    return (
      <div
        className={cn(
          "h-20 border-2 border-dashed border-muted rounded-md flex items-center justify-center",
          "hover:border-muted-foreground/50 cursor-pointer transition-colors",
          className
        )}
      >
        <span className="text-muted-foreground text-sm">+ Agregar</span>
      </div>
    );
  }

  const hasConflict = false; // Will be computed by parent

  const getStatusColor = (status: string) => {
    switch (status) {
      case "PUBLISHED":
        return "bg-green-100 border-green-300 text-green-800";
      case "DRAFT":
        return "bg-yellow-100 border-yellow-300 text-yellow-800";
      case "CANCELLED":
        return "bg-gray-100 border-gray-300 text-gray-500";
      default:
        return "bg-blue-100 border-blue-300 text-blue-800";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "PUBLISHED":
        return "Publicado";
      case "DRAFT":
        return "Borrador";
      case "CANCELLED":
        return "Cancelado";
      default:
        return status;
    }
  };

  return (
    <div
      className={cn(
        "relative h-20 p-2 border rounded-md transition-all",
        getStatusColor(shift.status),
        isHovered && "shadow-md ring-2 ring-primary/20",
        hasConflict && "ring-2 ring-red-500",
        className
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Conflict indicator */}
      {hasConflict && (
        <div className="absolute -top-1 -right-1">
          <AlertTriangle className="h-4 w-4 text-red-500" />
        </div>
      )}

      {/* Shift content */}
      <div className="flex flex-col h-full justify-between">
        <div className="flex items-start justify-between">
          <span className="font-medium text-sm truncate flex-1">
            {shift.userName}
          </span>
          {isHovered && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6 -mr-1 -mt-1" aria-label="Acciones de turno">
                  <MoreHorizontal className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit?.(shift)}>
                  <Edit className="h-4 w-4 mr-2" />
                  Editar
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onDuplicate?.(shift)}>
                  <Copy className="h-4 w-4 mr-2" />
                  Duplicar
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onDelete?.(shift)}
                  className="text-red-600"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Eliminar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs font-mono">
            {shift.startTime} - {shift.endTime}
          </span>
          <Badge variant="outline" className="text-xs px-1 py-0 h-4">
            {getStatusLabel(shift.status)}
          </Badge>
        </div>

        {shift.role && (
          <span className="text-xs text-muted-foreground truncate">
            {shift.role}
          </span>
        )}
      </div>
    </div>
  );
}
