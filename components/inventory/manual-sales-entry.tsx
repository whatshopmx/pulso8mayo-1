"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, ShoppingCart } from 'lucide-react';

interface CaptureResult {
  inserted?: number;
  updated?: number;
  skipped?: number;
  revenueComplete?: boolean;
  error?: string;
  code?: string;
}

export function ManualSalesEntry({ branchId, recipes, onSaved }: {
  branchId: string | null;
  recipes: { id: string; name: string }[];
  onSaved: () => void;
}) {
  const [recipeId, setRecipeId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [revenue, setRevenue] = useState('');
  const [saleDay, setSaleDay] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<CaptureResult | null>(null);
  const busy = useRef(false), alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const now = new Date();
    setSaleDay(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
    return () => { alive.current = false; };
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!branchId || !recipeId || busy.current) return;
    busy.current = true;
    setSaving(true); setResult(null);
    try {
      const response = await fetch('/api/inventory/sales-entry', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({ branchId, saleDate: saleDay,
          sales: [{ recipeId, quantitySold: Number(quantity), totalRevenue: revenue === '' ? null : Number(revenue) }] }),
      });
      const data = await response.json() as CaptureResult;
      if (!alive.current) return;
      if (!response.ok) {
        setResult({ error: typeof data.error === 'string' ? data.error : 'No se pudo guardar el total. Revisa los datos e inténtalo de nuevo.', code: data.code });
      } else {
        if (![data.inserted, data.updated, data.skipped].every(value => typeof value === 'number' && Number.isInteger(value) && value >= 0)) throw new Error('Invalid capture response');
        setResult(data);
        onSaved();
      }
    } catch {
      if (alive.current) setResult({ error: 'No se pudo confirmar la captura. Puedes reintentar el mismo total sin duplicar el consumo.' });
    } finally {
      busy.current = false;
      if (alive.current) setSaving(false);
    }
  }

  return <Card role="region" aria-label="Captura manual de ventas">
    <CardHeader>
      <CardTitle className="text-base flex items-center gap-2"><ShoppingCart className="h-4 w-4" />Captura manual de ventas</CardTitle>
      <CardDescription>Captura el total de la receta para el día. Repetir conserva el total; corregir lo reemplaza; cero lo anula.</CardDescription>
    </CardHeader>
    <form onSubmit={submit}>
      <fieldset disabled={saving || !branchId} className="min-w-0 space-y-4">
        <CardContent className="space-y-4">
          {!branchId && <p className="text-sm text-muted-foreground">Selecciona una sucursal para capturar ventas.</p>}
          <div className="space-y-2">
            <Label htmlFor="manual-sale-recipe">Receta / Platillo</Label>
            <Select value={recipeId} onValueChange={value => { setRecipeId(value); setResult(null); }} disabled={!recipes.length || saving || !branchId}>
              <SelectTrigger id="manual-sale-recipe"><SelectValue placeholder="Seleccionar platillo..." /></SelectTrigger>
              <SelectContent>{recipes.map(recipe => <SelectItem key={recipe.id} value={recipe.id}>{recipe.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-sale-day">Fecha de venta</Label>
            <Input id="manual-sale-day" type="date" required value={saleDay} onChange={event => { setSaleDay(event.target.value); setResult(null); }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="manual-sale-quantity">Cantidad</Label>
              <Input id="manual-sale-quantity" type="number" required min="0" max="99999999.99" step="0.01" value={quantity} onChange={event => { setQuantity(event.target.value); setResult(null); }} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="manual-sale-revenue">Ingreso Venta ($)</Label>
              <Input id="manual-sale-revenue" type="number" min="0" max="21474836.47" step="0.01" value={revenue} onChange={event => { setRevenue(event.target.value); setResult(null); }} aria-describedby="manual-revenue-help" placeholder="No reportado" />
            </div>
          </div>
          <p id="manual-revenue-help" className="text-xs text-muted-foreground">Ingreso en pesos. Deja vacío si no está reportado; 0 indica un ingreso explícito de cero.</p>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full gap-2" disabled={saving || !branchId || !recipeId || !saleDay}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}Guardar total
          </Button>
        </CardFooter>
      </fieldset>
    </form>
    {result && <CardContent>
      {result.error ? <div role="alert" className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        <p>{result.error}</p>
        {result.code === 'PENDING_RECOVERY' && <Link href="/dashboard/inventory/sales-entry" className="underline">Revisar recuperación histórica</Link>}
      </div> : <div role="region" aria-label="Resultado de captura" aria-live="polite" className="space-y-2 rounded-md border p-3 text-sm">
        <p>Total manual guardado para {saleDay}.</p>
        <p>{result.inserted} nueva · {result.updated} corregidas · {result.skipped} sin cambios</p>
        <p>{result.revenueComplete === true ? 'Ingreso completo' : result.revenueComplete === false ? 'Ingreso incompleto' : 'Cobertura de ingreso no disponible'}</p>
      </div>}
    </CardContent>}
  </Card>;
}
