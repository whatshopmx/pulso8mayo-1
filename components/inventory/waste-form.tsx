'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AlertTriangle, Package, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { formatQty } from '@/lib/utils';

const reasonLabels: Record<string, string> = {
  EXPIRED: 'Caducidad',
  DAMAGED: 'Dañado',
  QUALITY: 'Calidad',
  SPILLAGE: 'Derrame',
  STAFF: 'Consumo de personal',
  OTHER: 'Otro',
};

/**
 * Traduce el fallo de la API a lenguaje de cocina.
 *
 * Se apoya en el código ESTABLE de `error.details.code` (`WASTE_ERROR_CODES` en
 * `app/api/inventory/waste/route.ts`), nunca en substrings del mensaje: la ruta
 * responde en español y su copy va a cambiar.
 */
function humanizeWasteError(
  code: string | null,
  message: string,
  status?: number
): string {
  // El servidor ya arma el mensaje con la cantidad restante y su unidad.
  if (code === 'OVER_QUANTITY') {
    return (
      message ||
      'El lote seleccionado ya no tiene suficiente stock. Actualiza la página e intenta de nuevo.'
    );
  }
  if (code === 'BATCH_NOT_FOUND') {
    return 'No se encontró el lote seleccionado. Vuelve a elegirlo.';
  }
  if (code === 'BRANCH_FORBIDDEN') {
    return 'Solo puedes registrar mermas en tu sucursal.';
  }
  if (status === 401) {
    return 'Tu sesión expiró. Vuelve a iniciar sesión.';
  }
  // Errores de validación sin código: el mensaje de la ruta ya viene en español.
  if (status === 400 && message) {
    return message;
  }
  return 'No se pudo registrar la merma. Revisa tu conexión e intenta de nuevo.';
}

/** Cantidad restante del lote elegido, con su unidad, para el mensaje de error. */
type BatchLimit = { maxQuantity: number; unit: string } | null;

/**
 * El máximo depende del lote seleccionado, pero la validación tiene que correr
 * ANTES de que se abra el diálogo destructivo — no después de que el usuario ya
 * confirmó. Leer el límite de un ref dentro del `superRefine` deja el schema (y
 * con él el resolver) estable entre renders, y aun así valida contra el lote
 * vigente en el momento del submit.
 *
 * `min(1)` desapareció a propósito: la cocina se mide en kg y L, y 0.5 kg es una
 * merma perfectamente válida (plan-inventory-waste, T6).
 */
function buildWasteFormSchema(limitRef: { current: BatchLimit }) {
  return z
    .object({
      itemId: z.string().min(1, 'Selecciona un producto'),
      batchId: z.string().min(1, 'Selecciona un lote'),
      quantity: z.coerce.number().positive('La cantidad debe ser mayor a 0'),
      unit: z.string().min(1, 'Unidad es requerida'),
      reason: z.enum(['EXPIRED', 'DAMAGED', 'QUALITY', 'SPILLAGE', 'OTHER', 'STAFF']),
      costPerUnit: z.coerce.number().min(0).optional(),
      notes: z.string().optional(),
    })
    .superRefine((data, ctx) => {
      const limit = limitRef.current;
      if (!limit) return;
      if (data.quantity > limit.maxQuantity) {
        ctx.addIssue({
          code: 'custom',
          path: ['quantity'],
          message: `Solo quedan ${formatQty(limit.maxQuantity)} ${limit.unit} en este lote`,
        });
      }
    });
}

type WasteFormValues = z.infer<ReturnType<typeof buildWasteFormSchema>>;

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
  const [pendingSubmission, setPendingSubmission] = useState<WasteFormValues | null>(null);
  const router = useRouter();

  // Se rellena más abajo, en cuanto se conocen el lote y el producto elegidos.
  const batchLimitRef = useRef<BatchLimit>(null);
  const wasteFormSchema = useMemo(() => buildWasteFormSchema(batchLimitRef), []);

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

  // Los campos numéricos guardan el texto crudo mientras se escribe (para que
  // "2." no colapse a 2 y bloquee el punto decimal); Zod lo coacciona al validar
  // y aquí se coacciona para el cálculo en vivo de la pérdida.
  const quantity = Number(form.watch('quantity')) || 0;
  const costPerUnit = Number(form.watch('costPerUnit')) || 0;
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

  // Step 1: intercept submit and ask for confirmation (irreversible write-off)
  function onSubmit(data: WasteFormValues) {
    setPendingSubmission(data);
  }

  // Step 2: user confirmed — post the waste
  async function confirmAndPost() {
    const data = pendingSubmission;
    if (!data) return;

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

      // Envelope de la API: { success, data } | { success:false, error:{ message, details } }.
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.success) {
        setPendingSubmission(null);
        toast.error('No se registró la merma', {
          description: humanizeWasteError(
            payload?.error?.details?.code ?? null,
            payload?.error?.message ?? '',
            response.status
          ),
        });
        return;
      }

      setPendingSubmission(null);
      toast.success('Merma registrada', {
        description: `Se dieron de baja ${data.quantity} ${data.unit} de ${selectedProduct?.name ?? 'producto'}.`,
        action: {
          label: 'Ver registro',
          onClick: () => router.push('/dashboard/inventory/movements'),
        },
      });

      form.reset();
      onSuccess?.();
    } catch (error) {
      // Solo llega aquí un fallo de red / JSON ilegible: el error de la API se
      // maneja arriba con su código estable.
      console.error('Error submitting waste form:', error);
      setPendingSubmission(null);
      toast.error('No se registró la merma', {
        description: humanizeWasteError(null, ''),
      });
    } finally {
      setSubmitting(false);
    }
  }

  const selectedProduct = products.find(p => p.id === selectedItemId);
  const selectedBatch = batches.find(b => b.id === selectedBatchId);
  // Sin lote elegido no hay máximo que imponer (`batchId` es obligatorio, así
  // que el formulario no llega a enviarse). El viejo fallback `|| 1` venía de la
  // era integer y habría rechazado cualquier merma mayor a 1.
  const maxQuantity = selectedBatch ? Number(selectedBatch.currentQuantity) : null;
  batchLimitRef.current =
    maxQuantity === null
      ? null
      : { maxQuantity, unit: selectedProduct?.unit ?? form.getValues('unit') };

  return (
    <Form {...form}>
      {/* `noValidate`: la validación es la de Zod, que se muestra en el
          `FormMessage` (enlazado por `aria-describedby` desde `FormControl`).
          Sin esto el navegador se adelanta con su burbuja nativa, que el lector
          de pantalla no anuncia y el usuario no puede releer. */}
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
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
                          {batch.lotNumber || 'Sin lote'} - Stock: {formatQty(batch.currentQuantity)}{' '}
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
                    step="0.001"
                    inputMode="decimal"
                    max={maxQuantity ?? undefined}
                    {...field}
                    value={(field.value as string | number) ?? ''}
                    onChange={(e) => field.onChange(e.target.value)}
                  />
                </FormControl>
                {maxQuantity !== null && (
                  <FormDescription>
                    Máximo: {formatQty(maxQuantity)} {selectedProduct?.unit}
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
                    <SelectItem value="STAFF">Consumo de Personal</SelectItem>
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
                  inputMode="decimal"
                  placeholder="0.00"
                  {...field}
                  value={(field.value as string | number) ?? ''}
                  onChange={(e) => field.onChange(e.target.value === '' ? undefined : e.target.value)}
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

      <AlertDialog
        open={pendingSubmission !== null}
        onOpenChange={(open) => {
          if (!open && !submitting) setPendingSubmission(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Confirmar baja por merma?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Se darán de baja{' '}
                  <strong>
                    {pendingSubmission?.quantity} {pendingSubmission?.unit}
                  </strong>{' '}
                  de <strong>{selectedProduct?.name}</strong>
                  {selectedBatch?.lotNumber && (
                    <> (lote {selectedBatch.lotNumber})</>
                  )}
                  {' '}por <strong>{reasonLabels[pendingSubmission?.reason ?? 'OTHER']}</strong>.
                </p>
                {totalLoss > 0 && (
                  <p className="text-amber-700 dark:text-amber-400 font-medium">
                    Pérdida estimada: ${totalLoss.toFixed(2)} MXN
                  </p>
                )}
                <p className="text-xs">
                  Esta acción descuenta el stock de inmediato y no se puede deshacer.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Revisar de nuevo</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmAndPost();
              }}
              disabled={submitting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Registrando...
                </>
              ) : (
                'Sí, dar de baja'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Form>
  );
}
