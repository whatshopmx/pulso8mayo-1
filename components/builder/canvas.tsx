
"use client";

import React from 'react';
import { useBuilder } from './builder-context';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';

import { SortableStep } from './sortable-step';

export function Canvas() {
    const { steps, moveStep, selectStep } = useBuilder();



    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    function handleDragEnd(event: DragEndEvent) {
        const { active, over } = event;
        if (active.id !== over?.id) {
            moveStep(active.id as string, over?.id as string);
        }
    }

    return (
        <div className="flex-1 bg-background p-8 overflow-y-auto h-full" onClick={(e) => {
            if (e.target === e.currentTarget) selectStep(null);
        }}>
            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
            >
                <div className="max-w-xl mx-auto space-y-4 pb-20">
                    <div className="mb-8">
                        <h2 className="text-2xl font-semibold tracking-tight">Lienzo del Flujo</h2>
                        <p className="text-muted-foreground">Arrastra y suelta para reordenar. Haz clic para editar propiedades.</p>
                    </div>

                    <SortableContext items={steps.map(s => s.id)} strategy={verticalListSortingStrategy}>
                        {steps.map((step) => (
                            <SortableStep key={step.id} step={step} />
                        ))}
                    </SortableContext>

                    {steps.length === 0 && (
                        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-muted-foreground">
                            <p>Selecciona un componente de la izquierda para comenzar.</p>
                        </div>
                    )}
                </div>
            </DndContext>
        </div>
    );
}
