
"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import { Type, Hash, CheckSquare, Camera, List, ToggleLeft, Clock, Thermometer, PenTool, MapPin, Hourglass, Video, Mic, Info } from 'lucide-react';
import { useBuilder, StepType } from './builder-context';

const tools: { type: StepType; label: string; icon: React.ReactNode }[] = [
    { type: 'instruction', label: 'Instrucción', icon: <Info className="w-4 h-4 mr-2" /> },
    { type: 'text', label: 'Texto', icon: <Type className="w-4 h-4 mr-2" /> },
    { type: 'number', label: 'Número', icon: <Hash className="w-4 h-4 mr-2" /> },
    { type: 'yes_no', label: 'Sí/No', icon: <ToggleLeft className="w-4 h-4 mr-2" /> },
    { type: 'multiple_choice', label: 'Opción Múltiple', icon: <List className="w-4 h-4 mr-2" /> },
    { type: 'checklist', label: 'Lista de Verificación', icon: <CheckSquare className="w-4 h-4 mr-2" /> },
    { type: 'photo', label: 'Foto/IA', icon: <Camera className="w-4 h-4 mr-2" /> },
    { type: 'TimeField', label: 'Hora', icon: <Clock className="w-4 h-4 mr-2" /> },
    { type: 'TemperatureField', label: 'Temperatura', icon: <Thermometer className="w-4 h-4 mr-2" /> },
    { type: 'SignatureField', label: 'Firma', icon: <PenTool className="w-4 h-4 mr-2" /> },
    { type: 'OPSLocationField', label: 'Ubicación GPS', icon: <MapPin className="w-4 h-4 mr-2" /> },
    { type: 'timer', label: 'Temporizador', icon: <Hourglass className="w-4 h-4 mr-2" /> },
    { type: 'video', label: 'Video', icon: <Video className="w-4 h-4 mr-2" /> },
    { type: 'audio', label: 'Audio', icon: <Mic className="w-4 h-4 mr-2" /> },
];

export function Toolbox() {
    const { addStep } = useBuilder();

    return (
        <div className="w-64 border-r bg-muted/20 p-4 space-y-4">
            <h3 className="font-medium text-sm text-muted-foreground mb-4">Componentes</h3>
            <div className="grid gap-2">
                {tools.map((tool) => (
                    <Button
                        key={tool.type}
                        variant="secondary"
                        className="justify-start"
                        onClick={() => addStep(tool.type)}
                    >
                        {tool.icon}
                        {tool.label}
                    </Button>
                ))}
            </div>
            <div className="mt-8 p-4 bg-muted border border-border rounded text-xs text-muted-foreground">
                <p>Haz clic para agregarlos al final del flujo de trabajo.</p>
            </div>
        </div>
    );
}
