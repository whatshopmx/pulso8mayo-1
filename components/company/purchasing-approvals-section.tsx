"use client";

import { ApprovalMatrixEditor } from "@/components/service-orders/approval-matrix-editor";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** La matriz OC existente decide los niveles al enviar cada orden a aprobación. */
export function PurchasingApprovalsSection() {
  return (
    <section aria-labelledby="purchasing-approvals-title">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>
              <h2 id="purchasing-approvals-title" className="text-base font-semibold">
                Aprobaciones de compras
              </h2>
            </CardTitle>
            <Badge variant="secondary">Se aplica hoy</Badge>
          </div>
          <CardDescription>
            Elige qué rol aprueba cada rango de monto. Para exigir varios niveles, agrega
            reglas que cubran el mismo monto con secuencias distintas. Sólo un administrador
            o un rol superior puede editar esta matriz.
          </CardDescription>
          <p className="text-xs text-muted-foreground">
            Se guarda con «Guardar matriz de compras», por separado de la configuración general.
            Aplica al enviar nuevas órdenes a aprobación; las ya enviadas conservan sus niveles.
            La modalidad de compras describe la organización y no modifica esta matriz.
          </p>
          <p className="text-xs text-muted-foreground">
            Solicitar y emitir siguen sujetos a los permisos actuales. El presupuesto, el tope
            de emergencias y la separación entre solicitante y aprobador siguen aplicando.
          </p>
        </CardHeader>
        <CardContent>
          <ApprovalMatrixEditor documentType="OC" />
        </CardContent>
      </Card>
    </section>
  );
}
