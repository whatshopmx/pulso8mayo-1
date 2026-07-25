"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/hooks/use-tenant";
import { Loader2, X } from "lucide-react";
import { complianceServiceTypes, maintenanceFrequencies, complianceServiceAreas } from "@/lib/equipment-constants";

interface ServiceProvider {
  id: string;
  name: string;
  providerType: string;
}

const formSchema = z.object({
  branchId: z.string().min(1, "La sucursal es requerida"),
  serviceType: z.string().min(1, "El tipo de servicio es requerido"),
  serviceName: z.string().min(1, "El nombre del servicio es requerido"),
  regulationReference: z.string().optional(),
  isMandatory: z.boolean(),
  frequency: z.string().min(1, "La frecuencia es requerida"),
  customDays: z.number().optional(),
  providerId: z.string().optional(),
  providerName: z.string().optional(),
  providerContact: z.string().optional(),
  nextServiceDate: z.string().optional(),
  serviceAreas: z.array(z.string()).optional(),
  specialInstructions: z.string().optional(),
  isActive: z.boolean(),
});

type FormData = z.infer<typeof formSchema>;

interface ComplianceServiceFormProps {
  initialData?: Partial<FormData>;
  onSuccess: () => void;
}

export function ComplianceServiceForm({ initialData, onSuccess }: ComplianceServiceFormProps) {
  const { toast } = useToast();
  const { tenant } = useTenant();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [providers, setProviders] = useState<ServiceProvider[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [isLoadingProviders, setIsLoadingProviders] = useState(true);
  const [selectedAreas, setSelectedAreas] = useState<string[]>(initialData?.serviceAreas || []);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      branchId: initialData?.branchId || tenant?.branchId || "",
      serviceType: initialData?.serviceType || "",
      serviceName: initialData?.serviceName || "",
      regulationReference: initialData?.regulationReference || "",
      isMandatory: initialData?.isMandatory ?? true,
      frequency: initialData?.frequency || "MONTHLY",
      customDays: initialData?.customDays,
      providerId: initialData?.providerId || "",
      providerName: initialData?.providerName || "",
      providerContact: initialData?.providerContact || "",
      nextServiceDate: initialData?.nextServiceDate || "",
      serviceAreas: initialData?.serviceAreas || [],
      specialInstructions: initialData?.specialInstructions || "",
      isActive: initialData?.isActive ?? true,
    },
  });

  useEffect(() => {
    fetchProviders();
    fetchBranches();
  }, []);

  const fetchBranches = async () => {
    try {
      const res = await fetch("/api/branches");
      if (res.ok) {
        const result = await res.json();
        const branchList = result.data || result || [];
        setBranches(branchList);
        if (!form.getValues("branchId") && tenant?.branchId) {
          form.setValue("branchId", tenant.branchId);
        } else if (!form.getValues("branchId") && branchList.length > 0) {
          form.setValue("branchId", branchList[0].id);
        }
      }
    } catch (err) {
      console.error("Error fetching branches:", err);
    }
  };

  const fetchProviders = async () => {
    try {
      const response = await fetch("/api/equipment/providers");
      if (response.ok) {
      const data = await response.json();
      setProviders(data.data || []);
      }
    } catch (error) {
      console.error("Error fetching providers:", error);
    } finally {
      setIsLoadingProviders(false);
    }
  };

  const addArea = (area: string) => {
    if (area && !selectedAreas.includes(area)) {
      const newAreas = [...selectedAreas, area];
      setSelectedAreas(newAreas);
      form.setValue("serviceAreas", newAreas);
    }
  };

  const removeArea = (area: string) => {
    const newAreas = selectedAreas.filter((a) => a !== area);
    setSelectedAreas(newAreas);
    form.setValue("serviceAreas", newAreas);
  };

  const onSubmit = async (data: FormData) => {
    try {
      setIsSubmitting(true);

      const response = await fetch("/api/compliance-services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: data.branchId,
          serviceType: data.serviceType,
          serviceName: data.serviceName,
          regulationReference: data.regulationReference,
          isMandatory: data.isMandatory,
          frequency: data.frequency,
          customDays: data.customDays,
          providerId: data.providerId,
          providerName: data.providerName,
          providerContact: data.providerContact,
          nextServiceDate: data.nextServiceDate ? new Date(data.nextServiceDate).toISOString() : undefined,
          serviceAreas: selectedAreas,
          specialInstructions: data.specialInstructions,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Error al crear el servicio");
      }

      toast({
        title: "Éxito",
        description: "Servicio normativo configurado correctamente",
      });

      onSuccess();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Error al crear el servicio",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedFrequency = form.watch("frequency");

  if (isLoadingProviders) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Service Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Información del Servicio</h3>

            <FormField
              control={form.control}
              name="branchId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sucursal *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona la sucursal" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {branches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Sucursal asignada para recibir este servicio normativo
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="serviceType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo de Servicio *</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona el tipo" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {complianceServiceTypes.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
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
              name="serviceName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre del Servicio *</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej. Fumigación Mensual" {...field} />
                  </FormControl>
                  <FormDescription>
                    Nombre descriptivo para identificar este servicio
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="regulationReference"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Referencia Normativa</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej. NOM-251-SSA1-2009" {...field} />
                  </FormControl>
                  <FormDescription>
                    Código de la normativa aplicable
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="isMandatory"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Servicio Obligatorio</FormLabel>
                    <p className="text-sm text-muted-foreground">
                      Requerido por ley o regulación
                    </p>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>

          {/* Schedule */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Programación</h3>

            <FormField
              control={form.control}
              name="frequency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Frecuencia *</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona la frecuencia" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {maintenanceFrequencies.map((freq) => (
                        <SelectItem key={freq.value} value={freq.value}>
                          {freq.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {selectedFrequency === "CUSTOM" && (
              <FormField
                control={form.control}
                name="customDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Días Personalizados</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                        onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                      />
                    </FormControl>
                    <FormDescription>
                      Número de días entre servicios
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="nextServiceDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Próximo Servicio</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        {/* Provider */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Proveedor</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FormField
              control={form.control}
              name="providerId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Proveedor Existente</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona un proveedor (opcional)" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {providers.map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {provider.name}
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
              name="providerName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre del Proveedor</FormLabel>
                  <FormControl>
                    <Input placeholder="Nombre de la empresa" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="providerContact"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contacto del Proveedor</FormLabel>
                  <FormControl>
                    <Input placeholder="Teléfono o email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        {/* Service Areas */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Áreas a Serviciar</h3>
          <FormField
            control={form.control}
            name="serviceAreas"
            render={() => (
              <FormItem>
                <div className="flex flex-wrap gap-2 mb-4">
                  {selectedAreas.map((area) => (
                    <Badge key={area} variant="secondary" className="gap-1">
                      {area}
                      <button
                        type="button"
                        onClick={() => removeArea(area)}
                        className="ml-1 hover:text-destructive"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <Select
                  onValueChange={(value) => addArea(value)}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Agregar área..." />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {complianceServiceAreas
                      .filter((a) => !selectedAreas.includes(a))
                      .map((area) => (
                        <SelectItem key={area} value={area}>
                          {area}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Special Instructions */}
        <FormField
          control={form.control}
          name="specialInstructions"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Instrucciones Especiales</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Instrucciones especiales para el servicio..."
                  rows={3}
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Requisitos específicos, horarios preferidos, etc.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="isActive"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <FormLabel className="text-base">Activo</FormLabel>
                <p className="text-sm text-muted-foreground">
                  El servicio está programado y activo
                </p>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-4">
          <Button type="button" variant="outline" onClick={() => form.reset()}>
            Limpiar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar Servicio
          </Button>
        </div>
      </form>
    </Form>
  );
}
