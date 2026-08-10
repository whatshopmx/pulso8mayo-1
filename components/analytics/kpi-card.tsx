"use client";

import * as React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    TrendingUp,
    TrendingDown,
    Minus,
    AlertTriangle,
    AlertCircle,
    CheckCircle,
    MoreVertical,
} from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

interface KpiCardProps {
    kpi: {
        id: string;
        name: string;
        description?: string;
        metricType: string;
        category: string;
        unit?: string;
        decimalPlaces?: number;
        target?: number;
        warningThreshold?: number;
        criticalThreshold?: number;
        thresholdType?: string;
    };
    currentValue: number;
    previousValue?: number;
    history?: Array<{ date: string; value: number }>;
    status?: "NORMAL" | "WARNING" | "CRITICAL";
    onDrillDown?: (kpiId: string) => void;
    onViewDetails?: (kpiId: string) => void;
}

export function KpiCard({
    kpi,
    currentValue,
    previousValue,
    history = [],
    status = "NORMAL",
    onDrillDown,
    onViewDetails,
}: KpiCardProps) {
    const formatValue = (value: number) => {
        const decimals = kpi.decimalPlaces || 2;
        const unit = kpi.unit || "";

        if (kpi.metricType === "PERCENTAGE") {
            return `${value.toFixed(decimals)}%`;
        } else if (kpi.metricType === "TIME") {
            return `${value.toFixed(decimals)} ${unit || "hrs"}`;
        } else {
            return `${value.toFixed(decimals)} ${unit || "units"}`;
        }
    };

    const trend = previousValue ? ((currentValue - previousValue) / previousValue) * 100 : 0;
    const trendDirection = trend > 0 ? "up" : trend < 0 ? "down" : "neutral";

    const getStatusColor = () => {
        switch (status) {
            case "CRITICAL":
                return "bg-red-500 text-red-700 border-red-200";
            case "WARNING":
                return "bg-yellow-500 text-yellow-700 border-yellow-200";
            default:
                return "bg-green-500 text-green-700 border-green-200";
        }
    };

    const getStatusIcon = () => {
        switch (status) {
            case "CRITICAL":
                return <AlertCircle className="h-4 w-4" />;
            case "WARNING":
                return <AlertTriangle className="h-4 w-4" />;
            default:
                return <CheckCircle className="h-4 w-4" />;
        }
    };

    const getTrendIcon = () => {
        if (trendDirection === "up") {
            return <TrendingUp className="h-4 w-4 text-green-600" />;
        } else if (trendDirection === "down") {
            return <TrendingDown className="h-4 w-4 text-red-600" />;
        } else {
            return <Minus className="h-4 w-4 text-muted-foreground" />;
        }
    };

    return (
        <Card className="relative">
            <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                    <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                            <h3 className="text-sm font-medium text-muted-foreground">{kpi.name}</h3>
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span>{getStatusIcon()}</span>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>Status: {status}</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                        {kpi.description && (
                            <p className="text-xs text-muted-foreground line-clamp-1">
                                {kpi.description}
                            </p>
                        )}
                    </div>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6">
                                <MoreVertical className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onDrillDown?.(kpi.id)}>
                                Drill Down
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onViewDetails?.(kpi.id)}>
                                View Details
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                {/* Current Value */}
                <div className="flex items-baseline gap-2">
                    <span className="font-mono text-2xl font-bold tracking-tight">{formatValue(currentValue)}</span>
                    <Badge variant="outline" className={`text-xs ${getStatusColor()}`}>
                        {kpi.thresholdType || "TARGET"}
                    </Badge>
                </div>

                {/* Trend */}
                {previousValue && (
                    <div className="flex items-center gap-2 text-xs">
                        {getTrendIcon()}
                        <span className={trendDirection === "up" ? "text-green-600" : trendDirection === "down" ? "text-red-600" : "text-muted-foreground"}>
                            {trend > 0 ? "+" : ""}{trend.toFixed(1)}% vs last period
                        </span>
                    </div>
                )}

                {/* Target Info */}
                {kpi.target && (
                    <div className="pt-2 border-t">
                        <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Target:</span>
                            <span className="font-medium">{formatValue(kpi.target)}</span>
                        </div>
                        {kpi.warningThreshold && (
                            <div className="flex justify-between text-xs">
                                <span className="text-muted-foreground">Warning:</span>
                                <span className="font-medium text-yellow-600">{formatValue(kpi.warningThreshold)}</span>
                            </div>
                        )}
                        {kpi.criticalThreshold && (
                            <div className="flex justify-between text-xs">
                                <span className="text-muted-foreground">Critical:</span>
                                <span className="font-medium text-red-600">{formatValue(kpi.criticalThreshold)}</span>
                            </div>
                        )}
                    </div>
                )}

                {/* Category Badge */}
                <div className="flex gap-2 flex-wrap pt-2 border-t">
                    <Badge variant="secondary" className="text-xs">
                        {kpi.category}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                        {kpi.metricType}
                    </Badge>
                </div>
            </CardContent>
        </Card>
    );
}
