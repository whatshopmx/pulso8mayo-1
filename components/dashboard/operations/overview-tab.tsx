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
                <Card className="col-span-4">
                    <CardHeader>
                        <CardTitle>Workflow Completion Rate</CardTitle>
                    </CardHeader>
                    <CardContent className="pl-2">
                        <CompletionRateChart />
                    </CardContent>
                </Card>
                <Card className="col-span-3">
                    <CardHeader>
                        <CardTitle>Active Workflows</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ActiveWorkflowsList />
                    </CardContent>
                </Card>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <Card className="col-span-4">
                    <CardHeader>
                        <CardTitle>Employee Leaderboard</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <EmployeeLeaderboard />
                    </CardContent>
                </Card>
                <Card className="col-span-3">
                    <CardHeader>
                        <CardTitle>Inventory Activity</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <InventoryActivityFeed branchId={branchId} />
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
