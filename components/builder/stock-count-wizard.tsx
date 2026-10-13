"use client";

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useBuilder } from './builder-context';

interface Category { category: string; productCount: number }

export function useStockCountCategories(enabled = true) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    fetch('/api/inventory/stock-count/categories', { signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudieron cargar las categorías');
      setCategories(data);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [enabled, attempt]);
  return { categories, error, loading, retry: () => retry(value => value + 1) };
}

export function StockCountWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { steps, addStockCountSteps } = useBuilder();
  const { categories, error, loading, retry } = useStockCountCategories(open);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState(false);
  const existing = new Set(steps.filter(step => step.type === 'STOCK_COUNT').map(step => step.config?.category));
  const choices = selected.filter(category => !existing.has(category));
  return <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <DialogContent className="sm:max-w-xl">
      <DialogHeader><DialogTitle>{preview ? 'Revisa los componentes' : 'Conteo por categorías'}</DialogTitle>
        <DialogDescription>Agrega un componente por categoría con todos sus productos y lotes. Las cantidades se guardarán para revisión.</DialogDescription></DialogHeader>
      {loading ? <p role="status" className="py-6 text-sm text-muted-foreground">Cargando categorías…</p> : error ? <div role="alert" className="space-y-3 text-sm"><p>{error}</p><Button variant="outline" onClick={retry}>Reintentar</Button></div> : !categories.length ? <p className="py-4 text-sm text-muted-foreground">Registra productos activos en Inventario para configurar el conteo.</p> : <>
        {preview ? <div className="max-h-80 space-y-2 overflow-y-auto">{choices.map(category => <div key={category} className="rounded-lg border p-3"><p className="text-sm font-medium">Conteo · {category}</p><p className="text-xs text-muted-foreground">{categories.find(item => item.category === category)?.productCount} productos · todos los lotes de la sucursal</p></div>)}
          <p className="pt-2 text-xs text-muted-foreground">El catálogo y sus lotes se cargarán al iniciar cada ejecución; ese alcance quedará fijo para poder reanudarla.</p></div> : <>
          <Input type="search" aria-label="Buscar categoría" placeholder="Buscar categoría" value={query} onChange={event => setQuery(event.target.value)} />
          <div className="max-h-80 space-y-2 overflow-y-auto">{categories.filter(item => item.category.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(item => <label key={item.category} className="flex min-h-12 items-center gap-3 rounded-lg border p-3 text-sm">
            <input type="checkbox" disabled={existing.has(item.category)} checked={choices.includes(item.category)} onChange={event => setSelected(previous => event.target.checked ? [...previous, item.category] : previous.filter(value => value !== item.category))} />
            <span className="flex-1">{item.category}</span><span className="text-xs text-muted-foreground">{existing.has(item.category) ? 'Ya incluida' : `${item.productCount} productos`}</span>
          </label>)}{!categories.some(item => item.category.toLocaleLowerCase().includes(query.toLocaleLowerCase())) && <p className="py-3 text-sm text-muted-foreground">No hay coincidencias.</p>}</div>
        </>}
        <div className="flex flex-wrap justify-between gap-2"><Button variant="outline" onClick={() => preview ? setPreview(false) : onClose()}>{preview ? 'Atrás' : 'Cancelar'}</Button>
          <Button disabled={!choices.length} onClick={() => {
            if (!preview) { setPreview(true); return; }
            addStockCountSteps(choices); setSelected([]); setPreview(false); setQuery(''); onClose();
          }}>{preview ? `Agregar ${choices.length} componentes` : `Revisar ${choices.length} categorías`}</Button></div>
      </>}
    </DialogContent>
  </Dialog>;
}
