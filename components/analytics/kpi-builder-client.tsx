"use client";

import * as React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KpiForm } from "./kpi-form";
import { KpiTemplates } from "./kpi-templates";
import { type KpiTemplate } from "@/lib/analytics/restaurant-kpis";
import { Button } from "@/components/ui/button";
import { Plus, Copy, FileText, ChevronRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

interface KpiBuilderClientProps {
  userRole?: string;
}

export function KpiBuilderClient({ userRole = "GERENTE" }: KpiBuilderClientProps) {
  const [selectedTemplate, setSelectedTemplate] = React.useState<KpiTemplate | null>(null);
  const [activeTab, setActiveTab] = React.useState("templates");
  const { toast } = useToast();

  const handleSelectTemplate = (template: KpiTemplate) => {
    setSelectedTemplate(template);
    setActiveTab("custom");
    toast({
      title: "Plantilla cargada",
      description: `"${template.name}" está listo para personalizar`,
    });
  };

  const handleClearTemplate = () => {
    setSelectedTemplate(null);
  };

  return (
    <div className="max-w-6xl">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="templates" className="flex items-center gap-2">
            <Copy className="h-4 w-4" />
            Plantillas Predefinidas
          </TabsTrigger>
          <TabsTrigger value="custom" className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            KPI Personalizado
          </TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="mt-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Plantillas de KPIs para Restaurantes</h2>
                <p className="text-sm text-muted-foreground">
                  Selecciona una plantilla preconfigurada para tu grupo de restaurantes (3-15 sucursales)
                </p>
              </div>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setActiveTab("custom")}
              >
                <Plus className="h-4 w-4 mr-2" />
                Crear desde cero
              </Button>
            </div>
            <KpiTemplates 
              onSelectTemplate={handleSelectTemplate} 
              userRole={userRole}
            />
          </div>
        </TabsContent>

        <TabsContent value="custom" className="mt-6">
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Form */}
            <div className="lg:col-span-2">
              <KpiForm 
                initialTemplate={selectedTemplate || undefined}
                onClearTemplate={selectedTemplate ? handleClearTemplate : undefined}
              />
            </div>

            {/* Sidebar */}
            <div className="space-y-4">
              {selectedTemplate && (
                <Card className="border-primary/30 bg-primary/5">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Plantilla Seleccionada
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-3">
                    <div>
                      <h4 className="font-semibold text-sm">{selectedTemplate.name}</h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        {selectedTemplate.description}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-muted rounded p-2">
                        <span className="text-muted-foreground">Meta:</span>
                        <div className="font-medium">{selectedTemplate.target}{selectedTemplate.unit}</div>
                      </div>
                      <div className="bg-muted rounded p-2">
                        <span className="text-muted-foreground">Frecuencia:</span>
                        <div className="font-medium capitalize">{selectedTemplate.frequency.toLowerCase()}</div>
                      </div>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="w-full"
                      onClick={() => {
                        setActiveTab("templates");
                      }}
                    >
                      <ChevronRight className="h-4 w-4 mr-2 rotate-180" />
                      Cambiar plantilla
                    </Button>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Fórmulas Disponibles</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-2 text-xs">
                    <div className="font-medium text-muted-foreground mb-2">Operaciones</div>
                    <code className="block bg-muted px-2 py-1 rounded">
                      (completed_workflows / total_workflows) * 100
                    </code>
                    <code className="block bg-muted px-2 py-1 rounded">
                      (on_time_workflows / completed_workflows) * 100
                    </code>
                    
                    <div className="font-medium text-muted-foreground mt-3 mb-2">Personal</div>
                    <code className="block bg-muted px-2 py-1 rounded">
                      (attended_shifts / scheduled_shifts) * 100
                    </code>
                    <code className="block bg-muted px-2 py-1 rounded">
                      (compliant_breaks / total_breaks_required) * 100
                    </code>
                    
                    <div className="font-medium text-muted-foreground mt-3 mb-2">Inventario</div>
                    <code className="block bg-muted px-2 py-1 rounded">
                      (accurate_items / total_items) * 100
                    </code>
                    <code className="block bg-muted px-2 py-1 rounded">
                      cost_of_goods_sold / avg_inventory_value
                    </code>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Consejos</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <ul className="text-xs text-muted-foreground space-y-2">
                    <li className="flex gap-2">
                      <span className="text-primary">•</span>
                      Usa umbrales realistas basados en benchmarks de la industria
                    </li>
                    <li className="flex gap-2">
                      <span className="text-primary">•</span>
                      KPIs de cumplimiento deben tener meta del 100%
                    </li>
                    <li className="flex gap-2">
                      <span className="text-primary">•</span>
                      Actualiza la frecuencia según la criticidad del indicador
                    </li>
                    <li className="flex gap-2">
                      <span className="text-primary">•</span>
                      Verifica que la fórmula esté correctamente escrita
                    </li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
