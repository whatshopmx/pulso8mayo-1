"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Loader2, Package, Calendar, Tag, Clock, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface Batch {
  id: string;
  lotNumber: string | null;
  currentQuantity: number;
  expirationDate: string | null;
  unitCost: number | null;
  receivedAt: string | null;
}

interface ProductDetails {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string;
  minLevel: number | null;
  maxLevel: number | null;
  lastCost: number | null;
  storageRequirements: string | null;
  allergenInfo: string | null;
  typicalShelfLifeDays: number | null;
  totalStock: number;
}

interface ProductDetailDrawerProps {
  productId: string | null;
  branchId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProductDetailDrawer({ productId, branchId, open, onOpenChange }: ProductDetailDrawerProps) {
  const [product, setProduct] = useState<ProductDetails | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !productId) return;

    async function fetchData() {
      setLoading(true);
      try {
        const prodRes = await fetch(`/api/inventory/products/${productId}`);
        if (prodRes.ok) {
          const prodData = await prodRes.json();
          setProduct(prodData);
        }

        if (branchId) {
          const batchRes = await fetch(`/api/inventory/batches?itemId=${productId}&branchId=${branchId}`);
          if (batchRes.ok) {
            const batchData = await batchRes.json();
            setBatches(batchData.batches || []);
          }
        }
      } catch (error) {
        console.error("Error loading product detail in drawer:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [productId, branchId, open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg w-full flex flex-col gap-6 overflow-y-auto bg-background p-6">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : product ? (
          <>
            <SheetHeader className="p-0">
              <div className="flex items-center gap-2">
                <Badge variant={product.totalStock < (product.minLevel || 0) ? "destructive" : "secondary"}>
                  {product.totalStock < (product.minLevel || 0) ? "Bajo Stock" : "Stock OK"}
                </Badge>
                {product.category && (
                  <Badge variant="outline" className="capitalize">
                    {product.category}
                  </Badge>
                )}
              </div>
              <SheetTitle className="text-xl mt-2">{product.name}</SheetTitle>
              <SheetDescription className="font-mono text-xs">
                SKU: {product.sku || "N/A"}
              </SheetDescription>
            </SheetHeader>

            <div className="grid grid-cols-2 gap-4 bg-muted/20 p-4 rounded-lg border">
              <div>
                <span className="text-xs text-muted-foreground block">Stock Actual</span>
                <span className="text-2xl font-bold font-mono">
                  {product.totalStock} {product.unit}
                </span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Último Costo</span>
                <span className="text-2xl font-bold font-mono">
                  ${product.lastCost ? (product.lastCost / 100).toFixed(2) : "0.00"}
                </span>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Tag className="h-4 w-4 text-muted-foreground" /> Especificaciones del Producto
              </h4>
              <dl className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                <div>
                  <dt className="text-muted-foreground text-xs">Stock Mínimo</dt>
                  <dd className="font-medium font-mono">{product.minLevel || 0} {product.unit}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Stock Máximo</dt>
                  <dd className="font-medium font-mono">{product.maxLevel || "N/A"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Vida Útil</dt>
                  <dd className="font-medium">{product.typicalShelfLifeDays ? `${product.typicalShelfLifeDays} días` : "N/A"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Conservación</dt>
                  <dd className="font-medium truncate" title={product.storageRequirements || "N/A"}>
                    {product.storageRequirements || "N/A"}
                  </dd>
                </div>
              </dl>
              {product.allergenInfo && (
                <div className="flex gap-2 p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs">
                  <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
                  <div>
                    <span className="font-semibold block mb-0.5">Alérgenos</span>
                    {product.allergenInfo}
                  </div>
                </div>
              )}
            </div>

            <Separator />

            <div className="space-y-4 flex-1">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" /> Control de Lotes (FIFO)
              </h4>
              {batches.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">
                  No hay lotes disponibles en esta sucursal.
                </p>
              ) : (
                <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                  {batches.map((batch) => {
                    const isExpiring = batch.expirationDate 
                      ? Math.ceil((new Date(batch.expirationDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) < 7 
                      : false;
                    return (
                      <div key={batch.id} className="flex justify-between items-center p-3 rounded-lg border bg-card text-xs font-mono">
                        <div>
                          <div className="font-semibold text-foreground flex items-center gap-1.5">
                            <Package className="h-3 w-3 text-muted-foreground" />
                            {batch.lotNumber || "Sin lote"}
                          </div>
                          {batch.expirationDate && (
                            <div className={`text-[10px] mt-0.5 flex items-center gap-1 ${isExpiring ? "text-red-500 font-semibold" : "text-muted-foreground"}`}>
                              <Clock className="h-2.5 w-2.5" />
                              Expira: {new Date(batch.expirationDate).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          <span className="font-bold text-foreground">{batch.currentQuantity} {product.unit}</span>
                          {batch.unitCost && (
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              Costo: ${(batch.unitCost / 100).toFixed(2)}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="text-center text-muted-foreground py-12">
            No se pudo cargar la información del producto.
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
