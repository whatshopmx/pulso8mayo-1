"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Step {
    id: string;
    title: string;
    description: string;
    type: 'PHOTO' | 'TEXT' | 'CHECKBOX' | 'NUMBER';
    required: boolean;
    order: number;
}

interface DraggableStepProps {
    step: Step;
    index: number;
    onUpdate: (updates: Partial<Step>) => void;
    onRemove: () => void;
}

export function DraggableStep({ step, index, onUpdate, onRemove }: DraggableStepProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
    } = useSortable({ id: step.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    return (
        <div ref={setNodeRef} style={style} className="relative group">
            <Card>
                <div className="absolute top-1/2 -left-3 -translate-y-1/2 opacity-0 group-hover:opacity-100 cursor-move z-10" {...attributes} {...listeners}>
                    <div className="bg-background border rounded p-1 shadow-sm">
                        <GripVertical className="h-4 w-4 text-muted-foreground" />
                    </div>
                </div>

                <CardHeader className="p-4">
                    <div className="flex justify-between items-start">
                        <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs uppercase bg-muted px-1.5 py-0.5 rounded text-muted-foreground font-bold tracking-wider">
                                    {step.type}
                                </span>
                                <span className="text-xs text-muted-foreground">#{index + 1}</span>
                            </div>
                            <CardTitle className="text-base font-medium">{step.title}</CardTitle>
                            {step.description && <CardDescription className="mt-1">{step.description}</CardDescription>}
                        </div>
                        <button
                            onClick={onRemove}
                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive hover:text-destructive-foreground rounded transition-all"
                        >
                            <Trash2 className="h-4 w-4 text-destructive" />
                        </button>
                    </div>
                    {step.required && <span className="text-xs text-red-500 font-semibold mt-2 block">* Obligatorio</span>}
                </CardHeader>
            </Card>
        </div>
    );
}
