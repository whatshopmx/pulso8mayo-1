"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OverviewTab } from "./overview-tab";
import { ScheduledTab } from "./scheduled-tab";
import { TemplatesTab } from "./templates-tab";
import { RecentWorkflowsTable } from "../recent-workflows-table";
import { TemperatureMonitor } from "./temperature-monitor";

interface OperationsTabsProps {
  recentWorkflows: any[];
  period?: string;
  branchId?: string;
}

export function OperationsTabs({ recentWorkflows, period = "30d", branchId }: OperationsTabsProps) {
    return (
        <Tabs defaultValue="overview" className="space-y-4">
            <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="activity">Live & Recent</TabsTrigger>
                <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
                <TabsTrigger value="templates">Templates</TabsTrigger>
            </TabsList>
    <TabsContent value="overview" className="space-y-4">
      <OverviewTab branchId={branchId} period={period} />
      <TemperatureMonitor period={period} branchId={branchId} />
    </TabsContent>
            <TabsContent value="activity" className="space-y-4">
                <Card>
                    <CardHeader>
                        <CardTitle>Recent Activity</CardTitle>
                        <CardDescription>
                            Real-time log of all workflow executions.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <RecentWorkflowsTable workflows={recentWorkflows} />
                    </CardContent>
                </Card>
            </TabsContent>
            <TabsContent value="scheduled" className="space-y-4">
                <ScheduledTab />
            </TabsContent>
            <TabsContent value="templates" className="space-y-4">
                <Card>
                    <CardHeader>
                        <CardTitle>My Templates</CardTitle>
                        <CardDescription>
                            Manage and launch your workflow templates.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">Templates grid integration pending...</p>
                    </CardContent>
                </Card>
            </TabsContent>
        </Tabs>
    );
}
