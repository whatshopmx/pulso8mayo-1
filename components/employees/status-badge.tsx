"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type EmployeeStatus = 
  | "ONBOARDING" 
  | "ACTIVE" 
  | "ON_LEAVE" 
  | "SUSPENDED" 
  | "TERMINATED" 
  | "RESIGNED";

interface StatusBadgeProps {
  status: EmployeeStatus | string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const statusConfig: Record<string, { 
  label: string; 
  variant: "default" | "secondary" | "destructive" | "outline";
  className?: string;
}> = {
  ONBOARDING: { 
    label: "Onboarding", 
    variant: "secondary",
    className: "bg-blue-100 text-blue-800 hover:bg-blue-100"
  },
  ACTIVE: { 
    label: "Active", 
    variant: "default",
    className: "bg-green-100 text-green-800 hover:bg-green-100"
  },
  ON_LEAVE: { 
    label: "On Leave", 
    variant: "outline",
    className: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100"
  },
  SUSPENDED: { 
    label: "Suspended", 
    variant: "destructive",
    className: "bg-orange-100 text-orange-800 hover:bg-orange-100"
  },
  TERMINATED: { 
    label: "Terminated", 
    variant: "destructive",
    className: "bg-red-100 text-red-800 hover:bg-red-100"
  },
  RESIGNED: { 
    label: "Resigned", 
    variant: "destructive",
    className: "bg-gray-100 text-gray-800 hover:bg-gray-100"
  },
};

const sizeClasses = {
  sm: "text-xs px-1.5 py-0.5",
  md: "text-xs px-2 py-0.5",
  lg: "text-sm px-3 py-1",
};

export function StatusBadge({ status, size = "md", className }: StatusBadgeProps) {
  if (!status) return null;

  const config = statusConfig[status] || { 
    label: status, 
    variant: "outline",
    className: ""
  };

  return (
    <Badge 
      variant={config.variant} 
      className={cn(
        sizeClasses[size],
        config.className,
        className
      )}
    >
      {config.label}
    </Badge>
  );
}

// Document status badge
export type DocumentStatus = "VALIDATED" | "PENDING" | "EXPIRED" | "REJECTED";

interface DocumentStatusBadgeProps {
  status: DocumentStatus | string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const documentStatusConfig: Record<string, { 
  label: string; 
  variant: "default" | "secondary" | "destructive" | "outline";
  className?: string;
}> = {
  VALIDATED: { 
    label: "Validated", 
    variant: "default",
    className: "bg-green-100 text-green-800 hover:bg-green-100"
  },
  PENDING: { 
    label: "Pending", 
    variant: "secondary",
    className: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100"
  },
  EXPIRED: { 
    label: "Expired", 
    variant: "destructive",
    className: "bg-red-100 text-red-800 hover:bg-red-100"
  },
  REJECTED: { 
    label: "Rejected", 
    variant: "destructive",
    className: "bg-gray-100 text-gray-800 hover:bg-gray-100"
  },
};

export function DocumentStatusBadge({ status, size = "md", className }: DocumentStatusBadgeProps) {
  const config = documentStatusConfig[status] || { 
    label: status, 
    variant: "outline",
    className: ""
  };

  return (
    <Badge 
      variant={config.variant} 
      className={cn(
        sizeClasses[size],
        config.className,
        className
      )}
    >
      {config.label}
    </Badge>
  );
}
