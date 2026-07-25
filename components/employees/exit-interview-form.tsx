"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageSquare, HeartHandshake, Flag } from "lucide-react";

interface ExitInterviewFormProps {
  onNotesChange: (notes: string) => void;
  onConductedByChange: (userId: string) => void;
}

export function ExitInterviewForm({ onNotesChange, onConductedByChange }: ExitInterviewFormProps) {
  return (
    <Card className="border-purple-200/50 shadow-md">
      <CardHeader className="bg-purple-50/30">
        <div className="flex items-center gap-2">
          <HeartHandshake className="h-5 w-5 text-purple-600" />
          <CardTitle className="text-base text-purple-950">Entrevista de Salida</CardTitle>
        </div>
        <CardDescription>Captura retroalimentación para mejorar el clima organizacional</CardDescription>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Motivo Principal Extendido</Label>
            <Textarea 
              placeholder="Detalles sobre por qué el empleado decidió retirarse..." 
              className="min-h-[80px] text-sm"
              onChange={(e) => onNotesChange(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Calificación de Experiencia</Label>
              <Select defaultValue="neutral">
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Selecciona..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="positive">Muy Positiva</SelectItem>
                  <SelectItem value="neutral">Favorable / Estable</SelectItem>
                  <SelectItem value="negative">Negativa / Mal Clima</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label className="text-sm font-medium">¿Recomendaría la empresa?</Label>
              <Select defaultValue="yes">
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Selecciona..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Sí, definitivamente</SelectItem>
                  <SelectItem value="maybe">Tal vez / Solo ciertas áreas</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2 p-3 bg-slate-50 rounded-lg border border-slate-100 italic text-xs text-muted-foreground flex items-start gap-2">
            <Flag className="h-3.5 w-3.5 mt-0.5" />
            Esta información es confidencial y solo accesible por el departamento de Capital Humano para análisis de rotación.
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
