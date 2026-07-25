"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useBuilder, WorkflowStep } from "./builder-context";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { STEP_TYPE_DISPLAY } from "@/lib/workflow-type-map";

interface SortableStepProps {
    step: WorkflowStep;
    isSelected?: boolean;
    onClick?: () => void;
}

export function SortableStep({ step, isSelected: propIsSelected, onClick: propOnClick }: SortableStepProps) {
    const { selectedStepId, selectStep } = useBuilder();
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
    } = useSortable({ id: step.id });

    const isSelected = propIsSelected !== undefined ? propIsSelected : (selectedStepId === step.id);
    const onClick = propOnClick || (() => selectStep(step.id));

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    return (
        <div ref={setNodeRef} style={style} className="relative group mb-3">
            <Card
                className={cn(
                    "cursor-pointer transition-all border-2",
                    isSelected 
                        ? "border-primary bg-accent/5" 
                        : "border-border hover:border-foreground/20 bg-card"
                )}
                onClick={onClick}
            >
                <div 
                    className="absolute top-1/2 -left-3 -translate-y-1/2 opacity-0 group-hover:opacity-100 cursor-grab text-muted-foreground hover:text-foreground" 
                    {...attributes} 
                    {...listeners}
                    aria-label="Arrastrar para reordenar"
                >
                    <div className="bg-background border rounded p-1">
                        <GripVertical className="h-4 w-4" />
                    </div>
                </div>

                <CardHeader className="p-4">
                    <div className="flex justify-between items-start">
                        <div className="space-y-1">
                            <CardTitle className="text-sm font-medium flex items-center gap-2">
                                <span className="text-xs uppercase bg-muted px-1.5 py-0.5 rounded text-muted-foreground font-semibold tracking-wider">
                                    {STEP_TYPE_DISPLAY[step.type] || step.type}
                                </span>
                                {step.title}
                            </CardTitle>
                            {step.description && (
                                <CardDescription className="mt-1 text-xs line-clamp-2">
                                    {step.description}
                                </CardDescription>
                            )}
                        </div>
                        {step.required && (
                            <span className="text-xs bg-destructive/10 text-destructive px-1.5 py-0.5 rounded font-semibold">
                                Obligatorio
                            </span>
                        )}
                    </div>
                </CardHeader>
            </Card>
        </div>
    );
}
