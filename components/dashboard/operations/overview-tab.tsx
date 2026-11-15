"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CompletionRateChart } from "./completion-rate-chart";
import { ActiveWorkflowsList } from "./active-workflows-list";
import { EmployeeLeaderboard } from "./employee-leaderboard";
import { InventoryActivityFeed } from "./inventory-activity-feed";

export function OverviewTab({ branchId, period }: { branchId?: string; period?: string }) {
    return (
        <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <Card className="md:col-span-1 lg:col-span-4">
                    <CardHeader>
                        <CardTitle>Cumplimiento de tareas</CardTitle>
                    </CardHeader>
                    <CardContent className="pl-2">
                        <CompletionRateChart branchId={branchId} period={period} />
                    </CardContent>
                </Card>
                <Card className="md:col-span-1 lg:col-span-3">
                    <CardHeader>
                        <CardTitle>Tareas en curso</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ActiveWorkflowsList branchId={branchId} />
                    </CardContent>
                </Card>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <Card className="md:col-span-1 lg:col-span-4">
                    <CardHeader>
                        <CardTitle>Actividad del equipo</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <EmployeeLeaderboard branchId={branchId} period={period} />
                    </CardContent>
                </Card>
                <Card className="md:col-span-1 lg:col-span-3">
                    <CardHeader>
                        <CardTitle>Actividad de inventario</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <InventoryActivityFeed branchId={branchId} />
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
