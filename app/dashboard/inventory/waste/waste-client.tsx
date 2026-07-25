'use client';

import { useState } from 'react';
import { WasteForm } from '@/components/inventory/waste-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

interface WasteClientProps {
  branchId: string;
  preselectedItemId?: string;
}

export function WasteClient({ branchId, preselectedItemId }: WasteClientProps) {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleSuccess = () => {
    setRefreshKey(prev => prev + 1);
  };

  return (
    <div key={refreshKey} className="grid gap-6 lg:grid-cols-2">
      {/* Waste Registration Form */}
      <Card>
        <CardHeader>
          <CardTitle>Registrar Nueva Merma</CardTitle>
          <CardDescription>
            Completa los datos del producto que se dará de baja por merma
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WasteForm 
            branchId={branchId} 
            preselectedItemId={preselectedItemId}
            onSuccess={handleSuccess}
          />
        </CardContent>
      </Card>

      {/* Quick Info */}
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Tipos de Merma
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              <div>
                <dt className="font-medium text-sm">Caducidad (EXPIRED)</dt>
                <dd className="text-sm text-muted-foreground">
                  Productos que han pasado su fecha de vencimiento
                </dd>
              </div>
              <div>
                <dt className="font-medium text-sm">Dañado (DAMAGED)</dt>
                <dd className="text-sm text-muted-foreground">
                  Productos con empaque roto, golpes o deterioro físico
                </dd>
              </div>
              <div>
                <dt className="font-medium text-sm">Calidad (QUALITY)</dt>
                <dd className="text-sm text-muted-foreground">
                  Productos que no cumplen con los estándares de calidad
                </dd>
              </div>
              <div>
                <dt className="font-medium text-sm">Derrame (SPILLAGE)</dt>
                <dd className="text-sm text-muted-foreground">
                  Productos derramados o contaminados accidentalmente
                </dd>
              </div>
              <div>
                <dt className="font-medium text-sm">Otro (OTHER)</dt>
                <dd className="text-sm text-muted-foreground">
                  Cualquier otra causa de merma no listada
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Acciones Relacionadas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/dashboard/inventory/expirations">
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  Ver Productos por Vencer
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/dashboard/inventory">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Volver al Inventario
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
