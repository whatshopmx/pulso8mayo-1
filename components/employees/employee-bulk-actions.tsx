"use client";

import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  MoreHorizontal,
  Mail,
  MessageCircle,
  Building,
  ToggleRight,
  FileDown,
} from "lucide-react";
import { toast } from "sonner";

interface EmployeeBulkActionsProps {
  selectedEmployees: string[];
  onClearSelection: () => void;
  onBulkAction?: (action: string, employeeIds: string[]) => Promise<void>;
}

const actionLabels: Record<string, string> = {
  "change-department": "Change Department",
  "change-status": "Change Status",
  "email": "Send Email",
  "whatsapp": "Send WhatsApp",
  "export": "Export Selected",
};

export function EmployeeBulkActions({
  selectedEmployees,
  onClearSelection,
  onBulkAction,
}: EmployeeBulkActionsProps) {
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const executeAction = async (action: string) => {
    if (selectedEmployees.length === 0) {
      toast.error("No employees selected");
      return;
    }

    setLoading(true);
    try {
      await onBulkAction?.(action, selectedEmployees);
      
      switch (action) {
        case "export":
          toast.success(`Exporting ${selectedEmployees.length} employee(s)`);
          break;
        case "email":
          toast.success(`Opening email composer for ${selectedEmployees.length} employee(s)`);
          break;
        case "whatsapp":
          toast.success(`Opening WhatsApp for ${selectedEmployees.length} employee(s)`);
          break;
        case "change-department":
          toast.success(`Department change updated for ${selectedEmployees.length} employee(s)`);
          break;
        case "change-status":
          toast.success(`Status change updated for ${selectedEmployees.length} employee(s)`);
          break;
        default:
          toast.success(`Action "${action}" completed for ${selectedEmployees.length} employee(s)`);
      }
    } catch (error) {
      console.error("Error performing bulk action:", error);
      toast.error("Error performing bulk action");
    } finally {
      setLoading(false);
      setPendingAction(null);
    }
  };

  const handleActionClick = (action: string) => {
    if (action === "change-department" || action === "change-status") {
      setPendingAction(action);
    } else {
      executeAction(action);
    }
  };

  if (selectedEmployees.length === 0) {
    return null;
  }

  return (
    <>
      <div className="flex items-center gap-2 bg-muted/60 border border-muted p-2 rounded-lg text-sm">
        <Badge variant="secondary" className="font-normal text-xs">
          {selectedEmployees.length} selected
        </Badge>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={loading}>
              <MoreHorizontal className="mr-2 h-4 w-4" />
              Bulk Actions
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            
            <DropdownMenuItem onClick={() => handleActionClick("export")}>
              <FileDown className="mr-2 h-4 w-4" />
              Export Selected
            </DropdownMenuItem>
            
            <DropdownMenuSeparator />
            
            <DropdownMenuItem onClick={() => handleActionClick("email")}>
              <Mail className="mr-2 h-4 w-4" />
              Send Email
            </DropdownMenuItem>
            
            <DropdownMenuItem onClick={() => handleActionClick("whatsapp")}>
              <MessageCircle className="mr-2 h-4 w-4" />
              Send WhatsApp
            </DropdownMenuItem>
            
            <DropdownMenuSeparator />
            
            <DropdownMenuItem onClick={() => handleActionClick("change-department")}>
              <Building className="mr-2 h-4 w-4" />
              Change Department
            </DropdownMenuItem>
            
            <DropdownMenuItem onClick={() => handleActionClick("change-status")}>
              <ToggleRight className="mr-2 h-4 w-4" />
              Change Status
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="ghost" size="sm" onClick={onClearSelection}>
          Clear Selection
        </Button>
      </div>

      <AlertDialog open={!!pendingAction} onOpenChange={(open) => !open && setPendingAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Confirm {pendingAction ? actionLabels[pendingAction] || pendingAction : "Bulk Action"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to perform &quot;{pendingAction ? actionLabels[pendingAction] || pendingAction : ""}&quot; on {selectedEmployees.length} selected employee(s)?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={loading}
              onClick={() => pendingAction && executeAction(pendingAction)}
            >
              {loading ? "Processing..." : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
