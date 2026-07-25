'use client';

import { useState, useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { AlertTriangle, Package, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const wasteFormSchema = z.object({
  itemId: z.string().min(1, 'Selecciona un producto'),
  batchId: z.string().min(1, 'Selecciona un lote'),
  quantity: z.coerce.number().min(1, 'Cantidad debe ser mayor a 0'),
  unit: z.string().min(1, 'Unidad es requerida'),
  reason: z.enum(['EXPIRED', 'DAMAGED', 'QUALITY', 'SPILLAGE', 'OTHER', 'STAFF']),
  costPerUnit: z.coerce.number().min(0).optional(),
  notes: z.string().optional(),
});

type WasteFormValues = z.infer<typeof wasteFormSchema>;

interface Product {
  id: string;
  name: string;
  sku: string;
  unit: string;
}

interface Batch {
  id: string;
  lotNumber: string | null;
  currentQuantity: number;
  expirationDate: string | null;
  unitCost: number | null;
}

interface WasteFormProps {
  branchId: string;
  onSuccess?: () => void;
  onCancel?: () => void;
  preselectedItemId?: string;
}

export function WasteForm({ branchId, onSuccess, onCancel, preselectedItemId }: WasteFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadingBatches, setLoadingBatches] = useState(false);

  const form = useForm({
    resolver: zodResolver(wasteFormSchema),
    defaultValues: {
      itemId: '',
      batchId: '',
      quantity: 1,
      unit: 'UNIT',
      reason: 'EXPIRED',
      costPerUnit: 0,
      notes: '',
    },
  });

  const quantity = form.watch('quantity') as number;
  const costPerUnit = (form.watch('costPerUnit') as number) || 0;
  const totalLoss = quantity * costPerUnit;

  // Load products on mount
  useEffect(() => {
    async function loadProducts() {
      try {
        const res = await fetch('/api/inventory/products');
        if (res.ok) {
          const data = await res.json();
          setProducts(data || []);
          // Preselect item if provided
          if (preselectedItemId && data?.find((p: Product) => p.id === preselectedItemId)) {
            form.setValue('itemId', preselectedItemId);
          }
        }
      } catch (error) {
        console.error('Error loading products:', error);
        toast.error('Error al cargar productos');
      } finally {
        setLoadingProducts(false);
      }
    }
    loadProducts();
  }, [preselectedItemId, form]);

  // Load batches when product changes
  const selectedItemId = form.watch('itemId');
  useEffect(() => {
    if (!selectedItemId) {
      setBatches([]);
      form.setValue('batchId', '');
      return;
    }

    async function loadBatches() {
      setLoadingBatches(true);
      try {
        // Get the selected product to set the unit
        const selectedProduct = products.find(p => p.id === selectedItemId);
        if (selectedProduct) {
          form.setValue('unit', selectedProduct.unit);
        }

        const res = await fetch(`/api/inventory/batches?itemId=${selectedItemId}&branchId=${branchId}`);
        if (res.ok) {
          const data = await res.json();
          // Filter only AVAILABLE batches with stock
          const availableBatches = (data.batches || []).filter(
            (b: Batch) => b.currentQuantity > 0
          );
          setBatches(availableBatches);
        }
      } catch (error) {
        console.error('Error loading batches:', error);
        toast.error('Error al cargar lotes');
      } finally {
        setLoadingBatches(false);
      }
    }
    loadBatches();
  }, [selectedItemId, branchId, products, form]);

  // Update cost per unit when batch changes
  const selectedBatchId = form.watch('batchId');
  useEffect(() => {
    if (!selectedBatchId) {
      form.setValue('costPerUnit', 0);
      return;
    }

    const selectedBatch = batches.find(b => b.id === selectedBatchId);
    if (selectedBatch?.unitCost) {
      // Convert cents to dollars for display
      form.setValue('costPerUnit', selectedBatch.unitCost / 100);
    }
  }, [selectedBatchId, batches, form]);

  async function onSubmit(data: WasteFormValues) {
    try {
      setSubmitting(true);

      const response = await fetch('/api/inventory/waste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          branchId,
          totalLoss,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Error al registrar merma');
      }

      const result = await response.json();

      toast.success('Merma registrada exitosamente', {
        description: `Se registraron ${data.quantity} ${data.unit} como merma`,
      });

      form.reset();
      onSuccess?.();
    } catch (error) {
      console.error('Error submitting waste form:', error);
      toast.error('Error al registrar merma', {
        description: error instanceof Error ? error.message : 'No se pudo completar el registro. Intenta de nuevo.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  const selectedProduct = products.find(p => p.id === selectedItemId);
  const selectedBatch = batches.find(b => b.id === selectedBatchId);
  const maxQuantity = selectedBatch?.currentQuantity || 1;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          <div>
            <h3 className="text-lg font-medium">Registrar Merma</h3>
            <p className="text-sm text-muted-foreground">
              Registra productos vencidos, dañados o con problemas de calidad
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <FormField
            control={form.control}
            name="itemId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Producto</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value}
                  disabled={loadingProducts}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona un producto" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {loadingProducts ? (
                      <SelectItem value="loading" disabled>
                        Cargando productos...
                      </SelectItem>
                    ) : products.length === 0 ? (
                      <SelectItem value="empty" disabled>
                        No hay productos disponibles
                      </SelectItem>
                    ) : (
                      products.map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.name} ({product.sku})
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="batchId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Lote</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value}
                  disabled={!selectedItemId || loadingBatches}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          !selectedItemId
                            ? 'Primero selecciona un producto'
                            : loadingBatches
                            ? 'Cargando lotes...'
                            : 'Selecciona un lote'
                        }
                      />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {batches.length === 0 ? (
                      <SelectItem value="empty" disabled>
                        {selectedItemId
                          ? 'No hay lotes disponibles'
                          : 'Selecciona un producto primero'}
                      </SelectItem>
                    ) : (
                      batches.map((batch) => (
                        <SelectItem key={batch.id} value={batch.id}>
                          {batch.lotNumber || 'Sin lote'} - Stock: {batch.currentQuantity}{' '}
                          {selectedProduct?.unit}
                          {batch.expirationDate &&
                            ` - Vence: ${new Date(batch.expirationDate).toLocaleDateString()}`}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <FormDescription>
                  Solo se muestran lotes con stock disponible
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField
            control={form.control}
            name="quantity"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Cantidad</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min="1"
                    max={maxQuantity}
                    {...field}
                    value={field.value as number}
                    onChange={(e) => field.onChange(Number(e.target.value))}
                  />
                </FormControl>
                {selectedBatch && (
                  <FormDescription>
                    Máximo: {maxQuantity} {selectedProduct?.unit}
                  </FormDescription>
                )}
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="unit"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Unidad</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value}
                  disabled
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="UNIT">Unidades</SelectItem>
                    <SelectItem value="KG">Kilogramos</SelectItem>
                    <SelectItem value="L">Litros</SelectItem>
                    <SelectItem value="BOX">Cajas</SelectItem>
                  </SelectContent>
                </Select>
                <FormDescription>Auto-asignada del producto</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="reason"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Motivo</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="EXPIRED">Caducidad</SelectItem>
                    <SelectItem value="DAMAGED">Dañado</SelectItem>
                    <SelectItem value="QUALITY">Calidad</SelectItem>
                    <SelectItem value="SPILLAGE">Derrame</SelectItem>
                    <SelectItem value="STAFF">Consumo de Personal (Staff)</SelectItem>
                    <SelectItem value="OTHER">Otro</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="costPerUnit"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Costo por Unidad (opcional)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  {...field}
                  value={field.value as number}
                  onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : undefined)}
                />
              </FormControl>
              <FormDescription>
                Auto-completado desde el lote si tiene costo registrado
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {totalLoss > 0 && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-amber-600" />
              <span className="text-sm font-medium text-amber-900">
                Pérdida Estimada: ${totalLoss.toFixed(2)}
              </span>
            </div>
          </div>
        )}

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notas (opcional)</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Agrega notas adicionales sobre esta merma..."
                  className="resize-none"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex gap-3 justify-end">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" disabled={submitting || loadingProducts}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Registrando...
              </>
            ) : (
              'Registrar Merma'
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
