"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, User, Building, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";

interface ScheduledAssignment {
    id: string;
    status: string;
    dueDate: Date;
    priority: string;
    assignmentType: string;
    templateName: string;
    branchName: string;
    assigneeName: string;
    createdAt: Date;
}

export function ScheduledTab() {
    const [scheduledItems, setScheduledItems] = useState<ScheduledAssignment[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchScheduledItems = async () => {
            try {
                const response = await fetch('/api/operations/scheduled', {
                    credentials: 'include',
                });
                if (response.ok) {
                    const result = await response.json();
                    const data = result.data || result;
                    if (Array.isArray(data)) {
                        setScheduledItems(data);
                    }
                }
            } catch (error) {
                console.error('Error fetching scheduled items:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchScheduledItems();
    }, []);

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'PENDING': return 'bg-yellow-100 text-yellow-800';
            case 'IN_PROGRESS': return 'bg-blue-100 text-blue-800';
            case 'COMPLETED': return 'bg-green-100 text-green-800';
            case 'OVERDUE': return 'bg-red-100 text-red-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    const getPriorityColor = (priority: string) => {
        switch (priority) {
            case 'HIGH': return 'bg-red-100 text-red-800';
            case 'MEDIUM': return 'bg-yellow-100 text-yellow-800';
            case 'LOW': return 'bg-green-100 text-green-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    if (loading) {
        return (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <Card className="col-span-7">
                    <CardHeader>
                        <CardTitle>Upcoming Schedule</CardTitle>
                        <CardDescription>
                            Workflows scheduled for today and this week.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center justify-center p-8">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
            <Card className="col-span-7">
                <CardHeader>
                    <CardTitle>Upcoming Schedule</CardTitle>
                    <CardDescription>
                        Workflows scheduled for today and this week.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {scheduledItems.length === 0 ? (
                        <div className="flex flex-col items-center justify-center p-8 text-center border border-dashed rounded-lg">
                            <Calendar className="h-10 w-10 text-muted-foreground mb-4" />
                            <h3 className="text-lg font-semibold">No scheduled workflows found</h3>
                            <p className="text-sm text-muted-foreground max-w-sm mt-2">
                                Assignments created in the builder will appear here.
                                Configure schedules in your workflow templates.
                            </p>
                        </div>
                    ) : (
                        <ScrollArea className="h-[400px]">
                            <div className="space-y-4">
                                {scheduledItems.map((item) => (
                                    <div key={item.id} className="flex items-center justify-between p-4 border rounded-lg">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-2">
                                                <h4 className="font-medium">{item.templateName}</h4>
                                                <Badge className={getPriorityColor(item.priority)}>
                                                    {item.priority}
                                                </Badge>
                                                <Badge className={getStatusColor(item.status)}>
                                                    {item.status}
                                                </Badge>
                                            </div>
                                            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                                <div className="flex items-center gap-1">
                                                    <Clock className="h-4 w-4" />
                                                    Due: {format(new Date(item.dueDate), 'MMM dd, HH:mm')}
                                                </div>
                                                {item.assigneeName && (
                                                    <div className="flex items-center gap-1">
                                                        <User className="h-4 w-4" />
                                                        {item.assigneeName}
                                                    </div>
                                                )}
                                                {item.branchName && (
                                                    <div className="flex items-center gap-1">
                                                        <Building className="h-4 w-4" />
                                                        {item.branchName}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
