"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Package, Plus, Trash2, CheckCircle2 } from "lucide-react";

interface Asset {
  id: string;
  name: string;
  returned: boolean;
  condition?: string;
}

interface AssetChecklistProps {
  initialAssets?: Asset[];
  onAssetsChange: (assets: Asset[]) => void;
}

export function AssetChecklist({ initialAssets = [], onAssetsChange }: AssetChecklistProps) {
  const [assets, setAssets] = useState<Asset[]>(initialAssets.length > 0 ? initialAssets : [
    { id: "1", name: "Llaves de acceso / Tag", returned: false },
    { id: "2", name: "Uniforme completo (Filipina/Mandil)", returned: false },
    { id: "3", name: "Equipo móvil / Tablet", returned: false },
    { id: "4", name: "Credencial de empleado", returned: false },
  ]);
  const [newItemName, setNewItemName] = useState("");

  const handleToggle = (id: string) => {
    const updated = assets.map(a => a.id === id ? { ...a, returned: !a.returned } : a);
    setAssets(updated);
    onAssetsChange(updated);
  };

  const addItem = () => {
    if (!newItemName.trim()) return;
    const newItem = {
      id: Math.random().toString(36).substr(2, 9),
      name: newItemName.trim(),
      returned: false,
    };
    const updated = [...assets, newItem];
    setAssets(updated);
    onAssetsChange(updated);
    setNewItemName("");
  };

  const removeItem = (id: string) => {
    const updated = assets.filter(a => a.id !== id);
    setAssets(updated);
    onAssetsChange(updated);
  };

  const returnedCount = assets.filter(a => a.returned).length;

  return (
    <Card className="border-orange-200/50 shadow-md">
      <CardHeader className="bg-orange-50/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-orange-600" />
            <CardTitle className="text-base text-orange-950">Devolución de Activos</CardTitle>
          </div>
          <Badge variant="secondary" className="bg-orange-100 text-orange-800">
            {returnedCount} de {assets.length}
          </Badge>
        </div>
        <CardDescription>Verifica la entrega de herramientas y equipo de trabajo</CardDescription>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        <div className="space-y-2">
          {assets.map((asset) => (
            <div 
              key={asset.id} 
              className={`flex items-center justify-between p-3 rounded-md border transition-all ${
                asset.returned ? "bg-green-50/50 border-green-200" : "bg-white border-slate-100"
              }`}
            >
              <div className="flex items-center gap-3">
                <Checkbox 
                  id={asset.id} 
                  checked={asset.returned} 
                  onCheckedChange={() => handleToggle(asset.id)}
                />
                <Label 
                  htmlFor={asset.id} 
                  className={`text-sm cursor-pointer ${asset.returned ? "line-through text-muted-foreground" : "font-medium"}`}
                >
                  {asset.name}
                </Label>
              </div>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 text-muted-foreground hover:text-red-500"
                onClick={() => removeItem(asset.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Input 
            placeholder="Añadir otro activo (ej. Laptop, Herramientas)..." 
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addItem()}
            className="text-sm"
          />
          <Button variant="outline" size="icon" onClick={addItem}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {returnedCount === assets.length && assets.length > 0 && (
          <div className="flex items-center gap-2 p-3 bg-green-100/50 text-green-800 rounded-lg text-xs font-medium border border-green-200">
            <CheckCircle2 className="h-4 w-4" />
            Todos los activos han sido entregados satisfactoriamente.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Badge({ children, variant, className }: any) {
  return (
    <div className={`text-xs font-bold px-2 py-0.5 rounded-full ${className}`}>
      {children}
    </div>
  );
}
