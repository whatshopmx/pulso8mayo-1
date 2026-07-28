"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, PageContainer } from "@/components/shared";
import { ProductPhotoUpload } from "@/components/inventory/product-photo-upload";
import { useCreateProduct } from "@/hooks/queries";
import { CATEGORIES, UNITS } from "@/lib/inventory/constants";
import { Package, Loader2, ChevronLeft } from "lucide-react";
import { toast } from "sonner";

const productSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  sku: z.string(),
  barcode: z.string(),
  category: z.string(),
  unit: z.string(),
  minLevel: z.coerce.number().min(0),
  maxLevel: z.coerce.number().min(0),
  supplierId: z.string(),
  lastCost: z.coerce.number().min(0),
  shelfLife: z.coerce.number().min(0),
  storage: z.string(),
  allergenInfo: z.string(),
  brand: z.string().optional(),
  presentation: z.string().optional(),
  standardCost: z.coerce.number().min(0).optional(),
});

type ProductFormValues = z.infer<typeof productSchema>;

export default function NewProductPage() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [suppliersError, setSuppliersError] = useState(false);
  const [formPhotoUrl, setFormPhotoUrl] = useState<string | null>(null);
  const createProduct = useCreateProduct();

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema) as any,
    defaultValues: {
      name: "",
      sku: "",
      barcode: "",
      category: "",
      unit: "KG",
      minLevel: 0,
      maxLevel: 0,
      supplierId: "",
      lastCost: 0,
      shelfLife: 0,
      storage: "",
      allergenInfo: "",
      brand: "",
      presentation: "",
      standardCost: 0,
    },
  });

  const fetchSuppliers = () => {
    setSuppliersError(false);
    fetch("/api/inventory/suppliers")
      .then((res) => {
        if (!res.ok) throw new Error("Error al cargar proveedores");
        return res.json();
      })
      .then((data) => setSuppliers(data.suppliers || []))
      .catch(() => setSuppliersError(true));
  };

  useEffect(fetchSuppliers, []);

  const onSubmit = (data: ProductFormValues) => {
    const body: Record<string, unknown> = {
      name: data.name.trim(),
      unit: data.unit,
    };
    if (data.sku) body.sku = data.sku;
    if (data.barcode) body.barcode = data.barcode;
    if (data.category) body.category = data.category;
    if (data.minLevel > 0) body.minLevel = data.minLevel;
    if (data.maxLevel > 0) body.maxLevel = data.maxLevel;
    if (data.supplierId) body.supplierId = data.supplierId;
    if (data.lastCost > 0) body.lastCost = Math.round(Number(data.lastCost) * 100);
    if (data.shelfLife > 0) body.typicalShelfLifeDays = data.shelfLife;
    if (data.storage) body.storageRequirements = data.storage;
    if (data.allergenInfo) body.allergenInfo = data.allergenInfo;
    if (data.brand) body.brand = data.brand.trim();
    if (data.presentation) body.presentation = data.presentation.trim();
    if (data.standardCost && data.standardCost > 0) body.standardCost = Math.round(Number(data.standardCost) * 100);
    if (formPhotoUrl) body.photoUrl = formPhotoUrl;

    createProduct.mutate(body, {
      onSuccess: () => {
        toast.success("Producto creado", {
          description: `${data.name} ya está en tu catálogo.`,
        });
        router.push("/dashboard/inventory");
      },
      onError: (error) => {
        toast.error("No se pudo crear el producto", {
          description: error instanceof Error ? error.message : "Revisa tu conexión e intenta de nuevo.",
        });
      },
    });
  };

  return (
    <PageContainer className="max-w-3xl">
      <PageHeader
        title="Nuevo Producto"
        description="Agrega un insumo al catálogo. Solo el nombre y la unidad son obligatorios."
        icon={Package}
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard/inventory">
              <ChevronLeft className="mr-1 h-4 w-4" />
              Volver
            </Link>
          </Button>
        }
      />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Sección 1: Información básica (obligatoria) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Información básica</CardTitle>
              <CardDescription>Lo mínimo para empezar a usar el producto</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre *</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: Harina de Trigo" className="min-h-[44px]" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="unit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unidad de medida *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="min-h-[44px]">
                            <SelectValue placeholder="Seleccionar unidad" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {UNITS.map((u) => (
                            <SelectItem key={u.value} value={u.value}>
                              {u.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Categoría</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="min-h-[44px]">
                            <SelectValue placeholder="Seleccionar..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {CATEGORIES.map((cat) => (
                            <SelectItem key={cat.value} value={cat.value}>
                              {cat.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="sku"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>SKU</FormLabel>
                      <FormControl>
                        <Input placeholder="HAR-001" className="min-h-[44px]" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="barcode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Código de barras</FormLabel>
                      <FormControl>
                        <Input placeholder="750100123456" className="min-h-[44px]" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {/* Sección 2: Stock y almacenamiento (opcional) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Stock y almacenamiento</CardTitle>
              <CardDescription>Opcional — puedes completarlo después</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="minLevel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Stock mínimo</FormLabel>
                      <FormControl>
                        <Input type="number" min="0" placeholder="0" className="min-h-[44px]" {...field} onChange={(e) => field.onChange(Number(e.target.value))} />
                      </FormControl>
                      <FormDescription>Te avisamos cuando baje de este nivel</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="maxLevel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Stock máximo</FormLabel>
                      <FormControl>
                        <Input type="number" min="0" placeholder="0" className="min-h-[44px]" {...field} onChange={(e) => field.onChange(Number(e.target.value))} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="shelfLife"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vida útil (días)</FormLabel>
                      <FormControl>
                        <Input type="number" min="0" placeholder="Ej: 365" className="min-h-[44px]" {...field} onChange={(e) => field.onChange(Number(e.target.value))} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="storage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Requisitos de almacenamiento</FormLabel>
                      <FormControl>
                        <Input placeholder="Ej: Refrigeración 0-4°C" className="min-h-[44px]" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="brand"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Marca</FormLabel>
                      <FormControl>
                        <Input placeholder="Ej: Sello Rojo" className="min-h-[44px]" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="presentation"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Presentación</FormLabel>
                      <FormControl>
                        <Input placeholder="Ej: Envase de 1L, Caja de 10 kg" className="min-h-[44px]" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="allergenInfo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Información de alérgenos</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: Contiene gluten, lácteos" className="min-h-[44px]" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <ProductPhotoUpload
                currentPhotoUrl={null}
                onPhotoChange={setFormPhotoUrl}
              />
            </CardContent>
          </Card>

          {/* Sección 3: Proveedor y costo (opcional) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Proveedor y costo</CardTitle>
              <CardDescription>Opcional — ayuda a las sugerencias de compra</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="supplierId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Proveedor preferido</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="min-h-[44px]">
                            <SelectValue placeholder="Seleccionar proveedor..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {suppliersError ? (
                            <div className="p-3 text-sm text-center space-y-2">
                              <p className="text-destructive">Error al cargar</p>
                              <Button variant="outline" size="sm" onClick={fetchSuppliers}>
                                Reintentar
                              </Button>
                            </div>
                          ) : suppliers.length > 0 ? (
                            suppliers.map((s) => (
                              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                            ))
                          ) : (
                            <div className="p-2 text-sm text-muted-foreground text-center">
                              No hay proveedores registrados
                            </div>
                          )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lastCost"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Último costo de compra</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" placeholder="0.00" className="min-h-[44px]" {...field} onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : 0)} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="standardCost"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Costo estándar</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" placeholder="0.00" className="min-h-[44px]" {...field} onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : 0)} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-3 justify-end pb-8">
            <Button variant="outline" type="button" className="min-h-[44px]" asChild>
              <Link href="/dashboard/inventory">Cancelar</Link>
            </Button>
            <Button type="submit" disabled={createProduct.isPending} className="min-h-[44px]">
              {createProduct.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Crear Producto
            </Button>
          </div>
        </form>
      </Form>
    </PageContainer>
  );
}
