"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Award,
  BookOpen,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

import { useState } from "react";
import { EmployeeTrainingDialog } from "../employee-training-dialog";

interface TrainingTabProps {
  training: any[];
  skills: any; // Can be an array or object from profile.skills
  employeeId?: string;
  companyId?: string;
  onSuccess?: () => void;
}

export function TrainingTab({ training, skills, employeeId, companyId, onSuccess }: TrainingTabProps) {
  const [showTrainingDialog, setShowTrainingDialog] = useState(false);
  const skillsArray = Array.isArray(skills) ? skills : [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Certifications and Main Training */}
      <div className="lg:col-span-2 space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Award className="h-5 w-5 text-primary" />
                  Capacitación y Certificaciones
                </CardTitle>
                <CardDescription>
                  Historial de capacitación profesional, cursos STPS y certificaciones vigentes.
                </CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={() => setShowTrainingDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Registrar Capacitación
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {training && training.length > 0 ? (
              <div className="space-y-4">
                {training.map((item, index) => (
                  <div key={item.id || index} className="p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="flex items-start justify-between">
                      <div className="flex gap-3">
                        <div className="p-2 bg-primary/10 rounded-lg h-fit">
                          {item.trainingType === 'CERTIFICATION' ? (
                            <ShieldCheck className="h-5 w-5 text-primary" />
                          ) : (
                            <BookOpen className="h-5 w-5 text-primary" />
                          )}
                        </div>
                        <div>
                          <div className="font-semibold text-lg">{item.trainingName}</div>
                          <div className="text-sm text-muted-foreground">{item.provider}</div>
                          
                          <div className="flex flex-wrap gap-2 mt-2">
                            <Badge variant={item.status === 'COMPLETED' ? 'default' : 'secondary'}>
                              {item.status === 'COMPLETED' ? 'Completado' : item.status === 'IN_PROGRESS' ? 'En Curso' : item.status}
                            </Badge>
                            <Badge variant="outline">{item.trainingType === 'CERTIFICATION' ? 'Certificación' : item.trainingType === 'COURSE' ? 'Curso STPS' : item.trainingType}</Badge>
                            {item.isMandatory && (
                              <Badge variant="destructive" className="text-xs">OBLIGATORIO</Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <div className="flex items-center gap-1 justify-end">
                          <Calendar className="h-3 w-3" />
                          {item.completionDate ? format(new Date(item.completionDate), "d 'de' MMM, yyyy", { locale: es }) : 'En Curso'}
                        </div>
                        {item.expirationDate && (
                          <div className="text-destructive mt-1">
                            Vence: {format(new Date(item.expirationDate), "d 'de' MMM, yyyy", { locale: es })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 border-2 border-dashed rounded-lg">
                <BookOpen className="mx-auto h-12 w-12 text-muted-foreground mb-4 opacity-20" />
                <h3 className="text-lg font-semibold">Sin Capacitaciones Registradas</h3>
                <p className="text-muted-foreground text-sm max-w-xs mx-auto">
                  Este colaborador no cuenta con registros de cursos o certificaciones STPS.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Skills & Progress */}
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Habilidades y Competencias
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {skillsArray.length > 0 ? (
              skillsArray.map((skill: any, index: number) => (
                <div key={index} className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{skill.name || skill}</span>
                    <span className="text-muted-foreground">{skill.level || 'Profesional'}</span>
                  </div>
                  <Progress value={skill.progress || 80} className="h-2" />
                </div>
              ))
            ) : (
              <div className="text-sm text-muted-foreground italic">
                Sin competencias registradas en el perfil.
              </div>
            )}

            <div className="pt-4">
              <h4 className="text-xs font-semibold mb-3 flex items-center gap-2">
                <Clock className="h-3 w-3" />
                Próxima Capacitación Requerida
              </h4>
              <div className="p-3 bg-orange-50 border border-orange-100 rounded-lg text-xs">
                <div className="font-bold text-orange-800">Reforzamiento de Seguridad e Higiene NOM-251</div>
                <div className="text-orange-600 mt-1">Vence en 45 días</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Training Resources */}
        <Card className="bg-primary/5 border-primary/10">
          <CardHeader>
            <CardTitle className="text-sm">Enlaces Rápidos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button variant="ghost" size="sm" className="w-full justify-start text-xs">
              <ExternalLink className="mr-2 h-3 w-3" />
              Portal de Capacitación (LMS)
            </Button>
            <Button variant="ghost" size="sm" className="w-full justify-start text-xs">
              <ExternalLink className="mr-2 h-3 w-3" />
              Base de Conocimientos Interna
            </Button>
          </CardContent>
        </Card>
      </div>

      {showTrainingDialog && employeeId && companyId && (
        <EmployeeTrainingDialog
          open={showTrainingDialog}
          onOpenChange={setShowTrainingDialog}
          onSuccess={onSuccess || (() => {})}
          employeeId={employeeId}
          companyId={companyId}
        />
      )}
    </div>
  );
}
