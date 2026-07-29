import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Brain } from "lucide-react";

/**
 * Contenido de ayuda NOM-251 / NOM-035.
 *
 * Extraído del tab "Info" de la página principal de compliance en T3
 * (rediseño de cumplimiento). Se conserva para reuso contextual en T18:
 * ayuda "?" dentro de cada tab de reporte del Expediente de Auditoría.
 */
export function NomHelpContent() {
    return (
        <div className="space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <FileText className="h-5 w-5 text-primary" />
                            NOM-251-STPS-2015
                        </CardTitle>
                        <CardDescription>
                            Funciones de seguridad e higiene - Establecimientos de alimentos y bebidas
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-muted-foreground">
                            Requisitos mínimos de seguridad e higiene para establecimientos de alimentos y bebidas.
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Brain className="h-5 w-5 text-info" />
                            NOM-035-STPS-2018
                        </CardTitle>
                        <CardDescription>
                            Factores de riesgo psicosocial en el trabajo
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-muted-foreground">
                            Identifica, analiza y previene factores de riesgo psicosocial en el trabajo.
                        </p>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Beneficios Operativos</CardTitle>
                    <CardDescription>
                        El cumplimiento normativo como ventaja operativa
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid md:grid-cols-2 gap-4">
                        <div>
                            <h4 className="font-semibold mb-2">Beneficios NOM-251:</h4>
                            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                                <li>Operaciones más seguras y estandarizadas</li>
                                <li>Mejora la seguridad alimentaria</li>
                                <li>Confianza y reputación ante clientes</li>
                                <li>Auditorías sanitarias siempre listas</li>
                            </ul>
                        </div>
                        <div>
                            <h4 className="font-semibold mb-2">Beneficios NOM-035:</h4>
                            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                                <li>Entorno laboral saludable y productivo</li>
                                <li>Mejora el bienestar del personal</li>
                                <li>Reduce rotación de empleados</li>
                                <li>Previene riesgos psicosociales</li>
                            </ul>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
